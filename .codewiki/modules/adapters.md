

---
title: adapters
type: module
source_files:
  - src/adapters/files.ts
  - src/adapters/safe-file.ts
  - src/adapters/registry.ts
  - src/adapters/lookup.ts
  - src/adapters/git.ts
  - src/adapters/git-options.ts
  - src/adapters/initial-commit.ts
  - src/adapters/worktree-creation.ts
  - src/adapters/project-skills.ts
  - src/adapters/project-skill-io.ts
  - src/adapters/project-skill-provider.ts
  - src/adapters/working-directory.ts
  - src/ports.ts
  - src/creation-failure.ts
  - src/index.ts
  - src/tools.ts
  - src/types.ts
  - tests/adapters-safe-file.test.ts
  - tests/lookup.test.ts
  - tests/working-directory-adapter.test.ts
  - tests/project-skills.test.ts
  - tests/project-skills-race.test.ts
  - tests/project-skill-provider.test.ts
  - tests/worktree-creation.test.ts
tags: [adapters, infrastructure, filesystem, git, registry, lookup, project-skills, working-directory]
---

## Overview

The `src/adapters/` directory contains the DSH infrastructure adapters that implement the *ports* declared in `src/ports.ts`. The session-checkout domain (state machine in `src/session-checkout-module.ts`, apply engine, ports) is host-agnostic and depends only on those port interfaces; every real I/O with the host/OS lives behind these adapters so the domain stays testable with fakes.

The adapters cover five port families defined in `ports.ts`:

- **Filesystem** — `SessionCheckoutFilesPort`, implemented by `createNodeFilesPort` in `files.ts` plus the crash-safe JSON helpers in `safe-file.ts`.
- **Git** — `SessionCheckoutGitPort`, implemented by `createDshGitPort` in `git.ts`, with timeout policy in `git-options.ts`, initial-commit actions in `initial-commit.ts`, and the worktree-registration/rollback engine `createWorktree` in `worktree-creation.ts`.
- **Registry** — `SessionCheckoutRegistryPort`, implemented by `AtomicJsonCheckoutRegistry` in `registry.ts` (persisted via `safe-file.ts`).
- **Lookup** — `SessionCheckoutLookupPort`, implemented by `createDshLookupPort` in `lookup.ts` over the Harness `workspaceRegistry` / `sessions` services.
- **Project skills** — host-side Skill discovery/transport implemented by `ProjectSkillStore` (`project-skills.ts`), `project-skill-io.ts`, and `ClaudeProjectSkillProvider` (`project-skill-provider.ts`). These are not declared as ports in `ports.ts`; they are injected directly into the apply engine and tool layer.
- **Working directory** — `SessionWorkingDirectoryPort`, implemented by `createSessionWorkingDirectoryPort` in `working-directory.ts` over the host `workingDirectory` service (optional mount).

The adapters are constructed and wired together in `src/index.ts` `apply()` (lines 358–409): `createDshLookupPort(ctx)`, `new ProjectSkillStore(...)`, `createDshGitPort(ctx, {...})`, `createNodeFilesPort()`, `new AtomicJsonCheckoutRegistry(...)`, and `mountProjectSkillProvider(ctx, registry)`. A single `ProjectSkillStore` instance is shared between the git port (skill carry/assert-removable) and the apply engine, and is also used by the console review-diff reader.

Design invariants carried by the adapters:

- Git runs only through `ctx.subprocess` with hardening preserved from Domi: disabled git hooks (`core.hooksPath`), no optional locks, no terminal prompts, C locale, scrubbed ambient `GIT_*` env, and a hard timeout. See the header comment in `git.ts:6-24`.
- Plugin artifacts live under the `refs/dsh-worktree/session-checkouts/<key>` ref namespace (`git.ts:201-233`) so they never collide with user refs; abandoned-snapshot refs deliberately live outside that namespace at `refs/dsh-worktree/abandoned/<checkoutId>` (`git.ts:230-233`).
- Worktree creation is crash-recovery-first: identity evidence is captured before any mutating `git` call, and a failed registration is only ever rolled back (never force-deleted) when the tree is provably unchanged (`worktree-creation.ts`).
- Project-skill transport is provenance-checked end to end: a per-checkout manifest under the plugin state directory authorizes carry/copy/removal (`project-skills.ts`, `project-skill-provider.ts`).

## Key Components

### `files.ts` — Node filesystem port (`SessionCheckoutFilesPort`)

Module-level helpers (not exported) used by `createNodeFilesPort`:

