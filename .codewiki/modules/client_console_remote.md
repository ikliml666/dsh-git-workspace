---
title: client_console_remote
type: module
source_files:
  - src/console-remote/remote.ts
  - src/console-remote/descriptors.ts
  - src/console-remote/schemas.ts
  - src/console-remote/typert.ts
  - src/client/console-remote/adapter.ts
  - src/client/console-remote/index.ts
  - src/console-contract.ts
  - src/i18n/transport-messages.ts
  - src/i18n/core.ts
  - src/client/i18n.tsx
  - src/console-host/service.ts
  - src/client/index.tsx
  - src/client/settings-card/index.ts
  - tests/console-remote.test.ts
  - tests/client-console-remote-routing.test.ts
tags: [client, remote, typert, console, i18n, adapter, contract]
---

## Overview

The `client_console_remote` module is the client (browser) side of the Worktree Console's remote-RPC surface. It owns the shared strict-contract descriptor set, the client cordis fiber that mounts a Typert Remote namespace, and the adapter that injects the caller's `locale` context, enforces client-side call timeouts, and re-validates every Host payload against the same Zod schemas the Host used.

The Host counterpart lives in `src/console-host/`; the two sides share no code beyond the descriptor array `WORKTREE_CONSOLE_DESCRIPTORS` and the DTO types in `src/console-contract.ts`. The module has three layers:

1. **Contract declaration** — `src/console-remote/descriptors.ts` produces one frozen, strict `InvocationDescriptor[]` (`WORKTREE_CONSOLE_DESCRIPTORS`) consumed by both the Host (`typert.ts` → `TYPERT`) and the Client (`remote.ts` → `GitWorktreeRemote`).
2. **Client Remote namespace** — `src/client/console-remote/index.ts` is the cordis Client fiber entry (`apply`/`inject`); it `$mount`s the contribution, resolves the `remote.gitWorktree` proxy, and routes the Workspace-sidebar registration by the Host-pinned `workspaceClientFlavor` reported through `sidebarTopology`.
3. **Adapter seam** — `src/client/console-remote/adapter.ts` (`createWorktreeConsoleRemoteAdapter`) wraps the raw proxy so callers get a uniform `WorktreeConsoleAdapter` whose every method injects `locale`, races a timeout, and parses the result through the descriptor's strict codec.

## Key Components

### `src/console-remote/descriptors.ts` — shared strict descriptor set

- `PACKAGE = 'dsh-git-worktree'` (46|), `SERVICE = 'gitWorktree'` (47|), `AGENT_WIRE_TYPE = '@deepseek-ai/dsh-session/types#SessionId'` (48|): identity constants for descriptor IDs and the `agent` parameter wire type.
- `strictCodec(typeSymbol, schema)` (52–56|): builds a `TypertCodec` carrying both the legacy `schema` field (for older client adapters) and the DSH 0.2 canonical lazy `create()` field — both return the same frozen Zod instance.
- `agentParameter` (58–64|): the constant first parameter `agent`, with `wire: 'agentId'`, `source: 'lookup'`, `lookup: 'agent'`; the Gateway resolves the caller `Agent` from this before business code runs.
- `json(name, schema, typeSymbol, acceptsUndefined=false)` (66–74|): builds a JSON-body parameter descriptor; when `acceptsUndefined` is true it sets `acceptsUndefined: true` so optional trailing args (e.g. `locale`) may be omitted on the wire.
- `descriptor(method, parameters, resultSchema, resultType, withAgent=true)` (76–92|): assembles an `InvocationDescriptor`:
  - `id` = `${PACKAGE}#${SERVICE}/${method}` (84|);
  - `namespace`/`service` = `SERVICE` (85–86|);
  - `invocation.kind = 'direct'` (88|);
  - prepends `agentParameter` and appends `json('locale', optionalLanguageSchema, 'string | undefined', true)` (89|) unless `withAgent=false` (used by `sidebarTopology` at 95| and `clientBootReport` at 96| which carry no caller identity);
  - `result` codec is `strictCodec(\`${PACKAGE}/console-contract#${resultType}\`, resultSchema)` (90|).
- `WORKTREE_CONSOLE_DESCRIPTORS` (94–246|): `Object.freeze` array of 39 descriptors covering topology, current/list, creation/preflight, review/preview/checkpoint/resume/rollback/finalize, retention/cleanup/iteration, git overview/graph/branch/tag/prune, and abandoned recovery. The two `withAgent=false` exceptions are `sidebarTopology` (95|) and `clientBootReport` (96|).
- `WORKTREE_CONSOLE_REMOTE` (248–251|): `Object.freeze` `TypertRemoteContribution` with `package: PACKAGE` and `descriptors: WORKTREE_CONSOLE_DESCRIPTORS`.

