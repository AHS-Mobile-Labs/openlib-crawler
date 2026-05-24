const { daysBetween } = require("../utils/time");
const { parseJson } = require("../utils/json");

function scoreStars(stars) {
  if (stars >= 10000) return 20;
  if (stars >= 5000) return 18;
  if (stars >= 1000) return 15;
  if (stars >= 500) return 11;
  if (stars >= 100) return 7;
  return 0;
}

function scoreActivity(pushedAt) {
  const age = daysBetween(pushedAt);
  if (age <= 30) return 15;
  if (age <= 90) return 12;
  if (age <= 180) return 8;
  if (age <= 365) return 4;
  return 0;
}

function calculateQualityScore(app, parsedReadme = {}) {
  const screenshots = parsedReadme.screenshots || parseJson(app.screenshots, []);
  const tags = parseJson(app.tags, []);
  const topics = parseJson(app.topics, []);
  const hasWebsite = Boolean(app.website_url || app.website);
  const hasDocs = Boolean(app.docs_url || (parsedReadme.docsLinks || []).length);
  const hasLicense = Boolean(app.license && app.license !== "NOASSERTION" && app.license !== "Unknown");
  const isOrg = app.maintainer_type === "Organization";
  const hasRelease = Boolean(app.has_releases || app.latest_release_tag);

  const score =
    scoreStars(Number(app.stars || 0)) +
    scoreActivity(app.pushed_at || app.last_commit_at) +
    (hasRelease ? 10 : 0) +
    Math.min((screenshots || []).length * 3, 10) +
    (hasWebsite ? 8 : 0) +
    (isOrg ? 5 : 0) +
    (hasLicense ? 10 : 0) +
    Math.min(Number(app.readme_quality_score || parsedReadme.readmeQualityScore || 0) * 0.15, 15) +
    Math.min(Number(app.docs_quality_score || parsedReadme.docsQualityScore || 0) * 0.1, 10) +
    Math.min((tags.length + topics.length) * 1.5, 7);

  return Math.max(0, Math.min(100, Math.round(score)));
}

function rejectReason(repo, config) {
  if (repo.fork) return "fork";
  if (repo.archived) return "archived";
  if (repo.disabled) return "disabled";
  if (!repo.license) return "missing_license";
  if (!repo.description) return "missing_description";
  if (Number(repo.stargazers_count || 0) < config.github.minStars) return "low_stars";
  if (daysBetween(repo.pushed_at) > config.github.inactiveDays) return "inactive";
  return "";
}

module.exports = {
  calculateQualityScore,
  rejectReason
};
