---
title: workspace_provider
type: module
source_files:
  - src/workspace-provider-lifecycle.ts
  - src/host-compat.ts
  - src/index.ts
  - src/console-host/service.ts
  - src/ports.ts
  - cordis.patch.yml
  - tests/workspace-provider-lifecycle.test.ts
tags: [workspace-provider, cordis-loader, lifecycle, ui-workspace, plugin-mount]
---

## Overview

The `workspace_provider` module owns the **`uiWorkspace` provider election** for this plugin (package `dsh-git-worktree`). Exactly one provider of the Host's `uiWorkspace` service must be active at any time. This plugin's Managed Worktree UI is a *replacement* for the official `@deepseek-ai/dsh-client-ui-workspace` entry (the constant `OFFICIAL_WORKSPACE` at `src/workspace-provider-lifecycle.ts:11`); when it wins the election it must **disable the official entry** so two `uiWorkspace` providers never coexist, and when it loses (or is disabled) it must **restore** the official entry.

The election is implemented entirely with **Cordis Loader operations** (`entry.update({ disabled: ... })`) on the Host side, decided **once**, rather than a client-evaluated `disabled` expression. The long comment at `src/workspace-provider-lifecycle.ts:40-65` explains why: a previous conditional patch (`disabled: !!get('worktreeWorkspaceProvider') && ...`) evaluated the same expression at two unsynchronized moments — during this plugin's Host `apply` the plugin fiber was still `LOADING` (so Cordis' strict service read returned `undefined` and the election always failed → decorate fallback), while the Web renderer's later audit saw the plugin `ACTIVE` and evaluated the same expression to `true`, skipping the official entry. The result was **no `uiWorkspace` provider at all**, crashing the 0.2.x web boot (incidents 2026-10-17 18:11 and 20:25, 17 entries pending). The Host-side Loader election writes a plain deterministic boolean, so every later read (Host audit, serialized renderer tree, module events) is consistent.

The single public entry point is `mountWorkspaceProviderLifecycle` (`src/workspace-provider-lifecycle.ts:66`). It is called from the plugin's `apply` in `src/index.ts:358` with `hostWorkspaceClientFlavor()` and `{ enabled: config.enableWorkspaceProvider === true }`, and its returned `WorkspaceProviderLifecycleResult.officialWorkspaceActive` is forwarded into `WorktreeConsoleService` (`src/index.ts:398`, consumed at `src/console-host/service.ts:40-42` and surfaced in `sidebarTopology` at `src/console-host/service.ts:35`).

Takeover is **opt-in on legacy hosts** (`enableWorkspaceProvider` must be explicitly `true`; see `src/index.ts:313-318`) and **automatic on modern 0.2.x hosts** where the decorated registration structurally crashes the 0.2.x Browser's `renderSlot` (the flag stays advisory there). A `flavor === 'unsupported'` (see `src/host-compat.ts:5-25`) short-circuits to "official stays active".

## Key Components

### Constants & module augmentation

- **`Context.worktreeWorkspaceProvider: boolean`** — Cordis `declare module` augmentation at `src/workspace-provider-lifecycle.ts:5-9`. Exposes a service flag set by the lifecycle so other plugin code can detect ownership.
- **`OFFICIAL_WORKSPACE = '@deepseek-ai/dsh-client-ui-workspace'`** (`src/workspace-provider-lifecycle.ts:11`) — the official entry name this lifecycle disables/restores.
- **`UNLOADING: FiberState = 5`** (`src/workspace-provider-lifecycle.ts:12-13`) — Cordis exposes `FiberState` as a declaration-only `const enum`, not a JS export, so this literal re-defines the unloading state for the teardown guard.
- **`DEFAULT_OPERATION_TIMEOUT_MS = 10_000`** (`src/workspace-provider-lifecycle.ts:14-18`) — ceiling for a single Loader disable/restore operation; prevents a wedged official-fiber dispose from starving every Remote/tool/command mount.
- **`ownedDisables = new WeakSet<Entry>()`** (`src/workspace-provider-lifecycle.ts:26`) — cross-generation ownership bookkeeping. The `Entry` object is shared by every generation, so ownership of a disable we wrote is recorded there; a later generation must not mistake our own pending disable (which the restart may restore *after* the next activation) for a user/market decision.

### Types

