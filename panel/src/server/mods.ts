import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { config } from "./config";

const inflateRawAsync = promisify(zlib.inflateRaw);

const modRoots = {
  active: path.join(config.dataRoot, "mods"),
  quarantine: path.join(config.panelDataRoot, "mod-quarantine"),
  staging: path.join(config.dataRoot, "mods-staging")
} as const;

const centralDirectorySignature = 0x02014b50;
const endOfCentralDirectorySignature = 0x06054b50;
const localFileHeaderSignature = 0x04034b50;
const maxMetadataBytes = 128 * 1024;
const maxUploadBytes = 32 * 1024 * 1024;
const maxZipCommentBytes = 0xffff;
const jarNamePattern = /^[A-Za-z0-9][A-Za-z0-9._+-]*\.jar$/;
const zipMagic = Buffer.from([0x50, 0x4b]);

type ModScope = keyof typeof modRoots;
type ModWriteScope = Exclude<ModScope, "active"> | "active";
type QuarantineReason = "delete-active" | "manual-quarantine" | "rejected-upload";

type FabricModMetadata = {
  description?: string;
  environment?: string;
  id: string;
  name?: string;
  version?: string;
};

type QuarantineMetadata = {
  previousScope: Exclude<ModScope, "quarantine">;
  quarantinedAt: string;
  reason: QuarantineReason;
};

export type ModRecord = {
  fabricMetadata: FabricModMetadata | null;
  fileName: string;
  modifiedAt: string;
  quarantineMetadata?: QuarantineMetadata;
  scope: ModScope;
  sizeBytes: number;
};

export type ModsInventory = {
  mods: Record<ModScope, ModRecord[]>;
  restartRequired: boolean;
  roots: Record<ModScope, string>;
};

class ModError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "ModError";
    this.statusCode = statusCode;
  }
}

class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

const ensureModRoots = async () => {
  await Promise.all(Object.values(modRoots).map((root) => fs.mkdir(root, { recursive: true })));
};

const isJarFile = (value: string) => value.toLowerCase().endsWith(".jar");

const readUInt16 = (buffer: Buffer, offset: number) => buffer.readUInt16LE(offset);
const readUInt32 = (buffer: Buffer, offset: number) => buffer.readUInt32LE(offset);

const validateModName = (value: string) => {
  const trimmed = value.trim();

  if (!jarNamePattern.test(trimmed) || path.basename(trimmed) !== trimmed) {
    throw new ModError("invalid mod file name");
  }

  return trimmed;
};

const resolveModPath = async (scope: ModScope, fileName: string, options: { mustExist?: boolean } = {}) => {
  await ensureModRoots();
  const safeName = validateModName(fileName);
  const root = modRoots[scope];
  const resolved = path.resolve(root, safeName);

  if (!resolved.startsWith(`${root}${path.sep}`) && resolved !== path.join(root, safeName)) {
    throw new ModError("invalid mod path");
  }

  const stat = await fs.stat(resolved).catch(() => null);

  if (options.mustExist && !stat?.isFile()) {
    throw new ModError("mod not found", 404);
  }

  if (stat && !stat.isFile()) {
    throw new ModError("mod path is not a file");
  }

  return {
    path: resolved,
    stat
  };
};

const getQuarantineMetadataPath = (fileName: string) => path.join(modRoots.quarantine, `${fileName}.panel-meta.json`);

