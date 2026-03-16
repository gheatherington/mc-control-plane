import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import { getContainerState, getRecentLogs, runRconCommand } from "./control";
import { callManagement, getManagementCapability } from "./management";

type NamedEntry = {
  created?: string;
  expires?: string;
  name: string;
  source?: string;
  uuid?: string;
};

type PlayerSummary = {
  banned: boolean;
  online: boolean;
  op: boolean;
  whitelist: boolean;
  name: string;
  uuid?: string;
};

type RemotePlayer = {
  id?: string;
  name: string;
};

type RemoteOperator = {
  bypassesPlayerLimit?: boolean;
  permissionLevel?: number;
  player: RemotePlayer;
};

type RemoteUserBan = {
  expires?: string;
  player: RemotePlayer;
  reason?: string;
  source?: string;
};

type RemoteIpBan = {
  expires?: string;
  ip: string;
  reason?: string;
  source?: string;
};

const parseOnlinePlayersFromRcon = (raw: string): RemotePlayer[] => {
  const stripped = raw.replace(/\u001b\[[0-9;]*m/g, "").trim();

  if (!stripped) {
    return [];
  }

  const statusLine = stripped
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /players online:/i.test(line));

  if (!statusLine) {
    return [];
  }

  const onlineListMatch = statusLine.match(/players online:\s*(.*)$/i);

  if (!onlineListMatch) {
    return [];
  }

  const renderedNames = onlineListMatch[1]?.trim();

  if (!renderedNames) {
    return [];
  }

  return renderedNames
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((name) => ({ name }));
};

