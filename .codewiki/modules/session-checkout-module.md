---
title: Session Checkout Module
type: module
source_files:
  - src/session-checkout-module.ts
  - src/index.ts
  - src/ports.ts
  - src/types.ts
  - src/session-checkout-apply.ts
  - src/checkpoint.ts
  - src/creation-failure.ts
  - src/managed-worktree-path.ts
  - tests/session-checkout-module.test.ts
tags: [session-checkout, state-machine, worktree, delivery, recovery, apply-engine]
---

## Overview

`createSessionCheckoutModule(dependencies)` (in `src/session-checkout-module.ts:237-5303`) is the core state machine for dsh-git-worktree. It was ported from Domi and owns the **receipt-first Local Preview**, **rollback/finalize**, **project acceptance slots**, **crash recovery**, and **fingerprint CAS** flows, while adapting ownership to a separate source Local Session and target owner Session (module doc at `src/session-checkout-module.ts:237-243`).

It is **host-agnostic**: every Git, filesystem, registry, session-lookup, and apply-engine concern is injected through the `SessionCheckoutDependencies` port (`src/ports.ts:567-608`). The module talks only to these ports and a JSON checkout registry (`ManagedCheckoutsRegistry`, `src/ports.ts:542-547`).

Key delivery semantic: delivery now **only commits onto the Worktree's own session branch and never touches Local** (see the session-branch gate `refuseLegacyLocalWrite` at `src/session-checkout-module.ts:1656-1668`). The Worktree is attached to a dedicated `sessionBranch` (`refs/heads/feat/sess-<id>…`) at creation (`attachSessionBranch`, `src/session-checkout-module.ts:754-796`) and again before every review/finish/delivery (`ensureSessionBranch`, `src/session-checkout-module.ts:810-860`). Local is only merged back on explicit user request via `mergeBranchForSession`.

The module returns a `SessionCheckoutModule` object (`src/index.ts:113-219`) whose every mutation goes through `withBindingLock` (`src/session-checkout-module.ts:1289-1324`), a single-writer queue that also supports a concurrent read-only `maintenance` bypass for background `reconcile` / retention cleanup / keep-count sweeps.

## Key Components

The module is a single factory `createSessionCheckoutModule` (`src/session-checkout-module.ts:237`). Inside it, many private closures form the state machine; the factory returns the public `SessionCheckoutModule` surface (`src/session-checkout-module.ts:237-338`).

### Public API returned by the factory (`src/index.ts:113-219`)

All wrappers acquire `withBindingLock`; read-only list/inspect calls opt into the `allowConcurrentInspect` maintenance bypass.

- `inspect(sessionId)` → `SessionTargetView` — `inspectAvailable` (`src/session-checkout-module.ts:1344-1360`), spins on the binding lock and routes to `inspectLocal` (`src/session-checkout-module.ts:257-283`) or `inspectIsolated` (`src/session-checkout-module.ts:881-989`).
- `runtimeContext(sessionId, cwd?)` (`src/session-checkout-module.ts:1077-1220`) — **synchronous** registry-only snapshot that builds the model guidance string for the current target (Local vs Isolated, every delivery state, branch-race notice).
- `refreshBranchRaceGuards()` (`src/session-checkout-module.ts:1002-1027`) — fills `branchRaceCache` with per-Local-root branch creation times for the synchronous race guard.
- `preflight(sessionId, expectedRevision)` (`src/session-checkout-module.ts:2553-2631`) — read-only sync readiness check before apply/finish.
- `preflightPreviewRecovery(sessionId, expectedRevision, expectedReviewId, expectedPreviewId)` (`src/session-checkout-module.ts:2434-2520`) — deterministic detached-preview recovery assessment + proof.
- `runExclusiveSessionMutation(sessionId, operation)` — runs `operation(target)` under the exclusive lock.
- `bind(sessionId, choice)` (`src/session-checkout-module.ts:5216-5219` → `bindTarget`, `src/session-checkout-module.ts:4841-5200`) — binds a Local or creates an Isolated target.
- `createIsolatedTarget(sourceSessionId, targetSessionId, createOptions?)` (`src/session-checkout-module.ts:5220-5245`) — reserves a distinct owner session; same-id form = in-place upgrade.
- `beginNextIteration(sessionId, expectedRevision)` (`src/session-checkout-module.ts:5246-5247` → `beginNextIterationTarget`, `src/session-checkout-module.ts:4535-4744`) — recreates a cleaned delivered owner's immutable cwd as the next isolated iteration.
- `resumeRevision(...)` (`src/session-checkout-module.ts:1997-2068`), `prepareReviewRegeneration(...)` (`src/session-checkout-module.ts:2070-2101`), `preparePreviewRecoveryAnalysis(...)` (`src/session-checkout-module.ts:2103-2137`), `createPreviewRecoveryHandoff(...)` (`src/session-checkout-module.ts:2139-2185`) — persist Host one-shot continuations/proofs and create handoff worktrees.
- `markReadyForReview(sessionId, input)` (`src/session-checkout-module.ts:1684-1765`) — prepares a review and attaches the session branch first.
- `operate(input)` (`src/session-checkout-module.ts:3816-3834` → `operateTarget`) — dispatches the `SessionCheckoutOperation` actions `apply | finish | preview | checkpoint | rollback_preview | finalize_preview | retry_cleanup | discard | recover`.
- `isAutoDeliverEnabled()` (`src/session-checkout-module.ts:5266`) — live autoDeliver flag.
- `listManagedWorktrees(input?)` (`src/session-checkout-module.ts:4069-4078`), `listManagedWorktreesForSession(sessionId, input?)` (`src/session-checkout-module.ts:4080-4094`).
- `pruneMergedBranchesForSession(sessionId, input?)` (`src/session-checkout-module.ts:4170-4186`), `autoPruneStaleMergedBranches(olderThanDays)` (`src/session-checkout-module.ts:4193-4213`).
- `mergeBranchForSession(sessionId, input)` (`src/session-checkout-module.ts:4215-4291`) — merges a session-owned worktree branch into Local HEAD (forward) or vice versa (reverse), with ownership gating and acceptance-slot refusal.
- `listAbandonedWorktreeSnapshots(sessionId)` (`src/session-checkout-module.ts:4293-4309`), `restoreAbandonedWorktreeSnapshot(sessionId, checkoutId)` (`src/session-checkout-module.ts:4311-4334`).
- `manageManagedWorktreeForSession(sessionId, input)` (`src/session-checkout-module.ts:4336-4355`) and `manageManagedWorktree(input)` (`src/session-checkout-module.ts:4357-4434`) — owner-scoped discard / set_retention / set_permanent / clear_sidebar_badge / cleanup.
- `inspectManagedWorktreeCleanup(input?)` (`src/session-checkout-module.ts:4004-4016`) and `bulkCleanupManagedWorktrees(candidates)` (`src/session-checkout-module.ts:4018-4067`).
- `resolveManagedRoot(checkoutId)` (`src/session-checkout-module.ts:4457-4459`), `resolveRoots(checkoutId)` (`src/session-checkout-module.ts:4466-4469`) — registry read of both boundaries.
- `observeManagedCheckout(checkoutId)` (`src/session-checkout-module.ts:4436-4450`), `observeManagedCheckouts(checkoutIds)` (`src/session-checkout-module.ts:4436-4439`) — validated observation.
- `cleanupExpiredRetained(now?)` (`src/session-checkout-module.ts:4483-4503`), `enforceWorktreeKeepCount()` (`src/session-checkout-module.ts:4511-4533`), `reconcile()` (`src/session-checkout-module.ts:1362-1609`).

### Core internal closures (state machine)

- `withBindingLock(operation, {allowConcurrentInspect?})` (`src/session-checkout-module.ts:1289-1324`) — single-writer mutex with a `maintenance` read-only bypass; maintenance drains running inspects before handing the queue back to mutations.
- `inspectLocal` / `inspectIsolated` (`src/session-checkout-module.ts:257-283`, `881-989`) — build `SessionTargetView`; `inspectIsolated` validates identity, restores `recovery_required` → `ready` when paths are intact, and reports project acceptance-slot ownership.
- `validateManagedCheckoutDetailed` (`src/session-checkout-module.ts:597-653`) / `validateManagedCheckout` (`src/session-checkout-module.ts:655-662`) — canonical-path + Git-common-dir + branch-fingerprint identity proof (returns `valid | invalid | unavailable`).
- `ensureSessionBranch` (`src/session-checkout-module.ts:810-860`) and `attachSessionBranch` (`src/session-checkout-module.ts:754-796`) — attach the Worktree to its own session branch, trying `createSessionBranchCandidates` names; falls back to detached-HEAD if the port `attachWorktreeBranch` is absent.
- `refuseLegacyLocalWrite` (`src/session-checkout-module.ts:1656-1668`) — blocks legacy apply/preview/finalize that would write Local when a `sessionBranch` exists.
- `operateApply` (`src/session-checkout-module.ts:2187-2344`), `operatePreview` (`src/session-checkout-module.ts:2633-2783`), `operateFinalizePreview` (`src/session-checkout-module.ts:3166-3310`), `operateRollbackPreview` (`src/session-checkout-module.ts:2824-2929`), `operateFinish` (`src/session-checkout-module.ts:3339-3574`), `operateCheckpoint` (`src/session-checkout-module.ts:1767-1995`), `operateDiscard` (`src/session-checkout-module.ts:3586-3750`), `operateRecover` (`src/session-checkout-module.ts:3752-3814`) — each is an `operate` action handler with exclusive-lock CAS (`expectedRevision`), stale-target re-validations, acceptance-slot checks, and journal-based crash recovery.
- `cleanupFinalized` (`src/session-checkout-module.ts:2979-3163`) — the safety-critical removal chain: fingerprint CAS, worktree removal, detached-residue quarantine, container reclamation, and terminal `delivered` transition.
- `detachPreviewAfterLocalDrift` (`src/session-checkout-module.ts:2785-2822`) — turns a `preview_active` into `preview_detached` when Local drifted during rollback/finalize.
- `reconcile` (`src/session-checkout-module.ts:1362-1609`) — startup/idle sweep that replays journals to deterministic states, reclassifies finalized/retained, and triggers cleanup of expired retained worktrees.
- `bindTarget` (`src/session-checkout-module.ts:4841-5200`) — the create/local-rebind logic for both `bind` and `createIsolatedTarget`.
- `beginNextIterationTarget` (`src/session-checkout-module.ts:4535-4744`) — recreate a delivered owner's immutable cwd as the next isolated iteration.

### Constants & module-level helpers

- `UNVERSIONED_OID='unversioned'`, `UNVERSIONED_REF='WORKING_TREE'` (`src/session-checkout-module.ts:91-92`).
- `RETENTION_24H_MS`, `RETENTION_3D_MS` (`src/session-checkout-module.ts:93-94`), `DEFAULT_WORKTREE_RETENTION` imported from `src/types.ts:39`.
- `CHECKOUT_CLEANUP_TIMEOUT_MS = 120_000` (`src/session-checkout-module.ts:108`) and `withCleanupTimeout` (`src/session-checkout-module.ts:108-126`) — bounding startup cleanup so one stuck record cannot block app start.
- `TRANSIENT_CLEANUP_RETRY_DELAYS_MS = [100, 300, 800]` (`src/session-checkout-module.ts:172`) and `retryTransientCleanup` / `isTransientCleanupError` (`src/session-checkout-module.ts:163-184`) — retry on EBUSY/EPERM/EACCES/ENOTEMPTY.
- `persistedCleanupReason` / `cleanupReasonForMessage` (`src/session-checkout-module.ts:142-161`) — structured cleanup reason with legacy prose fallback.
- `pathForIdentity`, `pathsEqual`, `resolvedPathsEqual`, `pathIsWithin`, `branchNameOf` (`src/session-checkout-module.ts:192-235`) — Windows-safe path/branch normalization helpers.
- `sha256Facts` / `canonicalJson` / `recoveryGeneration` (`src/session-checkout-module.ts:2415-2432`) — the sha256 of canonical JSON forming the preview-recovery proof `generation`.
- `pushLocalBranchBestEffort` (`src/session-checkout-module.ts:129-140`) — best-effort session-branch push after finish.

### Domain data structures (port types in `src/ports.ts`)

`ManagedCheckoutRecord` (`src/ports.ts:487-540`) — the durable per-checkout record. All fields: `checkoutId`, `predecessorCheckoutId?`, `projectId`, `projectName`, `ownerSessionId`, `sourceSessionId?`, `localRoot`, `managedRoot`, `managedGitRoot`, `gitCommonDir`, `gitDir`, `baseOid`, `applyBaseOid?` (last applied isolated snapshot, not the user-visible base), `previousReview?` (`ManagedWorktreePreviousReviewRecord`, `src/ports.ts:353-359`), `checkpoints?` (`ManagedWorktreeCheckpointRecord[]`, `src/ports.ts:501-518`), `recoveryContinuation?`, `abandonedSnapshotOid?`, `abandonedSnapshotAt?`, `permanent?`, `sidebarBadgeClearedRevision?`, `sourceRef`, `sessionBranch?` (`refs/heads/feat/sess-…`, absent on historical records), `sessionTopic?`, `phase` (`SessionCheckoutPhase`, `src/types.ts:18-27`), `delivery` (`ManagedCheckoutDelivery` union, `src/ports.ts:449-485`), `journal` (`ManagedCheckoutJournal | null`, `src/ports.ts:501`), `revision`.

`ManagedCheckoutDelivery` (`src/ports.ts:449-485`) is a discriminated union on `state`: `working` | `ready_for_review` | `preview_active` | `preview_detached` | `finalized` | `retained` | `delivered`, each carrying the review/preview/proof and cleanup bookkeeping (e.g. `cleanup: 'pending'|'blocked'|'scheduled'`, `cleanupMessage?`, `cleanupReason?`, `retention`, `retainedAt`, `expiresAt`).

`ManagedCheckoutJournal` (`src/ports.ts:331`) separates `create` journals (`ManagedCheckoutCreateJournal`, `src/ports.ts:288-292`, with `creation: WorktreeCreationEvidence`, `step: 'creating_worktree'`) from mutation journals (`ManagedCheckoutMutationJournal`, `src/ports.ts:294-329`, `operation` ∈ `apply | preview | checkpoint | rollback_preview | finalize_preview | finish | cleanup`, and `step` ∈ `planning | artifacts_retained | committing_session_branch | writing_local | updating_ref | replacing_index | removing_worktree`).

