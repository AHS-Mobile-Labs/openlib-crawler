use crate::config::ControlConfig;
use crate::error::Result;
use crate::models::{
    ActivityItem, DashboardStats, QueueItem, QueueStats, RepositoryRow, Snapshot,
};
use chrono::{Duration as ChronoDuration, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

#[derive(Clone, Debug)]
pub struct Database {
    path: PathBuf,
}

impl Database {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub async fn snapshot(&self, config: Arc<ControlConfig>) -> Result<Snapshot> {
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || read_snapshot(path, config)).await?
    }

    pub async fn approve_repository(&self, app_id: i64) -> Result<()> {
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || {
            let conn = open_connection(path)?;
            let now = Utc::now().to_rfc3339();
            conn.execute(
                "UPDATE apps SET status = 'approved', visibility = 'public', rejection_reason = '', updated_at = ?1 WHERE id = ?2",
                params![now, app_id],
            )?;
            enqueue_sync_job(&conn, app_id, "upsert")?;
            Ok(())
        })
        .await?
    }

    pub async fn reject_repository(&self, app_id: i64, reason: &str) -> Result<()> {
        let path = self.path.clone();
        let reason = reason.to_string();
        tokio::task::spawn_blocking(move || {
            let conn = open_connection(path)?;
            let now = Utc::now().to_rfc3339();
            conn.execute(
                "UPDATE apps SET status = 'rejected', visibility = 'private', rejection_reason = ?1, updated_at = ?2 WHERE id = ?3",
                params![reason, now, app_id],
            )?;
            Ok(())
        })
        .await?
    }

    pub async fn update_repository_field(&self, app_id: i64, field: &str, value: &str) -> Result<()> {
        let allowed = matches!(
            field,
            "name" | "category" | "license" | "short_description" | "tags" | "status"
        );
        if !allowed {
            return Ok(());
        }

        let path = self.path.clone();
        let field = field.to_string();
        let value = value.to_string();
        tokio::task::spawn_blocking(move || {
            let conn = open_connection(path)?;
            let sql = format!("UPDATE apps SET {field} = ?1, updated_at = ?2 WHERE id = ?3");
            conn.execute(&sql, params![value, Utc::now().to_rfc3339(), app_id])?;
            Ok(())
        })
        .await?
    }
}

fn read_snapshot(path: PathBuf, config: Arc<ControlConfig>) -> Result<Snapshot> {
    let conn = open_connection(path.clone())?;
    let db_size_bytes = fs::metadata(&path).map(|metadata| metadata.len()).unwrap_or(0);
    let since_hour = (Utc::now() - ChronoDuration::hours(1)).to_rfc3339();

    let dashboard = DashboardStats {
        total_repositories: count(&conn, "SELECT COUNT(*) FROM apps")?,
        pending_moderation: count(
            &conn,
            "SELECT COUNT(*) FROM apps WHERE status IN ('pending', 'pending_duplicate', 'discovered')",
        )?,
        approved_apps: count(
            &conn,
            "SELECT COUNT(*) FROM apps WHERE status IN ('approved', 'published')",
        )?,
        failed_jobs: count(
            &conn,
            "SELECT
                (SELECT COUNT(*) FROM ai_jobs WHERE status = 'failed') +
                (SELECT COUNT(*) FROM sync_queue WHERE status = 'failed') +
                (SELECT COUNT(*) FROM update_jobs WHERE status = 'failed')",
        )?,
        active_workers: 0,
        throughput_hour: count_param(
            &conn,
            "SELECT COUNT(*) FROM crawl_logs WHERE created_at >= ?1",
            &since_hour,
        )?,
        accepted_hour: count_param(
            &conn,
            "SELECT COUNT(*) FROM crawl_logs WHERE created_at >= ?1 AND status IN ('pending', 'pending_duplicate', 'approved', 'published')",
            &since_hour,
        )?,
        last_crawl_at: conn
            .query_row(
                "SELECT MAX(last_seen) FROM (
                    SELECT MAX(created_at) AS last_seen FROM crawl_logs
                    UNION ALL
                    SELECT MAX(last_crawled_at) AS last_seen FROM apps
                )",
                [],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten(),
        db_size_bytes,
    };

    let queues = QueueStats {
        ai_pending: count(&conn, "SELECT COUNT(*) FROM ai_jobs WHERE status = 'pending'")?,
        ai_processing: count(&conn, "SELECT COUNT(*) FROM ai_jobs WHERE status = 'processing'")?,
        ai_failed: count(&conn, "SELECT COUNT(*) FROM ai_jobs WHERE status = 'failed'")?,
        sync_pending: count(&conn, "SELECT COUNT(*) FROM sync_queue WHERE status = 'pending'")?,
        sync_failed: count(&conn, "SELECT COUNT(*) FROM sync_queue WHERE status = 'failed'")?,
        sync_completed: count(&conn, "SELECT COUNT(*) FROM sync_queue WHERE status IN ('synced', 'completed') OR synced = 1")?,
        update_pending: count(&conn, "SELECT COUNT(*) FROM update_jobs WHERE status = 'pending'")?,
        screenshot_pending: count(&conn, "SELECT COUNT(*) FROM screenshots WHERE status = 'pending'")?,
    };

    let repositories = read_repositories(&conn)?;
    let activity = read_activity(&conn)?;
    let queue_items = read_queue_items(&conn)?;

    let mut snapshot = Snapshot {
        dashboard,
        queues,
        repositories,
        activity,
        queue_items,
        ..Snapshot::default()
    };
    snapshot.system.db_size_bytes = db_size_bytes;
    snapshot.ollama.base_url = config.ai.base_url.clone();
    snapshot.ollama.selected_model = config.ai.model.clone();
    Ok(snapshot)
}

