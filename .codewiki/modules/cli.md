---
title: cli
type: module
source_files:
  - src/commands.ts
  - src/tools.ts
  - src/index.ts
  - src/adapters/working-directory.ts
  - src/i18n/host.ts
  - src/i18n/host-messages.ts
  - tests/surface.test.ts
  - tests/working-directory-adapter.test.ts
  - src/console-remote/descriptors.ts
  - src/session-checkout-module.ts
tags: [cli, commands, tools, worktree, session-checkout, registration]
---

## Overview

The `cli` module is the plugin-facing command and tool registration surface for
session checkout. It does **not** implement the state machine; it only translates
user/model intents into calls on the `SessionCheckoutModule` (defined in
`src/index.ts`). There are two registration entry points, both wired from the
plugin `apply()` in `src/index.ts`:

- `registerTools(ctx, module)` — `src/tools.ts:94` — registers the model-facing
  `worktree_*` tools via the `@deepseek-ai/dsh-tools` `defineTool` helper. These
  are safe, model-callable tools that stop at *Ready for Review*; delivery is
  gated by the `autoDeliver` setting (see Known Issues).
- `registerWorktreeCommand(ctx, module)` — `src/commands.ts:44` — registers the
  single human `/worktree` command with verbs (`status`, `list`, `continue`,
  `next`, `finalize`, `finish`, `discard`, `remove`). Destructive verbs
  (finalize/finish/discard/remove) are intentionally human-initiated only.

Both surfaces share the same safety contract: before any operation that *may
delete the checkout* (finish/finalize/discard/remove/cleanup), the Session's
working directory is moved out of the worktree first; if that move fails the
removal is aborted so the Session never points at a deleted directory. This is
implemented in `src/tools.ts:51` (`leaveCheckoutBeforeRemoval`) and
`src/commands.ts:51` (`leaveCheckout`) for the tool/command sides respectively.

Both surfaces also enter the checkout (move the Session cwd into it) after a
create/next operation to reproduce the official `ctx.workingDirectory.set`
parity — `enterCheckout` at `src/tools.ts:76` and `src/commands.ts:62`.

## Key Components

### `src/commands.ts` — `/worktree` human command

- `targetText(target: SessionTargetView): string` — `src/commands.ts:16`. Builds
  the human-readable status block (checkout phase, dirty flag, current branch/oid,
  optional delivery state).
- `sessionIdOf(agent: unknown): string` — `src/commands.ts:26`. Reads
  `agent.session.id`; throws if not a string (only usable inside a DSH agent).
- `RETENTIONS` — `src/commands.ts:32`. `Set<WorktreeRetentionMode>` of the four
  valid retention modes: `cleanup`, `retain_24h`, `retain_3d`, `retain_manual`.
- `usage()` — `src/commands.ts:33`. Returns the `/worktree` usage hint string.
- `finishedText(result)` — `src/commands.ts:35`. Renders the result of a finished
  `operate` call, including auto-push outcome.
- `registerWorktreeCommand(ctx, module)` — `src/commands.ts:44`. Registers the
  `/worktree` command. The handler (`src/commands.ts:77`) tokenizes
  `invocation.rawInput` into a *verb* plus arguments and dispatches:
  - `status` (`src/commands.ts:84`) → `module.inspect(sessionId)`.
  - `list` (`src/commands.ts:87`) → `module.listManagedWorktreesForSession(sessionId)`.
  - `continue` (`src/commands.ts:97`) → requires `delivery.state === 'ready_for_review'`,
    then `module.resumeRevision(sessionId, current.revision, current.delivery.review.reviewId)`.
  - `next` (`src/commands.ts:110`) → `module.beginNextIteration(sessionId, current.revision)`,
    then `enterCheckout`.
  - `finalize` (`src/commands.ts:121`) — accepts an optional `reviewId revision
    retention` triple (or just `retention`); validates the review card is current
    via `expectedReviewId`/`parsedRevision`, leaves the checkout, then
    `module.operate({ action: 'finish', ... })`. On failure it re-enters the
    checkout.
  - `finish` (`src/commands.ts:160`) — takes a free-text commit message, leaves
    the checkout, then `module.operate({ action: 'finish', ... })` with the
    message from the human.
  - `discard` (`src/commands.ts:180`) — `module.operate({ action: 'discard', confirmDirty: true, ... })`,
    with `rollbackPreview: true` when `delivery.state === 'preview_active'`.
  - `remove` (`src/commands.ts:201`) — resolves a `checkoutId` from
    `listManagedWorktreesForSession`, leaves it, then
    `module.manageManagedWorktreeForSession(sessionId, { action: 'discard', ... })`.
  - default (`src/commands.ts:220`) → unknown-verb error.
