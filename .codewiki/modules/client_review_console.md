---
title: client_review_console
type: module
source_files:
  - src/client/review-console/index.ts
  - src/client/review-console/recovery-continuation.ts
  - src/client/review-console/request-cache.ts
  - src/client/review-console/preflight-cache.ts
  - src/client/review-console/preview-recovery-cache.ts
  - src/client/review-console/WorktreeReviewPanel.tsx
  - src/client/review-console/ReviewActions.tsx
  - src/client/review-console/ReviewDetailsModal.tsx
  - src/client/review-console/PreflightStatus.tsx
  - src/client/review-console/DeliveryProof.tsx
  - src/client/review-console/ReviewIcon.tsx
  - src/client/review-console/status-events.ts
  - src/client/review-console/review-console.styles.ts
  - src/console-contract.ts
  - src/client/actions.ts
  - src/types.ts
  - tests/client-recovery-continuation.test.ts
  - tests/client-preflight-cache.test.ts
  - tests/client-preview-recovery-cache.test.ts
  - tests/client-review-console.test.tsx
  - tests/client-review-details.test.tsx
tags: [client, review-console, recovery, preflight, cache, ui]
---

## Overview

The `client_review_console` module implements the **browser-side review surface** for the Worktree Console: the card/dock UI that displays an authoritative Host review (`WorktreeConsoleReviewSummary`), exposes the read-only preflight checks that gate every write, drives all delivery mutations (`preview` / `checkpoint` / `resumeRevision` / `rollbackPreview` / `finalize` / `finalizePreview` / `discard` / `retryCleanup` / recovery handoffs), and — crucially — implements **durable recovery/continuation of unsent Agent requests** across renderer teardown.

Two design invariants run through the whole module:

1. **Profile = Host authority.** The Client never trusts its own cached state for writes. `ReviewActions` re-runs `adapter.preflight` / `adapter.previewRecoveryPreflight` with `force` immediately before every mutation, and `recovery-continuation.ts` re-`inspect()`s the target and re-validates exact checkout/revision/kind identity before each outward `Session.prompt`.
2. **Browser storage is untrusted context, not authorization.** `recovery-continuation.ts` reads a persisted recovery request from `localStorage` only as a *reminder to revalidate*; every restored request is re-probed against the Host and fails closed (`cancel`) on any mismatch. See `readPersisted` at `src/client/review-console/recovery-continuation.ts:93` and the forged-kind rejection test at `tests/client-recovery-continuation.test.ts:384`.

The module has three cooperating sub-systems:
- **Read-only caches** (`request-cache.ts` → `preflight-cache.ts`, `preview-recovery-cache.ts`): identity-keyed, single-flight, generation-stamped React stores.
- **Review UI** (`WorktreeReviewPanel`, `ReviewActions`, `ReviewDetailsModal`, `PreflightStatus`, `DeliveryProof`, `ReviewIcon`, `status-events`, `index`, `styles`): pure presentation plus the mutation orchestration.
- **Recovery continuation** (`recovery-continuation.ts`): the durable, Host-revalidated queue that ships a recovery prompt to the owner Session's `Session.prompt`.

## Key Components

### `src/client/review-console/index.ts` — public barrel

- `reviewEvidenceFromTarget(target, detailsMarkdown?)` — `src/client/review-console/index.ts:12` — projects a persisted `WorktreeConsoleTargetSummary.review` into the compact `WorktreeReviewEvidence` shape used by the panel; returns `null` when `target.review` is absent.
- `reviewIdentityFromTarget(sessionId, target)` — `src/client/review-console/index.ts:24` — builds the exact CAS identity (`sessionId`, `checkoutId`, `expectedRevision`, `expectedReviewId`) that `Finalize` and advanced reads require. Returns `null` unless `target.checkoutId` and `target.review` both exist.
- Re-exports `WorktreeReviewPanel` and the types `WorktreeReviewEvidence`, `WorktreeReviewIdentity`, `WorktreeReviewPanelProps` from `WorktreeReviewPanel.js` (`src/client/review-console/index.ts:8`, `:5`–`:9`).

