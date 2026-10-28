---
title: support
type: module
source_files:
  - src/checkpoint.ts
  - src/commit-message.ts
  - src/creation-failure.ts
  - src/delivery-excludes.ts
  - src/adapters/worktree-creation.ts
  - src/session-checkout-module.ts
  - src/session-checkout-apply.ts
  - src/index.ts
  - tests/session-checkout-module.test.ts
  - tests/worktree-creation.test.ts
  - tests/support/commit-message.ts
tags: [support, checkpoint, commit-message, creation-failure, delivery-excludes]
---

## Overview

The `support` module is a collection of small, dependency-light standalone helpers that the session-checkout domain uses but do not belong to any state machine, adapter, or port. Each helper is a single-purpose, pure-ish function or class with no cross-imports inside the group, so they can be unit-tested and reused in isolation. There are four files:

- `src/checkpoint.ts` — derives a stable content-addressed "generation" string for a managed checkout's active Review + checkpoint chain.
- `src/commit-message.ts` — validates a free-form commit message before it is handed to Git on stdin.
- `src/creation-failure.ts` — a `WorktreeCreationFailure` error type that records whether a failed worktree creation was fully rolled back.
- `src/delivery-excludes.ts` — the canonical list of host/runtime artifacts that must stay out of review snapshots, delivery commits, and cleanup fingerprints, plus a converter to Git pathspec exclude arguments.

These helpers are consumed by the apply engine (`src/session-checkout-apply.ts`), the module state machine (`src/session-checkout-module.ts`), the worktree-creation adapter (`src/adapters/worktree-creation.ts`), and the plugin entry (`src/index.ts`). None of the four files are re-exported from `src/index.ts` — `WorktreeCreationFailure` reaches the domain only via its direct import in `src/session-checkout-module.ts:37`, and `isValidCommitMessage` / `checkpointGenerationForRecord` / `deliveryExcludePathspecs` are imported directly by the apply engine and module files.

## Key Components

### `src/checkpoint.ts`

- `canonicalJson(value: unknown): string` (line 4) — private. Recursively serializes a value into a stable, key-sorted canonical JSON string: arrays become `[...]`, plain objects become `{key:value,...}` with keys sorted and `undefined` entries filtered (lines 5–12). The result never includes spaces or key order noise, so equal logical inputs hash identically.
- `checkpointGenerationForRecord(record: ManagedCheckoutRecord): string | undefined` (line 16) — public. Returns a SHA-256 hex CAS generation for the exact active Review + checkpoint chain, or `undefined` unless the delivery state is `'ready_for_review'` or `'preview_active'` (line 18). It hashes a canonical JSON of: `checkoutId`, `revision`, `review.reviewId`, `review.isolatedHeadOid`, `review.isolatedFingerprint`, `checkpointCount` (from `record.checkpoints?.length ?? 0`), `previewId` (only when `preview_active`, else `null`), and `phase` (lines 19–28). Used by `src/session-checkout-module.ts` to stamp `checkpointGeneration` onto the inspection view so clients can detect when the Review/checkpoint chain changed without re-reading file state (see `recoveryView`, lines 410 and 409–411).

### `src/commit-message.ts`

- `isValidCommitMessage(value: unknown): value is string` (line 2) — public. Type guard returning `true` only when `value` is a non-empty string after `trim()`, i.e. `value.trim().length > 0`, and contains no NUL byte (`!value.includes('\0')`) (line 3). The file comment (line 1) clarifies the 500-character figure is **not** a Git limit — commit bodies go to Git on stdin, so the only hard constraint enforced here is the NUL separator. Consumed by `src/session-checkout-apply.ts` (`finalize` at line 2100, `checkpoint` at line 1192) and `src/session-checkout-module.ts` (`markReadyForReviewTarget` at line 1694).

### `src/creation-failure.ts`

- `class WorktreeCreationFailure extends Error` (line 2) — public. Thrown by the worktree-creation adapter to distinguish a failed creation from any other error, carrying a `rolledBack` boolean. Constructor signature `constructor(message: string, readonly rolledBack: boolean)` (line 3): it calls `super(message)`, sets `this.name = 'WorktreeCreationFailure'` (line 5). `rolledBack` is a public readonly field declaring whether the adapter already cleaned up (removed/quarantined) the partial checkout. `src/adapters/worktree-creation.ts` throws it in three paths: before claiming the target (line 72), after a confirmed quiescent rollback (lines 86, 116), and for un-cleaned failures (lines 119, 122). `src/session-checkout-module.ts` imports it (line 37) and `finishFailedCreation` (line 498) inspects the `rolledBack` flag to decide whether to drop the registry record (rolled back → delete checkout and binding, lines 512–519) or mark it `recovery_required` (not rolled back → `markRecoveryRequired`, line 509).

