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
  - tests/surface.test.ts
  - tests/support/official-client.ts
  - tests/support/production-adapters.ts
  - tests/support/review-actions-harness.tsx
  - tests/support/ui-primitives.tsx
  - tests/support/worktree-console.ts
  - tests/working-directory-adapter.test.ts
  - tests/workspace-provider-lifecycle.test.ts
  - tests/worktree-creation.test.ts
tags: [tests, vitest, fixtures, worktree-console, session-checkout, client-ui, git-integration]
---

## Overview

`tests/` 是 `dsh-git-worktree` 插件的完整 Vitest 测试套件，覆盖三条平行轨道：

1. **Host 域**（Node 环境）：`console-host.test.ts`（控制面投影与授权，约 1800 行）、`console-remote.test.ts`（Typert strict 描述符与网关）、`session-checkout-module.test.ts`（约 3100 行的核心模块集成）、`session-checkout-apply.test.ts`（Apply 引擎）、`session-branch-{delivery,adopt,label}.test.ts`（会话分支回归）。
2. **Client 域**（`// @vitest-environment jsdom`，如 `client-branch-overview-cache.test.ts:1`）：`client-*.test.tsx` 系列，用 `@testing-library/react` 渲染 `src/client/` 下的组件。
3. **平台/适配器域**：`git-{unborn,tags,timeouts,creation-lifecycle}.test.ts`、`worktree-creation.test.ts`、`project-skills*.test.ts` 直接对真实 `git` 子进程和文件系统断言。

所有客户端 Console 测试共享一个确定性夹具 `createWorktreeConsoleAdapterFixture`（`tests/support/worktree-console.ts:124`，注释见 123 行 "Shared deterministic fake used by the three parallel Worktree Console tracks"）；所有 Host/模块集成测试共享 `createNodeSessionCheckoutDependencies`（`tests/support/production-adapters.ts:514`），它同时实现了 v1→v2 台账迁移与全量 schema 校验器。

## Key Components

### 共享夹具：Console 适配器（tests/support/worktree-console.ts）

- `WorktreeConsoleFixtureMethod`（53|）：`keyof WorktreeConsoleAdapter`，记录调用方法名的类型。
- `WorktreeConsoleFixtureCall`（55-58|）：字段 `method: WorktreeConsoleFixtureMethod`、`request: unknown`。
- `readyTarget()`（60-111|）：返回完整的 `WorktreeConsoleTargetDetails`，字段包括 `project: { id: 'project-1', name: 'Fixture Project' }`、`checkoutId: 'checkout-1'`、`sourceSessionId: 'source-session'`、`ownerSessionId`/`targetSessionId: 'target-session'`、`iteration: 1`、`revision: 7`、`state: 'ready_for_review'`、`phase: 'ready'`、`dirty: true`、`currentOid: 'b'.repeat(40)`、`sourceOid: 'a'.repeat(40)`、`currentBranch: null`、`commitOid: null`、`sourceBranch: 'main'`、`managedRoot: '/fixture/project-worktrees/checkout-1'`、`sourceRoot: '/fixture/project'`、`capabilities`（create=false；open/inspect/discard/preflight/preview/checkpoint/resumeRevision/finalize=true；rollbackPreview/finalizePreview/setRetention/setPermanent/retryCleanup/beginNextIteration/returnToLocal=false）、`checkpointGeneration: '9'.repeat(64)`（97|）、`review`（98-109|：`reviewId: 'review-1'`、`revision: 7`、`iteration: 1`、`preparedAt: 1`、`summary: 'Fixture review'`、`validationStatus: 'passed'`、`validationSummary: 'focused tests passed'`、`tests: [{ command: 'pnpm test', status: 'passed' }]`、`changedFiles: ['src/index.ts']`、`suggestedCommitMessage: 'fix: fixture review'`）。
- `outcome<T>()`（113-115|）：包装 `{ ok: true, value }`。
- `WorktreeConsoleAdapterFixture`（117-121|）：字段 `adapter: WorktreeConsoleAdapter`、`calls: WorktreeConsoleFixtureCall[]`、`target: WorktreeConsoleTargetDetails`。
- `createWorktreeConsoleAdapterFixture(stateful = false)`（124-534|）：内部 `delivered()` 助手（130-170|）生成 `state: 'delivered'` + `deliveryProof` 的响应；可变标签状态 `tags`（173|）供标签 UI 读写；适配器方法逐个记录调用——`sidebarTopology`（176|）、`current`（180|）、`list`（184|）、`create`（188|）、`initializeProject`（192|）、`inspect`（196|）、`reviewDiff`（200|）、`preflight`（209|）、`previewRecoveryPreflight`（220|，返回 `generation: '1'.repeat(64)` 等完整 proof）、`preparePreviewRecoveryAnalysis`（246|）、`createPreviewRecoveryHandoff`（254|）、`preview`（267|，revision+1）、`checkpoint`（276|，revision+3）、`resumeRevision`（313|，可带 `conflictContinuation`→`host-authority-conflict-1`）、`prepareReviewRegeneration`（345|）、`rollbackPreview`（359|，按 `resumeRevision` 分支回 working 或 ready_for_review）、`discard`/`finalize`/`finalizePreview`/`retryCleanup`/`clearSidebarBadge`（372-399|）、`beginNextIteration`（400|，切到 `checkout-2`、iteration+1）、`returnToLocal`（423|）、`gitOverview`（447|）、`gitGraph`（460|）、`gitCreateBranch`/`gitSwitchBranch`（464/468|）、`listAbandoned`/`restoreAbandoned`（472/476|）、`gitListTags`（480|）、`gitCreateTag`（487|，重名返回 `git_operation_failed`）、`gitDeleteTag`（502|）、`gitPushTag`（509|）。stateful 模式（518-532|）把 `preview`/`rollbackPreview`/`resumeRevision`/`finalizePreview` 包上 CAS：`request.expectedRevision !== target.revision` 时返回 `stale_target`（522|），成功后 `result.value.target.revision = target.revision + 3`（526|，注释见 525 行 "Host journaling and completion each advance CAS"）。533| 返回 `{ adapter, calls, get target() { return target } }`。

