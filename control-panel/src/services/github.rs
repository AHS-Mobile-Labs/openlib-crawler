use crate::config::ControlConfig;
use crate::models::GithubRateLimit;
use chrono::{TimeZone, Utc};
use reqwest::header::{ACCEPT, AUTHORIZATION, USER_AGENT};
use serde::Deserialize;
use std::sync::Arc;
use std::time::Duration;

#[derive(Clone)]
pub struct GithubService {
    config: Arc<ControlConfig>,
    client: reqwest::Client,
}

impl GithubService {
    pub fn new(config: Arc<ControlConfig>) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(8))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self { config, client }
    }

    pub async fn rate_limit(&self) -> GithubRateLimit {
        let url = format!("{}/rate_limit", self.config.github.api_base_url.trim_end_matches('/'));
        let mut request = self
            .client
            .get(url)
            .header(USER_AGENT, self.config.github.user_agent.as_str())
            .header(ACCEPT, "application/vnd.github+json");

        if !self.config.github.token.is_empty() {
            request = request.header(AUTHORIZATION, format!("Bearer {}", self.config.github.token));
        }

        match request.send().await {
            Ok(response) => match response.error_for_status() {
                Ok(response) => match response.json::<RateLimitResponse>().await {
                    Ok(body) => {
                        let rate = body.resources.core.or(body.rate).unwrap_or_default();
                        GithubRateLimit {
                            online: true,
                            limit: rate.limit,
                            remaining: rate.remaining,
                            used: rate.used,
                            reset_at: rate
                                .reset
                                .and_then(|seconds| Utc.timestamp_opt(seconds, 0).single())
                                .map(|value| value.to_rfc3339()),
                            source: "github".to_string(),
                            error: None,
                        }
                    }
                    Err(err) => offline(err.to_string()),
                },
                Err(err) => offline(err.to_string()),
            },
            Err(err) => offline(err.to_string()),
        }
    }
}

fn offline(error: String) -> GithubRateLimit {
    GithubRateLimit {
        online: false,
        source: "offline".to_string(),
        error: Some(error),
        ..GithubRateLimit::default()
    }
}

#[derive(Debug, Deserialize)]
struct RateLimitResponse {
    resources: RateResources,
    rate: Option<RateInfo>,
}

#[derive(Debug, Deserialize)]
struct RateResources {
    core: Option<RateInfo>,
}

#[derive(Debug, Default, Deserialize)]
struct RateInfo {
    limit: i64,
    remaining: i64,
    reset: Option<i64>,
    used: i64,
}
