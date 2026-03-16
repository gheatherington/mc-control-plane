# Repository Guidelines

## Project Structure & Module Organization
This live directory is the canonical home for the NeoForge Minecraft server. Keep the root small and operational:

- `docker-compose.yml`: Compose stack using `itzg/minecraft-server:java21`.
- `.env`: active runtime configuration used by Docker Compose.
- `.env.example`: reference copy of the intended defaults.
- `README.md`: operator workflow and day-to-day commands.
- `AGENTS.md`: contributor and maintenance guidance for this deployed stack.
- `migration_plan.md`: handoff plan for the NeoForge rebaseline plus remaining Control Plane phases.

Runtime server data lives in `/opt/fabric-minecraft-server/data`. That includes worlds, logs, configs, whitelist data, and future mods.

Important: `panel-mod/` is no longer part of the active server or panel architecture. The live admin panel prefers Minecraft's built-in JSON-RPC management API on `25585` when the runtime supports it, but the current BMC5 line is pinned to `Minecraft 1.21.1`, which predates that protocol. Ongoing runtime and control-plane work should therefore target the server stack and `panel/`, with Docker/file/RCON fallback treated as the supported live control path unless an older experiment needs to be referenced.

## Current Server State
This server was built with the following fixed decisions:

- Minecraft `1.21.1`, not `latest`.
- NeoForge-first runtime; shared gameplay mods must match on both client and server.
- Runtime pin: `MC_VERSION=1.21.1` with `NEOFORGE_VERSION=21.1.220`.
- Live path: `/opt/fabric-minecraft-server`.
- Memory target: `12G` max heap, `2G` initial heap.
- Host game port: `6767/tcp`, forwarded to container `25565/tcp`.
- Admin panel port: `8080/tcp` through Caddy.
- Internal Minecraft management API: `25585/tcp` remains configured on the Compose network, but the pinned `Minecraft 1.21.1` BMC5 runtime cannot expose it because the protocol was introduced later.
- Control plane integration path: the panel prefers Minecraft's built-in JSON-RPC management API on `25585` when the runtime supports it and otherwise falls back to Docker, file, and RCON-backed operations; `panel-mod/` is not used by the live stack.
- Console-noise caveat: because the BMC5 runtime is not binding `25585`, the panel continues to fall back to RCON-backed state checks; the panel console now strips ANSI/control-sequence garbage and filters local RCON connect/disconnect noise plus repeated `AllTheLeaks` leak-summary spam from the Admin Control Plane view, but the underlying server log may still contain those entries until the mod behavior itself is addressed.
- Healthcheck caveat: the NeoForge container uses `mc-health`, but the BMC5 runtime can stall under load; the current stack widens the Docker health window and disables AllTheLeaks passive leak-summary reporting so shorter lag spikes do not immediately mark the server unhealthy.
- Current validation baseline: `docker compose config`, panel `npm run check`, panel `npm run build`, and `docker compose up -d --build --remove-orphans` all passed for the `1.21.1` migration.
- Management protocol regression boundary: native JSON-RPC was healthy on earlier `1.21.11` test runs and is unavailable on the current pinned `1.21.1` BMC5 runtime.
- Owner: `brayden:brayden` for the stack directory and data directory.
- Container UID/GID mapping: `1000:1000`.
- Current running services: `neoforge`, `panel`, and `caddy`.
- Panel access model: single-admin LAN page with no auth layer.
- Overall project state: the planned Admin Control Plane phases are implemented; current work is refinement, cleanup, and hardening rather than missing core features.

The original source folder under `/home/brayden/fabric-minecraft-server` was cleaned up after deployment. Ongoing management should happen only from `/opt/fabric-minecraft-server`.

## Build, Test, and Development Commands
Run from `/opt/fabric-minecraft-server` unless noted:

- `docker compose config`: validate the Compose stack and `.env`.
- `docker compose up -d`: start or recreate the server.
- `docker compose ps`: inspect container state.
- `docker compose logs -f`: follow server logs.
- `docker compose restart`: restart the service after config or mod changes.
- `docker compose down`: stop the service.
- `docker attach neoforge-minecraft-server`: open the live server console.

If Docker commands fail with a socket permission error, re-login so the `docker` group membership applies to `brayden`.

## Coding Style & Naming Conventions
Use ASCII by default. Keep YAML at 2-space indentation. Environment variables stay uppercase, for example `MC_VERSION`, `MEMORY`, and `ENABLE_WHITELIST`. If you add scripts later, use Bash with `set -euo pipefail` and lowercase hyphenated file names.

## Testing Guidelines
There is no formal test suite. Minimum validation:

- run `bash -n` on every edited shell script;
- run `docker compose config` after Compose or env changes;
- run `docker compose up -d` after config changes that affect boot;
- inspect `docker compose logs -f` for NeoForge startup errors;
- confirm files are still written under `data/` with `brayden` ownership.

## Commit & Pull Request Guidelines
Git history is now available in this environment, so use short imperative commits such as `Pin Minecraft to 1.21.1` or `Add whitelist defaults`. PRs should state operational impact, validation performed, and any required operator actions such as restarting the container or adding mods.

Always update the git repo whenever a phase is completed or when a meaningful stack, panel, or mod change has been made. Do not leave completed work untracked.

## Security & Configuration Tips
Do not expose secrets or back up `data/` carelessly. Keep the Minecraft version pinned, review operator and whitelist settings before public use, and preserve `brayden` ownership on `/opt/fabric-minecraft-server` after restores or manual file copies.