`ManagedCheckoutsRegistry` (`src/ports.ts:542-547`): version-2 JSON, `revision`, `sessionBindings: Record<sessionId, SessionBindingRecord>`, `managedCheckouts: Record<checkoutId, ManagedCheckoutRecord>`. Persisted atomically by `SessionCheckoutRegistryPort` (`src/ports.ts:549-552`); every mutation bumps `revision` via `updateManagedCheckout` (`src/session-checkout-module.ts:1670-1682`).

`SessionBindingRecord` (`src/ports.ts:257-267`) ties a session to `{kind:'local'}` or `{kind:'isolated', checkoutId}` plus `projectId`, `ownerSessionId`, `sourceRef`, `sourceOid`, `inheritedFromSessionId?`, `revision`.

`SessionCheckoutDependencies` (`src/ports.ts:567-608`) is the injected port bundle: `lookup`, `git` (`SessionCheckoutGitPort`, `src/ports.ts:109-230`), `files` (`SessionCheckoutFilesPort`, `src/ports.ts:238-255`), `registry`, `applyEngine` (`SessionCheckoutApplyEngine`, `src/session-checkout-apply.ts:279-317`), `managedCheckoutsRoot`, `createCheckoutId`, plus optional/local-adaptation flags (`autoPush`, `autoDeliver`, `worktreesRoot`, `inheritLocalChanges`, `worktreeKeepCount`, `branchRaceGuard`, `branchRaceWindowMs`).

### Test surface

`tests/session-checkout-module.test.ts` (3145 lines) exercises bind/apply/preview/finalize/rollback/checkpoint/discard/recover, retention cleanup, keep-count eviction, prune, merge gating, abandoned-snapshot restore, branch-race guards, and the legacy-prose→structured cleanup-reason fallback. It builds adapters via `createNodeSessionCheckoutDependencies` (`tests/session-checkout-module.test.ts:14`) against a real Git repo.

## Architecture

Every public method acquires `withBindingLock` (`src/session-checkout-module.ts:1289-1324`), a single-writer queue. Background sweeps (`reconcile`, `cleanupExpiredRetained`, `enforceWorktreeKeepCount`) and `preflightPreviewRecovery` opt into the read-only `maintenance` bypass so they never block interactive mutations; the bypass first drains in-flight inspects (`maintenance_draining`, `src/session-checkout-module.ts:1312-1319`) before a mutation takes the queue.

```text
            ┌──────────────────────────────────────────────────────────┐
            │  Host / Tools / Session-Target runtimeContext (index.ts)   │
            └───────────────┬──────────────────────────────────────────┘
                            │ bind / operate / cleanup / inspect
                            ▼
            ┌──────────────────────────────────────────────────────────┐
            │  SessionCheckoutModule (returned object, lines 5202-5303)   │
            │  withBindingLock (exclusive | maintenance | draining)       │
            └───────┬───────────────────────────────┬──────────────────┘
                    │                                │
          ┌─────────▼──────────┐            ┌────────▼───────────────┐
          │ bindTarget          │            │ reconcile / cleanup... │
          │ (create / attach    │            │ (maintenance bypass)   │
          │  sessionBranch)     │            └────────┬───────────────┘
          └─────────┬──────────┘                     │
                    │ writes                         │ reads/writes
                    ▼                                ▼
            ┌──────────────────────────────────────────────────────────┐
            │  ManagedCheckoutsRegistry (JSON, ports.ts:542-547)          │
            │  sessionBindings + managedCheckouts, revision bumped        │
            └───┬───────────────────┬────────────────────┬───────────────┘
                │                   │                    │
   ┌────────────▼─────┐  ┌──────────▼─────────┐  ┌───────▼──────────────┐
   │ SessionCheckout   │  │ SessionCheckout     │  │ SessionCheckout       │
   │ GitPort           │  │ FilesPort           │  │ ApplyEngine          │
   │ (worktree,        │  │ (canonicalize,      │  │ (plan/preview/        │
   │  inspect,         │  │  removeTree,        │  │  finalize/rollback/   │
   │  removeWorktree,  │  │  quarantine)        │  │  commitIsolated,      │
   │  attachBranch)    │  │                     │  │  reviewIsolated, CAS) │
   └───────────────────┘  └────────────────────┘  └──────────────────────┘
                ▲                   ▲                    ▲
                └──────── Local ─────┴──── Managed Worktree (isolated) ─┘
```

Two checkout kinds coexist through a binding (`src/session-checkout-module.ts:4841-4890`):
- **Local** (`kind:'local'`): the project's own repo; no worktree; direct Local work.
- **Isolated** (`kind:'isolated', checkoutId`): a detached managed worktree (`createDetachedWorktree`, called at `src/session-checkout-module.ts:5102` and `4655`) on its own `sessionBranch`, with the Local project root as its `localRoot`. Delivery commits only on the session branch; Local is never written (`refuseLegacyLocalWrite`, `src/session-checkout-module.ts:1656-1668`).

Project **acceptance slot** (`holdsProjectAcceptanceSlot` / `findProjectAcceptanceHolder`, `src/session-checkout-module.ts:2346-2364`) serializes preview/rollback/finalize/finish per `localRoot`: only one managed checkout in `preview_active` or with a `preview`/`rollback_preview`/`finalize_preview`/`finish` journal may occupy a project's Local at a time.

## Data Flow

### Create / bind (Local → Isolated)
`bindTarget` (`src/session-checkout-module.ts:4841-5200`) resolves the project, inspects the repo, picks a trusted sibling/fallback container, writes a `preparing` record + binding, calls `dependencies.git.createDetachedWorktree` (`src/session-checkout-module.ts:5102`), then `attachSessionBranch` (`src/session-checkout-module.ts:5117`), optionally carries local WIP (`carryLocalWorkInProgress`, `src/session-checkout-module.ts:4778-4804`), and flips the record to `ready`. Failures roll back via `finishFailedCreation` (`src/session-checkout-module.ts:498-521`) and `markRecoveryRequired` (`src/session-checkout-module.ts:523-538`).

### Delivery (the central flow)
1. `markReadyForReview` (`src/session-checkout-module.ts:1684-1765`) ensures the session branch, snapshots the review (`applyEngine.reviewIsolated`/`inspectReview`), and records `delivery.state='ready_for_review'`.
2. `operate preview` (`src/session-checkout-module.ts:2366-2516`) runs `applyEngine.plan`, retains preview artifacts (`retainPreviewArtifacts`, `src/session-checkout-module.ts:2366-2372`), and sets `preview_active`.
3. `operate finalize_preview` (`src/session-checkout-module.ts:2480-2624`) commits via `applyEngine.finalize` to Local; `operate finish` (`src/session-checkout-module.ts:2480-2715`) instead commits **only on the session branch** via `applyEngine.commitIsolated` (`src/session-checkout-apply.ts:292`) / `reviewIsolated` (`src/session-checkout-apply.ts:294`), sets `finalized`, optionally retains (`retainFinalized`, `src/session-checkout-module.ts:2931-2957`) or cleans up (`cleanupFinalized`, `src/session-checkout-module.ts:2979-3163`), and optionally best-effort pushes the session branch (`pushLocalBranchBestEffort`, `src/session-checkout-module.ts:129-140`).
4. `cleanupFinalized` transitions the record to `delivered` + `discarded` phase after the worktree is removed and the empty container reclaimed (`collectEmptyManagedContainer`, `src/session-checkout-module.ts:2963-2977`).

### Recovery & drift
If Local drifts during a preview (`stale_local`/`preview_modified`), `operateRollbackPreview`/`operateFinalizePreview` call `detachPreviewAfterLocalDrift` (`src/session-checkout-module.ts:2785-2822`) → `preview_detached`, then `preflightPreviewRecoveryTarget` (`src/session-checkout-module.ts:2434-2520`) produces a sha256 `WorktreePreviewRecoveryProof` (`recoveryGeneration`, `src/session-checkout-module.ts:2430-2432`) that gates retry via `recoveryProofMatches` (`src/session-checkout-module.ts:2522-2526`).

### Retention maintenance
`reconcile` (`src/session-checkout-module.ts:1362-1609`) replays interrupted journals, classifies finalized/retained, and calls `cleanupExpiredRetained` (`src/session-checkout-module.ts:4483-4503`) and `enforceWorktreeKeepCount` (`src/session-checkout-module.ts:4511-4533`). `retainFinalized` keeps a frozen environment for `retain_24h` / `retain_3d` / `retain_manual` (`retentionExpiresAt`, `src/session-checkout-module.ts:186-190`).

### Next iteration
After a successful cleanup, `beginNextIterationTarget` (`src/session-checkout-module.ts:4535-4744`) reuses the delivered owner's immutable cwd path and recreates the detached worktree at the predecessor session branch tip, preserving the iteration chain.

## Connections

- [[index]] — plugin entry; builds adapters and mounts the returned `SessionCheckoutModule`.
- [[session-checkout-apply-module]] — the `SessionCheckoutApplyEngine` port consumed here (`applyEngine.plan/preview/finalize/rollback/checkpoint/commitIsolated/reviewIsolated/assessPreviewRecovery`, `src/session-checkout-apply.ts:279-317`).
- [[ports]] — `SessionCheckoutDependencies`, `ManagedCheckoutRecord`, `ManagedCheckoutJournal`, `SessionBindingRecord`, `ManagedCheckoutsRegistry`.
- [[types]] — `SessionCheckoutPhase`, `WorktreeRetentionMode`, `WorktreeCleanupReason`, `ManagedCheckoutDelivery`, view types.
- [[managed-worktree-path]] — `createManagedWorktreePathCandidates`, `createManagedWorktreeRepositoryKey`, `createSessionBranchCandidates` (`src/session-checkout-module.ts:40-45`) used for container/candidate/branch naming.
- [[checkpoint]] — `checkpointGenerationForRecord` (`src/session-checkout-module.ts:39`) used in inspect/delivery views.
- [[concurrent-session-guard]] — `detectLocalBranchRace` (`src/session-checkout-module.ts:76`) backing the branch-race notice.
- [[creation-failure]] — `WorktreeCreationFailure` (`src/session-checkout-module.ts:37`) used by `finishFailedCreation`.
- [[console-host]] / console control plane — consumes `runtimeContext`, `inspect`, and the cleanup/summary views.

## Known Issues

- **Local write on legacy records is blocked by design** (`refuseLegacyLocalWrite`, `src/session-checkout-module.ts:1656-1668`): once a `sessionBranch` exists, the legacy apply/preview/finalize "write Local" paths return `operation_not_allowed`. Historical records created before session branches were adopted are forced through `finish` instead (and `operateFinish` additionally refuses `applyBaseOid`-bearing legacy records at `src/session-checkout-module.ts:3369-3375`).
- **`apply`/`preview` operations are effectively legacy**: the delivery model moved to session-branch-only commits, so `operateApply`/`operatePreview` still exist (`src/session-checkout-module.ts:2187-2344`, `2633-2783`) but the model is now expected to use `finish` (session-branch delivery).
- **Windows file-handle blocking**: `CHECKOUT_CLEANUP_TIMEOUT_MS = 120_000` (`src/session-checkout-module.ts:172`) bounds startup cleanup; transient EBUSY/EPERM are retried via `retryTransientCleanup` (`src/session-checkout-module.ts:172-184`) but a permanently held directory (e.g. a lingering agent process) surfaces as `quarantine_busy`/`directory_busy` cleanup and must be resolved manually.
- **`branchRaceGuard`/`branchRaceWindowMs` rely on reflog**: if `git.branchCreationTimes` is absent, the guard stays silent (`src/session-checkout-module.ts:1002-1027`) rather than guessing — concurrent Local branches from another live session are then undetected.
- **`attachWorktreeBranch` port may be absent**: when not provided, the Worktree stays detached HEAD and `ensureSessionBranch` warns and lets delivery proceed (`src/session-checkout-module.ts:810-817`); such records are later adopted onto a fresh branch at `finish`.
- **Empty-container reclamation is best-effort only**: `collectEmptyManagedContainer` (`src/session-checkout-module.ts:2963-2977`) and `removeEmptyDirectoryTree` calls never delete user bytes; a non-empty same-named directory is left untouched and rejected as untrusted (`src/session-checkout-module.ts:2963-3005`).
- **Keep-count eviction does not use `operateDiscard`**: `enforceWorktreeKeepCount` (`src/session-checkout-module.ts:4511-4533`) evicts finalized/retained worktrees via `cleanupFinalized` directly because `operateDiscard` only accepts `ready`/`recovery_required` phases and would silently fail on delivered records.

---
title: Session Checkout Module
type: module
source_files:
  - src/session-checkout-module.ts
  - src/index.ts
  - src/ports.ts
  - src/types.ts
  - src/session-checkout-apply.ts
  - tests/session-checkout-module.test.ts
  - src/checkpoint.ts
  - src/creation-failure.ts
  - src/managed-worktree-path.ts
tags: [session-checkout, state-machine, worktree, delivery, recovery, apply-engine]
---

## Overview

`createSessionCheckoutModule(dependencies)` in `src/session-checkout-module.ts` is the
core state machine for dsh-git-worktree. It was ported from Domi and owns the
**receipt-first Local Preview**, **rollback/finalize**, **project acceptance
slots**, **crash recovery**, and **fingerprint CAS** flows, while adapting
ownership to a separate source Local Session and target owner Session
(`src/session-checkout-module.ts:78-84`).

It is **host-agnostic**: every Git, filesystem, registry, session-lookup, and
apply-engine concern is injected through the `SessionCheckoutDependencies` port
(`src/ports.ts:567-608`). The module talks only to these ports and a JSON
checkout registry (`ManagedCheckoutsRegistry`, `src/ports.ts:542-547`).

Key delivery semantic (changed vs Domi): delivery now **only commits onto the
Worktree's own session branch and never touches Local** (`src/session-checkout-module.ts:1649-1668`
`refuseLegacyLocalWrite`). The Worktree is attached to a dedicated
`sessionBranch` (`refs/heads/feat/sess-<id>…`) at creation and at every
`finish`/`markReadyForReview` via `ensureSessionBranch` /
`attachSessionBranch` (`src/session-checkout-module.ts:754-860`).

