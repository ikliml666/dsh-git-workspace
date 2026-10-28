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
  - tests/support/commit-message.ts
  - tests/support/official-client.ts
  - tests/support/production-adapters.ts
  - tests/support/review-actions-harness.tsx
  - tests/support/ui-primitives.tsx
  - tests/support/worktree-console.ts
  - tests/surface.test.ts
  - tests/working-directory-adapter.test.ts
  - tests/workspace-provider-lifecycle.test.ts
  - tests/worktree-creation.test.ts
tags: [tests, vitest, fixtures, git, worktree, react, jsdom, i18n, cordis]
---

## Overview

`tests/` 是 `dsh-git-worktree` 插件（一个 Cordis 插件，为 DSH Host/Client 提供受管 Git Worktree 全生命周期）的完整 Vitest 测试套件。它不包含任何生产逻辑，但通过 `tests/support/` 下的共享基座文件为全部 50+ 个测试文件提供确定性的假件、真实子进程装配与浏览器产物加载器。

套件分四个层次：

1. **宿主域单测/集成**：`git-*.test.ts`、`session-checkout-*.test.ts`、`session-branch-*.test.ts`、`worktree-creation.test.ts`、`concurrent-session-guard.test.ts` 等，多数直接调用真实 `git` 二进制操作临时目录（`mkdtemp`）。
2. **Console 宿主/远程契约**：`console-host.test.ts`（1805 行，控制面全行为）、`console-remote.test.ts`（Typert 严格 schema 与网关分发）、`console-contract.test.ts`（状态投影）。
3. **客户端 UI**：`client-*.test.tsx` 全部使用 `// @vitest-environment jsdom`（如 `tests/client-bundle.test.ts:1`）+ `@testing-library/react`，直接渲染 `src/client/**` 的 React 组件。
4. **横切面**：i18n 目录完备性（`i18n-catalogs.test.ts`、`i18n-references.test.ts`）、Host 查询命令数预算（`host-query-budget.test.ts`）、开发脚本（`dev-dsh.test.ts`）、Workspace Provider 生命周期（`workspace-provider-lifecycle.test.ts`，用真实 Cordis Loader）。

## Key Components

### 一、共享测试基座（`tests/support/`）

#### `tests/support/worktree-console.ts` — WorktreeConsoleAdapter 确定性假件

| 符号 | 行号 | 用途 |
| --- | --- | --- |
| `WorktreeConsoleFixtureMethod` | 53 | `keyof WorktreeConsoleAdapter`，记录调用的方法名类型 |
| `WorktreeConsoleFixtureCall` | 55-58 | 接口：`method`（56）、`request`（57，`unknown`） |
| `readyTarget()` | 60-111 | 构造标准 `WorktreeConsoleTargetDetails`（见下） |
| `outcome<T>(value)` | 113-115 | 包成 `{ ok: true, value }` |
| `WorktreeConsoleAdapterFixture` | 117-121 | 接口：`adapter`（118）、`calls`（119）、`target`（120，经 533 行 getter 暴露可变目标） |
| `createWorktreeConsoleAdapterFixture(stateful = false)` | 124-534 | 全量 adapter 假件工厂 |

`readyTarget()` 的完整字段（行 62-110）：`project: { id: 'project-1', name: 'Fixture Project' }`、`checkoutId: 'checkout-1'`、`sourceSessionId: 'source-session'`、`ownerSessionId: 'target-session'`、`targetSessionId: 'target-session'`、`iteration: 1`、`revision: 7`、`state: 'ready_for_review'`、`phase: 'ready'`、`dirty: true`、`currentOid: 'b'.repeat(40)`、`sourceOid: 'a'.repeat(40)`、`currentBranch: null`、`commitOid: null`、`sourceBranch: 'main'`、`managedRoot: '/fixture/project-worktrees/checkout-1'`、`sourceRoot: '/fixture/project'`；`capabilities`（79-96）：`create:false, open:true, inspect:true, discard:true, preflight:true, preview:true, checkpoint:true, resumeRevision:true, rollbackPreview:false, finalize:true, finalizePreview:false, setRetention:false, setPermanent:false, retryCleanup:false, beginNextIteration:false, returnToLocal:false`；`checkpointGeneration: '9'.repeat(64)`（97）；`review`（98-109）：`reviewId 'review-1'`、`revision 7`、`iteration 1`、`preparedAt 1`、`summary 'Fixture review'`、`validationStatus 'passed'`、`validationSummary 'focused tests passed'`、`tests [{command:'pnpm test', status:'passed'}]`、`changedFiles ['src/index.ts']`、`suggestedCommitMessage 'fix: fixture review'`。

`createWorktreeConsoleAdapterFixture` 内部：`calls` 数组（125）+ `record()`（127-129）记录每次调用；`delivered()`（130-170）派生交付态（`state:'delivered'`、`phase:'discarded'`、`commitOid 'c'.repeat(40)`、`deliveryProof` 含 `localHeadBefore/After` 与 `commitInLocalHistory:true`）；`tags` 可变标签数组（173，注释「Mutable tag state: the tag UI reads it back after every mutation」）。Adapter 方法表：

| 方法 | 行号 | 返回要点 |
| --- | --- | --- |
| `sidebarTopology` | 176 | `{ projects: [], workspaceClientFlavor: 'legacy' }` |
| `current` / `list` / `inspect` | 180 / 184 / 196 | 返回当前 `target` |
| `create` | 188 | `{ target, targetSessionId: target.ownerSessionId, managedRoot }` |
| `initializeProject` | 192 | `true` |
| `reviewDiff` | 200 | 单个 modified patch `@@ -1 +1 @@` |
| `preflight` | 209 | `status:'ready'`，`baseStrategy:'recorded_base'` |
| `previewRecoveryPreflight` | 220 | `assessed` + 64 位 `generation`/`receiptFingerprint`/`localFingerprint` proof |
| `preparePreviewRecoveryAnalysis` / `createPreviewRecoveryHandoff` | 246 / 254 | 携带 `recoveryContinuation` |
| `preview` | 267 | `preview_active`，`revision+1`，能力位翻转 |
| `checkpoint` | 276 | `checkpoint-1`/`sequence 1`，target 回 `working` 且 `revision+3` |
| `resumeRevision` | 313 | `working`，`revision+1`；有 `conflictContinuation` 时回填 `requestId:'host-authority-conflict-1'` |
| `prepareReviewRegeneration` | 345 | `worktree_review_regeneration` continuation |
| `rollbackPreview` | 359 | `resumeRevision:true` → `working`，否则回 `ready_for_review` |
| `discard` / `finalize` / `finalizePreview` / `retryCleanup` / `clearSidebarBadge` | 372 / 376 / 380 / 392 / 396 | `delivered()` |
| `setRetention` / `setPermanent` | 384 / 388 | 透传 |
| `beginNextIteration` | 400 | `checkoutId:'checkout-2'`，`iteration+1`，`revision+2` |
| `returnToLocal` | 423 | 回 `local` 态 |
| `gitOverview` / `gitGraph` / `gitCreateBranch` / `gitSwitchBranch` | 447 / 460 / 464 / 468 | 分支总览与图 |
| `listAbandoned` / `restoreAbandoned` | 472 / 476 | 空快照 / 恢复分支名 |
| `gitListTags` / `gitCreateTag` / `gitDeleteTag` / `gitPushTag` | 480 / 487 / 502 / 509 | 对 `tags` 数组做可变读写（重名返回 `git_operation_failed`） |

