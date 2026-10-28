---
title: module_core
type: module
source_files:
  - src/index.ts
  - src/session-checkout-module.ts
  - src/session-target-context.ts
  - src/concurrent-session-guard.ts
  - src/managed-worktree-path.ts
  - src/ports.ts
  - src/tools.ts
  - src/commands.ts
  - src/session-checkout-apply.ts
  - src/adapters/working-directory.ts
tags: [module, session-checkout, facade, runtime-context, state-machine]
---

## Overview

`module_core` is the plugin-facing domain layer of `dsh-git-worktree`. It is built around a single factory, `createSessionCheckoutModule` (in `src/session-checkout-module.ts`), which returns the `SessionCheckoutModule` contract originally declared in `src/index.ts` (lines 113–219). The factory is the **module facade**: every business caller (the tool layer in `src/tools.ts`, the human command in `src/commands.ts`, the console control plane, and the startup/reconcile timers in `src/index.ts`) goes through this one object. It owns the managed-checkout state machine, the exclusive binding lock, the replay-stable runtime-context text, the branch-race guard, and the full lifecycle of isolated Worktrees (bind → create → review → preview/finalize → cleanup/retain → iterate/discard → reconcile).

Three distinct responsibilities live in this module:

- **Module facade** — `createSessionCheckoutModule` (src/session-checkout-module.ts:237) wires ~40 internal methods into the `SessionCheckoutModule` interface and wraps each mutating/observing call in a single-process-mutex, `withBindingLock` (src/session-checkout-module.ts:1289).
- **Session target context** — `registerSessionTargetContext` (src/session-target-context.ts:14) injects a synchronous, replay-stable system-prompt section by calling `module.runtimeContext(sessionId, cwd)` (src/session-checkout-module.ts:1077) and refreshes the branch-race cache via `module.refreshBranchRaceGuards?.()` (src/session-checkout-module.ts:1002) on a 45s interval.
- **Top-level `SessionCheckoutModule` API** — the interface and the `SessionCheckoutError` type (src/index.ts:41), plus the per-call input types (`ManageManagedWorktreeInput`, `ListManagedWorktreesInput`, `PruneMergedBranchesInput`, `MergeBranchForSessionInput`, `MarkReadyForReviewInput`, `IsolatedTargetLaunch`, `SessionCheckoutReconcileSummary`) all defined in `src/index.ts`.

The domain is "Domi-ported and host-agnostic": it takes its Git, filesystem, lookup, and registry behavior through injected `SessionCheckoutDependencies` (imported from `src/ports.ts`), and never touches the host directly. Harness-specific behavior (auto-deliver, auto-push, `worktreesRoot`, retention windows) arrives as **live config values** (`liveConfigValue(...)`) so settings-page edits apply without remounting.

## Key Components

### `SessionCheckoutModule` interface (src/index.ts:113–219)

The complete public surface. Each line below maps to a method returned by the factory at src/session-checkout-module.ts:5202.

