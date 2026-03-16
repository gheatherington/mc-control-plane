# NeoForge Migration And Remaining Control Plane Work

## Summary

Rebaseline the stack from Forge to NeoForge before continuing Control Plane development. Treat the NeoForge cutover as a prerequisite for the remaining unfinished work in `plan.md`, then complete Phase 16 (`Files`) and Phase 17 (`Realtime And Console Cleanup`) against the NeoForge runtime.

The runtime should become NeoForge-first, while visible panel branding should become generic `Modded MC`. The Mods route should explicitly refer to Forge/NeoForge server mod jars.

## Implementation Order

1. Update `plan.md` so the remaining roadmap reflects NeoForge instead of Forge.
2. Migrate the runtime and panel compatibility from Forge to NeoForge.
3. Validate the live stack and management API under NeoForge.
4. Implement Phase 16 Files.
5. Validate Phase 16.
6. Implement Phase 17 Realtime And Console Cleanup.
7. Validate Phase 17.
8. Update docs and progress notes.
9. Commit each meaningful milestone.

## `plan.md` Changes

- Add a new migration phase before Phase 16:
  - title: `NeoForge Migration`
  - note that the server is moving to NeoForge because clients will use shared gameplay NeoForge mods
  - note that panel branding becomes generic `Modded MC`
  - note that the Mods route explicitly refers to Forge/NeoForge jars
- Update the Active Summary:
  - replace Forge-first runtime language with NeoForge-first runtime language
  - state that the visible Control Plane branding is generic
- Update current runtime references:
  - use NeoForge runtime/service naming where the text is describing the actual platform
  - state that `NEOFORGE_VERSION` must be pinned
- Update Phase 15 notes:
  - mod metadata inventory must support `META-INF/neoforge.mods.toml`
- Update Phase 16 assumptions:
  - the file manager must safely support NeoForge config/layout files
  - approved roots should include `config/`, `defaultconfigs/`, world configs, `server.properties`, allowlist/op files, and mod directories
- Update Phase 17 assumptions:
  - verify that the management API notification stream behaves correctly under NeoForge
  - keep a documented polling fallback if notification coverage is incomplete
- Add a migration dependency note above Phase 16:
  - Phase 16 and 17 start only after NeoForge runtime and panel compatibility are complete and validated

## NeoForge Migration

### Runtime

- Change Compose runtime from `TYPE=FORGE` to `TYPE=NEOFORGE`.
- Add and pin `NEOFORGE_VERSION`.
- Keep:
  - host port `6767`
  - panel port `8080`
  - management API port `25585`
  - memory settings
  - DNS override unless testing proves it is no longer needed
  - mounted data, backups, panel-data, scripts, and Docker socket wiring
- Update service/container/default references so runtime host/container names are internally consistent.

### Panel backend

- Update default config values that still assume Forge runtime naming.
- Extend mod metadata parsing to support:
  - `fabric.mod.json`
  - `META-INF/mods.toml`
  - `META-INF/neoforge.mods.toml`
- Expand the loader enum and returned metadata so `neoforge` is a first-class value.

### Panel frontend

- Change visible shell/sidebar branding to `Modded MC`.
- Keep the Mods page explicitly about Forge/NeoForge server mod jars.
- Remove any remaining Fabric-only or Forge-only wording that would mislead operators.

### Docs

- Update `README.md`, `AGENTS.md`, and `plan.md` to NeoForge runtime language.
- Keep operator guidance explicit that shared gameplay modpacks must match between client and server.

## Phase 16 Files

### Goal

Add a scoped file manager for the Minecraft data tree without turning the panel into a shell.

### Approved roots

Restrict file access to the mounted Minecraft data tree and only the paths needed for operations:

- `config/`
- `defaultconfigs/`
- `mods/`
- `mods-staging/`
- `world/`
- top-level text/json/properties admin files under `data/`

### Backend

- Add scoped list/read/download/upload/rename/delete endpoints.
- Normalize paths and block traversal, symlink escape, hidden-root escape, and non-approved roots.
- Support inline editing only for small safe text files such as:
  - `.json`
  - `.properties`
  - `.toml`
  - `.txt`
  - `.yml`
  - `.yaml`
- Keep binary flows separate from inline text editing.
- Audit destructive or state-changing file operations:
  - upload
  - rename
  - delete
  - write/edit

### Frontend

