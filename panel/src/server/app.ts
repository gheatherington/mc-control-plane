import express, { type Request, type Response } from "express";
import path from "node:path";
import { attachAuditLogger, getAuditLog } from "./audit";
import { createBackup, deleteBackup, getBackupExclusionOptions, inspectBackup, listBackups, restoreBackup, toBackupErrorResponse } from "./backups";
import { appendConsoleEcho, getRecentLogs, restartServer, runRconCommand, startServer, stopServer } from "./control";
import { getDashboard, banPlayer, broadcastMessage, deopPlayer, kickPlayer, listPlayers, opPlayer, pardonPlayer, saveWorld, unwhitelistPlayer, whitelistPlayer } from "./minecraft";
import { config } from "./config";
import { getSettings, refreshRestartBaseline, updateSettings } from "./settings";
import { writeAuditEvent } from "./audit";

const publicRoot = path.resolve(__dirname, "../public");

const requireName = (req: Request, res: Response) => {
  const value = typeof req.body.name === "string" ? req.body.name.trim() : "";

  if (!value) {
    res.status(400).json({ error: "player name is required" });
    return null;
  }

  return value;
};

const readParam = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === "string" ? first : "";
  }

  return "";
};

const readAuditIp = (req: Request) => [req.ip, req.socket.remoteAddress, "unknown"].find(
  (value): value is string => typeof value === "string" && value.length > 0
) || "unknown";

const writeScopedAuditEvent = (req: Request, action: string, status: number, details: string) => {
  writeAuditEvent({
    action,
    actor: resLocalsUser(req),
    ip: readAuditIp(req),
    method: req.method,
    path: details,
    status
  });
};

const resLocalsUser = (req: Request) => {
  const user = req.res?.locals.user;
  return typeof user === "string" && user.length > 0 ? user : "anonymous";
};