| Method | Lines (impl) | Purpose |
|---|---|---|
| `inspect(sessionId)` | `inspectAvailable` src/session-checkout-module.ts:1344 | Read-only `SessionTargetView` for the current target (local or isolated). Blocks on the binding lock but never writes the registry. |
| `runtimeContext(sessionId, cwd?)` | src/session-checkout-module.ts:1077 | **Synchronous** registry snapshot → model system-prompt text. No Git/FS I/O, so it is safe inside the cordis `systemPrompt.context` contract. |
| `refreshBranchRaceGuards?()` | src/session-checkout-module.ts:999 | Async reflog probe that repopulates `branchRaceCache` (src/session-checkout-module.ts:1077) for `runtimeContext` (src/session-checkout-module.ts:1077) to read synchronously. |
| `preflight?` | src/session-checkout-module.ts:2553 | Read-only apply sync preflight; never touches Local/worktree/refs. |
| `preflightPreviewRecovery?` | src/session-checkout-module.ts:2434 | Read-only detached Preview recovery assessment. |
| `runExclusiveSessionMutation` | src/session-checkout-module.ts:5213 (wrapper) | Run a caller closure while holding the binding lock; receives a fresh `inspectTarget` view. |
| `bind(sessionId, choice)` | src/session-checkout-module.ts:5216 (→ `bindTarget` src/session-checkout-module.ts:4841) | Bind the session to a `local` or `isolated` target. |
| `createIsolatedTarget` | src/session-checkout-module.ts:5220 | Reserve a distinct owner session + checkout without moving the source session cwd/identity. Supports in-place upgrade (`sourceSessionId === targetSessionId`). |
| `beginNextIteration` | src/session-checkout-module.ts:5246 (→ `beginNextIterationTarget` src/session-checkout-module.ts:4535) | Recreate a cleaned delivered owner's immutable cwd as the next isolated iteration. |
| `resumeRevision` | src/session-checkout-module.ts:5249 (→ `resumeRevisionTarget` src/session-checkout-module.ts:1997) | Invalidate an unsynced review, resume the same iteration without touching Local. |
| `prepareReviewRegeneration` | src/session-checkout-module.ts:5252 (→ `prepareReviewRegenerationTarget` src/session-checkout-module.ts:2070) | Persist a one-shot read-only review-regeneration request. |
| `preparePreviewRecoveryAnalysis` | src/session-checkout-module.ts:5255 (→ `preparePreviewRecoveryAnalysisTarget` src/session-checkout-module.ts:2103) | Persist an exact detached recovery proof before the owner agent is prompted. |
| `createPreviewRecoveryHandoff` | src/session-checkout-module.ts:5258 (→ `createPreviewRecoveryHandoffTarget` src/session-checkout-module.ts:2139) | Create a fresh managed Worktree while preserving old detached evidence; returns `IsolatedTargetLaunch & { continuation }`. |
| `markReadyForReview` | src/session-checkout-module.ts:5261 (→ `markReadyForReviewTarget` src/session-checkout-module.ts:1684) | Persist the review (summary, validation, tests, suggested commit message). |
| `operate(input)` | src/session-checkout-module.ts:5264 (→ `operateTarget` src/session-checkout-module.ts:3816) | Dispatch over `SessionCheckoutOperation`: `apply`, `finish`, `preview`, `checkpoint`, `rollback_preview`, `finalize_preview`, `retry_cleanup`, `discard`, `recover`. |
| `isAutoDeliverEnabled()` | src/session-checkout-module.ts:5266 | Live `autoDeliver` value; tool layer refuses model-driven delivery while false. |
| `listManagedWorktrees(input?)` | src/session-checkout-module.ts:4069 | Read-only management list (no lock). |
| `listManagedWorktreesForSession` | src/session-checkout-module.ts:4080 | Caller-scoped list filtered by owner/source session. |
| `pruneMergedBranchesForSession` | src/session-checkout-module.ts:5270 (→ `pruneMergedBranchesForSession` src/session-checkout-module.ts:4170) | Safe-prune fully merged local branches in the session project (`git branch -d` semantics). |
| `autoPruneStaleMergedBranches` | src/session-checkout-module.ts:5273 (→ src/session-checkout-module.ts:4193) | Maintenance sweep across every managed project. |
| `mergeBranchForSession` | src/session-checkout-module.ts:5276 (→ `mergeBranchForSession` src/session-checkout-module.ts:4215) | Merge a session-owned worktree branch into Local HEAD; `dryRun` probes in a throwaway worktree. |
| `listAbandonedWorktreeSnapshots` | src/session-checkout-module.ts:5279 | List recoverable abandoned snapshots in the project. |
| `restoreAbandonedWorktreeSnapshot` | src/session-checkout-module.ts:5280 | Restore an abandoned snapshot as a branch. |
| `manageManagedWorktreeForSession` | src/session-checkout-module.ts:5283 | Caller-scoped management; never treats persisted owner ids as authorization. |
| `inspectManagedWorktreeCleanup` | src/session-checkout-module.ts:5286 (→ `inspectManagedWorktreeCleanup` src/session-checkout-module.ts:4004) | Read-only cleanup inspection. |
| `bulkCleanupManagedWorktrees` | src/session-checkout-module.ts:5287 (→ `bulkCleanupManagedWorktrees` src/session-checkout-module.ts:4018) | Batch cleanup of delivered worktrees. |
| `manageManagedWorktree` | src/session-checkout-module.ts:5288 (→ `manageManagedWorktree` src/session-checkout-module.ts:4357) | Owner/Host maintenance: retention, permanent, sidebar badge, discard, cleanup. |
| `resolveManagedRoot` | src/session-checkout-module.ts:5289 (→ src/session-checkout-module.ts:4457) | Canonical root after identity validation. |
| `resolveRoots` | src/session-checkout-module.ts:5290 (→ src/session-checkout-module.ts:4466) | Both boundaries from registry, no Git I/O. |
| `observeManagedCheckout?` | src/session-checkout-module.ts:5291 (→ src/session-checkout-module.ts:4436) | Fresh validated observation with local snapshot. |
| `observeManagedCheckouts?` | src/session-checkout-module.ts:5292 (→ src/session-checkout-module.ts:4453) | Batch observation under one lock. |
| `cleanupExpiredRetained(now?)` | src/session-checkout-module.ts:5293 (→ src/session-checkout-module.ts:4483) | Retention-expiry sweep; tolerates transient `directory_busy`/`quarantine_busy`. |
| `enforceWorktreeKeepCount()` | src/session-checkout-module.ts:5297 (→ src/session-checkout-module.ts:4512) | LRU eviction of oldest delivered worktrees past `worktreeKeepCount`. |
| `reconcile()` | src/session-checkout-module.ts:5301 (→ `reconcile` src/session-checkout-module.ts:1362) | Startup crash-recovery; returns `SessionCheckoutReconcileSummary`. |

