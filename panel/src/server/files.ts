import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config";

const editableExtensions = new Set([".json", ".properties", ".toml", ".txt", ".yml", ".yaml"]);
const textLikeExtensions = new Set([".cfg", ".conf", ".ini", ".json", ".properties", ".toml", ".txt", ".xml", ".yml", ".yaml"]);
const downloadMimeTypes: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".properties": "text/plain; charset=utf-8",
  ".toml": "application/toml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".yml": "application/yaml; charset=utf-8",
  ".yaml": "application/yaml; charset=utf-8"
};
const maxInlineBytes = 512 * 1024;
const maxUploadBytes = 32 * 1024 * 1024;
const safeFileNamePattern = /^[A-Za-z0-9][A-Za-z0-9._ +@-]*$/;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const allowedAdminFiles = new Set([
  "README.txt",
  "banned-ips.json",
  "banned-players.json",
  "eula.txt",
  "log4j2.xml",
  "ops.json",
  "server.properties",
  "user_jvm_args.txt",
  "usercache.json",
  "whitelist.json"
]);

const fileRoots = {
  admin: {
    absolutePath: config.dataRoot,
    label: "Admin Files"
  },
  all: {
    absolutePath: config.dataRoot,
    label: "All Server Files"
  },
  config: {
    absolutePath: path.join(config.dataRoot, "config"),
    label: "Config"
  },
  defaultconfigs: {
    absolutePath: path.join(config.dataRoot, "defaultconfigs"),
    label: "Default Configs"
  },
  mods: {
    absolutePath: path.join(config.dataRoot, "mods"),
    label: "Active Mods"
  },
  "mods-staging": {
    absolutePath: path.join(config.dataRoot, "mods-staging"),
    label: "Staged Mods"
  },
  world: {
    absolutePath: path.join(config.dataRoot, "world"),
    label: "World"
  }
} as const;

export type FileRootKey = keyof typeof fileRoots;

export type FileEntry = {
  editable: boolean;
  isDirectory: boolean;
  modifiedAt: string;
  name: string;
  path: string;
  sizeBytes: number;
};

export type FilesListResponse = {
  entries: FileEntry[];
  path: string;
  root: FileRootKey;
  roots: Array<{ key: FileRootKey; label: string; path: string }>;
};

export type FileContentResponse = {
  content?: string;
  editable: boolean;
  entry: FileEntry;
  root: FileRootKey;
};

class FilesError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "FilesError";
    this.statusCode = statusCode;
  }
}

const isFileRootKey = (value: string): value is FileRootKey => value in fileRoots;

const rootAllowsHiddenPaths = (root: FileRootKey) => root === "all";

const normalizeRelativePath = (value: string, options: { allowHidden?: boolean } = {}) => {
  const trimmed = value.trim().replace(/\\/g, "/");

  if (!trimmed) {
    return "";
  }

  const normalized = path.posix.normalize(trimmed);

  if (normalized.startsWith("/") || normalized === "." || normalized.includes("../") || normalized === "..") {
    throw new FilesError("invalid file path");
  }

  const segments = normalized.split("/").filter(Boolean);

  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      throw new FilesError("hidden and traversal paths are not allowed");
    }

    if (!options.allowHidden && segment.startsWith(".")) {
      throw new FilesError("hidden and traversal paths are not allowed");
    }
  }

  return segments.join("/");
};

const ensureRootExists = async (root: FileRootKey) => {
  if (root !== "admin") {
    await fs.mkdir(fileRoots[root].absolutePath, { recursive: true });
  }
};

const getRootRealPath = async (root: FileRootKey) => {
  await ensureRootExists(root);
  return fs.realpath(fileRoots[root].absolutePath);
};

const isSafeAdminFile = (fileName: string) => allowedAdminFiles.has(fileName);

const isTextLike = (fileName: string) => textLikeExtensions.has(path.extname(fileName).toLowerCase());
const isEditable = (fileName: string) => editableExtensions.has(path.extname(fileName).toLowerCase());
const canUseBroadTextEditing = (root: FileRootKey) => root === "all";

const decodeUtf8 = (buffer: Buffer) => {
  try {
    const decoded = utf8Decoder.decode(buffer);
    return decoded.includes("\u0000") ? null : decoded;
  } catch {
    return null;
  }
};

const assertSafeFileName = (value: string, options: { allowHidden?: boolean } = {}) => {
  const trimmed = value.trim();

  if (!trimmed || path.basename(trimmed) !== trimmed || trimmed === "." || trimmed === "..") {
    throw new FilesError("invalid file name");
  }

  if (!options.allowHidden && trimmed.startsWith(".")) {
    throw new FilesError("invalid file name");
  }

  if (!safeFileNamePattern.test(options.allowHidden && trimmed.startsWith(".") ? trimmed.slice(1) : trimmed)) {
    throw new FilesError("invalid file name");
  }

  return trimmed;
};