### `src/client/review-console/request-cache.ts` — generic identity-keyed cache

- `RequestSnapshot<TPreflight>` — `src/client/review-console/request-cache.ts:9` — discriminated union `{status:'idle'} | {status:'loading'} | {status:'success';preflight} | {status:'error';error}`.
- `Entry<TPreflight>` — `src/client/review-console/request-cache.ts:135` — per-identity store: `snapshot`, `listeners`, `promise?` (in-flight), `generation` (bumped on invalidate).
- `RequestCache<TIdentity, TPreflight>` — `src/client/review-console/request-cache.ts:78` — interface exposing `read`, `invalidate`, `useSnapshot`.
- `createRequestCache(options)` — `src/client/review-console/request-cache.ts:41` — the factory. Key behaviors:
  - Caches live in a **per-adapter `WeakMap`** (`caches`, `src/client/review-console/request-cache.ts:51`), so a remounted client can never read another adapter's data.
  - `read` (`src/client/review-console/request-cache.ts:78`) is **single-flight**: a concurrent call joins the in-flight `promise`; it serves the last `success`/`error` until `force` is passed; it publishes `loading` before the request; the landing response only republishes if `entry.generation === generation` (`src/client/review-console/request-cache.ts:93`), which prevents a stale response from overwriting a newer promise.
  - `invalidate` (`src/client/review-console/request-cache.ts:111`) bumps `generation`, clears the promise, and republishes `idle`.
  - `useSnapshot` (`src/client/review-console/request-cache.ts:119`) wires `useSyncExternalStore` and auto-reads once on mount when `adapter && identity && enabled`.

### `src/client/review-console/preflight-cache.ts` — Ready → write preflight

- `PreflightSnapshot` — `src/client/review-console/preflight-cache.ts:5`.
- `cache` is built from `createRequestCache` keyed by `sessionId\0checkoutId\0expectedRevision\0expectedReviewId` and wrapping `adapter.preflight` (`src/client/review-console/preflight-cache.ts:14`).
- `readReviewPreflight` (`:18`), `invalidateReviewPreflight` (`:21`), `useReviewPreflight` (`:23`).

### `src/client/review-console/preview-recovery-cache.ts` — detached-preview recovery preflight

- `PreviewRecoverySnapshot` — `src/client/review-console/preview-recovery-cache.ts:5`.
- `cache` keyed by `sessionId\0checkoutId\0expectedRevision\0expectedReviewId\0expectedPreviewId`, wrapping `adapter.previewRecoveryPreflight` (`src/client/review-console/preview-recovery-cache.ts:15`).
- `readPreviewRecoveryPreflight` (`:19`), `invalidatePreviewRecoveryPreflight` (`:21`), `usePreviewRecoveryPreflight` (`:23`). The module comment (`:18`) stresses **writes must force a refresh**; this is read-only assessment.

### `src/client/review-console/recovery-continuation.ts` — durable recovery queue

Public types:
- `WorktreeApplyConflictRecoveryRequest` — `src/client/review-console/recovery-continuation.ts:6` — `{kind:'worktree_apply_conflict', sessionId, requestId, checkoutId, reviewId, revision, localHeadOid, conflictingFiles[]}`.
- `WorktreeReviewRegenerationRequest` — `src/client/review-console/recovery-continuation.ts:19` — read-only regeneration; carries `revision` that **must stay unchanged** (the path is read-only).
- `WorktreeRecoveryRequest` — `src/client/review-console/recovery-continuation.ts:29` — union of the two above.
- `WorktreeRecoveryStatus` — `src/client/review-console/recovery-continuation.ts:30` — `'queued' | 'sending' | 'sent' | 'failed' | 'cancelled'`.
- `WorktreeRecoverySnapshot` — `src/client/review-console/recovery-continuation.ts:32` — `{status, request, error?}`.
- `RecoveryEntry` (internal) — `src/client/review-console/recovery-continuation.ts:38` — `{snapshot, adapter, services, isActive, claimed, abort?, unsubscribers, listeners}`.
- `PersistedRecoveryStatus` / `PersistedRecovery` — `src/client/review-console/recovery-continuation.ts:53`, `:54` — `localStorage` shape, version-pinned to `1`.

