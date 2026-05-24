const crypto = require("crypto");
const axios = require("axios");
const config = require("../config");
const logger = require("../logger");
const { nowIso } = require("../utils/time");
const { stringifyJson, parseJson, uniqueArray } = require("../utils/json");
const { cleanText } = require("../utils/text");
const { detectCategory } = require("./repositoryMapper");

function inputHash(app) {
  return crypto
    .createHash("sha256")
    .update(`${app.name}|${app.short_description}|${app.readme_text}|${app.topics}`)
    .digest("hex");
}

function extractJson(text) {
  const raw = String(text || "").trim();
  try {
    return JSON.parse(raw);
  } catch (_err) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch (_err2) {
      return null;
    }
  }
}

function fallbackEnrichment(app) {
  const topics = parseJson(app.topics, []);
  const keyFeatures = parseJson(app.key_features, []);
  const platforms = parseJson(app.supported_platforms, []);
  const tags = uniqueArray([...(parseJson(app.tags, []) || []), ...topics, app.language].filter(Boolean)).slice(0, 12);
  const description = cleanText(app.short_description || app.full_description || app.readme_text || "", 180);

  return {
    category: app.category || detectCategory({ topics, language: app.language, description: app.short_description }, {}),
    short_description: description,
    full_description: cleanText(app.full_description || app.readme_text || description, 1800),
    uses: cleanText(`Helps users solve ${description || app.name}.`, 300),
    alternative_of: [],
    tags,
    key_features: keyFeatures.slice(0, 8),
    comparison_table: [],
    supported_platforms: platforms,
    installation_methods: parseJson(app.installation_methods, []),
    system_requirements: []
  };
}

function buildPrompt(app) {
  const payload = {
    name: app.name,
    github: app.github_full_name,
    stars: app.stars,
    license: app.license,
    language: app.language,
    topics: parseJson(app.topics, []),
    existing_description: app.short_description,
    readme: cleanText(app.readme_text || "", config.ai.maxInputChars)
  };

  return `You enrich app metadata for OpenLib, a catalog of high-quality open-source applications.
Return compact valid JSON only. No markdown.

Required JSON keys:
category: short category name
short_description: one sentence under 160 characters
full_description: 1-2 clear paragraphs under 900 characters
uses: what problem the app solves, under 350 characters
alternative_of: array of comparable proprietary or open-source apps
tags: 5-12 lowercase tags
key_features: 4-8 short feature strings
comparison_table: array of up to 5 objects with keys "feature", "this_app", "alternatives"
supported_platforms: array
installation_methods: array
system_requirements: array

Prefer factual claims grounded in the README. Do not invent pricing or unsupported platforms.

Input:
${JSON.stringify(payload)}`;
}

async function callOllama(prompt) {
  const response = await axios.post(
    `${config.ai.baseUrl.replace(/\/+$/, "")}/api/generate`,
    {
      model: config.ai.model,
      prompt,
      stream: false,
      options: {
        temperature: 0.2,
        num_ctx: 4096,
        num_predict: 900
      }
    },
    {
      timeout: config.ai.timeoutMs,
      headers: { "Content-Type": "application/json" }
    }
  );
  return response.data?.response || "";
}

function normalizeEnrichment(app, data) {
  const fallback = fallbackEnrichment(app);
  const source = data && typeof data === "object" ? data : fallback;

  return {
    category: cleanText(source.category || fallback.category, 80),
    short_description: cleanText(source.short_description || fallback.short_description, 180),
    full_description: cleanText(source.full_description || fallback.full_description, 1800),
    uses: cleanText(source.uses || fallback.uses, 350),
    alternative_of: stringifyJson(uniqueArray(source.alternative_of || fallback.alternative_of).slice(0, 8)),
    tags: stringifyJson(uniqueArray(source.tags || fallback.tags).slice(0, 16)),
    key_features: stringifyJson(uniqueArray(source.key_features || fallback.key_features).slice(0, 8)),
    comparison_table: stringifyJson(Array.isArray(source.comparison_table) ? source.comparison_table.slice(0, 5) : []),
    supported_platforms: stringifyJson(uniqueArray(source.supported_platforms || fallback.supported_platforms).slice(0, 10)),
    installation_methods: stringifyJson(uniqueArray(source.installation_methods || fallback.installation_methods).slice(0, 8)),
    system_requirements: stringifyJson(uniqueArray(source.system_requirements || fallback.system_requirements).slice(0, 8))
  };
}

async function enrichApp(db, app, job = null) {
  const hash = inputHash(app);
  let output = null;
  let parsed = null;

  if (config.ai.enabled) {
    try {
      output = await callOllama(buildPrompt(app));
      parsed = extractJson(output);
    } catch (err) {
      logger.warn("ollama enrichment failed, using fallback", { appId: app.id, error: err.message });
      if (job) {
        await db.run(
          "UPDATE ai_jobs SET attempts = attempts + 1, last_error = ?, updated_at = ? WHERE id = ?",
          [err.message, nowIso(), job.id]
        );
      }
    }
  }

  const enrichment = normalizeEnrichment(app, parsed);
  const now = nowIso();
  await db.run(
    `UPDATE apps SET
      category = ?,
      short_description = ?,
      full_description = ?,
      uses = ?,
      alternative_of = ?,
      tags = ?,
      key_features = ?,
      comparison_table = ?,
      supported_platforms = ?,
      installation_methods = ?,
      system_requirements = ?,
      last_ai_at = ?,
      updated_at = ?
     WHERE id = ?`,
    [
      enrichment.category,
      enrichment.short_description,
      enrichment.full_description,
      enrichment.uses,
      enrichment.alternative_of,
      enrichment.tags,
      enrichment.key_features,
      enrichment.comparison_table,
      enrichment.supported_platforms,
      enrichment.installation_methods,
      enrichment.system_requirements,
      now,
      now,
      app.id
    ]
  );

  if (job) {
    await db.run(
      `UPDATE ai_jobs SET status = 'completed', model = ?, input_hash = ?, output = ?, updated_at = ?, completed_at = ?
       WHERE id = ?`,
      [config.ai.model, hash, output || stringifyJson(enrichment), now, now, job.id]
    );
  }

  return enrichment;
}

module.exports = {
  enrichApp,
  fallbackEnrichment,
  buildPrompt
};
