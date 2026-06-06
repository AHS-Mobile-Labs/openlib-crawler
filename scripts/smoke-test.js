const assert = require("assert");
const { db, initializeDatabase } = require("../src/db");
const { parseReadme } = require("../src/services/readmeParser");
const { calculateQualityScore } = require("../src/services/scoringService");
const { mapRepositoryToApp } = require("../src/services/repositoryMapper");

async function main() {
  await initializeDatabase(db);

  const tables = await db.all("SELECT name FROM sqlite_master WHERE type = 'table'");
  const names = new Set(tables.map((table) => table.name));
  for (const table of ["apps", "sync_queue", "screenshots", "crawl_logs", "ai_jobs", "update_jobs"]) {
    assert(names.has(table), `missing table ${table}`);
  }

  const readme = `
# Demo App

![Screenshot](docs/screenshot.png)
![Logo](docs/logo.png)

## Features
- Fast local search
- Linux desktop support

An open-source alternative to Example Cloud.

## Installation
\`\`\`bash
npm install
\`\`\`

## System Requirements
- RAM: 2 GB minimum
- Storage: 200 MB

## Comparison
| Feature | Demo App | Example Cloud |
| --- | --- | --- |
| Offline mode | ✔ | ✖ |

[Docs](https://example.com/docs)
`;

  const parsed = parseReadme(readme, {
    owner: "openlib",
    name: "demo",
    default_branch: "main",
    topics: ["linux-app"]
  });

  assert(parsed.screenshots.length === 1, "README screenshot extraction failed");
  assert(parsed.logoUrls.length === 1, "README logo extraction failed");
  assert(parsed.features.length === 2, "README feature extraction failed");
  assert(parsed.installationMethods.length === 1, "README installation extraction failed");
  assert(parsed.installationMethods[0].startsWith("npm |"), "README installation label formatting failed");
  assert(parsed.alternativeOf[0] === "Example Cloud", "README alternative extraction failed");
  assert(parsed.systemRequirements.length === 2, "README requirements extraction failed");
  assert(parsed.comparisonTable.length === 1, "README comparison table extraction failed");

  const app = mapRepositoryToApp(
    {
      id: 1,
      full_name: "openlib/demo",
      name: "demo",
      html_url: "https://github.com/openlib/demo",
      description: "A demo app",
      stargazers_count: 1000,
      forks_count: 10,
      watchers_count: 10,
      open_issues_count: 1,
      fork: false,
      archived: false,
      disabled: false,
      language: "JavaScript",
      topics: ["linux-app"],
      default_branch: "main",
      pushed_at: new Date().toISOString(),
      license: { spdx_id: "MIT" },
      owner: { login: "openlib", type: "Organization", html_url: "https://github.com/openlib" }
    },
    parsed,
    { tag_name: "v1.0.0", html_url: "https://github.com/openlib/demo/releases/tag/v1.0.0" }
  );

  const score = calculateQualityScore(app, parsed);
  assert(app.category === "Utility", "category normalization failed");
  assert(app.license === "MIT", "license normalization failed");
  assert(app.maintainer_type === "Organization", "maintainer type normalization failed");
  assert(app.logo_url.includes("/docs/logo.png"), "logo mapping failed");
  assert(app.readme_raw_url.endsWith("/openlib/demo/main/README.md"), "README raw URL fallback failed");
  assert(score > 50, "quality score unexpectedly low");

  await db.close();
  console.log("Smoke test passed.");
}

main().catch(async (err) => {
  console.error(err.stack || err.message);
  await db.close();
  process.exit(1);
});
