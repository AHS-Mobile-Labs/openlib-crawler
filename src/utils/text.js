const removeMarkdown = require("remove-markdown");
const slugify = require("slugify");

function cleanText(value, maxLength = 0) {
  const text = removeMarkdown(String(value || ""))
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?:;])/g, "$1")
    .trim();
  if (!maxLength || text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function makeSlug(name, fallback = "app") {
  const slug = slugify(String(name || fallback), {
    lower: true,
    strict: true,
    trim: true
  });
  return slug || fallback;
}

function compactLines(lines) {
  return lines
    .map((line) => cleanText(line))
    .filter(Boolean)
    .filter((line, index, all) => all.indexOf(line) === index);
}

module.exports = {
  cleanText,
  makeSlug,
  compactLines
};
