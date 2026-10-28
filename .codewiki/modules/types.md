---
title: types
type: module
source_files:
  - src/types.ts
  - tests/surface.test.ts
  - src/session-checkout-module.ts
  - src/session-checkout-apply.ts
  - src/index.ts
  - src/session-target-context.ts
  - src/commands.ts
  - src/console-contract.ts
  - tests/session-checkout-apply.test.ts
  - src/ports.ts
  - src/tools.ts
tags: [types, session-checkout, view-model, operation-result, dsh-git-worktree]
---

## Overview

`src/types.ts` is the **type surface** for the `dsh-git-worktree` session-checkout
domain. The file header (lines 1–8) states it was ported from Domi's
`session-checkout` domain (`@proma/shared` types/session-target.ts). The plugin
keeps Domi's Local preview / rollback / finalize lifecycle but deliberately drops
collaborator and Electron-only surfaces; harness transport and Session separation
live *above* this host-agnostic state machine.

The module contains **only type aliases, interfaces, unions, and a handful of
exported constants**. There is no runtime logic, no classes, and no functions —
it is a pure `.d.ts`-style contract written inline in a `.ts` file. Everything
here is consumed by `src/session-checkout-module.ts`, `src/session-checkout-apply.ts`,
`src/console-contract.ts`, `src/commands.ts`, `src/session-target-context.ts`, and
the plugin face `src/index.ts`.

Conceptually the types fall into four groups:

1. **Identity & phase enums** — what a checkout *is* and what lifecycle stage it's in
   (`SessionTargetRef`, `SessionCheckoutKind`, `SessionCheckoutPhase`, retention/validation enums).
2. **View models** — what the host serializes to the client (everything named `*View`):
   `SessionTargetView`, `WorktreeDeliveryView`, `WorktreeReviewView`,
   `ManagedWorktreeSummaryView`, `PruneMergedBranchesView`, etc.
3. **Operation envelopes & preflight** — the discriminated unions describing a
   requested mutation (`SessionCheckoutOperation` and its members, plus preflight
   reads like `WorktreeApplyPreflightView` / `WorktreePreviewRecoveryPreflightView`).
4. **Operation results** — the discriminated unions returned by `operate` and the
   bulk/merge tools (`SessionCheckoutOperationResult` and its members,
   `BulkCleanupManagedWorktreesResult`, `MergeBranchForSessionView`, …).

A recurring design rule (stated in the comments at lines 425, 477, and 479) is that
these `*View` projections are **path-free and read-only**. They carry enough to
render and navigate but never authorize: every real mutation re-validates under
the host lock, so the views are presentation/inspection data, not permission.

## Key Components

The module is a single file (`src/types.ts`, 634 lines). Below every exported
symbol is listed with its declaration line, discriminated-union members, and —
for each `interface`/`type` object — every field.

### Identity & phase enums

