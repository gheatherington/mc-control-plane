# Management API Outage Research And Fix Plan

Date: 2026-03-16

## Summary

The outage on `25585` is not a Docker networking problem and not a bad `server.properties` value.
The current live server is pinned to `Minecraft 1.21.1` with `NeoForge 21.1.220`, and that runtime does not provide the Minecraft Server Management Protocol used by the panel.

The panel's old successful `25585` connections came from earlier runs on newer runtimes:

- `2026-03-16 00:24 UTC`: `Minecraft 1.21.11` with Fabric
- `2026-03-16 02:44 UTC`: `Minecraft 1.21.11` with NeoForge `21.11.38-beta`

After the BMC5 rebase to `Minecraft 1.21.1`, every boot completes with game and RCON listeners but never starts the JSON-RPC management listener:

- `2026-03-16 14:34 UTC`
- `2026-03-16 15:07 UTC`
- `2026-03-16 15:11 UTC`
- `2026-03-16 17:09 UTC`
- `2026-03-16 17:45 UTC`

## Evidence

Local runtime evidence:

- Current `data/server.properties` still sets:
  - `management-server-enabled=true`
  - `management-server-host=0.0.0.0`
  - `management-server-port=25585`
- Inside the live container, only `25565` and `25575` are listening.
- From the panel container, a direct TCP connect to `neoforge:25585` fails with `ECONNREFUSED`.
- Current boot logs show `Done (...)` and `RCON running on 0.0.0.0:25575`, but no `Starting json RPC server` line.

Historical log evidence:

- [data/logs/2026-03-16-1.log.gz](/opt/fabric-minecraft-server/data/logs/2026-03-16-1.log.gz) shows `Loading Minecraft 1.21.11 with Fabric Loader 0.18.4` and then `Starting json RPC server on 0.0.0.0:25585`.
- [data/logs/2026-03-16-4.log.gz](/opt/fabric-minecraft-server/data/logs/2026-03-16-4.log.gz) shows `Minecraft 1.21.11`, `NeoForge 21.11.38-beta`, and then `Starting json RPC server on 0.0.0.0:25585`.
- [data/logs/latest.log](/opt/fabric-minecraft-server/data/logs/latest.log#L2049) shows the current `Minecraft 1.21.1` boot finishing without any JSON-RPC startup lines.

Runtime code evidence:

- The current `1.21.1` dedicated server classes do not expose `management-server-*` fields in `DedicatedServerProperties`, which matches the missing listener behavior.

External product evidence:

- Mojang introduced the Minecraft Server Management Protocol in snapshot `25w35a`, not in early `1.21.1` builds:
  - https://feedback.minecraft.net/hc/en-us/articles/39107188599565-Minecraft-Java-Edition-Snapshot-25w35a
- Ecosystem mods that extend this protocol also describe it as a `1.21.9+` / `25w35a+` feature:
  - https://modrinth.com/mod/msmp-enhanced
  - https://modrinth.com/mod/not-enough-management

## Root Cause

The stack documentation and panel assumptions carried forward from a newer test runtime where the management protocol existed.
When the live server was rebased to the BMC5 pack on `Minecraft 1.21.1`, the stack kept the `management-server-*` configuration and panel client logic, but the underlying game runtime no longer supported that protocol.

In short:

- `25585` worked on newer pre-BMC5 runtimes
- BMC5 requires `Minecraft 1.21.1`
- `Minecraft 1.21.1` does not provide the management protocol
- the panel therefore falls back to Docker, file, and RCON paths by design

## Recommended Fix Direction

Treat the management API as unavailable on the current `1.21.1` BMC5 line.
Do not continue debugging `25585` as if it is a misconfiguration, because the core feature is absent in this runtime.

## Fix Plan

### Phase 1: Correct The Source Of Truth

1. Update operator docs to state that the Minecraft Server Management Protocol was introduced after `1.21.1`, so the pinned BMC5 runtime cannot expose `25585`.
2. Remove or clearly mark misleading wording that implies the `1.21.1` live stack should have a working built-in management endpoint.
3. Record the exact regression boundary:
   - healthy on `1.21.11`
   - unavailable on `1.21.1`

### Phase 2: Stop Treating 25585 As A Recoverable Runtime Fault

1. Change panel health/status messaging so `25585` absence is shown as an expected capability gap on `1.21.1`, not as an unexplained outage.
2. Gate management-client startup behind capability detection:
   - try `rpc.discover` only when the runtime is known to support MSMP, or
   - cache a negative capability result and avoid repeated noisy reconnect attempts
3. Keep fallback paths as the primary control plane for this server line:
   - Docker for container state
   - file reads/writes for settings and file management
   - scoped RCON for actions that still require server execution

### Phase 3: Harden The 1.21.1 Fallback Path

1. Review every panel action that currently prefers management RPC.
2. Ensure each action has an explicit `1.21.1` fallback path and user-facing wording.
3. Reduce unnecessary RCON polling/noise where file or Docker state is sufficient.
4. Add focused regression checks for:
   - dashboard state
   - player list/actions
   - save and broadcast flows
   - settings reads/writes
   - SSE refresh behavior while on fallback mode

### Phase 4: Decide The Long-Term Strategy

Recommended default:

1. Keep BMC5 on `Minecraft 1.21.1`.
2. Operate permanently on the fallback control-plane architecture for this modpack line.
3. Remove any roadmap assumptions that require native `25585` on this stack.

Only if structured management RPC becomes a hard requirement:

1. Evaluate upgrading to a future modpack/runtime that supports `Minecraft 1.21.9+`.
2. Verify full client/server mod compatibility before any upgrade commitment.
3. If upgrade is not acceptable, evaluate a custom backport or bridge implementation as a separate project with explicit maintenance cost.

## Validation After The Fix Work

Once the panel/docs changes are complete, validate:

1. `docker compose config`
2. `panel npm run check`
3. `panel npm run build`
4. `docker compose up -d --build --remove-orphans`
5. Panel behavior with `25585` absent:
   - no crash loops
   - no misleading "outage" messaging
   - dashboard/settings/player actions still work through fallback

## Decision

The immediate fix is not to "make 25585 work" on `Minecraft 1.21.1`.
The immediate fix is to align the panel and docs with the real runtime capability boundary, then harden fallback mode as the supported operating model for the live BMC5 server.
