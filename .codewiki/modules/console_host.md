---
title: console_host
type: module
source_files:
  - src/console-host/control-plane.ts
  - src/console-host/errors.ts
  - src/console-host/projection.ts
  - src/console-host/review-diff.ts
  - src/console-host/service.ts
  - src/console-contract.ts
  - src/ports.ts
  - src/checkpoint.ts
  - src/host-compat.ts
  - src/index.ts
  - tests/console-host.test.ts
tags: [console, control-plane, projection, rpc-service, review-diff, session-checkout]
---

## Overview

`console_host` is the **host (server) side** of the Worktree Console: the authoritative control plane that the browser client calls over Typert Remote RPCs. It lives under `src/console-host/` and is composed of four files plus the host RPC façade:

- `control-plane.ts` — the domain control plane `createWorktreeConsoleControlPlane`. Holds all authorization, CAS (compare-and-swap) checks, identity verification, sidebar/list aggregation and every mutation hand-off to the `SessionCheckoutModule`.
- `projection.ts` — pure functions that turn a `ManagedCheckoutRecord` into the path-free, client-safe DTOs (`projectRecord`, `projectDetails`, `projectLocal`, `capabilities`).
- `review-diff.ts` — `createGitWorktreeReviewDiffReader`, a self-contained git diff reader that re-materializes the isolated snapshot into a scratch index and diffs it against `baseOid`.
- `errors.ts` — `WorktreeConsoleOutcome<T>` construction helpers (`domainError`, `failure`, `consoleFailure`, `outcome`).
- `service.ts` — `WorktreeConsoleService`, the `@Remote`-decorated Typert service that wraps the control plane and injects the i18n locale, diagnostics, and Workspace-flavor metadata.

The module's single authority rule (documented at `src/console-contract.ts:1-23`) is: **every Host operation resolves an exact caller Session and re-validates project, owner, cwd, revision and review identity at execution time**. The client never chooses ownership identity or target session — the Host allocates `targetSessionId` (see `createTargetSessionId` default `randomUUID` at `control-plane.ts:207`).

The control plane is wired into the plugin in `src/index.ts:398-405`: it is constructed with the already-built `module` (the `SessionCheckoutModule` from `createSessionCheckoutModule`), `lookup`, `files`, `registry`, `git` ports, and a `createGitWorktreeReviewDiffReader(projectSkills)` reader, then wrapped in `new WorktreeConsoleService(...)`. The diagnostics sink is a ndjson file at `<stateDir>/sidebar-diag.ndjson` (the `diagFile` argument at `index.ts:404`).

## Key Components

### `src/console-host/errors.ts`

Helpers that build the `WorktreeConsoleOutcome<T>` union (`{ ok: true; value } | { ok: false; error }`, defined at `console-contract.ts:695-697`).

- `domainError(code, message, continuation?)` — `errors.ts:5-11`. Builds an `Error` augmented with a `code` (`SessionCheckoutErrorCode`) and optional `continuation` (`WorktreeConsoleContinuation`). Returned by the control plane's own gates.
- `consoleFailure(error)` — `errors.ts:13-41`. Normalizes any thrown error into an `ok:false` outcome. If the error has a recognized `code`, it is passed through verbatim; otherwise it degrades to `git_error` with the raw message (note: local-only leak ceiling — `errors.ts:37-40`).
- `failure<T>(code, message, details?, continuation?)` — `errors.ts:43-58`. Explicit `ok:false` builder.
- `outcome<T>(operation)` — `errors.ts:60-66`. Wraps an async op in `try/catch` → `ok:true`/`ok:false`, but **only catches expected domain errors** (i.e. it does not swallow the `ReviewDiffStaleError` path used by `reviewDiff`/`preflight`; those methods handle their own try/catch).

### `src/console-host/projection.ts`

Pure record→DTO projection. No ports, no git, no filesystem. Exported functions:

- `review(record)` — `projection.ts:16-31`. Maps `record.delivery.review` → `WorktreeConsoleReviewSummary` (reviewId, revision, iteration, preparedAt, summary, validationStatus, tests, changedFiles, suggestedCommitMessage).
- `commitOid(record)` — `projection.ts:33-35`. Returns `record.delivery.commitOid` when present, else `null`.
- `deliveryProof(record, observed?)` — `projection.ts:37-56`. Maps `record.delivery.proof` → `WorktreeConsoleDeliveryProof`; if `observed` is supplied it is used instead (and `commitInLocalHistory` is forced to `null`).
- `iteration(record)` — `projection.ts:58-60`. Iteration from review or delivery.
- `capabilities(record, callerSessionId, ownerSessionAvailable=true, linkedRead=false)` — `projection.ts:62-105`. Returns a `WorktreeConsoleCapabilities` object. Computes `owner`/`source`/`readAuthorized`/`manageAuthorized`, then each boolean capability (`create`, `open`, `inspect`, `discard`, `preflight`, `preview`, `checkpoint`, `resumeRevision`, `rollbackPreview`, `finalize`, `finalizePreview`, `setRetention`, `setPermanent`, `retryCleanup`, `beginNextIteration`, `returnToLocal`) from `record.phase` + `record.delivery.state` + caller identity. `returnToLocal` is gated by `worktreeReachedDelivery(record.phase, record.delivery.state)` (`projection.ts:103`).
- `fallbackOid(record)` — `projection.ts:107-110`. Oid fallback chain: proof localHeadAfter → commitOid → applyBaseOid → baseOid.
- `sourceBranchFromRef(sourceRef)` — `projection.ts:112-114`. Strips `refs/heads/` prefix; returns `null` otherwise.
- `projectRecord(record, callerSessionId, observed?)` — `projection.ts:116-190`. The core summary projection → `WorktreeConsoleTargetSummary`. Includes `retention`/`retainedAt`/`expiresAt` when `delivery.state==='retained'`, `cleanupMessage` when present, `permanent` flag, `deliveryProof`, `review`, `checkpoints` (with sequence, reviewId, createdAt, summary, validationStatus, changedFiles), `checkpointGeneration` (from `checkpointGenerationForRecord`), `reviewSlot: 'available'` when `ready_for_review`, and `previewRecovery` when `preview_detached`. `sourceBranch` uses `record.sessionBranch ?? record.sourceRef` (`projection.ts:150`).
- `projectDetails(...)` — `projection.ts:192-270`. Extends `projectRecord` → `WorktreeConsoleTargetDetails`, adding `managedRoot`, `sourceRoot`, `sourceOid`, `currentBranch` (settled branch with recorded session-branch fallback, `projection.ts:226`), and a `recoveryContinuation` block for the owner's authorized recovery proofs (`worktree_apply_conflict` / `worktree_review_regeneration` / `worktree_preview_recovery_analysis` / handoff, `projection.ts:227-268`).
- `projectLocal(target, sessionId)` — `projection.ts:272-310`. Projects a Local (non-isolated) `SessionTargetView` → `WorktreeConsoleTargetDetails` with `state:'local'`, `managedRoot:null`, and a fixed capabilities set where only `create` (when not `unversioned`) and `open`/`inspect` are true.

### `src/console-host/review-diff.ts`