### 共享夹具：Node 生产依赖（tests/support/production-adapters.ts）

- `NodeSessionCheckoutOptions`（23-31|）：字段 `configDir: string`、`lookup: SessionCheckoutLookupPort`、`worktreesRoot?: string | LiveValue<string | undefined>`、`autoDeliver?`、`autoPush?`、`branchRaceGuard?`、`branchRaceWindowMs?`（均支持布尔/数值或 `LiveValue`）。
- `GitCommandResult`（33-37|）：`code`、`stdout`、`stderr`；`GitCommandOptions`（39-41|）：`hooksPath`。
- 常量 `GIT_COMMAND_TIMEOUT_MS = 10_000`（47|）、`WORKTREE_REMOVE_TIMEOUT_MS = 5 * 60_000`（48|）；`getSessionCheckoutGitTimeoutMs(args)`（51-55|）：`worktree remove` 用 5 分钟（注释见 50 行：Windows 删除约 1GB/6 万文件私有依赖树）。
- 文件工具：`measureDirectoryBytes`（57-65|，符号链接计 0）、`removeEmptyDirectoryTree`（67-76|）、`inspectDirectoryIdentity`（78-87|，返回 `DirectoryIdentity`：`device`/`inode`/`birthtimeNs`）、`directoryIdentitiesEqual`（89-91|）、`quarantineDirectoryTree`（93-113|，先 rename 再验身份，不符则尝试回滚且绝不删除，111 行注释）、`removeDirectoryTree`（115-127|，win32 6 次重试/150ms）。
- Git 执行：`runGit`（129-191|，统一加 `--no-pager --no-optional-locks -c core.quotePath=false -c core.fsmonitor=false -c core.hooksPath=…`，超时强杀见 181-189|）、`runGitChecked`（193-202|）。
- 内部 ref：`checkoutRefRoot`（204-207|，`refs/dsh-worktree/session-checkouts/<sha256(checkoutId).slice(0,24)>`）、`assertArtifactName`（209-217|）、`internalArtifactRef`（219-222|）、`applyBaseRef`（224-226|）。
- 台账校验器：`emptyRegistry`（228-235|，`version: 2, revision: 0`）、`isRecord`（237|）、`isStringArray`（241|）、`isTargetRef`（245-250|）、`isSessionBinding`（252-262|）、`isReview`（264-282|）、`isPreviewReceipt`（284-304|）、`isDeliveryProof`（306-312|）、`isDelivery`（314-353|，逐状态校验 working/ready_for_review/preview_active/preview_detached/finalized/retained/delivered）、`isJournal`（355-402|，合法 operation/step 枚举）、`isManagedCheckout`（404-422|）、`isRegistry`（424-434|）。
- `migrateLegacyRegistry`（436-491|）：v1→v2，legacy phase 不在 `{ready, discarded}` 时落 `recovery_required`（462-465|），delivery 置 `{ state: 'working', iteration: 1 }`（480|），phase 变化时 revision+1（482|）。
- `AtomicJsonCheckoutRegistry`（493-512|）：`read()`（496-506|，先 `isRegistry`，再迁移，文件不存在给空表，否则抛 `registry_corrupt`——505|）、`write()`（508-511|，`writeJsonFileAtomic`）。
- `createNodeSessionCheckoutDependencies(options)`（514-775|）：返回 `lookup`、`applyEngine`（526|）、`managedCheckoutsRoot = configDir/worktrees`（517|）、`createCheckoutId: randomUUID`（533|）、`registry`（534|）、`files`（535-550|：exists/canonicalize/inspectDirectoryIdentity/ensureDirectory/removeEmptyDirectoryTree/quarantineDirectoryTree/removeDirectoryTree/measureDirectoryBytes/readTextFile/copyFile）、`git`（551-773|）：`inspect`（552-570|，一次合并读取 toplevel/commonDir/gitDir/HEAD/symbolic-ref）、`findContainingWorktreeRoot`（571|）、`status`（577|）、`createDetachedWorktree`（581|）、`removeWorktree`（590|，`--force`，注释见 591-592 行）、`retainApplyBase`/`releaseApplyBase`（595/598|）、`retainInternalArtifact`/`readInternalArtifact`/`releaseInternalArtifacts`（601/604/610|）、`isAncestor`（618|）、`listLocalBranches`（624|）、`resolveLocalBranchTip`（628|）、`repairWorktreeLinks`（634|）、`pruneWorktrees`（638|）、`listWorktreeincludeFiles`（642-650|，注释见 644-645 行解释为何不能并集）、`branchOverview`（651|）、`defaultBranch`（668|，origin/HEAD 优先）、`deleteLocalBranch`（677|）、`branchTipTimes`（682|）、`branchCreationTimes`（695-711|，reflog `branch: Created from`）、`mergeLocalBranch`（712-772|，dryRun 在临时 detached worktree 试合，冲突详情截断 `CONFLICT_DETAIL_FILE_LIMIT`/`CONFLICT_DETAIL_DIFF_LIMIT`，716-732|）。

