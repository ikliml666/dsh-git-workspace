---
title: console_contract
type: module
source_files:
  - src/console-contract.ts
  - tests/console-contract.test.ts
  - tests/support/worktree-console.ts
  - src/types.ts
  - src/index.ts
  - src/console-host/service.ts
  - src/console-host/control-plane.ts
  - src/console-host/projection.ts
  - src/console-remote/remote.ts
tags: [console, contract, dto, adapter, worktree, remote, host]
---

## Overview

`src/console-contract.ts` is the **JSON-only shared contract** for the future Harness-native Worktree Console. It deliberately contains **no Cordis, React, Remote, or filesystem implementation** — it is pure types and pure functions. The module's stated authority rule (`src/console-contract.ts:2-8`) is that every Host operation resolves an exact caller Session and re-validates project, owner, cwd, revision and review identity at execution time, so the DTOs it defines are safe to share between Host (server) and Client (browser) tracks.

Concretely the module provides:

- **State enums & projection helpers** — the canonical Console target state machine derived from domain `phase`/`deliveryState` facts.
- **Target / projection DTOs** — `WorktreeConsoleTargetSummary`, `WorktreeConsoleTargetDetails`, `WorktreeConsoleProject`, `WorktreeConsoleCapabilities`, `WorktreeConsoleReviewSummary`, plus the preview-recovery record.
- **Sidebar DTOs** — read-only task aggregation for the Workspace sidebar (`WorktreeSidebarTopologyResponse`, `WorktreeSidebarProject`, `WorktreeSidebarTask`, `WorktreeClientBootReport`).
- **Lifecycle & mutation request/response DTOs** — create / inspect / discard / finalize / setRetention / setPermanent / retryCleanup / beginNextIteration / clearSidebarBadge / returnToLocal / checkpoint / resumeRevision.
- **Preview & recovery proof DTOs** — `WorktreeConsolePreviewRecoveryPreflight*` and the `WorktreeRecoveryProof` union plus `WorktreeApplyConflictContinuation`.
- **Git / branch / tag DTOs** — overview, graph, prune, tags.
- **Abandoned-snapshot DTOs** — `WorktreeConsoleAbandonedSnapshot` / list / restore.
- **Error model** — `WORKTREE_CONSOLE_ERROR_CODES`, `WorktreeConsoleErrorCategory`, `WorktreeConsoleRecovery`, `ERROR_META`, and `worktreeConsoleErrorMeta()`.
- **`WorktreeConsoleAdapter`** — the normalized Client seam; Remote transport details stay behind one adapter object so the Client never talks to the wire directly.

The module is re-exported verbatim from the plugin entry (`export * from './console-contract.js'`, `src/index.ts:243`), so every type/function here is part of the public plugin surface.

## Key Components

### State enums & projection helpers

- `WORKTREE_CONSOLE_TARGET_STATES` (const array, `src/console-contract.ts:26-38`) — the 11 canonical UI-facing states: `local`, `creating`, `working`, `ready_for_review`, `preview_active`, `preview_detached`, `retained`, `cleanup_pending`, `recovery_required`, `delivered`, `discarded`.
- `WorktreeConsoleTargetState` (type, `src/console-contract.ts:40`) — `typeof WORKTREE_CONSOLE_TARGET_STATES[number]`.
- `WorktreeConsoleDeliveryState` (type, `src/console-contract.ts:42-49`) — delivery sub-state used by projection: `working | ready_for_review | preview_active | preview_detached | finalized | retained | delivered`.
- `WorktreeConsoleProjectionSource` (interface, `src/console-contract.ts:52-56`) — minimal domain facts to project a state: `kind: 'local' | 'isolated'`, `phase: SessionCheckoutPhase`, optional `deliveryState`.
- `worktreeReachedDelivery(phase, deliveryState?)` (function, `src/console-contract.ts:64-73`) — returns `true` when the task reached the user (delivery won): `deliveryState` of `delivered` / `finalized` / `retained`, or `phase` of `finalized` / `retained`. Used by the sidebar to label a record as completed rather than abandoned. Tested at `tests/console-contract.test.ts:40-52`.
- `consoleStateFromDomain(source)` (function, `src/console-contract.ts:76-91`) — projects one stable `WorktreeConsoleTargetState` from the projection source. Precedence: `local` → `recovery_required` → `creating` (preparing) → `delivered` → `discarded` → `retained` → `cleanup_pending` (finalized) → `preview_detached` → `preview_active` → `ready_for_review` → `working`. Note (`src/console-contract.ts:81-84`): a `discarded` record keeps the delivery label it had *before* discard, so only `delivered` survives discard. Tested at `tests/console-contract.test.ts:21-38`.

### Target / projection DTOs (Summary, Details, Project, Capabilities, Review)

