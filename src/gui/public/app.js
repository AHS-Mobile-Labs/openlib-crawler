const state = {
  view: "dashboard",
  apiKey: localStorage.getItem("openlibApiKey") || "",
  dashboard: null,
  jobs: null,
  scheduler: null,
  apps: [],
  appsTotal: 0,
  selectedApp: null,
  appFilter: "pending",
  appSearch: "",
  queues: null,
  files: [],
  logs: { files: [], file: "openlib-crawler.log", content: "" },
  env: null,
  telemetry: null,
  busy: false
};

const titles = {
  dashboard: ["Dashboard", "Local operations"],
  workers: ["Workers", "Job control"],
  apps: ["Apps", "Moderation"],
  queues: ["Queues", "Backlog"],
  data: ["Data", "Files and config"],
  system: ["System", "Telemetry"]
};

const root = document.getElementById("app-root");
const apiKeyInput = document.getElementById("api-key");
apiKeyInput.value = state.apiKey;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function statusClass(value) {
  return String(value || "neutral").replace(/[^a-z0-9_-]/gi, "_");
}

function fmtNumber(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat().format(number);
}

function fmtBytes(value) {
  const number = Number(value || 0);
  if (!number) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(number) / Math.log(1024)), units.length - 1);
  return `${(number / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function fmtDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function setStatus(text, kind = "neutral") {
  const status = document.getElementById("connection-status");
  status.textContent = text;
  status.className = `pill ${kind}`;
}

function setBusy(busy) {
  state.busy = busy;
  document.querySelectorAll("button").forEach((button) => {
    if (!button.matches("[data-view]")) button.disabled = busy && button.dataset.keepEnabled !== "true";
  });
}

async function api(path, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.headers || {})
  };
  if (state.apiKey) headers["X-API-Key"] = state.apiKey;
  if (options.body !== undefined && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(options.body);
  }

  const response = await fetch(path, { ...options, headers });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const message = payload?.message || payload?.error || response.statusText;
    throw new Error(message);
  }
  return payload;
}

async function fetchBlob(path) {
  const headers = {};
  if (state.apiKey) headers["X-API-Key"] = state.apiKey;
  const response = await fetch(path, { headers });
  if (!response.ok) throw new Error(response.statusText);
  return response.blob();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function loadView() {
  setBusy(true);
  setStatus("Loading", "info");
  try {
    if (state.view === "dashboard") {
      state.dashboard = await api("/api/dashboard");
    }

    if (state.view === "workers") {
      const [jobs, scheduler] = await Promise.all([api("/api/jobs"), api("/api/scheduler")]);
      state.jobs = jobs;
      state.scheduler = scheduler;
    }

    if (state.view === "apps") {
      const query = new URLSearchParams({
        status: state.appFilter,
        q: state.appSearch,
        limit: "80"
      });
      const payload = await api(`/api/apps?${query}`);
      state.apps = payload.apps || [];
      state.appsTotal = payload.total || 0;
      if (state.selectedApp) {
        const fresh = await api(`/api/apps/${state.selectedApp.id}`);
        state.selectedApp = fresh.app;
      } else if (state.apps.length) {
        const fresh = await api(`/api/apps/${state.apps[0].id}`);
        state.selectedApp = fresh.app;
      }
    }

    if (state.view === "queues") {
      const [sync, ai, update] = await Promise.all([
        api("/api/sync-queue?limit=100"),
        api("/api/ai-jobs?limit=100"),
        api("/api/update-jobs?limit=100")
      ]);
      state.queues = { sync: sync.queue || [], ai: ai.jobs || [], update: update.jobs || [] };
    }

    if (state.view === "data") {
      const [files, logs, env] = await Promise.all([
        api("/api/files"),
        api(`/api/logs?file=${encodeURIComponent(state.logs.file)}&lines=320`),
        api("/api/config/env")
      ]);
      state.files = files.files || [];
      state.logs = logs;
      state.env = env;
    }

    if (state.view === "system") {
      state.telemetry = await api("/api/telemetry");
    }

    setStatus("Ready", "good");
  } catch (err) {
    setStatus(err.message || "Error", "bad");
  } finally {
    setBusy(false);
    render();
  }
}

function render() {
  const [title, kicker] = titles[state.view];
  document.getElementById("view-title").textContent = title;
  document.getElementById("view-kicker").textContent = kicker;
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.view);
  });

  if (state.view === "dashboard") root.innerHTML = renderDashboard();
  if (state.view === "workers") root.innerHTML = renderWorkers();
  if (state.view === "apps") root.innerHTML = renderApps();
  if (state.view === "queues") root.innerHTML = renderQueues();
  if (state.view === "data") root.innerHTML = renderData();
  if (state.view === "system") root.innerHTML = renderSystem();
}

function renderDashboard() {
  const data = state.dashboard;
  if (!data) return loading();
  const statusChips = Object.entries(data.apps.by_status || {})
    .map(([status, count]) => `<span class="status ${statusClass(status)}">${escapeHtml(status)} ${fmtNumber(count)}</span>`)
    .join("");

  return `
    <div class="section">
      <div class="grid">
        ${metric("Apps", data.apps.total)}
        ${metric("Avg quality", data.apps.average_quality)}
        ${metric("Screenshots", data.tables.screenshots)}
        ${metric("Sync queue", queueTotal(data.queues.sync))}
      </div>
    </div>
    <div class="section">
      <div class="section-head">
        <h2>Status</h2>
        <span class="muted">Updated ${escapeHtml(fmtDate(data.apps.last_updated))}</span>
      </div>
      <div class="chips">${statusChips || '<span class="pill neutral">No apps</span>'}</div>
    </div>
    <div class="section grid two">
      <div class="card">
        <h2>Data Files</h2>
        <table>
          <tbody>
            ${fileRow("Database", data.files.database)}
            ${fileRow("Data", data.files.data)}
            ${fileRow("Logs", data.files.logs)}
            ${fileRow(".env", data.files.env)}
          </tbody>
        </table>
      </div>
      <div class="card">
        <h2>System</h2>
        <table>
          <tbody>
            <tr><td>Host</td><td>${escapeHtml(data.system.hostname)}</td></tr>
            <tr><td>Platform</td><td>${escapeHtml(data.system.platform)}</td></tr>
            <tr><td>CPU</td><td>${fmtNumber(data.system.cpu_count)}</td></tr>
            <tr><td>Memory</td><td>${fmtBytes(data.system.free_memory)} free of ${fmtBytes(data.system.total_memory)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
    <div class="section">
      <div class="section-head">
        <h2>Recent Crawl Logs</h2>
        <button class="secondary" data-view="data">Logs</button>
      </div>
      ${renderLogRows(data.recent_logs)}
    </div>
  `;
}

function metric(label, value) {
  return `
    <div class="metric">
      <span>${escapeHtml(label)}</span>
      <strong>${fmtNumber(value)}</strong>
    </div>
  `;
}

function queueTotal(queue) {
  return Object.values(queue || {}).reduce((sum, count) => sum + Number(count || 0), 0);
}

function fileRow(label, file) {
  const size = file.is_directory ? `${fmtNumber(file.files || 0)} files` : fmtBytes(file.size);
  return `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(file.path || "-")}</td><td class="nowrap">${size}</td></tr>`;
}

function renderLogRows(rows = []) {
  if (!rows.length) return '<div class="empty">No rows</div>';
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Time</th><th>Status</th><th>Repository</th><th>Message</th></tr></thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td class="nowrap">${escapeHtml(fmtDate(row.created_at))}</td>
              <td><span class="status ${statusClass(row.status)}">${escapeHtml(row.status)}</span></td>
              <td>${escapeHtml(row.repo_full_name || "-")}</td>
              <td>${escapeHtml(row.message || "")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderWorkers() {
  const jobs = state.jobs;
  if (!jobs) return loading();
  const scheduler = state.scheduler || {};

  return `
    <div class="section">
      <div class="section-head">
        <h2>Scheduler</h2>
        <div class="actions">
          <span class="pill ${scheduler.active ? "good" : "neutral"}">${scheduler.active ? "Running" : "Stopped"}</span>
          <button data-scheduler="start">Start</button>
          <button class="secondary" data-scheduler="start-now">Start and run</button>
          <button class="danger" data-scheduler="stop">Stop</button>
        </div>
      </div>
    </div>
    <div class="section worker-grid">
      ${(jobs.available || []).map((worker) => `
        <div class="card worker-card">
          <h3>${escapeHtml(worker.label)}</h3>
          <label for="limit-${worker.name}">Limit</label>
          <input id="limit-${worker.name}" type="number" min="1" max="1000" value="${escapeHtml(worker.default_limit)}">
          <button data-start-job="${worker.name}">Start</button>
          <span class="muted">${Math.round(worker.interval_ms / 60000)} min interval</span>
        </div>
      `).join("")}
    </div>
    <div class="section">
      <h2>Job Runs</h2>
      ${renderJobsTable(jobs.history || [])}
    </div>
  `;
}

function renderJobsTable(jobs) {
  if (!jobs.length) return '<div class="empty">No runs</div>';
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Worker</th><th>Status</th><th>Limit</th><th>Started</th><th>Duration</th><th>Result</th></tr></thead>
        <tbody>
          ${jobs.map((job) => `
            <tr>
              <td>${escapeHtml(job.label || job.name)}</td>
              <td><span class="status ${statusClass(job.status)}">${escapeHtml(job.status)}</span></td>
              <td>${fmtNumber(job.limit)}</td>
              <td>${escapeHtml(fmtDate(job.started_at))}</td>
              <td>${job.duration_ms ? `${Math.round(job.duration_ms / 1000)}s` : "-"}</td>
              <td><code>${escapeHtml(job.error || JSON.stringify(job.result || {}))}</code></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderApps() {
  return `
    <div class="section">
      <div class="toolbar">
        <select id="app-status">
          ${["pending", "all", "approved", "published", "rejected", "dead", "discovered"].map((status) => `
            <option value="${status}" ${state.appFilter === status ? "selected" : ""}>${status}</option>
          `).join("")}
        </select>
        <input id="app-search" type="search" value="${escapeHtml(state.appSearch)}" placeholder="Search">
        <button data-apply-app-filter>Apply</button>
        <span class="pill neutral">${fmtNumber(state.appsTotal)} rows</span>
      </div>
    </div>
    <div class="split">
      <div>
        ${renderAppsTable()}
      </div>
      <div>
        ${renderAppDetail()}
      </div>
    </div>
  `;
}

