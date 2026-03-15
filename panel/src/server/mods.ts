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
const maxZipCommentBytes = 0xffff;

type ModScope = keyof typeof modRoots;

type FabricModMetadata = {
  description?: string;
  environment?: string;
  id: string;
  name?: string;
  version?: string;
};

export type ModRecord = {
  fabricMetadata: FabricModMetadata | null;
  fileName: string;
  modifiedAt: string;
  scope: ModScope;
  sizeBytes: number;
};

export type ModsInventory = {
  mods: Record<ModScope, ModRecord[]>;
  restartRequired: boolean;
  roots: Record<ModScope, string>;
};

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

const listScope = async (scope: ModScope): Promise<ModRecord[]> => {
  const directoryEntries = await fs.readdir(modRoots[scope], { withFileTypes: true });
  const records = await Promise.all(directoryEntries
    .filter((entry) => entry.isFile() && isJarFile(entry.name))
    .map(async (entry) => {
      const filePath = path.join(modRoots[scope], entry.name);
      const stat = await fs.stat(filePath);

      return {
        fabricMetadata: await readFabricMetadata(filePath),
        fileName: entry.name,
        modifiedAt: stat.mtime.toISOString(),
        scope,
        sizeBytes: stat.size
      };
    }));

  return records.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt) || left.fileName.localeCompare(right.fileName));
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
