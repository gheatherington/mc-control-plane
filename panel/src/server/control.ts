import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "./config";

const execFileAsync = promisify(execFile);
const controlScript = "/srv/minecraft/scripts/server-control.sh";
const consoleEchoPath = path.join(config.panelDataRoot, "console", "commands.log");

const ansiEscapePattern = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const nonPrintableControlPattern = /[\u0000-\u0008\u000b-\u001f\u007f]/g;
const managementNoisePattern = /\[Management server IO #[0-9]+\/INFO\]: RPC Connection #[0-9]+: Management connection (opened|closed) for /;
const rconNoisePattern = /\[RCON (Listener|Client).*Thread RCON Client .* (started|shutting down)/;
const allTheLeaksSummaryPattern = /\[AllTheLeaks\/\]: (Listing events\.\.\.|Listing memory leaks so far\.\.\.|B: .* \/ C: .* \/ Diff: .*|Memory Leaks detected: .*|No memory leak detected!|Server Player Logout: \d+|\| Player:|\|- ServerPlayer \(minecraft\): \d+|\| ChunkAccess:|\|- LevelChunk \(minecraft\): \d+)/;
const logTimestampPattern = /^\[(\d{2}):(\d{2}):(\d{2})\]/;

const sanitizeLogLine = (line: string) => line
  .replace(/\r/g, "")
  .replace(ansiEscapePattern, "")
  .replace(nonPrintableControlPattern, "")
  .trimEnd();

const isNoiseLine = (line: string) => managementNoisePattern.test(line)
  || rconNoisePattern.test(line)
  || allTheLeaksSummaryPattern.test(line);

const normalizeLogLines = (raw: string) => raw
  .split("\n")
  .map(sanitizeLogLine)
  .filter((line) => line.length > 0 && !isNoiseLine(line));

const readLogTimestamp = (line: string) => {
  const match = line.match(logTimestampPattern);

  if (!match) {
    return Number.MAX_SAFE_INTEGER;
  }

  const [, hours, minutes, seconds] = match;
  return (Number(hours) * 60 * 60) + (Number(minutes) * 60) + Number(seconds);
};

const runControl = async (args: string[]) => {
  const result = await execFileAsync(controlScript, args, {
    env: {
      ...process.env
    }
  });

  return result.stdout.trim();
};

const readConsoleEchoes = async () => {
  try {
    const raw = await fs.readFile(consoleEchoPath, "utf8");
    return normalizeLogLines(raw);
  } catch {
    return [];
  }
};

export const appendConsoleEcho = async (command: string, output: string) => {
  const stamp = new Date().toISOString().slice(11, 19);
  const outputLines = normalizeLogLines(output);
  const renderedOutput = outputLines.length > 0
    ? outputLines.map((line) => `[${stamp}] [Panel Console/INFO]: < ${line}`).join("\n")
    : `[${stamp}] [Panel Console/INFO]: < (no output)`;

  await fs.mkdir(path.dirname(consoleEchoPath), { recursive: true });
  await fs.appendFile(consoleEchoPath, `[${stamp}] [Panel Console/INFO]: > ${command}\n${renderedOutput}\n`);
};

export const getContainerState = async () => {
  const raw = await runControl(["status"]);
  return JSON.parse(raw) as {
    ExitCode: number;
    Health?: { Status: string };
    Running: boolean;
    StartedAt: string;
    Status: string;
  };
};

export const getRecentLogs = async (lines = 40) => {
  const [serverLogs, consoleEchoes] = await Promise.all([
    runControl(["logs-tail", String(Math.max(lines * 2, 80))]),
    readConsoleEchoes()
  ]);

  return [...normalizeLogLines(serverLogs), ...consoleEchoes]
    .map((line, index) => ({
      index,
      line,
      timestamp: readLogTimestamp(line)
    }))
    .sort((left, right) => left.timestamp - right.timestamp || left.index - right.index)
    .slice(-lines)
    .map((entry) => entry.line)
    .join("\n");
};

export const runRconCommand = async (...command: string[]) => runControl(["rcon", ...command]);

export const restartServer = async () => runControl(["restart"]);
export const startServer = async () => runControl(["start"]);
export const stopServer = async () => runControl(["stop"]);