### `SessionCheckoutError` (src/index.ts:41–53)

Stable domain failure type. Carries a `code: SessionCheckoutErrorCode` plus the user-facing `message`. Raised everywhere in the state machine; `operateTarget` (src/session-checkout-module.ts:3816) converts it into a `SessionCheckoutOperationErrorResult` (`{ status: 'error', code, message, ...target }`).

### Input & result types (src/index.ts:55–219)

- `SessionCheckoutReconcileSummary` (src/index.ts:55) — `{ recoveryRequiredCheckoutIds, orphanedCheckoutIds, dirtyOrphanedCheckoutIds, staleRootCheckoutIds, retainedCheckoutCount }`.
- `ManageManagedWorktreeInput` (src/index.ts:63) — `checkoutId`, `expectedRevision`, `action: 'cleanup_retained' | 'retry_cleanup' | 'set_retention' | 'set_permanent' | 'clear_sidebar_badge' | 'discard'`, optional `retention`, `permanent`, `confirmDirty`, `rollbackPreview`.
- `ListManagedWorktreesInput` (src/index.ts:73) — `projectId?`, `needsAttention?`, `checkoutId?`, `includeDiagnostics?`.
- `PruneMergedBranchesInput` (src/index.ts:80) — `dryRun?`, `olderThanDays?`.
- `MergeBranchForSessionInput` (src/index.ts:87) — `sourceBranch`, `dryRun?`, `direction?: 'forward' | 'reverse'`.
- `MarkReadyForReviewInput` (src/index.ts:96) — `summary`, `validationStatus`, `tests`, `suggestedCommitMessage`, `detailsMarkdown?`.
- `IsolatedTargetLaunch` (src/index.ts:106) — `{ targetSessionId, managedRoot, target: SessionTargetView }`.

### `registerSessionTargetContext(ctx, module)` (src/session-target-context.ts:14–42)

Registers a per-assembly system-prompt snapshot. It does **no Git/filesystem I/O** at registration time: it captures the live working-directory port (`createSessionWorkingDirectoryPort(ctx)` from `src/adapters/working-directory.ts`), then injects `systemPrompt.context` (order 118, name `git-worktree:session-target`) whose `text` calls `module.runtimeContext(sessionId, workingDirectory.current(context.agent))` (src/session-target-context.ts:36). If `module.refreshBranchRaceGuards` is present (optional on the interface), it sets a 45s `setInterval` (src/session-target-context.ts:22) to keep the branch-race cache fresh; the interval is cleared on ctx effect disposal.

### Internal helpers (selected; all in src/session-checkout-module.ts)

