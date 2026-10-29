---
title: lib — dsh-git-worktree 插件主源码
type: module
source_files:
  - lib/index.js
  - lib/index.d.ts
  - lib/types.d.ts
  - lib/ports.d.ts
  - lib/ports.js
  - lib/console-contract.d.ts
  - lib/console-contract.js
  - lib/adapters/files.js
  - lib/adapters/git.js
  - lib/adapters/git.d.ts
  - lib/adapters/git-options.js
  - lib/adapters/git-options.d.ts
  - lib/adapters/initial-commit.js
  - lib/adapters/initial-commit.d.ts
  - lib/adapters/lookup.js
  - lib/adapters/lookup.d.ts
  - lib/adapters/project-skill-io.js
  - lib/adapters/project-skill-io.d.ts
  - lib/adapters/project-skill-provider.js
  - lib/adapters/project-skill-provider.d.ts
  - lib/adapters/project-skills.js
  - lib/adapters/project-skills.d.ts
  - lib/adapters/registry.js
  - lib/adapters/registry.d.ts
  - lib/adapters/safe-file.js
  - lib/adapters/working-directory.js
  - lib/adapters/working-directory.d.ts
  - lib/adapters/worktree-creation.js
  - lib/checkpoint.js
  - lib/client/WorktreeCreateRow.js
  - lib/client/WorktreeCreateRow.d.ts
  - lib/client/WorktreeReviewRow.js
  - lib/client/WorktreeReviewRow.d.ts
  - lib/client/actions.js
  - lib/client/actions.d.ts
  - lib/client/console-remote/adapter.js
  - lib/client/console-remote/index.js
  - lib/client/console-remote/index.d.ts
  - lib/client/i18n.js
  - lib/client/i18n.d.ts
  - lib/client/index.js
  - lib/client/index.d.ts
  - lib/client/model.js
  - lib/client/model.d.ts
  - lib/client/pre-session/PreSessionWorktreeToggle.js
  - lib/client/pre-session/PreSessionWorktreeToggle.d.ts
  - lib/client/pre-session/controller.js
  - lib/client/pre-session/controller.d.ts
  - lib/client/pre-session/harness-input.js
  - lib/client/pre-session/harness-input.d.ts
  - lib/client/pre-session/index.js
  - lib/client/pre-session/index.d.ts
  - lib/client/review-console/DeliveryProof.js
  - lib/client/review-console/PreflightStatus.js
  - lib/client/review-console/PreflightStatus.d.ts
  - lib/client/review-console/ReviewActions.js
  - lib/client/review-console/ReviewActions.d.ts
  - lib/client/review-console/ReviewDetailsModal.js
  - lib/client/review-console/ReviewDetailsModal.d.ts
  - lib/client/review-console/ReviewIcon.js
  - lib/client/review-console/WorktreeReviewPanel.js
  - lib/client/review-console/WorktreeReviewPanel.d.ts
  - lib/client/review-console/index.js
  - lib/client/review-console/preflight-cache.js
  - lib/client/review-console/preview-recovery-cache.js
  - lib/client/review-console/recovery-continuation.js
  - lib/client/review-console/recovery-continuation.d.ts
  - lib/client/review-console/request-cache.js
  - lib/client/review-console/request-cache.d.ts
  - lib/client/review-console/status-events.js
  - lib/client/settings-card/WorktreeSettingsCard.js
  - lib/client/settings-card/WorktreeSettingsCard.d.ts
  - lib/client/settings-card/form-model.js
  - lib/client/settings-card/form-model.d.ts
  - lib/client/settings-card/index.js
  - lib/client/settings-card/worktree-settings-card.js
  - lib/client/settings-card/worktree-settings-card.d.ts
  - lib/client/target-console/BranchGraphModal.js
  - lib/client/target-console/BranchGraphModal.d.ts
  - lib/client/target-console/TagManagerModal.js
  - lib/client/target-console/TagManagerModal.d.ts
  - lib/client/target-console/TargetStatusAction.js
  - lib/client/target-console/TargetStatusAction.d.ts
  - lib/client/target-console/WorktreeConsoleView.js
  - lib/client/target-console/WorktreeConsoleView.d.ts
  - lib/client/target-console/WorktreeHeroChip.js
  - lib/client/target-console/WorktreeHeroChip.d.ts
  - lib/client/target-console/WorktreeManagerModal.js
  - lib/client/target-console/WorktreeManagerModal.d.ts
  - lib/client/target-console/WorktreeReviewStatus.js
  - lib/client/target-console/WorktreeReviewStatus.d.ts
  - lib/client/target-console/branch-overview-cache.js
  - lib/client/target-console/current-polling.js
  - lib/client/target-console/index.js
  - lib/client/target-console/index.d.ts
  - lib/client/workspace-sidebar/index.js
  - lib/client/workspace-sidebar/index.d.ts
  - lib/client/workspace-sidebar/model.js
  - lib/client/workspace-sidebar/model.d.ts
  - lib/commands.js
  - lib/commit-message.js
  - lib/concurrent-session-guard.js
  - lib/concurrent-session-guard.d.ts
  - lib/console-host/control-plane.js
  - lib/console-host/control-plane.d.ts
  - lib/console-host/errors.js
  - lib/console-host/projection.js
  - lib/console-host/review-diff.js
  - lib/console-host/review-diff.d.ts
  - lib/console-host/service.js
  - lib/console-host/service.d.ts
  - lib/console-remote/descriptors.js
  - lib/console-remote/remote.d.ts
  - lib/console-remote/schemas.js
  - lib/creation-failure.js
  - lib/creation-failure.d.ts
  - lib/delivery-excludes.js
  - lib/host-compat.js
  - lib/host-compat.d.ts
  - lib/i18n/core.js
  - lib/i18n/host.js
  - lib/i18n/host-messages.js
  - lib/managed-worktree-path.js
  - lib/managed-worktree-path.d.ts
  - lib/session-checkout-apply.js
  - lib/session-checkout-apply.d.ts
  - lib/session-checkout-module.js
  - lib/session-target-context.js
  - lib/tools.js
  - lib/workspace-provider-lifecycle.js
  - lib/workspace-provider-lifecycle.d.ts
tags: [git-worktree, dsh-plugin, session-checkout, console, adapters, i18n, apply-engine, react-client]
---

## Overview

`lib/` 是 **dsh-git-worktree** 插件的全部主源码：一个挂在 DSH 宿主（Cordis 框架）上的插件，为每个会话提供“托管 Git Worktree（隔离检出）"，并把“改代码 → Ready for Review → 预览/验收 → 交付（提交到会话分支）→ 清理”做成一个带 CAS 校验、崩溃恢复与安全快照的完整状态机。

分层结构（自底向上）：

1. **领域契约与纯工具**：`lib/types.d.ts`（状态/错误码/视图类型）、`lib/ports.d.ts`（端口接口）、`lib/console-contract.js`（Host↔Client 共享 DTO）、`lib/commit-message.js`、`lib/creation-failure.js`、`lib/delivery-excludes.js`、`lib/checkpoint.js`、`lib/managed-worktree-path.js`、`lib/concurrent-session-guard.js`、`lib/host-compat.js`。
2. **适配器**（`lib/adapters/`）：git 子进程端口、node-fs 文件端口、原子 JSON 注册表、会话/项目查找、工作目录切换、Worktree 创建/校验、初始提交协议、Project Skills 携带。
3. **Apply 引擎**（`lib/session-checkout-apply.js`）：不依赖宿主的合并/预览/回滚/Checkpoint/交付执行器。
4. **业务面**：`lib/tools.js`（模型工具）、`lib/commands.js`（`/worktree` 命令）、`lib/session-target-context.js`（运行上下文注入）。
5. **Console Host**（`lib/console-host/`）：Typert Remote 服务 + 控制平面 + 投影 + Review Diff 读取。
6. **Console 契约与远程**（`lib/console-remote/`）：zod schema 与方法描述符。
7. **客户端 React 面板**（`lib/client/`）：ToolView、目标胶囊、审阅控制台、设置卡、侧栏投影、预会话开关。
8. **i18n 与宿主兼容**（`lib/i18n/`、`lib/host-compat.js`、`lib/workspace-provider-lifecycle.js`）。

状态机模块本体 `createSessionCheckoutModule`（由 `lib/index.js:29` 自 `lib/session-checkout-module.js` 导入）的深入解析见 [[session-checkout-module]]。

## Key Components

### 1. 插件入口 — `lib/index.js`

