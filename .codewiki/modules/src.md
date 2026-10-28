---
title: src（dsh-git-worktree 插件源码根目录）
type: module
source_files:
  - src/index.ts
  - src/types.ts
  - src/ports.ts
  - src/commands.ts
  - src/tools.ts
  - src/commit-message.ts
  - src/concurrent-session-guard.ts
  - src/console-contract.ts
  - src/console-host/control-plane.ts
  - src/console-host/errors.ts
  - src/console-host/projection.ts
  - src/console-host/review-diff.ts
  - src/console-host/service.ts
  - src/console-remote/descriptors.ts
  - src/console-remote/remote.ts
  - src/console-remote/schemas.ts
  - src/creation-failure.ts
  - src/delivery-excludes.ts
  - src/host-compat.ts
  - src/i18n/core.ts
  - src/i18n/host.ts
  - src/i18n/host-messages.ts
  - src/managed-worktree-path.ts
  - src/session-checkout-apply.ts
  - src/session-target-context.ts
  - src/checkpoint.ts
  - src/workspace-provider-lifecycle.ts
  - src/adapters/files.ts
  - src/adapters/git-options.ts
  - src/adapters/git.ts
  - src/adapters/initial-commit.ts
  - src/adapters/lookup.ts
  - src/adapters/project-skill-io.ts
  - src/adapters/project-skill-provider.ts
  - src/adapters/project-skills.ts
  - src/adapters/registry.ts
  - src/adapters/safe-file.ts
  - src/adapters/working-directory.ts
  - src/adapters/worktree-creation.ts
  - src/client/WorktreeCreateRow.tsx
  - src/client/WorktreeReviewRow.tsx
  - src/client/actions.ts
  - src/client/i18n.tsx
  - src/client/index.tsx
  - src/client/model.ts
  - src/client/harness-platform.d.ts
  - src/client/console-remote/adapter.ts
  - src/client/console-remote/index.ts
  - src/client/pre-session/PreSessionWorktreeToggle.tsx
  - src/client/pre-session/controller.ts
  - src/client/pre-session/harness-input.ts
  - src/client/pre-session/index.tsx
  - src/client/review-console/DeliveryProof.tsx
  - src/client/review-console/PreflightStatus.tsx
  - src/client/review-console/ReviewActions.tsx
  - src/client/review-console/ReviewDetailsModal.tsx
  - src/client/review-console/ReviewIcon.tsx
  - src/client/review-console/WorktreeReviewPanel.tsx
  - src/client/review-console/index.ts
  - src/client/review-console/preflight-cache.ts
  - src/client/review-console/preview-recovery-cache.ts
  - src/client/review-console/recovery-continuation.ts
  - src/client/review-console/request-cache.ts
  - src/client/review-console/status-events.ts
  - src/client/settings-card/WorktreeSettingsCard.tsx
  - src/client/settings-card/form-model.ts
  - src/client/settings-card/index.ts
  - src/client/settings-card/worktree-settings-card.ts
  - src/client/target-console/BranchGraphModal.tsx
  - src/client/target-console/TagManagerModal.tsx
  - src/client/target-console/TargetStatusAction.tsx
  - src/client/target-console/WorktreeConsoleView.tsx
  - src/client/target-console/WorktreeHeroChip.tsx
  - src/client/target-console/WorktreeManagerModal.tsx
  - src/client/target-console/WorktreeReviewStatus.tsx
  - src/client/target-console/branch-overview-cache.ts
  - src/client/target-console/current-polling.ts
  - src/client/target-console/index.ts
  - src/client/workspace-sidebar/index.tsx
  - src/client/workspace-sidebar/model.ts
tags: [git-worktree, dsh-plugin, session-checkout, cordis, react, rpc, git]
---

## Overview

`src/` 是 `dsh-git-worktree` 插件的全部源码：一个挂在 DSH Host（Cordis 依赖注入框架）上的 Git Worktree 管理插件。它把「会话在隔离的受管 Worktree 里工作 → 准备评审 → 用户验收 → 写回/交付 → 清理」做成一条完整生命周期，同时不碰用户 Local 检出的工作区、索引或 HEAD（会话分支交付模式下），或在明确的 CAS 保护下才写 Local。

代码按四层组织：

1. **领域层（host-agnostic）**：`src/types.ts`、`src/ports.ts` 定义类型与端口；`src/session-checkout-apply.ts` 实现纯 git 的 Apply/Preview/Finalize/Checkpoint 引擎；状态机本体 `src/session-checkout-module.ts` 被 `src/index.ts:234` 导入（本文档给到的源码未包含该文件，仅能从 `SessionCheckoutModule` 接口 `src/index.ts:113-219` 观察其公开面）。
2. **适配器层（`src/adapters/`）**：Node fs/subprocess 背书的端口实现（git、files、registry、lookup、working-directory、project-skills）。
3. **主机面**：模型工具（`src/tools.ts`）、人机命令（`src/commands.ts`）、RPC 控制面（`src/console-host/`）、Workspace 接管选举（`src/workspace-provider-lifecycle.ts`）。
4. **浏览器客户端（`src/client/`）**：React ToolView、侧栏装饰、评审动作面板、恢复续传、设置卡片，通过 `src/console-remote/` 的严格 zod 契约与 Host 通信。

所有用户可见文案经 `src/i18n/` 双语（zh/en）输出；敏感判断（身份、CAS、清理授权）一律在 Host 侧完成，客户端数据仅作展示。

## Key Components

### 入口与插件装配（src/index.ts）

| 成员 | 行号 | 用途 |
| --- | --- | --- |
| `SessionCheckoutError` | 41-53 | 领域错误，携带稳定 `code`（来自 `SESSION_CHECKOUT_ERROR_CODES`） |
| `SessionCheckoutReconcileSummary` | 55-61 | reconcile 结果：`recoveryRequiredCheckoutIds`/`orphanedCheckoutIds`/`dirtyOrphanedCheckoutIds`/`staleRootCheckoutIds`/`retainedCheckoutCount` |
| `ManageManagedWorktreeInput` | 63-71 | 管理动作输入：`checkoutId`/`expectedRevision`/`action`（`cleanup_retained`/`retry_cleanup`/`set_retention`/`set_permanent`/`clear_sidebar_badge`/`discard`）+ `retention`/`permanent`/`confirmDirty`/`rollbackPreview` |
| `ListManagedWorktreesInput` | 73-78 | `projectId`/`needsAttention`/`checkoutId`/`includeDiagnostics` |
| `PruneMergedBranchesInput` | 80-85 | `dryRun`、`olderThanDays` |
| `MergeBranchForSessionInput` | 87-94 | `sourceBranch`/`dryRun`/`direction`（`forward`/`reverse`） |
| `MarkReadyForReviewInput` | 96-103 | `summary`/`detailsMarkdown`/`validationStatus`/`validationSummary`/`tests`/`suggestedCommitMessage` |
| `IsolatedTargetLaunch` | 106-110 | 客户端建 Workspace/Session 的交接数据：`targetSessionId`/`managedRoot`/`target` |
| `SessionCheckoutModule` | 113-219 | 状态机完整接口：`inspect`/`runtimeContext`/`refreshBranchRaceGuards?`/`preflight?`/`preflightPreviewRecovery?`/`runExclusiveSessionMutation`/`bind`/`createIsolatedTarget`/`beginNextIteration`/`resumeRevision`/`prepareReviewRegeneration`/`preparePreviewRecoveryAnalysis`/`createPreviewRecoveryHandoff`/`markReadyForReview`/`operate`/`isAutoDeliverEnabled`/`listManagedWorktrees(ForSession)`/`pruneMergedBranchesForSession`/`autoPruneStaleMergedBranches`/`mergeBranchForSession`/`listAbandonedWorktreeSnapshots`/`restoreAbandonedWorktreeSnapshot`/`manageManagedWorktreeForSession`/`inspectManagedWorktreeCleanup`/`bulkCleanupManagedWorktrees`/`manageManagedWorktree`/`resolveManagedRoot`/`resolveRoots`/`observeManagedCheckout?`/`observeManagedCheckouts?`/`cleanupExpiredRetained`/`enforceWorktreeKeepCount`/`reconcile` |
| `inject` | 253 | 具名导出：`{ tools, commands, subprocess, loader: { await: false } }`；`workingDirectory` 为可选服务，运行期 `ctx.get` 动态解析 |
| `Config` | 261-319 | schemastery 配置：`stateDir`(268)、`gitTimeoutMs`(271)、`worktreeAddTimeoutMs`(272)、`autoDeliver`(279)、`autoPush`(284)、`worktreesRoot`(291)、`inheritLocalChanges`(297)、`worktreeKeepCount`(302)、`branchRaceGuard`(309)、`branchRaceWindowMs`(311)、`enableWorkspaceProvider`(318)；带 `volatile()` 标记（256-259）的字段以 `LiveValue` 引用热更新 |
| `resolveStateDir` | 337-341 | 默认 `$DSH_HOME/plugins/dsh-git-worktree`（无 `DSH_HOME` 时 `~/.dsh`） |
| 定时器常量 | 343-347 | `RETENTION_MAINTENANCE_INTERVAL_MS`=15min、`AUTO_PRUNE_INTERVAL_MS`=24h、`AUTO_PRUNE_FIRST_RUN_DELAY_MS`=60s、`AUTO_PRUNE_OLDER_THAN_DAYS`=7 |
| `apply(ctx, config)` | 358-458 | 装配：workspace 接管选举（363）→ stateDir/hooks 目录（364-367）→ 构造 lookup/git/files/registry（375-379）→ `mountProjectSkillProvider`（380）→ `createSessionCheckoutModule`（381-396）→ `WorktreeConsoleService` + 控制面（398-405）→ `registerTools`/`registerWorktreeCommand`/`registerSessionTargetContext`（407-409）→ `ready` 事件 reconcile（414-428）→ 保留期/keep-count 定时器（429-436）→ 自动 prune 定时器（437-452） |