### `src/delivery-excludes.ts`

- `HOST_RUNTIME_ARTIFACTS: readonly string[]` (line 12) — public constant. The exact set of host/runtime artifacts that the session cwd (which lives inside the managed Worktree) writes and that are **not** delivery output: `'.dsh-ops'`, `'desktop-runtime.json'`, `'.dsh-runtime.json'` (lines 13–16). The file header (lines 1–11) explains these are paths the host is known to write (DSH panel logs, desktop runtime markers); business dirs like `build/`/`dist/` are deliberately excluded because the user's own `.gitignore` already covers them.
- `deliveryExcludePathspecs(paths: readonly string[] = HOST_RUNTIME_ARTIFACTS): string[]` (line 22) — public. Converts each raw path into four Git pathspec exclude arguments so the artifact is excluded as both a whole subtree and via a `**` glob variant (to cover nested occurrences when a plugin mounts a second workspace inside a subdirectory). For each trimmed, slash-normalized path it pushes (line 27):
  - `:(exclude)${path}`
  - `:(exclude)${path}/**`
  - `:(exclude,glob)**/${path}`
  - `:(exclude,glob)**/${path}/**`

  Leading/trailing slashes are stripped (line 25) and empty paths are skipped (line 26). Consumed by `src/session-checkout-apply.ts` in three places: `captureSnapshot` default excludes at line 606, `reviewIsolated` at line 1489, and `commitIsolated` at line 1538 — ensuring host artifacts and carried Project Skills never enter review snapshots or delivery commits.

## Architecture

The four helpers are leaf modules with no internal dependencies; each is imported by higher-level domain code. The box diagram maps producers (the domain files) to the leaf helpers.

```text
┌─────────────────────────────┐  ┌────────────────────────────┐
│ session-checkout-module.ts  │  │ session-checkout-apply.ts  │
│ (state machine)             │  │ (apply engine)             │
└───────┬───────────┬─────────┘  └───────┬───────────┬────────┘
        │           │                    │           │
        │ isValid   │ checkpointGeneration│ isValid   │ deliveryExclude
        │ Commit-   │ ForRecord          │ Commit-   │ Pathspecs
        │ Message    │                    │ Message    │
        ▼           ▼                    ▼           ▼
┌─────────────────────────────┐  ┌────────────────────────────┐
│ commit-message.ts           │  │ checkpoint.ts              │
│ creation-failure.ts         │  │ delivery-excludes.ts       │
│ (WorktreeCreationFailure)   │  │ (HOST_RUNTIME_ARTIFACTS)   │
└───────┬─────────────────────┘  └────────────────────────────┘
        │
        ▼ throw / catch
┌─────────────────────────────┐
│ adapters/worktree-creation.ts│
│ (createWorktree)            │
└─────────────────────────────┘
```

## Data Flow

1. **Commit-message validation** — enters at `isValidCommitMessage` (`src/commit-message.ts:2`). The model tool layer calls it twice: `markReadyForReviewTarget` (`src/session-checkout-module.ts:1684`) guards `suggestedCommitMessage`, and `src/session-checkout-apply.ts` guards the user-facing commit message in `finalize` (line 2100) and `checkpoint` (line 1192). A non-string, empty-after-trim, or NUL-containing value short-circuits into an `invalid_input` error before any Git `commit-tree`/`commit-tree` stdin write.

2. **Creation-failure rollup** — `createWorktree` (`src/adapters/worktree-creation.ts:17`) throws `WorktreeCreationFailure` with the `rolledBack` flag set to `true` (lines 72, 86, 116) when it already removed/quarantined the partial checkout, or `false` (lines 119, 122) when residue is preserved. The caller funnels the error into `finishFailedCreation` (`src/session-checkout-module.ts:498`), which re-wraps unknown errors into `WorktreeCreationFailure(message, false)` (line 503), then branches: rolled-back → delete the `managedCheckouts[checkoutId]` record and the session binding (lines 512–519); not rolled-back → `markRecoveryRequired` (line 509). In both cases it throws a `SessionCheckoutError` carrying the original message.