| 成员 | 行号 | 说明 |
| --- | --- | --- |
| `SessionCheckoutError` | 4-15 | 领域错误类；字段 `code`（稳定错误码）、继承 `Error`；构造 `(code, message)`，`name='SessionCheckoutError'` |
| `inject` | 46 | `{ tools:{}, commands:{}, subprocess:{}, loader:{await:false} }`；loader 读命名导出作为注入清单，避免 "cannot get property without inject"（39-45 注释） |
| `volatile(schema)` | 48-52 | 给 schemastery 字段打 `meta.volatile`，设置页热改写 cordis.patch.yml 不重载插件 |
| `Config` | 53-111 | 配置 schema：`stateDir`(60)、`gitTimeoutMs`/`worktreeAddTimeoutMs`(volatile, 63-64)、`autoDeliver`(71)、`autoPush`(76)、`worktreesRoot`(83)、`inheritLocalChanges`(89)、`worktreeKeepCount`(94)、`branchRaceGuard`(101)、`branchRaceWindowMs`(103)、`enableWorkspaceProvider`(110，默认 `false` —— 接管官方 Workspace 仅显式开启) |
| `resolveWorktreesRootValue` | 112-115 | 解析 volatile worktreesRoot（trim+resolve） |
| `resolveStateDir` | 116-121 | `config.stateDir` → 否则 `$DSH_HOME/plugins/dsh-git-worktree`（`~/.dsh` 兜底） |
| 常量 | 122-126 | `RETENTION_MAINTENANCE_INTERVAL_MS=15min`(122)、`AUTO_PRUNE_INTERVAL_MS=24h`(124)、`AUTO_PRUNE_FIRST_RUN_DELAY_MS=60s`(125)、`AUTO_PRUNE_OLDER_THAN_DAYS=7`(126) |
| `apply(ctx, config)` | 136-230 | 装配入口：`validateGitTimeouts`(137) → `mountWorkspaceProviderLifecycle`(141) → 建 stateDir/空 hooks 目录(142-145) → 组装 `lookup/git/files/registry`(152-156) → `mountProjectSkillProvider`(157) → `createSessionCheckoutModule`(158-173) → `new WorktreeConsoleService`(174-181) → `registerTools/registerWorktreeCommand/registerSessionTargetContext`(182-184) → 启动恢复 `events.on('ready')`(188-199) → 保留期定时器(200-207) → 自动清理已合并分支定时器(208-223) → `ctx.effect` 清理(224-229) |

### 2. 领域类型与纯工具

**`lib/types.d.ts`**（仅类型）：`SessionTargetRef`(10-17)、`SessionCheckoutPhase`(19-21)、`WorktreeRetentionMode`(24)、`DEFAULT_WORKTREE_RETENTION`(30)、`WorktreeCleanupReason`(31)、`WorktreeValidationItem`(32-36)、`WorktreeCheckpointView`(38-46)、`WorktreeReviewView`(47-59)、`WorktreeDeliveryProofView`(60-71)、`WorktreeDeliveryView`(72-116)、`WorktreeApplyPreflightView`(136-154)、`SessionTargetView`(175-193，含 `project/checkout/source/current/ownership/dirty/revision/delivery/checkpoints/checkpointGeneration/reviewSlot`)、`SessionCheckoutOperation`(199-305，apply/finish/preview/checkpoint/rollback_preview/finalize_preview/retry_cleanup/discard/recover)、`CONFLICT_DETAIL_FILE_LIMIT=6`/`CONFLICT_DETAIL_DIFF_LIMIT=4096`(439-440)、`SESSION_CHECKOUT_ERROR_CODES`(499-500)。

**`lib/ports.d.ts`** 关键结构：

- `GitCheckoutSnapshot`(52-59)：`root, commonDir, gitDir, branch, headOid, headRef`。
- `BranchOverviewEntry`(61-66)、`TagOverviewEntry`(68-78，`pushed: boolean|null`，null=无法查询远端)、`GraphLogCommit`(80-88)。
- `InitialCommitPreflight`(89-93)：`kind: 'ready'|'empty'|'files'`、`fingerprint`、`snapshot`。
- `SessionCheckoutGitPort`(94-237)：必选 `inspect/findContainingWorktreeRoot/status/createDetachedWorktree/removeWorktree/retainApplyBase/releaseApplyBase/retainInternalArtifact/readInternalArtifact/releaseInternalArtifacts/isAncestor`；可选（本地适配）：`preflightInitialCommit/initializeEmptyRepository/initializeProject/listLocalBranches/resolveLocalBranchTip/attachWorktreeBranch/pushBranch/repairWorktreeLinks/pruneWorktrees/branchOverview/defaultBranch/branchTipTimes/branchCreationTimes/deleteLocalBranch/mergeLocalBranch/graphLog/createLocalBranch/switchLocalBranch/listTags/createTag/deleteLocalTag/pushTag/deleteRemoteTag/captureLocalWip/applyWorktreePatch/listUntrackedFiles/snapshotAbandonedWorktree/restoreAbandonedSnapshot/listWorktreeincludeFiles`。
- `DirectoryIdentity`(238-242)：`device, inode, birthtimeNs`（目录身份三元组，隔离区 CAS 的基础）。
- `SessionCheckoutFilesPort`(243-260)：`exists/canonicalize/inspectDirectoryIdentity/ensureDirectory/removeEmptyDirectoryTree/quarantineDirectoryTree/removeDirectoryTree/measureDirectoryBytes/readTextFile?/copyFile?/isSymbolicLink?`。
- `WorktreeCreationEvidence`(276-288)：`root, rootIdentity, parentIdentity, commonDir, commonIdentity, lockReason, gitDir?, gitIdentity?, metadataFingerprint?, indexFingerprint?, quarantinePath?`。
- `ManagedCheckoutDelivery`(426-471)：`working / ready_for_review / preview_active / preview_detached / finalized / retained / delivered` 七态判别联合。
- `ManagedCheckoutRecord`(472-525)：`checkoutId, predecessorCheckoutId?, projectId, projectName, ownerSessionId, sourceSessionId?, localRoot, managedRoot, managedGitRoot, gitCommonDir, gitDir, baseOid, applyBaseOid?, previousReview?, checkpoints?, recoveryContinuation?, abandonedSnapshotOid?, abandonedSnapshotAt?, permanent?, sidebarBadgeClearedRevision?, sourceRef, sessionBranch?, sessionTopic?, phase, delivery, journal, revision`。
- `ManagedCheckoutsRegistry`(526-531)：`{version:2, revision, sessionBindings, managedCheckouts}`。
- `SessionCheckoutDependencies`(542-583)：模块依赖（全部 `LiveValue` 可 volatile）。
- `liveConfigValue`（实现于 `lib/ports.js:10-15`）：`typeof value?.get === 'function' ? value.get() : value`，统一读普通值或 volatile 引用。

**`lib/console-contract.js`**（Host↔Client 共享，无实现依赖）：

| 成员 | 行号 | 说明 |
| --- | --- | --- |
| `WORKTREE_CONSOLE_TARGET_STATES` | 11-23 | 11 个 UI 状态：`local/creating/working/ready_for_review/preview_active/preview_detached/retained/cleanup_pending/recovery_required/delivered/discarded` |
| `worktreeReachedDelivery(phase, deliveryState)` | 30-36 | delivered/finalized/retained（delivery 或 phase）即视为已交付，避免把清理后的记录误判为 abandoned |
| `consoleStateFromDomain(source)` | 38-63 | 领域态→UI 态投影；`discarded` 阶段优先于 `retained/finalized`（47-49 注释） |
| `WORKTREE_CONSOLE_ERROR_CODES` | 64-69 | 领域错误码 + `transport_unavailable/malformed_response/timeout` |
| `ERROR_META` | 70-103 | 每个错误码的 `category/recovery/retryable` |
| `worktreeConsoleErrorMeta(code)` | 104-106 | 查询元数据 |

**`lib/commit-message.js`**：`isValidCommitMessage(value)` —— 非空、可 trim、不含 `\0`（提交体走 stdin，500 字符非 Git 限制）。

**`lib/creation-failure.js`**：`WorktreeCreationFailure extends Error`，字段 `rolledBack: boolean`；“创建失败 ≠ 空目录可安全删除”。

**`lib/delivery-excludes.js`**：`HOST_RUNTIME_ARTIFACTS = ['.dsh-ops','desktop-runtime.json','.dsh-runtime.json']`；`deliveryExcludePathspecs(paths)` 生成 git pathspec 排除项（含 `**` 变体覆盖嵌套工作区）。

**`lib/checkpoint.js`**：`canonicalJson`(2-12，键排序+滤 undefined)；`checkpointGenerationForRecord(record)`(14-28) —— 对 `checkoutId/revision/reviewId/isolatedHeadOid/isolatedFingerprint/checkpointCount/previewId/phase` 做 sha256，仅在 `ready_for_review|preview_active` 时返回，作为 Checkpoint CAS 的 Host 生成号。

**`lib/managed-worktree-path.js`**：常量 `WINDOWS_INVALID_CHARACTERS/WINDOWS_RESERVED_NAME/REPEATED_DASHES/MAX_LABEL_LENGTH=40/DEFAULT_IDENTITY_LENGTH=8`；`sanitizeManagedWorktreeLabel`；`createManagedWorktreeRepositoryKey`（sha256 前 12 位）；`sanitizeBranchSegment`；`createSessionBranchCandidates`（`feat/sess-<会话>[--主题]`，重名 `-2/-3…`）；`createManagedWorktreeDirectoryName`（`<repo>--<id>--worktree`）；`createTopicManagedWorktreeDirectoryName`（`<topic>-<YYYYMMDD>[-<id>]`）；`createTopicDateStamp`；`createManagedWorktreePathCandidates`（设置 `worktreesRoot` 后四个候选全部移到 `<root>/<projectLabel|repoKey>` 下）。

