const cheerio = require("cheerio");
const { cleanText, compactLines } = require("../utils/text");
const { absoluteFromGithub, normalizeUrl, isHttpUrl, toRawGithubUrl } = require("../utils/url");
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

const logoHints = [
  "logo",
  "icon",
  "app-icon",
  "brand",
  "mark"
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

function isLikelyLogo(image) {
  const haystack = `${image.alt} ${image.url}`.toLowerCase();
  const hintHaystack = `${image.alt} ${image.url.split("/").pop() || ""}`.toLowerCase();
  if (isBadge(image)) return false;
  if (!/\.(png|jpe?g|webp)(\?|#|$)/i.test(image.url)) return false;
  if (screenshotHints.some((hint) => hintHaystack.includes(hint))) return false;
  return logoHints.some((hint) => haystack.includes(hint));
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

function sectionContentLines(markdown, headings) {
  const lines = markdown.split(/\r?\n/);
  const wanted = headings.map((heading) => heading.toLowerCase());
  const collected = [];
  let active = false;
  let inCode = false;

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;

    const heading = line.match(/^#{1,4}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const text = cleanText(heading[1]).toLowerCase();
      active = wanted.some((item) => text.includes(item));
      continue;
    }

    if (!active || /^\s*\|/.test(line)) continue;
    const cleaned = line
      .replace(/^\s*[-*+]\s+/, "")
      .replace(/^\s*\d+[.)]\s+/, "")
      .trim();
    if (cleaned) collected.push(cleaned);
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

function inferInstallLabel(command) {
  const firstLine = String(command || "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\$\s*/, "").replace(/^sudo\s+/, ""))
    .find(Boolean) || "";

  if (isHttpUrl(firstLine)) return "download";

  const firstToken = firstLine.split(/\s+/)[0].toLowerCase();
  const labelMap = {
    npm: "npm",
    pnpm: "pnpm",
    yarn: "yarn",
    pip: "pip",
    pipx: "pipx",
    cargo: "cargo",
    go: "go",
    brew: "brew",
    apt: "apt",
    "apt-get": "apt",
    flatpak: "flatpak",
    snap: "snap",
    docker: "docker",
    winget: "winget",
    choco: "choco",
    git: "git"
  };

  if (labelMap[firstToken]) return labelMap[firstToken];
  if (/curl|wget/.test(firstToken)) return "script";
  return "manual";
}

function formatInstallationMethod(command) {
  const normalized = cleanText(String(command || "").replace(/\r?\n/g, " && "), 400);
  if (!normalized) return "";
  if (/^[a-z0-9-]+\s*\|/i.test(normalized)) return normalized;
  return `${inferInstallLabel(command)} | ${normalized}`;
}

function extractInstallation(markdown) {
  const commands = [];
  const installSection = sectionContentLines(markdown, ["install", "installation", "getting started", "quick start"]);
  for (const line of installSection) {
    if (/^(\$?\s*)?(sudo\s+)?(npm|pnpm|yarn|pipx?|cargo|go|brew|apt|apt-get|flatpak|snap|docker|winget|choco|git|curl|wget)\b/i.test(line)) {
      commands.push(line);
    }
  }

  for (const block of extractCodeBlocks(markdown)) {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.some((line) => /^(\$?\s*)?(sudo\s+)?(npm|pnpm|yarn|pipx?|cargo|go|brew|apt|apt-get|flatpak|snap|docker|winget|choco|git|curl|wget)\b/i.test(line))) {
      commands.push(lines.slice(0, 6).join("\n"));
    }
  }

  return uniqueArray(commands.map(formatInstallationMethod)).slice(0, 8);
}

function cleanAlternativeName(value) {
  const cleaned = cleanText(value || "", 80)
    .replace(/\[[^\]]+\]\([^)]+\)/g, "")
    .replace(/^["'`([{]+|["'`)\]}]+$/g, "")
    .replace(/\b(apps?|software|tools?|solutions?|platforms?)$/i, "")
    .trim();
  if (!cleaned || cleaned.length < 2) return "";
  if (/^(commercial|proprietary|paid|closed source)$/i.test(cleaned)) return "";
  return cleaned;
}

function extractAlternatives(markdown) {
  const text = cleanText(markdown, 12000);
  const alternatives = [];
  const patterns = [
    /(?:free\s+and\s+open[- ]source\s+|open[- ]source\s+|free\s+)?alternative\s+(?:to|for)\s+([^.;:\n]{2,90})/gi,
    /(?:replacement|substitute)\s+(?:to|for)\s+([^.;:\n]{2,90})/gi
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text))) {
      const raw = match[1]
        .replace(/\bwith\b.*$/i, "")
        .replace(/\bthat\b.*$/i, "")
        .replace(/\bused\b.*$/i, "");
      for (const item of raw.split(/\s*(?:,|\/|\bor\b|\band\b)\s*/i)) {
        const alternative = cleanAlternativeName(item);
        if (alternative) alternatives.push(alternative);
      }
    }
  }

  return uniqueArray(alternatives).slice(0, 8);
}

function extractSystemRequirements(markdown) {
  return sectionContentLines(markdown, ["system requirements", "requirements", "prerequisites"])
    .filter((line) => !/^(\$?\s*)?(npm|pnpm|yarn|pipx?|cargo|go|brew|apt|apt-get|flatpak|snap|docker|winget|choco|git)\b/i.test(line))
    .slice(0, 8);
}

function splitTableRow(line, shouldClean = true) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => (shouldClean ? cleanText(cell, 120) : cell.trim()));
}