const readJsonFile = async <T>(filename: string, fallback: T): Promise<T> => {
  try {
    const raw = await fs.readFile(path.join(config.dataRoot, filename), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const parseProperties = async () => {
  const raw = await fs.readFile(path.join(config.dataRoot, "server.properties"), "utf8");
  const values = raw.split("\n").reduce<Record<string, string>>((accumulator, line) => {
    if (!line || line.startsWith("#") || !line.includes("=")) {
      return accumulator;
    }

    const index = line.indexOf("=");
    const key = line.slice(0, index);
    const value = line.slice(index + 1);
    accumulator[key] = value;
    return accumulator;
  }, {});

  return values;
};

const mergePlayers = async (remote?: {
  bannedPlayers: RemoteUserBan[];
  onlinePlayers: RemotePlayer[];
  ops: RemoteOperator[];
  whitelist: RemotePlayer[];
}): Promise<PlayerSummary[]> => {
  const [knownPlayers, whitelist, ops, bannedPlayers] = await Promise.all([
    readJsonFile<NamedEntry[]>("usercache.json", []),
    readJsonFile<NamedEntry[]>("whitelist.json", []),
    readJsonFile<NamedEntry[]>("ops.json", []),
    readJsonFile<NamedEntry[]>("banned-players.json", [])
  ]);

  const players = new Map<string, PlayerSummary>();

  const ensure = (name: string, uuid?: string) => {
    const existing = players.get(name) || {
      banned: false,
      online: false,
      op: false,
      whitelist: false,
      name,
      uuid
    };

    if (uuid && !existing.uuid) {
      existing.uuid = uuid;
    }

    players.set(name, existing);
    return existing;
  };

  for (const player of knownPlayers) {
    ensure(player.name, player.uuid);
  }

  for (const player of whitelist) {
    ensure(player.name, player.uuid).whitelist = true;
  }

  for (const player of ops) {
    ensure(player.name, player.uuid).op = true;
  }

  for (const player of bannedPlayers) {
    ensure(player.name, player.uuid).banned = true;
  }

  for (const player of remote?.whitelist || []) {
    ensure(player.name, player.id).whitelist = true;
  }

  for (const operator of remote?.ops || []) {
    ensure(operator.player.name, operator.player.id).op = true;
  }

  for (const player of remote?.bannedPlayers || []) {
    ensure(player.player.name, player.player.id).banned = true;
  }

  for (const player of remote?.onlinePlayers || []) {
    ensure(player.name, player.id).online = true;
  }

  return Array.from(players.values()).sort((left, right) => left.name.localeCompare(right.name));
};

const readSettingsFromManagement = async () => {
  const [status, difficulty, maxPlayers, motd, whitelistEnabled] = await Promise.all([
    callManagement<{ players?: RemotePlayer[]; started: boolean; version?: { name?: string } }>("minecraft:server/status"),
    callManagement<string>("minecraft:serversettings/difficulty"),
    callManagement<number>("minecraft:serversettings/max_players"),
    callManagement<string>("minecraft:serversettings/motd"),
    callManagement<boolean>("minecraft:serversettings/use_allowlist")
  ]);

  return {
    difficulty,
    maxPlayers,
    motd,
    onlinePlayers: status.players || [],
    version: status.version?.name,
    whitelistEnabled
  };
};

const readOnlinePlayersFallback = async () => {
  try {
    return parseOnlinePlayersFromRcon(await runRconCommand("list"));
  } catch {
    return [];
  }
};

const readPlayerName = (entry: NamedEntry | RemotePlayer) => entry.name;

const readOperatorName = (entry: NamedEntry | RemoteOperator) =>
  "player" in entry ? entry.player.name : entry.name;

export const getDashboard = async () => {
  const [state, properties, logs] = await Promise.all([
    getContainerState(),
    parseProperties(),
    getRecentLogs(20)
  ]);
  const management = getManagementCapability();

  let settings: Awaited<ReturnType<typeof readSettingsFromManagement>> | null = null;
  let fallbackOnlinePlayers: RemotePlayer[] = [];

  if (state.Running && management.supported) {
    try {
      settings = await readSettingsFromManagement();
    } catch {
      settings = null;
      fallbackOnlinePlayers = await readOnlinePlayersFallback();
    }
  } else if (state.Running) {
    fallbackOnlinePlayers = await readOnlinePlayersFallback();
  }

  const players = await mergePlayers(settings ? {
    bannedPlayers: [],
    onlinePlayers: settings.onlinePlayers,
    ops: [],
    whitelist: []
  } : {
    bannedPlayers: [],
    onlinePlayers: fallbackOnlinePlayers,
    ops: [],
    whitelist: []
  });

  return {
    logs: logs.split("\n").filter(Boolean),
    players: {
      known: players.length,
      online: players.filter((player) => player.online).length
    },
    server: {
      difficulty: settings?.difficulty || properties.difficulty,
      management,
      maxPlayers: settings?.maxPlayers || Number(properties["max-players"] || 0),
      motd: settings?.motd || properties.motd,
      onlineMode: properties["online-mode"] === "true",
      port: 6767,
      status: state.Status,
      healthy: state.Health?.Status || "unknown",
      version: settings?.version || config.minecraftVersion,
      whitelistEnabled: settings?.whitelistEnabled ?? (properties["white-list"] === "true")
    }
  };
};

export const listPlayers = async () => {
  const state = await getContainerState();
  const management = getManagementCapability();
  let remote: {
    bannedIps: RemoteIpBan[];
    bannedPlayers: RemoteUserBan[];
    onlinePlayers: RemotePlayer[];
    ops: RemoteOperator[];
    whitelist: RemotePlayer[];
  } | null = null;
  let fallbackOnlinePlayers: RemotePlayer[] = [];

  if (state.Running && management.supported) {
    try {
      const [onlinePlayers, bannedIps, whitelist, ops, bannedPlayers] = await Promise.all([
        callManagement<RemotePlayer[]>("minecraft:players"),
        callManagement<RemoteIpBan[]>("minecraft:ip_bans"),
        callManagement<RemotePlayer[]>("minecraft:allowlist"),
        callManagement<RemoteOperator[]>("minecraft:operators"),
        callManagement<RemoteUserBan[]>("minecraft:bans")
      ]);

      remote = {
        bannedIps,
        bannedPlayers,
        onlinePlayers,
        ops,
        whitelist
      };
    } catch {
      remote = null;
      fallbackOnlinePlayers = await readOnlinePlayersFallback();
    }
  } else if (state.Running) {
    fallbackOnlinePlayers = await readOnlinePlayersFallback();
  }

  const [players, bannedIps, whitelist, ops] = await Promise.all([
    mergePlayers(remote ? {
      bannedPlayers: remote.bannedPlayers,
      onlinePlayers: remote.onlinePlayers,
      ops: remote.ops,
      whitelist: remote.whitelist
    } : {
      bannedPlayers: [],
      onlinePlayers: fallbackOnlinePlayers,
      ops: [],
      whitelist: []
    }),
    remote ? Promise.resolve(remote.bannedIps) : readJsonFile<NamedEntry[]>("banned-ips.json", []),
    remote ? Promise.resolve(remote.whitelist) : readJsonFile<NamedEntry[]>("whitelist.json", []),
    remote ? Promise.resolve(remote.ops) : readJsonFile<NamedEntry[]>("ops.json", [])
  ]);

  return {
    bannedIps,
    management,
    ops: ops.map(readOperatorName),
    players,
    whitelist: whitelist.map(readPlayerName)
  };
};

export const whitelistPlayer = async (name: string) => {
  try {
    await callManagement("minecraft:allowlist/add", [[{ name }]]);
  } catch {
    await runRconCommand("whitelist", "add", name);
  }
  return listPlayers();
};

export const unwhitelistPlayer = async (name: string) => {
  try {
    await callManagement("minecraft:allowlist/remove", [[{ name }]]);
  } catch {
    await runRconCommand("whitelist", "remove", name);
  }
  return listPlayers();
};

export const opPlayer = async (name: string) => {
  try {
    await callManagement("minecraft:operators/add", [[{
      bypassesPlayerLimit: false,
      permissionLevel: 4,
      player: { name }
    }]]);
  } catch {
    await runRconCommand("op", name);
  }
  return listPlayers();
};

export const deopPlayer = async (name: string) => {
  try {
    await callManagement("minecraft:operators/remove", [[{ name }]]);
  } catch {
    await runRconCommand("deop", name);
  }
  return listPlayers();
};

export const banPlayer = async (name: string) => {
  try {
    await callManagement("minecraft:bans/add", [[{
      player: { name }
    }]]);
  } catch {
    await runRconCommand("ban", name);
  }
  return listPlayers();
};

export const pardonPlayer = async (name: string) => {
  try {
    await callManagement("minecraft:bans/remove", [[{ name }]]);
  } catch {
    await runRconCommand("pardon", name);
  }
  return listPlayers();
};

export const kickPlayer = async (name: string, reason?: string) => {
  const trimmedReason = reason?.trim();

  try {
    await callManagement("minecraft:players/kick", [[{
      message: trimmedReason ? { literal: trimmedReason } : undefined,
      player: { name }
    }]]);
  } catch {
    await runRconCommand(...["kick", name, ...(trimmedReason ? [trimmedReason] : [])]);
  }
  return listPlayers();
};

export const saveWorld = async () => {
  try {
    await callManagement("minecraft:server/save", [false]);
    return "Save requested through the management API";
  } catch {
    await runRconCommand("save-all", "flush");
    return "Save requested through RCON fallback";
  }
};

export const broadcastMessage = async (message: string) => {
  try {
    await callManagement("minecraft:server/system_message", [{
      message: { literal: message },
      overlay: false
    }]);

    return "Broadcast sent through the management API";
  } catch {
    await runRconCommand("say", message);
    return "Broadcast sent through RCON fallback";
  }
};