`stateful` 模式（518-532）：包装 `preview/rollbackPreview/resumeRevision/finalizePreview` 四个写方法，若 `request.expectedRevision !== target.revision` 返回 `stale_target`（522）；成功后 **硬编码 `result.value.target.revision = target.revision + 3`**（526，注释「Host journaling and completion each advance CAS」）。

#### `tests/support/production-adapters.ts` — 生产级 Node 依赖装配（真实 git 子进程）

| 符号 | 行号 | 说明 |
| --- | --- | --- |
| `NodeSessionCheckoutOptions` | 23-31 | 字段：`configDir`（24）、`lookup`（25）、`worktreesRoot?`（26，string 或 LiveValue）、`autoDeliver?`（27）、`autoPush?`（28）、`branchRaceGuard?`（29）、`branchRaceWindowMs?`（30） |
| `GitCommandResult` | 33-37 | `code`/`stdout`/`stderr` |
| `GitCommandOptions` | 39-41 | `hooksPath` |
| `GIT_COMMAND_TIMEOUT_MS = 10_000` | 47 | 普通命令超时 |
| `WORKTREE_REMOVE_TIMEOUT_MS = 5 * 60_000` | 48 | 删除大依赖树专用（注释引 Windows 1GB/6 万文件） |
| `getSessionCheckoutGitTimeoutMs(args)` | 51-55 | `worktree remove` 走 5 分钟，其余 10 秒 |
| `measureDirectoryBytes(path)` | 57-65 | 递归求字节；符号链接计 0 |
| `removeEmptyDirectoryTree(path)` | 67-76 | 仅删空目录树，失败返回 false |
| `inspectDirectoryIdentity(path)` | 78-87 | 返回 `DirectoryIdentity{device, inode, birthtimeNs}`（bigint lstat） |
| `directoryIdentitiesEqual` | 89-91 | 三字段全等 |
| `quarantineDirectoryTree(path, expectedIdentity, quarantinePath)` | 93-113 | 要求同父目录且 quarantine 未占用；rename 后复验身份，不符则尝试回滚 rename 且**绝不删除**（109-112） |
| `removeDirectoryTree(path)` | 115-127 | `rm` 递归，`maxRetries` win32 为 6 否则 2，`retryDelay:150`（124-126） |
| `runGit(cwd, args, options)` | 129-191 | spawn `git --no-pager --no-optional-locks -c core.quotePath=false -c core.fsmonitor=false -c core.hooksPath=…`（135-156），env 强制 `GIT_OPTIONAL_LOCKS=0 / GIT_TERMINAL_PROMPT=0 / LC_ALL=C`（148-154）；超时 SIGKILL 并以失败结果返回（181-188） |
| `runGitChecked` | 193-202 | 非 0 抛 `SessionCheckoutError('git_operation_failed')` |
| `checkoutRefRoot(checkoutId)` | 204-207 | `sha256(checkoutId)` 前 24 hex → `refs/dsh-worktree/session-checkouts/<key>` |
| `assertArtifactName` | 209-217 | 段名必须匹配 `/^[A-Za-z0-9][A-Za-z0-9._-]*$/` |
| `internalArtifactRef` / `applyBaseRef` | 219-222 / 224-226 | 内部 ref（apply-base） |
| `emptyRegistry()` | 228-235 | `{ version:2, revision:0, sessionBindings:{}, managedCheckouts:{} }` |
| 校验器族 | 237-434 | `isRecord`(237)、`isStringArray`(241)、`isTargetRef`(245)、`isSessionBinding`(252)、`isReview`(264)、`isPreviewReceipt`(284)、`isDeliveryProof`(306)、`isDelivery`(314，覆盖 working/ready_for_review/preview_active/preview_detached/finalized/retained/delivered 七态及各自必填字段)、`isJournal`(355，校验 operation×step 组合与全部可选字段类型)、`isManagedCheckout`(404)、`isRegistry`(424) |
| `migrateLegacyRegistry(value)` | 436-491 | v1→v2：phase 仅 `ready/discarded` 保留，否则置 `recovery_required`（462-466）；delivery 置 `{state:'working', iteration:1}`（480）；phase 变更时 record revision +1（482），registry revision +1（487） |
| `AtomicJsonCheckoutRegistry` | 493-512 | 类：构造器存 `path`（494）；`read()`（496-506）——`readJsonFileSafe` → `isRegistry` → 尝试 `migrateLegacyRegistry`（成功即写回）→ 文件缺失返回 `emptyRegistry()` → 其余抛 `registry_corrupt`（505）；`write()`（508-511）——`mkdirSync` 父目录 + `writeJsonFileAtomic` |
| `createNodeSessionCheckoutDependencies(options)` | 514-775 | 装配 `SessionCheckoutDependencies`：`managedCheckoutsRoot = configDir/worktrees`（517）、禁用 hooks 目录 `configDir/disabled-git-hooks/<uuid>`（518）、`createCheckoutId: randomUUID`（533）、`registry`（534）、`files` 端口（535-550，含 `copyFile` 先删后拷）、`git` 端口（551-773） |

git 端口方法（均在 551-773 内）：`inspect`（552-570，五连 `rev-parse`：toplevel / common-dir / absolute-git-dir / HEAD / symbolic-ref）、`findContainingWorktreeRoot`(571)、`status`(577，porcelain v1 -z 全部未跟踪)、`createDetachedWorktree`(581，`worktree add --detach`)、`removeWorktree`(590，`remove --force`)、`retainApplyBase`/`releaseApplyBase`(595/598)、`retainInternalArtifact`/`readInternalArtifact`/`releaseInternalArtifacts`(601/604/610)、`isAncestor`(618，exit 0/1/其他→异常)、`listLocalBranches`(624)、`resolveLocalBranchTip`(628)、`repairWorktreeLinks`(634)、`pruneWorktrees`(638，`--expire now`)、`listWorktreeincludeFiles`(642-650，注释说明 `--exclude-from` 只吃清单本身的 codex 语义)、`branchOverview`(651)、`defaultBranch`(669，origin/HEAD → init.defaultBranch)、`deleteLocalBranch`(677)、`branchTipTimes`(683)、`branchCreationTimes`(697，reflog `branch: Created from`)、`mergeLocalBranch`(714-772，dryRun 在临时 detached 探针 worktree 试合（744-762），冲突详情受 `CONFLICT_DETAIL_FILE_LIMIT` 截断（721）)。

