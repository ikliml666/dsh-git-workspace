---
title: session_guard
type: module
source_files:
  - src/concurrent-session-guard.ts
  - src/session-checkout-module.ts
  - src/ports.ts
  - src/index.ts
  - src/adapters/git.ts
  - src/adapters/lookup.ts
  - src/session-target-context.ts
  - tests/concurrent-session-guard.test.ts
tags: [concurrency, branch-race, session-guard, runtime-context, reflog]
---

## Overview

The `session_guard` module defends against a specific concurrency hazard in this
git-worktree plugin: **multiple live Harness Sessions sharing one Local Git
checkout (the same `project.root`)**. When two such Sessions both live in the
Local boundary and one of them creates a fresh local branch, every later-started
Session that keeps working there would branch off the same HEAD and silently
switch the Local HEAD out from under the other Session.

The guard is split into two layers:

1. A **pure, synchronous predicate** `detectLocalBranchRace` in
   `src/concurrent-session-guard.ts` (the whole file is 89 lines). It takes a
   snapshot of live sessions plus branch-creation times and returns either
   `clear` or `race_detected` — never touches Git or the filesystem. This purity
   is deliberate: `runtimeContext` is called from the system-prompt contract,
   which must stay synchronous, so it cannot `await` branch-reflog probes.
2. A **background refresh + synchronous read** in `src/session-checkout-module.ts`.
   `refreshBranchRaceGuards()` (line 1002) performs the async reflog spawns on a
   timer and writes results into an in-memory `branchRaceCache`
   (`session-checkout-module.ts:1035`). `branchRaceNotice()` (line 1035) then
   consumes that cache synchronously inside `runtimeContext()` (line 1077) and
   emits the "Branch Race detected" warning.

The net effect: a later-started Session that still stands in the Local boundary,
when another live Session in the same checkout has created a branch inside the
detection window, is told to call `worktree_create` first to isolate its work
into a managed Worktree, instead of creating branches or committing in Local.

## Key Components

### `src/concurrent-session-guard.ts` (pure predicate, the module core)

**Interfaces (all `readonly`):**

- `GuardSessionInfo` (line 16): minimal live-session projection.
  - `id: string` (line 17) — session identifier.
  - `createdAt?: number` (line 19) — millisecond epoch from the session header; missing on legacy hosts.
  - `cwd?: string` (line 20) — session's live working directory.
- `BranchRaceFacts` (line 23): the detection result.
  - `status: 'race_detected' | 'clear'` (line 24).
  - `earlierLocalSessionIds: readonly string[]` (line 26) — live Sessions rooted in this Local boundary that started before `sessionId`.
  - `recentBranchNames: readonly string[]` (line 28) — Local branches created inside the window, newest first.
- `BranchRaceInput` (line 31): all evidence the predicate needs.
  - `sessions: readonly GuardSessionInfo[]` (line 32).
  - `sessionId: string` (line 33) — the Session being evaluated.
  - `localRoot: string` (line 40) — Local boundary root. A session counts as sharing the checkout when its `cwd` is the root or a descendant, or when its `cwd` is missing (the caller only passes sessions it already scoped to the workspace).
  - `branchCreationTimes: Record<string, number> | undefined` (line 42) — branch name → millisecond creation time, from per-branch reflog.
  - `now: number` (line 43).
  - `windowMs: number` (line 45) — detection window in milliseconds.
  - `managedBranches?: readonly string[]` (line 50) — branches owned by managed worktrees; they live in isolated checkouts and never race, so they are excluded from the "recent new branch" evidence.

**Functions:**

