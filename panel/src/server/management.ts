import fs from "node:fs/promises";
import path from "node:path";
import WebSocket from "ws";
import { config } from "./config";

const rpcTimeoutMs = 5000;
const releaseSupportFloor = [1, 21, 9] as const;
const snapshotSupportFloor = { revision: "a", week: 35, year: 25 } as const;

type RpcResponse =
  | {
      jsonrpc: "2.0";
      id: number;
      result: unknown;
    }
  | {
      jsonrpc: "2.0";
      id: number;
      error: {
        code: number;
        data?: unknown;
        message: string;
      };
    }
  | {
      jsonrpc: "2.0";
      method: string;
      params?: unknown[];
    };

export type ManagementCapability = {
  configuredPort: number;
  host: string;
  minimumRelease: string;
  minimumSnapshot: string;
  reason: string;
  runtimeVersion: string;
  supported: boolean;
  transport: "fallback-only" | "json-rpc";
};

const compareReleaseVersions = (left: number[], right: readonly number[]) => {
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index] ?? 0;
    const rightPart = right[index] ?? 0;

    if (leftPart !== rightPart) {
      return leftPart - rightPart;
    }
  }

  return 0;
};

const supportsManagementProtocol = (version: string) => {
  const normalized = version.trim();
  const releaseMatch = normalized.match(/^(\d+)\.(\d+)\.(\d+)$/);

  if (releaseMatch) {
    const release = releaseMatch.slice(1).map(Number);
    return compareReleaseVersions(release, releaseSupportFloor) >= 0;
  }

  const snapshotMatch = normalized.match(/^(\d{2})w(\d{2})([a-z])$/i);

  if (snapshotMatch) {
    const [, year, week, revision] = snapshotMatch;

    if (Number(year) !== snapshotSupportFloor.year) {
      return Number(year) > snapshotSupportFloor.year;
    }

    if (Number(week) !== snapshotSupportFloor.week) {
      return Number(week) > snapshotSupportFloor.week;
    }

    return revision.toLowerCase() >= snapshotSupportFloor.revision;
  }

  return false;
};

const managementCapability: ManagementCapability = (() => {
  const runtimeVersion = config.minecraftVersion;
  const supported = supportsManagementProtocol(runtimeVersion);

  return {
    configuredPort: config.managementPort,
    host: config.managementHost,
    minimumRelease: releaseSupportFloor.join("."),
    minimumSnapshot: `${String(snapshotSupportFloor.year).padStart(2, "0")}w${String(snapshotSupportFloor.week).padStart(2, "0")}${snapshotSupportFloor.revision}`,
    reason: supported
      ? `Minecraft ${runtimeVersion} can expose the native management protocol on ${config.managementHost}:${config.managementPort}.`
      : `Minecraft ${runtimeVersion} predates the native management protocol. It starts at 1.21.9+ and snapshot 25w35a, so this server stays on Docker, file, and RCON fallback paths.`,
    runtimeVersion,
    supported,
    transport: supported ? "json-rpc" : "fallback-only"
  };
})();

export const getManagementCapability = () => managementCapability;

export const readManagementSecret = async () => {
  const raw = await fs.readFile(path.join(config.dataRoot, "server.properties"), "utf8");
  const secretLine = raw
    .split("\n")
    .find((line) => line.startsWith("management-server-secret="));

  const secret = secretLine?.slice(secretLine.indexOf("=") + 1).trim();

  if (!secret) {
    throw new Error("management-server-secret is not configured");
  }

  return secret;
};

export const callManagement = async <T>(method: string, params: unknown[] = []): Promise<T> => {
  const capability = getManagementCapability();

  if (!capability.supported) {
    throw new Error(capability.reason);
  }

  const secret = await readManagementSecret();
  const protocol = config.managementTls ? "wss" : "ws";
  const endpoint = `${protocol}://${config.managementHost}:${config.managementPort}/`;

  return new Promise<T>((resolve, reject) => {
    const id = Date.now();
    const socket = new WebSocket(endpoint, {
      headers: {
        Authorization: `Bearer ${secret}`
      }
    });

    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error(`management API timed out for ${method}`));
    }, rpcTimeoutMs);

    const finish = (callback: () => void) => {
      clearTimeout(timeout);
      callback();
    };

    socket.on("open", () => {
      socket.send(JSON.stringify({
        id,
        jsonrpc: "2.0",
        method,
        params
      }));
    });

    socket.on("message", (raw) => {
      const response = JSON.parse(String(raw)) as RpcResponse;

      if (!("id" in response) || response.id !== id) {
        return;
      }

      finish(() => {
        socket.close();

        if ("error" in response) {
          reject(new Error(`management API error for ${method}: ${response.error.message}`));
          return;
        }

        resolve(response.result as T);
      });
    });

    socket.on("error", (error) => {
      finish(() => reject(error));
    });

    socket.on("close", () => {
      clearTimeout(timeout);
    });
  });
};
