use crate::error::{ControlError, Result};
use crate::models::ConfigEntry;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Clone, Debug)]
pub struct ControlConfig {
    pub root_dir: PathBuf,
    pub db_path: PathBuf,
    pub data_dir: PathBuf,
    pub log_dir: PathBuf,
    pub env_path: PathBuf,
    pub github: GithubConfig,
    pub ai: AiConfig,
    pub sync: SyncConfig,
    pub crawler: CrawlerConfig,
    pub updater: UpdaterConfig,
    pub screenshots: ScreenshotConfig,
    pub moderation: ModerationConfig,
    pub refresh_interval: Duration,
}

#[derive(Clone, Debug)]
pub struct GithubConfig {
    pub token: String,
    pub user_agent: String,
    pub api_base_url: String,
    pub per_page: u32,
    pub max_pages_per_query: u32,
}

#[derive(Clone, Debug)]
pub struct AiConfig {
    pub enabled: bool,
    pub base_url: String,
    pub model: String,
    pub timeout: Duration,
    pub concurrency: u32,
    pub interval: Duration,
}

#[derive(Clone, Debug)]
pub struct SyncConfig {
    pub api_base_url: String,
    pub api_key: String,
    pub concurrency: u32,
    pub batch_size: u32,
}

#[derive(Clone, Debug)]
pub struct CrawlerConfig {
    pub target_apps_per_run: u32,
    pub concurrency: u32,
    pub min_quality_score: u32,
    pub interval: Duration,
}

#[derive(Clone, Debug)]
pub struct UpdaterConfig {
    pub batch_size: u32,
    pub interval: Duration,
}

#[derive(Clone, Debug)]
pub struct ScreenshotConfig {
    pub enabled: bool,
    pub concurrency: u32,
    pub refresh_interval: Duration,
}

#[derive(Clone, Debug)]
pub struct ModerationConfig {
    pub host: String,
    pub port: u16,
    pub api_key: String,
}

impl ControlConfig {
    pub fn load() -> Result<Self> {
        let root_dir = detect_root_dir(env::current_dir()?);
        let env_path = root_dir.join(".env");
        if env_path.exists() {
            dotenvy::from_path(&env_path).map_err(|err| ControlError::Env(err.to_string()))?;
        }

        let db_path = resolve_path(&root_dir, &env_or("DB_PATH", "openlib.db"));
        let data_dir = resolve_path(&root_dir, &env_or("DATA_DIR", "data"));
        let log_dir = resolve_path(&root_dir, &env_or("LOG_DIR", "logs"));

        Ok(Self {
            root_dir,
            db_path,
            data_dir,
            log_dir,
            env_path,
            github: GithubConfig {
                token: env_or("GITHUB_TOKEN", ""),
                user_agent: env_or("GITHUB_USER_AGENT", "openlib-crawler"),
                api_base_url: env_or("GITHUB_API_BASE_URL", "https://api.github.com"),
                per_page: env_u32("GITHUB_PER_PAGE", 30),
                max_pages_per_query: env_u32("GITHUB_MAX_PAGES_PER_QUERY", 3),
            },
            ai: AiConfig {
                enabled: env_bool("AI_ENABLED", true),
                base_url: env_or("OLLAMA_BASE_URL", "http://127.0.0.1:11434"),
                model: env_or("OLLAMA_MODEL", "tinyllama"),
                timeout: Duration::from_millis(env_u64("OLLAMA_TIMEOUT_MS", 120_000)),
                concurrency: env_u32("AI_CONCURRENCY", 1),
                interval: Duration::from_millis(env_u64("AI_INTERVAL_MS", 24 * 60 * 60 * 1000)),
            },
            sync: SyncConfig {
                api_base_url: env_or("OPENLIB_API_URL", ""),
                api_key: env_or("OPENLIB_API_KEY", ""),
                concurrency: env_u32("SYNC_CONCURRENCY", 1),
                batch_size: env_u32("SYNC_BATCH_SIZE", 25),
            },
            crawler: CrawlerConfig {
                target_apps_per_run: env_u32("TARGET_APPS_PER_RUN", 50),
                concurrency: env_u32("CRAWLER_CONCURRENCY", 2),
                min_quality_score: env_u32("MIN_QUALITY_SCORE", 70),
                interval: Duration::from_millis(env_u64("CRAWLER_INTERVAL_MS", 6 * 60 * 60 * 1000)),
            },
            updater: UpdaterConfig {
                batch_size: env_u32("UPDATER_BATCH_SIZE", 40),
                interval: Duration::from_millis(env_u64("UPDATER_INTERVAL_MS", 24 * 60 * 60 * 1000)),
            },
            screenshots: ScreenshotConfig {
                enabled: env_bool("SCREENSHOTS_ENABLED", true),
                concurrency: env_u32("SCREENSHOT_CONCURRENCY", 2),
                refresh_interval: Duration::from_millis(env_u64(
                    "SCREENSHOT_REFRESH_INTERVAL_MS",
                    7 * 24 * 60 * 60 * 1000,
                )),
            },
            moderation: ModerationConfig {
                host: env_or("MODERATION_HOST", "127.0.0.1"),
                port: env_u32("MODERATION_PORT", 3020) as u16,
                api_key: env_or("MODERATION_API_KEY", ""),
            },
            refresh_interval: Duration::from_millis(env_u64("CONTROL_PANEL_REFRESH_MS", 2_000)),
        })
    }