fn open_connection(path: PathBuf) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "busy_timeout", 5_000)?;
    Ok(conn)
}

fn count(conn: &Connection, sql: &str) -> Result<i64> {
    Ok(conn.query_row(sql, [], |row| row.get::<_, i64>(0)).unwrap_or(0))
}

fn count_param(conn: &Connection, sql: &str, param_value: &str) -> Result<i64> {
    Ok(conn
        .query_row(sql, params![param_value], |row| row.get::<_, i64>(0))
        .unwrap_or(0))
}

fn read_repositories(conn: &Connection) -> Result<Vec<RepositoryRow>> {
    let mut stmt = conn.prepare(
        "SELECT
            id,
            COALESCE(github_full_name, ''),
            COALESCE(name, ''),
            COALESCE(status, ''),
            COALESCE(quality_score, score, 0),
            COALESCE(license, ''),
            COALESCE(category, ''),
            COALESCE(language, ''),
            COALESCE(stars, 0),
            (SELECT COUNT(*) FROM screenshots WHERE screenshots.app_id = apps.id),
            updated_at,
            last_crawled_at,
            last_ai_at,
            last_synced_at,
            COALESCE(short_description, ''),
            COALESCE(SUBSTR(readme_text, 1, 800), '')
        FROM apps
        ORDER BY
            CASE status
                WHEN 'pending' THEN 0
                WHEN 'pending_duplicate' THEN 1
                WHEN 'approved' THEN 2
                ELSE 3
            END,
            quality_score DESC,
            updated_at DESC
        LIMIT 250",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(RepositoryRow {
            id: row.get(0)?,
            full_name: row.get(1)?,
            name: row.get(2)?,
            status: row.get(3)?,
            quality_score: row.get(4)?,
            license: row.get(5)?,
            category: row.get(6)?,
            language: row.get(7)?,
            stars: row.get(8)?,
            screenshot_count: row.get(9)?,
            updated_at: row.get(10)?,
            last_crawled_at: row.get(11)?,
            last_ai_at: row.get(12)?,
            last_synced_at: row.get(13)?,
            short_description: row.get(14)?,
            readme_preview: row.get(15)?,
        })
    })?;

    Ok(rows.filter_map(std::result::Result::ok).collect())
}

fn read_activity(conn: &Connection) -> Result<Vec<ActivityItem>> {
    let mut stmt = conn.prepare(
        "SELECT
            COALESCE(created_at, ''),
            COALESCE(status, ''),
            COALESCE(repo_full_name, ''),
            COALESCE(message, '')
        FROM crawl_logs
        ORDER BY id DESC
        LIMIT 80",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(ActivityItem {
            at: row.get(0)?,
            status: row.get(1)?,
            repo: row.get(2)?,
            message: row.get(3)?,
        })
    })?;

    Ok(rows.filter_map(std::result::Result::ok).collect())
}

fn read_queue_items(conn: &Connection) -> Result<Vec<QueueItem>> {
    let mut items = Vec::new();

    let mut ai_stmt = conn.prepare(
        "SELECT id, app_id, COALESCE(task, 'enrich'), COALESCE(status, ''), COALESCE(attempts, 0), COALESCE(last_error, ''), updated_at
        FROM ai_jobs
        ORDER BY
            CASE status WHEN 'processing' THEN 0 WHEN 'pending' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END,
            updated_at DESC
        LIMIT 50",
    )?;
    let ai_rows = ai_stmt.query_map([], |row| {
        Ok(QueueItem {
            id: row.get(0)?,
            queue: "ai".to_string(),
            app_id: row.get(1)?,
            action: row.get(2)?,
            status: row.get(3)?,
            attempts: row.get(4)?,
            last_error: row.get(5)?,
            updated_at: row.get(6)?,
        })
    })?;
    items.extend(ai_rows.filter_map(std::result::Result::ok));

    let mut sync_stmt = conn.prepare(
        "SELECT id, app_id, COALESCE(action, 'upsert'), COALESCE(status, ''), COALESCE(attempts, 0), COALESCE(last_error, ''), updated_at
        FROM sync_queue
        ORDER BY
            CASE status WHEN 'processing' THEN 0 WHEN 'pending' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END,
            updated_at DESC
        LIMIT 50",
    )?;
    let sync_rows = sync_stmt.query_map([], |row| {
        Ok(QueueItem {
            id: row.get(0)?,
            queue: "sync".to_string(),
            app_id: row.get(1)?,
            action: row.get(2)?,
            status: row.get(3)?,
            attempts: row.get(4)?,
            last_error: row.get(5)?,
            updated_at: row.get(6)?,
        })
    })?;
    items.extend(sync_rows.filter_map(std::result::Result::ok));

    items.sort_by(|left, right| left.status.cmp(&right.status).then(right.updated_at.cmp(&left.updated_at)));
    Ok(items)
}

fn enqueue_sync_job(conn: &Connection, app_id: i64, action: &str) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO sync_queue (app_id, action, payload, status, attempts, created_at, updated_at)
        SELECT ?1, ?2, '{}', 'pending', 0, ?3, ?3
        WHERE NOT EXISTS (
            SELECT 1 FROM sync_queue
            WHERE app_id = ?1 AND action = ?2 AND status IN ('pending', 'processing', 'failed')
        )",
        params![app_id, action, now],
    )?;
    Ok(())
}
