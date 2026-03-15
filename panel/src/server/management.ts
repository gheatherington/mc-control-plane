import fs from "node:fs/promises";
import path from "node:path";
import WebSocket from "ws";
import { config } from "./config";

const rpcTimeoutMs = 5000;

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

const readManagementSecret = async () => {
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