### 共享替身与加载器

- `tests/support/official-client.ts`：`loadOfficialBrowserClient(packageName, override?)`（6-19|）——读 `package.json` 的 `exports['./client'].browser`（10|），用 `new Function('window', …)` 执行并捕获 `__ModuleLoader__.load` handoff（12-16|）。
- `tests/support/ui-primitives.tsx`：`MenuEntry`（4-8|，三种变体：`{ id, label, icon?, disabled?, danger? }` | `{ type: 'separator', id }` | `{ type: 'label', id, text }`）、`Menu`（10-36|，受控菜单，Escape 关闭）、`MenuItemButton`（39-67|）、`IconTrashOutlineRegular`（69-72|）、`IconBranchOutlineRegular`（74-77|）、`Modal`（79-119|，`open/onClose/title/closeLabel/description/children/footer/headless/className`）。
- `tests/support/review-actions-harness.tsx`：`ReviewActionsHarnessProps`（15-20|，含 `adapter?`/`services?`/`onRefresh?`/`onTargetChange?`）、`reviewIsStale(target, identity, review)`（22-34|，`state === 'working'` 或 revision/reviewId 不匹配即过期）、`ReviewActionsHarness`（36-129|）：`actionScope`（50-54|，identity 四元组 `\u0000` 连接）、`targetKey`（55-85|，30+ 字段拼接）、`currentTarget`/`invalidReason` 状态、`handleStale`（103-109|，一次性触发 `onRefresh`）、`handleTargetChange`（111-114|）、`liveReady`（116-122|）、渲染 `WorktreeReviewPanel` + `ReviewActions`（123-128|）。
- `tests/official-workspace-client.mock.ts`：`inject`（3|）、`derivedBrowserCalls`（11|）、`resetDerivedBrowserCalls`（13-15|）、`WorkspaceBrowser`（17-20|，打 `data-derived-workspace-browser` 标记）、`apply`（22-38|，注释见 5-10 行解释 decorate 必须路由到派生 Browser）。
- `tests/official-workspace-client-next.mock.ts`：`inject`（1|，多出 `shortcuts`）、`apply`（3-21|，声明 `sidebar.workspaces` 的 5 个子 slot：directoryFlow/session.menu.item/session.row.action/session.row.leading/session.row.hover，5-16|）与 `conversation.hero.workspace`（17-20|）。

### Host 域测试夹具

