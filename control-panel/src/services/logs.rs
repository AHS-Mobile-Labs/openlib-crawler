use crate::config::ControlConfig;
use crate::models::LogLine;
use serde_json::Value;
use std::collections::VecDeque;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::sync::Arc;

#[derive(Clone)]
pub struct LogService {
    config: Arc<ControlConfig>,
}

impl LogService {
    pub fn new(config: Arc<ControlConfig>) -> Self {
        Self { config }
    }

    pub async fn tail(&self, limit: usize) -> Vec<LogLine> {
        let config = self.config.clone();
        tokio::task::spawn_blocking(move || {
            let mut lines = Vec::new();
            lines.extend(tail_file(&config.log_dir.join("openlib-crawler.log"), "crawler", limit));
            lines.extend(tail_file(&config.log_dir.join("ollama.log"), "ollama", limit / 2));
            lines.extend(tail_file(&config.log_dir.join("openlib-control-panel.log"), "system", limit / 2));
            lines.sort_by(|left, right| left.at.cmp(&right.at));
            if lines.len() > limit {
                lines.drain(0..lines.len() - limit);
            }
            lines
        })
        .await
        .unwrap_or_default()
    }
}

fn tail_file(path: &Path, source: &str, limit: usize) -> Vec<LogLine> {
    let Ok(file) = File::open(path) else {
        return Vec::new();
    };

    let mut tail = VecDeque::with_capacity(limit);
    for raw in BufReader::new(file).lines().map_while(Result::ok) {
        if tail.len() == limit {
            tail.pop_front();
        }
        tail.push_back(parse_log_line(source, &raw));
    }
    tail.into_iter().collect()
}

fn parse_log_line(source: &str, raw: &str) -> LogLine {
    if let Ok(value) = serde_json::from_str::<Value>(raw) {
        return LogLine {
            at: value
                .get("ts")
                .or_else(|| value.get("timestamp"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            source: source.to_string(),
            level: value.get("level").and_then(Value::as_str).unwrap_or("info").to_string(),
            message: value
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or(raw)
                .to_string(),
            raw: raw.to_string(),
        };
    }

    let level = if raw.contains("ERROR") || raw.contains("\"error\"") {
        "error"
    } else if raw.contains("WARN") {
        "warn"
    } else {
        "info"
    };

    LogLine {
        at: String::new(),
        source: source.to_string(),
        level: level.to_string(),
        message: raw.to_string(),
        raw: raw.to_string(),
    }
}
