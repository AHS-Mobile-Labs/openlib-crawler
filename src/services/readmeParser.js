const cheerio = require("cheerio");
const { cleanText, compactLines } = require("../utils/text");
const { absoluteFromGithub, normalizeUrl, isHttpUrl } = require("../utils/url");
const { uniqueArray } = require("../utils/json");

const screenshotHints = [
  "screenshot",
  "screen-shot",
  "preview",
  "demo",
  "gallery",
  "image",
  "capture",
  "ui",
  "interface"
];

const badgeHints = [
  "badge",
  "shield",
  "travis",
  "circleci",
  "github/actions",
  "workflow",
  "license",
  "coverage",
  "npm/v",
  "version"
];

function markdownImages(markdown) {
  const images = [];
  const imageRe = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match;
  while ((match = imageRe.exec(markdown))) {
    images.push({ alt: match[1] || "", url: match[2] || "" });
  }
  return images;
}

function htmlImages(markdown) {
  const $ = cheerio.load(markdown);
  const images = [];
  $("img").each((_idx, el) => {
    images.push({
      alt: $(el).attr("alt") || "",
      url: $(el).attr("src") || ""
    });
  });
  return images;
}

function markdownLinks(markdown) {
  const links = [];
  const linkRe = /(?<!!)\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match;
  while ((match = linkRe.exec(markdown))) {
    links.push({ text: cleanText(match[1]), url: match[2] || "" });
  }
  return links;
}

function htmlLinks(markdown) {
  const $ = cheerio.load(markdown);
  const links = [];
  $("a").each((_idx, el) => {
    links.push({
      text: cleanText($(el).text() || $(el).attr("href") || ""),
      url: $(el).attr("href") || ""
    });
  });
  return links;
}

function isBadge(image) {
  const haystack = `${image.alt} ${image.url}`.toLowerCase();
  return badgeHints.some((hint) => haystack.includes(hint));
}

function isLikelyScreenshot(image) {
  const haystack = `${image.alt} ${image.url}`.toLowerCase();
  if (isBadge(image)) return false;
  if (!/\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(image.url)) return false;
  return screenshotHints.some((hint) => haystack.includes(hint)) || !/svg(\?|#|$)/i.test(image.url);
}

function sectionLines(markdown, headings) {
  const lines = markdown.split(/\r?\n/);
  const wanted = headings.map((heading) => heading.toLowerCase());
  const collected = [];
  let active = false;

  for (const line of lines) {
    const heading = line.match(/^#{1,4}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const text = cleanText(heading[1]).toLowerCase();
      active = wanted.some((item) => text.includes(item));
      continue;
    }

    if (active) {
      if (/^#{1,4}\s+/.test(line)) break;
      const bullet = line.match(/^\s*[-*+]\s+(.+)/);
      if (bullet) collected.push(bullet[1]);
    }
  }

  return compactLines(collected).slice(0, 12);
}

function extractCodeBlocks(markdown) {
  const blocks = [];
  const re = /```[a-z0-9-]*\n([\s\S]*?)```/gi;
  let match;
  while ((match = re.exec(markdown))) {
    blocks.push(match[1].trim());
  }
  return blocks;
}

function extractInstallation(markdown) {
  const commands = [];
  const installSection = sectionLines(markdown, ["install", "installation", "getting started"]);
  for (const line of installSection) {
    if (/^(npm|pnpm|yarn|pip|cargo|go|brew|apt|flatpak|snap|docker|git)\b/i.test(line)) {
      commands.push(line);
    }
  }

  for (const block of extractCodeBlocks(markdown)) {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.some((line) => /^(npm|pnpm|yarn|pip|cargo|go|brew|apt|flatpak|snap|docker|git)\b/i.test(line))) {
      commands.push(lines.slice(0, 6).join("\n"));
    }
  }

  return uniqueArray(commands).slice(0, 8);
}

function extractPlatforms(markdown, repo) {
  const text = `${markdown} ${repo.language || ""} ${(repo.topics || []).join(" ")}`.toLowerCase();
  const platformMap = [
    ["linux", "Linux"],
    ["windows", "Windows"],
    ["macos", "macOS"],
    ["osx", "macOS"],
    ["android", "Android"],
    ["ios", "iOS"],
    ["web", "Web"],
    ["docker", "Docker"],
    ["flatpak", "Flatpak"],
    ["appimage", "AppImage"],
    ["snap", "Snap"]
  ];

  return uniqueArray(platformMap.filter(([needle]) => text.includes(needle)).map(([, label]) => label));
}

function extractLinks(markdown, repo) {
  const all = [...markdownLinks(markdown), ...htmlLinks(markdown)]
    .map((link) => ({
      text: cleanText(link.text),
      url: normalizeUrl(absoluteFromGithub(link.url, repo))
    }))
    .filter((link) => isHttpUrl(link.url));

  const seen = new Set();
  return all.filter((link) => {
    const key = `${link.text}|${link.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseReadme(markdown = "", repo = {}) {
  const text = cleanText(markdown);
  const images = [...markdownImages(markdown), ...htmlImages(markdown)]
    .map((image) => ({
      alt: cleanText(image.alt),
      url: normalizeUrl(absoluteFromGithub(image.url, repo))
    }))
    .filter((image) => isHttpUrl(image.url));

  const screenshots = uniqueArray(images.filter(isLikelyScreenshot).map((image) => image.url)).slice(0, 12);
  const badges = uniqueArray(images.filter(isBadge).map((image) => image.url));
  const links = extractLinks(markdown, repo);
  const features = sectionLines(markdown, ["feature", "features", "highlights", "why"]);
  const installationMethods = extractInstallation(markdown);

  const docsLinks = links
    .filter((link) => /docs|documentation|guide|manual|wiki|book/i.test(`${link.text} ${link.url}`))
    .map((link) => link.url)
    .slice(0, 6);

  const websiteLinks = links
    .filter((link) => /website|homepage|demo|official|site/i.test(link.text))
    .map((link) => link.url)
    .slice(0, 4);

  const youtubeLinks = links
    .filter((link) => /youtube\.com|youtu\.be/i.test(link.url))
    .map((link) => link.url)
    .slice(0, 4);

  const headings = markdown.match(/^#{1,3}\s+.+$/gm) || [];
  const readmeQualityScore = Math.min(
    100,
    (text.length > 1000 ? 20 : text.length > 300 ? 10 : 0) +
      Math.min(features.length * 5, 25) +
      Math.min(screenshots.length * 8, 20) +
      (installationMethods.length ? 15 : 0) +
      (docsLinks.length ? 10 : 0) +
      Math.min(headings.length * 2, 10)
  );

  return {
    text,
    screenshots,
    badges,
    features,
    installationMethods,
    docsLinks,
    websiteLinks,
    youtubeLinks,
    supportedPlatforms: extractPlatforms(markdown, repo),
    readmeQualityScore,
    docsQualityScore: Math.min(100, docsLinks.length * 30 + (installationMethods.length ? 20 : 0))
  };
}

module.exports = {
  parseReadme
};
