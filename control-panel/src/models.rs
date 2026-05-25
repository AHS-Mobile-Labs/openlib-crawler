use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ThemeMode {
    Dark,
    Light,
}

impl ThemeMode {
    pub fn toggle(self) -> Self {
        match self {
            Self::Dark => Self::Light,
            Self::Light => Self::Dark,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum Screen {
    Dashboard,
    Workers,
    Ai,
    Repositories,
    Queue,
    Logs,
    Scheduler,
    Sync,
    System,
    Config,
    Plugins,
}

impl Screen {
    pub const ALL: [Screen; 11] = [
        Screen::Dashboard,
        Screen::Workers,
        Screen::Ai,
        Screen::Repositories,
        Screen::Queue,
        Screen::Logs,
        Screen::Scheduler,
        Screen::Sync,
        Screen::System,
        Screen::Config,
        Screen::Plugins,
    ];

    pub fn title(self) -> &'static str {
        match self {
            Screen::Dashboard => "Dashboard",
            Screen::Workers => "Workers",
            Screen::Ai => "AI",
            Screen::Repositories => "Repositories",
            Screen::Queue => "Queues",
            Screen::Logs => "Logs",
            Screen::Scheduler => "Scheduler",
            Screen::Sync => "Sync",
            Screen::System => "System",
            Screen::Config => "Config",
            Screen::Plugins => "Plugins",
        }
    }

    pub fn icon(self) -> &'static str {
        match self {
            Screen::Dashboard => "D",
            Screen::Workers => "W",
            Screen::Ai => "A",
            Screen::Repositories => "R",
            Screen::Queue => "Q",
            Screen::Logs => "L",
            Screen::Scheduler => "S",
            Screen::Sync => "Y",
            Screen::System => "M",
            Screen::Config => "C",
            Screen::Plugins => "P",
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct DashboardStats {
    pub total_repositories: i64,
    pub pending_moderation: i64,
    pub approved_apps: i64,
    pub failed_jobs: i64,
    pub active_workers: usize,
    pub throughput_hour: i64,
    pub accepted_hour: i64,
    pub last_crawl_at: Option<String>,
    pub db_size_bytes: u64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct QueueStats {
    pub ai_pending: i64,
    pub ai_processing: i64,
    pub ai_failed: i64,
    pub sync_pending: i64,
    pub sync_failed: i64,
    pub sync_completed: i64,
    pub update_pending: i64,
    pub screenshot_pending: i64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct GithubRateLimit {
    pub online: bool,
    pub limit: i64,
    pub remaining: i64,
    pub reset_at: Option<String>,
    pub used: i64,
    pub source: String,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct OpenlibStatus {
    pub configured: bool,
    pub online: bool,
    pub status_code: Option<u16>,
    pub latency_ms: Option<u128>,
    pub checked_at: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct OllamaModel {
    pub name: String,
    pub size_bytes: Option<u64>,
    pub modified_at: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct OllamaStatus {
    pub online: bool,
    pub base_url: String,
    pub selected_model: String,
    pub models: Vec<OllamaModel>,
    pub process_running: bool,
    pub pid: Option<u32>,
    pub latency_ms: Option<u128>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct DiskStats {
    pub mount: String,
    pub total_bytes: u64,
    pub available_bytes: u64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct NetworkStats {
    pub rx_bytes: u64,
    pub tx_bytes: u64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct SystemStats {
    pub cpu_percent: f32,
    pub memory_used_bytes: u64,
    pub memory_total_bytes: u64,
    pub swap_used_bytes: u64,
    pub swap_total_bytes: u64,
    pub load_one: f64,
    pub load_five: f64,
    pub load_fifteen: f64,
    pub disks: Vec<DiskStats>,
    pub network: NetworkStats,
    pub db_size_bytes: u64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct RepositoryRow {
    pub id: i64,
    pub full_name: String,
    pub name: String,
    pub status: String,
    pub quality_score: i64,
    pub license: String,
    pub category: String,
    pub language: String,
    pub stars: i64,
    pub screenshot_count: i64,
    pub updated_at: Option<String>,
    pub last_crawled_at: Option<String>,
    pub last_ai_at: Option<String>,
    pub last_synced_at: Option<String>,
    pub short_description: String,
    pub readme_preview: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ActivityItem {
    pub at: String,
    pub status: String,
    pub repo: String,
    pub message: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct QueueItem {
    pub id: i64,
    pub queue: String,
    pub app_id: Option<i64>,
    pub action: String,
    pub status: String,
    pub attempts: i64,
    pub last_error: String,
    pub updated_at: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct LogLine {
    pub at: String,
    pub source: String,
    pub level: String,
    pub message: String,
    pub raw: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ConfigEntry {
    pub key: String,
    pub value: String,
    pub secret: bool,
    pub description: String,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
pub enum WorkerKind {
    Crawler,
    Updater,
    Ai,
    Screenshots,
    Sync,
    Scheduler,
    Moderation,
    Ollama,
}

impl WorkerKind {
    pub const ALL: [WorkerKind; 8] = [
        WorkerKind::Crawler,
        WorkerKind::Updater,
        WorkerKind::Ai,
        WorkerKind::Screenshots,
        WorkerKind::Sync,
        WorkerKind::Scheduler,
        WorkerKind::Moderation,
        WorkerKind::Ollama,
    ];

    pub fn label(self) -> &'static str {
        match self {
            WorkerKind::Crawler => "crawler",
            WorkerKind::Updater => "updater",
            WorkerKind::Ai => "ai",
            WorkerKind::Screenshots => "screenshots",
            WorkerKind::Sync => "sync",
            WorkerKind::Scheduler => "scheduler",
            WorkerKind::Moderation => "moderation",
            WorkerKind::Ollama => "ollama",
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct WorkerState {
    pub kind: WorkerKind,
    pub running: bool,
    pub pid: Option<u32>,
    pub health: String,
    pub command: String,
    pub started_at: Option<String>,
    pub last_exit: Option<String>,
    pub last_error: Option<String>,
    pub restarts: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SchedulerJob {
    pub name: String,
    pub worker: WorkerKind,
    pub interval: Duration,
    pub enabled: bool,
    pub running: bool,
    pub last_run: Option<String>,
    pub next_run: Option<String>,
    pub status: String,
}

impl Default for SchedulerJob {
    fn default() -> Self {
        Self {
            name: String::new(),
            worker: WorkerKind::Crawler,
            interval: Duration::from_secs(0),
            enabled: false,
            running: false,
            last_run: None,
            next_run: None,
            status: String::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Snapshot {
    pub refreshed_at: DateTime<Utc>,
    pub dashboard: DashboardStats,
    pub queues: QueueStats,
    pub github: GithubRateLimit,
    pub openlib: OpenlibStatus,
    pub ollama: OllamaStatus,
    pub system: SystemStats,
    pub repositories: Vec<RepositoryRow>,
    pub activity: Vec<ActivityItem>,
    pub queue_items: Vec<QueueItem>,
    pub logs: Vec<LogLine>,
    pub workers: Vec<WorkerState>,
    pub schedules: Vec<SchedulerJob>,
}

impl Default for Snapshot {
    fn default() -> Self {
        Self {
            refreshed_at: Utc::now(),
            dashboard: DashboardStats::default(),
            queues: QueueStats::default(),
            github: GithubRateLimit::default(),
            openlib: OpenlibStatus::default(),
            ollama: OllamaStatus::default(),
            system: SystemStats::default(),
            repositories: Vec::new(),
            activity: Vec::new(),
            queue_items: Vec::new(),
            logs: Vec::new(),
            workers: Vec::new(),
            schedules: Vec::new(),
        }
    }
}

impl Default for WorkerKind {
    fn default() -> Self {
        Self::Crawler
    }
}