const readQuarantineMetadata = async (fileName: string): Promise<QuarantineMetadata | undefined> => {
  try {
    const raw = await fs.readFile(getQuarantineMetadataPath(validateModName(fileName)), "utf8");
    const parsed = JSON.parse(raw) as Partial<QuarantineMetadata>;

    if (
      (parsed.previousScope === "active" || parsed.previousScope === "staging") &&
      typeof parsed.quarantinedAt === "string" &&
      (parsed.reason === "delete-active" || parsed.reason === "manual-quarantine" || parsed.reason === "rejected-upload")
    ) {
      return {
        previousScope: parsed.previousScope,
        quarantinedAt: parsed.quarantinedAt,
        reason: parsed.reason
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
};

const writeQuarantineMetadata = async (fileName: string, metadata: QuarantineMetadata) => {
  await fs.writeFile(getQuarantineMetadataPath(validateModName(fileName)), `${JSON.stringify(metadata, null, 2)}\n`);
};

const deleteQuarantineMetadata = async (fileName: string) => {
  await fs.rm(getQuarantineMetadataPath(validateModName(fileName)), { force: true });
};

const findEndOfCentralDirectory = (buffer: Buffer) => {
  const startOffset = Math.max(0, buffer.length - (22 + maxZipCommentBytes));

  for (let offset = buffer.length - 22; offset >= startOffset; offset -= 1) {
    if (readUInt32(buffer, offset) === endOfCentralDirectorySignature) {
      return offset;
    }
  }

  throw new ZipError("missing end of central directory");
};

const findZipEntry = (buffer: Buffer, fileName: string) => {
  const endOffset = findEndOfCentralDirectory(buffer);
  const centralDirectorySize = readUInt32(buffer, endOffset + 12);
  const centralDirectoryOffset = readUInt32(buffer, endOffset + 16);
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  let offset = centralDirectoryOffset;

  while (offset < centralDirectoryEnd) {
    if (readUInt32(buffer, offset) !== centralDirectorySignature) {
      throw new ZipError("invalid central directory header");
    }

    const compressionMethod = readUInt16(buffer, offset + 10);
    const compressedSize = readUInt32(buffer, offset + 20);
    const uncompressedSize = readUInt32(buffer, offset + 24);
    const fileNameLength = readUInt16(buffer, offset + 28);
    const extraLength = readUInt16(buffer, offset + 30);
    const commentLength = readUInt16(buffer, offset + 32);
    const localHeaderOffset = readUInt32(buffer, offset + 42);
    const entryNameStart = offset + 46;
    const entryNameEnd = entryNameStart + fileNameLength;
    const entryName = buffer.toString("utf8", entryNameStart, entryNameEnd);

    if (entryName === fileName) {
      return {
        compressedSize,
        compressionMethod,
        localHeaderOffset,
        uncompressedSize
      };
    }

    offset = entryNameEnd + extraLength + commentLength;
  }

  return null;
};

const extractZipEntry = async (buffer: Buffer, fileName: string) => {
  const entry = findZipEntry(buffer, fileName);

  if (!entry) {
    return null;
  }

  if (entry.uncompressedSize > maxMetadataBytes) {
    throw new ZipError("fabric metadata exceeds maximum size");
  }

  if (readUInt32(buffer, entry.localHeaderOffset) !== localFileHeaderSignature) {
    throw new ZipError("invalid local file header");
  }

  const fileNameLength = readUInt16(buffer, entry.localHeaderOffset + 26);
  const extraLength = readUInt16(buffer, entry.localHeaderOffset + 28);
  const dataOffset = entry.localHeaderOffset + 30 + fileNameLength + extraLength;
  const dataEnd = dataOffset + entry.compressedSize;
  const payload = buffer.subarray(dataOffset, dataEnd);

  if (entry.compressionMethod === 0) {
    return payload;
  }

  if (entry.compressionMethod === 8) {
    return inflateRawAsync(payload);
  }

  throw new ZipError(`unsupported compression method ${entry.compressionMethod}`);
};

const parseFabricMetadata = (value: unknown): FabricModMetadata | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const metadata = value as Record<string, unknown>;
  const id = typeof metadata.id === "string" ? metadata.id : "";

  if (!id) {
    return null;
  }

  return {
    description: typeof metadata.description === "string" ? metadata.description : undefined,
    environment: typeof metadata.environment === "string" ? metadata.environment : undefined,
    id,
    name: typeof metadata.name === "string" ? metadata.name : undefined,
    version: typeof metadata.version === "string" ? metadata.version : undefined
  };
};

const readFabricMetadata = async (filePath: string) => {
  try {
    const buffer = await fs.readFile(filePath);
    const rawMetadata = await extractZipEntry(buffer, "fabric.mod.json");

    if (!rawMetadata) {
      return null;
    }

    return parseFabricMetadata(JSON.parse(rawMetadata.toString("utf8")));
  } catch (error) {
    if (error instanceof ZipError || error instanceof SyntaxError) {
      return null;
    }

    throw error;
  }
};

const ensureZipLikeJar = (buffer: Buffer) => {
  if (buffer.length < 4 || !buffer.subarray(0, 2).equals(zipMagic)) {
    throw new ModError("uploaded file is not a valid jar archive");
  }
};

const moveFile = async (sourcePath: string, destinationPath: string) => {
  try {
    await fs.rename(sourcePath, destinationPath);
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";

    if (code !== "EXDEV") {
      throw error;
    }

    await fs.copyFile(sourcePath, destinationPath);
    await fs.unlink(sourcePath);
  }
};

const decodeUploadContent = (contentBase64: string) => {
  const trimmed = contentBase64.trim();

  if (!trimmed) {
    throw new ModError("contentBase64 is required");
  }

  const buffer = Buffer.from(trimmed, "base64");

  if (buffer.length === 0) {
    throw new ModError("uploaded file content is empty");
  }

  if (buffer.length > maxUploadBytes) {
    throw new ModError(`uploaded file exceeds ${Math.floor(maxUploadBytes / (1024 * 1024))} MB limit`, 413);
  }

  ensureZipLikeJar(buffer);
  return buffer;
};

const getAvailableTargetPath = async (scope: ModScope, fileName: string) => {
  const safeName = validateModName(fileName);
  const ext = path.extname(safeName);
  const base = safeName.slice(0, -ext.length);
  let attempt = 0;

  while (attempt < 1000) {
    const candidate = attempt === 0
      ? safeName
      : `${base}-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}-${attempt}${ext}`;
    const { stat } = await resolveModPath(scope, candidate);

    if (!stat) {
      return path.join(modRoots[scope], candidate);
    }

    attempt += 1;
  }

  throw new ModError("could not allocate a quarantine file name", 500);
};

const createModRecord = async (scope: ModScope, fileName: string): Promise<ModRecord> => {
  const resolved = await resolveModPath(scope, fileName, { mustExist: true });

  return {
    fabricMetadata: await readFabricMetadata(resolved.path),
    fileName,
    modifiedAt: resolved.stat!.mtime.toISOString(),
    quarantineMetadata: scope === "quarantine" ? await readQuarantineMetadata(fileName) : undefined,
    scope,
    sizeBytes: resolved.stat!.size
  };
};

const listScope = async (scope: ModScope): Promise<ModRecord[]> => {
  const directoryEntries = await fs.readdir(modRoots[scope], { withFileTypes: true });
  const records = await Promise.all(directoryEntries
    .filter((entry) => entry.isFile() && isJarFile(entry.name))
    .map((entry) => createModRecord(scope, entry.name)));

  return records.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt) || left.fileName.localeCompare(right.fileName));
};