- `createSessionCheckoutModule(dependencies)` — factory, src/session-checkout-module.ts:237. Closes over `dependencies` and defines all ~40 closures; returns the public object at src/session-checkout-module.ts:5202.
- `withBindingLock` — src/session-checkout-module.ts:1289. Single-process mutex (`bindingQueue` promise chain at src/session-checkout-module.ts:1261). Mutating calls run as `'exclusive'`; `preflightPreviewRecovery` / `cleanupExpiredRetained` / `enforceWorktreeKeepCount` / `reconcile` pass `{ allowConcurrentInspect: true }` and run as `'maintenance'`, which lets in-flight `inspect` calls (started via `inspectDuringMaintenance`, src/session-checkout-module.ts:1332) read authoritative snapshots without holding the mutation queue (the `maintenance_draining` handshake at src/session-checkout-module.ts:1314).
- `inspectTarget` / `inspectLocal` / `inspectIsolated` / `recoveryView` — src/session-checkout-module.ts:389, 257, 881, 389. `inspectIsolated` owns identity reconciliation: if the persisted record's `projectId`/`ownerSessionId` mismatch, or the managed root vanished, it calls `markRecoveryRequired` (src/session-checkout-module.ts:523) and renders a `recovery_required` view.
- `resolveBinding` — src/session-checkout-module.ts:1222. Throws `target_unselected` / `project_mismatch` when the session has no binding or its project no longer matches the persisted binding's project.
- `bindTarget` — src/session-checkout-module.ts:4841. The creation core; builds the `ManagedCheckoutRecord` (src/session-checkout-module.ts:5062), writes `sessionBindings` + `managedCheckouts`, calls `dependencies.git.createDetachedWorktree`, attaches a session branch via `attachSessionBranch` (src/session-checkout-module.ts:754), optionally carries local WIP (`carryLocalWorkInProgress`, src/session-checkout-module.ts:4778), and on failure runs `finishFailedCreation` (src/session-checkout-module.ts:498) → either `markRecoveryRequired` or rolls the binding back and deletes the record.
- `reconcile` — src/session-checkout-module.ts:1362. Crash-recovery over every `managedCheckout`: promotes interrupted previews/checkpoints/finalizes to deterministic states, retracts `recovery_required`, cleans delivered empty shells, then (under `withCleanupTimeout`, src/session-checkout-module.ts:108) runs `cleanupFinalized` on leftover `finalized` records and `cleanupExpiredRetained`.
- `branchRaceNotice` / `refreshBranchRaceGuards` / `branchRaceCache` — src/session-checkout-module.ts:999, 1002, 999. `runtimeContext` (src/session-checkout-module.ts:1077) consumes the cache synchronously; the guard is disabled when `liveConfigValue(dependencies.branchRaceGuard) === false` (default true), see config at src/index.ts:126.
- `updateManagedCheckout` — src/session-checkout-module.ts:1670. Reads registry, applies update, bumps `registry.revision`, writes back. The single mutation primitive every operation uses.
- `validateManagedCheckoutDetailed` — src/session-checkout-module.ts:597. Deep identity/path/Git-state proof (`ValidatedManagedCheckout`, src/session-checkout-module.ts:540) with `checkpointHeadInvariantHolds` (src/session-checkout-module.ts:561).
- `cleanupFinalized` — src/session-checkout-module.ts:2979. The full delivery-teardown chain: validate, `removeWorktree`, quarantine residue (`quarantineAndRemove`, src/session-checkout-module.ts:3053), set `phase: 'discarded'` + `delivery.state: 'delivered'`.

### Managed record field notes

`ManagedCheckoutRecord` (imported from `src/ports.ts`, written at src/session-checkout-module.ts:5062 and 4615) carries auto-managed fields the article must not generalize: `revision` (monotonic, bumped by every `updateManagedCheckout` and creation step), `phase` (`preparing | ready | mutating | finalized | retained | recovery_required | discarded`), `journal` (replayable operation receipt: `operation`, `operationId`, `step`, `startedAt`, plus operation-specific fields such as `managedDirectoryIdentity`, `cleanupQuarantinePath`, `commitOid`), `delivery` (a discriminated union over `working | ready_for_review | preview_active | preview_detached | finalized | retained | delivered`), `permanent` (exempts auto-cleanup), `sidebarBadgeClearedRevision`, `abandonedSnapshotOid` / `abandonedSnapshotAt`, `checkpoints`, `sessionBranch`, `sessionTopic`, `sourceRef` / `sourceOid`, `applyBaseOid`, `predecessorCheckoutId`. The `delivery.cleanupMessage`/`cleanupReason` fields are persisted prose + structured reason; `persistedCleanupReason` (src/session-checkout-module.ts:156) prefers the structured field and falls back to keyword matching on legacy records.

## Architecture

