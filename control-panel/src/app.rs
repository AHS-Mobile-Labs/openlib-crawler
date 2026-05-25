use crate::config::{write_env_value, ControlConfig};
use crate::db::Database;
use crate::error::Result;
use crate::events::{poll_events, InputEvent};
use crate::models::{ConfigEntry, Screen, Snapshot, ThemeMode, WorkerKind};
use crate::services::github::GithubService;
use crate::services::logs::LogService;
use crate::services::ollama::OllamaService;
use crate::services::openlib::OpenlibService;
use crate::services::scheduler::SchedulerService;
use crate::services::system::SystemService;
use crate::services::workers::WorkerService;
use crate::tui::TuiTerminal;
use chrono::{Duration as ChronoDuration, Utc};
use crossterm::event::{
    KeyCode, KeyEvent, KeyEventKind, KeyModifiers, MouseButton, MouseEvent, MouseEventKind,
};
use std::cmp::min;
use std::collections::HashSet;
use std::fs;
use std::sync::Arc;
use std::time::{Duration, Instant};

const LOG_TABS: [&str; 6] = ["all", "crawler", "ai", "sync", "system", "ollama"];

pub async fn run(terminal: &mut TuiTerminal, config: Arc<ControlConfig>, db: Database) -> Result<()> {
    let mut app = App::new(config, db);
    app.refresh(true).await;

    let mut render_tick = tokio::time::interval(Duration::from_millis(125));
    let mut refresh_tick = tokio::time::interval(app.config.refresh_interval);
    let mut spinner_tick = tokio::time::interval(Duration::from_millis(180));
    let mut shutdown = Box::pin(tokio::signal::ctrl_c());

    loop {
        tokio::select! {
            _ = render_tick.tick() => {
                for event in poll_events()? {
                    app.handle_event(event).await?;
                }
                terminal.draw(|frame| crate::tui::draw(frame, &app))?;
            }
            _ = spinner_tick.tick() => {
                app.spinner = app.spinner.wrapping_add(1);
            }
            _ = refresh_tick.tick() => {
                app.refresh(false).await;
            }
            _ = &mut shutdown => {
                app.should_quit = true;
            }
        }

        if app.should_quit {
            break;
        }
    }

    Ok(())
}

#[derive(Clone, Debug)]
pub enum InputMode {
    Normal,
    Search,
    EditConfig { key: String, secret: bool, value: String },
    EditRepo { app_id: i64, field: String, value: String },
}

pub struct App {
    pub config: Arc<ControlConfig>,
    db: Database,
    github: GithubService,
    ollama: OllamaService,
    openlib: OpenlibService,
    system: SystemService,
    logs: LogService,
    scheduler: SchedulerService,
    workers: WorkerService,
    pub snapshot: Snapshot,
    pub config_entries: Vec<ConfigEntry>,
    pub screen_index: usize,
    pub theme: ThemeMode,
    pub should_quit: bool,
    pub status_message: String,
    pub search_query: String,
    pub input_mode: InputMode,
    pub spinner: usize,
    pub selected_repo: usize,
    pub selected_worker: usize,
    pub selected_queue: usize,
    pub selected_config: usize,
    pub selected_schedule: usize,
    pub selected_log: usize,
    pub log_tab: usize,
    paused_schedules: HashSet<String>,
    last_github_refresh: Option<Instant>,
    last_ollama_refresh: Option<Instant>,
    last_openlib_refresh: Option<Instant>,
}

impl App {
    pub fn new(config: Arc<ControlConfig>, db: Database) -> Self {
        Self {
            github: GithubService::new(config.clone()),
            ollama: OllamaService::new(config.clone()),
            openlib: OpenlibService::new(config.clone()),
            system: SystemService::new(config.clone()),
            logs: LogService::new(config.clone()),
            scheduler: SchedulerService::new(config.clone()),
            workers: WorkerService::new(config.clone()),
            config_entries: config.editable_entries(),
            config,
            db,
            snapshot: Snapshot::default(),
            screen_index: 0,
            theme: ThemeMode::Dark,
            should_quit: false,
            status_message: "Ready".to_string(),
            search_query: String::new(),
            input_mode: InputMode::Normal,
            spinner: 0,
            selected_repo: 0,
            selected_worker: 0,
            selected_queue: 0,
            selected_config: 0,
            selected_schedule: 0,
            selected_log: 0,
            log_tab: 0,
            paused_schedules: HashSet::new(),
            last_github_refresh: None,
            last_ollama_refresh: None,
            last_openlib_refresh: None,
        }
    }