- `tests/console-host.test.ts`：`runGit`（28-32|）、`local(sessionId)`（34-42|，Local 视图：project-1、`checkout { id: 'local', kind: 'local' }`、revision 1）、`readyRecord()`（44-60|，`ManagedCheckoutRecord`：`checkoutId: 'checkout-1'`、`ownerSessionId: 'target-session'`、`localRoot: '/local'`、`managedRoot: '/managed'`、`gitCommonDir: '/git/common'`、`gitDir: '/git/worktrees/one'`、`baseOid: A`、`revision: 7`、delivery `ready_for_review` + review-1）、`readyReviewOf`（62-66|）、`retainedRecord()`（68-79|，`sessionBranch: 'refs/heads/feat/sess-target-session--task'`、`retention: 'retain_24h'`）、`registry(record)`（81-86|）、`moduleDouble(record)`（88-122|，mock 全部 `SessionCheckoutModule` 方法）、`lookupDouble()`（124-129|，`workspace-target` → `/managed`）、`ownerLocalLookup()`（131-136|，owner 的 project root 恒为 `/local`，注释见 131 行）、`filesDouble()`（138-145|）、`gitDouble()`（147-154|）、`plane(record, overrides)`（156-173|，组装 `createWorktreeConsoleControlPlane` + reviewDiff mock）。测试见下方地图。
- `tests/session-checkout-module.test.ts`：`TestSession`/`TestProject`（16-26|）、`TestContext` 接口（38-58|：`root/configDir/worktreesRoot/projectRoot/repositoryRoot/module/restart/pauseNextGitInspect/failNextGitInspect/pauseNextDirectoryMeasure/getRemoveWorktreeCallCount/getCreateWorktreeCallCount/getMeasureDirectoryCallCount/setSessionProject/setProjectRoot/addProject/addSession/removeSession/removeProject`）、`git()`（70-80|）、`gitDated()`（83-93|，固定 author/committer 日期）、`createContext(options)`（95-348|）——注入可控 `git.inspect` 暂停/失败（177-197|）、`removeWorktree` 失败与残留（198-223|）、`removeDirectoryTree`/`ensureDirectory` 失败（224-241|）、`measureDirectoryBytes` 暂停（243-258|）、`createDetachedWorktree` 计数/回滚/崩溃（259-277|）；返回对象还含 `setSessionDelegation`（330|）与 `markSessionDelegationCheckoutReleased`（336|）。
- `tests/session-checkout-apply.test.ts`：`runGit`（30-36|，带 `core.quotePath=false`）、`createFixture(options)`（38-63|，本地检出 + detached worktree，路径含空格/中文 “隔离 checkout”，可选 `projectSubdirectory`）、`readyPlan`（65-70|）。
- `tests/session-branch-delivery.test.ts`：`testEnvironment`（12-23|，剥离 `GIT_*` 环境变量）、`fixture()`（32-79|，Local 停在他人分支 `fix/sess-session--dock-action-click` 并留未提交文件）。
- `tests/session-branch-adopt.test.ts`：`fixture()`（32-91|，含 `tryGit`，88-90|）。
- `tests/session-branch-label.test.ts`：`fixture()`（35-88|）。
- `tests/git-unborn.test.ts`：`testEnvironment`（17-23|）、`git`（24-26|）、`fixture()`（27-50|，支持 `hooks.beforeCommand` 钩子拦截，33/36|）。
- `tests/git-tags.test.ts`：`fixture()`（23-58|，先配置 user.name/email 以便附注标签，30-31|）。
- `tests/console-remote.test.ts`：`OWNER_PEER`（37-41|，owner principal + signal + `interactions: 'answer'`）、`loadRemoteClientModule()`（46-48|）、`METHODS`（50-90|，39 个方法名全表：sidebarTopology、clientBootReport、current、list、gitOverview、gitGraph、preflightCreate、createWithInitialCommit、create、initProject、inspect、reviewDiff、preflight、previewRecoveryPreflight、preparePreviewRecoveryAnalysis、createPreviewRecoveryHandoff、preview、checkpoint、resumeRevision、prepareReviewRegeneration、rollbackPreview、discard、finalize、finalizePreview、setRetention、setPermanent、retryCleanup、beginNextIteration、returnToLocal、clearSidebarBadge、gitCreateBranch、gitSwitchBranch、gitPruneMergedBranches、gitListTags、gitCreateTag、gitDeleteTag、gitPushTag、listAbandoned、restoreAbandoned）。

### Client 域测试夹具

