import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "./config";
import { getContainerState, startServer, stopServer } from "./control";

const execFileAsync = promisify(execFile);
const tarCommand = "tar";
const rootName = path.basename(config.dataRoot);
const dataParentRoot = path.dirname(config.dataRoot);

const backupExclusionOptions = [
  {
    description: "Server logs are noisy and can be regenerated outside the archive.",
    key: "logs",
    label: "Logs"
  },
  {
    description: "Crash reports are diagnostic artifacts and usually do not need to be restored.",
    key: "crash-reports",
    label: "Crash Reports"
  },
  {
    description: "The user cache is recreated by the server as players reconnect.",
    key: "usercache.json",
    label: "User Cache"
  }
] as const;

const allowedBackupExclusions = new Set<string>(backupExclusionOptions.map((option) => option.key));

class BackupError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "BackupError";
    this.statusCode = statusCode;
  }
}

export type BackupExclusionOption = (typeof backupExclusionOptions)[number];

export type BackupSummary = {
  createdAt: string;
  format: "tar" | "tar.gz" | "tgz";
  modifiedAt: string;
  name: string;
  sizeBytes: number;
};

export type BackupDetails = BackupSummary & {
  entries: string[];
  entryCount: number;
  includesWorldData: boolean;
  restoreConfirmation: string;
  worldPaths: string[];
};

const ensureBackupsRoot = async () => {
  await fs.mkdir(config.backupsRoot, { recursive: true });
};

const sanitizeBackupLabel = (value: string | undefined) => {
  if (!value) {
    return "";
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
};

const formatBackupStamp = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

const isBackupArchiveName = (value: string) => (
  /^[a-z0-9][a-z0-9._-]*\.(tar|tar\.gz|tgz)$/i.test(value) &&
  path.basename(value) === value
);

const detectArchiveFormat = (name: string): BackupSummary["format"] => {
  if (name.endsWith(".tar.gz")) {
    return "tar.gz";
  }

  if (name.endsWith(".tgz")) {
    return "tgz";
  }

  return "tar";
};

const resolveBackupPath = async (name: string) => {
  if (!isBackupArchiveName(name)) {
    throw new BackupError("invalid backup name");
  }

  await ensureBackupsRoot();
  const backupPath = path.join(config.backupsRoot, name);
  const stat = await fs.stat(backupPath).catch(() => null);

  if (!stat?.isFile()) {
    throw new BackupError("backup not found", 404);
  }

  return backupPath;
};

const readArchiveEntries = async (backupPath: string) => {
  const { stdout } = await execFileAsync(tarCommand, ["-tf", backupPath], {
    cwd: dataParentRoot,
    env: process.env
  });

  return stdout.split("\n").map((line) => line.trim()).filter(Boolean);
};

const createBackupSummary = async (name: string): Promise<BackupSummary> => {
  const backupPath = await resolveBackupPath(name);
  const stat = await fs.stat(backupPath);

  return {
    createdAt: stat.birthtime.toISOString(),
    format: detectArchiveFormat(name),
    modifiedAt: stat.mtime.toISOString(),
    name,
    sizeBytes: stat.size
  };
};

const normalizeExclusions = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(
    value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => allowedBackupExclusions.has(entry))
  ));
};

const knownWorldRoots = [
  "world",
  "world_nether",
  "world_the_end"
];

const detectWorldPaths = (entries: string[]) => {
  const worldDirectories = new Set<string>();

  for (const root of knownWorldRoots) {
    const prefix = `${rootName}/${root}`;
    if (entries.some((entry) => entry === prefix || entry.startsWith(`${prefix}/`))) {
      worldDirectories.add(root);
    }
  }

  return Array.from(worldDirectories).sort();
};

export const getBackupExclusionOptions = (): BackupExclusionOption[] => [...backupExclusionOptions];

