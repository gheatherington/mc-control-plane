import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import { getContainerState } from "./control";
import { callManagement } from "./management";

type SettingType = "boolean" | "enum" | "integer" | "string";
type SettingValue = boolean | number | string;

type SettingDefinition = {
  description: string;
  group: string;
  key: string;
  label: string;
  propertyKey: string;
  restartRequired: boolean;
  type: SettingType;
  options?: string[];
  managementGetMethod?: string;
  managementSetMethod?: string;
  normalize: (value: unknown) => SettingValue;
};

type PendingRestartState = {
  values: Record<string, string>;
  updatedAt: string;
};

const restartBaselinePath = path.join(config.panelDataRoot, "settings", "restart-baseline.json");
const propertiesPath = path.join(config.dataRoot, "server.properties");

const groupMetadata = {
  capacity: {
    description: "Player capacity and visible server text.",
    title: "Capacity"
  },
  gameplay: {
    description: "Runtime gameplay and safety behavior for the live server.",
    title: "Gameplay"
  },
  network: {
    description: "Connection behavior that remains restart-bound.",
    title: "Network"
  },
  whitelist: {
    description: "Allowlist behavior for who may join and how enforcement works.",
    title: "Whitelist"
  },
  world: {
    description: "World simulation and distance-related server settings.",
    title: "World"
  }
} as const;

const coerceBoolean = (value: unknown) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }

  throw new Error("expected a boolean value");
};

const coerceInteger = (value: unknown, { max, min }: { max: number; min: number }) => {
  const parsed = typeof value === "number" ? value : Number(String(value).trim());

  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`expected an integer between ${min} and ${max}`);
  }

  return parsed;
};

const coerceString = (value: unknown, { max, min }: { max: number; min: number }) => {
  const normalized = String(value ?? "").trim();

  if (normalized.length < min || normalized.length > max) {
    throw new Error(`expected a string between ${min} and ${max} characters`);
  }

  return normalized;
};

const coerceEnum = (value: unknown, options: string[]) => {
  const normalized = String(value ?? "").trim().toLowerCase();

  if (!options.includes(normalized)) {
    throw new Error(`expected one of: ${options.join(", ")}`);
  }

  return normalized;
};