#### `tests/support/official-client.ts`

- `loadOfficialBrowserClient(packageName, override?)`（6-19）：解析 `${packageName}/package.json`（8），取 `exports['./client'].browser ?? default`（10），用 `new Function('window', …)` 执行并捕获 `window.__ModuleLoader__.load(handoff)`（12-16），最后调 `handoff.factory(require)`（14）；无 handoff 抛错（17）。这是所有「直接执行官方发布浏览器产物」测试的入口。

#### `tests/support/review-actions-harness.tsx`

| 符号 | 行号 | 说明 |
| --- | --- | --- |
| `export type { WorktreeReviewEvidence }` | 12 | 透传 |
| `ReviewActionsHarnessProps` | 15-20 | 继承 `WorktreeReviewPanelProps`，新增 `adapter?`（16）、`services?`（17）、`onRefresh?`（18）、`onTargetChange?`（19） |
| `reviewIsStale(target, identity, review)` | 22-34 | `working` 即 stale（28）；白名单态（29）下 revision 或 reviewId 不匹配即 stale（30-33） |
| `ReviewActionsHarness` | 36-129 | 测试用组合组件：`actionScope`（50-52，identity 四元组 `\u0000` 连接）、`targetKey`（55-85，checkoutId/revision/state/reviewId/commitOid/retention/cleanupMessage/deliveryProof×5/checkpoints×3/checkpointGeneration/reviewSlot/reviewSlotHolder×4/previewRecovery×4/capabilities×6 拼接）、`handleStale`（103-109，置 stale 文案并首次触发 `onRefresh`）、`liveReady`（116-122）、渲染 `<WorktreeReviewPanel>` + `<ReviewActions isActive={() => mounted.current}>`（123-128） |

#### `tests/support/ui-primitives.tsx`

- `MenuEntry`（4-8）：`{ id, label, icon?, disabled?, danger? } | { type:'separator', id } | { type:'label', id, text }`。
- `Menu`（10-36）：受控菜单替身，`open` 时挂 Escape 监听（13-25）。
- `MenuItemButton`（39-67）：`role="menuitem"`，透出 `data-danger`/`data-separator-before`。
- `IconTrashOutlineRegular`（70-72）、`IconBranchOutlineRegular`（74-77）：`<svg data-icon=…>`。
- `Modal`（80-127）：`role="dialog" aria-modal`，Escape 关闭（102-107），`headless` 去标题。

除上述五个核心基座外，`tests/support/` 下还有常量夹具 `tests/support/commit-message.ts`：导出 `longCommitMessage`，由 `tests/client-review-console.test.tsx:2` 引用，供超长提交信息相关用例（426/451）共享。

### 二、官方客户端替身（虚拟模块）

- `tests/official-workspace-client.mock.ts`：`inject`（3）、`derivedBrowserCalls`（11，记录派生 Browser 收到的 props）、`resetDerivedBrowserCalls`（13）、`WorkspaceBrowser`（17-20，渲染 `data-derived-workspace-browser` 标记）、`apply`（22-38，注册 `sidebar.workspaces` 与 `conversation.hero.workspace` slot）。其头部注释（5-10）说明 decorate 路径必须走此派生组件而非官方原组件，否则图标/徽章静默丢失。
- `tests/official-workspace-client-next.mock.ts`：`inject`（1，多 `layout`+`shortcuts`）、`apply`（3-21），声明五种子 slot（`session.menu.item`/`row.action`/`row.leading`/`row.hover`）。
- `tests/official-workspace-client-alpha.mock.ts`：alpha 版官方 Workspace 虚拟模块，与上述两份共同构成三种 Host 形态的替身；`tests/client-console-remote-routing.test.ts` 的 `test.each` 按 legacy/alpha/next 各只注册一个 Browser，其中 alpha 变体的 inject 序列为 `slots/sessions/workspaces/locale/remote/remote.directoryPicker` 加 `layout`（无 `shortcuts`，见 `tests/client-console-remote-routing.test.ts:54`）。

### 三、大文件内嵌的测试上下文夹具

- `TestContext`（`tests/session-checkout-module.test.ts:38-58`）：`root/configDir/worktreesRoot/projectRoot/repositoryRoot`（39-43）、`module`（44）、`restart()`（45，用同 configDir 重建模块模拟进程重启）、`pauseNextGitInspect(expectedPath?)`（46）、`failNextGitInspect`（47）、`pauseNextDirectoryMeasure`（48）、`getRemoveWorktreeCallCount/getCreateWorktreeCallCount/getMeasureDirectoryCallCount`（49-51）、`setSessionProject/setProjectRoot/addProject/addSession/removeSession/removeProject`（52-57）。工厂 `createContext(options)` 在 95-348，可注入 `crashAfterWorktreeCreate`、`removeWorktreeFailures`、`createWorktreeFailures`、`ensureDirectoryFailures` 等故障注入；`git()`（70）与 `gitDated()`（83，固定 author/committer 日期）是真 git 子进程助手。
- `CheckoutFixture`（`tests/session-checkout-apply.test.ts:12-19`）：`baseOid`、`branchName`、`isolatedPath`、`isolatedRepositoryPath`、`localPath`、`localRepositoryPath`；工厂 `createFixture()`（38-63）创建含中文/空格路径的「本地 checkout + 隔离 worktree」对。
- `console-host.test.ts` 夹具：`A = 'a'.repeat(40)`/`B`（25-26）、`runGit`（28）、`local(sessionId)`（34-42）、`readyRecord()`（44-60，含 `delivery.review` 与 `revision:7`）、`readyReviewOf`（63-66）、`retainedRecord()`（69-79）、`registry()`（81-86，`structuredClone` 读）、`moduleDouble()`（88-122，inspect/operate/preflight 等全部 `vi.fn`）、`lookupDouble()`（124-129）、`ownerLocalLookup()`（132-136，注释强调 owner 的 project root 永远是 Local 边界）、`filesDouble()`（138-145）、`gitDouble()`（147-154）、`plane()`（156-173，组装 control plane）。
- `SlotsDouble`（`tests/client-target-console.test.tsx:25-53`）：实现 `TargetConsoleContextLike['slots']`，`entries` 数组 + 可 dispose 注册。

