# MOTD Editor + Live NeoForge Helper Plan

## Purpose
This document is the execution brief for a future Codex session. The next session should use this file as the source of truth to implement:

- a new MOTD editor in the panel `Settings` route
- reliable MOTD persistence with no revert-on-restart behavior
- full support for two-line MOTDs
- standard Minecraft legacy colors and text styles
- a raw-code editing mode
- a small server-side NeoForge helper that enables live MOTD updates on the pinned `Minecraft 1.21.1` runtime

This plan is written so the work can be split across multiple scoped agents to reduce context pressure, then integrated and validated from one session.

## Repo And Runtime Constraints
- Repo root: `/opt/fabric-minecraft-server`
- Active runtime: `Minecraft 1.21.1`
- Loader/runtime: `NeoForge 21.1.220`
- Active stack root: `/opt/fabric-minecraft-server`
- Live server data: `/opt/fabric-minecraft-server/data`
- Panel lives under: `/opt/fabric-minecraft-server/panel`
- `panel-mod/` is historical and must not be revived
- The pinned `1.21.1` runtime does not support the native Minecraft management protocol on `25585`
- The live stack currently relies on Docker/file/RCON fallback paths

## User Decisions Already Made
- Default editing mode: visual builder
- Advanced editing mode: raw-code tab remains available
- While raw code is being edited, the visual builder must become read-only
- Supported formatting scope for now: standard Minecraft legacy colors and styles only
- A small server-side NeoForge helper is allowed and should be added so MOTD can update live on `1.21.1`

## Problem Summary
The current MOTD implementation is not fit for the desired behavior.

### Current Code Findings
- MOTD is currently modeled as a generic string setting in `panel/src/server/settings.ts`
- The UI renders it as a plain single-line input in `panel/src/client/App.tsx`
- The current runtime cannot use the native live settings API because `Minecraft 1.21.1` predates that protocol
- The panel can currently persist `motd` into `data/server.properties`, but that alone does not provide live reload on this runtime

### Most Likely Root Cause Of The Revert
There is split ownership of MOTD:

- the panel writes `data/server.properties`
- Docker Compose still injects `MOTD` from `.env`

Relevant file:
- `docker-compose.yml` currently includes `MOTD: "${MOTD}"`

That means container recreation or restart behavior can cause the runtime image to reassert the `.env` value, which matches the reported bug where a changed MOTD reverted back to its previous value.

## Research Summary
These findings should guide implementation choices.

1. `itzg/minecraft-server` manages `server.properties` from env vars unless configured otherwise, and it supports MOTD formatting plus multiline `\n`.
2. On popular server platforms, live MOTD changes are commonly implemented by changing the server-list ping response dynamically, not by treating `server.properties` as live-reloadable.
3. Minecraft MOTD formatting supports legacy codes and two-line text, but overly long rendered MOTDs can behave poorly in clients.

### External References
- `itzg/minecraft-server` server properties and MOTD behavior:
  - https://docker-minecraft-server.readthedocs.io/en/latest/configuration/server-properties/
- Minecraft `server.properties` reference:
  - https://minecraft.wiki/w/Server.properties
- Minecraft formatting codes:
  - https://minecraft.wiki/w/Formatting_codes
- Spigot reference for dynamic server-list MOTD behavior:
  - https://hub.spigotmc.org/javadocs/spigot/org/bukkit/event/server/ServerListPingEvent.html

## High-Level Solution
Implement the feature in four layers:

1. Fix persistence ownership so MOTD no longer reverts.
2. Replace the generic string field with a dedicated MOTD editor in the panel.
3. Add a narrow NeoForge runtime helper that can apply MOTD updates live on `1.21.1`.
4. Wire accurate save/apply status and validate the end-to-end behavior.

## Architecture Decisions

### Persistence Ownership
The panel must become the sole owner of MOTD persistence.