Public functions:
- `enqueueWorktreeRecovery(input)` — `src/client/review-console/recovery-continuation.ts:389` — durable context queue only; validates the request (`validRequest`), persists, and kicks `attempt`. Reuses an existing entry if the `requestId` matches; otherwise cancels the previous entry.
- `restoreWorktreeRecovery(input)` — `src/client/review-console/recovery-continuation.ts:429` — called on renderer remount; restores a persisted unsent request (`readPersisted`), or re-attaches to a live entry. Sending entries that were torn down are marked `failed` with an "unknown outcome" error (`:452`–`:460`).
- `retryWorktreeRecovery(sessionId)` — `src/client/review-console/recovery-continuation.ts:491` — re-sends from `failed`/`cancelled`; re-validates Host identity via `attempt`.
- `getWorktreeRecoverySnapshot(sessionId)` — `src/client/review-console/recovery-continuation.ts:503`.
- `subscribeWorktreeRecovery` — `src/client/review-console/recovery-continuation.ts:507`.
- `useWorktreeRecoverySnapshot(sessionId)` — `src/client/review-console/recovery-continuation.ts:513` — `useSyncExternalStore` binding.
- `cancelWorktreeRecovery(sessionId, requestId?)` — `src/client/review-console/recovery-continuation.ts:523` — drops renderer-lifetime evidence only when status is not `sent`/`failed`.
- `detachWorktreeRecoveryRuntime(sessionId)` — `src/client/review-console/recovery-continuation.ts:531` — simulates teardown while keeping durable unsent context.
- `clearWorktreeRecovery(sessionId)` — `src/client/review-console/recovery-continuation.ts:540` — full teardown + `localStorage` removal.
- `buildWorktreeRecoveryPrompt(request, t?)` — `src/client/review-console/recovery-continuation.ts:378` — builds the exact Agent prompt; the read-only regeneration branch carries the "严格 Read Only / 不要修改任何文件" instruction (asserted at `tests/client-recovery-continuation.test.ts:405`).

Key internal guards:
- `validRequest` (`:140`) enforces length/character bounds on every id and validates `conflictingFiles` (≤500, `safeConflictFile` at `:129` rejects absolute paths, `..`, control chars), and a 40/64-hex `localHeadOid`.
- `readPersisted` (`:93`) only accepts a tightly-shaped, version-1 record whose `sessionId` matches; anything else is deleted and ignored.
- `targetMatchesRequest` (`:195`) re-validates `checkoutId`, `ownerSessionId`, `targetSessionId`, `revision`, `managedRoot`, and — for conflicts — the full `recoveryContinuation` proof byte-for-byte.
- `sessionReady` (`:238`) requires an `open`, non-`running`, non-`removed` owner Session whose cwd matches `target.managedRoot` (`samePath` at `:186`).
- `attempt` (`:280`) is the single-flight send loop: it re-`inspect`s, re-checks `isCurrent`, re-validates `targetMatchesRequest`, waits via `waitForSession` (`:264`, 250 ms polling) until the owner Session is idle+open, then sends through `binding.session.prompt(..., 'queue', abort.signal)` (`:351`). Every transition re-checks `activeSessionState` (`:227`) and aborts on selection/scope change.

### `src/client/review-console/WorktreeReviewPanel.tsx` — read-only evidence card