### `src/console-remote/remote.ts` — client-side Remote map & re-exports

- `GitWorktreeRemote = TypertRemoteNamespace<'gitWorktree'>` (31|): the client typing of the mounted namespace.
- `export default WORKTREE_CONSOLE_REMOTE` (33|) and re-export of `WORKTREE_CONSOLE_DESCRIPTORS`, `WORKTREE_CONSOLE_REMOTE` (34|).
- `declare module '@deepseek-ai/dsh-typert-protocol'` augments:
  - `TypertRemoteMap` (36–77|): every method signature (e.g. `'gitWorktree/current'`, `'gitWorktree/list'`, `'gitWorktree/checkpoint'`, `'gitWorktree/rollbackPreview'`) returning `Promise<RemoteResult<WorktreeConsoleOutcome<...>>>` with a trailing optional `locale?: Language`;
  - `TypertRemoteNamespaceMap` (79–81|): binds `gitWorktree` to `TypertRemoteNamespace<'gitWorktree'>`.

### `src/console-remote/schemas.ts` — Zod validation boundary

All schemas are built with `strict({...})` (29|) so unknown keys are rejected; this is the single JSON boundary shared across Host and Client. Notable pieces:

- String sanitizers: `sessionIdSchema` (31|), `checkoutIdSchema` (32|), `reviewIdSchema` (33|), `commitMessageSchema` (34| — uses `isValidCommitMessage`), `branchNameSchema` (45–50|), `previewIdSchema` (42|), `generationSchema` (43| — 64-hex), `requestIdSchema` (44|).
- `oidSchema` (37–41|): `'unversioned' | 'unborn' | <40/64-hex git oid>`.
- `capabilitiesSchema` (84–106|): note `returnToLocal: z.boolean().default(false)` (105|) — intentionally tolerant of an older Host that predates this additive capability bit, so a stale Host cannot collapse the whole `current` payload to "unavailable". Unknown keys are still rejected (108–111| region enforces strictness).
- `targetSummarySchema` (122–155|) / `targetDetailsSchema` (203–209|): the primary payload shape and its identity-validated detail superset.
- `outcomeSchema<T>(value)` (227–232|): discriminated union `{ ok: true, value } | { ok: false, error }` around any `value` schema; `error` is `consoleErrorSchema` (216–225|) which forbids a `continuation` unless `code === 'apply_conflict'`.
- `previewRecoveryProofSchema` (343–360|), `previewRecoveryPreflightResponseSchema` (374–376|), git/tag/abandoned response schemas (391–463|).

### `src/console-remote/typert.ts` — Host contribution discovered by the Loader

- `TYPERT` (5–15|): frozen `TypertContribution` with `package: 'dsh-git-worktree'`, `face: 'host'`. `schemas`, `model.services/events/objects` are all empty; `invocations` (14|) points at `WORKTREE_CONSOLE_DESCRIPTORS`. This manual contribution is discovered by the official Typert Loader through the package's `./typert` export.

### `src/client/console-remote/adapter.ts` — client adapter & context injection