Implementation intent:
- remove Compose-driven MOTD ownership from the live runtime path
- keep the runtime-facing persisted MOTD in `data/server.properties`
- optionally keep a richer structured representation in `panel-data` so the UI can round-trip cleanly

Recommended approach:
- remove `MOTD: "${MOTD}"` from `docker-compose.yml`
- keep `.env` and `.env.example` aligned with the live stack, but make clear MOTD is now panel-managed if those files are retained
- consider documenting this in `README.md` or `AGENTS.md` if needed

### Runtime Live Apply
Because `1.21.1` cannot use the native management protocol, live update requires a runtime-side helper.

Implementation intent:
- create a new dedicated helper module, for example `runtime-motd-helper/`
- do not use `panel-mod/`
- expose a narrow local-only control path that the panel backend can call
- update the in-memory server MOTD
- invalidate or refresh cached server status so the next ping reflects the change
- keep the helper tightly scoped to MOTD only

### UI Editing Model
The new editor should support:

- visual builder as the default tab
- raw-code tab for advanced edits
- two lines
- standard legacy colors only
- standard legacy styles only:
  - bold
  - italic
  - underline
  - strikethrough
  - obfuscated
  - reset
- a live preview modeled after a multiplayer server-list card
- validation and warning states

### Raw Mode Locking Rule
When raw mode is being edited:

- the visual builder becomes read-only
- the preview continues to update if the raw input is parseable
- if the raw input cannot be losslessly mapped back to the supported visual model, the builder stays read-only and a warning is shown

## Shared Data Contract
All agents must align to this contract before implementation diverges.

### `MotdDocument`
Structured representation used by the panel editor.

Suggested shape:

```ts
type MotdStyle = {
  bold?: boolean;
  italic?: boolean;
  obfuscated?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
};

type MotdColor =
  | "black"
  | "dark_blue"
  | "dark_green"
  | "dark_aqua"
  | "dark_red"
  | "dark_purple"
  | "gold"
  | "gray"
  | "dark_gray"
  | "blue"
  | "green"
  | "aqua"
  | "red"
  | "light_purple"
  | "yellow"
  | "white";

type MotdSegment = {
  color: MotdColor;
  style: MotdStyle;
  text: string;
};

type MotdLine = {
  segments: MotdSegment[];
};

type MotdDocument = {
  line1: MotdLine;
  line2: MotdLine;
};
```

The exact structure may vary, but the system must preserve:
- line separation
- segment order
- legacy color choice
- supported styles

### `SerializedMotd`
Runtime-facing Minecraft MOTD string using:
- legacy `§` formatting codes
- `\n` between lines

### `ApplyResult`

```ts
type ApplyResult =
  | "live-and-persisted"
  | "persisted-only"
  | "live-apply-failed";
```

### `RawModeState`

```ts
type RawModeState =
  | "clean"
  | "editing"
  | "parseable"
  | "non-roundtrippable";
```

## Current Files Likely To Be Changed

### Existing Files
- `docker-compose.yml`
- `.env`
- `.env.example`
- `README.md`
- `AGENTS.md`
- `panel/src/server/settings.ts`
- `panel/src/server/app.ts`
- `panel/src/server/minecraft.ts`
- `panel/src/server/control.ts`
- `panel/src/client/App.tsx`
- `panel/src/client/styles.css`

### New Files Or Folders Likely Needed
- `runtime-motd-helper/`
- `panel/src/server/motd.ts`
- `panel/src/client/motd-editor.tsx` or similar component file if extraction is worthwhile
- `panel-data/settings/motd.json` or similar if structured state persistence is needed
- this plan may be complemented by a short handoff file if the coordinator wants one

## Agent Delegation Overview
Use one coordinator and four scoped worker agents.

If the future Codex session has explicit sub-agent tooling, create separate agents. If it does not, emulate the same structure with isolated work phases and tightly scoped file reads.

### Agent Roles
1. Coordinator Agent
2. Runtime Helper Agent
3. Backend API Agent
4. UI/UX Agent
5. Review/Test Agent