- Constants: `REVIEW_DIFF_MAX_FILES = 200` (`review-diff.ts:9`), `REVIEW_DIFF_MAX_PATCH_BYTES = 100 * 1024` (`review-diff.ts:10`), `REVIEW_DIFF_MAX_PAYLOAD_BYTES = 1024 * 1024` (`review-diff.ts:11`).
- `ReviewDiffReadInput` — `review-diff.ts:13-19`. `{ managedRoot, baseOid, reviewId, revision, changedFiles }`.
- `WorktreeReviewDiffReader` — `review-diff.ts:21-23`. Interface with `read(input): Promise<WorktreeConsoleReviewDiffResponse>`.
- `ReviewDiffStaleError` — `review-diff.ts:25-30`. Error class; thrown when the actual changed-file set no longer matches the isolated snapshot.
- `git(cwd, args, env, maxBytes)` — `review-diff.ts:34-64`. Low-level spawn of `git` with byte-bounded `stdout`/`stderr` capture; rejects with a localized message on non-zero exit.
- `projectPath(value)` — `review-diff.ts:66-70`. Rejects absolute paths, backslashes, NUL, `..`, and leading `/` (defense against path traversal out of the project).
- `utf8Prefix(value, maxBytes)` — `review-diff.ts:72-78`. Truncates a string at a UTF-8 character boundary to fit `maxBytes`.
- `payloadBytes(response)` — `review-diff.ts:80-82`. JSON byte length of a response.
- `parseNameStatus(output)` — `review-diff.ts:90-113`. Parses `git diff --name-status -z`, folding copy (`C`) into rename (`renamed`, `review-diff.ts:97-104`).
- `sortedUnique(values)` — `review-diff.ts:115-117`. De-dup + sort.
- `changedPathSet(entries)` — `review-diff.ts:119-121`. Collects previous + current paths.
- `createGitWorktreeReviewDiffReader(projectSkills?)` — `review-diff.ts:123-245`. Returns a `WorktreeReviewDiffReader`. The `read` method: validates each changed path via `projectPath`, builds a scratch git index in a temp dir, `read-tree <baseOid>`, `git add -A`, optionally prunes tracked project-skill paths via `projectSkills`, then `git diff --cached --name-status` and compares the result to the expected `changedFiles` (stale → `ReviewDiffStaleError`, `review-diff.ts:175-177`). It then diffs each changed file (batch-parallel, `REVIEW_DIFF_BATCH_SIZE = 8`, `review-diff.ts:66-68`), honoring `REVIEW_DIFF_MAX_FILES` (truncate after 200, `review-diff.ts:180-181`) and the 1 MiB payload budget (`review-diff.ts:223-234`).

### `src/console-host/control-plane.ts`

- `WorktreeConsoleControlPlaneOptions` — `control-plane.ts:70-78`. `{ module, lookup, files, registry, git, reviewDiff, createTargetSessionId? }`.
- `WorktreeConsoleControlPlane` — `control-plane.ts:80-119`. The full RPC surface (≈40 methods), all returning `Promise<WorktreeConsoleOutcome<…>>`. Key groups: sidebar/topology (`sidebarTopology`, `current`, `list`), lifecycle (`preflightCreate`, `createWithInitialCommit`, `create`, `initProject`), review/preview (`reviewDiff`, `preflight`, `previewRecoveryPreflight`, `preparePreviewRecoveryAnalysis`, `createPreviewRecoveryHandoff`, `preview`, `checkpoint`, `resumeRevision`, `prepareReviewRegeneration`, `rollbackPreview`, `discard`, `finalize`, `finalizePreview`), retention (`setRetention`, `setPermanent`, `retryCleanup`, `beginNextIteration`, `returnToLocal`, `clearSidebarBadge`), git surface (`gitOverview`, `gitGraph`, `gitCreateBranch`, `gitSwitchBranch`, `gitPruneMergedBranches`, `gitListTags`, `gitCreateTag`, `gitDeleteTag`, `gitPushTag`), abandoned (`listAbandoned`, `restoreAbandoned`), and `inspect`.
- `createWorktreeConsoleControlPlane(options)` — `control-plane.ts:206-1553`. Factory. Closes over the ports and defines many private helpers, then returns the object literal of methods. Notable internal helpers:
  - `recordOf(registry, checkoutId)` — `control-plane.ts:121-125`. Reads a record, throws `domainError('checkout_missing', …)` if absent.
  - `sidebarTaskState(record)` — `control-plane.ts:127-138`. Maps a record to a `WorktreeSidebarTaskState` (`finalized`/`discarded`/`recovery_required`/`preview_detached`/`preview_active`/`ready_for_review`/`working`); delivery state wins over phase (`control-plane.ts:131`).
  - `readyReview(record)` — `control-plane.ts:140-145`. Throws unless `phase==='ready'` and `delivery.state==='ready_for_review'`.
  - `previewReview(record)` — `control-plane.ts:147-155`. Throws unless ready/preview_active/preview_detached.
  - `safeRecoveryRequestId`/`safeConflictFile` — `control-plane.ts:157-165`. Input validators.
  - `applyConflictContinuation(result, reviewId)` — `control-plane.ts:167-190`. Builds a `worktree_apply_conflict` continuation from an `operate` `conflict` result (validates `localHeadOid` is 40/64 hex, `conflictingFiles` ≤ 500 & safe).
  - `preflightFailure(view)` — `control-plane.ts:192-204`. Maps module `preflight` blocked reasons to console error codes.
  - `unboundLocalTarget`/`callerTarget` — `control-plane.ts:209-239`. Resolve the caller's `SessionTargetView`; `callerTarget` falls back to a Local projection when the module throws `target_unselected`.
  - `verifyCallerRoot` — `control-plane.ts:241-316`. The repo-root authorization gate. Memoizes canonicalization (`control-plane.ts:414-421`), and for the **owner** Session accepts the live cwd (`getSessionCwd`) as `managedRoot`/`localRoot` evidence (the fix at `control-plane.ts:289-296`), while a **source** Session keeps the Workspace-root gate. See the test at `tests/console-host.test.ts:1142-1186`.
  - `authorize` — `control-plane.ts:318-338`. Owner/source check + project match + `verifyCallerRoot` + (non-discarded) visibility in `listManagedWorktreesForSession`.
  - `linkedReadAccess` — `control-plane.ts:340-398`. Cross-source, same-project linked read (acceptance-slot holder) authorization; returns `{ record, linkedRead, acceptanceAnchorCheckoutId? }`.
  - `observe` — `control-plane.ts:400-419`. Reuses caller observation or re-validates the managed checkout to get `managedRoot`/`snapshot`/`dirty`/`localSnapshot`.
  - `ownerSessionAvailable`/`observeFromCaller`/`withinRoot`/`settledLocalBranch` — `control-plane.ts:421-513`. Observation reuse + Local-branch resolution for delivered owners.
  - `sameLocalRoot` — `control-plane.ts:515-517`. Case-insensitive on win32.
  - `acceptanceHolder` — `control-plane.ts:519-532`. Finds the checkout holding the acceptance slot for the same `localRoot`.
  - `projectReviewSlot` — `control-plane.ts:534-551`. Decorates a target summary with `reviewSlot`/`reviewSlotHolder` when `ready_for_review` and a holder exists.
  - `deliveryProofFromTarget` — `control-plane.ts:553-560`. Extracts `delivery.proof` from a `SessionTargetView`.
  - `details` — `control-plane.ts:562-601`. Full read projection for `current`/`inspect`.
  - `mutationResponse` — `control-plane.ts:603-625`. Re-projection after a mutation (discards or live).
  - `confirmations`/`creating` — `control-plane.ts:627-628`. Maps holding the `empty`-repo `createWithInitialCommit` confirmation tokens and the in-flight creation lock.
  - `localProject`/`projectRootFor`/`withCreation`/`createTarget` — `control-plane.ts:629-695`. Local-root project resolution + creation lock + isolated-target launch + identity verification.
  - Method implementations — `control-plane.ts:698-1552`. All listed RPC methods; key authorization/identity checks are replicated per-method (stale-revision guards `record.revision !== request.expectedRevision` → `stale_target`; owner-only checks → `not_owner`; recovery-proof identity checks).