- `transport<T>(message)` (31–33|): produces `{ ok:false, error:{ code:'transport_unavailable', message } }`.
- `malformed<T>(method, locale)` (35–37|): produces `{ ok:false, error:{ code:'malformed_response', ... } }` using the `transportMessages.malformed` catalog (src/i18n/transport-messages.ts:4–7).
- `messageOf(value)` (39–43|): normalizes Error / `{message}` / primitive to a string.
- `isCodecRejection(value)` (45–48|): detects Zod/transport codec rejection by substring (`rejected "` or `返回了不符合 strict contract`).
- `FAST_TIMEOUT_MS = 30_000` (56|), `SLOW_TIMEOUT_MS = 180_000` (57|): the Web RPC carrier has no timeout, so the adapter races every call with a timer. `FAST_METHODS` (60–65|) lists the methods kept at 30s: `sidebarTopology`, `current`, `inspect`, `previewRecoveryPreflight`, `gitOverview`, `gitGraph`, `listAbandoned`.
- `timeoutOutcome<T>(method, locale, timeoutMs)` (67–78|): builds the `timeout` error with the `transportMessages.invokeTimeout` template (src/i18n/transport-messages.ts:16–19).
- `createWorktreeConsoleRemoteAdapter(remote, getLanguage=()=>'zh')` (80–156|): returns a `WorktreeConsoleAdapter`. Internal `invoke<T>(method, call)` (83–112|):
  - resolves `locale = normalizeLanguage(getLanguage())` (84|) — **this is the locale context injection point**;
  - picks timeout from `FAST_METHODS` (85|);
  - `Promise.race` between `call(locale)` and a `setTimeout` rejecting with `{timedOut:true}` (89–94|);
  - on throw: clears timer, returns `malformed` if codec rejection else `transport` (95–98|);
  - on timeout: returns `timeoutOutcome` (100–102|);
  - validates carrier shape (103|) and carrier error (104|);
  - looks up the descriptor, requires `result.mode === 'strict'` (105–106|), then `descriptor.result.create().parse(carrier.value)` (108|) — re-validating the Host output against the same schema the Host used; any failure → `malformed` (109–111|).
  - The returned object (114–155|) maps every adapter method to a closure that injects `locale` (and positional args) into the matching `remote.<method>`. E.g. `current: request => invoke('current', locale => remote.current(request.sessionId, locale))` (116|); `resumeRevision` conditionally passes `conflictContinuation` as `undefined` when absent (130–132|); `initializeProject` maps to `remote.initProject` (121|).

### `src/client/console-remote/index.ts` — client fiber entry & flavor routing

- `inject` (45–49|): declared services — `officialWorkspaceInject` minus `remote.directoryPicker` and `remoteAccess`, plus `slots`, `configForms`. The two filtered names are omitted deliberately to avoid deadlocking the web boot (the directory picker and `remoteAccess` wait on `uiWorkspace` / a 0.2.1 host service). See the long comment at 18–44|.
- `ConsoleClientContext` (51–53|): `Context` extended with `remote: ClientRemote & { gitWorktree: GitWorktreeRemote }`.
- `declare module '@deepseek-ai/cordis'` (55–59|): registers `worktreeConsole: WorktreeConsoleAdapter` on the Context.
- `apply(ctx)` (62–206|):
  - `ctx.remote.$mount(contribution)` (64|) and register dispose via `ctx.effect` (66|);
  - resolves `remote = ctx.get('remote.gitWorktree')` (67|); throws `mountFailed` if undefined (70|);
  - `getLanguage = () => readClientLanguage(ctx.get('locale'))` (69|) — read at invocation time, not module load;
  - `adapter = createWorktreeConsoleRemoteAdapter(remote, getLanguage)` (71|), `ctx.provide('worktreeConsole', adapter)` (72|);
  - `mountSettingsCard` (73|);
  - `mountTools` (75–81|): mounts conversation-dependent ToolViews under the resolved `uiWorkspace` fiber;
  - `reportBoot(branch, registered, detail?)` (86–102|): best-effort `remote.clientBootReport(...)` diagnostics breadcrumb — the trailing `undefined` locale must still be passed because the Remote proxy enforces descriptor arity positionally (88–95|);
  - `topology = await adapter.sidebarTopology()` (104|) then branch on `flavor = topology.value.workspaceClientFlavor` (110|):
    - `legacy` (112–121|): requires `sessions.open`, else throws; registers `registerManagedWorkspaceSidebar`;
    - `modern` (122–161|): if `officialWorkspaceActive` decorates (`registerDecoratedWorkspaceSidebar`) else manages (`registerManagedWorkspaceSidebar` with `applyOfficialWorkspace`);
    - `alpha` / `next` (162–200|): same decorate-vs-manage split using `alphaWorkspaceInject`/`applyAlphaWorkspace` or `nextWorkspaceInject`/`applyNextWorkspace`;
    - else `unsupported` (201–205|): leaves official provider live, just mounts tools.

## Architecture

```text
┌──────────────────────────────┐   $mount    ┌──────────────────────────┐
│ client/console-remote/index  │ ───────────►│ WORKTREE_CONSOLE_REMOTE  │
│ (apply, flavor routing)      │             │ (descriptors.ts)         │
└──────────────┬───────────────┘             └────────────┬─────────────┘
               │ provides worktreeConsole                  │ invocations
               ▼                                           ▼
┌──────────────────────────────┐             ┌──────────────────────────┐
│  createWorktreeConsole-      │ ◄── locale  │  GitWorktreeRemote proxy │
│  RemoteAdapter (adapter.ts)  │     ctx+    │  (remote.ts / gateway)   │
└──────────────┬───────────────┘             └────────────┬─────────────┘
               │ parse(strict codec)                       │ RPC over /api
               ▼                                           ▼
┌──────────────────────────────┐                 ┌──────────────────────────┐
│  WorktreeConsoleAdapter      │                 │  Host WorktreeConsole-   │
│  callers (sidebar, tools)    │                 │  Service (console-host)  │
└──────────────────────────────┘                 └──────────────────────────┘

Strict contract fans out:
  descriptors.ts ──► typert.ts        (TYPERT, face:'host')
                └────► remote.ts      (GitWorktreeRemote, client map)
Both sides validate payloads through schemas.ts (Zod strict).
```