- `WorktreeReviewEvidence` — `src/client/review-console/WorktreeReviewPanel.tsx:9` — extends `WorktreeConsoleReviewSummary` with optional `detailsMarkdown`.
- `WorktreeReviewIdentity` — `src/client/review-console/WorktreeReviewPanel.tsx:13` — `{sessionId, checkoutId, expectedRevision, expectedReviewId}`.
- `WorktreeReviewPanelProps` — `src/client/review-console/WorktreeReviewPanel.tsx:20`.
- `validationLabel` (`:27`), `testStatusLabel` (`:34`).
- `reviewIsStale(target, identity, review)` — `src/client/review-console/WorktreeReviewPanel.tsx:40` — returns `true` when `target.state === 'working'`, or when the review id/revision no longer matches the live target. Drives the "验收结果已过期，请刷新" warning (tested at `tests/client-review-console.test.tsx:194`).
- `WorktreeReviewPanel` (`:54`) — collapses to summary + file count + foldable validation details; renders **no** diff, inspect, or retention buttons (asserted at `tests/client-review-console.test.tsx:109`, `:181`).

### `src/client/review-console/ReviewActions.tsx` — mutation orchestration (largest file, 1199 lines)

- `ReviewActionsProps` — `src/client/review-console/ReviewActions.tsx:35`.
- `Mutation`/`CommitMode` unions — `:52`, `:53`.
- `DEFAULT_RETAIN_ENVIRONMENT = true` — `src/client/review-console/ReviewActions.tsx:80` — delivery keeps the frozen environment by default so an accidental delivery stays recoverable.
- `ReviewActions` (`:82`) — the orchestrator. Notable internal handlers (line references are their `const` definitions / first use):
  - `previewLocal` (`:453`) — re-runs `readReviewPreflight(force)`, then `adapter.preview`; re-probes on `conflict`/`blocked`.
  - `openCheckpoint`/`checkpoint` (`:487`, `:494`) — single-flight, generation-bound `requestId` (`checkpointRequestIdForGeneration` at `:55`), never touches Local Preview.
  - `resumeRevision` (`:536`) — `adapter.resumeRevision` then `prefillSessionDraft`.
  - `rollbackPreview` (`:561`) — for `preview_detached` it forces a fresh `previewRecoveryPreflight`, requires `proof.rollback.status === 'safe'`.
  - `submitCommit` (`:625`) — handles `finish` (re-preflights, forbids `blocked`/`conflict`) and `finalize_preview` (forces recovery proof, requires `proof.finalize.status === 'safe'`).
  - `discard` (`:699`) — sends `rollbackPreview:true` for active previews.
  - `startConflictRecovery` (`:265`) — resume Working via `adapter.resumeRevision` with `conflictContinuation`, then `enqueueRecovery` (`:260`).
  - `startReviewRegeneration` (`:360`) — read-only path; `adapter.prepareReviewRegeneration` then `enqueueRecovery`.
  - `analyzeRecovery` (`:741`) / `handoffRecovery` (`:797`) — detached-preview read-only analysis / fresh-worktree handoff via `openAuthorizedWorktreeTarget` + `Session.prompt`.
  - `openHolder` (`:878`) — opens the Session holding the Local acceptance slot.
  - `applyTarget` (`:253`) — pushes the Host-returned target up via `onTargetChange` and pings `requestWorktreeReviewRefresh`.
  - `finishError` (`:232`) — maps `apply_conflict` runtime conflicts into `setRuntimeConflict`, and `stale_*` codes into a refresh + `onStale`.
- Effects: `restoreWorktreeRecovery` on mount (`:155`); collapse-on-review-change (`:160`); outside-click / Escape menu close (`:170`); revision-change (`:190`) and `reviewSlot` release (`:200`) handlers that invalidate the preflight cache.

### `src/client/review-console/ReviewDetailsModal.tsx` — read-only detail dialog

- `validationText` (`:8`), `validationIcon` (`:11`), `COLLAPSED_LIST_LIMIT = 5` (`:15`).
- `ReviewDetailsList` (`:17`) — collapsible list above the 5-item threshold.
- `ReviewDetailsModal` (`:36`) — focus-trap dialog (`:41`); derives `state`/`note` from `target.state`, `preflight.status`, `preview_detached`/`recovery_required`; renders conflict files, validation, and a version `<details>` (reviewId / revision / currentOid). No diff or write buttons (asserted at `tests/client-review-details.test.tsx:55`).

