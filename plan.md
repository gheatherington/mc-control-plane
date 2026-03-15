# Implementation Plan

## Active Summary

- The live Fabric server runs on host port `6767` and is healthy.
- The panel and Caddy stack are live on host port `8080`.
- Minecraft's management server is enabled internally on `25585/tcp`.
- The panel is now being simplified to a single-admin LAN control page with no auth layer.
- Phase 12 is complete: the panel now has a real `Settings` page with structured read/update APIs, runtime-safe management RPC writes, and guarded restart-required file edits where needed.
- Git tracking is now part of the operational workflow: completed phases and meaningful stack, panel, or mod changes should be committed promptly.

## Phase Log

### Phase 1

- Changed the Minecraft host port from `25565` to `6767`.
- Updated runtime env and operator docs.
- Validated the Compose stack and live container health after restart.

### Phases 2-7 Foundation

- Added `panel` and `caddy` services to the Compose stack.
- Scaffolded the backend-served frontend app in `panel/`.
- Enabled the internal Minecraft management server on `25585/tcp`.
- Brought up the panel through Caddy on `8080/tcp`.
- Added an initial auth and audit layer, which is now being removed because the panel is single-admin only.

### Phase 8 Complete

Completed:

- Removed the panel auth/session scaffolding for the single-admin LAN deployment.
- Added a Docker/RCON control wrapper at `scripts/server-control.sh`.
- Added live dashboard data from Docker state, `server.properties`, and recent logs.
- Added player inventory and player-management API endpoints backed by RCON.
- Added the first real dashboard and players UI in the panel frontend.

Validation:

- `bash -n scripts/server-control.sh`
- `npm run build` in `panel/`
- `docker compose config`
- `curl http://127.0.0.1:8080/api/dashboard`
- `curl http://127.0.0.1:8080/api/players`

### Phase 9 Complete

Completed:

- Added `/api/server/start`, `/api/server/stop`, `/api/server/restart`, `/api/server/save`, and `/api/server/broadcast`.
- Wired dashboard controls for start, stop, restart, save, and broadcast.
- Reused the Docker wrapper for container lifecycle actions.
- Moved save and broadcast onto Minecraft's internal management API on `25585`.

Validation:

- `npm run build` in `panel/`
- `docker compose up -d --build panel`
- `curl -X POST http://127.0.0.1:8080/api/server/save`
- `curl -H 'Content-Type: application/json' -d '{"message":"Panel broadcast verify 2118"}' http://127.0.0.1:8080/api/server/broadcast`
- `docker compose logs --tail=20 fabric`

### Phase 10 Complete

Completed:

- Added `/api/console` for recent log retrieval.
- Added `/api/console/command` for direct RCON command execution.
- Replaced the placeholder console page with a live console UI and command form.
- Kept console command execution on the scoped RCON fallback because the management API does not expose raw console/log endpoints.
- Filtered management connection open/close noise out of panel log views.
- Added panel-console command echoes and output echoes into recent logs.
- Added auto-refresh and auto-scroll-to-bottom behavior for dashboard and console log viewers.

Validation:

- `npm run build` in `panel/`
- `docker compose up -d --build panel`
- `curl http://127.0.0.1:8080/api/console`
- `curl -H 'Content-Type: application/json' -d '{"command":"list"}' http://127.0.0.1:8080/api/console/command`
- `curl -fsS http://127.0.0.1:8080/api/console`
- `curl -fsS -X POST http://127.0.0.1:8080/api/console/command -H 'Content-Type: application/json' -d '{"command":"list"}'`

### Phase 11 Complete

Completed:

- Installed a host-local Java build path under `/home/brayden/.local/opt` without requiring root access.
- Added shell exports in `/home/brayden/.profile` and `/home/brayden/.bashrc` so `java`, `javac`, and `gradle` resolve in new Bash sessions.
- Verified `java` and `javac` at Temurin `21.0.10+7` and `gradle` at `9.4.0`.
- Scaffolded a pinned Fabric mod project in `panel-mod/` for Minecraft `1.21.11`.
- Added a Gradle wrapper, Fabric metadata, and a minimal dedicated-server entrypoint for the future panel bridge.
- Verified the scaffold builds and emits a remapped mod jar in `panel-mod/build/libs/`.
- Probed the live Minecraft management server and confirmed it is already active as an authenticated WebSocket JSON-RPC service on `25585`.
- Added a panel-side management client and moved dashboard state, player management, saves, and broadcasts to the built-in JSON-RPC API instead of the temporary RCON/file path where supported.