## Data Flow

1. **Boot / mount.** Client fiber `apply` (index.ts:62) calls `ctx.remote.$mount(contribution)` (index.ts:64) with `WORKTREE_CONSOLE_REMOTE`. The Gateway registers the 39 strict `invocations` (`descriptors.ts:248`). The `remote.gitWorktree` proxy is resolved (`index.ts:67`).
2. **Topology probe.** First call `adapter.sidebarTopology()` (index.ts:104 → adapter.ts:115) hits `remote.sidebarTopology(locale)`. The Host `sidebarTopology` (`console-host/service.ts:54`) attaches `workspaceClientFlavor` + `officialWorkspaceActive` (`console-host/service.ts:65`) and the Client routes the Browser branch from that pinned flavor (index.ts:67–205).
3. **Per-call dispatch.** A UI caller invokes an adapter method, e.g. `adapter.current({sessionId})` (adapter.ts:116). `invoke` (adapter.ts:83):
   - injects `locale = normalizeLanguage(getLanguage())` (adapter.ts:84) — `getLanguage` reads `ctx.get('locale')` live (index.ts:69);
   - races the call with `FAST_TIMEOUT_MS`/`SLOW_TIMEOUT_MS` (adapter.ts:85,89);
   - `remote.current(sessionId, locale)` is encoded by the Gateway: `agentId` is resolved from the `agentParameter` lookup (descriptors.ts:58) before the Host business method runs (`console-host/service.ts:76`);
   - on resolve, the carrier is shape-checked and, if `ok`, `descriptor.result.create().parse(carrier.value)` re-validates against `currentResponseSchema` (schemas.ts:234) — the same schema the Host used (adapter.ts:105).
4. **Error normalization.** Any carrier error becomes `transport_unavailable` (adapter.ts:32); a codec rejection (Host returned a shape violating the strict contract) becomes `malformed_response` (adapter.ts:36,109). The Client never forwards a raw Host `code` to React directly; instead `WorktreeConsoleAdapter` consumers read `WorktreeConsoleOutcome<T>` and translate via `worktreeConsoleErrorMeta` (`console-contract.ts:740`).
5. **Diagnostics.** `reportBoot` (index.ts:86) fires `clientBootReport` with `elapsedMountMs`/`elapsedTopologyMs` (index.ts:94) into the Host ndjson sink (`console-host/service.ts:70`) — best effort, never blocking boot.

## Connections

- [[console-host]] — the Host counterpart: `WorktreeConsoleService` (`src/console-host/service.ts`) implements every `gitWorktree/*` method; the contract is symmetric via `WORKTREE_CONSOLE_DESCRIPTORS`.
- [[console-contract]] — `src/console-contract.ts` defines all DTOs (`WorktreeConsoleOutcome`, `WorktreeConsoleAdapter`, error codes, `worktreeConsoleErrorMeta`) shared by both sides.
- [[client]] — `src/client/` owns the Browser fiber (`index.tsx`, `workspace-sidebar/`, `target-console/`, `settings-card/`) that consumes the `worktreeConsole` adapter.
- [[i18n]] — `normalizeLanguage`, `createTranslator`, `readClientLanguage`, `transportMessages` implement the per-call locale injection.
- [[host-compat]] — `hostWorkspaceClientFlavor()` feeds the `workspaceClientFlavor` the Client routes on.

## Known Issues

