const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const sharp = require("sharp");
const config = require("../config");
const logger = require("../logger");
const { nowIso } = require("../utils/time");
const { parseJson, stringifyJson, uniqueArray } = require("../utils/json");
const { safeFileNameFromUrl, isHttpUrl } = require("../utils/url");
const { withRetry } = require("../utils/retry");

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function relativeToRoot(filePath) {
  return path.relative(config.rootDir, filePath).replace(/\\/g, "/");
}

async function downloadImage(url) {
  return withRetry(
    async () => {
      const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: config.screenshots.timeoutMs,
        maxBodyLength: 8 * 1024 * 1024,
        maxContentLength: 8 * 1024 * 1024,
        headers: {
          "User-Agent": config.github.userAgent,
          Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.8"
        }
      });
      return Buffer.from(response.data);
    },
    {
      retries: 2,
      baseDelayMs: 1000,
      shouldRetry: (err) => {
        const status = err.response?.status;
        return !status || status >= 500 || status === 429;
      }
    }
  );
}

async function processScreenshot(db, app, sourceUrl, sortOrder) {
  if (!isHttpUrl(sourceUrl)) return null;

  const now = nowIso();
  const appDir = path.join(config.screenshotDir, app.slug || String(app.id));
  fs.mkdirSync(appDir, { recursive: true });

  try {
    const buffer = await downloadImage(sourceUrl);
    const hash = sha256(buffer);
    const filename = `${hash.slice(0, 16)}-${safeFileNameFromUrl(sourceUrl, "screenshot").replace(/\.[^.]+$/, "")}.webp`;
    const outputPath = path.join(appDir, filename);
    const image = sharp(buffer, { failOn: "none", animated: false });
    const metadata = await image.metadata();

    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width < config.screenshots.minWidth ||
      metadata.height < config.screenshots.minHeight
    ) {
      await db.run(
        `INSERT INTO screenshots (app_id, source_url, status, sort_order, last_checked_at, created_at, updated_at)
         VALUES (?, ?, 'rejected_tiny', ?, ?, ?, ?)
         ON CONFLICT(app_id, source_url) DO UPDATE SET
           status = excluded.status,
           sort_order = excluded.sort_order,
           last_checked_at = excluded.last_checked_at,
           updated_at = excluded.updated_at`,
        [app.id, sourceUrl, sortOrder, now, now, now]
      );
      return null;
    }

    const result = await image
      .rotate()
      .resize({ width: 1280, height: 900, fit: "inside", withoutEnlargement: true })
      .webp({ quality: config.screenshots.webpQuality })
      .toFile(outputPath);

    const relativePath = relativeToRoot(outputPath);
    await db.run(
      `INSERT INTO screenshots
        (app_id, source_url, local_path, webp_path, width, height, size_bytes, content_hash, status,
         sort_order, last_checked_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?)
       ON CONFLICT(app_id, source_url) DO UPDATE SET
         local_path = excluded.local_path,
         webp_path = excluded.webp_path,
         width = excluded.width,
         height = excluded.height,
         size_bytes = excluded.size_bytes,
         content_hash = excluded.content_hash,
         status = excluded.status,
         sort_order = excluded.sort_order,
         last_checked_at = excluded.last_checked_at,
         updated_at = excluded.updated_at`,
      [
        app.id,
        sourceUrl,
        relativePath,
        relativePath,
        result.width,
        result.height,
        result.size,
        hash,
        sortOrder,
        now,
        now,
        now
      ]
    );

    return {
      source_url: sourceUrl,
      webp_path: relativePath,
      width: result.width,
      height: result.height,
      size_bytes: result.size
    };
  } catch (err) {
    logger.warn("screenshot failed", { appId: app.id, sourceUrl, error: err.message });
    await db.run(
      `INSERT INTO screenshots (app_id, source_url, status, sort_order, last_checked_at, created_at, updated_at)
       VALUES (?, ?, 'failed', ?, ?, ?, ?)
       ON CONFLICT(app_id, source_url) DO UPDATE SET
         status = excluded.status,
         sort_order = excluded.sort_order,
         last_checked_at = excluded.last_checked_at,
         updated_at = excluded.updated_at`,
      [app.id, sourceUrl, sortOrder, now, now, now]
    );
    return null;
  }
}

async function processAppScreenshots(db, app, candidateUrls = []) {
  if (!config.screenshots.enabled) return [];
  const existing = parseJson(app.screenshots, []);
  const urls = uniqueArray([...candidateUrls, ...existing]).filter(isHttpUrl).slice(0, config.screenshots.maxPerApp);
  const ready = [];

  for (let index = 0; index < urls.length; index += 1) {
    const screenshot = await processScreenshot(db, app, urls[index], index);
    if (screenshot) ready.push(screenshot);
  }

  const dbScreenshots = await db.all(
    "SELECT source_url, webp_path, width, height FROM screenshots WHERE app_id = ? AND status = 'ready' ORDER BY sort_order ASC, id ASC LIMIT ?",
    [app.id, config.screenshots.maxPerApp]
  );
  const normalized = dbScreenshots.map((row) => ({
    source_url: row.source_url,
    webp_path: row.webp_path,
    width: row.width,
    height: row.height
  }));

  await db.run("UPDATE apps SET screenshots = ?, last_screenshot_at = ?, updated_at = ? WHERE id = ?", [
    stringifyJson(normalized),
    nowIso(),
    nowIso(),
    app.id
  ]);

  return normalized;
}

module.exports = {
  processAppScreenshots
};