- `normalizePath(path: string): string` (line 53): converts `\` to `/`, appends a trailing slash, and lowercases on `win32` so Windows path comparisons are case/separator-insensitive. Used only by `cwdWithinLocalRoot`.
- `cwdWithinLocalRoot(cwd: string | undefined, localRoot: string): boolean` (line 60): containment test — the boundary itself is included. An empty/missing `cwd` returns `true` (treat as sharing). Implementation at lines 61–64.
- `detectLocalBranchRace(input: BranchRaceInput): BranchRaceFacts` (line 68): the pure race predicate.
  - Computes `earlierLocalSessionIds` (lines 70–78): every other session that shares the Local root (`cwdWithinLocalRoot`) AND started at or before `self`'s `createdAt`. The `createdAt === undefined` self or per-session `createdAt === undefined` short-circuit (lines 75–77) treats the other session as potentially earlier — a conservative "warn" choice.
  - Computes `recentBranchNames` (lines 79–84): entries from `branchCreationTimes` that are not in `managedBranches` and whose `createdAt >= now - windowMs`, sorted newest-first by time.
  - Returns `clear` (line 86) when either list is empty; otherwise `race_detected` (line 88).

### `src/session-checkout-module.ts` (integration / async refresh + sync read)

Local state and functions inside `createSessionCheckoutModule`:

- `branchRaceCache: Map<string, Record<string, number> | undefined>` (line 999): keyed by Local root; holds the latest branch-creation-times snapshot so `runtimeContext` can read it synchronously. A missing entry keeps the guard silent.
- `branchRaceWindowMsDefault = 30 * 60 * 1000` (line 1000): fallback window (30 min) when config is absent.
- `refreshBranchRaceGuards(): Promise<void>` (line 1002): **async** background refresh.
  - Bails out (line 1003) when `liveConfigValue(dependencies.branchRaceGuard) === false`.
  - Bails out (line 1004) when `dependencies.git.branchCreationTimes` is not a function (host without reflog support).
  - Collects every `projectId` from `sessionBindings`, `managedCheckouts`, and — critically — from `lookup.listLiveSessions()` (lines 1006–1016) so freshly-started sessions without a binding are still probed.
  - For each project root, calls `git.branchCreationTimes!(root)` (line 1021) and stores into the cache; a failed probe keeps the previous snapshot (lines 1022–1025).
- `branchRaceNotice(sessionId, registry): string` (line 1035): **synchronous** race warning builder used by `runtimeContext`.
  - Silent (`''`) when guard disabled (line 1036), no live-session support (lines 1037–1039), fewer than 2 live sessions (line 1040), no resolved project/localRoot (lines 1041–1044).
  - Excludes sessions already bound to an isolated target (lines 1047–1052), so only Local-boundary Sessions race.
  - Builds `managedBranches` from `record.sessionBranch` of non-discarded records (lines 1054–1056), then calls the pure `detectLocalBranchRace` (lines 1057–1065) with `now: Date.now()`, `windowMs` from `liveConfigValue(dependencies.branchRaceWindowMs) ?? branchRaceWindowMsDefault` (line 1063).
  - On `race_detected` returns the three-line "Branch Race detected" notice (lines 1067–1074); otherwise `''`.
- `runtimeContext(sessionId, cwd?): string` (line 1077): the system-prompt snapshot. When there is no binding for `sessionId` it returns `branchRaceNotice(...)` directly (line 1080); when bound to `local` with no pending worktree it appends `branchRaceNotice` to the "Local Checkout" text (line 1098). The notice is therefore shown both to unbound Sessions and to bound-Local Sessions with no active isolated checkout.

### `src/ports.ts` (contract surface)

- `SessionCheckoutLookupPort.listLiveSessions?(): readonly { id: string; createdAt?: number; cwd?: string }[]` (line 59): live-session projection; missing on hosts without the service, in which case the guard stays silent.
- `SessionCheckoutGitPort.branchCreationTimes?(root): Promise<Record<string, number> | undefined>` (line 181): per-branch creation times parsed from reflog `branch: Created from` entries; powers the guard. Ports without it leave the guard silent.
- `SessionCheckoutDependencies.branchRaceGuard?: boolean | LiveValue<boolean | undefined>` (line 605) and `branchRaceWindowMs?: number | LiveValue<number | undefined>` (line 607): volatile Cordis config, defaults true / 30 min (see `src/index.ts:309` and `src/index.ts:311`).
- `SessionCheckoutModule.refreshBranchRaceGuards?(): Promise<void>` (`index.ts:126`): the optional async refresh method on the public module interface.

### `src/adapters/git.ts` (data source)

- `branchCreationTimes: async (root)` (line 508): one `git reflog show --all --date=unix --format=%ct%x00%gd%x00%gs` spawn (line 512); parses each line, keeps only `branch: Created from` subjects (line 519), strips the `refs/heads/` prefix and `@{n}` suffix from the ref selector (line 520), and records the **earliest** (`createdAt < times[name]`) creation time per branch (lines 523–524).

### `src/adapters/lookup.ts` (data source)

- `listLiveSessions()` (line 109): reads the harness `sessions` store `list()`, projects each header's `id` / `createdAt` (number) / `cwd` (string) (lines 117–128); on a missing store or a thrown error returns `[]` so the guard stays silent rather than guessing.

### `src/session-target-context.ts` (wiring)

- `registerSessionTargetContext()` (line 14) registers the system-prompt snapshot (line 29) and, when `module.refreshBranchRaceGuards` exists, sets a `setInterval` every **45 000 ms** (line 24) that fire-and-forgets `module.refreshBranchRaceGuards!()` (line 23). The cache is refreshed off the synchronous path so `runtimeContext` never awaits.

## Architecture

```text
┌─────────────────────┐   setInterval 45s   ┌──────────────────────────────┐
│ session-target-      │ ─────────────────► │ refreshBranchRaceGuards()    │
│ context.ts:22        │  (fire-and-forget) │ session-checkout-module.ts:1002
└─────────────────────┘                     └──────────────┬───────────────┘
                                                            │ git.branchCreationTimes
                                                            │ (git.ts:508, reflog --all)
                                                            ▼
                                                   ┌────────────────────┐
                                                   │ branchRaceCache     │
                                                   │ Map<root, times>    │
                                                   │ module.ts:999       │
                                                   └─────────┬──────────┘
                                                             │ synchronous read
                                                             ▼