const createEntry = (
  root: FileRootKey,
  name: string,
  relativePath: string,
  stat: { isDirectory(): boolean; mtime: Date; size: number }
) => ({
  editable: !stat.isDirectory() && (canUseBroadTextEditing(root) ? isTextLike(name) : isEditable(name)),
  isDirectory: stat.isDirectory(),
  modifiedAt: stat.mtime.toISOString(),
  name,
  path: relativePath,
  sizeBytes: stat.isDirectory() ? 0 : stat.size
});

const resolveRootPath = async (root: FileRootKey, relativePath: string, options: { allowMissing?: boolean } = {}) => {
  const normalized = normalizeRelativePath(relativePath, {
    allowHidden: rootAllowsHiddenPaths(root)
  });
  const rootRealPath = await getRootRealPath(root);
  const targetPath = normalized ? path.join(fileRoots[root].absolutePath, normalized) : fileRoots[root].absolutePath;
  const targetExists = await fs.lstat(targetPath).catch(() => null);

  if (!targetExists) {
    if (!options.allowMissing) {
      throw new FilesError("path not found", 404);
    }

    const parentPath = path.dirname(targetPath);
    const parentRealPath = await fs.realpath(parentPath).catch(() => null);

    if (!parentRealPath || (parentRealPath !== rootRealPath && !parentRealPath.startsWith(`${rootRealPath}${path.sep}`))) {
      throw new FilesError("path escapes approved root");
    }

    return {
      normalized,
      rootRealPath,
      targetPath,
      targetStat: null
    };
  }

  if (targetExists.isSymbolicLink()) {
    throw new FilesError("symlinks are not allowed");
  }

  const targetRealPath = await fs.realpath(targetPath);

  if (targetRealPath !== rootRealPath && !targetRealPath.startsWith(`${rootRealPath}${path.sep}`)) {
    throw new FilesError("path escapes approved root");
  }

  return {
    normalized,
    rootRealPath,
    targetPath,
    targetStat: targetExists
  };
};

