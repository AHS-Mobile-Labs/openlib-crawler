use crate::app::{App, InputMode};
use crate::models::{LogLine, QueueItem, Screen, ThemeMode};
use crossterm::event::{DisableMouseCapture, EnableMouseCapture};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Alignment, Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Cell, Gauge, Paragraph, Row, Table, Wrap};
use ratatui::{Frame, Terminal};
use std::io::{self, Stdout};

pub type TuiTerminal = Terminal<CrosstermBackend<Stdout>>;

pub fn init_terminal() -> io::Result<TuiTerminal> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;
    terminal.clear()?;
    Ok(terminal)
}

pub fn restore_terminal(terminal: &mut TuiTerminal) -> io::Result<()> {
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen, DisableMouseCapture)?;
    terminal.show_cursor()?;
    Ok(())
}

pub fn draw(frame: &mut Frame, app: &App) {
    let palette = palette(app.theme);
    let area = frame.area();
    frame.render_widget(Block::default().style(Style::default().bg(palette.bg).fg(palette.fg)), area);

    let shell = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Min(12),
            Constraint::Length(if area.height > 34 { 10 } else { 7 }),
            Constraint::Length(1),
        ])
        .split(area);

    render_top_bar(frame, shell[0], app, &palette);
    let body = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Length(24), Constraint::Min(40)])
        .split(shell[1]);
    render_sidebar(frame, body[0], app, &palette);
    render_screen(frame, body[1], app, &palette);
    render_bottom_logs(frame, shell[2], app, &palette);
    render_command_bar(frame, shell[3], app, &palette);
}

#[derive(Clone, Copy)]
struct Palette {
    bg: Color,
    fg: Color,
    muted: Color,
    border: Color,
    accent: Color,
    accent2: Color,
    good: Color,
    warn: Color,
    bad: Color,
    selected_bg: Color,
}

fn palette(theme: ThemeMode) -> Palette {
    match theme {
        ThemeMode::Dark => Palette {
            bg: Color::Rgb(7, 10, 18),
            fg: Color::Rgb(220, 235, 240),
            muted: Color::Rgb(112, 127, 143),
            border: Color::Rgb(38, 54, 72),
            accent: Color::Rgb(0, 220, 255),
            accent2: Color::Rgb(255, 55, 190),
            good: Color::Rgb(80, 240, 150),
            warn: Color::Rgb(255, 203, 90),
            bad: Color::Rgb(255, 82, 110),
            selected_bg: Color::Rgb(20, 40, 55),
        },
        ThemeMode::Light => Palette {
            bg: Color::Rgb(244, 248, 250),
            fg: Color::Rgb(18, 29, 39),
            muted: Color::Rgb(92, 106, 118),
            border: Color::Rgb(171, 186, 199),
            accent: Color::Rgb(0, 116, 140),
            accent2: Color::Rgb(170, 36, 122),
            good: Color::Rgb(0, 136, 89),
            warn: Color::Rgb(166, 111, 0),
            bad: Color::Rgb(184, 35, 65),
            selected_bg: Color::Rgb(220, 237, 242),
        },
    }
}

fn render_top_bar(frame: &mut Frame, area: Rect, app: &App, p: &Palette) {
    let github = &app.snapshot.github;
    let ollama = &app.snapshot.ollama;
    let api = if github.online {
        format!("GH {}/{}", github.remaining, github.limit)
    } else {
        "GH offline".to_string()
    };
    let ai = if ollama.online {
        format!("AI {}ms", ollama.latency_ms.unwrap_or_default())
    } else {
        "AI offline".to_string()
    };
    let spinner = ["|", "/", "-", "\\"].get(app.spinner % 4).copied().unwrap_or("|");

    let title = Line::from(vec![
        Span::styled(" OpenLib Control Panel ", Style::default().fg(p.accent).add_modifier(Modifier::BOLD)),
        Span::styled(spinner, Style::default().fg(p.accent2)),
        Span::raw("  "),
        Span::styled(app.current_screen().title(), Style::default().fg(p.fg).add_modifier(Modifier::BOLD)),
        Span::raw("  "),
        Span::styled(api, Style::default().fg(if github.online { p.good } else { p.warn })),
        Span::raw("  "),
        Span::styled(ai, Style::default().fg(if ollama.online { p.good } else { p.warn })),
        Span::raw("  "),
        Span::styled(format!("DB {}", human_bytes(app.snapshot.system.db_size_bytes)), Style::default().fg(p.muted)),
        Span::raw("  "),
        Span::styled(format!("age {}", app.refresh_age()), Style::default().fg(p.muted)),
    ]);

    frame.render_widget(
        Paragraph::new(title)
            .block(block(" control center ", p))
            .alignment(Alignment::Left),
        area,
    );
}