- **`FAST_METHODS` (adapter.ts:60–65) deliberately excludes `list`, `preflight`, `preflightCreate`.** The comment at adapter.ts:58–59 explains those three do a full recompute (20+ `git` spawns for many records) and are therefore kept on the `SLOW_TIMEOUT_MS` (180s) track, while the remaining fast-path methods stay at `FAST_TIMEOUT_MS` (30s). The intent matches the set, but the per-method split is hardcoded: adding a new heavy method requires a manual edit here, or it silently inherits the 180s budget.
- **Locale arity is positional and fragile.** The Remote proxy enforces descriptor arity positionally; `reportBoot` must pass a trailing `undefined` for `locale` even when unused (`index.ts:86–95`), otherwise the call mis-aligns. Any new descriptor that drops/adds a positional parameter must update every adapter closure in `adapter.ts:84–155` by hand.
- **`returnToLocal` capability is additive-only tolerant.** `schemas.ts:105` uses `.default(false)` rather than `optional()` so older Hosts lacking the bit don't collapse `current`. If a future capability is added as a *required* field, it will break backward compat (documented intent at `descriptors.ts:212` and `console-contract.ts` `WorktreeConsoleCapabilities`).
- **`remoteAccess` / `remote.directoryPicker` are filtered out of `inject`** (`index.ts:45–49`) to avoid a web-boot deadlock on hosts < 0.2.1 / rc.2. On a host that does require these, the managed branch must supply a stub via `officialContextProxy` (`registerManagedWorkspaceSidebar`); otherwise `apply` will fail to provide `uiWorkspace` and the sidebar never mounts.
- **No client-side retry on `timeout`.** A timed-out `invoke` returns `timeout` (adapter.ts:101) while the Host work keeps running (adapter.ts:83–112). Callers must decide to retry; the adapter does not single-flight or dedupe, which matters for `checkpoint`/`resumeRevision` where `requestId`/`conflictContinuation` exist to prevent double-application only on the Host side.

### `src/client/console-remote/index.ts`

- `inject` — `index.ts:45`–`49`. The Cordis dependency list: the official Workspace Client's `inject` array with `'remote.directoryPicker'` and `'remoteAccess'` **filtered out** (lazy-resolved to avoid web-boot deadlock — see `inject` comment `index.ts:18`–`44`), plus the explicitly declared `'slots'` and `'configForms'`. De-duplicated via `new Set`.
- `interface ConsoleClientContext extends Context` — `index.ts:51`–`53`. The plugin context shape: `remote: ClientRemote & { gitWorktree: GitWorktreeRemote }`.
- `declare module '@deepseek-ai/cordis'` — `index.ts:55`–`59`. Augments `Context` with `worktreeConsole: WorktreeConsoleAdapter`, the service this module provides.
- `apply(ctx)` — `index.ts:62`–`206`. The Cordis `apply` lifecycle. Sequence:
  1. `ctx.remote.$mount(contribution)` → `disposeRemote`, registered via `ctx.effect(...)` (`index.ts:66`–`66`).
  2. Resolve `ctx.get('remote.gitWorktree')` (`index.ts:67`); if `undefined` throw `mountFailed` (`index.ts:70`).
  3. `getLanguage = () => readClientLanguage(ctx.get('locale'))` (`index.ts:69`).
  4. `adapter = createWorktreeConsoleRemoteAdapter(remote, getLanguage)`; `ctx.provide('worktreeConsole', adapter)` (`index.ts:71`–`72`).
  5. `mountSettingsCard(ctx)` (`index.ts:73`).
  6. `mountTools(workspaceCtx)` — `index.ts:75`–`81`. Inside a child fiber that `inject`s `toolViewInject`, calls `applyToolViews(child, adapter)` to register the Worktree ToolViews (imported from `../index.js`).
  7. `reportBoot(branch, registered, detail?)` — `index.ts:86`–`102`. Best-effort telemetry via `remote.clientBootReport(...)` (trailing `locale` passed even when `undefined`, because the Remote proxy enforces descriptor arity positionally). Never throws.
  8. `topology = await adapter.sidebarTopology()` with `elapsedTopologyMs` timing (`index.ts:104`–`105`); on failure report `topology-failed` and throw `workspaceGenerationUnknown` (`index.ts:108`–`109`).
  9. Branch on `flavor = topology.value.workspaceClientFlavor` (`index.ts:110`):
     - `'legacy'` (`index.ts:112`–`121`): requires `sessions.open()`; registers a **managed** sidebar via `registerManagedWorkspaceSidebar(ctx, adapter)`; `mountTools(ctx)`.
     - `'modern'` (`index.ts:122`–`161`): if `officialWorkspaceActive === true` → **decorate** the running official Workspace (`registerDecoratedWorkspaceSidebar`); else → **managed** registration passing `applyOfficialWorkspace`. Both also `mountTools(child)`.
     - `'alpha' | 'next'` (`index.ts:162`–`200`): pick `[alphaWorkspaceInject, applyAlphaWorkspace]` or `[nextWorkspaceInject, applyNextWorkspace]`; same decorate-vs-managed split on `officialWorkspaceActive`.
     - else (`'unsupported'` / unknown) (`index.ts:201`–`205`): only `mountTools(ctx)`, leaving the official Browser untouched.
  - Each branch wraps `register*WorkspaceSidebar` in `ctx.inject(inject, child => {...})` and calls `reportBoot(flavor, true/false, ...)`, throwing on error so the boot reports `false` before re-throw (`index.ts:86`–`200`).