- `measureDirectoryBytes(path: string): Promise<number>` — `files.ts:16-24`. Recursively sums byte sizes; returns `0` for missing paths or symlinks; does not follow symlinks.
- `removeEmptyDirectoryTree(path: string): boolean` — `files.ts:26-35`. Recursively deletes only empty directories; returns `true` when `path` was absent; refuses files/symlinks.
- `inspectDirectoryIdentity(path: string): Promise<DirectoryIdentity | null>` — `files.ts:37-46`. Reads `device`/`inode`/`birthtimeNs` via `lstat({bigint:true})`; returns `null` for missing/non-dir/symlink. `DirectoryIdentity` is `{device, inode, birthtimeNs}` (`ports.ts:232-236`).
- `directoryIdentitiesEqual(left, right)` — `files.ts:48-50`. Compares all three fields.
- `quarantineDirectoryTree(path, expectedIdentity, quarantinePath)` — `files.ts:52-72`. Atomically `rename`s within the same parent only; after move, re-reads identity and compares to `expectedIdentity`; on mismatch, attempts to move back and throws `SessionCheckoutError('checkout_mismatch', ...)` rather than deleting.
- `removeDirectoryTree(path)` — `files.ts:74-86`. Recurses-deletes a fully-owned tree (`rm -r`) with platform-specific `maxRetries`; refuses file/symlink with `SessionCheckoutError('checkout_mismatch', ...)`.

Public factory:

- `createNodeFilesPort(): SessionCheckoutFilesPort` — `files.ts:89-109`. Returns an object literal implementing every port method:
  - `exists`: `existsSync`.
  - `canonicalize`: `async (path) => realpath(resolve(path))`.
  - `inspectDirectoryIdentity`, `ensureDirectory` (`mkdirSync({recursive:true})`), `removeEmptyDirectoryTree`, `quarantineDirectoryTree`, `removeDirectoryTree`, `measureDirectoryBytes` (above).
  - `readTextFile`: `existsSync(path) ? readFileSync(path,'utf8') : null`.
  - `copyFile`: creates parent dir, removes target if exists, then `copyFileSync`.
  - `isSymbolicLink`: `lstatSync(...).isSymbolicLink()` collapsing non-strings/absent to `false`.

### `safe-file.ts` — crash-safe JSON/text persistence

Module constants and helpers:

- `RETRYABLE_RENAME_CODES` — `safe-file.ts:14-18`. Windows adds `EBUSY/EPERM/EACCES/ENOTEMPTY`; non-Windows `EBUSY/ENOTEMPTY`.
- `sleepSync(milliseconds)` — `safe-file.ts:20-27`. `Atomics.wait` based sleep with a busy-spin fallback.
- `renameAtomicWithRetry(source, target, maxAttempts=5)` — `safe-file.ts:30-44`. Renames, retries on retryable codes with exponential backoff (`20 * 2**(attempt-1)` ms).
- `tmpPathFor(filePath)` — `safe-file.ts:50-52`. Returns `<file>.<pid>.<uuid>.tmp`; unique per-process tmp prevents concurrent writers from truncating each other or promoting a half-written tmp.
- `listTmpFiles(filePath)` — `safe-file.ts:55-68`. Returns all `*.tmp` residue (including the legacy fixed `<file>.tmp`) sorted by mtime newest→oldest.
- `cleanupTmpFiles(filePath)` — `safe-file.ts:70-74`. Unlinks every listed tmp.

Public functions:

- `writeJsonFileAtomic(filePath, data, skipBackup=false)` — `safe-file.ts:82-100`. Backs up existing file to `<file>.bak`, writes JSON to unique tmp, then atomic rename.
- `writeTextFileAtomic(filePath, content)` — `safe-file.ts:103-107`. Same pattern for plain text (JSONL etc.).
- `readJsonFileSafe<T>(filePath): T | null` — `safe-file.ts:113-161`. Tries primary file → newest parseable `.tmp` (promotes via atomic rename) → `.bak` (restores primary). Returns `null` when all fail, signalling the caller to rebuild from JSONL.

### `registry.ts` — durable `ManagedCheckoutsRegistry` (`SessionCheckoutRegistryPort`)

Validation predicate helpers (each returns a type guard over `unknown`): `isRecord` (`registry.ts:26-28`), `isStringArray` (`30-32`), `isOid` (`34-36`, 40- or 64-hex), `isBoundedText` (`38-40`, no NUL), `isSafeRelativePath` (`42-46`, no absolute/empty/`..`), `isTargetRef` (`48-53`), `isSessionBinding` (`55-65`), `isReview` (`67-85`), `isPreviousReview` (`87-95`), `isCheckpoint` (`97-114`), `isPreviewReceipt` (`116-136`), `isDeliveryProof` (`138-150`), `isDelivery` (`152-191`, exhaustively validates every `state` variant), `isJournal` (`193-250`), `isRecoveryContinuation` (`266-290`), `isManagedCheckout` (`292-325`), `isRegistry` (`327-337`). Legacy helpers `safeRecoveryString` (`252-254`), `safeRecoveryRevision` (`256-258`), `safeConflictFile` (`260-264`).

- `emptyRegistry()` — `registry.ts:17-24`. Returns the empty `{version:2, revision:0, sessionBindings:{}, managedCheckouts:{}}`.
- `migrateLegacyRegistry(value)` — `registry.ts:339-394`. Converts a v1 registry to v2; phases other than `ready`/`discarded` become `recovery_required`; bumps `revision`.
- `class AtomicJsonCheckoutRegistry implements SessionCheckoutRegistryPort` — `registry.ts:397-416`.
  - constructor `(private readonly path: string)` — `registry.ts:398`.
  - `read(): ManagedCheckoutsRegistry` — `registry.ts:400-410`. Reads via `readJsonFileSafe`; if valid returns it; else tries `migrateLegacyRegistry` and writes the migrated copy; else if file absent returns `emptyRegistry()`; else throws `SessionCheckoutError('registry_corrupt', ...)`.
  - `write(registry)` — `registry.ts:412-415`. `mkdirSync` parent then `writeJsonFileAtomic`.

