# Forge Minecraft Server

This stack runs a Forge-ready Minecraft server in Docker using `itzg/minecraft-server`, pinned to Minecraft `1.21.11`.

## Todo

1. Install Docker Engine and the Compose plugin.
2. Copy this stack to `/opt/fabric-minecraft-server`.
3. Review `.env` and adjust values if needed.
4. Start the server and let Forge generate the initial `/data` layout.
5. Add mods later under `/opt/fabric-minecraft-server/data/mods`.

## Files

- `docker-compose.yml`: Main container definition.
- `.env.example`: Default environment settings. Copy to `.env` on first deploy.
- `install-docker-ubuntu-24.04.sh`: Root-run installer for Docker on Ubuntu 24.04.
- `deploy-to-opt.sh`: Root-run deploy helper that copies this stack into `/opt`.

## Install Docker

Run this as root:

```bash
cd /home/brayden/fabric-minecraft-server
sudo bash ./install-docker-ubuntu-24.04.sh
```

After installation, log out and log back in so the `docker` group membership takes effect.

## Deploy To /opt

Run this as root:

```bash
cd /home/brayden/fabric-minecraft-server
sudo bash ./deploy-to-opt.sh
```

## Start The Server

```bash
cd /opt/fabric-minecraft-server
docker compose up -d
docker compose logs -f
```

Players should connect to `host-or-lan-ip:6767`.
The admin panel will be available on `http://host-or-lan-ip:8080` once the panel stack is up.
Core dashboard, player, save, broadcast, and settings actions use the internal Minecraft management API on `25585` where available; the console page still falls back to scoped RCON for raw commands, the Audit page reads from `panel-data/audit/audit.log`, and the Mods page now stages uploads before promoting jars into the live `data/mods` directory.

## Operations

Stop:

```bash
cd /opt/fabric-minecraft-server
docker compose down
```

Restart:

```bash
cd /opt/fabric-minecraft-server
docker compose restart
```

Restart only the admin stack:

```bash
cd /opt/fabric-minecraft-server
docker compose restart panel caddy
```

Update the container image:

```bash
cd /opt/fabric-minecraft-server
docker compose pull
docker compose up -d
```

Open the server console:

```bash
cd /opt/fabric-minecraft-server
docker attach forge-minecraft-server
```

Detach from the console with `Ctrl+P`, then `Ctrl+Q`.

Build the legacy Fabric mod scaffold:

```bash
cd /opt/fabric-minecraft-server/panel-mod
./gradlew build
```

## Data Layout

- World, configs, logs, and mods live under `/opt/fabric-minecraft-server/data`.
- Active mods live under `/opt/fabric-minecraft-server/data/mods`.
- Staged mod uploads live under `/opt/fabric-minecraft-server/data/mods-staging`.
- The legacy Fabric mod workspace for older panel-bridge experiments lives under `/opt/fabric-minecraft-server/panel-mod`.
- Panel runtime data lives under `/opt/fabric-minecraft-server/panel-data`.
- Quarantined mods live under `/opt/fabric-minecraft-server/panel-data/mod-quarantine`.
- Backup archives live under `/opt/fabric-minecraft-server/backups`.
- Host control scripts for the panel live under `/opt/fabric-minecraft-server/scripts`.
- The host port is `6767/tcp`, forwarded to the container's internal Minecraft port `25565/tcp`.
- The admin panel is proxied by Caddy on host port `8080/tcp`.
- The Minecraft management API is reserved on the internal Compose network at port `25585/tcp` and is not published to the LAN.

## Notes

- `.env` defaults to `12G` max heap and `2G` initial heap.
- `EULA=TRUE` is set because Minecraft will not start without accepting the EULA.
- `TZ` is set to `Etc/UTC`; change it in `.env` if you want local server time.