- **`WorkspaceProviderLifecycleOptions`** (`src/workspace-provider-lifecycle.ts:28-32`) — tuning seam for tests. Single field `operationTimeoutMs?: number` (ceiling for one Loader disable/restore op in ms).
- **`WorkspaceProviderLifecycleResult`** (`src/workspace-provider-lifecycle.ts:34-38`) — outcome consumed by the Sidebar topology. Single field `officialWorkspaceActive: boolean` — `false` only when this plugin actually disabled the official `ui-workspace` entry (takeover).

### Function — `mountWorkspaceProviderLifecycle(ctx, flavor?, options?)`

`src/workspace-provider-lifecycle.ts:66-304`. The election driver. Signature: `async (ctx: Context, flavor: WorkspaceClientFlavor = hostWorkspaceClientFlavor(), options: WorkspaceProviderLifecycleOptions & { enabled?: boolean } = {}): Promise<WorkspaceProviderLifecycleResult>`.

Internal closures and locals (all defined inside the function body):

- **Opt-in gate** `src/workspace-provider-lifecycle.ts:81-84`: if `!options.enabled`, logs `Workspace takeover disabled …` and returns `{ officialWorkspaceActive: true }` without touching anything. This makes takeover a no-op by default on legacy hosts.
- **Unsupported gate** `src/workspace-provider-lifecycle.ts:85-88`: if `flavor === 'unsupported'`, warns and returns `{ officialWorkspaceActive: true }`.
- **`operationTimeoutMs`** `src/workspace-provider-lifecycle.ts:89` — `options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS`.
- **`loader = ctx.loader`** `src/workspace-provider-lifecycle.ts:90`.
- **`selfDisabled()`** `src/workspace-provider-lifecycle.ts:96-102` — reads `ctx.fiber.entry?.disabled`; returns `true` on thrown error. Guards against the market replaying its persisted disable list while this apply is still in flight (`src/workspace-provider-lifecycle.ts:91-95`).
- **`adopted: Set<string>`** `src/workspace-provider-lifecycle.ts:110` — entry ids THIS lifecycle disabled (the only ones it may restore).
- **`overridden: Set<string>`** `src/workspace-provider-lifecycle.ts:111` — official entries already disabled (plain truthy, not ours) when first seen; user/market decisions never touched.
- **`official()`** `src/workspace-provider-lifecycle.ts:112-125` — returns the current official `Entry[]` still subject to election. Skips entries whose `options.name !== OFFICIAL_WORKSPACE` or that are `overridden`; treats a plain truthy `disabled` (not a `__jsExpr` conditional, not already `adopted`, not in `ownedDisables`) as a user/market override and adds it to `overridden` (`src/workspace-provider-lifecycle.ts:115-121`).
- **`released` / `pending` / `inFlight`** `src/workspace-provider-lifecycle.ts:126-131` — `released` flips in teardown; `pending` serializes reconciles into a chain; `inFlight` holds entry ids with a Loader op still in flight (so at most one mutation per entry is alive).
- **`operate(entry, kind)`** `src/workspace-provider-lifecycle.ts:132-180` — performs one Loader disable/restore, ceiling-bounded:
  - disable: `entry.update({ disabled: true }, false, true).then(() => fiber?.await())` (`src/workspace-provider-lifecycle.ts:147-148`);
  - restore: `entry.update({ disabled: null }, false, true)` then `entry.init()` if the current fiber is null/dead, else `entry.refresh()` (`src/workspace-provider-lifecycle.ts:149-154`). The comment at `src/workspace-provider-lifecycle.ts:140-145` explains the Loader 1.0.6 adaptation (absorbed from upstream `e2c6c70`): `update()` disposes the fiber without awaiting and retains it on the entry, so a disable must `await` the old fiber and a restore must rebuild a dead generation.
  - A `setTimeout(operationTimeoutMs)` (unref'd) resolves early with a single warning if the op never settles (`src/workspace-provider-lifecycle.ts:163-170`); the real `operation.then` clears the timer and reports failure once (`src/workspace-provider-lifecycle.ts:171-179`).
- **`reconcile()`** `src/workspace-provider-lifecycle.ts:181-206` — appends to `pending`; bails if `released` or `selfDisabled()`; for each `official()` entry not `inFlight`, reads `entry.disabled` (guarded) and if not disabled calls `operate(entry, 'disable')`, then adopts it only when `entry.options.disabled === true` was synchronously committed (`src/workspace-provider-lifecycle.ts:193-202`). A wedged/failed op stays unowned and retries later.
- **`releaseMarker = ctx.provide('worktreeWorkspaceProvider', true)`** `src/workspace-provider-lifecycle.ts:207` — registered through this return value so Cordis 4.0.5 (which unloads effects concurrently, not LIFO) can withdraw the selection before restoring Workspace, including when the replacement apply fails (`src/workspace-provider-lifecycle.ts:260-263`).
- **Teardown `ctx.effect(() => async () => { … })`** `src/workspace-provider-lifecycle.ts:208-259` — sets `released = true`, `await releaseMarker()` (`src/workspace-provider-lifecycle.ts:209-212`), defines `withdraw()` (`src/workspace-provider-lifecycle.ts:217-222`) to drop `entry.fiber` and emit `internal/plugin`, handles failed-activation vs restart distinction (`src/workspace-provider-lifecycle.ts:223-231`), skips root/include teardown (`src/workspace-provider-lifecycle.ts:110`), and on dispose restores each `adopted` official entry via `operate(entry, 'restore')` after `await pending.catch(() => {})` (`src/workspace-provider-lifecycle.ts:234-245`). A deferred `settle()` (`src/workspace-provider-lifecycle.ts:251-258`) drops the failed fiber only once the unload has left `UNLOADING`.
- **`ctx.on('internal/status', …)`** `src/workspace-provider-lifecycle.ts:267-271` — re-runs `reconcile()` when this fiber's status changes and not yet released (re-enters on every Loader event, e.g. an Include adding the official row after activation).
- **`ctx.on('internal/plugin', …)`** `src/workspace-provider-lifecycle.ts:272-276` — re-runs `reconcile()` when a *different* official entry starts (external re-enable of a disabled official entry).
- **First-pass `await reconcile()`** `src/workspace-provider-lifecycle.ts:281` — settles before activation returns so the Sidebar topology reports a truthful outcome.
- **Outcome reporting** `src/workspace-provider-lifecycle.ts:289-303` — recomputes `takeover` from `official()`: only claims takeover when every owned official entry is actually disabled (a committed plain boolean, so the read cannot race a service-activation state). If any is not disabled, warns and falls back to decorated coexistence. Returns `{ officialWorkspaceActive: !takeover }`.

### Function — `hostWorkspaceClientFlavor()` (dependency, `src/host-compat.ts`)

- **`WorkspaceClientFlavor`** type `src/host-compat.ts:5` — `'legacy' | 'alpha' | 'next' | 'modern' | 'unsupported'`.
- **`workspaceClientFlavorForAgentVersion(version)`** `src/host-compat.ts:7-25` — maps an agent version string to a flavor (e.g. `0.2.0-rc.2`/`0.2.1-rc.4` → `modern`; unverified 0.1.x/0.3+ → `unsupported`). `isModernGeneration` (`src/host-compat.ts:27-30`) gates `0.2.*`.
- **`hostWorkspaceClientFlavor()`** `src/host-compat.ts:79-81` — runs `workspaceFlavorDiagnostics()` against `[process.argv[1], process.cwd(), import.meta.url]` and returns `.flavor`.

## Architecture

The lifecycle is a Host-side Controller that reconciles two `uiWorkspace` providers through Cordis Loader events. One election pass = one `reconcile()` run; passes are serialized through `pending` and re-enter on `internal/status` / `internal/plugin` events.

```text
┌───────────────────────────────────────────────────────────────────┐
│ plugin.apply  (src/index.ts:363)                                   │
│   mountWorkspaceProviderLifecycle(ctx, hostWorkspaceClientFlavor(),│
│                                   {enabled: enableWorkspaceProvider})│
└───────────────┬───────────────────────────────────────────────────┘
                │ returns WorkspaceProviderLifecycleResult
                ▼
┌──────────────────────────────────────────────────────────────────┐
│ mountWorkspaceProviderLifecycle (workspace-provider-lifecycle.ts)  │
│  gates: !enabled ─► officialWorkspaceActive=true (no-op)           │
│         flavor==unsupported ─► officialWorkspaceActive=true        │
│  official() ──► Entry[] of @deepseek-ai/dsh-client-ui-workspace    │
│  reconcile() ──serialize──► pending ──► operate(entry,'disable')    │
│  adopted / ownedDisables WeakSet  (cross-generation ownership)     │
│  ctx.provide('worktreeWorkspaceProvider',true) = releaseMarker     │
└───────┬───────────────────────┬───────────────────────┬───────────┘
        │                       │                       │
        ▼                       ▼                       ▼
┌──────────────┐   ctx.on('internal/status')   ctx.on('internal/plugin')
│ Cordis Loader│   ──► reconcile() re-run ──►  ──► reconcile() re-run
│ entry.update │      (this fiber changed)       (another official
│ {disabled:..}│                                 entry started)
└───────┬──────┘
        │ dispose / ctx.effect teardown (line 208-259)
        ▼
┌──────────────────────────────────────────────────────────────────┐
│ restore: operate(entry,'restore') for each adopted + still-disabled │
│ → releaseMarker(); withdraw(); official Workspace lives again       │
└───────────────┬───────────────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────────────┐
│ WorktreeConsoleService (src/console-host/service.ts:40-42,65)      │
│   officialWorkspaceActive ──► sidebarTopology().officialWorkspaceActive
└──────────────────────────────────────────────────────────────────┘
```

Component inventory (≥3): the **election controller** (`mountWorkspaceProviderLifecycle`), the **Cordis Loader** (`ctx.loader`, `entry.update`/`init`/`refresh`/`await`) as the mutation substrate, the **ownership bookkeeping** (`adopted` set + `ownedDisables` WeakSet + `overridden` set), the **event re-entry hooks** (`internal/status`, `internal/plugin`), and the **consumer** (`WorktreeConsoleService.sidebarTopology`).

## Data Flow

1. **Boot / activation.** `src/index.ts:363` calls `mountWorkspaceProviderLifecycle(ctx, hostWorkspaceClientFlavor(), { enabled: config.enableWorkspaceProvider === true })`. `hostWorkspaceClientFlavor()` (`src/host-compat.ts:79`) resolves the Host generation; `enableWorkspaceProvider` (`src/index.ts:313-318`) is the opt-in boolean defaulting to `false`.
2. **Gates.** `!enabled` → return `{ officialWorkspaceActive: true }` (`src/workspace-provider-lifecycle.ts:81-84`); `flavor === 'unsupported'` → same (`src/workspace-provider-lifecycle.ts:85-88`).
3. **First reconcile.** `await reconcile()` (`src/workspace-provider-lifecycle.ts:112`) runs `official()` (`src/workspace-provider-lifecycle.ts:132`) to enumerate live official entries, then for each not-yet-disabled entry calls `operate(entry, 'disable')` (`src/workspace-provider-lifecycle.ts:110`). On a committed `entry.options.disabled === true` it adds the id to `adopted` and `ownedDisables` (`src/workspace-provider-lifecycle.ts:198-201`).
4. **Outcome.** Recomputes `takeover` from `official()` (`src/workspace-provider-lifecycle.ts:289-299`); warns and falls back to decorated coexistence if any owned entry is not disabled. Returns `{ officialWorkspaceActive: !takeover }` (`src/workspace-provider-lifecycle.ts:303`).
5. **Propagation to consumer.** `src/index.ts:405` passes `providerLifecycle.officialWorkspaceActive` into `new WorktreeConsoleService(ctx, …, join(stateDir,'sidebar-diag.ndjson'), providerLifecycle.officialWorkspaceActive)`. `WorktreeConsoleService` stores it as `officialWorkspaceActive` (`src/console-host/service.ts:40-42`) and merges it into `sidebarTopology` response as `officialWorkspaceActive` (`src/console-host/service.ts:35`).
6. **Re-entry.** While live, `internal/status` on this fiber (`src/workspace-provider-lifecycle.ts:267-271`) and `internal/plugin` on another official entry (`src/workspace-provider-lifecycle.ts:272-276`) re-run `reconcile()` so a delayed Include (`tests/workspace-provider-lifecycle.test.ts:189-199`) or external re-enable is reconciled without persisting flags (`tests/workspace-provider-lifecycle.test.ts:189-205`).
7. **Teardown / restart.** On dispose, `ctx.effect`'s teardown (`src/workspace-provider-lifecycle.ts:208-259`) withdraws `releaseMarker`, and after `await pending.catch(()=>{})` restores each `adopted` entry still disabled via `operate(entry, 'restore')` (`src/workspace-provider-lifecycle.ts:244`), re-enabling the official Workspace. Failed-activation vs clean-restart is distinguished by `ctx.fiber.uid === null` (`src/workspace-provider-lifecycle.ts:110`) and the `settle()` guard (`src/workspace-provider-lifecycle.ts:251-258`) so the fiber reference is only dropped once the unload leaves `UNLOADING`.

## Connections

- **[[index]]** — the plugin `apply` (`src/index.ts:358`) is the sole caller of `mountWorkspaceProviderLifecycle` (`src/index.ts:363`) and forwards `officialWorkspaceActive` into `WorktreeConsoleService` (`src/index.ts:398`).
- **[[host_compat]]** — supplies `hostWorkspaceClientFlavor()` (`src/host-compat.ts:79`) and the `WorkspaceClientFlavor` type (`src/host-compat.ts:5`); the `unsupported`/`modern` branches gate takeover.
- **[[console_host_service]]** — `WorktreeConsoleService` consumes `officialWorkspaceActive` (`src/console-host/service.ts:40-42`) and surfaces it in `sidebarTopology` (`src/console-host/service.ts:35`); `workspaceClientFlavor` is also recomputed there (`src/console-host/service.ts:65`).
- **[[ports]]** — `liveConfigValue`/`LiveValue` (`src/ports.ts:554-565`) are how the volatile `enableWorkspaceProvider`/related config arrives as live references; see `LocalAdaptationConfig.enableWorkspaceProvider` (`src/index.ts:329`).
- **Cordis Loader / cordis-plugin-loader** (external dependency) — the mutation substrate: `ctx.loader`, `entry.update({ disabled })` (`src/workspace-provider-lifecycle.ts:147-150`), `entry.init()`/`refresh()` (`src/workspace-provider-lifecycle.ts:152-153`), `entry.fiber.await()` (`src/workspace-provider-lifecycle.ts:148`), and events `internal/status` / `internal/plugin` (`src/workspace-provider-lifecycle.ts:90-99`).
- **cordis.patch.yml** — the published patch (`cordis.patch.yml:12-14`) only inserts the `dsh-git-worktree` entry and deliberately contains **no** `disabled` expression for ui-workspace; the election now lives entirely in this Host-side lifecycle (see `tests/workspace-provider-lifecycle.test.ts:103-107` asserting the official entry is no longer patched).

## Known Issues

- **Loader 1.0.6 fiber retention (Windows timer starvation, 2026-10-24).** `update()` disposes a fiber without awaiting and *retains* it on the entry, while `refresh()` treats any surviving reference as running and only `init()` replaces the dead generation (`src/workspace-provider-lifecycle.ts:140-145`). On Windows a failed activation's `fiber.await()` spins on the retained transition (`while (inertia)` re-awaits an already-settled promise and starves timers). The teardown therefore waits for `ctx.fiber.uid === null` / state to leave `UNLOADING` before `withdraw()` (`src/workspace-provider-lifecycle.ts:223-231`, `251-258`). Covered by `tests/workspace-provider-lifecycle.test.ts:239-251` (failed replacement activation restores official provider) and `:307-309` (deferred official disable lands after activation).
- **Cordis 4.0.5 concurrent effect unload (not LIFO).** The marker is registered through `releaseMarker` (`src/workspace-provider-lifecycle.ts:207`) so it can be withdrawn *before* Workspace restore, including when the replacement apply fails (`src/workspace-provider-lifecycle.ts:260-263`); otherwise the selection could be cleared after the restore and re-enable an unexpected provider.
- **Wedged official disable must never block plugin activation.** A `setTimeout` ceiling (`DEFAULT_OPERATION_TIMEOUT_MS = 10_000`, `src/workspace-provider-lifecycle.ts:14-18`) resolves the election early with one warning; the entry stays guarded and the next Loader event retries (`src/workspace-provider-lifecycle.ts:163-170`). Regression-guarded by `tests/workspace-provider-lifecycle.test.ts:287-297` (`wedge: 'never'`) and `:299-309` (`wedge: 'deferred'`).
- **Cross-generation ownership vs restart restore.** Because the `Entry` object is shared across generations and a restart may restore our own `disabled: true` *after* the next activation, ownership is recorded in the `ownedDisables` WeakSet (`src/workspace-provider-lifecycle.ts:19-26`) so a later generation re-elects (disables again) instead of mistaking our pending disable for a user/market choice.
- **Two providers must never coexist at boot.** With the official entry disabled *before* the page loads, the renderer never observes two `uiWorkspace` providers from a slow reconciliation (`src/workspace-provider-lifecycle.ts:62-64`). A premature takeover claim would make the Web client replay the official apply and crash with `service "uiWorkspace" has been registered` (`src/workspace-provider-lifecycle.ts:282-287`); the outcome read uses a committed plain boolean precisely to avoid that race.
- **Takeover is opt-in on legacy, mandatory on modern (advisory only).** Disabling the official entry drops its client package from the Host client graph, and every package importing it loses its bundle (`src/workspace-provider-lifecycle.ts:82-84`); on 0.1.x this once broke new-conversation creation, so `enableWorkspaceProvider` (`src/index.ts:313-318`) gates it there, while on 0.2.x the takeover is required to obtain the Browser's child-slot seat (`src/workspace-provider-lifecycle.ts:71-77`).
