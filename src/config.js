require("dotenv").config({ quiet: true });

const path = require("path");

const rootDir = path.resolve(__dirname, "..");

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function boolFromEnv(name, fallback = false) {
  if (process.env[name] === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(String(process.env[name]).toLowerCase());
}

function listFromEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw
    .split("\n")
    .flatMap((line) => line.split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

const defaultQueries = [
  "topic:opensource stars:>200 archived:false fork:false",
  "topic:desktop-app stars:>200 archived:false fork:false",
  "topic:linux-app stars:>100 archived:false fork:false",
  "topic:electron stars:>500 archived:false fork:false",
  "topic:self-hosted stars:>500 archived:false fork:false",
  "topic:productivity stars:>300 archived:false fork:false",
  "topic:developer-tools stars:>300 archived:false fork:false"
];

module.exports = {
  rootDir,
  env: process.env.NODE_ENV || "production",
  dbPath: path.resolve(rootDir, process.env.DB_PATH || "openlib.db"),
  dataDir: path.resolve(rootDir, process.env.DATA_DIR || "data"),
  screenshotDir: path.resolve(rootDir, process.env.SCREENSHOT_DIR || "data/cache/screenshots"),
  logDir: path.resolve(rootDir, process.env.LOG_DIR || "logs"),

  github: {
    token: process.env.GITHUB_TOKEN || "",
    userAgent: process.env.GITHUB_USER_AGENT || "openlib-crawler",
    apiBaseUrl: process.env.GITHUB_API_BASE_URL || "https://api.github.com",
    perPage: numberFromEnv("GITHUB_PER_PAGE", 30),
    maxPagesPerQuery: numberFromEnv("GITHUB_MAX_PAGES_PER_QUERY", 3),
    minStars: numberFromEnv("MIN_STARS", 100),
    inactiveDays: numberFromEnv("INACTIVE_DAYS", 365),
    requestTimeoutMs: numberFromEnv("GITHUB_REQUEST_TIMEOUT_MS", 20000),
    searchQueries: listFromEnv("GITHUB_SEARCH_QUERIES", defaultQueries)
  },

  crawler: {
    targetAppsPerRun: numberFromEnv("TARGET_APPS_PER_RUN", 50),
    concurrency: numberFromEnv("CRAWLER_CONCURRENCY", 2),
    minQualityScore: numberFromEnv("MIN_QUALITY_SCORE", 70),
    crawlIntervalMs: numberFromEnv("CRAWLER_INTERVAL_MS", 6 * 60 * 60 * 1000)
  },

  updater: {
    batchSize: numberFromEnv("UPDATER_BATCH_SIZE", 40),
    intervalMs: numberFromEnv("UPDATER_INTERVAL_MS", 24 * 60 * 60 * 1000),
    staleAfterHours: numberFromEnv("UPDATE_STALE_AFTER_HOURS", 24)
  },

  screenshots: {
    enabled: boolFromEnv("SCREENSHOTS_ENABLED", true),
    concurrency: numberFromEnv("SCREENSHOT_CONCURRENCY", 2),
    maxPerApp: numberFromEnv("MAX_SCREENSHOTS_PER_APP", 6),
    minWidth: numberFromEnv("SCREENSHOT_MIN_WIDTH", 240),
    minHeight: numberFromEnv("SCREENSHOT_MIN_HEIGHT", 160),
    webpQuality: numberFromEnv("SCREENSHOT_WEBP_QUALITY", 78),
    timeoutMs: numberFromEnv("SCREENSHOT_TIMEOUT_MS", 25000),
    refreshIntervalMs: numberFromEnv("SCREENSHOT_REFRESH_INTERVAL_MS", 7 * 24 * 60 * 60 * 1000)
  },

  ai: {
    enabled: boolFromEnv("AI_ENABLED", true),
    baseUrl: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
    model: process.env.OLLAMA_MODEL || "tinyllama",
    timeoutMs: numberFromEnv("OLLAMA_TIMEOUT_MS", 120000),
    numCtx: numberFromEnv("OLLAMA_NUM_CTX", 1024),
    numPredict: numberFromEnv("OLLAMA_NUM_PREDICT", 180),
    concurrency: numberFromEnv("AI_CONCURRENCY", 1),
    intervalMs: numberFromEnv("AI_INTERVAL_MS", 24 * 60 * 60 * 1000),
    maxInputChars: numberFromEnv("AI_MAX_INPUT_CHARS", 1200)
  },

  sync: {
    apiBaseUrl: process.env.OPENLIB_API_URL || "",
    apiKey: process.env.OPENLIB_API_KEY || "",
    concurrency: numberFromEnv("SYNC_CONCURRENCY", 1),
    batchSize: numberFromEnv("SYNC_BATCH_SIZE", 25),
    retryBaseMs: numberFromEnv("SYNC_RETRY_BASE_MS", 15 * 60 * 1000)
  },

  moderation: {
    host: process.env.MODERATION_HOST || "127.0.0.1",
    port: numberFromEnv("MODERATION_PORT", 3020),
    apiKey: process.env.MODERATION_API_KEY || ""
  }
};