export const createApp = () => {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(attachAuditLogger);
  app.use(express.static(publicRoot));

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({
      service: "panel",
      status: "ok"
    });
  });

  app.get("/api/system/config", (_req: Request, res: Response) => {
    res.json({
      managementHost: config.managementHost,
      managementPort: config.managementPort,
      managementTls: config.managementTls,
      dataRoot: config.dataRoot,
      backupsRoot: config.backupsRoot,
      panelDataRoot: config.panelDataRoot
    });
  });

  app.get("/api/dashboard", async (_req: Request, res: Response) => {
    res.json(await getDashboard());
  });

  app.get("/api/settings", async (_req: Request, res: Response) => {
    res.json(await getSettings());
  });

  app.post("/api/settings", async (req: Request, res: Response) => {
    const values = req.body && typeof req.body === "object" && !Array.isArray(req.body.values)
      ? req.body.values
      : null;

    if (!values) {
      res.status(400).json({ error: "values object is required" });
      return;
    }

    res.json(await updateSettings(values as Record<string, unknown>));
  });

  app.get("/api/audit", (req: Request, res: Response) => {
    const pageValue = readParam(req.query.page);
    const pageSizeValue = readParam(req.query.pageSize);
    const statusValue = readParam(req.query.status);
    const page = pageValue ? Number(pageValue) : undefined;
    const pageSize = pageSizeValue ? Number(pageSizeValue) : undefined;
    const status = statusValue ? Number(statusValue) : undefined;

    res.json(getAuditLog({
      action: readParam(req.query.action) || undefined,
      method: readParam(req.query.method) || undefined,
      page,
      pageSize,
      search: readParam(req.query.search) || undefined,
      status: Number.isInteger(status) ? status : undefined
    }));
  });

  app.get("/api/backups", async (_req: Request, res: Response) => {
    res.json({
      backups: await listBackups(),
      exclusions: getBackupExclusionOptions()
    });
  });

  app.get("/api/backups/:name", async (req: Request, res: Response) => {
    try {
      res.json(await inspectBackup(readParam(req.params.name)));
    } catch (error) {
      const response = toBackupErrorResponse(error);
      res.status(response.statusCode).json({ error: response.message });
    }
  });

  app.post("/api/backups", async (req: Request, res: Response) => {
    try {
      const result = await createBackup({
        exclusions: req.body?.exclusions,
        name: typeof req.body?.name === "string" ? req.body.name : undefined
      });

      writeScopedAuditEvent(req, "backup-create", 200, `/api/backups/${result.backup.name}`);
      res.json({
        backup: result.backup,
        backups: await listBackups(),
        exclusions: result.exclusions
      });
    } catch (error) {
      const response = toBackupErrorResponse(error);
      writeScopedAuditEvent(req, "backup-create", response.statusCode, "/api/backups");
      res.status(response.statusCode).json({ error: response.message });
    }
  });

  app.delete("/api/backups/:name", async (req: Request, res: Response) => {
    const name = readParam(req.params.name);

    try {
      const backup = await deleteBackup(name);
      writeScopedAuditEvent(req, "backup-delete", 200, `/api/backups/${backup.name}`);
      res.json({
        backup,
        backups: await listBackups()
      });
    } catch (error) {
      const response = toBackupErrorResponse(error);
      writeScopedAuditEvent(req, "backup-delete", response.statusCode, `/api/backups/${name}`);
      res.status(response.statusCode).json({ error: response.message });
    }
  });

  app.post("/api/backups/:name/restore", async (req: Request, res: Response) => {
    const name = readParam(req.params.name);
    const confirmation = typeof req.body?.confirmation === "string" ? req.body.confirmation : "";

    try {
      const result = await restoreBackup(name, confirmation);
      writeScopedAuditEvent(req, "backup-restore", 200, `/api/backups/${result.backup.name}/restore`);
      res.json({
        ...result,
        backups: await listBackups()
      });
    } catch (error) {
      const response = toBackupErrorResponse(error);
      writeScopedAuditEvent(req, "backup-restore", response.statusCode, `/api/backups/${name}/restore`);
      res.status(response.statusCode).json({ error: response.message });
    }
  });

  app.post("/api/server/start", async (_req: Request, res: Response) => {
    await startServer();
    await refreshRestartBaseline();
    res.json(await getDashboard());
  });

  app.post("/api/server/stop", async (_req: Request, res: Response) => {
    await stopServer();
    res.json(await getDashboard());
  });

  app.post("/api/server/restart", async (_req: Request, res: Response) => {
    await restartServer();
    await refreshRestartBaseline();
    res.json(await getDashboard());
  });

  app.post("/api/server/save", async (_req: Request, res: Response) => {
    const output = await saveWorld();
    res.json({
      dashboard: await getDashboard(),
      output
    });
  });

  app.post("/api/server/broadcast", async (req: Request, res: Response) => {
    const message = typeof req.body.message === "string" ? req.body.message.trim() : "";

    if (!message) {
      res.status(400).json({ error: "message is required" });
      return;
    }

    const output = await broadcastMessage(message);
    res.json({
      dashboard: await getDashboard(),
      output
    });
  });

  app.get("/api/console", async (_req: Request, res: Response) => {
    res.json({
      logs: (await getRecentLogs(120)).split("\n").filter(Boolean)
    });
  });

  app.post("/api/console/command", async (req: Request, res: Response) => {
    const command = typeof req.body.command === "string" ? req.body.command.trim() : "";

    if (!command) {
      res.status(400).json({ error: "command is required" });
      return;
    }

    const output = await runRconCommand(...command.split(" ").filter(Boolean));
    await appendConsoleEcho(command, output);
    res.json({
      logs: (await getRecentLogs(120)).split("\n").filter(Boolean),
      output
    });
  });

  app.get("/api/players", async (_req: Request, res: Response) => {
    res.json(await listPlayers());
  });

  app.post("/api/players/whitelist", async (req: Request, res: Response) => {
    const name = requireName(req, res);
    if (!name) return;
    res.json(await whitelistPlayer(name));
  });

  app.delete("/api/players/whitelist/:name", async (req: Request, res: Response) => {
    res.json(await unwhitelistPlayer(readParam(req.params.name)));
  });

  app.post("/api/players/ops", async (req: Request, res: Response) => {
    const name = requireName(req, res);
    if (!name) return;
    res.json(await opPlayer(name));
  });

  app.delete("/api/players/ops/:name", async (req: Request, res: Response) => {
    res.json(await deopPlayer(readParam(req.params.name)));
  });

  app.post("/api/players/bans", async (req: Request, res: Response) => {
    const name = requireName(req, res);
    if (!name) return;
    res.json(await banPlayer(name));
  });

  app.delete("/api/players/bans/:name", async (req: Request, res: Response) => {
    res.json(await pardonPlayer(readParam(req.params.name)));
  });

  app.post("/api/players/kick", async (req: Request, res: Response) => {
    const name = requireName(req, res);
    if (!name) return;
    const reason = typeof req.body.reason === "string" ? req.body.reason : undefined;
    res.json(await kickPlayer(name, reason));
  });

  app.get("*", (_req: Request, res: Response) => {
    res.sendFile(path.join(publicRoot, "index.html"));
  });

  return app;
};