### 四、测试套件清单（按域）

#### 宿主 Git 适配层

| 文件 | 被测对象 | 关键用例（行号） |
| --- | --- | --- |
| `tests/worktree-creation.test.ts` | `createWorktree`（`src/adapters/worktree-creation.js`） | 完整 detached checkout 并只释放自身锁（30）；确认退出后回滚半成品且可重试（37）；`it.each` 7 种残余类型拒绝 force 兜底（54）；不修复他人 checkout（79）；filter/gitlink 隐藏数据保留（91）；sparse checkout 文件集一致（117）；注册失败只删独占空目录（133）；拒绝删除替换目录（142）；4 种残余保留（159） |
| `tests/git-creation-lifecycle.test.ts` | `createDshGitPort` | `it.each([true,false,'reject','successful-child'])` 超时后等待整树静默才处理（11-70，断言 `signal.aborted`、`terminated===1`、`cleanupCalls===0`）；`.worktreeinclude` 只列 gitignored 匹配文件（72-96）；`snapshotAbandonedWorktree` 快照 + `restoreAbandonedSnapshot` 恢复本地分支（98-133） |
| `tests/git-tags.test.ts` | git 端口标签族 | 轻量/附注/指定 target 创建（65/83/96）；重名与非法名拒绝（107/115）；本地删除（122）；pushed 三态（131/144/153）；graph decorations 保留 `tag:` 标记（167） |
| `tests/git-timeouts.test.ts` | `gitTimeoutMs`/`validateGitTimeouts`/`Config` | 终止宽限与查询期限分离（9-29）；三类期限独立且可配置（31-50）；非法值在 mount 前拒绝（52-58）；volatile live reference 每命令读取（60-69）；Config schema volatile 字段精确标记（77-84） |
| `tests/git-unborn.test.ts` | 未出生仓库全链路 | 身份读取合并（53）；空仓库确认式初始化（89-165，含竞态序列化 151、外部 index.lock 226、HEAD 变更中止 206）；host/module 全流程（174-199，`create` 被拒 `operation_not_allowed` 而 `createWithInitialCommit` 成功）；Windows 长路径（253-310，`it.skipIf(process.platform !== 'win32')`）；Skill 携带与隔离（312-464） |
| `tests/concurrent-session-guard.test.ts` | `cwdWithinLocalRoot`/`detectLocalBranchRace` | 边界与 win32 大小写（22-30）；竞态命中/窗口外/受管分支豁免/缺 createdAt 保守告警（38/57/65/91）；真实 reflog 集成：`refreshBranchRaceGuards` 后 `runtimeContext` 含 'Branch Race detected'（104-154） |
| `tests/host-query-budget.test.ts` | 命令数预算 | `vi.mock('node:child_process')` 计时包装（13-21）；`test.each([1,3])`（23）；预算表 `{current:18, list:18+9*(count-1), preflight:60, deliver:90}`（67）；deliver 以 `module.operate({action:'finish'})` 度量（89-95） |

#### 会话检出核心

| 文件 | 被测对象 | 关键用例（行号） |
| --- | --- | --- |
| `tests/session-checkout-module.test.ts`（3144 行） | `createSessionCheckoutModule` | 独占锁（351）；Local inspect（378）；双目标唯一性（411）；批量观察（433）；指定基准分支（445）；外层仓库回退（465）；8 位路径冲突扩位（475）；runtimeContext 三态（539/555/569）；checkpoint 幂等 + 累计交付（721-790）；崩溃 journal 恢复（792）；冲突恢复 proof 持久化（889）；只读再生成（934）；下一轮迭代（996/1047/1071）；分支修剪（1187/1215/1237）；worktree 分支合并（1262/1290）；反向同步（1323/1343）；容器回收（1369/1479/1506）；LRU keep-count（1633）；retention 清扫三态（1697）；Preview 全生命周期（1734-2392）；验收槽互斥（2351）；v1 台账迁移（2652）；in-place 升级（2904-2966）；清理原因回退（3098） |
| `tests/session-checkout-apply.test.ts` | `createSessionCheckoutApplyEngine` | `describe`（72）。checkpoint 成功/过期/崩溃恢复/空阶段拒绝（73/113/140/174）；apply 的 staged/unstaged/untracked 全层传递（1061）、Unicode 未跟踪（1075）、删除（1089）、二进制（1102）、`invalid_plan`（1116）、四类 `stale_local/stale_isolated`（1132/1150/1168/1189/1206）；finish 单提交且保留 Local 层（235/715/738/773）；preview/rollback/finalize 的 CAS 与补偿（263/287/318/346/366/392/421）；`assessPreviewRecovery` 只读评估（452）；快进/换支/改写历史下的回滚（492/526/559/593/618）；win32 跳过的 mode/symlink 用例（1225/1241） |
| `tests/session-branch-delivery.test.ts` | 会话分支交付 | 创建即建 `feat/sess-owner--<topic>` 分支（93-104）；`.dsh-ops` 运行期产物绝不进变更集（113-115）；Local HEAD/分支/他人未提交文件逐字节不动（141-146）；两会话同主题不抢分支（152-174） |
| `tests/session-branch-adopt.test.ts` | 遗留 detached 记录采纳 | 交付时补建会话分支并回填 `sessionBranch`/`sourceRef`（93-152，回归注释 26-31） |
| `tests/session-branch-label.test.ts` | 胶囊分支标签 | 创建后 `currentBranch === 'feat/sess-owner--labels'`（90-121）；交付后 currentBranch 跟随 Local 的 `main`、sourceBranch 仍指任务分支（123-169） |

#### Console 宿主与远程契约