**`lib/concurrent-session-guard.js`**：`cwdWithinLocalRoot(cwd, localRoot)`（路径文本归一含盘符小写）；`detectLocalBranchRace(input)` —— 纯同步谓词：同 Local 根的更早存活会话 × 检测窗内新建分支（排除 `managedBranches`）→ `race_detected`，否则 `clear`；返回 `BranchRaceFacts{status, earlierLocalSessionIds, recentBranchNames}`。

**`lib/host-compat.js`**：`workspaceClientFlavorForAgentVersion(version)`（`0.1.2-rc.1→legacy / 0.1.6-alpha.2→alpha / 0.1.7-rc.2→next / 0.2.0-rc.2→modern / 0.2.x→modern / 其余 unsupported`）、`isModernGeneration`、`workspaceFlavorDiagnostics(anchors)`（从 `process.argv[1]/cwd/import.meta.url` 逐个探针解析 `@deepseek-ai/dsh-agent` 版本并记录）、`hostWorkspaceClientFlavor()`。

### 3. 适配器 — `lib/adapters/`

#### git-options.js（超时策略）

| 成员 | 行号 | 说明 |
| --- | --- | --- |
| `DEFAULT_GIT_TIMEOUT_MS` | 2 | `120_000` |
| `DEFAULT_WORKTREE_ADD_TIMEOUT_MS` | 3 | `5*60_000` |
| `MAX_GIT_TIMEOUT_MS` | 4 | `60*60_000` |
| `validateGitTimeouts(options)` | 5-12 | 两个超时必须是 `[1000, 3600000]` 内的安全整数，否则 `RangeError` |
| `gitTimeoutMs(args, options)` | 13-21 | `worktree add` 用 worktreeAddTimeoutMs；`worktree remove` 固定 5 分钟(18-19)；其余 `gitTimeoutMs`；volatile 值每次调用读取（14-15 注释：设置页改完下一条命令即生效） |

#### files.js（Node fs 文件端口）

内部函数：`measureDirectoryBytes`(13-25，不跟随符号链接)、`removeEmptyDirectoryTree`(26-38，仅当整树无文件/链接才删)、`inspectDirectoryIdentity`(39-50，bigint lstat 取 device/inode/birthtimeNs)、`directoryIdentitiesEqual`(51-53)、`quarantineDirectoryTree`(54-74，校验“同父目录+目标未占用”后 `rename` 进隔离区，身份不匹配则尽力搬回并抛 `checkout_mismatch`，绝不删除身份不符对象——71 注释)、`removeDirectoryTree`(75-88，Windows 重试 6 次否则 2 次，拒绝非目录/符号链接根，80)。
`createNodeFilesPort()`(90-116) 返回完整 `SessionCheckoutFilesPort`；`copyFile`(101-106) 先建父目录再 `rmSync` 旧目标；`isSymbolicLink`(107-114) 异常时返回 false。

#### git.js（ctx.subprocess git 端口，最重要的适配器）

常量：`GIT_TERMINATION_GRACE_MS=1_000`(32)、`GIT_COLLECT_BYTES=1<<20`(34)、`WIP_PATCH_COLLECT_BYTES=16<<20`(36，二进制 WIP 补丁 base85 膨胀)。模块注释(6-24)说明：禁 hooks、无可选锁、无终端提示、C locale、Windows 上 worktree remove 5 分钟硬上限、内部 ref 命名空间 `refs/dsh-worktree/session-checkouts/<key>`；并解释与官方实验 worktree 服务的**有意分歧**（不做 `sandbox.confine`，因为受管检出在会话 workspace 之外，15-22）。

| 函数 | 行号 | 说明 |
| --- | --- | --- |
| `parseDecoration` | 42-53 | `%D` 装饰 → ref 名数组；`tag:` 前缀保留、`HEAD -> ` 剥离、裸 `HEAD` 丢弃 |
| `settleCreationTree` | 54-70 | 创建期终止确认（10s abort 上限） |
| `runGit` | 76-183 | 单条 git 命令：argv 原样传递不经 shell；固定前缀 `--no-pager --no-optional-locks [-c core.longpaths=true(Win)] -c core.quotePath=false -c core.fsmonitor=false -c core.hooksPath=<hooksPath>`(85-96)；env 清洗全部可劫持仓库路由的 `GIT_DIR/GIT_WORK_TREE/...` 变量(108)，设 `GIT_OPTIONAL_LOCKS=0/GIT_TERMINAL_PROMPT=0/LC_ALL=C/LANG=C`(109-112)；支持 `input` 为 `GitCommitProtocol{prepare, beforeCommit}` 的事务提交（轮询 `prepare: ok`，118-139）；返回 outcome `{code, stdout, stderr, quiescent}`，非零退出是否为错由调用方决定(71-75) |
| `runGitChecked` | 184-190 | 非零即抛 `git_operation_failed` |
| `checkoutRefRoot` | 191-194 | sha256(checkoutId) 前 24 位 → `refs/dsh-worktree/session-checkouts/<key>` |
| `assertArtifactName` | 195-201 | artifact 段必须 `[A-Za-z0-9][A-Za-z0-9._-]*` |
| `internalArtifactRef` / `applyBaseRef` | 202-205 / 206-208 | 内部 artifact / `apply-base` ref |
| `abandonedSnapshotRef` | 214-217 | 故意放在 `checkoutRefRoot` 之外：`refs/dsh-worktree/abandoned/<checkoutId>`，避免 discard 流程整组释放时带走安全快照(209-213 注释) |
| `hasGitMetadata` | 218-234 | 向上找 `.git` 判定“是否真的不是 git 仓库” |
| `createDshGitPort(ctx, options)` | 236-782 | 端口工厂，方法见下表 |

`createDshGitPort` 返回对象的方法（行号）：

| 方法 | 行号 | 要点 |
| --- | --- | --- |
| `inspect` | 242-310 | 快路径：一次 `rev-parse` 取 4 项 + 并行 `symbolic-ref`(243-264)；unborn HEAD 仅在 `show-ref` 干净时判 `headOid='unborn'`(291-297)；路径不做跨调用缓存（275-276 注释：worktree/commonDir 身份是安全边界）；POSIX 换行路径歧义时回退单值读取(280-285) |
| `findContainingWorktreeRoot` | 311-319 | `rev-parse --show-toplevel` |
| `status` | 320-324 | `status --porcelain=v1 -z --untracked-files=all` + Project Skills scope 过滤 |
| `createDetachedWorktree` | 325-336 | 先快照+校验本地 Skills 改动(326-330)，否则拒绝创建；带 deadline 调 `createWorktree`；`projectSkills.carry` |
| `removeWorktree` | 337-347 | 先 `projectSkills.assertRemovable`(340-344) 再 `worktree remove --force` + `forget` |
| `pruneWorktrees` | 348-350 | `worktree prune --expire now` |
| `retainApplyBase` / `releaseApplyBase` | 351-353 / 354-356 | update-ref(+/-d) |
| `retainInternalArtifact` / `readInternalArtifact` | 357-359 / 360-367 | 写/读内部 ref（code 1 → null） |
| `releaseInternalArtifacts` | 368-380 | 单次 spawn `update-ref --stdin` 事务删除全部 ref（376 注释：原逐个 -d 为 1+N 次串行） |
| `isAncestor` | 381-388 | `merge-base --is-ancestor`，code 1 → false |
| `listLocalBranches` / `resolveLocalBranchTip` | 389-392 / 393-400 | for-each-ref / rev-parse（40-64 位 hex 校验） |
| `attachWorktreeBranch` | 401-415 | 只动 ref 与 HEAD 指向绝不碰工作区(402-403 注释)；CAS：`expectedOldOid=null` 时以全零旧值创建(406-407) |
| `pushBranch` | 416-433 | 普通推送上游，绝不强推/改写远端历史(417-419 注释)；分离 HEAD/无上游→`{ok:false,message}` |
| `repairWorktreeLinks` | 434-439 | `worktree repair`（仓库搬盘后修复 `.git` 指针） |
| `listWorktreeincludeFiles` | 440-461 | `.worktreeinclude` 语义 = 两次 `ls-files --others --ignored` 的交集(441-448 注释)；自动带入被 ignore 的 `AGENTS.override.md`(457-459) |
| `branchOverview` / `defaultBranch` | 462-479 / 480-488 | 分支总览（含 dirtyCount）/ `origin/HEAD`→`init.defaultBranch`，绝不猜 'main' |
| `branchTipTimes` / `branchCreationTimes` | 489-503 / 504-527 | 分支 tip 时间；reflog `branch: Created from` 首条即创建时间（505-507 注释） |
| `deleteLocalBranch` | 528-533 | `branch -d`（绝不强删） |
| `graphLog` | 534-556 | topo-order 提交图，`\0/\x1e` 分隔解析 |
| `createLocalBranch` / `switchLocalBranch` | 557-566 / 567-578 | 先 `check-ref-format`；switch 失败匹配 "already used by / already checked out at worktree"(571-574) 转友好错误 |
| `listTags` / `createTag` / `deleteLocalTag` / `pushTag` / `deleteRemoteTag` | 579-618 / 619-634 / 635-640 / 641-647 / 648-653 | 标签管理；`pushed` 初值 `null`（离线≠未推送，604-606）；push 永不 force(642) |
| `mergeLocalBranch` | 654-728 | dryRun 在 `mkdtemp` 临时 detached worktree 试合并(692-717)且 finally 强制回收(712-716)；正式合并冲突不 abort，冲突留在现场由调用方解决(718)；`collectConflict` 逐文件 diff（`CONFLICT_DETAIL_*` 限流） |
| `captureLocalWip` / `applyWorktreePatch` | 729-737 / 738-744 | codex 对齐：`diff --binary HEAD` 捕获 / `apply --binary -` 原子应用 |
| `listUntrackedFiles` | 745-749 | 非 ignore 的 untracked |
| `snapshotAbandonedWorktree` | 750-770 | `add -A`→`write-tree`→`commit-tree`（显式身份，不依赖用户 git 配置）→`update-ref refs/dsh-worktree/abandoned/<id>` |
| `restoreAbandonedSnapshot` | 771-779 | 建分支 `worktree-restore-<oid8>` 并删快照 ref |