### `lookup.ts` — Harness-backed `SessionCheckoutLookupPort`

Structural interfaces (compile-time-only): `WorkspaceLike` (`lookup.ts:19-24`), `WorkspaceRegistryLike` (`26-32`), `LiveSessionLike` (`34-36`), `SessionStoreLike` (`38-41`).

- `isWorkspaceRegistryLike`, `isSessionStoreLike` — `lookup.ts:43-54`. Narrow `ctx.get(...)` returns.
- `sameResolvedPath(left, right)` — `lookup.ts:56-62`. Cross-platform normalized `resolve` equality.
- `createDshLookupPort(ctx): SessionCheckoutLookupPort` — `lookup.ts:65-165`. `registry()` reads `ctx.get('workspaceRegistry')`; `sessions()` reads `ctx.get('sessions')`; `liveHeaderCwd(sessionId)` (`81-84`) centralizes the `sessions()?.get(id)?.header?.cwd` read. Returns the port object:
  - `getSidebarMemberships(managedRoots)` — `87-108`. Maps each root to matching workspace ids and session ids (also from `ctx.get('sessionQuery').listSessions()` headers).
  - `listLiveSessions()` — `109-133`. Builds `{id, createdAt?, cwd?}` from the live session store; degrades to `[]` on error.
  - `getSession(sessionId)` — `134-151`. First scans `workspace.sessionIds`; then, when Harness filtered a still-live cleaned Session, recovers via `liveHeaderCwd` + exactly-one matching workspace.
  - `getSessionCwd(sessionId)` — `152-157`. Returns the live header's real cwd (the immutable worktree root for an owner Session).
  - `getProject(projectId)` — `158-163`. Maps a workspace to `{id, name: workspace.title, root: workspace.path}`.

### `git.ts` — subprocess-backed `SessionCheckoutGitPort`

Module constants: `GIT_TERMINATION_GRACE_MS = 1_000` (`git.ts:38`), `GIT_COLLECT_BYTES = 1<<20` (`40`), `WIP_PATCH_COLLECT_BYTES = 16<<20` (`42`).