fn render_sidebar(frame: &mut Frame, area: Rect, app: &App, p: &Palette) {
    let rows = Screen::ALL
        .iter()
        .enumerate()
        .map(|(index, screen)| {
            let selected = index == app.screen_index;
            let style = if selected {
                Style::default().fg(p.accent).bg(p.selected_bg).add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(p.fg)
            };
            Line::from(vec![
                Span::styled(format!(" {} ", screen.icon()), Style::default().fg(if selected { p.accent2 } else { p.muted })),
                Span::styled(format!("{:<15}", screen.title()), style),
            ])
        })
        .collect::<Vec<_>>();

    frame.render_widget(
        Paragraph::new(rows)
            .block(block(" nav ", p))
            .style(Style::default().fg(p.fg))
            .wrap(Wrap { trim: true }),
        area,
    );
}

fn render_screen(frame: &mut Frame, area: Rect, app: &App, p: &Palette) {
    match app.current_screen() {
        Screen::Dashboard => render_dashboard(frame, area, app, p),
        Screen::Workers => render_workers(frame, area, app, p),
        Screen::Ai => render_ai(frame, area, app, p),
        Screen::Repositories => render_repositories(frame, area, app, p),
        Screen::Queue => render_queue(frame, area, app, p),
        Screen::Logs => render_logs(frame, area, app, p),
        Screen::Scheduler => render_scheduler(frame, area, app, p),
        Screen::Sync => render_sync(frame, area, app, p),
        Screen::System => render_system(frame, area, app, p),
        Screen::Config => render_config(frame, area, app, p),
        Screen::Plugins => render_plugins(frame, area, app, p),
    }
}

fn render_dashboard(frame: &mut Frame, area: Rect, app: &App, p: &Palette) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(8), Constraint::Min(8)])
        .split(area);
    let metrics = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage(25),
            Constraint::Percentage(25),
            Constraint::Percentage(25),
            Constraint::Percentage(25),
        ])
        .split(chunks[0]);

    let d = &app.snapshot.dashboard;
    let q = &app.snapshot.queues;
    metric(frame, metrics[0], "repositories", d.total_repositories.to_string(), "discovered", p.accent, p);
    metric(frame, metrics[1], "moderation", d.pending_moderation.to_string(), "pending review", p.warn, p);
    metric(frame, metrics[2], "approved", d.approved_apps.to_string(), "ready for sync", p.good, p);
    metric(frame, metrics[3], "failures", d.failed_jobs.to_string(), "needs attention", if d.failed_jobs > 0 { p.bad } else { p.good }, p);

    let lower = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(46), Constraint::Percentage(54)])
        .split(chunks[1]);

    let queue_lines = vec![
        Line::from(vec![Span::styled("AI queue      ", Style::default().fg(p.muted)), Span::styled(format!("{} pending / {} running / {} failed", q.ai_pending, q.ai_processing, q.ai_failed), Style::default().fg(p.fg))]),
        Line::from(vec![Span::styled("Sync queue    ", Style::default().fg(p.muted)), Span::styled(format!("{} pending / {} failed / {} done", q.sync_pending, q.sync_failed, q.sync_completed), Style::default().fg(p.fg))]),
        Line::from(vec![Span::styled("Updates       ", Style::default().fg(p.muted)), Span::styled(format!("{} pending", q.update_pending), Style::default().fg(p.fg))]),
        Line::from(vec![Span::styled("Screenshots   ", Style::default().fg(p.muted)), Span::styled(format!("{} pending", q.screenshot_pending), Style::default().fg(p.fg))]),
        Line::from(""),
        Line::from(vec![Span::styled("Throughput    ", Style::default().fg(p.muted)), Span::styled(format!("{} events/hour, {} accepted", d.throughput_hour, d.accepted_hour), Style::default().fg(p.accent))]),
        Line::from(vec![Span::styled("Last crawl    ", Style::default().fg(p.muted)), Span::raw(short_opt(d.last_crawl_at.as_deref()))]),
        Line::from(vec![Span::styled("Workers       ", Style::default().fg(p.muted)), Span::raw(format!("{} active", d.active_workers))]),
    ];
    frame.render_widget(Paragraph::new(queue_lines).block(block(" live operations ", p)), lower[0]);

    render_activity_table(frame, lower[1], app, p);
}