export const listBackups = async (): Promise<BackupSummary[]> => {
  await ensureBackupsRoot();

  const directoryEntries = await fs.readdir(config.backupsRoot, { withFileTypes: true });
  const backups = await Promise.all(directoryEntries
    .filter((entry) => entry.isFile() && isBackupArchiveName(entry.name))
    .map((entry) => createBackupSummary(entry.name)));

  return backups.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
};

export const inspectBackup = async (name: string): Promise<BackupDetails> => {
  const summary = await createBackupSummary(name);
  const entries = await readArchiveEntries(path.join(config.backupsRoot, name));
  const worldPaths = detectWorldPaths(entries);

  return {
    ...summary,
    entries: entries.slice(0, 200),
    entryCount: entries.length,
    includesWorldData: worldPaths.length > 0,
    restoreConfirmation: `RESTORE ${name}`,
    worldPaths
  };
};

export const createBackup = async (options: { exclusions?: unknown; name?: string }) => {
  await ensureBackupsRoot();

  const exclusions = normalizeExclusions(options.exclusions);
  const label = sanitizeBackupLabel(options.name);
  const fileName = `${formatBackupStamp(new Date())}-${label || rootName}.tar.gz`;
  const archivePath = path.join(config.backupsRoot, fileName);
  const excludeArgs = exclusions.map((exclusion) => `--exclude=${path.posix.join(rootName, exclusion)}`);

  await execFileAsync(tarCommand, ["-czf", archivePath, ...excludeArgs, rootName], {
    cwd: dataParentRoot,
    env: process.env
  });

  return {
    backup: await inspectBackup(fileName),
    exclusions
  };
};

export const deleteBackup = async (name: string) => {
  const backup = await createBackupSummary(name);
  await fs.unlink(path.join(config.backupsRoot, name));
  return backup;
};

export const restoreBackup = async (name: string, confirmation: string) => {
  const backup = await inspectBackup(name);
  const expectedConfirmation = `RESTORE ${name}`;

  if (confirmation.trim() !== expectedConfirmation) {
    throw new BackupError(`confirmation must match '${expectedConfirmation}'`);
  }

  const backupPath = await resolveBackupPath(name);
  const timestamp = Date.now();
  const extractRoot = path.join(dataParentRoot, `.restore-${rootName}-${timestamp}`);
  const previousRoot = path.join(dataParentRoot, `.${rootName}-before-restore-${timestamp}`);
  const extractedDataRoot = path.join(extractRoot, rootName);
  const containerState = await getContainerState();
  const restartAfterRestore = containerState.Running;
  let currentDataMoved = false;
  let restored = false;
  let previousDataRetained = false;

  await fs.mkdir(extractRoot, { recursive: true });

  try {
    if (restartAfterRestore) {
      await stopServer();
    }

    await execFileAsync(tarCommand, ["-xf", backupPath, "-C", extractRoot], {
      cwd: dataParentRoot,
      env: process.env
    });

    const extractedStat = await fs.stat(extractedDataRoot).catch(() => null);
    if (!extractedStat?.isDirectory()) {
      throw new BackupError(`backup '${name}' does not contain '${rootName}/' at its top level`, 422);
    }

    await fs.rename(config.dataRoot, previousRoot);
    currentDataMoved = true;
    await fs.rename(extractedDataRoot, config.dataRoot);
    restored = true;

    await fs.rm(previousRoot, { force: true, recursive: true }).catch(() => {
      previousDataRetained = true;
    });
  } catch (error) {
    if (currentDataMoved && !restored) {
      await fs.rename(previousRoot, config.dataRoot).catch(() => undefined);
    }

    throw error;
  } finally {
    await fs.rm(extractRoot, { force: true, recursive: true }).catch(() => undefined);

    if (restartAfterRestore) {
      await startServer().catch(() => undefined);
    }
  }

  return {
    backup,
    previousDataRetained,
    restartAfterRestore
  };
};

export const toBackupErrorResponse = (error: unknown) => {
  if (error instanceof BackupError) {
    return {
      message: error.message,
      statusCode: error.statusCode
    };
  }

  return {
    message: error instanceof Error ? error.message : "backup operation failed",
    statusCode: 500
  };
};