### 领域类型（src/types.ts）

| 成员 | 行号 | 说明 |
| --- | --- | --- |
| `SessionTargetRef` | 11-14 | `{kind:'unselected'} \| {kind:'local'} \| {kind:'isolated', checkoutId}` |
| `SessionCheckoutPhase` | 18-27 | `preparing/ready/applying(废弃)/mutating/recovery_required/finalized/retained/discarded` |
| `WorktreeRetentionMode` | 32 | `cleanup/retain_24h/retain_3d/retain_manual`；默认值 `DEFAULT_WORKTREE_RETENTION='retain_24h'`（39） |
| `WorktreeCleanupReason` | 41-46 | `directory_busy/modified_after_finalize/identity_changed/detached_residue/quarantine_busy` |
| `WorktreeCheckpointView` | 55-63 | 字段：`checkpointId/sequence/reviewId/createdAt/summary/validationStatus/changedFiles` |
| `WorktreeDeliveryProofView` | 79-90 | `localBranch/localHeadBefore/localHeadAfter/changedFiles/validationStatus?/validationSummary?/commitInLocalHistory` |
| `WorktreeDeliveryView` | 92-127 | 七态判别联合：`working/ready_for_review/preview_active/preview_detached/finalized/retained/delivered` |
| `WorktreeApplyPreflightView` | 159-172 | `ready/local_advanced/already_in_local/conflict/blocked` + `WorktreeApplyPreflightFacts`（139-150） |
| `SessionTargetView` | 198-216 | `project/checkout/source/current/ownership/dirty/revision/delivery?/checkpoints?/checkpointGeneration?/reviewSlot?/reviewSlotOwnerSessionId?` |
| 操作类型 | 222-353 | `apply/finish/preview/checkpoint/rollback_preview/finalize_preview/retry_cleanup/discard/recover`；`WorktreePreviewRecoveryProof`（273-291，含 `receiptFingerprint` 等 16 字段） |
| `WorktreePushOutcome` | 389-392 | `status: 'pushed'|'skipped'|'failed'` + `message?` |
| `SessionCheckoutFinishedResult` | 394-411 | `status:'finished'`/`target`/`changedFiles`/`commitOid`/`branch?`/`cleanup`/`cleanupMessage?`/`cleanupReason?`/`push?` |
| `ManagedWorktreeSummaryView` | 453-480 | 管理面投影：含 `approximateBytes/updatedAt/canCleanup/cleanup?/activeSessionIds?` |
| `CONFLICT_DETAIL_FILE_LIMIT`=6、`CONFLICT_DETAIL_DIFF_LIMIT`=4096 | 517-518 | 冲突详情 payload 上限 |
| `MergeLocalBranchResult`/`MergeBranchForSessionView` | 522-540 | merge 结果与方向化视图 |
| `SESSION_CHECKOUT_ERROR_CODES` | 597-627 | 29 个稳定错误码；`SessionCheckoutErrorCode`（629） |

### 端口契约（src/ports.ts）

| 成员 | 行号 | 说明 |
| --- | --- | --- |
| `SessionCheckoutLookupPort` | 40-60 | `getSession`/`getProject`/`getSidebarMemberships?`/`getSessionCwd?`/`listLiveSessions?`；注释（46-53）说明 owner 会话 cwd 即 worktree 根 |
| `GitCheckoutSnapshot` | 62-69 | `root/commonDir/gitDir/branch/headOid/headRef` |
| `BranchOverviewEntry`/`TagOverviewEntry`/`GraphLogCommit` | 72-101 | 分支芯片、标签管理器、提交图的一行数据 |
| `SessionCheckoutGitPort` | 109-230 | 40+ 方法（可选方法带 `?`）：`inspect/status/createDetachedWorktree/attachWorktreeBranch?/removeWorktree/retain*/release*/isAncestor/pushBranch?/repairWorktreeLinks?/pruneWorktrees?/branchOverview?/branchCreationTimes?/mergeLocalBranch?/graphLog?/listTags?/snapshotAbandonedWorktree?/restoreAbandonedSnapshot?` 等 |
| `DirectoryIdentity` | 232-236 | `device/inode/birthtimeNs`（字符串化的三元身份） |
| `SessionCheckoutFilesPort` | 238-255 | `exists/canonicalize/inspectDirectoryIdentity/ensureDirectory/removeEmptyDirectoryTree/quarantineDirectoryTree/removeDirectoryTree/measureDirectoryBytes/readTextFile?/copyFile?/isSymbolicLink?` |
| `SessionBindingRecord` | 257-267 | `sessionId/projectId/projectName/target/ownerSessionId/inheritedFromSessionId?/sourceRef/sourceOid/revision` |
| `WorktreeCreationEvidence` | 274-286 | 字段：`root/rootIdentity/parentIdentity/commonDir/commonIdentity/lockReason/gitDir?/gitIdentity?/metadataFingerprint?/indexFingerprint?/quarantinePath?` |
| `ManagedCheckoutJournal` | 269-331 | create（288-292）与 mutation（294-329）两种 journal，含 `operationId/startedAt/operation/step/baseOid?/planRevision?/previewId?/reviewId?/…/recoveryGeneration?/resumeRevision?/changedFiles?` |
| `ManagedWorktreeCheckpointRecord` | 333-350 | `checkpointId/sequence/reviewId/requestId?/requestedRevision?/generation?/iteration/createdAt/commitOid/parentOid/summary/commitMessage/validationStatus/changedFiles` |
| `ManagedWorktreeReviewRecord` | 361-374 | `reviewId/iteration/preparedAt/detailsMarkdown?/summary/validationStatus/validationSummary?/tests/changedFiles/suggestedCommitMessage/isolatedFingerprint/isolatedHeadOid` |
| `ManagedPreviewReceipt` | 376-395 | `previewId/reviewId/iteration/previewedAt/configuredBaseOid/effectiveBaseOid/baseStrategy/localHeadOid/localHeadRef/localFingerprintBefore/localFingerprintPreview/localWorkingTreeOid/localIndexTreeOid/previewWorkingTreeOid/isolatedHeadOid/isolatedFingerprint/isolatedSnapshotOid/changedFiles` |
| `ManagedDeliveryProof` | 397-405 | `localBranch/localHeadBefore/localHeadAfter/changedFiles/validationStatus?/validationSummary?` |
| 恢复续传类型 | 407-441 | `ManagedApplyConflictRecoveryContinuation`/`ManagedReviewRegenerationContinuation`/`ManagedPreviewRecoveryAnalysisContinuation`/`ManagedPreviewRecoveryHandoffContinuation` |
| `ManagedCheckoutDelivery` | 449-485 | 与 types.ts 的交付七态对应的持久层判别联合 |
| `ManagedCheckoutRecord` | 487-540 | 全字段：`checkoutId(488)/predecessorCheckoutId?(490)/projectId(492)/projectName(493)/ownerSessionId(494)/sourceSessionId?(496)/localRoot(497)/managedRoot(499)/managedGitRoot(501)/gitCommonDir(502)/gitDir(503)/baseOid(504)/applyBaseOid?(506)/previousReview?(508)/checkpoints?(510)/recoveryContinuation?(512)/abandonedSnapshotOid?(514)/abandonedSnapshotAt?(515)/permanent?(517)/sidebarBadgeClearedRevision?(519)/sourceRef(520)/sessionBranch?(528)/sessionTopic?(535)/phase(536)/delivery(537)/journal(538)/revision(539)` |
| `ManagedCheckoutsRegistry` | 542-547 | `{version:2, revision, sessionBindings, managedCheckouts}` |
| `SessionCheckoutRegistryPort` | 549-552 | `read()/write()` |
| `LiveValue` + `liveConfigValue` | 554-565 | 易失配置的活引用解包 |
| `SessionCheckoutDependencies` | 567-608 | `createSessionCheckoutModule` 的全部依赖（含本插件本地适配的 `worktreesRoot/inheritLocalChanges/worktreeKeepCount/branchRaceGuard/branchRaceWindowMs`） |