### `src/console-host/service.ts`

- `WorktreeConsoleService extends TypertRemoteService` — `service.ts:35-43`. Constructor `(hostContext: Context, controlPlane, diagFile?, officialWorkspaceActive=true)`. Registers the Remote service under `'gitWorktree'`.
- `appendDiag(line)` — `service.ts:47-52`. Best-effort ndjson append to `diagFile` (no-op when `undefined`).
- `@Remote` methods — `service.ts:54-342`. One thin wrapper per control-plane method. Each resolves the request's `locale` (`withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext))`) and delegates to the control plane, passing `agent.id` as `sessionId`. Notable:
  - `sidebarTopology` (`service.ts:54-67`) augments the outcome with `workspaceClientFlavor` (`hostWorkspaceClientFlavor()`) and `officialWorkspaceActive`, and emits a `host` diag line.
  - `current` (`service.ts:75-89`) records `durationMs` in its diag line (used to diagnose the 5s polling capsule).
  - `clientBootReport` (`service.ts:69-73`) is a write-only diag sink taking a `WorktreeClientBootReport`.
  - All other methods (`list`, `preflightCreate`, `createWithInitialCommit`, `create`, `initProject`, `inspect`, `reviewDiff`, `preflight`, `previewRecoveryPreflight`, `preparePreviewRecoveryAnalysis`, `createPreviewRecoveryHandoff`, `preview`, `checkpoint`, `prepareReviewRegeneration`, `resumeRevision`, `rollbackPreview`, `discard`, `finalize`, `finalizePreview`, `setRetention`, `setPermanent`, `retryCleanup`, `beginNextIteration`, `returnToLocal`, `clearSidebarBadge`, `gitOverview`, `gitGraph`, `gitCreateBranch`, `gitSwitchBranch`, `gitPruneMergedBranches`, `listAbandoned`, `restoreAbandoned`) follow the same translate-and-delegate pattern (`service.ts:91-342`).

### Shared contract (`src/console-contract.ts`) and ports (`src/ports.ts`)

The DTOs the host projects and the port shapes the host depends on:

- `WorktreeConsoleOutcome<T>` — `console-contract.ts:695-697`. The result envelope returned by every RPC.
- `WorktreeConsoleError` — `console-contract.ts:688-693`. `{ code, message, details?, continuation? }`.
- `worktreeReachedDelivery(phase, deliveryState)` — `console-contract.ts:64-73`. True when delivery/retention/finalized/retained.
- `consoleStateFromDomain(source)` — `console-contract.ts:76-91`. Maps domain facts to a `WorktreeConsoleTargetState`.
- `WorktreeConsoleCapabilities` — `console-contract.ts:98-124`; `WorktreeConsoleTargetSummary` — `console-contract.ts:149-179`; `WorktreeConsoleTargetDetails` — `console-contract.ts:182-195`.
- `WorktreeConsoleErrorMeta` / `worktreeConsoleErrorMeta` — `console-contract.ts:699-742`. Per-code category/recovery/retryable metadata.
- `WorktreeConsoleAdapter` — `console-contract.ts:745-784`. The client seam (normalized interface) that the service implements.
- `SessionCheckoutLookupPort` — `ports.ts:40-60` (incl. optional `getSidebarMemberships`, `getSessionCwd`, `listLiveSessions`); `SessionCheckoutGitPort` — `ports.ts:109+`; `GitCheckoutSnapshot` — `ports.ts:62-69`; `SessionCheckoutFilesPort`; `SessionCheckoutRegistryPort` (`registry.read().managedCheckouts[…]`, `sessionBindings[…]`); `SessionCheckoutModule` — `index.ts:113-219`.
- `checkpointGenerationForRecord(record)` — `checkpoint.ts:16-29`. Host-derived CAS generation over the active review/checkpoint chain; used by `projection.ts:173`.

## Architecture

The host side is a thin RPC façade (`WorktreeConsoleService` in `service.ts`) over a single domain object (`WorktreeConsoleControlPlane` in `control-plane.ts`). The control plane depends only on ports (`module`, `lookup`, `files`, `registry`, `git`, `reviewDiff`) and is fully testable with fakes (see `tests/console-host.test.ts`). Projection (`projection.ts`) and error construction (`errors.ts`) are pure. `review-diff.ts` is a self-contained git diff reader.

```text
┌────────────────────────────┐   Typert Remote (@Remote)   ┌──────────────────────────────┐
│  Browser Client (console-  │ ─ ─ ─ gitWorktree namespace ─ ▶│ WorktreeConsoleService       │
│  remote / review console)  │                               │ service.ts (locale + diag +  │
└────────────────────────────┘ ◀ ─ ─ WorktreeConsoleOutcome ─│ flavor envelope)             │
                                                          └───────────────┬──────────────┘
                                                                          │ delegates
                                                                          ▼
                                                          ┌──────────────────────────────┐
                                                          │ createWorktreeConsole-       │
                                                          │ ControlPlane (control-plane) │
                                                          │ authorize / linkedRead /     │
                                                          │ observe / mutate             │
                                                          └───────┬───────────────┬──────┘
                                       ports (src/ports.ts)        │               │
                          ┌───────────────────────────────┼───────┴───────┐       │
                          ▼                               ▼               ▼       ▼
                   ┌──────────────┐  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
                   │ Session-     │  │ Lookup/Files/ │ │ Registry     │ │ Git port     │
                   │ Checkout-    │  │ Registry port│ │ (managed-    │ │ (inspect/    │
                   │ Module       │  │              │ │ checkouts)   │ │ status/...)  │
                   │ (operate,    │  │              │ │              │ │              │
                   │ bind, preflight)              │ │              │ │              │
                   └──────────────┘  └──────────────┘ └──────────────┘ └──────────────┘
                          │
                          ▼
                   ┌──────────────────────────────┐  read  ┌──────────────────────────┐
                   │ projection.ts                │ ─────▶│ WorktreeConsoleTarget-   │
                   │ projectRecord/projectDetails │        │ Summary/Details (DTO)    │
                   │ /capabilities                │        └──────────────────────────┘
                   └──────────────────────────────┘
                          │
                          ▼ (reviewDiff only)
                   ┌──────────────────────────────┐
                   │ review-diff.ts               │
                   │ createGitWorktreeReviewDiff- │
                   │ Reader (scratch index + git) │
                   └──────────────────────────────┘
```

`errors.ts` is used by `control-plane.ts` to build every `ok:false` outcome; the `WorktreeConsoleService` simply forwards whatever `WorktreeConsoleOutcome` the control plane returns. The control plane never imports `service.ts`, keeping the domain independent of the Cordis/Typert RPC layer.

## Data Flow

**Read flow (`current` / `inspect`)** — the 5s polling capsule path:

1. `WorktreeConsoleService.current(agent, locale)` (`service.ts:75-89`) resolves locale and calls `controlPlane.current(agent.id)`; it records `durationMs` in the diag log.
2. `current` (`control-plane.ts:764-770`) calls `callerTarget` (`control-plane.ts:230-239`). If the module reports `target_unselected`, it falls back to `unboundLocalTarget` → a Local projection (`projectLocal`, `projection.ts:272-310`).
3. For an isolated target, `details` (`control-plane.ts:562-601`) runs `linkedReadAccess` (authorization), `observe` (reuses the caller's already-paid git observation via `observeFromCaller`, `control-plane.ts:443-461`), then `projectReviewSlot(projectDetails(...))`. `projectDetails` resolves `currentBranch` via `settledLocalBranch` (`control-plane.ts:489-513`) so a delivered owner reads its Local branch, not the frozen task branch.
4. The result is a `WorktreeConsoleTargetDetails` DTO with `managedRoot` only when the caller is authorized for detail (`tests/console-host.test.ts:1458-1467` asserts the list row stays path-free while `inspect` reveals `managedRoot`).

**Mutation flow (e.g. `finalize`)**:

1. `finalize` (`control-plane.ts:1337-1379`) authorizes (`authorize`), checks owner + `expectedRevision` (→ `stale_target`), reads `readyReview`, validates the commit message via `isValidCommitMessage`.
2. Calls `module.operate({ action: 'finish', … })`. On `conflict` it returns an `apply_conflict` failure carrying `applyConflictContinuation(result, review.reviewId)` (`control-plane.ts:167-190`); on `finished` it re-projects via `mutationResponse` (`control-plane.ts:603-625`) with `deliveryProofFromTarget(result.target)` and `commitOid`.

**Review diff flow**:

1. `reviewDiff` (`control-plane.ts:998-1036`) authorizes, checks owner/stale/review identity, then runs `module.preflight` **before and after** the read (`control-plane.ts:1005-1030`), refusing any mid-read drift with `stale_isolated` (matching the `ReviewDiffStaleError` from inside `review-diff.ts`).
2. `options.reviewDiff.read({ managedRoot, baseOid, reviewId, revision, changedFiles })` re-materializes the snapshot in a scratch git index and returns `WorktreeConsoleReviewDiffResponse` (`review-diff.ts:123-245`).

**Creation flow (empty repo)** — `preflightCreate` (`control-plane.ts:956-972`) returns `{ kind: 'empty', confirmationToken }` stored in the `confirmations` map (5-min TTL); `createWithInitialCommit` (`control-plane.ts:973-988`) validates the token (session/root/project/fingerprint/expiry) before `git.initializeEmptyRepository` then `createTarget`. `withCreation` (`control-plane.ts:655-672`) holds a per-session + per-root lock in the `creating` set to reject concurrent/duplicate creation (`tests/console-host.test.ts:1793-1804`).

## Connections

- [[console-remote]] — the browser client side that calls every `@Remote` method on the `gitWorktree` namespace; mirrors the `WorktreeConsoleAdapter` seam (`console-contract.ts:745-784`).
- [[session-checkout-module]] — the `SessionCheckoutModule` (`src/index.ts:113-219`) the control plane delegates all domain mutations to (`operate`, `bind`, `beginNextIteration`, `resumeRevision`, `prepareReviewRegeneration`, `preparePreviewRecoveryAnalysis`, `createPreviewRecoveryHandoff`, `manageManagedWorktreeForSession`, `listManagedWorktreesForSession`, `observeManagedCheckout(s)`, `pruneMergedBranchesForSession`, `listAbandonedWorktreeSnapshots`, `restoreAbandonedWorktreeSnapshot`).
- [[console-contract]] — the shared JSON-only DTOs and the single authority rule (`console-contract.ts:1-23`); the host projects `WorktreeConsoleTargetSummary`/`Details` and returns `WorktreeConsoleOutcome`.
- [[ports]] — the port interfaces (`SessionCheckoutLookupPort`, `SessionCheckoutFilesPort`, `SessionCheckoutRegistryPort`, `SessionCheckoutGitPort`) the control plane depends on; `getSessionCwd` (`ports.ts:53`) is what makes owner authorization work (`control-plane.ts:290`).
- [[checkpoint]] — `checkpointGenerationForRecord` (`checkpoint.ts:16-29`) is consumed by `projection.ts:173` to expose the CAS generation to clients.
- [[host-compat]] — `hostWorkspaceClientFlavor` / `workspaceFlavorDiagnostics` (`host-compat.ts:65-81`) feed `workspaceClientFlavor` into `sidebarTopology` (`service.ts:57-66`).
- [[index]] (plugin entry) — `src/index.ts:398-405` constructs the control plane + `WorktreeConsoleService` and mounts the retention/expiry timers that drive the same module.

## Known Issues

---
title: console_host
type: module
source_files:
  - src/console-host/control-plane.ts
  - src/console-host/errors.ts
  - src/console-host/projection.ts
  - src/console-host/review-diff.ts
  - src/console-host/service.ts
  - src/console-contract.ts
  - src/index.ts
  - tests/console-host.test.ts
tags: [host, console, control-plane, projection, review-diff, service]
---

## Overview

The `console_host` module is the Host-side control plane and transport surface for the Worktree Console. It sits between the Typert Remote RPC layer (`[[console_remote]]`) and the host-agnostic `SessionCheckoutModule` + ports (`[[session-checkout-module]]`, `[[ports]]`), and is responsible for five duties:

1. **Control plane (`control-plane.ts`)** — `createWorktreeConsoleControlPlane` returns a `WorktreeConsoleControlPlane` object whose methods implement every console operation (topology, current, list, create, review diff, preflight, preview, checkpoint, finalize, git surface, abandoned snapshots, etc.). Each method re-resolves the exact caller Session and re-validates project, owner, cwd, revision and review identity at execution time. The module is pure domain logic with no Cordis/React/Remote import.
2. **Projection (`projection.ts`)** — pure functions that turn a `ManagedCheckoutRecord` into the UI-facing `WorktreeConsoleTargetSummary` / `WorktreeConsoleTargetDetails` DTOs (state, capabilities, review, delivery proof, checkpoints, recovery continuation). It owns the `capabilities()` authorization matrix and the `state` mapping delegated from `[[console-contract]]`.
3. **Review diff (`review-diff.ts`)** — `createGitWorktreeReviewDiffReader` builds a `WorktreeReviewDiffReader` that recomputes the exact `changedFiles` set against `baseOid` using a throwaway Git index in a temp dir (so the managed root's real index/objects stay untouched), enforces size budgets, and can surface skill-tracking paths. `ReviewDiffStaleError` is thrown when the on-disk snapshot no longer matches the recorded one.
4. **Service / transport (`service.ts`)** — `WorktreeConsoleService` extends `TypertRemoteService` and exposes every control-plane method as a `@Remote` RPC; it wraps each call in `withHostLanguage` for i18n, attaches the `workspaceClientFlavor` / `officialWorkspaceActive` election result, and writes ndjson diagnostics (`sidebarTopology`, `current`, `clientBootReport`).
5. **Errors (`errors.ts`)** — `domainError`, `failure`, `consoleFailure`, `outcome` build the `WorktreeConsoleOutcome<T>` discriminated union (`{ ok: true, value } | { ok: false, error }`) and convert thrown `Error`s into console errors, sanitizing verbatim third-party messages for the local UI.

The module is composed in `src/index.ts` (`apply`): the `WorktreeConsoleService` is constructed with a `createWorktreeConsoleControlPlane({ module, lookup, files, registry, git, reviewDiff })` instance, and `createGitWorktreeReviewDiffReader(projectSkills)` supplies `reviewDiff`. Diagnostics go to `<stateDir>/sidebar-diag.ndjson` and `officialWorkspaceActive` comes from `mountWorkspaceProviderLifecycle`.

## Key Components

### `control-plane.ts` — `WorktreeConsoleControlPlane`

#### `WorktreeConsoleControlPlaneOptions` interface — line 70
Wiring contract for the control plane: `module` (`SessionCheckoutModule`), `lookup` (`SessionCheckoutLookupPort`), `files` (`SessionCheckoutFilesPort`), `registry` (`SessionCheckoutRegistryPort`), `git` (`SessionCheckoutGitPort`), `reviewDiff` (`WorktreeReviewDiffReader`), and optional `createTargetSessionId` (defaults to `randomUUID` at line 207).

#### `WorktreeConsoleControlPlane` interface — line 80
Declares all ~40 console operations (sidebar topology, current, list, create flows, inspect, reviewDiff, preflight, preview-recovery flows, preview/checkpoint/resume/regeneration/rollback/discard/finalize, retention/permanent/retry/beginNextIteration/returnToLocal, sidebar badge, git overview/graph/branch/tag/prune, abandoned list/restore). See the full list at lines 81–119.

#### `createWorktreeConsoleControlPlane(options)` — line 206
Factory returning the `WorktreeConsoleControlPlane`. It defines the internal helpers (`unboundLocalTarget`, `callerTarget`, `verifyCallerRoot`, `authorize`, `linkedReadAccess`, `observe`, `details`, `mutationResponse`, `localProject`, `projectRootFor`, `withCreation`, `createTarget`) and then returns the object literal of methods.

**Internal helper functions:**

- `recordOf(registry, checkoutId)` — line 121: reads `registry.read().managedCheckouts[checkoutId]`, throws `domainError('checkout_missing', …)` if absent.
- `sidebarTaskState(record)` — line 127: maps a record to `WorktreeSidebarTaskState` (`'finalized'` wins over `'discarded'`, then `recovery_required`, `preview_detached`, `preview_active`, `ready_for_review`, else `'working'`); uses `worktreeReachedDelivery` at line 131.
- `readyReview(record)` — line 140: throws `operation_not_allowed` unless `phase === 'ready' && delivery.state === 'ready_for_review'`; returns `record.delivery.review`.
- `previewReview(record)` — line 147: throws `preview_not_active` unless `phase === 'ready'` and delivery is `preview_active`/`preview_detached`.
- `safeRecoveryRequestId(value)` — line 157: length 1–500, no `\0\r\n`.
- `safeConflictFile(file)` — line 161: rejects `\0-\x1f\x7f`, absolute paths, empty/`.`/`..` segments.
- `applyConflictContinuation(result, reviewId)` — line 167: builds the `worktree_apply_conflict` continuation payload from a `conflict` operation result; validates `localHeadOid` is a 40/64-hex oid (line 173) and confining files (line 177).
- `preflightFailure(view)` — line 192: maps a `blocked` preflight `reason` to a `WorktreeConsoleErrorCode` (`stale_isolated`/`stale_local`/`stale_target`/`project_acceptance_busy`/`not_owner`/`operation_not_allowed`/`checkout_mismatch`/`git_error`).

**Caller / authorization helpers:**

- `unboundLocalTarget(sessionId)` — line 209: resolves the project + Git snapshot for a Session that has no managed checkout bound; returns a `local` `SessionTargetView`.
- `callerTarget(sessionId)` — line 230: calls `options.module.inspect(sessionId)`; if it throws `target_unselected`, falls back to `unboundLocalTarget`.
- `verifyCallerRoot(sessionId, record, expectedRoot)` — line 241: the cwd / Local-boundary authorization gate. Allows owner live-cwd equal to `localRoot` (lines 289–296), settled delivery through Local (lines 297–312), and the Workspace-root gate (lines 304–315). Uses a memoized `canonical` cache (line 269) because `files.canonicalize` is a realpath syscall.
- `authorize(sessionId, checkoutId, observedCaller?)` — line 318: owner/source check (line 323), project match (line 326), expected-root selection (`managedRoot` for owner, `localRoot` for source, line 329), `verifyCallerRoot`, and visibility check via `listManagedWorktreesForSession` (line 332) when phase is not `discarded`.
- `linkedReadAccess(sessionId, checkoutId, observedCaller?)` — line 340: allows a source Session (isolated) to read another checkout in the same linked group / acceptance slot (lines 350–397), returning `{ record, linkedRead, acceptanceAnchorCheckoutId? }`.
- `observe(record, observedCaller?)` — line 400: returns `{ managedRoot, snapshot, dirty, localSnapshot? }`; returns `{ managedRoot: null }` for `discarded` (line 410), reuses caller observation via `observeFromCaller` (line 443) on a hot path, else uses `observeManagedCheckout` / `resolveManagedRoot` + `git.inspect`/`git.status`.
- `observeFromCaller(record, caller)` — line 443: reuses a warm `inspect` result only when the caller is an active (`ready`) owner of exactly this checkout at the same revision (lines 447–455).
- `withinRoot(candidate, root)` — line 464: cross-platform "is candidate the root or nested under it" test.
- `settledLocalBranch(record, sessionId, managedRoot, observedLocalSnapshot?)` — line 489: for a delivered owner, reports the Local branch the Session is actually standing on (so the chip stops naming the frozen task branch after merge); `undefined` = not a delivered-owner read, `null` = Local not observable right now.
- `sameLocalRoot(left, right)` — line 515: case-insensitive compare on win32.
- `acceptanceHolder(record)` — line 519: finds the sibling checkout holding the project's acceptance slot (same `localRoot`, in a review/preview/finalize/finish journal state).
- `projectReviewSlot(record, target)` — line 534: stamps `reviewSlot: 'available' | 'waiting'` and, when a holder exists, attaches `reviewSlotOwnerSessionId`, `reviewSlotHolder`, and disables preview/checkpoint/finalize capabilities.
- `deliveryProofFromTarget(target)` — line 553: extracts a `WorktreeConsoleDeliveryProof` from a `SessionTargetView` delivery.
- `details(sessionId, checkoutId, observedDeliveryProof?, observedCaller?)` — line 562: runs `linkedReadAccess` + `observe` + consistency re-check (lines 571–587), then projects via `projectDetails`.
- `mutationResponse(sessionId, checkoutId, observedDeliveryProof?)` — line 603: builds the `WorktreeConsoleMutationResponse` for `discarded` (line 609) or active (line 617) records via `projectRecord` (+ `projectReviewSlot`).
- `localProject(sessionId)` — line 629: resolves the local project repo for create flows; throws `operation_not_allowed` on changed initial state (line 634).
- `projectRootFor(sessionId)` — line 644: resolves the calling Session's *project* repo (never a managed worktree) for the git-surface RPCs.
- `withCreation(sessionId, action)` — line 655: in-flight creation guard via a `creating` `Set` keyed by session (line 657) and canonical root (line 663), releasing in `finally` (line 668).
- `createTarget(sourceSessionId, branch?)` — line 673: allocates `targetSessionId`, calls `module.createIsolatedTarget`, and returns `projectDetails` after identity verification (lines 677–695).

**Returned control-plane methods (returned object literal, lines 697–1552):**

- `sidebarTopology()` — line 698: aggregates records into per-project tasks by owner, deduped by newest iteration/revision (lines 742–747); honors `sidebarBadgeClearedRevision` suppression (line 724); attaches `getSidebarMemberships` (line 700).
- `current(sessionId)` — line 764: `projectLocal` for a `local` target (line 766), else `details`.
- `gitOverview` — line 772; `gitGraph` — line 787; `gitCreateBranch` — line 794; `gitSwitchBranch` — line 801 (refuses while delivering, line 805–812); `gitPruneMergedBranches` — line 818; `gitListTags` — line 822; `gitCreateTag` — line 830 (soft-degrade push, line 835); `gitDeleteTag` — line 842 (remote-first, line 846); `gitPushTag` — line 858.
- `listAbandoned` — line 869; `restoreAbandoned` — line 873.
- `list(request)` — line 879: caller-scoped list with optional `needsAttention`/`includeDelivered`; uses `observeManagedCheckouts` batch observation (line 908) with per-record fallback (line 929); filters delivered/active (lines 903–904) and attention states (lines 944–951).
- `preflightCreate(sourceSessionId)` — line 956: empty/files/ready branching; stores a 300s `confirmations` token (line 970).
- `createWithInitialCommit(sourceSessionId, confirmationToken)` — line 973: validates the confirmation (line 976) and initializes the empty repo (line 980).
- `create(sourceSessionId, branch?)` — line 989; `initProject` — line 990.
- `inspect(sessionId, checkoutId)` — line 996.
- `reviewDiff(request)` — line 998: owner + revision + review-identity checks (lines 1000–1004), double `preflight` gate before/after diff (lines 1005, 1018), stale detection against registry (lines 1022–1030), catches `ReviewDiffStaleError` as `stale_isolated` (line 1033).
- `preflight(request)` — line 1038; `previewRecoveryPreflight` — line 1049; `preparePreviewRecoveryAnalysis` — line 1069; `createPreviewRecoveryHandoff` — line 1099 (identity verify + handoff continuation, lines 1118–1123).
- `checkpoint(request)` — line 1148: validates message/requestId (line 1152), calls `module.operate({ action: 'checkpoint' })`, handles `preview_detached`/`checkpointed` (lines 1165–1173).
- `preview(request)` — line 1176: `module.operate({ action: 'preview' })`; converts `conflict` → `apply_conflict` with continuation (lines 1186–1191).
- `resumeRevision(request)` — line 1200: validates optional conflict continuation (lines 1206–1216), calls `module.resumeRevision`, persists/verifies the conflict recovery (lines 1242–1248).
- `prepareReviewRegeneration(request)` — line 1263.
- `rollbackPreview(request)` — line 1288: `module.operate({ action: 'rollback_preview' })`, handles `preview_rolled_back`/`preview_detached` (lines 1299–1301).
- `discard(request)` — line 1308: owner (`module.operate({ action: 'discard' })`) vs source (`module.manageManagedWorktreeForSession`) paths (lines 1313–1333).
- `finalize(request)` — line 1337 (async, returns `failure` directly on guard failures; `finish` action; `apply_conflict` path, lines 1355–1361).
- `finalizePreview(request)` — line 1381 (async; `finalize_preview` action; `preview_detached` path, lines 1399–1407).
- `setRetention(request)` — line 1426; `setPermanent` — line 1437; `retryCleanup` — line 1448; `clearSidebarBadge` — line 1458 (only terminal states, line 1461).
- `beginNextIteration(request)` — line 1472: requires `discarded`+`delivered` predecessor (line 1480), matches owner root (lines 1488–1491), verifies lineage (lines 1501–1507).
- `returnToLocal(request)` — line 1528: releases a delivered owner Session back to the Local boundary via `module.bind(sessionId, { kind: 'local' })` (line 1546); idempotent when already released (lines 1540–1544).

### `errors.ts`

- `domainError(code, message, continuation?)` — line 5: returns an `Error` with a `code` property (`SessionCheckoutErrorCode`) and optional `continuation` (`WorktreeConsoleError['continuation']`).
- `consoleFailure(error)` — line 13: maps a typed error (code in `SESSION_CHECKOUT_ERROR_CODES`) to a `WorktreeConsoleOutcome<never>` failure, preserving `continuation`; otherwise sanitizes verbatim messages into `git_error` (lines 34–40). Comment at line 33 marks it a local-only leak ceiling.
- `failure<T>(code, message, details?, continuation?)` — line 43: constructs a typed `{ ok: false, error }` outcome.
- `outcome<T>(operation)` — line 60: wraps an async `operation` into `{ ok: true, value }` or `consoleFailure(error)`.

### `projection.ts`

- `review(record)` — line 16: maps `delivery.review` to `WorktreeConsoleReviewSummary` (reviewId, revision, iteration, preparedAt, summary, validationStatus, tests, changedFiles, suggestedCommitMessage).
- `commitOid(record)` — line 33: returns `delivery.commitOid` when present, else `null`.
- `deliveryProof(record, observed?)` — line 37: builds `WorktreeConsoleDeliveryProof`; when `observed` is supplied (linked-read safety) it is used; `commitInLocalHistory` is always `null` (line 54).
- `iteration(record)` — line 58: review iteration, else delivery iteration.
- `capabilities(record, callerSessionId, ownerSessionAvailable?, linkedRead?)` — line 62: the authorization matrix → `WorktreeConsoleCapabilities`. All 17 flags (line 82): `create:false` (line 83), `open` (line 84), `inspect` (line 85), `discard` (line 86), `preflight`/`preview` (lines 87–88), `checkpoint` (line 89), `resumeRevision` (line 90), `rollbackPreview` (line 91), `finalize`/`finalizePreview` (lines 92–93), `setRetention`/`setPermanent` (lines 94–95), `retryCleanup` (line 96), `beginNextIteration` (line 97), `returnToLocal` (line 103). Doc comment at lines 98–102 explains the delivery-rebound rule.
- `fallbackOid(record)` — line 107: proof `localHeadAfter` → `commitOid` → `applyBaseOid` → `baseOid`.
- `sourceBranchFromRef(sourceRef)` — line 112: strips `refs/heads/` prefix, else `null`.
- `projectRecord(record, callerSessionId, observed?)` — line 116: builds `WorktreeConsoleTargetSummary` (state via `consoleStateFromDomain`, sourceBranch, retention/cleanup/expiry, delivery proof, review, checkpoints, checkpointGeneration, previewRecovery). Returns the structured object at lines 133–189.
- `projectDetails(record, callerSessionId, managedRoot, snapshot?, dirty?, ownerSessionAvailable?, linkedRead?, observedDeliveryProof?, settledLocalBranch?)` — line 192: extends `projectRecord` with `managedRoot`, `sourceRoot`, `sourceOid`, `currentBranch` (line 226), and `recoveryContinuation` (lines 227–268, four continuation kinds).
- `projectLocal(target, sessionId)` — line 272: builds a `WorktreeConsoleTargetDetails` for a `local` target (capabilities with `create` conditional on `unversioned` oid, line 288; all mutations `false`, lines 291–303).

### `review-diff.ts`

- `REVIEW_DIFF_MAX_FILES = 200` — line 9; `REVIEW_DIFF_MAX_PATCH_BYTES = 100*1024` — line 10; `REVIEW_DIFF_MAX_PAYLOAD_BYTES = 1024*1024` — line 11.
- `ReviewDiffReadInput` interface — line 13: `{ managedRoot, baseOid, reviewId, revision, changedFiles }`.
- `WorktreeReviewDiffReader` interface — line 21: single `read(input)` method.
- `ReviewDiffStaleError` class — line 25: thrown when the isolated snapshot's `changedFiles` no longer matches on-disk.
- `git(cwd, args, env, maxBytes)` — line 34: spawn-based git runner with stdout byte-cap and truncation flag; sets `GIT_TERMINAL_PROMPT=0` (line 38), `-c core.quotePath=false` and win32 `core.longpaths=true` (line 36).
- `projectPath(value)` — line 66: rejects unsafe project-relative paths (null, backslash, absolute, traversal).
- `utf8Prefix(value, maxBytes)` — line 72: safe UTF-8 truncation at byte boundary.
- `payloadBytes(response)` — line 80: JSON byte length of the response.
- `parseNameStatus(output)` — line 90: parses `git diff --name-status -z`; R/C fold into `renamed` (line 103, see ponytail note line 97).
- `sortedUnique(values)` — line 115; `changedPathSet(entries)` — line 119: union of path + previousPath.
- `createGitWorktreeReviewDiffReader(projectSkills?)` — line 123: returns the reader. `read` (line 125): validates `changedFiles` (line 127), creates a temp dir with a private `objects` dir (lines 128–130), builds an isolated env (`GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_CONFIG_NOSYSTEM`, lines 138–144), `read-tree baseOid` + `add -A` (lines 145–146), optional skill tracking via `projectSkills.paths`/`state` (lines 147–162), `diff --cached --name-status` (line 163), stale check by comparing `changedPathSet` to `sortedUnique(changedFiles)` (lines 174–177), then batches file patches (batch size 8, line 184) within payload budget (lines 200–237), cleaning the temp dir in `finally` (line 241).

### `service.ts` — `WorktreeConsoleService`

- `class WorktreeConsoleService extends TypertRemoteService` — line 35. Constructor (line 36) takes `hostContext`, `controlPlane`, optional `diagFile`, and `officialWorkspaceActive` (default `true`, line 41); calls `super(hostContext, 'gitWorktree')` (line 43).
- `appendDiag(line)` — line 47: best-effort `appendFileSync` of ndjson diagnostics.
- `@Remote sidebarTopology(locale?)` — line 54: runs `controlPlane.sidebarTopology` under `withHostLanguage` (line 56), adds `workspaceClientFlavor` + `officialWorkspaceActive` (line 65), logs a `host` diag (lines 58–63).
- `@Remote clientBootReport(report)` — line 70: logs a `client` diag (line 71).
- `@Remote current(agent, locale?)` — line 76: runs `controlPlane.current(agent.id)` (line 80), logs a `current` diag with `durationMs` (lines 83–87).
- All remaining `@Remote` methods (lines 91–342) are thin `withHostLanguage(...)` wrappers that translate `agent.id` + positional args into the control-plane request shape. Notable examples: `reviewDiff` (line 122) maps `{checkoutId, expectedRevision, expectedReviewId}`; `finalize` (line 239) maps `retention: WorktreeRetentionMode`; `returnToLocal` (line 300), `listAbandoned` (line 334) and `restoreAbandoned` (line 339) are the terminal/recovery RPCs. (Note: `gitDeleteTag`/`gitPushTag` exist only on the control plane at `control-plane.ts:842`/`858` — the service does not expose them as `@Remote` methods in this file.)

### Shared contract types used (`console-contract.ts`)

- `WorktreeConsoleOutcome<T>` — line 695: `{ ok: true, value: T } | { ok: false, error: WorktreeConsoleError }`.
- `WorktreeConsoleError` — line 688: `{ code, message, details?, continuation? }`.
- `worktreeReachedDelivery(phase, deliveryState?)` — line 64: delivery/retention/finalized predicate reused by the control plane.
- `consoleStateFromDomain(source)` — line 76: maps domain phase/delivery to `WorktreeConsoleTargetState` (the 11-state enum at line 40).
- `WorktreeConsoleTargetSummary` — line 149; `WorktreeConsoleTargetDetails` — line 182 (adds `managedRoot`, `sourceRoot`, `sourceOid`, `currentBranch`, `recoveryContinuation`).
- `WorktreeConsoleCapabilities` — line 98; `WorktreeConsoleReviewSummary` — line 135; `WorktreeConsoleDeliveryProof` — line 133 (`= WorktreeDeliveryProofView`).
- `WorktreeConsoleReviewDiffRequest` — line 492; `WorktreeConsoleReviewDiffResponse` — line 499 (`{ reviewId, revision, files: WorktreeConsoleDiffFile[], truncated }`); `WorktreeConsoleDiffFile` — line 483.
- `ReviewDiffStaleError` mapping to `stale_isolated` via `reviewChangedFilesNoLongerMatchesTheIsolatedSnapshot` message.

## Architecture

The module has four internal layers plus the shared contract; the service layer is the only one that knows about Cordis/Remote.

```text
┌───────────────────────────────┐
│  WorktreeConsoleService       │  service.ts  (TypertRemoteService)
│  @Remote methods (line 54–342)│  withHostLanguage + ndjson diag
└──────────────┬────────────────┘
               │ agent.id + request DTOs
               ▼
┌───────────────────────────────┐
│  WorktreeConsoleControlPlane  │  control-plane.ts
│  createWorktreeConsole…(206)  │  authorize / linkedReadAccess
│  reviewDiff / preflight / …   │  observe / details / mutationResponse
└──────┬───────────────┬─────────┘
       │               │
       ▼               ▼
┌──────────────┐  ┌──────────────────────────┐
│ projection   │  │ review-diff.ts            │
│ (ts) lines   │  │ createGitWorktree…(123)  │
│ 16–310       │  │ WorktreeReviewDiffReader │
│ project*()   │  │ + ReviewDiffStaleError   │
└──────┬───────┘  └────────────┬─────────────┘
       │                       │ spawn git in temp index
       ▼                       ▼
┌──────────────────────────────────────────────┐
│ SessionCheckoutModule / ports ([[ports]])     │
│ module.operate / inspect / preflight / git    │
└──────────────────────────────────────────────┘
       ▲
       │ WorktreeConsoleOutcome<T> + DTOs
┌──────────────────────────────────────────────┐
│ errors.ts (line 5–66): domainError/failure/   │
│ outcome/consoleFailure → WorktreeConsoleError │
└──────────────────────────────────────────────┘
```

- The **service** (`service.ts`) is the Typert Remote RPC face: every `@Remote` method (lines 54–342) translates an `Agent` + positional args into a control-plane request and runs it under `withHostLanguage` so host-message i18n resolves correctly. It attaches `workspaceClientFlavor`/`officialWorkspaceActive` (line 65) and appends ndjson diagnostics (`sidebarTopology` line 58, `current` line 83, `clientBootReport` line 71).
- The **control plane** (`control-plane.ts`) holds no framework imports; it is the authority layer. Every mutating method re-resolves the caller Session (`callerTarget` line 230), re-validates owner/source/cwd (lines 318–338, 340–398), and only then calls `module.*` ports.
- **projection** (`projection.ts`) is pure: it never touches Git or the registry, only `ManagedCheckoutRecord` + observed facts. This keeps capability/state computation testable without a filesystem.
- **review-diff** (`review-diff.ts`) isolates its Git work in a throwaway temp index (`GIT_INDEX_FILE`/`GIT_OBJECT_DIRECTORY` at lines 140–143) so it never mutates the managed checkout's index; it is also pure aside from the `git` spawn and the optional `projectSkills` adapter.
- **errors** (`errors.ts`) is the only translation point from thrown `Error`/`domainError` to the `WorktreeConsoleOutcome` discriminated union.

## Data Flow

**Read path — `current` polling (top capsule, every 5s):**

1. `WorktreeConsoleService.current(agent, locale)` (`service.ts:76`) → `controlPlane.current(agent.id)` (`control-plane.ts:764`).
2. `current` calls `callerTarget(sessionId)` (`control-plane.ts:230`) which runs `options.module.inspect` and falls back to `unboundLocalTarget` on `target_unselected`.
3. If `target.checkout.kind === 'local'`, `projectLocal` (`projection.ts:272`) returns a details DTO; otherwise `details` (`control-plane.ts:562`).
4. `details` → `linkedReadAccess` (auth) → `observe` (Git snapshot/dirty, reusing the `callerTarget` observation via `observeFromCaller` at line 443) → `projectDetails` (`projection.ts:192`) with `settledLocalBranch` (`control-plane.ts:489`) for the chip branch.
5. Service wraps the value in `withHostLanguage` and logs `durationMs`.

**Read path — `reviewDiff` (stale-guarded):**

1. `controlPlane.reviewDiff(request)` (`control-plane.ts:998`) authorizes owner + revision + review id (lines 1000–1004), runs `module.preflight` twice (before line 1005, after line 1018) to catch any local content drift, then `options.reviewDiff.read({...})` (`review-diff.ts:125`).
2. `read` builds a temp index, `read-tree baseOid && add -A`, `diff --cached --name-status`, and compares the resulting path set to `sortedUnique(changedFiles)` (lines 174–177). If they differ → `ReviewDiffStaleError` (line 176), propagated as `failure('stale_isolated', …)` at `control-plane.ts:1033`.
3. Per-file patches are batched (size 8, line 184) under the `REVIEW_DIFF_MAX_PAYLOAD_BYTES` budget (line 223), truncating payloads via `utf8Prefix` (line 228).

**Mutation path — `finalize` (the canonical CAS mutation):**

1. `WorktreeConsoleService.finalize(agent, …)` (`service.ts:239`) → `controlPlane.finalize(request)` (`control-plane.ts:1337`, async).
2. Guard checks return `failure(...)` directly when owner/revision/review/commit-message fail (lines 1340–1345).
3. `module.operate({ action: 'finish', … })` (line 1346); `conflict` status → `apply_conflict` + `applyConflictContinuation` (lines 1355–1361); `finished` → `mutationResponse` (`control-plane.ts:603`) with `deliveryProofFromTarget(result.target)` and `commitOid` (lines 1367–1374).
4. `mutationResponse` re-runs `observe` and projects via `projectRecord` + `projectReviewSlot` so the client gets a fresh capabilities/target state (`control-plane.ts:534–624`).

**Composition (wiring) at `src/index.ts`:**

- `apply()` (line 358) builds `module`, `lookup`, `files`, `registry`, `git`, then constructs `new WorktreeConsoleService(ctx, createWorktreeConsoleControlPlane({ module, lookup, files, registry, git, reviewDiff: createGitWorktreeReviewDiffReader(projectSkills) }), join(stateDir, 'sidebar-diag.ndjson'), providerLifecycle.officialWorkspaceActive)` (lines 398–405).
- `createTargetSessionId` defaults to `randomUUID` (control-plane.ts:207) unless overridden via options.
- `officialWorkspaceActive` comes from `mountWorkspaceProviderLifecycle` (`workspace-provider-lifecycle.ts`) and drives the `officialWorkspaceActive` flag on `sidebarTopology` (control-plane via service line 65).

## Connections

- `[[console_remote]]` — the Client-side Remote descriptor/typings; `WorktreeConsoleService` (service.ts) is the Host implementation that the Client's adapter (see `WorktreeConsoleAdapter`, console-contract.ts:745) calls over the Typert `gitWorktree` namespace.
- `[[session-checkout-module]]` — `SessionCheckoutModule` is the domain engine the control plane drives (`operate`, `inspect`, `preflight`, `createIsolatedTarget`, `resumeRevision`, `manageManagedWorktreeForSession`, etc.). `index.ts` builds both and wires them together (lines 381–405).
- `[[ports]]` — `SessionCheckoutLookupPort`, `SessionCheckoutFilesPort`, `SessionCheckoutGitPort`, `SessionCheckoutRegistryPort` provide the repository/registry/cwd evidence the control plane authorizes against (`authorize`, `verifyCallerRoot`).
- `[[console-contract]]` — the JSON-only shared DTOs (`WorktreeConsoleOutcome`, `WorktreeConsoleTargetSummary/Details`, `WorktreeConsoleCapabilities`, `WorktreeConsoleReviewDiffResponse`, `WorktreeConsoleError`, `worktreeReachedDelivery`, `consoleStateFromDomain`, error metadata `ERROR_META`). The control plane and projection import types and helpers from here rather than redefining them.
- `[[checkpoint]]` — `checkpointGenerationForRecord` (used in `projection.ts:14,173`) feeds `checkpointGeneration` on the projected target.
- `[[host-compat]]` — `hostWorkspaceClientFlavor()` and `workspaceFlavorDiagnostics()` (used in `service.ts:62,62`) supply the `workspaceClientFlavor`/`anchors` diag and `officialWorkspaceActive` election result.
- `[[host-i18n]]` — `withHostLanguage`, `languageFromSettings`, `hostMessage` drive every message in the control plane/service.
- `[[workspace-provider-lifecycle]]` — `mountWorkspaceProviderLifecycle` produces `officialWorkspaceActive`, passed into the service constructor (`index.ts:405`).
- `[[session-target-context]]` / `[[tools]]` / `[[commands]]` — other Host surfaces that also consume `SessionCheckoutModule`; the control plane is the console-specific front end.
- `tests/console-host.test.ts` — direct unit tests for `createWorktreeConsoleControlPlane` and `createGitWorktreeReviewDiffReader` (fixtures `readyRecord`/`retainedRecord`/`registry`/`moduleDouble` at lines 44–130).

## Known Issues

- **`reviewDiff` is not wrapped in `outcome()`** — unlike the other control-plane methods (which use `outcome(async () => …)` at the return-object literal), `reviewDiff` (`control-plane.ts:998`) and `finalize`/`finalizePreview` (`control-plane.ts:1337, 1381`) are bare `async` functions that return `failure(...)` / `consoleFailure(error)` directly. They do catch `ReviewDiffStaleError` (line 1033) but rely on manual error handling rather than the shared `outcome` wrapper. This is intentional for the preflight-gate path, but any unexpected throw still funnels through `consoleFailure` only at the explicit `catch` sites.
- **`create` flow has no `confirmations` guard on the `branch` path** — `preflightCreate` (line 956) only stores a confirmation token for the `empty` case; `create` (`control-plane.ts:989`) calls `createTarget` directly and trusts the caller. A source Session whose repo becomes non-empty between `preflightCreate` and `create` is not re-checked (unlike `createWithInitialCommit`, which re-validates `confirmation.fingerprint` at line 976).
- **`setRetention`/`setPermanent`/`retryCleanup`/`clearSidebarBadge` run `authorize` but do not re-check phase** — `setRetention` (`control-plane.ts:1426`) authorizes then directly calls `module.manageManagedWorktreeForSession`; the capability guard lives only in projection (`capabilities`, projection.ts:62–96). A caller that is authorized but whose `capabilities` disallows the action still reaches the module, which must enforce its own state machine — the console-side guard is projection-only.
- **`gitSwitchBranch` refuses while *any* same-project session is mid-delivery** — line 805–812 blocks the switch for every session sharing the project repo in a delivering state, not just `agent.id`. Comment notes this re-bases all future apply-to-local; the broad scope is a deliberate safety over-approximation.
- **Documented local-only leak ceiling on `consoleFailure`** — `errors.ts:13` (`ponytail` comment) notes that verbatim third-party error messages are surfaced as-is for the local console UI and are only truncated/replaced "if a remote face lands." Today the transport is local-only, so raw git messages can reach the client.
- **`observe` duplicate-spawn mitigation is read-path only** — `observeFromCaller` (control-plane.ts:443) reuses the warm `callerTarget` inspection on the `current` poll hot path, but `details` still calls `observe` once more for non-owner/linked reads, and the comment at lines 438–441 notes delivered terminal states intentionally skip the reuse (conservative `dirty: true`).
- **`REVIEW_DIFF_MAX_FILES` truncation loses files silently** — when `entries.length > REVIEW_DIFF_MAX_FILES` (200, line 180) the file list is sliced and `truncated` is set, but callers receive a partial `files` array; the budget logic at lines 223–234 trims payloads by dropping patch bytes (keeping the file entry) rather than dropping whole files.
- **`beginNextIteration` owner-root match accepts either managed or local root** — line 1488–1491 matches `workspace.root` to `predecessor.managedRoot` *or* `predecessor.localRoot`. The in-place (Local) next-iteration path needs the local match; the isolated path needs the managed match. Both are accepted, so a misbound Session whose workspace accidentally shares either root could pass the gate.

