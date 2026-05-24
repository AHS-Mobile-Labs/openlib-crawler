const config = require("./config");
const logger = require("./logger");
const { db, initializeDatabase } = require("./db");
const CrawlerWorker = require("./workers/crawlerWorker");
const UpdaterWorker = require("./workers/updaterWorker");
const AiWorker = require("./workers/aiWorker");
const ScreenshotWorker = require("./workers/screenshotWorker");
const SyncWorker = require("./workers/syncWorker");

function argValue(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) return fallback;
  return process.argv[index + 1];
}

function limitArg(fallback) {
  const value = Number(argValue("--limit", fallback));
  return Number.isFinite(value) ? value : fallback;
}

async function runCommand(command) {
  switch (command) {
    case "setup":
      await initializeDatabase(db);
      return;
    case "crawl":
      await new CrawlerWorker().run({ limit: limitArg(config.crawler.targetAppsPerRun) });
      return;
    case "update":
      await new UpdaterWorker().run({ limit: limitArg(config.updater.batchSize) });
      return;
    case "ai":
      await new AiWorker().run({ limit: limitArg(25) });
      return;
    case "screenshots":
      await new ScreenshotWorker().run({ limit: limitArg(50) });
      return;
    case "sync":
      await new SyncWorker().run({ limit: limitArg(config.sync.batchSize) });
      return;
    case "scheduler":
      await runScheduler();
      return;
    default:
      console.log(`Usage:
  npm run setup
  npm run crawl -- --limit 50
  npm run update
  npm run ai
  npm run screenshots
  npm run sync
  npm run moderation
  npm run scheduler`);
  }
}

function guarded(name, fn) {
  let running = false;
  return async () => {
    if (running) {
      logger.warn("scheduled job skipped because previous run is active", { name });
      return;
    }
    running = true;
    try {
      await fn();
    } catch (err) {
      logger.error("scheduled job failed", { name, error: err.message });
    } finally {
      running = false;
    }
  };
}

async function runScheduler() {
  await initializeDatabase(db);
  logger.info("scheduler started", {
    crawlerHours: Math.round(config.crawler.crawlIntervalMs / 3600000),
    updaterHours: Math.round(config.updater.intervalMs / 3600000),
    aiHours: Math.round(config.ai.intervalMs / 3600000)
  });

  const crawl = guarded("crawl", () => new CrawlerWorker().run());
  const update = guarded("update", () => new UpdaterWorker().run());
  const ai = guarded("ai", () => new AiWorker().run());
  const screenshots = guarded("screenshots", () => new ScreenshotWorker().run());
  const sync = guarded("sync", () => new SyncWorker().run());

  await crawl();
  await update();
  await ai();
  await sync();

  setInterval(crawl, config.crawler.crawlIntervalMs);
  setInterval(update, config.updater.intervalMs);
  setInterval(ai, config.ai.intervalMs);
  setInterval(screenshots, config.screenshots.refreshIntervalMs);
  setInterval(sync, 30 * 60 * 1000);
}

process.on("SIGINT", async () => {
  logger.info("shutdown requested");
  await db.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("shutdown requested");
  await db.close();
  process.exit(0);
});

runCommand(process.argv[2] || "help").catch(async (err) => {
  logger.error("command failed", { error: err.stack || err.message });
  await db.close();
  process.exit(1);
});