### 适配器（src/adapters/）

**git.ts（subprocess 背书的 git 端口）**

| 成员 | 行号 | 用途 |
| --- | --- | --- |
| `GIT_TERMINATION_GRACE_MS`/`GIT_COLLECT_BYTES`/`WIP_PATCH_COLLECT_BYTES` | 38/40/42 | 1s 终止宽限；1MB 输出上限；WIP patch 16MB |
| `GitPortOptions` | 44-48 | `hooksPath` + 超时 + `projectSkills` |
| `parseDecoration` | 63-71 | `%D` → ref 名（tag 前缀保留、裸 HEAD 丢弃） |
| `runGit` | 93-188 | 单条 git 命令：`--no-pager --no-optional-locks`、Windows `core.longpaths=true`（107）、`core.hooksPath=禁用目录`（110）、环境变量清洗（121-131，抹掉 `GIT_DIR/GIT_WORK_TREE/…`）、`GIT_TERMINAL_PROMPT=0`、`LC_ALL=C`；创建路径下做 quiescence 确认（157-168）；`GitCommitProtocol` 两阶段 stdin 协议（133-154，轮询 `prepare: ok`） |
| `runGitChecked` | 190-199 | 非零退出抛 `SessionCheckoutError('git_operation_failed')` |
| `checkoutRefRoot` | 201-204 | `refs/dsh-worktree/session-checkouts/<sha256 前 24>` 命名空间 |
| `abandonedSnapshotRef` | 230-233 | `refs/dsh-worktree/abandoned/<checkoutId>`，刻意放在 checkoutRefRoot 之外（225-229 注释） |
| `createDshGitPort` | 249-773 | 组装全部 git 端口方法：`inspect`（256-322，单次 rev-parse 快路径 + unborn 回退 282-321）、`status`（331-335）、`createDetachedWorktree`（336-348）、`attachWorktreeBranch`（405-425，CAS update-ref + symbolic-ref，不碰工作区）、`pushBranch`（426-442）、`repairWorktreeLinks`（443-448）、`listWorktreeincludeFiles`（449-468，两个 `ls-files --others --ignored` 求交集）、`mergeLocalBranch`（649-719，dryRun 临时 worktree 试合并 686-708）、`captureLocalWip`（720-728）、`snapshotAbandonedWorktree`（741-761）、`restoreAbandonedSnapshot`（762-770）等 |

**files.ts**

- `measureDirectoryBytes`（16-24）：符号链接返回 0；`removeEmptyDirectoryTree`（26-35）；`inspectDirectoryIdentity`（37-46，bigint lstat）；`directoryIdentitiesEqual`（48-50）；`quarantineDirectoryTree`（52-72，rename→复核身份，不匹配即回滚且**绝不删除**身份不符对象，69 注释）；`removeDirectoryTree`（74-86，Windows 重试 6 次）。
- `createNodeFilesPort`（89-109）导出 `SessionCheckoutFilesPort`。

**git-options.ts**

- `DEFAULT_GIT_TIMEOUT_MS=120_000`（8）、`DEFAULT_WORKTREE_ADD_TIMEOUT_MS=5*60_000`（9）、`MAX_GIT_TIMEOUT_MS=60*60_000`（10）。
- `validateGitTimeouts`（12-19）：[1000, 3600000] 区间校验。
- `gitTimeoutMs(args, options)`（21-27）：`worktree add` 用 worktreeAdd 超时、`worktree remove` 固定 5min（25）、其余 120s；活引用每次调用现读（22-23 注释）。

**initial-commit.ts**

- `GitCommitProtocol`（8）：`{prepare: string; beforeCommit(): Promise<void>}`。
- `initialCommitActions(inspect, run)`（13-119）返回：
  - `preflightInitialCommit`（29-47）：`ready/empty/files` 三态 + 指纹（39-45，含 root/gitDir/HEAD/index 身份）。
  - `initializeEmptyRepository`（48-100）：`index.lock` 独占（55-58）→ 二次 preflight → `mktree` 空树 → `commit-tree` → `update-ref --stdin` 两阶段 CAS（74-84，`beforeCommit` 在 Git 锁内复检）；`EEXIST` → `initialRepositoryBusy`（87-89）。
  - `initializeProject`（104-117）：非 Git/未出生仓库在用户确认后 `git init -b main` + `add -A` + 首提交。

**lookup.ts**

- `WorkspaceLike`（19-24）/`WorkspaceRegistryLike`（26-32）结构视图；`isWorkspaceRegistryLike`/`isSessionStoreLike`（43-54）鸭子守卫。
- `sameResolvedPath`（56-62）：Windows 大小写不敏感。
- `createDshLookupPort(ctx)`（65-165）：`getSidebarMemberships`（87-108，查 header 而非 transcript）、`listLiveSessions`（109-133）、`getSession`（134-151，workspace 命中失败后用 live header cwd 恢复 145-150）、`getSessionCwd`（152-157）、`getProject`（158-163）。

**project-skills.ts / project-skill-io.ts / project-skill-provider.ts（随会话携带的 Project Skills）**

- `PROJECT_SKILL_ROOTS = ['.dsh/skills','.agents/skills','.claude/skills']`（project-skills.ts:7）、`MAX_FILES=5000`（8）、`MAX_BYTES=64MB`（9）。
- `assertSkillTree`（60-70，≤10000 节点/≤64 层）、`inventory`（74-98）、`ProjectSkillStore`（101-214）：`snapshot`（104-107）、`load`（108-124，manifest 校验：version/root/identity/phase='ready'/hash/mode/去重）、`carry`（125-167，先冲突预检 133-149 → `wx` 独占 manifest（155）→ 复制 → 逐文件 hash 复核（158-161）→ `.ready` 临时文件 + rename 发布 ready（163-166））、`scope`（168-171）、`paths`（172）、`state`（173-203，输出 fingerprint + modified）、`assertRemovable`（204-212）、`forget`（213）。
- `trackedSkillPaths`（216-223）、`hasDeliverableStatus`（225-235，仅 `?? ` 且不属于辅助路径才算干净）、`assertSkillPath`（237-239）。
- project-skill-io.ts：`checkRoot`（10-15）/`checkPath`（16-36，逐段 lstat 拒绝符号链接与特殊文件）/`readSkillFiles`（38-64，O_NOFOLLOW + 双 stat 复核 + 总量 64MB 预算）/`createSkillDirectories`（66-73）/`createSkillFiles`（75-88，O_EXCL 创建 + fsync）。
- project-skill-provider.ts：`managedSkillRoot(registry)`（22-45，双向 gitdir 指针互验后才认 `.claude/skills`）、`ClaudeProjectSkillProvider`（48-119，串行化操作队列 53-57、LRU 32 个 FileSystemSkillProvider 63-67、rank 250）、`mountProjectSkillProvider`（121-133）。

**registry.ts**

- 30+ 个 `is*` 校验函数（26-337）：`isSessionBinding`（55-65）、`isReview`（67-85）、`isCheckpoint`（97-114）、`isJournal`（193-250）、`isManagedCheckout`（292-325）、`isRegistry`（327-337）。
- `migrateLegacyRegistry`（339-394）：v1 记录保守迁移为 `recovery_required`。
- `AtomicJsonCheckoutRegistry`（397-415）：`read`（400-410，损坏即抛 `registry_corrupt`（409）而不是静默覆盖）、`write`（412-415，`writeJsonFileAtomic`）。

**safe-file.ts（崩溃安全 JSON 读写）**