const settings: SettingDefinition[] = [
  {
    description: "Controls hostile mob strength and general survival pressure.",
    group: "gameplay",
    key: "difficulty",
    label: "Difficulty",
    managementGetMethod: "minecraft:serversettings/difficulty",
    managementSetMethod: "minecraft:serversettings/difficulty/set",
    normalize: (value) => coerceEnum(value, ["peaceful", "easy", "normal", "hard"]),
    options: ["peaceful", "easy", "normal", "hard"],
    propertyKey: "difficulty",
    restartRequired: false,
    type: "enum"
  },
  {
    description: "Allows or denies flight for players and modded clients.",
    group: "gameplay",
    key: "allowFlight",
    label: "Allow Flight",
    managementGetMethod: "minecraft:serversettings/allow_flight",
    managementSetMethod: "minecraft:serversettings/allow_flight/set",
    normalize: coerceBoolean,
    propertyKey: "allow-flight",
    restartRequired: false,
    type: "boolean"
  },
  {
    description: "Idle seconds before the server kicks an inactive player. Use 0 to disable.",
    group: "gameplay",
    key: "playerIdleTimeout",
    label: "Player Idle Timeout",
    managementGetMethod: "minecraft:serversettings/player_idle_timeout",
    managementSetMethod: "minecraft:serversettings/player_idle_timeout/set",
    normalize: (value) => coerceInteger(value, { max: 86400, min: 0 }),
    propertyKey: "player-idle-timeout",
    restartRequired: false,
    type: "integer"
  },
  {
    description: "Whether only allowlisted players may join the server.",
    group: "whitelist",
    key: "useAllowlist",
    label: "Use Allowlist",
    managementGetMethod: "minecraft:serversettings/use_allowlist",
    managementSetMethod: "minecraft:serversettings/use_allowlist/set",
    normalize: coerceBoolean,
    propertyKey: "white-list",
    restartRequired: false,
    type: "boolean"
  },
  {
    description: "When enabled, players removed from the allowlist are kicked immediately.",
    group: "whitelist",
    key: "enforceAllowlist",
    label: "Enforce Allowlist",
    managementGetMethod: "minecraft:serversettings/enforce_allowlist",
    managementSetMethod: "minecraft:serversettings/enforce_allowlist/set",
    normalize: coerceBoolean,
    propertyKey: "enforce-whitelist",
    restartRequired: false,
    type: "boolean"
  },
  {
    description: "How many players may join simultaneously.",
    group: "capacity",
    key: "maxPlayers",
    label: "Max Players",
    managementGetMethod: "minecraft:serversettings/max_players",
    managementSetMethod: "minecraft:serversettings/max_players/set",
    normalize: (value) => coerceInteger(value, { max: 1000, min: 1 }),
    propertyKey: "max-players",
    restartRequired: false,
    type: "integer"
  },
  {
    description: "The message shown in the multiplayer server list.",
    group: "capacity",
    key: "motd",
    label: "MOTD",
    managementGetMethod: "minecraft:serversettings/motd",
    managementSetMethod: "minecraft:serversettings/motd/set",
    normalize: (value) => coerceString(value, { max: 120, min: 1 }),
    propertyKey: "motd",
    restartRequired: false,
    type: "string"
  },
  {
    description: "Chunk radius sent to players for rendering.",
    group: "world",
    key: "viewDistance",
    label: "View Distance",
    managementGetMethod: "minecraft:serversettings/view_distance",
    managementSetMethod: "minecraft:serversettings/view_distance/set",
    normalize: (value) => coerceInteger(value, { max: 32, min: 2 }),
    propertyKey: "view-distance",
    restartRequired: false,
    type: "integer"
  },
  {
    description: "Chunk radius simulated on the server.",
    group: "world",
    key: "simulationDistance",
    label: "Simulation Distance",
    managementGetMethod: "minecraft:serversettings/simulation_distance",
    managementSetMethod: "minecraft:serversettings/simulation_distance/set",
    normalize: (value) => coerceInteger(value, { max: 32, min: 2 }),
    propertyKey: "simulation-distance",
    restartRequired: false,
    type: "integer"
  },
  {
    description: "Pause the server after it has been empty for this many seconds. Use 0 to disable.",
    group: "world",
    key: "pauseWhenEmptySeconds",
    label: "Pause When Empty",
    managementGetMethod: "minecraft:serversettings/pause_when_empty_seconds",
    managementSetMethod: "minecraft:serversettings/pause_when_empty_seconds/set",
    normalize: (value) => coerceInteger(value, { max: 86400, min: 0 }),
    propertyKey: "pause-when-empty-seconds",
    restartRequired: false,
    type: "integer"
  },
  {
    description: "Require Mojang account verification for player joins.",
    group: "network",
    key: "onlineMode",
    label: "Online Mode",
    normalize: coerceBoolean,
    propertyKey: "online-mode",
    restartRequired: true,
    type: "boolean"
  },
  {
    description: "Enable or disable player-versus-player combat.",
    group: "gameplay",
    key: "pvp",
    label: "PVP",
    normalize: coerceBoolean,
    propertyKey: "pvp",
    restartRequired: true,
    type: "boolean"
  }
];

const serializePropertyValue = (value: SettingValue) => {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return String(value);
};

