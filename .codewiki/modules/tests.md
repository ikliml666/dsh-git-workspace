---
title: tests
type: module
source_files:
  - tests/adapters-safe-file.test.ts
  - tests/client-actions.test.ts
  - tests/client-branch-overview-cache.test.ts
  - tests/client-bundle.test.ts
  - tests/client-conflict-display.test.tsx
  - tests/client-console-remote-routing.test.ts
  - tests/client-i18n.test.tsx
  - tests/client-polling-diagnostic.test.tsx
  - tests/client-pre-session.test.tsx
  - tests/client-preview-recovery-cache.test.ts
  - tests/client-recovery-continuation.test.ts
  - tests/client-review-console.test.tsx
  - tests/client-review-details.test.tsx
  - tests/client-settings-card.test.tsx
  - tests/client-target-console.test.tsx
  - tests/client-toolview.test.tsx
  - tests/client-workspace-sidebar-actions.test.ts
  - tests/client-workspace-sidebar-model.test.ts
  - tests/client-workspace-sidebar-profile.test.ts
  - tests/client-workspace-sidebar-status.test.tsx
  - tests/client-workspace-sidebar.test.tsx
  - tests/concurrent-session-guard.test.ts
  - tests/console-contract.test.ts
  - tests/console-host.test.ts
  - tests/console-remote.test.ts
  - tests/current-polling.test.ts
  - tests/dev-dsh.test.ts
  - tests/git-creation-lifecycle.test.ts
  - tests/git-tags.test.ts
  - tests/git-timeouts.test.ts
  - tests/git-unborn.test.ts
  - tests/host-i18n.test.ts
  - tests/host-locale-context.test.ts
  - tests/host-query-budget.test.ts
  - tests/i18n-catalogs.test.ts
  - tests/i18n-references.test.ts
  - tests/lookup.test.ts
  - tests/official-workspace-client-alpha.mock.ts
  - tests/official-workspace-client-next.mock.ts
  - tests/official-workspace-client.mock.ts
  - tests/project-skill-provider.test.ts
  - tests/project-skills-race.test.ts
  - tests/project-skills.test.ts
  - tests/session-branch-adopt.test.ts
  - tests/session-branch-delivery.test.ts
  - tests/session-branch-label.test.ts
  - tests/session-checkout-apply.test.ts
  - tests/session-checkout-module.test.ts
  - tests/support/commit-message.js
  - tests/support/official-client.ts
  - tests/support/production-adapters.ts
  - tests/support/review-actions-harness.tsx
  - tests/support/ui-primitives.tsx
  - tests/support/worktree-console.ts
  - tests/surface.test.ts
  - tests/working-directory-adapter.test.ts
  - tests/workspace-provider-lifecycle.test.ts
  - tests/worktree-creation.test.ts
tags: [测试, vitest, worktree, console-host, console-contract, i18n, sidebar, git, fixture]
---

## Overview

`tests/` 是 `dsh-git-worktree` 插件的完整 Vitest 测试套件，覆盖三条并行主线：

1. **Host 端核心域**（node 环境）：`SessionCheckoutModule` 全生命周期（创建 / 评审 / checkpoint / Preview / 交付 / 清理 / 恢复）、`SessionCheckoutApplyEngine` 的 Git CAS 写入、Console Host 控制面、Git 端口（unborn 仓库、标签、超时、创建回滚）、并发分支竞态守卫、Skill 携带、公开工具面、i18n 目录。
2. **Client 端 UI**（`// @vitest-environment jsdom`，React Testing Library）：pre-session Worktree 开关、验收 Console、Target 状态胶囊、侧栏投影（Mode A 遮蔽 / Mode B 装饰）、验收详情弹层、恢复续跑、i18n、设置卡、工具视图、构建产物 bundle。
3. **合同与边界**：strict Typert 描述符、远程适配器错误分级、Workspace provider 生命周期（真实 Cordis Loader）、`dev-dsh` 开发工作流。

测试的鲜明特征是**把产品回归写进测试注释**：几乎每个测试都注明了它防住的 bug（Issue #6、胶囊分支标签丢失、交付误写他人分支、慢胶囊、hidden-tab 轮询开销等），见 [Known Issues](#known-issues)。

## Key Components

### 共享测试基座：`tests/support`

#### `tests/support/worktree-console.ts` — Console adapter 确定性假实现

| 导出 | 行号 | 用途 |
| --- | --- | --- |
| `WorktreeConsoleFixtureMethod` | 53 | `keyof WorktreeConsoleAdapter`，用于 `calls` 记录的方法名类型 |
| `WorktreeConsoleFixtureCall` | 55-58 | `{ method: WorktreeConsoleFixtureMethod; request: unknown }` |
| `WorktreeConsoleAdapterFixture` | 117-121 | `{ adapter; calls: WorktreeConsoleFixtureCall[]; target: WorktreeConsoleTargetDetails }` |
| `createWorktreeConsoleAdapterFixture(stateful = false)` | 124-534 | 核心工厂，返回记录每次调用的 adapter 假实现 |
| `readyTarget()` | 60-111 | 私有 fixture 目标：`checkoutId: 'checkout-1'`、`sourceSessionId: 'source-session'`、`ownerSessionId/targetSessionId: 'target-session'`、`iteration: 1`、`revision: 7`、`state: 'ready_for_review'`、`phase: 'ready'`、`dirty: true`、`currentOid: 'b'.repeat(40)`、`sourceOid: 'a'.repeat(40)`、`currentBranch: null`、`sourceBranch: 'main'`、`managedRoot: '/fixture/project-worktrees/checkout-1'`、`sourceRoot: '/fixture/project'`、`checkpointGeneration: '9'.repeat(64)`、`review`（`reviewId: 'review-1'`、`revision: 7`、`iteration: 1`、`preparedAt: 1`、`summary: 'Fixture review'`、`validationStatus: 'passed'`、`validationSummary: 'focused tests passed'`、`tests: [{command:'pnpm test',status:'passed'}]`、`changedFiles: ['src/index.ts']`、`suggestedCommitMessage: 'fix: fixture review'`）及 16 位 capabilities |
| `outcome<T>(value)` | 113-115 | 包成 `{ ok: true, value }` |

`adapter` 上每个方法先 `record(method, request)` 再返回确定性结果（行号即方法定义处）：

| 方法 | 行号 | 返回摘要 |
| --- | --- | --- |
| `sidebarTopology()` | 176 | `{ projects: [], workspaceClientFlavor: 'legacy' }` |
| `current(req)` | 180 | `{ target }` |
| `list(req)` | 184 | `{ project, worktrees: [target] }` |
| `create(req)` | 188 | `{ target, targetSessionId: target.ownerSessionId, managedRoot }` |
| `initializeProject(req)` | 192 | `true` |
| `inspect(req)` | 196 | `{ target }` |
| `reviewDiff(req)` | 200 | 单文件 `modified` patch `@@ -1 +1 @@` |
| `preflight(req)` | 209 | `status: 'ready'`，`baseStrategy: 'recorded_base'` |
| `previewRecoveryPreflight(req)` | 220-245 | `status: 'assessed'` + 完整 proof（generation `'1'×64`、rollback `safe`、finalize `safe`） |
| `preparePreviewRecoveryAnalysis(req)` | 246 | `{ target, recoveryContinuation: kind 'worktree_preview_recovery_analysis' }` |
| `createPreviewRecoveryHandoff(req)` | 254 | handoff continuation |
| `preview(req)` | 267 | `state: 'preview_active'`、`revision + 1`、关闭 preview/preflight、开 rollbackPreview/finalizePreview |
| `checkpoint(req)` | 276-312 | `state: 'working'`、`revision + 3`、`checkpoints: [{checkpointId:'checkpoint-1', sequence:1, …}]` |
| `resumeRevision(req)` | 313-344 | `state: 'working'`、`revision + 1`；`conflictContinuation` 时回填 `recoveryContinuation`（`requestId: 'host-authority-conflict-1'`） |
| `prepareReviewRegeneration(req)` | 345-358 | 只读 `worktree_review_regeneration` proof（`requestId: 'host-authority-regeneration-1'`） |
| `rollbackPreview(req)` | 359-371 | `resumeRevision` 时回 `working`；否则回 `ready_for_review` |
| `discard / finalize / finalizePreview / retryCleanup / clearSidebarBadge` | 372 / 376 / 380 / 392 / 396 | `delivered()`（130-170）：`state: 'delivered'`、`phase: 'discarded'`、`commitOid: 'c'.repeat(40)`、`deliveryProof`、`beginNextIteration/returnToLocal: true` |
| `setRetention(req)` | 384 | `{ state: 'retained', phase: 'retained', retention }` |
| `setPermanent(req)` | 388 | `{ permanent }` |
| `beginNextIteration(req)` | 400-422 | `checkoutId: 'checkout-2'`、`iteration + 1`、`revision + 2`、`working` |
| `returnToLocal(req)` | 423-446 | `state: 'local'`、`checkoutId: null`、`currentBranch: 'main'` |
| `gitOverview(sessionId)` | 447-459 | 基于 `target.currentBranch` 的分支列表（`main` 带 `upstream: 'origin/main'`） |
| `gitGraph / gitCreateBranch / gitSwitchBranch` | 460 / 464 / 468 | 空 commits / branch 名回显 |
| `listAbandoned / restoreAbandoned` | 472 / 476 | 空 snapshots / `worktree-restore-<id 前 8 位>` |
| `gitListTags / gitCreateTag / gitDeleteTag / gitPushTag` | 480 / 487 / 502 / 509 | 闭包内可变 `tags` 状态（行 173 注释：**Mutable tag state**）；重名/不存在返回 `git_operation_failed`；`pushed` 随操作翻转 |