The module returns a `SessionCheckoutModule` object (`src/index.ts:113-219`)
whose every mutation goes through `withBindingLock` (`src/session-checkout-module.ts:1289-1324`),
a single-writer queue that also supports a concurrent read-only `maintenance`
bypass for background `reconcile` / retention cleanup / keep-count sweeps.

## Key Components

The module is a single factory `createSessionCheckoutModule` (`src/session-checkout-module.ts:237-5303`).
Inside it, many private closures form the state machine; the factory returns the
public `SessionCheckoutModule` surface (`src/session-checkout-module.ts:5202-5302`).

### Public API returned by the factory (`src/index.ts:113-219`)

All wrappers acquire `withBindingLock`; read-only list/inspect calls opt into the
`allowConcurrentInspect` maintenance bypass.

- `inspect(sessionId)` → `SessionTargetView` — `inspectAvailable` (`src/session-checkout-module.ts:1344`),
  spins on the binding lock and routes to `inspectLocal` (`src/session-checkout-module.ts:257-283`)
  or `inspectIsolated` (`src/session-checkout-module.ts:881-989`).
- `runtimeContext(sessionId, cwd?)` (`src/session-checkout-module.ts:1077-1220`) — **synchronous**
  registry-only snapshot that builds the model guidance string for the current
  target (Local vs Isolated, every delivery state, branch-race notice).
- `refreshBranchRaceGuards()` (`src/session-checkout-module.ts:1002-1027`) — fills
  `branchRaceCache` with per-Local-root branch creation times for the synchronous
  race guard.
- `preflight(sessionId, expectedRevision)` (`src/session-checkout-module.ts:2553-2631`) — read-only
  sync-readiness check before apply/preview.
- `preflightPreviewRecovery(sessionId, expectedRevision, expectedReviewId, expectedPreviewId)`
  (`src/session-checkout-module.ts:2434-2520`) — deterministic detached-preview
  recovery assessment + proof.
- `runExclusiveSessionMutation(sessionId, operation)` — runs `operation(target)`
  under the exclusive lock.
- `bind(sessionId, choice)` (`src/session-checkout-module.ts:5216-5219` → `bindTarget`) — binds a
  Local or creates an Isolated target (`bindTarget`, `src/session-checkout-module.ts:4841-5200`).
- `createIsolatedTarget(sourceSessionId, targetSessionId, createOptions?)` (`src/session-checkout-module.ts:5220-5245`)
  — reserves a distinct owner session; same-id form = in-place upgrade.
- `beginNextIteration(sessionId, expectedRevision)` (`src/session-checkout-module.ts:4535-4744`) — recreates a
  cleaned delivered owner's immutable cwd as the next isolated iteration.
- `resumeRevision(...)` (`src/session-checkout-module.ts:1997-2068`) — invalidates an unsynced review.
- `prepareReviewRegeneration(...)` (`src/session-checkout-module.ts:2070-2101`),
  `preparePreviewRecoveryAnalysis(...)` (`src/session-checkout-module.ts:2103-2137`),
  `createPreviewRecoveryHandoff(...)` (`src/session-checkout-module.ts:2139-2185`) — persist Host
  one-shot continuations/proofs and create handoff worktrees.
- `markReadyForReview(sessionId, input)` (`src/session-checkout-module.ts:1684-1765`) — prepares a review
  and attaches the session branch first (so the acceptance fingerprint records
  the real HEAD identity).
- `operate(input)` (`src/session-checkout-module.ts:3816-3834` → `operateTarget`) — dispatches the
  `SessionCheckoutOperation` actions `apply | finish | preview | checkpoint |
  rollback_preview | finalize_preview | retry_cleanup | discard | recover`
  (`src/session-checkout-module.ts:3819-3827`).
- `isAutoDeliverEnabled()` (`src/session-checkout-module.ts:5266`) — live autoDeliver flag.
- `listManagedWorktrees(input?)` (`src/session-checkout-module.ts:4069-4078`), `listManagedWorktreesForSession(sessionId, input?)` (`src/session-checkout-module.ts:4080-4094`)
- `pruneMergedBranchesForSession(sessionId, input?)` (`src/session-checkout-module.ts:4170-4186`),
  `autoPruneStaleMergedBranches(olderThanDays)` (`src/session-checkout-module.ts:4193-4213`) — safe
  `git branch -d` style prune (`pruneMergedBranchesInRepo`, `src/session-checkout-module.ts:4103-4168`).
- `mergeBranchForSession(sessionId, input)` (`src/session-checkout-module.ts:4215-4291`) — merges a
  session-owned worktree branch into Local HEAD (forward) or vice versa (reverse),
  with ownership gating and acceptance-slot refusal.
- `listAbandonedWorktreeSnapshots(sessionId)` (`src/session-checkout-module.ts:4293-4309`),
  `restoreAbandonedWorktreeSnapshot(sessionId, checkoutId)` (`src/session-checkout-module.ts:4311-4334`).
- `manageManagedWorktreeForSession(sessionId, input)` (`src/session-checkout-module.ts:4336-4355`) and
  `manageManagedWorktree(input)` (`src/session-checkout-module.ts:4357-4434`) — owner-scoped
  discard / set_retention / set_permanent / clear_sidebar_badge / cleanup.
- `inspectManagedWorktreeCleanup(input?)` (`src/session-checkout-module.ts:4004-4016`) and
  `bulkCleanupManagedWorktrees(candidates)` (`src/session-checkout-module.ts:4018-4067`).
- `resolveManagedRoot(checkoutId)` (`src/session-checkout-module.ts:4457-4459`),
  `resolveRoots(checkoutId)` (`src/session-checkout-module.ts:4466-4469`) — registry read of both boundaries.
- `observeManagedCheckout(checkoutId)` (`src/session-checkout-module.ts:4436-4450`),
  `observeManagedCheckouts(checkoutIds)` (`src/session-checkout-module.ts:4453-4456`) — validated observation.
- `cleanupExpiredRetained(now?)` (`src/session-checkout-module.ts:4483-4503`),
  `enforceWorktreeKeepCount()` (`src/session-checkout-module.ts:4511-4533`),
  `reconcile()` (`src/session-checkout-module.ts:1362-1609`).

### Core internal closures (state machine)

- `withBindingLock(operation, {allowConcurrentInspect?})` (`src/session-checkout-module.ts:1289-1324`) —
  single-writer mutex with a `maintenance` read-only bypass; maintenance drains
  running inspects before handing the queue back to mutations.
- `inspectLocal` / `inspectIsolated` (`src/session-checkout-module.ts:257-283`, `881-989`) — build
  `SessionTargetView`; `inspectIsolated` validates identity, restores
  `recovery_required` → `ready` when paths are intact, and reports project
  acceptance-slot ownership.
- `validateManagedCheckoutDetailed` (`src/session-checkout-module.ts:597-653`) /
  `validateManagedCheckout` (`src/session-checkout-module.ts:655-662`) — canonical-path + Git-common-dir +
  branch-fingerprint identity proof (returns `valid | invalid | unavailable`).
- `ensureSessionBranch` (`src/session-checkout-module.ts:810-860`) and `attachSessionBranch`
  (`src/session-checkout-module.ts:754-796`) — attach the Worktree to its own session branch, trying
  `createSessionBranchCandidates` names; falls back to detached-HEAD if the port
  `attachWorktreeBranch` is absent.
- `refuseLegacyLocalWrite` (`src/session-checkout-module.ts:1656-1668`) — blocks legacy apply/preview/
  finalize that would write Local when a `sessionBranch` exists.
- `operateApply` (`src/session-checkout-module.ts:2187-2344`), `operatePreview` (`src/session-checkout-module.ts:2633-2783`),
  `operateFinalizePreview` (`src/session-checkout-module.ts:3166-3310`), `operateRollbackPreview`
  (`src/session-checkout-module.ts:3339-3444`), `operateFinish` (`src/session-checkout-module.ts:3339-3574`),
  `operateCheckpoint` (`src/session-checkout-module.ts:1767-1995`), `operateDiscard`
  (`src/session-checkout-module.ts:3752-3916`), `operateRecover` (`src/session-checkout-module.ts:3752-3814`) —
  each is an `operate` action handler with exclusive-lock CAS (`expectedRevision`),
  stale-target re-validations, acceptance-slot checks, and journal-based crash recovery.
- `cleanupFinalized` (`src/session-checkout-module.ts:2979-3163`) — the safety-critical removal chain:
  fingerprint CAS, worktree removal, detached-residue quarantine, container
  reclamation, and terminal `delivered` transition.
- `detachPreviewAfterLocalDrift` (`src/session-checkout-module.ts:2785-2822`) — turns a
  `preview_active` into `preview_detached` when Local drifted during rollback/finalize.
- `reconcile` (`src/session-checkout-module.ts:1362-1609`) — startup/idle sweep that replays journals to
  deterministic states, reclassifies finalized/retained, and triggers cleanup of
  expired retained worktrees.

### Constants & module-level helpers

- `UNVERSIONED_OID='unversioned'`, `UNVERSIONED_REF='WORKING_TREE'` (`src/session-checkout-module.ts:91-92`)
- `RETENTION_24H_MS`, `RETENTION_3D_MS` (`src/session-checkout-module.ts:93-94`), `DEFAULT_WORKTREE_RETENTION`
  imported from `src/types.ts:39`.
- `CHECKOUT_CLEANUP_TIMEOUT_MS = 120_000` (`src/session-checkout-module.ts:108`) and `withCleanupTimeout`
  (`src/session-checkout-module.ts:108-126`) — bounding startup cleanup so one stuck record cannot
  block app start.
- `TRANSIENT_CLEANUP_RETRY_DELAYS_MS = [100, 300, 800]` (`src/session-checkout-module.ts:97`) and
  `retryTransientCleanup` / `isTransientCleanupError` (`src/session-checkout-module.ts:163-184`) — retry on
  EBUSY/EPERM/EACCES/ENOTEMPTY.
- `persistedCleanupReason` / `cleanupReasonForMessage` (`src/session-checkout-module.ts:142-161`) — structured
  cleanup reason with legacy prose fallback.
- `pathForIdentity`, `pathsEqual`, `resolvedPathsEqual`, `pathIsWithin`, `branchNameOf`
  (`src/session-checkout-module.ts:192-235`) — Windows-safe path/branch normalization helpers.
- `sha256Facts` / `canonicalJson` / `recoveryGeneration` (`src/session-checkout-module.ts:2415-2432`) — the
  sha256 of canonical JSON that forms the preview-recovery proof `generation`.

### Domain data structures (port types in `src/ports.ts`)

`ManagedCheckoutRecord` (`src/ports.ts:487-540`) — the durable per-checkout record. All fields:
`checkoutId`, `predecessorCheckoutId?`, `projectId`, `projectName`, `ownerSessionId`,
`sourceSessionId?`, `localRoot`, `managedRoot`, `managedGitRoot`, `gitCommonDir`,
`gitDir`, `baseOid`, `applyBaseOid?` (last applied isolated snapshot, not the
user-visible base), `previousReview?`
(`ManagedWorktreeCheckpointRecord[]`, `src/ports.ts:333-350`), `recoveryContinuation?`,
`abandonedSnapshotOid?`, `abandonedSnapshotAt?`, `permanent?`,
`sidebarBadgeClearedRevision?`, `sourceRef`, `sessionBranch?`
(`refs/heads/feat/sess-…`, absent on historical records), `sessionTopic?`,
`phase` (`SessionCheckoutPhase`, `src/types.ts:18-27`), `delivery`
(`ManagedCheckoutDelivery` union, `src/ports.ts:449-485`), `journal`
(`ManagedCheckoutJournal | null`, `src/ports.ts:331`), `revision`.

`ManagedCheckoutDelivery` (`src/ports.ts:449-485`) is a discriminated union on
`state`: `working` | `ready_for_review` | `preview_active` | `preview_detached` |
`finalized` | `retained` | `delivered`, each carrying the review/preview/proof
and cleanup bookkeeping (e.g. `cleanup: 'pending'|'blocked'|'scheduled'`,
`cleanupMessage?`, `cleanupReason?`, `retention`, `retainedAt`, `expiresAt`).

`ManagedCheckoutJournal` (`src/ports.ts:331`) separates `create` journals (with
`creation: WorktreeCreationEvidence`, `predecessorCheckoutId`, `managedDirectoryIdentity`,
`cleanupQuarantinePath`) from mutation journals (`operation` ∈
`apply | preview | checkpoint | rollback_preview | finalize_preview | finish |
cleanup`, see field set at `src/ports.ts:299-329`).

`ManagedCheckoutsRegistry` (`src/ports.ts:542-547`): version-2 JSON, `revision`,
`sessionBindings: Record<sessionId, SessionBindingRecord>`,
`managedCheckouts: Record<checkoutId, ManagedCheckoutRecord>`. Persisted atomically
by `SessionCheckoutRegistryPort` (`src/ports.ts:549-552`); every mutation bumps
`revision` (`updateManagedCheckout`, `src/session-checkout-module.ts:1670-1682`).

`SessionBindingRecord` (referenced from `src/ports.ts`) ties a session to
`{kind:'local'}` or `{kind:'isolated', checkoutId}` plus `projectId`,
`ownerSessionId`, `sourceRef`, `sourceOid`, `inheritedFromSessionId?`, `revision`.

### Test surface

`tests/session-checkout-module.test.ts` (3145 lines) exercises bind/apply/preview/
finalize/rollback/checkpoint/discard/recover, retention cleanup, keep-count
eviction, prune, merge gating, abandoned-snapshot restore, and the
legacy-prose→structured cleanup-reason fallback (`tests/session-checkout-module.test.ts:3098-3142`).
It builds adapters via `createNodeSessionCheckoutDependencies`
(`tests/session-checkout-module.test.ts:152`) and a real Git repo.

## Architecture

## Data Flow

## Architecture

Every public method acquires `withBindingLock` (`src/session-checkout-module.ts:1289-1324`), a single-writer
queue. Background sweeps (`reconcile`, `cleanupExpiredRetained`, `enforceWorktreeKeepCount`)
and `preflightPreviewRecovery` opt into the read-only `maintenance` bypass so they
never block interactive mutations; the bypass first drains in-flight inspects
(`maintenance_draining`, `src/session-checkout-module.ts:1312-1319`) before a mutation takes the queue.

