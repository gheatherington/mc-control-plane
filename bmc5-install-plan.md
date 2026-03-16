# BMC5 Installation Plan

## Implementation Note (2026-03-16)

This plan was implemented with one important live-environment deviation:

- the BMC5 server pack booted successfully, but the Minecraft built-in JSON-RPC management API did not bind on `25585` in this environment after the rebase
- `NEOFORGE_VERSION=21.1.219` was tested first per pack expectations, then the live runtime was returned to `21.1.220`
- the panel was hardened to fall back to Docker, file, and RCON-backed operations for dashboard, settings, player actions, saves, and broadcasts when the management API is unavailable

Treat the rest of this document as the original installation plan plus the implementation note above.

## Purpose

This document is a standalone implementation plan for installing `Better MC [NEOFORGE] BMC5` onto the live server stack in `/opt/fabric-minecraft-server`.

It is written so a future clean-context session can execute the work without relying on prior chat history.

## Scope

This plan covers:

- replacing the current test server content with the BMC5 server pack
- preserving the existing Docker + panel + Caddy architecture
- restoring Admin Control Plane functionality after the pack import
- validating that the server, panel, management API, and RCON all still work
- leaving a rollback path if the first boot fails

This plan does **not** attempt to preserve the old world. The prior world was confirmed to be disposable test data, so a fresh BMC5-generated world is the intended outcome.

## Current Live Environment

Repository root:

- `/opt/fabric-minecraft-server`

Important live files:

- `/opt/fabric-minecraft-server/docker-compose.yml`
- `/opt/fabric-minecraft-server/.env`
- `/opt/fabric-minecraft-server/README.md`
- `/opt/fabric-minecraft-server/AGENTS.md`

Important runtime directories:

- `/opt/fabric-minecraft-server/data`
- `/opt/fabric-minecraft-server/backups`
- `/opt/fabric-minecraft-server/panel`
- `/opt/fabric-minecraft-server/panel-data`

Current services:

- `neoforge`
- `panel`
- `caddy`

Current container names:

- `neoforge-minecraft-server`
- `neoforge-minecraft-panel`
- `neoforge-minecraft-panel-caddy`

Current pinned runtime before BMC5 change:

- Minecraft `1.21.1`
- NeoForge `21.1.220`
- Docker image `itzg/minecraft-server:java21`
- host Minecraft port `6767`
- internal management API port `25585`
- panel through Caddy on `8080`

Observed current disk context at planning time:

- `/opt/fabric-minecraft-server/data` was about `450M`
- host free space was about `5.2G`

That is enough for staging and deployment, but large temporary archives should still be cleaned up after installation.

## Confirmed User Decisions

These decisions were already made and should be treated as approved unless explicitly changed:

- generate a fresh new BMC5 world
- do not preserve the current `data/world`
- regenerating or replacing `server.properties` is acceptable
- Admin Control Plane features must be restored afterward

## Pack Research Summary

Client zip provided by user:

- `https://mediafilez.forgecdn.net/files/7703/808/Better%20MC%20%5BNEOFORGE%5D%201.21.1%20v48.5.zip`

Important finding:

- that URL is the client/export package, not the server deployment package

Confirmed server pack:

- `BMC5_Server_Pack_v48.5.zip`
- CurseForge file page: `https://www.curseforge.com/minecraft/modpacks/better-mc-neoforge-bmc5/files/7703842`

Confirmed contents of the server pack:

- `mods/`
- `config/`
- `server.properties`
- `start.sh`
- `start.bat`
- `start.ps1`
- `variables.txt`
- `install_java.sh`

Observed pack characteristics:

- about `330` mod files
- about `41` files intentionally shipped as `.disabled`
- no prebuilt world bundled with the server pack
- server pack targets Minecraft `1.21.1`
- server pack targets NeoForge `21.1.219`

Important compatibility note:

- the live stack was pinned to `21.1.220`
- the BMC5 manifest and bundled server pack files target `21.1.219`
- first install should align to `21.1.219` instead of assuming patch-level compatibility

## Why This Installation Method

The correct approach for this stack is:

1. use the official BMC5 **server pack**
2. keep the existing Docker Compose architecture
3. keep `TYPE=NEOFORGE`
4. import the pack contents into `/opt/fabric-minecraft-server/data`
5. do **not** run the pack's `start.sh`

