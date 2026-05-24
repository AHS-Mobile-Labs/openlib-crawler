const config = require("../config");
const logger = require("../logger");
const { db, initializeDatabase } = require("../db");
const { parseReadme } = require("../services/readmeParser");
const { processAppScreenshots } = require("../services/screenshotService");
const { hoursAgo } = require("../utils/time");

class ScreenshotWorker {
  constructor(options = {}) {
    this.db = options.db || db;
  }

  async run(options = {}) {
    await initializeDatabase(this.db);
    const limit = options.limit || 50;
    const staleBefore = new Date(Date.now() - config.screenshots.refreshIntervalMs).toISOString();
    const apps = await this.db.all(
      `SELECT * FROM apps
        WHERE status IN ('pending', 'pending_duplicate', 'approved', 'published')
          AND readme_markdown IS NOT NULL
          AND readme_markdown != ''
          AND (last_screenshot_at IS NULL OR last_screenshot_at < ?)
          AND updated_at > ?
        ORDER BY quality_score DESC
        LIMIT ?`,
      [staleBefore, hoursAgo(24 * 365 * 3), limit]
    );

    let processed = 0;
    for (const app of apps) {
      const parsed = parseReadme(app.readme_markdown, {
        owner: app.github_owner,
        name: app.github_repo,
        default_branch: app.default_branch,
        language: app.language
      });
      await processAppScreenshots(this.db, app, parsed.screenshots);
      processed += 1;
    }

    logger.info("screenshot worker finished", { processed });
    return { processed };
  }
}

module.exports = ScreenshotWorker;