| 文件 | 被测对象 | 关键用例（行号） |
| --- | --- | --- |
| `tests/console-contract.test.ts` | `consoleStateFromDomain`/`worktreeReachedDelivery`/`worktreeConsoleErrorMeta` | 七态投影与 `discarded` 保留前态（21-38）；交付判定（40-52）；错误→恢复策略映射（54-75）；fixture 记录精确 mutation（77-97） |
| `tests/console-host.test.ts`（1805 行） | `createWorktreeConsoleControlPlane` | `describe`（175）。未选中 Session 不改绑定（176）；会话分支命名（200）；非 Git 不建（232/246）；Host 分配 target 身份（262）；sidebar topology 路径自由 + memberships（275/344）；冲突 proof 持久化（437）；checkpoint 泄漏检查 `refs/dsh`（538-597）；preview 竞态 continuation（599）；跨源同级只读能力（892-972）；验收槽 waiting 投影（974-1069）；live cwd 授权（1142/1159/1168）；retained/finalized 仍可读（1192/1215）；复用 caller inspect 免三次 spawn（1273，注释解释「chip 慢」根因）；registry revision 前进时重观察（1296）；returnToLocal 三例（1395/1408/1437）；finalize 长信息/竞态/非法输入（1469/1485/1511）；discard 归属（1553/1565/1580）；侧栏徽章（1597/1604）；reviewDiff 过期丢字节（1630）；1MiB 总预算（1647）；二进制/重命名预算（1674）；初始版本确认组（1717-1804，token 一次性消费、过期 1765、部分成功 1774、并发去重 1793） |
| `tests/console-remote.test.ts` | `TYPERT` 描述符 + `WorktreeConsoleService` + `createWorktreeConsoleRemoteAdapter` | 测试专用 principal `compatibilityTest` 声明（26-30）；`OWNER_PEER`（37-41）；`METHODS` 38 项（50-90）；描述符共享与严格校验（93-116）；legacy/lazy codec 同 schema（118）；path-free topology 拒绝泄漏路径（134）；wire 输入/业务输出在 Zod 边界关死（160）；500+ 字符多行提交信息（174）；新增能力位缺失容错并落 false（215-237，注释解释旧 Host 兼容）；conflict continuation 往返（239）；checkpoint 严格（264）；recovery proof 往返（294）；Loader 自动发现（350）；无 Agent 的 sidebar 分发 + locale（367）；boot report NDJSON（404）；非 owner 一律 `remote-access/denied`（426-451）；`$mount` 往返与撤回（483-543）；三类错误区分 `not_owner`/`transport_unavailable`/`malformed_response`（545-610）；初始版本远程边界（614-633） |
| `tests/lookup.test.ts` | `createDshLookupPort` | Workspace 权威投影（37）；清理后凭不可变 cwd 头恢复（51）；cold/mismatch/pathless/ambiguous 不恢复（65）；`getSidebarMemberships` 含空 workspace 与 cold 头但**不**授予 getSession 权限（86-99） |
| `tests/surface.test.ts` | `registerTools`/`registerWorktreeCommand` | 九个工具名清单（39-49）：`worktree_create/list/resume_revision/begin_next_iteration/ready_for_review/deliver/cleanup/prune_branches/merge`；list 输出无 undefined 键（54-83，否则 Host 判非 lossless JSON）；resume/next/deliver/finalize 的参数绑定（85/108/183/215/258）；create 的 cwd 切换与 `cwdSelected` 回退（285/310）；cleanup 在 cwd 移动失败时中止且不删（333-356） |
| `tests/working-directory-adapter.test.ts` | `createSessionWorkingDirectoryPort` | enter 移动并回报规范 cwd（34）；无服务时降级 no-op 返回 undefined（44）；服务拒答时 current 为 undefined（52）；leave 仅在 checkout 内恢复（57）；前缀相同的兄弟目录不误动（73） |

#### 客户端 UI（jsdom + Testing Library）