- `tests/client-actions.test.ts`：`services(byId, projectedCwd)`（12-45|，模拟 workspaces/sessions.list/subscribe）。
- `tests/client-target-console.test.tsx`：`SlotEntry`（19-23|）、`SlotsDouble`（25-53|，实现 `TargetConsoleContextLike['slots']`，记录 entries 并可 dispose）、`localTarget()`（55-90|，`state: 'local'`、`capabilities.create: true` 其余 false）、`clientServices()`（92-121|）、`summaryOf()`（123-126|，剥离 `managedRoot/sourceRoot/sourceOid/currentBranch`）、`renderConsole()`（128-134|）。
- `tests/client-pre-session.test.tsx`：`isolatedTarget()`（30-49|）、`successFixture()`（51-137|，`events` 字符串数组按序记录 `block:set`/`remote:create`/`workspace:create`/`session:create`/`target:draft`/… 全链路）。
- `tests/client-review-console.test.tsx`：`review(overrides)`（23-36|）、`identity(revision=7)`（38-40|）、`clientServices()`（42-60|，session.prompt 可断言）、`previewTarget()`（62-80|）、`loggedReviewRow(adapter?)`（82-103|）。
- `tests/client-i18n.test.tsx`：`localeFace(active)`（18-27|，可变 locale 快照 + listeners）、`evidence`（29-33|，中文用户数据样本）、`Counter`（35-39|）。
- `tests/client-recovery-continuation.test.ts`：`runtime(target, initial)`（18-76|，可控 running/openState/currentSession）、`conflictRequest(revision, suffix)`（78-89|）、`authorizedTarget()`（91-112|）、`regenerationRequest()`（114-123|）。
- `tests/client-preview-recovery-cache.test.ts`：`identity`（8-14|）、`assessed(generation)`（16-47|，完整 proof）。
- `tests/client-bundle.test.ts`：`gatewayClient()`（20-25|）、`mountAccess()`（27-32|）、`ClientHandoff`（35-38|：`id`/`factory(require)`）、`platformRequire`（40-43|，UI primitives stub）、`executeBundle(code)`（49-59|，执行 `lib/client.js` 捕获 handoff）、`configFormsStub()`（62-71|）。11-16| 在 import 前用 `transferableAbortController` stub 全局 `AbortController/AbortSignal`。
- `tests/client-toolview.test.tsx`：`services()`（11-53|，返回 `opened: string[]` 与 `commands: string[]` 供断言）。
- `tests/client-settings-card.test.tsx`：`makeScope(overrides, mutate)`（15-34|）、`renderCard(scope, view)`（36-55|，注释见 40 行解释 `useSyncExternalStore` 镜像 slot 运行时绑定）、`saveButton()`（57|）。
- `tests/client-workspace-sidebar.test.tsx`：`state()`（25-48|）、`adapter()`（50-67|，`sidebarTopology` 带 `checkout-1` 任务）、`browserProps()`（69-82|）、`InspectBrowser`（84-114|，暴露操作按钮并读取 `__dshGitWorktree` 标记）。
- `tests/client-workspace-sidebar-profile.test.ts`：`strictSlotLedger()`（14-33|，重复声明 slot 即抛错）。
- `tests/client-workspace-sidebar-actions.test.ts`：`officialApply(source)`（16-27|，执行 pin 的客户端工厂而非 Vitest 虚拟模块）、`variants`（29-33|，alpha/next/modern）。
- `tests/client-workspace-sidebar-status.test.tsx`：`labels`（10-13|，7 状态中文映射）、`loadRow(source)`（18-41|，用 primitives Proxy 执行真实 pinned 行组件并导出 `TestRow`）、`variants`（43-47|）、`renderRow`（49-62|）。
- `tests/current-polling.test.ts`：`fixture()`（9-23|，fake timers + 受控 `current`）、`settle()`（24|）、`refresh(sessionId)`（25-27|，派发 `WORKTREE_REVIEW_REFRESH_EVENT`）。
- `tests/lookup.test.ts`：`workspace()`（10-12|）、`session()`（17-19|）、`contextOf()`（21-34|）。
- `tests/working-directory-adapter.test.ts`：`fakeHost(initial, opts)`（9-27|）、`ctxWith()`（29-31|）。
- `tests/workspace-provider-lifecycle.test.ts`：`entries(disabled)`（22-28|，从 `cordis.patch.yml` 应用 patch）、`boot(data, replayDisabled?, delayedImport?, childEntries?, failApply?, flavor?, takeover?)`（30-100|，真实 Cordis `Loader` + `ClientModuleRegistry`，支持楔死 official entry 的 `update` 以测选举竞态）。
- `tests/dev-dsh.test.ts`：`git()`（23-25|）、`createHarnessRoot()`（27-38|）、`sourceDshArgs()`（40-43|）。
- `tests/surface.test.ts`：`readyTarget`（7-28|）。
- `tests/console-contract.test.ts`：`source(overrides)`（11-18|）。
- `tests/adapters-safe-file.test.ts`：`dirs`（7|）、`scratch()`（8-12|）、afterEach 清理（14-16|）。
- `tests/host-query-budget.test.ts`：`traces` spy（12-21|，mock `node:child_process.spawn` 计时）。
- `tests/i18n-references.test.ts`：`walk()`（10-15|）、`literalKeys()`（20-26|）、`CLIENT_CALL`/`HOST_CALL` 正则（28/29|）。
- `tests/i18n-catalogs.test.ts`：`placeholders()`（6|）。
- `tests/host-locale-context.test.ts`：`deferred()`（12-16|）、`settingsContext(preference)`（18-20|）。
- `tests/project-skill-provider.test.ts`：`fixture()`（15-23|）、`list()`（24-27|）。
- `tests/project-skills.test.ts`：`fixture()`（10-19|）。

### 测试文件地图（关键 describe/test 行号）