#### registry.js（原子 JSON 注册表）

校验函数群（`isRecord`22-24、`isOid`28-30、`isBoundedText`31-33、`isSafeRelativePath`34-40、`isSessionBinding`48-58、`isReview`59-77、`isCheckpoint`87-104、`isPreviewReceipt`105-125、`isDelivery`139-182、`isJournal`183-242、`isRecoveryContinuation`256-282、`isManagedCheckout`283-314、`isRegistry`315-324）。`migrateLegacyRegistry(value)`(325-378)：v1 记录保守迁移——`ready/discarded` 保留，其余 phase 一律 `recovery_required`，`revision+1`。
`AtomicJsonCheckoutRegistry`(380-402)：`read()`(385-397) 每次读都过校验闸门（坏文件响亮失败 `registry_corrupt`，396），v1 迁移成功即回写；`write()`(398-401) mkdir + `writeJsonFileAtomic`。

#### safe-file.js（崩溃安全 JSON 读写）

`sleepSync`(15-23)、`renameAtomicWithRetry`(25-41，Windows EBUSY/EPERM/EACCES/ENOTEMPTY 指数退避重试 5 次)、`tmpPathFor`(46-48，`<file>.<pid>.<uuid>.tmp` 固定名会让并发写者互踩——42-45 注释)、`listTmpFiles`(50-64，按 mtime 新→旧)、`cleanupTmpFiles`(65-72)、`writeJsonFileAtomic`(79-95，写前备份 `.bak` + 唯一 tmp + 原子 rename)、`writeTextFileAtomic`(97-101)、`readJsonFileSafe`(106-154)：主文件 → 最新可解析 `.tmp` 残留（成功即提升为主文件并清场）→ `.bak`（恢复时 `skipBackup=true` 防止坏主文件覆盖好备份，143-144）→ 全失败返回 null 由上层从 JSONL 重建。**无跨进程锁**（76-77 ponytail 注释）。

#### working-directory.js（会话 cwd 端口）

`isWorkingDirectoryLike`(14-19)、`sessionOf`(20-22)、`createSessionWorkingDirectoryPort(ctx)`(28-75)：
- `current(agent)`(38-49)：无服务/无会话 → `undefined`；异常吞掉。
- `enter(agent, path)`(50-57)：无服务或 `agent===undefined` → `undefined`（“上报一个从未设置过的 cwd” 是禁止的——52-53 注释）。
- `leave(agent, path, fallback)`(58-73)：仅当当前 cwd 在 `path` 内才 `set(fallback)`。
- `isWithin(candidate, root)`(77-85)：跨平台路径包含判定。

#### lookup.js（会话/项目查找端口）

`isWorkspaceRegistryLike`(14-19)、`isSessionStoreLike`(20-24)、`sameResolvedPath`(25-31，win32 大小写不敏感)。`createDshLookupPort(ctx)`(33-134)：`registry()`/`sessions()` 动态 fail-soft 取服务(34-41)；`liveHeaderCwd`(49-52)；`getSidebarMemberships`(54-74，查 header 而非 transcript——“目录缺失不能抹掉历史导航身份”，59-60)；`listLiveSessions`(75-102，结构未知降级为空列表)；`getSession`(103-120，先扫 workspace 会话账号，cwd 失效被 Harness 过滤时用 immutable live header 恢复精确映射——110-112 注释)；`getSessionCwd`(121-126，Live cwd 是会话真实工作目录：受管 owner 的 immutable worktree 根)；`getProject`(127-132)。

#### initial-commit.js（空仓库初始化协议）

`initialCommitActions(inspect, run)`(7-133)，仅 Console 确认的宿主动作会初始化，普通 Git 巡检只读(6)：
- `stale()`(8)、`checked`(9-14)、`identity(path, trackChanges)`(15-20，`dev:ino:birthtimeNs[:mtimeNs:ctimeNs]`，符号链接抛 stale)、`indexBytes`(21-30)。
- `preflightInitialCommit`(31-52)：文件系统枚举**刻意不做任何 ignore**（38-39 注释：忽略文件/链接/嵌套仓库/空目录都需要用户显式决策）；`empty` 时计算覆盖 root/gitDir/HEAD/index/文件清单的 sha256 指纹(44-50)。
- `initializeEmptyRepository`(53-113)：锁 `index.lock`(61-64，“绝不删除非自己创建的锁”，60)、三次 preflight 指纹比对(54-79)、校验 `GIT_AUTHOR_IDENT/GIT_COMMITTER_IDENT`(69-73)、`mktree` 空树(74-75)、`update-ref --stdin` 事务 + `beforeCommit` 回调中**在 HEAD 锁下**再验指纹(83-94)；`EEXIST` → `initialRepositoryBusy`(98-100)；finally 逆序清理锁且失败不掩盖主错误(103-112)。
- `initializeProject`(117-131)：本地适配——非 Git/未出生仓库在显式确认后 `init -b main`(124) + `add -A` + `commit`；已有提交历史拒绝(119-121)；提交失败原样报错不回滚（116 注释）。

#### project-skills.js / project-skill-io.js / project-skill-provider.js（Project Skills 携带）