- `interface GitPortOptions extends GitTimeoutOptions` — `git.ts:44-48`. Adds `hooksPath: string` (dir holding empty `core.hooksPath` target) and optional `projectSkills?: ProjectSkillStore`.
- `interface GitCommandResult` — `git.ts:50-56`. `{code, stdout, stderr, quiescent?}`.
- `parseDecoration(decoration)` — `git.ts:63-71`. `%D` ref decoration → ref names; keeps `tag:` prefix, drops `HEAD ->`.
- `settleCreationTree(handle)` — `git.ts:73-86`. `terminate()` + `waitForExit` to confirm whole-tree quiescence.
- `runGit(ctx, cwd, args, options, input?, creation?, collectBytes?)` — `git.ts:93-188`. The core spawner: builds the argv (`git --no-pager --no-optional-locks`, win32 `core.longpaths`, `core.hooksPath`, `core.quotePath=false`, `core.fsmonitor=false`, scrubbed `GIT_*`, `GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`, `LC_ALL/LANG=C`), streams with `maxBytes` cap, supports interactive `GitCommitProtocol` input for `update-ref`/`commit-tree` CAS, computes the timeout via `gitTimeoutMs`, and (for `creation`) waits for quiescence via `settleCreationTree`. Returns `GitCommandResult`.
- `runGitChecked(ctx, cwd, args, options)` — `git.ts:190-199`. Wraps `runGit`; throws `SessionCheckoutError('git_operation_failed', ...)` on non-zero.
- `checkoutRefRoot(checkoutId)` — `git.ts:201-204`. `sha256(checkoutId)` → `refs/dsh-worktree/session-checkouts/<24hex>`.
- `assertArtifactName(artifactName)` — `git.ts:206-214`. Rejects empty/segment-malformed names.
- `internalArtifactRef(checkoutId, artifactName)` — `git.ts:216-219`; `applyBaseRef(checkoutId)` → `.../<key>/apply-base` (`221-223`); `abandonedSnapshotRef(checkoutId)` → `refs/dsh-worktree/abandoned/<checkoutId>` (`230-233`).
- `hasGitMetadata(root)` — `git.ts:235-246`. Walks up parents looking for `.git`.
- `createDshGitPort(ctx, options): SessionCheckoutGitPort` — `git.ts:249-773`. Builds `projectSkills`, `runSessionGit`, `runSessionGitChecked`, then returns a port object implementing the full `SessionCheckoutGitPort` (all methods listed below) and `Object.assign`s the initial-commit actions from `initialCommitActions(port.inspect, runSessionGit)` (`git.ts:772`). Implemented methods:
  - `inspect` (`256-322`) — single `rev-parse` for toplevel/common-dir/git-dir/HEAD; falls back to per-field reads for unborn/broken HEAD; returns `null` only for a confirmed non-repo with no `.git` metadata.
  - `findContainingWorktreeRoot` (`323-330`), `status` (`331-335`, dirty only for non-auxiliary Skill changes via `hasDeliverableStatus`), `createDetachedWorktree` (`336-348`, gates on committed Skill changes then delegates to `createWorktree` + `projectSkills.carry`), `removeWorktree` (`349-359`, asserts removable Skills then `worktree remove --force`), `pruneWorktrees` (`360-362`).
  - `retainApplyBase`/`releaseApplyBase` (`363-368`, `update-ref (delete)`), `retainInternalArtifact` (`369-371`), `readInternalArtifact` (`372-377`), `releaseInternalArtifacts` (`378-388`, single `update-ref --stdin` transaction).
  - `isAncestor` (`389-394`), `listLocalBranches` (`395-398`), `resolveLocalBranchTip` (`399-404`), `attachWorktreeBranch` (`405-425`, CAS `update-ref` + `symbolic-ref HEAD`, no worktree file touches), `pushBranch` (`426-442`, never force).
  - `repairWorktreeLinks` (`443-448`, `git worktree repair`), `listWorktreeincludeFiles` (`449-468`, `.worktreeinclude` intersection of ignored-and-matched; auto-carries `AGENTS.override.md`), `branchOverview` (`469-485`), `defaultBranch` (`486-493`), `branchTipTimes` (`494-507`), `branchCreationTimes` (`508-527`, from reflog `branch: Created from`), `deleteLocalBranch` (`528-532`, `-d` only).
  - `graphLog` (`533-555`), `createLocalBranch` (`556-565`, `check-ref-format`), `switchLocalBranch` (`566-577`, detects "used by worktree" errors), `listTags` (`578-615`), `createTag` (`616-631`), `deleteLocalTag` (`632-637`), `pushTag`/`deleteRemoteTag` (`638-648`, never force).
  - `mergeLocalBranch` (`649-719`) — dry-run probes in a throwaway detached worktree; real merge leaves conflict state in place (never aborts); returns `{type:'merged'|'conflict'|'up_to_date'|'failed', ...}`.
  - `captureLocalWip` (`720-728`, `diff --binary HEAD`), `applyWorktreePatch` (`729-735`), `listUntrackedFiles` (`736-740`), `snapshotAbandonedWorktree` (`741-761`, `add -A` → `write-tree` → `commit-tree` with fixed identity → `update-ref` to abandoned ref), `restoreAbandonedSnapshot` (`762-770`, creates `worktree-restore-<8hex>` branch and deletes the abandoned ref).

### `git-options.ts` — git timeout policy

- `interface GitTimeoutOptions` — `git-options.ts:3-6`. `{gitTimeoutMs?, worktreeAddTimeoutMs?}` each `number | LiveValue<...>`.
- `DEFAULT_GIT_TIMEOUT_MS = 120_000`, `DEFAULT_WORKTREE_ADD_TIMEOUT_MS = 5*60_000`, `MAX_GIT_TIMEOUT_MS = 60*60_000` — `git-options.ts:8-10`.
- `validateGitTimeouts(options)` — `git-options.ts:12-19`. Throws `RangeError` if any value is not an integer in `[1000, MAX_GIT_TIMEOUT_MS]`.
- `gitTimeoutMs(args, options)` — `git-options.ts:21-27`. `worktree add` → `worktreeAddTimeoutMs` (default 5min); `worktree remove` → 5min; else `gitTimeoutMs` (default 120s). Reads `LiveValue`s per call.

### `initial-commit.ts` — initial-commit port actions

- `interface GitCommitProtocol { prepare: string; beforeCommit(): Promise<void> }` — `initial-commit.ts:8`.
- `type Run = (root, args, input?) => Promise<{code, stdout, stderr}>` — `initial-commit.ts:10`.
- `initialCommitActions(inspect, run)` — `initial-commit.ts:13-119`. Returns `{preflightInitialCommit, initializeEmptyRepository, initializeProject}` (assigned onto the git port at `git.ts:772`):
  - `preflightInitialCommit(root)` — `29-47`. Returns `{kind:'ready'|'files'|'empty', fingerprint, snapshot}`; `empty` carries a SHA-256 fingerprint over snapshot + directory identities (`identity()` at `20-24` and `indexBytes()` at `25-28`).
  - `initializeEmptyRepository(root, fingerprint, assertAuthorized?)` — `48-100`. Re-checks fingerprint under an index lock, verifies author identity, `mktree` empty tree, `commit-tree`, then CAS-commits the unborn HEAD via `update-ref --stdin` with a `beforeCommit` recheck (throws `stale_local`/`operation_not_allowed` on drift; `operation_not_allowed`/`initialRepositoryBusy` on `EEXIST`).
  - `initializeProject(root)` — `104-117`. `git init -b main` if non-repo, then `add -A` + `commit -m 'Initial commit'`; refuses already-versioned repos.

