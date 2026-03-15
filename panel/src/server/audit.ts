import fs from "node:fs";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config";

const auditDir = path.join(config.panelDataRoot, "audit");
const auditLogPath = path.join(auditDir, "audit.log");

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

export const writeAuditEvent = (event: AuditEvent) => {
  ensureAuditDir();
  fs.appendFileSync(auditLogPath, `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`);
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