| 文件 | 被测对象 | 关键用例（行号） |
| --- | --- | --- |
| `tests/client-actions.test.ts` | `openAuthorizedWorktreeTarget` 等 | `services()` 假件（12-45）；仅唯一 mainView-retained Session 可 finalize（48）；多主会话拒绝（64）；新版 Host 走 `uiWorkspace.openSession`（78）；两代都无导航则 fail closed（88）；已存在目标不重建 Workspace（94）；cwd 不一致 fail closed（109）；inspect 证明 owner/cwd 身份后才打开（131）；inspect 途中失活不导航（159）；身份不一致拒绝（180）；`prefillSessionDraft` 只填不发（194）；新建后复投影 cwd 复核（205，fake timers 2 秒超时） |
| `tests/client-branch-overview-cache.test.ts` | 分支总览缓存 | 后台 flight 不覆盖乐观 patch（31）；飞行中失效不再回填（57）；无并发变更正常回填（75）；失败/`!ok` 清槽不供陈旧快照（83/102）；失败不清中途 patch（116） |
| `tests/client-bundle.test.ts` | `lib/client.js` 浏览器产物 | 只 require 五个宿主依赖（74-84）；`handoff.id === 'dsh-git-worktree'` 且 inject 精确八项、排除 `conversation/connection/remote.directoryPicker/remoteAccess`（86-112，含 2026-10-17 「14 entries did not activate」事故注释 107-110）；完整启动集成：uiWorkspace 先于 conversation 激活、样式表带 `data-dsh-git-worktree`、dispose 撤干净（114-216）；modern Host picker 延迟解析（218-292）；Lucide 以选中 ESM 图标内联（295-303） |
| `tests/client-conflict-display.test.tsx` | 冲突 UI | 紧凑冲突条 + 详情弹窗文件列表 + 无预览按钮（25-51）；busy/capability 禁用与英文 compact（53-69） |
| `tests/client-console-remote-routing.test.ts` | `console-remote/index.js` 路由 | `vi.hoisted` spies + 三个 `vi.mock`（3-16）；`test.each` legacy/alpha/next 各只注册一个 Browser 且 inject 序列不同（39-55）；未知 Host 不注册（57）；官方 Workspace 活跃时 decorate（65）；识别失败先于注册（76） |
| `tests/client-i18n.test.tsx` | `readClientLanguage`/`ClientI18nProvider` | 读 `snapshot.active` 而非猜语言属性（42-49）；订阅切换不重置本地状态（51-62）；两个客户端互不共享语言（64-71）；目录占位符与英文文案契约（73-82）；工具态/解析回退用当前翻译器（84-90）；命令式动作每次调用读 locale（108-115）；入口注册提供真实 locale face（117-131）；侧栏投影只译徽章（133-141）；英文恢复 prompt 保留精确 ID/哈希/JSON 编码路径（144-160） |
| `tests/client-polling-diagnostic.test.tsx` | TargetStatusAction+WorktreeReviewStatus | **Issue #6 回归**（行 2 注释）：1 或 2 个显示消费者 30 秒内共享同一未决请求，`peak===1`（26-65）；刷新事件在共享请求未决时合并（57） |
| `tests/client-pre-session.test.tsx`（978 行） | 预会话 Worktree 切换 | 开关样式走 Harness 主题变量（16-28）；`successFixture()`（51-137）；准备流程完整事件序列（199-229，断言 11 步顺序 215-227）；`sessions.using` 保留目标（156）；创建失败零副作用（282）；discard 双通道（302/339）；草稿确认后变更回滚（381）；重复点击合并（413）；引用 chip 先拒（437）；目录菜单注册描述符 `{name:'conversation.input.left', id:'worktree-pre-session', order:40}`（457-476）；确认弹窗与取消（661/702）；preflight 合并与 Session 切换弃结果（916）；初始提交同意令牌消费（861/895）；三态回滚报告（933-953）；准备期间切会话回滚（955-977） |
| `tests/client-preview-recovery-cache.test.ts` | 恢复预检缓存 | identity 键控 + single-flight（50-63）；自动错误缓存 + 显式失效换新 generation（65-79） |
| `tests/client-recovery-continuation.test.ts` | 恢复续跑队列 | `runtime()` 夹具（18-76）；等待空闲 open owner 且单发（131）；仅 mainView-retained（157）；checkout/revision/kind 不符 fail closed（172）；Session 切换/React scope 失活取消（184/199）；sending 阶段 AbortSignal（216/237）；失败显式重试不重复 Host mutation（257）；取消后可重试（277）；新请求取代旧请求（308）；渲染器拆除后恢复持久化请求（328）；结果未知不自动重放（348）；不安全路径先拒（369）；伪造 kind 拒绝（384）；再生成严格只读（405） |
| `tests/client-review-console.test.tsx`（791 行） | WorktreeReviewPanel 等 | `describe`（105）。卡片布局约束（106）；菜单 CSS 展开（118）；外部点击/Escape 关闭（143）；默认中文摘要 + 原始 markdown 不渲染 HTML（162-179）；身份不符 fail closed（191）；自动只读预检 + 写前强制重检（201）；同 identity 共享一次预检（220）；冲突单飞（232）；写前竞态 continuation（281）；checkpoint generation 绑定（331）；跳过预览保存（389）；finalizePreview（410）；超长提交信息保全（426/451）；detached proof 驱动安全操作（497）；discard 先撤预览（535）；stale_local 只刷预检（550）；stale_isolated 走 Session.prompt（567）；验收槽 waiting→available 自动重检（603）；占用任务 path-free 摘要（631）；交付证明（656）；logged ToolView 事件联动（678）；英文对话框热切换（736-773）；撤回→再预览→保存全链路（776-791） |
| `tests/client-review-details.test.tsx` | ReviewDetailsModal | 只读详情焦点圈（14-38）；四态验证标记（40）；预览/恢复/冲突/语言（48）；不展开工具记录即可打开且只读（66）；5 项折叠阈值（90-103）；长列表独立展开与重置（113/136）；英文保留展开态（158）；菜单图标语义（169） |
| `tests/client-settings-card.test.tsx` | WorktreeSettingsCard | 五行开关/输入（59-73）；布尔编辑在读 revision 上 fenced 保存（75-87）；非法数值阻塞保存（89）；summary 视图单行（98） |
| `tests/client-target-console.test.tsx`（1707 行） | TargetStatusAction / WorktreeConsoleView / registerTargetConsole | 五个 `describe`（138/972/1043/1301/1408）。错误 tooltip 暴露真实 code（141）；六态胶囊投影（154-169）；非 Git 项目专用文案与初始化入口（173/187）；Header 懒加载 gitOverview（232）；>12 分支出搜索框 + Enter 切换（245）；打标签指向特定提交/HEAD（302/331）；推送状态未知不误判（353）；附注标签（378）；创建即推送（402）；删除二次确认（421）；切会话弃旧请求防注入（520/624/649）；dock 注册与单一主操作（679）；detached 两种 reason 的文案与 proof（752/778）；recovery_required dock 无自动重试（905）；三个 slot 精确注册、无 `conversation.view`（926）；hero chip portal（940）；创建分支选择/单次/目标身份校验（1044-1217）；guard 弃置确认（1409）；用响应 revision 而非乐观自增（1458）；stale_target 刷新不重放破坏动作（1488）； capability 门控重试清理（1510）；四个独立尾测试：撤回-刷新-再预览 CAS（1555）、撤回失败不伪造 ready（1613）、迟结果不串会话（1631）、迟快照不回退 revision（1649） |
| `tests/client-toolview.test.tsx` | WorktreeCreateRow/WorktreeReviewRow | Create 卡打开精确保留 Session（56）；`cwdSelected:true` 时去掉开门按钮（83，注释「In-place creation」）；Local `target_unselected` 错误不渲染卡（111/130）；非 Local 错误保留诊断（147）；离线时回放紧凑证据且禁用 mutation（166） |

#### Workspace 侧栏（四种模式）

| 文件 | 被测对象 | 关键用例（行号） |
| --- | --- | --- |
| `tests/client-workspace-sidebar-model.test.ts` | `projectManagedWorkspaceSidebar` | 单 owner 归组并移除 UUID Workspace 行（30）；七态中文标签映射（61-96）；徽章含分支名（98-123）；可证 blank launcher 抑制（125）；多 owner/意外第二会话（149/212）；`test.each` 归档/选中组合（172）；未知 blank 标志不阻塞归组（196）；Host-proven memberships 合并冷会话且不删摘要（250-301）；多项目争 claim 时 fail open（293） |
| `tests/client-workspace-sidebar.test.tsx` | `ManagedOfficialWorkspaceBrowser` / `registerDecoratedWorkspaceSidebar` | 精确声明树（117-151）；guard 拓扑验证前全拦、验证后只护 owner（153-186）；owner 投影 + 静默拦截第二会话操作（188-225）；归档 owner 重投影（227）；拓扑不可用回退官方投影（256）；徽章语言切换（278）；历史成员不带 owner 徽章（291）；Mode B 经 `sidebar.session.row.leading/hover` 两席位装饰、不存在 trailing 席位（341-366，注释解释 DSH 0.2.x 只有两个席位）；徽章渲染/事件刷新（368-410）；clear-badge 菜单项（454-508） |
| `tests/client-workspace-sidebar-actions.test.ts` | 三变体官方动作 | `officialApply()` 执行钉住的官方源码（16-27）；`describe.each(variants)`（53）；rename/archive 走官方回调、fork 受 guard 保护、guard 未就绪时 startSession 不开 Workspace（54-146） |
| `tests/client-workspace-sidebar-profile.test.ts` | 三变体源码派生 | `strictSlotLedger()`（14-33）；保护官方 pin/rename/archive、护 owner fork（36-85）；`cordis.patch.yml` 不再 patch 官方条目 + NOTICE 归属（86-98）；modern/alpha/next 派生 seam 与保护表达式逐字断言（100-194）；next 子 slot 授权树精确八项（196-206）；重复声明抛错（208-223） |
| `tests/client-workspace-sidebar-status.test.tsx` | 三变体行渲染 | `loadRow()` 执行官方源码并导出 `TestRow`（18-41）；working 徽章与原生运行态共存（66-83）；`test.each` 七态徽章不变（84-89）；普通会话零装饰（90-95） |