## Coordinator Agent Task Sheet

### Objective
Own sequencing, shared contracts, integration order, and merge readiness.

### Inputs
- `AGENTS.md`
- `docker-compose.yml`
- `panel/src/server/settings.ts`
- `panel/src/client/App.tsx`
- this `motd_plan.md`

### Tasks
- Restate the shared contract in a concise handoff note if needed.
- Decide exact ownership boundaries so workers do not collide.
- Ensure the helper is created in a new location and not in `panel-mod/`.
- Sequence work so runtime helper and backend can start in parallel after the contract is fixed.
- Keep a short handoff log with changed files, API decisions, and unresolved risks.
- Integrate worker outputs and resolve interface mismatches.

### Deliverables
- a concise handoff note such as `agent-handoff/motd-contract.md` if useful
- merge order
- integration notes

### Success Criteria
- all worker outputs align to one contract
- no duplicated or conflicting edits remain
- the final branch is validation-ready

## Runtime Helper Agent Task Sheet

### Objective
Create a small NeoForge helper that enables live MOTD changes on `Minecraft 1.21.1`.

### Inputs
- this plan
- coordinator contract
- local Java 21 / Gradle toolchain
- runtime APIs available for NeoForge `21.1.220`

### Required Behavior
- accept a narrow local-only request from the panel backend
- update the in-memory MOTD of the running server
- force cached server status to refresh or invalidate it so the next ping sees the new MOTD
- log failures clearly
- return machine-readable success/failure information

### Scope Boundaries
- only MOTD functionality
- no general control-plane expansion
- no reuse of `panel-mod/`

### Recommended Deliverables
- new helper module under `runtime-motd-helper/`
- build files and source
- minimal API contract document
- example request and response payloads
- verification note describing how a live server-list ping update was confirmed

### Technical Notes
- The helper should be usable by this specific server only.
- Prefer a narrow localhost-only control surface.
- Keep auth/simple secret handling scoped and explicit if a socket or HTTP endpoint is used.
- Keep the helper robust if the panel is offline.

### Handoff Must Include
- exact backend call format
- exact success/failure response shape
- any port, filesystem, or permission assumptions
- runtime caveats or known limits

## Backend API Agent Task Sheet

### Objective
Make MOTD persistence reliable and connect the panel to the new runtime helper.

### Inputs
- this plan
- `docker-compose.yml`
- `panel/src/server/settings.ts`
- `panel/src/server/app.ts`
- any runtime helper contract from the Runtime Helper Agent

### Required Changes
- remove split ownership so Docker no longer overwrites panel-saved MOTD
- stop treating MOTD as a generic settings string
- add dedicated parsing/serialization logic for `MotdDocument` and `SerializedMotd`
- persist serialized MOTD into `data/server.properties`
- persist structured editor state if needed for lossless round-tripping
- call the runtime helper for live apply when the server is running
- return accurate `ApplyResult` state to the UI

### Suggested Backend Behavior
- If server is offline:
  - persist the change
  - return `persisted-only`
- If server is running and helper apply succeeds:
  - persist the change
  - return `live-and-persisted`
- If server is running and helper apply fails:
  - still persist the change
  - return `live-apply-failed`

### Scope Boundaries
- avoid broad unrelated settings refactors unless required to avoid regressions
- do not silently pretend MOTD is live when only persistence succeeded
- do not silently normalize unsupported raw input without surfacing it

### Deliverables
- backend API changes
- parser and serializer implementation
- settings payload updates for the MOTD editor
- fallback behavior documentation

### Handoff Must Include
- exact request/response shapes for the UI
- persistence file paths
- edge cases and normalization rules

## UI/UX Agent Task Sheet

### Objective
Replace the current plain MOTD input with a dedicated editor in the `Settings` route.

### Inputs
- this plan
- backend request/response contract
- `panel/src/client/App.tsx`
- `panel/src/client/styles.css`