| 文件 | 域 | 关键断言（行号） |
| --- | --- | --- |
| `console-host.test.ts` | Host 控制面 | 未选会话投影 Local 不动 binding（176-198）；会话分支名优先于 detached 读数（200-216）；legacy 记录退回 fork 点（218-230）；非 Git 不给 create（232-244）；路径无关 sidebar 拓扑仅留最新 iteration（275-342）；conflict proof `conflict-recovery:` 持久化（437-499）；只读 regeneration proof（501-536）；checkpoint generation 绑定且不泄漏 `refs/dsh`（538-597）；Preview 竞态结构化 continuation（599-625）；标签端口（742-807）；坏记录降级为无观察投影（826-890）；sibling 只读检查 `not_owner`（892-972）；验收位 path-free（974-1069，JSON 不得含 `/holder`）；live cwd 授权（1142-1157）；Diff 预算 1MiB/200 文件（1647-1713）；初始版本确认（1717-1805） |
| `console-remote.test.ts` | Remote 契约 | 39 描述符全 strict/agent lookup（92-116）；旧 Host 缺 `returnToLocal` 容忍为 false、未知键拒绝（215-237）；checkpoint 不接受 `internalRef`/`../secret`（264-292）；typert 自动发现（350-365）；topology 免 agent lookup + locale 校验（367-390）；非 owner 在业务分发前拒绝（426-451）；`$mount` 往返与撤回（483-543）；业务错误 ≠ 载体错误（545-610）；初始版本 Remote 边界（614-633） |
| `session-checkout-module.test.ts` | 核心模块 | 独占锁（351-376）；唯一 checkout 身份（2451-2469）；8 字符路径冲突延长（475-488）；EPERM 报 OS 错（516-528）；`In-place binding` 规则（555-567/2921-2938）；超长 commit message 持久化（652-676/698-719）；checkpoint 幂等重放（721-790/792-829）；apply conflict proof（889-932）；worktreeKeepCount LRU（1633-1666）；retention 三态（1697-1732）；detached preview 恢复矩阵（1854-2266）；recovery handoff（2268-2314）；仓库搬迁自动 heal（2493-2521）；`.worktreeinclude`（2523-2551）；v1→v2 迁移（2652-2671）；清理原因结构化字段优先（3098-3142） |
| `session-checkout-apply.test.ts` | Apply 引擎 | checkpoint staged/unstaged/untracked 合一提交且 Local 字节不变（73-111）；崩溃恢复收敛（140-172）；fast-forward 回滚保新提交（492-524）；`preview_modified` 冲突（559-591）；`recorded_base` fail-closed（1006-1023）；invalid_plan（1116-1130）；stale_local 矩阵（1132-1204） |
| `session-branch-delivery.test.ts` | 会话分支 | 交付写 `feat/sess-owner--sleep-wake` 且 Local HEAD/索引/他人未提交文件逐项不变（81-150）；`.dsh-ops` 运行期产物不入变更集（113-130）；两会话不同分支（152-175） |
| `session-branch-adopt.test.ts` | legacy 记录 | detached 记录交付时补建会话分支并回填 `sessionBranch`（93-153） |
| `session-branch-label.test.ts` | 胶囊标签 | 创建后 `currentBranch === 'feat/sess-owner--labels'`（90-121）；交付后 currentBranch 回 main、sourceBranch 保留（123-170） |
| `git-unborn.test.ts` | Git 端口 | unborn 识别与空库初始化保护矩阵（83-238）；真实 host/module 流（174-199）；Windows 长路径（253-310，`it.skipIf(process.platform !== 'win32')`）；Skill 携带不脏检出（312-329）、不入评审/交付（331-386） |
| `git-tags.test.ts` | 标签 | 轻量/附注/指定 target/重名拒绝/推送状态 null 语义（65-178） |
| `git-timeouts.test.ts` | 超时 | 三类截止独立（31-50）；volatile live 引用逐命令读取（60-69）；Config schema volatile 标记（77-84） |
| `git-creation-lifecycle.test.ts` | 创建生命周期 | 30s+270s 静默窗口与 quiescence 四态（11-70）；`.worktreeinclude` 的 codex 语义（72-96）；废弃 worktree 快照/恢复（98-133） |
| `worktree-creation.test.ts` | 创建失败 | 八种残留保留策略（54-77/159-184）；不误修他 checkout（79-89）；sparse checkout 等价（117-131） |
| `surface.test.ts` | 工具面 | 9 个工具注册序（31-52）；list 输出无 undefined 键（54-83）；`worktree_create` cwd 切换（285-331）；cleanup 在 cwd 移动失败时中止（333-356） |
| `console-contract.test.ts` | 状态投影 | `consoleStateFromDomain` 11 态（20-38）；`worktreeReachedDelivery`（40-52）；错误恢复策略（54-75）；夹具记录精确调用（77-97） |
| `client-target-console.test.tsx` | 目标控制台 | 状态→文案表（154-169）；非 Git 专用文案（171-205）；分支搜索阈值 12（245-300）；标签全流程（302-518）；跨 Session 丢弃旧请求（520-542/624-677）；detached preview proof 展示（752-801）；guarded mutations CAS（1408-1540） |
| `client-pre-session.test.tsx` | 预会话开关 | 事件顺序快照（199-229）；草稿迁移与归档失败容错（231-280）；Host create 失败零对象（282-300）；两阶段 Discard（302-359）；重复点击合并（413-435）；空库初始提交确认（861-914）；Session 切换回滚（955-977） |
| `client-review-console.test.tsx` | 验收面板 | 只读预检单飞（201-230）；冲突续跑经 `Session.prompt`（232-279）；checkpoint 生成绑定（331-358）；detached proof 展示（497-533）；验收位 busy→available 重检（603-654）；撤回-刷新-再预览同一 review（776-790） |
| `client-recovery-continuation.test.ts` | 恢复续跑 | 空闲 owner 单发（131-155）；inactive scope 取消/中止（199-255）；失败保留可重试（257-306）；持久化恢复与歧义发送不重放（328-367）；伪造 kind/不安全路径拒绝（369-403） |
| `client-workspace-sidebar*.test.ts(x)` | 侧栏 | 一棵声明树 + 子 slot（sidebar.test 117-151）；guard 等拓扑（153-186）；投影模型状态映射（model.test 30-96）；fork 保护与 hash-gated 衍生（profile.test 35-148）；official 回调改名/归档（actions.test 53-146）；7 状态徽章（status.test 64-96）；Mode B 装饰（sidebar.test 313-508） |
| `client-bundle.test.ts` | 产物 | require 白名单（74-84）；`dsh-git-worktree` handoff 与 inject 列表（86-112）；uiWorkspace 先于 conversation（114-216）；picker 懒解析（218-292）；Lucide ESM 选装（295-303） |
| `current-polling.test.ts` | 轮询 | 完成后 5 秒节流（29-38）；burst 合并（40-49）；隐藏窗口挂起（114-133） |
| `workspace-provider-lifecycle.test.ts` | 选举 | 恰一个 provider（142-152）；disable 重放（167-171）；楔死 disable 不阻塞激活（287-297）；慢 disable 落后激活（299-309） |
| `host-query-budget.test.ts` | 预算 | `current: 18, list: 18 + 9*(count-1), preflight: 60, deliver: 90` 次命令上限（67|） |
| `dev-dsh.test.ts` | 开发流 | 默认参数/隔离 home/源码 Harness 发现（46-179）；安装仅限 typecheck/build/pack/add/smoke（237-294）；多 profile 归档保留（390-435） |
| `adapters-safe-file.test.ts` | 安全写 | 最新可解析 `.tmp` 提升（19-31）；legacy `<file>.tmp`（33-40）；不可解析清理+null（42-50）；`.bak` 保留上一份好内容（52-64） |