| 成员 | 行号 | 用途 |
| --- | --- | --- |
| `RETRYABLE_RENAME_CODES` | 14-18 | Windows 附加 `EPERM/EACCES/ENOTEMPTY` |
| `sleepSync` | 20-27 | `Atomics.wait` 优先 |
| `renameAtomicWithRetry` | 30-44 | 原子 rename + 指数退避（20ms×2^n）5 次 |
| `tmpPathFor` | 50-52 | `<file>.<pid>.<uuid>.tmp` 唯一命名 |
| `listTmpFiles` | 55-68 | mtime 新→旧 |
| `writeJsonFileAtomic` | 82-100 | 备份 .bak → 写 tmp → 原子 rename；注释 79-81 声明无跨进程锁 |
| `writeTextFileAtomic` | 103-107 | JSONL 会话用 |
| `readJsonFileSafe` | 113-161 | 主文件 → 最新可解析 .tmp（129-141，恢复即提升 + 清理）→ .bak（145-158，`skipBackup=true` 回写）→ null |

**working-directory.ts**

- `WorkingDirectoryServiceLike`（18-24）、`SessionWorkingDirectoryPort`（27-43：`current/enter/leave`，`enter` 返回 undefined 表示宿主无服务不可宣称已切换）。
- `createSessionWorkingDirectoryPort(ctx)`（61-101）：动态 `ctx.get('workingDirectory')`（62-68），无服务/无 agent 一律 no-op（80-85）；`leave` 用 `isWithin`（104-112）判断会话是否仍在待删目录内。

**worktree-creation.ts（创建与回滚证据链）**

- `createWorktree`（17-124）：`mkdir(target)` 独占认领（38）→ evidence（42-43）→ `worktree add --detach --no-checkout --lock`（44）→ gitDir 身份 + metadataFingerprint（45-48）→ sparse 分支 `reset --hard` / 普通分支 `read-tree`+`checkout-index --all`（54-67）→ `unlock`（69）。失败路径（70-123）：未认领→直接抛；已认领未注册且 quiescent→证明目录为空后 `rmdir`（73-91）；已注册→验证 `verifyIdentity`/`verifyRollbackMetadata`/`verifyUnmodified` 后 `worktree move` 进 quarantine 再 remove（94-121）；任何一步无法证明→ `WorktreeCreationFailure(rolledBack:false)` 保留现场（122）。
- `verifyIdentity`（126-148）：双向 `.git`/`gitdir`/`commondir` 指针互验 + HEAD/locked 内容 + 禁止 index.lock（147）。
- `verifyRollbackMetadata`（150-160）与 `metadataFingerprint`（162-183，白名单文件集，排除 `index/gitdir/ORIG_HEAD`）。
- `verifyUnmodified`（185-250）：索引逐条 blob hash 复核（221-241）、`check-attr` 拒绝 filter/working-tree-encoding（214-219）、拒绝 submodule/未知目录/未知文件（193/208/210）。

### 应用引擎（src/session-checkout-apply.ts）

| 成员 | 行号 | 用途 |
| --- | --- | --- |
| `ApplyPlan` | 20-31 | 字段：`revision/localFingerprint/isolatedFingerprint/effectiveBaseOid/baseStrategy/localHeadOid/localHeadRef(null=detached)/isolatedHeadOid/changedFiles` |
| `PreviewReceipt` | 128-147 | 见 ports.ts 同名字段；引擎侧权威定义 |
| `SessionCheckoutApplyEngine` | 279-317 | 接口：`inspectReview/checkpoint/recoverCheckpoint/preflight/plan/apply/finish/commitIsolated?/reviewIsolated?/preview/assessPreviewRecovery/rollback/finalize` |
| `SessionCheckoutApplyEngineOptions` | 319-329 | `projectSkills` + 4 个测试 seam（`beforeFinalLocalValidation/afterLocalWriteBeforeVerification/beforeFinalIsolatedValidation/afterIsolatedWriteBeforeVerification`） |
| 环境清洗 | 392-411 | `AMBIENT_GIT_ENV_PATTERN`（394）、`disabledGitHooksPath()` 懒创建（404-411） |
| `runGit` | 418-480 | 独立 spawn：30s 超时（415）、`allowedExitCodes`、options.env 为刻意注入通道（434-444） |
| `snapshotFingerprint` | 589-604 | sha256(headOid ‖ headRef ‖ indexEntries ‖ treeOid) |
| `captureSnapshot` | 606-659 | 还原 staged 语义（`diff --cached --binary`→`read-tree`→`apply --cached`）再 `add -A` 叠加工作区，得到 `indexTreeOid` 与最终 `treeOid`；排除 `deliveryExcludePathspecs()`（613）；扣除携带的 Skills fingerprint（649-656） |
| `selectEffectiveApplyBase` | 551-572 | 三策略：`recorded_base`/`isolated_contains_local_head`/`local_contains_isolated_head` |
| `computeMerge` | 706-802 | 临时仓库三方 merge；冲突时逐文件 diff 截断（`collectConflictDetails` 684-704） |
| `computeTreeMerge` | 804-893 | 树级三路合并（`C = H + (M - L)` 的原语） |
| `DefaultSessionCheckoutApplyEngine` | 1175-2672 | 关键方法：`checkpoint`（1190-1331，`beforeCommit` 持久化 → index.lock + `.dsh-<oid>` marker → HEAD CAS（分支符号引用走 `update-ref <headRef>`，1242-1250）→ rename 换 index → 写后复核）；`recoverCheckpoint`（1333-1419）；`reviewIsolated`（1476-1512，完全不读 Local）；`commitIsolated`（1521-1608，会话分支交付：`update-ref HEAD` + `reset --quiet`（1570-1572），守门「Worktree 必须在传入 branch 上」1543-1552）；`calculatePlan`（1618-1735，`plans` Map 每 isolated 只存一份，1710-1716）；`apply`（1737-1816，四次快照 CAS → 打补丁）；`preview`（1818-1958，`beforeWrite` 先落 receipt）；`assessPreviewRecovery`（1960-1986，`prepareRollbackAssessment` 969-1042 / `prepareFinalizeAssessment` 1044-1105）；`rollback`（1988-2091）；`finalize`（2093-2367，`writeIndexLock`（1147-1166）持有 git index.lock 完成校验→update-ref→rename 换 index；失败补偿 2282-2315，无法证明则保留 `backupIndex` 现场 2350-2358）；`finish`（2369-2655，锁内完成 worktree patch + branch CAS + index 替换，2592-2640，失败逆序回滚 2608-2639） |
| `createSessionCheckoutApplyEngine` | 2674-2678 | 工厂 |

### 主机控制面（src/console-host/）

**errors.ts**

- `domainError`（5-11）：`Error + code(+continuation)`；`consoleFailure`（13-41）：领域错误转 `WorktreeConsoleOutcome`，否则归为 `git_error` 并**原样透传**错误文本（30-33 注释）；`failure`（43-58）；`outcome`（60-66）。

**projection.ts**

| 成员 | 行号 | 用途 |
| --- | --- | --- |
| `capabilities(record, callerSessionId, ownerSessionAvailable, linkedRead)` | 62-105 | 16 个能力位：`create/open/inspect/discard/preflight/preview/checkpoint/resumeRevision/rollbackPreview/finalize/finalizePreview/setRetention/setPermanent/retryCleanup/beginNextIteration/returnToLocal`（returnToLocal 语义见 98-103 注释） |
| `sourceBranchFromRef` | 112-114 | `refs/heads/x` → `x` |
| `projectRecord` | 116-190 | → `WorktreeConsoleTargetSummary`；`sourceBranch` 取 `record.sessionBranch ?? record.sourceRef`（150）；`cleanupMessage` 经 `hostPersistedCleanupMessage` 本地化（157） |
| `projectDetails` | 192-270 | + `managedRoot/sourceRoot/sourceOid/currentBranch/recoveryContinuation`；`currentBranch` 用 `settledLocalBranch ?? snapshot?.branch ?? sourceBranchFromRef(sessionBranch)`（226） |
| `projectLocal` | 272-310 | Local 目标投影（`create` 仅在非 unversioned 时可用，288） |

**control-plane.ts**

