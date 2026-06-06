const { cleanText } = require("../utils/text");

const FORM_CATEGORIES = [
  "Communication",
  "Design",
  "Finance",
  "Media",
  "Productivity",
  "Security",
  "Utility",
  "Other"
];

const FORM_LICENSES = [
  "MIT",
  "GPL-3.0",
  "GPL-2.0",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "LGPL-3.0",
  "MPL-2.0",
  "AGPL-3.0",
  "Unlicense",
  "Other"
];

function normalizeCategory(value) {
  const raw = cleanText(value || "", 120);
  if (!raw) return "Other";

  const exact = FORM_CATEGORIES.find((category) => category.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;

  const text = raw.toLowerCase();
  if (/chat|messag|email|mail|forum|social|community|communication|conference|collaboration/.test(text)) {
    return "Communication";
  }
  if (/design|drawing|image|graphics|photo|vector|figma|illustration|ui|ux/.test(text)) return "Design";
  if (/finance|account|budget|bank|invoice|payment|money|expense|crypto|ledger/.test(text)) return "Finance";
  if (/media|video|audio|music|player|stream|podcast|photo|camera|record/.test(text)) return "Media";
  if (/productivity|note|task|todo|calendar|kanban|office|document|writing|workflow|business|education|learning|ai/.test(text)) {
    return "Productivity";
  }
  if (/security|password|auth|vpn|encrypt|privacy|firewall|malware|secret/.test(text)) return "Security";
  if (/util|tool|developer|devtool|cli|terminal|ide|code|self-host|server|docker|database|backup|sync/.test(text)) {
    return "Utility";
  }

  return "Other";
}

function normalizeLicense(value) {
  const raw = cleanText(value || "", 120);
  if (!raw || /^(unknown|noassertion|none|null)$/i.test(raw)) return "Other";

  const exact = FORM_LICENSES.find((license) => license.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;

  const text = raw.toLowerCase();
  if (/\bmit\b/.test(text)) return "MIT";
  if (/apache( license)? v?2|apache-?2/.test(text)) return "Apache-2.0";
  if (/agpl[- ]?3|affero.*3/.test(text)) return "AGPL-3.0";
  if (/lgpl[- ]?3|lesser.*3/.test(text)) return "LGPL-3.0";
  if (/gpl[- ]?3|general public license.*3/.test(text)) return "GPL-3.0";
  if (/gpl[- ]?2|general public license.*2/.test(text)) return "GPL-2.0";
  if (/bsd[- ]?2|bsd 2|2-clause/.test(text)) return "BSD-2-Clause";
  if (/bsd[- ]?3|bsd 3|3-clause/.test(text)) return "BSD-3-Clause";
  if (/mpl[- ]?2|mozilla public license.*2/.test(text)) return "MPL-2.0";
  if (/unlicense/.test(text)) return "Unlicense";

  return "Other";
}

function normalizeMaintainerType(value) {
  const text = cleanText(value || "", 80).toLowerCase();
  if (text === "organization" || text === "org") return "Organization";
  if (text === "individual" || text === "user" || text === "person") return "Individual";
  return "Individual";
}

function isOpenSourceVerified(rawLicense) {
  const raw = cleanText(rawLicense || "", 120);
  return Boolean(raw && !/^(unknown|noassertion|none|null)$/i.test(raw));
}

module.exports = {
  FORM_CATEGORIES,
  FORM_LICENSES,
  normalizeCategory,
  normalizeLicense,
  normalizeMaintainerType,
  isOpenSourceVerified
};