- `PROJECT_SKILL_ROOTS = ['.dsh/skills','.agents/skills','.claude/skills']`(6)、`MAX_FILES=5000`(7)、`MAX_BYTES=64MB`(8)、`safePath`(12-17，skill 根本身可以是 tracked 文件——13-14 注释)、`inspectPath`(25-41，逐段 lstat 拒符号链接/junction)、`boundedRead`(42-66，读前后 stat 比对防“读中被换”）、`assertSkillTree`(67-80，10000 项/64 层上限)、`inventory`(84-115)。
- `ProjectSkillStore`(117-258)：`file(root)`(122，sha256(root).json)、`snapshot(source)`(123-126)、`load(root)`(127-150，manifest 严格校验含 identity/phase/files 去重)、`carry(snapshot, target)`(151-206，完整冲突预检→`wx` 独占发布 `copying` manifest→复制→逐文件哈希校验→`ready` 原子替换 188-205)、`scope`(207-210)、`paths`(211)、`state(root, tracked)`(212-244，指纹+modified 判定)、`assertRemovable`(245-256)、`forget`(257)。
- `trackedSkillPaths(indexEntries, headPaths)`(259-267)、`hasDeliverableStatus(output, auxiliary, directories)`(269-282，仅 `??` 且命中携带清单的记录算辅助，其余一律算脏)、`assertSkillPath`(283-286)。
- `project-skill-io.js`：`checkRoot`(6-11)、`checkPath`(12-36，首段必须 `.dsh/.agents/.claude` + `skills`)、`readSkillFiles`(37-69，O_NOFOLLOW + 双 stat ino/dev 比对 + 总量 64MB 预算)、`createSkillDirectories`(70-77)、`createSkillFiles`(78-95，O_EXCL 独占创建 + chmod + fsync + 复检)。
- `project-skill-provider.js`：`candidatePath`(7-13，兼容 DSH 0.1 `candidate.path` 与 0.2 `locator.path`)、`managedSkillRoot(registry)`(15-45，**以宿主持有的记录为准**——14 注释；校验 `.git` marker 与 `gitdir` 回链双向 realpath)、`ClaudeProjectSkillProvider`(47-132，串行 `run`(55-59)、LRU 32 个 `FileSystemSkillProvider`(69-77)、`rank: 250`、`source:'project-claude'`)、`mountProjectSkillProvider`(133-146，注入 `skills` 服务 + 监听 `fs/observed` + dispose)。

#### worktree-creation.js（创建协议与回滚）

| 函数 | 行号 | 说明 |
| --- | --- | --- |
| `createWorktree(localRoot, target, baseOid, run, saveEvidence)` | 12-148 | 独占 `mkdir(target)`(42) → 采证据（root/parent/common 身份 + 随机 lockReason，47）→ `worktree add --detach --no-checkout --lock`(49) → gitDir 身份 + metadataFingerprint(50-55) → `registered=true`(56) → `verifyIdentity`(57) → sparse 分支 `reset --hard` / 普通 `read-tree`+index 指纹+`checkout-index --all`(58-77) → `unlock`(79)；失败路径：未 claimed → 可安全重试(83-84)；已 claimed 未 registered 且 quiescent → 五重证据比对后 `rmdir` 残余(85-110)；已 registered 且 quiescent → 验身份/指纹/未修改 → `worktree move` 进 `.failed-<uuid>` 隔离区 → 再次全验 → `remove --force`(113-138)；**超时/进程树丢失/身份不可证 = 永远不是删除授权**（111-112 注释） |
| `verifyIdentity(e, baseOid)` | 149-177 | root/parent/commonDir/gitDir 四重身份 + `.git` 指针/`gitdir` 回链/`commondir`/HEAD/locked 文本 + **任何 `.lock` 文件存在即失败**(175-176) |
| `verifyRollbackMetadata` | 178-196 | metadata/index 指纹 + ORIG_HEAD 比对 |
| `metadataFingerprint(gitDir)` | 197-228 | 逐文件哈希；`index/gitdir/ORIG_HEAD` 语义另查(201-203)；未知条目/符号链接/超 1MB 文件即抛 |
| `verifyUnmodified(root, baseOid, run)` | 229-320 | 拒绝 submodule(238-239)、拒绝 filter/编码转换(265-271)、逐 blob 哈希复算(273-307)、`diff-index`/`ls-files -v`/`ls-files --others`/`diff` 全清(308-319) |

### 4. Apply 引擎 — `lib/session-checkout-apply.js`

常量与工具：`AMBIENT_GIT_ENV_PATTERN`、`scrubbedAmbientGitEnv`、`disabledGitHooksPath`（惰性 mkdtemp 空目录禁 hooks）、`GIT_TIMEOUT_MS=30_000`、`OID_PATTERN`、`runGit`（与 git.js 同款清洗；`options.env` 是**有意的注入通道**如 `GIT_INDEX_FILE`）、`GitCommandFailure`、`selectEffectiveApplyBase`（recorded base 必须证明在两侧历史中才允许前移）、`snapshotFingerprint`、`captureSnapshot`（临时 index 复原 staged 语义→叠加 working tree→`add -A`+excludes→剔除携带 Skills→指纹）、`createSnapshotCommit`、`collectConflictDetails`、`computeMerge`（临时仓库三方合并 + 中心 index 回放）、`computeTreeMerge`、`treePatch`、`prepareRollbackAssessment`/`prepareFinalizeAssessment`、`writeIndexLock`（Git index.lock 协议）。

`DefaultSessionCheckoutApplyEngine`，`plans: Map`（**内存态**，重启即丢）：

| 方法 | 说明 |
| --- | --- |
| `checkpoint` | 快照 CAS → 项目外变更拒绝 → 用户提交 → `beforeCommit` 持久化 journal → 邻接 index + 锁标记 → 复验 → 分支型 HEAD 用 `update-ref <headRef>` 而非 `--no-deref`（防止 detached 掉会话分支）→ 失败回滚分 `unchanged/uncertain` → 写后五元组验证 |
| `recoverCheckpoint` | 仅当锁标记属于本 commit 且树匹配才处理遗留 `index.lock`；HEAD==parent → aborted；HEAD==commit 且树/索引合法 → 换入干净 index |
| `inspectReview` | Local/Isolated 必须同 object 目录、同项目子目录前缀 |
| `reviewIsolated` | 只读 Worktree 快照，完全不碰 Local |
| `commitIsolated` | **会话分支交付**：完全不读写 Local；守门 `headRef===branch`；提交树取自“评审快照”同一条构造路径以排除宿主产物与 Skills；`update-ref HEAD` + `reset --quiet` 归位索引；git 身份缺失转可执行提示 |
| `preflight` / `plan` / `calculatePlan` | 同一合并计算，`persistPlan=false/true`；冲突返回逐文件 diff；plans map 每 checkout 仅留一份 |
| `apply` | plan 匹配 → 双侧快照 CAS → 无 ref 内部 snapshot commit → 最终 Local 校验 → `apply --binary` 打补丁 |
| `preview` | `beforeWrite` 先持久化 receipt 再写 Local；写后 tree 必须等于 `previewWorkingTreeOid` |
| `assessPreviewRecovery` | 严格只读，同时算 rollback 与 finalize 两份证据 |
| `rollback` | Journal 先于最终 CAS；写后指纹/树五重校验 |
| `finalize` | 任务树/最终索引树三方分离计算 → `commitRequired` 短路 → 备份 index → index.lock 下原子换索引 → 写后验证失败的三级补偿（ref-only 回退 / 备份 CAS 恢复 / 拒绝部分回滚）→ 无法证明则保留备份并报 `uncertain` |
| `finish` | 复验冲突集与文件集与 plan 一致；无任务增量→不建空提交；`C = H + (M − L)` 任务增量剥离、`S' = C + (S − H)` 恢复 staged；index.lock 内“校验→打补丁→update-ref→换索引”；失败逆序回滚 ref/补丁 |
| `errorMessage` / `cleanup` | 错误格式化 / 清理失败仅 warn 不掩盖主结果 |

`createSessionCheckoutApplyEngine(options)`；测试/宿主 seam：`beforeFinalLocalValidation/afterLocalWriteBeforeVerification/beforeFinalIsolatedValidation/afterIsolatedWriteBeforeVerification`（接口见 `lib/session-checkout-apply.d.ts`）。

### 5. 业务面 — tools / commands / target-context

**`lib/tools.js`**：`parseWorktreeRetention`、`sessionIdOf`、`renderJson`、`leaveCheckoutBeforeRemoval`（cwd 无法移出则**必须中止删除**）、`enterCheckout`（优先读台账 `resolveRoots`，避免全局锁下的全量 Git 校验失败把会话晾在 Worktree 外）。`registerTools(ctx, module)` 注册 9 个模型工具：

| 工具 | 说明 |
| --- | --- |
| `worktree_create` | in-place 创建：`targetSessionId=sourceSessionId`，创建即 `enterCheckout`；输出 `cwdSelected` |
| `worktree_list` | 会话可见 Worktree 列表；`commitOid` 空值省略键 |
| `worktree_resume_revision` | Ready→Working，仅限未同步 Review |
| `worktree_begin_next_iteration` | 已交付+清理完成→重建 immutable cwd 进入下一轮并重新进入 |
| `worktree_ready_for_review` | 提交评审 |
| `worktree_deliver` | `autoDeliver` 关闭时抛 `worktreeDeliverDisabledByAutoDeliver`；交付前必须 `leaveCheckoutBeforeRemoval`；失败后把会话送回 checkout |
| `worktree_cleanup` | 清理 retained 终态（CAS revision） |
| `worktree_prune_branches` | 已合并分支安全清理（dryRun 优先） |
| `worktree_merge` | 会话分支 ⇄ Local 合并 |

**`lib/commands.js`**：`targetText`、`sessionIdOf`、`RETENTIONS`、`usage`、`finishedText`。`registerWorktreeCommand(ctx, module)`：创建 `leaveCheckout`（"leave 失败必须中止删除"）与 `enterCheckout`；`/worktree` 动词：`status`、`list`、`continue`、`next`、`finalize`（reviewId+revision CAS 校验）、`finish <message>`、`discard`、`remove <checkoutId>`；未知动词 → usage。

**`lib/session-target-context.js`**：`registerSessionTargetContext(ctx, module)` —— 每 45s 后台刷新分支竞争守卫缓存（runtimeContext 必须保持同步）；向 `systemPrompt.context` 注入 `git-worktree:session-target`，文本 = `module.runtimeContext(sessionId, workingDirectory.current(agent))`。

### 6. Console Host — `lib/console-host/`

**errors.js**：`domainError(code, message, continuation?)`；`consoleFailure(error)`（带 `code` 的领域错误原样转 `{ok:false,error}`，第三方错误本地 UI 刻意原样透出，远程化前必须清洗）；`failure(code, message, details?, continuation?)`；`outcome(operation)`。

**projection.js**：`capabilities(record, callerSessionId, ownerSessionAvailable, linkedRead)`（16 个能力位逐项推导，`returnToLocal: owner && worktreeReachedDelivery`）；`fallbackOid`；`sourceBranchFromRef`；`projectRecord`（`sourceBranch` 用 `sessionBranch ?? sourceRef`——防止把 fork 点误标为归属）；`projectDetails`（含 `managedRoot/sourceRoot/sourceOid/currentBranch`（交付后用 `settledLocalBranch` 报真实所在分支）与 owner 专属 `recoveryContinuation` 投影）；`projectLocal`。

**control-plane.js**：`createWorktreeConsoleControlPlane(options)`。核心内部件：`recordOf`、`sidebarTaskState`、`readyReview`/`previewReview`、`applyConflictContinuation`、`preflightFailure`、`unboundLocalTarget`、`callerTarget`、`verifyCallerRoot`（owner live cwd=managedRoot 或交付落定后=localRoot 均可授权；canonical realpath 按 path 记忆化）、`authorize`、`linkedReadAccess`（同一 link 组或“验收槽位持有者”只读访问）、`observe`/`observeFromCaller`（复用 callerTarget 已付的三次 spawn）、`settledLocalBranch`、`acceptanceHolder`、`projectReviewSlot`、`details`、`mutationResponse`、`withCreation`（session+root 双键互斥）、`createTarget`。端点：

| 端点 | 要点 |
| --- | --- |
| `sidebarTopology` | 聚合 projects/tasks + 目录 memberships；用户清除的终态徽章不再投影 task |
| `current` | local → `projectLocal`；isolated → `details` |
| `gitOverview`/`gitGraph`/`gitCreateBranch`/`gitSwitchBranch` | 一律解析到**项目本地仓库根**；switch 在交付中拒绝 |
| `gitPruneMergedBranches` | 委托 module |
| `gitListTags`/`gitCreateTag`/`gitDeleteTag`/`gitPushTag` | 删标签先远后本地；push 失败是“可上报结果”而非失败变更 |
| `listAbandoned`/`restoreAbandoned` | 放弃快照列表/恢复 |
| `list` | 批量观察（`observeManagedCheckouts` 一次拿锁并行验证），验证失败逐条降级 |
| `preflightCreate`/`createWithInitialCommit`/`create`/`initProject` | 空仓库确认令牌 5 分钟有效、上限 500；创建全程 `withCreation` 互斥 |
| `inspect` | |
| `reviewDiff` | 读写前后各一次 preflight，diff 字节过期即弃 |
| `preflight`/`previewRecoveryPreflight` | 仅 owner；revision/reviewId(/previewId) CAS |
| `preparePreviewRecoveryAnalysis`/`createPreviewRecoveryHandoff` | proof 逐字段比对；handoff 后新建记录身份复核 |
| `checkpoint`/`preview`/`resumeRevision` | 冲突 continuation 身份严格校验；恢复后读回持久化 continuation |
| `prepareReviewRegeneration`/`rollbackPreview`/`discard` | discard：owner 接管后源会话被拒，非 owner 走 `manageManagedWorktreeForSession` |
| `finalize`/`finalizePreview` | commitMessage 校验；冲突转 `apply_conflict`+continuation |
| `setRetention`/`setPermanent`/`retryCleanup`/`clearSidebarBadge` | 徽章仅终态可清 |
| `beginNextIteration` | 前驱必须 `discarded+delivered`；workspace 根与 managed/local 任一匹配即可；lineage/CAS 复核 |
| `returnToLocal` | 仅已交付记录可解绑；已解绑幂等返回 Local 投影 |

**review-diff.js**：常量 `REVIEW_DIFF_MAX_FILES=200`、`REVIEW_DIFF_MAX_PATCH_BYTES=100KB`、`REVIEW_DIFF_MAX_PAYLOAD_BYTES=1MB`；`ReviewDiffStaleError`；裸 `spawn` `git`（带 maxBytes 截断）；`projectPath`/`utf8Prefix`/`parseNameStatus`（R/C 折叠为 renamed）；`createGitWorktreeReviewDiffReader(projectSkills)`：临时 object 目录 + `read-tree baseOid` + `add -A` + 剔除携带 Skills → name-status 与 `review.changedFiles` 严格比对（不一致抛 `ReviewDiffStaleError`）→ **8 个一批并行**取证（串行最坏 400 次 spawn 会顶爆 180s SLOW 超时）→ 载荷字节预算折叠。

**service.js**：`WorktreeConsoleService extends TypertRemoteService` —— 全部方法 `@Remote` 装饰；构造注入 `hostContext/controlPlane/diagFile/officialWorkspaceActive`；`appendDiag`（ndjson 诊断永不破坏 RPC）；`sidebarTopology`（附加 `workspaceClientFlavor` + `officialWorkspaceActive`）；`clientBootReport`；`current`（记录 durationMs/error code）；其余方法逐个转发 control-plane 并包 `withHostLanguage`（locale 优先请求，再 `languageFromSettings(agent.ctx)`）。

### 7. Console 远程契约 — `lib/console-remote/`

- **schemas.js**（zod）：`sessionIdSchema`、`checkoutIdSchema`、`reviewIdSchema`、`commitMessageSchema`、`revisionSchema`、`oidSchema`、`previewIdSchema`、`generationSchema`、`requestIdSchema`、`branchNameSchema`、`retentionSchema`/`retainedModeSchema`、`capabilitiesSchema`（`returnToLocal` 用 `default(false)` 而非 `optional()`——旧 Host 不知道新键，必填会塌掉整条 `current`）、`targetSummarySchema`、`targetDetailsSchema`、`recoveryContinuationSchema` + 四种 recovery proof schema、`outcomeSchema`（仅 `apply_conflict` 可带 continuation）、`previewRecoveryProofSchema`、git 系列。
- **descriptors.js**：`strictCodec`（DSH 0.2 走 `create()`，保留 legacy `schema` 字段）、`descriptor`（统一 agent 参数 + locale）；`WORKTREE_CONSOLE_DESCRIPTORS`（40 个方法的严格 schema 描述符）、`WORKTREE_CONSOLE_REMOTE`。
- **remote.d.ts**：`GitWorktreeRemote` 类型 + `TypertRemoteMap` 全量方法签名声明。

### 8. 客户端 — `lib/client/`

**基础**：
- `i18n.js`：`readClientLanguage`（读 LocaleFace `snapshot.active`，异常回退 `zh`）、`clientTranslator`、`defaultClientTranslator`、`ClientI18nProvider`（`useSyncExternalStore`）、`useClientLanguage`/`useClientTranslator`、`translatorForServices`（命令式调用点即时解析语言）。
- `model.js`：`parseCreateTool`（从日志块解析 `worktree_target_created`）、`reviewArgs`、`parseReviewTool`；生命周期 `running/ok/error/stopped`。
- `index.js`：`WORKTREE_CONSOLE_ADAPTER_SERVICE='worktreeConsole'`、`inject`、`apply(ctx, adapterOverride)`：代理 `slots.register` 包一层 `ClientI18nProvider`、注入样式 `<style data-plugin="dsh-git-worktree">`、注册 `worktree_create`/`worktree_ready_for_review` ToolView、有 adapter 时再挂 `registerTargetConsole` 与 `registerPreSessionWorktree`。
- `actions.js`：`samePath`(2-9)、`navigateToSession`(11-18)、`selectedSessionId`(20-29)、`openExistingSession`(31-37)、`waitForProjectedSessionPath`(38-78，2s 超时等待 Harness 投影可信 cwd)、`openIsolatedTarget`(80-111，幂等注册 workspace→创建预分配会话→等 cwd→导航)、`openAuthorizedWorktreeTarget`(116-139，先 `adapter.inspect` 路径无关授权再复用 cwd 校验导航)、`prefillSessionDraft`(141-147)、`finalizeCurrentSession`(149-162，提交 `/worktree finalize <reviewId> <revision> <retention>` 命令)。
- `WorktreeCreateRow.js`(7-41)/`WorktreeReviewRow.js`(13-91)：两个 keyed ToolView；ReviewRow 监听 `WORKTREE_REVIEW_REFRESH_EVENT`(39-49) 并拉 `adapter.current`(54-77)。
- `console-remote/adapter.js`：`createWorktreeConsoleRemoteAdapter(remote, getLanguage)` —— `FAST_TIMEOUT_MS=30s`/`SLOW_TIMEOUT_MS=180s`，`FAST_METHODS`（含 `sidebarTopology/current/inspect/previewRecoveryPreflight/gitOverview/gitGraph/listAbandoned`）；Web RPC 无超时，客户端侧超时以免 UI 永久 pending；codec 拒绝识别为 `malformed_response`。
- `console-remote/index.js`：`inject`（过滤 `remote.directoryPicker`/`remoteAccess` 并补 `slots/configForms`——注释详述 web boot 死锁与 0.2.0-rc.2 pending 事故）；`apply(ctx)`：`$mount` 远程贡献 → `sidebarTopology()` 探测 flavor → 按 `legacy/modern/alpha|next/unsupported` 分支注册侧栏与工具；`reportBoot` 尽力回报诊断。

**审阅控制台**（`lib/client/review-console/`）：
- `status-events.js`：`WORKTREE_REVIEW_REFRESH_EVENT='dsh-git-worktree:review-refresh'`、`requestWorktreeReviewRefresh(sessionId)`。
- `request-cache.js`：`createRequestCache` —— ponytail 注释：per-adapter WeakMap、identity 字符串唯一键、single-flight、`invalidate` 以 generation++ 防迟到响应回写。
- `preflight-cache.js`/`preview-recovery-cache.js`：两个身份键缓存实例。
- `recovery-continuation.js`：localStorage 持久化前缀 `dsh-git-worktree:recovery:v1:`；`persistSnapshot`/`readPersisted`（严格 key/类型校验）；`validRequest`；`targetMatchesRequest`；`attempt`（发送前**再次** inspect 复核身份与目标匹配）；公开 API：`buildWorktreeRecoveryPrompt`、`enqueueWorktreeRecovery`、`restoreWorktreeRecovery`、`retryWorktreeRecovery`（cancelled 亦可重发）、`getWorktreeRecoverySnapshot`、`subscribeWorktreeRecovery`、`useWorktreeRecoverySnapshot`、`cancelWorktreeRecovery`、`detachWorktreeRecoveryRuntime`、`clearWorktreeRecovery`。
- `WorktreeReviewPanel.js`：`reviewIsStale`、`WorktreeReviewPanel`。
- `ReviewActions.js`：`DEFAULT_RETAIN_ENVIRONMENT=true`（误交付可恢复）；`ReviewActions` —— preview/checkpoint/resume/rollback/finalize/finalizePreview/discard/retryCleanup、冲突恢复 `startConflictRecovery`、评审再生成 `startReviewRegeneration`、detached 恢复分析/交接 `analyzeRecovery`/`handoffRecovery`、更多菜单、三个 Modal、PreflightStatus/recovery 状态区、DeliveryProof。
- `PreflightStatus.js`、`ReviewDetailsModal.js`（焦点陷阱）、`DeliveryProof.js`、`ReviewIcon.js`（lucide 图标映射）。
- `index.js`：`reviewEvidenceFromTarget`、`reviewIdentityFromTarget`。

**目标胶囊 / 管理面**（`lib/client/target-console/`）：
- `index.js`：`registerTargetConsole` 注册 `conversation.session.header.actions` 的 `TargetStatusAction`、`conversation.input.dock` 的 `WorktreeReviewStatus` 与 `WorktreeHeroChip`。
- `current-polling.js`：`DELAY=5_000`、`HIDDEN_DELAY=60_000`（隐藏窗口轮询纯烧 CPU）；`Poll` 类（generation 失效、visibilitychange 即时唤醒）；`subscribeCurrent`（adapter×session×language 键控共享）。
- `branch-overview-cache.js`：`TTL_MS=60_000`、`patchEpochs` 防 flight 踩掉乐观补丁、`cachedBranchOverview`、`invalidateBranchOverview`、`patchBranchOverview`、`ensureBranchOverview`、`refreshBranchOverviewInBackground`。
- `TargetStatusAction.js`：状态胶囊 + 分支弹层（搜索过滤、`MAX_BRANCH_ITEMS=12`）、switch 乐观补丁、`initializeRepository`（非 Git 项目的显式出路）、prune 预览、retry/begin/return/discard 动作、图形/标签弹窗联动。
- `BranchGraphModal.js`：`mergeRefs`、`computeGraphLanes`（lane 拓扑移植自 `@linxin666/dsh-client-ui-git-graph`）、`BranchGraphModal`。
- `TagManagerModal.js`：每次变更后重读列表，"error 不在 reload 时清空”以免推送失败消息被抹掉。
- `WorktreeConsoleView.js`：`ATTENTION_RANK`、current+list+abandoned 三路并行刷新、`applyMutation`、创建/放弃/清理/常驻/保留期/恢复快照动作。
- `WorktreeManagerModal.js`、`WorktreeHeroChip.js`（portal 进 hero 行，`resolvePortalRenderer` 懒加载 react-dom）。
- `WorktreeReviewStatus.js`：composer 上方紧凑交付条，含独立恢复条与终态 dismiss。

**设置卡**（`lib/client/settings-card/`）：
- `form-model.js`：`settingsBooleanField`/`settingsNumberField`/`settingsTextField`；`SettingsFormModel`：暂存式编辑（staged 才写）、`bind`、`shell`、`field`、`actions`、`save`（以 baseline.revision CAS mutate，失败保留草稿）、`dispose`、`plan`。
- `worktree-settings-card.js`：`WORKTREE_SETTINGS_NS='dsh-git-worktree'`、`WorktreeSettingsCardController`。
- `WorktreeSettingsCard.js`：`view==='summary'` 时只渲染一行；行内样式自包含（随插件安装的 ui-primitives 版本早于共享 SettingsForm）。
- `index.js`：`mountSettingsCard(ctx)` —— fail-soft 探测 `configForms/slots`，注入 `plugins.bundle.config` 槽。

**预会话开关**（`lib/client/pre-session/`）：
- `harness-input.js`：`readHarnessInput`（兼容 `imageIds`/`attachmentIds` 双代 API）、`adaptHarnessInputActions`（经原 receiver 绑定）。
- `controller.js`：`PreSessionWorktreeError`（`recoveryRequired`）；`PreSessionWorktreeController`：`prepare`（inflight 去重）、`run`（`sourceStillMatches` 最终 CAS、目标写入→导航→源清空的**无 await 关键区**、`using()` 持引用、归档源会话失败不回滚已安全交接、失败 rollback）、`rollback`（discard → 幂等 archive → 删 workspace）。
- `PreSessionWorktreeToggle.js`：composer 工具行的开关 + 确认 Modal；渲染期即失效旧续体；令牌一次性。
- `index.js`：`registerPreSessionWorktree` 挂 `conversation.input.left`（order 40）。

**侧栏投影**（`lib/client/workspace-sidebar/`）：
- `model.js`：`sidebarBadgeTasks`（每 owner 取最新 iteration/revision）、`projectManagedWorkspaceSidebar`（把受管 owner 会话合并回 Local 项目；歧义 fail-open 不隐藏；`hiddenWorkspaceIds/suppressedSessionIds/relocatedSessionIds` 等）。
- `index.js`：`sharedTopology` 模块级共享；`ManagedOfficialWorkspaceBrowser`（保留官方 Browser 只换数据投影）；`officialContextProxy`（service 级守卫 `blockSession/blockWorkspace`、picker 延迟解析）；`registerManagedWorkspaceSidebar`（接管模式：一次性 apply 官方 Client）；`ClearSidebarBadgeMenuItem`/`registerClearSidebarBadgeEntry`；`ROW_SEATS`（0.2.x 无 trailing seat）；`WorktreeStatusBadgeEntry`；`registerDecoratedWorkspaceSidebar`（Mode B：官方 Workspace 仍活跃时经 child-seat 装饰；源码注释解释为何 shadow `sidebar.workspaces` 是死路）。

### 9. i18n — `lib/i18n/`

- `core.js`：`normalizeLanguage(value)`（`en*`→en 否则 zh）；`createTranslator(catalog, language)`（`{name}` 插值，缺失原样返回占位）。
- `host.js`：AsyncLocalStorage 每次调用一个不可变 locale 快照；`currentHostLanguage`、`withHostLanguage(language, operation)`、`languageFromSettings(ctx)`（只读公共 settings 缝隙，异常回退 zh）、`languageForInvocation(agent, fallbackContext)`、`hostMessage(key, params?)`。
- `host-messages.js`：`hostMessages`（中英双语的巨型文案目录，键稳定、用户数据只走插值）；`hostRegistrationMessage(key)`（`zh + ' / ' + en`，用于工具/命令注册元数据）；`persistedCleanupKeys` 与 `hostPersistedCleanupMessage(message, translate)` —— 持久化的清理判别文案必须保持原值，仅对公开投影本地化。

### 10. Workspace Provider 选举 — `lib/workspace-provider-lifecycle.js`

常量：`OFFICIAL_WORKSPACE='@deepseek-ai/dsh-client-ui-workspace'`、`UNLOADING=5`、`DEFAULT_OPERATION_TIMEOUT_MS=10_000`、`ownedDisables`（跨代 WeakSet 所有权）。`mountWorkspaceProviderLifecycle(ctx, flavor, options)`：
- 未开启（`enableWorkspaceProvider !== true`）→ 直接返回 `{officialWorkspaceActive:true}`；`unsupported` flavor 同样让位。
- `selfDisabled()`（市场可外部禁用本插件 → 必须让位）。
- `adopted`/`overridden` 所有权簿记；`operate(entry, kind)` —— disable= `update({disabled:true})`+await 旧 fiber，restore= `update({disabled:null})`+按 fiber 状态 init/refresh（Loader 1.0.6 适配），每个操作竞速 10s 上限。
- `reconcile` 在 Loader 事件上重选；dispose：先撤 `worktreeWorkspaceProvider` marker → UNLOADING 后 withdraw fiber 引用 → 恢复 adopted 条目 → settle。
- 返回 `{officialWorkspaceActive: !takeover}`；误报接管会让 Web client 重放官方 apply 而崩溃。

## Architecture

```text
┌─────────────────── lib/index.js : apply() ───────────────────┐
│ Config(volatile) → 适配器装配 → createSessionCheckoutModule  │
└────┬──────────────┬───────────────┬──────────────┬───────────┘
     ▼              ▼               ▼              ▼
┌───────────┐ ┌─────────────┐ ┌──────────────┐ ┌──────────────┐
│ adapters/ │ │ session-    │ │ console-host │ │ tools.js ·   │
│ git·files │►│ checkout-   │►│ control-plane│►│ commands.js· │
│ ·registry │ │ apply.js    │ │ + service    │ │ target-ctx   │
└─────┬─────┘ └──────┬──────┘ └──────┬───────┘ └──────┬───────┘
      │              │               ▼                │
      │              │         ┌────────────┐         │
      │              │         │ i18n/host  │◄────────┘
      ▼              ▼         │ hostMessage│
┌─────────────────────────┐   └────────────┘
│ managed-checkouts.json  │
│ registry + safe-file    │
└───────────▲─────────────┘
            │ Remote RPC (WorktreeConsoleService)
┌───────────┴───────────────────────────────────────────┐
│ lib/client/*  React ToolView · 侧栏 · 设置卡 · 胶囊    │
└───────────────────────────────────────────────────────┘
```

三层安全边界贯穿全库：① **目录身份**（`DirectoryIdentity` device/inode/birthtimeNs）让“删除”永远建立在物理证据上（`worktree-creation.js`、`files.js:quarantineDirectoryTree`）；② **CAS**（revision、fingerprint、checkpoint generation、ref 旧值）让并发写永远失败得可恢复；③ **journal + 保留环境**让崩溃后可以恢复而不是猜测成功。

## Data Flow

**① 插件启动**（`lib/index.js:136-230`）：`validateGitTimeouts` → provider 选举 → 建 stateDir 与空 hooks 目录 → 组装四个端口 + ProjectSkillStore → `createSessionCheckoutModule`（[[session-checkout-module]]）→ 挂 `WorktreeConsoleService`（会把 `sidebarTopology` 结果附上 flavor/officialWorkspaceActive）→ 注册工具/命令/上下文 → `events.on('ready')` 触发 `module.reconcile()`（丢失本地根的记录警告，192-193）与 `enforceWorktreeKeepCount` → 三个定时器（保留期 15min、auto-prune 首跑 60s 后每 24h）。

**② worktree_create**：模型调工具（`lib/tools.js`）→ `module.createIsolatedTarget`（状态机，含 `createWorktree` 的独占 mkdir + `worktree add --detach --no-checkout --lock` + `verifyIdentity` + `read-tree/checkout-index`）→ `attachWorktreeBranch` 建会话分支 → `enterCheckout` 经 `workingDirectory.set` 真把会话 cwd 移进去 → 输出 `{kind:'worktree_target_created', ..., cwdSelected}`，客户端 `WorktreeCreateRow` 渲染并可“打开隔离会话”。

**③ Ready → 交付**：模型 `worktree_ready_for_review`（`lib/tools.js`）→ `engine.reviewIsolated` 快照 → `engine.commitIsolated`（`lib/session-checkout-apply.js`）把改动提交到**会话分支**（完全不写 Local）→ 按 retention 保留/清理冻结环境 → `autoPush` 尽力推送 → 用户经 `finalizeCurrentSession`（`lib/client/actions.js`）或 `/worktree finalize` 走 Local 合并路径（`worktree_merge`）。

**④ Console 读取链**：客户端 `createWorktreeConsoleRemoteAdapter`（30s/180s 超时）→ Typert RPC → `WorktreeConsoleService.<method>`（`withHostLanguage` 包裹 + ndjson 诊断）→ `createWorktreeConsoleControlPlane`（`authorize` → `observe`/`observeFromCaller` → `projectRecord/projectDetails` 投影）→ 严格 zod schema 校验（`descriptors.js`）→ React 面板。胶囊轮询由 `current-polling.js` 共享 Poll 驱动（隐藏页 60s）。

**⑤ 注册表持久化**：所有记录写经 `AtomicJsonCheckoutRegistry.write` → `writeJsonFileAtomic`（唯一 tmp + rename + `.bak`）；读经 `readJsonFileSafe` 三级回退 → `isRegistry` 严格校验（坏文件 `registry_corrupt` 响亮失败）→ v1 迁移（`migrateLegacyRegistry`，非 ready/discarded 一律 `recovery_required`）。

## Connections

- [[session-checkout-module]] —— `createSessionCheckoutModule`（`lib/index.js:29` 导入）是状态机本体，消费本目录的 `lookup/git/files/registry/applyEngine` 与全部 volatile 配置。
- [[session-checkout-apply]] —— Apply 引擎详析（checkpoint/preview/rollback/finalize/finish/commitIsolated 的 CAS 协议）。
- [[adapters-git]] / [[adapters-worktree-creation]] —— git 端口与创建回滚协议的深入文档。
- [[console-contract]] —— Host↔Client 共享 DTO、状态投影与错误元数据。
- [[console-host-control-plane]] —— 每个端点的授权矩阵与 CAS 细节。
- [[client-review-console]] —— 预检缓存、恢复续体与动作面板。
- [[client-workspace-sidebar]] —— 接管/装饰两种 Workspace 侧栏模式。
- [[i18n-host-messages]] —— 文案键目录与持久化判别文案约束。
- [[workspace-provider-lifecycle]] —— Loader 选举、所有权簿记与卸载时序。

## Known Issues

1. **safe-file 无跨进程锁**（`lib/adapters/safe-file.js:76-77` ponytail 注释）：唯一 tmp + 原子 rename 消除了"tmp 互踩/半写提升"，但文件级 last-writer-wins 仍在；需要强一致时须再引入 lock 文件。
2. **plans 仅内存**（`lib/session-checkout-apply.js`）：`plan/persistPlan` 存于进程内 Map，宿主重启即失效（调用方需重新 plan；journal 持久化由上层状态机补足）。
3. **第三方错误信息本地原样透出**（`lib/console-host/errors.js` ponytail 注释）：`consoleFailure` 对非领域错误保留原始 message 供本地 UI/测试观测；**若未来增加远程序列化通道，必须先在此截断/替换**。
4. **apply 引擎 30s 固定超时**（`lib/session-checkout-apply.js`）：ponytail 注释说明与 git.js 的 120s 不一致，靠 `options.timeoutMs` 覆盖；超大仓库的合并计算可能逼近上限。
5. **Review Diff 的"Ready 后即弃"语义**（`lib/console-host/control-plane.js` 的 `reviewDiff` 端点）：读写后任一 preflight 复验失败，diff 字节即被丢弃并报 `stale_isolated`——这是刻意设计，但对用户表现为"diff 偶发消失"。
6. **`capabilitiesSchema.returnToLocal` 兼容窗口**（`lib/console-remote/schemas.js`）：旧 Host 不输出该键，靠 `default(false)` 容忍；新增能力位必须沿用此模式，否则整条 `current` 校验失败、胶囊塌成“不可用”。
7. **侧栏 Mode B 的 seat 限制**（`lib/client/workspace-sidebar/index.js`）：DSH 0.2.x 没有 `sidebar.session.row.trailing` 声明，注入该名字会永久等待、徽章永远不挂载——只能用 `leading`+`hover` 两个 seat。
8. **接管官方 Workspace 的连锁风险**（`lib/index.js:104-110`、`lib/workspace-provider-lifecycle.js`）：takeover 会把官方 ui-workspace 客户端包从 Host 图里移除，任何导入它的包都失去 bundle；因此默认 `false`，且 0.2.x 上装饰路径结构性崩溃时该开关"自动生效但仅为建议值"（`lib/index.js:127-134` 注释）。
9. **`hostMessages` 单体目录**（`lib/i18n/host-messages.js`）：约 880 个键集中在一个对象里；`hostPersistedCleanupMessage` 依赖 zh 原文匹配持久化判别文案——**改动这些键的 zh 文本会破坏清理恢复的本地化识别**。
10. **隐藏窗口轮询降级依赖 `document.visibilityState`**（`lib/client/target-console/current-polling.js`）：无 DOM 的宿主按普通 5s 处理；`Poll` 的 last 快照在最后一个订阅者退出时清空，重挂载首帧必有一次真实 RPC。
11. **分支概览缓存按 sessionId 键控但语义是仓库级**（`lib/client/target-console/branch-overview-cache.js`）：同项目多会话互相覆盖同一底层视图，这是文档化行为而非 bug，但排查“别处切了分支这边没刷新”时需知悉。
12. **`worktree_deliver` 的 autoDeliver 闸门**（`lib/tools.js`）：`autoDeliver` 关闭时模型侧交付被硬禁用（抛 `worktreeDeliverDisabledByAutoDeliver`），只能走 `worktree_ready_for_review` 人工验收——这是功能开关而非缺陷，但排查“模型报错无法交付”时应首先检查该配置（`lib/index.js:66-71`，默认 true）。
