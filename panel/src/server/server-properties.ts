import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config";

export const propertiesPath = path.join(config.dataRoot, "server.properties");

export const readServerProperties = async () => {
  const raw = await fs.readFile(propertiesPath, "utf8");
  return raw.split("\n").reduce<Record<string, string>>((accumulator, line) => {
    if (!line || line.startsWith("#") || !line.includes("=")) {
      return accumulator;
    }

    const index = line.indexOf("=");
    const key = line.slice(0, index);
    const value = line.slice(index + 1);
    accumulator[key] = value;
    return accumulator;
  }, {});
};

export const writeServerProperties = async (updates: Record<string, string>) => {
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
