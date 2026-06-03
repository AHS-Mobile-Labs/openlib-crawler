const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { URL } = require("url");
const config = require("./config");
const logger = require("./logger");
const { db, initializeDatabase } = require("./db");
const { parseJson, stringifyJson } = require("./utils/json");
const CrawlerWorker = require("./workers/crawlerWorker");
const UpdaterWorker = require("./workers/updaterWorker");
const AiWorker = require("./workers/aiWorker");
const ScreenshotWorker = require("./workers/screenshotWorker");
const SyncWorker = require("./workers/syncWorker");
const {
  updateAppFields,
  getAppById,
  enqueueSync,
  enqueueAiJob,
  enqueueUpdateJob,
  listAppScreenshots
} = require("./services/appStore");

const publicDir = path.resolve(__dirname, "gui/public");
const envPath = path.resolve(config.rootDir, ".env");
const maxBodyBytes = 2 * 1024 * 1024;

const jsonFields = new Set([
  "alternative_of",
  "tags",
  "key_features",
  "screenshots",
  "comparison_table",
  "supported_platforms",
  "installation_methods",
  "system_requirements"
]);

const editableFields = new Set([
  "name",
  "slug",
  "category",
  "logo_url",
  "short_description",
  "full_description",
  "uses",
  "alternative_of",
  "download_url",
  "website_url",
  "docs_url",
  "youtube_url",
  "maintainer_type",
  "developer_name",
  "developer_url",
  "version",
  "license",
  "file_size",
  "tags",
  "key_features",
  "comparison_table",
  "supported_platforms",
  "installation_methods",
  "system_requirements",
  "visibility",
  "quality_score"
]);

const workerRegistry = {
  crawl: {
    label: "Crawler",
    Worker: CrawlerWorker,
    defaultLimit: () => config.crawler.targetAppsPerRun,
    intervalMs: () => config.crawler.crawlIntervalMs
  },
  update: {
    label: "Updater",
    Worker: UpdaterWorker,
    defaultLimit: () => config.updater.batchSize,
    intervalMs: () => config.updater.intervalMs
  },
  ai: {
    label: "AI",
    Worker: AiWorker,
    defaultLimit: () => 25,
    intervalMs: () => config.ai.intervalMs
  },
  screenshots: {
    label: "Screenshots",
    Worker: ScreenshotWorker,
    defaultLimit: () => 50,
    intervalMs: () => config.screenshots.refreshIntervalMs
  },
  sync: {
    label: "Sync",
    Worker: SyncWorker,
    defaultLimit: () => config.sync.batchSize,
    intervalMs: () => 30 * 60 * 1000
  }
};

const runningJobs = new Map();
const jobHistory = [];
const schedulerState = {
  active: false,
  started_at: null,
  handles: []
};

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function sendText(res, status, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  res.end(text);
}

function notFound(res) {
  sendJson(res, 404, { error: "not_found" });
}