**stateful 模式**（518-532）：对 `preview`、`rollbackPreview`、`resumeRevision`、`finalizePreview` 包装 CAS —— 请求 `expectedRevision !== target.revision` 时返回 `stale_target`；成功后把返回 target 的 revision 改写为 `target.revision + 3`（行 526 注释：*Host journaling and completion each advance CAS; callers must use returned identity*）。行 533 的 `get target()` 是属性方法，始终返回最新可变目标。

#### `tests/support/production-adapters.ts` — 真实 Node 依赖装配

| 常量/导出 | 行号 | 用途 |
| --- | --- | --- |
| `NodeSessionCheckoutOptions` | 23-31 | `configDir`、`lookup`、`worktreesRoot?`、`autoDeliver?`、`autoPush?`、`branchRaceGuard?`、`branchRaceWindowMs?`（后五者均支持 `T \| LiveValue<T>`） |
| `GitCommandResult` | 33-37 | `{ code, stdout, stderr }` |
| `GitCommandOptions` | 39-41 | `{ hooksPath }` |
| `GIT_COMMAND_TIMEOUT_MS` | 47 | `10_000` |
| `WORKTREE_REMOVE_TIMEOUT_MS` | 48 | `5 * 60_000`（行 50 注释：Windows 删 1GB/6 万文件私有依赖树时 10 秒不够） |
| `getSessionCheckoutGitTimeoutMs(args)` | 51-55 | `worktree remove` 用 5 分钟，其余 10 秒 |
| `measureDirectoryBytes(path)` | 57-65 | 递归求目录字节数；符号链接记 0 |
| `removeEmptyDirectoryTree(path)` | 67-76 | 仅删全空目录树，非目录/链接返回 false |
| `inspectDirectoryIdentity(path)` | 78-87 | 返回 `DirectoryIdentity { device, inode, birthtimeNs }`（bigint stat） |
| `directoryIdentitiesEqual(l, r)` | 89-91 | 三元组相等 |
| `quarantineDirectoryTree(path, expectedIdentity, quarantinePath)` | 93-113 | rename 到隔离名并复核身份；身份不符时尝试还原并抛 `checkout_mismatch`（行 111 注释：**绝不删除身份不符对象**） |
| `removeDirectoryTree(path)` | 115-127 | `rm` 递归，Windows 重试 6 次/150ms |
| `runGit(cwd, args, options)` | 129-191 | spawn `git --no-pager --no-optional-locks -c core.quotePath=false -c core.fsmonitor=false -c core.hooksPath=…`，env 强制 `GIT_OPTIONAL_LOCKS=0`、`GIT_TERMINAL_PROMPT=0`、`LC_ALL/LANG=C`；超时 SIGKILL 并按失败返回（不抛） |
| `runGitChecked(cwd, args, options)` | 193-202 | 非 0 退出抛 `SessionCheckoutError('git_operation_failed')` |
| `checkoutRefRoot(checkoutId)` | 204-207 | `refs/dsh-worktree/session-checkouts/<sha256 前 24 位>` |
| `assertArtifactName(name)` | 209-217 | 内部 artifact 名每段须 `^[A-Za-z0-9][A-Za-z0-9._-]*$` |
| `internalArtifactRef(checkoutId, name)` | 219-222 | `<root>/<name>` |
| `applyBaseRef(checkoutId)` | 224-226 | `<root>/apply-base` |
| `emptyRegistry()` | 228-235 | `{ version: 2, revision: 0, sessionBindings: {}, managedCheckouts: {} }` |

**记录校验器**（v2 registry 防腐层）：

| 校验器 | 行号 | 校验要点 |
| --- | --- | --- |
| `isRecord` / `isStringArray` | 237 / 241 | 基础类型 |
| `isTargetRef` | 245-250 | `kind` ∈ `unselected / local / isolated(+checkoutId)` |
| `isSessionBinding` | 252-262 | sessionId、projectId、projectName、target、ownerSessionId、sourceRef、sourceOid、revision |
| `isReview` | 264-282 | reviewId/iteration/preparedAt/summary/validationStatus(4 态)/tests/changedFiles/suggestedCommitMessage/isolatedFingerprint/isolatedHeadOid |
| `isPreviewReceipt` | 284-304 | previewId、reviewId、iteration、previewedAt、base 三个 oid、baseStrategy(3 态)、localHeadOid、两个 local fingerprint、4 个 tree oid、isolatedSnapshotOid、changedFiles |
| `isDeliveryProof` | 306-312 | localBranch、localHeadBefore/After、changedFiles |
| `isDelivery` | 314-353 | 按 7 个 state 分别校验：`working`（iteration）、`ready_for_review`（review）、`preview_active`（review+receipt）、`preview_detached`（+detachedAt、reason ∈ `stale_local/preview_modified`、attemptedAction 3 态）、`finalized`（finalizedAt、cleanup ∈ `pending/blocked`）、`retained`（retention 3 态、retainedAt、expiresAt、cleanup ∈ `scheduled/blocked`）、`delivered`（iteration、commitOid、deliveredAt） |
| `isJournal` | 355-402 | `null` 或带 operationId/step/startedAt；create 仅 `creating_worktree`；其余 operation 7 态 × step 7 态，可选字段逐个类型检查（含 checkpoint 家族与 recoveryGeneration） |
| `isManagedCheckout` | 404-422 | checkoutId…gitDir、baseOid、sourceRef、phase 7 态、delivery、journal、revision |
| `isRegistry` | 424-434 | version===2 且两个 map 逐项通过 |
| `migrateLegacyRegistry` | 436-491 | v1→v2：无 delivery 字段的记录迁为 `{state:'working', iteration:1}`，未知 phase 归 `recovery_required` 并 revision+1 |

**类 `AtomicJsonCheckoutRegistry implements SessionCheckoutRegistryPort`**（493-512）：

- `constructor(private readonly path: string)`（494）
- `read()`（496-506）：读 JSON → `isRegistry` 直接返回；否则尝试 `migrateLegacyRegistry` 并回写；文件不存在返回 `emptyRegistry()`；损坏则抛 `SessionCheckoutError('registry_corrupt', 'managed-checkouts.json 损坏…')`（505）
- `write(registry)`（508-511）：先 `mkdirSync(dirname, {recursive:true})` 再 `writeJsonFileAtomic`

**`createNodeSessionCheckoutDependencies(options)`**（514-775）返回完整 `SessionCheckoutDependencies`：

- `lookup`（525）、`applyEngine: createSessionCheckoutApplyEngine()`（526）、`managedCheckoutsRoot = configDir/worktrees`（517）、`disabledGitHooksRoot = configDir/disabled-git-hooks/<uuid>`（518）
- `createCheckoutId: randomUUID`（533）、`registry: new AtomicJsonCheckoutRegistry(configDir/managed-checkouts.json)`（534）
- `files` 端口（535-550）：`exists`(536)、`canonicalize`(537)、`inspectDirectoryIdentity`(538)、`ensureDirectory`(539)、`removeEmptyDirectoryTree`(540)、`quarantineDirectoryTree`(541)、`removeDirectoryTree`(542)、`measureDirectoryBytes`(543)、`readTextFile`(544)、`copyFile`(545)
- `git` 端口（551-773）：

| git 方法 | 行号 | 实现要点 |
| --- | --- | --- |
| `inspect(root)` | 552-570 | `rev-parse --show-toplevel` + `--path-format=absolute --git-common-dir/--absolute-git-dir` + `HEAD` + `symbolic-ref`；branch 取 `refs/heads/` 前缀 |
| `findContainingWorktreeRoot` | 571-576 | toplevel |
| `status` | 577-580 | `status --porcelain=v1 -z --untracked-files=all` |
| `createDetachedWorktree` | 581-589 | `worktree add --detach` |
| `removeWorktree` | 590-594 | `worktree remove --force`（行 591 注释：caller 已先验证 identity 与完整 fingerprint） |
| `retainApplyBase / releaseApplyBase` | 595 / 598 | `update-ref ±d` 到 apply-base ref |
| `retainInternalArtifact / readInternalArtifact / releaseInternalArtifacts` | 601 / 604 / 610 | 前缀枚举 `for-each-ref` 后逐个 `-d` |
| `isAncestor` | 618-623 | `merge-base --is-ancestor`（0/1/其他） |
| `listLocalBranches / resolveLocalBranchTip` | 624 / 628 | `for-each-ref` / `rev-parse --verify --quiet` |
| `repairWorktreeLinks / pruneWorktrees` | 634 / 638 | `worktree repair` / `prune --expire now` |
| `listWorktreeincludeFiles` | 642-650 | 两次 `ls-files --others --ignored`（行 644-645 注释：`--exclude-from` 只吃清单本身，需与全集求交集） |
| `branchOverview` | 651-667 | `for-each-ref` 四列 + `status`，过滤非法 oid |
| `defaultBranch` | 669-676 | `origin/HEAD` → `init.defaultBranch` → null（行 668 注释与 `src/adapters/git.ts` 同语义） |
| `deleteLocalBranch` | 677-681 | `branch -d`，失败返回 `{deleted:false, reason}` |
| `branchTipTimes` | 683-694 | committerdate unix ×1000 |
| `branchCreationTimes` | 697-711 | reflog 里最早 `branch: Created from`（竞态检测用） |
| `mergeLocalBranch(root, source, options)` | 714-772 | dryRun 在 `mkdtemp` 临时 detached worktree 试合 `--no-commit --no-ff`；正式合 `--no-ff --no-edit`；冲突收集 `diff --name-only --diff-filter=U` + 每文件 `diff`（受 `CONFLICT_DETAIL_FILE_LIMIT`/`CONFLICT_DETAIL_DIFF_LIMIT` 限制，行 716-732） |

