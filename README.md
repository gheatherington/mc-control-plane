# NeoForge Minecraft Server

This stack runs a NeoForge Minecraft server in Docker using `itzg/minecraft-server:java21`, pinned to Minecraft `1.21.1` with NeoForge `21.1.220` and staged around the Better MC [NEOFORGE] BMC5 server pack.

## Runtime

- Live path: `/opt/fabric-minecraft-server`
- Minecraft host port: `6767/tcp`
- Admin panel port: `8080/tcp`
- Internal management API: `25585/tcp` on the Compose network only
- Runtime services: `neoforge`, `panel`, and `caddy`
- Memory defaults: `12G` max heap and `2G` initial heap

Shared gameplay modpacks must match between client and server. The live runtime is the Better MC [NEOFORGE] BMC5 server pack on NeoForge, while the panel remains a generic LAN-only admin surface and the Mods page stays focused on Forge/NeoForge server jars.

The panel still prefers Minecraft's built-in management API when it is available, but the current BMC5 runtime does not bind `25585` in this environment. Dashboard, settings, player actions, saves, and broadcasts therefore fall back to the existing Docker, file, and RCON control paths.

## Files

- `docker-compose.yml`: Compose stack for NeoForge, panel, and Caddy.
- `.env`: Active runtime configuration.
- `.env.example`: Reference defaults.
- `plan.md`: Main implementation roadmap and completed phase log.
- `migration_plan.md`: NeoForge migration handoff and remaining-phase checklist.
- `panel/`: Panel backend and frontend.
- `panel-mod/`: Legacy Fabric bridge workspace kept only for historical reference and not used by the live stack.
- `scripts/server-control.sh`: Scoped Docker and RCON wrapper.

## Start

```bash
cd /opt/fabric-minecraft-server
docker compose up -d
docker compose logs -f
```

Players connect to `host-or-lan-ip:6767`. The admin panel is available at `http://host-or-lan-ip:8080`.

## Operations

```bash
cd /opt/fabric-minecraft-server
docker compose ps
docker compose restart
docker compose down
docker attach neoforge-minecraft-server
```

Detach from the console with `Ctrl+P`, then `Ctrl+Q`.

Restart only the admin stack:

```bash
cd /opt/fabric-minecraft-server
docker compose restart panel caddy
```

Rebuild and recreate after panel or runtime changes:

```bash
cd /opt/fabric-minecraft-server
docker compose up -d --build --remove-orphans
```

## Panel Features

- Dashboard, players, saves, broadcasts, and settings use the internal Minecraft management API where available.
- Console log viewing is panel-managed, but raw command execution still uses scoped RCON.
- Files now exposes scoped navigation, download, upload, rename, delete, and safe inline text editing inside approved data roots only.
- Mods stages uploads before promotion and parses Fabric, Forge, and NeoForge metadata when available.
- Audit history lives in `panel-data/audit/audit.log`.
- Backups live under `/opt/fabric-minecraft-server/backups`.

## Data Layout

- Runtime data lives under `/opt/fabric-minecraft-server/data`.
- Active mods: `/opt/fabric-minecraft-server/data/mods`
- Staged mod uploads: `/opt/fabric-minecraft-server/data/mods-staging`
- NeoForge and server configs: `/opt/fabric-minecraft-server/data/config` and `/opt/fabric-minecraft-server/data/defaultconfigs`
- World data and server configs: `/opt/fabric-minecraft-server/data/world`
- Panel runtime data: `/opt/fabric-minecraft-server/panel-data`
- Quarantined mods: `/opt/fabric-minecraft-server/panel-data/mod-quarantine`

## Validation

Minimum validation after meaningful stack changes:

- `bash -n scripts/server-control.sh`
- `npm run check` in `panel/`
- `npm run build` in `panel/`
- `docker compose config`
- `docker compose up -d --build --remove-orphans`
- inspect `docker compose logs -f neoforge`