function authorized(req) {
  if (!config.moderation.apiKey) return true;
  const headerKey = req.headers["x-api-key"];
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return headerKey === config.moderation.apiKey || bearer === config.moderation.apiKey;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > maxBodyBytes) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendFile(res, filePath, cache = "no-store", downloadName = "") {
  const extension = path.extname(filePath).toLowerCase();
  const headers = {
    "Content-Type": mimeTypes[extension] || "application/octet-stream",
    "Cache-Control": cache
  };
  if (downloadName) {
    headers["Content-Disposition"] = `attachment; filename="${downloadName.replace(/"/g, "")}"`;
  }
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

function serveGui(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;

  const routeMap = {
    "/": "index.html",
    "/index.html": "index.html",
    "/styles.css": "styles.css",
    "/app.js": "app.js"
  };

  if (routeMap[url.pathname]) {
    const filePath = path.resolve(publicDir, routeMap[url.pathname]);
    if (!filePath.startsWith(publicDir) || !fs.existsSync(filePath)) return false;
    sendFile(res, filePath, "no-store");
    return true;
  }

  if (url.pathname.startsWith("/assets/")) {
    const assetRoot = path.resolve(config.rootDir, "assets");
    const filePath = path.resolve(config.rootDir, url.pathname.slice(1));
    if (!filePath.startsWith(assetRoot) || !fs.existsSync(filePath)) return false;
    sendFile(res, filePath, "public, max-age=86400");
    return true;
  }

  return false;
}

function serializeApp(app, screenshots = []) {
  if (!app) return null;
  const output = { ...app, screenshots_preview: screenshots };
  for (const field of jsonFields) {
    output[field] = parseJson(app[field], []);
  }
  return output;
}

function normalizeStatuses(status) {
  if (!status || status === "all") return [];
  if (status === "pending") return ["pending", "pending_duplicate"];
  return status
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function safeLimit(value, fallback, max = 250) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

async function listApps(url) {
  const limit = safeLimit(url.searchParams.get("limit"), 50, 250);
  const offset = safeLimit(url.searchParams.get("offset"), 0, 100000);
  const statuses = normalizeStatuses(url.searchParams.get("status") || "pending");
  const query = String(url.searchParams.get("q") || "").trim();
  const where = [];
  const params = [];

  if (statuses.length) {
    where.push(`a.status IN (${statuses.map(() => "?").join(",")})`);
    params.push(...statuses);
  }

  if (query) {
    where.push(
      `(a.name LIKE ? OR a.github_full_name LIKE ? OR a.category LIKE ? OR a.tags LIKE ? OR a.short_description LIKE ?)`
    );
    const like = `%${query}%`;
    params.push(like, like, like, like, like);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await db.all(
    `SELECT a.*,
            d.name AS duplicate_name,
            d.github_url AS duplicate_github_url
       FROM apps a
       LEFT JOIN apps d ON d.id = a.duplicate_of_app_id
       ${whereSql}
      ORDER BY a.quality_score DESC, a.updated_at DESC, a.created_at ASC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const totalRow = await db.get(`SELECT COUNT(*) AS count FROM apps a ${whereSql}`, params);

  return {
    apps: await Promise.all(rows.map(async (app) => serializeApp(app, await listAppScreenshots(db, app.id)))),
    total: totalRow?.count || 0,
    limit,
    offset
  };
}

async function getDetailedApp(id) {
  const app = await getAppById(db, id);
  if (!app) return null;
  const screenshots = await listAppScreenshots(db, id);
  const duplicate = app.duplicate_of_app_id ? await getAppById(db, app.duplicate_of_app_id) : null;
  return {
    ...serializeApp(app, screenshots),
    duplicate_warning: duplicate
      ? {
          id: duplicate.id,
          name: duplicate.name,
          github_url: duplicate.github_url,
          score: app.duplicate_score
        }
      : null
  };
}

function normalizeEdit(body) {
  const fields = {};
  for (const [key, value] of Object.entries(body || {})) {
    if (!editableFields.has(key)) continue;
    fields[key] = jsonFields.has(key) ? stringifyJson(value) : value;
  }
  return fields;
}

async function serveScreenshot(res, id) {
  const screenshot = await db.get("SELECT * FROM screenshots WHERE id = ? AND status = 'ready'", [id]);
  if (!screenshot?.webp_path) return notFound(res);

  const filePath = path.resolve(config.rootDir, screenshot.webp_path);
  if (!filePath.startsWith(config.rootDir) || !fs.existsSync(filePath)) return notFound(res);

  sendFile(res, filePath, "public, max-age=86400");
}

async function countByStatus(tableName) {
  const rows = await db.all(`SELECT status, COUNT(*) AS count FROM ${tableName} GROUP BY status ORDER BY count DESC`);
  return rows.reduce((acc, row) => {
    acc[row.status || "unknown"] = row.count;
    return acc;
  }, {});
}

async function tableCount(tableName) {
  const row = await db.get(`SELECT COUNT(*) AS count FROM ${tableName}`);
  return row?.count || 0;
}

function fileStat(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return {
      exists: true,
      size: stat.size,
      modified_at: stat.mtime.toISOString(),
      is_directory: stat.isDirectory()
    };
  } catch (err) {
    return {
      exists: false,
      size: 0,
      modified_at: null,
      is_directory: false
    };
  }
}

function directorySummary(dirPath) {
  const summary = { files: 0, directories: 0, size: 0 };
  if (!fs.existsSync(dirPath)) return summary;

  const stack = [dirPath];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (err) {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        summary.directories += 1;
        stack.push(entryPath);
      } else if (entry.isFile()) {
        summary.files += 1;
        try {
          summary.size += fs.statSync(entryPath).size;
        } catch (err) {
          // Ignore files that disappear while collecting a lightweight summary.
        }
      }
    }
  }

  return summary;
}

function publicJob(job) {
  const { promise, ...safeJob } = job;
  return safeJob;
}

function startWorkerJob(name, options = {}) {
  const registry = workerRegistry[name];
  if (!registry) {
    const err = new Error(`unknown worker: ${name}`);
    err.statusCode = 404;
    throw err;
  }

  if (runningJobs.has(name)) {
    const err = new Error(`${name} worker is already running`);
    err.statusCode = 409;
    throw err;
  }

  const limit = safeLimit(options.limit, registry.defaultLimit(), 1000);
  const job = {
    id: crypto.randomUUID(),
    name,
    label: registry.label,
    status: "running",
    limit,
    started_at: new Date().toISOString(),
    finished_at: null,
    duration_ms: null,
    result: null,
    error: null
  };

  runningJobs.set(name, job);
  jobHistory.unshift(job);
  jobHistory.splice(40);

  const startedAt = Date.now();
  job.promise = (async () => {
    const worker = new registry.Worker();
    return worker.run({ limit });
  })()
    .then((result) => {
      job.status = "completed";
      job.result = result;
      logger.info("gui worker completed", { name, result });
    })
    .catch((err) => {
      job.status = "failed";
      job.error = err.stack || err.message;
      logger.error("gui worker failed", { name, error: err.stack || err.message });
    })
    .finally(() => {
      job.finished_at = new Date().toISOString();
      job.duration_ms = Date.now() - startedAt;
      runningJobs.delete(name);
    });

  return job;
}

function schedulerSnapshot() {
  return {
    active: schedulerState.active,
    started_at: schedulerState.started_at,
    jobs: Object.entries(workerRegistry).map(([name, item]) => ({
      name,
      label: item.label,
      interval_ms: item.intervalMs(),
      running: runningJobs.has(name)
    }))
  };
}

function startScheduler(runNow = false) {
  if (schedulerState.active) return schedulerSnapshot();

  schedulerState.active = true;
  schedulerState.started_at = new Date().toISOString();
  schedulerState.handles = Object.entries(workerRegistry).map(([name, item]) => {
    const tick = () => {
      if (runningJobs.has(name)) return;
      try {
        startWorkerJob(name);
      } catch (err) {
        logger.warn("scheduled worker skipped", { name, error: err.message });
      }
    };

    if (runNow) setTimeout(tick, 250);
    return setInterval(tick, item.intervalMs());
  });

  logger.info("gui scheduler started");
  return schedulerSnapshot();
}

function stopScheduler() {
  for (const handle of schedulerState.handles) clearInterval(handle);
  schedulerState.active = false;
  schedulerState.started_at = null;
  schedulerState.handles = [];
  logger.info("gui scheduler stopped");
  return schedulerSnapshot();
}

async function dashboard() {
  const appSummary = await db.get(
    `SELECT COUNT(*) AS total,
            AVG(quality_score) AS average_quality,
            MAX(updated_at) AS last_updated
       FROM apps`
  );
  const recentLogs = await db.all(
    "SELECT * FROM crawl_logs ORDER BY created_at DESC LIMIT 12"
  );

  return {
    apps: {
      total: appSummary?.total || 0,
      average_quality: Math.round(Number(appSummary?.average_quality || 0)),
      last_updated: appSummary?.last_updated || null,
      by_status: await countByStatus("apps")
    },
    queues: {
      sync: await countByStatus("sync_queue"),
      ai: await countByStatus("ai_jobs"),
      update: await countByStatus("update_jobs")
    },
    tables: {
      apps: await tableCount("apps"),
      sync_queue: await tableCount("sync_queue"),
      screenshots: await tableCount("screenshots"),
      crawl_logs: await tableCount("crawl_logs"),
      ai_jobs: await tableCount("ai_jobs"),
      update_jobs: await tableCount("update_jobs")
    },
    files: {
      database: { path: path.relative(config.rootDir, config.dbPath), ...fileStat(config.dbPath) },
      env: { path: ".env", ...fileStat(envPath) },
      data: { path: path.relative(config.rootDir, config.dataDir), ...fileStat(config.dataDir), ...directorySummary(config.dataDir) },
      logs: { path: path.relative(config.rootDir, config.logDir), ...fileStat(config.logDir), ...directorySummary(config.logDir) }
    },
    recent_logs: recentLogs,
    jobs: jobHistory.map(publicJob),
    scheduler: schedulerSnapshot(),
    system: systemSnapshot()
  };
}

function systemSnapshot() {
  const memory = process.memoryUsage();
  return {
    pid: process.pid,
    platform: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    hostname: os.hostname(),
    uptime_seconds: Math.round(os.uptime()),
    process_uptime_seconds: Math.round(process.uptime()),
    load_average: os.loadavg(),
    cpu_count: os.cpus().length,
    total_memory: os.totalmem(),
    free_memory: os.freemem(),
    node_memory: memory,
    paths: {
      root: config.rootDir,
      database: config.dbPath,
      data: config.dataDir,
      logs: config.logDir,
      screenshots: config.screenshotDir
    }
  };
}

async function fetchJson(url, options = {}, timeoutMs = 4000) {
  if (typeof fetch !== "function") {
    return { ok: false, error: "fetch_not_available" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch (err) {
      body = text;
    }

    return {
      ok: response.ok,
      status: response.status,
      body
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message
    };
  } finally {
    clearTimeout(timer);
  }
}

async function telemetry() {
  const githubHeaders = {
    "User-Agent": config.github.userAgent,
    Accept: "application/vnd.github+json"
  };
  if (config.github.token) githubHeaders.Authorization = `Bearer ${config.github.token}`;

  const [github, ollama] = await Promise.all([
    fetchJson(`${config.github.apiBaseUrl.replace(/\/$/, "")}/rate_limit`, { headers: githubHeaders }),
    fetchJson(`${config.ai.baseUrl.replace(/\/$/, "")}/api/tags`)
  ]);

  return {
    system: systemSnapshot(),
    github: {
      configured: Boolean(config.github.token),
      ...github
    },
    ollama: {
      configured: Boolean(config.ai.baseUrl),
      ...ollama
    }
  };
}

async function listQueue(tableName, limitValue) {
  const limit = safeLimit(limitValue, 100, 250);
  return db.all(`SELECT * FROM ${tableName} ORDER BY created_at DESC, id DESC LIMIT ?`, [limit]);
}

function listLogFiles() {
  if (!fs.existsSync(config.logDir)) return [];
  return fs
    .readdirSync(config.logDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const relativePath = path.join(path.relative(config.rootDir, config.logDir), entry.name);
      return {
        name: entry.name,
        path: relativePath,
        ...fileStat(path.join(config.logDir, entry.name))
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function tailFile(filePath, lines = 250) {
  const stat = fs.statSync(filePath);
  const maxBytes = 512 * 1024;
  const start = Math.max(0, stat.size - maxBytes);
  const length = stat.size - start;
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(filePath, "r");
  try {
    fs.readSync(fd, buffer, 0, length, start);
  } finally {
    fs.closeSync(fd);
  }

  return buffer
    .toString("utf8")
    .split(/\r?\n/)
    .slice(-safeLimit(lines, 250, 1000))
    .join("\n");
}

function fileRecord(relativePath) {
  const absolutePath = path.resolve(config.rootDir, relativePath);
  if (!absolutePath.startsWith(config.rootDir) || !fs.existsSync(absolutePath)) return null;
  const stat = fs.statSync(absolutePath);
  return {
    name: path.basename(relativePath),
    path: relativePath,
    type: stat.isDirectory() ? "directory" : "file",
    size: stat.isDirectory() ? null : stat.size,
    modified_at: stat.mtime.toISOString(),
    downloadable: stat.isFile()
  };
}

function dataFiles() {
  const records = [fileRecord(".env"), fileRecord("openlib.db")].filter(Boolean);

  for (const logFile of listLogFiles()) records.push(fileRecord(logFile.path));

  const roots = ["data", "screenshots"];
  for (const root of roots) {
    const rootPath = path.resolve(config.rootDir, root);
    if (!fs.existsSync(rootPath)) continue;
    records.push(fileRecord(root));
    const entries = fs.readdirSync(rootPath, { withFileTypes: true }).slice(0, 80);
    for (const entry of entries) {
      records.push(fileRecord(path.join(root, entry.name)));
    }
  }

  return records.filter(Boolean);
}

function safeDownloadPath(relativePath) {
  const rel = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const allowed =
    rel === ".env" ||
    rel === "openlib.db" ||
    rel.startsWith("logs/") ||
    rel.startsWith("data/") ||
    rel.startsWith("screenshots/");
  if (!allowed || rel.includes("..")) return null;

  const absolutePath = path.resolve(config.rootDir, rel);
  if (!absolutePath.startsWith(config.rootDir) || !fs.existsSync(absolutePath)) return null;
  const stat = fs.statSync(absolutePath);
  if (!stat.isFile()) return null;
  return { absolutePath, rel };
}

function csvValue(value) {
  if (value === null || value === undefined) return "";
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function exportApps(res, format) {
  const rows = await db.all(
    `SELECT id, name, slug, category, status, visibility, quality_score, stars, license,
            github_full_name, github_url, website_url, updated_at
       FROM apps
      ORDER BY updated_at DESC, id DESC
      LIMIT 10000`
  );

  if (format === "csv") {
    const columns = Object.keys(rows[0] || {
      id: "",
      name: "",
      slug: "",
      category: "",
      status: "",
      visibility: "",
      quality_score: "",
      stars: "",
      license: "",
      github_full_name: "",
      github_url: "",
      website_url: "",
      updated_at: ""
    });
    const lines = [columns.join(",")];
    for (const row of rows) lines.push(columns.map((column) => csvValue(row[column])).join(","));
    sendText(res, 200, `${lines.join("\n")}\n`, "text/csv; charset=utf-8");
    return;
  }

  sendJson(res, 200, { apps: rows, exported_at: new Date().toISOString() });
}

async function saveEnv(content) {
  if (typeof content !== "string") {
    const err = new Error("content must be a string");
    err.statusCode = 400;
    throw err;
  }
  if (content.length > 64 * 1024) {
    const err = new Error(".env content is too large");
    err.statusCode = 400;
    throw err;
  }

  const backupDir = path.resolve(config.dataDir, "env-backups");
  fs.mkdirSync(backupDir, { recursive: true });
  if (fs.existsSync(envPath)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(envPath, path.join(backupDir, `.env.${stamp}.bak`));
  }
  fs.writeFileSync(envPath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

async function router(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (serveGui(req, res, url)) return;

  if (url.pathname === "/health") {
    return sendJson(res, 200, { ok: true, service: "openlib-crawler-gui" });
  }

  if (!authorized(req)) {
    return sendJson(res, 401, { error: "unauthorized" });
  }

  if (req.method === "GET" && url.pathname === "/api/dashboard") {
    return sendJson(res, 200, await dashboard());
  }

  if (req.method === "GET" && url.pathname === "/api/telemetry") {
    return sendJson(res, 200, await telemetry());
  }

  if (req.method === "GET" && url.pathname === "/api/apps") {
    return sendJson(res, 200, await listApps(url));
  }

  const appQueueMatch = url.pathname.match(/^\/api\/apps\/(\d+)\/queue\/(ai|update|sync)$/);
  if (appQueueMatch && req.method === "POST") {
    const appId = Number(appQueueMatch[1]);
    const type = appQueueMatch[2];
    const app = await getAppById(db, appId);
    if (!app) return notFound(res);
    if (type === "ai") await enqueueAiJob(db, appId, "enrich", config.ai.model);
    if (type === "update") await enqueueUpdateJob(db, appId, "refresh");
    if (type === "sync") await enqueueSync(db, appId, app.remote_openlib_id ? "update" : "create");
    return sendJson(res, 200, { ok: true, app: await getDetailedApp(appId) });
  }

  const appMatch = url.pathname.match(/^\/api\/apps\/(\d+)(?:\/(approve|reject))?$/);
  if (appMatch) {
    const appId = Number(appMatch[1]);
    const action = appMatch[2];

    if (req.method === "GET" && !action) {
      const app = await getDetailedApp(appId);
      return app ? sendJson(res, 200, { app }) : notFound(res);
    }

    if (req.method === "PUT" && !action) {
      const fields = normalizeEdit(await readBody(req));
      await updateAppFields(db, appId, fields);
      const app = await getDetailedApp(appId);
      return sendJson(res, 200, { app });
    }

    if (req.method === "POST" && action === "approve") {
      const app = await getAppById(db, appId);
      if (!app) return notFound(res);
      await updateAppFields(db, appId, { status: "approved", visibility: "public" });
      await enqueueSync(db, appId, app.remote_openlib_id ? "update" : "create");
      return sendJson(res, 200, { ok: true, app: await getDetailedApp(appId) });
    }

    if (req.method === "POST" && action === "reject") {
      const body = await readBody(req);
      await updateAppFields(db, appId, {
        status: "rejected",
        visibility: "private",
        rejection_reason: body.reason || "moderator_rejected"
      });
      return sendJson(res, 200, { ok: true, app: await getDetailedApp(appId) });
    }
  }

  const screenshotMatch = url.pathname.match(/^\/screenshots\/(\d+)$/);
  if (req.method === "GET" && screenshotMatch) {
    return serveScreenshot(res, Number(screenshotMatch[1]));
  }

  if (req.method === "GET" && url.pathname === "/api/sync-queue") {
    return sendJson(res, 200, { queue: await listQueue("sync_queue", url.searchParams.get("limit")) });
  }

  if (req.method === "GET" && url.pathname === "/api/ai-jobs") {
    return sendJson(res, 200, { jobs: await listQueue("ai_jobs", url.searchParams.get("limit")) });
  }

  if (req.method === "GET" && url.pathname === "/api/update-jobs") {
    return sendJson(res, 200, { jobs: await listQueue("update_jobs", url.searchParams.get("limit")) });
  }

  if (req.method === "GET" && url.pathname === "/api/jobs") {
    return sendJson(res, 200, {
      running: Array.from(runningJobs.values()).map(publicJob),
      history: jobHistory.map(publicJob),
      available: Object.entries(workerRegistry).map(([name, item]) => ({
        name,
        label: item.label,
        default_limit: item.defaultLimit(),
        interval_ms: item.intervalMs()
      }))
    });
  }

  const jobStartMatch = url.pathname.match(/^\/api\/jobs\/(crawl|update|ai|screenshots|sync)\/start$/);
  if (jobStartMatch && req.method === "POST") {
    const body = await readBody(req);
    try {
      const job = startWorkerJob(jobStartMatch[1], body);
      return sendJson(res, 202, { job: publicJob(job) });
    } catch (err) {
      return sendJson(res, err.statusCode || 500, { error: "job_start_failed", message: err.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/scheduler") {
    return sendJson(res, 200, schedulerSnapshot());
  }

  if (req.method === "POST" && url.pathname === "/api/scheduler/start") {
    const body = await readBody(req);
    return sendJson(res, 200, startScheduler(Boolean(body.run_now)));
  }

  if (req.method === "POST" && url.pathname === "/api/scheduler/stop") {
    return sendJson(res, 200, stopScheduler());
  }

  if (req.method === "GET" && url.pathname === "/api/logs") {
    const fileName = path.basename(url.searchParams.get("file") || "openlib-crawler.log");
    const filePath = path.resolve(config.logDir, fileName);
    if (!filePath.startsWith(config.logDir) || !fs.existsSync(filePath)) {
      return sendJson(res, 200, { files: listLogFiles(), file: fileName, content: "" });
    }
    return sendJson(res, 200, {
      files: listLogFiles(),
      file: fileName,
      content: tailFile(filePath, url.searchParams.get("lines"))
    });
  }

  if (req.method === "GET" && url.pathname === "/api/files") {
    return sendJson(res, 200, { files: dataFiles() });
  }

  if (req.method === "GET" && url.pathname === "/api/files/download") {
    const safePath = safeDownloadPath(url.searchParams.get("path"));
    if (!safePath) return notFound(res);
    return sendFile(res, safePath.absolutePath, "no-store", path.basename(safePath.rel));
  }

  if (req.method === "GET" && url.pathname === "/api/export/apps") {
    return exportApps(res, url.searchParams.get("format") === "csv" ? "csv" : "json");
  }

  if (req.method === "GET" && url.pathname === "/api/config/env") {
    return sendJson(res, 200, {
      path: ".env",
      content: fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "",
      stat: fileStat(envPath)
    });
  }

  if (req.method === "PUT" && url.pathname === "/api/config/env") {
    const body = await readBody(req);
    try {
      await saveEnv(body.content);
      return sendJson(res, 200, {
        ok: true,
        path: ".env",
        stat: fileStat(envPath),
        restart_required: true
      });
    } catch (err) {
      return sendJson(res, err.statusCode || 500, { error: "env_save_failed", message: err.message });
    }
  }

  return notFound(res);
}

async function start() {
  await initializeDatabase(db);
  const server = http.createServer((req, res) => {
    router(req, res).catch((err) => {
      logger.error("gui server error", { error: err.stack || err.message });
      sendJson(res, 500, { error: "internal_error", message: err.message });
    });
  });

  server.on("error", (err) => {
    logger.error("openlib gui failed to listen", { error: err.stack || err.message });
    process.exit(1);
  });

  server.listen(config.moderation.port, config.moderation.host, () => {
    logger.info("openlib gui started", {
      host: config.moderation.host,
      port: config.moderation.port
    });
  });
}

async function shutdown() {
  stopScheduler();
  logger.info("shutdown requested");
  await db.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start().catch((err) => {
  logger.error("gui server failed", { error: err.stack || err.message });
  process.exit(1);
});
