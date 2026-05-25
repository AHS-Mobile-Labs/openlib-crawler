use crate::config::ControlConfig;
use crate::models::{SchedulerJob, WorkerKind, WorkerState};
use chrono::{DateTime, Utc};
use std::sync::Arc;
use std::time::Duration;

#[derive(Clone)]
pub struct SchedulerService {
    config: Arc<ControlConfig>,
}

impl SchedulerService {
    pub fn new(config: Arc<ControlConfig>) -> Self {
        Self { config }
    }

    pub fn jobs(&self, workers: &[WorkerState]) -> Vec<SchedulerJob> {
        vec![
            self.job("crawl repositories", WorkerKind::Crawler, self.config.crawler.interval, workers),
            self.job("refresh metadata", WorkerKind::Updater, self.config.updater.interval, workers),
            self.job("ai enrichment", WorkerKind::Ai, self.config.ai.interval, workers),
            self.job(
                "screenshots",
                WorkerKind::Screenshots,
                self.config.screenshots.refresh_interval,
                workers,
            ),
            self.job("openlib sync", WorkerKind::Sync, Duration::from_secs(30 * 60), workers),
        ]
    }

    fn job(
        &self,
        name: &str,
        worker: WorkerKind,
        interval: Duration,
        workers: &[WorkerState],
    ) -> SchedulerJob {
        let worker_state = workers.iter().find(|candidate| candidate.kind == worker);
        let running = worker_state.map(|state| state.running).unwrap_or(false);
        let last_run = worker_state.and_then(|state| state.started_at.clone());
        let chrono_interval = chrono::Duration::from_std(interval)
            .unwrap_or_else(|_| chrono::Duration::seconds(0));
        let next_run = last_run
            .as_deref()
            .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
            .map(|value| value.with_timezone(&Utc) + chrono_interval)
            .map(|value| value.to_rfc3339());

        SchedulerJob {
            name: name.to_string(),
            worker,
            interval,
            enabled: true,
            running,
            last_run,
            next_run,
            status: if running { "running" } else { "ready" }.to_string(),
        }
    }
}