```text
            ┌──────────────────────────────────────────────────────────┐
            │  Host / Tools / Session-Target runtimeContext (index.ts)   │
            └───────────────┬──────────────────────────────────────────┘
                            │ bind / operate / cleanup / inspect
                            ▼
            ┌──────────────────────────────────────────────────────────┐
            │  SessionCheckoutModule (returned object, lines 5202-5302)   │
            │  withBindingLock (exclusive | maintenance | draining)       │
            └───────┬───────────────────────────────┬──────────────────┘
                    │                                │
          ┌─────────▼──────────┐            ┌────────▼───────────────┐
          │ bindTarget          │            │ reconcile / cleanup... │
          │ (create / attach    │            │ (maintenance bypass)   │
          │  sessionBranch)     │            └────────┬───────────────┘
          └─────────┬──────────┘                     │
                    │ writes                         │ reads/writes
                    ▼                                ▼
            ┌──────────────────────────────────────────────────────────┐
            │  ManagedCheckoutsRegistry (JSON, ports.ts:542-547)          │
            │  sessionBindings + managedCheckouts, revision bumped        │
            └───┬───────────────────┬────────────────────┬───────────────┘
                │                   │                    │
   ┌────────────▼─────┐  ┌──────────▼─────────┐  ┌───────▼──────────────┐
   │ SessionCheckout   │  │ SessionCheckout     │  │ SessionCheckout       │
   │ GitPort           │  │ FilesPort           │  │ ApplyEngine          │
   │ (worktree,        │  │ (canonicalize,      │  │ (plan/preview/        │
   │  inspect,         │  │  removeTree,        │  │  finalize/rollback/   │
   │  removeWorktree)  │  │  quarantine)        │  │  checkpoint, CAS)     │
   └───────────────────┘  └────────────────────┘  └──────────────────────┘
                ▲                   ▲                    ▲
                └──────── Local ─────┴──── Managed Worktree (isolated) ─┘
```

Two checkout kinds coexist through a binding (`src/session-checkout-module.ts:4841-4945`):
- **Local** (`kind:'local'`): the project's own repo; no worktree; direct Local work.
- **Isolated** (`kind:'isolated', checkoutId`): a detached managed worktree
  (`createDetachedWorktree`, `src/session-checkout-module.ts:5102`) on its own `sessionBranch`, with the
  Local project root as its `localRoot`. Delivery commits only on the session
  branch; Local is never written (`refuseLegacyLocalWrite`, `src/session-checkout-module.ts:1656-1668`).

Project **acceptance slot** (`holdsProjectAcceptanceSlot` / `findProjectAcceptanceHolder`,
`src/session-checkout-module.ts:2346-2364`) serializes preview/rollback/finalize/finish per `localRoot`: only one
managed checkout in `preview_active` / `preview` / `rollback_preview` /
`finalize_preview` / `finish` journal state may occupy a project's Local at a time.

## Data Flow

### Create / bind (Local → Isolated)
`bindTarget` (`src/session-checkout-module.ts:4841-5200`) resolves the project, inspects the repo, picks a
trusted sibling/fallback container, writes a `preparing` record + binding, calls
`dependencies.git.createDetachedWorktree` (`src/session-checkout-module.ts:5102`), then `attachSessionBranch`
(`src/session-checkout-module.ts:4778`), optionally carries local WIP (`carryLocalWorkInProgress`,
`src/session-checkout-module.ts:4778-4804`), and flips the record to `ready`. Failures roll back via
`finishFailedCreation` (`src/session-checkout-module.ts:498`) and `markRecoveryRequired` (`src/session-checkout-module.ts:523`).

### Delivery (the central flow)
1. `markReadyForReview` (`src/session-checkout-module.ts:1684-1765`) ensures the session branch, snapshots the
   review (`applyEngine.inspectReview`), and records `delivery.state='ready_for_review'`.
2. `operate preview` (`src/session-checkout-module.ts:2633-2783`) runs `applyEngine.plan`, retains preview
   artifacts (`retainPreviewArtifacts`, `src/session-checkout-module.ts:2366-2372`), and sets `preview_active`.
3. `operate finalize_preview` / `operate finish` (`src/session-checkout-module.ts:3166-3310`,
   `3339-3574`) commits onto the session branch via `applyEngine.finalize` /
   `commitIsolated` (`src/session-checkout-apply.ts:83-106`), sets `finalized`, optionally retains
   (`retainFinalized`, `src/session-checkout-module.ts:2931-2957`) or cleans up (`cleanupFinalized`,
   `src/session-checkout-module.ts:129-313`), and optionally best-effort pushes (`pushLocalBranchBestEffort`,
   `src/session-checkout-module.ts:129-140`).
4. `cleanupFinalized` transitions the record to `delivered` + `discarded` phase after the
   worktree is removed and the empty container reclaimed (`collectEmptyManagedContainer`,
   `src/session-checkout-module.ts:2963-2977`).

### Recovery & drift
If Local drifts during a preview (`stale_local`/`preview_modified`), `operateRollbackPreview`
/`operateFinalizePreview` call `detachPreviewAfterLocalDrift` (`src/session-checkout-module.ts:2785-2822`)
→ `preview_detached`, then `preflightPreviewRecoveryTarget` (`src/session-checkout-module.ts:2434-2520`)
produces a sha256 `WorktreePreviewRecoveryProof` (`recoveryGeneration`,
`src/session-checkout-module.ts:2430-2432`) that gates retry.

### Retention maintenance
`reconcile` (`src/session-checkout-module.ts:1362-1609`) replays interrupted journals, classifies
finalized/retained, and calls `cleanupExpiredRetained` (`src/session-checkout-module.ts:4483-4503`) and
`enforceWorktreeKeepCount` (`src/session-checkout-module.ts:4511-4533`). `retainFinalized` keeps a frozen
environment for `retain_24h` / `retain_3d` / `retain_manual` (`retentionExpiresAt`,
`src/session-checkout-module.ts:186-190`).

### Next iteration
After a successful cleanup, `beginNextIterationTarget` (`src/session-checkout-module.ts:4535-4744`) reuses the
delivered owner's immutable cwd path and recreates the detached worktree at the
predecessor session branch tip, preserving the iteration chain.

## Connections

- [[index]] — plugin entry; builds adapters and mounts the returned `SessionCheckoutModule`.
- [[session-checkout-apply-module]] — the `SessionCheckoutApplyEngine` port consumed here (`applyEngine.plan/preview/finalize/rollback/checkpoint`, `src/session-checkout-module.ts:2373-2380` references the engine).
- [[ports]] — `SessionCheckoutDependencies`, `ManagedCheckoutRecord`, `ManagedCheckoutJournal`, `SessionBindingRecord`.
- [[types]] — `SessionCheckoutPhase`, `WorktreeRetentionMode`, `ManagedCheckoutDelivery`, view types.
- [[managed-worktree-path]] — `createManagedWorktreePathCandidates`, `createManagedWorktreeRepositoryKey`, `createSessionBranchCandidates` (`src/session-checkout-module.ts:40-45`) used for container/candidate/branch naming.
- [[checkpoint]] — `checkpointGenerationForRecord` (`src/session-checkout-module.ts:39`) used in inspect/delivery views.
- [[concurrent-session-guard]] — `detectLocalBranchRace` (`src/session-checkout-module.ts:76`) backing the branch-race notice.
- [[creation-failure]] — `WorktreeCreationFailure` (`src/session-checkout-module.ts:37`) used by `finishFailedCreation`.
- [[console-host]] / console control plane — consumes `runtimeContext`, `inspect`, and the cleanup/summary views.

## Known Issues

- **Local write on legacy records is blocked by design** (`refuseLegacyLocalWrite`,
  `src/session-checkout-module.ts:1656-1668`): once a `sessionBranch` exists, the legacy apply/preview/finalize
  "write Local" paths return `operation_not_allowed`. Historical records created
  before session branches were adopted are forced through `finish` instead.
- **`apply`/`preview` operations are effectively legacy**: the delivery model moved
  to session-branch-only commits, so `operateApply`/`operatePreview` still exist
  (`src/session-checkout-module.ts:1210-1367`, `2633-2783`) but the model is now expected to use `worktree_deliver` (`finish`).
- **Windows file-handle blocking**: `CHECKOUT_CLEANUP_TIMEOUT_MS = 120_000`
  (`src/session-checkout-module.ts:108`) bounds startup cleanup; transient EBUSY/EPERM are retried via
  `retryTransientCleanup` (`src/session-checkout-module.ts:172-184`) but a permanently held directory (e.g. a
  lingering agent process) surfaces as `quarantine_busy`/`directory_busy` cleanup
  and must be resolved manually.
- **`branchRaceGuard`/`branchRaceWindowMs` rely on reflog**: if the git port lacks
  `branchCreationTimes`, the guard stays silent (`src/session-checkout-module.ts:1002-1027`) rather than
  guessing — concurrent Local branches from another live session are then
  undetected.
- **`attachWorktreeBranch` port may be absent**: when not provided, the Worktree stays
  detached HEAD and `ensureSessionBranch` warns and lets delivery proceed
  (`src/session-checkout-module.ts:810-817`); such records are later adopted onto a fresh branch at `finish`.
- **Empty-container reclamation is best-effort only**: `collectEmptyManagedContainer`
  (`src/session-checkout-module.ts:2963-2977`) and `removeEmptyDirectoryTree` calls never delete user bytes;
  a non-empty same-named directory is left untouched and rejected as untrusted.

---

# Session Checkout State Machine

`createSessionCheckoutModule`（src/session-checkout-module.ts:237-5303）是插件核心：一套从 Domi 移植来的 session-checkout 状态机（模块自述见 78-84），保留 receipt-first Local Preview、回滚/finalize、项目验收槽、崩溃恢复与 fingerprint CAS，同时把所有权适配到 Harness 分离的 source Local Session 与 target owner Session。全部持久化状态落在 `ManagedCheckoutsRegistry`（version 2，src/ports.ts:542-547）。

当前版本最关键的语义变化是**交付不再写回 Local**：每个受管 Worktree 在创建阶段就挂到属于自己会话的分支（`refs/heads/feat/sess-<会话>[--<主题>]`），`finish` 只在这条会话分支上提交，Local 的工作区、索引与 HEAD 全程不被读写；合并由 `mergeBranchForSession` 显式发起。为此模块新增了 `branchNameOf`（src/session-checkout-module.ts:233-235，注释 232）、`attachSessionBranch`（754）、`ensureSessionBranch`（810）、`refuseLegacyLocalWrite`（1656）与 `explainApplyConflict`（1626）。同一语义已延伸到验收侧：`markReadyForReviewTarget`（1684）在 `inspectReview` 之前先 `ensureSessionBranch`，让验收指纹记录交付期真实的 HEAD 身份（详见「生命周期操作」）。

## Overview

模块管理「受管 Worktree」（Managed Worktree）的全生命周期：绑定会话、创建、检查点（Checkpoint）、预览（Preview）、Review、交付（Deliver/Finish）、保留（Retain）与清理（Cleanup）。三个机制贯穿始终：

- **互斥**：所有变更操作经 `withBindingLock`（src/session-checkout-module.ts:1289-1324）串行化；maintenance 模式允许只读 `inspect` 并发旁路，但必须先关闭旁路并排空已启动的 inspect。
- **崩溃恢复**：`record.journal` 记录可重放的 receipt，`reconcile()`（1362-1609）按 journal 的 step 把记录确定性收敛到 `ready` 或 `recovery_required`。
- **CAS / 指纹**：`revision`、`isolatedFingerprint`、`reviewId`、`generation` 共同构成乐观并发校验；Preview 用 receipt 记录写入前后的 Local 指纹（`localFingerprintBefore`/`localFingerprintPreview`，src/ports.ts:386-387），任何漂移都让预览进入 `preview_detached`。

本地适配特性（相对 Domi 原版）：

- **会话分支交付**：创建即挂分支，交付只提交会话分支（754、810、3339）。
- **清理收敛超时**：`withCleanupTimeout`（108-126）给启动期清理/收敛加 120s 兜底，单条被占用的损坏记录不再卡死应用启动。
- **自动推送**：Finish 成功后尽力推送**会话分支**（`pushLocalBranchBestEffort`，src/session-checkout-module.ts:129-140）；失败降级为「已跳过」备注。
- **仓库移动修复**：`git worktree repair` 重连断链 Worktree（`repairStaleWorktreeLinks`，4806）。
- **Worktree 根目录配置**：`worktreesRoot` + 主题命名（路径候选生成在 `createManagedWorktreePathCandidates`，src/managed-worktree-path.ts:132-175）。
- **继承未提交修改**：`carryLocalWorkInProgress`（4778），仅当基点等于 Local HEAD 时生效（门控 5106-5110）。
- **放弃快照**：带未提交内容放弃前固化快照（`operateDiscard` 3586，快照写入 3701-3720）。
- **常驻标记**：`permanent` 豁免保留期到期清理与 LRU 逐出（`set_permanent` 4399-4414；豁免点 4471、4500）。
- **侧栏徽章清除**：`clear_sidebar_badge`（4415-4426）记录 `sidebarBadgeClearedRevision` 且刻意不 bump revision。
- **空容器回收**：worktree 删除后若项目容器已空且无其他记录引用，一并回收（`collectEmptyManagedContainer`，2963-2977，注释 2950-2953）。
- **并发分支竞态守卫**：`refreshBranchRaceGuards`（1002）/`branchRaceNotice`（1035）检测同仓库内其他活跃会话新近创建的分支，命令后启动的会话先隔离。

## Key Components

### 模块级常量与工具函数（src/session-checkout-module.ts）