fn metric(frame: &mut Frame, area: Rect, title: &str, value: String, label: &str, color: Color, p: &Palette) {
    let lines = vec![
        Line::from(Span::styled(value, Style::default().fg(color).add_modifier(Modifier::BOLD))),
        Line::from(Span::styled(label, Style::default().fg(p.muted))),
    ];
    frame.render_widget(
        Paragraph::new(lines)
            .block(block(title, p))
            .alignment(Alignment::Center),
        area,
    );
}

fn render_activity_table(frame: &mut Frame, area: Rect, app: &App, p: &Palette) {
    let rows = app.snapshot.activity.iter().take(12).map(|item| {
        Row::new(vec![
            Cell::from(short_time(&item.at)),
            Cell::from(item.status.clone()).style(status_style(&item.status, p)),
            Cell::from(truncate(&item.repo, 36)),
            Cell::from(truncate(&item.message, 48)),
        ])
    });
    let table = Table::new(
        rows,
        [
            Constraint::Length(9),
            Constraint::Length(13),
            Constraint::Percentage(36),
            Constraint::Percentage(42),
        ],
    )
    .header(header(["time", "status", "repository", "message"], p))
    .block(block(" crawler activity ", p));
    frame.render_widget(table, area);
}

fn render_workers(frame: &mut Frame, area: Rect, app: &App, p: &Palette) {
    let rows = app.snapshot.workers.iter().enumerate().map(|(index, worker)| {
        let selected = index == app.selected_worker;
        let mut row = Row::new(vec![
            Cell::from(worker.kind.label()),
            Cell::from(if worker.running { "running" } else { "idle" }).style(if worker.running { Style::default().fg(p.good) } else { Style::default().fg(p.muted) }),
            Cell::from(worker.pid.map(|pid| pid.to_string()).unwrap_or_else(|| "-".to_string())),
            Cell::from(worker.health.clone()),
            Cell::from(worker.restarts.to_string()),
            Cell::from(truncate(&worker.command, 40)),
            Cell::from(worker.last_exit.clone().unwrap_or_default()),
        ]);
        if selected {
            row = row.style(selected_style(p));
        }
        row
    });

    frame.render_widget(
        Table::new(
            rows,
            [
                Constraint::Length(13),
                Constraint::Length(10),
                Constraint::Length(8),
                Constraint::Length(12),
                Constraint::Length(8),
                Constraint::Percentage(35),
                Constraint::Percentage(25),
            ],
        )
        .header(header(["worker", "state", "pid", "health", "starts", "command", "last exit"], p))
        .block(block(" worker manager  s=start x=stop R=restart ", p)),
        area,
    );
}