### Required Behavior
- visual builder is the default tab
- raw-code tab is available for advanced edits
- support two lines
- support only standard legacy colors and styles
- show a server-list style preview
- builder becomes read-only while raw mode is being edited
- parseable raw edits keep preview in sync
- non-roundtrippable raw edits show a warning and keep builder locked
- surface backend apply state accurately

### UX Requirements
- no false “saved live” message
- clear distinction between:
  - live applied
  - persisted only
  - live apply failed
- clear raw-mode notice when the visual builder is locked
- usable on desktop and mobile

### Scope Boundaries
- no hex color support
- no whole-page redesign
- do not let the visual builder mutate raw-mode edits while raw mode is active

### Deliverables
- custom MOTD editor UI
- supporting styles
- client-side state and validation logic
- preview implementation

### Handoff Must Include
- component entry points
- new client-side types
- any UX assumptions needing review

## Review/Test Agent Task Sheet

### Objective
Review the integrated work for correctness, regressions, and missing cases.

### Inputs
- merged implementation
- this plan
- helper API contract
- backend/UI payload shapes

### Review Focus
- persistence regressions
- live-update truthfulness
- raw-mode lock behavior
- round-trip stability
- noisy failure modes

### Minimum Validation
- `docker compose config`
- panel `npm run check`
- panel `npm run build`
- helper build command
- live runtime smoke test against the running server

### Required Test Cases
1. Save a new MOTD, reload settings, confirm it does not revert.
2. Restart the server/container, confirm the MOTD persists.
3. Change MOTD while the server is running, confirm server-list ping updates without restart.
4. Validate two-line rendering.
5. Validate supported colors and styles survive round-trips.
6. Validate raw-mode editing locks the visual builder.
7. Validate unsupported raw input produces a warning instead of corrupting visual state.
8. Validate offline-server save returns `persisted-only`.
9. Validate helper failure returns `live-apply-failed`.

### Deliverables
- prioritized findings list
- validation summary
- pass/fail recommendation
- follow-up fixes if required

## Execution Sequence

### Phase 1: Coordinator Setup
- Read only the files needed to confirm current state.
- Restate or materialize the shared contract.
- Assign file ownership to avoid edit collisions.

### Phase 2: Parallel Work
Start in parallel:
- Runtime Helper Agent
- Backend API Agent

Once the backend contract is stable enough, start:
- UI/UX Agent

### Phase 3: Integration
- Coordinator merges runtime helper and backend
- Coordinator merges UI changes
- Coordinator resolves contract drift

### Phase 4: Review And Validation
- Review/Test Agent runs
- Fix findings
- Repeat validation until acceptance criteria pass

## Recommended Implementation Details

### 1. Compose/Persistence Fix
Primary goal: eliminate MOTD split ownership.

Recommended actions:
- remove `MOTD: "${MOTD}"` from `docker-compose.yml`
- decide whether `.env` and `.env.example` should:
  - keep `MOTD` as a documented legacy value, or
  - remove it entirely to avoid confusion
- document panel ownership clearly

### 2. Backend MOTD Module
Prefer extracting MOTD-specific logic into a dedicated module rather than overloading generic settings handling.

Suggested responsibilities:
- parse structured editor state
- serialize to legacy Minecraft MOTD string
- parse raw legacy MOTD string back to structured state when possible
- classify raw-mode parse result into `RawModeState`
- write `server.properties`
- optionally write structured state under `panel-data/settings/`

### 3. Runtime Helper Integration
The backend should not directly assume native management API support.

Suggested behavior:
- if runtime helper is available and server running: apply live
- if helper unavailable but persistence succeeds: do not lie, return `persisted-only` or `live-apply-failed`
- keep logs concise and machine-actionable

### 4. UI Integration
Do not leave MOTD as a generic row in the settings grid if it causes awkward UI. It is acceptable to render MOTD as a dedicated custom card inside the `Settings` route while the rest of the settings stay generic.

Suggested UI sections:
- editor tabs
- builder toolbar
- line editor
- preview card
- status and warnings