const parseProperties = async () => {
  const raw = await fs.readFile(propertiesPath, "utf8");
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

const writeProperties = async (updates: Record<string, string>) => {
  const raw = await fs.readFile(propertiesPath, "utf8");
  const lines = raw.split("\n");
  const seen = new Set<string>();

  const updatedLines = lines.map((line) => {
    if (!line || line.startsWith("#") || !line.includes("=")) {
      return line;
    }

    const index = line.indexOf("=");
    const key = line.slice(0, index);

    if (!(key in updates)) {
      return line;
    }

    seen.add(key);
    return `${key}=${updates[key]}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) {
      updatedLines.push(`${key}=${value}`);
    }
  }

  await fs.writeFile(propertiesPath, updatedLines.join("\n"));
};

const getRestartRequiredSettings = () => settings.filter((setting) => setting.restartRequired);

const readRestartBaseline = async (): Promise<PendingRestartState | null> => {
  try {
    const raw = await fs.readFile(restartBaselinePath, "utf8");
    const parsed = JSON.parse(raw) as PendingRestartState;
    return {
      values: parsed.values,
      updatedAt: parsed.updatedAt
    };
  } catch {
    return null;
  }
};

const writeRestartBaseline = async (properties: Record<string, string>) => {
  const values = Object.fromEntries(getRestartRequiredSettings().map((setting) => [
    setting.key,
    properties[setting.propertyKey] ?? ""
  ]));

  await fs.mkdir(path.dirname(restartBaselinePath), { recursive: true });
  await fs.writeFile(restartBaselinePath, JSON.stringify({
    updatedAt: new Date().toISOString(),
    values
  }, null, 2));
};

export const refreshRestartBaseline = async () => {
  const properties = await parseProperties();
  await writeRestartBaseline(properties);
};

const readRuntimeValues = async () => {
  const state = await getContainerState();

  if (!state.Running) {
    return {
      liveAvailable: false,
      running: false,
      values: {} as Record<string, SettingValue>
    };
  }

  try {
    const runtimeEntries = await Promise.all(settings
      .filter((setting) => setting.managementGetMethod)
      .map(async (setting) => [setting.key, await callManagement<SettingValue>(setting.managementGetMethod as string)] as const));

    return {
      liveAvailable: true,
      running: true,
      values: Object.fromEntries(runtimeEntries)
    };
  } catch {
    return {
      liveAvailable: false,
      running: true,
      values: {} as Record<string, SettingValue>
    };
  }
};

const buildSettingsPayload = async () => {
  const [properties, runtime] = await Promise.all([
    parseProperties(),
    readRuntimeValues()
  ]);
  let restartBaseline = await readRestartBaseline();

  if (!restartBaseline) {
    await writeRestartBaseline(properties);
    restartBaseline = await readRestartBaseline();
  }

  const pendingRestartKeys = getRestartRequiredSettings()
    .filter((setting) => (restartBaseline?.values[setting.key] ?? "") !== (properties[setting.propertyKey] ?? ""))
    .map((setting) => setting.key);

  const groups = Object.entries(groupMetadata).map(([groupId, meta]) => ({
    description: meta.description,
    id: groupId,
    settings: settings
      .filter((setting) => setting.group === groupId)
      .map((setting) => {
        const propertyValue = properties[setting.propertyKey];
        const fallbackValue = setting.normalize(propertyValue);
        const value = runtime.values[setting.key] ?? fallbackValue;

        return {
          applyMode: setting.restartRequired ? "restart-required" : "live-and-persisted",
          description: setting.description,
          key: setting.key,
          label: setting.label,
          options: setting.options,
          restartRequired: setting.restartRequired,
          type: setting.type,
          value
        };
      }),
    title: meta.title
  }));

  return {
    groups,
    liveSettingsAvailable: runtime.liveAvailable,
    pendingRestart: {
      keys: pendingRestartKeys,
      required: pendingRestartKeys.length > 0,
      updatedAt: restartBaseline?.updatedAt || null
    },
    serverRunning: runtime.running
  };
};

export const getSettings = async () => buildSettingsPayload();

export const updateSettings = async (updates: Record<string, unknown>) => {
  const propertyUpdates: Record<string, string> = {};
  const runtimeUpdates: Array<Promise<unknown>> = [];
  const restartRequiredKeys: string[] = [];
  const appliedKeys: string[] = [];
  const [runtime, properties] = await Promise.all([
    readRuntimeValues(),
    parseProperties()
  ]);

  for (const [key, rawValue] of Object.entries(updates)) {
    const definition = settings.find((setting) => setting.key === key);

    if (!definition) {
      throw new Error(`unknown setting: ${key}`);
    }

    const normalized = definition.normalize(rawValue);
    const serialized = serializePropertyValue(normalized);
    const fileChanged = properties[definition.propertyKey] !== serialized;
    const runtimeChanged = runtime.values[definition.key] !== normalized;

    if (!fileChanged && (!definition.managementSetMethod || !runtime.running || !runtimeChanged)) {
      continue;
    }

    propertyUpdates[definition.propertyKey] = serialized;
    appliedKeys.push(definition.key);

    if (definition.managementSetMethod && runtime.running && runtime.liveAvailable && runtimeChanged) {
      runtimeUpdates.push(callManagement(definition.managementSetMethod, [normalized]));
    } else if (fileChanged && (definition.restartRequired || !runtime.liveAvailable)) {
      restartRequiredKeys.push(definition.key);
    }
  }

  if (Object.keys(propertyUpdates).length > 0) {
    await writeProperties(propertyUpdates);
  }

  if (runtimeUpdates.length > 0) {
    await Promise.all(runtimeUpdates);
  }

  return {
    appliedKeys,
    restartRequiredKeys: Array.from(new Set(restartRequiredKeys)).sort(),
    settings: await buildSettingsPayload()
  };
};