┌──────────────┐  runtimeContext()  ┌──────────────────────────────────────┐
│ system-prompt│ ◄───────────────── │ branchRaceNotice() module.ts:1035     │
│ contract      │   (no await)       │   listLiveSessions (lookup.ts:109)    │
│ (sync)        │                    │   detectLocalBranchRace (guard.ts:68) │
└──────────────┘                    └──────────────────────────────────────┘
                                          │
                                          ▼ pure predicate
                                   ┌────────────────────────┐
                                   │ concurrent-            │
                                   │ session-guard.ts       │
                                   │ cwdWithinLocalRoot:60  │
                                   │ detectLocalBranchRace:68
                                   └────────────────────────┘
```

Data the predicate combines: live sessions (`listLiveSessions`), branch creation
times (`branchRaceCache`), managed branches (from `managedCheckouts[].sessionBranch`),
and the per-Session `createdAt` ordering — all collected asynchronously and
replayed synchronously.

## Data Flow

1. **Background probe (async, every 45 s).** `registerSessionTargetContext` (`session-target-context.ts:14`) calls `refreshBranchRaceGuards()` (`session-checkout-module.ts:1002`). It gathers candidate project roots from `sessionBindings`, `managedCheckouts`, and `lookup.listLiveSessions()` (lines 1006–1016), then for each root calls `git.branchCreationTimes(root)` (`git.ts:508`). Each result is stored in `branchRaceCache` keyed by root (line 1021). A failed spawn keeps the prior snapshot.

2. **Synchronous evaluation (per system-prompt render).** `runtimeContext()` (`session-checkout-module.ts:1077`) is invoked by the system-prompt contract (`session-target-context.ts:36`) with the live `cwd`. For an unbound Session it calls `branchRaceNotice()` directly (line 1080); for a `local`-bound Session with no pending worktree it appends it (line 1098).

3. **Notice construction.** `branchRaceNotice()` (line 1035) pulls the live session list via `lookup.listLiveSessions()` (line 1038), drops sessions already bound to an isolated target (lines 1047–1052), resolves the project's Local root, and calls the pure `detectLocalBranchRace()` (`concurrent-session-guard.ts:68`) with:
   - `sessions: activeSessions`,
   - `sessionId`,
   - `localRoot`,
   - `branchCreationTimes: branchRaceCache.get(localRoot)`,
   - `now: Date.now()`,
   - `windowMs: liveConfigValue(dependencies.branchRaceWindowMs) ?? branchRaceWindowMsDefault`,
   - `managedBranches` (from `managedCheckouts[].sessionBranch`).

4. **Predicate logic.** Inside `detectLocalBranchRace`:
   - `earlierLocalSessionIds` = other sessions whose `cwd` is within `localRoot` (`cwdWithinLocalRoot`, line 60) and whose `createdAt <= self.createdAt` (treating unknown `createdAt` as "earlier").
   - `recentBranchNames` = branch names whose creation time `>= windowStart` and not in `managedBranches`, sorted newest-first.
   - If either list is empty → `status: 'clear'`; else `status: 'race_detected'`.

5. **Output.** On `race_detected`, `branchRaceNotice` returns the three-line notice instructing the later-started Session to call `worktree_create` first and never create Local branches/commits (lines 1067–1074). The text is concatenated into the `runtimeContext` string and surfaced to the model as the system-prompt `git-worktree:session-target` block (order 118).

6. **Test coverage.** `tests/concurrent-session-guard.test.ts:110` exercises the full path with a real git reflog: `createRaceContext()` builds two sessions (`session-early`, `session-late`), runs `module.refreshBranchRaceGuards!()` then asserts `runtimeContext('session-late')` contains `'Branch Race detected'` and the new branch name and `worktree_create` (lines 138–145). It also proves that without a prior refresh the cache is empty and the text is `''` (line 149), and that `branchRaceGuard: false` disables it (lines 151–153).

## Connections

- [[session-checkout-module]] — owns the async refresh (`refreshBranchRaceGuards`, `session-checkout-module.ts:1002`), the sync notice (`branchRaceNotice`, `:1035`) and the system-prompt entry (`runtimeContext`, `:1077`).
- [[ports]] — defines `listLiveSessions` (`ports.ts:59`), `branchCreationTimes` (`ports.ts:181`), `branchRaceGuard`/`branchRaceWindowMs` dependencies (`:605`, `:607`) and the `refreshBranchRaceGuards?` interface method (`:126`).
- [[index]] — mounts the plugin, supplies `branchRaceGuard`/`branchRaceWindowMs` config (default true / 30 min, `index.ts:309`, `:311`) and forwards `liveConfigValue` volatile references into `createSessionCheckoutModule` (`index.ts:393-394`).
- [[adapters/git]] and [[adapters/lookup]] — the two data sources: reflog-derived branch creation times (`git.ts:508`) and the live-session projection (`lookup.ts:109`).
- [[session-target-context]] — wires the 45 s refresh timer and the synchronous system-prompt render (`session-target-context.ts:14`).
- [[worktree-create]] — the remediation the notice points to: `worktree_create` isolates the later-started Session into a managed Worktree instead of mutating Local.

## Known Issues

- **Guard is opt-in and silent when data is missing.** If `branchRaceGuard` is false (`session-checkout-module.ts:1003`) or the host's `git.branchCreationTimes` port is absent (`session-checkout-module.ts:1004`) or `lookup.listLiveSessions` is unavailable (`session-checkout-module.ts:1037`), the notice is empty — no warning, no error. Same for the first render before the 45 s timer has fired (cache empty): `runtimeContext('session-late')` returns `''` until `refreshBranchRaceGuards` runs (`tests/concurrent-session-guard.test.ts:128`).
- **Cache staleness by design.** `branchRaceCache` is refreshed only on the 45 s interval (`session-target-context.ts:24`). A branch created and the race evaluated between ticks relies on the last snapshot; conversely a stale entry lingers until overwritten — intended trade-off to keep `runtimeContext` synchronous.
- **Conservative "warn" on unknown timestamps.** When `self.createdAt` or any peer `createdAt` is `undefined`, `detectLocalBranchRace` treats the peer as "potentially earlier" (`concurrent-session-guard.ts:75-77`), so a legacy host with no `createdAt` in headers will flag *every* multi-session checkout as a race. This is a deliberate safe-over-warn choice, not a bug.
- **`managedBranches` evidence only covers `record.sessionBranch`** (`session-checkout-module.ts:1054-1056`); branches from legacy records that never set `sessionBranch` are not excluded, so a recently created managed-worktree branch on an old record could still appear as "recent" evidence.