- `WorktreeConsoleProject` (interface, `src/console-contract.ts:93-96`) — `{ id: string; name: string }`.
- `WorktreeConsoleCapabilities` (interface, `src/console-contract.ts:98-124`) — boolean feature flags resolved on the Host for the caller: `create`, `open`, `inspect`, `discard`, `preflight`, `preview`, `checkpoint`, `resumeRevision`, `rollbackPreview`, `finalize`, `finalizePreview`, `setRetention`, `setPermanent`, `retryCleanup`, `beginNextIteration`, `returnToLocal`. `returnToLocal` (`:117-123`) is only meaningful while the Session still points at `isolated`.
- `WorktreeConsolePreviewRecovery` (interface, `src/console-contract.ts:126-131`) — `{ previewId: string; detachedAt: number; reason: 'stale_local' | 'preview_modified'; attemptedAction: 'rollback_preview' | 'finalize_preview' | 'discard' }`.
- `WorktreeConsoleDeliveryProof` (type alias, `src/console-contract.ts:133`) — `= WorktreeDeliveryProofView` (imported from `./types.js`).
- `WorktreeConsoleReviewSummary` (interface, `src/console-contract.ts:135-146`) — review snapshot: `reviewId`, `revision`, `iteration`, `preparedAt` (number, epoch), `summary`, `validationStatus`, optional `validationSummary`, `tests: WorktreeValidationItem[]`, `changedFiles: string[]`, `suggestedCommitMessage`.
- `WorktreeConsoleTargetSummary` (interface, `src/console-contract.ts:149-179`) — the **path-free** row safe for project lists and header status chips. Fields:

  | Field | Type | Notes |
  |---|---|---|
  | `project` | `WorktreeConsoleProject` | owning project |
  | `checkoutId` | `string \| null` | null on Local |
  | `sourceSessionId` | `string` | fork source session |
  | `ownerSessionId` | `string` | owning session |
  | `targetSessionId` | `string \| null` | allocated Host session (null on Local) |
  | `iteration` | `number` | |
  | `revision` | `number` | Host CAS version |
  | `state` | `WorktreeConsoleTargetState` | projected UI state |
  | `phase` | `SessionCheckoutPhase \| 'local'` | |
  | `dirty` | `boolean` | |
  | `currentOid` | `string` | |
  | `commitOid` | `string \| null` | |
  | `sourceBranch` | `string \| null` | fork point / session branch; null when Local detached or unversioned (`src/console-contract.ts:162`) |
  | `retention?` | `Exclude<WorktreeRetentionMode, 'cleanup'>` | |
  | `retainedAt?` | `number` | epoch ms |
  | `expiresAt?` | `number \| null` | epoch ms |
  | `permanent?` | `boolean` | codex 对齐：常驻豁免自动清理 (`src/console-contract.ts:167`) |
  | `cleanupMessage?` | `string` | |
  | `deliveryProof?` | `WorktreeConsoleDeliveryProof` | |
  | `review?` | `WorktreeConsoleReviewSummary` | |
  | `checkpoints?` | `WorktreeCheckpointView[]` | |
  | `checkpointGeneration?` | `string` | |
  | `reviewSlot?` | `'available' \| 'waiting'` | |
  | `reviewSlotOwnerSessionId?` | `string` | |
  | `reviewSlotHolder?` | `WorktreeAcceptanceBlockerView` | |
  | `previewRecovery?` | `WorktreeConsolePreviewRecovery` | |
  | `capabilities` | `WorktreeConsoleCapabilities` | always present |

- `WorktreeConsoleTargetDetails` (interface, `src/console-contract.ts:182-195`) — extends `WorktreeConsoleTargetSummary`; identity-validated detail used only when the caller may open the target: `managedRoot: string | null`, `sourceRoot: string | null` (Host-validated canonical Local root, `src/console-contract.ts:184`), `sourceOid: string`, `currentBranch: string | null` (Git-reported branch now, falling back to recorded session branch, `src/console-contract.ts:188-192`), and `recoveryContinuation?: WorktreeRecoveryProof` (owner-only Host proof, `src/console-contract.ts:193-194`).

### Sidebar DTOs

