use thiserror::Error;

pub type Result<T> = std::result::Result<T, ControlError>;

#[derive(Debug, Error)]
pub enum ControlError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("background task failed: {0}")]
    Join(#[from] tokio::task::JoinError),

    #[error("environment error: {0}")]
    Env(String),

    #[error("worker command error: {0}")]
    Command(String),
}
