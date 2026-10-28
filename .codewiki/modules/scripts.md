---
title: scripts
type: module
source_files:
  - scripts/check-publish.mjs
  - scripts/check-workspace-sidebar-version.mjs
  - scripts/clean-lib.mjs
  - scripts/dev-dsh.mjs
  - scripts/dev-dsh-lib.mjs
  - scripts/dsh-source-runner.mjs
  - scripts/workspace-sidebar-upstream.mjs
  - scripts/workspace-sidebar-upstream-next.mjs
  - scripts/workspace-sidebar-upstream-alpha.mjs
  - scripts/workspace-sidebar-upstream.d.mts
  - tests/dev-dsh.test.ts
  - tests/official-workspace-client.mock.ts
  - tests/official-workspace-client-next.mock.ts
  - tests/official-workspace-client-alpha.mock.ts
  - package.json
  - tsdown.config.ts
  - vitest.config.ts
  - cordis.patch.yml
tags: [scripts, dev-workflow, publish-gate, sidebar-derivation, build]
---

## Overview

The `scripts/` directory contains the pure-Node build-time and development-time tooling for the `dsh-git-worktree` package. None of these files ship to the published tarball's runtime — they are invoked by the npm `scripts` block (see `package.json` lines 70–83), the `tsdown.config.ts` bundler, and `vitest.config.ts`. They fall into three functional groups:

1. **Pre-publish integrity gates** — `check-publish.mjs` and `check-workspace-sidebar-version.mjs` validate the package before `pnpm publish`. These are wired to `check:publish`, `check:publish:release` and `check:sidebar-version` (package.json 75–77), and `prepublishOnly` runs all of them (package.json 82).
2. **Local dev harness** — `dev-dsh.mjs` (CLI entry), `dev-dsh-lib.mjs` (all logic, ~548 lines, fully unit-tested in `tests/dev-dsh.test.ts`), and `dsh-source-runner.mjs` (a small bridge that runs a Harness source checkout's CLI against the fixture). These implement the `dev:dsh`, `dev:dsh:install`, `dev:dsh:smoke`, `dev:dsh:remove` npm scripts (package.json 78–81).
3. **Official Workspace Client derivation** — `workspace-sidebar-upstream.mjs`, `workspace-sidebar-upstream-next.mjs`, `workspace-sidebar-upstream-alpha.mjs` and the type shim `workspace-sidebar-upstream.d.mts`. These read the *pinned* official `@deepseek-ai/dsh-client-ui-workspace` (and its `-next` / `-alpha` aliases, see package.json 120–122) source, gate it by version + SHA-256, inject managed-worktree presentation/control changes, and hand the derived module back to `tsdown.config.ts` via virtual module IDs (`virtual:dsh-official-workspace-client[-next|-alpha]`).

Additionally `clean-lib.mjs` is a one-liner run at the start of `pnpm run build` (package.json 71) that wipes `lib/` so removed source files cannot leak stale output into a tarball.

A central theme across these scripts is **fail-closed gating**: every upstream seam replacement (`replaceExactlyOnce`) throws if the official source has drifted, and every publish check `process.exit(1)`s rather than silently passing.
## Key Components

### scripts/clean-lib.mjs

| Symbol | Kind | Line | Purpose |
| --- | --- | --- | --- |
| (top-level) | side-effect | 1–7 | On import, calls `rmSync` on `../lib/` with `{ recursive: true, force: true }`. The comment at lines 4–6 explains TypeScript does not delete outputs for removed source files, so the publishable tree must always be rebuilt from an empty `lib/`. |

### scripts/check-workspace-sidebar-version.mjs

| Symbol | Kind | Line | Purpose |
| --- | --- | --- | --- |
| (top-level) | side-effect | 1–18 | Resolves `@deepseek-ai/dsh-client-locale/package.json` and asserts its `version` equals the exported `WORKSPACE_LOCALE_VERSION` (lines 11–14). Then calls `readOfficialWorkspaceClient()`, `readAlphaWorkspaceClient()`, `readNextWorkspaceClient()` and logs a combined SHA-256 + version gate summary (lines 15–18). |

### scripts/check-publish.mjs

This is a sequential integrity gate that runs 7 numbered checks and then `console.log('check-publish: all checks passed')` (line 256). All failures call the local `fail()` (line 16) which prints `check-publish: FAIL: …` and `process.exit(1)`.

| Symbol | Kind | Line | Purpose |
| --- | --- | --- | --- |
| `exportTargets(value, label)` | fn | 20–27 | Recursively flattens a package `exports` map entry into `{ condition, target }` pairs; a string value becomes `{ default }`, an object is traversed depth-first. |
| `includedByFiles(target)` | fn | 29–36 | Returns whether `target` is covered by `package.json` `files` (supports `./` prefix and directory prefixes ending `/`). |
| `fail(message)` / `ok(message)` | fn | 16–17 | Print FAIL / ok markers. |
| Check 1: host singleton packages | block | 38–65 | `hostSingletonPackages` (lines 39–53) must be `peerDependencies` + `devDependencies` but NOT `dependencies` (each checked at lines 54–64); otherwise a private copy would break Host service identity. |
| Check 2: Host bundle patch | block | 67–99 | Requires `manifest.dsh?.bundle?.patch` to exist, the referenced `cordis.patch.yml` to exist and be covered by `files`, to contain `- insert:` and `name: <manifest.name>`, and — via a dynamic import of `lib/workspace-provider-lifecycle.js` — to NOT export a retired `WORKSPACE_PROVIDER_CONDITION` (lines 85–88). Also forbids any client-evaluated `!!js` expression (line 88), patching the official `ui-workspace` entry (lines 89–91), and `dsh.client.inject` requesting the disabled official client (lines 93–95). |
| Check 3: every export exists + covered | block | 101–124 | Iterates `manifest.exports`, resolves each target relative to root, fails if it escapes the package, is missing, or is not in `files` (lines 105–115). Then asserts two removed acceptance-UI files are gone from `lib/` (lines 118–124). |
| Check 4: manual strict Typert artifacts | block | 126–157 | Forbids depending on `@deepseek-ai/dsh-typert-generator` (lines 127–129); imports `./typert` (`.TYPERT`) and `./remote` (`.default`) and asserts both carry the package identity and **share one descriptor array instance** (`hostContribution.invocations === remoteContribution.descriptors`, line 145). Validates every method's name against the `expectedRemoteMethods` list (line 146, 39 methods) and every descriptor's `namespace`/`service` (`gitWorktree`) plus Zod v4 strict codecs (lines 150–156). |
| Check 5: Host entry metadata | block | 159–165 | Asserts `exports["."].default` (or `main`) is a path, and that the Host entry exports `function apply` and `const inject`. |
| Check 6: Browser ToolView + ModuleLoader closure | block | 167–241 | Validates `dsh.client { platform: "web", inject: [...] }` and the required client packages (lines 168–182), then loads `./client` source into a `vm` sandbox with a fake `window.__ModuleLoader__.load` (lines 198–215). The factory must return `apply` + `inject`, must NOT statically inject `remoteAccess` (line 235), `remote.directoryPicker` (lines 237–238), `conversation` (line 239) or `connection` (line 240), and MUST inject `remote` (line 236). |
| Check 7: optional clean-tree gate | block | 243–254 | When `CHECK_PUBLISH_REQUIRE_CLEAN=1` or `--require-clean` is passed, runs `git status --porcelain --untracked-files=all` and fails if dirty (lines 245–251); otherwise defers. |

### scripts/dev-dsh-lib.mjs

This is the logic layer imported by `dev-dsh.mjs`. Every function is exported and most are exercised by `tests/dev-dsh.test.ts`.

| Symbol | Kind | Line | Purpose |
| --- | --- | --- | --- |
| `FIXTURE_MARKER` | const | 17 | File name `.dsh-git-worktree-fixture.json` used to identify managed disposable repos. |
| `FIXTURE_IDENTITY` | const | 18–21 | Frozen `{ owner: 'dsh-git-worktree', schemaVersion: 1 }` written into the marker. |
| `MODES` | const | 22 | `Set(['run', 'install', 'remove', 'smoke'])`. |
| `devCacheRoot(environment)` | fn | 25–29 | Returns `DSH_HOME/dev-dsh-cache` when `DSH_HOME` is set, else `os.tmpdir()/dsh-git-worktree-dev`. |
| `createDefaultOptions(projectRoot, cacheRoot, isolated)` | fn | 31–42 | Returns `{ projectRoot, cacheRoot, profile: 'web', port: 3081, repo }`; `repo` points at `<cache>/fixture` normally, or `<cache>/Documents/deepseek-harness/default-workspace` when `isolated`. |
| `parseDevDshArgs(argv, defaults)` | fn | 44–104 | Parses mode + `--profile` / `--repo` / `--port` / `--harness` (both `--x v` and `--x=v` forms), validates profile charset (line 93) and port range (via `parsePort`, lines 106–112). |
| `parsePort(value)` | fn | 106–112 | Coerces to int, rejects `<1` or `>65535`. |
| `normalizedRealPath(path)` | fn | 114–117 | `realpathSync` normalised to forward slashes; lower-cased on win32. |
| `git(cwd, args)` | fn | 119–121 | Thin `execFileSync('git', …)` wrapper. |
| `validateGitRoot(repoPath)` | fn | 123–133 | Ensures `repoPath` is a usable Git worktree and not nested inside another. |
| `ensureDevFixture(repoPath, options)` | fn | 139–205 | Creates/validates the disposable repo. Refuses symlinks (line 141), explicit repos are read-only + `validateGitRoot` (lines 145–151), default path requires the marker or an empty dir (lines 153–178), and on init writes marker + `tracked.txt` + initial commit (lines 180–190). Final assertion: clean tree and exactly 1 linked worktree (lines 192–204). Returns `{ path, created, managed }`. |
| `isHarnessRoot(path)` / `isHarnessSourceReady(path)` | fn | 207–215 | `isHarnessRoot` requires `package.json` + `apps/cli/src/bin.ts`; `isHarnessSourceReady` additionally requires `node_modules/tsx/package.json`. |
| `discoverHarnessRoot(projectRoot, environment)` | fn | 217–239 | Uses `DSH_HARNESS_ROOT` if set (validated, lines 218–224); otherwise walks the Git common-dir parent for `deepseek-harness` / `DeepSeek/deepseek-harness` candidates (lines 225–238) and prefers a source-ready checkout. |
| `executable(name, platform)` | fn | 241–243 | Returns `${name}.cmd` on win32, else `name`. |
| `createDshInvocation(options)` | fn | 245–282 | If no `harnessRoot`, returns `{ command: 'dsh', args, cwd, source: false }` (lines 249–254). With a harness root, validates it and returns a `pnpm --dir <harness> exec node --import tsx/esm <scripts/dsh-source-runner.mjs> <cwd> <apps/cli/src/bin.ts> …` invocation (lines 269–281, `source: true`). |
| `createDshLaunch(options)` | fn | 284–297 | Wraps `createDshInvocation` with `--profile`, optional `--patch` + `--no-open` and `--port` args. |
| `prepareIsolatedWorkspacePatch(cacheRoot)` | fn | 300–306 | Writes `<cache>/workspace-isolation.patch.yml` setting the Host `workspace-controller` `documentsDirectory` to `<cache>/Documents`. |
| `assertWindowsCommandSafe(command, args)` | fn | 308–314 | Rejects shell metacharacters on Windows. |
| `runProcess(command, args, options)` | fn | 316–336 | Cross-platform `spawnSync`; wraps `cmd.exe /d /v:off /c` on win32 (lines 319–323); `capture: true` returns stdout instead of inheriting stdio. |
| `copyPackageEntry(source, destination)` | fn | 338–351 | Recursive copy for packaging; refuses symlinks (line 340) and non-file/non-dir entries. |
| `dshHomeOf(options)` | fn | 353–355 | Resolves `options.environment.DSH_HOME` or `process.env.DSH_HOME` or `~/.dsh`. |
| `profileManifestOf(options)` | fn | 357–359 | Path to `<dshHome>/profiles/<profile>/package.json`. |
| `archiveReferenceFromManifest(manifestPath, required)` | fn | 361–380 | Reads a profile manifest's `file:` dependency on `dsh-git-worktree`; returns the resolved archive path or `undefined` (unless `required`). |
| `profileArchiveReference(options)` | fn | 382–384 | `archiveReferenceFromManifest(profileManifestOf(options), true)`. |
| `comparablePath(path)` | fn | 386–389 | Normalised + lower-cased (win32) absolute path. |
| `referencedProfileArchives(options)` | fn | 391–407 | Collects all `*.tgz` archive paths referenced by every profile manifest. |
| `cleanSupersededArchives(cacheRoot, keepPath, options)` | fn | 409–417 | Deletes `dsh-git-worktree-<n>.tgz` in `cacheRoot` that are not referenced by any profile and not `keepPath`. |
| `repairMissingCurrentProfileArchive(options, archivePath)` | fn | 419–428 | If the current profile references a missing managed archive, copies the new snapshot into that path instead of failing. |
| `assertDshRuntimeAvailable(options)` | fn | 430–449 | Ensures either a valid harness root or an installed `dsh --version` is reachable. |
| `runDsh(options, args, runOptions)` | fn | 451–463 | Builds a DSH invocation via `createDshInvocation` and runs it (honouring injected `options.run`). |
| `installLocalSnapshot(options)` | fn | 466–528 | Builds (`typecheck` + `build`), packs a `<name>-dev.<ts>.tgz` (staged with `scripts: {}` and selected `files`, lines 486–500), ensures the profile is initialized via `--dump-config`, repairs + `plugin add`s the snapshot, asserts the profile now references the new archive, and cleans superseded archives. Returns `{ archivePath, dumpConfig }`. |
| `removeLocalSnapshot(options)` | fn | 530–538 | `plugin remove dsh-git-worktree` then deletes all `*.tgz` under `cacheRoot`. |
| `smokeLocalSnapshot(options)` | fn | 540–547 | Runs `--dump-config` and asserts `dsh-git-worktree` is composed; returns the dump. |

### scripts/dev-dsh.mjs

| Symbol | Kind | Line | Purpose |
| --- | --- | --- | --- |
| `printUsage()` | fn | 26–44 | Prints the usage banner for `--help`/`-h`. |
| (main try block) | side-effect | 46–98 | Resolves `projectRoot` (line 19), `cacheRoot = devCacheRoot()` (line 20), and `defaults` with `discoverHarnessRoot` (lines 21–24). Then dispatches by parsed mode: `install` (57–63), `smoke` (64–66), `remove` (67–69), or the default `run` (70–93) which installs a snapshot, `ensureDevFixture`s the repo, builds a `createDshLaunch` (with `prepareIsolatedWorkspacePatch` when `DSH_HOME` is set, lines 84–85), and `runProcess`es the DSH launch. Catches errors at lines 95–98. |

### scripts/dsh-source-runner.mjs

| Symbol | Kind | Line | Purpose |
| --- | --- | --- | --- |
| (top-level) | side-effect | 1–20 | Expects `<workspaceRoot> <cliEntry> [...args]`. It `process.chdir(workspaceRoot)` (line 12) so freshly created DSH Sessions use the fixture, rewrites `process.argv` (line 13), dynamically imports `cliEntry`, and awaits its exported `runCli()` (lines 17–20). Recent Harness CLIs guard their entry with `import.meta.main`, so this runner lets the imported module stay non-main while still invoking `runCli`. |

### scripts/workspace-sidebar-upstream.mjs

| Symbol | Kind | Line | Purpose |
| --- | --- | --- | --- |
| `WORKSPACE_UI_VERSION` | const | 5 | `'0.2.1-rc.4'` — the gated official Client version. |
| `WORKSPACE_LOCALE_VERSION` | const | 6 | `'0.2.1-rc.4'` — the gated locale package version. |
| `WORKSPACE_CLIENT_SHA256` | const | 7 | Expected SHA-256 of the official `client` module. |
| `OFFICIAL_WORKSPACE_VIRTUAL_ID` | const | 8 | `'virtual:dsh-official-workspace-client'`. |
| `RESOLVED_OFFICIAL_WORKSPACE_VIRTUAL_ID` | const | 9 | `'\0' + OFFICIAL_WORKSPACE_VIRTUAL_ID` (null-prefixed virtual id used by `tsdown.config.ts`). |
| `readOfficialWorkspaceClient()` | fn | 11–25 | Resolves `@deepseek-ai/dsh-client-ui-workspace`, asserts its `version`, reads `client`, and asserts its `SHA-256` against `WORKSPACE_CLIENT_SHA256`. Returns `{ source, clientPath }`. |
| `replaceExactlyOnce(source, needle, replacement, label)` | fn | 27–34 | Replaces a single occurrence; throws if the seam is absent or appears more than once (fail-closed against upstream drift). |
| `replaceIfPresent(source, needle, replacement, label)` | fn | 38–42 | Like `replaceExactlyOnce` but a no-op (keeping `source`) when the optional seam is absent; honours `WT_DEBUG_SEAMS` debug logging. |
| `decorateOfficialWorkspaceClient(source)` | fn | 49–174 | Applies a long, exact sequence of source-text patches: instance-local managed guard (lines 53–56), managed `forkSession`/workspace shortcut blocks (57–64), zh/en locale tables (65–72), managed metadata on group/session/search nodes (73–88), modern session decorations + `ManagedWorktreeIdentity`/`managedWorktreeDecoration` helpers (89–156), managed session menu filtering (157–160), and finally exports `WorkspaceBrowser` (169–172). Returns the derived source string. |
| `materializeOfficialWorkspaceClientModule()` | fn | 176–209 | Calls `readOfficialWorkspaceClient()` + `decorateOfficialWorkspaceClient()`, then extracts the `factory: (require) => { … }` body (lines 179–185) and wraps it in an ESM module that maps the official `require` specifiers to real imports (`@deepseek-ai/cordis`, `@deepseek-ai/dsh-client-store`, `react/jsx-runtime`, `react`, `@deepseek-ai/dsh-client-ui-primitives`) and re-exports `apply`, `inject`, `WorkspaceBrowser`. |

### scripts/workspace-sidebar-upstream-next.mjs

| Symbol | Kind | Line | Purpose |
| --- | --- | --- | --- |
| `NEXT_WORKSPACE_VERSION` / `NEXT_WORKSPACE_SHA256` | const | 5–6 | `'0.1.7-rc.2'` + expected SHA-256 of the `-next` alias source. |
| `NEXT_WORKSPACE_VIRTUAL_ID` / `RESOLVED_NEXT_WORKSPACE_VIRTUAL_ID` | const | 7–8 | `'virtual:dsh-official-workspace-client-next'` + null-prefixed form. |
| `readNextWorkspaceClient()` | fn | 10–21 | Resolves `@deepseek-ai/dsh-client-ui-workspace-next`, asserts `packageJson.name === '@deepseek-ai/dsh-client-ui-workspace'` (aliased) and version, and hashes `client`. |
| `once(source, needle, replacement, label)` | fn | 23–29 | Local single-occurrence replacer (same contract as `replaceExactlyOnce`). |
| `decorateNextWorkspaceClient(source)` | fn | 32–95 | Patches the next-line official Client: protected workspace group/row (35–44), instance-local managed guard (47–51), managed `forkSession` + workspace shortcut (52–61), managed Session metadata (62–66), and ProjectRow/SessionNode managed-owner guards, drag/start/menu controls and branch decoration + status badge (67–93). |
| `materializeNextWorkspaceClientModule()` | fn | 97–99 | `materializeWorkspaceFactory(decorateNextWorkspaceClient(readNextWorkspaceClient()))`. |
| `materializeWorkspaceFactory(source)` | fn | 102–130 | Shared extractor (also used by the alpha module) that pulls the `factory: (require) => { … }` body and re-exports `apply`/`inject` (no `WorkspaceBrowser`). |

### scripts/workspace-sidebar-upstream-alpha.mjs

| Symbol | Kind | Line | Purpose |
| --- | --- | --- | --- |
| `ALPHA_WORKSPACE_VERSION` / `ALPHA_WORKSPACE_SHA256` | const | 6–7 | `'0.1.6-alpha.2'` + expected SHA-256 of the `-alpha` alias source. |
| `ALPHA_WORKSPACE_VIRTUAL_ID` / `RESOLVED_ALPHA_WORKSPACE_VIRTUAL_ID` | const | 8–9 | `'virtual:dsh-official-workspace-client-alpha'` + null-prefixed form. |
| `readAlphaWorkspaceClient()` | fn | 11–22 | Resolves `@deepseek-ai/dsh-client-ui-workspace-alpha`, asserts name + version + SHA-256. |
| `once(source, needle, replacement, label)` | fn | 24–30 | Local single-occurrence replacer. |
| `decorateAlphaWorkspaceClient(source)` | fn | 33–100 | Same family of patches as the next module, but `forkSession` guards before `AbortSignal.any` (line 54), uses `IconBranchOutline16` (line 91), `onRename/onFork/onArchive` signature (line 78) and `row.hasActiveSchedule`/`ActiveScheduleIndicator` seam (line 95); disables unsafe managed-owner row mutations. |
| `materializeAlphaWorkspaceClientModule()` | fn | 102–104 | `materializeWorkspaceFactory(decorateAlphaWorkspaceClient(readAlphaWorkspaceClient()))`. |

### scripts/workspace-sidebar-upstream.d.mts

Type-only shim mirroring the public surface of `workspace-sidebar-upstream.mjs`, consumed by the TS bundler:

| Symbol | Kind | Line |
| --- | --- | --- |
| `WORKSPACE_UI_VERSION` | const string | 1 |
| `WORKSPACE_LOCALE_VERSION` | const string | 2 |
| `WORKSPACE_CLIENT_SHA256` | const string | 3 |
| `OFFICIAL_WORKSPACE_VIRTUAL_ID` | const string | 4 |
| `RESOLVED_OFFICIAL_WORKSPACE_VIRTUAL_ID` | const string | 5 |
| `readOfficialWorkspaceClient()` | fn → `{ source; clientPath }` | 6 |
| `decorateOfficialWorkspaceClient(source)` | fn → string | 7 |
| `materializeOfficialWorkspaceClientModule()` | fn → string | 8 |

### tests/dev-dsh.test.ts

`tests/dev-dsh.test.ts` (lines 1–522) is the only test file exercising the `scripts/` tooling directly. It imports the exported functions from `../scripts/dev-dsh-lib.mjs` (lines 8–21) and covers: default option selection (46–57), `devCacheRoot` isolation (59–63), isolated Workspace patch (65–82), explicit option parsing (84–103), `dsh-source-runner.mjs` cwd + argv preservation (105–114), source-checkout launch plan (116–138), pinned pnpm selection (140–149), `runProcess` forwarding (151–153), harness discovery precedence (155–179), unprepared-source failure (181–192), bad port/option rejection (194–199), fixture creation/occupancy (201–235), local snapshot install command shape (237–294), first-profile initialization (296–337), source-CLI install/smoke/remove (339–388), multi-profile archive preservation (390–435), missing-archive repair (437–481), and stale-profile failure (483–520).

## Architecture

The scripts form three independent tool pipelines that touch the repository at build, dev and publish time. The box diagram below shows the components (file + key symbol) and how they connect; the dashed boundary marks what `tsdown.config.ts`/`vitest.config.ts` consume.

```text
┌──────────────────────── package.json (npm scripts 70-83) ────────────────────────┐
│                                                                                   │
│  build:  clean-lib.mjs ──► tsc ──► tsdown.config.ts                                │
│                              │              │                                     │
│                              │   import     │  resolveId/load virtual ids          │
│                              ▼              ▼                                      │
│              workspace-sidebar-upstream*.mjs  (read+decorate+materialize)          │
│                              │              │                                     │
│                              │  materializeXxxModule()                            │
│                              ▼              ▼                                      │
│              lib/client.js  ◄── official @deepseek-ai/dsh-client-ui-workspace      │
│                                                                                   │
│  dev:dsh:  dev-dsh.mjs ──► dev-dsh-lib.mjs ──► dsh-source-runner.mjs ──► dsh CLI   │
│              │                (installLocalSnapshot, ensureDevFixture, …)          │
│              ▼                                                                     │
│          ~/.dsh / tmp dev-dsh-cache (snapshots, profiles)                          │
│                                                                                   │
│  check:publish / check:sidebar-version:                                           │
│      check-publish.mjs  ── package.json + lib/*.js + cordis.patch.yml             │
│      check-workspace-sidebar-version.mjs ── workspace-sidebar-upstream*.mjs       │
└───────────────────────────────────────────────────────────────────────────────────┘
        │                                          │
        ▼ (tests)                                 ▼ (resolve alias)
  tests/dev-dsh.test.ts            vitest.config.ts ── tests/official-workspace-client*.mock.ts
```

Component inventory (file → role):

- `scripts/clean-lib.mjs` → wipes `lib/` before every build.
- `scripts/workspace-sidebar-upstream.mjs` / `-next.mjs` / `-alpha.mjs` → gated upstream derivation; consumed by `tsdown.config.ts` through the three `virtual:dsh-official-workspace-client*` ids (resolved at lines 42–53).
- `scripts/dev-dsh.mjs` → CLI entry; delegates all logic to `dev-dsh-lib.mjs`.
- `scripts/dev-dsh-lib.mjs` → snapshot build/pack/install, fixture management, harness discovery, process running.
- `scripts/dsh-source-runner.mjs` → chdir + `runCli()` bridge for Harness source checkouts.
- `scripts/check-publish.mjs` → 7-step release gate.
- `scripts/check-workspace-sidebar-version.mjs` → version/locale/SHA-256 gate.
- `tests/dev-dsh.test.ts` → unit coverage of `dev-dsh-lib.mjs`.

## Data Flow

### Local dev snapshot flow (`dev:dsh run`)
1. `dev-dsh.mjs` resolves `projectRoot`, `devCacheRoot()` and `discoverHarnessRoot()` → `defaults` (lines 19–24).
2. `parseDevDshArgs(process.argv.slice(2), defaults)` (line 51) returns mode/options.
3. For `run`: `installLocalSnapshot({ …, cacheRoot })` (lines 71–74) → builds, packs `dsh-git-worktree-<ts>.tgz`, ensures profile init via `--dump-config`, repairs/adds the snapshot, cleans superseded archives (returns `{ archivePath, dumpConfig }`).
4. `ensureDevFixture(options.repo, { explicit })` (line 75) creates/validates the disposable Git repo (marker-protected).
5. If `DSH_HOME` is set, `prepareIsolatedWorkspacePatch(cacheRoot)` (line 84) writes `workspace-isolation.patch.yml` and `createDshLaunch` adds `--patch`/`--no-open` (lines 78–85).
6. `runProcess(launch.command, launch.args, { cwd: launch.cwd })` (line 92) either runs the installed `dsh` binary or, with a harness root, the `pnpm --dir <harness> exec node --import tsx/esm scripts/dsh-source-runner.mjs <cwd> <harness>/apps/cli/src/bin.ts …` chain.

### Official Workspace Client derivation flow (build time)
1. `tsdown.config.ts` plugin `resolveId` maps `virtual:dsh-official-workspace-client[-next|-alpha]` → the `\0`-prefixed id (lines 42–45).
2. On `load`, it calls `materializeOfficialWorkspaceClientModule()` / `materializeNextWorkspaceClientModule()` / `materializeAlphaWorkspaceClientModule()` (lines 49–51).
3. Each materialize fn → `readXxxWorkspaceClient()` resolves the pinned `@deepseek-ai/dsh-client-ui-workspace[-next|-alpha]` package, asserts its `version` + `SHA-256`, then `decorateXxxWorkspaceClient(source)` performs exact source-text patches.
4. `materializeWorkspaceFactory(source)` / the official module's own extractor slices the `factory: (require) => { … }` body (lines 179–185 / 102–107) and wraps it in an ESM module that maps the official `require` specifiers to real imports; the official variant additionally re-exports `WorkspaceBrowser` (line 171, 207).
5. The derived string becomes the virtual module content fed into the `lib/client.js` bundle.

### Publish gate flow (`prepublishOnly`)
`pnpm run check:sidebar-version` → `check-workspace-sidebar-version.mjs` (re-checks version + SHA-256) → `pnpm run build` → `pnpm run check:publish:release` (`check-publish.mjs --require-clean`, 7 checks) → `pnpm run test` (`vitest run`). `check-publish.mjs` reads `package.json`, dynamically imports `lib/workspace-provider-lifecycle.js` (line 86) and the built `./typert` / `./remote` / `./client` artifacts, and `vm`-runs `./client` to validate the ModuleLoader closure.

## Connections

- **[[package.json]]** — owns the npm `scripts` that invoke every file here (`build` line 71, `check:sidebar-version` 75, `check:publish` 76, `check:publish:release` 77, `dev:dsh*` 78–81, `prepublishOnly` 82) and declares the pinned official Client aliases (`@deepseek-ai/dsh-client-ui-workspace[-next|-alpha]`, lines 120–122) that the derivation scripts read.
- **[[tsdown.config.ts]]** — the bundler that imports `materialize*WorkspaceClientModule` and wires the three `virtual:dsh-official-workspace-client*` ids (`resolveId`/`load`, lines 40–54); the derivation scripts are silent unless something calls them here.
- **[[vitest.config.ts]]** — resolves the same virtual ids to `tests/official-workspace-client*.mock.ts` in tests (lines 10–18), so the real derivation is only exercised in the build, not in `vitest run`.
- **[[cordis.patch.yml]]** — produced by `src/` and validated by Check 2 of `check-publish.mjs` (lines 67–99); the file's header comment (2026-10-17) explains the Host-side election that the publish gate enforces no `!!js` expression (lines 85–91).
- **[[lib/workspace-provider-lifecycle.js]]** — `check-publish.mjs` dynamically imports it (line 86) to confirm the retired `WORKSPACE_PROVIDER_CONDITION` export is gone; this is the Host-side lifecycle that took over the Workspace election.
- **[[tests/dev-dsh.test.ts]]** — the only unit-coverage article for the scripts; pins the exact behaviour of `dev-dsh-lib.mjs` and the `dsh-source-runner.mjs` bridge.
- **[[tests/official-workspace-client.mock.ts]]** / **[[tests/official-workspace-client-next.mock.ts]]** / **[[tests/official-workspace-client-alpha.mock.ts]]** — the test-side stand-ins for the derived virtual modules.

## Known Issues

- **`check-publish.mjs` is a release-time gate only.** It is run by `prepublishOnly` (package.json 82) and `check:publish:release`; a plain `pnpm run build` never invokes it, so a stale `lib/` client bundle (e.g. statically injecting `remoteAccess`) would only be caught at publish time, not during local dev. The script itself documents this deferral at lines 243–254 (`requireClean` gated behind `CHECK_PUBLISH_REQUIRE_CLEAN`).
- **Official Client derivation is brittle by design.** Every patch in `decorateOfficialWorkspaceClient` / `decorateNextWorkspaceClient` / `decorateAlphaWorkspaceClient` uses exact string seams (`replaceExactlyOnce`, `once`). Any upstream release of `@deepseek-ai/dsh-client-ui-workspace` changes the source, the `SHA-256`/`version` constants (lines 5–7 / 5–6 / 6–7) no longer match, and `readXxxWorkspaceClient()` throws. The patch seam (e.g. the `IconBranchOutlineRegular` vs `IconBranchOutline16` difference at `workspace-sidebar-upstream.mjs:27` vs `…alpha.mjs:91`) and the `forkSession`/`SessionNodeItem` signatures (alpha uses `onRename/onFork/onArchive` at line 78, next uses `onCreate` at line 68) must be kept in lockstep with each pinned version. `check-workspace-sidebar-version.mjs` is the early-warning gate for this drift (lines 11–18).
- **`clean-lib.mjs` deletes without confirmation.** It `rmSync`s `../lib` recursively (lines 1–7); because `tsdown.config.ts` runs with `clean: false` (line 28), the pre-build wipe in `package.json` line 71 is what guarantees a clean tree. If invoked directly with a wrong CWD the target is still `../lib` relative to the script, so it only ever hits the repo-local `lib/`.
- **`dev-dsh-lib.mjs` isolates archives by naming convention.** `cleanSupersededArchives` / `removal` match `^dsh-git-worktree-\d+\.tgz$` (lines 413, 535). A profile whose manifest records a `file:` dependency outside `<cacheRoot>` with a non-matching name is treated as "outside the managed cache" and `repairMissingCurrentProfileArchive` throws (lines 422–426) rather than silently repairing.
- **Windows command safety.** `runProcess` only asserts metacharacter safety when `process.platform === 'win32'` (lines 308–323); on non-Windows it passes args straight to `spawnSync`, relying on `spawn` (not `shell`) to avoid injection.
- **`check-publish.mjs` Check 6 hard-codes the allowed browser-require set.** `allowedBrowserRequires` (lines 187–193) is an explicit allow-list (`react`, `react/jsx-runtime`, `@deepseek-ai/dsh-client-ui-primitives`, `@deepseek-ai/cordis`, `@deepseek-ai/dsh-client-store`); any new `require()` in `lib/client.js` added outside that set fails the gate, which is intentional but means new client deps need the list updated here first.