#### `tests/support/official-client.ts`

`loadOfficialBrowserClient(packageName, override?)`（6-19）：解析官方包 `package.json` 的 `exports['./client'].browser ?? .default`（行 10，注释：**Execute the published browser face, not the newly separate Node client**），以假 `window.__ModuleLoader__` 执行该 bundle 文件并取回 `handoff.factory(require)` 的导出；handoff 缺失时抛错（17-18）。

#### `tests/support/review-actions-harness.tsx`

- `ReviewActionsHarnessProps extends WorktreeReviewPanelProps`（15-20）：`adapter?`、`services?`、`onRefresh?`、`onTargetChange?`（另有 47 行读取的 `unavailableMessageOverride`）
- `reviewIsStale(target, identity, review)`（22-34）：`target.state==='working'` 即 stale；否则比对 `expectedRevision` 与 `review.reviewId`
- `ReviewActionsHarness({...})`（36-128）：内部状态 `mounted`(49-51)、`actionScope`（identity 四元组 NUL 拼接，51-52）、`targetKey`（26 项 target 字段 NUL 拼接，55-85）、`currentTarget`(86)、`invalidReason`(87)；`useLayoutEffect`（97-101）在 targetKey 变化时重置；`handleStale`（103-109）置 stale 文案并去重触发 `onRefresh`；`liveReady`（117-122）才启用 `ReviewActions`（125-127，传 `isActive={() => mounted.current}`）

#### `tests/support/ui-primitives.tsx`

| 导出 | 行号 | 说明 |
| --- | --- | --- |
| `MenuEntry` | 4-8 | 普通项 / `separator` / `label` 三态 |
| `Menu({open, anchor, items, footer, onSelect, onClose})` | 10-36 | 受控菜单 double；open 时监听 Escape 调 `onClose`（18-25） |
| `MenuItemButton` | 39-67 | `role="menuitem"`，透出 `data-danger`/`data-separator-before` |
| `IconTrashOutlineRegular` | 70-72 | `<svg data-icon="trash-outline" />` |
| `IconBranchOutlineRegular` | 74-77 | `<svg data-icon="branch-outline" />` |
| `Modal({open, onClose, title, closeLabel, description, children, footer, headless, className})` | 80-119 | Escape 关闭；headless 时不渲染标题与 × 按钮 |

#### 官方 Workspace client mock

- `tests/official-workspace-client.mock.ts`：`inject`（3，含 `conversation`/`connection`）、`derivedBrowserCalls`（11-14，记录传给派生 Browser 的 props）、`resetDerivedBrowserCalls()`（13-15）、`WorkspaceBrowser(props)`（17-20，渲染 `data-derived-workspace-browser`）、`apply(ctx)`（22-38，在 `sidebar.workspaces` 与 `conversation.hero.workspace` 两个 slot 注册官方 Browser）。
- `tests/official-workspace-client-next.mock.ts`：`inject`（1，`shortcuts` 版本）、`apply(ctx)`（3-21）——声明 `sidebar.workspaces` 完整子 seat 树（`session.menu.item`、`session.row.action`、`session.row.leading`、`session.row.hover`）与 `conversation.hero.workspace`。
- `tests/official-workspace-client-alpha.mock.ts`：alpha 派生 mock，被 `client-console-remote-routing.test.ts:19` 以 `applyAlpha` 引入，与 legacy/next 并列参与 Browser 三分派。
- 另有被多处引用的 `tests/support/commit-message.js`（导出 `longCommitMessage`，供 `console-host.test.ts:1`、`client-review-console.test.tsx:2`、`session-checkout-apply.test.ts:1`、`session-checkout-module.test.ts:1` 使用；源码不在本文引用范围）。

### Host 端集成测试套件

#### `tests/session-checkout-module.test.ts`（核心回归，~3144 行）

固定装置与类型：

- `TestSession`（16-20）：`{ id, projectId?, title? }`，运行期由 fixture 注入 `delegationCheckoutReleasedAt`、`sourceDelegationId`、`delegationStatus`
- `TestProject`（22-26）：`{ id, name, root }`
- `ManagedInspectPause`（28-31）：`{ started: Promise<void>; resume(): void }`
- `DirectoryMeasurePause`（33-36）：同构
- `TestContext`（38-58）字段/方法全集：`root`、`configDir`、`worktreesRoot`、`projectRoot`、`repositoryRoot`、`module`、`restart()`、`pauseNextGitInspect(expectedPath?)`、`failNextGitInspect(expectedPath?)`、`pauseNextDirectoryMeasure()`、`getRemoveWorktreeCallCount()`、`getCreateWorktreeCallCount()`、`getMeasureDirectoryCallCount()`、`setSessionProject(sessionId, projectId)`、`setProjectRoot(projectId, root)`、`addProject(projectId, name, root)`、`addSession(sessionId, projectId, title?)`、`removeSession(sessionId)`、`removeProject(projectId)`；返回对象另含未列于接口的 `setSessionDelegation`（330）与 `markSessionDelegationCheckoutReleased`（336）
- `git(cwd, ...args)`（70-80）：`spawnSync`，强制 `GIT_TERMINAL_PROMPT=0`
- `gitDated(cwd, committerDate, ...args)`（83-93）：固定 `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`，用于 tip 年龄过滤
- `createContext(options)`（95-348）：options 字段（96-113）——`projectSubdirectory`、`applyEngine`、`crashAfterWorktreeCreate`、`rolledBackCreationCall`、`createWorktreeFailures`、`createWorktreeFailureLeavesFile`、`removeWorktreeFailures`、`transientRemoveWorktreeFailures`、`removeWorktreeFailureLeavesResidue`、`removeDirectoryTreeFailures`、`ensureDirectoryFailures`、`outerRepository`、`checkoutIds`、`worktreesRoot`、`worktreesRootLive`、`autoDeliverRef`、`worktreeKeepCount`；内部对 `dependencies.git.inspect` 注入暂停/失败钩子（184-197）、`removeWorktree` 计数与残余构造（198-223）、`removeDirectoryTree`/`ensureDirectory` 故障注入（224-241）、`measureDirectoryBytes` 暂停（243-258）、`createDetachedWorktree` 计数/回滚/崩溃（259-277）
- 行 62 注释：全局超时在 `vitest.config.ts`（60s）

`describe('SessionCheckoutModule')`（350）覆盖（行号为 test 起始）：互斥 mutation 锁（351）、Local inspect 展示 branch/HEAD（378）、dirty 实时（401）、同源两个 isolated target 且 Local 干净（411）、`observeManagedCheckouts` 批量（433）、指定基准分支（445）、外层仓库回退（465）、checkout 路径 8 位冲突扩展（475）、sibling 容器未知内容不碰（490）、symlink 容器走 fallback（502）、EPERM 报容器名而非「不可信」（516）、跨 cwd 身份 fail closed（530）、runtimeContext 三态（539/555/569）、Ready 后恢复编辑不碰 Local（594）、非法 commit body 全动作拒绝且不落盘（623）、超长建议消息持久化+重启（652）、oversized 评审字段 `invalid_input`（678）、超长 finish 信息只写会话分支（698）、checkpoint 幂等 + 最终一次累计交付（721）、checkpoint 崩溃后 journal 恢复（792）、Preview 上先回滚再 checkpoint（831）、stale checkpoint 拒绝（863）、apply conflict 证明持久化（889）、只读 regeneration proof（934）、stale resume fail closed（965）、回滚创建后手动重试（985）、清理后下一轮迭代（996）、cwd 被重建时拒绝覆盖（1047）、in-place 下一轮（1071）、delivered 后 runtime 不再声称已删 cwd（1095）、中断的下一轮恢复 predecessor（1119）、source 可丢弃未开 reservation（1170）、分支修剪 dryRun（1187）/olderThanDays（1215）/维护扫描（1237）、worktree 分支 merge（1262）/冲突（1290）/反向（1323/1343）、容器回收（1369/1479/1506）、volatile autoDeliver（1527）、owner 接管拒绝（1539）、跨 session 持久 owner id 不授权（1554）、strict Finish 拒绝未评审字节（1570）、receipt-first 直接交付（1597）、keep-count LRU（1633）、瞬时清理阻塞可重试（1668）、retention 窗口/永久/过期（1697）、Preview 回滚（1734）、撤回-再预览-保存同一 review（1765）、finalize preview（1796）、放弃 Preview 先回滚（1832）、detached 快进恢复（1854）、detached finalize（1917）、证据变化拒绝旧 proof（1971）、不确定回滚进入 recovery_required（2013）、不确定 finalize（2074）、评估后 Local 变化拒绝旧 proof（2142）、验收位占用（2189）、recovery handoff（2268）、Preview 被 Local 提交后 fail closed（2316）、第二目标等待验收位（2351）、legacy Apply 后禁止 Finish/Discard（2393）、worktree add 残余 fail closed（2429）、重复 bind 幂等（2451/2460）、local→isolated 拒绝（2471）、非 Git 拒绝（2484）、台账自动搬迁（2493）、`.worktreeinclude` 携带（2523/2539）、stale root 报错与 `needs_attention`（2553/2570）、外部删除后 discard（2588）、空壳 reconcile（2606）、inspect 与 Discard 串行（2623）、v1→v2 迁移（2652）、interrupted evidence 不可 adopt/delete（2682）、crash 后 Recover（2706）、Preview artifacts 重启（2775）、branch CAS 崩溃（2806）、stale engine 稳定错误码（2847）、in-place 升级（2904-2968）、trunk 修剪（2982）、Preview 占位时 merge 拒绝但 dryRun 可用（3006）、他人分支 merge 指名 owner（3030）、terminal residue 不复活（3073）、cleanup reason 结构化字段优先（3098）。