```text
┌────────────────────────────┐   tools/commands/console   (callers)
│  src/tools.ts / commands.ts │
└───────────────┬────────────┘
                │ SessionCheckoutModule API
                ▼
┌──────────────────────────────────────────────────────────┐
│ createSessionCheckoutModule()  (src/session-checkout-module.ts:237)
│  ├─ withBindingLock ── exclusive/maintenance mutex ──┐
│  ├─ inspect/inspectAvailable ──► inspectTarget ─┐     │
│  ├─ operate ──► operateTarget (apply/finish/…)   │     │
│  ├─ bind/createIsolatedTarget ──► bindTarget      │     │
│  ├─ reconcile / cleanupExpiredRetained /          │     │
│  │   enforceWorktreeKeepCount (maintenance mode)  │     │
│  └─ runtimeContext (sync) ──► branchRaceCache      │     │
└───────────────┬──────────────────────┬───────────┘     │
                │ deps                  │ deps            │
                ▼                       ▼                 ▼
        ┌───────────────┐      ┌────────────────┐   registry.json
        │ git/files/     │      │ AtomicJson     │   (managedCheckouts,
        │ lookup ports   │      │ CheckoutRegistry│    sessionBindings)
        │ (src/ports.ts) │      └────────────────┘
        └───────────────┘
                ▲
                │ refreshBranchRaceGuards (45s) ── src/session-target-context.ts:22
┌──────────────────────────────────────────────┐
│ registerSessionTargetContext → systemPrompt    │
│   text = module.runtimeContext(sessionId, cwd) │
└──────────────────────────────────────────────┘
```

The binding lock (`withBindingLock`, src/session-checkout-module.ts:1289) is the central correctness primitive: every public mutating method and `inspectAvailable` (the read path) funnels through `bindingQueue` (src/session-checkout-module.ts:1261), so the registry's `revision` stays consistent even when the console control plane, the maintenance timers, and interactive tools fire concurrently. `maintenance` mode (src/session-checkout-module.ts:1306) deliberately lets already-started `inspect` calls finish while a slow reconcile/cleanup (Windows file-lock can take tens of seconds) holds the lock.

## Data Flow

1. **Bind / create.** `bind({kind:'isolated'})` → `bindTarget` (src/session-checkout-module.ts:4841) writes a `preparing` record + a `sessionBindings[sessionId]` entry, calls `git.createDetachedWorktree`, then `attachSessionBranch` (src/session-checkout-module.ts:754) to put the Worktree on its own `feat/sess-<id>` branch (`createSessionBranchCandidates` in `src/managed-worktree-path.ts`). The record is promoted to `ready` (src/session-checkout-module.ts:5139). `createIsolatedTarget` (src/session-checkout-module.ts:5220) does the same for a *separate* preallocated target session without moving the source session's cwd.
2. **Review.** `markReadyForReview` (src/session-checkout-module.ts:1684) first calls `ensureSessionBranch` (src/session-checkout-module.ts:810) so the fingerprint captures the real session-branch HEAD, then snapshots the isolated review and stores `delivery.state = 'ready_for_review'`.
3. **Preview / finalize / finish.** `operate({action:'preview'|'finalize_preview'|'finish'|...})` (src/session-checkout-module.ts:3816) → the matching `operateX` closure. Each transitions `phase: 'mutating'` with a `journal` receipt, drives `dependencies.applyEngine`, and on success records the new `delivery` state. The delivered commit lands **only on the session branch** — Local working tree, index, and HEAD are never written (see `refuseLegacyLocalWrite`, src/session-checkout-module.ts:1656, which blocks the legacy apply/preview/finalize-to-Local path once a `sessionBranch` exists).
4. **Cleanup / retain / iterate.** `finalize_preview` (src/session-checkout-module.ts:3166) sets `finalized`/`retained`; `cleanupFinalized` (src/session-checkout-module.ts:2979) tears down the Worktree to `discarded` + `delivered`. `beginNextIteration` (src/session-checkout-module.ts:4535) reuses the predecessor's session branch tip as the new base so the iteration chain is contiguous.
5. **Runtime context.** The host calls `runtimeContext(sessionId, cwd)` (src/session-checkout-module.ts:1077) synchronously inside the system prompt; it renders the authoritative cwd, the absolute-path write rule, the delivery-state guidance, and — when `branchRaceGuard` is on — the race notice from `branchRaceNotice` (src/session-checkout-module.ts:1035) using the cached `branchRaceCache` (src/session-checkout-module.ts:999).
6. **Reconcile.** On `ready` (src/index.ts:414) and every `RETENTION_MAINTENANCE_INTERVAL_MS` (src/index.ts:343, 15 min) plus the auto-prune sweep, `reconcile` (src/session-checkout-module.ts:1362) + `enforceWorktreeKeepCount` (src/session-checkout-module.ts:4511) + `autoPruneStaleMergedBranches` (src/session-checkout-module.ts:4193) converge leftover records.