fn render_ai(frame: &mut Frame, area: Rect, app: &App, p: &Palette) {
    let chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(42), Constraint::Percentage(58)])
        .split(area);
    let left = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(9), Constraint::Min(8)])
        .split(chunks[0]);

    let ai = &app.snapshot.ollama;
    let status = vec![
        Line::from(vec![Span::styled("Status       ", Style::default().fg(p.muted)), Span::styled(if ai.online { "online" } else { "offline" }, Style::default().fg(if ai.online { p.good } else { p.warn }))]),
        Line::from(vec![Span::styled("Endpoint     ", Style::default().fg(p.muted)), Span::raw(ai.base_url.clone())]),
        Line::from(vec![Span::styled("Model        ", Style::default().fg(p.muted)), Span::raw(ai.selected_model.clone())]),
        Line::from(vec![Span::styled("Process      ", Style::default().fg(p.muted)), Span::raw(if ai.process_running { format!("running pid {}", ai.pid.unwrap_or_default()) } else { "not tracked".to_string() })]),
        Line::from(vec![Span::styled("Latency      ", Style::default().fg(p.muted)), Span::raw(ai.latency_ms.map(|ms| format!("{ms} ms")).unwrap_or_else(|| "-".to_string()))]),
        Line::from(vec![Span::styled("Queue        ", Style::default().fg(p.muted)), Span::raw(format!("{} pending / {} processing / {} failed", app.snapshot.queues.ai_pending, app.snapshot.queues.ai_processing, app.snapshot.queues.ai_failed))]),
    ];
    frame.render_widget(Paragraph::new(status).block(block(" ollama status ", p)), left[0]);

    let model_rows = ai.models.iter().map(|model| {
        Row::new(vec![
            Cell::from(model.name.clone()),
            Cell::from(model.size_bytes.map(human_bytes).unwrap_or_else(|| "-".to_string())),
            Cell::from(model.modified_at.clone().unwrap_or_default()),
        ])
    });
    frame.render_widget(
        Table::new(model_rows, [Constraint::Percentage(45), Constraint::Length(12), Constraint::Percentage(35)])
            .header(header(["model", "size", "modified"], p))
            .block(block(" installed models ", p)),
        left[1],
    );

    let preview = app
        .selected_repository()
        .map(|repo| {
            let estimated_tokens = (repo.readme_preview.len() / 4).max(1);
            vec![
                Line::from(vec![Span::styled(repo.full_name.clone(), Style::default().fg(p.accent).add_modifier(Modifier::BOLD))]),
                Line::from(vec![Span::styled("Score ", Style::default().fg(p.muted)), Span::raw(repo.quality_score.to_string()), Span::styled("  Status ", Style::default().fg(p.muted)), Span::raw(repo.status.clone())]),
                Line::from(vec![Span::styled("Estimated tokens ", Style::default().fg(p.muted)), Span::raw(estimated_tokens.to_string()), Span::styled("  Fallback ", Style::default().fg(p.muted)), Span::raw(if app.snapshot.ollama.online { "primary model" } else { "deferred/offline" })]),
                Line::from(""),
                Line::from(truncate(&repo.short_description, 120)),
                Line::from(""),
                Line::from(truncate(&repo.readme_preview.replace('\n', " "), 800)),
            ]
        })
        .unwrap_or_else(|| vec![Line::from("No repository selected")]);
    frame.render_widget(
        Paragraph::new(preview)
            .block(block(" enrichment preview ", p))
            .wrap(Wrap { trim: true }),
        chunks[1],
    );
}