- `export { createWorktreeConsoleRemoteAdapter }` — `index.ts:16` (re-exported for consumers/tests).

### Shared contract & descriptors (referenced by this module)

- `WORKTREE_CONSOLE_DESCRIPTORS` — `src/console-remote/descriptors.ts:94`–`246`. Frozen `readonly InvocationDescriptor[]` of 38 methods; each carries a strict result codec and per-parameter strict codecs. This is the **single source of truth** consumed both by the Host gateway (validation) and by the Client adapter (`descriptor.result.create().parse(...)` re-validation at `adapter.ts:108`).
- `WORKTREE_CONSOLE_REMOTE` (`descriptors.ts:248`–`251`) and `TYPERT` (`src/console-remote/typert.ts:5`–`15`) — the Typert contribution (`face: 'host'`) discovered by the official Loader through `./typert`.
- `GitWorktreeRemote` (`src/console-remote/remote.ts:31`) and the `declare module '@deepseek-ai/dsh-typert-protocol'` block (`remote.ts:54`–`82`) — the strictly-typed wire namespace the adapter wraps. The adapter's only non-trivial arity transform is `resumeRevision` (`adapter.ts:130`), because the wire signature puts `conflictContinuation` last while the contract puts it under the request object.
- `WorktreeConsoleAdapter` interface (`src/console-contract.ts:745`–`784`) and `WorktreeConsoleOutcome<T>` union (`src/console-contract.ts:609`–`697`) — the normalized seam the adapter produces. Every error code (`transport_unavailable`, `malformed_response`, `timeout`) is enumerated in `WORKTREE_CONSOLE_ERROR_CODES` (`console-contract.ts:609`–`614`).

## Architecture

```text
  Host Browser (Cordis fiber)
  ┌─────────────────────────────────────────────────────────────┐
  │ apply(ctx)  src/client/console-remote/index.ts:62           │
  │   ctx.remote.$mount(WORKTREE_CONSOLE_REMOTE)  :64            │
  │   remote = ctx.get('remote.gitWorktree')         :67        │
  │   adapter = createWorktreeConsoleRemoteAdapter(remote) :71  │
  │   ctx.provide('worktreeConsole', adapter)        :72        │
  │   mountSettingsCard(ctx)  :73  ──► settings-card/index.ts:35│
  │   topology = await adapter.sidebarTopology()    :104        │
  │   branch on workspaceClientFlavor               :110        │
  │        ├─ legacy ─► registerManagedWorkspaceSidebar         │
  │        ├─ modern/alpha/next ─► decorate | managed           │
  │        └─ unsupported ─► mountTools only                    │
  │   mountTools ─► applyToolViews(child, adapter)             │
  └───────────────┬───────────────────────┬────────────────────┘
                  │ provides              │ injects
                  ▼                       ▼
        ┌───────────────────┐   ┌──────────────────────────────┐
        │ worktreeConsole   │   │ ToolViews / Sidebar (UI)     │
        │ (WorktreeConsole- │   │ src/client/index.tsx         │
        │  Adapter)         │   │ workspace-sidebar/*          │
        └─────────┬─────────┘   └──────────────────────────────┘
                  │ wraps
                  ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ createWorktreeConsoleRemoteAdapter  adapter.ts:80           │
  │   invoke<T>(method, call)  adapter.ts:83                    │
  │     Promise.race(call, setTimeout)  :89                     │
  │     parse(carrier.value) via descriptor.result              │
  │       WORKTREE_CONSOLE_DESCRIPTORS  descriptors.ts:94       │
  └─────────┬───────────────────────────────────────┬──────────┘
            │ delegates (typed)                      │ validates
            ▼                                        ▼
   ┌──────────────────────────┐        ┌─────────────────────────┐
   │ GitWorktreeRemote proxy  │        │ strict Zod codecs       │
   │ (remote.ts TypertRemoteMap)        │ (schemas.ts)            │
   └────────────┬─────────────┘        └─────────────────────────┘
                ▼
   Typert gateway ↔ Host console-host/service.ts ([[console-host]])
```