## Connections

- [[index]] — `apply()` (src/index.ts:358) mounts the module via `createSessionCheckoutModule`, wires volatile config (`autoDeliver`, `autoPush`, `worktreesRoot`, `worktreeKeepCount`, `branchRaceGuard`, `branchRaceWindowMs`), registers tools/commands/context, and runs startup `reconcile`.
- [[session-checkout-apply]] — `dependencies.applyEngine` (`src/session-checkout-apply.ts`) backs every `operate*` action (`plan`, `apply`, `preview`, `rollback`, `finalize`, `checkpoint`, `inspectReview`, `reviewIsolated`, `commitIsolated`, `recoverCheckpoint`).
- [[ports]] — `SessionCheckoutDependencies` (`git`, `files`, `lookup`, `registry`, `applyEngine`, live config values) injected into the factory.
- [[session-target-context]] — registers `runtimeContext` as a system-prompt source and drives `refreshBranchRaceGuards`.
- [[concurrent-session-guard]] — `detectLocalBranchRace` (src/session-checkout-module.ts:1057) used by `branchRaceNotice`.
- [[managed-worktree-path]] — `createSessionBranchCandidates`, `createManagedWorktreePathCandidates`, `createManagedWorktreeRepositoryKey`, `createTopicDateStamp`, `sanitizeBranchSegment` name the session branch and the Worktree on-disk layout.
- [[registry]] — `AtomicJsonCheckoutRegistry` is the single persistence the module reads/writes via `dependencies.registry`.
- [[tools]] / [[commands]] — the two callers of the `SessionCheckoutModule` surface exposed to models and humans.
- [[console-host]] — the control plane calls `inspectManagedWorktreeCleanup`, `manageManagedWorktree`, `bulkCleanupManagedWorktrees`, `listManagedWorktrees`.

## Known Issues

- **Branch-race guard is refresh-driven, not operate-driven.** `refreshBranchRaceGuards` (src/session-checkout-module.ts:1002) is optional on the interface and is only invoked by the 45s host interval (src/session-target-context.ts:22); the `operate`/`bind` paths never call it. If the host omits it (or `git.branchCreationTimes` is unimplemented), `branchRaceNotice` (src/session-checkout-module.ts:1035) returns an empty string and the guard stays silent rather than blocking — by design (see src/concurrent-session-guard.ts:12).
- **`git.add` not invoked for session-branch creation.** When `dependencies.git.attachWorktreeBranch` is missing, `attachSessionBranch` (src/session-checkout-module.ts:754) returns `null` and `ensureSessionBranch` (src/session-checkout-module.ts:810) falls back to committing on the detached HEAD, warning `theSessionBranchCouldNotBeAttachedFallingBackTo`. Production adapters implement the port; missing it degrades delivery attribution but does not block creation.
- **Creation convergence timeout.** A single checkout-cleanup under startup can hang on Windows file locks; `withCleanupTimeout` (src/session-checkout-module.ts:108, `CHECKOUT_CLEANUP_TIMEOUT_MS = 120_000` at src/session-checkout-module.ts:1289) bounds it but does not cancel — the background op continues and retries serially via `withBindingLock` (no `AbortSignal` yet, see ponytail note at src/session-checkout-module.ts:104).
- **Legacy Local-write records.** Worktrees created by older versions with `applyBaseOid` set and `delivery.state` `working`/`ready_for_review` are rejected by `operateFinish` (src/session-checkout-module.ts:3339) and `operateDiscard` (src/session-checkout-module.ts:3586) with a "written to Local through an older path" message; `refuseLegacyLocalWrite` (src/session-checkout-module.ts:1656) blocks apply/preview/finalize once a session branch exists. These are intentional guards, not bugs.
