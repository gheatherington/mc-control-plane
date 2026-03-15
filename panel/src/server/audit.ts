import fs from "node:fs";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config";

const auditDir = path.join(config.panelDataRoot, "audit");
const auditLogPath = path.join(auditDir, "audit.log");
const maxAuditLogBytes = 1024 * 1024;
const trimTargetBytes = 768 * 1024;

const ensureAuditDir = () => {
  fs.mkdirSync(auditDir, { recursive: true });
};

type AuditEvent = {
  action: string;
  actor: string;
  ip: string;
  method: string;
  path: string;
  status: number;
};

export type AuditRecord = AuditEvent & {
  timestamp: string;
};

export type AuditQuery = {
  action?: string;
  method?: string;
  page?: number;
  pageSize?: number;
  search?: string;
  status?: number;
};

type AuditSummary = {
  actions: Record<string, number>;
  methods: Record<string, number>;
  statuses: Record<string, number>;
  totalEntries: number;
  filteredEntries: number;
};

export type AuditResponse = {
  entries: AuditRecord[];
  page: number;
  pageSize: number;
  summary: AuditSummary;
  totalPages: number;
};

const increment = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] || 0) + 1;
};

const trimAuditLogIfNeeded = () => {
  const stat = fs.statSync(auditLogPath, { throwIfNoEntry: false });
  if (!stat || stat.size <= maxAuditLogBytes) {
    return;
  }

  const content = fs.readFileSync(auditLogPath, "utf8");
  const retained = content.slice(-trimTargetBytes);
  const newlineIndex = retained.indexOf("\n");
  const nextContent = newlineIndex >= 0 ? retained.slice(newlineIndex + 1) : retained;
  fs.writeFileSync(auditLogPath, nextContent.endsWith("\n") ? nextContent : `${nextContent}\n`);
};

export const writeAuditEvent = (event: AuditEvent) => {
  ensureAuditDir();
  fs.appendFileSync(auditLogPath, `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`);
  trimAuditLogIfNeeded();
};

const parseAuditRecord = (line: string): AuditRecord | null => {
  if (!line.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(line) as Partial<AuditRecord>;

    if (
      typeof parsed.timestamp !== "string" ||
      typeof parsed.action !== "string" ||
      typeof parsed.actor !== "string" ||
      typeof parsed.ip !== "string" ||
      typeof parsed.method !== "string" ||
      typeof parsed.path !== "string" ||
      typeof parsed.status !== "number"
    ) {
      return null;
    }

    return {
      action: parsed.action,
      actor: parsed.actor,
      ip: parsed.ip,
      method: parsed.method,
      path: parsed.path,
      status: parsed.status,
      timestamp: parsed.timestamp
    };
  } catch {
    return null;
  }
};

const normalizePage = (value: number | undefined, fallback: number) => {
  if (!Number.isInteger(value) || !value || value < 1) {
    return fallback;
  }

  return value;
};

const normalizePageSize = (value: number | undefined, fallback: number) => {
  if (!Number.isInteger(value) || !value || value < 1) {
    return fallback;
  }

  return Math.min(value, 200);
};

const matchesAuditQuery = (entry: AuditRecord, query: AuditQuery) => {
  if (query.action && entry.action !== query.action) {
    return false;
  }

  if (query.method && entry.method !== query.method.toUpperCase()) {
    return false;
  }

  if (query.status !== undefined && entry.status !== query.status) {
    return false;
  }

  if (query.search) {
    const haystack = [
      entry.timestamp,
      entry.action,
      entry.actor,
      entry.ip,
      entry.method,
      entry.path,
      String(entry.status)
    ].join(" ").toLowerCase();

    if (!haystack.includes(query.search.toLowerCase())) {
      return false;
    }
  }

  return true;
};

export const getAuditLog = (query: AuditQuery = {}): AuditResponse => {
  ensureAuditDir();

  const lines = fs.existsSync(auditLogPath)
    ? fs.readFileSync(auditLogPath, "utf8").split("\n")
    : [];
  const records = lines
    .map(parseAuditRecord)
    .filter((record): record is AuditRecord => record !== null)
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  const filtered = records.filter((entry) => matchesAuditQuery(entry, query));
  const page = normalizePage(query.page, 1);
  const pageSize = normalizePageSize(query.pageSize, 50);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const entries = filtered.slice(startIndex, startIndex + pageSize);
  const summary = filtered.reduce<AuditSummary>((result, entry) => {
    increment(result.actions, entry.action);
    increment(result.methods, entry.method);
    increment(result.statuses, String(entry.status));
    return result;
  }, {
    actions: {},
    filteredEntries: filtered.length,
    methods: {},
    statuses: {},
    totalEntries: records.length
  });

  return {
    entries,
    page: currentPage,
    pageSize,
    summary,
    totalPages
  };
};

export const attachAuditLogger = (req: Request, res: Response, next: NextFunction) => {
  if (!req.path.startsWith("/api/") || req.path === "/api/health") {
    next();
    return;
  }

  const ip = [req.ip, req.socket.remoteAddress, "unknown"].find(
    (value): value is string => typeof value === "string" && value.length > 0
  ) || "unknown";

  res.on("finish", () => {
    writeAuditEvent({
      action: "api-request",
      actor: res.locals.user || "anonymous",
      ip,
      method: req.method,
      path: req.path,
      status: res.statusCode
    });
  });

  next();
};