function isTableSeparator(line) {
  const cells = splitTableRow(line, false);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function extractComparisonTable(markdown) {
  const lines = markdown.split(/\r?\n/);
  const rows = [];
  let currentHeading = "";

  for (let index = 0; index < lines.length - 1; index += 1) {
    const heading = lines[index].match(/^#{1,4}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      currentHeading = cleanText(heading[1], 120);
      continue;
    }

    if (!lines[index].includes("|") || !isTableSeparator(lines[index + 1])) continue;

    const headers = splitTableRow(lines[index]);
    const context = `${currentHeading} ${headers.join(" ")}`.toLowerCase();
    if (!/compar|alternative|versus|\bvs\b|feature/.test(context)) continue;

    let rowIndex = index + 2;
    while (rowIndex < lines.length && lines[rowIndex].includes("|")) {
      const cells = splitTableRow(lines[rowIndex]);
      if (cells.length >= 2) {
        const row = {};
        headers.forEach((header, cellIndex) => {
          row[header || `Column ${cellIndex + 1}`] = cells[cellIndex] || "—";
        });
        rows.push(row);
      }
      rowIndex += 1;
    }

    index = rowIndex;
  }

  const seen = new Set();
  return rows
    .filter((row) => {
      const key = JSON.stringify(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
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
      url: normalizeUrl(toRawGithubUrl(absoluteFromGithub(image.url, repo)))
    }))
    .filter((image) => isHttpUrl(image.url));

  const logoUrls = uniqueArray(images.filter(isLikelyLogo).map((image) => image.url)).slice(0, 4);
  const screenshots = uniqueArray(images.filter((image) => isLikelyScreenshot(image) && !isLikelyLogo(image)).map((image) => image.url)).slice(0, 12);
  const badges = uniqueArray(images.filter(isBadge).map((image) => image.url));
  const links = extractLinks(markdown, repo);
  const features = sectionLines(markdown, ["feature", "features", "highlights", "why"]);
  const installationMethods = extractInstallation(markdown);
  const alternativeOf = extractAlternatives(markdown);
  const systemRequirements = extractSystemRequirements(markdown);
  const comparisonTable = extractComparisonTable(markdown);

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
    logoUrls,
    screenshots,
    badges,
    features,
    installationMethods,
    alternativeOf,
    comparisonTable,
    systemRequirements,
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