### `src/client/review-console/PreflightStatus.tsx`

- `shortOid` (`:7`), `statusLabel` (`:11`), `PreflightStatus` (`:21`) — renders `idle`/`loading`/`error`/`conflict`/`blocked`/neutral states; wires `onRefresh`/`onRecovery`/`onOpenHolder`.

### `src/client/review-console/DeliveryProof.tsx`

- `shortOid` (`:4`), `validationLabel` (`:8`), `DeliveryProof` (`:16`) — renders `target.deliveryProof` as full or `compact` (dock) variant; derives lifecycle text from `state` (`delivered`/`retained`/`cleanup_pending`/`else`). `retained` shows `expiresAt` localized via `useClientLanguage` (`:18`, `:25`).

### `src/client/review-console/ReviewIcon.tsx`

- `icons` map (`:8`), `ReviewIconName` (`:16`), `ReviewIcon` (`:18`) — thin `lucide-react` wrapper.

### `src/client/review-console/status-events.ts`

- `WORKTREE_REVIEW_REFRESH_EVENT = 'dsh-git-worktree:review-refresh'` — `src/client/review-console/status-events.ts:1`.
- `requestWorktreeReviewRefresh(sessionId)` — `src/client/review-console/status-events.ts:4` — dispatches a `CustomEvent` so every mounted review surface re-reads the Host-authoritative target.

### `src/client/review-console/review-console.styles.ts`

- `REVIEW_CONSOLE_STYLES` — `src/client/review-console/review-console.styles.ts:1` — all CSS for the card, dock, details modal, preflight, delivery proof, and responsive rules. Notably the card uses `overflow:visible` so the "more" menu is not clipped (tested at `tests/client-review-console.test.tsx:130`), while the composer dock opens its menu **upward** (`.dsh-wt-review-dock .dsh-wt-more-content` bottom-anchored, `:46`), and the dock hides `loading`/`ready`/`local_advanced`/`already_in_local` preflight states (`:111`).

## Architecture

```text
┌──────────────────────── ReviewActions.tsx ────────────────────────┐
│ begin/finish (mutation lock)                                       │
│  previewLocal  checkpoint  resumeRevision  rollbackPreview         │
│  submitCommit  discard  startConflictRecovery  startReviewRegen    │
│  analyzeRecovery  handoffRecovery  openHolder                      │
│        │                       │                                   │
│        ▼                       ▼                                   │
│  useReviewPreflight()   usePreviewRecoveryPreflight()             │
│  (preflight-cache)      (preview-recovery-cache)                 │
│        │                       │                                   │
│        ▼                       ▼                                   │
│  adapter.preflight()    adapter.previewRecoveryPreflight()        │
│  adapter.rollbackPreview/finalize/finalizePreview/discard/...     │
└────────┬───────────────────────┬──────────────────────────────────┘
         │ applyTarget→onTargetChange
         ▼                        ▼
┌─────────────────┐   ┌──────────────── RecoveryActions ────────────────┐
│ WorktreeReview  │   │ enqueueWorktreeRecovery → attempt()             │
│ Panel / Modal /│   │   re-inspect → targetMatchesRequest             │
│ PreflightStatus│   │   waitForSession(250ms poll) → sessionReady      │
│ DeliveryProof  │   │   binding.session.prompt('queue', abort)        │
└─────────────────┘   │   persistSnapshot→localStorage '…v1:sessionId' │
                      │   restoreWorktreeRecovery→readPersisted(recheck)│
                      └───────────────────┬──────────────────────────────┘
                                          ▼
                              Host (adapter.inspect/adapter.*)
                              + Owner Session.prompt (Agent)

request-cache.ts : createRequestCache → per-adapter WeakMap + generation-stamped single-flight
```

## Data Flow

