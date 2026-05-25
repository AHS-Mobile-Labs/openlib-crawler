mod app;
mod config;
mod db;
mod error;
mod events;
mod models;
mod services;
mod tui;

use crate::config::ControlConfig;
use crate::db::Database;
use crate::error::{ControlError, Result};
use std::sync::Arc;
use tracing_subscriber::filter::Directive;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    let config = Arc::new(ControlConfig::load()?);
    std::fs::create_dir_all(&config.log_dir)?;

    let file_appender = tracing_appender::rolling::never(&config.log_dir, "openlib-control-panel.log");
    let (writer, _guard) = tracing_appender::non_blocking(file_appender);
    let filter = EnvFilter::from_default_env().add_directive(
        "openlib_control_panel=info"
            .parse::<Directive>()
            .map_err(|err| ControlError::Env(format!("invalid tracing directive: {err}")))?,
    );

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(writer)
        .with_ansi(false)
        .init();

    let database = Database::new(config.db_path.clone());
    let mut terminal = tui::init_terminal()?;
    let run_result = app::run(&mut terminal, config, database).await;
    let restore_result = tui::restore_terminal(&mut terminal);

    restore_result?;
    run_result
}