#### `tests/session-checkout-apply.test.ts`

- `CheckoutFixture`（12-19）：`{ baseOid, branchName, isolatedPath, isolatedRepositoryPath, localPath, localRepositoryPath }`
- `runGit(cwd, args)`（32-36，加 `core.quotePath=false`）、`createFixture(options: { projectSubdirectory? })`（38-63，含中文/空格路径目录「隔离 checkout」）、`readyPlan(engine, fixture)`（65-70）
- 行 22-24 注释：Git 重型用例超过 Vitest 默认 5s，全局超时在 `vitest.config.ts`（30s）

`describe('SessionCheckoutApplyEngine')`（72）覆盖：checkpoint 一次性干净提交且 Local 字节不变（73）、CAS 前并发改动 `stale_isolated`（113）、HEAD 已动但索引未清的崩溃恢复 `recoverCheckpoint`（140）、拒绝空 stage（174）、只读 preflight 不产可执行 plan（188）、Apply 只留 unstaged（214）、Finish 单 squash commit（235）、receipt 持久化失败 Local 不变（263）、回滚保留并发 Local 层（287）、rollback journal 竞态（318）、verification fault 显式 uncertain（346）、finalize fault 补偿（366）、finalize 索引竞态（392）、补偿拒绝覆盖并发 stage（421）、detached 恢复评估只读（452）、快进后回滚保留新 commit（492）、评估后再变 CAS 拒绝（526）、快进冲突 `preview_modified`（559）、切分支（593）、非后代改写（618）、跨 Preview finalize（645/678）、Local 三层并发（715）、同文件不同 hunk（738）、detached Local 拒绝（756）、空 delta 不产空提交（773）、增量二次 Apply 用 `nextBaseOid`（862）、`local_contains_isolated_head`（883/906）、monorepo 子目录继承（970）、动态祖先不能推进 base（988）、divergent 冲突（1006）、文本/二进制冲突（1025/1046）、staged+unstaged 终态传输（1061）、Unicode untracked（1075）、删除/二进制/模式/符号链接（1089/1102/1225 win32 skip /1241 win32 skip）、篡改 plan `invalid_plan`（1116）、plan 后 Local 变化 `stale_local`（1132/1150/1168/1189）、Isolated 提交后 `stale_isolated`（1206）。

#### `tests/session-branch-delivery.test.ts` / `-adopt` / `-label`（分支三回归）

三文件共享结构：`testEnvironment(overrides)`（delivery 12-23 / adopt 12-23 / label 13-24，隔离 `GIT_CONFIG_NOSYSTEM`、`GIT_CONFIG_GLOBAL`，删除 `GIT_AUTHOR_/COMMITTER_/DIR/WORK_TREE/INDEX_FILE`）与 `fixture()`（delivery 32-79 / adopt 32-91 / label 35-88）——`mkdtemp` + 真实 git init + 通过假 `ctx.subprocess.spawn` 的 `createDshGitPort`。

- **delivery**（81-150）：Local 停在他人分支 `fix/sess-session--dock-action-click` 时创建 Worktree，断言创建即建 `feat/sess-owner--sleep-wake`（97）、交付只写该分支（131-137）、Local HEAD/索引/他人未提交文件零改动（141-146）、`.dsh-ops` 运行期产物不进变更集（112-114, 130）；第二用例两个会话不抢同一分支（152-175）。
- **adopt**（93-153）：legacy detached 记录（无 `sessionBranch`、`sourceRef` 指他人分支）交付时补建会话分支、回填记录（144-147）、不动他人分支（140）、Local 未写（149）。
- **label**（90-121 / 123-170）：胶囊 `currentBranch` 必须是真分支名而非 null（113）；交付后 owner 回 Local 边界，`currentBranch` 跟随 `main` 而 `sourceBranch` 保留任务分支（160-164）。

#### `tests/console-host.test.ts`

固定装置：

- `A`/`B`（25-26，40 位 oid）、`runGit(cwd, args)`（28-32）、`local(sessionId)`（34-42）、`readyRecord()`（44-60，完整 `ManagedCheckoutRecord`，字段见行 45-60）、`readyReviewOf(record)`（63-66）、`retainedRecord()`（69-79，`phase:'retained'`、`sessionBranch:'refs/heads/feat/sess-target-session--task'`、delivery 带 retention/expiresAt/cleanup）、`registry(record)`（81-86）、`moduleDouble(record)`（88-122，mock `SessionCheckoutModule` 全方法）、`lookupDouble()`（124-129）、`ownerLocalLookup()`（132-136，行 131 注释：**owner Session 的项目根永远是 Local checkout**）、`filesDouble()`（138-145）、`gitDouble()`（147-154）、`plane(record, overrides)`（156-173，组装 `createWorktreeConsoleControlPlane`，含 `createTargetSessionId: () => 'host-target'` 与 reviewDiff stub）
- `describe('initial version confirmation on the host')`（1717）：`setup()`（1718-1733，`git.preflightInitialCommit`/`initializeEmptyRepository` 可变 state + fingerprint）、`token(control)`（1734-1738）；测试：preflight/取消零写入且 confirmation 绑定 source session（1739）、非 empty 拒绝与 fingerprint 变化（1752）、过期 confirmation 不写（1765）、部分成功保留初始提交仅重试建 worktree（1774）、`initProject`（1783）、并发去重（1793）

主 describe（175）覆盖（行号）：未选 Session 投影 Local 不改 binding（176）、session 分支命名（200/218）、非 Git 不给 create（232）、非 Git 未绑定报 `not_git_repository` 不读 status（246）、Host 分配 target 身份（262）、path-free sidebar 拓扑且只留最新 iteration（275）、跨 iteration 目录 membership 不泄漏路径（344）、清理后仍可投影 delivered（371）、resume 不写 Local（398）、conflict proof 持久化（437）、只读 regeneration proof（501）、checkpoint 生成绑定不泄漏 `refs/dsh`（538）、Preview 竞态结构化 continuation（599）、stale review 拒绝（627）、iteration 2 保留 cwd 身份（636）、in-place owner 过 workspace gate（693）、preview_detached 进注意力过滤（712）、交付挂起禁止 Local 切分支（732）、标签 CRUD（742-807）、批量观察（809）、坏记录降级不整表失败（826）、同源 sibling 只读（892）、验收位 waiting（974）、跨源不扩散读权限（1071）、delivered proof（1085）、非 source/owner 拒绝且不 reveal managedRoot（1126）、live cwd 授权（1133-1179）、清理后 owner 仍可读（1181/1192/1215）、retained 分支命名（1228/1250）、复用 caller inspection 免三连 spawn（1273，注释：*the reported "chip is slow to read the branch"*）、registry revision 推进时重观察（1296）、新鲜 registry proof（1328）、观察携带 Local branch（1367）、`returnToLocal` 能力（1395-1456）、list path-free / inspect 带路径（1458）、finalize 完整长消息（1469）、直接 Finalize 竞态 continuation（1485）、空/NUL commit message 拒绝（1511）、finalizePreview 校验（1523）、source Discard 拒绝（1553）/未开 reservation 允许（1565）/owner 路由（1580）、sidebar badge 清除（1597/1604）、diff bytes stale 丢弃（1630）、1MiB 总预算（1647）、二进制/重命名在预算内（1674）。

#### `tests/console-remote.test.ts`

- `OWNER_PEER`（37-41，注释：0.2.1-rc.1 gateway 把每次调用绑到 Peer）
- `loadRemoteClientModule()`（46-48）、`METHODS`（50-90，39 个方法名清单）
- 主 describe（92）：strict 描述符集合共享（93-116）、legacy/lazy codec 同 schema（118）、sidebar 无 agent 可调且拒绝泄漏路径（134）、wire 输入/业务输出在 Zod 边界 fail closed（160）、>500 字符多行 commit message 全动作接受（174）、path-free blocker/proof 往返（186）、容忍旧 Host 缺 `returnToLocal`（215，注释：Client 与 Host 独立部署，新增能力位必须缺省为 false）、conflict continuation 往返（239）、checkpoint 严格+无内部 ref（264）、detached recovery proof 拒绝非法路径/字段/generation（294）、detached reason 往返（328）、`./typert` 自动发现（350）、sidebar 免 agent 派发 + locale 快照（367）、provider election 上报（392）、boot report 落 NDJSON 诊断（404）、非 owner 拒绝且无关资源 grant 不授权（426）、agent lookup 前置（453）、Client `$mount` 全链路+撤回（483）、业务/载体/malformed 三类错误分离（545，`malformed_response` 中文消息在 559）
- `describe('initial version Remote boundary')`（614）：preflight 只读、confirmation 独立方法、拒绝路径与畸形 token（615-633）

#### 其余 Host 套件

