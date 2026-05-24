const config = require("../config");
const logger = require("../logger");
const { db, initializeDatabase } = require("../db");
const GitHubClient = require("../services/githubClient");
const { parseReadme } = require("../services/readmeParser");
const { mapRepositoryToApp } = require("../services/repositoryMapper");
const { calculateQualityScore, rejectReason } = require("../services/scoringService");
const { processAppScreenshots } = require("../services/screenshotService");
const { getAppById, updateAppFields, enqueueAiJob, enqueueSync, enqueueUpdateJob } = require("../services/appStore");
const { nowIso, hoursAgo } = require("../utils/time");

function splitFullName(app) {
  if (app.github_owner && app.github_repo) return { owner: app.github_owner, repo: app.github_repo };
  const [owner, repo] = String(app.github_full_name || app.github_url?.replace("https://github.com/", "") || "").split("/");
  return { owner, repo };
}

class UpdaterWorker {
  constructor(options = {}) {
    this.db = options.db || db;
    this.client = options.client || new GitHubClient();
  }

  async queueStale(limit = config.updater.batchSize) {
    const staleBefore = hoursAgo(config.updater.staleAfterHours);
    const apps = await this.db.all(
      `SELECT id FROM apps
        WHERE status IN ('pending', 'pending_duplicate', 'approved', 'published')
          AND github_full_name IS NOT NULL
          AND github_full_name != ''
          AND (last_crawled_at IS NULL OR last_crawled_at < ?)
        ORDER BY COALESCE(last_crawled_at, created_at) ASC
        LIMIT ?`,
      [staleBefore, limit]
    );

    for (const app of apps) {
      await enqueueUpdateJob(this.db, app.id, "refresh");
    }

    return apps.length;
  }

  async run(options = {}) {
    await initializeDatabase(this.db);
    const limit = options.limit || config.updater.batchSize;
    await this.queueStale(limit);

    const jobs = await this.db.all(
      `SELECT * FROM update_jobs
        WHERE status IN ('pending', 'failed')
          AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        ORDER BY created_at ASC
        LIMIT ?`,
      [nowIso(), limit]
    );

    let refreshed = 0;
    let dead = 0;
    let failed = 0;

    for (const job of jobs) {
      await this.db.run("UPDATE update_jobs SET status = 'processing', updated_at = ? WHERE id = ?", [nowIso(), job.id]);

      try {
        const app = await getAppById(this.db, job.app_id);
        if (!app) throw new Error(`app not found: ${job.app_id}`);
        const result = await this.refreshApp(app);
        refreshed += result === "refreshed" ? 1 : 0;
        dead += result === "dead" ? 1 : 0;
        await this.db.run(
          "UPDATE update_jobs SET status = 'completed', updated_at = ?, completed_at = ? WHERE id = ?",
          [nowIso(), nowIso(), job.id]
        );
      } catch (err) {
        const attempts = Number(job.attempts || 0) + 1;
        const nextAttempt = new Date(Date.now() + Math.min(120, attempts * 20) * 60 * 1000).toISOString();
        await this.db.run(
          `UPDATE update_jobs SET status = 'failed', attempts = ?, last_error = ?, next_attempt_at = ?, updated_at = ?
           WHERE id = ?`,
          [attempts, err.message, nextAttempt, nowIso(), job.id]
        );
        failed += 1;
        logger.error("update job failed", { jobId: job.id, error: err.message });
      }
    }

    logger.info("updater finished", { refreshed, dead, failed });
    return { refreshed, dead, failed };
  }

  async refreshApp(app) {
    const { owner, repo: repoName } = splitFullName(app);
    if (!owner || !repoName) throw new Error(`missing github repo for app ${app.id}`);

    let repo;
    try {
      repo = await this.client.getRepository(owner, repoName);
    } catch (err) {
      if (err.response?.status === 404) {
        await this.markDead(app, "repository_not_found");
        return "dead";
      }
      throw err;
    }

    const reason = rejectReason(repo, config);
    if (["archived", "disabled", "inactive"].includes(reason)) {
      await this.markDead(app, reason);
      return "dead";
    }

    const [readme, latestRelease] = await Promise.all([
      this.client.getReadme(owner, repoName),
      this.client.getLatestRelease(owner, repoName)
    ]);

    const parsedReadme = {
      ...parseReadme(readme, {
        owner,
        name: repoName,
        default_branch: repo.default_branch,
        language: repo.language,
        topics: repo.topics || []
      }),
      markdown: readme
    };

    const mapped = mapRepositoryToApp(repo, parsedReadme, latestRelease);
    mapped.status = app.status;
    mapped.visibility = app.visibility;
    mapped.remote_openlib_id = app.remote_openlib_id;
    mapped.quality_score = calculateQualityScore(mapped, parsedReadme);
    mapped.score = mapped.quality_score;

    await updateAppFields(this.db, app.id, {
      ...mapped,
      last_crawled_at: nowIso()
    });

    const refreshed = await getAppById(this.db, app.id);
    if (!app.last_screenshot_at || Date.now() - new Date(app.last_screenshot_at).getTime() > config.screenshots.refreshIntervalMs) {
      await processAppScreenshots(this.db, refreshed, parsedReadme.screenshots);
    }

    await enqueueAiJob(this.db, app.id, "enrich", config.ai.model);
    if (["published"].includes(app.status)) {
      await enqueueSync(this.db, app.id, "update");
    }

    return "refreshed";
  }

  async markDead(app, reason) {
    await updateAppFields(this.db, app.id, {
      status: "dead",
      dead_reason: reason,
      dead_checked_at: nowIso()
    });

    if (["published", "approved"].includes(app.status)) {
      await enqueueSync(this.db, app.id, "delete", { reason });
    }

    logger.warn("app marked dead", { appId: app.id, reason });
  }
}

module.exports = UpdaterWorker;