3. **Checkpoint generation** — `checkpointGenerationForRecord` (`src/checkpoint.ts:16`) is called from `recoveryView` (`src/session-checkout-module.ts:389` and 409–411) only when the record has checkpoints and a Review is active. It canonicalizes a fixed field set into `canonicalJson` and SHA-256 hashes it; the resulting `checkpointGeneration` string rides on the `SessionTargetView` so the client can tell whether the Review/checkpoint chain is byte-for-byte identical across inspections without diffing files.

4. **Delivery excludes** — `deliveryExcludePathspecs` (`src/delivery-excludes.ts:22`) is invoked in three apply-engine sites:
   - `captureSnapshot` default arg at `src/session-checkout-apply.ts:606` (covers `apply`/`plan`/`preview`/checkpoint snapshotting),
   - `reviewIsolated` at line 1489,
   - `commitIsolated` at line 1538.
   Each call expands `HOST_RUNTIME_ARTIFACTS` (or a caller-supplied override such as `input.excludePaths`) into four pathspec exclude strings per artifact (line 27), which are passed as the `excludes` argument to `captureSnapshot` (the `git add -A -- <excludes>` path at line 647) so host runtime markers (` .dsh-ops`, `desktop-runtime.json`, `.dsh-runtime.json`) and carried Project Skills are excluded from review snapshots, delivery commits, and cleanup CAS.

## Connections

- [[session-checkout-module]] — the state machine that consumes `isValidCommitMessage` (`markReadyForReviewTarget`, `src/session-checkout-module.ts:1684`), `checkpointGenerationForRecord` (`recoveryView`, lines 409–411), and `WorktreeCreationFailure` (`finishFailedCreation`, line 498; import at line 37).
- [[session-checkout-apply]] — the apply engine where `isValidCommitMessage` guards `finalize` (line 2100) and `checkpoint` (line 1192), and `deliveryExcludePathspecs` excludes host artifacts in `captureSnapshot` (line 613), `reviewIsolated` (line 1489), and `commitIsolated` (line 1538).
- [[worktree-creation]] — adapter that throws `WorktreeCreationFailure` (`src/adapters/worktree-creation.ts:72,86,116,119,122`); this is the producer side of the creation-failure flow documented above.
- [[ports]] — `ManagedCheckoutRecord` (imported in `src/checkpoint.ts:2` and `src/session-checkout-module.ts`) is the record shape `checkpointGenerationForRecord` reads; `WorktreeCreationEvidence` is the evidence type `createWorktree` writes.
- [[index]] — the plugin entry (`src/index.ts`) does not re-export any of these helpers; it defines the `SessionCheckoutError` type that `finishFailedCreation` raises, and the `SessionCheckoutModule` interface that the module file implements.
- [[managed-worktree-path]] — sibling leaf helpers for the same domain; `session-checkout-module.ts` imports both `creation-failure` and `managed-worktree-path` together (lines 37–45).

## Known Issues

- `isValidCommitMessage` (src/commit-message.ts:2) enforces only NUL-absence and non-emptiness; there is no length cap in the helper itself. The former 500-character boundary was removed and is intentionally not re-imposed here (see the file comment at line 1 and the test fixture `tests/support/commit-message.ts`, which exercises a 475-char-plus-emoji body). Field-level length caps (summary 240, details 12_000, etc.) live separately in `markReadyForReviewTarget` (src/session-checkout-module.ts:1684–1704), not in the commit-message helper.
- `deliveryExcludePathspecs` (src/delivery-excludes.ts:22) only excludes artifacts the host is *known* to write. Build outputs (`build/`, `dist/`) and other user-generated untracked paths are deliberately out of scope and rely on the user's `.gitignore`; the file header (lines 9–10) documents this boundary explicitly.
- `checkpointGenerationForRecord` (src/checkpoint.ts:16) returns `undefined` for every delivery state other than `'ready_for_review'` / `'preview_active'`. Callers must therefore treat a missing `checkpointGeneration` as "no generation", not "generation 0"; `recoveryView` only stamps it when both the record has checkpoints and the helper returns a value (src/session-checkout-module.ts:389–411).
- `WorktreeCreationFailure.rolledBack` (src/creation-failure.ts:3) is the only signal `finishFailedCreation` uses to decide between deleting the checkout record vs. marking `recovery_required`. A `false` value is also assigned when a non-`WorktreeCreationFailure` error reaches `finishFailedCreation` (src/session-checkout-module.ts:498), so any unexpected throw during creation always routes to `recovery_required` rather than silent cleanup.