- **`ResolvedSessionProject`**（86-89）：`session` + `project` 的内部解析结果。
- **`UNVERSIONED_OID` / `UNVERSIONED_REF`**（91-92）：未版本化项目的伪 OID 与伪 ref（`'unversioned'` / `'WORKING_TREE'`）。
- **`RETENTION_24H_MS` / `RETENTION_3D_MS`**（93-94）：保留期时长。
- **`CLEANUP_IDENTITY_CHANGED_MESSAGE`**（95）、**`CLEANUP_RESIDUE_MESSAGE`**（96）：清理被身份变更/残留证据挡住时的固定文案。
- **`TRANSIENT_CLEANUP_RETRY_DELAYS_MS`**（97）：`[100, 300, 800]`。
- **`CHECKOUT_CLEANUP_TIMEOUT_MS`**（106）：`120_000`，Windows 文件占用下防止清理无限挂起；注释（99-105）明确「不做取消」——超时后后台操作继续跑完，只保证启动收敛先走。
- **`withCleanupTimeout(checkoutId, operation)`**（108-126）：`Promise.race` 实现的 120s 兜底超时，超时返回 `null` 并 `console.warn`（118）。
- **`pushLocalBranchBestEffort(push, localRoot)`**（129-140）：尽力推送，返回 `WorktreePushOutcome`，异常降级为 `{status:'failed', message}`。
- **`cleanupReasonForMessage(message)`**（142-150）：把历史清理文案（zh/en 关键词成对匹配，注释 143-144）映射回结构化 `WorktreeCleanupReason`，只兜底旧持久化记录。
- **`persistedCleanupReason(delivery)`**（156-161，文档 152-155）：优先读结构化 `cleanupReason`，否则回退文案映射。
- **`isTransientCleanupError(error)`**（163-170）：识别 `EBUSY` / `EPERM` / `EACCES` / `ENOTEMPTY` 等瞬时错误（code 或 message）。
- **`retryTransientCleanup(operation)`**（172-184）：按 `TRANSIENT_CLEANUP_RETRY_DELAYS_MS` 退避重试，最多 4 次尝试。
- **`retentionExpiresAt(mode, retainedAt)`**（186-190）：保留到期时间戳；`retain_24h` → +24h、`retain_3d` → +3d、`retain_manual` → `null`。
- **`pathForIdentity(path)`**（192-198）：realpath + 分隔符归一，仅用于身份比较；失败退回 `resolve` 结果。
- **`pathsEqual(left, right)`**（200-206）：Windows 下大小写不敏感的 realpath 后比较。
- **`resolvedPathsEqual(left, right)`**（209-215）：canonical 路径与 registry 原始路径比较，**不做 realpath**（注释 208），防止 Junction 冒充原目录。
- **`pathIsWithin(candidate, root)`**（222-230，文档 217-221）：判断 `candidate` 是 `root` 本身或嵌套其下（包含而非相等，Session 常 `cd` 进子目录）。
- **`branchNameOf(ref)`**（233-235，注释 232）：`refs/heads/x` → `x`；其他 ref（含 detached 的 `HEAD`）返回 `null`。会话分支名一律经它从 ref 取出。

### 工厂内基础件（绑定/校验/视图）

- **`requireSession(sessionId)`**（240-244）、**`resolveSessionProject(sessionId)`**（246-255，缺项目根时抛 `project_root_missing`，251-253）。
- **`inspectLocal(binding)`**（257-283）：Local 目标视图；先挂 `statusPromise` 并 noop catch 防 rejection 冒泡（261-263）。
- **`projectPreviousReview(record)`**（285-293）：保留 `reviewId`/`iteration`/`summary`/`suggestedCommitMessage`（**完整保留，不截断**），仅 `changedFiles.slice(0, 50)`（291）。
- **`projectCheckpoint(record)`**（295-305）：checkpoint 记录 → 视图投影。
- **`projectDelivery(record, commitInLocalHistory)`**（307-372）：按 `delivery.state` 投影 review/preview/proof/cleanup 视图；`cleanupMessage` 经 `hostPersistedCleanupMessage` 重译（345、358）。
- **`bindingForManagedRecord(record)`**（374-387）：从托管记录合成绑定记录（持久化绑定不匹配时兜底）。
- **`recoveryView(binding, record?, dirty)`**（389-412）：`phase` 为 `discarded` 时保持 `discarded`，否则 `recovery_required`（394）。
- **`validateCommittedLocalCheckout(binding, record)`**（414-436）、**`committedFollowupView(binding, record)`**（438-485）：commit 是权威交付事实，残余环境异常只影响 cleanup，不把会话降级（注释 472）；用 `git.isAncestor` 判 `commitInLocalHistory`（450-461，无法判定时为 `null`）。
- **`saveCreationEvidence`**（487-496）、**`finishFailedCreation(sessionId, checkoutId, error, previous?)`**（498-521）、**`markRecoveryRequired(record)`**（523-538，revision/phase 双 CAS 在 529）。
- **`ValidatedManagedCheckout`**（540-545）、**`ManagedCheckoutValidationResult`**（547-550）：`valid` / `invalid` / `unavailable` 三态。
- **`checkpointHeadInvariantHolds(record, managedRoot, headOid)`**（561-586）：先结构校验（sequence 连续、checkpointId/reviewId 去重，561-569），再并行取证（`readInternalArtifact` + `isAncestor` 链，`Promise.all`，581-578），最后验证末位 checkpoint 是 `headOid` 祖先（585）。
- **`validateManagedCheckoutDetailed(binding, record, requireCreateBase)`**（597-653）：多重身份判定——binding 四元组与 `managedRoot` 存在（593-599）、canonicalize 后 `pathsEqual(canonicalProjectRoot, canonicalLocalRoot)`（609）、`resolvedPathsEqual` 比较 canonical 与 registry 原始路径（623-625）、`pathsEqual` 比较 `snapshot.root`/`commonDir`/`gitDir`（626-630）；`requireCreateBase` 时要求 `headOid === baseOid`（631），否则校验检查点不变式（632）；`catch` 返回 `{status:'unavailable'}`（640-643，注释 641），避免瞬时 Git/I/O 故障把健康 Worktree 判成 `recovery_required`。
- **`validateManagedCheckout`**（655-662）：上面函数的薄包装，只取 valid。
- **`ValidatedCleanupResidue`**（664-668）、**`directoryIdentitiesEqual`**（669-671）、**`hasCleanupRemovalReceipt`**（673-677）、**`hasLegacyCleanupResidueEvidence`**（679-686）、**`validateCleanupLocalIdentity`**（688-704）、**`validateDetachedCleanupResidue`**（706-744）：清理链的身份与残留取证。
- **`attachSessionBranch({localRoot, managedRoot, sessionId, topic})`**（754-796，文档 737-744）：把新建/重建的 Worktree 从 detached HEAD 挂到会话分支。端口缺 `attachWorktreeBranch` 时 `console.warn` 并返回 `null`（751-755，退回旧 detached 行为）；否则取 `inspect(managedRoot).headOid`（756-757），对 `createSessionBranchCandidates`（src/managed-worktree-path.ts:63-75）逐个候选拼 `refs/heads/${branch}`，先用 `resolveLocalBranchTip` 取该名现有 tip（762）。**同名分支已存在时不再无条件跳过**：若 `existing === headOid`，或 `existing` 是当前 HEAD 的祖先（`isAncestor`），则视为可复用，用 `attach(managedRoot, branchRef, headOid, existing)`（CAS 到该 old 值）挂上去并复验（763-776）；其余情况换下一个候选名——**绝不覆盖带别的提交的同名分支**。分支不存在时 `attach(managedRoot, branchRef, headOid, null)` 创建，同样复验后才返回 `{branch, branchRef}`（778-784）。
- **`EnsureSessionBranchResult`**（798-800）：`{ok:true, record}` | `{ok:false, code, message}`。
- **`ensureSessionBranch(record)`**（810-860，文档 793-800）：交付前保证 Worktree 挂在自己的会话分支上。端口缺 `attachWorktreeBranch` 时 warn 并原样 `ok:true`（802-808）；`inspect` 失败 → `recovery_required`（809-812）；`record.sessionBranch` 已存在且 `headRef` 相符则直接 `ok`（813-816）；有记录但 HEAD 已离开（例如 checkpoint 把 HEAD 写成游离提交）→ attach 回记录值并复验（817-829），attach 失败**另建独立会话分支**（注释 827，绝不覆盖别人提交）；`attachSessionBranch` 返回 null → `git_operation_failed`（838-839）；成功后 `updateManagedCheckout` 同时把 `sessionBranch` 与 `sourceRef` 写成同一个 branch ref（840-848）；记录不存在 → `checkout_missing`。**历史记录（旧版本创建、detached、`sourceRef` 记的是 Local 当时所在分支——可能属于别的会话）不复用 `sourceRef` 作为交付目标**（注释 795-798），`sourceRef` 从此只作「分叉来源」展示。
- **`validateCleanupQuarantine(record)`**（862-879）：校验隔离目录身份（目录名形如 `.dsh-wt-cleanup--<checkoutId 前 8 位>--<operationId>`，858）。
- **`inspectIsolated(binding, persistRecovery = true)`**（881-989）：`discarded` + `delivered` 走 `committedFollowupView`（884-895）；`recovery_required` 且 `journal === null` 且目录仍在时，先用 `validateManagedCheckoutDetailed` 尝试修复回 `ready`（897-918）；只有 `invalid` 才持久化 recovery（943，注释 942），瞬时 `unavailable` 允许下次重试；命中 `ready_for_review` 时计算 `reviewSlot`（950-956、973-978）。
- **`getPersistedBinding(sessionId)`**（991-993）。
- **`branchRaceCache` / `branchRaceWindowMsDefault`**（999-1000）：分支创建时间快照（keyed by Local root）与 30 分钟默认窗口（注释 986-989：system-prompt 契约禁止 await，快照由异步刷新写入、同步读取）。
- **`refreshBranchRaceGuards()`**（1002-1027）：`branchRaceGuard === false` 直接返回（994）；端口缺 `branchCreationTimes` 时静默（995）；从 sessionBindings、managedCheckouts 与 `listLiveSessions`（1002-1007）收集项目根，逐根探测 reflog 分支创建时间写入缓存（1008-1017）；探测失败保留上一份快照（1014-1016）。
- **`branchRaceNotice(sessionId, registry)`**（1035-1075，文档 1020-1025）：守卫关闭或活跃会话 <2 返回空串（1027-1031）；排除已隔离的会话（1038-1043）；调 `detectLocalBranchRace`（1047-1055，窗口取 `branchRaceWindowMs` 配置，1053）；命中竞态时返回一段给模型的指引——后启动的会话**不得**在 Local 建分支/直接提交，必须先 `worktree_create` 隔离（1057-1064）。
- **`runtimeContext(sessionId, cwd?)`**（1077-1220）：给模型的运行时指引。完全无绑定时只返回竞态通知（1070-1071）。Local 分支按 pending 记录给出提示：无 pending → 普通 Local 工作（1088-1096，末尾附 `branchRaceNotice`，1089-1095）；`preview_active` → 只读（1097-1103）；`preview_detached` → 恢复（1104-1110）；pending 属于别的会话 → handoff pending（1114-1120，注释 1111-1113）；属于本会话 → 回到该 checkout 工作（1121-1126）。Isolated 分支：`recovery_required`（1130-1132）、`discarded`+`delivered`（1137-1144，注释 1132-1135）、`finalized`/`retained` 且 cwd 不在 `managedRoot`（1150-1165，注释 1144-1149）时输出「允许在 Local 工作」等提示，消除「人在 Local 却禁止写 Local」矛盾；否则输出 Isolated Checkout 权威 cwd 与 write-guard 规则（1166-1210，cwd 不在 Worktree 内时追加绝对路径规则 1180-1185）；checkpoint（1187-1192）与各 delivery state 的专属指引在 1192-1209（`working` 态按 `autoDeliver` 分叉为 `worktree_deliver` 或 `worktree_ready_for_review`，1200-1202）。
- **`resolveBinding(sessionId)`**（1222-1257）：`project_mismatch` / `target_unselected`（1247）；`discarded`+`delivered` 且 `workspace.root` 等于 `managedRoot` 时放行（1221-1237）。
- **`BindingOperationMode`**（1259）与锁队列变量（1252-1260）；**`prepareMaintenanceReadySignal`**（1271-1273）、**`beginMaintenanceInspect`**（1275-1278）、**`finishMaintenanceInspect`**（1284-1287）。
- **`withBindingLock(operation, {allowConcurrentInspect?})`**（1289-1324）：排他/维护锁队列；maintenance 退出时先置 `maintenance_draining` 并等待已启动 inspect 排空（1303-1310）。
- **`inspectTarget`**（1326-1330）、**`inspectDuringMaintenance`**（1332-1342，只读不写 registry，注释 1327-1328）、**`inspectAvailable`**（1344-1360）。
- **`reconcile()`**（1362-1609）：清 `discarded` 空壳 cwd 与空容器（1363-1373，注释 1364-1365）；回收 predecessor 记录中断的下一轮创建（1374-1402）；`finalized` 记录经 `withCleanupTimeout` 进 `cleanupFinalized`（1582-1588，注释 1585、调用 1586）；按 journal step 确定性收敛（finalize/finish `updating_ref`/`replacing_index` → `recovery_required` 1409-1424；checkpoint 恢复 1425-1503；preview planning 1504-1521，注释 1512；finalize/finish planning 1522-1536，注释 1527；artifacts_retained 1537-1551）；其余 `preparing`/`mutating` → `recovery_required`（1552-1561）；结尾 `cleanupExpiredRetained`（1589）。
- **`operationError(code, message, target?)`**（1611-1617）。
- **`explainApplyConflict({localRoot, conflictingFiles})`**（1626-1647，文档 1610-1616）：把 `apply_conflict` 分类并给出 `resolveHint`——先 `listUntrackedFiles` 取未跟踪集，命中即 `untracked_conflict`（1627-1632）；否则 `git.status().dirty` → `local_dirty`（1633-1636）；否则 `content_conflict`（1637）。
- **`refuseLegacyLocalWrite(record, binding)`**（1656-1668，文档 1640-1646）：`if (!record.sessionBranch) return null`（1660）；否则旧的「写回 Local」操作一律返回 `operation_not_allowed`，并把 `inspectIsolated(binding)` 作为 target 指路 `worktree_deliver`。调用点：`operateApply`（2214-2215）、`operatePreview`（2655-2656）、`operateFinalizePreview`（3197-3198）。
- **`updateManagedCheckout(checkoutId, mutate)`**（1670-1682）：CAS 写 registry。

### 生命周期操作