## Architecture

```text
┌──────────────────────────────────────────────────────────────────┐
│                         tests/  测试套件                          │
└──────────────────────────────────────────────────────────────────┘
  │
  ├─► 支撑层  tests/support/：worktree-console.ts（Console 适配器夹具）
  │           production-adapters.ts（真实 Node 依赖 + 台账校验/迁移）
  │           official-client.ts / ui-primitives.tsx / review-actions-harness.tsx
  │
  ├─► Host 域 console-host.test.ts ──plane()──► src/console-host/control-plane
  │           console-remote.test.ts ──► console-remote/descriptors（39 方法）
  │           session-checkout-module / -apply / session-branch-*
  │
  ├─► Client 域 client-*.test.tsx（jsdom + @testing-library/react）
  │           ──► src/client/{actions,target-console,review-console,...}
  │
  └─► 平台层  git-{unborn,tags,timeouts,creation-lifecycle}.test.ts、
              worktree-creation / project-skills* / workspace-provider-lifecycle
              （真实 git 子进程 + mkdtemp 临时目录）
```

## Data Flow

**客户端渲染测试**：`createWorktreeConsoleAdapterFixture()`（`tests/support/worktree-console.ts:124`）产出记录型 `adapter` → 以 props 传入被测组件（如 `WorktreeReviewStatus`、`PreSessionWorktreeToggle`）→ RTL `render`/`fireEvent` → 断言 `fixture.calls`（精确到 `method` + `request`，例如 `client-target-console.test.tsx:709-714` 要求 `preflight`/`preview` 各收到完整 identity）与渲染文本。stateful 夹具（518-532|）额外模拟 Host CAS：revision 不匹配返回 `stale_target`，成功后 revision+3。

**Host 控制面测试**：`plane(record, overrides)`（`tests/console-host.test.ts:156`）把 `moduleDouble`（88|）+ `registry`/`files`/`git`/`lookup` 替身喂给 `createWorktreeConsoleControlPlane` → 调 `control.current()/list()/inspect()/operate()` → 同时断言 mock 调用参数（如 `console-host.test.ts:165-169` 验证 `operate` 收到完整长 commitMessage）与台账 JSON 落盘结果（如 1604-1628| 的 `sidebarBadgeClearedRevision`）。

**端到端 Git 测试**：`fixture()`（`tests/session-branch-delivery.test.ts:32`）用 `spawnSync('git')` 建临时仓库并把 Local 停在他人分支 → `createNodeSessionCheckoutDependencies`（`tests/support/production-adapters.ts:514`）注入 `createDshGitPort(ctx-stub)` → `createSessionCheckoutModule` → `module.createIsolatedTarget`/`markReadyForReview`/`operate` → 直接断言 git refs/工作区字节（如 141-146|：Local HEAD、symbolic-ref、`?? other-session-note.txt` 状态、文件内容四重校验）。

