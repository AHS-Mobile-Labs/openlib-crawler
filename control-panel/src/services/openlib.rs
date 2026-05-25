use crate::config::ControlConfig;
use crate::models::OpenlibStatus;
use chrono::Utc;
use reqwest::header::AUTHORIZATION;
use std::sync::Arc;
use std::time::{Duration, Instant};

#[derive(Clone)]
pub struct OpenlibService {
    config: Arc<ControlConfig>,
    client: reqwest::Client,
}

impl OpenlibService {
    pub fn new(config: Arc<ControlConfig>) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(6))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self { config, client }
    }

    pub async fn status(&self) -> OpenlibStatus {
        if self.config.sync.api_base_url.is_empty() {
            return OpenlibStatus {
                configured: false,
                checked_at: Some(Utc::now().to_rfc3339()),
                error: Some("OPENLIB_API_URL is not configured".to_string()),
                ..OpenlibStatus::default()
            };
        }

        let started = Instant::now();
        let mut request = self.client.get(self.config.sync.api_base_url.trim_end_matches('/'));
        if !self.config.sync.api_key.is_empty() {
            request = request.header(AUTHORIZATION, format!("Bearer {}", self.config.sync.api_key));
        }

        match request.send().await {
            Ok(response) => {
                let status = response.status();
                OpenlibStatus {
                    configured: true,
                    online: status.is_success() || status.is_redirection() || status.as_u16() == 401,
                    status_code: Some(status.as_u16()),
                    latency_ms: Some(started.elapsed().as_millis()),
                    checked_at: Some(Utc::now().to_rfc3339()),
                    error: None,
                }
            }
            Err(err) => OpenlibStatus {
                configured: true,
                online: false,
                latency_ms: Some(started.elapsed().as_millis()),
                checked_at: Some(Utc::now().to_rfc3339()),
                error: Some(err.to_string()),
                ..OpenlibStatus::default()
            },
        }
    }
}
