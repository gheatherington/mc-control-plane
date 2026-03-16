import express, { type Request, type Response } from "express";
import path from "node:path";
import { attachAuditLogger, getAuditLog } from "./audit";
import { createBackup, deleteBackup, getBackupExclusionOptions, inspectBackup, listBackups, restoreBackup, toBackupErrorResponse } from "./backups";
import { appendConsoleEcho, getRecentLogs, restartServer, runRconCommand, startServer, stopServer } from "./control";
import { emitSystemPanelEvent, getBridgeState, subscribeToPanelEvents } from "./events";
import { assertFileRoot, deleteFile, downloadFile, listFiles, readFileContent, renameFile, toFilesErrorResponse, uploadFile, writeTextFile } from "./files";
import { getDashboard, banPlayer, broadcastMessage, deopPlayer, kickPlayer, listPlayers, opPlayer, pardonPlayer, saveWorld, unwhitelistPlayer, whitelistPlayer } from "./minecraft";
import { config } from "./config";
import { deleteMod, installMod, listModsInventory, quarantineMod, rejectUploadedMod, restoreQuarantinedMod, toModErrorResponse, uploadModToStaging } from "./mods";
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

const isModScope = (value: string): value is "active" | "quarantine" | "staging" => value === "active" || value === "quarantine" || value === "staging";

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
  app.use(express.json({ limit: "64mb" }));
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

  app.get("/api/mods", async (_req: Request, res: Response) => {
    res.json(await listModsInventory());
  });

  app.get("/api/files", async (req: Request, res: Response) => {
    try {
      const root = assertFileRoot(readParam(req.query.root) || "config");
      res.json(await listFiles(root, readParam(req.query.path)));
    } catch (error) {
      const response = toFilesErrorResponse(error);
      res.status(response.statusCode).json({ error: response.message });
    }
  });

  app.get("/api/files/content", async (req: Request, res: Response) => {
    try {
      const root = assertFileRoot(readParam(req.query.root) || "config");
      res.json(await readFileContent(root, readParam(req.query.path)));
    } catch (error) {
      const response = toFilesErrorResponse(error);
      res.status(response.statusCode).json({ error: response.message });
    }
  });

  app.get("/api/files/download", async (req: Request, res: Response) => {
    try {
      const root = assertFileRoot(readParam(req.query.root) || "config");
      const result = await downloadFile(root, readParam(req.query.path));
      res.setHeader("Content-Type", result.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${result.fileName}"`);
      res.send(result.payload);
    } catch (error) {
      const response = toFilesErrorResponse(error);
      res.status(response.statusCode).json({ error: response.message });
    }
  });

  app.post("/api/files/upload", async (req: Request, res: Response) => {
    try {
      const root = assertFileRoot(typeof req.body?.root === "string" ? req.body.root : "config");
      const file = await uploadFile(
        root,
        typeof req.body?.path === "string" ? req.body.path : "",
        typeof req.body?.fileName === "string" ? req.body.fileName : "",
        typeof req.body?.contentBase64 === "string" ? req.body.contentBase64 : ""
      );
      writeScopedAuditEvent(req, "file-upload", 200, `/api/files/${root}/${file.entry.path}`);
      res.json({
        file,
        listing: await listFiles(root, typeof req.body?.path === "string" ? req.body.path : "")
      });
    } catch (error) {
      const response = toFilesErrorResponse(error);
      writeScopedAuditEvent(req, "file-upload", response.statusCode, "/api/files/upload");
      res.status(response.statusCode).json({ error: response.message });
    }
  });

  app.post("/api/files/write", async (req: Request, res: Response) => {
    try {
      const root = assertFileRoot(typeof req.body?.root === "string" ? req.body.root : "config");
      const file = await writeTextFile(
        root,
        typeof req.body?.path === "string" ? req.body.path : "",
        typeof req.body?.content === "string" ? req.body.content : ""
      );
      writeScopedAuditEvent(req, "file-write", 200, `/api/files/${root}/${file.entry.path}`);
      res.json({ file });
    } catch (error) {
      const response = toFilesErrorResponse(error);
      writeScopedAuditEvent(req, "file-write", response.statusCode, "/api/files/write");
      res.status(response.statusCode).json({ error: response.message });
    }
  });

  app.post("/api/files/rename", async (req: Request, res: Response) => {
    try {
      const root = assertFileRoot(typeof req.body?.root === "string" ? req.body.root : "config");
      const result = await renameFile(
        root,
        typeof req.body?.path === "string" ? req.body.path : "",
        typeof req.body?.nextName === "string" ? req.body.nextName : ""
      );
      writeScopedAuditEvent(req, "file-rename", 200, `/api/files/${root}/${result.path}`);
      res.json({
        listing: await listFiles(root, path.posix.dirname(result.path) === "." ? "" : path.posix.dirname(result.path)),
        renamed: result
      });
    } catch (error) {
      const response = toFilesErrorResponse(error);
      writeScopedAuditEvent(req, "file-rename", response.statusCode, "/api/files/rename");
      res.status(response.statusCode).json({ error: response.message });
    }
  });

  app.delete("/api/files", async (req: Request, res: Response) => {
    try {
      const root = assertFileRoot(readParam(req.query.root) || "config");
      const relativePath = readParam(req.query.path);
      const parentPath = path.posix.dirname(relativePath) === "." ? "" : path.posix.dirname(relativePath);
      const deleted = await deleteFile(root, relativePath);
      writeScopedAuditEvent(req, "file-delete", 200, `/api/files/${root}/${deleted.path}`);
      res.json({
        deleted,
        listing: await listFiles(root, root === "admin" ? "" : parentPath)
      });
    } catch (error) {
      const response = toFilesErrorResponse(error);
      writeScopedAuditEvent(req, "file-delete", response.statusCode, "/api/files");
      res.status(response.statusCode).json({ error: response.message });
    }
  });

  app.post("/api/mods/upload", async (req: Request, res: Response) => {
    const fileName = typeof req.body?.fileName === "string" ? req.body.fileName : "";
    const contentBase64 = typeof req.body?.contentBase64 === "string" ? req.body.contentBase64 : "";

    try {
      const mod = await uploadModToStaging({ contentBase64, fileName });
      writeScopedAuditEvent(req, "mod-upload", 200, `/api/mods/staging/${mod.fileName}`);
      res.json({
        inventory: await listModsInventory(),
        mod
      });
    } catch (error) {
      const response = toModErrorResponse(error);
      writeScopedAuditEvent(req, "mod-upload", response.statusCode, "/api/mods/upload");
      res.status(response.statusCode).json({ error: response.message });
    }
  });

  app.post("/api/mods/staging/:name/install", async (req: Request, res: Response) => {
    const name = readParam(req.params.name);

    try {
      const mod = await installMod("staging", name);
      writeScopedAuditEvent(req, "mod-install", 200, `/api/mods/active/${mod.fileName}`);
      res.json({
        inventory: await listModsInventory(),
        mod
      });
    } catch (error) {
      const response = toModErrorResponse(error);
      writeScopedAuditEvent(req, "mod-install", response.statusCode, `/api/mods/staging/${name}/install`);
      res.status(response.statusCode).json({ error: response.message });
    }
  });

  app.post("/api/mods/staging/:name/quarantine", async (req: Request, res: Response) => {
    const name = readParam(req.params.name);

    try {
      const mod = await rejectUploadedMod(name);
      writeScopedAuditEvent(req, "mod-quarantine", 200, `/api/mods/quarantine/${mod.fileName}`);
      res.json({
        inventory: await listModsInventory(),
        mod
      });
    } catch (error) {
      const response = toModErrorResponse(error);
      writeScopedAuditEvent(req, "mod-quarantine", response.statusCode, `/api/mods/staging/${name}/quarantine`);
      res.status(response.statusCode).json({ error: response.message });
    }
  });

  app.post("/api/mods/active/:name/quarantine", async (req: Request, res: Response) => {
    const name = readParam(req.params.name);

    try {
      const mod = await quarantineMod("active", name);
      writeScopedAuditEvent(req, "mod-remove", 200, `/api/mods/quarantine/${mod.fileName}`);
      res.json({
        inventory: await listModsInventory(),
        mod
      });
    } catch (error) {
      const response = toModErrorResponse(error);
      writeScopedAuditEvent(req, "mod-remove", response.statusCode, `/api/mods/active/${name}/quarantine`);
      res.status(response.statusCode).json({ error: response.message });
    }
  });

  app.post("/api/mods/quarantine/:name/install", async (req: Request, res: Response) => {
    const name = readParam(req.params.name);

    try {
      const mod = await installMod("quarantine", name);
      writeScopedAuditEvent(req, "mod-restore-active", 200, `/api/mods/active/${mod.fileName}`);
      res.json({
        inventory: await listModsInventory(),
        mod
      });
    } catch (error) {
      const response = toModErrorResponse(error);
      writeScopedAuditEvent(req, "mod-restore-active", response.statusCode, `/api/mods/quarantine/${name}/install`);
      res.status(response.statusCode).json({ error: response.message });
    }
  });

  app.post("/api/mods/quarantine/:name/restore", async (req: Request, res: Response) => {
    const name = readParam(req.params.name);
    const rawTargetScope = typeof req.body?.targetScope === "string" ? req.body.targetScope : "staging";
    const targetScope = rawTargetScope === "active" ? "active" : "staging";

    try {
      const mod = await restoreQuarantinedMod(name, targetScope);
      writeScopedAuditEvent(req, "mod-restore", 200, `/api/mods/${targetScope}/${mod.fileName}`);
      res.json({
        inventory: await listModsInventory(),
        mod
      });
    } catch (error) {
      const response = toModErrorResponse(error);
      writeScopedAuditEvent(req, "mod-restore", response.statusCode, `/api/mods/quarantine/${name}/restore`);
      res.status(response.statusCode).json({ error: response.message });
    }
  });

  app.delete("/api/mods/:scope/:name", async (req: Request, res: Response) => {
    const scope = readParam(req.params.scope);
    const name = readParam(req.params.name);

    if (!isModScope(scope) || scope === "active") {
      res.status(400).json({ error: "deletion is supported only for staging or quarantine mods" });
      return;
    }

    try {
      const mod = await deleteMod(scope, name);
      writeScopedAuditEvent(req, "mod-delete", 200, `/api/mods/${scope}/${mod.fileName}`);
      res.json({
        inventory: await listModsInventory(),
        mod
      });
    } catch (error) {
      const response = toModErrorResponse(error);
      writeScopedAuditEvent(req, "mod-delete", response.statusCode, `/api/mods/${scope}/${name}`);
      res.status(response.statusCode).json({ error: response.message });
    }
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
    emitSystemPanelEvent("dashboard-refresh");
    res.json(await getDashboard());
  });

  app.post("/api/server/stop", async (_req: Request, res: Response) => {
    await stopServer();
    emitSystemPanelEvent("dashboard-refresh");
    res.json(await getDashboard());
  });

  app.post("/api/server/restart", async (_req: Request, res: Response) => {
    await restartServer();
    await refreshRestartBaseline();
    emitSystemPanelEvent("dashboard-refresh");
    res.json(await getDashboard());
  });

  app.post("/api/server/save", async (_req: Request, res: Response) => {
    const output = await saveWorld();
    emitSystemPanelEvent("save-event");
    emitSystemPanelEvent("dashboard-refresh");
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
    emitSystemPanelEvent("dashboard-refresh");
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
    emitSystemPanelEvent("dashboard-refresh");
    res.json({
      logs: (await getRecentLogs(120)).split("\n").filter(Boolean),
      output
    });
  });

  app.get("/api/events/state", (_req: Request, res: Response) => {
    res.json(getBridgeState());
  });

  app.get("/api/events/stream", (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const send = (event: unknown) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    send({
      details: getBridgeState(),
      receivedAt: new Date().toISOString(),
      source: "system",
      type: "management-bridge-state"
    });

    const unsubscribe = subscribeToPanelEvents(send);
    const keepAlive = setInterval(() => {
      res.write(": keep-alive\n\n");
    }, 15000);

    req.on("close", () => {
      clearInterval(keepAlive);
      unsubscribe();
      res.end();
    });
  });

  app.get("/api/players", async (_req: Request, res: Response) => {
    res.json(await listPlayers());
  });

  app.post("/api/players/whitelist", async (req: Request, res: Response) => {
    const name = requireName(req, res);
    if (!name) return;
    const players = await whitelistPlayer(name);
    emitSystemPanelEvent("allowlist-changed", { name });
    emitSystemPanelEvent("players-refresh");
    res.json(players);
  });

  app.delete("/api/players/whitelist/:name", async (req: Request, res: Response) => {
    const name = readParam(req.params.name);
    const players = await unwhitelistPlayer(name);
    emitSystemPanelEvent("allowlist-changed", { name });
    emitSystemPanelEvent("players-refresh");
    res.json(players);
  });

  app.post("/api/players/ops", async (req: Request, res: Response) => {
    const name = requireName(req, res);
    if (!name) return;
    const players = await opPlayer(name);
    emitSystemPanelEvent("operators-changed", { name });
    emitSystemPanelEvent("players-refresh");
    res.json(players);
  });

  app.delete("/api/players/ops/:name", async (req: Request, res: Response) => {
    const name = readParam(req.params.name);
    const players = await deopPlayer(name);
    emitSystemPanelEvent("operators-changed", { name });
    emitSystemPanelEvent("players-refresh");
    res.json(players);
  });

  app.post("/api/players/bans", async (req: Request, res: Response) => {
    const name = requireName(req, res);
    if (!name) return;
    const players = await banPlayer(name);
    emitSystemPanelEvent("players-refresh", { name });
    res.json(players);
  });

  app.delete("/api/players/bans/:name", async (req: Request, res: Response) => {
    const name = readParam(req.params.name);
    const players = await pardonPlayer(name);
    emitSystemPanelEvent("players-refresh", { name });
    res.json(players);
  });

  app.post("/api/players/kick", async (req: Request, res: Response) => {
    const name = requireName(req, res);
    if (!name) return;
    const reason = typeof req.body.reason === "string" ? req.body.reason : undefined;
    const players = await kickPlayer(name, reason);
    emitSystemPanelEvent("players-refresh", { name });
    res.json(players);
  });

  app.get("*", (_req: Request, res: Response) => {
    res.sendFile(path.join(publicRoot, "index.html"));
  });

  return app;
};