- `WorktreeSidebarTaskState` (type, `src/console-contract.ts:216-223`) — `working | ready_for_review | preview_active | preview_detached | recovery_required | finalized | discarded`.
- `WorktreeSidebarTask` (interface, `src/console-contract.ts:226-236`) — read-only task identity for sidebar aggregation: `checkoutId`, `ownerSessionId`, `sourceSessionId`, `iteration`, `revision`, `phase: SessionCheckoutPhase`, `state: WorktreeSidebarTaskState`, `sourceBranch: string | null`.
- `WorktreeSidebarProject` (interface, `src/console-contract.ts:238-243`) — `{ project: WorktreeConsoleProject; tasks: WorktreeSidebarTask[]; memberships?: { workspaceIds: string[]; sessionIds: string[] } }`. `memberships` is Host-proven directory membership including cleaned/older iterations.
- `WorktreeSidebarTopologyResponse` (interface, `src/console-contract.ts:245-251`) — `{ projects: WorktreeSidebarProject[]; workspaceClientFlavor?: 'legacy' | 'alpha' | 'next' | 'modern' | 'unsupported'; officialWorkspaceActive?: boolean }`. `workspaceClientFlavor` is server-pinned; unknown generations must not mount a guessed Client Browser (`src/console-contract.ts:248`).
- `WorktreeClientBootReport` (interface, `src/console-contract.ts:253-263`) — Client-side breadcrumb reporting which sidebar branch ran: `flavor`, `branch: 'legacy' | 'alpha' | 'next' | 'modern' | 'unsupported' | 'topology-failed' | 'boot-failed'`, `registered`, `detail?`, `elapsedMountMs?`, `elapsedTopologyMs?`.

### Lifecycle & mutation request/response DTOs

Read operations (returns `WorktreeConsoleTargetDetails`):

- `WorktreeConsoleCurrentRequest` / `…Response` (`src/console-contract.ts:197-203`) — `{ sessionId }` → `{ target: WorktreeConsoleTargetDetails }`.
- `WorktreeConsoleListRequest` / `…Response` (`src/console-contract.ts:205-214`) — `{ sessionId; needsAttention?; includeDelivered? }` → `{ project; worktrees: WorktreeConsoleTargetSummary[] }`.
- `WorktreeConsoleInspectRequest` / `…Response` (`src/console-contract.ts:283-290`) — `{ sessionId; checkoutId }` → `{ target: WorktreeConsoleTargetDetails }`.

Create path (uses `WorktreeConsoleCreatePreflightResponse`, `src/console-contract.ts:266-269`, a discriminated union: `{ kind: 'ready'; branches?: string[] } | { kind: 'empty'; confirmationToken: string } | { kind: 'files' }`):

- `WorktreeConsoleCreateRequest` (`src/console-contract.ts:271-275`) — `{ sourceSessionId; branch?: string }` (branch starts the worktree from a local branch tip instead of source HEAD).
- `WorktreeConsoleCreateResponse` (`src/console-contract.ts:277-281`) — `{ target: WorktreeConsoleTargetDetails; targetSessionId: string; managedRoot: string }` — `targetSessionId` is **allocated on the Host**, the browser never chooses ownership identity (`src/console-contract.ts:265`).

Discard / finalize / retention mutations (each returns `WorktreeConsoleMutationResponse`, see below):

- `WorktreeConsoleDiscardRequest` (`src/console-contract.ts:292-298`) — `{ sessionId; checkoutId; expectedRevision; confirmDirty: boolean; rollbackPreview? }`.
- `WorktreeConsoleFinalizeRequest` (`src/console-contract.ts:369-377`) — `{ sessionId; checkoutId; expectedRevision; expectedReviewId; commitMessage: string; retention: WorktreeRetentionMode }`.
- `WorktreeConsoleFinalizePreviewRequest` (`src/console-contract.ts:379-387`) — like finalize but preview-based, plus optional `recoveryProof?`.
- `WorktreeConsoleSetRetentionRequest` (`src/console-contract.ts:389-394`) — `{ sessionId; checkoutId; expectedRevision; retention: Exclude<WorktreeRetentionMode, 'cleanup'> }`.
- `WorktreeConsoleSetPermanentRequest` (`src/console-contract.ts:397-402`) — codex 对齐：常驻标记；`{ sessionId; checkoutId; expectedRevision; permanent: boolean }`.
- `WorktreeConsoleRetryCleanupRequest` (`src/console-contract.ts:404-408`).
- `WorktreeConsoleBeginNextIterationRequest` (`src/console-contract.ts:410-414`).
- `WorktreeConsoleClearSidebarBadgeRequest` (`src/console-contract.ts:417-421`) — clears terminal sidebar badges (abandoned/completed).
- `WorktreeConsoleReturnToLocalRequest` (`src/console-contract.ts:430-433`) and `…Response` (`src/console-contract.ts:435-437`) — releases a *delivered* isolated session back to the Local boundary; rejects undelivered worktrees (`src/console-contract.ts:423-429`). Response is `{ target: WorktreeConsoleTargetDetails }`.
- `WorktreeConsoleMutationResponse` (interface, `src/console-contract.ts:439-445`) — `{ target: WorktreeConsoleTargetSummary; changedFiles?: string[]; commitOid?: string | null; checkpoint?: WorktreeCheckpointView; recoveryContinuation?: WorktreeRecoveryProof }`.

