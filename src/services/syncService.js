const axios = require("axios");
const config = require("../config");
const logger = require("../logger");
const { nowIso } = require("../utils/time");
const { parseJson, stringifyJson } = require("../utils/json");
const { listAppScreenshots } = require("./appStore");

function appToPayload(app, screenshots = []) {
  return {
    external_id: app.remote_openlib_id || undefined,
    source: "github",
    source_url: app.source_url || app.github_url,
    github: {
      id: app.github_id,
      owner: app.github_owner,
      repo: app.github_repo,
      full_name: app.github_full_name,
      stars: app.stars,
      forks: app.forks,
      last_commit_at: app.last_commit_at
    },
    name: app.name,
    slug: app.slug,
    category: app.category,
    logo: app.logo_url || app.logo,
    short_description: app.short_description,
    full_description: app.full_description,
    uses: app.uses,
    alternative_of: parseJson(app.alternative_of, []),
    download_url: app.download_url,
    website_url: app.website_url || app.website,
    docs_url: app.docs_url,
    youtube_url: app.youtube_url,
    maintainer_type: app.maintainer_type,
    developer_name: app.developer_name,
    developer_url: app.developer_url,
    version: app.version,
    license: app.license,
    file_size: app.file_size,
    tags: parseJson(app.tags, []),
    key_features: parseJson(app.key_features, []),
    screenshots: screenshots.map((shot) => ({
      source_url: shot.source_url,
      path: shot.webp_path || shot.local_path,
      width: shot.width,
      height: shot.height
    })),
    comparison_table: parseJson(app.comparison_table, []),
    supported_platforms: parseJson(app.supported_platforms, []),
    installation_methods: parseJson(app.installation_methods, []),
    system_requirements: parseJson(app.system_requirements, []),
    open_source_verified: Boolean(app.open_source_verified),
    visibility: app.visibility,
    added_by: app.added_by,
    quality_score: app.quality_score,
    status: app.status,
    last_updated: app.updated_at
  };
}

function syncClient() {
  if (!config.sync.apiBaseUrl) {
    throw new Error("OPENLIB_API_URL is required for sync");
  }
  if (!config.sync.apiKey) {
    throw new Error("OPENLIB_API_KEY is required for sync");
  }

  return axios.create({
    baseURL: config.sync.apiBaseUrl.replace(/\/+$/, ""),
    timeout: 30000,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.sync.apiKey}`,
      "X-API-Key": config.sync.apiKey
    }
  });
}

async function sendSyncRequest(client, action, app, payload) {
  if (action === "create") {
    return client.post("/apps", payload);
  }

  if (action === "update") {
    const id = app.remote_openlib_id || app.slug;
    return client.post(`/apps/${encodeURIComponent(id)}`, payload);
  }

  if (action === "delete") {
    const id = app.remote_openlib_id || app.slug;
    return client.post(`/apps/${encodeURIComponent(id)}/delete`, {
      source_url: app.source_url || app.github_url,
      reason: app.dead_reason || app.rejection_reason || "removed"
    });
  }

  throw new Error(`Unknown sync action: ${action}`);
}

function nextRetryIso(attempts) {
  const delay = config.sync.retryBaseMs * Math.pow(2, Math.min(attempts, 5));
  return new Date(Date.now() + delay).toISOString();
}

async function processSyncQueue(db, limit = config.sync.batchSize) {
  const rows = await db.all(
    `SELECT a.*,
            q.id AS queue_id,
            q.action AS queue_action,
            q.payload AS queue_payload,
            q.attempts AS queue_attempts
       FROM sync_queue q
       JOIN apps a ON a.id = q.app_id
      WHERE q.status IN ('pending', 'failed')
        AND (q.next_attempt_at IS NULL OR q.next_attempt_at <= ?)
      ORDER BY q.created_at ASC
      LIMIT ?`,
    [nowIso(), limit]
  );

  if (!rows.length) {
    logger.info("sync queue empty");
    return { processed: 0, synced: 0, failed: 0 };
  }

  const client = syncClient();
  let synced = 0;
  let failed = 0;

  for (const row of rows) {
    const now = nowIso();
    await db.run("UPDATE sync_queue SET status = 'processing', updated_at = ? WHERE id = ?", [now, row.queue_id]);

    try {
      const screenshots = await listAppScreenshots(db, row.id);
      const payload = row.queue_payload ? parseJson(row.queue_payload, {}) : appToPayload(row, screenshots);
      const response = await sendSyncRequest(client, row.queue_action, row, payload);
      const remoteId = response.data?.id || response.data?.app?.id || row.remote_openlib_id || null;
      const done = nowIso();

      await db.run(
        `UPDATE sync_queue SET status = 'synced', synced = 1, openlib_response = ?, updated_at = ?, synced_at = ?
         WHERE id = ?`,
        [stringifyJson(response.data || {}), done, done, row.queue_id]
      );

      await db.run(
        `UPDATE apps SET
          remote_openlib_id = COALESCE(?, remote_openlib_id),
          status = CASE WHEN status = 'approved' THEN 'published' ELSE status END,
          last_synced_at = ?,
          updated_at = ?
         WHERE id = ?`,
        [remoteId, done, done, row.id]
      );

      synced += 1;
      logger.info("sync completed", { appId: row.id, action: row.queue_action });
    } catch (err) {
      const attempts = Number(row.queue_attempts || 0) + 1;
      const nextAttempt = nextRetryIso(attempts);
      await db.run(
        `UPDATE sync_queue SET status = 'failed', attempts = ?, last_error = ?, next_attempt_at = ?, updated_at = ?
         WHERE id = ?`,
        [
          attempts,
          err.response?.data ? stringifyJson(err.response.data) : err.message,
          nextAttempt,
          nowIso(),
          row.queue_id
        ]
      );
      failed += 1;
      logger.error("sync failed", { appId: row.id, action: row.queue_action, error: err.message });
    }
  }

  return { processed: rows.length, synced, failed };
}

module.exports = {
  appToPayload,
  processSyncQueue
};