- `tests/concurrent-session-guard.test.ts`：`NOW`(18)/`WINDOW`(19)/`LOCAL_ROOT`(20)；`cwdWithinLocalRoot` 边界+win32 大小写（22-30）；`detectLocalBranchRace` 六场景（32-102，含 `managedBranches` 豁免 65、保守告警 91）；`describe('runtimeContext 集成（真实 git reflog）')`（104）中 `git()`（105）与 `createRaceContext(options)`（110-136，用真实 reflog 造 `feat/other-session`），验证 `refreshBranchRaceGuards` 后 `runtimeContext` 含 `Branch Race detected`/`worktree_create`（138-145），刷新前静默、guard 关闭始终静默（147-154）。
- `tests/git-tags.test.ts`：`testEnvironment()`（11-17）、`git()`（19）、`fixture()`（23-58，带真实 spawn 的 stdio 管道）。覆盖轻量/附注标签、指定 target、重名拒绝、git 拒绝名、删除、pushed 三态（无 remote 时为 `null`，行 77-79 注释）、push 失败为数据非异常（144-151）、仅删远端、graph 装饰保留 `tag:` 标记（167-178）。
- `tests/git-timeouts.test.ts`：终止宽限与查询 deadline 分离（9-29，`grace` 恒 1000ms）、三类 deadline 独立 + `Config` schema 默认值（31-50，行 39 注释：schemastery ≥3.18.4 把 volatile 字段包成 live reference 需解包）、非法值挂载前拒绝（52-58）、volatile 引用每命令重读（60-69）、挂载校验（71-75）、恰好五个 settings 可编辑字段 volatile（77-84）。
- `tests/git-unborn.test.ts`：`testEnvironment()`（17-23）、`git()`（24）、`fixture()`（27-50，支持 `hooks.beforeCommand` 钩子）。覆盖 identity 路径合并读取（53-70，断言 `--git-common-dir` 只出现一次）、含换行路径回退单次读（72-81，`it.skipIf(win32)`）、unborn 识别（84-88）、显式确认才 init（89-99）、四类文件+index 保护（101-114，`test.each`）、身份缺失/重试（115-126）、确认后到达文件与 ref 锁下到达文件（127-142）、仓库身份变化（143-150）、并发初始化串行（151-165）、非 Git/坏 ref 区分（166-172）、Host/module/control 全流程（174-199）、非法 HEAD（201-205）、发布前 HEAD/授权变化中止（206-225）、外部 index.lock 保持完好（226-238）、权限错误不算非 Git（240-248）、win32 专属长路径（253-310，`it.skipIf(platform !== 'win32')`，120s）、Skill 携带四连测（312/331/388/411/437）。
- `tests/git-creation-lifecycle.test.ts`：`it.each([true,false,'reject','successful-child'])` 超时静默树等待（11-70，行 12 注释 macOS `/var` 是 symlink；断言 `terminate` 一次、清理零次、仅 `quiescence===true` 回滚）；`.worktreeinclude` 只带被 ignore 且列入清单的文件（72-96，行 94 注释 `AGENTS.override.md` codex 语义自动带入）；脏 worktree 放弃前快照到 `refs/dsh-worktree/abandoned/<id>` 并可恢复成分支（98-133）。
- `tests/worktree-creation.test.ts`：`fixture()`（11-29，物理路径）。覆盖完整 detached checkout + 只释放自己的锁（30-36）、确认退出后回滚可重试（37-53）、八种残余保留不用 force 当删除权威（54-77）、不修复他人 checkout（79-89）、filter/gitlink 隐藏数据（91-115）、sparse checkout 文件集一致（117-131）、注册失败只删独占空目录（133-140）、拒绝删替换目录（142-157）、四种残余保留（159-184）。
- `tests/console-contract.test.ts`：`source(overrides)`（11-18）；`consoleStateFromDomain` 12 态投影含 discarded 保留前态（21-38）、`worktreeReachedDelivery` 完成语义（40-52，行 46-49 注释区分真交付与真放弃）、`worktreeConsoleErrorMeta` 四类恢复策略（54-75）、fixture 精确记录 finalize（77-97）。
- `tests/surface.test.ts`：`readyTarget`（7-28）；9 个模型工具名单（31-52）、list 输出无 undefined 值（54-83，行 58-59 注释 host 拒绝非 lossless JSON）、resume 自动失效当前 review（85-106）、next iteration 用最新 delivered revision（108-138）、`/worktree continue|next`（140-181）、finalize 用持久化评审消息（183-213）、deliver 工具（215-283）、create 移动 cwd 并上报 `cwdSelected`（285-331）、cleanup cwd 移出失败时中止（333-356）。
- `tests/host-i18n.test.ts`：`placeholders()`（7）；双语与占位符契约（10-17）、按调用语言渲染且 code 稳定（19-29）、不翻译插值数据（31-37）、仅识别的 legacy cleanup 消息投影期本地化（39-47）、注册元数据双语（49-55）、第三方错误原样透传（57-61）。
- `tests/host-locale-context.test.ts`：`deferred()`（12-16）、`settingsContext(preference)`（18-20）；只读公开 settings 且兜底（23-29）、重叠调用隔离与嵌套恢复（31-51）、偏好快照（53-62）；descriptor 尾参可选 locale（66-77）、Client 请求语言捕获（80-90）、显式 locale 不串扰并发（92-112）；工具/命令按 Agent ctx 快照（116-146）。
- `tests/host-query-budget.test.ts`：`traces` hoisted（12）+ `vi.mock('node:child_process')` 计时（13-21）；`test.each([1,3])`（23-98）度量真实 git 命令数，预算 `{ current: 18, list: 18 + 9*(count-1), preflight: 60, deliver: 90 }`（67，行 65-66 注释 deliver 74 次实测），并断言观察是新鲜的而非缓存（74-80）。
- `tests/i18n-catalogs.test.ts` / `tests/i18n-references.test.ts`：三目录双语+参数一致（catalogs 8-18）；引用护栏——`walk()`（10-15）、`literalKeys()`（20-26）、`CLIENT_CALL`/`HOST_CALL` 正则（28-29），扫描 `src/client` 的字面 `t("…")` 与其余源码的 `hostMessage("…")` 必须落在目录内（31-51，行 8-9 注释目录内部一致性由 catalogs 负责）。
- `tests/lookup.test.ts`：`LiveSessionFixture`（6-8）、`workspace()`（10-12）、`contextOf()`（14-34）；权威 workspace 投影（37-49）、cwd header 恢复冷会话（51-63）、冷/错配/无路径/歧义不恢复（65-82）、sidebar identity 含空 workspace 与 cold header 但不授予 `getSession` 权威（86-98）。
- `tests/working-directory-adapter.test.ts`：`fakeHost(initial, opts)`（9-27）、`ctxWith(service)`（29-31）；enter 移动并回报（34-42）、无服务降级 no-op 返回 `undefined`（44-50，行 46-47 注释）、current 对未知 session 返回 undefined（52-55）、leave 仅当在 checkout 内才还原（57-71）、仅前缀相同的兄弟路径忽略（73-77）。
- `tests/adapters-safe-file.test.ts`：`dirs`(7)、`scratch()`（8-12，`mkdtempSync('dsh-git-worktree-safe-file-…')`）、afterEach 递归清理（14-16）；最新可解析 tmp 残余晋升且其余清理（19-31）、legacy `<file>.tmp` 晋升（33-40）、全不可解析清空并返回 null（42-50）、原子写留 `.bak` 且损坏后可从 bak 恢复（52-64）、`writeTextFileAtomic` 整体替换（66-73）。
- `tests/project-skills.test.ts`：`fixture()`（10-19，`source/target/state` 三目录 + `.agents/skills/helper/SKILL.md`）；provenance 跨重启与修改检测（20-37）、不排除/不静默覆盖冲突文件（38-45）、provenance 发布失败保留副本并报 incomplete（46-56）、目录替换后拒绝复用 provenance（57-62）、Git ignore 也不许新资源（63-69）、junction 拒绝且不动目标（70-82）、64MB 上限（83-87）、win32 skip 权限保持（88-95）、空目录携带与后续内容保留（97-107）、skill 根本身是 tracked 占位文件（109-117）。
- `tests/project-skills-race.test.ts`：`race` hoisted（7）+ `vi.mock('../src/adapters/project-skill-io.js')` 在 `createSkillFiles` 前插入钩子（8-14）；父目录被换 junction 时拒绝且外部 sentinel 不动（21-45）。
- `tests/project-skill-provider.test.ts`：`fixture()`（15-23）、`list()`（24-27）、`text`（28）；真实上游解析 + 资源基 + cwd 隔离（29-42）、原生优先级 `project-dsh > project-agents > project-claude`（43-56）、项目外链接 Skill 根拒绝（57-66）、pending lookup 与 dispose 串行（68-90）。
- `tests/dev-dsh.test.ts`：`git()`（23）、`createHarnessRoot()`（27-38）、`sourceDshArgs()`（40-43）；默认参数（46-57）、隔离 home 的 dev cache（59-63）、Documents 留在隔离 home + patch 内容断言（65-82）、显式选项解析（84-103）、source runner 单次执行（105-114）、Harness 源码启动 cwd=projectRoot（116-138）、pin 的 pnpm（140-149）、平台 shim（151-153）、发现算法从 Local/linked Worktree 均命中 ready checkout（155-172）、`DSH_HARNESS_ROOT` 优先（174-179）、未准备源码给出可执行命令并拒绝构建（181-192）、非法端口/未知选项（194-199）、托管 fixture 创建（201-213）、占用路径 fail closed（215-223）、显式仓库只校验（225-235）、install 命令序列含 version 改写与 smoke、无 publish（237-294）、首 profile 初始化顺序（296-337）、源码 CLI 全程使用（339-388）、其他 profile 归档保留（390-435）、缺失归档自愈（437-481）、stale profile 报错且新旧归档都保留（483-520）。
- `tests/workspace-provider-lifecycle.test.ts`：`yaml`/`OFFICIAL`/`WORKTREE` 常量（13-18）、`entries(disabled)`（22-28，读真实 `cordis.patch.yml` 打补丁）、`boot(data, replayDisabled, delayedImport, childEntries, failApply, flavor, takeover)`（30-100，构造 4 个假包 + `ClientModuleRegistry` + 可 wedge 的官方 entry `update`）。29 个场景（103-309）：发布补丁不再 patch 官方 entry（103-107）、disabled Worktree 仍启动官方 Workspace（109-115）、未知 generation（118-122）、takeover 显式 opt-in 含 modern（124-134）、不复活用户禁用项（136-140）、替代序无关（142-152）、组禁用（158-165）、market disable replay（167-171）、延迟 import/Include（173-187）、live disable 不落盘标志（189-205）、restart 保留 fiber（207-216）、旧代清理不撤新 fiber（218-237）、激活失败回退官方（239-251）、用户显式禁用不被覆盖（253-264）、root dispose 不复活（266-277）、disable/re-enable 重启不写 patch（279-285）、wedge 官方 disable 不阻塞替代激活（287-297）、慢 disable 落在激活后（299-309）。