Reasoning:

- the live server is already Dockerized around `itzg/minecraft-server:java21`
- the panel depends on the existing runtime and internal management API
- the pack's launcher scripts are designed for generic host-based startup, not this specific Compose stack
- using the pack's scripts would create unnecessary divergence from the current operational model

## Critical Admin Control Plane Constraints

The BMC5 `server.properties` must **not** be copied into place without review.

During planning, the pack's `server.properties` was compared with the live one. The pack version would drop or disable key control-plane requirements, including:

- `management-server-enabled=true`
- `management-server-host=0.0.0.0`
- `management-server-port=25585`
- `management-server-secret=<value>`
- `management-server-tls-enabled=false`
- `enable-rcon=true`
- `rcon.password=<value>`

The pack file also differs in gameplay-related values such as:

- `allow-flight=true`
- `enable-command-block=true`
- `level-type=bclib:normal`
- pack-specific MOTD

The correct pattern is:

- use the BMC5 `server.properties` as a gameplay/worldgen baseline if desired
- then reapply all control-plane-required settings afterward

## Best Practices For Installing a Large Modpack Server

These practices should be followed during implementation:

- install from the server pack, not the client export
- match the mod loader version exactly on first deployment
- prefer a fresh world for a worldgen-heavy pack unless an existing world must be preserved
- stage files outside live `/data` first
- back up the old runtime before replacing anything
- avoid running third-party launcher scripts when the server already has a stable orchestration layer
- preserve operational settings separately from gameplay settings
- verify ownership remains `brayden:brayden`
- validate first boot from logs before declaring the deployment complete

## Recommended File And Config Strategy

### Keep As-Is

These components should remain part of the deployment:

- `/opt/fabric-minecraft-server/docker-compose.yml`
- `/opt/fabric-minecraft-server/panel`
- `/opt/fabric-minecraft-server/panel-data`
- `/opt/fabric-minecraft-server/Caddyfile`
- overall Compose service topology

### Update

These should be changed for BMC5:

- `/opt/fabric-minecraft-server/.env`
- `/opt/fabric-minecraft-server/data/mods`
- `/opt/fabric-minecraft-server/data/config`
- `/opt/fabric-minecraft-server/data/server.properties`
- `/opt/fabric-minecraft-server/data/world`

### Do Not Import Directly Into Live Runtime

These pack files should be treated as reference-only:

- `start.sh`
- `start.bat`
- `start.ps1`
- `install_java.sh`
- `variables.txt`

They are useful for confirming upstream expectations, but should not be adopted as the runtime control method for this Docker stack.

## Required Runtime Changes

### `.env`

Update:

- `NEOFORGE_VERSION=21.1.219`

Do not change unless needed:

- `MC_VERSION=1.21.1`
- `MC_PORT=6767`
- `MC_MANAGEMENT_PORT=25585`
- memory settings unless boot testing proves they need tuning

### `server.properties`

After importing or regenerating the BMC5 server properties, ensure these settings are present:

```properties
enable-rcon=true
rcon.password=<set to valid value>
rcon.port=25575
management-server-enabled=true
management-server-host=0.0.0.0
management-server-port=25585
management-server-secret=<set to valid value>
management-server-tls-enabled=false
```

Keep or review these host/runtime-specific values:

```properties
server-port=25565
online-mode=true
white-list=false
max-players=20
```

Gameplay/worldgen values may come from BMC5 as desired, including:

```properties
level-name=world
level-type=bclib\:normal
motd=Better MC [NEOFORGE] 1.21.1
allow-flight=true
enable-command-block=true
```

If a new `server.properties` is generated instead of copied from the pack, ensure the BMC5-required worldgen-related values are explicitly restored where needed.

## Implementation Sequence

### Phase 1: Backup And Snapshot

Create a rollback point before touching the live server:

- back up `/opt/fabric-minecraft-server/data`
- back up `/opt/fabric-minecraft-server/.env`
- back up `/opt/fabric-minecraft-server/docker-compose.yml`

Recommended backup artifacts:

- a timestamped archive or copied directory under `/opt/fabric-minecraft-server/backups`
- a small text note containing the exact restore procedure