- **`SessionTargetRef`** (11–14): union — `{ kind: 'unselected' } | { kind: 'local' } | { kind: 'isolated'; checkoutId: string }`. Stable durable-layer reference; paths/branches are *not* checkout identity.
- **`SessionCheckoutKind`** (16): `'local' | 'isolated'`.
- **`SessionCheckoutPhase`** (18–27): `'preparing' | 'ready' | 'applying' (deprecated, v1 registry/runtime compatibility; new mutations use `mutating`) | 'mutating' | 'recovery_required' | 'finalized' | 'retained' | 'discarded'`.
- **`WorktreeValidationStatus`** (29): `'passed' | 'failed' | 'partial' | 'not_run'`.
- **`WorktreeRetentionMode`** (32): `'cleanup' | 'retain_24h' | 'retain_3d' | 'retain_manual'`. `cleanup` removes the worktree immediately; the others keep a frozen environment for later inspection.
- **`DEFAULT_WORKTREE_RETENTION`** (39, const): value `'retain_24h'`. Applied when caller chooses no retention; keeps the frozen env one day so an accidental delivery is recoverable, then auto-expires.
- **`WorktreeCleanupReason`** (41–46): `'directory_busy' | 'modified_after_finalize' | 'identity_changed' | 'detached_residue' | 'quarantine_busy'`. Structured cause persisted on blocked cleanup.
- **`WorktreeApplyPreflightBlockedReason`** (129–137): `'not_owner' | 'not_ready_for_review' | 'stale_target' | 'stale_local' | 'stale_isolated' | 'project_acceptance_busy' | 'checkout_unavailable' | 'git_error'`.
- **`WorktreePreviewRecoveryPreflightBlockedReason`** (293–299): `'not_owner' | 'not_preview_detached' | 'stale_target' | 'artifacts_missing' | 'checkout_unavailable' | 'git_error'`.
- **`WorktreePreviewRecoveryActionBlockReason`** (251–256): `'stale_local' | 'preview_modified' | 'commit_isolation_conflict' | 'operation_not_allowed' | 'project_acceptance_busy'`.
- **`ApplyBaseStrategy`** (505–508): `'recorded_base' | 'isolated_contains_local_head' | 'local_contains_isolated_head'`.
- **`ApplyConflictReason`** (548): `'content_conflict' | 'local_dirty' | 'untracked_conflict'`. Why a Local merge refused.
- **`MergeLocalBranchOutcome`** (520): `'merged' | 'up_to_date' | 'conflict' | 'failed'`.
- **`ManagedWorktreeCleanupEligibility`** (413): `'safe' | 'retained' | 'blocked'`.
- **`ManagedWorktreeCleanupBlockReason`** (415–423): `'working' | 'review_pending' | 'preview_active' | 'retention_active' | 'uncommitted_changes' | 'identity_mismatch' | 'cleanup_failed' | 'unknown'`.
- **`ManagedWorktreeSummaryState`** (443–450): `'working' | 'ready_for_review' | 'preview_active' | 'retained' | 'cleanup_pending' | 'needs_attention' | 'delivered'`.

### View models (`*View`)