- Replace the Files placeholder route with a real file manager.
- Show:
  - root-scoped navigation
  - directory listing
  - file details
  - guarded destructive actions
  - simple inline editor for safe text files
- Treat binary files as download/upload only.

### Validation

- traversal-block tests
- safe text-edit tests against NeoForge config files
- binary upload/download tests
- audit verification for destructive operations

## Phase 17 Realtime And Console Cleanup

### Goal

Reduce polling where the management API can supply live updates and narrow RCON usage to what cannot safely move away.

### Backend

- Add a persistent management API subscriber/client.
- Consume notifications for:
  - server status
  - player joins/leaves
  - save events
  - operator changes
  - allowlist changes
- Keep polling fallback if subscription fails or event coverage is incomplete under NeoForge.

### Frontend

- Push live updates to dashboard and players views.
- Fall back to existing polling behavior if the live channel is unavailable.

### Console

- Reassess whether remaining RCON-backed actions can move to the management API safely.
- Keep RCON only for actions that still have no safe management API replacement.

### Validation

- live join/leave verification
- live save/admin-change verification
- fallback verification with live subscription unavailable
- console regression checks

## Agent Workflow

## Change agent

Use one implementation agent to make changes in this order:

1. update `plan.md`
2. implement NeoForge migration
3. validate NeoForge runtime and panel compatibility
4. implement Phase 16
5. validate Phase 16
6. implement Phase 17
7. validate Phase 17
8. update docs and progress notes
9. commit each completed milestone

## Review-agent checklist

After each major milestone, run focused review passes:

### Runtime review

- confirm Compose/env/runtime references are NeoForge-correct
- confirm version pinning is explicit
- confirm service/container/script references are internally consistent
- confirm no stale Forge runtime assumptions remain

### Backend review

- confirm NeoForge metadata parsing exists everywhere needed
- confirm panel config defaults are correct
- confirm Files scope and traversal protections cover every read/write path
- confirm realtime fallback logic is complete

### Frontend/content review

- confirm visible branding is generic `Modded MC`
- confirm Mods route language is Forge/NeoForge-specific where appropriate
- confirm Files and realtime views expose the intended behaviors

### Docs/repo review

- confirm `plan.md`, `README.md`, and `AGENTS.md` reflect NeoForge runtime and remaining phases
- confirm completed-phase notes do not contradict the runtime
- confirm commits were created for each milestone

### Gap review

- run repo-wide searches for:
  - `forge`
  - `Forge`
  - `fabric`
  - `Fabric`
  - `neoforge`
  - runtime/container names
- flag any stale references that still require changes

## Interactive Prompt Rules

Ask the user directly during implementation only when the answer cannot be discovered locally and materially changes behavior. Important examples:

- choosing a pinned `NEOFORGE_VERSION` if multiple plausible versions apply to the final Minecraft version
- deciding whether stale Forge-only artifacts in `data/` should be deleted immediately or retained temporarily for rollback safety
- deciding whether any risky-but-in-root files should remain hidden from the Files UI
- deciding whether any console actions should stay on RCON even if a lower-fidelity management API alternative exists

Default behavior:

- recommend the safer option first
- proceed with the recommended option if the user confirms or does not override
- record the choice in `plan.md` and milestone notes when it affects behavior

## Validation Checklist

### NeoForge migration

- `bash -n scripts/server-control.sh`
- panel typecheck/build
- `docker compose config`
- `docker compose up -d --build --remove-orphans`
- verify NeoForge server reaches `healthy`
- verify dashboard, players, mods, and settings endpoints work

### Phase 16

- blocked traversal tests
- text edit tests on safe NeoForge config files
- binary upload/download tests
- audit verification for destructive operations

### Phase 17

- live event verification for joins/leaves/save/admin changes
- fallback verification with subscriber unavailable
- console regression checks

### Final sign-off

- review-agent checklist completed
- repo-wide stale-reference search completed
- `plan.md` updated to mark NeoForge migration complete
- `plan.md` updated to mark Phase 16 complete
- `plan.md` updated to mark Phase 17 complete

## Assumptions

- Runtime target is NeoForge, not Forge.
- Visible panel branding should be generic `Modded MC`.
- The Mods route should explicitly refer to Forge/NeoForge server mod jars.
- There are no planned phases after Phase 17 in the current `plan.md`; if new work appears, add a new explicit phase instead of silently folding it into 16 or 17.
