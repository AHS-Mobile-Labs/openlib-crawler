const { nowIso } = require("../utils/time");
const { stringifyJson } = require("../utils/json");

const mutableAppFields = [
  "github_id",
  "github_owner",
  "github_repo",
  "github_full_name",
  "github_url",
  "source_url",
  "download_url",
  "website",
  "website_url",
  "docs_url",
  "youtube_url",
  "name",
  "slug",
  "category",
  "logo",
  "logo_url",
  "logo_local_path",
  "short_description",
  "full_description",
  "uses",
  "alternative_of",
  "maintainer_type",
  "developer_name",
  "developer_url",
  "version",
  "license",
  "file_size",
  "tags",
  "key_features",
  "screenshots",
  "comparison_table",
  "supported_platforms",
  "installation_methods",
  "system_requirements",
  "open_source_verified",
  "visibility",
  "added_by",
  "quality_score",
  "score",
  "status",
  "rejection_reason",
  "duplicate_of_app_id",
  "duplicate_score",
  "stars",
  "forks",
  "watchers",
  "open_issues",
  "fork",
  "archived",
  "disabled",
  "language",
  "topics",
  "default_branch",
  "package_names",
  "has_releases",
  "latest_release_tag",
  "latest_release_url",
  "latest_release_at",
  "last_commit_at",
  "pushed_at",
  "readme_markdown",
  "readme_text",
  "readme_quality_score",
  "docs_quality_score",
  "remote_openlib_id",
  "dead_checked_at",
  "dead_reason",
  "last_crawled_at",
  "last_ai_at",
  "last_screenshot_at",
  "last_synced_at"
];

async function findExistingApp(db, app) {
  if (app.github_id) {
    const byGithubId = await db.get("SELECT * FROM apps WHERE github_id = ? LIMIT 1", [app.github_id]);
    if (byGithubId) return byGithubId;
  }

  if (app.github_full_name) {
    const byFullName = await db.get("SELECT * FROM apps WHERE github_full_name = ? LIMIT 1", [app.github_full_name]);
    if (byFullName) return byFullName;
  }

  if (app.github_url || app.source_url) {
    const byUrl = await db.get("SELECT * FROM apps WHERE github_url = ? OR source_url = ? LIMIT 1", [
      app.github_url || app.source_url,
      app.source_url || app.github_url
    ]);
    if (byUrl) return byUrl;
  }

  return null;
}

async function upsertApp(db, app) {
  const now = nowIso();
  const existing = await findExistingApp(db, app);
  const data = {
    ...app,
    quality_score: app.quality_score ?? app.score ?? 0,
    score: app.score ?? app.quality_score ?? 0,
    updated_at: now,
    last_crawled_at: app.last_crawled_at || now
  };

  const keys = Object.keys(data).filter((key) => mutableAppFields.includes(key));

  if (existing) {
    const assignments = keys.map((key) => `${key} = ?`).join(", ");
    await db.run(`UPDATE apps SET ${assignments}, updated_at = ? WHERE id = ?`, [
      ...keys.map((key) => data[key]),
      now,
      existing.id
    ]);
    return existing.id;
  }

  data.created_at = now;
  data.updated_at = now;
  const insertKeys = [...keys, "created_at", "updated_at"];
  const placeholders = insertKeys.map(() => "?").join(", ");
  const result = await db.run(
    `INSERT INTO apps (${insertKeys.join(", ")}) VALUES (${placeholders})`,
    insertKeys.map((key) => data[key])
  );
  return result.lastID;
}

async function getAppById(db, id) {
  return db.get("SELECT * FROM apps WHERE id = ? LIMIT 1", [id]);
}

async function updateAppFields(db, id, fields) {
  const now = nowIso();
  const keys = Object.keys(fields).filter((key) => mutableAppFields.includes(key));
  if (!keys.length) return;
  await db.run(`UPDATE apps SET ${keys.map((key) => `${key} = ?`).join(", ")}, updated_at = ? WHERE id = ?`, [
    ...keys.map((key) => fields[key]),
    now,
    id
  ]);
}

async function enqueueAiJob(db, appId, task = "enrich", model = "") {
  const existing = await db.get(
    "SELECT id FROM ai_jobs WHERE app_id = ? AND task = ? AND status IN ('pending', 'processing') LIMIT 1",
    [appId, task]
  );
  if (existing) return existing.id;

  const now = nowIso();
  const result = await db.run(
    `INSERT INTO ai_jobs (app_id, task, status, model, attempts, created_at, updated_at)
     VALUES (?, ?, 'pending', ?, 0, ?, ?)`,
    [appId, task, model, now, now]
  );
  return result.lastID;
}

async function enqueueUpdateJob(db, appId, jobType = "refresh") {
  const existing = await db.get(
    "SELECT id FROM update_jobs WHERE app_id = ? AND job_type = ? AND status IN ('pending', 'processing') LIMIT 1",
    [appId, jobType]
  );
  if (existing) return existing.id;

  const now = nowIso();
  const result = await db.run(
    `INSERT INTO update_jobs (app_id, job_type, status, attempts, created_at, updated_at)
     VALUES (?, ?, 'pending', 0, ?, ?)`,
    [appId, jobType, now, now]
  );
  return result.lastID;
}

async function enqueueSync(db, appId, action, payload = null) {
  const existing = await db.get(
    "SELECT id FROM sync_queue WHERE app_id = ? AND action = ? AND status IN ('pending', 'processing') LIMIT 1",
    [appId, action]
  );
  if (existing) return existing.id;

  const now = nowIso();
  const result = await db.run(
    `INSERT INTO sync_queue (app_id, action, payload, status, attempts, synced, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', 0, 0, ?, ?)`,
    [appId, action, payload ? stringifyJson(payload) : null, now, now]
  );
  return result.lastID;
}

async function listAppScreenshots(db, appId) {
  return db.all(
    "SELECT * FROM screenshots WHERE app_id = ? AND status = 'ready' ORDER BY sort_order ASC, id ASC",
    [appId]
  );
}

module.exports = {
  mutableAppFields,
  findExistingApp,
  upsertApp,
  getAppById,
  updateAppFields,
  enqueueAiJob,
  enqueueUpdateJob,
  enqueueSync,
  listAppScreenshots
};