### Preview & recovery DTOs

- `WorktreeConsolePreflightRequest` / `…Response` (`src/console-contract.ts:300-309`) — `{ sessionId; checkoutId; expectedRevision; expectedReviewId }` → `{ preflight: WorktreeApplyPreflightView }`.
- `WorktreeConsolePreviewRequest` (`src/console-contract.ts:311-316`) — `{ sessionId; checkoutId; expectedRevision; expectedReviewId }`.
- `WorktreeConsoleCheckpointRequest` (`src/console-contract.ts:318-326`) — adds `expectedGeneration: string`, `requestId: string`, `commitMessage: string` (save exact reviewed snapshot as a managed-Worktree-only stage).
- `WorktreeConsoleResumeRevisionRequest` (`src/console-contract.ts:328-335`) — adds optional `conflictContinuation?: WorktreeApplyConflictContinuation`; Host re-runs conflict preflight under CAS.
- `WorktreeConsolePreviewRecoveryPreflightRequest` (`src/console-contract.ts:337-343`) — adds `expectedPreviewId: string`.
- `WorktreeConsolePreviewRecoveryPreflightResponse` (`src/console-contract.ts:345-347`) — `{ preflight: WorktreePreviewRecoveryPreflightView }`.
- `WorktreeConsolePreparePreviewRecoveryAnalysisRequest` (`src/console-contract.ts:349-351`) — extends the preflight request with `recoveryProof: WorktreePreviewRecoveryProof`.
- `WorktreeConsoleCreatePreviewRecoveryHandoffRequest` (`src/console-contract.ts:353-355`) — same extension.
- `WorktreeConsoleCreatePreviewRecoveryHandoffResponse` (`src/console-contract.ts:357-359`) — extends `WorktreeConsoleCreateResponse` with `recoveryContinuation: WorktreePreviewRecoveryHandoffProof`.
- `WorktreeConsoleRollbackPreviewRequest` (`src/console-contract.ts:361-367`) — `{ sessionId; checkoutId; expectedRevision; resumeRevision?: boolean; recoveryProof?: WorktreePreviewRecoveryProof }`.
- `WorktreeApplyConflictContinuation` (interface, `src/console-contract.ts:628-639`) — `{ kind: 'worktree_apply_conflict'; requestId; checkoutId; reviewId; revision; localHeadOid; conflictingFiles: string[] }` — stable identity for Client single-flight/retry.
- `WorktreeApplyConflictRecoveryProof` (`src/console-contract.ts:641-650`), `WorktreeReviewRegenerationProof` (`src/console-contract.ts:652-658`), `WorktreePreviewRecoveryAnalysisProof` (`src/console-contract.ts:660-668`), `WorktreePreviewRecoveryHandoffProof` (`src/console-contract.ts:670-679`) — the four Host-authority proof shapes.
- `WorktreeRecoveryProof` (union, `src/console-contract.ts:681-685`) — the four proofs above.
- `WorktreeConsoleContinuation` (type alias, `src/console-contract.ts:686`) — `= WorktreeApplyConflictContinuation`.

### Git / branch / tag DTOs

- `WorktreeConsoleFileStatus` (type, `src/console-contract.ts:481`) — `'added' | 'modified' | 'deleted' | 'renamed' | 'binary'`.
- `WorktreeConsoleDiffFile` (`src/console-contract.ts:483-489`) — `{ path; previousPath?; status: WorktreeConsoleFileStatus; patch: string | null; truncated: boolean }`.
- `WorktreeConsoleReviewDiffRequest` / `…Response` (`src/console-contract.ts:492-504`) — bound to the same immutable identity as Finalize; response `{ reviewId; revision; files: WorktreeConsoleDiffFile[]; truncated }`.
- `WorktreeConsoleGitBranch` (`src/console-contract.ts:507-512`) — `{ name; oid; isCurrent: boolean; upstream: string | null }`.
- `WorktreeConsoleGitOverviewResponse` (`src/console-contract.ts:514-520`) — `{ root; branch: string | null; headOid; branches: WorktreeConsoleGitBranch[]; dirtyCount }`.
- `WorktreeConsoleGitPruneEntry` (`src/console-contract.ts:523-527`) — `{ name; oid; reason? }`; mirrors `PruneMergedBranchesView`.
- `WorktreeConsoleGitPruneResponse` (`src/console-contract.ts:529-534`) — `{ dryRun; headBranch: string | null; pruned: …Entry[]; skipped: …Entry[] }`.
- `WorktreeConsoleGitGraphCommit` (`src/console-contract.ts:537-545`) — one `git log` row: `{ oid; parents: string[]; author; authorTime: number; refs: string[]; subject }`. Lane topology is computed client-side.
- `WorktreeConsoleGitGraphResponse` (`src/console-contract.ts:547-551`) — `{ root; branch; commits: WorktreeConsoleGitGraphCommit[] }`.
- `WorktreeConsoleGitMutationResponse` (`src/console-contract.ts:553-556`) — `{ branch: string }` (created or switched-to branch).
- `WorktreeConsoleGitTag` (`src/console-contract.ts:559-571`) — `{ name; oid; commitOid: string | null; annotated: boolean; message: string | null; pushed: boolean | null }`. `pushed` is `null` when the remote could not be queried (must not be reported as "not pushed", `src/console-contract.ts:567-569`).
- `WorktreeConsoleGitTagListResponse` (`src/console-contract.ts:573-576`) — `{ root; tags: WorktreeConsoleGitTag[] }`.
- `WorktreeConsoleGitTagMutationResponse` (`src/console-contract.ts:578-584`) — `{ tag: string; pushed?: boolean; pushMessage?: string }`.
- `WorktreeConsoleGitCreateTagRequest` (`src/console-contract.ts:587-595`) — `{ sessionId; name; message?; target?; push? }`.
- `WorktreeConsoleGitDeleteTagRequest` (`src/console-contract.ts:597-602`) — `{ sessionId; name; remote? }` (remote never forced).
- `WorktreeConsoleGitPushTagRequest` (`src/console-contract.ts:604-607`) — `{ sessionId; name }`.

