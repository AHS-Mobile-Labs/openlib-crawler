const { parseJson } = require("../utils/json");
const { normalizeUrl } = require("../utils/url");

function tokens(value) {
  return new Set(
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter(Boolean)
  );
}

function jaccard(a, b) {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((item) => right.has(item)).length;
  return intersection / (left.size + right.size - intersection);
}

function arrayOverlapScore(left, right) {
  const a = new Set(parseJson(left, []).map((item) => String(item).toLowerCase()));
  const b = new Set(parseJson(right, []).map((item) => String(item).toLowerCase()));
  if (!a.size || !b.size) return 0;
  return ([...a].filter((item) => b.has(item)).length / Math.min(a.size, b.size)) * 100;
}

function similarityScore(app, other) {
  if (app.github_id && other.github_id && Number(app.github_id) === Number(other.github_id)) return 100;
  if (app.github_full_name && app.github_full_name === other.github_full_name) return 100;
  if (app.github_url && app.github_url === other.github_url) return 100;

  let score = 0;
  if (app.slug && other.slug && app.slug === other.slug) score = Math.max(score, 85);
  if (app.website_url && other.website_url && normalizeUrl(app.website_url) === normalizeUrl(other.website_url)) {
    score = Math.max(score, 80);
  }
  if (app.github_owner && other.github_owner && app.github_owner === other.github_owner && app.name === other.name) {
    score = Math.max(score, 78);
  }

  score = Math.max(score, Math.round(jaccard(app.name, other.name) * 65));
  score = Math.max(score, Math.round(jaccard(app.short_description, other.short_description) * 45));
  score = Math.max(score, Math.round(arrayOverlapScore(app.package_names, other.package_names) * 0.75));
  return score;
}

async function detectDuplicate(db, app) {
  const candidates = await db.all(
    `SELECT id, github_id, github_owner, github_full_name, github_url, name, slug, website_url,
            short_description, package_names
       FROM apps
      WHERE id != ?
        AND status NOT IN ('rejected', 'dead')
        AND (
          slug = ?
          OR github_owner = ?
          OR website_url = ?
          OR github_full_name = ?
          OR name = ?
        )
      LIMIT 50`,
    [app.id || 0, app.slug || "", app.github_owner || "", app.website_url || "", app.github_full_name || "", app.name || ""]
  );

  let best = null;
  for (const candidate of candidates) {
    const score = similarityScore(app, candidate);
    if (!best || score > best.score) {
      best = { app: candidate, score };
    }
  }

  if (best && best.score >= 75) {
    await db.run("UPDATE apps SET duplicate_of_app_id = ?, duplicate_score = ? WHERE id = ?", [
      best.app.id,
      best.score,
      app.id
    ]);
    return best;
  }

  await db.run("UPDATE apps SET duplicate_of_app_id = NULL, duplicate_score = 0 WHERE id = ?", [app.id]);
  return null;
}

module.exports = {
  detectDuplicate,
  similarityScore
};
