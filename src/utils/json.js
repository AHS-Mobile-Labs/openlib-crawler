function stringifyJson(value, fallback = null) {
  try {
    return JSON.stringify(value ?? fallback);
  } catch (_err) {
    return JSON.stringify(fallback);
  }
}

function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (Array.isArray(value) || typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (_err) {
    return fallback;
  }
}

function uniqueArray(items) {
  return [...new Set((items || []).map((item) => String(item).trim()).filter(Boolean))];
}

module.exports = {
  stringifyJson,
  parseJson,
  uniqueArray
};
