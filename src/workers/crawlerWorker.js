const crypto = require("crypto");
const config = require("../config");
const logger = require("../logger");
const { db, initializeDatabase, logCrawl } = require("../db");
const GitHubClient = require("../services/githubClient");
const { parseReadme } = require("../services/readmeParser");
const { calculateQualityScore, rejectReason } = require("../services/scoringService");
const { mapRepositoryToApp } = require("../services/repositoryMapper");
const { processAppScreenshots } = require("../services/screenshotService");
const { detectDuplicate } = require("../services/duplicateDetector");
const { findExistingApp, getAppById, upsertApp, updateAppFields, enqueueAiJob } = require("../services/appStore");
const { nowIso } = require("../utils/time");
const { mapLimit } = require("../utils/queue");

function repoNameParts(repo) {
  const [owner, name] = String(repo.full_name || "").split("/");
  return {
    owner: owner || repo.owner?.login,
    name: name || repo.name
  };
}

class CrawlerWorker {
  constructor(options = {}) {
    this.client = options.client || new GitHubClient();
    this.db = options.db || db;
  }

  async run(options = {}) {
    await initializeDatabase(this.db);
    const runId = options.runId || crypto.randomUUID();
    const target = options.limit || config.crawler.targetAppsPerRun;
    const stats = {
      runId,
      searched: 0,
      processed: 0,
      accepted: 0,
      rejected: 0,
      skipped: 0,
      failed: 0
    };

    logger.info("crawler run started", { runId, target });

    for (const query of config.github.searchQueries) {
      if (stats.accepted >= target) break;

      for (let page = 1; page <= config.github.maxPagesPerQuery; page += 1) {
        if (stats.accepted >= target) break;

        logger.info("github search", { query, page });
        const results = await this.client.searchRepositories(query, page, config.github.perPage);
        const repos = results.items || [];
        stats.searched += repos.length;

        await mapLimit(repos, config.crawler.concurrency, async (repo) => {
          if (stats.accepted >= target) return;
          const result = await this.processRepository(repo, query, runId);
          if (!result) return;
          stats.processed += 1;
          stats[result] = (stats[result] || 0) + 1;
        });

        if (!repos.length) break;
        await this.client.politePause();
      }
    }

    logger.info("crawler run finished", stats);
    return stats;
  }

  async processRepository(repoSummary, query, runId) {
    const parts = repoNameParts(repoSummary);
    const repoFullName = repoSummary.full_name || `${parts.owner}/${parts.name}`;

    try {
      const existing = await findExistingApp(this.db, {
        github_id: repoSummary.id,
        github_full_name: repoFullName,
        github_url: repoSummary.html_url
      });

      if (existing?.last_crawled_at && Date.now() - new Date(existing.last_crawled_at).getTime() < 12 * 60 * 60 * 1000) {
        await logCrawl(this.db, {
          runId,
          query,
          repoFullName,
          githubId: repoSummary.id,
          status: "skipped",
          message: "recently crawled"
        });
        return "skipped";
      }

      const repo = await this.client.getRepository(parts.owner, parts.name);
      const reason = rejectReason(repo, config);

      if (reason) {
        await this.storeRejectedRepo(repo, reason);
        await logCrawl(this.db, {
          runId,
          query,
          repoFullName,
          githubId: repo.id,
          status: "rejected",
          message: reason
        });
        return "rejected";
      }

      const [readme, latestRelease] = await Promise.all([
        this.client.getReadme(parts.owner, parts.name),
        this.client.getLatestRelease(parts.owner, parts.name)
      ]);

      const parsedReadme = {
        ...parseReadme(readme, {
          owner: parts.owner,
          name: parts.name,
          default_branch: repo.default_branch,
          language: repo.language,
          topics: repo.topics || []
        }),
        markdown: readme
      };

      const app = mapRepositoryToApp(repo, parsedReadme, latestRelease);
      app.quality_score = calculateQualityScore(app, parsedReadme);
      app.score = app.quality_score;
      app.status = app.quality_score >= config.crawler.minQualityScore ? "pending" : "rejected";
      app.rejection_reason = app.status === "rejected" ? "below_quality_threshold" : "";

      if (existing && ["approved", "published"].includes(existing.status)) {
        app.status = existing.status;
        app.visibility = existing.visibility;
        app.remote_openlib_id = existing.remote_openlib_id;
      }

      const appId = await upsertApp(this.db, app);
      let storedApp = await getAppById(this.db, appId);

      if (app.quality_score >= config.crawler.minQualityScore - 10 && parsedReadme.screenshots.length) {
        await processAppScreenshots(this.db, storedApp, parsedReadme.screenshots);
        storedApp = await getAppById(this.db, appId);
        const rescore = calculateQualityScore(storedApp, parsedReadme);
        await updateAppFields(this.db, appId, { quality_score: rescore, score: rescore });
        storedApp.quality_score = rescore;
      }

      const duplicate = await detectDuplicate(this.db, storedApp);
      if (duplicate && ["pending", "approved", "published"].includes(storedApp.status)) {
        const status = storedApp.status === "pending" ? "pending_duplicate" : storedApp.status;
        await updateAppFields(this.db, appId, {
          status,
          rejection_reason: status === "pending_duplicate" ? "duplicate_warning" : storedApp.rejection_reason
        });
        storedApp.status = status;
      }

      if (["pending", "pending_duplicate", "approved", "published"].includes(storedApp.status)) {
        await enqueueAiJob(this.db, appId, "enrich", config.ai.model);
      }

      await logCrawl(this.db, {
        runId,
        query,
        repoFullName,
        githubId: repo.id,
        status: storedApp.status,
        message: "processed",
        details: {
          qualityScore: storedApp.quality_score,
          duplicateScore: duplicate?.score || 0
        }
      });

      return ["pending", "pending_duplicate", "approved", "published"].includes(storedApp.status) ? "accepted" : "rejected";
    } catch (err) {
      logger.error("repository processing failed", { repoFullName, error: err.message });
      await logCrawl(this.db, {
        runId,
        query,
        repoFullName,
        githubId: repoSummary.id,
        status: "failed",
        message: err.message
      });
      return "failed";
    }
  }

  async storeRejectedRepo(repo, reason) {
    const app = mapRepositoryToApp(repo, {}, null);
    app.status = "rejected";
    app.rejection_reason = reason;
    app.quality_score = calculateQualityScore(app, {});
    app.score = app.quality_score;
    app.last_crawled_at = nowIso();
    await upsertApp(this.db, app);
  }
}

module.exports = CrawlerWorker;