### Client 端测试套件（jsdom）

- `tests/client-actions.test.ts`：`services(byId, projectedCwd = 'workspace-path')`（12-45，手写 `WorktreeClientServices` 含可订阅 list）；12 场景（47-227）：mainView-retained finalize（48）、多 main 拒绝（64）、新 Harness 用 `uiWorkspace.openSession` 且校验 cwd（78）、无导航服务抛「会话导航服务」（88）、打开既有 target 不重建 Workspace（94）、cwd 不一致 fail closed（109）、source cwd 匹配才开（121）、授权 slot holder 先 inspect 验证（131）、inspect 在途时 caller 失活不导航（159）、身份不一致拒绝（180）、`prefillSessionDraft` 只填草稿不发送（194）、新建后 cwd 重投影复验含 fake timers 2s 超时（205-227）。
- `tests/client-branch-overview-cache.test.ts`：`overview(branches)`（16-24）、afterEach `invalidateBranchOverview`（26-28）；6 场景（31-130）：后台 flight 不覆盖乐观 patch（31）、flight 中失效不回填（57）、无并发变更正常回填（75）、失败 flight 清槽不回陈旧快照（83，行 97 中文注释）、`!ok` 也清槽（102）、失败不清 mid-flight patch（116）。共同技巧：`vi.spyOn(Date,'now')` 把 fetchedAt 拨旧 61s 触发 stale-while-revalidate（35）。
- `tests/client-bundle.test.ts`：`beforeEach` 用 `transferableAbortController` stub 全局 AbortController（11-16）；`gatewayClient()`（20-25）、`mountAccess()`（27-32，行 28 注释：无 owner 快照/直播流时官方 UI 应答恒 false）、`ClientHandoff`（35-38）、`platformRequire()`（40-43，UI primitives 用空对象顶替）、`executeBundle(code)`（49-59，假 `window.__ModuleLoader__`）、`configFormsStub()`（62-71）。测试：产物 require 白名单恰好 5 项（74-84）、注册 package id `dsh-git-worktree` 与 inject 列表（86-112，行 104-111 注释解释排除 `remote.directoryPicker`/`remoteAccess` 的死锁事故）、uiWorkspace 先于 conversation 装配且随 fiber 撤销（114-216，含 style `data-plugin` 归属断言 191-195）、modern Host picker 等 uiWorkspace 且懒解析（218-292）、Lucide 按需打包而 React 留宿主（295-303）。
- `tests/client-conflict-display.test.tsx`：`files`（10，5 个超长文件名）、`conflictFixture()`（12-21）；紧凑冲突卡 + 详情弹层 + 无预览按钮（25-51）、busy/capability 禁用 + 英文 compact 一致（53-69）。
- `tests/client-console-remote-routing.test.ts`：`spies` hoisted（3-8）+ 三个 `vi.mock`（9-16）；`clientContext(legacy)`（22-32）；`describe('one Host-pinned Browser provider per Client startup')`（38）：`test.each` legacy/alpha/next 各注册自己的 Browser（39-55，断言 inject 序列 50-54）、未知 Host 不注册（57-63）、官方 Workspace live 时 decorate 而非 replay（65-74）、错配/不可识别在注册前失败（76-82）。
- `tests/client-i18n.test.tsx`：`localeFace(active)`（18-27，可变 locale face）、`evidence`（29-33，含中文 reviewId/文件名）、`Counter`（35-39）；9 场景（41-141）：读 `snapshot.active` 而非猜属性（42-49，含 throw 面）、订阅切换不重置本地状态（51-62）、两个实例不共享语言（64-71）、目录参数与英文文案完整性（73-82）、工具态/解析诊断用当前翻译（84-90）、评审标题切换且用户数据不动（92-106）、命令式动作每次调用读 locale（108-115）、入口注册传真 locale face（117-131）、侧栏投影只译插件徽章（133-141）；英文恢复提示保留 ID/hash/JSON 路径（144-160）。
- `tests/client-polling-diagnostic.test.tsx`：行 2 注释 **Issue #6 regression**；`services()`（11-22）；`for (const consumers of [1,2])` 双消费（26）；单测试断言 30 秒内 `current` 只发 1 次共享请求、peak pending 1（27-65），刷新事件在共享请求在途时合并（57-58），unmount 后不投递（59-62）。
- `tests/client-pre-session.test.tsx`：样式回归断言（16-28，断言 `WORKTREE_STYLES` 中 28px/13px/透明边框与 `--dsw-alias-*` 变量）；`isolatedTarget()`（30-49）、`successFixture()`（51-137，返回 `{adapter, events, services, sourceActions, target, targetInput}`，全流程事件记录到 `events` 数组）；`describe('Pre-session Worktree preparation')`（141-450）：agentPreset 透传（142）、无 binding on create 时经 `sessions.using` 保留 target（156）、打开失败保住源草稿（186）、完整事件序列（199-229，含 `block:set → remote:create → workspace:create → session:create → target:draft → … → session:archive → block:clear`）、新导航契约交 UI Workspace（231）、无兼容导航不建 checkout（246）、归档失败不影响 target 可用（261）、Host create 失败零副作用（282）、Session 创建失败时经 source caller 丢弃 reservation（302-337）、附件被拒时 Discard 目标（339）、两次 Discard 失败保留可恢复目标（361）、确认后草稿变化回滚（381）、重复点击合并（413）、未解析引用 chip 提前失败（437）；`describe('Pre-session directory menu')`（452-793）：注册 seat/id/order（457）、rc.1 hooks 渲染与禁用矩阵（478）、attachmentIds 迁移（528）、快照失败可重试（565）、仅 blank Session 显示（585）、等仓库探测（616）、非 Git 隐藏（637）、确认后才 create（661）、取消不改动草稿（702）、初次查询失败重检（730）、失败可重试+alert（768）；英文确认弹层（795-818）；`describe('Worktree switch preflight and session ownership')`（820-978）：`localFixture()`（821）、`chooseWorktree()`（835）、原生 button switch + Escape 恢复（840）、空仓库初始提交需显式同意（861）、取消不写且有文件则阻塞（876）、token 消费后需新 preflight（895）、preflight 合并+换 Session 丢弃 stale 结果（916）、三种回滚形态报告持久化初始提交（933-953）、真实 controller 准备期间切 Session 回滚（955-977）。
- `tests/client-preview-recovery-cache.test.ts`：`identity`（8-14，五元组）、`assessed(generation)`（16-47，完整 proof）；identity 键控 single-flight（50-63）、自动错误入缓存+显式失效换新 generation（65-79）。
- `tests/client-recovery-continuation.test.ts`：`runtime(target, initial)`（18-76，`running/openState/removed/newSelection` 可变快照 + `prompt` spy）、`conflictRequest(revision, suffix)`（78-89）、`authorizedTarget()`（91-112）、`regenerationRequest()`（114-123）、afterEach 清 `localStorage['dsh-git-worktree:recovery:v1:target-session']`（125-128）；15 场景（131-420）：等 idle open owner 且只发一次（131）、mainView-retained 才发+选择变化取消（157）、checkout/revision/kind 不匹配 fail closed（172）、Harness Session 变化取消（184）、React scope 失活取消 queued（199）与中止 sending（216）、切换中止（237）、失败保留供显式重试不重复 Host mutation（257）、取消后可显式重试（277）、新请求顶替旧请求（308）、renderer teardown 后恢复未发送请求（328）、模糊 sending 不自动重放（348，断言「结果未知…显式重新发送」）、不安全冲突路径在持久化前拒绝（369）、伪造 kind 拒绝（384）、regeneration 只读且需原 review 身份（405）。
- `tests/client-review-console.test.tsx`：`review(overrides)`（23-36）、`identity(revision=7)`（38-40）、`clientServices(byId)`（42-60）、`previewTarget()`（62-80）、`loggedReviewRow(adapter)`（82-103，从 argsRaw/content JSON 组装 ToolView block）；`describe('Domi-style Worktree Review')`（105-734）：28 个场景（行号 106/118/143/162/181/191/201/220/232/281/331/360/375/389/410/426/451/486/497/535/550/567/603/631/656/678/706/729），要点：验收卡只有结果与可折叠详情（106）、菜单展开方向 CSS（118-141，解析 `WORKTREE_STYLES` 规则）、Escape/外点关闭（143）、默认只展示中文摘要且防 XSS `img`（162-179）、200 文件只显示数量（181）、身份不匹配 fail closed（191）、Ready 自动只读预检 + 主操作写前强制重检（201）、同 identity 共享预检（220）、冲突需显式点击后 `Session.prompt` 单飞续跑（232）、Preview 竞态结构化 continuation（281）、checkpoint generation-bound requestId（331）、Preview active 保存由 Host 先恢复（360）、跳过预览保存 retention 确认（389，行 400 注释默认保留环境）、finalizePreview vs finalize（410）、超长建议值全链路保持（426/451）、撤回预览（486）、Detached 只按 Host proof 显示操作（497-533）、放弃需先 rollback（535）、stale_local 刷新不废 Review（550）、stale isolated 经 `Session.prompt` 重生成（567）、验收位释放自动重检（603）、busy path-free 摘要 + inspect/cwd 打开占用者（631）、delivery proof（656）、ToolView 与 dock 同一状态刷新事件（678/706）、无 Console 时回放紧凑证据（729）；英文弹层切换不改用户输入（737-758）、排队反馈翻译不重复动作（760-772）；顶层「撤回-刷新-再保存同一 review」（776-791）。
- `tests/client-review-details.test.tsx`：只读详情无 diff/交付按钮 + 焦点环（14-38）、四种真实验证状态（40-46）、预览/恢复/冲突/语言切换全来自当前数据（48-64）、不开工具记录即可打开且只读调用（66-74）、Lucide 图标与长文本滚动（76-88）、5 项折叠阈值（90-103）、`longReviewTarget()`（105-111）+ 独立展开/收起（113-134）、四种变化后恢复默认折叠（136-156）、英文切换保留展开状态（158-167）、菜单语义图标不重复（169-179）。
- `tests/client-settings-card.test.tsx`：`makeScope(overrides, mutate)`（15-34）、`renderCard(scope, view)`（36-55，行 40 注释：镜像 slot 运行时的绑定）、`saveButton()`（57）；五行渲染且未编辑禁用保存（59-73）、布尔编辑 fenced 到读 revision（75-87）、非法数字阻塞保存（89-96）、summary 视图一行简介（98-103）。
- `tests/client-target-console.test.tsx`：`SlotEntry`（19-23）、`class SlotsDouble implements TargetConsoleContextLike['slots']`（25-53，字段 `entries`/`injectedDisposers`，方法 `inject`(29)/`register`(34)/`dispose`(50)）、`localTarget()`（55-90）、`clientServices()`（92-121）、`summaryOf()`（123-126，剥离四个路径字段）、`renderConsole()`（128-134）；六大 describe 共 50+ 场景：Header 胶囊（138-970，含 current 失败 tooltip 暴露错误码 141-152、状态映射 test.each 154-169、非 Git 专用文案 173-205、注册/释放 Header action 207-230、首展开才拉 gitOverview 232-243、分支 >12 出搜索框 245-288、标签全套 302-518、跨 Session 丢弃旧请求 520-542/624-647/649-677、快捷面板 544-571、owner lifecycle 二次确认 573-622、detached/recovery dock 解释 717-801、delivered 隐藏 dock 819-903、hero chip portal 940-969）；加载/检查（972-1041）；Create/Open（1043-1299，含只创建一次 1064、换 Session 丢弃 A 的 create 结果 1098、卸载不导航 1141、拒绝 source 别名 target 1162、Workspace 路径不一致 fail closed 1189、非预期 Session ID 1204、capability 撤销不开 1219、先 inspect 后开 authorized root 1282）；Client entry 集成（1301-1406）；guarded mutations（1408-1540，含 revision CAS 用响应值而非乐观自增 1458、stale 刷新不重放破坏性动作 1488、capability 允许才重试清理 1510）；顶层（1542-1707，含撤回-刷新-再预览 CAS 1555、验证状态真实标签 test.each 1573、pending preview 共享状态 1585、只有显式继续才 resumeRevision 1600、撤回失败不伪造 ready review 1613、迟到结果不污染他 Session 1631、延迟快照不回退 revision 1649、Lucide 图标 1667、管理弹窗单标题 1679、list 过滤开关 1695）。
- `tests/client-toolview.test.tsx`：`services()`（11-53，记录 `opened`/`commands`）；创建卡注册 managed root 并打开精确保留 Session（56-81）、已选 cwd 撤掉打开按钮（83-109，行 103-104 注释）、Local `target_unselected` 错误不渲染卡片（111-145）、非 Local 错误保持可见（147-164）、无 live adapter 时回放证据且禁用 mutation（166-202）。
- `tests/client-workspace-sidebar.test.tsx`：`state()`（25-48）、`adapter()`（50-67，覆写 `sidebarTopology`）、`browserProps(snapshot)`（69-82）、`InspectBrowser`（84-114，暴露 8 个动作按钮 + `__dshGitWorktree` 数据属性）；Mode A（116-275）：单棵官方声明树（117-151）、topology 验证前阻塞官方快捷变更（153-186，含 unmount 后 `guard.ready` 复位）、owner 投影 + rename/archive 放行 + fork/move/start 静默拦截（188-225，断言零 `window.alert`）、归档 owner 重投影（227-254）、topology 不可用回退官方投影（256-275）；顶层徽章切换（278-288）、历史成员归 Local（291-311）；Mode B `registerDecoratedWorkspaceSidebar`（313-508）：`fakeRegistry()`（314）、`decorateCtx()`（330）、经子 seat 装饰不遮蔽 Browser（341-366，行 348-352 注释 DSH 0.2.x 只有两个 row seat）、badge 渲染/清空/事件刷新（368-410，行 403-405 注释 chip 只显示状态词、分支留 tooltip）、双 seat 镜像 identity mark（412-442）、slot registry 缺失 fail loudly（444-452）、清徽章菜单挂载/路由 RPC（454-508）。
- `tests/client-workspace-sidebar-model.test.ts`：`workspace()`（9-15）、`session()`（17-19）、`topology()`（21-27）；投影（29-247）：owner 直入 Local 项目并删 UUID Workspace 行（30-59）、七态中文标签映射（61-96）、badge 带任务分支名（98-123）、抑制可证明 blank launcher（125-147）、意外第二 Session 不隐藏（149-170）、归档/选中/未解析成员矩阵（172-194）、未知 blank 标志不阻塞分组（196-210）、多 owner 无歧义（212-224）、清理后历史 owner 留 Local（226-246）；Host-proven membership（250-301）：合并空 Workspace/未知 launcher/冷会话且不删摘要（252-268，断言输入不被改写 266-267）、选中的 blank 留 Local（270-280）、不偷手工记账会话也不凭目录名猜（282-291）、多项目争claim fail open（293-301）。
- `tests/client-workspace-sidebar-profile.test.ts`：`strictSlotLedger()`（14-33，重复声明即抛）；官方 pin/rename/archive 保留 + fork 保护（36-85）、loader 不打补丁 + 派生归属清单（86-98，断言 `cordis.patch.yml` 不含 `dsh-client-ui-workspace`/`!!js`/`disabled:`，含 `dsh-git-worktree` insert）、真实 Branch Icon + 独立 Badge（100-134，对生成源码逐串断言）、modern/alpha/next 三派生的 seam 校验（136-194，缺 seam/重复 seam 抛错）、next 子 seat 授权树（196-206）、官方 slot 树只声明一次（208-223）。
- `tests/client-workspace-sidebar-status.test.tsx`：`labels`（10-13，七态中文）、`loadRow(source)`（18-41，替换 `exports.apply` seam 注出 `TestRow` + primitives Proxy）、`variants`（43-47）、`renderRow()`（49-62）；`describe.each(variants)`（64-95）：working 徽章与原生运行态并存（66-83，行 68-69 注释 upstream 594298b 隐藏了 working 徽章而本 fork 显示）、七态徽章不变（84-89）、普通 Session 不装饰（90-95）。
- `tests/client-workspace-sidebar-actions.test.ts`：`officialApply(source)`（16-27）、`variants`（29-33，alpha/next/modern 三派生）、`Guard`（35-39）、`WorkspaceNavigation`（40-47）、`ActionInjection`（48-51）；行 55 注释：jsdom 24 缺 `AbortSignal.any` 故 stub；三变体共享测试（54-146）：官方 rename/archive/unarchive 回调照走、fork managed 抛 `/managed Session/`、ordinary fork 透传、`startSession` 对 managed workspace 不触发 `openWorkspace(Sesssion)`、guard 未 ready 时全阻塞、modern 额外断言 `allowMigration`/`session-id` descriptor、非 alpha 断言 `stopAndArchiveSession('owner', {stopActivity:true})`。