- **`markReadyForReviewTarget(sessionId, input)`**（1684-1765）：owner + isolated 校验（1679-1682）；`summary`/`suggestedCommitMessage` trim 后非空且通过 `isValidCommitMessage`、`tests ≤ 20`（1683-1687）；长度上限 **summary ≤240、detailsMarkdown ≤12000、validationSummary ≤500、单条 test command/summary ≤500**（1688-1695）——**`suggestedCommitMessage` 没有长度上限**（只要求合法）；record 门（1696-1700）；`inspectIsolated` 后 phase 非 `ready` → `recovery_required`（1701-1704）；**先 `ensureSessionBranch`（注释 1705-1707，调用 1708-1709；历史记录在此补建分支，否则交付时 headRef 从 DETACHED 变会话分支导致指纹必被误判 `stale_isolated`）**；`inspectReview` 用 `applyBaseOid ?? baseOid`（1711-1715）；写 `ready_for_review` delivery 含 `isolatedFingerprint`/`isolatedHeadOid`（1720-1753）。
- **`operateCheckpoint`**（1767-1995）：`requestId` 幂等重放（1777-1792，`exactReplay` 才返回原 checkpoint）、`expectedGeneration` 64 位 hex CAS（1769）、revision 双检（1793-1795、1810-1818）、`preview_active` 先 rollback（1820-1873）；journal `planning` → `updating_ref` 并 `retainInternalArtifact('checkpoints/<id>')`（1905-1930，retain 在 1928）；提交后 delivery 回 `working` 并追加 checkpoint 记录（1968-1978）。幂等重放与崩溃恢复的端到端行为见 tests/session-checkout-module.test.ts:721-790、792-829。
- **`resumeRevisionTarget`**（1997-2068）、**`prepareReviewRegenerationTarget`**（2070-2101）、**`preparePreviewRecoveryAnalysisTarget`**（2103-2137）、**`createPreviewRecoveryHandoffTarget`**（2139-2185）。
- **`operateApply`**（2187-2344）：旧的「写回 Local」路径。开头插入 legacy 门（2214-2215）；冲突时用 `explainApplyConflict` 填充 `reason` + `resolveHint`（2233-2250，调用 2235）；`invalid_plan`/`stale_local`/`stale_isolated` 可证明未触碰 Local，恢复 `ready`（2315-2324，注释 2321）；成功更新 `applyBaseOid`（2327-2333）。
- **`holdsProjectAcceptanceSlot`**（2346-2352）、**`findProjectAcceptanceHolder`**（2354-2364）、**`retainPreviewArtifacts`**（2366-2372，四个内部 ref）、**`releasePreviewArtifactsBestEffort`**（2374-2380）、**`previewArtifactsMatch`**（2382-2394）。
- **`blockedPreviewRecovery`**（2396-2413）、**`canonicalJson`**（2415-2424，递归键排序并过滤 `undefined`）、**`sha256Facts`**（2426-2428）、**`recoveryGeneration`**（2430-2432）。
- **`preflightPreviewRecoveryTarget`**（2434-2520）：`not_owner` → `checkout_unavailable` → `stale_target` → `not_preview_detached` → `checkout_unavailable` → `artifacts_missing` → `assessPreviewRecovery` → `git_error`；项目验收槽被占时 rollback/finalize 都置 `{status:'blocked', code:'project_acceptance_busy'}`（2464-2473）；facts 含 `receiptFingerprint`、`localFingerprint` 等（2474-2490），二次 CAS（2491-2501）与二次工件校验（2502-2504）后返回 `{status:'assessed', localModified:false, proof:{…, generation}}`（2505-2506）。
- **`recoveryProofMatches(left, right)`**（2522-2526）、**`blockedPreflight`**（2528-2551）、**`preflightTarget(sessionId, expectedRevision)`**（2553-2631）：`applyEngine.preflight` 后按 `changedFiles` 空 → `already_in_local`、`localHeadOid !== baseOid` → `local_advanced`、否则 `ready`（2616-2621）。
- **`operatePreview`**（2633-2783）：legacy 门（2655-2656）之后写 journal `planning`，`plan` 冲突则回 `ready` 并用 `explainApplyConflict` 返回 `apply_conflict`（2683-2700）；`beforeWrite` 内 `retainPreviewArtifacts` + delivery `preview_active` + journal `artifacts_retained`（2740-2750）；成功返回 `{status:'previewed'}`（2765-2773）。
- **`detachPreviewAfterLocalDrift`**（2785-2822）：`preview_active` → `preview_detached`。
- **`operateRollbackPreview`**（2824-2929）：detached 恢复需 `recoveryProofMatches` + `proof.rollback.status === 'safe'`（2836-2853）；成功按 `resumeRevision` 回 `working` 或 `ready_for_review`（2909-2917）。
- **`retainFinalized(record, retention)`**（2931-2957）：`finalized` → `retained`，写 `retention`/`retainedAt`/`expiresAt`/`cleanup:'scheduled'`。
- **`collectEmptyManagedContainer(managedGitRoot, excludedCheckoutId)`**（2963-2977，注释 2950-2953）：worktree 移除后回收空项目容器（`removeEmptyDirectoryTree` 遇任何条目返回 false，绝不删用户字节）。
- **`cleanupFinalized(record, {allowLegacyResidue?})`**（2979-3163）：非 `finalized`/`retained` 直接 `directory_busy`（2999-3001）；`identity_changed` 直接复述（3002-3009）；`hasLegacyCleanupResidueEvidence` 且 `managedGitRoot` 仍在 → `detached_residue`（3010-3012）；`beginRemoval` 写 journal `{operation:'cleanup', step:'removing_worktree', managedDirectoryIdentity}`（3020-3042）；`quarantineAndRemove` 走 `.dsh-wt-cleanup--…` 隔离目录（3044-3074）；`removeWorktree` 后若目录仍在，转 `validateDetachedCleanupResidue` + 隔离链（3100-3104）；指纹不符 → `modified_after_finalize`（3092-3093）；收尾 `collectEmptyManagedContainer`（3115）、`releaseApplyBaseBestEffort`（3116），并把记录写成 `phase:'discarded'` + `delivery.state:'delivered'`（3117-3132）；`catch` 打 `console.warn('[session-checkout] finalized Worktree cleanup failed:', error)`（3135），`finalized` 记 `cleanup:'pending'`、`retained` 记 `cleanup:'blocked'`（3142-3150）。
- **`operateFinalizePreview`**（3166-3310）：`preview_detached` 时先验 `proof.finalize.status === 'safe'`（3178-3195），再走 legacy 门（3197-3198）；`applyEngine.finalize` 的 `beforeCommit` 写 journal `updating_ref` + `commitOid`（3221-3229）；成功写 `delivery.state:'finalized'` 与 `proof`（3252-3277），`retention !== 'cleanup'` 走 `retainFinalized`（3280-3290），否则 `cleanupFinalized`（3291-3300）。
- **`operateRetryCleanup`**（3312-3337）：仅 `finalized`/`retained` 可重试（3315-3317），`allowLegacyResidue: true`（3318）。
- **`operateFinish`**（3339-3574）：见下节「会话分支交付链」。
- **`releaseApplyBaseBestEffort(record)`**（3576-3584）：释放 apply base 与内部 artifact，失败只 `console.warn`（3573）。
- **`operateDiscard`**（3586-3750）：`preview_active` 需 `rollbackPreview` 或拒绝（3607-3614）；带 creation 证据的记录 → `recovery_unsafe`（3639-3641）；`recovery_required` 且目录已消失 → 直接 `discarded`（3643-3652）；`ready` 且目录连同 git 顶层都没了 → prune + 清台账（3653-3670，注释 3653-3655）；脏工作树或未交付 checkpoint 需 `confirmDirty`（3695-3700），并先 `snapshotAbandonedWorktree` 固化放弃快照（3704-3720，注释 3702-3704），快照失败则中止放弃（数据保护优先）。
- **`operateRecover`**（3752-3814）：终态记录（`delivered`/`discarded`/`finalized`/`retained`）不允许被 Recover 复活（3760-3765，注释 3758-3759）；`journal.operation === 'create'` 且有 creation 证据 → `recovery_unsafe`（3767-3769）；有 journal 时先 `reconcile()` 收敛再判断（3770-3784，注释 3771-3772）；验证通过后写回 canonical 路径并转 `ready`（3794-3803）。
- **`operateTarget`**（3816-3834）：按 `action` 分发（`apply`/`finish`/`preview`/`checkpoint`/`rollback_preview`/`finalize_preview`/`retry_cleanup`/`discard`/`recover`，3810-3818），`SessionCheckoutError` 转 `operationError`（3820-3823）。

### 会话分支交付链（`operateFinish`，3339-3574）

1. 身份与前置校验：owner（3334-3336）→ 只接受 isolated（3337-3339）→ `commitMessage` trim 非空（3340-3343）且通过 `isValidCommitMessage`（3345-3347，**无长度上限**，多行/Unicode 正文原样提交，见 tests/session-checkout-module.test.ts:442-463）→ `checkout_missing`（3348-3349）→ `stale_target`（3350-3352）→ `expectedReviewId` 不符 → `stale_target`（3353-3358）。
2. **历史 wrote-to-Local 记录**（`record.applyBaseOid && (state === 'working' || state === 'ready_for_review')`，3360-3366，注释 3359）→ `operation_not_allowed`。
3. 状态门：`phase !== 'ready'` 或 `preview_active`/`preview_detached` → `operation_not_allowed`（3367-3369）；项目验收槽被占 → `project_acceptance_busy`（3370-3377）；`inspectIsolated` 后 `phase` 非 `ready` → `recovery_required`（3379-3382）。
4. 引擎能力探测：`reviewIsolated` / `commitIsolated` 缺失 → `operation_not_allowed('thisVersionCannotDeliverToASessionBranch')`（3388-3393；两者先 `.bind(engine)`，因为这些方法经 `this` 访问内部状态，注释 3387）。
5. 写 journal `{operation:'finish', step:'committing_session_branch', baseOid: applyBaseOid}`（3395-3410）。
6. **`ensureSessionBranch(mutating)`**（3423，注释 3421-3422，实现见 810）；失败 → `restoreReady()`（3412-3419）+ 错误。`branchRef = deliverable.sessionBranch ?? null`（3428-3429）。
7. `reviewIsolated({isolatedPath: deliverable.managedRoot, baseOid: applyBaseOid})`（3431-3435）；`expectedReviewId` 下 reviewId/指纹/HEAD 任一不符 → 回 `working` + `stale_isolated`（3436-3454）。
8. 沿用 `ready_for_review` 的 review，否则现造一个（3456-3474），写 `delivery.state:'ready_for_review'`（3475-3488）。
9. **`commitIsolated({isolatedPath, baseOid, commitMessage, branchRef})`**（3490-3495）；失败 → `restoreReady()`（3496-3499）。
10. 写 `delivery.state:'finalized'` 与 `proof`：`localBranch: branchNameOf(branchRef)`、`localHeadBefore/After` 等（3501-3528）。
11. 自动 push：`(liveConfigValue(dependencies.autoPush) ?? true) && dependencies.git.pushBranch` → `pushLocalBranchBestEffort`（3535-3538；推的是**会话分支**，新分支通常无 upstream，注释 3533-3534）。
12. 收尾：`retention !== 'cleanup'` 走 `retainFinalized`（3540-3552），否则 `cleanupFinalized`（3553-3564）；两者都带 `branch`（3548/3559）与 `push`。

### 清理资格、列表与管理

- **`managedIteration`**（3836-3839）、**`managedUpdatedAt`**（3841-3849）。
- **`summarizeManagedWorktree(record, includeDiagnostics = false)`**（3851-3942）：快速列表必须保守且不扫描 Git/磁盘（注释 3845）；`includeDiagnostics` 时才算 dirty、隔离/残留、`approximateBytes`（3850-3876）；`state` 由 `staleRoot` / `phase` / `delivery.state` 组合得出（3878-3895）；`canCleanup` 仅在诊断完成且非 dirty 时为 true（3931）。
- **`cleanupBlocked(reason, message, revision)`**（3944-3946）、**`inspectCleanupForRecord(record)`**（3948-4002）：按 `delivery.state` 与指纹给出 `safe` / `retained` / `blocked` 及结构化原因；retention 窗口未过或 `retain_manual` → `retained`（3986-3991）；否则 `safe`（3992）。
- **`inspectManagedWorktreeCleanup`**（4004-4016）、**`bulkCleanupManagedWorktrees`**（4018-4067，逐条 revision CAS 后 `cleanupFinalized`）、**`listManagedWorktrees`**（4069-4078）、**`listManagedWorktreesForSession`**（4080-4094）。
- **`pruneMergedBranchesInRepo`**（4103-4168，文档 4087-4093）：只删「已完全合并」的本地分支（tip 可达主干，注释 4106-4107）；主干名从 `origin/HEAD` → `init.defaultBranch` 推断（4108-4110），合并基准优先主干、退回当前 HEAD（4111-4113）；`olderThanDays` 需 `branchTipTimes`，端口缺该能力时直接拒绝而非放宽（4115-4123）。行为测试见 tests/session-checkout-module.test.ts:1187-1213（基础 prune）、1215-1235（年龄过滤）、1237-1260（维护清扫）、2982-3004（以主干而非当前分支为基准）。
- **`pruneMergedBranchesForSession`**（4170-4186）、**`autoPruneStaleMergedBranches`**（4193-4213，逐项目失败记为 skipped 条目，绝不抛出）。
- **`mergeBranchForSession(sessionId, input)`**（4215-4291）：先注册 `record.sessionBranch`，再补各 Worktree 的当前分支（4229-4238）；来源分支等于 Local 当前分支直接 `invalid_input`（4241-4243）；**分支找不到时区分**「属于另一个会话 X 的分支」（`not_owner` 并指名 owner，4244-4260）；真实合并（非 dryRun）前检查项目验收槽（4266-4271，注释 4263-4265）；`direction === 'reverse'` 把 Local 当前分支合进任务 worktree，冲突现场留在 worktree（4272-4279，注释 4273）。验收槽门控与归属守卫见 tests/session-checkout-module.test.ts:3006-3028、3030-3071。
- **`listAbandonedWorktreeSnapshots`**（4293-4309）、**`restoreAbandonedWorktreeSnapshot`**（4311-4334）。
- **`manageManagedWorktreeForSession`**（4336-4355）、**`manageManagedWorktree`**（4357-4434，`discard`（4352-4367）/ `set_retention`（4368-4389）/ `set_permanent`（4399-4414）/ `clear_sidebar_badge`（4415-4426，刻意不 bump revision，注释 4407-4409）/ 清理 fall-through（4418-4424））。
- **`observeManagedCheckout`**（4436-4450）、**`observeManagedCheckouts`**（4453-4456，注释 4435）、**`resolveManagedRoot`**（4457-4459）、**`resolveRoots`**（4466-4469，文档 4444-4448，纯读 registry 不碰 Git）。
- **`retryableCleanupBlock`**（4477-4481，注释 4454-4459：暂时性占用必须留在定期重试里）、**`cleanupExpiredRetained(now)`**（4483-4503）：只清 `cleanup:'scheduled'` 或 `directory_busy`/`quarantine_busy` 阻塞的到期记录，`permanent` 豁免（4471），逐条经 `withCleanupTimeout`（4479）。
- **`enforceWorktreeKeepCount()`**（4511-4533，文档 4488-4493）：`permanent` 与进行中记录豁免（4498-4503），只逐出最旧的 `finalized`/`retained`；**必须走 `cleanupFinalized`**（4511）——不能复用 `operateDiscard`，它对 finalized/retained 一律返回 `operation_not_allowed`（注释 4508-4510）。
- **`beginNextIterationTarget(sessionId, expectedRevision)`**（4535-4744）：要求 predecessor 已是 `discarded`+`delivered`（4536-4538）、owner 与 cwd 归属匹配（4546-4551，in-place 会话 rooted 在 Local 边界也放行，注释 4541-4545）、旧路径未复活（4553-4555）、Local 项目与 git 身份未变（4557-4569）；**迭代以「上一轮会话分支 tip」为 `iterationBaseOid`**（`branchNameOf(predecessor.sessionBranch) ?? branchNameOf(predecessor.sourceRef)` → `resolveLocalBranchTip`，4577-4598，注释 4574-4576），解析不到才退回 `snapshot.headOid`；重建后 `attachSessionBranch` 重新挂会话分支并同步 `sourceRef`/`sessionBinding.sourceRef`（4661-4686）。
- **`copyWorktreeincludeFiles`**（4750-4772，注释 4729-4732）、**`carryLocalWorkInProgress`**（4778-4804，注释 4757-4760）、**`repairStaleWorktreeLinks`**（4806-4839，仓库移动后的 `git worktree repair` 搬迁见 tests/session-checkout-module.test.ts:2493-2521）。
- **`bindTarget(sessionId, choice, createAttempt, requestStartedAt, sourceSessionId, createOptions)`**（4841-5200）：in-place 升级仅认 `createIsolatedTarget(sourceSessionId, sourceSessionId, options)` 调用形（4862-4872）；终态 replaced binding 复用（4873-4897）；支持 `createOptions.branch` 以指定本地分支 tip 为 `baseOid`（4950-4971，测试见 tests/session-checkout-module.test.ts:259-277）；路径候选（8/12/32 位身份，4974-4984，主题命名 4981-4983）与容器信任校验（4995-5027，同名未知目录非空即拒绝、空目录回收重建；EPERM/EACCES 报 OS 错误而非笼统信任错误，5034-5044）；创建路径在 `createDetachedWorktree` 成功后立即 `attachSessionBranch`（5102-5122），`readyRecord` 同时写 `sessionBranch` 与 `sourceRef` 为同一个 branch ref（5136-5138，注释 5117-5118），`binding.sourceRef` 同步（5143-5145）；基点等于 Local HEAD 且 `inheritLocalChanges !== false` 时 `carryLocalWorkInProgress`（5125-5127）；失败按 `WorktreeCreationFailure` / 残留是否清掉决定 `markRecoveryRequired` 还是重试一次（5152-5199）。