Minimum checks:

- verify backup exists
- verify ownership is still `brayden:brayden`

### Phase 2: Stage The BMC5 Server Pack

Create a temporary staging directory outside live `/data`, for example:

- `/tmp/bmc5-stage`
- or `/opt/fabric-minecraft-server/backups/bmc5-staging`

Download and extract the BMC5 server pack there.

Expected staged content:

- `mods/`
- `config/`
- `server.properties`

At this point, generate an inventory:

- count mod jars
- verify presence of `.disabled` files
- confirm absence of prebuilt world

### Phase 3: Align Runtime Version

Edit `/opt/fabric-minecraft-server/.env`:

- change `NEOFORGE_VERSION=21.1.220` to `NEOFORGE_VERSION=21.1.219`

Reason:

- the BMC5 pack explicitly targets `21.1.219`
- baseline deployment should match upstream pack expectations exactly

### Phase 4: Replace Test Runtime Content

Stop the stack before file replacement.

Recommended approach:

1. stop the server cleanly
2. archive the old `/data`
3. clear or move aside old test content
4. copy BMC5 `mods/` into `/opt/fabric-minecraft-server/data/mods`
5. copy BMC5 `config/` into `/opt/fabric-minecraft-server/data/config`
6. remove the old test `world/`
7. prepare `server.properties`

If the pack ships additional directories that are clearly required and belong under `/data`, include them only after inspection.

### Phase 5: Rebuild `server.properties`

Two acceptable patterns:

#### Option A: BMC5 Base, Then Reapply Control Plane

1. copy the pack `server.properties` into `/opt/fabric-minecraft-server/data/server.properties`
2. manually restore:
   - RCON settings
   - management API settings
   - any host-specific runtime values

This is the recommended option.

#### Option B: Regenerate, Then Apply BMC5 Values

1. allow the server/image to generate a clean `server.properties`
2. patch in BMC5-specific gameplay and worldgen values
3. patch in RCON and management API settings

This is acceptable if the import is cleaner this way.

### Phase 6: Boot And Validate

Run:

- `docker compose config`
- `docker compose up -d --build --remove-orphans`

Then validate:

- `docker compose ps`
- `docker compose logs -f neoforge`

Look specifically for:

- missing mod files
- incompatible mod loader errors
- registry load failures
- config parsing failures
- worldgen bootstrap failures
- management API startup failures
- RCON initialization failures

### Phase 7: Validate The Admin Control Plane

Confirm:

- panel still loads on port `8080`
- management API is reachable internally on `25585`
- dashboard data updates correctly
- player and server control actions still work
- console command execution still works through RCON fallback

### Phase 8: Cleanup And Commit

After a successful validation:

- remove temporary staged archives if no longer needed
- keep at least one rollback snapshot
- update docs if the runtime pin changes are operator-relevant
- commit the final working state in git

Suggested commit style:

- `Install Better MC 5 server pack`
- or `Rebase server to BMC5 v48.5`

## Agent-Based Execution Plan

Use multiple agents in the next implementation session to reduce context load and improve speed.

### Agent 1: Backup / Rollback Agent

Responsibilities:

- snapshot `/data`, `.env`, and `docker-compose.yml`
- record backup sizes and locations
- verify ownership and restore readiness

Outputs:

- backup artifact(s)
- restore instructions

### Agent 2: Pack Staging Agent

Responsibilities:

- download and extract `BMC5_Server_Pack_v48.5.zip`
- inventory `mods/`, `config/`, and any extra files
- prepare a concise summary of what will be imported

Outputs:

- staging directory
- file inventory summary

### Agent 3: Runtime Alignment Agent

Responsibilities:

- update `.env` to `NEOFORGE_VERSION=21.1.219`
- prepare the `server.properties` merge
- make sure Compose and panel integration settings remain intact

Outputs:

- updated `.env`
- final `server.properties`

### Agent 4: Validation Agent

Responsibilities:

- run `docker compose config`
- boot the stack
- inspect logs
- verify panel, management API, and RCON behavior

Outputs:

- boot validation summary
- list of any follow-up fixes

### Recommended Order

Use the agents in this sequence:

1. Agent 1 and Agent 2 in parallel
2. Agent 3 after staging confirms pack contents
3. Agent 4 after file replacement and config updates

## Concrete Command Checklist

Run from `/opt/fabric-minecraft-server` unless noted otherwise.

Pre-change:

```bash
docker compose ps
docker compose config
```

Stop stack before replacement:

```bash
docker compose down
```

Bring stack back:

```bash
docker compose up -d --build --remove-orphans
docker compose ps
docker compose logs -f neoforge
```

Post-change validation:

```bash
docker compose logs --tail=200 neoforge
docker compose logs --tail=200 panel
```

If shell scripts are added or edited during implementation:

```bash
bash -n path/to/script.sh
```

## Validation Checklist

A successful implementation should satisfy all of the following:

- `.env` pins `NEOFORGE_VERSION=21.1.219`
- `docker compose config` succeeds
- containers start successfully
- NeoForge boots without loader mismatch errors
- BMC5 mods are present in `/opt/fabric-minecraft-server/data/mods`
- BMC5 config files are present in `/opt/fabric-minecraft-server/data/config`
- a fresh `world/` is created successfully
- panel remains accessible on `8080`
- management API is enabled on `25585`
- RCON is enabled and usable for console fallback
- file ownership under `/opt/fabric-minecraft-server/data` remains correct

## Risks And Mitigations

### Risk: NeoForge Patch Mismatch

Symptom:

- startup failure or obscure mod incompatibility

Mitigation:

- pin to `21.1.219` first

### Risk: Broken Panel Integration

Symptom:

- panel loads but cannot control or inspect the server

Mitigation:

- ensure all `management-server-*` properties are restored
- ensure `enable-rcon=true` and valid `rcon.password`

### Risk: Pack Config Overwrites Operational Settings

Symptom:

- server boots but control-plane features disappear

Mitigation:

- use selective `server.properties` merge
- do not blindly copy pack settings over operational ones

### Risk: Disk Pressure During Staging

Symptom:

- archive extraction or Docker startup fails due to low free space

Mitigation:

- stage temporarily
- remove unneeded archives after validation
- keep one rollback copy only

## Fallback / Rollback Plan

If the BMC5 deployment fails:

1. stop the stack
2. restore the pre-change `/data`
3. restore the pre-change `.env`
4. restore the pre-change `docker-compose.yml` if it was touched
5. run `docker compose up -d`
6. verify panel and server return to prior state

Because the old world was disposable test data, rollback is primarily for operational recovery, not world preservation.

## Suggested Deliverables For The Next Session

The next implementation session should produce:

- updated `/opt/fabric-minecraft-server/.env`
- updated `/opt/fabric-minecraft-server/data/mods`
- updated `/opt/fabric-minecraft-server/data/config`
- updated `/opt/fabric-minecraft-server/data/server.properties`
- fresh generated `/opt/fabric-minecraft-server/data/world`
- validation summary
- git commit for the completed change

## Source References

These sources informed this plan and should be used again if re-verification is needed:

- CurseForge project files:
  - `https://www.curseforge.com/minecraft/modpacks/better-mc-neoforge-bmc5/files/all`
- BMC5 server pack file page:
  - `https://www.curseforge.com/minecraft/modpacks/better-mc-neoforge-bmc5/files/7703842`
- `itzg/minecraft-server` Auto CurseForge docs:
  - `https://github.com/itzg/docker-minecraft-server/blob/master/docs/types-and-platforms/mod-platforms/auto-curseforge.md`
- `itzg/minecraft-server` manual CurseForge server pack docs:
  - `https://github.com/itzg/docker-minecraft-server/blob/master/docs/types-and-platforms/mod-platforms/curseforge.md`
- `itzg/minecraft-server` variables reference:
  - `https://github.com/itzg/docker-minecraft-server/blob/master/docs/variables.md`

## Final Instruction For The Next Session

Treat this as a clean BMC5 rebase onto the existing Dockerized NeoForge server stack.

The shortest correct path is:

1. back up current runtime
2. stage official BMC5 server pack
3. pin NeoForge to `21.1.219`
4. replace test world/mod/config content with BMC5 content
5. restore management API and RCON settings in `server.properties`
6. boot, validate, and commit
