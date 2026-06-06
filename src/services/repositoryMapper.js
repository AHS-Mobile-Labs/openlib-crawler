const { makeSlug, cleanText } = require("../utils/text");
const { stringifyJson, uniqueArray } = require("../utils/json");
const {
  normalizeCategory,
  normalizeLicense,
  normalizeMaintainerType,
  isOpenSourceVerified
} = require("./formOptions");

function repoParts(repo) {
  const fullName = repo.full_name || "";
  const [owner, name] = fullName.split("/");
  return {
    owner: owner || repo.owner?.login || "",
    name: name || repo.name || ""
  };
}

function detectCategory(repo, parsedReadme = {}) {
  const topics = (repo.topics || []).map((topic) => topic.toLowerCase());
  const language = String(repo.language || "").toLowerCase();
  const text = `${repo.description || ""} ${topics.join(" ")} ${parsedReadme.text || ""}`.toLowerCase();

  const rules = [
    ["Communication", ["chat", "messaging", "email", "mail", "forum", "social", "community", "communication"]],
    ["Design", ["design", "figma", "drawing", "image", "graphics", "photo", "vector", "illustration"]],
    ["Finance", ["finance", "accounting", "budget", "invoice", "payment", "money", "expense", "ledger"]],
    ["Media", ["video", "audio", "music", "player", "streaming", "podcast", "recording"]],
    ["Security", ["security", "password", "auth", "vpn", "encryption", "privacy", "firewall"]],
    ["Productivity", ["productivity", "notes", "task", "todo", "calendar", "kanban"]],
    ["Utility", ["developer-tool", "devtool", "cli", "terminal", "ide", "code-editor", "api", "self-hosted", "selfhosted", "server", "docker", "backup", "sync"]],
    ["Productivity", ["ai", "llm", "machine-learning", "ml", "ollama", "education", "learning", "course", "flashcard", "crm", "erp", "analytics"]]
  ];

  for (const [category, needles] of rules) {
    if (needles.some((needle) => topics.includes(needle) || text.includes(needle))) return category;
  }

  if (["javascript", "typescript", "go", "rust", "python"].includes(language)) return "Utility";
  return "Other";
}

function readmeRawUrl(repo, parsedReadme, parts) {
  if (parsedReadme.readmeRawUrl) return parsedReadme.readmeRawUrl;
  if (!(parsedReadme.markdown || parsedReadme.text) || !parts.owner || !parts.name) return "";
  const branch = repo.default_branch || "main";
  return `https://raw.githubusercontent.com/${parts.owner}/${parts.name}/${branch}/README.md`;
}

function mapRepositoryToApp(repo, parsedReadme = {}, latestRelease = null) {
  const parts = repoParts(repo);
  const website = repo.homepage || parsedReadme.websiteLinks?.[0] || "";
  const docs = parsedReadme.docsLinks?.[0] || "";
  const youtube = parsedReadme.youtubeLinks?.[0] || "";
  const sourceUrl = repo.html_url || `https://github.com/${parts.owner}/${parts.name}`;
  const releaseUrl = latestRelease?.html_url || `${sourceUrl}/releases`;
  const description = cleanText(repo.description || parsedReadme.text || "", 220);
  const rawLicense = repo.license?.spdx_id || repo.license?.name || "";

  return {
    github_id: repo.id,
    github_owner: parts.owner,
    github_repo: parts.name,
    github_full_name: repo.full_name || `${parts.owner}/${parts.name}`,
    github_url: sourceUrl,
    source_url: sourceUrl,
    download_url: releaseUrl,
    website,
    website_url: website,
    docs_url: docs,
    youtube_url: youtube,
    name: repo.name || parts.name,
    slug: makeSlug(repo.name || parts.name),
    category: normalizeCategory(detectCategory(repo, parsedReadme)),
    logo: parsedReadme.logoUrls?.[0] || "",
    logo_url: parsedReadme.logoUrls?.[0] || "",
    short_description: description,
    full_description: cleanText(parsedReadme.text || repo.description || "", 3000),
    uses: "",
    alternative_of: stringifyJson(parsedReadme.alternativeOf || []),
    maintainer_type: normalizeMaintainerType(repo.owner?.type || "User"),
    developer_name: repo.owner?.login || parts.owner,
    developer_url: repo.owner?.html_url || `https://github.com/${parts.owner}`,
    version: latestRelease?.tag_name || "",
    license: normalizeLicense(rawLicense),
    file_size: repo.size || 0,
    tags: stringifyJson(uniqueArray([...(repo.topics || []), repo.language].filter(Boolean)).slice(0, 16)),
    key_features: stringifyJson(parsedReadme.features || []),
    screenshots: stringifyJson(parsedReadme.screenshots || []),
    comparison_table: stringifyJson(parsedReadme.comparisonTable || []),
    supported_platforms: stringifyJson(parsedReadme.supportedPlatforms || []),
    installation_methods: stringifyJson(parsedReadme.installationMethods || []),
    system_requirements: stringifyJson(parsedReadme.systemRequirements || []),
    open_source_verified: isOpenSourceVerified(rawLicense) ? 1 : 0,
    visibility: "public",
    added_by: "OpenLib (Official)",
    stars: repo.stargazers_count || 0,
    forks: repo.forks_count || 0,
    watchers: repo.watchers_count || 0,
    open_issues: repo.open_issues_count || 0,
    fork: repo.fork ? 1 : 0,
    archived: repo.archived ? 1 : 0,
    disabled: repo.disabled ? 1 : 0,
    language: repo.language || "",
    topics: stringifyJson(repo.topics || []),
    default_branch: repo.default_branch || "main",
    package_names: stringifyJson([repo.name, repo.full_name].filter(Boolean)),
    has_releases: latestRelease ? 1 : 0,
    latest_release_tag: latestRelease?.tag_name || "",
    latest_release_url: latestRelease?.html_url || "",
    latest_release_at: latestRelease?.published_at || "",
    last_commit_at: repo.pushed_at || "",
    pushed_at: repo.pushed_at || "",
    readme_raw_url: readmeRawUrl(repo, parsedReadme, parts),
    readme_markdown: parsedReadme.markdown || "",
    readme_text: parsedReadme.text || "",
    readme_quality_score: parsedReadme.readmeQualityScore || 0,
    docs_quality_score: parsedReadme.docsQualityScore || 0
  };
}

module.exports = {
  mapRepositoryToApp,
  detectCategory
};