### `worktree-creation.ts` — worktree registration & crash-rollback engine

Module types `Result = {code, stdout, stderr, quiescent?}`, `Run = (cwd, args, creating?) => Promise<Result>` (`worktree-creation.ts:12-13`); `files = createNodeFilesPort()` (`11`); `samePath`, `sameIdentity` helpers (`12-14`).

- `createWorktree(localRoot, target, baseOid, run, saveEvidence?)` — `worktree-creation.ts:17-124`. Registers and checks out a detached worktree with full identity evidence (`WorktreeCreationEvidence`, `ports.ts:274-286`). On failure it is **never** force-deleted: if registration never completed (`!registered`) it removes an *exclusively-claimed* empty dir only under strict identity checks; if it had registered, it rolls back via `worktree move --force` into a quarantine path then `worktree remove --force`, re-verifying identity throughout. Throws `WorktreeCreationFailure` (`src/creation-failure.ts`, `{message, rolledBack:boolean}`).
- `verifyIdentity(e, baseOid)` — `126-148`, `verifyRollbackMetadata(e, baseOid)` — `150-160`, `metadataFingerprint(gitDir)` — `162-183` (recursive sha256 over the fixed allow-list of metadata files), `verifyUnmodified(root, baseOid, run)` — `185-250` (proves the checkout still equals the authorized base before any deletion).

### `project-skills.ts` — project-skill provenance store (`ProjectSkillStore`)

Module constants `PROJECT_SKILL_ROOTS = ['.dsh/skills', '.agents/skills', '.claude/skills']` (`project-skills.ts:7`), `MAX_FILES = 5000`, `MAX_BYTES = 64MB` (`8-9`); interfaces `Entry` (`10`), `Manifest` (`11`, `{version:1, root, identity, phase:'copying'|'ready', files, directories?}`), `SkillSnapshot` (`12`), `CarriedSkillState` (`13`).

- `safePath(path)` — `17-22`, `identity(path)` — `23-27`, `inspectPath(root, relative)` — `29-39`, `boundedRead(path, limit)` — `40-58` (O_NOFOLLOW, TOCTOU-guarded read).
- `assertSkillTree(root, skillRoot)` — `60-70`. Recursively inspects a skill root (depth/sum caps).
- `ownedSkillDirectories(files, directories?)` — `71-73`. Computes the owned `<root>/<ns>/<skill>` prefixes.
- `inventory(root, roots?, tracked?, emptyDirectories?)` — `74-98`. Walks the skill roots (depth ≤64, ≤10000 entries) and reads each file's content + sha256 hash.
- `class ProjectSkillStore` — `101-214`:
  - constructor `(private readonly directory: string)` — `102`. Per-checkout manifest is `<sha256(resolve(root))>.json` (`103`).
  - `snapshot(source): Promise<SkillSnapshot>` — `104-107`.
  - `load(root): Promise<Manifest | null>` — `108-124`. Revalidates version/root/identity/phases/files; returns `null` when missing.
  - `carry(snapshot, target): Promise<void>` — `125-167`. Exclusive (`wx`) manifest publication; creates dirs/files; verifies hashes; renames `.ready` into place.
  - `scope(root)` — `168-171`, `paths(root)` — `172`; `state(root, tracked?)` — `173-203` returns `{paths, fingerprint, modified}`; `assertRemovable(root, tracked)` — `204-212` (throws when modified or new resources appear); `forget(root)` — `213` (rm manifest).
- `trackedSkillPaths(indexEntries, headPaths?)` — `216-223`. Union of `ls-files --stage` (index) and `ls-tree` (HEAD) paths.
- `hasDeliverableStatus(output, auxiliary, directories?)` — `225-235`. Returns `true` when the `git status -z` output has any non-auxiliary `??` (untracked) entry, i.e. a real dirty change.
- `assertSkillPath(root, path)` — `237-239`.

### `project-skill-io.ts` — low-level skill file I/O

- `checkRoot(root, expected)` — `project-skill-io.ts:10-15`, `checkPath(root, path, createParents?)` — `16-36` (only `.dsh/.agents/.claude` + `skills` + component-name checks).
- `readSkillFiles(root, identity, files)` — `38-64`, `createSkillDirectories(root, identity, directories)` — `66-73`, `createSkillFiles(root, identity, files)` — `75-88` (O_EXCL, chmod, sync; re-`checkRoot`/`checkPath` after each step).

### `project-skill-provider.ts` — Claude project skill provider

