const path = require("path");

function normalizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    if (parsed.pathname !== "/") parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString();
  } catch (_err) {
    return raw;
  }
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol);
  } catch (_err) {
    return false;
  }
}

function absoluteFromGithub(rawUrl, repo) {
  if (!rawUrl) return "";
  if (isHttpUrl(rawUrl)) return rawUrl;
  if (rawUrl.startsWith("#")) return "";

  const clean = rawUrl.replace(/^\.\//, "");
  const branch = repo.default_branch || "main";
  return `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${branch}/${clean}`;
}

function safeFileNameFromUrl(url, fallback = "image") {
  try {
    const parsed = new URL(url);
    const ext = path.extname(parsed.pathname).slice(0, 8) || ".img";
    const base = path.basename(parsed.pathname, ext).replace(/[^a-z0-9-]/gi, "-").slice(0, 80);
    return `${base || fallback}${ext}`;
  } catch (_err) {
    return fallback;
  }
}

module.exports = {
  normalizeUrl,
  isHttpUrl,
  absoluteFromGithub,
  safeFileNameFromUrl
};
