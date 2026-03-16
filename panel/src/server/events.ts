import { EventEmitter } from "node:events";
import { getDashboard, listPlayers } from "./minecraft";
import { callManagement, readManagementSecret } from "./management";
import WebSocket from "ws";
import { config } from "./config";

type DashboardState = Awaited<ReturnType<typeof getDashboard>>;
type PlayersState = Awaited<ReturnType<typeof listPlayers>>;

type PanelEventType =
  | "allowlist-changed"
  | "dashboard-refresh"
  | "management-bridge-state"
  | "management-notification"
  | "operators-changed"
  | "player-join"
  | "player-leave"
  | "players-refresh"
  | "save-event";

export type PanelEvent = {
  details?: Record<string, unknown>;
  receivedAt: string;
  source: "poll" | "subscriber" | "system";
  type: PanelEventType;
};

type BridgeState = {
  connected: boolean;
  fallbackActive: boolean;
  lastError: string | null;
  lastNotificationAt: string | null;
  lastOpenAt: string | null;
};

const emitter = new EventEmitter();
const pollIntervalMs = 5000;
const reconnectDelayMs = 5000;
const keepAliveMs = 20000;

let started = false;
let pollTimer: NodeJS.Timeout | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let socket: WebSocket | null = null;
let pingTimer: NodeJS.Timeout | null = null;
let previousDashboard: DashboardState | null = null;
let previousPlayers: PlayersState | null = null;
let bridgeState: BridgeState = {
  connected: false,
  fallbackActive: true,
  lastError: null,
  lastNotificationAt: null,
  lastOpenAt: null
};

const emitPanelEvent = (event: PanelEvent) => {
  emitter.emit("event", event);
};

const updateBridgeState = (nextState: Partial<BridgeState>) => {
  bridgeState = {
    ...bridgeState,
    ...nextState
  };

  emitPanelEvent({
    details: {
      ...bridgeState
    },
    receivedAt: new Date().toISOString(),
    source: "system",
    type: "management-bridge-state"
  });
};

const emitRefresh = (source: PanelEvent["source"], type: PanelEventType, details?: Record<string, unknown>) => {
  emitPanelEvent({
    details,
    receivedAt: new Date().toISOString(),
    source,
    type
  });
};

const compareStatesAndEmit = async () => {
  try {
    const [dashboard, players] = await Promise.all([
      getDashboard(),
      listPlayers()
    ]);

    if (previousDashboard && previousDashboard.server.status !== dashboard.server.status) {
      emitRefresh("poll", "dashboard-refresh", {
        nextStatus: dashboard.server.status,
        previousStatus: previousDashboard.server.status
      });
    }

    const previousOnline = new Set(previousPlayers?.players.filter((player) => player.online).map((player) => player.name) || []);
    const nextOnline = new Set(players.players.filter((player) => player.online).map((player) => player.name));

    for (const player of nextOnline) {
      if (!previousOnline.has(player)) {
        emitRefresh("poll", "player-join", { name: player });
      }
    }

    for (const player of previousOnline) {
      if (!nextOnline.has(player)) {
        emitRefresh("poll", "player-leave", { name: player });
      }
    }

    const previousOps = new Set(previousPlayers?.ops || []);
    const nextOps = new Set(players.ops);

    if (previousPlayers && (previousOps.size !== nextOps.size || [...previousOps].some((name) => !nextOps.has(name)))) {
      emitRefresh("poll", "operators-changed");
    }

    const previousAllowlist = new Set(previousPlayers?.whitelist || []);
    const nextAllowlist = new Set(players.whitelist);

    if (previousPlayers && (previousAllowlist.size !== nextAllowlist.size || [...previousAllowlist].some((name) => !nextAllowlist.has(name)))) {
      emitRefresh("poll", "allowlist-changed");
    }

    if (!previousPlayers || !previousDashboard) {
      emitRefresh("poll", "dashboard-refresh");
      emitRefresh("poll", "players-refresh");
    }

    previousDashboard = dashboard;
    previousPlayers = players;
  } catch (error) {
    updateBridgeState({
      fallbackActive: true,
      lastError: error instanceof Error ? error.message : "poll failed"
    });
  }
};