- **`WorktreeValidationItem`** (48–52): `command: string`, `status: 'passed' | 'failed' | 'not_run'`, `summary?: string`.
- **`WorktreeCheckpointView`** (55–63): `checkpointId: string`, `sequence: number`, `reviewId: string`, `createdAt: number` (timestamp), `summary: string`, `validationStatus: WorktreeValidationStatus`, `changedFiles: string[]`. A saved stage living only in managed Worktree history until delivery.
- **`WorktreeReviewView`** (65–77): `reviewId: string`, `iteration: number`, `preparedAt: number` (timestamp), `detailsMarkdown?: string` (deterministically rendered full Markdown body; historical records may omit), `summary: string`, `validationStatus: WorktreeValidationStatus`, `validationSummary?: string`, `tests: WorktreeValidationItem[]`, `changedFiles: string[]`, `suggestedCommitMessage: string`.
- **`WorktreeDeliveryProofView`** (79–90): `localBranch: string | null` (null = detached; automatic finish rejects that), `localHeadBefore: string`, `localHeadAfter: string`, `changedFiles: string[]`, `validationStatus?: WorktreeValidationStatus`, `validationSummary?: string`, `commitInLocalHistory: boolean | null` (whether this round's commit is still an ancestor of Local HEAD at view time; null when no commit).
- **`WorktreeDeliveryView`** (92–127): discriminated union of delivery states:
  - `{ state: 'working'; iteration: number }` (93)
  - `{ state: 'ready_for_review'; review: WorktreeReviewView }` (94)
  - `{ state: 'preview_active'; review: WorktreeReviewView; previewedAt: number }` (95)
  - `{ state: 'preview_detached'; review: WorktreeReviewView; previewedAt: number; detachedAt: number; reason: 'stale_local' | 'preview_modified'; attemptedAction: 'rollback_preview' | 'finalize_preview' | 'discard' }` (96–103)
  - `{ state: 'finalized'; review: WorktreeReviewView; commitOid: string | null; proof?: WorktreeDeliveryProofView; cleanup: 'pending' | 'blocked'; cleanupMessage?: string; cleanupReason?: WorktreeCleanupReason }` (104–113)
  - `{ state: 'retained'; review: WorktreeReviewView; commitOid: string | null; proof?: WorktreeDeliveryProofView; retention: Exclude<WorktreeRetentionMode, 'cleanup'>; retainedAt: number; expiresAt: number | null; cleanup: 'scheduled' | 'blocked'; cleanupMessage?: string; cleanupReason?: WorktreeCleanupReason }` (114–126)
  - `{ state: 'delivered'; iteration: number; commitOid: string | null; proof?: WorktreeDeliveryProofView; deliveredAt: number }` (127)
- **`SessionTargetProjectView`** (174–177): `id: string`, `name: string`.
- **`SessionTargetCheckoutView`** (179–184): `id: string`, `kind: SessionCheckoutKind`, `label: string`, `phase: SessionCheckoutPhase`.
- **`SessionTargetSourceView`** (186–190): `ref: string` (source ref at target creation; detached sources use HEAD), `oid: string`.
- **`SessionTargetCurrentView`** (192–196): `branch: string | null` (null = detached HEAD), `oid: string`.
- **`SessionTargetView`** (198–216): the central projection. Fields:
  - `project: SessionTargetProjectView`
  - `checkout: SessionTargetCheckoutView`
  - `source: SessionTargetSourceView`
  - `current: SessionTargetCurrentView`
  - `ownership: 'owner' | 'inherited'`
  - `dirty: boolean`
  - `revision: number`
  - `delivery?: WorktreeDeliveryView` (delivery state for isolated checkouts; absent on Local)
  - `checkpoints?: WorktreeCheckpointView[]` (linear saved stages not yet published to Local)
  - `checkpointGeneration?: string` (Host-derived CAS generation for the active Review/checkpoint state)
  - `reviewSlot?: 'available' | 'waiting'` (current project Local Preview slot state)
  - `reviewSlotOwnerSessionId?: string` (owner Session holding the slot, for navigation/status only)
- **`SessionTargetBindChoice`** (218–220): `{ kind: 'local' } | { kind: 'isolated' }`.
- **`WorktreeAcceptanceBlockerView`** (152–157): `checkoutId: string`, `ownerSessionId: string`, `revision: number`, `state: 'preview_active' | 'preview_detached' | 'finalized' | 'retained' | 'working' | 'ready_for_review' | 'delivered'`. Path-free identity for the exact Worktree holding a project's acceptance slot.
- **`ManagedWorktreeCleanupView`** (426–431): `eligibility: ManagedWorktreeCleanupEligibility`, `reason: ManagedWorktreeCleanupBlockReason`, `message: string`, `inspectedRevision: number`. Read-only inspection conclusion (never authorization).
- **`ManagedWorktreeSummaryView`** (453–480): path-free projection for the management surface. Fields: `checkoutId: string`, `revision: number`, `ownerSessionId: string`, `ownerSessionTitle: string`, `project: SessionTargetProjectView`, `iteration: number`, `state: ManagedWorktreeSummaryState`, `phase: SessionCheckoutPhase`, `dirty: boolean`, `commitOid: string | null`, `checkpointCount?: number`, `retention?: Exclude<WorktreeRetentionMode, 'cleanup'>`, `retainedAt?: number`, `expiresAt?: number | null`, `permanent?: boolean` (Chinese comment: codex alignment — permanently-marked Worktree exempt from auto-cleanup), `cleanupMessage?: string`, `cleanupReason?: WorktreeCleanupReason`, `approximateBytes: number | null`, `updatedAt: number`, `canCleanup: boolean`, `cleanup?: ManagedWorktreeCleanupView` (read-only; real cleanup re-validates), `activeSessionIds?: string[]` (active owner sessions the management surface stops before a forced discard).
- **`PruneMergedBranchEntry`** (483–487): `name: string`, `oid: string`, `reason?: string`.
- **`PruneMergedBranchesView`** (489–494): `dryRun: boolean`, `headBranch: string | null`, `pruned: PruneMergedBranchEntry[]`, `skipped: PruneMergedBranchEntry[]`.
- **`AbandonedWorktreeSnapshotView`** (497–503): `checkoutId: string`, `projectName: string`, `snapshotOid: string`, `snapshotAt: number`, `revision: number`. Safety snapshot left when abandoning a Worktree with uncommitted content (recoverable as a Local branch).
- **`MergeBranchForSessionView`** (531–540): extends `MergeLocalBranchResult` with `dryRun: boolean`, `sourceBranch: string`, `localBranch: string | null` (Local checkout branch at merge; null on detached HEAD), `targetBranch: string | null` (receiving branch: Local HEAD forward or worktree branch reverse), `direction: 'forward' | 'reverse'` (forward default = worktree → Local; reverse = Local HEAD → worktree, conflicts stay in worktree).

### Operation envelopes & preflight

- **`SessionCheckoutOperationBase`** (222–225, internal interface): `sessionId: string`, `expectedRevision: number`. Shared fields for all operation envelopes.
- **`SessionCheckoutApplyOperation`** (227–229): `action: 'apply'` + base.
- **`SessionCheckoutFinishOperation`** (231–237): `action: 'finish'`, `commitMessage: string`, `retention?: WorktreeRetentionMode`, `expectedReviewId?: string` (binds Finish to a persisted human-reviewed snapshot).
- **`SessionCheckoutPreviewOperation`** (239–241): `action: 'preview'` + base.
- **`SessionCheckoutCheckpointOperation`** (243–249): `action: 'checkpoint'`, `commitMessage: string`, `expectedReviewId: string`, `expectedGeneration: string`, `requestId: string`.
- **`SessionCheckoutRollbackPreviewOperation`** (314–320): `action: 'rollback_preview'`, `resumeRevision?: boolean` (structured withdraw-and-continue returns to working), `recoveryProof?: WorktreePreviewRecoveryProof` (required only for `preview_detached`; context to re-verify, never bearer permission).
- **`SessionCheckoutFinalizePreviewOperation`** (322–328): `action: 'finalize_preview'`, `commitMessage: string`, `retention?: WorktreeRetentionMode`, `recoveryProof?: WorktreePreviewRecoveryProof` (same semantics as above).
- **`SessionCheckoutRetryCleanupOperation`** (330–332): `action: 'retry_cleanup'` + base.
- **`SessionCheckoutDiscardOperation`** (334–338): `action: 'discard'`, `confirmDirty: boolean`, `rollbackPreview?: boolean`.
- **`SessionCheckoutRecoverOperation`** (340–342): `action: 'recover'` + base.
- **`SessionCheckoutOperation`** (344–353): union of all nine operation envelopes above.
- **`WorktreeApplyPreflightFacts`** (139–150): `checkoutId: string`, `reviewId: string`, `revision: number`, `configuredBaseOid: string`, `effectiveBaseOid: string`, `baseStrategy: ApplyBaseStrategy`, `localBranch: string | null`, `localHeadOid: string`, `isolatedHeadOid: string`, `changedFiles: string[]`.
- **`WorktreeApplyPreflightView`** (159–172): union — `{ status: 'ready' | 'local_advanced' | 'already_in_local'; localModified: false } & WorktreeApplyPreflightFacts` (160), `{ status: 'conflict'; localModified: false; conflictingFiles: string[]; conflictDetails?: ApplyConflictDetail[] } & WorktreeApplyPreflightFacts` (161), or `{ status: 'blocked'; localModified: false; checkoutId: string; reviewId: string | null; revision: number; reason: WorktreeApplyPreflightBlockedReason; message: string; blocker?: WorktreeAcceptanceBlockerView }` (162–172).
- **`WorktreePreviewRecoveryProof`** (273–291): Host-issued read-only recovery context. Mutation recomputes & compares it under the Host lock. Fields: `sessionId: string`, `checkoutId: string`, `reviewId: string`, `previewId: string`, `revision: number`, `generation: string`, `receiptFingerprint: string` (SHA-256 over the complete durable receipt; binds proof to retained recovery evidence), `localFingerprint: string`, `localHeadOid: string`, `localHeadRef: string | null`, `localHeadTreeOid: string`, `localIndexTreeOid: string`, `localWorkingTreeOid: string`, `rollback: WorktreePreviewRecoveryRollbackAction`, `finalize: WorktreePreviewRecoveryFinalizeAction`, `blocker?: WorktreeAcceptanceBlockerView`.
- **`WorktreePreviewRecoveryRollbackAction`** (258–260): `{ status: 'safe'; targetTreeOid: string } | { status: 'blocked'; code: WorktreePreviewRecoveryActionBlockReason; message: string; conflictingFiles?: string[] }`.
- **`WorktreePreviewRecoveryFinalizeAction`** (262–270): `{ status: 'safe'; taskTreeOid: string; finalIndexTreeOid: string; expectedWorkingTreeOid: string; commitRequired: boolean } | { status: 'blocked'; code: WorktreePreviewRecoveryActionBlockReason; message: string; conflictingFiles?: string[] }`.
- **`WorktreePreviewRecoveryPreflightView`** (301–312): `{ status: 'assessed'; localModified: false; proof: WorktreePreviewRecoveryProof }` (302) or `{ status: 'blocked'; localModified: false; checkoutId: string; reviewId: string | null; previewId: string | null; revision: number; reason: WorktreePreviewRecoveryPreflightBlockedReason; message: string }` (303–312).

### Operation results

- **`SessionCheckoutAppliedResult`** (355–359): `{ status: 'applied'; target: SessionTargetView; changedFiles: string[] }`.
- **`SessionCheckoutPreviewedResult`** (361–365): `{ status: 'previewed'; target: SessionTargetView; changedFiles: string[] }`.
- **`SessionCheckoutCheckpointedResult`** (367–372): `{ status: 'checkpointed'; target: SessionTargetView; checkpoint: WorktreeCheckpointView; changedFiles: string[] }`.
- **`SessionCheckoutPreviewRolledBackResult`** (374–378): `{ status: 'preview_rolled_back'; target: SessionTargetView; changedFiles: string[] }`.
- **`SessionCheckoutPreviewDetachedResult`** (380–386): `{ status: 'preview_detached'; target: SessionTargetView; changedFiles: string[]; reason: 'stale_local' | 'preview_modified'; attemptedAction: 'rollback_preview' | 'finalize_preview' | 'discard' }`.
- **`WorktreePushOutcome`** (389–392): `{ status: 'pushed' | 'skipped' | 'failed'; message?: string }`. Best-effort outcome of the automatic `git push` after a successful Finish.
- **`SessionCheckoutFinishedResult`** (394–411): `{ status: 'finished'; target: SessionTargetView; changedFiles: string[]; commitOid: string | null; branch?: string; cleanup: 'discarded' | 'pending' | 'retained'; cleanupMessage?: string; cleanupReason?: WorktreeCleanupReason; push?: WorktreePushOutcome }`. `branch` is where the user merges from; `push` never blocks delivery.
- **`BulkCleanupManagedWorktreeCandidate`** (433–436): `{ checkoutId: string; expectedRevision: number }`.
- **`BulkCleanupManagedWorktreesResult`** (438–441): `{ cleaned: Array<{ checkoutId: string; iteration: number; commitOid: string | null }>; retained: Array<{ checkoutId: string; iteration: number; cleanup: ManagedWorktreeCleanupView }> }`.
- **`MergeLocalBranchResult`** (522–529): `{ type: MergeLocalBranchOutcome; mergedFiles?: string[]; conflictingFiles?: string[]; conflictDetails?: ApplyConflictDetail[]; reason?: string }` (reason present for `'failed'`).
- **`SessionCheckoutConflictResult`** (550–566): `{ status: 'conflict'; code: 'apply_conflict'; reason: ApplyConflictReason; target: SessionTargetView; baseStrategy: ApplyBaseStrategy; effectiveBaseOid: string; localHeadOid: string; isolatedHeadOid: string; canRetryAfterRefresh: false; conflictingFiles: string[]; conflictDetails?: ApplyConflictDetail[]; resolveHint?: string }` (one concrete next command for the classified reason).
- **`SessionCheckoutDiscardedResult`** (568–571): `{ status: 'discarded'; target: SessionTargetView }`.
- **`SessionCheckoutRecoveredResult`** (573–576): `{ status: 'recovered'; target: SessionTargetView }`.
- **`SessionCheckoutOperationErrorResult`** (578–583): `{ status: 'error'; code: SessionCheckoutErrorCode; message: string; target?: SessionTargetView }`.
- **`SessionCheckoutOperationResult`** (585–595): union of all ten result shapes above (applied, previewed, checkpointed, preview_rolled_back, preview_detached, finished, conflict, discarded, recovered, error).
- **`ApplyConflictDetail`** (510–514): `{ file: string; diff: string }` (combined conflict diff, truncated to keep payload model-readable).

### Constants & error codes

- **`CONFLICT_DETAIL_FILE_LIMIT`** (517, const): `6` — max files in conflict payload.
- **`CONFLICT_DETAIL_DIFF_LIMIT`** (518, const): `4096` — max bytes per diff (4KB). Together they cap the conflict-detail payload so it doesn't blow up the model context (Chinese comment, line 516).
- **`SESSION_CHECKOUT_ERROR_CODES`** (597–627, const tuple): the full stable error-code list — `'session_not_found'`, `'project_not_found'`, `'project_root_missing'`, `'not_git_repository'`, `'target_unselected'`, `'target_already_bound'`, `'project_mismatch'`, `'checkout_missing'`, `'checkout_mismatch'`, `'recovery_required'`, `'registry_corrupt'`, `'git_operation_failed'`, `'not_owner'`, `'stale_target'`, `'dirty_confirmation_required'`, `'apply_conflict'`, `'apply_failed'`, `'invalid_input'`, `'invalid_plan'`, `'stale_local'`, `'stale_isolated'`, `'git_error'`, `'commit_isolation_conflict'`, `'checkout_limit_reached'`, `'project_acceptance_busy'`, `'operation_not_allowed'`, `'preview_not_active'`, `'preview_modified'`, `'recovery_unsafe`.
- **`SessionCheckoutErrorCode`** (629): `typeof SESSION_CHECKOUT_ERROR_CODES[number]` — derived union type.
- **`SessionCheckoutFailure`** (631–634): `{ code: SessionCheckoutErrorCode; message: string }`.

## Architecture

`types.ts` has no internal runtime architecture — it is a flat set of exported
type/const declarations. The meaningful structure is the *layering* of its
consumers: the state machine produces `*View` models and `SessionCheckoutOperationResult`
unions; the apply engine and preflight reads layer on their own `*Facts` / `*Preflight*`
unions; the console-contract and command surfaces render `*View` projections; and
the plugin `index.ts` re-exports the domain error type plus the module contract.

```text
┌─────────────────────────── src/types.ts (pure contracts) ───────────────────────────┐
│ SessionTargetView · WorktreeDeliveryView · ManagedWorktreeSummaryView (path-free *View) │
│ SessionCheckoutOperation (9 envelopes) · SessionCheckoutOperationResult (10 unions)    │
│ WorktreeApplyPreflight* · WorktreePreviewRecoveryProof · ManagedWorktreeCleanupView     │
│ SESSION_CHECKOUT_ERROR_CODES · DEFAULT_WORKTREE_RETENTION · CONFLICT_DETAIL_*_LIMIT      │
└───────────┬───────────────────────────────┬───────────────────────────────┬───────────┘
            │ produces/consumes             │ consumes                       │ re-exports
            ▼                               ▼                               ▼
┌────────────────────────┐   ┌──────────────────────────┐   ┌──────────────────────────┐
│ session-checkout-module │   │ session-checkout-apply    │   │ index.ts (plugin face)   │
│ (.ts, state machine)   │   │ (.ts, apply engine)       │   │ SessionCheckoutError +    │
│ operate()->Result      │   │ ApplyPlan + Preflight     │   │ SessionCheckoutModule     │
└───────────┬────────────┘   └────────────┬─────────────┘   └────────────┬─────────────┘
            │                               │                            │
            ▼                               ▼                            ▼
┌────────────────────────┐   ┌──────────────────────────┐   ┌──────────────────────────┐
│ console-contract.ts     │   │ commands.ts /             │   │ session-target-context.ts │
│ (JSON DTOs for Console) │   │ session-target-context.ts │   │ (runtimeContext snapshot) │
│ renders *View           │   │ render SessionTargetView  │   │ feeds SessionTargetView   │
└────────────────────────┘   └──────────────────────────┘   └──────────────────────────┘
```

The views at the top are the single contract between Host and Client: the Host
(`session-checkout-module.ts` + `index.ts`) resolves an exact caller Session and
re-validates project/owner/cwd/revision/review identity, then emits only these
`*View` shapes; the Client (`console-contract.ts`, `commands.ts`) consumes them
without performing authorization (see comment at `types.ts:425`).

## Data Flow

The types move in two opposing directions through the same `SessionTargetView` contract:

1. **Inspection (Host → Client)** — `session-checkout-module.ts` resolves a
   `ManagedCheckoutRecord` (from `ports.ts`) and projects it into a
   `SessionTargetView` (lines 198–216), attaching `delivery?` (`WorktreeDeliveryView`,
   lines 92–127), `checkpoints?` (`WorktreeCheckpointView[]`, lines 55–63), and
   `reviewSlot?`. `ManagedWorktreeSummaryView` (lines 453–480) is the bulk-management
   projection consumed by `worktree_list`. `session-target-context.ts` (line 36)
   calls `module.runtimeContext(sessionId, cwd)` to embed a `SessionTargetView` into
   the system prompt. `console-contract.ts` (`src/console-contract.ts:11–24`) imports
   `WorktreeDeliveryView`, `WorktreeReviewView`, `WorktreeCheckpointView`, etc. to
   render the Harness-native Worktree Console JSON.

2. **Mutation (Client → Host)** — a human `/worktree` command (`commands.ts`) or a
   model tool (`tools.ts`, exercised in `tests/surface.test.ts`) builds a
   `SessionCheckoutOperation` envelope (lines 344–353) carrying `sessionId` and
   `expectedRevision` from `SessionCheckoutOperationBase` (lines 222–225). `operate()`
   in `session-checkout-module.ts` re-validates and returns a
   `SessionCheckoutOperationResult` (lines 585–595). `tests/surface.test.ts` (lines
   7–28, 183–213) shows a `SessionTargetView` fixture flowing into `operate()` and a
   `SessionCheckoutFinishedResult` coming back with `cleanup: 'retained'`,
   `commitOid`, and optional `push: WorktreePushOutcome` (lines 389–392).

3. **Preflight / recovery** — before applying, the Host computes
   `WorktreeApplyPreflightFacts` (lines 139–150) and returns a
   `WorktreeApplyPreflightView` (lines 159–172); on conflicts it yields
   `conflictDetails: ApplyConflictDetail[]` (lines 510–514) capped by
   `CONFLICT_DETAIL_FILE_LIMIT` = 6 and `CONFLICT_DETAIL_DIFF_LIMIT` = 4096
   (lines 517–518). Crash recovery uses `WorktreePreviewRecoveryProof` (lines 273–291)
   and re-validates it under the Host lock, returning a
   `WorktreePreviewRecoveryPreflightView` (lines 301–312).

4. **Bulk / merge tooling** — `worktree_cleanup` returns
   `BulkCleanupManagedWorktreesResult` (lines 438–441); `worktree_merge` returns
   `MergeBranchForSessionView` (lines 531–540) extending `MergeLocalBranchResult`
   (lines 522–529); `worktree_prune_branches` returns `PruneMergedBranchesView`
   (lines 489–494).

## Connections

- [[session-checkout-module]] — the state machine that *produces* and *consumes*
  almost every type here; `SessionTargetView`, `SessionCheckoutOperation`,
  `SessionCheckoutOperationResult`, `WorktreeApplyPreflightView`,
  `BulkCleanupManagedWorktreesResult` and `ManagedWorktreeSummaryView` all pass
  through `src/session-checkout-module.ts` (imports at lines 7–34).
- [[session-checkout-apply]] — the apply engine that builds `ApplyPlan` and layers
  `WorktreeApplyPreflightFacts` / `WorktreeApplyPreflightView` / `ApplyConflictDetail`
  onto the apply/conflict types (imports at `src/session-checkout-apply.ts:11–12`).
- [[console-contract]] — JSON-only shared DTO module that re-exports many `*View`
  types (`WorktreeDeliveryView`, `WorktreeReviewView`, `WorktreeCheckpointView`,
  `WorktreeAcceptanceBlockerView`, `WorktreePreviewRecoveryProof`, etc.) at
  `src/console-contract.ts:11–24`; the future Harness-native Worktree Console.
- [[commands]] — `/worktree` human command surface that renders `SessionTargetView`
  (`targetText` at `src/commands.ts:16–24`) and consumes `DEFAULT_WORKTREE_RETENTION`
  (import at `src/commands.ts:14`).
- [[session-target-context]] — injects a `SessionTargetView` snapshot into the system
  prompt via `module.runtimeContext(...)` (`src/session-target-context.ts:36`).
- [[index]] — plugin entry that re-exports `SessionCheckoutError` (built from
  `SessionCheckoutErrorCode`, lines 41–53) and the `SessionCheckoutModule` contract;
  re-imports the view/result/error types at `src/index.ts:20–38`.
- [[ports]] — `ManagedCheckoutRecord` / `ManagedReviewRecord` / `ManagedDeliveryProof`
  durable records that the state machine projects *into* the `*View` types here.
- [[tools]] — model-tool surface that serializes `SessionTargetView` and constructs
  `SessionCheckoutOperation` envelopes; the main consumer exercised by
  `tests/surface.test.ts`.

## Known Issues

- **`SessionCheckoutPhase` carries a deprecated `'applying'` member** (lines 21–22):
  kept only for v1 registry/runtime compatibility; the comment explicitly states
  new mutations use `'mutating'` instead. The field is not removed to avoid breaking
  persisted records, but producers should not emit `'applying'`.
- **`SessionCheckoutPhase` is missing the `discarded` ↔ console-state alignment for
  every surface** — note that `SessionTargetView.checkout.phase` uses `SessionCheckoutPhase`
  (line 183) while `ManagedWorktreeSummaryView.state` uses the separate
  `ManagedWorktreeSummaryState` (line 460) and `console-contract.ts` defines yet a
  third `WorktreeConsoleTargetState` / `WorktreeConsoleDeliveryState`. Three overlapping
  phase/state enums exist with slightly different members, so a producer must map
  between them explicitly.
- **`SessionCheckoutOperationResult` does not include a `*View` of the recovery proof**
  on the `preview_detached` result — `SessionCheckoutPreviewDetachedResult` (lines
  380–386) carries only `reason`/`attemptedAction`, not the `WorktreePreviewRecoveryProof`
  needed to re-verify a `preview_detached` resume; the caller must have already
  obtained it via `WorktreePreviewRecoveryPreflightView`.
- **`detailsMarkdown` is optional and historically absent** — `WorktreeReviewView.detailsMarkdown`
  (line 70) may be missing on older records, so any renderer must tolerate its absence
  rather than assume a full Markdown body.
- **`ManagedWorktreeSummaryView` must not emit `undefined` keys** — the host rejects
  lossless JSON with `undefined` values. `tests/surface.test.ts` (lines 54–83) guards
  this: e.g. `commitOid: null` must serialize as the *absent* key (via `?? undefined`
  on the Host side), never as a present-but-null key, or the tool is killed on a real
  host.
- **`SessionCheckoutConflictResult.canRetryAfterRefresh` is hard-pinned to `false`**
  (line 560): the type makes the field a literal `false`, signaling conflict recovery
  always requires an explicit refresh + re-apply rather than an in-place retry.
- **No `permanent` field on the `SessionTargetView` projection** — retention exemption
  (`ManagedWorktreeSummaryView.permanent`, line 470, "codex 对齐") is only exposed on
  the summary view, not on the per-target `SessionTargetView`, so a single-target
  inspection cannot see the permanent flag.