### 工厂返回的公开接口（5202-5302）

| 成员 | 行号 | 说明 |
| --- | --- | --- |
| `inspect` | 5203 | → `inspectAvailable` |
| `runtimeContext` | 5204 | 模型运行时指引 |
| `refreshBranchRaceGuards` | 5205 | 异步刷新分支创建时间快照（竞态守卫数据源） |
| `preflight` | 5206-5208 | 加锁 → `preflightTarget` |
| `preflightPreviewRecovery` | 5209-5212 | `allowConcurrentInspect: true`（5211） |
| `runExclusiveSessionMutation` | 5213-5215 | 独占变更包装 |
| `bind` | 5216-5219 | 加锁 → `bindTarget` |
| `createIsolatedTarget` | 5220-5245 | in-place（targetSessionId === sourceSessionId，5223）与独立会话两种形态 |
| `beginNextIteration` | 5246-5248 | 下一轮迭代 |
| `resumeRevision` | 5249-5251 | 恢复编辑 Review |
| `prepareReviewRegeneration` | 5252-5254 | `stale_isolated` 时重出 Review |
| `preparePreviewRecoveryAnalysis` | 5255-5257 | 预览恢复分析 |
| `createPreviewRecoveryHandoff` | 5258-5260 | 预览恢复移交 |
| `markReadyForReview` | 5261-5263 | 标记 Review |
| `operate` | 5264 | 操作分发 |
| `isAutoDeliverEnabled` | 5266-5267 | 暴露 autoDeliver 实时取值（注释 5266） |
| `listManagedWorktrees` / `listManagedWorktreesForSession` | 5268-5269 | 只读列表，不加全局锁（注释 5267） |
| `pruneMergedBranchesForSession` / `autoPruneStaleMergedBranches` | 5270-5275 | 分支修剪 |
| `mergeBranchForSession` | 5276-5278 | 合并会话分支 |
| `listAbandonedWorktreeSnapshots` / `restoreAbandonedWorktreeSnapshot` | 5279-5282 | 放弃快照 |
| `manageManagedWorktreeForSession` | 5283-5285 | 受限管理工作台 |
| `inspectManagedWorktreeCleanup` | 5286 | 清理资格检查 |
| `bulkCleanupManagedWorktrees` / `manageManagedWorktree` | 5287-5288 | 批量清理与管理工作台 |
| `resolveManagedRoot` / `resolveRoots` | 5289-5290 | 路径解析 |
| `observeManagedCheckout` / `observeManagedCheckouts` | 5291-5292 | 纯读观察 |
| `cleanupExpiredRetained` / `enforceWorktreeKeepCount` | 5293-5300 | `allowConcurrentInspect: true`（5295、5299） |
| `reconcile` | 5301 | `allowConcurrentInspect: true` |

### 类型定义（src/types.ts）

- **`SessionTargetRef`**（11-14）：`unselected` | `local` | `isolated{checkoutId}`。
- **`SessionCheckoutKind`**（16）、**`SessionCheckoutPhase`**（18-27）：`preparing` / `ready` / `applying`（弃用）/ `mutating` / `recovery_required` / `finalized` / `retained` / `discarded`。
- **`WorktreeValidationStatus`**（29）：`passed` / `failed` / `partial` / `not_run`。
- **`WorktreeRetentionMode`**（32）：`cleanup` / `retain_24h` / `retain_3d` / `retain_manual`；**`DEFAULT_WORKTREE_RETENTION`**（39）= `retain_24h`。
- **`WorktreeCleanupReason`**（41-46）：`directory_busy` / `modified_after_finalize` / `identity_changed` / `detached_residue` / `quarantine_busy`。
- **`WorktreeValidationItem`**（48-52）：`command`、`status`、`summary?`。
- **`WorktreeCheckpointView`**（55-63）：`checkpointId`、`sequence`、`reviewId`、`createdAt`、`summary`、`validationStatus`、`changedFiles`。
- **`WorktreeReviewView`**（65-77）：`reviewId`、`iteration`、`preparedAt`、`detailsMarkdown?`、`summary`、`validationStatus`、`validationSummary?`、`tests`、`changedFiles`、`suggestedCommitMessage`。
- **`WorktreeDeliveryProofView`**（79-90）：`localBranch`、`localHeadBefore`、`localHeadAfter`、`changedFiles`、`validationStatus?`、`validationSummary?`、`commitInLocalHistory`（89）。会话分支交付后 `localBranch` 记的是**会话分支名**。
- **`WorktreeDeliveryView`**（92-127）：7 种状态联合——`working{iteration}`、`ready_for_review{review}`、`preview_active{review, previewedAt}`、`preview_detached{review, previewedAt, detachedAt, reason, attemptedAction}`、`finalized{review, commitOid, proof?, cleanup, cleanupMessage?, cleanupReason?}`、`retained{…, retention, retainedAt, expiresAt, cleanup:'scheduled'|'blocked', cleanupMessage?, cleanupReason?}`、`delivered{iteration, commitOid, proof?, deliveredAt}`。
- **`WorktreeApplyPreflightBlockedReason`**（129-137）、**`WorktreeApplyPreflightFacts`**（139-150）、**`WorktreeAcceptanceBlockerView`**（152-157）、**`WorktreeApplyPreflightView`**（159-172）：`ready`/`local_advanced`/`already_in_local` | `conflict{conflictingFiles, conflictDetails?}` | `blocked{reason, message, blocker?}`，三者都带 `localModified: false`。
- **`SessionTargetProjectView`**（174-177）、**`SessionTargetCheckoutView`**（179-184）、**`SessionTargetSourceView`**（186-190）、**`SessionTargetCurrentView`**（192-196）。
- **`SessionTargetView`**（198-216）：`project`、`checkout`、`source`、`current`、`ownership`、`dirty`、`revision`、`delivery?`、`checkpoints?`、`checkpointGeneration?`（211）、`reviewSlot?`（213）、`reviewSlotOwnerSessionId?`（215）。
- **`SessionTargetBindChoice`**（218-220）。
- 操作接口（222-353）：`SessionCheckoutOperationBase`(222-225)、`SessionCheckoutApplyOperation`(227-229)、`SessionCheckoutFinishOperation`(231-237, 含 commitMessage/retention/expectedReviewId)、`SessionCheckoutPreviewOperation`(239-241)、`SessionCheckoutCheckpointOperation`(243-249, 含 commitMessage/expectedReviewId/expectedGeneration/requestId)、`WorktreePreviewRecoveryActionBlockReason`(251-256)、`WorktreePreviewRecoveryRollbackAction`(258-260)、`WorktreePreviewRecoveryFinalizeAction`(262-270)、`WorktreePreviewRecoveryProof`(273-291, 含 generation/receiptFingerprint/localFingerprint/rollback/finalize/blocker?)、`WorktreePreviewRecoveryPreflightBlockedReason`(293-299)、`WorktreePreviewRecoveryPreflightView`(301-312)、`SessionCheckoutRollbackPreviewOperation`(314-320, 含 resumeRevision?/recoveryProof?)、`SessionCheckoutFinalizePreviewOperation`(322-328)、`SessionCheckoutRetryCleanupOperation`(330-332)、`SessionCheckoutDiscardOperation`(334-338)、`SessionCheckoutRecoverOperation`(340-342)；`SessionCheckoutOperation`(344-353) 联合上述。
- 结果类型：`SessionCheckoutAppliedResult`(355-359)、`Previewed`(361-365)、`Checkpointed`(367-372)、`PreviewRolledBack`(374-378)、`PreviewDetached`(380-386)、`WorktreePushOutcome`(389-392)、`SessionCheckoutFinishedResult`(394-411, 含 branch(404)/cleanup/cleanupMessage?/cleanupReason?/push?(410))、`ManagedWorktreeCleanupEligibility`(413)、`ManagedWorktreeCleanupBlockReason`(415-423)、`ManagedWorktreeCleanupView`(426-431)、`BulkCleanupManagedWorktreeCandidate`(433-436)、`BulkCleanupManagedWorktreesResult`(438-441)、`ManagedWorktreeSummaryView`(452-480, path-free 投影，含 `permanent?`(470)/`approximateBytes`(473)/`canCleanup`(475)/`cleanup?`(477)/`activeSessionIds?`(479))、`PruneMergedBranchEntry`(483-487)、`PruneMergedBranchesView`(489-494)、`AbandonedWorktreeSnapshotView`(497-503)。
- `ApplyBaseStrategy`(505-509)、`ApplyConflictDetail`(510-514)、`CONFLICT_DETAIL_FILE_LIMIT=6`(517)、`CONFLICT_DETAIL_DIFF_LIMIT=4096`(518)、`MergeLocalBranchOutcome`(520)、`MergeLocalBranchResult`(522-529)、`MergeBranchForSessionView`(531-540, 含 `direction: 'forward' | 'reverse'`(539))。
- `ApplyConflictReason`(548)：`content_conflict` / `local_dirty` / `untracked_conflict`。
- `SessionCheckoutConflictResult`(550-566, 含 `reason`(553)/`conflictDetails?`(563)/`resolveHint?`(565))、`Discarded`(568-571)、`Recovered`(573-576)、`SessionCheckoutOperationErrorResult`(578-583)、`SessionCheckoutOperationResult`(585-595)。
- `SESSION_CHECKOUT_ERROR_CODES`(597-627) 及 `SessionCheckoutErrorCode`(629)、`SessionCheckoutFailure`(631-634)。

### 端口契约（src/ports.ts）

