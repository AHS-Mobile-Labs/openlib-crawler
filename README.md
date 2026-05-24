# OpenLib Crawler

Production-ready GitHub crawler and AI-powered enrichment system built for discovering, analyzing, moderating, and syncing open-source applications into [OpenLib](https://www.openlib.online).

Designed specifically for low-resource systems like MX Linux laptops, the crawler uses Node.js, SQLite, and local Ollama AI models to process repositories efficiently with minimal RAM and CPU usage.

---

## Features

* GitHub repository discovery and crawling
* AI-powered metadata enrichment using local LLMs
* README parsing and screenshot extraction
* Quality scoring and duplicate detection
* Moderation workflow before publishing
* Sync engine for pushing approved apps to OpenLib
* SQLite-based lightweight architecture
* Restartable worker-based processing
* Optimized for low-end hardware
* PM2 and cron support for automation

---

## Architecture

```text
GitHub API
   ↓
Crawler Workers
   ↓
Repository Filters
   ↓
README + Metadata Parser
   ↓
Screenshot Extractor
   ↓
Local AI Enrichment
   ↓
Duplicate Detection
   ↓
Quality Scoring
   ↓
Moderation Queue
   ↓
Sync Queue
   ↓
OpenLib API
```

The crawler database acts as the source of truth.
OpenLib data is updated only through authenticated sync workers.

---

## Tech Stack

* Node.js
* SQLite
* Ollama
* PM2
* GitHub REST API

---

## Project Structure

```text
openlib-crawler/
├── docs/
├── logs/
├── scripts/
├── src/
│   ├── services/
│   ├── workers/
│   ├── config.js
│   ├── db.js
│   └── server.js
├── data/
├── crawler.js
├── updater.js
├── sync.js
├── ai.js
└── ecosystem.config.js
```

### Important Components

| File / Folder         | Purpose                                                   |
| --------------------- | --------------------------------------------------------- |
| `src/config.js`       | Loads environment configuration                           |
| `src/db.js`           | Initializes SQLite database and WAL mode                  |
| `src/services/`       | Core services for crawling, AI, parsing, scoring, syncing |
| `src/workers/`        | One-shot worker jobs                                      |
| `src/server.js`       | Moderation backend API                                    |
| `docs/schema.sql`     | Reference database schema                                 |
| `ecosystem.config.js` | PM2 process configuration                                 |

---

# Installation

## Requirements

* Node.js 18+
* npm
* Git
* Ollama (optional but recommended)

---

## Setup

```bash
git clone https://github.com/AHS-Mobile-Labs/openlib-crawler.git && \
cd openlib-crawler && \
cp .env.example .env && \
npm install && \
npm run setup
```

---

## Smoke Test

```bash
npm run smoke
```

---

# Ollama Setup

Install Ollama and pull a lightweight model:

```bash
ollama pull tinyllama
```

Alternative lightweight models:

```bash
ollama pull qwen2.5:0.5b
ollama pull phi
```

Recommended settings for low-end systems:

```env
CRAWLER_CONCURRENCY=2
AI_CONCURRENCY=1
TARGET_APPS_PER_RUN=50
```

---

# Running Jobs

## Crawl Repositories

```bash
npm run crawl -- --limit 50
```

## Update Existing Apps

```bash
npm run update
```

## Run AI Enrichment

```bash
npm run ai
```

## Refresh Screenshots

```bash
npm run screenshots
```

## Sync Approved Apps

```bash
npm run sync
```

## Start Moderation API

```bash
npm run moderation
```

---

# Scheduler

Run all jobs automatically:

```bash
npm run scheduler
```

---

# PM2 Setup

Install PM2:

```bash
npm install -g pm2
```

Start workers:

```bash
pm2 start ecosystem.config.js
```

Save configuration:

```bash
pm2 save
pm2 startup
```

---

# Cron Jobs

Example cron configuration:

```cron
0 */6 * * * cd /home/Linox/openlib-crawler && /usr/bin/npm run crawl -- --limit 50
20 2 * * * cd /home/Linox/openlib-crawler && /usr/bin/npm run update
40 1 * * * cd /home/Linox/openlib-crawler && /usr/bin/npm run ai
10 3 * * 0 cd /home/Linox/openlib-crawler && /usr/bin/npm run screenshots
*/30 * * * * cd /home/Linox/openlib-crawler && /usr/bin/npm run sync
```

---

# Moderation API

## Get Pending Apps

```bash
curl -H "X-API-Key: $MODERATION_API_KEY" \
"http://127.0.0.1:3020/api/apps?status=pending&limit=20"
```

## Update App Metadata

```bash
curl -X PUT \
-H "X-API-Key: $MODERATION_API_KEY" \
-H "Content-Type: application/json" \
-d '{"category":"Developer Tools","tags":["git","developer-tools"]}' \
"http://127.0.0.1:3020/api/apps/1"
```

## Approve App

```bash
curl -X POST \
-H "X-API-Key: $MODERATION_API_KEY" \
"http://127.0.0.1:3020/api/apps/1/approve"
```

## Reject App

```bash
curl -X POST \
-H "X-API-Key: $MODERATION_API_KEY" \
-H "Content-Type: application/json" \
-d '{"reason":"not a user-facing app"}' \
"http://127.0.0.1:3020/api/apps/1/reject"
```

---

# Quality Rules

Repositories are rejected before expensive processing if they are:

* Forks
* Archived
* Disabled
* Unlicensed
* Inactive
* Below minimum star threshold
* Missing useful descriptions

Quality scoring considers:

* Stars
* Activity
* Releases
* Screenshots
* Website availability
* Organization verification
* License quality
* README quality
* Documentation
* Topic richness

Only repositories above the configured quality threshold enter moderation.

---

# Local AI Enrichment

OpenLib Crawler uses local Ollama models only.

If Ollama is unavailable, the system falls back to deterministic enrichment logic.

Supported lightweight models:

* tinyllama
* qwen2.5:0.5b
* phi
* lightweight Mistral variants

---

## Project-Local Ollama

Start local Ollama:

```bash
npm run ollama:start
```

Pull models:

```bash
npm run ollama:pull
```

Check status:

```bash
curl http://127.0.0.1:11434/api/tags
```

Run AI test:

```bash
npm run ai -- --limit 1
```

Stop Ollama:

```bash
npm run ollama:stop
```

---

# Logs & Storage

| Resource         | Location                   |
| ---------------- | -------------------------- |
| SQLite Database  | `openlib.db`               |
| Main Logs        | `logs/openlib-crawler.log` |
| PM2 Logs         | `logs/pm2-*.log`           |
| Screenshot Cache | `data/cache/screenshots`   |
| Ollama Models    | `data/ollama-models`       |

SQLite runs in WAL mode for better reliability during concurrent workers.

---

# Goals

OpenLib Crawler aims to:

* Build a scalable open-source app discovery engine
* Reduce manual app submission work
* Improve metadata quality using local AI
* Support privacy-friendly self-hosted infrastructure
* Run efficiently on low-end hardware

---

# License

MIT License

---

# OpenLib

Discover open-source alternatives and apps on:

[OpenLib Website](https://www.openlib.online)