fn render_repositories(frame: &mut Frame, area: Rect, app: &App, p: &Palette) {
    let chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(66), Constraint::Percentage(34)])
        .split(area);
    let indexes = app.filtered_repo_indexes();
    let rows = indexes.iter().enumerate().map(|(visible_index, repo_index)| {
        let repo = &app.snapshot.repositories[*repo_index];
        let selected = visible_index == app.selected_repo;
        let mut row = Row::new(vec![
            Cell::from(repo.id.to_string()),
            Cell::from(truncate(&repo.full_name, 34)),
            Cell::from(repo.status.clone()).style(status_style(&repo.status, p)),
            Cell::from(repo.quality_score.to_string()),
            Cell::from(truncate(&repo.license, 12)),
            Cell::from(truncate(&repo.category, 16)),
            Cell::from(repo.stars.to_string()),
        ]);
        if selected {
            row = row.style(selected_style(p));
        }
        row
    });

    let title = if app.search_query.is_empty() {
        " repositories  a=approve d=reject n/e/y/u=edit ".to_string()
    } else {
        format!(" repositories  filter: {} ", app.search_query)
    };

    frame.render_widget(
        Table::new(
            rows,
            [
                Constraint::Length(6),
                Constraint::Percentage(36),
                Constraint::Length(16),
                Constraint::Length(7),
                Constraint::Length(14),
                Constraint::Length(16),
                Constraint::Length(8),
            ],
        )
        .header(header(["id", "repository", "status", "score", "license", "category", "stars"], p))
        .block(block(title, p)),
        chunks[0],
    );

    let detail = app
        .selected_repository()
        .map(|repo| {
            vec![
                Line::from(Span::styled(repo.full_name.clone(), Style::default().fg(p.accent).add_modifier(Modifier::BOLD))),
                Line::from(""),
                kv("Name", &repo.name, p),
                kv("Status", &repo.status, p),
                kv("License", &repo.license, p),
                kv("Category", &repo.category, p),
                kv("Language", &repo.language, p),
                kv("Stars", &repo.stars.to_string(), p),
                kv("Screenshots", &repo.screenshot_count.to_string(), p),
                kv("Crawled", &short_opt(repo.last_crawled_at.as_deref()), p),
                kv("AI", &short_opt(repo.last_ai_at.as_deref()), p),
                kv("Synced", &short_opt(repo.last_synced_at.as_deref()), p),
                Line::from(""),
                Line::from(truncate(&repo.short_description, 400)),
                Line::from(""),
                Line::from(truncate(&repo.readme_preview.replace('\n', " "), 1000)),
            ]
        })
        .unwrap_or_else(|| vec![Line::from("No repository selected")]);

    frame.render_widget(
        Paragraph::new(detail)
            .block(block(" repository detail ", p))
            .wrap(Wrap { trim: true }),
        chunks[1],
    );
}

fn render_queue(frame: &mut Frame, area: Rect, app: &App, p: &Palette) {
    render_queue_table(frame, area, app, p, " queue management ");
}

fn render_logs(frame: &mut Frame, area: Rect, app: &App, p: &Palette) {
    let logs = app.visible_logs();
    let rows = logs.iter().rev().enumerate().map(|(index, line)| {
        let selected = index == app.selected_log;
        let mut row = Row::new(log_cells(line)).style(log_style(line, p));
        if selected {
            row = row.style(selected_style(p));
        }
        row
    });
    let title = format!(" logs  tab={}  [/] switch source  /=search ", app.active_log_tab());
    frame.render_widget(
        Table::new(
            rows,
            [
                Constraint::Length(9),
                Constraint::Length(9),
                Constraint::Length(8),
                Constraint::Percentage(70),
            ],
        )
        .header(header(["time", "source", "level", "message"], p))
        .block(block(title, p)),
        area,
    );
}

fn render_scheduler(frame: &mut Frame, area: Rect, app: &App, p: &Palette) {
    let rows = app.snapshot.schedules.iter().enumerate().map(|(index, job)| {
        let selected = index == app.selected_schedule;
        let mut row = Row::new(vec![
            Cell::from(job.name.clone()),
            Cell::from(job.worker.label()),
            Cell::from(format_duration(job.interval)),
            Cell::from(if job.enabled { "enabled" } else { "paused" }),
            Cell::from(job.status.clone()).style(if job.running { Style::default().fg(p.good) } else { Style::default().fg(p.muted) }),
            Cell::from(short_opt(job.last_run.as_deref())),
            Cell::from(short_opt(job.next_run.as_deref())),
        ]);
        if selected {
            row = row.style(selected_style(p));
        }
        row
    });
    frame.render_widget(
        Table::new(
            rows,
            [
                Constraint::Percentage(23),
                Constraint::Length(12),
                Constraint::Length(12),
                Constraint::Length(10),
                Constraint::Length(10),
                Constraint::Percentage(18),
                Constraint::Percentage(18),
            ],
        )
        .header(header(["job", "worker", "interval", "mode", "status", "last run", "next run"], p))
        .block(block(" scheduler manager  m=manual trigger p=pause/resume ", p)),
        area,
    );
}