1. **Mount / auto-preflight.** `ReviewActions` computes `autoPreflightEnabled` (`src/client/review-console/ReviewActions.tsx:118`) from `adapter && identity && !disabled && state==='ready_for_review' && capabilities.preflight`. When true, `useReviewPreflight` (`:125`) auto-reads once and publishes `success`/`error`/`loading` via `useSyncExternalStore`. The primary "预览修改" button stays disabled until `safeReadyPreflight` (`:130`, i.e. status not `blocked`/`conflict`).
2. **Write path (every mutation).** The handler calls `readReviewPreflight(adapter, identity, true)` (or `readPreviewRecoveryPreflight(..., true)` for detached previews) to **force a fresh Host read**, then gates on the result (`previewLocal` `:455`, `submitCommit` `:632`, `rollbackPreview` `:570`, `startConflictRecovery` `:276`). The forced read satisfies the "writes must force refresh" contract in `preview-recovery-cache.ts:19`.
3. **Host mutation → applyTarget.** On a successful adapter call, the handler calls `applyTarget(outcome.value.target)` (`src/client/review-console/ReviewActions.tsx:253`), which updates the parent via `onTargetChange` and fires `requestWorktreeReviewRefresh` (`src/client/review-console/status-events.ts:4`) to refresh every mounted surface.
4. **Conflict / stale_isolated recovery.** A `conflict` preflight → `startConflictRecovery` resumes Working (`adapter.resumeRevision({conflictContinuation})`) and then `enqueueRecovery` (`src/client/review-console/ReviewActions.tsx:260`) builds a `worktree_apply_conflict` request and hands it to `enqueueWorktreeRecovery`. A `blocked`+`stale_isolated` preflight → `startReviewRegeneration` → `prepareReviewRegeneration` → `enqueueRecovery` with a `worktree_review_regeneration` request.
5. **Recovery continuation.** `enqueueWorktreeRecovery` (`src/client/review-console/recovery-continuation.ts:389`) validates, persists to `localStorage` (`STORAGE_PREFIX = 'dsh-git-worktree:recovery:v1:'`, `:51`), and starts `attempt`. `attempt` (`:280`) re-`inspect`s the target, re-validates `targetMatchesRequest`, and — if the owner Session is not yet idle+open — parks via `waitForSession` (`:264`, a 250 ms `setInterval`). Once `sessionReady` (`:238`) holds, it re-checks, aborts on any session switch/scope change, and sends through `binding.session.prompt(..., 'queue', abort.signal)` (`:351`). Status flows `queued → sending → sent`, or `failed`/`cancelled`.
6. **Durable restore.** On renderer remount, `ReviewActions`' mount effect calls `restoreWorktreeRecovery` (`src/client/review-console/ReviewActions.tsx:82` via `:157`), which either re-attaches a live in-memory entry or rehydrates a persisted `localStorage` record (`readPersisted`, `:93`) and re-runs `attempt`. A request that was `sending` at teardown becomes `failed` with an "unknown" error (`:452`–`:460`) and **must** be explicitly retried — never auto-replayed (tested at `tests/client-recovery-continuation.test.ts:348`).
7. **Detached-preview recovery.** `preview_detached` state shows `recoveryProof` (from `usePreviewRecoveryPreflight`) with `rollback.status`/`finalize.status`. `rollbackPreview`/`submitCommit(finalize_preview)` require `status==='safe'` and re-`readPreviewRecoveryPreflight(force)` immediately before the write (`src/client/review-console/ReviewActions.tsx:625`, `:654`).
8. **Slot release.** When `reviewSlot` transitions `waiting → available`, an effect invalidates and re-reads the preflight cache (`src/client/review-console/ReviewActions.tsx:200`).

## Connections