## Validation Checklist

### Backend/Panel
- `docker compose config`
- `cd panel && npm run check`
- `cd panel && npm run build`

### Runtime Helper
- helper build succeeds
- helper can be packaged and loaded by the server

### Live Behavior
- edit MOTD and save while server is running
- confirm panel reports accurate apply state
- query or inspect client-visible server-list MOTD
- confirm no restart was required for live change

### Persistence Behavior
- reload panel settings
- restart the server
- optionally recreate the stack if needed
- confirm MOTD remains the newly saved value

### UX Behavior
- raw-code tab editing locks builder
- parseable raw edits sync preview
- unsupported raw edits show warning
- visual builder remains stable after reload

## Acceptance Criteria
The feature is done only when all of these are true:

1. The panel `Settings` route contains a dedicated MOTD editor.
2. The editor supports:
   - two lines
   - standard legacy colors
   - standard legacy styles
   - raw-code editing
   - preview
3. Raw-code editing makes the visual builder read-only.
4. MOTD changes do not revert after reload or restart.
5. On the running `1.21.1` NeoForge stack, MOTD changes can apply live without requiring a restart.
6. The UI reports truthful apply state.
7. The implementation does not reuse `panel-mod/`.
8. Validation passes.

## Risks And Mitigations

### Risk: Runtime Helper API Is Too Broad
Mitigation:
- keep it MOTD-only
- use a narrow local control path
- document its scope clearly

### Risk: Raw Mode Can Express Things The Visual Builder Cannot
Mitigation:
- classify as `non-roundtrippable`
- lock the builder
- show a warning instead of corrupting state

### Risk: Docker/Env Still Overrides MOTD
Mitigation:
- remove Compose MOTD ownership
- confirm persistence after restart and recreation

### Risk: Client Rendering Issues From Long MOTDs
Mitigation:
- add warnings
- validate both raw serialized length and rendered content heuristics
- do not block reasonable values without explanation

## Out Of Scope For This Iteration
- hex/RGB color support
- generalized runtime control helper features beyond MOTD
- redesign of the entire settings page
- migration of unrelated settings away from the current generic settings model unless required by the MOTD work

## Suggested Prompts For Future Agent Creation
These are optional. A future Codex session can adapt them.

### Coordinator Prompt
"Use `motd_plan.md` as the execution brief. Create scoped agents for runtime helper, backend, UI, and review. Keep contexts small, assign file ownership, integrate outputs, and drive validation to completion."

### Runtime Helper Prompt
"Read only the relevant sections of `motd_plan.md`. Implement a new NeoForge helper under a new folder, not `panel-mod/`, to apply MOTD changes live on Minecraft 1.21.1. Expose a narrow local control path, update in-memory MOTD, refresh server status visibility for pings, and document the backend call contract."

### Backend Prompt
"Read only the backend and contract sections of `motd_plan.md`. Remove MOTD split ownership from the stack, add dedicated MOTD parsing/serialization and persistence, integrate with the runtime helper, and return truthful apply states."

### UI Prompt
"Read only the UI and contract sections of `motd_plan.md`. Replace the generic MOTD input with a dedicated editor supporting visual builder, raw mode, two lines, standard legacy colors/styles, preview, and read-only builder behavior while raw code is being edited."

### Review Prompt
"Read only the validation and acceptance sections of `motd_plan.md`. Review the merged implementation for regressions, verify live apply and persistence behavior, and report prioritized findings."

## Final Instruction To The Future Codex Session
Treat this file as an implementation plan, not merely a discussion artifact. Execute the work end to end:

1. create the scoped sub-agents if tooling allows
2. otherwise emulate the same delegation manually with isolated work phases
3. implement the runtime helper, backend changes, and UI changes
4. validate the result
5. update documentation if the behavior or operator workflow changes
6. leave the repo in a coherent, test-validated state

Do not stop at planning. Carry the work through implementation and verification.
