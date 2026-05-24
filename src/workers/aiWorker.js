const config = require("../config");
const logger = require("../logger");
const { db, initializeDatabase } = require("../db");
const { enrichApp } = require("../services/aiService");
const { getAppById, enqueueAiJob } = require("../services/appStore");
const { nowIso } = require("../utils/time");

class AiWorker {
  constructor(options = {}) {
    this.db = options.db || db;
  }

  async queueMissing(limit = 100) {
    const candidates = await this.db.all(
      `SELECT id FROM apps
        WHERE status IN ('pending', 'pending_duplicate', 'approved', 'published')
          AND (last_ai_at IS NULL OR last_ai_at = '')
        ORDER BY quality_score DESC
        LIMIT ?`,
      [limit]
    );

    for (const app of candidates) {
      await enqueueAiJob(this.db, app.id, "enrich", config.ai.model);
    }

    return candidates.length;
  }

  async run(options = {}) {
    await initializeDatabase(this.db);
    const limit = options.limit || 25;
    await this.queueMissing(limit);

    const jobs = await this.db.all(
      `SELECT * FROM ai_jobs
        WHERE status IN ('pending', 'failed')
          AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        ORDER BY created_at ASC
        LIMIT ?`,
      [nowIso(), limit]
    );

    let completed = 0;
    let failed = 0;

    for (const job of jobs) {
      await this.db.run("UPDATE ai_jobs SET status = 'processing', updated_at = ? WHERE id = ?", [nowIso(), job.id]);
      try {
        const app = await getAppById(this.db, job.app_id);
        if (!app) throw new Error(`app not found: ${job.app_id}`);
        await enrichApp(this.db, app, job);
        completed += 1;
        logger.info("ai job completed", { jobId: job.id, appId: app.id });
      } catch (err) {
        const attempts = Number(job.attempts || 0) + 1;
        const nextAttempt = new Date(Date.now() + Math.min(60, attempts * 10) * 60 * 1000).toISOString();
        await this.db.run(
          `UPDATE ai_jobs SET status = 'failed', attempts = ?, last_error = ?, next_attempt_at = ?, updated_at = ?
           WHERE id = ?`,
          [attempts, err.message, nextAttempt, nowIso(), job.id]
        );
        failed += 1;
        logger.error("ai job failed", { jobId: job.id, error: err.message });
      }
    }

    logger.info("ai worker finished", { completed, failed });
    return { completed, failed };
  }
}

module.exports = AiWorker;