Components ≥ 3 and the boot path is non-trivial, so the diagram above shows the four layers: the Cordis `apply` entry, the `WorktreeConsoleAdapter` seam (provided as `worktreeConsole`), the `createWorktreeConsoleRemoteAdapter` wrapping + `invoke` timeout/validation loop, and the wire `GitWorktreeRemote` proxy plus the shared strict Zod codecs. The descriptor set (`WORKTREE_CONSOLE_DESCRIPTORS`) is the single authority shared with the Host ([[console-remote]]).

## Data Flow

A single UI mutation call traverses the whole stack as follows (concrete example: `adapter.current` at `adapter.ts:116`):

1. **UI call.** A component (e.g. `src/client/index.tsx` ToolView or a sidebar card) awaits `worktreeConsole.current({ sessionId })`. The object is the adapter returned by `createWorktreeConsoleRemoteAdapter`.
2. **`invoke<T>` wrapper** (`adapter.ts:83`). `locale` is resolved from `getLanguage()` (`readClientLanguage(ctx.get('locale'))`, `src/client/i18n.tsx:19`) and normalized. `timeoutMs` is chosen from `FAST_METHODS` (`adapter.ts:85`); `current` is FAST (30s).
3. **`Promise.race`** (`adapter.ts:89`–`94`). The `call(locale)` thunk (`locale => remote.current(request.sessionId, locale)`) races a `setTimeout` that resolves `{ timedOut: true }` after `timeoutMs`. The Web RPC carrier itself has no timeout, so this client-side guard prevents the UI from hanging forever on a stalled server handler (`adapter.ts:85`–`55` comment).
4. **Carrier error mapping.** On throw → `isCodecRejection` decides `malformed_response` vs `transport_unavailable` (`adapter.ts:32`–`98`). On timeout → `timeoutOutcome` (`adapter.ts:67`–`102`). On a non-`{ ok: boolean }` shape → `malformed` (`adapter.ts:103`).
5. **Business result pass-through.** If `carrier.ok === false`, the error message is surfaced directly (codec rejections still become `malformed_response`) (`adapter.ts:36`). If `carrier.ok === true`, the value is **re-parsed** through the shared strict schema (`adapter.ts:105`–`111`):
   - descriptor lookup by `method`; if `result.mode !== 'strict'` → `malformed` (defensive, see [[console-remote]]);
   - `descriptor.result.create().parse(carrier.value)`; a parse throw (wire payload violates contract) → `malformed_response`.
6. **Return.** The UI receives a `WorktreeConsoleOutcome<T>` — either the validated `{ ok: true, value }` or a `{ ok: false, error }` with one of `transport_unavailable` / `malformed_response` / `timeout` / the Host's own business error code. The contract's `WORKTREE_CONSOLE_ERROR_CODES` (`console-contract.ts:609`) enumerates all three client-injected codes.

**Boot-time flow (no UI yet).** `apply` (`index.ts:62`) mounts the Remote, resolves `remote.gitWorktree`, builds the adapter, provides it, mounts the settings card, then calls `adapter.sidebarTopology()` (`index.ts:104`) — a path-free call (`descriptors.ts:95`, `withAgent=false`) that returns `workspaceClientFlavor` and `officialWorkspaceActive`. That topology drives the branch election (`index.ts:67`–`205`): `legacy`/`alpha`/`next`/`modern` each register either a **managed** sidebar (re-provide `uiWorkspace` via `applyOfficialWorkspace`/`applyAlphaWorkspace`/`applyNextWorkspace`) or **decorate** the already-live official Workspace. `mountTools` (`index.ts:75`) then wires the ToolViews through `applyToolViews(child, adapter)`. Throughout, `reportBoot(...)` streams a `WorktreeClientBootReport` (`console-contract.ts:254`) to the Host diagnostics sink via `remote.clientBootReport` (`remote.ts:39`).

## Connections

