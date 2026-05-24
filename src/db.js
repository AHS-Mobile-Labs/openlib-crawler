const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const config = require("./config");
const logger = require("./logger");
const { nowIso } = require("./utils/time");
const { stringifyJson } = require("./utils/json");

class Database {
  constructor(filePath = config.dbPath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.filePath = filePath;
    this.db = new sqlite3.Database(filePath);
  }

  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function onRun(err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  exec(sql) {
    return new Promise((resolve, reject) => {
      this.db.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async transaction(callback) {
    await this.exec("BEGIN IMMEDIATE TRANSACTION;");
    try {
      const result = await callback(this);
      await this.exec("COMMIT;");
      return result;
    } catch (err) {
      await this.exec("ROLLBACK;");
      throw err;
    }
  }

  close() {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

const database = new Database();

const appColumns = [
  ["github_id", "INTEGER"],
  ["github_owner", "TEXT"],
  ["github_repo", "TEXT"],
  ["github_full_name", "TEXT"],
  ["github_url", "TEXT"],
  ["source_url", "TEXT"],
  ["download_url", "TEXT"],
  ["website", "TEXT"],
  ["website_url", "TEXT"],
  ["docs_url", "TEXT"],
  ["youtube_url", "TEXT"],
  ["name", "TEXT"],
  ["slug", "TEXT"],
  ["category", "TEXT"],
  ["logo", "TEXT"],
  ["logo_url", "TEXT"],
  ["logo_local_path", "TEXT"],
  ["short_description", "TEXT"],
  ["full_description", "TEXT"],
  ["uses", "TEXT"],
  ["alternative_of", "TEXT"],
  ["maintainer_type", "TEXT"],
  ["developer_name", "TEXT"],
  ["developer_url", "TEXT"],
  ["version", "TEXT"],
  ["license", "TEXT"],
  ["file_size", "INTEGER DEFAULT 0"],
  ["tags", "TEXT"],
  ["key_features", "TEXT"],
  ["screenshots", "TEXT"],
  ["comparison_table", "TEXT"],
  ["supported_platforms", "TEXT"],
  ["installation_methods", "TEXT"],
  ["system_requirements", "TEXT"],
  ["open_source_verified", "INTEGER DEFAULT 0"],
  ["visibility", "TEXT DEFAULT 'private'"],
  ["added_by", "TEXT DEFAULT 'crawler'"],
  ["quality_score", "INTEGER DEFAULT 0"],
  ["score", "INTEGER DEFAULT 0"],
  ["status", "TEXT DEFAULT 'discovered'"],
  ["rejection_reason", "TEXT"],
  ["duplicate_of_app_id", "INTEGER"],
  ["duplicate_score", "INTEGER DEFAULT 0"],
  ["stars", "INTEGER DEFAULT 0"],
  ["forks", "INTEGER DEFAULT 0"],
  ["watchers", "INTEGER DEFAULT 0"],
  ["open_issues", "INTEGER DEFAULT 0"],
  ["fork", "INTEGER DEFAULT 0"],
  ["archived", "INTEGER DEFAULT 0"],
  ["disabled", "INTEGER DEFAULT 0"],
  ["language", "TEXT"],
  ["topics", "TEXT"],
  ["default_branch", "TEXT"],
  ["package_names", "TEXT"],
  ["has_releases", "INTEGER DEFAULT 0"],
  ["latest_release_tag", "TEXT"],
  ["latest_release_url", "TEXT"],
  ["latest_release_at", "TEXT"],
  ["last_commit_at", "TEXT"],
  ["pushed_at", "TEXT"],
  ["readme_markdown", "TEXT"],
  ["readme_text", "TEXT"],
  ["readme_quality_score", "INTEGER DEFAULT 0"],
  ["docs_quality_score", "INTEGER DEFAULT 0"],
  ["remote_openlib_id", "TEXT"],
  ["dead_checked_at", "TEXT"],
  ["dead_reason", "TEXT"],
  ["last_crawled_at", "TEXT"],
  ["last_ai_at", "TEXT"],
  ["last_screenshot_at", "TEXT"],
  ["last_synced_at", "TEXT"],
  ["created_at", "TEXT"],
  ["updated_at", "TEXT"]
];

const syncQueueColumns = [
  ["app_id", "INTEGER"],
  ["action", "TEXT"],
  ["payload", "TEXT"],
  ["status", "TEXT DEFAULT 'pending'"],
  ["attempts", "INTEGER DEFAULT 0"],
  ["last_error", "TEXT"],
  ["next_attempt_at", "TEXT"],
  ["openlib_response", "TEXT"],
  ["synced", "INTEGER DEFAULT 0"],
  ["created_at", "TEXT"],
  ["updated_at", "TEXT"],
  ["synced_at", "TEXT"]
];

async function tableColumns(db, tableName) {
  const rows = await db.all(`PRAGMA table_info(${tableName});`);
  return new Set(rows.map((row) => row.name));
}

async function addMissingColumns(db, tableName, columns) {
  const existing = await tableColumns(db, tableName);
  for (const [name, type] of columns) {
    if (!existing.has(name)) {
      await db.run(`ALTER TABLE ${tableName} ADD COLUMN ${name} ${type};`);
    }
  }
}

async function createIndexes(db) {
  const indexes = [
    "CREATE INDEX IF NOT EXISTS idx_apps_status_score ON apps(status, quality_score DESC);",
    "CREATE INDEX IF NOT EXISTS idx_apps_github_id ON apps(github_id);",
    "CREATE INDEX IF NOT EXISTS idx_apps_slug ON apps(slug);",
    "CREATE INDEX IF NOT EXISTS idx_apps_updated ON apps(updated_at);",
    "CREATE INDEX IF NOT EXISTS idx_apps_last_crawled ON apps(last_crawled_at);",
    "CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, next_attempt_at);",
    "CREATE INDEX IF NOT EXISTS idx_screenshots_app ON screenshots(app_id, sort_order);",
    "CREATE INDEX IF NOT EXISTS idx_crawl_logs_run ON crawl_logs(run_id, created_at);",
    "CREATE INDEX IF NOT EXISTS idx_ai_jobs_status ON ai_jobs(status, next_attempt_at);",
    "CREATE INDEX IF NOT EXISTS idx_update_jobs_status ON update_jobs(status, next_attempt_at);"
  ];

  for (const sql of indexes) {
    await db.run(sql);
  }
}

async function initializeDatabase(db = database) {
  await db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA temp_store = MEMORY;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS apps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      github_id INTEGER,
      github_owner TEXT,
      github_repo TEXT,
      github_full_name TEXT,
      github_url TEXT,
      source_url TEXT,
      download_url TEXT,
      website TEXT,
      website_url TEXT,
      docs_url TEXT,
      youtube_url TEXT,
      name TEXT,
      slug TEXT,
      category TEXT,
      logo TEXT,
      logo_url TEXT,
      logo_local_path TEXT,
      short_description TEXT,
      full_description TEXT,
      uses TEXT,
      alternative_of TEXT,
      maintainer_type TEXT,
      developer_name TEXT,
      developer_url TEXT,
      version TEXT,
      license TEXT,
      file_size INTEGER DEFAULT 0,
      tags TEXT,
      key_features TEXT,
      screenshots TEXT,
      comparison_table TEXT,
      supported_platforms TEXT,
      installation_methods TEXT,
      system_requirements TEXT,
      open_source_verified INTEGER DEFAULT 0,
      visibility TEXT DEFAULT 'private',
      added_by TEXT DEFAULT 'crawler',
      quality_score INTEGER DEFAULT 0,
      score INTEGER DEFAULT 0,
      status TEXT DEFAULT 'discovered',
      rejection_reason TEXT,
      duplicate_of_app_id INTEGER,
      duplicate_score INTEGER DEFAULT 0,
      stars INTEGER DEFAULT 0,
      forks INTEGER DEFAULT 0,
      watchers INTEGER DEFAULT 0,
      open_issues INTEGER DEFAULT 0,
      fork INTEGER DEFAULT 0,
      archived INTEGER DEFAULT 0,
      disabled INTEGER DEFAULT 0,
      language TEXT,
      topics TEXT,
      default_branch TEXT,
      package_names TEXT,
      has_releases INTEGER DEFAULT 0,
      latest_release_tag TEXT,
      latest_release_url TEXT,
      latest_release_at TEXT,
      last_commit_at TEXT,
      pushed_at TEXT,
      readme_markdown TEXT,
      readme_text TEXT,
      readme_quality_score INTEGER DEFAULT 0,
      docs_quality_score INTEGER DEFAULT 0,
      remote_openlib_id TEXT,
      dead_checked_at TEXT,
      dead_reason TEXT,
      last_crawled_at TEXT,
      last_ai_at TEXT,
      last_screenshot_at TEXT,
      last_synced_at TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER,
      action TEXT,
      payload TEXT,
      status TEXT DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      last_error TEXT,
      next_attempt_at TEXT,
      openlib_response TEXT,
      synced INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT,
      synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS screenshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL,
      source_url TEXT NOT NULL,
      local_path TEXT,
      webp_path TEXT,
      width INTEGER DEFAULT 0,
      height INTEGER DEFAULT 0,
      size_bytes INTEGER DEFAULT 0,
      content_hash TEXT,
      status TEXT DEFAULT 'pending',
      sort_order INTEGER DEFAULT 0,
      last_checked_at TEXT,
      created_at TEXT,
      updated_at TEXT,
      UNIQUE(app_id, source_url)
    );

    CREATE TABLE IF NOT EXISTS crawl_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT,
      query TEXT,
      repo_full_name TEXT,
      github_id INTEGER,
      status TEXT,
      message TEXT,
      details TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS ai_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL,
      task TEXT DEFAULT 'enrich',
      status TEXT DEFAULT 'pending',
      model TEXT,
      attempts INTEGER DEFAULT 0,
      input_hash TEXT,
      output TEXT,
      last_error TEXT,
      next_attempt_at TEXT,
      created_at TEXT,
      updated_at TEXT,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS update_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL,
      job_type TEXT DEFAULT 'refresh',
      status TEXT DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      last_error TEXT,
      next_attempt_at TEXT,
      created_at TEXT,
      updated_at TEXT,
      completed_at TEXT
    );
  `);

  await addMissingColumns(db, "apps", appColumns);
  await addMissingColumns(db, "sync_queue", syncQueueColumns);
  await createIndexes(db);

  const now = nowIso();
  await db.run("UPDATE apps SET created_at = COALESCE(created_at, ?), updated_at = COALESCE(updated_at, ?);", [now, now]);
  await db.run("UPDATE apps SET quality_score = COALESCE(NULLIF(quality_score, 0), score, 0);");
  await db.run(
    "UPDATE apps SET source_url = COALESCE(NULLIF(source_url, ''), github_url), website_url = COALESCE(NULLIF(website_url, ''), website), logo_url = COALESCE(NULLIF(logo_url, ''), logo);"
  );

  logger.info("database ready", { path: db.filePath });
}

async function logCrawl(db, entry) {
  await db.run(
    `INSERT INTO crawl_logs (run_id, query, repo_full_name, github_id, status, message, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.runId || null,
      entry.query || null,
      entry.repoFullName || null,
      entry.githubId || null,
      entry.status || "info",
      entry.message || "",
      stringifyJson(entry.details || {}),
      nowIso()
    ]
  );
}

module.exports = {
  Database,
  db: database,
  initializeDatabase,
  logCrawl
};