| 成员 | 行号 | 用途 |
| --- | --- | --- |
| `WorktreeConsoleControlPlane` | 80-119 | 38 个 RPC 方法签名 |
| `sidebarTaskState` | 127-138 | 交付优先于 phase（128-131 注释） |
| `unboundLocalTarget`/`callerTarget` | 209-239 | `target_unselected` 时降级为 Local 投影 |
| `verifyCallerRoot` | 241-316 | 授权边界：owner live cwd == expectedRoot；已交付终态可经 Local 边界放行（259-265）；`canonical` memoize（269-276） |
| `authorize` | 318-338 | `recordOf` + owner/source 判定 + 项目匹配 + 根校验 + 可见性 |
| `linkedReadAccess` | 340-398 | 非属主读（同链接组 / 精确验收槽持有者） |
| `observe`/`observeFromCaller` | 400-461 | 复用 `callerTarget` 已付的三次 spawn（425-442 注释） |
| `settledLocalBranch` | 489-513 | 已交付 owner 的会话实际所在分支 |
| `acceptanceHolder`/`projectReviewSlot` | 519-551 | Local 验收槽占用检测；占用时关闭 `preview/checkpoint/finalize`（548） |
| `withCreation`/`createTarget`/`preflightCreate`/`createWithInitialCommit`/`initProject` | 655-994 | 创建互斥（`creating` Set，628-672）、确认令牌 Map（627，300s 过期、上限 500） |
| `current`/`list`/`inspect` | 764-770/879-954/996 | 批量观察降级（905-934）；`needsAttention` 过滤（944-950） |
| `reviewDiff` | 998-1036 | 读前/读后双重 preflight + 指纹复核（1018-1030） |
| `checkpoint`/`preview`/`resumeRevision`/`prepareReviewRegeneration`/`rollbackPreview`/`discard`/`finalize`/`finalizePreview`/`setRetention`/`setPermanent`/`retryCleanup`/`clearSidebarBadge`/`beginNextIteration`/`returnToLocal` | 1148-1551 | 每个 mutation 都走 `authorize` + revision CAS + 写后身份复核；冲突结果转 `applyConflictContinuation`（167-190） |

**review-diff.ts**

- 常量 `REVIEW_DIFF_MAX_FILES=200`（9）、`REVIEW_DIFF_MAX_PATCH_BYTES=100KB`（10）、`REVIEW_DIFF_MAX_PAYLOAD_BYTES=1MB`（11）。
- `ReviewDiffStaleError`（25-30）；`parseNameStatus`（90-113，R/C 折叠为 renamed，97-99 注释）。
- `createGitWorktreeReviewDiffReader(projectSkills?)`（123-245）：临时 object dir + `GIT_INDEX_FILE` 隔离环境（134-144）、`read-tree baseOid`+`add -A`（145-146）、剔除携带 Skills（147-162）、name-status 与 review.changedFiles 逐项比对（174-177）、按批 8 并行取证（183-238）、payload 超限 UTF-8 安全截断（72-78 + 223-232）。

**service.ts**

- `WorktreeConsoleService extends TypertRemoteService`（35-343）：`@Remote` 方法逐个转发控制面对应方法（控制面的 `gitListTags/gitCreateTag/gitDeleteTag/gitPushTag` 四个标签方法未在此暴露）；`appendDiag`（47-52，ndjson 诊断，永不抛错）；`sidebarTopology` 附带 `workspaceClientFlavor` 与 `officialWorkspaceActive`（55-67）；`current` 记录 `durationMs` 与失败 code（76-89）；除诊断上报 `clientBootReport` 外，每个方法 `withHostLanguage(locale ?? languageFromSettings(...))` 包裹。

### RPC 契约层（src/console-remote/ + src/console-contract.ts）

**console-contract.ts**

| 成员 | 行号 | 说明 |
| --- | --- | --- |
| `WORKTREE_CONSOLE_TARGET_STATES` | 26-38 | 11 个 UI 态：`local/creating/working/ready_for_review/preview_active/preview_detached/retained/cleanup_pending/recovery_required/delivered/discarded` |
| `worktreeReachedDelivery` | 64-73 | `delivered/finalized/retained` 交付或 phase 终态 |
| `consoleStateFromDomain` | 76-91 | 领域 → UI 态映射（`discarded` 优先于 retained/finalized，81-84 注释） |
| `WorktreeConsoleTargetSummary` | 149-179 | 全字段见上文枚举（project/checkoutId/sourceSessionId/ownerSessionId/targetSessionId/iteration/revision/state/phase/dirty/currentOid/commitOid/sourceBranch/retention?/retainedAt?/expiresAt?/permanent?/cleanupMessage?/deliveryProof?/review?/checkpoints?/checkpointGeneration?/reviewSlot?/reviewSlotOwnerSessionId?/reviewSlotHolder?/previewRecovery?/capabilities） |
| `WorktreeConsoleTargetDetails` | 182-195 | 追加 `managedRoot/sourceRoot/sourceOid/currentBranch/recoveryContinuation?` |
| 请求/响应 | 197-607 | `Create(Preflight)`/`Inspect`/`Preflight`/`Checkpoint`/`ResumeRevision`/`PreviewRecovery*`/`Discard`/`Finalize(Preview)`/`SetRetention`/`SetPermanent`/`RetryCleanup`/`BeginNextIteration`/`ClearSidebarBadge`/`ReturnToLocal`/`Abandoned*`/`ReviewDiff`/`Git*` 等 |
| 恢复凭证 | 628-686 | `WorktreeApplyConflictContinuation` 与四种 `*Proof` |
| `ERROR_META` + `worktreeConsoleErrorMeta` | 705-742 | 每错误码的 `category/recovery/retryable` |
| `WorktreeConsoleAdapter` | 745-784 | 客户端统一 seam（`preflightCreate?/createWithInitialCommit?/initializeProject?/listAbandoned?/restoreAbandoned?` 可选） |

**console-remote/schemas.ts**（zod strict）

- 基础：`sessionIdSchema`（31）、`checkoutIdSchema`（32）、`reviewIdSchema`（33）、`commitMessageSchema`（34）、`revisionSchema`（35）、`oidSchema`（37-41，允许 `unversioned`/`unborn`）、`previewIdSchema`（42）、`generationSchema`（43）、`requestIdSchema`（44）、`branchNameSchema`（45-50）、`retentionSchema`/`retainedModeSchema`（54-55）。
- `capabilitiesSchema.returnToLocal` 用 `z.boolean().default(false)`（84-106，注释说明跨版本容错原因）。
- `targetSummarySchema`（122-155）、`recoveryContinuationSchema`（162-170）、四种 proof（171-202）、`consoleErrorSchema` 限制 continuation 仅 `apply_conflict`（216-225）、`outcomeSchema`（227-232）、`preflightSchema`（300-313）、`previewRecoveryProofSchema`（343-360）、git 面 schema（385-448）、`abandoned*`（450-463）。

**console-remote/descriptors.ts / remote.ts**

- `strictCodec`（52-56）：`create()` 惰性 schema + 兼容旧版 `schema` 字段。
- `WORKTREE_CONSOLE_DESCRIPTORS`（94-246）：39 个 `InvocationDescriptor`（agent 参数 wire=`agentId`，locale 末位必传）。
- `WORKTREE_CONSOLE_REMOTE`（248-251）默认导出于 remote.ts:33；`remote.ts:36-82` 对 `TypertRemoteMap` 做模块扩充声明全部 39 个方法的签名。

### 浏览器客户端（src/client/）

**入口与模型**

- `src/client/index.tsx`：`WORKTREE_CONSOLE_ADAPTER_SERVICE='worktreeConsole'`（18）；`inject`（36）；`apply(ctx, adapterOverride?)`（49-105）——`localizedSlots` Proxy 为每个注册包裹 `ClientI18nProvider`（53-59）、自标记 `<style>`（69-77）、注册 `tool.call.toolview` 两个 keyed 行（81-88）、有 adapter 时挂 `registerTargetConsole`/`registerPreSessionWorktree`（91-105）。
- `src/client/model.ts`：纯重放稳定解析——`parseCreateTool`（100-117，校验 `worktree_target_created` payload 7 个必填字符串）、`parseReviewTool`（152-185，args 严格校验 `reviewArgs` 119-150）、`lifecycle`（86-90，`interrupted`→`stopped`）。
- `src/client/i18n.tsx`：`readClientLanguage`（19-21）、`clientTranslator`（23）、`ClientI18nProvider`（29-40，`useSyncExternalStore` 绑 locale snapshot）、`translatorForServices`（49-51）。
- `src/client/harness-platform.d.ts`：三个 `virtual:dsh-official-workspace-client*` 与 `dsh-client-ui-primitives`（`Menu/Modal/MenuItemButton` 等，31-78）的类型声明。

**动作编排（src/client/actions.ts）**