- `leaveCheckout(agent, checkoutId)` — `src/commands.ts:51`. Resolves roots via
  `module.resolveRoots`, then `workingDirectory.leave`. Returns a non-null error
  reason if the cwd could not be restored (caller must abort removal).
- `enterCheckout(agent, checkoutId)` — `src/commands.ts:62`. Resolves the managed
  root via `module.resolveRoots` (or `module.resolveManagedRoot` fallback), then
  `workingDirectory.enter`. Best-effort; returns the cwd string or `undefined`.

### `src/tools.ts` — model-facing `worktree_*` tools

- `WORKTREE_RETENTION_VALUES` — `src/tools.ts:22`. The four valid retention
  values as a readonly tuple.
- `parseWorktreeRetention(value)` — `src/tools.ts:24`. Validates/normalizes a
  retention argument, defaulting to `DEFAULT_WORKTREE_RETENTION`; throws on invalid.
- `sessionIdOf(agent)` — `src/tools.ts:32`. Same guard as the command side,
  throws `worktreeToolsCanOnlyBeCalledInADSH`.
- `renderJson(value)` — `src/tools.ts:41`. Wraps a value as the tool's
  `{ type: 'text', text: JSON.stringify(value) }` output shape.
- `leaveCheckoutBeforeRemoval(port, module, agent, checkoutId)` —
  `src/tools.ts:51`. Mirrors the command-side `leaveCheckout`; returns a non-null
  reason if the cwd could not be restored.
- `enterCheckout(port, module, agent, checkoutId)` — `src/tools.ts:76`. Mirrors
  the command-side `enterCheckout` (ledger `resolveRoots` first, then the
  `resolveManagedRoot` validation fallback).
- `registerTools(ctx, module)` — `src/tools.ts:94`. Registers nine tools via
  `ctx.tools.register(defineTool({ ... }))`, each with `name`, `description`
  (from `hostRegistrationMessage`), `parameters`, an `output` schema, an
  `execute` body, and a `presentCall` card. The registered tools are:

| Tool name | Register line | Executes on `module` | Notes |
|---|---|---|---|
| `worktree_create` | `src/tools.ts:101` | `createIsolatedTarget(sourceSessionId, targetSessionId, { topic?, branch? })` | In-place creation: target = source session; enters the checkout (`src/tools.ts:140`). Reports `cwdSelected`/`cwd`. |
| `worktree_list` | `src/tools.ts:169` | `listManagedWorktreesForSession(sessionId)` | Omits `commitOid` when absent (`src/tools.ts:218`). |
| `worktree_resume_revision` | `src/tools.ts:227` | `resumeRevision(sessionId, current.revision, reviewId)` | Throws if delivery does not return to `working`. |
| `worktree_begin_next_iteration` | `src/tools.ts:274` | `beginNextIteration(sessionId, current.revision)` | Re-enters the recreated checkout (`src/tools.ts:297`). |
| `worktree_ready_for_review` | `src/tools.ts:319` | `markReadyForReview(sessionId, {...})` | Requires `summary`, `validationStatus` (enum), `tests`, `suggestedCommitMessage`. |
| `worktree_deliver` | `src/tools.ts:406` | `operate({ action: 'finish', ... })` | Refused unless `module.isAutoDeliverEnabled()` (`src/tools.ts:451`); only allowed in `working`/`ready_for_review`. |
| `worktree_cleanup` | `src/tools.ts:509` | `manageManagedWorktreeForSession(sessionId, { action: 'cleanup_retained' })` | Validates `checkoutId`/`expectedRevision`; leaves first. |
| `worktree_prune_branches` | `src/tools.ts:561` | `pruneMergedBranchesForSession(sessionId, { dryRun, olderThanDays })` | Safe `git branch -d` semantics. |
| `worktree_merge` | `src/tools.ts:631` | `mergeBranchForSession(sessionId, { sourceBranch, dryRun, direction })` | `direction` ∈ `forward`/`reverse`; `failed` type throws. |

