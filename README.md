# OpenLib Crawler

Production-oriented GitHub open-source app discovery, enrichment, moderation, and sync service for OpenLib. It is built for MX Linux and low-power laptops: Node.js, SQLite, local Ollama AI, small worker batches, low concurrency, and restartable one-shot jobs.

## Architecture

GitHub REST API -> crawler -> filters -> README parser -> screenshot extractor -> local AI enrichment -> duplicate detection -> scoring engine -> moderation queue -> sync queue -> OpenLib API.

The crawler database is the source of truth for discovery and moderation. Production OpenLib data is changed only through the sync queue and authenticated OpenLib API calls.

## Project Structure

- `src/config.js` loads low-resource defaults from `.env`.
- `src/db.js` initializes SQLite, migrates older prototype tables, and enables WAL mode.
- `src/services/` contains GitHub, README parsing, screenshots, AI, scoring, duplicates, app storage, and OpenLib sync services.
- `src/workers/` contains one-shot crawl, update, AI, screenshot, and sync workers.
- `src/server.js` is the moderation backend API.
- `scripts/setup-db.js` creates or migrates the database.
- `docs/schema.sql` is the reference schema.
- `ecosystem.config.js` runs the system with PM2 cron-style worker separation.

## Setup on MX Linux

```bash
cp .env.example .env
npm install
npm run setup
npm run smoke
```

Install Ollama and pull a small model:

```bash
ollama pull tinyllama
# or: ollama pull qwen2.5:0.5b
# or: ollama pull phi
```

For an 8GB dual-core laptop, keep `CRAWLER_CONCURRENCY=2`, `AI_CONCURRENCY=1`, and `TARGET_APPS_PER_RUN=50`.

## Running Jobs

```bash
npm run crawl -- --limit 50
npm run update
npm run ai
npm run screenshots
npm run sync
npm run moderation
```

The scheduler is available if you prefer one long-running process:

```bash
npm run scheduler
```

## PM2

```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

The PM2 config separates workers:

- crawler every 6 hours
- updater daily at 02:20
- AI enrichment nightly at 01:40
- screenshot refresh weekly
- sync every 30 minutes
- moderation backend always on

## Cron Alternative

```cron
0 */6 * * * cd /home/Linox/openlib-crawler && /usr/bin/npm run crawl -- --limit 50
20 2 * * * cd /home/Linox/openlib-crawler && /usr/bin/npm run update
40 1 * * * cd /home/Linox/openlib-crawler && /usr/bin/npm run ai
10 3 * * 0 cd /home/Linox/openlib-crawler && /usr/bin/npm run screenshots
*/30 * * * * cd /home/Linox/openlib-crawler && /usr/bin/npm run sync
```

## Moderation API

Start it:

```bash
npm run moderation
```

Examples:

```bash
curl -H "X-API-Key: $MODERATION_API_KEY" \
  "http://127.0.0.1:3020/api/apps?status=pending&limit=20"

curl -X PUT -H "X-API-Key: $MODERATION_API_KEY" -H "Content-Type: application/json" \
  -d '{"category":"Developer Tools","tags":["git","developer-tools"]}' \
  "http://127.0.0.1:3020/api/apps/1"

curl -X POST -H "X-API-Key: $MODERATION_API_KEY" \
  "http://127.0.0.1:3020/api/apps/1/approve"

curl -X POST -H "X-API-Key: $MODERATION_API_KEY" -H "Content-Type: application/json" \
  -d '{"reason":"not a user-facing app"}' \
  "http://127.0.0.1:3020/api/apps/1/reject"
```

## OpenLib Sync API Contract

The sync worker uses API key auth with both `Authorization: Bearer <key>` and `X-API-Key`.

- `POST /apps` creates an approved app.
- `POST /apps/:id` updates a published app.
- `POST /apps/:id/delete` deletes or unpublishes a dead app.

Failed syncs remain in `sync_queue` with exponential retry metadata.

## Quality Rules

Repos are rejected before expensive work if they are forks, archived, disabled, unlicensed, inactive, below the star threshold, or missing a useful description.

Quality score includes stars, recent activity, releases, screenshots, website, verified organization, license, README quality, docs quality, and topic/tag richness. Only apps above `MIN_QUALITY_SCORE` enter moderation.

## Local AI

AI enrichment uses Ollama only. The worker sends compact JSON prompts and falls back to deterministic local enrichment if Ollama is offline. Use tiny models on the target laptop:

- `tinyllama`
- `qwen2.5:0.5b`
- `phi`
- small Mistral variants if memory allows

If system-wide Ollama install needs a sudo password, this repo can run a project-local Ollama binary:

```bash
npm run ollama:start
npm run ollama:pull
curl http://127.0.0.1:11434/api/tags
npm run ai -- --limit 1
```

Project-local files are kept out of git:

- binary bundle: `vendor/ollama`
- model cache: `data/ollama-models`
- Ollama log: `logs/ollama.log`

Stop it with:

```bash
npm run ollama:stop
```

## Logs and Data

- SQLite: `openlib.db`
- Main logs: `logs/openlib-crawler.log`
- PM2 logs: `logs/pm2-*.log`
- Screenshot cache: `data/cache/screenshots`

The database runs in WAL mode for better reliability during worker overlap.
