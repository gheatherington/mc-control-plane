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

type BackupExclusionOption = {
  description: string;
  key: string;
  label: string;
};

type BackupSummary = {
  createdAt: string;
  format: "tar" | "tar.gz" | "tgz";
  modifiedAt: string;
  name: string;
  sizeBytes: number;
};

type BackupDetails = BackupSummary & {
  entries: string[];
  entryCount: number;
  includesWorldData: boolean;
  restoreConfirmation: string;
  worldPaths: string[];
};

type BackupsResponse = {
  backups: BackupSummary[];
  exclusions: BackupExclusionOption[];
};

type ModMetadata = {
  description?: string;
  environment?: string;
  id: string;
  name?: string;
  version?: string;
};

type QuarantineMetadata = {
  previousScope: "active" | "staging";
  quarantinedAt: string;
  reason: "delete-active" | "manual-quarantine" | "rejected-upload";
};

type ModRecord = {
  fabricMetadata: ModMetadata | null;
  fileName: string;
  modifiedAt: string;
  quarantineMetadata?: QuarantineMetadata;
  scope: "active" | "staging" | "quarantine";
  sizeBytes: number;
};

type ModsResponse = {
  mods: {
    active: ModRecord[];
    quarantine: ModRecord[];
    staging: ModRecord[];
  };
  restartRequired: boolean;
  roots: {
    active: string;
    quarantine: string;
    staging: string;
  };
};

const flattenSettings = (groups: SettingsGroup[]) => groups.flatMap((group) => group.settings);

const toDraftValue = (value: SettingValue) => typeof value === "boolean" ? String(value) : String(value);

const formatCountMap = (counts: Record<string, number>) => Object.entries(counts)
  .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
  .slice(0, 4)
  .map(([key, count]) => `${key}: ${count}`)
  .join(" | ");

const formatBytes = (value: number) => {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const modScopeLabel: Record<ModRecord["scope"], string> = {
  active: "Active Mods",
  quarantine: "Quarantined Mods",
  staging: "Staged Mods"
};

const quarantineReasonLabel: Record<NonNullable<QuarantineMetadata["reason"]>, string> = {
  "delete-active": "Removed from active mods",
  "manual-quarantine": "Moved out of staging",
  "rejected-upload": "Rejected after upload"
};

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return window.btoa(binary);
};

const Page = ({ title, description }: { title: string; description: string }) => (
  <section className="panel-card">
    <p className="eyebrow">{title}</p>
    <h1>{title}</h1>
    <p className="body-copy">{description}</p>
  </section>
);

const BackupProgressIndicator = ({ label, detail }: { label: string; detail: string }) => (
  <div className="backup-progress-card" role="status" aria-live="polite">
    <div className="backup-progress-copy">
      <strong>{label}</strong>
      <span>{detail}</span>
    </div>
    <div className="backup-progress-track" aria-hidden="true">
      <div className="backup-progress-bar" />
    </div>
  </div>
);