| 函数 | 行号 | 用途 |
| --- | --- | --- |
| `navigateToSession` | 125-132 | 优先 `uiWorkspace.openSession`，否则 `sessions.open`，否则抛错 |
| `selectedSessionId` | 135-142 | 兼容 `current` 与 `retainedBy.mainView` 两代选中协议 |
| `openExistingSession` | 145-154 | 仅当 Harness 列表证明 id+cwd 匹配才导航 |
| `waitForProjectedSessionPath` | 156-196 | 2s 超时等待投影 cwd 匹配（188-190） |
| `openIsolatedTarget` | 199-230 | 幂等：已存在→校验 cwd 后导航；否则 `workspaces.create` → `sessions.create` → 等投影 → 导航 |
| `openAuthorizedWorktreeTarget` | 236-263 | 先 `adapter.inspect` 校验 `checkoutId/ownerSessionId/targetSessionId` 一致再开 |
| `prefillSessionDraft` | 266-275 | 只写草稿，绝不 `command/send` |
| `finalizeCurrentSession` | 278-292 | 把验收卡接受转成显式 `/worktree finalize` 命令 |

**评审控制台（src/client/review-console/）**

| 成员 | 文件:行号 | 用途 |
| --- | --- | --- |
| `request-cache.ts` `createRequestCache` | 41-151 | 身份键单飞缓存：per-adapter WeakMap（51）、`generation` 防失效后旧响应回写（87/93/101/114-116）、`read/invalidate/useSnapshot` |
| `preflight-cache.ts` / `preview-recovery-cache.ts` | 7-23 / 7-23 | 基于 request-cache 的两个只读预检缓存（写前必须 force） |
| `status-events.ts` | 1-6 | `WORKTREE_REVIEW_REFRESH_EVENT` + `requestWorktreeReviewRefresh`（window CustomEvent） |
| `recovery-continuation.ts` | — | 恢复续传模块：`RecoveryEntry`（38-47）、`entries` Map + `STORAGE_PREFIX`（49-51，localStorage 持久化 73-118）、`validRequest`（140-167）、`buildWorktreeRecoveryPrompt`（378-386）、`enqueueWorktreeRecovery`（389-427）、`attempt`（280-376，发送前二次 inspect + 会话就绪守卫 `sessionReady` 238-252）、`restoreWorktreeRecovery`（429-489）、`retryWorktreeRecovery`（491-501，cancelled 亦可重发，493 注释）、`useWorktreeRecoverySnapshot`（513-520）、`cancelWorktreeRecovery`（523-528）、`clearWorktreeRecovery`（540-548） |
| `ReviewActions.tsx` | 82-1199 | 验收动作中枢：`previewLocal`（453-485）、`checkpoint`（494-534）、`resumeRevision`（536-559）、`rollbackPreview`（561-623）、`submitCommit`（625-697，finish/finalize_preview 双模式）、`discard`（699-722）、`startConflictRecovery`（265-358）、`startReviewRegeneration`（360-422）、`analyzeRecovery`（741-795）与 `handoffRecovery`（797-856）、`retryCleanup`（858-876）、`openHolder`（878-895）；UI 部分渲染主按钮/更多菜单/三个 Modal（923-1112）与 detached 恢复区（1124-1163） |
| `WorktreeReviewPanel.tsx` | 54-118 | 紧凑评审卡 + `reviewIsStale`（40-52） |
| `ReviewDetailsModal.tsx` | 36-88 | 详情弹窗（焦点陷阱 41-64、列表折叠 17-34） |
| `PreflightStatus.tsx` | 21-114 | 预检状态条（conflict/blocked/事实表） |
| `DeliveryProof.tsx` | 16-48 | 交付证据（compact/full 两形态） |
| `ReviewIcon.tsx` | 8-21 | lucide 图标映射 |
| `index.ts` | 12-35 | `reviewEvidenceFromTarget`/`reviewIdentityFromTarget` |

**目标控制台（src/client/target-console/）**

| 成员 | 文件:行号 | 用途 |
| --- | --- | --- |
| `registerTargetConsole` | index.ts:19-46 | 注册 `conversation.session.header.actions`（order 30）与 `conversation.input.dock` 两个 seat（order 10/20） |
| `TargetStatusAction.tsx` | 51-764 | 顶部胶囊 + 分支菜单：`subscribeCurrent` 订阅（120-138）、分支切换乐观补丁（200-218）、prune 预览（287-337）、`initializeRepository`（257-285）、菜单项构造（494-559） |
| `current-polling.ts` | — | `Poll` 类（22-91）：5s 轮询（DELAY=5_000, 9）、隐藏页降至 60s（HIDDEN_DELAY, 15）、`invalidate` 立即触发；`subscribeCurrent`（94-107，adapter WeakMap + `[sessionId,language]` 键） |
| `branch-overview-cache.ts` | — | 60s TTL（17）模块级缓存；`patchBranchOverview`（41-46）乐观补丁 + `patchEpochs` 防飞行覆盖（23-25/58/61）、`ensureBranchOverview`（80-84）、`refreshBranchOverviewInBackground`（87-92） |
| `BranchGraphModal.tsx` | 39-127/175-311 | `mergeRefs`（39-57）、`computeGraphLanes`（66-127，lane 拓扑 + 洞复用）、SVG 渲染与分页加载 |
| `TagManagerModal.tsx` | 26-262 | 标签 CRUD；每个 mutation 后重拉列表（24-26 注释） |
| `WorktreeConsoleView.tsx` | 93-700 | 管理面板：`refresh`（145-176，current+list+abandoned 三并发）、`createTarget`（236-291）、`discardTarget`（293-319）、`setPermanentFlag`/`setRetentionMode`（346-389）、`restoreAbandonedSnapshot`（391-412）、`openListedTarget`（414-437）、注意力排序（78-90 + 439-447） |
| `WorktreeHeroChip.tsx` | 84-142 | 空会话 hero 行 portal（`findHeroRowFrom` 44-69 结构优先 + 4s 兜底轮询） |
| `WorktreeReviewStatus.tsx` | 25-184 | composer 上方交付状态 dock（`subscribeCurrent` 57-73；`standaloneRecovery` 75-99；`renderStatus` 154-168） |
| `WorktreeManagerModal.tsx` | 18-49 | `WorktreeConsoleView` 的 Modal 包装 |

**空白会话准备（src/client/pre-session/）**

- `index.tsx`：`registerPreSessionWorktree`（30-60，`conversation.input.left` seat，order 40；`sessionPhase` 推导 39-40）。
- `PreSessionWorktreeToggle.tsx`：`PreSessionWorktreeToggle`（36-180）——`scopeRef` 渲染期失效（47-53）、`preflightCreate` → 三态 pending（96-116）、确认创建（125-147，令牌一次性，142 注释）、Modal 文案（163-177）。
- `controller.ts`：`PreSessionWorktreeError`（37-42，`recoveryRequired`）；`PreSessionWorktreeController`（67-230）：inflight 去重（75-83）、`run`（85-195）——创建 → `workspaces.create` → `sessions.create`（保留 agentPreset 102-130）→ `handoff`（138-156，**无 await 区间**完成 setDraft/addImages/navigate/清源 147-155）→ 归档源会话（170）→ 失败回滚 `rollback`（197-229，先 discard 两个调用方、再 archive、再删 workspace）；`createPreSessionWorktreeController`（232-237）。
- `harness-input.ts`：`readHarnessInput`（14-19）、`adaptHarnessInputActions`（22-31，attachment API 兼容）。

**侧栏（src/client/workspace-sidebar/）**

- `model.ts`：`sidebarBadgeTasks`（51-74，每 owner 取最新 iteration/revision）、`projectManagedWorkspaceSidebar`（81-203，受管 owner 并回 Local 项目、目录归属 claims 142-193、歧义 fail-open 82-85 注释）。
- `index.tsx`：`sharedTopology` 模块级共享（24-40）；`ManagedOfficialWorkspaceBrowser`（70-203，投影 `useWorkspaces/useSessions` + 守卫 `startSession/forkSession/insertSessionBefore` 185-201）；`officialContextProxy`（237-321，`remote.directoryPicker` 延迟 facade 219-235、`remoteAccess` stub 309-316、guard 拦截危险菜单项 258-271）；`registerManagedWorkspaceSidebar`（328-334）；`ClearSidebarBadgeMenuItem`（347-381）；`ROW_SEATS = ['sidebar.session.row.leading','sidebar.session.row.hover']`（424，0.2.x 无 trailing seat，413-423 注释）；`registerDecoratedWorkspaceSidebar`（495-535，Mode B 装饰路径）。

**远程适配器（src/client/console-remote/）**