    pub fn current_screen(&self) -> Screen {
        Screen::ALL[self.screen_index]
    }

    pub fn screen_count(&self) -> usize {
        Screen::ALL.len()
    }

    pub fn selected_worker_kind(&self) -> WorkerKind {
        WorkerKind::ALL
            .get(self.selected_worker)
            .copied()
            .unwrap_or(WorkerKind::Crawler)
    }

    pub fn active_log_tab(&self) -> &'static str {
        LOG_TABS.get(self.log_tab).copied().unwrap_or("all")
    }

    pub fn filtered_repo_indexes(&self) -> Vec<usize> {
        let query = self.search_query.to_lowercase();
        self.snapshot
            .repositories
            .iter()
            .enumerate()
            .filter(|(_, repo)| {
                if query.is_empty() {
                    return true;
                }
                repo.full_name.to_lowercase().contains(&query)
                    || repo.name.to_lowercase().contains(&query)
                    || repo.status.to_lowercase().contains(&query)
                    || repo.license.to_lowercase().contains(&query)
                    || repo.category.to_lowercase().contains(&query)
                    || repo.language.to_lowercase().contains(&query)
            })
            .map(|(index, _)| index)
            .collect()
    }

    pub fn selected_repository(&self) -> Option<&crate::models::RepositoryRow> {
        let indexes = self.filtered_repo_indexes();
        indexes
            .get(self.selected_repo)
            .and_then(|index| self.snapshot.repositories.get(*index))
    }

    pub fn visible_logs(&self) -> Vec<&crate::models::LogLine> {
        let tab = self.active_log_tab();
        let query = self.search_query.to_lowercase();
        self.snapshot
            .logs
            .iter()
            .filter(|line| {
                let source_ok = tab == "all" || line.source == tab || (tab == "ai" && line.source == "ollama");
                let query_ok = query.is_empty()
                    || line.message.to_lowercase().contains(&query)
                    || line.level.to_lowercase().contains(&query)
                    || line.source.to_lowercase().contains(&query);
                source_ok && query_ok
            })
            .collect()
    }

    async fn handle_event(&mut self, event: InputEvent) -> Result<()> {
        match event {
            InputEvent::Key(key) => self.handle_key(key).await,
            InputEvent::Mouse(mouse) => {
                self.handle_mouse(mouse);
                Ok(())
            }
            InputEvent::Resize(_, _) => Ok(()),
        }
    }

    async fn handle_key(&mut self, key: KeyEvent) -> Result<()> {
        if key.kind != KeyEventKind::Press {
            return Ok(());
        }

        match &mut self.input_mode {
            InputMode::Search => return self.handle_search_key(key),
            InputMode::EditConfig { .. } => return self.handle_config_edit_key(key).await,
            InputMode::EditRepo { .. } => return self.handle_repo_edit_key(key).await,
            InputMode::Normal => {}
        }

        match key.code {
            KeyCode::Char('q') => self.should_quit = true,
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.should_quit = true;
            }
            KeyCode::Tab | KeyCode::Right | KeyCode::Char('l') => self.next_screen(),
            KeyCode::BackTab | KeyCode::Left | KeyCode::Char('h') => self.previous_screen(),
            KeyCode::Char('t') => {
                self.theme = self.theme.toggle();
                self.status_message = format!("Theme: {:?}", self.theme);
            }
            KeyCode::Char('r') => {
                self.refresh(true).await;
                self.status_message = "Refreshed".to_string();
            }
            KeyCode::Char('/') => {
                self.input_mode = InputMode::Search;
                self.status_message = "Search mode".to_string();
            }
            KeyCode::Esc => {
                self.search_query.clear();
                self.input_mode = InputMode::Normal;
                self.status_message = "Search cleared".to_string();
            }
            KeyCode::Up | KeyCode::Char('k') => self.move_selection(-1),
            KeyCode::Down | KeyCode::Char('j') => self.move_selection(1),
            KeyCode::Home | KeyCode::Char('g') => self.selection_home(),
            KeyCode::End | KeyCode::Char('G') => self.selection_end(),
            KeyCode::Char('s') => self.start_selected_worker().await?,
            KeyCode::Char('x') => self.stop_selected_worker().await?,
            KeyCode::Char('R') => self.restart_selected_worker().await?,
            KeyCode::Char('m') => self.manual_trigger_schedule().await?,
            KeyCode::Char('p') => self.toggle_selected_schedule(),
            KeyCode::Char('o') => self.export_visible_logs()?,
            KeyCode::Char('a') => self.approve_selected_repo().await?,
            KeyCode::Char('d') => self.reject_selected_repo().await?,
            KeyCode::Char('n') => self.begin_repo_edit("name"),
            KeyCode::Char('e') => self.begin_repo_edit("short_description"),
            KeyCode::Char('y') => self.begin_repo_edit("category"),
            KeyCode::Char('u') => self.begin_repo_edit("license"),
            KeyCode::Enter => self.begin_config_edit(),
            KeyCode::Char('[') => self.previous_log_tab(),
            KeyCode::Char(']') => self.next_log_tab(),
            KeyCode::Char(value) if value.is_ascii_digit() => {
                let index = value.to_digit(10).unwrap_or(1) as usize;
                if index > 0 && index <= self.screen_count() {
                    self.screen_index = index - 1;
                }
            }
            _ => {}
        }

        Ok(())
    }

    fn handle_search_key(&mut self, key: KeyEvent) -> Result<()> {
        match key.code {
            KeyCode::Esc | KeyCode::Enter => {
                self.input_mode = InputMode::Normal;
                self.status_message = if self.search_query.is_empty() {
                    "Search cleared".to_string()
                } else {
                    format!("Filter: {}", self.search_query)
                };
            }
            KeyCode::Backspace => {
                self.search_query.pop();
            }
            KeyCode::Char(ch) => {
                if !key.modifiers.contains(KeyModifiers::CONTROL) {
                    self.search_query.push(ch);
                }
            }
            _ => {}
        }
        Ok(())
    }

    async fn handle_config_edit_key(&mut self, key: KeyEvent) -> Result<()> {
        let mode = std::mem::replace(&mut self.input_mode, InputMode::Normal);
        let (env_key, secret, mut value) = match mode {
            InputMode::EditConfig { key, secret, value } => (key, secret, value),
            other => {
                self.input_mode = other;
                return Ok(());
            }
        };

        match key.code {
            KeyCode::Esc => {
                self.status_message = "Edit canceled".to_string();
            }
            KeyCode::Enter => {
                write_env_value(&self.config.env_path, &env_key, &value)?;
                for entry in &mut self.config_entries {
                    if entry.key == env_key.as_str() {
                        entry.value = value.clone();
                    }
                }
                self.status_message = format!("{env_key} saved to .env");
            }
            KeyCode::Backspace => {
                value.pop();
                self.input_mode = InputMode::EditConfig { key: env_key, secret, value };
            }
            KeyCode::Char(ch) => {
                if !key.modifiers.contains(KeyModifiers::CONTROL) {
                    value.push(ch);
                    if secret {
                        self.status_message = "Editing secret value".to_string();
                    }
                }
                self.input_mode = InputMode::EditConfig { key: env_key, secret, value };
            }
            _ => {
                self.input_mode = InputMode::EditConfig { key: env_key, secret, value };
            }
        }

        Ok(())
    }

    async fn handle_repo_edit_key(&mut self, key: KeyEvent) -> Result<()> {
        let mode = std::mem::replace(&mut self.input_mode, InputMode::Normal);
        let (app_id, field, mut value) = match mode {
            InputMode::EditRepo { app_id, field, value } => (app_id, field, value),
            other => {
                self.input_mode = other;
                return Ok(());
            }
        };

        match key.code {
            KeyCode::Esc => {
                self.status_message = "Edit canceled".to_string();
            }
            KeyCode::Enter => {
                self.db.update_repository_field(app_id, &field, &value).await?;
                self.refresh(false).await;
                self.status_message = format!("{field} updated");
            }
            KeyCode::Backspace => {
                value.pop();
                self.input_mode = InputMode::EditRepo { app_id, field, value };
            }
            KeyCode::Char(ch) => {
                if !key.modifiers.contains(KeyModifiers::CONTROL) {
                    value.push(ch);
                }
                self.input_mode = InputMode::EditRepo { app_id, field, value };
            }
            _ => {
                self.input_mode = InputMode::EditRepo { app_id, field, value };
            }
        }
        Ok(())
    }

    fn handle_mouse(&mut self, mouse: MouseEvent) {
        match mouse.kind {
            MouseEventKind::ScrollDown => self.move_selection(1),
            MouseEventKind::ScrollUp => self.move_selection(-1),
            MouseEventKind::Down(MouseButton::Left) => {
                if mouse.column < 24 && mouse.row >= 4 {
                    let index = mouse.row.saturating_sub(4) as usize;
                    if index < self.screen_count() {
                        self.screen_index = index;
                    }
                }
            }
            _ => {}
        }
    }

    pub async fn refresh(&mut self, force_network: bool) {
        let now = Instant::now();
        let should_refresh_github = force_network
            || self
                .last_github_refresh
                .map(|last| last.elapsed() > Duration::from_secs(60))
                .unwrap_or(true);
        let should_refresh_ollama = force_network
            || self
                .last_ollama_refresh
                .map(|last| last.elapsed() > Duration::from_secs(10))
                .unwrap_or(true);
        let should_refresh_openlib = force_network
            || self
                .last_openlib_refresh
                .map(|last| last.elapsed() > Duration::from_secs(60))
                .unwrap_or(true);

        let db_future = self.db.snapshot(self.config.clone());
        let system_future = self.system.snapshot();
        let logs_future = self.logs.tail(240);
        let workers_future = self.workers.states();
        let github_future = async {
            if should_refresh_github {
                Some(self.github.rate_limit().await)
            } else {
                None
            }
        };
        let ollama_future = async {
            if should_refresh_ollama {
                Some(self.ollama.status().await)
            } else {
                None
            }
        };
        let openlib_future = async {
            if should_refresh_openlib {
                Some(self.openlib.status().await)
            } else {
                None
            }
        };

        let (db_snapshot, system, logs, workers, github, ollama, openlib) = tokio::join!(
            db_future,
            system_future,
            logs_future,
            workers_future,
            github_future,
            ollama_future,
            openlib_future
        );

        match db_snapshot {
            Ok(mut snapshot) => {
                snapshot.system = system;
                snapshot.logs = logs;
                snapshot.workers = workers;
                snapshot.dashboard.active_workers = snapshot.workers.iter().filter(|worker| worker.running).count();
                snapshot.schedules = self.scheduler.jobs(&snapshot.workers);
                for job in &mut snapshot.schedules {
                    if self.paused_schedules.contains(&job.name) {
                        job.enabled = false;
                        job.status = "paused".to_string();
                    }
                }
                if let Some(github) = github {
                    snapshot.github = github;
                    self.last_github_refresh = Some(now);
                } else {
                    snapshot.github = self.snapshot.github.clone();
                }
                if let Some(ollama) = ollama {
                    snapshot.ollama = ollama;
                    self.last_ollama_refresh = Some(now);
                } else {
                    snapshot.ollama = self.snapshot.ollama.clone();
                }
                if let Some(openlib) = openlib {
                    snapshot.openlib = openlib;
                    self.last_openlib_refresh = Some(now);
                } else {
                    snapshot.openlib = self.snapshot.openlib.clone();
                }
                self.snapshot = snapshot;
                self.clamp_selections();
            }
            Err(err) => {
                self.status_message = format!("Database refresh failed: {err}");
            }
        }
    }

    fn next_screen(&mut self) {
        self.screen_index = (self.screen_index + 1) % self.screen_count();
    }

    fn previous_screen(&mut self) {
        self.screen_index = if self.screen_index == 0 {
            self.screen_count() - 1
        } else {
            self.screen_index - 1
        };
    }

    fn move_selection(&mut self, delta: isize) {
        let max = self.current_selection_len().saturating_sub(1);
        let target = match self.current_screen() {
            Screen::Workers => &mut self.selected_worker,
            Screen::Repositories => &mut self.selected_repo,
            Screen::Queue | Screen::Sync | Screen::Ai => &mut self.selected_queue,
            Screen::Logs => &mut self.selected_log,
            Screen::Scheduler => &mut self.selected_schedule,
            Screen::Config => &mut self.selected_config,
            _ => &mut self.selected_repo,
        };

        if delta < 0 {
            *target = target.saturating_sub(delta.unsigned_abs());
        } else {
            *target = min(max, *target + delta as usize);
        }
    }

    fn selection_home(&mut self) {
        match self.current_screen() {
            Screen::Workers => self.selected_worker = 0,
            Screen::Repositories => self.selected_repo = 0,
            Screen::Queue | Screen::Sync | Screen::Ai => self.selected_queue = 0,
            Screen::Logs => self.selected_log = 0,
            Screen::Scheduler => self.selected_schedule = 0,
            Screen::Config => self.selected_config = 0,
            _ => {}
        }
    }

    fn selection_end(&mut self) {
        let max = self.current_selection_len().saturating_sub(1);
        match self.current_screen() {
            Screen::Workers => self.selected_worker = max,
            Screen::Repositories => self.selected_repo = max,
            Screen::Queue | Screen::Sync | Screen::Ai => self.selected_queue = max,
            Screen::Logs => self.selected_log = max,
            Screen::Scheduler => self.selected_schedule = max,
            Screen::Config => self.selected_config = max,
            _ => {}
        }
    }

    fn current_selection_len(&self) -> usize {
        match self.current_screen() {
            Screen::Workers => WorkerKind::ALL.len(),
            Screen::Repositories => self.filtered_repo_indexes().len(),
            Screen::Queue | Screen::Sync | Screen::Ai => self.snapshot.queue_items.len(),
            Screen::Logs => self.visible_logs().len(),
            Screen::Scheduler => self.snapshot.schedules.len(),
            Screen::Config => self.config_entries.len(),
            _ => 1,
        }
    }

    fn clamp_selections(&mut self) {
        self.selected_worker = min(self.selected_worker, WorkerKind::ALL.len().saturating_sub(1));
        self.selected_repo = min(self.selected_repo, self.filtered_repo_indexes().len().saturating_sub(1));
        self.selected_queue = min(self.selected_queue, self.snapshot.queue_items.len().saturating_sub(1));
        self.selected_log = min(self.selected_log, self.visible_logs().len().saturating_sub(1));
        self.selected_config = min(self.selected_config, self.config_entries.len().saturating_sub(1));
        self.selected_schedule = min(self.selected_schedule, self.snapshot.schedules.len().saturating_sub(1));
    }

    async fn start_selected_worker(&mut self) -> Result<()> {
        let kind = self.selected_worker_kind();
        self.workers.start(kind).await?;
        self.status_message = format!("Started {}", kind.label());
        self.refresh(false).await;
        Ok(())
    }

    async fn stop_selected_worker(&mut self) -> Result<()> {
        let kind = self.selected_worker_kind();
        self.workers.stop(kind).await?;
        self.status_message = format!("Stopped {}", kind.label());
        self.refresh(false).await;
        Ok(())
    }

    async fn restart_selected_worker(&mut self) -> Result<()> {
        let kind = self.selected_worker_kind();
        self.workers.restart(kind).await?;
        self.status_message = format!("Restarted {}", kind.label());
        self.refresh(false).await;
        Ok(())
    }

    async fn manual_trigger_schedule(&mut self) -> Result<()> {
        let (worker, name) = match self.snapshot.schedules.get(self.selected_schedule) {
            Some(job) => (job.worker, job.name.clone()),
            None => return Ok(()),
        };
        self.workers.start(worker).await?;
        self.status_message = format!("Triggered {name}");
        self.refresh(false).await;
        Ok(())
    }

    fn toggle_selected_schedule(&mut self) {
        if self.current_screen() != Screen::Scheduler {
            return;
        }

        let Some(name) = self
            .snapshot
            .schedules
            .get(self.selected_schedule)
            .map(|job| job.name.clone())
        else {
            return;
        };

        let paused = if self.paused_schedules.remove(&name) {
            false
        } else {
            self.paused_schedules.insert(name.clone());
            true
        };

        let Some(job) = self.snapshot.schedules.get_mut(self.selected_schedule) else {
            return;
        };

        if paused {
            job.enabled = false;
            job.status = "paused".to_string();
            self.status_message = format!("Paused {name}");
        } else {
            job.enabled = true;
            job.status = if job.running { "running" } else { "ready" }.to_string();
            self.status_message = format!("Resumed {name}");
        }
    }

    fn export_visible_logs(&mut self) -> Result<()> {
        if self.current_screen() != Screen::Logs {
            return Ok(());
        }

        fs::create_dir_all(&self.config.log_dir)?;
        let lines = self
            .visible_logs()
            .into_iter()
            .map(|line| {
                if line.raw.is_empty() {
                    format!("{} {} {} {}", line.at, line.source, line.level, line.message)
                } else {
                    line.raw.clone()
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
        let path = self.config.log_dir.join("openlib-control-panel-export.log");
        fs::write(&path, format!("{lines}\n"))?;
        self.status_message = format!("Exported logs to {}", path.display());
        Ok(())
    }

    async fn approve_selected_repo(&mut self) -> Result<()> {
        if self.current_screen() != Screen::Repositories {
            return Ok(());
        }
        let (app_id, full_name) = match self.selected_repository() {
            Some(repo) => (repo.id, repo.full_name.clone()),
            None => return Ok(()),
        };
        self.db.approve_repository(app_id).await?;
        self.status_message = format!("Approved {full_name}");
        self.refresh(false).await;
        Ok(())
    }

    async fn reject_selected_repo(&mut self) -> Result<()> {
        if self.current_screen() != Screen::Repositories {
            return Ok(());
        }
        let (app_id, full_name) = match self.selected_repository() {
            Some(repo) => (repo.id, repo.full_name.clone()),
            None => return Ok(()),
        };
        self.db.reject_repository(app_id, "rejected_from_control_panel").await?;
        self.status_message = format!("Rejected {full_name}");
        self.refresh(false).await;
        Ok(())
    }

    fn begin_repo_edit(&mut self, field: &str) {
        if self.current_screen() != Screen::Repositories {
            return;
        }

        let Some(repo) = self.selected_repository() else {
            return;
        };
        let value = match field {
            "name" => repo.name.clone(),
            "category" => repo.category.clone(),
            "license" => repo.license.clone(),
            "short_description" => repo.short_description.clone(),
            _ => String::new(),
        };
        let app_id = repo.id;

        self.input_mode = InputMode::EditRepo {
            app_id,
            field: field.to_string(),
            value,
        };
        self.status_message = format!("Editing {field}");
    }

    fn begin_config_edit(&mut self) {
        if self.current_screen() != Screen::Config {
            return;
        }

        let Some(entry) = self.config_entries.get(self.selected_config) else {
            return;
        };
        let key = entry.key.clone();
        let secret = entry.secret;
        let value = entry.value.clone();
        self.input_mode = InputMode::EditConfig {
            key: key.clone(),
            secret,
            value,
        };
        self.status_message = format!("Editing {key}");
    }

    fn next_log_tab(&mut self) {
        self.log_tab = (self.log_tab + 1) % LOG_TABS.len();
    }

    fn previous_log_tab(&mut self) {
        self.log_tab = if self.log_tab == 0 {
            LOG_TABS.len() - 1
        } else {
            self.log_tab - 1
        };
    }

    pub fn refresh_age(&self) -> String {
        let age = Utc::now().signed_duration_since(self.snapshot.refreshed_at);
        if age < ChronoDuration::seconds(60) {
            format!("{}s", age.num_seconds().max(0))
        } else {
            format!("{}m", age.num_minutes())
        }
    }
}