const listAdminFiles = async (): Promise<FileEntry[]> => {
  const names = await fs.readdir(fileRoots.admin.absolutePath);
  const entries = await Promise.all(names
    .filter((name) => isSafeAdminFile(name))
    .map(async (name) => {
      const stat = await fs.lstat(path.join(fileRoots.admin.absolutePath, name));

      if (!stat.isFile()) {
        return null;
      }

      return createEntry("admin", name, name, stat);
    }));

  return entries
    .filter((entry): entry is FileEntry => entry !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
};

const sortEntries = (entries: FileEntry[]) => entries.sort((left, right) => {
  if (left.isDirectory !== right.isDirectory) {
    return left.isDirectory ? -1 : 1;
  }

  return left.name.localeCompare(right.name);
});

const toRootsList = () => (Object.entries(fileRoots) as Array<[FileRootKey, { absolutePath: string; label: string }]>)
  .map(([key, value]) => ({
    key,
      label: value.label,
      path: value.absolutePath
  }));

export const assertFileRoot = (value: string) => {
  if (!isFileRootKey(value)) {
    throw new FilesError("invalid file root");
  }

  return value;
};

export const listFiles = async (root: FileRootKey, relativePath = ""): Promise<FilesListResponse> => {
  if (root === "admin") {
    if (normalizeRelativePath(relativePath)) {
      throw new FilesError("admin files do not support nested paths");
    }

    return {
      entries: await listAdminFiles(),
      path: "",
      root,
      roots: toRootsList()
    };
  }

  const resolved = await resolveRootPath(root, relativePath);

  if (!resolved.targetStat?.isDirectory()) {
    throw new FilesError("path is not a directory");
  }

  const names = await fs.readdir(resolved.targetPath);
  const entries = await Promise.all(names.map(async (name) => {
    if (!rootAllowsHiddenPaths(root) && name.startsWith(".")) {
      return null;
    }

    const childRelativePath = resolved.normalized ? `${resolved.normalized}/${name}` : name;
    const childPath = path.join(resolved.targetPath, name);
    const stat = await fs.lstat(childPath);

    if (stat.isSymbolicLink()) {
      return null;
    }

    return createEntry(root, name, childRelativePath, stat);
  }));

  return {
    entries: sortEntries(entries.filter((entry): entry is FileEntry => entry !== null)),
    path: resolved.normalized,
    root,
    roots: toRootsList()
  };
};

export const readFileContent = async (root: FileRootKey, relativePath: string): Promise<FileContentResponse> => {
  if (root === "admin" && !isSafeAdminFile(path.basename(relativePath))) {
    throw new FilesError("file is not in the approved admin set");
  }

  const resolved = await resolveRootPath(root, relativePath);

  if (!resolved.targetStat?.isFile()) {
    throw new FilesError("path is not a file");
  }

  const entry = createEntry(root, path.basename(resolved.normalized), resolved.normalized, resolved.targetStat);

  if (!canUseBroadTextEditing(root) && !isTextLike(entry.name)) {
    return {
      editable: false,
      entry,
      root
    };
  }

  if (resolved.targetStat.size > maxInlineBytes) {
    throw new FilesError("file is too large for inline reading");
  }

  const payload = await fs.readFile(resolved.targetPath);
  const decoded = decodeUtf8(payload);

  if (decoded === null) {
    return {
      editable: false,
      entry,
      root
    };
  }

  return {
    content: decoded,
    editable: canUseBroadTextEditing(root) ? true : entry.editable,
    entry: {
      ...entry,
      editable: canUseBroadTextEditing(root) ? true : entry.editable
    },
    root
  };
};

export const downloadFile = async (root: FileRootKey, relativePath: string) => {
  if (root === "admin" && !isSafeAdminFile(path.basename(relativePath))) {
    throw new FilesError("file is not in the approved admin set");
  }

  const resolved = await resolveRootPath(root, relativePath);

  if (!resolved.targetStat?.isFile()) {
    throw new FilesError("path is not a file");
  }

  const fileName = path.basename(resolved.targetPath);
  return {
    contentType: downloadMimeTypes[path.extname(fileName).toLowerCase()] || "application/octet-stream",
    fileName,
    payload: await fs.readFile(resolved.targetPath)
  };
};

export const uploadFile = async (root: FileRootKey, relativeDirectory: string, fileName: string, contentBase64: string) => {
  const safeName = assertSafeFileName(fileName, {
    allowHidden: rootAllowsHiddenPaths(root)
  });
  const payload = Buffer.from(contentBase64, "base64");

  if (!payload.length) {
    throw new FilesError("uploaded file is empty");
  }

  if (payload.length > maxUploadBytes) {
    throw new FilesError("uploaded file exceeds the maximum size");
  }

  if (root === "admin" && !isSafeAdminFile(safeName)) {
    throw new FilesError("upload target is not an approved admin file");
  }

  const directoryPath = root === "admin" ? "" : normalizeRelativePath(relativeDirectory, {
    allowHidden: rootAllowsHiddenPaths(root)
  });
  const parent = await resolveRootPath(root, directoryPath);

  if (root !== "admin" && !parent.targetStat?.isDirectory()) {
    throw new FilesError("upload target is not a directory");
  }

  const nextRelativePath = directoryPath ? `${directoryPath}/${safeName}` : safeName;
  const filePath = path.join(root === "admin" ? fileRoots.admin.absolutePath : parent.targetPath, safeName);
  await fs.writeFile(filePath, payload);
  return readFileContent(root, nextRelativePath);
};

export const writeTextFile = async (root: FileRootKey, relativePath: string, content: string) => {
  const normalized = normalizeRelativePath(relativePath, {
    allowHidden: rootAllowsHiddenPaths(root)
  });
  const fileName = path.basename(normalized);

  if (!canUseBroadTextEditing(root) && !isEditable(fileName)) {
    throw new FilesError("only approved text files may be edited inline");
  }

  if (Buffer.byteLength(content, "utf8") > maxInlineBytes) {
    throw new FilesError("inline edits are limited to 512 KB");
  }

  if (root === "admin" && !isSafeAdminFile(fileName)) {
    throw new FilesError("file is not in the approved admin set");
  }

  const resolved = await resolveRootPath(root, normalized, { allowMissing: true });
  await fs.writeFile(resolved.targetPath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  return readFileContent(root, normalized);
};

export const renameFile = async (root: FileRootKey, relativePath: string, nextName: string) => {
  if (root === "admin") {
    throw new FilesError("admin files cannot be renamed");
  }

  const safeName = assertSafeFileName(nextName, {
    allowHidden: rootAllowsHiddenPaths(root)
  });
  const resolved = await resolveRootPath(root, relativePath);

  if (!resolved.targetStat) {
    throw new FilesError("path not found", 404);
  }

  const nextRelativePath = path.posix.join(path.posix.dirname(resolved.normalized), safeName).replace(/^\.\//, "");
  const nextResolved = await resolveRootPath(root, nextRelativePath, { allowMissing: true });
  await fs.rename(resolved.targetPath, nextResolved.targetPath);
  return {
    name: safeName,
    path: nextRelativePath
  };
};

export const deleteFile = async (root: FileRootKey, relativePath: string) => {
  const normalized = normalizeRelativePath(relativePath, {
    allowHidden: rootAllowsHiddenPaths(root)
  });

  if (!normalized) {
    throw new FilesError("refusing to delete a root");
  }

  if (root === "admin" && !isSafeAdminFile(path.basename(normalized))) {
    throw new FilesError("file is not in the approved admin set");
  }

  const resolved = await resolveRootPath(root, normalized);
  await fs.rm(resolved.targetPath, { force: false, recursive: true });
  return {
    path: normalized
  };
};

export const toFilesErrorResponse = (error: unknown) => {
  if (error instanceof FilesError) {
    return {
      message: error.message,
      statusCode: error.statusCode
    };
  }

  return {
    message: error instanceof Error ? error.message : "file action failed",
    statusCode: 500
  };
};