- [[console-remote]] — The Host-side counterpart: `WORKTREE_CONSOLE_DESCRIPTORS`, `WORKTREE_CONSOLE_REMOTE`, `TYPERT`, `GitWorktreeRemote` type, and the `TypertRemoteMap['gitWorktree/*']` wire signatures that this adapter wraps. The two share one frozen descriptor array and one set of strict schemas.
- [[console-contract]] — `WorktreeConsoleAdapter` (the implemented seam), `WorktreeConsoleOutcome<T>`, all request/response DTOs, `WorktreeClientBootReport`, and `WORKTREE_CONSOLE_ERROR_CODES`. This module's error codes (`transport_unavailable`, `malformed_response`, `timeout`) originate from that enum.
- [[console-host]] — The Host gateway service (`WorktreeConsoleService`) that receives the Typert invocations issued by `GitWorktreeRemote`; `src/console-remote/remote.ts:31` declares the `TypertRemoteMap` consumed end-to-end.
- [[client-workspace-sidebar]] — `registerManagedWorkspaceSidebar` / `registerDecoratedWorkspaceSidebar` (called at `index.ts:118`,`132`,`149`,`173`,`188`) choose managed-vs-decorate registration per `workspaceClientFlavor`.
- [[client-tool-view]] (the `src/client/index.tsx` `apply`/`inject` pair, aliased as `applyToolViews`/`toolViewInject`) — mounted via `mountTools` (`index.ts:75`–`81`) once the Workspace provider exists, passing the built `adapter`.
- [[client-settings-card]] — `mountSettingsCard(ctx)` (`index.ts:73`, implemented `src/client/settings-card/index.ts:35`) registers the bundle's Plugins-page form fail-soft.
- [[client-i18n]] — `readClientLanguage` (`src/client/i18n.tsx:19`) resolves the locale at invocation time; `getLanguage` (`index.ts:69`) feeds it into every `invoke` and error message. `transportMessages` (`src/i18n/transport-messages.ts`) supplies the `malformed` / `mountFailed` / `workspaceGenerationUnknown` / `invokeTimeout` strings.
- [[i18n-core]] — `createTranslator`, `normalizeLanguage`, and the `Language` type used throughout the adapter and entry.

## Known Issues

- **Client-side timeouts are heuristic, not negotiated.** `FAST_TIMEOUT_MS = 30_000` and `SLOW_TIMEOUT_MS = 180_000` (`adapter.ts:60`–`57`) are fixed constants. `FAST_METHODS` (`adapter.ts:60`–`65`) decides which 7 read paths stay on the FAST track; every other method (full `list`/`preflight`/`preflightCreate` recompute, all mutations) silently gets the 180s budget. Adding a new slow method without adding it to `FAST_METHODS` will slow it; adding a new fast method to `FAST_METHODS` incorrectly risks a premature `timeout` error. There is no server-side signal for the budget.
- **`remote.directoryPicker` and `remoteAccess` are intentionally NOT injected** (`index.ts:45`–`49`, comment `index.ts:18`–`44`). They are filtered out to avoid a web-boot deadlock (the picker awaits `uiWorkspace`, which this entry would block) and a permanently-pending 0.2.0-rc.2 desktop boot (`'waiting for service: remoteAccess'`). They are resolved lazily through the managed context proxy instead. A reader must not "fix" the inject list by adding them back without reintroducing the official `officialContextProxy` stub path.
- **`resumeRevision` is the only arity-remapping adapter method.** The wire signature puts `conflictContinuation` last and optional (`remote.ts:54`), while the contract nests it under the request object. The adapter conditionally passes `undefined` when absent (`adapter.ts:130`–`132`). Any future method that reorders optional wire params relative to the contract request shape needs the same manual mapping — the `invoke` wrapper is otherwise a blind positional forward.
- **Re-parse can mask a Host upgrade mismatch.** `invoke` re-validates the carrier value against the client's copy of `WORKTREE_CONSOLE_DESCRIPTORS` (`adapter.ts:81`–`111`). If the Host and Client bundles drift (independent deploys), a Host payload that is valid server-side but not against the client's frozen schema collapses to `malformed_response`. The contract tolerates *additive* capability bits as `false` (`console-remote.test.ts:215`–`237`) but rejects unknown keys, so a Host that adds a non-capability field still breaks the client.
- **`clientBootReport` locale must be passed positionally even when `undefined`.** The Typert proxy enforces descriptor arity, so `reportBoot` always forwards `undefined` as the trailing locale (`index.ts:86`–`95`). Omitting it would throw at the proxy layer rather than at the adapter.
- **No disabled/feature-flagged code in this module.** The adapter object (`adapter.ts:119`–`155`) implements every `WorktreeConsoleAdapter` member, including the optional `preflightCreate`, `createWithInitialCommit`, `initializeProject`, `listAbandoned`, `restoreAbandoned` — none are stubbed out. The `'legacy'` branch (`index.ts:112`–`121`) is a live code path gated only by the Host-reported `workspaceClientFlavor`, not by a compile-time switch.
