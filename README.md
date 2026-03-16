# NeoForge Minecraft Server

This stack runs a NeoForge Minecraft server in Docker using `itzg/minecraft-server:java21`, pinned to Minecraft `1.21.1` with NeoForge `21.1.220` and staged around the Better MC [NEOFORGE] BMC5 server pack.

## Runtime

- Live path: `/opt/fabric-minecraft-server`
- Minecraft host port: `6767/tcp`
- Admin panel port: `8080/tcp`
- Optional DuckDNS updater profile: `duckdns` for `goyminecrafting.duckdns.org`
- Internal management API: `25585/tcp` configured on the Compose network, but unsupported on the pinned `Minecraft 1.21.1` BMC5 runtime
- Internal MOTD helper: `25586/tcp` on the Compose network for live MOTD refreshes on the pinned `1.21.1` runtime
- Runtime services: `neoforge`, `panel`, `caddy`, and optional `duckdns`
- Memory defaults: `12G` max heap and `2G` initial heap

Shared gameplay modpacks must match between client and server. The live runtime is the Better MC [NEOFORGE] BMC5 server pack on NeoForge, while the panel remains a generic LAN-only admin surface and the Mods page stays focused on Forge/NeoForge server jars.

Minecraft's native management protocol was introduced after `1.21.1` and was previously verified on newer `1.21.11` test runs, so the current BMC5 runtime cannot expose `25585` even though the port remains configured. Dashboard, settings, player actions, saves, broadcasts, and live refreshes therefore operate on the supported Docker, file, and RCON fallback paths for this server line.

MOTD persistence is panel-owned. Docker Compose no longer injects `MOTD`, the panel writes the live value into `data/server.properties`, and a dedicated NeoForge helper handles live MOTD applies on the pinned `1.21.1` runtime over the internal `25586/tcp` helper path.

MOTD persistence is panel-managed now. The Compose stack no longer injects `MOTD`, so the Settings page owns `data/server.properties`, and live MOTD updates on `1.21.1` use the dedicated NeoForge helper inside the server runtime.

Docker health state is based on `mc-health`. Because this BMC5 runtime can stall under load, the stack uses a wider healthcheck window and disables AllTheLeaks passive leak-summary reporting to avoid false unhealthy reports during shorter lag spikes.

## Files

- `docker-compose.yml`: Compose stack for NeoForge, panel, and Caddy.
- `.env`: Active runtime configuration.
- `.env.example`: Reference defaults.
- `plan.md`: Main implementation roadmap and completed phase log.
- `migration_plan.md`: NeoForge migration handoff and remaining-phase checklist.
- `motd_plan.md`: execution brief for the dedicated MOTD editor and live-helper rework.
- `panel/`: Panel backend and frontend.
- `panel-mod/`: Legacy Fabric bridge workspace kept only for historical reference and not used by the live stack.
- `runtime-motd-helper/`: NeoForge helper workspace for live MOTD updates on `1.21.1`.
- `scripts/server-control.sh`: Scoped Docker and RCON wrapper.

## Start

```bash
cd /opt/fabric-minecraft-server
docker compose up -d
docker compose logs -f
```

Players connect to `host-or-lan-ip:6767`. The admin panel is available at `http://host-or-lan-ip:8080`.

For players outside your LAN, DuckDNS must track your network's public IPv4, not this server's private LAN address. Your router must then forward external `6767/tcp` to this host's local `6767/tcp`, and the admin panel should stay LAN-only by not forwarding `8080`.

Enable the DuckDNS updater after putting your token into `.env`:

```bash
cd /opt/fabric-minecraft-server
docker compose --profile duckdns up -d duckdns
docker compose logs -f duckdns
```

After that, outside players should use `goyminecrafting.duckdns.org:6767`.

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

Restart only the DuckDNS updater:

```bash
cd /opt/fabric-minecraft-server
docker compose --profile duckdns up -d duckdns
```

## Panel Features

- Dashboard, players, saves, broadcasts, and settings prefer the internal Minecraft management API on supported runtimes, but the current `1.21.1` BMC5 stack runs those flows in fallback mode.
- The Settings page now includes a dedicated MOTD editor with a visual builder, raw legacy-code mode, two-line preview, and accurate live-apply status.
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
