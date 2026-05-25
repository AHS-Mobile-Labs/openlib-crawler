# OpenLib Control Panel

Rust terminal control center for OpenLib Crawler. It is built with Tokio, Ratatui, Crossterm, rusqlite, Reqwest, Serde, Tracing, and Chrono.

The panel is additive: it reads the existing `openlib.db`, `.env`, and `logs/` files, and it can start the existing crawler jobs while the Rust service layer becomes the long-term home for native workers.

## Run

```bash
cargo run --manifest-path control-panel/Cargo.toml
```

From the repository root you can also run:

```bash
npm run control
```

## Controls

| Key | Action |
| --- | --- |
| `Tab`, `l` | Next screen |
| `Shift+Tab`, `h` | Previous screen |
| `j/k`, arrows | Move selection |
| `/` | Search/filter |
| `Esc` | Clear search or cancel edit |
| `r` | Refresh immediately |
| `t` | Toggle dark/light theme |
| `s` | Start selected worker |
| `x` | Stop selected worker |
| `R` | Restart selected worker |
| `m` | Manually trigger selected scheduler job |
| `p` | Pause/resume selected scheduler job |
| `a` | Approve selected repository |
| `d` | Reject selected repository |
| `n/e/y/u` | Edit repository name/description/category/license |
| `Enter` | Edit selected config value |
| `[` / `]` | Switch log source tab |
| `o` | Export filtered logs |
| `q` | Quit |

Mouse support is enabled for sidebar selection and scrolling.

## Architecture

```text
main.rs
  -> app.rs                async event loop and state machine
  -> tui/                  Ratatui layout and rendering
  -> db.rs                 SQLite snapshot and moderation mutations
  -> services/
       github.rs           GitHub rate-limit telemetry
       ollama.rs           Ollama status and model inventory
       system.rs           CPU/RAM/disk/network telemetry
       logs.rs             log tailing and JSON parsing
       workers.rs          non-blocking process control
       scheduler.rs        cron-like job metadata
  -> config.rs             .env loading and safe writes
  -> models.rs             shared state models
```

The UI refreshes local state frequently and network state conservatively. Database reads run on blocking worker threads so terminal rendering stays responsive. Worker commands are started through a registry, which keeps the future native Rust worker system separate from the panels that control it.

## Low-End Linux Notes

The render loop targets a modest cadence, SQLite uses WAL/busy-timeout pragmas, logs are tailed with bounded buffers, and GitHub/Ollama checks are cached between refreshes. The goal is to feel live without burning CPU on MX Linux laptops.