- `adapter.ts`：`FAST_TIMEOUT_MS=30_000`（56）、`SLOW_TIMEOUT_MS=180_000`（57）、`FAST_METHODS`（60-65）；`createWorktreeConsoleRemoteAdapter`（80-156）——`Promise.race` 超时（89-102）、codec 拒绝识别（45-48）、结果 strict 解析（105-111）。
- `index.ts`：`apply(ctx)`（62-206）——`$mount(contribution)`（64）→ `worktreeConsole` provide（72）→ `mountSettingsCard`（73）→ `sidebarTopology` 决定四代 Browser 分支（104-205）：`legacy`/`modern`（decorate vs inject）/`alpha|next`/`unsupported`；`reportBoot`（86-102）上送诊断。

**设置卡片（src/client/settings-card/）**

- `form-model.ts`：`SettingsFormScopeSnapshot`（24-37，含 `base/user/revision`）；`settingsBooleanField`（129-141）、`settingsNumberField`（149-162）、`settingsTextField`（170-179）；`SettingsFormModel`（188-369）：`bind`（214-218）、`shell`（224-235）、`field`（242-254）、`actions`（260-275）、`save`（285-303，revision 围栏 mutation，失败保留草稿）、`plan`（313-328）、`dispose`（306）。
- `worktree-settings-card.ts`：`WORKTREE_SETTINGS_NS='dsh-git-worktree'`（14）、`WorktreeSettings` 接口（17-23）、`WorktreeSettingsCardController`（39-69）。
- `WorktreeSettingsCard.tsx`：`WorktreeSettingsCard`（162-234，`view==='summary'` 只出一行，165）；`index.ts`：`mountSettingsCard`（35-56，`plugins.bundle.config` slot 注入 52-56）。

### 模型工具与人机命令

**src/tools.ts**（全部经 `withHostLanguage(languageForInvocation(...))` 包裹）

| 工具 | 行号 | 关键行为 |
| --- | --- | --- |
| `worktree_create` | 100-166 | in-place：`targetSessionId = sourceSessionId`（136-137）；必传 createOptions 触发 bind 升级（134-135 注释）；`enterCheckout` 把 cwd 切进 Worktree（148）；输出 `worktree_target_created` JSON |
| `worktree_list` | 168-224 | 输出 `worktree_list`，commitOid 缺省省略（216-218 注释） |
| `worktree_resume_revision` | 226-271 | Ready→Working，不动 Local |
| `worktree_begin_next_iteration` | 273-316 | 已交付+已清理后重建 cwd |
| `worktree_ready_for_review` | 318-403 | 参数含 summary/details/tests/suggestedCommitMessage；输出 `worktree_ready_for_review` |
| `worktree_deliver` | 405-506 | `isAutoDeliverEnabled()` 关闭即拒（451-453）；先 `leaveCheckoutBeforeRemoval`（470-473）→ `operate finish` → 失败回 `enterCheckout`（486）；autoPush 结果并入 `push` |
| `worktree_cleanup` | 508-558 | checkoutId+expectedRevision CAS 清理保留环境 |
| `worktree_prune_branches` | 560-628 | dryRun 默认行为由 `module.pruneMergedBranchesForSession` 决定 |
| `worktree_merge` | 630-692 | `direction` forward/reverse；`failed` 直接抛 `reason` |

辅助：`leaveCheckoutBeforeRemoval`（51-66，cwd 无法还原则**中止删除**）、`enterCheckout`（76-91，台账优先、验证路径为回退）。

**src/commands.ts** `registerWorktreeCommand`（44-228）：`/worktree` 动词 `status`(84)/`list`(87)/`continue`(97)/`next`(110)/`finalize`(121，`[<reviewId> <revision>] [retention]`，验收卡过期校验 133-138)/`finish`(160)/`discard`(180)/`remove`(201)；所有可能删除 checkout 的动词先 `leaveCheckout`（51-61，失败即中止）。

**src/session-target-context.ts** `registerSessionTargetContext`（14-41）：system prompt `git-worktree:session-target`（order 118，31），同步读取 `module.runtimeContext(sessionId, workingDirectory.current(agent))`；分支竞态守卫后台 45s 刷新（20-27）。

### 横切基础设施

| 文件 | 公开项 | 行号 | 说明 |
| --- | --- | --- | --- |
| `src/commit-message.ts` | `isValidCommitMessage` | 2-4 | 非空且无 NUL（500 字符非 git 限制，1 注释） |
| `src/creation-failure.ts` | `WorktreeCreationFailure` | 2-6 | `rolledBack: boolean`；「失败不等于空目录可复用」（1 注释） |
| `src/delivery-excludes.ts` | `HOST_RUNTIME_ARTIFACTS` / `deliveryExcludePathspecs` | 12-16 / 22-30 | `.dsh-ops`、`desktop-runtime.json`、`.dsh-runtime.json`；4 类 pathspec（含 `**` 变体） |
| `src/concurrent-session-guard.ts` | `cwdWithinLocalRoot` / `detectLocalBranchRace` | 60-65 / 68-89 | 纯同步谓词：早于本会话的 Local 会话 × 检测窗内新建分支（排除 managed 分支 49-51/79）→ `race_detected` |
| `src/checkpoint.ts` | `checkpointGenerationForRecord` | 16-29 | 对 `canonicalJson`（4-13，键排序去 undefined）做 sha256，产出 checkpoint CAS generation |
| `src/managed-worktree-path.ts` | `sanitizeManagedWorktreeLabel`（15-29）、`createManagedWorktreeRepositoryKey`（38-40，sha256 前 12）、`sanitizeBranchSegment`（46-55）、`createSessionBranchCandidates`（63-75，`feat/sess-<会话>--<主题>`，重名 `-2/-3…`）、`createTopicManagedWorktreeDirectoryName`（101-112，`<主题>-<YYYYMMDD>`）、`createManagedWorktreePathCandidates`（132-175，`worktreesRoot` 存在时双容器同址；否则兄弟目录 `--worktrees` + 状态目录回退） |
| `src/host-compat.ts` | `workspaceClientFlavorForAgentVersion`（7-25：legacy/alpha/next/modern/unsupported，0.2.x 全系视为 modern，23）、`workspaceFlavorDiagnostics`（65-77，entry/cwd/plugin 三锚点探测）、`hostWorkspaceClientFlavor`（79-81） |
| `src/i18n/core.ts` | `normalizeLanguage`（4-6）、`MessageCatalog`（8）、`Translator`（14-17，模板占位符类型化）、`createTranslator`（19-24） |
| `src/i18n/host.ts` | `languages` AsyncLocalStorage（6）、`withHostLanguage`（12-14）、`languageFromSettings`（17-27，只读 `settings.get('locale').preference`）、`languageForInvocation`（30-33）、`hostMessage`（35-38） |
| `src/i18n/host-messages.ts` | `hostMessages`（4-1756，约 500 键 zh/en）、`hostRegistrationMessage`（1759-1761，注册期双语拼接）、`hostPersistedCleanupMessage`（1770-1773，持久化清理判别文案的有限白名单本地化，1764-1767 注释） |
| `src/workspace-provider-lifecycle.ts` | `OFFICIAL_WORKSPACE`（11）、`UNLOADING=5`（13）、`ownedDisables` WeakSet（26）、`mountWorkspaceProviderLifecycle(ctx, flavor, options)`（66-304）：未启用/不支持 → 官方 Workspace 存活（81-88）；Loader 选举 disable/restore（132-180，每操作 10s 天花板 18）；`internal/status`/`internal/plugin` 事件重入选举（267-276）；卸载时恢复自家 adopted 条目（208-259）；返回 `{officialWorkspaceActive}`（303） |

## Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│ DSH Host (Cordis) — src/index.ts apply() @358 装配            │
└───┬──────────────┬───────────────┬───────────────────────────┘
    ▼              ▼               ▼
┌─────────┐ ┌────────────┐ ┌───────────────────────────────┐
│模型工具   │ │/worktree   │ │WorktreeConsoleService         │
│tools.ts │ │commands.ts │ │console-host/service.ts @Remote│
└────┬────┘ └─────┬──────┘ └──────────────┬────────────────┘
    └────────────┼───────────────────────┘
                 ▼
┌──────────────────────────────────────────────────────────────┐
│ 状态机 SessionCheckoutModule(session-checkout-module.ts)       │
│ + DefaultSessionCheckoutApplyEngine @1175                     │
│   src/session-checkout-apply.ts（纯 git CAS 写入）              │
└──┬──────────────┬───────────────┬──────────────┬──────────────┘
   ▼ ports.ts     ▼               ▼              ▼