fn render_sync(frame: &mut Frame, area: Rect, app: &App, p: &Palette) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(6), Constraint::Min(8)])
        .split(area);
    let connected = !app.config.sync.api_base_url.is_empty() && !app.config.sync.api_key.is_empty();
    let openlib = &app.snapshot.openlib;
    let lines = vec![
        Line::from(vec![Span::styled("OpenLib API   ", Style::default().fg(p.muted)), Span::raw(if app.config.sync.api_base_url.is_empty() { "not configured".to_string() } else { app.config.sync.api_base_url.clone() })]),
        Line::from(vec![Span::styled("Credentials   ", Style::default().fg(p.muted)), Span::styled(if app.config.sync.api_key.is_empty() { "missing" } else { "present" }, Style::default().fg(if connected { p.good } else { p.warn }))]),
        Line::from(vec![Span::styled("Connectivity  ", Style::default().fg(p.muted)), Span::styled(if openlib.online { "online" } else if openlib.configured { "offline" } else { "not configured" }, Style::default().fg(if openlib.online { p.good } else { p.warn })), Span::raw(format!("  status={} latency={}", openlib.status_code.map(|code| code.to_string()).unwrap_or_else(|| "-".to_string()), openlib.latency_ms.map(|ms| format!("{ms}ms")).unwrap_or_else(|| "-".to_string())))]),
        Line::from(vec![Span::styled("Queue         ", Style::default().fg(p.muted)), Span::raw(format!("{} pending / {} failed / {} complete", app.snapshot.queues.sync_pending, app.snapshot.queues.sync_failed, app.snapshot.queues.sync_completed))]),
    ];
    frame.render_widget(Paragraph::new(lines).block(block(" sync management ", p)), chunks[0]);
    render_queue_table(frame, chunks[1], app, p, " sync queue ");
}

fn render_system(frame: &mut Frame, area: Rect, app: &App, p: &Palette) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(8), Constraint::Min(8)])
        .split(area);
    let gauges = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(25), Constraint::Percentage(25), Constraint::Percentage(25), Constraint::Percentage(25)])
        .split(chunks[0]);
    let sys = &app.snapshot.system;
    gauge(frame, gauges[0], "CPU", f64::from(sys.cpu_percent) / 100.0, format!("{:.1}%", sys.cpu_percent), p.accent, p);
    gauge(frame, gauges[1], "RAM", ratio(sys.memory_used_bytes, sys.memory_total_bytes), format!("{} / {}", human_bytes(sys.memory_used_bytes), human_bytes(sys.memory_total_bytes)), p.good, p);
    gauge(frame, gauges[2], "Swap", ratio(sys.swap_used_bytes, sys.swap_total_bytes), format!("{} / {}", human_bytes(sys.swap_used_bytes), human_bytes(sys.swap_total_bytes)), p.warn, p);
    gauge(frame, gauges[3], "SQLite", 0.0, human_bytes(sys.db_size_bytes), p.accent2, p);

    let disk_rows = sys.disks.iter().take(8).map(|disk| {
        let used = disk.total_bytes.saturating_sub(disk.available_bytes);
        Row::new(vec![
            Cell::from(truncate(&disk.mount, 32)),
            Cell::from(human_bytes(used)),
            Cell::from(human_bytes(disk.total_bytes)),
            Cell::from(format!("{:.1}%", ratio(used, disk.total_bytes) * 100.0)),
        ])
    });
    let lower = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(58), Constraint::Percentage(42)])
        .split(chunks[1]);
    frame.render_widget(
        Table::new(disk_rows, [Constraint::Percentage(45), Constraint::Length(12), Constraint::Length(12), Constraint::Length(8)])
            .header(header(["mount", "used", "total", "pct"], p))
            .block(block(" disks ", p)),
        lower[0],
    );
    let lines = vec![
        kv("Load", &format!("{:.2} {:.2} {:.2}", sys.load_one, sys.load_five, sys.load_fifteen), p),
        kv("Network RX", &human_bytes(sys.network.rx_bytes), p),
        kv("Network TX", &human_bytes(sys.network.tx_bytes), p),
        kv("Ollama", if app.snapshot.ollama.process_running { "process tracked" } else { "not tracked" }, p),
        kv("Database", &human_bytes(sys.db_size_bytes), p),
    ];
    frame.render_widget(Paragraph::new(lines).block(block(" host telemetry ", p)), lower[1]);
}