Validation:

- `gradle tasks` in `panel-mod/`
- `gradle wrapper --gradle-version 9.4.0` in `panel-mod/`
- `./gradlew build` in `panel-mod/`
- `npm run check` in `panel/`
- `npm run build` in `panel/`
- `docker compose up -d --build panel`
- `curl http://127.0.0.1:8080/api/dashboard`
- `curl http://127.0.0.1:8080/api/players`
- `curl -X POST http://127.0.0.1:8080/api/server/save`
- `curl -H 'Content-Type: application/json' -d '{"message":"Panel management API verification 2149"}' http://127.0.0.1:8080/api/server/broadcast`

## Next Phases

### Phase 12 Complete

Goals:

- Add a real `Settings` page instead of the placeholder route.
- Expose structured read/update APIs for safe server settings edits.
- Prefer the management API for runtime-safe settings and only fall back to file edits plus restart when a setting is not exposed at runtime.

Scope:

- Add backend endpoints for settings groups such as gameplay, whitelist behavior, capacity, MOTD, and distance settings.
- Use the management API for values already exposed under `minecraft:serversettings/*`.
- Add guarded file editing for remaining `server.properties` keys with validation and type coercion.
- Show which changes are live-applied versus restart-required.
- Add a restart prompt/workflow for pending file-backed changes.

Validation:

- `npm run check` in `panel/`
- `npm run build` in `panel/`
- `docker compose up -d --build panel`
- `curl http://127.0.0.1:8080/api/system/config`
- `curl` checks for new settings read/update endpoints

Completed:

- Added `/api/settings` read and update endpoints in the panel backend.
- Added grouped settings for gameplay, whitelist behavior, capacity, world tuning, and restart-bound network behavior.
- Wired live-safe settings to the internal Minecraft JSON-RPC management API and persisted those values back to `server.properties`.
- Added guarded file-backed handling for restart-required settings such as `online-mode` and `pvp`.
- Added restart-baseline tracking so pending restart prompts reflect real file drift instead of stale history.
- Replaced the placeholder `Settings` route in the frontend with a live settings page, grouped forms, save/reload actions, and a restart prompt.
- Refined the settings page layout so the sidebar remains reachable, settings rows do not overlap their inputs, and settings groups use a masonry-style layout rather than leaving large grid gaps.

Validation performed:

- `npm run check` in `panel/`
- `npm run build` in `panel/`
- `docker compose config`
- `docker compose up -d --build panel`
- `curl http://127.0.0.1:8080/api/settings`
- `curl -X POST http://127.0.0.1:8080/api/settings -H 'Content-Type: application/json' -d '{"values":{"motd":"A Fabric-ready Minecraft server [panel test]"}}'`
- `curl -X POST http://127.0.0.1:8080/api/settings -H 'Content-Type: application/json' -d '{"values":{"motd":"A Fabric-ready Minecraft server"}}'`
- `curl -X POST http://127.0.0.1:8080/api/settings -H 'Content-Type: application/json' -d '{"values":{"pvp":"false"}}'`
- `curl -X POST http://127.0.0.1:8080/api/settings -H 'Content-Type: application/json' -d '{"values":{"pvp":"true"}}'`

### Phase 13 Audit

Goals:

- Add an `Audit` page and API so the existing on-disk audit trail is visible in the panel.
- Make operational history searchable enough to investigate who did what and when.

Scope:

- Add audit read/list endpoints backed by `panel-data/audit/audit.log`.
- Parse newline-delimited JSON entries and expose paging, filtering, and basic summary counts.
- Add a frontend table or log view with timestamp, method, path, status, IP, and action columns.
- Add retention/size guardrails if the log grows materially.

Validation:

- `npm run check` in `panel/`
- `npm run build` in `panel/`
- `docker compose up -d --build panel`
- `curl` checks for new audit endpoints

Completed:

- Added `/api/audit` in the panel backend, backed by `panel-data/audit/audit.log`.
- Added newline-delimited JSON parsing with paging, search, and method/action/status filters.
- Added summary counts for the filtered audit view so recent activity can be scoped quickly.
- Added a size guardrail that trims the on-disk audit log once it grows past the configured cap.
- Replaced the placeholder `Audit` route in the frontend with a live filterable audit page.

Validation performed:

- `npm run check` in `panel/`
- `npm run build` in `panel/`
- `docker compose config`
- `docker compose up -d --build panel`
- `curl http://127.0.0.1:8080/api/audit`
- `curl 'http://127.0.0.1:8080/api/audit?method=POST&pageSize=5'`

### Phase 14 Backups

Goals:

- Add guided backup creation and restore workflows for the mounted server data.
- Keep backup operations inside explicitly scoped directories and flows.

Scope:

- Add backend endpoints to create, list, inspect, and delete backup archives under `/opt/fabric-minecraft-server/backups`.
- Support exclusions for noisy or reproducible paths when creating archives.
- Require confirmation for restore operations and stop the server during restore.
- Surface backup metadata and restore warnings in the UI.
- Audit all backup and restore actions.

Validation:

- `npm run check` in `panel/`
- `npm run build` in `panel/`
- `docker compose up -d --build panel`
- Manual backup create/list/restore smoke tests

Completed:

- Added `/api/backups` endpoints to list, inspect, create, delete, and restore archives inside `/opt/fabric-minecraft-server/backups`.
- Scoped backup creation to the mounted Minecraft data directory and added exclusion options for `logs`, `crash-reports`, and `usercache.json`.
- Added confirmation-gated restore handling that validates the archive, stops the server before replacement, and restarts it afterward if it had been running.
- Added explicit backup audit events for create, delete, and restore attempts alongside the existing API request log.
- Replaced the placeholder `Backups` route in the frontend with a live archive inventory, metadata viewer, exclusion controls, and guided restore flow.

Validation performed:

- `npm run check` in `panel/`
- `npm run build` in `panel/`
- `docker compose config`
- `docker compose up -d --build panel`
- `curl http://127.0.0.1:8080/api/backups`
- `curl -X POST http://127.0.0.1:8080/api/backups -H 'Content-Type: application/json' --data '{"name":"phase-14-smoke","exclusions":["logs","crash-reports"]}'`
- `curl http://127.0.0.1:8080/api/backups/<created-archive>`
- `curl -X POST http://127.0.0.1:8080/api/backups/<created-archive>/restore -H 'Content-Type: application/json' --data '{"confirmation":"WRONG"}'`
- `curl -X DELETE http://127.0.0.1:8080/api/backups/<created-archive>`
- `curl 'http://127.0.0.1:8080/api/audit?action=backup-create&pageSize=5'`
- `curl 'http://127.0.0.1:8080/api/audit?action=backup-restore&pageSize=5'`
- `curl 'http://127.0.0.1:8080/api/audit?action=backup-delete&pageSize=5'`

### Phase 15 Mods

Goals:

- Add a mod management workflow that is safe for a live server and obvious to operate.
- Distinguish staging from active install state.

Scope:

- Add upload/list/delete endpoints scoped to `data/mods` and an optional staging area.
- Show installed jar metadata where practical.
- Support enable/install and remove workflows with restart-required messaging.
- Add quarantine or rollback handling for bad uploads.
- Audit all mod changes.

Validation:

- `npm run check` in `panel/`
- `npm run build` in `panel/`
- `docker compose up -d --build panel`
- Manual upload/remove/restart-required smoke tests

### Phase 16 Files

Goals:

- Add a scoped file manager for the Minecraft data tree without turning the panel into a general shell.

Scope:

- Restrict all file actions to approved roots under `data/`.
- Add list/read/download/upload/rename/delete endpoints with path normalization and traversal protection.
- Add simple editor support for small text files such as config JSON, properties, and whitelist files.
- Clearly separate safe text edits from binary download/upload actions.
- Audit destructive file operations.

Validation:

- `npm run check` in `panel/`
- `npm run build` in `panel/`
- `docker compose up -d --build panel`
- Manual file traversal and blocked-path tests

### Phase 17 Realtime And Console Cleanup

Goals:

- Reduce polling and use the management API's notification stream where it adds value.
- Narrow the remaining RCON dependency to only what cannot yet be replaced.

Scope:

- Add a persistent management API client/subscriber in the panel backend.
- Consume notifications such as server status, player joins/leaves, saves, and operator/allowlist changes.
- Push live updates to the frontend for dashboard and player views.
- Reassess the console page and replace any remaining RCON-backed actions if a safe non-RCON path becomes available.
- Keep polling as a fallback if the notification channel is unavailable.

Validation:

- `npm run check` in `panel/`
- `npm run build` in `panel/`
- `docker compose up -d --build panel`
- Manual live-update verification during join/leave/save/admin actions