const moveIntoQuarantine = async (scope: Exclude<ModScope, "quarantine">, fileName: string, reason: QuarantineReason) => {
  const source = await resolveModPath(scope, fileName, { mustExist: true });
  const quarantinePath = await getAvailableTargetPath("quarantine", fileName);
  const quarantineName = path.basename(quarantinePath);

  await moveFile(source.path, quarantinePath);
  await writeQuarantineMetadata(quarantineName, {
    previousScope: scope,
    quarantinedAt: new Date().toISOString(),
    reason
  });

  return createModRecord("quarantine", quarantineName);
};

export const listModsInventory = async (): Promise<ModsInventory> => {
  await ensureModRoots();

  return {
    mods: {
      active: await listScope("active"),
      quarantine: await listScope("quarantine"),
      staging: await listScope("staging")
    },
    restartRequired: true,
    roots: { ...modRoots }
  };
};

export const uploadModToStaging = async (options: { contentBase64: string; fileName: string }) => {
  await ensureModRoots();
  const safeName = validateModName(options.fileName);
  const buffer = decodeUploadContent(options.contentBase64);
  const destination = await resolveModPath("staging", safeName);

  if (destination.stat) {
    throw new ModError("a staged mod with that name already exists", 409);
  }

  await fs.writeFile(destination.path, buffer, { flag: "wx" });
  return createModRecord("staging", safeName);
};

export const installMod = async (scope: "staging" | "quarantine", fileName: string) => {
  await ensureModRoots();
  const safeName = validateModName(fileName);
  const source = await resolveModPath(scope, safeName, { mustExist: true });
  const destination = await resolveModPath("active", safeName);

  if (destination.stat) {
    throw new ModError("an active mod with that name already exists", 409);
  }

  await moveFile(source.path, destination.path);

  if (scope === "quarantine") {
    await deleteQuarantineMetadata(safeName);
  }

  return createModRecord("active", safeName);
};

export const quarantineMod = async (scope: "active" | "staging", fileName: string) => {
  return moveIntoQuarantine(scope, fileName, scope === "active" ? "delete-active" : "manual-quarantine");
};

export const restoreQuarantinedMod = async (fileName: string, targetScope: "active" | "staging" = "staging") => {
  await ensureModRoots();
  const safeName = validateModName(fileName);
  const source = await resolveModPath("quarantine", safeName, { mustExist: true });
  const destination = await resolveModPath(targetScope, safeName);

  if (destination.stat) {
    throw new ModError(`a ${targetScope} mod with that name already exists`, 409);
  }

  await moveFile(source.path, destination.path);
  await deleteQuarantineMetadata(safeName);
  return createModRecord(targetScope, safeName);
};

export const deleteMod = async (scope: "staging" | "quarantine", fileName: string) => {
  const safeName = validateModName(fileName);
  const resolved = await resolveModPath(scope, safeName, { mustExist: true });
  const record = await createModRecord(scope, safeName);

  await fs.unlink(resolved.path);
  if (scope === "quarantine") {
    await deleteQuarantineMetadata(safeName);
  }

  return record;
};

export const rejectUploadedMod = async (fileName: string) => moveIntoQuarantine("staging", fileName, "rejected-upload");

export const toModErrorResponse = (error: unknown) => {
  if (error instanceof ModError) {
    return {
      message: error.message,
      statusCode: error.statusCode
    };
  }

  return {
    message: "internal mod operation failure",
    statusCode: 500
  };
};
