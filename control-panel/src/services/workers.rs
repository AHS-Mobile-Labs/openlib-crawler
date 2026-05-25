use crate::config::ControlConfig;
use crate::error::{ControlError, Result};
use crate::models::{WorkerKind, WorkerState};
use chrono::Utc;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct WorkerService {
    config: Arc<ControlConfig>,
    processes: Arc<Mutex<HashMap<WorkerKind, ManagedProcess>>>,
}

impl WorkerService {
    pub fn new(config: Arc<ControlConfig>) -> Self {
        Self {
            config,
            processes: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn start(&self, kind: WorkerKind) -> Result<()> {
        let mut guard = self.processes.lock().await;
        if let Some(process) = guard.get_mut(&kind) {
            if process.is_running()? {
                return Ok(());
            }
        }

        let command_line = command_for(kind);
        let mut command = Command::new(command_line[0]);
        command.args(&command_line[1..]);
        command.current_dir(&self.config.root_dir);
        command.stdin(Stdio::null());
        command.stdout(Stdio::null());
        command.stderr(Stdio::null());

        let child = command.spawn().map_err(|err| {
            ControlError::Command(format!("failed to start {}: {err}", kind.label()))
        })?;

        let restarts = guard.get(&kind).map(|process| process.restarts + 1).unwrap_or(0);
        guard.insert(
            kind,
            ManagedProcess {
                child: Some(child),
                command: command_line.join(" "),
                started_at: Some(Utc::now().to_rfc3339()),
                last_exit: None,
                last_error: None,
                restarts,
            },
        );

        tracing::info!(worker = kind.label(), "worker started");
        Ok(())
    }

    pub async fn stop(&self, kind: WorkerKind) -> Result<()> {
        let mut guard = self.processes.lock().await;
        let Some(process) = guard.get_mut(&kind) else {
            return Ok(());
        };

        if let Some(child) = process.child.as_mut() {
            match child.kill().await {
                Ok(()) => {
                    process.last_exit = Some(format!("stopped at {}", Utc::now().to_rfc3339()));
                    process.child = None;
                    tracing::info!(worker = kind.label(), "worker stopped");
                }
                Err(err) => {
                    process.last_error = Some(err.to_string());
                    return Err(ControlError::Command(err.to_string()));
                }
            }
        }

        Ok(())
    }

    pub async fn restart(&self, kind: WorkerKind) -> Result<()> {
        self.stop(kind).await?;
        self.start(kind).await
    }

    pub async fn states(&self) -> Vec<WorkerState> {
        let mut guard = self.processes.lock().await;
        WorkerKind::ALL
            .iter()
            .copied()
            .map(|kind| worker_state(kind, guard.get_mut(&kind)))
            .collect()
    }
}

struct ManagedProcess {
    child: Option<Child>,
    command: String,
    started_at: Option<String>,
    last_exit: Option<String>,
    last_error: Option<String>,
    restarts: u32,
}

impl ManagedProcess {
    fn is_running(&mut self) -> Result<bool> {
        let Some(child) = self.child.as_mut() else {
            return Ok(false);
        };

        match child.try_wait()? {
            Some(status) => {
                self.last_exit = Some(format!("exit {status} at {}", Utc::now().to_rfc3339()));
                self.child = None;
                Ok(false)
            }
            None => Ok(true),
        }
    }
}

fn worker_state(kind: WorkerKind, process: Option<&mut ManagedProcess>) -> WorkerState {
    let Some(process) = process else {
        return WorkerState {
            kind,
            health: "idle".to_string(),
            command: command_for(kind).join(" "),
            ..WorkerState::default()
        };
    };

    let running = match process.is_running() {
        Ok(value) => value,
        Err(err) => {
            process.last_error = Some(err.to_string());
            false
        }
    };

    let pid = process.child.as_ref().and_then(Child::id);
    WorkerState {
        kind,
        running,
        pid,
        health: if running { "running" } else { "stopped" }.to_string(),
        command: process.command.clone(),
        started_at: process.started_at.clone(),
        last_exit: process.last_exit.clone(),
        last_error: process.last_error.clone(),
        restarts: process.restarts,
    }
}

fn command_for(kind: WorkerKind) -> Vec<&'static str> {
    match kind {
        WorkerKind::Crawler => vec!["npm", "run", "crawl"],
        WorkerKind::Updater => vec!["npm", "run", "update"],
        WorkerKind::Ai => vec!["npm", "run", "ai"],
        WorkerKind::Screenshots => vec!["npm", "run", "screenshots"],
        WorkerKind::Sync => vec!["npm", "run", "sync"],
        WorkerKind::Scheduler => vec!["npm", "run", "scheduler"],
        WorkerKind::Moderation => vec!["npm", "run", "moderation"],
        WorkerKind::Ollama => vec!["npm", "run", "ollama:start"],
    }
}