## Progress Notes

- Phase 1 is complete: the host Minecraft port was changed to `6767`.
- Phases 2-7 foundation are complete: the panel and Caddy stack are live, and the internal management API remains configured on `25585` for future runtimes even though the current `1.21.1` line cannot bind it.
- Phase 8 is complete: dashboard and player-management APIs are live in the panel, backed by Docker state, file reads, and temporary RCON actions.
- Phase 9 is complete: dashboard server controls are live for start, stop, restart, save, and broadcast, using the scoped wrapper and temporary RCON execution.
- Phase 10 is complete: a console page and console APIs are live for recent logs and direct command execution through temporary RCON.
- Phase 10 refinements are complete: console and dashboard logs now filter out management connection open/close noise, panel-issued console commands are echoed back into recent logs with their outputs, and the log views auto-refresh and pin to the newest entries.
- Phase 11 is complete in historical terms: the panel gained native JSON-RPC support for dashboard state, player management, world saves, and broadcasts on runtimes that expose `25585`; the current pinned `1.21.1` BMC5 server falls back because that protocol is not available there.
- Phase 12 is complete: the panel now has a real Settings page and structured settings APIs, using management RPC for live-safe changes and guarded `server.properties` edits for restart-required values.
- Phase 12 UI refinements are complete: the settings page layout now keeps the sidebar usable, avoids input overlap, and uses a masonry-style group layout so cards flow naturally as they wrap.
- Phase 13 is complete: the panel now exposes the on-disk audit trail through `/api/audit` and a live Audit page with paging, filtering, summary counts, and size guardrails for `panel-data/audit/audit.log`.
- Phase 14 is complete: the panel now exposes scoped backup APIs and a live Backups page for archive create/list/inspect/delete flows, exclusion-aware backup creation, explicit world-data coverage for mounted saves, confirmation-gated restore requests, and explicit backup audit events under `/opt/fabric-minecraft-server/backups`.
- Phase 15 is complete: the panel now exposes scoped mod-management APIs and a live Mods page for staged jar uploads, active install promotion, quarantine/remove flows, rollback restores, loader metadata inventory for Fabric, Forge, and NeoForge jars, and explicit mod audit events across `data/mods`, `data/mods-staging`, and `panel-data/mod-quarantine`.
- The host-local Java 21 and Gradle toolchain remains installed under `/home/brayden/.local/opt`, but `panel-mod/` is now historical reference material only and is not used by the live server or panel.
- NeoForge migration is complete: the runtime now uses `TYPE=NEOFORGE`, `NEOFORGE_VERSION=21.1.220`, and the live service names are `neoforge-minecraft-server`, `neoforge-minecraft-panel`, and `neoforge-minecraft-panel-caddy`.
- Minecraft `1.21.1` migration is complete: the live server, Compose defaults, dashboard version reporting, and panel branding text now match the active `1.21.1` runtime, and the recreated stack reached healthy state after the change.
- Better MC [NEOFORGE] BMC5 installation is complete: the live runtime now uses the upstream BMC5 v48.5 server pack content under `data/mods` and `data/config`, keeps a fresh BMC5 world, preserves the panel/Caddy/control-plane architecture, stays on `NEOFORGE_VERSION=21.1.220`, and relies on the panel's Docker/file/RCON fallback paths because the BMC5 runtime does not bind the built-in management RPC port on `25585` in this environment.
- Phase 17 fallback hardening is complete: because the management API is unavailable on the current `1.21.1` BMC5 runtime, the panel serves dashboard and settings from file/container state, keeps player and server actions working through scoped RCON where possible, and avoids crashing the panel process on management connection failures.
- 2026-03-16 console-noise refinement is complete: investigation confirmed the management bridge is still unavailable in this BMC5 environment, so fallback RCON polling remains expected; the panel console now removes Docker ANSI/control-sequence artifacts, hides transient localhost RCON connect/disconnect lines, and suppresses repeated `AllTheLeaks` leak-summary blocks from the Admin Control Plane display after they began spamming following a player logout.
- 2026-03-16 healthcheck refinement is complete: investigation showed Docker health failures were `mc-health` timeouts during severe modpack lag rather than hard process failure, so the NeoForge healthcheck window was widened and AllTheLeaks passive leak-report logging was disabled in `data/config/alltheleaks.json`.
- The old bridge-mod approach is superseded: the live panel targets the internal management API for dashboard state, player management, saves, broadcasts, settings, and realtime refreshes when the runtime supports it; on the current `1.21.1` BMC5 line those features run on Docker/file/RCON fallback, with RCON kept only where server execution is still required.
- Phase 16 is complete: the panel now exposes scoped file-management APIs and a live Files page for approved data roots, traversal-resistant navigation, download/upload flows, guarded rename/delete actions, safe inline editing for small text configs, and explicit file audit events.
- Phase 16 refinements are complete: the Files route now supports both common-root shortcuts and a full mounted server-tree view, uses a horizontal listing/editor workspace in both modes, exposes current-path plus back/forward/up navigation, supports folder search, shows file-type badges, and includes layout fixes for long file names and detail-panel spacing.
- Phase 17 is complete: the panel now keeps a persistent management API subscriber for supported runtimes, pushes dashboard and player refreshes over SSE to the frontend, keeps a polling fallback when subscription coverage is unavailable or incomplete, and capability-gates the subscriber on the current `1.21.1` BMC5 line where native `25585` support does not exist.