- [[console-contract]] — `src/console-contract.ts` defines every DTO this module consumes: `WorktreeConsoleAdapter` (`:745`), `WorktreeConsoleTargetSummary`/`Details`, `WorktreeConsoleReviewSummary`, `WorktreeConsoleError`/`worktreeConsoleErrorMeta` (`:740`), and the recovery-proof unions (`WorktreeApplyConflictRecoveryProof`, `WorktreeReviewRegenerationProof`, `WorktreePreviewRecoveryProof`, etc., `:641`–`:686`). The Client is the read-only projection side of this contract.
- [[client-actions]] — `src/client/actions.ts` supplies `WorktreeClientServices`, `selectedSessionId` (`:135`), `openAuthorizedWorktreeTarget` (`:236`), `openIsolatedTarget` (`:199`), and `prefillSessionDraft` (`:266`), all used by `ReviewActions` and `recovery-continuation`.
- [[client-i18n]] — `src/client/i18n.tsx` provides `useClientTranslator`, `useClientLanguage`, `translatorForServices`, `defaultClientTranslator` used throughout for labels and recovery prompts.
- [[target-console]] — `WorktreeReviewStatus` (in `src/client/target-console/`) mounts `ReviewActions` and `ReviewDetailsModal` from the sidebar/card surface; test cross-references at `tests/client-review-console.test.tsx:11` and `tests/client-review-details.test.tsx:7`.
- [[console-host]] — the Host side that *computes* the preflight views, recovery proofs, and CAS-guarded mutations this Client merely projects and re-validates (e.g. `previewRecoveryPreflight`, `prepareReviewRegeneration`, `resumeRevision`).
- [[console-remote]] — the Remote transport behind `WorktreeConsoleAdapter` (see `src/client/console-remote/adapter.ts`); this module never touches transport directly.
- [[workspace-sidebar]] — aggregate task list that links into the same review surfaces.

## Known Issues

- **Recovery prompt is queued, not steered.** `attempt` sends via `prompt(..., 'queue', signal)` (`src/client/review-console/recovery-continuation.ts:351`); it does not await Agent completion, so the UI only knows `sent`, not whether the Agent acted. The follow-up `reviewSlot`/`review` change is what surfaces completion.
- **`preview_detached` proof staleness is possible between reads.** `activeRecovery` (`src/client/review-console/ReviewActions.tsx:148`) is matched by `checkoutId`/`reviewId` only; `rollbackPreview`/`finalize_preview` therefore always force a `readPreviewRecoveryPreflight(force)` (`:570`, `:654`) before trusting the proof — but a proof read between the forced read and the write could still differ; the Host re-validates under its lock as the authoritative backstop.
- **`localStorage` is best-effort only.** `browserStorage()` (`:61`) returns `undefined` in non-browser/SSR contexts and all persistence is wrapped in `try/catch`; the comment at `:88` states browser persistence is context only and Host identity checks remain authoritative. A forged/partial record is silently dropped in `readPersisted` (`:93`–`:118`).
- **No automatic replay of `sending` state.** By design, a recovery request torn down mid-`sending` is marked `failed` ("结果未知") and requires explicit `retryWorktreeRecovery` (`tests/client-recovery-continuation.test.ts:348`). This avoids double-sending an ambiguous request.
- **`validRequest` trusts shape only.** `validRequest` (`src/client/review-console/recovery-continuation.ts:140`) bounds lengths and rejects obviously-unsafe paths, but the persisted record is still treated as attacker-controlled; the actual authorization is the Host re-validation in `targetMatchesRequest` (`:195`) + `sessionReady` (`:238`).
- **`enqueueWorktreeRecovery` re-kick on same requestId.** If an existing entry shares `requestId`, only the `adapter`/`services`/`isActive` refs are updated and `attempt` is not re-run (`src/client/review-console/recovery-continuation.ts:280`–`:404`); callers must not expect a fresh send for an identical requestId.
- **`ReviewActions` is a single 1199-line component.** All mutation orchestration lives in one file with many `useState`/`useRef` flags (`mutationLock`, `observedTargetRevision`, `observedReviewSlot`, `commitMode`, `runtimeConflict`, …). The `Mutation` union (`:52`) enumerates every action; any new delivery verb must be added there and to the `primary`/`more-menu` JSX (`:923`–`:1023`).