const classifyNotification = (method: string) => {
  const normalized = method.toLowerCase();

  if (normalized.includes("allowlist")) {
    return "allowlist-changed";
  }

  if (normalized.includes("operator") || normalized.includes("op")) {
    return "operators-changed";
  }

  if (normalized.includes("save")) {
    return "save-event";
  }

  if (normalized.includes("join")) {
    return "player-join";
  }

  if (normalized.includes("leave")) {
    return "player-leave";
  }

  if (normalized.includes("status") || normalized.includes("server")) {
    return "dashboard-refresh";
  }

  return "management-notification";
};

const handleSocketMessage = (rawMessage: WebSocket.RawData) => {
  try {
    const parsed = JSON.parse(String(rawMessage)) as { id?: number; method?: string; params?: unknown[]; result?: unknown };

    if (!parsed.method || parsed.id !== undefined) {
      return;
    }

    updateBridgeState({
      fallbackActive: false,
      lastError: null,
      lastNotificationAt: new Date().toISOString()
    });

    const type = classifyNotification(parsed.method);
    emitRefresh("subscriber", type, {
      method: parsed.method,
      params: parsed.params || []
    });

    if (type !== "dashboard-refresh") {
      emitRefresh("subscriber", "dashboard-refresh", { method: parsed.method });
      emitRefresh("subscriber", "players-refresh", { method: parsed.method });
    }
  } catch (error) {
    updateBridgeState({
      lastError: error instanceof Error ? error.message : "notification parse failed"
    });
  }
};

const scheduleReconnect = () => {
  if (reconnectTimer) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectSubscriber();
  }, reconnectDelayMs);
};

const clearSocketState = () => {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }

  if (socket) {
    socket.removeAllListeners();
    socket = null;
  }
};

const connectSubscriber = async () => {
  clearSocketState();

  try {
    const secret = await readManagementSecret();
    const protocol = config.managementTls ? "wss" : "ws";
    const endpoint = `${protocol}://${config.managementHost}:${config.managementPort}/`;
    socket = new WebSocket(endpoint, {
      headers: {
        Authorization: `Bearer ${secret}`
      }
    });

    socket.on("open", () => {
      updateBridgeState({
        connected: true,
        fallbackActive: bridgeState.lastNotificationAt === null,
        lastError: null,
        lastOpenAt: new Date().toISOString()
      });

      pingTimer = setInterval(() => {
        socket?.ping();
      }, keepAliveMs);

      socket?.send(JSON.stringify({
        id: Date.now(),
        jsonrpc: "2.0",
        method: "minecraft:outgoing_rpc_methods",
        params: []
      }));
    });

    socket.on("message", handleSocketMessage);

    socket.on("error", (error) => {
      updateBridgeState({
        connected: false,
        fallbackActive: true,
        lastError: error.message
      });
    });

    socket.on("close", () => {
      updateBridgeState({
        connected: false,
        fallbackActive: true
      });
      clearSocketState();
      scheduleReconnect();
    });
  } catch (error) {
    updateBridgeState({
      connected: false,
      fallbackActive: true,
      lastError: error instanceof Error ? error.message : "subscriber failed to start"
    });
    scheduleReconnect();
  }
};

export const ensureEventsStarted = () => {
  if (started) {
    return;
  }

  started = true;
  void connectSubscriber();
  void compareStatesAndEmit();
  pollTimer = setInterval(() => {
    void compareStatesAndEmit();
  }, pollIntervalMs);
};

export const getBridgeState = () => bridgeState;

export const subscribeToPanelEvents = (listener: (event: PanelEvent) => void) => {
  emitter.on("event", listener);
  return () => emitter.off("event", listener);
};

export const emitSystemPanelEvent = (type: Exclude<PanelEventType, "management-bridge-state" | "management-notification">, details?: Record<string, unknown>) => {
  emitRefresh("system", type, details);
};