- `SessionCheckoutSessionRecord`(21-26)、`SessionCheckoutProjectRecord`(28-32)、`SidebarDirectoryMembership`(34-38)、`SessionCheckoutLookupPort`(40-60，含可选 `listLiveSessions?`(59)，竞态守卫据此枚举活跃会话)。
- `GitCheckoutSnapshot`(62-69)：`root`、`commonDir`、`gitDir`、`branch`、`headOid`、`headRef`。
- `BranchOverviewEntry`(71-77)、`TagOverviewEntry`(79-90, `name`/`oid`/`commitOid`/`annotated`/`message`/`pushed`)、`GraphLogCommit`(92-101)、`InitialCommitPreflight`(103-107)。
- `SessionCheckoutGitPort`(109-230)：核心方法 `inspect`(119)/`findContainingWorktreeRoot`(121)/`status`(122)/`createDetachedWorktree`(123)/`attachWorktreeBranch?`(131，CAS 到 `expectedOldOid`，文档 124-130)/`removeWorktree`(133)/`retainApplyBase`(134)/`releaseApplyBase`(135)/`retainInternalArtifact`(136)/`readInternalArtifact`(138)/`releaseInternalArtifacts`(139)/`isAncestor`(141)；本地适配可选方法 `resolveLocalBranchTip?`(118)、`listLocalBranches?`(116)、`listWorktreeincludeFiles?`(142)、`pushBranch?`(148)、`repairWorktreeLinks?`(154)、`pruneWorktrees?`(159)、`branchOverview?`(165)、`defaultBranch?`(170)、`branchTipTimes?`(175)、`branchCreationTimes?`(181)、`deleteLocalBranch?`(183)、`mergeLocalBranch?`(189)、`graphLog?`(191)、`createLocalBranch?`(193)、`switchLocalBranch?`(195)、`listTags?`(201)、`createTag?`(203)、`deleteLocalTag?`(205)、`pushTag?`(210)、`deleteRemoteTag?`(212)、`captureLocalWip?`(217)、`applyWorktreePatch?`(219)、`listUntrackedFiles?`(221)、`snapshotAbandonedWorktree?`(227)、`restoreAbandonedSnapshot?`(229)。
- `DirectoryIdentity`(232-236)：`device`/`inode`/`birthtimeNs`。
- `SessionCheckoutFilesPort`(238-255)：`exists`(239)/`canonicalize`(240)/`inspectDirectoryIdentity`(241)/`ensureDirectory`(242)/`removeEmptyDirectoryTree`(244)/`quarantineDirectoryTree`(246)/`removeDirectoryTree`(248)/`measureDirectoryBytes`(250)/`readTextFile?`(251)/`copyFile?`(252)/`isSymbolicLink?`(254)。
- `SessionBindingRecord`(257-267)：`sessionId`、`projectId`、`projectName`、`target`、`ownerSessionId`、`inheritedFromSessionId?`、`sourceRef`、`sourceOid`、`revision`。
- `ManagedCheckoutJournalBase`(269-272)、`WorktreeCreationEvidence`(274-286)、`ManagedCheckoutCreateJournal`(288-292)、`ManagedCheckoutMutationJournal`(294-329, operation 枚举含 `cleanup`(295)，step 枚举含会话分支交付专用的 `committing_session_branch`(299) 及 `cleanupQuarantinePath?`(328))、`ManagedCheckoutJournal`(331)。
- `ManagedWorktreeCheckpointRecord`(333-350, 幂等键 `requestId?`(338)/`requestedRevision?`(340)/`generation?`(341))、`ManagedWorktreePreviousReviewRecord`(352-359)、`ManagedWorktreeReviewRecord`(361-374)、`ManagedPreviewReceipt`(376-395, 含 `localWorkingTreeOid`(388)/`localIndexTreeOid`(389)/`previewWorkingTreeOid`(390)/`isolatedSnapshotOid`(393) 四个回滚锚点)、`ManagedDeliveryProof`(397-405)。
- 恢复续传类型：`ManagedApplyConflictRecoveryContinuation`(407-415)、`ManagedReviewRegenerationContinuation`(417-422)、`ManagedPreviewRecoveryAnalysisContinuation`(424-431)、`ManagedPreviewRecoveryHandoffContinuation`(433-441)、`ManagedRecoveryContinuation`(443-447)。
- `ManagedCheckoutDelivery`(449-485)：与 `WorktreeDeliveryView` 对应的持久化形态（finalized/retained 成员有 `cleanupMessage?` 但**未声明** `cleanupReason`）。
- `ManagedCheckoutRecord`(487-540)：核心持久化记录——`checkoutId`(488)、`predecessorCheckoutId?`(490)、`projectId`(491)、`projectName`(492)、`ownerSessionId`(493)、`sourceSessionId?`(495)、`localRoot`(497)、`managedRoot`(499)、`managedGitRoot`(501)、`gitCommonDir`(502)、`gitDir`(503)、`baseOid`(504)、`applyBaseOid?`(506)、`previousReview?`(508)、`checkpoints?`(510)、`recoveryContinuation?`(512)、`abandonedSnapshotOid?`/`abandonedSnapshotAt?`(514-515)、`permanent?`(517)、`sidebarBadgeClearedRevision?`(519)、`sourceRef`(520)、`sessionBranch?`(528，文档 521-527)、`sessionTopic?`(535，文档 529-534)、`phase`(536)、`delivery`(537)、`journal`(538)、`revision`(539)。
- `ManagedCheckoutsRegistry`(542-547)：`version: 2`、`revision`、`sessionBindings`、`managedCheckouts`。
- `SessionCheckoutRegistryPort`(549-552)。
- `LiveValue<T>`(555-557) 与 `liveConfigValue<T>`(560-565)。
- `SessionCheckoutDependencies`(567-608)：聚合 lookup/git/files/registry/applyEngine/managedCheckoutsRoot/createCheckoutId 及可选 live 配置 `autoPush`(576)/`autoDeliver`(578)/`worktreesRoot`(584)/`inheritLocalChanges`(591)/`worktreeKeepCount`(598)/`branchRaceGuard`(605)/`branchRaceWindowMs`(607)。

### 支撑模块

- `checkpoint.ts`：
  - `canonicalJson` (4-13，内部) 规范化 JSON 串。
  - `checkpointGenerationForRecord(record: ManagedCheckoutRecord): string | undefined` (15-29)：仅当 delivery.state 为 ready_for_review 或 preview_active 时，对 checkoutId/revision/reviewId/isolatedHeadOid/isolatedFingerprint/checkpointCount/previewId/phase 做 sha256 生成 CAS generation；否则 undefined。
- `creation-failure.ts`：
  - `export class WorktreeCreationFailure extends Error` (2-7)：构造 `(message: string, readonly rolledBack: boolean)`，标识创建失败是否已回滚，防止误判空路径安全。
- `managed-worktree-path.ts`：
  - 常量 `WINDOWS_INVALID_CHARACTERS`(4)、`WINDOWS_RESERVED_NAME`(5)、`REPEATED_DASHES`(6)、`MAX_LABEL_LENGTH=40`(7)、`DEFAULT_IDENTITY_LENGTH=8`(8)
  - `truncateCodePoints` (10-12)
  - `sanitizeManagedWorktreeLabel` (15-29)：仓库名转安全目录段
  - `checkoutIdentity` (31-35)
  - `createManagedWorktreeRepositoryKey` (38-40)：对 canonicalGitRoot 做 sha256 取前12位
  - `sanitizeBranchSegment` (46-55)
  - `createSessionBranchCandidates` (63-75)：生成 `feat/sess-<session>[--topic]` 及 -2/-3 递增候选
  - `createManagedWorktreeDirectoryName` (78-86)：`<repoLabel>--<identity>--worktree`
  - `ManagedWorktreePathCandidates` (88-93)：sibling/fallback container/root
  - `createTopicManagedWorktreeDirectoryName` (101-112)：`<topic>-<date>[-<id>]`
  - `createTopicDateStamp` (115-120)：本地 YYYYMMDD
  - `createManagedWorktreePathCandidates` (132-175)：根据 worktreesRoot 是否设置决定容器位置，返回候选路径供调用方探测不存在者。

## Architecture

```text
┌──────────────────────────────────────────────────────────────────┐
│    createSessionCheckoutModule (src/session-checkout-module.ts)  │
│                                                                  │
│  bind/create           operate*             list/manage/prune    │
│  bindTarget 4841       finish 3339          summarize 3851       │
│  createIsolatedTarget  preview 2633         cleanup 检查 4004    │
│   5220                                                           │
│      └─────────► withBindingLock (1289) ◄──────────┘             │
│           exclusive / maintenance / draining                     │
│                        │                                         │
│    ┌───────────┬────────┴──────┬─────────────┐                    │
│    ▼           ▼               ▼             ▼                    │
│ 身份校验    applyEngine      registry v2    git port              │
│ validate*   plan/preview/    读写 1670      ports.ts 109-230      │
│ 597-735     commitIsolated                                       │
│                                                                  │
│ 会话分支层 attachSessionBranch(754) / ensureSessionBranch(810)   │
│ refuseLegacyLocalWrite(1656) ──► 交付只写 refs/heads/feat/…      │
└──────────────────────────────────────────────────────────────────┘
```

## Data Flow

1. **绑定与创建**：`bind` / `createIsolatedTarget` 经 `bindTarget`（4841）解析项目与 git 快照、生成路径候选、写入 `preparing` 记录与 binding、`createDetachedWorktree` 后复验 git 身份，随后立即 `attachSessionBranch`（754）把 Worktree 挂到 `feat/sess-<会话>[--<主题>]`，`sessionBranch` 与 `sourceRef` 同写该 ref，记录转 `ready`。
2. **编辑与检查点**：改动只发生在 Worktree。`checkpoint`（`operateCheckpoint` 1767）用 `requestId` 幂等 + `expectedGeneration` CAS，在 `refs/…/checkpoints/<id>` 上留证，提交后回 `working`。
3. **Review 与 Preview**：`markReadyForReviewTarget`（1684）先 `ensureSessionBranch` 再固化 review 指纹（1708-1715）；`operatePreview`（2633）在 receipt 保护下把改动写进 Local，`beforeWrite` 内先留工件再置 `preview_active`。Local 一旦漂移，预览进入 `preview_detached`（2776），需要 `preflightPreviewRecoveryTarget`（2434）生成的 proof 才能继续。
4. **交付（只写会话分支）**：`operateFinish`（3339）先 `ensureSessionBranch`（810），再 `reviewIsolated` + `commitIsolated(branchRef)`，`proof.localBranch` 记会话分支名，自动 push 也推会话分支，Local 的三个面全程不读写。旧的 `operateApply` / `operatePreview` / `operateFinalizePreview` 在存在 `sessionBranch` 时被 `refuseLegacyLocalWrite`（1656）拒绝并指向 `worktree_deliver`。
5. **合并**：`mergeBranchForSession`（4215）先认 `record.sessionBranch`，拒绝把 Local 自身分支当来源，并区分「别的会话的分支」；真实合并前检查项目验收槽，冲突现场留给用户解决。
6. **保留与清理**：`finalized` 可 `retain_*` 冻结环境（默认 `retain_24h`，src/types.ts:39），或直接 `cleanupFinalized`（2979）删除目录；目录身份不符/交付后又有改动会被挡成 `identity_changed` / `modified_after_finalize`；到期由 `cleanupExpiredRetained`（4483）、总量由 `enforceWorktreeKeepCount`（4511）收口。
7. **崩溃恢复**：启动或显式 `recover` 时 `reconcile()`（1362）按 journal step 前进或回退；finish 的 `committing_session_branch` step 落入通用 `mutating` 分支（1552-1561），被视作可能已产生提交，收敛为 `recovery_required` 而不是草率回 `ready`。

## Connections

- [[session-checkout-apply]]：`applyEngine` 的实现，提供 `plan` / `preflight` / `preview` / `rollback` / `finalize` / `recoverCheckpoint` / `inspectReview` / `reviewIsolated` / `commitIsolated`。
- [[managed-worktree-path]]：会话分支名候选与 Worktree 目录/路径候选生成，`createSessionBranchCandidates` 是 `attachSessionBranch` 的唯一取名来源。
- [[registry]]：`ManagedCheckoutsRegistry` 的持久化与原子写入。
- [[git-port]]：`SessionCheckoutGitPort` 适配器，`attachWorktreeBranch` / `resolveLocalBranchTip` / `mergeLocalBranch` 是会话分支语义的底层支点。
- [[file-port]]：`SessionCheckoutFilesPort`，目录身份、隔离与删除能力。
- [[session-management]]：`lookup` 端口提供会话与项目记录，决定 owner 与 cwd 归属判定。
- [[concurrent-session-guard]]：`detectLocalBranchRace`（src/session-checkout-module.ts:76 引入）实现分支竞态判定，供 `branchRaceNotice` 消费。
- [[host-messages]]：所有面向用户的文案键与持久化清理文案的映射表。

## Known Issues

- **detached 兼容残留**：端口不实现 `attachWorktreeBranch` 时，`attachSessionBranch`（751-755）与 `ensureSessionBranch`（802-808）都只 warn 并退回旧行为，此时 `record.sessionBranch` 永不写入。
- **历史记录仍可写 Local**：`refuseLegacyLocalWrite`（1656-1668）只对存在 `sessionBranch` 的记录生效（1660），因此旧版本创建、无会话分支的记录仍可走 `operateApply` / `operatePreview` / `operateFinalizePreview` 写回 Local；`operateFinish`（3360-3366）与 `operateDiscard`（3600-3606）对这类 wrote-to-Local 中间态另有显式拒绝。
- **迭代基点会退化**：`beginNextIterationTarget`（4535）用 `resolveLocalBranchTip` 找上一轮会话分支 tip（4577-4598），找不到（分支被删/改名）就退回 Local 的 `headOid`，上一轮内容会在迭代链上断开——源码注释（4574-4576）已点明这一点。
- **`operateFinish` 重读记录只校验 phase**：`ensureSessionBranch` 之前那次 registry 重读只判 `phase !== 'ready'`（3383-3386），不再比 `revision`，并发窗口依赖 `withBindingLock`（1289）与 `updateManagedCheckout`（1670）的 CAS 兜底。
- **清理失败原因被折叠**：`cleanupFinalized`（2979）的 `catch`（3134-3153）把所有异常降级成 `quarantine_busy` / `directory_busy` 的 `pending`/`blocked`，不区分底层错误类型，只能靠 `console.warn('[session-checkout] finalized Worktree cleanup failed:', error)`（3135）定位。
- **清理超时不做取消**：`withCleanupTimeout`（108-126）只让启动收敛先走（超时返回 `null`），后台操作继续跑完；`withBindingLock` 保证同进程重试串行、台账写入安全（注释 101-103）。若实际挂起普遍超过 2min，需要给 files/git ports 加 AbortSignal。
- **`retain_24h` 是默认值**：调用方未显式给 `retention` 时（`DEFAULT_WORKTREE_RETENTION`，src/types.ts:39；使用点 3279、3532）冻结环境会留一天，磁盘占用与 `approximateBytes` 会持续到到期清理。
- **旧写回校验仍在**：`inspectCleanupForRecord`（3948）在 `commitOid + proof` 时仍用 `validateCommittedLocalCheckout` + `isAncestor` 验证交付提交在 Local 历史里（3958-3965），这是写回语义的遗留；会话分支交付的提交不在 Local 历史中，该分支逻辑对这类记录不再成立。
- **双轨记录共存**：`ManagedCheckoutDelivery`（src/ports.ts:449-485）的 finalized/retained 成员未声明 `cleanupReason`，但 `cleanupFinalized` 的 `block()`（2983-3005）与 `catch`（3142-3160）运行时会写入该字段；视图类型 `WorktreeDeliveryView`（src/types.ts:104-126）已声明它。`persistedCleanupReason`（156-161）读不到结构化字段时回退文案匹配，新旧记录在同一份台账里语义不完全一致。
- **分支竞态守卫静默降级**：`refreshBranchRaceGuards`（1002）探测失败时保留旧快照（1014-1016），端口缺 `branchCreationTimes` 时守卫整体静默（995）；`branchRaceNotice`（1035）在这些环境下永远返回空串，不产生任何提示——守卫是尽力而为，不是硬保证。