### Abandoned-snapshot DTOs

- `WorktreeConsoleAbandonedSnapshot` (`src/console-contract.ts:448-454`) — `{ checkoutId; projectName; snapshotOid; snapshotAt: number; revision }` — for discarded records that have no live target.
- `WorktreeConsoleAbandonedListRequest` / `…Response` (`src/console-contract.ts:456-462`) — `{ sessionId }` → `{ snapshots: WorktreeConsoleAbandonedSnapshot[] }`.
- `WorktreeConsoleRestoreAbandonedRequest` / `…Response` (`src/console-contract.ts:464-472`) — `{ sessionId; checkoutId }` → `{ checkoutId; branch }`.

### Error model (codes, category, recovery, ERROR_META)

- `WORKTREE_CONSOLE_ERROR_CODES` (const array, `src/console-contract.ts:609-614`) — spreads `SESSION_CHECKOUT_ERROR_CODES` and adds `transport_unavailable`, `malformed_response`, `timeout`.
- `WorktreeConsoleErrorCode` (type, `src/console-contract.ts:616`) — `SessionCheckoutErrorCode | 'transport_unavailable' | 'malformed_response' | 'timeout'`.
- `WorktreeConsoleErrorCategory` (type, `src/console-contract.ts:617-625`) — `permission | stale | confirmation | recovery | conflict | unavailable | invalid | internal`.
- `WorktreeConsoleRecovery` (type, `src/console-contract.ts:626`) — `'none' | 'refresh' | 'confirm_dirty' | 'open_recovery' | 'retry'`.
- `WorktreeConsoleError` (interface, `src/console-contract.ts:688-693`) — `{ code: WorktreeConsoleErrorCode; message: string; details?: Record<string, string | number | boolean | null>; continuation?: WorktreeConsoleContinuation }`.
- `WorktreeConsoleOutcome<T>` (`src/console-contract.ts:745-747`) — discriminated union `{ ok: true; value: T } | { ok: false; error: WorktreeConsoleError }`. Every `WorktreeConsoleAdapter` method returns a `Promise<WorktreeConsoleOutcome<…>>`.
- `WorktreeConsoleErrorMeta` (interface, `src/console-contract.ts:699-703`) — `{ category; recovery; retryable: boolean }`.
- `ERROR_META` (const object, `src/console-contract.ts:705-738`) — `satisfies Record<WorktreeConsoleErrorCode, WorktreeConsoleErrorMeta>`. Maps every code to a fixed `{ category, recovery, retryable }`. Notable entries: `not_owner` → permission/none/false (`:718`); `stale_target` → stale/refresh/true (`:719`); `dirty_confirmation_required` → confirmation/confirm_dirty/true (`:720`); `transport_unavailable` → unavailable/retry/true (`:735`); `malformed_response` → internal/none/false (`:736`); `timeout` → unavailable/retry/true (`:737`). The full 32-entry table is at `src/console-contract.ts:706-737`.
- `worktreeConsoleErrorMeta(code)` (function, `src/console-contract.ts:740-742`) — returns `ERROR_META[code]`. Tested at `tests/console-contract.test.ts:54-75`.

### WorktreeConsoleAdapter (normalized Client seam)

