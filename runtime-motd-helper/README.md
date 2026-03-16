# Runtime MOTD Helper

This NeoForge helper enables live MOTD updates on the pinned `Minecraft 1.21.1` runtime where the built-in management protocol is unavailable.

## Build

```bash
cd /opt/fabric-minecraft-server/runtime-motd-helper
gradle build
```

The deployable jar is written to `build/libs/panelmotdhelper-1.0.0.jar`.

## Runtime Contract

- Bind port: `PANEL_MOTD_HELPER_PORT` or `25586`
- Path: `POST /motd`
- Scope: internal Docker-network traffic only; the port is not published on the host

Request body:

```json
{
  "motd": "§6Line one\n§aLine two"
}
```

Success response:

```json
{
  "applied": true,
  "error": null,
  "motd": "§6Line one\n§aLine two"
}
```

Failure response:

```json
{
  "applied": false,
  "error": "Timed out waiting for the server thread",
  "motd": null
}
```

The handler applies the new MOTD on the server thread, calls `MinecraftServer#setMotd`, then invalidates the cached ping status with `MinecraftServer#invalidateStatus`.