#### i18n 与横切

| 文件 | 被测对象 | 关键用例（行号） |
| --- | --- | --- |
| `tests/host-i18n.test.ts` | `hostMessages`/`withHostLanguage` | 双语+占位符契约（10）；错误码不变、消息随调用语言（19）；插值数据（用户标题/路径）不翻译（31）；遗留清理消息投影期受控本地化（39）；注册元信息双语拼接（49）；第三方错误逐字透传（57） |
| `tests/host-locale-context.test.ts` | `languageFromSettings`/`withHostLanguage` | 只读公开 settings（23）；嵌套/失败恢复（31-51）；快照偏好不随观察变化（53）；每个描述符尾随可选 locale（66-78）；Client 请求语言捕获且错误码稳定（80-90）；五个并发调用各自语言（92-112）；工具/命令在调用期本地化（115-146） |
| `tests/i18n-catalogs.test.ts` | 三目录完备性 | 遍历 `clientMessages/hostMessages/transportMessages` 断言双语非空且命名参数一致（8-18） |
| `tests/i18n-references.test.ts` | 引用护栏 | 递归 `walk(src)`（10-15）；字面 `t("…")` 必在 `clientMessages`（28/32-40）；`hostMessage("…")` 必在 `hostMessages`（29/42-50） |
| `tests/adapters-safe-file.test.ts` | `readJsonFileSafe`/`writeJsonFileAtomic`/`writeTextFileAtomic` | 最新可解析 tmp 残留晋升且其余清理（19-31）；legacy `<file>.tmp`（33）；全不可解析清空返回 null（42）；`.bak` 保存上一份好内容、主文件损坏可恢复（52-64）；文本原子写整体替换（66） |
| `tests/current-polling.test.ts` | `subscribeCurrent` | 结果共享 + 完成后 5 秒再轮询（29）；突发刷新合并、失效前响应丢弃（40）；卸载/重挂不投递被弃请求（51）；最后退订停计时器（62）；传输失败发布且恢复（72）；领域错误仍是 outcome（82）；隐藏页停轮询、可见即恢复（114-133） |
| `tests/dev-dsh.test.ts` | `scripts/dev-dsh-lib.mjs` 全部导出 | `parseDevDshArgs` 默认/显式（46/84）；隔离 DSH_HOME 缓存根与 Documents（59/65）；源码 CLI runner（105）；`discoverHarnessRoot` 就绪优先 + `DSH_HARNESS_ROOT` 覆盖（155/174）；未就绪 Harness 在构建前失败并给出命令（181）；`ensureDevFixture` 建干净仓库/占用即拒/显式仓库只校验（201/215/225）；`installLocalSnapshot` 只执行 typecheck→build→pack→add→dump-config、staged manifest 去 scripts（237-294）；首 profile 初始化顺序（296）；源码 CLI 全程（339）；多 profile 旧归档保留（390）；缺失/陈旧归档修复与失败（437/483） |
| `tests/project-skill-provider.test.ts` | `ClaudeProjectSkillProvider` | 真实上游解析 + 资源基 + cwd 隔离（29）；原生 `.dsh/.agents` 优先于 Claude 回退（43）；项目外 junction 拒绝（57）；dispose 与挂起查找串行（68） |
| `tests/project-skills-race.test.ts` | ProjectSkillStore 竞态 | `vi.mock` `project-skill-io` 注入 `race.beforeCreate` 钩子（7-14）；拷贝开始前父级已被换成 junction 时拒绝且外部哨兵文件原样（21-45） |
| `tests/project-skills.test.ts` | `ProjectSkillStore` | 溯源跨重启持久 + 编辑/删除检测（20）；冲突目标文件绝不覆盖（38）；发布失败保留已完成拷贝（46）；checkout 目录替换后禁用溯源复用（57）；Git ignore 之外的新资源也拒（63）；源/目标 junction 拒绝（70）；64MiB 体积上限（83）；可执行位保留（88，skipIf win32）；空目录携带与后续内容（97）；skill 根本身是 tracked 占位文件（109） |
| `tests/workspace-provider-lifecycle.test.ts` | `mountWorkspaceProviderLifecycle` | 真实 Cordis Loader + `ClientModuleRegistry` 的 `boot()`（30-100）；patch 不再 patch 官方条目（103）；禁用条目启动官方 Workspace（109）；未知 Host/未启用 takeover 保持官方（118/124/130）；modern 自动接管不复活用户禁用条目（136）；启用后图恰为 `[WORKTREE]`、禁用恢复 `[OFFICIAL]`（142/148）；market 禁用重放（167）；延迟 import/Include 不产生双 provider（173/177/183）；live disable 往返不持久化标志（189-205）；fiber 重启保留（207）；旧代清理不撤新 fiber（218）；激活失败恢复官方（239）；用户显式 disabled 不被生命周期拥有（253）；根 dispose 不复活（266）；楔死的官方 disable 不阻塞接管（287）；慢 disable 落在激活后（299） |

## Architecture

测试模块自身呈「套件 → 基座 → 被测物」三层结构，外加一条直接执行官方浏览器产物的旁路：

```text
┌───────────────────────────── tests/*.test.ts(x) 套件 ─────────────────────────────┐
│ 宿主域 git-*/session-*/console-host │ 客户端域 client-*(jsdom) │ 契约 console-remote │
└──────┬───────────────────┬────────────────────┬──────────────────┬───────────────┘
       │                   │                    │                  │
       ▼                   ▼                    ▼                  ▼
┌───────────────────┐ ┌─────────────────┐ ┌───────────────┐ ┌────────────────────┐
│ support/          │ │ support/        │ │ support/      │ │ official-workspace-│
│ production-       │ │ worktree-       │ │ official-     │ │ client*.mock.ts    │
│ adapters.ts       │ │ console.ts      │ │ client.ts     │ │ (虚拟 cordis 模块) │
│ (真实 git/files)  │ │ (adapter 假件)  │ │ (浏览器手递)  │ │                    │
└────────┬──────────┘ └────────┬────────┘ └───────┬───────┘ └─────────┬──────────┘
         ▼                     ▼                  ▼                   ▼
   真实 git 子进程      WorktreeConsoleAdapter   官方包 ./client     cordis ctx 注入
   + 临时目录 fixtures   (src/console-contract)   浏览器 ModuleLoader  (slots/locale/…)
```

## Data Flow

以两类代表性测试说明：