`WorktreeConsoleAdapter` (`src/console-contract.ts:744-784`) is the **normalized Client seam** — Remote transport details stay behind one object so the Client never sees the wire. Every method returns `Promise<WorktreeConsoleOutcome<…>>`. Optional (`?`) methods are not yet mandated on every transport. The full method list, with return types:

| Method | Request / args | Returns |
|---|---|---|
| `preflightCreate?` (`:746`) | `{ sourceSessionId }` | `Outcome<WorktreeConsoleCreatePreflightResponse>` |
| `createWithInitialCommit?` (`:747`) | `{ sourceSessionId; confirmationToken }` | `Outcome<WorktreeConsoleCreateResponse>` |
| `initializeProject?` (`:748`) | `{ sourceSessionId }` | `Outcome<boolean>` |
| `sidebarTopology` (`:749`) | — | `Outcome<WorktreeSidebarTopologyResponse>` |
| `current` (`:750`) | `WorktreeConsoleCurrentRequest` | `Outcome<WorktreeConsoleCurrentResponse>` |
| `list` (`:751`) | `WorktreeConsoleListRequest` | `Outcome<WorktreeConsoleListResponse>` |
| `create` (`:752`) | `WorktreeConsoleCreateRequest` | `Outcome<WorktreeConsoleCreateResponse>` |
| `inspect` (`:753`) | `WorktreeConsoleInspectRequest` | `Outcome<WorktreeConsoleInspectResponse>` |
| `reviewDiff` (`:754`) | `WorktreeConsoleReviewDiffRequest` | `Outcome<WorktreeConsoleReviewDiffResponse>` |
| `preflight` (`:755`) | `WorktreeConsolePreflightRequest` | `Outcome<WorktreeConsolePreflightResponse>` |
| `previewRecoveryPreflight` (`:756`) | `WorktreeConsolePreviewRecoveryPreflightRequest` | `Outcome<WorktreeConsolePreviewRecoveryPreflightResponse>` |
| `preparePreviewRecoveryAnalysis` (`:757`) | `WorktreeConsolePreparePreviewRecoveryAnalysisRequest` | `Outcome<WorktreeConsoleMutationResponse>` |
| `createPreviewRecoveryHandoff` (`:758`) | `WorktreeConsoleCreatePreviewRecoveryHandoffRequest` | `Outcome<WorktreeConsoleCreatePreviewRecoveryHandoffResponse>` |
| `preview` (`:759`) | `WorktreeConsolePreviewRequest` | `Outcome<WorktreeConsoleMutationResponse>` |
| `checkpoint` (`:760`) | `WorktreeConsoleCheckpointRequest` | `Outcome<WorktreeConsoleMutationResponse>` |
| `resumeRevision` (`:761`) | `WorktreeConsoleResumeRevisionRequest` | `Outcome<WorktreeConsoleMutationResponse>` |
| `prepareReviewRegeneration` (`:762`) | `WorktreeConsolePrepareRegenerationRequest` | `Outcome<WorktreeConsoleMutationResponse>` |
| `rollbackPreview` (`:763`) | `WorktreeConsoleRollbackPreviewRequest` | `Outcome<WorktreeConsoleMutationResponse>` |
| `discard` (`:764`) | `WorktreeConsoleDiscardRequest` | `Outcome<WorktreeConsoleMutationResponse>` |
| `finalize` (`:765`) | `WorktreeConsoleFinalizeRequest` | `Outcome<WorktreeConsoleMutationResponse>` |
| `finalizePreview` (`:766`) | `WorktreeConsoleFinalizePreviewRequest` | `Outcome<WorktreeConsoleMutationResponse>` |
| `setRetention` (`:767`) | `WorktreeConsoleSetRetentionRequest` | `Outcome<WorktreeConsoleMutationResponse>` |
| `setPermanent` (`:768`) | `WorktreeConsoleSetPermanentRequest` | `Outcome<WorktreeConsoleMutationResponse>` |
| `retryCleanup` (`:769`) | `WorktreeConsoleRetryCleanupRequest` | `Outcome<WorktreeConsoleMutationResponse>` |
| `beginNextIteration` (`:770`) | `WorktreeConsoleBeginNextIterationRequest` | `Outcome<WorktreeConsoleMutationResponse>` |
| `returnToLocal` (`:771`) | `WorktreeConsoleReturnToLocalRequest` | `Outcome<WorktreeConsoleReturnToLocalResponse>` |
| `clearSidebarBadge` (`:772`) | `WorktreeConsoleClearSidebarBadgeRequest` | `Outcome<WorktreeConsoleMutationResponse>` |
| `gitOverview` (`:773`) | `sessionId` | `Outcome<WorktreeConsoleGitOverviewResponse>` |
| `gitGraph` (`:774`) | `sessionId, limit?` | `Outcome<WorktreeConsoleGitGraphResponse>` |
| `gitCreateBranch` (`:775`) | `sessionId, name` | `Outcome<WorktreeConsoleGitMutationResponse>` |
| `gitSwitchBranch` (`:776`) | `sessionId, branch` | `Outcome<WorktreeConsoleGitMutationResponse>` |
| `gitPruneMergedBranches` (`:777`) | `sessionId, dryRun` | `Outcome<WorktreeConsoleGitPruneResponse>` |
| `gitListTags` (`:778`) | `sessionId` | `Outcome<WorktreeConsoleGitTagListResponse>` |
| `gitCreateTag` (`:779`) | `WorktreeConsoleGitCreateTagRequest` | `Outcome<WorktreeConsoleGitTagMutationResponse>` |
| `gitDeleteTag` (`:780`) | `WorktreeConsoleGitDeleteTagRequest` | `Outcome<WorktreeConsoleGitTagMutationResponse>` |
| `gitPushTag` (`:781`) | `WorktreeConsoleGitPushTagRequest` | `Outcome<WorktreeConsoleGitTagMutationResponse>` |
| `listAbandoned?` (`:782`) | `WorktreeConsoleAbandonedListRequest` | `Outcome<WorktreeConsoleAbandonedListResponse>` |
| `restoreAbandoned?` (`:783`) | `WorktreeConsoleRestoreAbandonedRequest` | `Outcome<WorktreeConsoleRestoreAbandonedResponse>` |