### 合同 / 交叉层测试

- `tests/client-bundle.test.ts` 与 `tests/workspace-provider-lifecycle.test.ts` 共同把「发布产物」当被测对象（读 `lib/client.js` 与 `cordis.patch.yml` 真实文件）。
- `tests/i18n-catalogs.test.ts` / `tests/i18n-references.test.ts` 双护栏见上。

## Architecture

```text
┌────────────────────── tests/support 共享测试基座 ──────────────────────┐
│ worktree-console.ts        → Console adapter 假实现（calls 全量记录）    │
│ production-adapters.ts     → 真实 Node git/files/AtomicJson registry   │
│ official-client.ts         → 官方 browser bundle 加载器          │
│ ui-primitives.tsx · review-actions-harness.tsx · official mock ×2    │
└──────────┬──────────────────────────────────────────┬────────────────┘
           ▼                                          ▼
┌─ Host 集成测试（node 环境）──┐        ┌─ Client 测试（jsdom + RTL）────────┐
│ session-checkout-module      │        │ client-pre-session / review-console │
│ session-checkout-apply       │        │ client-target-console / toolview    │
│ console-host / console-remote│        │ client-workspace-sidebar* / bundle  │
│ git-* / worktree-creation    │        │ client-i18n / actions / polling …   │
│ surface / host-* / lookup    │        └──────────────┬──────────────────────┘
└──────┬───────────────────────┘                       ▼
       ▼                              官方包真身：@deepseek-ai/dsh-api-gateway
 spawn/spawnSync('git') + mkdtemp     client-console-remote-routing 用 vi.mock
 临时 Git 仓库，afterEach rmSync      拦截 src/client/*（行 3-8 的 spies）
```