    pub fn editable_entries(&self) -> Vec<ConfigEntry> {
        vec![
            entry("DB_PATH", self.db_path.display().to_string(), false, "SQLite database path"),
            entry("LOG_DIR", self.log_dir.display().to_string(), false, "Crawler log directory"),
            entry("GITHUB_TOKEN", self.github.token.clone(), true, "GitHub API token"),
            entry("GITHUB_USER_AGENT", self.github.user_agent.clone(), false, "GitHub API user agent"),
            entry("TARGET_APPS_PER_RUN", self.crawler.target_apps_per_run.to_string(), false, "Crawler batch target"),
            entry("CRAWLER_CONCURRENCY", self.crawler.concurrency.to_string(), false, "Crawler worker concurrency"),
            entry("MIN_QUALITY_SCORE", self.crawler.min_quality_score.to_string(), false, "Moderation threshold"),
            entry("AI_ENABLED", self.ai.enabled.to_string(), false, "Enable Ollama enrichment"),
            entry("OLLAMA_BASE_URL", self.ai.base_url.clone(), false, "Ollama API base URL"),
            entry("OLLAMA_MODEL", self.ai.model.clone(), false, "Default enrichment model"),
            entry("AI_CONCURRENCY", self.ai.concurrency.to_string(), false, "AI worker concurrency"),
            entry("OPENLIB_API_URL", self.sync.api_base_url.clone(), false, "OpenLib sync API URL"),
            entry("OPENLIB_API_KEY", self.sync.api_key.clone(), true, "OpenLib sync API key"),
            entry("SYNC_BATCH_SIZE", self.sync.batch_size.to_string(), false, "Sync batch size"),
            entry("SYNC_CONCURRENCY", self.sync.concurrency.to_string(), false, "Sync worker concurrency"),
            entry("MODERATION_HOST", self.moderation.host.clone(), false, "Moderation API bind host"),
            entry("MODERATION_PORT", self.moderation.port.to_string(), false, "Moderation API port"),
            entry("MODERATION_API_KEY", self.moderation.api_key.clone(), true, "Moderation API key"),
        ]
    }
}

pub fn write_env_value(path: &Path, key: &str, value: &str) -> Result<()> {
    let mut found = false;
    let mut lines = if path.exists() {
        fs::read_to_string(path)?
            .lines()
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    for line in &mut lines {
        let trimmed = line.trim_start();
        if trimmed.starts_with('#') || !trimmed.contains('=') {
            continue;
        }

        let existing_key = trimmed.split_once('=').map(|(left, _)| left.trim()).unwrap_or("");
        if existing_key == key {
            *line = format!("{key}={}", serialize_env_value(value));
            found = true;
            break;
        }
    }

    if !found {
        lines.push(format!("{key}={}", serialize_env_value(value)));
    }

    let tmp_path = path.with_extension("env.tmp");
    fs::write(&tmp_path, format!("{}\n", lines.join("\n")))?;
    fs::rename(tmp_path, path)?;
    Ok(())
}

fn entry(key: &str, value: String, secret: bool, description: &str) -> ConfigEntry {
    ConfigEntry {
        key: key.to_string(),
        value,
        secret,
        description: description.to_string(),
    }
}

fn resolve_path(root: &Path, raw: &str) -> PathBuf {
    let path = PathBuf::from(raw);
    if path.is_absolute() {
        path
    } else {
        root.join(path)
    }
}

fn detect_root_dir(current_dir: PathBuf) -> PathBuf {
    if current_dir.join("package.json").exists() && current_dir.join("docs/schema.sql").exists() {
        return current_dir;
    }

    if let Some(parent) = current_dir.parent() {
        if parent.join("package.json").exists() && parent.join("docs/schema.sql").exists() {
            return parent.to_path_buf();
        }
    }

    current_dir
}

fn env_or(name: &str, fallback: &str) -> String {
    env::var(name).unwrap_or_else(|_| fallback.to_string())
}

fn env_u32(name: &str, fallback: u32) -> u32 {
    env::var(name)
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(fallback)
}

fn env_u64(name: &str, fallback: u64) -> u64 {
    env::var(name)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(fallback)
}

fn env_bool(name: &str, fallback: bool) -> bool {
    env::var(name)
        .ok()
        .map(|value| matches!(value.to_lowercase().as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(fallback)
}

fn serialize_env_value(value: &str) -> String {
    if value.contains('\n') || value.contains('#') || value.trim() != value {
        format!("{value:?}")
    } else {
        value.to_string()
    }
}