fn render_config(frame: &mut Frame, area: Rect, app: &App, p: &Palette) {
    let rows = app.config_entries.iter().enumerate().map(|(index, entry)| {
        let value = if entry.secret && !entry.value.is_empty() {
            "********".to_string()
        } else {
            truncate(&entry.value, 44)
        };
        let mut row = Row::new(vec![
            Cell::from(entry.key.clone()),
            Cell::from(value),
            Cell::from(entry.description.clone()),
        ]);
        if index == app.selected_config {
            row = row.style(selected_style(p));
        }
        row
    });
    frame.render_widget(
        Table::new(
            rows,
            [Constraint::Percentage(28), Constraint::Percentage(32), Constraint::Percentage(40)],
        )
        .header(header(["key", "value", "description"], p))
        .block(block(" configuration  enter=edit .env ", p)),
        area,
    );
}

fn render_plugins(frame: &mut Frame, area: Rect, _app: &App, p: &Palette) {
    let rows = [
        ("panel.dashboard", "enabled", "core metrics and activity widgets"),
        ("panel.workers", "enabled", "worker command registry"),
        ("panel.repositories", "enabled", "moderation and metadata editor"),
        ("panel.ai", "enabled", "Ollama model monitor"),
        ("panel.sync", "enabled", "OpenLib queue adapter"),
        ("future.plugins", "planned", "dynamic panel registration and feature flags"),
    ]
    .into_iter()
    .map(|(name, status, detail)| Row::new(vec![Cell::from(name), Cell::from(status), Cell::from(detail)]));
    frame.render_widget(
        Table::new(rows, [Constraint::Percentage(28), Constraint::Length(12), Constraint::Percentage(60)])
            .header(header(["module", "state", "purpose"], p))
            .block(block(" plugin-friendly registry ", p)),
        area,
    );
}

fn render_queue_table(frame: &mut Frame, area: Rect, app: &App, p: &Palette, title: impl Into<String>) {
    let rows = app.snapshot.queue_items.iter().enumerate().map(|(index, item)| {
        let selected = index == app.selected_queue;
        let mut row = queue_row(item, p);
        if selected {
            row = row.style(selected_style(p));
        }
        row
    });
    frame.render_widget(
        Table::new(
            rows,
            [
                Constraint::Length(7),
                Constraint::Length(7),
                Constraint::Length(8),
                Constraint::Length(14),
                Constraint::Length(8),
                Constraint::Percentage(40),
                Constraint::Percentage(22),
            ],
        )
        .header(header(["id", "queue", "app", "status", "tries", "error", "updated"], p))
        .block(block(title, p)),
        area,
    );
}

fn render_bottom_logs(frame: &mut Frame, area: Rect, app: &App, p: &Palette) {
    let rows = app.visible_logs().into_iter().rev().take(area.height.saturating_sub(3) as usize).map(|line| {
        Row::new(log_cells(line)).style(log_style(line, p))
    });
    frame.render_widget(
        Table::new(
            rows,
            [
                Constraint::Length(8),
                Constraint::Length(8),
                Constraint::Length(7),
                Constraint::Percentage(75),
            ],
        )
        .header(header(["time", "source", "level", "message"], p))
        .block(block(" live logs ", p)),
        area,
    );
}

fn render_command_bar(frame: &mut Frame, area: Rect, app: &App, p: &Palette) {
    let mode = match &app.input_mode {
        InputMode::Normal => "NORMAL".to_string(),
        InputMode::Search => format!("SEARCH /{}", app.search_query),
        InputMode::EditConfig { key, secret, value } => {
            let shown = if *secret { "*".repeat(value.len().min(24)) } else { value.clone() };
            format!("EDIT {key}={shown}")
        }
        InputMode::EditRepo { field, value, .. } => format!("EDIT {field}={}", truncate(value, 64)),
    };
    let line = Line::from(vec![
        Span::styled(format!(" {mode} "), Style::default().fg(p.bg).bg(p.accent).add_modifier(Modifier::BOLD)),
        Span::raw(" "),
        Span::styled("q quit  tab nav  j/k move  / search  r refresh  t theme  p pause  o export", Style::default().fg(p.muted)),
        Span::raw("  "),
        Span::styled(app.status_message.clone(), Style::default().fg(p.fg)),
    ]);
    frame.render_widget(Paragraph::new(line).style(Style::default().bg(p.bg)), area);
}