### `src/adapters/working-directory.ts` — Session cwd port

- `WorkingDirectoryServiceLike` — `src/adapters/working-directory.ts:18`. Minimal
  structural view of the host `workingDirectory` service (`get`, optional
  `ensure`, `set`).
- `SessionWorkingDirectoryPort` — `src/adapters/working-directory.ts:27`. The
  port the tool/command layers use to move a Session cwd: `current`,
  `enter(agent, path)`, `leave(agent, path, fallback)`.
- `createSessionWorkingDirectoryPort(ctx)` — `src/adapters/working-directory.ts:61`.
  Resolves the service dynamically via `ctx.get('workingDirectory')`; degrades to
  `undefined` (no cwd move) on hosts without it. `enter` resolves the requested
  path (or `undefined` if no service), `leave` only restores when the Session is
  actually inside the checkout (`isWithin`, `src/adapters/working-directory.ts:104`).

### `src/index.ts` — wiring

- `registerTools`/`registerWorktreeCommand` are called from `apply()` at
  `src/index.ts:381` and `src/index.ts:408`, after `createSessionCheckoutModule`
  (which begins at `src/index.ts:381`).
- `inject` at `src/index.ts:253` declares `tools`, `commands`, `subprocess`,
  `loader` so cordis provisions the services the surfaces need.

## Architecture

```text
                Model / Human (Agent)
                          │
            ┌─────────────┴─────────────┐
            │                           │
   worktree_* tools (model)      /worktree command (human)
   src/tools.ts:94                src/commands.ts:44
            │                           │
            │  execute(handler)         │  handler(rawInput)
            │                           │
            ▼                           ▼
   parse args / sessionIdOf     tokenize verb + sessionIdOf
   leaveCheckoutBeforeRemoval   leaveCheckout / enterCheckout
   enterCheckout                (src/commands.ts:51,62)
   (src/tools.ts:51,76)
            │                           │
            └─────────┬─────────────────┘
                      │ SessionCheckoutModule
                      │ (src/index.ts:113)
                      ▼
        createIsolatedTarget / inspect / listManagedWorktreesForSession
        beginNextIteration / resumeRevision / markReadyForReview
        operate / manageManagedWorktreeForSession
        pruneMergedBranchesForSession / mergeBranchForSession
        resolveRoots / resolveManagedRoot / isAutoDeliverEnabled

   Session cwd safety via SessionWorkingDirectoryPort
   src/adapters/working-directory.ts:61 (ctx.get('workingDirectory'))
```

Both surfaces call the same module methods; the only structural difference is
that the command surface adds destructive verbs (`finish`, `discard`, `remove`)
and the tool surface adds bare `worktree_create` / `worktree_deliver` /
`worktree_cleanup` / `worktree_prune_branches` / `worktree_merge`. Delivery
(`worktree_deliver`) is the only model tool that commits/pushes/cleans, and it is
refused while `autoDeliver` is off (`src/tools.ts:8`).

## Data Flow

A representative flow for the model `worktree_deliver` tool (`src/tools.ts:447`):

1. `sessionIdOf(exec.agent)` resolves the caller's session id
   (`src/tools.ts:449`).
2. `module.inspect(sessionId)` reads the current target (`src/tools.ts:450`).
3. If `!module.isAutoDeliverEnabled()` throw `worktreeDeliverDisabledByAutoDeliver`
   (`src/tools.ts:451`). Otherwise require `delivery.state` to be `working` or
   `ready_for_review` (`src/tools.ts:455`).
4. If `ready_for_review`, pin `expectedReviewId` and default the commit message
   from `review.suggestedCommitMessage` (`src/tools.ts:460`).
5. `leaveCheckoutBeforeRemoval(...)` moves the Session out of the checkout; if it
   fails, throw and abort (`src/tools.ts:470`).