**Remote 契约测试**：`METHODS`（`tests/console-remote.test.ts:50`）逐个取描述符 → 断言 strict codec、agent lookup 参数（107-113|）、路径安全（拒绝 `../`、`managedRoot` 泄漏）→ 再用真实 `WorktreeConsoleService` + `TypertGatewayService` + `OWNER_PEER` 走网关 invoke（483-543|），客户端侧用 `createWorktreeConsoleRemoteAdapter` 验证参数序与错误归一（545-610|，如 checkpoint 调用序 `('agent-1','checkout-1',7,'review-1',generation,requestId,message,'zh')`）。

## Connections

- [[client]] — `client-*.test.tsx` 覆盖 `src/client/actions.ts`、`src/client/target-console/`、`src/client/review-console/`、`src/client/pre-session/`、`src/client/workspace-sidebar/`、`src/client/settings-card/`。
- [[console-host]] / [[console-remote]] / [[console-contract]] — Host 控制面、Typert 描述符与共享状态投影的直接测试方。
- [[session-checkout-module]] / [[session-checkout-apply]] — 核心模块与 Apply 引擎；`tests/support/production-adapters.ts` 同时被两者复用。
- [[adapters]]（git 端口、safe-file、lookup、working-directory、project-skills）— `git-*.test.ts`、`adapters-safe-file.test.ts`、`lookup.test.ts`、`working-directory-adapter.test.ts`、`project-skills*.test.ts`。
- [[i18n]] — `host-i18n.test.ts`、`host-locale-context.test.ts`、`client-i18n.test.tsx`、`i18n-catalogs.test.ts`、`i18n-references.test.ts`。
- [[workspace-provider-lifecycle]] — `tests/workspace-provider-lifecycle.test.ts` 直接消费 `cordis.patch.yml`（22-28|）。
- [[scripts]]（dev-dsh-lib、workspace-sidebar-upstream{,-next,-alpha}.mjs）— `dev-dsh.test.ts:8-21` 与 `client-workspace-sidebar-{actions,profile,status}.test.ts` 顶部 import。
- [[surface]]（tools/commands 注册）— `surface.test.ts`、`concurrent-session-guard.test.ts:104-155`（runtimeContext 集成）。

## Known Issues

- **平台跳过**：`session-checkout-apply.test.ts:1225/1241` 在 win32 上 `test.skip`（可执行位、符号链接）；`git-unborn.test.ts:72` `it.skipIf(process.platform === 'win32')`（含换行的仓库路径），`git-unborn.test.ts:253` 反向 `it.skipIf(process.platform !== 'win32')`（Windows 长路径）。
- **全局超时**：Git 重型集成超过 Vitest 默认 5s——`session-checkout-apply.test.ts:23-25` 注明全局 30s、`session-checkout-module.test.ts:62-63` 注明 60s（均在 `vitest.config.ts`）；个别测试再加自有超时（`session-checkout-module.test.ts:1045` 60_000、`console-host.test.ts:1672` 30_000 与 1713| 120_000、`host-query-budget.test.ts:97` 120_000）。
- **夹具陷阱**：`console-host.test.ts:1142-1157` 的 live-cwd 授权测试**必须**用 `ownerLocalLookup()`（131|）；若用 `lookupDouble()`，owner 的 project root 恰好等于 `expectedRoot`，断言无论是否有修复都会通过——1151-1152 行注释明确警告。
- **环境隔离**：多数集成测试通过 `testEnvironment()`（`session-branch-delivery.test.ts:12-23`、`git-unborn.test.ts:17-23`、`session-branch-adopt.test.ts:12-23`、`session-branch-label.test.ts:13-24`、`git-tags.test.ts:11-17`）删除 `GIT_AUTHOR_*`/`GIT_DIR` 等变量并设 `GIT_CONFIG_GLOBAL=/dev/null`（win32 用 `NUL`），否则会读到本仓库的 git 配置；`worktree-creation.test.ts:19` 与 `git-creation-lifecycle.test.ts:13` 强调 macOS `/var` → `/private/var` 需 `realpath`。
- **假定时器**：`current-polling.test.ts:8`、`client-polling-diagnostic.test.tsx:24`、`git-creation-lifecycle.test.ts:10`、`git-timeouts.test.ts:8`、`client-actions.test.ts:213-226` 都依赖 `vi.useFakeTimers/advanceTimersByTimeAsync` 并在 afterEach/finally 恢复，遗漏会污染后续用例。
- **依赖真实 `git` 可执行文件**：`console-host.test.ts:28`、`session-branch-*.test.ts`、`git-unborn.test.ts:24` 等直接 `spawnSync('git')`，在没有 git 的环境无法运行；`host-query-budget.test.ts` 还 mock 了 `node:child_process.spawn` 计时（12-21|），但命令次数预算（67|）是确定性断言，墙钟时间仅诊断（62| 注释）。
- **Host 运行期产物**：`.dsh-ops/**` 不得进入评审变更集，由 `session-branch-delivery.test.ts:113-130` 回归守护（注释提到 issue #2）。