function renderAppsTable() {
  if (!state.apps.length) return '<div class="empty">No apps</div>';
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Status</th><th>Score</th><th>Category</th><th>Stars</th></tr></thead>
        <tbody>
          ${state.apps.map((app) => `
            <tr class="selectable" data-select-app="${app.id}">
              <td>
                <strong>${escapeHtml(app.name || app.github_full_name || `#${app.id}`)}</strong><br>
                <span class="muted">${escapeHtml(app.github_full_name || app.github_url || "")}</span>
              </td>
              <td><span class="status ${statusClass(app.status)}">${escapeHtml(app.status)}</span></td>
              <td>${fmtNumber(app.quality_score)}</td>
              <td>${escapeHtml(app.category || "-")}</td>
              <td>${fmtNumber(app.stars)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderAppDetail() {
  const app = state.selectedApp;
  if (!app) return '<div class="empty">No app selected</div>';
  const tags = Array.isArray(app.tags) ? app.tags.join(", ") : "";
  const features = Array.isArray(app.key_features) ? app.key_features.join("\n") : "";

  return `
    <form class="card" id="app-form">
      <div class="section-head">
        <div>
          <h2>${escapeHtml(app.name || `App #${app.id}`)}</h2>
          <span class="status ${statusClass(app.status)}">${escapeHtml(app.status)}</span>
        </div>
        <div class="actions">
          <button type="button" data-approve-app="${app.id}">Approve</button>
          <button type="button" class="danger" data-reject-app="${app.id}">Reject</button>
        </div>
      </div>
      ${app.duplicate_warning ? `<p class="pill warn">Duplicate: ${escapeHtml(app.duplicate_warning.name)} (${fmtNumber(app.duplicate_warning.score)})</p>` : ""}
      <div class="form-grid">
        ${inputField("name", "Name", app.name)}
        ${inputField("slug", "Slug", app.slug)}
        ${inputField("category", "Category", app.category)}
        ${inputField("license", "License", app.license)}
        ${inputField("quality_score", "Quality", app.quality_score, "number")}
        ${inputField("visibility", "Visibility", app.visibility)}
        ${inputField("website_url", "Website", app.website_url)}
        ${inputField("download_url", "Download", app.download_url)}
        ${inputField("docs_url", "Docs", app.docs_url)}
        ${inputField("readme_raw_url", "README Raw", app.readme_raw_url)}
        ${inputField("logo_url", "Logo", app.logo_url)}
        ${textareaField("short_description", "Short description", app.short_description, true)}
        ${textareaField("full_description", "Full description", app.full_description, true)}
        ${textareaField("uses", "Uses", app.uses, true)}
        ${textareaField("tags", "Tags", tags, true)}
        ${textareaField("key_features", "Key features", features, true)}
      </div>
      <div class="section">
        <h3>Screenshots</h3>
        <div class="screens">
          ${(app.screenshots_preview || []).map((shot) => `<img src="/screenshots/${shot.id}" alt="Screenshot">`).join("") || '<span class="muted">No screenshots</span>'}
        </div>
      </div>
      <div class="actions">
        <button type="submit">Save</button>
        <button type="button" class="secondary" data-queue-app="ai">Queue AI</button>
        <button type="button" class="secondary" data-queue-app="update">Queue update</button>
        <button type="button" class="secondary" data-queue-app="sync">Queue sync</button>
      </div>
      <p class="muted">${escapeHtml(app.github_url || "")}</p>
    </form>
  `;
}

function inputField(name, label, value, type = "text") {
  return `
    <div class="field">
      <label for="field-${name}">${escapeHtml(label)}</label>
      <input id="field-${name}" name="${escapeHtml(name)}" type="${type}" value="${escapeHtml(value ?? "")}">
    </div>
  `;
}

function textareaField(name, label, value, wide = false) {
  return `
    <div class="field ${wide ? "wide" : ""}">
      <label for="field-${name}">${escapeHtml(label)}</label>
      <textarea id="field-${name}" name="${escapeHtml(name)}">${escapeHtml(value ?? "")}</textarea>
    </div>
  `;
}

function parseListField(value) {
  const text = String(value || "").trim();
  if (!text) return [];
  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      return JSON.parse(text);
    } catch (err) {
      return text.split(/\n|,/).map((item) => item.trim()).filter(Boolean);
    }
  }
  return text.split(/\n|,/).map((item) => item.trim()).filter(Boolean);
}

function formToAppPayload(form) {
  const data = new FormData(form);
  const payload = {};
  for (const [key, value] of data.entries()) payload[key] = value;
  payload.quality_score = Number(payload.quality_score || 0);
  payload.tags = parseListField(payload.tags);
  payload.key_features = parseListField(payload.key_features);
  return payload;
}

function renderQueues() {
  const queues = state.queues;
  if (!queues) return loading();
  return `
    <div class="queue-grid">
      ${queueTable("Sync Queue", queues.sync, ["id", "app_id", "action", "status", "attempts", "last_error", "created_at"])}
      ${queueTable("AI Jobs", queues.ai, ["id", "app_id", "task", "status", "attempts", "last_error", "created_at"])}
      ${queueTable("Update Jobs", queues.update, ["id", "app_id", "job_type", "status", "attempts", "last_error", "created_at"])}
    </div>
  `;
}

function queueTable(title, rows, columns) {
  return `
    <div class="section">
      <h2>${escapeHtml(title)}</h2>
      ${rows.length ? `
        <div class="table-wrap">
          <table>
            <thead><tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead>
            <tbody>
              ${rows.map((row) => `
                <tr>
                  ${columns.map((column) => {
                    const value = column.endsWith("_at") ? fmtDate(row[column]) : row[column];
                    const cell = column === "status"
                      ? `<span class="status ${statusClass(row[column])}">${escapeHtml(row[column])}</span>`
                      : escapeHtml(value ?? "-");
                    return `<td>${cell}</td>`;
                  }).join("")}
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      ` : '<div class="empty">No rows</div>'}
    </div>
  `;
}

function renderData() {
  const files = state.files || [];
  return `
    <div class="section">
      <div class="actions">
        <button data-export-apps="json">Export JSON</button>
        <button class="secondary" data-export-apps="csv">Export CSV</button>
      </div>
    </div>
    <div class="file-grid">
      <div class="queue-grid">
        <div class="section">
          <h2>Files</h2>
          ${files.length ? `
            <div class="table-wrap">
              <table>
                <thead><tr><th>Name</th><th>Path</th><th>Type</th><th>Size</th><th>Modified</th><th></th></tr></thead>
                <tbody>
                  ${files.map((file) => `
                    <tr>
                      <td>${escapeHtml(file.name)}</td>
                      <td>${escapeHtml(file.path)}</td>
                      <td>${escapeHtml(file.type)}</td>
                      <td>${file.size === null ? "-" : fmtBytes(file.size)}</td>
                      <td>${escapeHtml(fmtDate(file.modified_at))}</td>
                      <td>${file.downloadable ? `<button class="secondary" data-download-file="${escapeHtml(file.path)}">Download</button>` : ""}</td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          ` : '<div class="empty">No files</div>'}
        </div>
        <div class="section">
          <div class="section-head">
            <h2>Logs</h2>
            <select id="log-file">
              ${(state.logs.files || []).map((file) => `
                <option value="${escapeHtml(file.name)}" ${state.logs.file === file.name ? "selected" : ""}>${escapeHtml(file.name)}</option>
              `).join("")}
            </select>
          </div>
          <pre>${escapeHtml(state.logs.content || "")}</pre>
        </div>
      </div>
      <form class="card" id="env-form">
        <div class="section-head">
          <h2>.env</h2>
          <span class="muted">${escapeHtml(fmtDate(state.env?.stat?.modified_at))}</span>
        </div>
        <textarea class="codebox" name="content">${escapeHtml(state.env?.content || "")}</textarea>
        <div class="actions">
          <button type="submit">Save</button>
          <button type="button" class="secondary" data-download-file=".env">Download</button>
        </div>
      </form>
    </div>
  `;
}

function renderSystem() {
  const telemetry = state.telemetry;
  if (!telemetry) return loading();
  const github = telemetry.github || {};
  const ollama = telemetry.ollama || {};
  const githubCore = github.body?.resources?.core;
  const ollamaModels = Array.isArray(ollama.body?.models) ? ollama.body.models : [];

  return `
    <div class="grid two">
      <div class="card">
        <h2>Runtime</h2>
        <table>
          <tbody>
            <tr><td>PID</td><td>${fmtNumber(telemetry.system.pid)}</td></tr>
            <tr><td>Node uptime</td><td>${fmtNumber(telemetry.system.process_uptime_seconds)}s</td></tr>
            <tr><td>OS uptime</td><td>${fmtNumber(telemetry.system.uptime_seconds)}s</td></tr>
            <tr><td>Load</td><td>${telemetry.system.load_average.map((value) => Number(value).toFixed(2)).join(" / ")}</td></tr>
            <tr><td>Memory</td><td>${fmtBytes(telemetry.system.free_memory)} free of ${fmtBytes(telemetry.system.total_memory)}</td></tr>
          </tbody>
        </table>
      </div>
      <div class="card">
        <h2>Paths</h2>
        <table>
          <tbody>
            ${Object.entries(telemetry.system.paths || {}).map(([key, value]) => `
              <tr><td>${escapeHtml(key)}</td><td>${escapeHtml(value)}</td></tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      <div class="card">
        <h2>GitHub</h2>
        <table>
          <tbody>
            <tr><td>Status</td><td><span class="pill ${github.ok ? "good" : "warn"}">${github.ok ? "Online" : "Unavailable"}</span></td></tr>
            <tr><td>Token</td><td>${github.configured ? "configured" : "not set"}</td></tr>
            <tr><td>Remaining</td><td>${githubCore ? fmtNumber(githubCore.remaining) : "-"}</td></tr>
            <tr><td>Reset</td><td>${githubCore ? fmtDate(githubCore.reset * 1000) : "-"}</td></tr>
          </tbody>
        </table>
      </div>
      <div class="card">
        <h2>Ollama</h2>
        <table>
          <tbody>
            <tr><td>Status</td><td><span class="pill ${ollama.ok ? "good" : "warn"}">${ollama.ok ? "Online" : "Unavailable"}</span></td></tr>
            <tr><td>Models</td><td>${ollamaModels.length ? ollamaModels.map((model) => escapeHtml(model.name)).join(", ") : "-"}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function loading() {
  return '<div class="empty">Loading</div>';
}

document.addEventListener("click", async (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    state.view = viewButton.dataset.view;
    state.selectedApp = state.view === "apps" ? state.selectedApp : null;
    render();
    await loadView();
    return;
  }

  if (event.target.closest("[data-refresh]")) {
    await loadView();
    return;
  }

  if (event.target.closest("[data-save-api-key]")) {
    state.apiKey = apiKeyInput.value.trim();
    localStorage.setItem("openlibApiKey", state.apiKey);
    setStatus("Saved", "good");
    await loadView();
    return;
  }

  const startJob = event.target.closest("[data-start-job]");
  if (startJob) {
    const name = startJob.dataset.startJob;
    const limit = Number(document.getElementById(`limit-${name}`)?.value || 0);
    setStatus(`Starting ${name}`, "info");
    await api(`/api/jobs/${name}/start`, { method: "POST", body: { limit } });
    await loadView();
    return;
  }

  const scheduler = event.target.closest("[data-scheduler]");
  if (scheduler) {
    const action = scheduler.dataset.scheduler;
    const path = action === "stop" ? "/api/scheduler/stop" : "/api/scheduler/start";
    await api(path, { method: "POST", body: { run_now: action === "start-now" } });
    await loadView();
    return;
  }

  if (event.target.closest("[data-apply-app-filter]")) {
    state.appFilter = document.getElementById("app-status").value;
    state.appSearch = document.getElementById("app-search").value;
    state.selectedApp = null;
    await loadView();
    return;
  }

  const appRow = event.target.closest("[data-select-app]");
  if (appRow) {
    const payload = await api(`/api/apps/${appRow.dataset.selectApp}`);
    state.selectedApp = payload.app;
    render();
    return;
  }

  const approveButton = event.target.closest("[data-approve-app]");
  if (approveButton) {
    await api(`/api/apps/${approveButton.dataset.approveApp}/approve`, { method: "POST" });
    await loadView();
    return;
  }

  const rejectButton = event.target.closest("[data-reject-app]");
  if (rejectButton) {
    const reason = window.prompt("Reject reason", "moderator_rejected") || "moderator_rejected";
    await api(`/api/apps/${rejectButton.dataset.rejectApp}/reject`, { method: "POST", body: { reason } });
    await loadView();
    return;
  }

  const queueButton = event.target.closest("[data-queue-app]");
  if (queueButton && state.selectedApp) {
    await api(`/api/apps/${state.selectedApp.id}/queue/${queueButton.dataset.queueApp}`, { method: "POST" });
    await loadView();
    return;
  }

  const downloadButton = event.target.closest("[data-download-file]");
  if (downloadButton) {
    const filePath = downloadButton.dataset.downloadFile;
    const blob = await fetchBlob(`/api/files/download?path=${encodeURIComponent(filePath)}`);
    downloadBlob(blob, filePath.split("/").pop() || "download");
    return;
  }

  const exportButton = event.target.closest("[data-export-apps]");
  if (exportButton) {
    const format = exportButton.dataset.exportApps;
    const blob = await fetchBlob(`/api/export/apps?format=${format}`);
    downloadBlob(blob, `openlib-apps.${format}`);
  }
});

document.addEventListener("submit", async (event) => {
  if (event.target.id === "app-form") {
    event.preventDefault();
    if (!state.selectedApp) return;
    await api(`/api/apps/${state.selectedApp.id}`, {
      method: "PUT",
      body: formToAppPayload(event.target)
    });
    await loadView();
  }

  if (event.target.id === "env-form") {
    event.preventDefault();
    const content = new FormData(event.target).get("content");
    await api("/api/config/env", {
      method: "PUT",
      body: { content }
    });
    await loadView();
  }
});

document.addEventListener("change", async (event) => {
  if (event.target.id === "log-file") {
    state.logs.file = event.target.value;
    await loadView();
  }
});

document.addEventListener("keydown", async (event) => {
  if (event.target.id === "app-search" && event.key === "Enter") {
    state.appSearch = event.target.value;
    state.appFilter = document.getElementById("app-status").value;
    state.selectedApp = null;
    await loadView();
  }
});

render();
loadView();