6. `module.operate({ sessionId, expectedRevision, action: 'finish', commitMessage, retention, ...expectedReviewId })` does the delivery (`src/tools.ts:474`).
7. On `status !== 'finished'`, `enterCheckout(...)` moves the Session back into the
   surviving checkout and throws (`src/tools.ts:486`).

The human `/worktree finalize` path (`src/commands.ts:121`) is analogous but
parses the `reviewId revision retention` triple from `rawInput`, validates the
review card has not expired (`src/commands.ts:133`), and renders via
`finishedText` (`src/commands.ts:35`).

`worktree_create` (`src/tools.ts:101`) is the one tool that *enters* a checkout:
it calls `module.createIsolatedTarget` and then `enterCheckout`, reporting
`cwdSelected`/`cwd` so the model knows whether the Session now actually works
inside the worktree, or only has guidance (`src/tools.ts:148`, `src/tools.ts:160`).

## Connections

- [[session-checkout-module]] — the `SessionCheckoutModule` contract
  (`src/index.ts:113`) that both surfaces call into; owns the state machine,
  `operate`, `inspect`, `resolveRoots`/`resolveManagedRoot`.
- [[index]] — plugin `apply()` (`src/index.ts:358`) wires `registerTools` and
  `registerWorktreeCommand`, and provides `inject` (`src/index.ts:253`).
- [[session-target-context]] — `registerSessionTargetContext` (`src/index.ts:409`)
  is the sibling runtime-context surface; tools/commands and it all read the same
  module.
- [[working-directory-adapter]] — `src/adapters/working-directory.ts` is the
  `SessionWorkingDirectoryPort` both surfaces depend on for cwd safety.
- [[i18n]] — `hostMessage` / `hostRegistrationMessage` (`src/i18n/host.ts`,
  `src/i18n/host-messages.ts`) supply all tool/command descriptions and error
  text; `withHostLanguage`/`languageForInvocation` scope the locale per invocation.
- [[console-remote]] — the RPC descriptors (`src/console-remote/descriptors.ts`)
  mirror these tool schemas for the remote control plane.

## Known Issues

- **`worktree_deliver` is disabled while `autoDeliver` is off.** The tool layer
  reads `module.isAutoDeliverEnabled()` and throws `worktreeDeliverDisabledByAutoDeliver`
  at `src/tools.ts:451`. When off, model-driven delivery must go through
  `worktree_ready_for_review` + the human acceptance bar (`/worktree finalize` /
  `finish`); see the module docstring at `src/tools.ts:8`.
- **`worktree_deliver` is only allowed in `working` or `ready_for_review` state.**
  Any other state throws `worktreeDeliverNotAllowedInState` (`src/tools.ts:456`).
- **List output omits `undefined` keys.** Because the host rejects
  `undefined` as "not lossless JSON", `worktree_list` spreads `commitOid` only
  when present (`src/tools.ts:101`); `worktree_create` similarly spreads `branch`
  and `cwd` conditionally (`src/tools.ts:158`, `src/tools.ts:161`).
- **Cwd-restore failure aborts removal, never proceeds.** Both `leaveCheckout`
  (`src/commands.ts:51`) and `leaveCheckoutBeforeRemoval` (`src/tools.ts:51`)
  return a non-null reason on failure and the caller must refuse to delete the
  checkout (e.g. `src/tools.ts:471`, `src/commands.ts:139`); otherwise the
  Session's `cwd` would point at a directory about to vanish. `enterCheckout`
  failures are best-effort only — a warning is logged and the Session keeps the
  guidance path (`src/commands.ts:69`, `src/tools.ts:88`).
- **`retain_24h`/`retain_3d` expiry math** is defined on the module side
  (`RETENTION_24H_MS` etc. in `src/session-checkout-module.ts`), not in this
  module; the CLI only passes the retention string through and validates it
  against `RETENTIONS` (`src/commands.ts:32`) / `WORKTREE_RETENTION_VALUES`
  (`src/tools.ts:22`).
- **No automated CLI test for the `/worktree` verbs aside from `surface.test.ts`.**
  `tests/surface.test.ts` covers `continue`, `next`, `finalize`, and the
  `worktree_*` tools, plus cwd-enter/leave behaviour; the port itself is covered
  by `tests/working-directory-adapter.test.ts`. Discard/remove verb branches are
  not exercised by a dedicated test.