const BackupErrorModal = ({ message, onClose }: { message: string; onClose: () => void }) => (
  <div className="backup-modal-backdrop" role="presentation">
    <div aria-labelledby="backup-error-title" aria-modal="true" className="backup-modal" role="alertdialog">
      <p className="eyebrow">Backup Error</p>
      <h1 id="backup-error-title">Backup Action Failed</h1>
      <p className="body-copy">{message}</p>
      <div className="action-grid">
        <button className="primary-button" onClick={onClose} type="button">Dismiss</button>
      </div>
    </div>
  </div>
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
  const [formReminder, setFormReminder] = useState("");
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  const loadPlayers = async () => {
    const response = await fetch("/api/players");
    const data = await response.json();
    setPlayersState(data);
  };

  useEffect(() => {
    void loadPlayers();
  }, []);

  const submit = async (endpoint: string, options: RequestInit = {}) => {
    setFormReminder("");
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

  const requirePlayerName = (callback: () => Promise<void>) => {
    if (!name.trim()) {
      setFormReminder("Enter a player name before running that action.");
      nameInputRef.current?.focus();
      return;
    }

    void callback();
  };

  const players = useMemo(() => playersState?.players || [], [playersState]);

  return (
    <section className="dashboard-grid">
      <article className="panel-card">
        <p className="eyebrow">Player Management</p>
        <h1>Directory</h1>
        <p className="body-copy">Use exact Minecraft usernames for operator, whitelist, ban, and kick actions.</p>
        {formReminder ? <p className="notice-text">{formReminder}</p> : null}
        <div className="player-form">
          <input
            onChange={(event) => {
              setName(event.target.value);
              if (event.target.value.trim()) {
                setFormReminder("");
              }
            }}
            placeholder="Player name"
            ref={nameInputRef}
            value={name}
          />
          <input onChange={(event) => setReason(event.target.value)} placeholder="Kick reason (optional)" value={reason} />
        </div>
        <div className="action-grid">
          <button className="primary-button" disabled={!!pendingAction} onClick={() => requirePlayerName(async () => submit("/api/players/whitelist", { body: JSON.stringify({ name }), method: "POST" }))} type="button">Whitelist</button>
          <button className="secondary-button" disabled={!!pendingAction} onClick={() => requirePlayerName(async () => submit(`/api/players/whitelist/${encodeURIComponent(name)}`, { method: "DELETE" }))} type="button">Remove Whitelist</button>
          <button className="primary-button" disabled={!!pendingAction} onClick={() => requirePlayerName(async () => submit("/api/players/ops", { body: JSON.stringify({ name }), method: "POST" }))} type="button">Op</button>
          <button className="secondary-button" disabled={!!pendingAction} onClick={() => requirePlayerName(async () => submit(`/api/players/ops/${encodeURIComponent(name)}`, { method: "DELETE" }))} type="button">Deop</button>
          <button className="primary-button" disabled={!!pendingAction} onClick={() => requirePlayerName(async () => submit("/api/players/bans", { body: JSON.stringify({ name }), method: "POST" }))} type="button">Ban</button>
          <button className="secondary-button" disabled={!!pendingAction} onClick={() => requirePlayerName(async () => submit(`/api/players/bans/${encodeURIComponent(name)}`, { method: "DELETE" }))} type="button">Pardon</button>
          <button className="secondary-button" disabled={!!pendingAction} onClick={() => requirePlayerName(async () => submit("/api/players/kick", { body: JSON.stringify({ name, reason }), method: "POST" }))} type="button">Kick</button>
          <button
            className={pendingAction === "refresh" ? "secondary-button is-loading" : "secondary-button"}
            disabled={!!pendingAction}
            onClick={async () => {
              setPendingAction("refresh");
              await loadPlayers();
              setPendingAction(null);
            }}
            type="button"
          >
            {pendingAction === "refresh" ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </article>
      <article className="panel-card">
        <p className="eyebrow">Known Players</p>
        <h1>{players.length}</h1>
        <div className="player-table">
          {players.map((player) => (
            <button
              className="player-row player-row-button"
              key={player.name}
              onClick={() => setName(player.name)}
              type="button"
            >
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
            </button>
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

const BackupsPage = () => {
  const [backupsState, setBackupsState] = useState<BackupsResponse | null>(null);
  const [selectedBackup, setSelectedBackup] = useState<BackupDetails | null>(null);
  const [backupName, setBackupName] = useState("");
  const [inspectTarget, setInspectTarget] = useState<string | null>(null);
  const [restoreConfirmation, setRestoreConfirmation] = useState("");
  const [selectedIncludes, setSelectedIncludes] = useState<string[]>(["world"]);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [modalError, setModalError] = useState("");
  const creatingBackup = pendingAction === "create";
  const restoringBackup = pendingAction !== null && pendingAction.startsWith("restore:");
  const activeRestoreName = restoringBackup ? pendingAction.slice("restore:".length) : "";

  const loadBackups = async (preferredBackupName?: string) => {
    setInspectTarget(preferredBackupName || null);
    const response = await fetch("/api/backups");
    const data = await response.json() as BackupsResponse;
    setBackupsState(data);

    const nextBackupName = preferredBackupName || selectedBackup?.name || data.backups[0]?.name;
    if (!nextBackupName) {
      setSelectedBackup(null);
      setInspectTarget(null);
      return;
    }

    const detailResponse = await fetch(`/api/backups/${encodeURIComponent(nextBackupName)}`);
    if (!detailResponse.ok) {
      setSelectedBackup(null);
      setInspectTarget(null);
      return;
    }

    const detail = await detailResponse.json() as BackupDetails;
    setSelectedBackup(detail);
    setInspectTarget(null);
  };

  useEffect(() => {
    void loadBackups();
  }, []);

  const toggleInclude = (key: string) => {
    setSelectedIncludes((current) => current.includes(key)
      ? current.filter((value) => value !== key)
      : [...current, key]);
  };

  const createArchive = async () => {
    setPendingAction("create");
    setError("");
    setMessage("");
    setModalError("");

    const response = await fetch("/api/backups", {
      body: JSON.stringify({
        exclusions: backupsState.exclusions
          .map((option) => option.key)
          .filter((key) => !selectedIncludes.includes(key)),
        name: backupName
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const data = await response.json();
    setPendingAction(null);

    if (!response.ok) {
      const nextError = data.error || "Failed to create backup";
      setError(nextError);
      setModalError(nextError);
      return;
    }

    setBackupName("");
    setRestoreConfirmation("");
    setMessage(`Created backup ${data.backup.name}.`);
    await loadBackups(data.backup.name);
  };

  const removeArchive = async (name: string) => {
    setPendingAction(`delete:${name}`);
    setError("");
    setMessage("");
    setModalError("");

    const response = await fetch(`/api/backups/${encodeURIComponent(name)}`, {
      method: "DELETE"
    });
    const data = await response.json();
    setPendingAction(null);

    if (!response.ok) {
      const nextError = data.error || "Failed to delete backup";
      setError(nextError);
      setModalError(nextError);
      return;
    }

    setMessage(`Deleted backup ${name}.`);
    if (selectedBackup?.name === name) {
      setSelectedBackup(null);
      setRestoreConfirmation("");
    }
    await loadBackups();
  };

  const restoreArchive = async () => {
    if (!selectedBackup) {
      return;
    }

    setPendingAction(`restore:${selectedBackup.name}`);
    setError("");
    setMessage("");
    setModalError("");

    const response = await fetch(`/api/backups/${encodeURIComponent(selectedBackup.name)}/restore`, {
      body: JSON.stringify({
        confirmation: restoreConfirmation
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const data = await response.json();
    setPendingAction(null);

    if (!response.ok) {
      const nextError = data.error || "Failed to restore backup";
      setError(nextError);
      setModalError(nextError);
      return;
    }

    setMessage(
      data.previousDataRetained
        ? `Restored ${selectedBackup.name}. Previous data could not be removed automatically.`
        : `Restored ${selectedBackup.name}.`
    );
    setRestoreConfirmation("");
    await loadBackups(selectedBackup.name);
  };

  if (!backupsState) {
    return <Page description="Loading backup inventory from the scoped backups directory..." title="Backups" />;
  }

  return (
    <>
      {modalError ? <BackupErrorModal message={modalError} onClose={() => setModalError("")} /> : null}
      <section className="dashboard-grid settings-page">
        <article className="panel-card logs-card settings-summary-card">
        <p className="eyebrow">Backup Control</p>
        <h1>Scoped Data Archives</h1>
        <p className="body-copy">Archives are created only from the mounted Minecraft data directory and stored under the configured backups root. The options below control which data classes are included in the archive, with world data enabled by default.</p>
        <div className="metric-grid">
          <div><span className="metric-label">Archives</span><strong>{backupsState.backups.length}</strong></div>
          <div><span className="metric-label">Latest Backup</span><strong>{backupsState.backups[0] ? new Date(backupsState.backups[0].modifiedAt).toLocaleString() : "None"}</strong></div>
          <div><span className="metric-label">Selected</span><strong>{inspectTarget || selectedBackup?.name || "None"}</strong></div>
        </div>
        <p className="notice-text">Restore stops the server, replaces the mounted data directory, and starts the server again if it had been running before the restore.</p>
        {creatingBackup ? <BackupProgressIndicator detail="Packing the mounted data directory into a new archive. This can take a while for large worlds." label="Creating Backup" /> : null}
        {restoringBackup ? <BackupProgressIndicator detail={`Restoring ${activeRestoreName}. The server data is being replaced and the service may restart if it was running.`} label="Restoring Backup" /> : null}
        {message ? <p className="success-text">{message}</p> : null}
        {error ? <p className="error-text">{error}</p> : null}
        </article>
        <article className="panel-card">
        <p className="eyebrow">Create Backup</p>
        <h1>New Archive</h1>
        <p className="body-copy">Optional labels are sanitized into the archive name. Checked options are included in the new archive. `World Data` starts enabled so world saves are backed up by default.</p>
        {creatingBackup ? <BackupProgressIndicator detail="Archive creation is running. Inputs stay locked until the archive write completes." label="Archive In Progress" /> : null}
        <div className="player-form">
          <input onChange={(event) => setBackupName(event.target.value)} placeholder="Optional label, for example pre-update" value={backupName} />
        </div>
        <div className="backup-exclusions">
          {backupsState.exclusions.map((option) => (
            <label className="backup-option" key={option.key}>
              <input
                checked={selectedIncludes.includes(option.key)}
                onChange={() => toggleInclude(option.key)}
                type="checkbox"
              />
              <div>
                <strong>{option.label}</strong>
                <p className="body-copy">{option.description}</p>
              </div>
            </label>
          ))}
        </div>
        <div className="action-grid">
          <button className="primary-button" disabled={!!pendingAction} onClick={() => void createArchive()} type="button">Create Backup</button>
          <button className="secondary-button" disabled={!!pendingAction} onClick={() => void loadBackups()} type="button">Refresh Inventory</button>
        </div>
        </article>
        <article className="panel-card">
        <p className="eyebrow">Archive Inventory</p>
        <h1>{backupsState.backups.length}</h1>
        <div className="backup-table">
          <div className="backup-table-header">
            <span>Name</span>
            <span>Modified</span>
            <span>Size</span>
            <span>Format</span>
            <span>Actions</span>
          </div>
          {backupsState.backups.map((backup) => (
            <div className={`backup-row ${selectedBackup?.name === backup.name ? "selected" : ""}`} key={backup.name}>
              <span className="backup-name">{backup.name}</span>
              <span>{new Date(backup.modifiedAt).toLocaleString()}</span>
              <span>{formatBytes(backup.sizeBytes)}</span>
              <span>{backup.format}</span>
              <span className="backup-row-actions">
                <button
                  className={inspectTarget === backup.name ? "secondary-button is-loading" : "secondary-button"}
                  disabled={!!pendingAction || inspectTarget !== null}
                  onClick={() => void loadBackups(backup.name)}
                  type="button"
                >
                  {inspectTarget === backup.name ? "Inspecting..." : "Inspect"}
                </button>
                <button className="secondary-button" disabled={!!pendingAction} onClick={() => void removeArchive(backup.name)} type="button">Delete</button>
              </span>
            </div>
          ))}
          {backupsState.backups.length === 0 ? <p className="body-copy">No backups have been created yet.</p> : null}
        </div>
        </article>
        <article className="panel-card">
        <p className="eyebrow">Restore Flow</p>
        <h1>{inspectTarget || selectedBackup?.name || "Select A Backup"}</h1>
        {inspectTarget ? (
          <p className="body-copy">Loading archive details for {inspectTarget}...</p>
        ) : selectedBackup ? (
          <>
            <div className="metric-grid">
              <div><span className="metric-label">Entries</span><strong>{selectedBackup.entryCount}</strong></div>
              <div><span className="metric-label">Created</span><strong>{new Date(selectedBackup.createdAt).toLocaleString()}</strong></div>
              <div><span className="metric-label">Size</span><strong>{formatBytes(selectedBackup.sizeBytes)}</strong></div>
              <div><span className="metric-label">World Data</span><strong>{selectedBackup.includesWorldData ? "Included" : "Not Detected"}</strong></div>
            </div>
            <p className="body-copy">Detected world paths: {selectedBackup.worldPaths.length > 0 ? selectedBackup.worldPaths.join(", ") : "None detected in this archive."}</p>
            <p className="body-copy">Type the exact confirmation phrase below to restore this archive.</p>
            <p className="notice-text">{selectedBackup.restoreConfirmation}</p>
            {restoringBackup && activeRestoreName === selectedBackup.name ? (
              <BackupProgressIndicator detail="The archive is being unpacked and applied to the live data directory." label="Restore In Progress" />
            ) : null}
            <div className="player-form">
              <input onChange={(event) => setRestoreConfirmation(event.target.value)} placeholder="Paste restore confirmation phrase" value={restoreConfirmation} />
            </div>
            <div className="action-grid">
              <button
                className={restoringBackup && activeRestoreName === selectedBackup.name ? "primary-button is-loading" : "primary-button"}
                disabled={pendingAction !== null || restoreConfirmation !== selectedBackup.restoreConfirmation}
                onClick={() => void restoreArchive()}
                type="button"
              >
                {restoringBackup && activeRestoreName === selectedBackup.name ? "Restoring..." : "Restore Backup"}
              </button>
            </div>
            <div className="backup-entries">
              <p className="eyebrow">Archive Preview</p>
              <pre className="log-block">{selectedBackup.entries.join("\n")}</pre>
            </div>
          </>
        ) : (
          <p className="body-copy">Inspect an archive to review its metadata and restore phrase.</p>
        )}
        </article>
      </section>
    </>
  );
};

const ModList = ({
  mods,
  onAction,
  pendingAction
}: {
  mods: ModRecord[];
  onAction: (endpoint: string, options?: RequestInit, successMessage?: string) => Promise<void>;
  pendingAction: string | null;
}) => {
  if (mods.length === 0) {
    return <p className="body-copy">No jar files are present in this scope yet.</p>;
  }

  return (
    <div className="mod-table">
      {mods.map((mod) => (
        <div className="mod-row" key={`${mod.scope}-${mod.fileName}`}>
          <div>
            <div className="mod-heading">
              <strong>{mod.fabricMetadata?.name || mod.fileName}</strong>
              <span className={`tag ${mod.fabricMetadata ? "live-tag" : "restart-tag"}`}>
                {mod.fabricMetadata ? "Fabric Metadata" : "No fabric.mod.json"}
              </span>
            </div>
            <p className="body-copy mod-file-name">{mod.fileName}</p>
            <div className="player-tags">
              {mod.fabricMetadata?.id ? <span className="tag">{mod.fabricMetadata.id}</span> : null}
              {mod.fabricMetadata?.version ? <span className="tag">{mod.fabricMetadata.version}</span> : null}
              {mod.fabricMetadata?.environment ? <span className="tag">{mod.fabricMetadata.environment}</span> : null}
            </div>
            {mod.quarantineMetadata ? (
              <p className="body-copy">
                From {mod.quarantineMetadata.previousScope} on {new Date(mod.quarantineMetadata.quarantinedAt).toLocaleString()}.
                {" "}
                {quarantineReasonLabel[mod.quarantineMetadata.reason]}.
              </p>
            ) : null}
            {mod.fabricMetadata?.description ? <p className="body-copy">{mod.fabricMetadata.description}</p> : null}
          </div>
          <div className="mod-meta">
            <span><strong>Modified</strong> {new Date(mod.modifiedAt).toLocaleString()}</span>
            <span><strong>Size</strong> {formatBytes(mod.sizeBytes)}</span>
            <div className="backup-row-actions">
              {mod.scope === "active" ? (
                <button
                  className="secondary-button"
                  disabled={pendingAction !== null}
                  onClick={() => void onAction(`/api/mods/active/${encodeURIComponent(mod.fileName)}/quarantine`, { method: "POST" }, `Moved ${mod.fileName} to quarantine.`)}
                  type="button"
                >
                  Remove To Quarantine
                </button>
              ) : null}
              {mod.scope === "staging" ? (
                <>
                  <button
                    className="primary-button"
                    disabled={pendingAction !== null}
                    onClick={() => void onAction(`/api/mods/staging/${encodeURIComponent(mod.fileName)}/install`, { method: "POST" }, `Installed ${mod.fileName} into active mods.`)}
                    type="button"
                  >
                    Install Active
                  </button>
                  <button
                    className="secondary-button"
                    disabled={pendingAction !== null}
                    onClick={() => void onAction(`/api/mods/staging/${encodeURIComponent(mod.fileName)}/quarantine`, { method: "POST" }, `Moved ${mod.fileName} to quarantine.`)}
                    type="button"
                  >
                    Quarantine
                  </button>
                  <button
                    className="secondary-button"
                    disabled={pendingAction !== null}
                    onClick={() => void onAction(`/api/mods/staging/${encodeURIComponent(mod.fileName)}`, { method: "DELETE" }, `Deleted staged mod ${mod.fileName}.`)}
                    type="button"
                  >
                    Delete
                  </button>
                </>
              ) : null}
              {mod.scope === "quarantine" ? (
                <>
                  <button
                    className="secondary-button"
                    disabled={pendingAction !== null}
                    onClick={() => void onAction(
                      `/api/mods/quarantine/${encodeURIComponent(mod.fileName)}/restore`,
                      {
                        body: JSON.stringify({ targetScope: "staging" }),
                        headers: { "Content-Type": "application/json" },
                        method: "POST"
                      },
                      `Restored ${mod.fileName} to staging.`
                    )}
                    type="button"
                  >
                    Restore To Staging
                  </button>
                  <button
                    className="primary-button"
                    disabled={pendingAction !== null}
                    onClick={() => void onAction(`/api/mods/quarantine/${encodeURIComponent(mod.fileName)}/install`, { method: "POST" }, `Restored ${mod.fileName} into active mods.`)}
                    type="button"
                  >
                    Restore Active
                  </button>
                  <button
                    className="secondary-button"
                    disabled={pendingAction !== null}
                    onClick={() => void onAction(`/api/mods/quarantine/${encodeURIComponent(mod.fileName)}`, { method: "DELETE" }, `Deleted quarantined mod ${mod.fileName}.`)}
                    type="button"
                  >
                    Delete
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

const ModsPage = () => {
  const [modsState, setModsState] = useState<ModsResponse | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadMods = async () => {
    const response = await fetch("/api/mods");
    const data = await response.json() as ModsResponse;
    setModsState(data);
  };

  useEffect(() => {
    void loadMods();
  }, []);

  const runAction = async (endpoint: string, options: RequestInit = {}, successMessage = "Mod action completed.") => {
    setPendingAction(endpoint);
    setError("");
    setMessage("");

    const response = await fetch(endpoint, options);
    const data = await response.json();
    setPendingAction(null);

    if (!response.ok) {
      setError(data.error || "Mod action failed");
      return;
    }

    setModsState(data.inventory as ModsResponse);
    setMessage(successMessage);
  };

  const uploadSelectedFile = async () => {
    if (!selectedFile) {
      return;
    }

    setPendingAction("upload");
    setError("");
    setMessage("");

    try {
      const contentBase64 = arrayBufferToBase64(await selectedFile.arrayBuffer());
      const response = await fetch("/api/mods/upload", {
        body: JSON.stringify({
          contentBase64,
          fileName: selectedFile.name
        }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const data = await response.json();
      setPendingAction(null);

      if (!response.ok) {
        setError(data.error || "Upload failed");
        return;
      }

      setSelectedFile(null);
      setModsState(data.inventory as ModsResponse);
      setMessage(`Uploaded ${selectedFile.name} to staging.`);
    } catch (uploadError) {
      setPendingAction(null);
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
    }
  };

  if (!modsState) {
    return <Page description="Loading active, staged, and quarantined mod jars from the scoped server directories..." title="Mods" />;
  }

  const totalMods = modsState.mods.active.length + modsState.mods.staging.length + modsState.mods.quarantine.length;

  return (
    <section className="dashboard-grid settings-page">
      <article className="panel-card logs-card settings-summary-card">
        <p className="eyebrow">Mod Inventory</p>
        <h1>Scoped Fabric Jars</h1>
        <p className="body-copy">Uploads land in staging first. From there you can install a jar into the active mod set, quarantine it, or delete it. Removing an active mod also moves it into quarantine so rollback stays available.</p>
        <div className="metric-grid">
          <div><span className="metric-label">Active</span><strong>{modsState.mods.active.length}</strong></div>
          <div><span className="metric-label">Staged</span><strong>{modsState.mods.staging.length}</strong></div>
          <div><span className="metric-label">Quarantined</span><strong>{modsState.mods.quarantine.length}</strong></div>
          <div><span className="metric-label">Total Jars</span><strong>{totalMods}</strong></div>
        </div>
        <p className="notice-text">Any mod add, remove, or move between these scopes will require a server restart before Minecraft loads the changed jar set.</p>
        {message ? <p className="success-text">{message}</p> : null}
        {error ? <p className="error-text">{error}</p> : null}
        <div className="action-grid">
          <button className={pendingAction === "refresh" ? "primary-button is-loading" : "primary-button"} disabled={pendingAction !== null} onClick={async () => {
            setPendingAction("refresh");
            await loadMods();
            setPendingAction(null);
          }} type="button">Refresh Inventory</button>
        </div>
      </article>
      <article className="panel-card">
        <p className="eyebrow">Upload</p>
        <h1>Stage A Mod</h1>
        <p className="body-copy">Select a `.jar` file to upload into the staging area. The backend accepts up to 32 MB per upload and keeps active mods untouched until you explicitly install the staged jar.</p>
        <div className="player-form">
          <input accept=".jar,application/java-archive" onChange={(event) => setSelectedFile(event.target.files?.[0] || null)} type="file" />
        </div>
        <p className="body-copy">Selected file: {selectedFile ? `${selectedFile.name} (${formatBytes(selectedFile.size)})` : "None"}</p>
        <div className="action-grid">
          <button className={pendingAction === "upload" ? "primary-button is-loading" : "primary-button"} disabled={!selectedFile || pendingAction !== null} onClick={() => void uploadSelectedFile()} type="button">Upload To Staging</button>
        </div>
      </article>
      {(["active", "staging", "quarantine"] as const).map((scope) => (
        <article className="panel-card" key={scope}>
          <p className="eyebrow">{modScopeLabel[scope]}</p>
          <h1>{modsState.mods[scope].length}</h1>
          <p className="body-copy">Path: <code>{modsState.roots[scope]}</code></p>
          <ModList mods={modsState.mods[scope]} onAction={runAction} pendingAction={pendingAction} />
        </article>
      ))}
    </section>
  );
};

const pages = [
  { path: "/", label: "Dashboard", element: <DashboardPage /> },
  { path: "/console", label: "Console", element: <ConsolePage /> },
  { path: "/players", label: "Players", element: <PlayersPage /> },
  { path: "/files", label: "Files", element: <Page title="Files" description="Scoped file management will operate only inside the mounted Minecraft data directory." /> },
  { path: "/mods", label: "Mods", element: <ModsPage /> },
  { path: "/backups", label: "Backups", element: <BackupsPage /> },
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
