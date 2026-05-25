use crate::config::ControlConfig;
use crate::models::{OllamaModel, OllamaStatus};
use serde::Deserialize;
use std::fs;
use std::sync::Arc;
use std::time::{Duration, Instant};

#[derive(Clone)]
pub struct OllamaService {
    config: Arc<ControlConfig>,
    client: reqwest::Client,
}

impl OllamaService {
    pub fn new(config: Arc<ControlConfig>) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(4))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self { config, client }
    }

    pub async fn status(&self) -> OllamaStatus {
        let pid = read_pid(&self.config);
        let process_running = pid.map(process_exists).unwrap_or(false);
        let started = Instant::now();
        let url = format!("{}/api/tags", self.config.ai.base_url.trim_end_matches('/'));

        match self.client.get(url).send().await {
            Ok(response) => match response.error_for_status() {
                Ok(response) => match response.json::<TagsResponse>().await {
                    Ok(body) => OllamaStatus {
                        online: true,
                        base_url: self.config.ai.base_url.clone(),
                        selected_model: self.config.ai.model.clone(),
                        models: body
                            .models
                            .into_iter()
                            .map(|model| OllamaModel {
                                name: model.name,
                                size_bytes: model.size,
                                modified_at: model.modified_at,
                            })
                            .collect(),
                        process_running,
                        pid,
                        latency_ms: Some(started.elapsed().as_millis()),
                        error: None,
                    },
                    Err(err) => offline(&self.config, pid, process_running, err.to_string()),
                },
                Err(err) => offline(&self.config, pid, process_running, err.to_string()),
            },
            Err(err) => offline(&self.config, pid, process_running, err.to_string()),
        }
    }
}

fn offline(config: &ControlConfig, pid: Option<u32>, process_running: bool, error: String) -> OllamaStatus {
    OllamaStatus {
        online: false,
        base_url: config.ai.base_url.clone(),
        selected_model: config.ai.model.clone(),
        process_running,
        pid,
        error: Some(error),
        ..OllamaStatus::default()
    }
}

fn read_pid(config: &ControlConfig) -> Option<u32> {
    let pid_path = config.data_dir.join("ollama.pid");
    fs::read_to_string(pid_path).ok()?.trim().parse::<u32>().ok()
}

fn process_exists(pid: u32) -> bool {
    #[cfg(target_os = "linux")]
    {
        std::path::Path::new("/proc").join(pid.to_string()).exists()
    }
    #[cfg(not(target_os = "linux"))]
    {
        pid > 0
    }
}

#[derive(Debug, Deserialize)]
struct TagsResponse {
    models: Vec<TagModel>,
}

#[derive(Debug, Deserialize)]
struct TagModel {
    name: String,
    size: Option<u64>,
    modified_at: Option<String>,
}