fn queue_row<'a>(item: &'a QueueItem, p: &Palette) -> Row<'a> {
    Row::new(vec![
        Cell::from(item.id.to_string()),
        Cell::from(item.queue.clone()),
        Cell::from(item.app_id.map(|id| id.to_string()).unwrap_or_else(|| "-".to_string())),
        Cell::from(item.status.clone()).style(status_style(&item.status, p)),
        Cell::from(item.attempts.to_string()),
        Cell::from(truncate(&item.last_error, 52)),
        Cell::from(short_opt(item.updated_at.as_deref())),
    ])
}

fn gauge(frame: &mut Frame, area: Rect, title: &str, ratio_value: f64, label: String, color: Color, p: &Palette) {
    frame.render_widget(
        Gauge::default()
            .block(block(title, p))
            .gauge_style(Style::default().fg(color).bg(p.selected_bg).add_modifier(Modifier::BOLD))
            .ratio(ratio_value.clamp(0.0, 1.0))
            .label(label),
        area,
    );
}

fn header<const N: usize>(labels: [&str; N], p: &Palette) -> Row<'static> {
    Row::new(
        labels
            .into_iter()
            .map(|label| Cell::from(label.to_string()).style(Style::default().fg(p.muted).add_modifier(Modifier::BOLD))),
    )
}

fn block<'a>(title: impl Into<String>, p: &Palette) -> Block<'a> {
    Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(p.border))
        .title(title.into())
        .style(Style::default().bg(p.bg).fg(p.fg))
}

fn kv(label: &str, value: &str, p: &Palette) -> Line<'static> {
    Line::from(vec![
        Span::styled(format!("{label:<12}"), Style::default().fg(p.muted)),
        Span::raw(value.to_string()),
    ])
}

fn log_cells(line: &LogLine) -> Vec<Cell<'static>> {
    vec![
        Cell::from(short_time(&line.at)),
        Cell::from(line.source.clone()),
        Cell::from(line.level.clone()),
        Cell::from(truncate(&line.message, 140)),
    ]
}

fn log_style(line: &LogLine, p: &Palette) -> Style {
    match line.level.as_str() {
        "error" => Style::default().fg(p.bad),
        "warn" => Style::default().fg(p.warn),
        "debug" => Style::default().fg(p.muted),
        _ => Style::default().fg(p.fg),
    }
}

fn status_style(status: &str, p: &Palette) -> Style {
    match status {
        "approved" | "published" | "completed" | "synced" | "pending" => Style::default().fg(p.good),
        "processing" | "discovered" => Style::default().fg(p.accent),
        "pending_duplicate" | "failed" => Style::default().fg(p.warn),
        "rejected" | "error" => Style::default().fg(p.bad),
        _ => Style::default().fg(p.fg),
    }
}

fn selected_style(p: &Palette) -> Style {
    Style::default().fg(p.accent).bg(p.selected_bg).add_modifier(Modifier::BOLD)
}

fn ratio(used: u64, total: u64) -> f64 {
    if total == 0 {
        0.0
    } else {
        used as f64 / total as f64
    }
}

fn human_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} {}", UNITS[unit])
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

fn short_time(value: &str) -> String {
    if value.len() >= 19 {
        value[11..19].to_string()
    } else {
        value.to_string()
    }
}

fn short_opt(value: Option<&str>) -> String {
    value.filter(|item| !item.is_empty()).map(short_time).unwrap_or_else(|| "-".to_string())
}

fn truncate(value: &str, max: usize) -> String {
    if value.chars().count() <= max {
        return value.to_string();
    }
    let mut output = value.chars().take(max.saturating_sub(1)).collect::<String>();
    output.push('~');
    output
}

fn format_duration(duration: std::time::Duration) -> String {
    let seconds = duration.as_secs();
    if seconds >= 86_400 {
        format!("{}d", seconds / 86_400)
    } else if seconds >= 3_600 {
        format!("{}h", seconds / 3_600)
    } else if seconds >= 60 {
        format!("{}m", seconds / 60)
    } else {
        format!("{seconds}s")
    }
}