The deterministic test double `createWorktreeConsoleAdapterFixture(stateful?)` in `tests/support/worktree-console.ts` (`:124-534`) implements this interface in-memory: it records every call into `calls` (`:55-58`, `:127-129`), builds a `readyTarget()` (`src/console-contract.ts`-shaped `WorktreeConsoleTargetDetails`, `:60-111`), and returns a `delivered()` mutation (`WorktreeConsoleMutationResponse`, `:130-170`) that stamps `state: 'delivered'` / `phase: 'discarded'` plus a `deliveryProof`. With `stateful = true` (`:518-532`) the `preview` / `rollbackPreview` / `resumeRevision` / `finalizePreview` methods gain a `stale_target` guard mirroring Host CAS. The fixture's `current` → `finalize` flow is asserted at `tests/console-contract.test.ts:77-97`.

## Architecture

The contract is the shared boundary between three "tracks": the Host (server, Typert `Remote` service), the Client (browser), and the in-memory test fixtures. It has no implementation of its own — it is types + pure helpers that both sides import.

```text
┌─────────────────────────── src/console-contract.ts ───────────────────────────┐
│  enums · projection helpers (consoleStateFromDomain, worktreeReachedDelivery)  │
│  DTOs: TargetSummary/Details, Sidebar*, Git*, Review, Recovery proofs, Errors  │
│  WorktreeConsoleAdapter  (normalized Client seam, lines 744-784)               │
└───────┬───────────────────────────────┬───────────────────────────────┬───────┘
        │ import types + ERROR_META      │ import DTO types + RPC map     │ re-implement
        ▼                                ▼                                ▼
┌────────────────────┐          ┌────────────────────┐          ┌────────────────────┐
│ console-host/      │  Typert  │ console-remote/    │  wire    │ tests/support/     │
│ service.ts         │  Remote  │ remote.ts          │ ───────► │ worktree-console.ts│
│ (WorktreeConsole-  │ ◄─────── │ (GitWorktreeRemote │          │ (createWorktree-   │
│  Service, :35)     │          │  descriptors, :31) │          │  ConsoleAdapter-)  │
│ control-plane.ts   │          │                    │          │  Fixture, :124)    │
│ projection.ts      │          └────────────────────┘          └────────────────────┘
│ (consoleStateFrom- │
│  Domain usage, :4) │
└────────────────────┘
        │
        ▼  export * from './console-contract.js'  (src/index.ts:243)
┌────────────────────┐
│ plugin entry       │  public surface for all Worktree Console types/functions
│ src/index.ts       │
└────────────────────┘
```

The Host side (`src/console-host/service.ts:35`) is a `TypertRemoteService` named `gitWorktree` that translates each DTO in/out of the `WorktreeConsoleControlPlane` (`src/console-host/control-plane.ts`) and `projection.ts` (which itself calls `consoleStateFromDomain` at `src/console-host/projection.ts:4` and `worktreeReachedDelivery` at `:5`). The Remote side (`src/console-remote/remote.ts:31`) declares the `GitWorktreeRemote` namespace / `TypertRemoteMap` (`:36-60`) that encodes each adapter method as a wire method with `agentId`/locale args. Both import only types and the error codes from the contract, never behavior.

## Data Flow

A typical Client→Host round trip through the contract:

1. **Sidebar discovery** — Client calls `adapter.sidebarTopology()` (`src/console-contract.ts:749`). Host resolves `WorktreeSidebarTopologyResponse` (`src/console-contract.ts:245-251`) including `workspaceClientFlavor` and `officialWorkspaceActive`; the Client must not mount a guessed browser for an unknown flavor (`src/console-contract.ts:250`).
2. **Select current target** — Client calls `adapter.current({ sessionId })` (`:750`), receiving `WorktreeConsoleTargetDetails` (`:182-195`) with Host-validated `managedRoot` / `sourceRoot` / `sourceOid` / `currentBranch` and the caller-specific `capabilities` mask (`:98-124`).
3. **Review-bound mutation** — every mutating call carries `expectedRevision` + `expectedReviewId` (e.g. `WorktreeConsoleFinalizeRequest`, `:369-377`). The Host re-validates identity and bumps the CAS revision. The Client passes a `WorktreeApplyConflictContinuation` (`WorktreeConsoleResumeRevisionRequest`, `:328-335`) to recover a conflict under CAS.
4. **Outcome envelope** — every method returns `WorktreeConsoleOutcome<T>` (`:695-697`); on failure the Client reads `WorktreeConsoleError` (`:688-693`) and maps `code` via `worktreeConsoleErrorMeta(code)` (`:740-742`) to a single `{ category, recovery, retryable }` policy from `ERROR_META` (`:705-738`). `transport_unavailable` / `timeout` / `malformed_response` (`:609-614`) are transport-level codes folded into the same envelope.
5. **Projection** — the Host's `projection.ts` uses `consoleStateFromDomain(source)` (`src/console-contract.ts:76-91`) and `worktreeReachedDelivery(...)` (`:64-73`) to derive the `state`/`phase` projected onto `WorktreeConsoleTargetSummary` (`:149-179`), so delivery always wins over a stale phase and a `discarded` record keeps its pre-discard delivery label.

The test fixture (`tests/support/worktree-console.ts:60`) reproduces this flow in-memory: `current` (`:180-183`) returns the `readyTarget`, and `finalize` (`:376-379`) returns `delivered()` (`:130-170`) which sets `state: 'delivered'`, `phase: 'discarded'`, `deliveryProof`, and the post-delivery `capabilities` (only `inspect` / `beginNextIteration` / `returnToLocal` remain). With `stateful` it also enforces revision CAS (`:518-532`).

## Connections

- [[index]] — plugin entry; `export * from './console-contract.js'` (src/index.ts:243) promotes the contract to the public surface.
- [[console-host-service]] — Host-side `TypertRemoteService` (`WorktreeConsoleService`, src/console-host/service.ts:35) that implements the adapter methods as RPC.
- [[console-host-control-plane]] — `WorktreeConsoleControlPlane` invoked by the service for each DTO call.
- [[console-host-projection]] — Host projection layer that consumes `consoleStateFromDomain` (src/console-host/projection.ts:4) and `worktreeReachedDelivery` (:5).
- [[console-remote]] — `GitWorktreeRemote` namespace / `TypertRemoteMap` (src/console-remote/remote.ts:37,:36-60) declaring each wire method.
- [[session-checkout-module]] — domain module whose `SessionCheckoutModule` interface (src/index.ts:113-219) the Host control-plane wraps into Console DTOs.
- [[types]] — source of imported domain views (`WorktreeDeliveryProofView`, `WorktreeCheckpointView`, `WorktreeValidationItem`, `WorktreeRetentionMode`, `SESSION_CHECKOUT_ERROR_CODES`, etc., src/console-contract.ts:11-24).

## Known Issues

- **No runtime enforcement in the contract itself** — `WorktreeConsoleAdapter` (src/console-contract.ts:744-784) is a pure TypeScript interface. Identity/revision/CAS checks described by the doc comments live only in the Host (`console-host/service.ts`, `control-plane.ts`), not in this module. The in-memory fixture only mirrors CAS when constructed with `stateful = true` (`tests/support/worktree-console.ts:518-532`); the default (`stateful = false`) fixture always succeeds.
- **Optional adapter methods are not yet mandated** — `preflightCreate`, `createWithInitialCommit`, `initializeProject`, `listAbandoned`, `restoreAbandoned` (src/console-contract.ts:746-748,:782-783) are optional (`?`), so partial transports may omit them; callers must branch on presence.
- **`WorktreeConsoleTargetDetails` fields absent from `Summary`** — `managedRoot`, `sourceRoot`, `sourceOid`, `currentBranch`, `recoveryContinuation` (src/console-contract.ts:182-195) are only present after the Host validates open authority; the list/sidebar rows stay path-free by design.
- **No disabled/feature-flagged code in this module** — every exported symbol is live; there are no commented-out or `@deprecated` members in `src/console-contract.ts`.
