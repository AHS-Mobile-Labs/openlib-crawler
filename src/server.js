const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");
const config = require("./config");
const logger = require("./logger");
const { db, initializeDatabase } = require("./db");
const { parseJson, stringifyJson } = require("./utils/json");
const { updateAppFields, getAppById, enqueueSync, listAppScreenshots } = require("./services/appStore");

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

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(body));
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
      if (data.length > 1024 * 1024) {
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

function serializeApp(app, screenshots = []) {
  if (!app) return null;
  const output = { ...app, screenshots_preview: screenshots };
  for (const field of jsonFields) {
    output[field] = parseJson(app[field], []);
  }
  return output;
}

async function pendingApps(url) {
  const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 100);
  const status = url.searchParams.get("status") || "pending";
  const statuses =
    status === "pending"
      ? ["pending", "pending_duplicate"]
      : status.split(",").map((item) => item.trim()).filter(Boolean);
  const placeholders = statuses.map(() => "?").join(",");
  const rows = await db.all(
    `SELECT a.*,
            d.name AS duplicate_name,
            d.github_url AS duplicate_github_url
       FROM apps a
       LEFT JOIN apps d ON d.id = a.duplicate_of_app_id
      WHERE a.status IN (${placeholders})
      ORDER BY a.quality_score DESC, a.created_at ASC
      LIMIT ?`,
    [...statuses, limit]
  );

  return Promise.all(
    rows.map(async (app) => serializeApp(app, await listAppScreenshots(db, app.id)))
  );
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

  res.writeHead(200, {
    "Content-Type": "image/webp",
    "Cache-Control": "public, max-age=86400"
  });
  fs.createReadStream(filePath).pipe(res);
}

async function router(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/health") {
    return sendJson(res, 200, { ok: true, service: "openlib-crawler" });
  }

  if (!authorized(req)) {
    return sendJson(res, 401, { error: "unauthorized" });
  }

  if (req.method === "GET" && url.pathname === "/api/apps") {
    return sendJson(res, 200, { apps: await pendingApps(url) });
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
    const rows = await db.all("SELECT * FROM sync_queue ORDER BY created_at DESC LIMIT 100");
    return sendJson(res, 200, { queue: rows });
  }

  return notFound(res);
}

async function start() {
  await initializeDatabase(db);
  const server = http.createServer((req, res) => {
    router(req, res).catch((err) => {
      logger.error("moderation api error", { error: err.stack || err.message });
      sendJson(res, 500, { error: "internal_error", message: err.message });
    });
  });

  server.listen(config.moderation.port, config.moderation.host, () => {
    logger.info("moderation backend started", {
      host: config.moderation.host,
      port: config.moderation.port
    });
  });
}

start().catch((err) => {
  logger.error("moderation backend failed", { error: err.stack || err.message });
  process.exit(1);
});