┌──────────┐ ┌──────────┐ ┌──────────────┐ ┌──────────────┐
│git port  │ │files port│ │registry port │ │lookup/cwd    │
│git.ts    │ │files.ts  │ │registry.ts   │ │lookup.ts     │
└──────────┘ └──────────┘ │+safe-file.ts │ │+working-dir  │
                          └──────────────┘ └──────────────┘
```

浏览器侧与 Host 的 RPC 链路：

```text
React 组件                      客户端适配层                    Host
┌────────────────────┐  ┌─────────────────────────┐  ┌────────────────────┐
│target-console/     │► │console-remote/adapter.ts│─►│WorktreeConsole     │
│review-console/     │  │超时 30s/180s @56-57      │  │Service @Remote     │
│workspace-sidebar/  │  │strict zod 解析 @105-111  │  │service.ts @35      │
└────────────────────┘  └───────────┬─────────────┘  └─────────┬──────────┘
                                    ▼ descriptors/schemas      ▼
                        ┌─────────────────────────┐  ┌────────────────────┐
                        │WORKTREE_CONSOLE_        │  │createWorktree-     │
                        │DESCRIPTORS @94          │  │ConsoleControlPlane │
                        └─────────────────────────┘  │@206 authorize/CAS  │
                                                     └─────────┬──────────┘
                                                               ▼
                                                  SessionCheckoutModule
```

## Data Flow

1. **创建 Worktree（in-place）**：Agent 调 `worktree_create`（tools.ts:101）→ `module.createIsolatedTarget` → git 端口 `createDetachedWorktree`（git.ts:336）→ `createWorktree`（worktree-creation.ts:17）保存 `WorktreeCreationEvidence` 到 registry journal → `attachWorktreeBranch`（git.ts:405）挂会话分支 → `projectSkills.carry`（project-skills.ts:125）复制技能 → 输出 `worktree_target_created` JSON → `client/WorktreeCreateRow.tsx` 按 `parseCreateTool`（model.ts:100）渲染，`cwdSelected=false` 时给「打开隔离会话」按钮（`openIsolatedTarget`，actions.ts:199）。

2. **评审 → 验收**：`worktree_ready_for_review`（tools.ts:318）冻结评审快照；客户端 `WorktreeReviewRow`/`WorktreeReviewStatus` 经 `adapter.preflight`（只读预检缓存 request-cache.ts:41）确认后 `preview`（写 Local 预览，apply engine `preview` @1818，`beforeWrite` 先落 receipt journal）→ 用户在 `ReviewActions` 中 `finalize`（控制面 finalize @1337 → engine `finalize` @2093，git index.lock 内完成 ref CAS + index 原子替换）或 `discard`。

3. **会话分支交付（autoDeliver）**：`worktree_deliver`（tools.ts:405）→ `operate {action:'finish'}` → `commitIsolated`（session-checkout-apply.ts:1521）把 Worktree 工作区提交到 `refs/heads/feat/sess-…`，**完全不读 Local**；成功后 `pushBranch`（git.ts:426，永不 force）→ 保留/清理。合并回 Local 是后续独立步骤 `worktree_merge`（tools.ts:630 → `mergeLocalBranch` git.ts:649）。

4. **轮询与侧栏**：`Poll`（current-polling.ts:22）每 5s → `control-plane.current`（control-plane.ts:764）→ `observe` 复用调用方快照（443-461）→ `projectDetails` 投影；侧栏 `sidebarTopology`（698-762）直接读 registry 全量并按 owner 聚合 → 客户端 `projectManagedWorkspaceSidebar`（workspace-sidebar/model.ts:81）。

5. **恢复续传**：冲突/再生成恢复请求在渲染层持久化 localStorage（recovery-continuation.ts:280-325）；`attempt`（280-376）在 owner 会话打开且空闲时通过官方 `session.prompt` 队列发送恢复提示词（`buildWorktreeRecoveryPrompt` @378），每次发送前重新 inspect 并校验 `targetMatchesRequest`（195-225）。

6. **生命周期维护**：Host `ready` 后 `module.reconcile()`（index.ts:414-428）；15 分钟定时器 `cleanupExpiredRetained` + `enforceWorktreeKeepCount`（429-436）；每日自动 prune 7 天前的已合并分支（437-452）。

## Connections

- 领域契约由 [[src-types]] 与 [[src-ports]] 定义，全部实现集中在 [[src-adapters]]（git/files/registry/lookup/working-directory/project-skills）。
- 写入引擎细节见 [[src-session-checkout-apply]]；其排除项来自 [[src-delivery-excludes]]，会话携带技能见 [[src-project-skills]]。
- RPC 契约与校验见 [[src-console-contract]]、[[src-console-remote]]、[[src-console-host]]。
- 浏览器面板见 [[src-client]]（[[src-client-review-console]]、[[src-client-target-console]]、[[src-client-pre-session]]、[[src-client-workspace-sidebar]]、[[src-client-settings-card]]）。
- 模型与人机入口见 [[src-tools]]、[[src-commands]]、[[src-session-target-context]]；并发守卫见 [[src-concurrent-session-guard]]。
- 宿主代际与 Workspace 接管见 [[src-host-compat]]、[[src-workspace-provider-lifecycle]]；路径命名见 [[src-managed-worktree-path]]；i18n 见 [[src-i18n]]。
- 状态机本体 `session-checkout-module.ts` 的实现细节（被 index.ts:234 导入）不在本文档覆盖范围内，需查阅该文件源码。

## Known Issues

- **本地错误文本泄漏**：`consoleFailure`（src/console-host/errors.ts:13-41）对非领域错误以 `git_error` 透传 `error.message`；注释（30-33）明确这是 local-only 限额，未来若上远程传输必须先截断/替换。
- **注册表写入无跨进程锁**：`writeJsonFileAtomic`（src/adapters/safe-file.ts:82-100）注释（79-81）声明唯一 tmp + 原子 rename 只消除「tmp 互踩」与「半写提升」，文件级 last-writer-wins 仍在，需要强一致时要引入 lock 文件。
- **review diff 的 R/C 语义折叠**：`parseNameStatus`（src/console-host/review-diff.ts:90-113）把 copy（C）折叠进 `renamed`（97-99 注释），契约中没有 `copied` 状态。
- **与官方 experimental worktree service 的刻意分歧**：src/adapters/git.ts:15-22 注释——不做 `sandbox.confine`，因为受管 checkout 位于会话工作区之外， confinement 会拒绝插件要创建的目录本身。
- **跨版本能力位容错**：`capabilitiesSchema.returnToLocal` 用 `default(false)` 而非 `optional()`（src/console-remote/schemas.ts:100-106），避免旧 Host 响应缺失键时整条 `current` 校验失败导致胶囊塌成「不可用」。
- **apply 引擎 plan 容量**：`plans` Map 对同一 isolated 路径只保留最新一份 plan（src/session-checkout-apply.ts:1710-1716 注释），旧 plan 的 revision 立即失效。
- **两阶段提交的 5ms 忙等**：`runGit` 的 `GitCommitProtocol` 分支轮询 stdout `prepare: ok`（src/adapters/git.ts:93-95），每次 5ms sleep，属轻量自旋而非事件驱动。
- **终态回滚保守性**：创建失败的残留只有在 `verifyIdentity`/`verifyRollbackMetadata`/`verifyUnmodified` 全部通过后才允许 quarantine+remove（src/adapters/worktree-creation.ts:94-121）；任何一步无法证明即保留现场（122），这是设计而非 bug，但意味着 Windows 下被占用的目录可能长期滞留 quarantine。
- **Windows 路径比较逻辑多处重复**：大小写不敏感比较在 src/adapters/files.ts:59-61、src/adapters/lookup.ts:56-62、src/adapters/working-directory.ts:104-112、src/console-host/control-plane.ts:515-517、src/concurrent-session-guard.ts:53-57、src/client/actions.ts:115-122 各自实现，修改规范化规则时需同步六处。
- **交付排除项为白名单**：`HOST_RUNTIME_ARTIFACTS`（src/delivery-excludes.ts:12-16）只覆盖插件确知宿主写出的三个路径，不猜测业务目录（9-11 注释）；新增宿主产物需要同步扩展。
- **本文档未覆盖文件**：`src/session-checkout-module.ts`（index.ts:234 导入的状态机实现）与 `src/session-checkout-module` 引用的其它内部文件源码不在本篇给到的源码内，其行为仅能通过 `SessionCheckoutModule` 接口（src/index.ts:113-219）与调用点推断。