## Data Flow

**Host 域测试的典型流**（以 `session-checkout-module.test.ts` 为例）：

```text
createContext(options) ─► mkdtemp 真实 git 仓库
      │  （git / gitDated 造基线；dependencies 注入暂停/故障钩子）
      ▼
module.bind / createIsolatedTarget / markReadyForReview / operate / …
      │  （内部经 production-adapters 的 AtomicJsonCheckoutRegistry
      │    写 configDir/managed-checkouts.json，经 git 端口跑真实 git）
      ▼
expect(...)  ──  直接断言：仓库 ref/HEAD、registry JSON、runtimeContext 文案
      ▼
afterEach: temporaryRoots.splice → rmSync(recursive, force)
```

**Client 测试的典型流**：`createWorktreeConsoleAdapterFixture()` → （可选）覆写 adapter 方法为 `vi.fn` → `render(<组件/>)` → `fireEvent`/`waitFor` → 断言 `fixture.calls` 中的精确 `{method, request}`（如 `client-target-console.test.tsx:709-714` 断言 preflight/preview 请求体逐字段相等）。stateful fixture 的 CAS 流：请求 `expectedRevision` 必须等于当前 `target.revision`（`worktree-console.ts:522`），成功后 revision 由 Host journaling 语义推进 `+3`（526），调用方必须改用返回身份——这复刻了 `client-target-console.test.tsx:1555-1570` 断言的 `[7, 13]` 序列。

**远程链路流**（`console-remote.test.ts:483-543`）：假 `host.typertGateway.invoke` ← `client.remote.$mount(WORKTREE_CONSOLE_REMOTE)`，`call` spy 把 `/api` + `gitWorktree/<method>` 转发回 Host gateway；`dispose()` 后 `client.remote.gitWorktree` 消失且旧引用得到 `gateway/internal`。

## Connections

- Host 核心被测物：[[session-checkout-module]]（创建/绑定/交付/迭代/清理/恢复）、[[session-checkout-apply]]（ApplyEngine 的 plan/apply/finish/preview/rollback/finalize/assess/recover）。
- Console 层：[[console-contract]]（状态投影与错误元数据）、[[console-host]]（控制面 + review-diff 预算）、[[console-remote]]（strict Typert 描述符与 `WorktreeConsoleService`）。
- 适配器：[[adapters-git]]（`createDshGitPort`：unborn/标签/超时/创建回滚均测其真实行为）、[[adapters-safe-file]]（原子 JSON/txt 写）、[[adapters-project-skills]]（Skill 快照/携带/provenance）与 [[adapters-lookup]]、[[adapters-working-directory]]。
- Client 层：[[client-actions]]、[[client-i18n]]、[[client-review-console]]、[[client-target-console]]、[[client-workspace-sidebar]]（Mode A/B 与三份官方派生）、[[client-pre-session]]。
- 平台机制：[[workspace-provider-lifecycle]]（`mountWorkspaceProviderLifecycle` 选举）、[[surface-tools]]（`registerTools`/`registerWorktreeCommand` 公开面）、[[concurrent-session-guard]]、[[i18n-catalogs]]、[[dev-dsh]]（本地 DSH 开发工作流脚本）。
- 共享假体反向支撑：[[support-worktree-console-fixture]] 是全部 client-*.test 的唯一 adapter 来源（引用见各文件第 7-17 行 import）。

## Known Issues

以下均为测试注释中**显式记录**的产品回归/约束（附位置）：

1. **Issue #6（轮询风暴）**：`tests/client-polling-diagnostic.test.tsx:33` —— display observers 必须共享一次有界请求；30 秒内多个消费者只允许 `current` 被调 1 次（27-65）。
2. **胶囊分支标签丢失**：根因是 Worktree 停在 detached HEAD（`tests/session-branch-label.test.ts:26-34` 注释完整机理）；创建即建会话分支后端到端必须给出 `feat/sess-owner--labels`（113-117）。
3. **交付误写他人分支**：Local 停在另一会话分支时旧实现会分叉并写回同一条分支（`tests/session-branch-delivery.test.ts:25-31`）；现在交付只写 `feat/sess-owner--<topic>` 且 Local 字节不动（141-146）。
4. **legacy detached 记录交付失败**：修复前创建的记录无 `sessionBranch`，交付时会补建分支并回填记录（`tests/session-branch-adopt.test.ts:25-31, 144-147`）。
5. **慢胶囊（chip 慢）**：`current` 曾对同一记录重复三连 `git` spawn，占每次 5s 轮询的三分之一（`tests/console-host.test.ts:1273-1277` 注释）；现在复用 caller inspection，registry revision 推进才重观察（1296）。
6. **隐藏标签页的轮询开销**：隐藏 GUI 每次轮询仍花 Host 一个 `git status` + 两个 `git rev-parse`（`tests/current-polling.test.ts:120-122` 注释），故 `visibilitychange` 时挂起循环（129-132）。
7. **`remoteAccess` 静态注入死锁**：桌面 profile 经 junction 在 0.2.0-rc.2 加载 bundle，静态声明导致 web boot 永久 pending（"14 entries did not activate", 2026-10-17）（`tests/client-bundle.test.ts:107-111` 注释）；同理 `remote.directoryPicker` 需等 `uiWorkspace`（104-106）与 `uiConversation` 需在 `uiWorkspace` 之后（172-175）。
8. **upstream 594298b 隐藏 working 徽章**：本 fork 刻意恢复显示（`tests/client-workspace-sidebar-status.test.tsx:68-69` 注释），因为运行中的任务正需要说明自己在做什么。
9. **Mode B 的 slot seat 约束**：DSH 0.2.x 只声明 `sidebar.session.row.leading/hover` 两个 seat，注入不存在的 trailing seat 会永远等待（`tests/client-workspace-sidebar.test.tsx:349-352` 注释）；遮蔽 Browser 也无法重新声明子 seat（347-348）。
10. **provider 选举归属**：发布补丁不再 patch `@deepseek-ai/dsh-client-ui-workspace`，选举由 Host 生命周期拥有（`tests/workspace-provider-lifecycle.test.ts:103-107`；`tests/client-workspace-sidebar-profile.test.ts:92-98` 断言 patch 文件无 `!!js`/`disabled:`），且 takevoer 必须显式 `enableWorkspaceProvider`、modern host 上非 advisory（124-134）。
11. **非 Git 项目不是故障**：`not_git_repository` 与探测故障共用「不可用」会让正常会话看起来坏掉（`tests/client-target-console.test.tsx:171-172` 注释），故胶囊给专用文案 + 初始化入口（173-205）。
12. **current 失败 tooltip**：只显示「不可用」无从诊断，tooltip 必须带真实 `code: message`（`tests/client-target-console.test.tsx:139-141` 注释 + 150-151 断言）。
13. **Windows 专属路径**：长路径 checkout 仅 win32 测（`tests/git-unborn.test.ts:253`，`it.skipIf(platform !== 'win32')`，120s）；含换行路径回退在非 win32 跳过（72）；文件模式/符号链接 Apply 用例在 win32 跳过（`tests/session-checkout-apply.test.ts:1225, 1241`）；可执行权限用例同样 `skipIf(win32)`（`tests/project-skills.test.ts:88`）。
14. **jsdom 24 缺 `AbortSignal.any`**：用 Node 的 `transferableAbortController` stub 全局（`tests/client-workspace-sidebar-actions.test.ts:55-58`；`tests/client-bundle.test.ts:11-16` 同法）。
15. **worktree remove 超时**：Windows 删 ~1GB/6 万文件私有依赖树 10 秒不够（`tests/support/production-adapters.ts:51` 注释），故 `getSessionCheckoutGitTimeoutMs` 给 5 分钟（51-55）；git-timeouts 测试另断言终止宽限恒 1000ms 与查询 deadline 解耦（`tests/git-timeouts.test.ts:9-29`）。
16. **registry 损坏 fail closed**：v2 校验失败的 `managed-checkouts.json` 抛 `registry_corrupt` 停止访问（`tests/support/production-adapters.ts:505`），v1 由 `migrateLegacyRegistry`（436-491）自动迁移。
17. **超时配置集中**：Apply 重型用例依赖 `vitest.config.ts` 的 30s 全局超时（`tests/session-checkout-apply.test.ts:22-24`），Module 用例为 60s（`tests/session-checkout-module.test.ts:62`）。
18. **交付延迟不再写 Local**：`preview` 属旧写回路径会被明确拒绝，预算测试度量其替代者「会话分支提交式交付」（`tests/host-query-budget.test.ts:87-89` 中文注释）。