- `NAME = 'worktree-project-claude'` — `project-skill-provider.ts:10`.
- `candidatePath(candidate)` — `14-19`. Reads `candidate.locator.path` (DSH 0.2) else `candidate.path` (DSH 0.1).
- `managedSkillRoot(registry)` — `22-45`. Returns a resolver `(cwd) => string | null` that finds a `phase==='ready'` managed checkout whose `managedGitRoot` contains `cwd` and whose `.git`/backlink chain matches the registry record.
- `class ClaudeProjectSkillProvider implements SkillProvider` — `48-119`: `name` (`49`), `providers` Map capped at 32 (`50-74`), serialized `run`/`operations` queue (`51-57`), `list`/`listNow` (`75-94`, validates each candidate's path via `assertSkillTree`+`assertSkillPath`, marks `source:'project-claude'`, rank 250), `get`/`getNow` (`95-108`), `observeHostMutation` (`109-111`), `dispose` (`112-118`).
- `mountProjectSkillProvider(ctx, registry)` — `121-133`. `ctx.inject(['skills'], ...)` registers the provider under `managedSkillRoot(registry)` and re-forwards `fs/observed` events.

### `working-directory.ts` — session working-directory port (`SessionWorkingDirectoryPort`)

- `interface WorkingDirectoryServiceLike` — `working-directory.ts:18-24` (`get`/`ensure?`/`set`).
- `interface SessionWorkingDirectoryPort` — `27-43`: `current(agent)`, `enter(agent, path)`, `leave(agent, path, fallback)`.
- `isWorkingDirectoryLike` — `45-50`, `sessionOf(agent)` — `52-54`.
- `createSessionWorkingDirectoryPort(ctx): SessionWorkingDirectoryPort` — `61-101`. Resolves `ctx.get('workingDirectory')` dynamically (also tolerates a plugin-only Context with no `get`); `current` reads `service.get(session)`, `enter` calls `service.set` (returns `undefined` when no service or no live Agent — callers must never report a cwd they didn't move into), `leave` restores `fallback` only when the session is currently inside `path`.
- `isWithin(candidate, root)` — `104-112`. Cross-platform containment check (`resolve` + separator/`..`/`\` guards, win32 case-insensitive).

## Architecture

The adapters implement the five port families declared in `src/ports.ts` and one host-service port (`working-directory.ts`). The `apply()` entry (`src/index.ts:358-409`) constructs each adapter and injects them into `createSessionCheckoutModule` (`src/session-checkout-module.ts`). `ProjectSkillStore` is a shared singleton passed both into `createDshGitPort` (for Skill carry/assert-removable) and `createSessionCheckoutApplyEngine`.

```text
┌─────────────────────────────── apply() (src/index.ts:358) ───────────────────────────────┐
│ builds port implementations and injects them into the session-checkout module             │
└─────────────────────────────────────────────────────────────────────────────────────────┘
        │              │              │              │              │              │
        ▼              ▼              ▼              ▼              ▼              ▼
┌───────────────┐ ┌───────────┐ ┌──────────────┐ ┌───────────┐ ┌─────────────┐ ┌──────────────┐
│ createDsh     │ │ createNode │ │ AtomicJson   │ │ createDsh │ │ ProjectSkill│ │ createSession│
│ LookupPort    │ │ FilesPort  │ │ CheckoutReg. │ │ GitPort   │ │ Store (singl)│ │ WorkingDir.  │
│ (lookup.ts)   │ │ (files.ts) │ │ (registry.ts)│ │ (git.ts)  │ │(project-    │ │ Port         │
└──────┬────────┘ └─────┬──────┘ └──────┬───────┘ └─────┬─────┘ │  skills.ts) │ │(working-    │
       │                │              │               │        └──────┬──────┘ │ directory.ts)│
       │ ctx.get('workspace│           │               │               │        │ └──────┬───────┘
       │   Registry'/'sessions')       │               │               │        │        │
       ▼                │              │               │               ▼        │        ▼
┌──────────────┐       │      ┌─────────┴─────────┐   │      ┌────────────────┐│   ┌──────────────┐
│ Harness      │       │      │ readJsonFileSafe  │   │      │ skill files    ││   │ Host         │
│ workspace /  │       │      │ writeJsonFileAtomic│   │      │ (.dsh/.agents/ ││   │ working-     │
│ sessions svc │       │      │ (safe-file.ts)    │   │      │  .claude/skills)││   │ Directory svc│
└──────────────┘       │      └───────────────────┘   │      └────────────────┘│   └──────────────┘
                       │                               │                        │
            ┌──────────┴────────────┐                  │          ┌─────────────┴──────────┐
            │ node:fs / realpath /  │                  │          │ createWorktree        │
            │ lstat / rename        │                  │          │ (worktree-creation.ts)│
            └───────────────────────┘                  │          │ git subprocess spawn  │
                                                       │          │ identity-evidence CAS │
            ┌──────────────────────────────────────────┴──────────┴──────────────────────┐
            │ createDshGitPort ──runs──▶ ctx.subprocess (git, --no-optional-locks,        │
            │   hooksPath, C locale, scrubbed GIT_*)  +  initialCommitActions             │
            │   (initial-commit.ts) + gitTimeoutMs (git-options.ts)                       │
            └──────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
                          ┌────────────────────────────┐
                          │ createSessionCheckoutModule │ (src/session-checkout-module.ts:237)
                          │ + applyEngine (shares       │
                          │   ProjectSkillStore)        │
                          └────────────────────────────┘
```

Notes:
- `working-directory.ts` and `lookup.ts` both resolve host services dynamically via `ctx.get(...)` and degrade to `undefined`/no-op when the host does not mount them (see `working-directory.ts:62-68`, `lookup.ts:66-73`).
- `registry.ts` persists through `safe-file.ts` so a crash mid-write never truncates the whole registry.
- `git.ts` is the only adapter that shells out to Git; every other adapter is pure `node:fs`.
## Data Flow

### Worktree creation (filesystem + git + skill adapters)

1. `session-checkout-module.ts` calls `dependencies.git.createDetachedWorktree(localRoot, managedRoot, baseOid, saveCreationEvidence)` (`git.ts:336-348`).
2. `createDetachedWorktree` first snapshots project Skills (`projectSkills.snapshot(localRoot)`, `project-skills.ts:104`), then verifies the repo has **no uncommitted tracked Skill changes** (`git diff ... -- PROJECT_SKILL_ROOTS`, `git.ts:251-253`); otherwise it throws before any worktree is created.
3. It delegates the actual creation to `createWorktree(localRoot, managedRoot, baseOid, run, saveEvidence)` (`worktree-creation.ts:17`), passing a `run` wrapper that routes through `runGit` with the worktree-add deadline and the `move/remove` 5-minute deadline (`git.ts:342-346`).
4. `createWorktree` captures `WorktreeCreationEvidence` (root/parent/commonDir identities, gitDir, fingerprints — `ports.ts:274-286`) and calls `saveEvidence` after each durable step (`worktree-creation.ts:43,49,65,100,107`).
5. After a successful checkout, `createDetachedWorktree` copies the committed Skills into the new worktree via `projectSkills.carry(skills, managedRoot)` (`project-skills.ts:125`).
6. The module persists the evidence through `dependencies.registry` (`saveCreationEvidence`, `session-checkout-module.ts:487-496`).

### Registry read/write (safe-file crash recovery)

- `AtomicJsonCheckoutRegistry.read()` (`registry.ts:400`) calls `readJsonFileSafe` (`safe-file.ts:113`): primary file → newest parseable `.tmp` (promoted) → `.bak` (restored). A v1 file is migrated (`migrateLegacyRegistry`, `registry.ts:339`). A present-but-corrupt file throws `registry_corrupt`.
- `AtomicJsonCheckoutRegistry.write()` (`registry.ts:412`) calls `writeJsonFileAtomic` (`safe-file.ts:82`): backup `.bak`, write `<file>.<pid>.<uuid>.tmp`, atomic `rename`. A crash thus leaves either the old primary, a `.bak`, or a recoverable `.tmp` — never a truncated primary. Covered by `tests/adapters-safe-file.test.ts`.

### Lookup resolution (host services)

- `getSession` (`lookup.ts:134`) scans the `workspaceRegistry` projection first; a cleaned delivered Session that Harness filtered out of `workspace.sessionIds` is recovered through `liveHeaderCwd` against exactly one matching workspace. Verified in `tests/lookup.test.ts` (the "recovers a filtered live Session" case at lines 51-63).
- `getSidebarMemberships` (`lookup.ts:87`) additionally pulls live session headers from `ctx.get('sessionQuery').listSessions()` so cold/cleaned sessions still contribute navigation identity without granting `getSession` authority.

### Git command path (subprocess hardening)

Every Git operation flows `port method → runGitChecked/runGit` (`git.ts:93`). `runGit` injects `--no-optional-locks`, the empty `core.hooksPath` (`options.hooksPath` from `index.ts:366`), `core.quotePath=false`, `core.fsmonitor=false`, `GIT_TERMINAL_PROMPT=0`, `LC_ALL=C`, and scrubs ambient `GIT_DIR/WORK_TREE/...` env so repository routing comes only from the authorized `cwd` (`git.ts:121-131`). The timeout is chosen by `gitTimeoutMs` (`git-options.ts:21`). Interactive CAS for `update-ref`/`commit-tree` uses the `GitCommitProtocol` input path (`git.ts:136-153`).

### Project-skill carry (provenance-checked copy)

- `ProjectSkillStore.snapshot(source)` hashes every skill file (`project-skills.ts:74-98`); `carry(snapshot, target)` writes an exclusive `wx` manifest then materializes dirs/files, re-verifying content hashes, and finally publishes the `.ready` manifest via atomic rename (`125-167`).
- On worktree removal, `git.ts:removeWorktree` calls `projectSkills.assertRemovable(managedRoot, trackedSkillPaths(index, head))` (`project-skills.ts:204`); if any carried Skill was modified, removal throws rather than destroying user content.
- `ClaudeProjectSkillProvider` (`project-skill-provider.ts:48`) layers `.claude/skills` discovery on top of native `.dsh/.agents` discovery; `managedSkillRoot(registry)` (`22`) only resolves a `cwd` to a `ready` managed checkout whose `.git`/backlink chain matches the registry record.

### Working-directory move (optional host service)

- `tools.ts` calls `createSessionWorkingDirectoryPort(ctx)` once (`tools.ts:99`) and uses `enterCheckout`/`leaveCheckoutBeforeRemoval` (`tools.ts:76-91`, `51-66`). For `worktree_create` the Session is moved into the new `managedRoot`; for `worktree_deliver`/`worktree_cleanup` it is moved back to `localRoot` *before* the checkout is removed (the removal aborts if the move fails). When the host lacks the `workingDirectory` service, `enter`/`leave`/`current` all resolve `undefined` and the tool layer keeps its guidance-only behavior (`working-directory.ts:80-99`). Verified in `tests/working-directory-adapter.test.ts`.

## Connections

- [[ports]] — the `SessionCheckoutFilesPort`, `SessionCheckoutGitPort`, `SessionCheckoutRegistryPort`, `SessionCheckoutLookupPort` interfaces these adapters implement (`src/ports.ts`).
- [[session-checkout-module]] — the domain state machine that consumes every adapter; adapters are wired in `src/index.ts` `apply()` (`src/session-checkout-module.ts`, `src/index.ts:358-409`).
- [[session-checkout-apply]] — `createSessionCheckoutApplyEngine` shares the `ProjectSkillStore` singleton (constructed in `index.ts:376`).
- [[tools]] — `src/tools.ts` consumes `createSessionWorkingDirectoryPort` and the module; `enterCheckout`/`leaveCheckoutBeforeRemoval` gate cwd moves around checkout creation/removal.
- [[creation-failure]] — `WorktreeCreationFailure` (`src/creation-failure.ts`) is thrown by `createWorktree` (`worktree-creation.ts:17`) and converted by the module's `finishFailedCreation` (`session-checkout-module.ts:498-521`).
- [[types]] — `WorktreeCreationEvidence`, `DirectoryIdentity`, `ManagedCheckoutsRegistry`, `GitCheckoutSnapshot` record shapes consumed/produced here (`src/types.ts`, `src/ports.ts`).
- [[index]] — plugin entry; mounts the adapters, registers tools, the `/worktree` command, the session-target context, and the startup `reconcile`/retention timers (`src/index.ts`).
- [[concurrent-session-guard]] — `git.branchCreationTimes` / `listLiveSessions` feed the concurrent branch-race guard used by `runtimeContext`.

## Known Issues

- **No cross-process file lock in `safe-file.ts`.** `writeJsonFileAtomic` (`safe-file.ts:82`) relies on a unique per-process tmp + atomic `rename`; the comment at `safe-file.ts:79-80` notes last-writer-wins at the file level. Strong consistency would need an explicit lock file (not yet implemented).
- **`git.ts` divergence from the official worktree service.** The adapter cannot wrap git in `sandbox.confine` because a managed checkout lives *outside* the session workspace (the `worktreesRoot` is a sibling tree); doing so would deny the very directory being created. Session file-policy enforcement is intentionally left to the Host's own file/shell tools. See the header note at `git.ts:15-23`.
- **Worktree creation never uses force as deletion authority.** `createWorktree` (`worktree-creation.ts:17`) will *preserve* residue on any unconfirmed/unknown/modified/initializing/metadata-mismatch condition rather than `worktree remove --force`. Rollback (`rolledBack:true`) only happens when identity is provably unchanged and the tree is exclusively claimed. This is a deliberate safety property, not a bug; `tests/worktree-creation.test.ts:54-77` asserts every such case leaves the residue untouched.
- **`migrateLegacyRegistry` only converts v1 → v2.** A v1 managed-checkout record's phase other than `ready`/`discarded` becomes `recovery_required` and its `revision` is bumped (`registry.ts:365-386`); some v1 fields (e.g. `sessionBranch`, `sessionTopic`) are not reconstructed, so adopted records fall back to detached-HEAD delivery in the domain module.
- **`lookup.getSession` requires exactly one matching workspace.** When a live header `cwd` matches more than one workspace, `getSession` deliberately returns `undefined` rather than guessing (`lookup.ts:148-150`); the sidebar path (`getSidebarMemberships`) still includes those sessions as navigation identity (`tests/lookup.test.ts:65-82`, the "ambiguous" case).
- **Project-skill provider is an *additional* source only.** `ClaudeProjectSkillProvider` (`project-skill-provider.ts:48`) does not replace native `.dsh`/`.agents` discovery; it is registered alongside it and ranks below them (`rank:250`, `project-skill-provider.ts:91`). Native precedence is asserted in `tests/project-skill-provider.test.ts:43-56`.
- **`working-directory` is a no-op on hosts without the service.** When `ctx.get('workingDirectory')` is absent (or the Context has no `get`), `enter`/`leave`/`current` return `undefined` (`working-directory.ts:62-99`). The model-facing `cwd`/`cwdSelected` fields in `tools.ts` then report no cwd was selected. This is expected degradation, not a defect.
- **Initial-commit identity is fixed for abandoned snapshots.** `snapshotAbandonedWorktree` (`git.ts:741-761`) commits with `user.name=dsh-git-worktree` / `user.email=dsh-git-worktree@localhost` and does not reuse the user's git identity, by design (so a snapshot can always be created regardless of `user.useConfigOnly` config).