1. **宿主集成测试**（如 `tests/session-branch-delivery.test.ts`）：`testEnvironment()`（12-23）剥掉宿主 `GIT_*` 变量 → `fixture()`（32-79）在 `mkdtempSync` 临时根里 `git init` 并注入真实子进程 Context → `createNodeSessionCheckoutDependencies`（`tests/support/production-adapters.ts:514`）装配 git/files/registry 端口（registry 写到 `configDir/managed-checkouts.json`）→ `createSessionCheckoutModule` 驱动 `createIsolatedTarget/markReadyForReview/operate` → 用 `git()` 与 `readFileSync` 逐字节断言 Local/台账/分支状态，`finally` 中 `env.cleanup()`（147-149）。
2. **客户端 UI 测试**（如 `tests/client-review-console.test.tsx`）：`createWorktreeConsoleAdapterFixture()`（`tests/support/worktree-console.ts:124`）得到会记录 `calls` 的 adapter → `render(<WorktreeReviewPanel …>)` → `fireEvent.click` 触发动作 → 断言 `fixture.calls` 含精确 `{method, request}`（如 `tests/client-review-console.test.tsx:789` 的 finalizePreview、`tests/client-target-console.test.tsx:709-714` 的 preflight/preview 断言）与屏幕文案；需要 CAS 语义时传 `stateful=true`（`tests/client-review-console.test.tsx:777`、`tests/client-target-console.test.tsx:1556`），写请求随后与 `expectedRevision` 严格比对并推进 +3。
3. **产物契约测试**（`tests/client-bundle.test.ts`）：`loadOfficialBrowserClient`（support/official-client.ts:6）或 `executeBundle`（49-59）以 `window.__ModuleLoader__` 手递捕获 `handoff.factory(require)`，在真实 cordis `Context` 上 `ctx.plugin` 并断言激活顺序与 DOM 副作用。

## Connections

- 被测核心：[[session-checkout-module]]、[[session-checkout-apply]]、[[console-host]]（`control-plane.js`，主测于 `tests/console-host.test.ts`）、[[console-contract]]、[[console-remote]]（`descriptors.js`/`typert.js`/`service.js`）。
- 被测适配器：[[adapters-safe-file]]（`src/adapters/safe-file.js`，测于 `tests/adapters-safe-file.test.ts`）、[[adapters-git]]（`createDshGitPort`，测于 `tests/git-*.test.ts`）、[[adapters-lookup]]、[[adapters-working-directory]]、[[adapters-project-skills]]（`ProjectSkillStore`/`ClaudeProjectSkillProvider`）。
- 被测客户端：[[client-actions]]、[[client-review-console]]、[[client-target-console]]、[[client-workspace-sidebar]]、[[client-pre-session]]、[[client-i18n]]、[[current-polling]]、[[branch-overview-cache]]、[[preview-recovery-cache]]、[[recovery-continuation]]。
- 被测基础设施：[[workspace-provider-lifecycle]]（配合真实 `@deepseek-ai/cordis-plugin-loader`）、[[tools-commands-surface]]（`registerTools`/`registerWorktreeCommand`）、[[dev-dsh]]（`scripts/dev-dsh-lib.mjs`）、[[i18n-catalogs]]（三份消息目录）。
- 契约对端：生产共享 fixture 也被 `tests/console-contract.test.ts:77-97` 用作「一处假件、三轨复用」的单一事实源（文件头注释 123 行：「Shared deterministic fake used by the three parallel Worktree Console tracks」）。

## Known Issues

- **平台门控用例**：`tests/git-unborn.test.ts:72` 用 `it.skipIf(process.platform === 'win32')` 跳过含换行路径的仓库；`:253` 用 `it.skipIf(process.platform !== 'win32')` 限定 Windows 长路径用例；`tests/session-checkout-apply.test.ts:1225` 与 `:1241` 在 win32 上以 `test.skip` 跳过可执行位与符号链接用例。未来 agent 在非 Windows 环境看不到这些分支的执行。
- **超时依赖全局配置**：`tests/session-checkout-apply.test.ts:23-24` 注释说明 Git 重集成用例超出 Vitest 默认 5 秒，全局 30 秒在 `vitest.config.ts`；`tests/session-checkout-module.test.ts:62` 同理为 60 秒。另有大用例自带显式 timeout（如 `tests/console-host.test.ts:1672` 的 30_000 与 `:1713` 的 120_000；三个 `session-branch-*.test.ts` 均为 120_000）。
- **硬编码 CAS 步长**：stateful fixture 中 `result.value.target.revision = target.revision + 3`（`tests/support/worktree-console.ts:526`）。任何依赖「每次写恰好 +1」语义的新断言都会与该假件冲突，需在 fixture 层调整。
- **环境隔离靠约定**：多个 git 集成文件各自复制 `testEnvironment()`（`tests/session-branch-delivery.test.ts:12-23`、`tests/session-branch-adopt.test.ts:12-23`、`tests/session-branch-label.test.ts:13-24`、`tests/git-unborn.test.ts:17-23`、`tests/git-tags.test.ts:11-17`）以剥除 `GIT_AUTHOR_*/GIT_DIR/GIT_WORK_TREE` 等——新增集成文件若忘记这一步，adapter 会读到本仓库自身的 git 指针（`session-branch-delivery.test.ts:11` 注释明确此风险）。
- **模块级 mock 边界**：`tests/client-console-remote-routing.test.ts:9-16` 用 `vi.mock` 虚拟化 `src/client/index.js`、workspace-sidebar 与 remote adapter——该文件的断言只覆盖路由编排，不覆盖被 mock 的实现；`tests/host-query-budget.test.ts:13-21` 包装 `node:child_process.spawn` 计时；`tests/project-skills-race.test.ts:8-14` 在 `project-skill-io.createSkillFiles` 上开竞态钩子。阅读这些文件时须先确认 mock 面。
- **测试专用身份类型**：`tests/console-remote.test.ts:26-30` 通过 `declare module` 注入 principal kind `compatibilityTest`，并在 426-451 验证「无策略注册即拒绝、且授予无关资源也不放行」——该类型仅存在于类型层，生产不可用。
- **诊断输出**：`tests/client-polling-diagnostic.test.tsx:54` 打印 `console.info(JSON.stringify(...))` 诊断行（Issue #6 回归观测）；`tests/host-query-budget.test.ts:63` 打印墙钟/命令数诊断——都是有意保留的观测点，不是遗留日志。
- **jsdom 能力补丁**：`tests/client-bundle.test.ts:11-16` 与 `tests/client-workspace-sidebar-actions.test.ts:55-58` 因 jsdom 24 缺 `AbortSignal.any` 而 stub 全局 `AbortController/AbortSignal` 为 Node 实现；新 UI 测试若依赖 abort 语义需复用该模式。
