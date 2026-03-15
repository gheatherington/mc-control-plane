import React, { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";

type DashboardResponse = {
  logs: string[];
  players: {
    known: number;
    online: number;
  };
  server: {
    difficulty: string;
    healthy: string;
    managementPort: string;
    maxPlayers: number;
    motd: string;
    onlineMode: boolean;
    port: number;
    status: string;
    version: string;
    whitelistEnabled: boolean;
  };
};

type PlayerState = {
  banned: boolean;
  online: boolean;
  op: boolean;
  whitelist: boolean;
  name: string;
  uuid?: string;
};

type PlayersResponse = {
  bannedIps: Array<{ name: string }>;
  ops: string[];
  players: PlayerState[];
  whitelist: string[];
};

type SettingValue = boolean | number | string;

type Setting = {
  applyMode: "live-and-persisted" | "restart-required";
  description: string;
  key: string;
  label: string;
  options?: string[];
  restartRequired: boolean;
  type: "boolean" | "enum" | "integer" | "string";
  value: SettingValue;
};

type SettingsGroup = {
  description: string;
  id: string;
  settings: Setting[];
  title: string;
};

type SettingsResponse = {
  groups: SettingsGroup[];
  pendingRestart: {
    keys: string[];
    required: boolean;
    updatedAt: string | null;
  };
  serverRunning: boolean;
};

type AuditEntry = {
  action: string;
  actor: string;
  ip: string;
  method: string;
  path: string;
  status: number;
  timestamp: string;
};

type AuditResponse = {
  entries: AuditEntry[];
  page: number;
  pageSize: number;
  summary: {
    actions: Record<string, number>;
    methods: Record<string, number>;
    statuses: Record<string, number>;
    totalEntries: number;
    filteredEntries: number;
  };
  totalPages: number;
};

const flattenSettings = (groups: SettingsGroup[]) => groups.flatMap((group) => group.settings);

const toDraftValue = (value: SettingValue) => typeof value === "boolean" ? String(value) : String(value);

const formatCountMap = (counts: Record<string, number>) => Object.entries(counts)
  .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
  .slice(0, 4)
  .map(([key, count]) => `${key}: ${count}`)
  .join(" | ");

const Page = ({ title, description }: { title: string; description: string }) => (
  <section className="panel-card">
    <p className="eyebrow">{title}</p>
    <h1>{title}</h1>
    <p className="body-copy">{description}</p>
  </section>
);

const LogViewer = ({ logs }: { logs: string[] }) => {
  const logRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    if (!logRef.current) {
      return;
    }

    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  return <pre className="log-block" ref={logRef}>{logs.join("\n")}</pre>;
};

const DashboardPage = () => {
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [broadcast, setBroadcast] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  const load = async () => {
    const response = await fetch("/api/dashboard");
    const data = await response.json();
    setDashboard(data);
  };

  useEffect(() => {
    let active = true;
    const safeLoad = async () => {
      const response = await fetch("/api/dashboard");
      const data = await response.json();
      if (active) {
        setDashboard(data);
      }
    };

    void safeLoad();
    const timer = window.setInterval(() => void load(), 3000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const runServerAction = async (endpoint: string, body?: Record<string, string>) => {
    setPending(endpoint);
    const response = await fetch(endpoint, {
      body: body ? JSON.stringify(body) : undefined,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      method: "POST"
    });
    const data = await response.json();
    setPending(null);
    setBroadcast("");
    setDashboard("dashboard" in data ? data.dashboard : data);
  };

  if (!dashboard) {
    return <Page description="Loading live server state..." title="Dashboard" />;
  }

  return (
    <section className="dashboard-grid settings-grid">
      <article className="panel-card">
        <p className="eyebrow">Live Server</p>
        <h1>{dashboard.server.status}</h1>
        <div className="metric-grid">
          <div><span className="metric-label">Health</span><strong>{dashboard.server.healthy}</strong></div>
          <div><span className="metric-label">Minecraft</span><strong>{dashboard.server.version}</strong></div>
          <div><span className="metric-label">Port</span><strong>{dashboard.server.port}</strong></div>
          <div><span className="metric-label">Management</span><strong>{dashboard.server.managementPort}</strong></div>
          <div><span className="metric-label">Players</span><strong>{dashboard.players.online}/{dashboard.server.maxPlayers}</strong></div>
          <div><span className="metric-label">Known Players</span><strong>{dashboard.players.known}</strong></div>
        </div>
        <p className="body-copy">MOTD: {dashboard.server.motd}</p>
        <div className="action-grid">
          <button className="primary-button" disabled={!!pending} onClick={() => void runServerAction("/api/server/start")} type="button">Start</button>
          <button className="secondary-button" disabled={!!pending} onClick={() => void runServerAction("/api/server/stop")} type="button">Stop</button>
          <button className="primary-button" disabled={!!pending} onClick={() => void runServerAction("/api/server/restart")} type="button">Restart</button>
          <button className="secondary-button" disabled={!!pending} onClick={() => void runServerAction("/api/server/save")} type="button">Save World</button>
        </div>
      </article>
      <article className="panel-card">
        <p className="eyebrow">Gameplay Settings</p>
        <h1>Current Runtime</h1>
        <div className="metric-grid">
          <div><span className="metric-label">Difficulty</span><strong>{dashboard.server.difficulty}</strong></div>
          <div><span className="metric-label">Online Mode</span><strong>{dashboard.server.onlineMode ? "Enabled" : "Disabled"}</strong></div>
          <div><span className="metric-label">Whitelist</span><strong>{dashboard.server.whitelistEnabled ? "Enabled" : "Disabled"}</strong></div>
        </div>
        <div className="player-form">
          <input onChange={(event) => setBroadcast(event.target.value)} placeholder="Broadcast message" value={broadcast} />
        </div>
        <button className="primary-button" disabled={!broadcast || !!pending} onClick={() => void runServerAction("/api/server/broadcast", { message: broadcast })} type="button">
          Broadcast
        </button>
      </article>
      <article className="panel-card logs-card settings-summary-card">
        <p className="eyebrow">Recent Logs</p>
        <h1>Startup And Runtime</h1>
        <LogViewer logs={dashboard.logs} />
      </article>
    </section>
  );
};

const PlayersPage = () => {
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [playersState, setPlayersState] = useState<PlayersResponse | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const loadPlayers = async () => {
    const response = await fetch("/api/players");
    const data = await response.json();
    setPlayersState(data);
  };

  useEffect(() => {
    void loadPlayers();
  }, []);

  const submit = async (endpoint: string, options: RequestInit = {}) => {
    setPendingAction(endpoint);
    const response = await fetch(endpoint, {
      headers: {
        "Content-Type": "application/json"
      },
      ...options
    });
    const data = await response.json();
    setPlayersState(data);
    setPendingAction(null);
    setName("");
    setReason("");
  };

  const players = useMemo(() => playersState?.players || [], [playersState]);

  return (
    <section className="dashboard-grid">
      <article className="panel-card">
        <p className="eyebrow">Player Management</p>
        <h1>Directory</h1>
        <p className="body-copy">Use exact Minecraft usernames for operator, whitelist, ban, and kick actions.</p>
        <div className="player-form">
          <input onChange={(event) => setName(event.target.value)} placeholder="Player name" value={name} />
          <input onChange={(event) => setReason(event.target.value)} placeholder="Kick reason (optional)" value={reason} />
        </div>
        <div className="action-grid">
          <button className="primary-button" disabled={!name || !!pendingAction} onClick={() => void submit("/api/players/whitelist", { body: JSON.stringify({ name }), method: "POST" })} type="button">Whitelist</button>
          <button className="secondary-button" disabled={!name || !!pendingAction} onClick={() => void submit(`/api/players/whitelist/${encodeURIComponent(name)}`, { method: "DELETE" })} type="button">Remove Whitelist</button>
          <button className="primary-button" disabled={!name || !!pendingAction} onClick={() => void submit("/api/players/ops", { body: JSON.stringify({ name }), method: "POST" })} type="button">Op</button>
          <button className="secondary-button" disabled={!name || !!pendingAction} onClick={() => void submit(`/api/players/ops/${encodeURIComponent(name)}`, { method: "DELETE" })} type="button">Deop</button>
          <button className="primary-button" disabled={!name || !!pendingAction} onClick={() => void submit("/api/players/bans", { body: JSON.stringify({ name }), method: "POST" })} type="button">Ban</button>
          <button className="secondary-button" disabled={!name || !!pendingAction} onClick={() => void submit(`/api/players/bans/${encodeURIComponent(name)}`, { method: "DELETE" })} type="button">Pardon</button>
          <button className="secondary-button" disabled={!name || !!pendingAction} onClick={() => void submit("/api/players/kick", { body: JSON.stringify({ name, reason }), method: "POST" })} type="button">Kick</button>
          <button className="secondary-button" disabled={!!pendingAction} onClick={() => void loadPlayers()} type="button">Refresh</button>
        </div>
      </article>
      <article className="panel-card">
        <p className="eyebrow">Known Players</p>
        <h1>{players.length}</h1>
        <div className="player-table">
          {players.map((player) => (
            <div className="player-row" key={player.name}>
              <div>
                <strong>{player.name}</strong>
                <div className="player-tags">
                  {player.online ? <span className="tag online">Online</span> : null}
                  {player.whitelist ? <span className="tag">Whitelist</span> : null}
                  {player.op ? <span className="tag">Op</span> : null}
                  {player.banned ? <span className="tag banned">Banned</span> : null}
                </div>
              </div>
              <span className="body-copy">{player.uuid || "No UUID yet"}</span>
            </div>
          ))}
          {players.length === 0 ? <p className="body-copy">No players recorded yet.</p> : null}
        </div>
      </article>
    </section>
  );
};

const ConsolePage = () => {
  const [command, setCommand] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [output, setOutput] = useState("");
  const [pending, setPending] = useState(false);

  const loadConsole = async () => {
    const response = await fetch("/api/console");
    const data = await response.json();
    setLogs(data.logs);
  };

  useEffect(() => {
    void loadConsole();
    const timer = window.setInterval(() => void loadConsole(), 3000);
    return () => window.clearInterval(timer);
  }, []);

  const runCommand = async () => {
    setPending(true);
    const response = await fetch("/api/console/command", {
      body: JSON.stringify({ command }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const data = await response.json();
    setPending(false);
    setCommand("");
    setLogs(data.logs);
    setOutput(data.output || "");
  };

  return (
    <section className="dashboard-grid">
      <article className="panel-card">
        <p className="eyebrow">Command Line</p>
        <h1>RCON Console</h1>
        <div className="player-form">
          <input onChange={(event) => setCommand(event.target.value)} placeholder="Enter a Minecraft command without leading slash" value={command} />
        </div>
        <div className="action-grid">
          <button className={pending ? "primary-button is-loading" : "primary-button"} disabled={!command || pending} onClick={() => void runCommand()} type="button">Run Command</button>
          <button className="secondary-button" disabled={pending} onClick={() => void loadConsole()} type="button">Refresh Logs</button>
        </div>
        <p className="body-copy">Latest command output: {output || "No command run yet."}</p>
      </article>
      <article className="panel-card logs-card">
        <p className="eyebrow">Console</p>
        <h1>Recent Server Logs</h1>
        <LogViewer logs={logs} />
      </article>
    </section>
  );
};

const SettingsPage = () => {
  const [settingsState, setSettingsState] = useState<SettingsResponse | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadSettings = async () => {
    const response = await fetch("/api/settings");
    const data = await response.json() as SettingsResponse;
    setSettingsState(data);
    setDraft(Object.fromEntries(flattenSettings(data.groups).map((setting) => [setting.key, toDraftValue(setting.value)])));
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  const saveSettings = async () => {
    setPendingAction("save");
    setError("");
    setMessage("");

    const response = await fetch("/api/settings", {
      body: JSON.stringify({ values: draft }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });

    const data = await response.json();

    if (!response.ok) {
      setPendingAction(null);
      setError(data.error || "Failed to save settings");
      return;
    }

    const nextState = data.settings as SettingsResponse;
    setSettingsState(nextState);
    setDraft(Object.fromEntries(flattenSettings(nextState.groups).map((setting) => [setting.key, toDraftValue(setting.value)])));
    setPendingAction(null);
    setMessage(
      data.restartRequiredKeys.length > 0
        ? `Saved settings. Restart required for: ${data.restartRequiredKeys.join(", ")}.`
        : "Saved settings live."
    );
  };

  const restartServer = async () => {
    setPendingAction("restart");
    setError("");
    setMessage("");

    const response = await fetch("/api/server/restart", { method: "POST" });

    if (!response.ok) {
      setPendingAction(null);
      setError("Failed to restart the server");
      return;
    }

    await loadSettings();
    setPendingAction(null);
    setMessage("Server restart requested.");
  };

  if (!settingsState) {
    return <Page description="Loading live settings and restart state..." title="Settings" />;
  }

  return (
    <section className="dashboard-grid settings-page">
      <article className="panel-card logs-card settings-summary-card">
        <p className="eyebrow">Settings Control</p>
        <h1>Structured Server Settings</h1>
        <p className="body-copy">Live-safe settings are applied immediately through the internal management API and also persisted back to `server.properties`. Restart-required settings are written safely and held until the next start or restart.</p>
        <div className="metric-grid">
          <div><span className="metric-label">Server</span><strong>{settingsState.serverRunning ? "Running" : "Stopped"}</strong></div>
          <div><span className="metric-label">Pending Restart</span><strong>{settingsState.pendingRestart.required ? "Required" : "No"}</strong></div>
          <div><span className="metric-label">Changed Keys</span><strong>{settingsState.pendingRestart.keys.length}</strong></div>
        </div>
        {settingsState.pendingRestart.required ? (
          <p className="notice-text">
            Pending restart keys: {settingsState.pendingRestart.keys.join(", ")}
            {settingsState.pendingRestart.updatedAt ? ` since ${new Date(settingsState.pendingRestart.updatedAt).toLocaleString()}` : ""}
          </p>
        ) : null}
        {message ? <p className="success-text">{message}</p> : null}
        {error ? <p className="error-text">{error}</p> : null}
        <div className="action-grid">
          <button className="primary-button" disabled={!!pendingAction} onClick={() => void saveSettings()} type="button">Save Settings</button>
          <button className="secondary-button" disabled={!!pendingAction} onClick={() => void loadSettings()} type="button">Reload</button>
          <button className="secondary-button" disabled={!!pendingAction || !settingsState.pendingRestart.required} onClick={() => void restartServer()} type="button">Restart To Apply</button>
        </div>
      </article>
      <div className="settings-masonry">
        {settingsState.groups.map((group) => (
          <article className="panel-card settings-group-card" key={group.id}>
            <p className="eyebrow">{group.title}</p>
            <h1>{group.title}</h1>
            <p className="body-copy">{group.description}</p>
            <div className="settings-list">
              {group.settings.map((setting) => (
                <div className="setting-row" key={setting.key}>
                  <div className="setting-copy">
                    <div className="setting-heading">
                      <strong>{setting.label}</strong>
                      <span className={`tag ${setting.restartRequired ? "restart-tag" : "live-tag"}`}>
                        {setting.restartRequired ? "Restart Required" : "Live"}
                      </span>
                    </div>
                    <p className="body-copy">{setting.description}</p>
                  </div>
                  <div className="setting-input-wrap">
                    {setting.type === "boolean" || setting.type === "enum" ? (
                      <select
                        className="setting-input"
                        onChange={(event) => setDraft((current) => ({ ...current, [setting.key]: event.target.value }))}
                        value={draft[setting.key] ?? toDraftValue(setting.value)}
                      >
                        {(setting.type === "boolean" ? ["true", "false"] : setting.options || []).map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="setting-input"
                        onChange={(event) => setDraft((current) => ({ ...current, [setting.key]: event.target.value }))}
                        type={setting.type === "integer" ? "number" : "text"}
                        value={draft[setting.key] ?? toDraftValue(setting.value)}
                      />
                    )}
                    <span className="setting-mode">{setting.applyMode === "live-and-persisted" ? "Applies immediately and persists" : "Stored now, applied on next restart"}</span>
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
};

const AuditPage = () => {
  const [auditState, setAuditState] = useState<AuditResponse | null>(null);
  const [filters, setFilters] = useState({
    action: "",
    method: "",
    search: "",
    status: ""
  });
  const [pending, setPending] = useState(false);

  const loadAudit = async (page = 1, nextFilters = filters) => {
    setPending(true);
    const params = new URLSearchParams({
      page: String(page),
      pageSize: "40"
    });

    if (nextFilters.search) params.set("search", nextFilters.search);
    if (nextFilters.method) params.set("method", nextFilters.method);
    if (nextFilters.action) params.set("action", nextFilters.action);
    if (nextFilters.status) params.set("status", nextFilters.status);

    const response = await fetch(`/api/audit?${params.toString()}`);
    const data = await response.json() as AuditResponse;
    setAuditState(data);
    setPending(false);
  };

  useEffect(() => {
    void loadAudit();
  }, []);

  if (!auditState) {
    return <Page description="Loading recent audit history from panel-data/audit/audit.log..." title="Audit" />;
  }

  return (
    <section className="dashboard-grid">
      <article className="panel-card logs-card settings-summary-card">
        <p className="eyebrow">Operational History</p>
        <h1>Audit Trail</h1>
        <p className="body-copy">Search recent API activity by method, status, action, IP, path, or actor. The backend trims the on-disk audit log if it grows past the configured size guardrail.</p>
        <div className="metric-grid">
          <div><span className="metric-label">Visible Entries</span><strong>{auditState.summary.filteredEntries}</strong></div>
          <div><span className="metric-label">Log Entries</span><strong>{auditState.summary.totalEntries}</strong></div>
          <div><span className="metric-label">Page</span><strong>{auditState.page}/{auditState.totalPages}</strong></div>
        </div>
        <p className="body-copy">Methods: {formatCountMap(auditState.summary.methods) || "No entries"}</p>
        <p className="body-copy">Statuses: {formatCountMap(auditState.summary.statuses) || "No entries"}</p>
        <p className="body-copy">Actions: {formatCountMap(auditState.summary.actions) || "No entries"}</p>
      </article>
      <article className="panel-card logs-card">
        <p className="eyebrow">Filters</p>
        <h1>Search Audit</h1>
        <div className="audit-filters">
          <input
            onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
            placeholder="Search path, IP, actor, action, or status"
            value={filters.search}
          />
          <select onChange={(event) => setFilters((current) => ({ ...current, method: event.target.value }))} value={filters.method}>
            <option value="">All methods</option>
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="DELETE">DELETE</option>
          </select>
          <input
            onChange={(event) => setFilters((current) => ({ ...current, action: event.target.value }))}
            placeholder="Action filter, for example api-request"
            value={filters.action}
          />
          <select onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))} value={filters.status}>
            <option value="">All statuses</option>
            <option value="200">200</option>
            <option value="304">304</option>
            <option value="400">400</option>
            <option value="500">500</option>
          </select>
        </div>
        <div className="action-grid">
          <button className={pending ? "primary-button is-loading" : "primary-button"} disabled={pending} onClick={() => void loadAudit(1, filters)} type="button">Apply Filters</button>
          <button className="secondary-button" disabled={pending} onClick={() => {
            const nextFilters = { action: "", method: "", search: "", status: "" };
            setFilters(nextFilters);
            void loadAudit(1, nextFilters);
          }} type="button">Reset</button>
        </div>
        <div className="audit-table">
          <div className="audit-table-header">
            <span>Timestamp</span>
            <span>Method</span>
            <span>Path</span>
            <span>Status</span>
            <span>IP</span>
            <span>Action</span>
          </div>
          {auditState.entries.map((entry) => (
            <div className="audit-row" key={`${entry.timestamp}-${entry.method}-${entry.path}-${entry.status}`}>
              <span>{new Date(entry.timestamp).toLocaleString()}</span>
              <span>{entry.method}</span>
              <span className="audit-path">{entry.path}</span>
              <span>{entry.status}</span>
              <span>{entry.ip}</span>
              <span>{entry.action}</span>
            </div>
          ))}
          {auditState.entries.length === 0 ? <p className="body-copy">No audit entries matched the current filters.</p> : null}
        </div>
        <div className="action-grid">
          <button className="secondary-button" disabled={pending || auditState.page <= 1} onClick={() => void loadAudit(auditState.page - 1)} type="button">Previous</button>
          <button className="secondary-button" disabled={pending || auditState.page >= auditState.totalPages} onClick={() => void loadAudit(auditState.page + 1)} type="button">Next</button>
          <button className="secondary-button" disabled={pending} onClick={() => void loadAudit(auditState.page)} type="button">Refresh</button>
        </div>
      </article>
    </section>
  );
};

const pages = [
  { path: "/", label: "Dashboard", element: <DashboardPage /> },
  { path: "/console", label: "Console", element: <ConsolePage /> },
  { path: "/players", label: "Players", element: <PlayersPage /> },
  { path: "/files", label: "Files", element: <Page title="Files" description="Scoped file management will operate only inside the mounted Minecraft data directory." /> },
  { path: "/mods", label: "Mods", element: <Page title="Mods" description="Mod upload, staging, restart-required workflow, and quarantine rollback will live here." /> },
  { path: "/backups", label: "Backups", element: <Page title="Backups" description="Full-data backups with selectable exclusions and guided restore will live here." /> },
  { path: "/settings", label: "Settings", element: <SettingsPage /> },
  { path: "/audit", label: "Audit", element: <AuditPage /> }
];

export const App = () => (
  <div className="shell">
    <aside className="sidebar">
      <div>
        <p className="eyebrow">Fabric Panel</p>
        <h1>Single-Admin Control Plane</h1>
        <p className="body-copy">This panel is private to the LAN and exposes direct controls for the live Fabric 1.21.11 server.</p>
      </div>
      <nav className="nav">
        {pages.map((page) => (
          <NavLink className={({ isActive }) => isActive ? "nav-link active" : "nav-link"} key={page.path} to={page.path}>
            {page.label}
          </NavLink>
        ))}
      </nav>
    </aside>
    <main className="content">
      <Routes>
        {pages.map((page) => (
          <Route element={page.element} key={page.path} path={page.path} />
        ))}
      </Routes>
    </main>
  </div>
);
