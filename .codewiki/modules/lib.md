---
title: lib
type: module
source_files:
  - lib/index.js
  - lib/index.d.ts
  - lib/ports.js
  - lib/ports.d.ts
  - lib/types.d.ts
  - lib/checkpoint.js
  - lib/commit-message.js
  - lib/concurrent-session-guard.js
  - lib/console-contract.js
  - lib/console-contract.d.ts
  - lib/creation-failure.js
  - lib/delivery-excludes.js
  - lib/host-compat.js
  - lib/managed-worktree-path.js
  - lib/session-checkout-apply.js
  - lib/session-checkout-apply.d.ts
  - lib/session-target-context.js
  - lib/tools.js
  - lib/commands.js
  - lib/workspace-provider-lifecycle.js
  - lib/adapters/files.js
  - lib/adapters/git-options.js
  - lib/adapters/git.js
  - lib/adapters/initial-commit.js
  - lib/adapters/lookup.js
  - lib/adapters/project-skill-io.js
  - lib/adapters/project-skill-provider.js
  - lib/adapters/project-skills.js
  - lib/adapters/registry.js
  - lib/adapters/safe-file.js
  - lib/adapters/working-directory.js
  - lib/adapters/worktree-creation.js
  - lib/console-host/control-plane.js
  - lib/console-host/errors.js
  - lib/console-host/projection.js
  - lib/console-host/review-diff.js
  - lib/console-host/service.js
  - lib/console-remote/descriptors.js
  - lib/console-remote/schemas.js
  - lib/i18n/core.js
  - lib/i18n/host-messages.js
  - lib/i18n/host.js
  - lib/client/index.js
  - lib/client/model.js
  - lib/client/i18n.js
  - lib/client/actions.js
  - lib/client/WorktreeCreateRow.js
  - lib/client/WorktreeReviewRow.js
  - lib/client/console-remote/adapter.js
  - lib/client/console-remote/index.js
  - lib/client/pre-session/controller.js
  - lib/client/pre-session/harness-input.js
  - lib/client/pre-session/index.js
  - lib/client/pre-session/PreSessionWorktreeToggle.js
  - lib/client/review-console/request-cache.js
  - lib/client/review-console/preflight-cache.js
  - lib/client/review-console/preview-recovery-cache.js
  - lib/client/review-console/status-events.js
  - lib/client/review-console/recovery-continuation.js
  - lib/client/review-console/ReviewIcon.js
  - lib/client/review-console/WorktreeReviewPanel.js
  - lib/client/review-console/DeliveryProof.js
  - lib/client/review-console/PreflightStatus.js
  - lib/client/review-console/ReviewDetailsModal.js
  - lib/client/review-console/ReviewActions.js
  - lib/client/review-console/index.js
  - lib/client/settings-card/form-model.js
  - lib/client/settings-card/worktree-settings-card.js
  - lib/client/settings-card/index.js
  - lib/client/settings-card/WorktreeSettingsCard.js
  - lib/client/target-console/branch-overview-cache.js
  - lib/client/target-console/current-polling.js
  - lib/client/target-console/BranchGraphModal.js
  - lib/client/target-console/TagManagerModal.js
  - lib/client/target-console/TargetStatusAction.js
  - lib/client/target-console/WorktreeConsoleView.js
  - lib/client/target-console/WorktreeHeroChip.js
  - lib/client/target-console/WorktreeManagerModal.js
  - lib/client/target-console/WorktreeReviewStatus.js
  - lib/client/target-console/index.js
tags: [git-worktree, dsh-plugin, adapters, session-checkout, console-rpc, react-client]
---

## Overview

`lib/` 是 `dsh-git-worktree` 插件的全部源码。该插件运行在 DSH（DeepSeek Harness，基于 Cordis 的宿主）之上，为 Agent 会话提供**受管 Git Worktree**：把会话切进一个独立 checkout 工作，经过「Working → Ready for Review →（Local Preview）→ 交付/放弃」的生命周期，最终把改动写回会话分支或 Local 仓库，并按保留策略清理冻结环境。

目录按严格的分层组织：

| 层 | 目录/文件 | 职责 |
| --- | --- | --- |
| 插件入口 | `lib/index.js` | 装配全部端口、模块与表面层；`Config`/`inject` 元数据 |
| 端口契约 | `lib/ports.d.ts` / `lib/ports.js` | 领域只依赖的端口接口（git/files/registry/lookup）与运行时 `liveConfigValue` |
| 领域核心 | `lib/session-checkout-apply.js` 等 | 宿主无关的 apply 引擎（三方合并、CAS、崩溃恢复） |
| 适配器 | `lib/adapters/*` | 把端口落到 Node fs、git 子进程、Cordis 服务上 |
| 表面层 | `lib/tools.js`、`lib/commands.js`、`lib/console-host/*` | 模型工具、`/worktree` 命令、Typert RPC 服务 |
| 浏览器端 | `lib/client/**` | React ToolView / 评审面板 / 目标胶囊 / 预会话开关 / 设置卡 |
| 共享契约 | `lib/console-contract.js`、`lib/console-remote/*`、`lib/i18n/*` | JSON DTO、zod 严格 schema、双语文案 |

状态机本体 `createSessionCheckoutModule`（`lib/session-checkout-module.js`）在 `lib/index.js:29` 被导入并在 `lib/index.js:158-173` 装配，但其源码不在本文件集内，详见 [[session-checkout-module]]。

## Key Components

### 1. 入口与装配

#### lib/index.js

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `SessionCheckoutError` | 4-15 | 领域错误类；字段 `code`（取值来自 `lib/types.d.ts:499` 的 `SESSION_CHECKOUT_ERROR_CODES`）+ 继承的 `message`；`name='SessionCheckoutError'` |
| `inject` | 46 | 插件依赖声明 `{ tools:{}, commands:{}, subprocess:{}, loader:{await:false} }`；注释（39-45）说明必须用具名导出，否则首次 `ctx.tools` 访问报 "cannot get property without inject" |
| `volatile()` | 48-52 | 给 schema 字段打 `meta.volatile=true`，使设置页热更新（写 cordis.patch.yml 不重挂载，值以 live 引用到达） |
| `Config` | 53-111 | schemastery 配置：`stateDir`(60)、`gitTimeoutMs`(63, 默认 120000)、`worktreeAddTimeoutMs`(64, 默认 300000)、`autoDeliver`(71, 默认 true)、`autoPush`(76, 默认 true)、`worktreesRoot`(83)、`inheritLocalChanges`(89, 默认 true)、`worktreeKeepCount`(94, 默认 15, 0-500)、`branchRaceGuard`(101, 默认 true)、`branchRaceWindowMs`(103, 默认 30 分钟)、`enableWorkspaceProvider`(110, **默认 false，即 takeover 默认禁用**) |
| `resolveWorktreesRootValue()` | 112-115 | 解析 live 引用并 `resolve()`；空串视为未配置 |
| `resolveStateDir()` | 116-121 | 默认 `$DSH_HOME/plugins/dsh-git-worktree`，`DSH_HOME` 未设时 `~/.dsh` |
| 常量 | 122-126 | `RETENTION_MAINTENANCE_INTERVAL_MS=15min`、`AUTO_PRUNE_INTERVAL_MS=24h`、`AUTO_PRUNE_FIRST_RUN_DELAY_MS=60s`、`AUTO_PRUNE_OLDER_THAN_DAYS=7` |
| `apply()` | 136-230 | 主装配：`validateGitTimeouts`(137) → `mountWorkspaceProviderLifecycle`(141) → 建目录与 hooksPath(142-145) → `createDshLookupPort`(152) → `ProjectSkillStore`(153) → `createDshGitPort`(154) → `createNodeFilesPort`(155) → `AtomicJsonCheckoutRegistry`(156) → `mountProjectSkillProvider`(157) → `createSessionCheckoutModule`(158-173) → `new WorktreeConsoleService(...)`(174-181, 带 ndjson 诊断文件与 `officialWorkspaceActive`) → `registerTools`(182) / `registerWorktreeCommand`(183) / `registerSessionTargetContext`(184) → `ready` 事件上 `module.reconcile()+enforceWorktreeKeepCount`(188-199) → 保留期定时器(200-207) → 7 天合并分支自动清理(208-223) → 卸载时统一清理(224-229) |

#### lib/host-compat.js

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `workspaceClientFlavorForAgentVersion()` | 4-27 | 精确版本映射：`0.1.2-rc.1→legacy`、`0.1.6-alpha.2→alpha`、`0.1.7-rc.2→next`、`0.2.0-rc.2→modern`；未钉住的 `0.2.x` 走 `isModernGeneration` 也判 modern（注释 13-23 说明 0.2.1-rc.4 为上游钉住发布） |
| `isModernGeneration()` | 28-31 | 正则 `/^(\d+)\.(\d+)\./` 提取主/次版本并要求为 `0.2`（即 `0.2.x`） |
| `agentVersionFromAnchor()` | 32-43 | 用 `createRequire` 从锚点解析 `@deepseek-ai/dsh-agent/package.json` 读取版本 |
| `workspaceFlavorDiagnostics()` | 52-63 | 依次探测 `[process.argv[1], process.cwd(), import.meta.url]` 三类锚点（`ANCHOR_KINDS`，44 行），首个解析到 Host agent 树的锚点定 flavor，全部记录 |
| `hostWorkspaceClientFlavor()` | 64-66 | 便捷封装 |

#### lib/workspace-provider-lifecycle.js

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `OFFICIAL_WORKSPACE` | 2 | `'@deepseek-ai/dsh-client-ui-workspace'` |
| `UNLOADING` | 4 | Cordis FiberState=5（仅声明，无 JS 导出） |
| `DEFAULT_OPERATION_TIMEOUT_MS` | 9 | 10s，单次 Loader 操作天花板 |
| `ownedDisables` | 17 | `WeakSet`，跨代际记录本插件写下的 disable |
| `mountWorkspaceProviderLifecycle()` | 44-293 | `uiWorkspace` 提供者选举。`options.enabled!==true` 直接返回 `{officialWorkspaceActive:true}`(55-58)；flavor `unsupported` 同样放行(59-62)。内部：`selfDisabled`(70-77)、`adopted/overridden` 集合(85-86)、`official()`(87-101, 识别并绕过用户禁用的条目、清掉遗留 `__jsExpr` 条件补丁)、`operate(entry,'disable'\|'restore')`(108-154, disable 要 `update({disabled:true})` 后 `fiber.await()`；restore 要 `update({disabled:null})` 后按 fiber 状态 `init()` 或 `refresh()`——Loader 1.0.6 适配，见 116-132 注释)、`reconcile()`(155-183)、卸载 effect(185-243, 先撤 `worktreeWorkspaceProvider` 标记、等待离开 UNLOADING 再 withdraw fiber)、`internal/status` 与 `internal/plugin` 事件重入选举(251-260)、首次 `await reconcile()`(265)、最终判定 takeover(273-292, 只有所有 owned 条目真实 disabled 才声明接管，否则回退 decorate 共存) |

#### lib/session-target-context.js

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `registerSessionTargetContext()` | 6-32 | 注册系统提示上下文 `git-worktree:session-target`（order 118，23 行）。文本同步调用 `module.runtimeContext(sessionId, workingDirectory.current(agent))`；若模块提供 `refreshBranchRaceGuards`，另起 45s 定时器后台刷新分支竞争守卫缓存(12-19) |

### 2. 领域核心

#### lib/session-checkout-apply.js（apply 引擎，1725 行）

模块级工具：

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `GitCommandFailure` | 12-20 | 携带 `args` 与原始 `result` 的 git 失败 |
| `AMBIENT_GIT_ENV_PATTERN` | 23 | 需要清洗的 `GIT_DIR/GIT_WORK_TREE/...` 环境变量正则 |
| `scrubbedAmbientGitEnv()` | 24-28 | 把上述变量置 `undefined`，防止环境变量把 git 重定向到非授权仓库 |
| `disabledGitHooksPath()` | 33-36 | 惰性 mkdtemp 出空 hooks 目录 |
| `GIT_TIMEOUT_MS` | 39 | 30s（apply 路径命令较短） |
| `runGit()` | 41-100 | spawn git，固定 `--no-optional-locks`、Windows `core.longpaths=true`、`core.quotePath=false`、`core.fsmonitor=false`、空 hooksPath；支持 `allowedExitCodes`、`options.env` 注入通道（总是覆盖清洗后的环境）、`timeoutMs` SIGTERM |
| `snapshotFingerprint()` | 173-183 | `sha256(headOid ‖ headRef ‖ indexEntries ‖ treeOid)` |
| `captureSnapshot()` | 184-228 | 临时 index 上重放 HEAD 的 staged 补丁（`read-tree`+`apply --cached`），再 `add -A`（带 `deliveryExcludePathspecs()` 排除宿主运行期产物，186 行默认参数）；若有随会话携带的 Project Skills 则从指纹中剔除(217-223)；返回 `{fingerprint, headOid, headRef, headTreeOid, indexTreeOid, treeOid, indexEntries}` |
| `selectEffectiveApplyBase()` | 153-168 | 三种 base 策略：`recorded_base` / `isolated_contains_local_head` / `local_contains_isolated_head`，靠 `merge-base --is-ancestor` 证明 |
| `computeMerge()` | 261-322 | 在一次性临时仓库里对 Local/Isolated 快照 commit 做三方合并；冲突时返回 `conflictingFiles` + `collectConflictDetails`(243-260, 逐文件 diff，受 `CONFLICT_DETAIL_FILE_LIMIT=6`/`CONFLICT_DETAIL_DIFF_LIMIT=4096` 约束，见 `lib/types.d.ts:439-440`)；成功时产出 binary patch 与 `mergedTreeOid`（中央 index 收敛） |
| `computeTreeMerge()` | 323-376 | 纯 tree 级三方合并（用于从完整快照中剥离任务增量） |
| `prepareRollbackAssessment()` | 420-473 | Preview 撤回安全评估：branch/HEAD 快进检查、Local 已前进时的四次 tree 合并验证，任一不安全返回 blocked（`stale_local`/`preview_modified`） |
| `prepareFinalizeAssessment()` | 474-519 | Preview 提交安全评估：任务增量 `taskTreeOid`、最终 index `finalIndexTreeOid`、`commitRequired` 判定 |
| `writeIndexLock()` | 559-581 | 以 `O_EXCL` 写 `<index>.lock`（Git 原生锁协议），失败识别 `EEXIST` |
| `planMatches()` | 397-408 | 全字段比较已审核 plan 与请求 plan |

`DefaultSessionCheckoutApplyEngine`（588-1721）全部方法：

| 方法 | 位置 | 说明 |
| --- | --- | --- |
| `constructor` | 591-593 | 持有 `options`（`projectSkills` 与测试 seam） |
| `captureSnapshot`（实例包装） | 594-596 | 注入 `this.options.projectSkills` |
| `checkpoint()` | 597-736 | 阶段保存：指纹 CAS(614-616) → 创建用户 commit → `beforeCommit` 持久化 journal(626) → 写 index.lock + 邻接 index(630-636) → CAS 复验(637-641) → 推进 HEAD/branch(644-652, 分支附着时绝不 `--no-deref` 以免 detach) → rename index(656) → 写后验证(687-717)；失败按 `headUpdated` 回滚，无法回滚时 `recoveryState:'uncertain'` 并保留恢复证据(667-676) |
| `recoverCheckpoint()` | 737-822 | 崩溃恢复：用 `.dsh-<commitOid>` 锁标记证明遗留锁归属(750-763)，按 HEAD 位置分支为 `checkpoint_aborted` 或 `checkpoint_recovered` |
| `inspectReview()` | 823-864 | 评审快照（读 Local+Isolated，验证同仓库同子目录） |
| `reviewIsolated()` | 869-902 | **只读 Worktree** 的评审快照（会话分支交付用，完全不解析 Local） |
| `commitIsolated()` | 910-986 | **会话分支交付**：把 Worktree 工作区提交到它检出的分支上，完全不读写 Local（注释 903-909）。`branchRef` 守门(932-941)、提交树取自评审快照同路径以排除宿主产物与 Project Skills(943-946)、`update-ref HEAD`+`reset --quiet`(951-954)、提交后干净快照供清理 CAS(957)；git 身份未配置时映射为 `initialIdentityMissing` 提示(976-979) |
| `preflight()` / `plan()` | 987-992 | 分别对应 `calculatePlan(persistPlan=false/true)` |
| `calculatePlan()` | 993-1081 | 同仓库/同前缀校验 → 双侧快照 → effective base → computeMerge → 产出 `ApplyPlan`；persist 时每个 isolated 路径只保留一份 plan（1053-1059 的 ponytail 注释） |
| `apply()` | 1082-1132 | plan CAS → 双侧复验 → `beforeFinalLocalValidation` seam(1111) → 最终 CAS(1112-1118) → 向 Local 工作区打 binary patch(1119-1121) |
| `preview()` | 1133-1218 | 与 apply 同前置；`beforeWrite` 先持久化 receipt(1193) 再写 patch；写后 tree 必须等于 `previewWorkingTreeOid`(1197-1203) |
| `assessPreviewRecovery()` | 1219-1248 | 严格只读的 detached Preview 恢复评估（rollback+finalize 双结论） |
| `rollback()` | 1249-1315 | 评估 → `beforeWrite`(1265) → CAS(1267-1272) → 反向 patch → 写后指纹精确匹配(1291-1305)，不匹配报 `uncertain` |
| `finalize()` | 1316-1522 | Preview 提交落 Local：`prepareFinalizeAssessment` → 预演 task/index patch(1353-1364) → `beforeCommit`(1368) → 备份 index(1373-1374) → `writeIndexLock`(1379) → 锁内 CAS(1387-1394) → `update-ref branch`+rename index(1399-1403) → 写后验证(1409-1432)；失败补偿路径三种（1435-1472：仅 ref 回滚 / 备份 index CAS 恢复 / 证据缺失拒绝部分回滚），最终 `restored` 判定(1474-1500)，不可恢复时保留备份并报 `uncertain`(1501-1510) |
| `finish()` | 1523-1705 | 经典「写回 Local」交付：plan CAS → 复验合并与文件集一致(1558-1568) → `nextBaseOid` 快照(1569-1573) → 任务增量剥离 `C = H + (M − L)`(1583-1593) → staged 恢复 `S' = C + (S − H)`(1594-1604) → index.lock 内完成 打补丁→`update-ref`→换 index(1620-1653)；任一步失败按已完成步骤逆序回滚(1654-1688) |
| `errorMessage()` / `cleanup()` | 1706-1720 | 错误文案与临时目录清理（清理失败只 warn，不掩盖主结果） |
| `createSessionCheckoutApplyEngine()` | 1722-1724 | 工厂 |

#### lib/concurrent-session-guard.js

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `normalizePath()` | 14-18 | 反斜杠→正斜杠、补尾斜杠、Windows 小写 |
| `cwdWithinLocalRoot()` | 20-26 | cwd 是 Local 根自身或其后代（cwd 缺失视为 true） |
| `detectLocalBranchRace()` | 28-49 | 纯同步谓词：输入 `{sessions, sessionId, localRoot, branchCreationTimes, now, windowMs, managedBranches?}`，输出 `{status:'race_detected'\|'clear', earlierLocalSessionIds, recentBranchNames}`；managed worktree 分支(39-44)与无 `createdAt` 时的「他人都可能更早」策略(33-37) |

#### lib/checkpoint.js

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `canonicalJson()` | 2-12 | 递归键排序、剔除 `undefined` 的规范 JSON 序列化 |
| `checkpointGenerationForRecord()` | 14-28 | 对 `{checkoutId, revision, reviewId, isolatedHeadOid, isolatedFingerprint, checkpointCount, previewId?, phase}` 做 sha256，作为 Host 派生的 checkpoint CAS generation；仅 `ready_for_review`/`preview_active` 有效，否则 `undefined` |

#### lib/commit-message.js
- `isValidCommitMessage()` 2-4：非空、可 trim、不含 `\0`（提交体走 stdin，500 字符并非 Git 上限）。

#### lib/creation-failure.js
- `WorktreeCreationFailure` 2-9：`rolledBack: boolean`；注释「创建失败 ≠ 可以推断空路径安全」。

#### lib/delivery-excludes.js

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `HOST_RUNTIME_ARTIFACTS` | 12-16 | `['.dsh-ops','desktop-runtime.json','.dsh-runtime.json']` |
| `deliveryExcludePathspecs()` | 21-30 | 转成 4 种 git pathspec 排除（本目录/子树/`**` 嵌套两种） |

### 3. 端口契约与数据模型

#### lib/ports.d.ts（接口）/ lib/ports.js（运行时）

| 接口 | 位置 | 关键字段/方法 |
| --- | --- | --- |
| `SessionCheckoutLookupPort` | 27-51 | `getSession`/`getProject`；可选 `getSidebarMemberships`、`getSessionCwd`（owner 会话的**活 cwd 即 worktree 根**，注释 32-40）、`listLiveSessions` |
| `GitCheckoutSnapshot` | 52-59 | `root, commonDir, gitDir, branch, headOid, headRef` |
| `BranchOverviewEntry` | 61-66 | `name, oid, isCurrent, upstream` |
| `TagOverviewEntry` | 68-78 | `name, oid, commitOid, annotated, message, pushed(boolean\|null)` |
| `GraphLogCommit` | 80-88 | `oid, parents, author, authorTime, refs, subject` |
| `InitialCommitPreflight` | 89-93 | `kind:'ready'\|'empty'\|'files'`, `fingerprint`, `snapshot` |
| `SessionCheckoutGitPort` | 94-237 | 必选 `inspect/findContainingWorktreeRoot/status/createDetachedWorktree/removeWorktree/retainApplyBase/releaseApplyBase/retainInternalArtifact/readInternalArtifact/releaseInternalArtifacts/isAncestor`；大量本地适配可选方法：`attachWorktreeBranch`(111-118, CAS 语义)、`pushBranch`(130-138)、`repairWorktreeLinks`(139-144)、`pruneWorktrees`(145-149)、`branchOverview`(150-158)、`defaultBranch`(159-163)、`branchTipTimes`(164-168)、`branchCreationTimes`(169-174)、`deleteLocalBranch`(175-179)、`mergeLocalBranch`(180-187)、`graphLog`(188-189)、`createLocalBranch`(190-191)、`switchLocalBranch`(192-193)、`listTags`(194-199)、`createTag`(200-204)、`deleteLocalTag`(205-206)、`pushTag`(207-214)、`deleteRemoteTag`(215-216)、`captureLocalWip`(217-224)、`applyWorktreePatch`(225-226)、`listUntrackedFiles`(227-228)、`snapshotAbandonedWorktree`(229-234)、`restoreAbandonedSnapshot`(235-236)、`preflightInitialCommit`/`initializeEmptyRepository`/`initializeProject`(95-99)、`listLocalBranches`/`resolveLocalBranchTip`(100-103)、`listWorktreeincludeFiles`(129) |
| `DirectoryIdentity` | 238-242 | `device, inode, birthtimeNs`（字符串化的目录身份） |
| `SessionCheckoutFilesPort` | 243-260 | `exists/canonicalize/inspectDirectoryIdentity/ensureDirectory/removeEmptyDirectoryTree/quarantineDirectoryTree/removeDirectoryTree/measureDirectoryBytes` + 可选 `readTextFile/copyFile/isSymbolicLink` |
| `SessionBindingRecord` | 261-271 | `sessionId, projectId, projectName, target, ownerSessionId, inheritedFromSessionId?, sourceRef, sourceOid, revision` |
| `WorktreeCreationEvidence` | 276-288 | `root, rootIdentity, parentIdentity, commonDir, commonIdentity, lockReason, gitDir?, gitIdentity?, metadataFingerprint?, indexFingerprint?, quarantinePath?` |
| `ManagedCheckoutJournal` | 272-323 | `ManagedCheckoutCreateJournal`(operation='create', step='creating_worktree', creation?) 与 `ManagedCheckoutMutationJournal`(apply/preview/checkpoint/rollback_preview/finish/finalize_preview/cleanup × 7 个 step，含 `baseOid/planRevision/previewId/reviewId/localFingerprint/isolatedFingerprint/effectiveBaseOid/baseStrategy/localHeadOid/isolatedHeadOid/commitOid/checkpoint*/parentOid/retention/recoveryGeneration/resumeRevision?/changedFiles` 等可选字段) |
| `ManagedWorktreeCheckpointRecord` | 324-341 | `checkpointId, sequence, reviewId, requestId?, requestedRevision?, generation?, iteration, createdAt, commitOid, parentOid, summary, commitMessage, validationStatus, changedFiles` |
| `ManagedWorktreeReviewRecord` | 350-363 | `reviewId, iteration, preparedAt, detailsMarkdown?, summary, validationStatus, validationSummary?, tests, changedFiles, suggestedCommitMessage, isolatedFingerprint, isolatedHeadOid` |
| `ManagedPreviewReceipt` | 364-383 | `previewId, reviewId, iteration, previewedAt, configuredBaseOid, effectiveBaseOid, baseStrategy, localHeadOid, localHeadRef, localFingerprintBefore, localFingerprintPreview, localWorkingTreeOid, localIndexTreeOid, previewWorkingTreeOid, isolatedHeadOid, isolatedFingerprint, isolatedSnapshotOid, changedFiles` |
| `ManagedDeliveryProof` | 384-392 | `localBranch, localHeadBefore, localHeadAfter, changedFiles, validationStatus?, validationSummary?` |
| `ManagedRecoveryContinuation` 联合 | 393-425 | `worktree_apply_conflict`(393-401: requestId, reviewId, readyRevision, workingRevision, localHeadOid, conflictingFiles) / `worktree_review_regeneration`(402-407) / `worktree_preview_recovery_analysis`(408-415, +previewId, generation) / `worktree_preview_recovery_handoff`(416-424, +sourceCheckoutId, sourceRevision) |
| `ManagedCheckoutDelivery` 联合 | 426-471 | 7 态：`working`(426-429) / `ready_for_review`(429-432) / `preview_active`(432-436) / `preview_detached`(436-444: detachedAt, reason, attemptedAction) / `finalized`(444-454: commitOid, proof?, isolatedFingerprint, finalizedAt, cleanup:'pending'\|'blocked', cleanupMessage?) / `retained`(454-465: retention, retainedAt, expiresAt, cleanup:'scheduled'\|'blocked') / `delivered`(465-471) |
| `ManagedCheckoutRecord` | 472-525 | 全字段：`checkoutId, predecessorCheckoutId?, projectId, projectName, ownerSessionId, sourceSessionId?, localRoot, managedRoot, managedGitRoot, gitCommonDir, gitDir, baseOid, applyBaseOid?, previousReview?, checkpoints?, recoveryContinuation?, abandonedSnapshotOid?, abandonedSnapshotAt?, permanent?, sidebarBadgeClearedRevision?, sourceRef, sessionBranch?, sessionTopic?, phase, delivery, journal, revision` |
| `ManagedCheckoutsRegistry` | 526-531 | `version:2, revision, sessionBindings:Record<string,SessionBindingRecord>, managedCheckouts:Record<string,ManagedCheckoutRecord>` |
| `SessionCheckoutRegistryPort` | 532-535 | `read()/write()` |
| `LiveValue<T>` | 537-539 | `{get():T}`；`liveConfigValue()`（lib/ports.js:10-15）读取普通值或 live 引用 |
| `SessionCheckoutDependencies` | 542-583 | 模块依赖 + 全部本地适配开关（`autoPush/autoDeliver/worktreesRoot/inheritLocalChanges/worktreeKeepCount/branchRaceGuard/branchRaceWindowMs`，均支持 `LiveValue`） |

#### lib/types.d.ts（节选常量）
- `DEFAULT_WORKTREE_RETENTION` 声明于 30（retain 系默认，使误交付可恢复）。
- `CONFLICT_DETAIL_FILE_LIMIT = 6`（439）、`CONFLICT_DETAIL_DIFF_LIMIT = 4096`（440）。
- `SESSION_CHECKOUT_ERROR_CODES`（499）29 个稳定错误码；`WorktreeRetentionMode`（24）= `cleanup|retain_24h|retain_3d|retain_manual`。

#### lib/console-contract.js / .d.ts

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `WORKTREE_CONSOLE_TARGET_STATES` | 11-23 | `local/creating/working/ready_for_review/preview_active/preview_detached/retained/cleanup_pending/recovery_required/delivered/discarded` |
| `worktreeReachedDelivery()` | 30-36 | delivery 为 delivered/finalized/retained 或 phase 为 finalized/retained；**交付优先于 phase**（否则清理成功后的 `discarded` 会被误读为 abandoned） |
| `consoleStateFromDomain()` | 38-63 | 领域 `(kind, phase, deliveryState)` → UI 态；`recovery_required` 与 `preparing→creating` 优先(41-44)，`discarded` phase 压过陈旧 retained 标签(50-52) |
| `WORKTREE_CONSOLE_ERROR_CODES` | 64-69 | 领域错误码 + `transport_unavailable/malformed_response/timeout` |
| `ERROR_META` / `worktreeConsoleErrorMeta()` | 70-106 | 每个错误码的 `{category, recovery, retryable}` 元数据 |

`lib/console-contract.d.ts` 中的核心 DTO：
- `WorktreeConsoleCapabilities`（33-59）：`create/open/inspect/discard/preflight/preview/checkpoint/resumeRevision/rollbackPreview/finalize/finalizePreview/setRetention/setPermanent/retryCleanup/beginNextIteration/returnToLocal` 共 16 个能力位。
- `WorktreeConsoleTargetSummary`（80-110）：`project, checkoutId, sourceSessionId, ownerSessionId, targetSessionId, iteration, revision, state, phase, dirty, currentOid, commitOid, sourceBranch, retention?, retainedAt?, expiresAt?, permanent?, cleanupMessage?, deliveryProof?, review?, checkpoints?, checkpointGeneration?, reviewSlot?, reviewSlotOwnerSessionId?, reviewSlotHolder?, previewRecovery?, capabilities`。
- `WorktreeConsoleTargetDetails`（112-125）：Summary 之上加 `managedRoot, sourceRoot, sourceOid, currentBranch, recoveryContinuation?`。
- `WorktreeConsoleAdapter`（554-600）：客户端统一 seam，38 个 `Promise<WorktreeConsoleOutcome<T>>` 方法（`sidebarTopology/current/list/preflightCreate/createWithInitialCommit/create/initializeProject/inspect/reviewDiff/preflight/previewRecoveryPreflight/preparePreviewRecoveryAnalysis/createPreviewRecoveryHandoff/preview/checkpoint/resumeRevision/prepareReviewRegeneration/rollbackPreview/discard/finalize/finalizePreview/setRetention/setPermanent/retryCleanup/beginNextIteration/returnToLocal/clearSidebarBadge/gitOverview/gitGraph/gitCreateBranch/gitSwitchBranch/gitPruneMergedBranches/gitListTags/gitCreateTag/gitDeleteTag/gitPushTag` + 可选 `listAbandoned/restoreAbandoned`）。

### 4. 适配器

#### files.js — Node fs 文件端口

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `measureDirectoryBytes()` | 13-25 | 递归字节量，不跟随符号链接 |
| `removeEmptyDirectoryTree()` | 26-38 | 仅当整棵树无文件/链接才逐级 rmdir，否则整体返回 false |
| `inspectDirectoryIdentity()` | 39-50 | `{device, inode, birthtimeNs}`（bigint lstat），非目录或链接返回 null |
| `directoryIdentitiesEqual()` | 51-53 | 三元组相等 |
| `quarantineDirectoryTree()` | 54-74 | 校验 quarantine 父目录同源且未占用(55-62) → `rename` → 复验身份(64-66)；不匹配则**尽量 rename 回原位且绝不删除身份不符对象**(67-72 注释) |
| `removeDirectoryTree()` | 75-88 | 拒绝非目录/符号链接根(79-81)；Windows 上 `maxRetries:6` vs 其他 2(85) |
| `createNodeFilesPort()` | 90-116 | 返回 11 方法对象：`exists/canonicalize/inspectDirectoryIdentity/ensureDirectory/removeEmptyDirectoryTree/quarantineDirectoryTree/removeDirectoryTree/measureDirectoryBytes/readTextFile/copyFile(101-106, 先建父目录+rm 目标)/isSymbolicLink(107-114)` |

#### git-options.js

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `DEFAULT_GIT_TIMEOUT_MS` | 2 | 120_000 |
| `DEFAULT_WORKTREE_ADD_TIMEOUT_MS` | 3 | 5×60_000 |
| `MAX_GIT_TIMEOUT_MS` | 4 | 60×60_000 |
| `validateGitTimeouts()` | 5-12 | 必须是 1000..3600000 的安全整数 |
| `gitTimeoutMs()` | 13-21 | 按命令分流：`worktree add` 用 `worktreeAddTimeoutMs`；`worktree remove` 固定 5 分钟(18-19)；其余 `gitTimeoutMs`；volatile 字段每次调用实时读取(14-15 注释) |

#### git.js — ctx.subprocess 支撑的 git 端口（782 行）

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| 常量 | 32-36 | `GIT_TERMINATION_GRACE_MS=1000`、`GIT_COLLECT_BYTES=1MB`、`WIP_PATCH_COLLECT_BYTES=16MB` |
| `parseDecoration()` | 42-53 | `%D` → ref 名数组；tag 加 `tag:` 前缀；丢弃 `HEAD -> `；裸 `HEAD` 非 ref |
| `settleCreationTree()` | 54-70 | 创建失败时确认进程树终止（10s 上限） |
| `runGit()` | 76-183 | 单条 git 命令：固定参数 `--no-pager --no-optional-locks`、Windows `core.longpaths=true`、`core.quotePath=false`、`core.fsmonitor=false`、空 `core.hooksPath`(85-96)；环境清洗(105-113, 108 行正则 + `GIT_OPTIONAL_LOCKS=0`/`GIT_TERMINAL_PROMPT=0`/`LC_ALL=C`)；输出按 `maxBytes` 采集，`lossy` 即判失败(166-168)；creation 路径支持二进制输入的两段协议（`prepare`→等待 stdout 回显→`beforeCommit`→`commit\n`/`abort\n`，115-139），配合 initial-commit 的 CAS |
| `runGitChecked()` | 184-190 | 非零即抛 `git_operation_failed` |
| ref 命名空间 | 191-217 | `checkoutRefRoot`= `refs/dsh-worktree/session-checkouts/<sha256 前24>`(191-194)；`assertArtifactName`(195-201)；`internalArtifactRef`(202-205)；`applyBaseRef`(206-208)；`abandonedSnapshotRef` **故意放在命名空间外**(209-217)，避免 discard 清理连带删除安全快照 |
| `hasGitMetadata()` | 218-234 | 向上逐级探测 `.git`（ENOENT 之外的错误视为「有元数据」，225-228） |
| `createDshGitPort()` | 236-782 | 返回完整端口（方法与 `ports.d.ts` 一一对应）。要点：`inspect`(242-310) 单次 rev-parse 快路径 + unborn/broken HEAD 回退路径；`createDetachedWorktree`(325-336) 先校验 Project Skills 无本地 tracked 改动(327-330) 再调 `createWorktree`；`attachWorktreeBranch`(401-415) 用 `update-ref <branch> <new> <old>` 实现零文件触碰的 CAS 换 HEAD(404-409 注释)；`releaseInternalArtifacts`(368-380) 单次 spawn `update-ref --stdin` 事务删除全部 ref；`switchLocalBranch`(567-578) 用正则识别「分支已被别的 worktree 检出」（571-572，因 LC_ALL=C 输出为英文才可靠）；`listTags`(579-618) 单 spawn 列 tag + 一次 best-effort `ls-remote` 标记 pushed(604-606 注释：离线不得报「未推送」)；`mergeLocalBranch`(654-728) dryRun 用临时 detached worktree 探测(692-717)、正式冲突不 abort 留在 Local(718-727)；`snapshotAbandonedWorktree`(750-770) `add -A`+`write-tree`+显式身份 `commit-tree`(760-762)；`captureLocalWip`(729-737)/`applyWorktreePatch`(738-744)/`listWorktreeincludeFiles`(440-461, 两次 `ls-files --others --ignored` 求交，并自动带入 `AGENTS.override.md`，457-459) |

#### initial-commit.js

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `initialCommitActions()` | 7-133 | 返回 `{preflightInitialCommit, initializeEmptyRepository, initializeProject}`；只允许 Console 确认过的宿主动作调用(6 行注释) |
| `preflightInitialCommit`（内部） | 31-52 | unborn 仓库时枚举根目录文件（刻意忽略 ignore 规则，38-39 注释），空仓库计算含 `rootIdentity/gitIdentity/HEAD/index` 的 sha256 指纹(44-50) |
| `initializeEmptyRepository`（内部） | 53-113 | 三段式防竞态：前置 preflight → `index.lock` 独占创建(61-64, 注释 59-60「绝不删除非自己创建的锁」) → 复验指纹(65-67) → 校验 git 身份(69-73) → `mktree` 空 tree(74-75) → `commit-tree` → 再次 preflight(77-79) → `update-ref --stdin` 的 prepare 阶段持 HEAD 锁、`beforeCommit` 回调里第三次复验后才 commit(83-94)；`EEXIST` → `initialRepositoryBusy`(98-100)；finally 逆序清锁且不掩盖主错误(103-112) |
| `initializeProject`（内部） | 117-131 | 本地适配：非 Git/未出生仓库经用户显式确认后 `git init -b main`(123-124, 不写 config) + `add -A` + `commit`；已有提交历史拒绝(119-121)；失败不回滚任何字节(114-116 注释) |

#### registry.js — 原子 JSON 台账

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| 校验器族 | 14-324 | `emptyRegistry`(14-21)、`isOid`(28-30, 40/64 hex)、`isSafeRelativePath`(34-40)、`isTargetRef`(41-47)、`isSessionBinding`(48-58)、`isReview`(59-77)、`isPreviousReview`(78-86)、`isCheckpoint`(87-104)、`isPreviewReceipt`(105-125)、`isDeliveryProof`(126-138)、`isDelivery`(139-182, 按 7 个 state 分别校验)、`isJournal`(183-242, create 的 `creation.evidence` 结构校验含「旧 journal 永不获得删除权限」注释 195)、`isRecoveryContinuation`(256-282)、`isManagedCheckout`(283-314)、`isRegistry`(315-324) |
| `migrateLegacyRegistry()` | 325-378 | v1 → v2 保守迁移：非 ready/discarded 的 phase 一律 `recovery_required`(350-352)，revision 递增 |
| `AtomicJsonCheckoutRegistry` | 380-402 | `read()`(385-397)：先验 v2；失败尝试迁移并写回；文件不存在返回空台账；**损坏则 loud fail** 抛 `registry_corrupt`(396)。`write()`(398-401)：确保目录 + `writeJsonFileAtomic` |

#### safe-file.js — 崩溃安全 JSON 读写

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `RETRYABLE_RENAME_CODES` | 12-14 | Windows 额外含 `EPERM/EACCES` |
| `sleepSync()` | 15-23 | `Atomics.wait`，无 SharedArrayBuffer 时忙等回退 |
| `renameAtomicWithRetry()` | 25-41 | 指数退避重试 rename，保留原子语义 |
| `tmpPathFor()` | 46-48 | `<file>.<pid>.<uuid>.tmp`（固定 `.tmp` 会让并发写者互踩，42-45 注释） |
| `listTmpFiles()` / `cleanupTmpFiles()` | 50-64 / 65-72 | 按 mtime 新→旧列残留 |
| `writeJsonFileAtomic()` | 79-95 | 备份 `.bak`(83-90) → 写唯一 tmp → 原子 rename；**无跨进程锁**（76-78 ponytail 注释，last-writer-wins） |
| `writeTextFileAtomic()` | 97-101 | 同协议的文本版 |
| `readJsonFileSafe()` | 106-154 | 主文件 → 最新可解析 `.tmp` 提升并清理(121-135) → `.bak` 恢复(138-152, 跳过备份避免用坏主文件覆盖好 .bak)；全失败返回 null 由上层从 JSONL 重建(153) |

#### lookup.js / working-directory.js — 宿主服务适配

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `createDshLookupPort()` | lookup.js 33-134 | 动态 `ctx.get('workspaceRegistry')`/`ctx.get('sessions')`（结构性守卫 14-24）；`liveHeaderCwd`(49-52)；端口方法：`getSidebarMemberships`(54-74, 查 header 而非转录体，59-60 注释)、`listLiveSessions`(75-102, 未知投影降级为空表)、`getSession`(103-120, workspace 扫描 + 不可变 header cwd 的**唯一匹配**恢复分支 110-119)、`getSessionCwd`(121-126, owner 会话的真实 cwd 是 worktree 根)、`getProject`(127-132)；缺失服务降级为 `undefined`，状态机视为恢复/orphan 事实 |
| `sameResolvedPath()` | lookup.js 25-31 | Windows 大小写不敏感 |
| `createSessionWorkingDirectoryPort()` | working-directory.js 28-75 | 封装宿主 `workingDirectory` 服务：`current`(38-49, get 失败返回 undefined)、`enter`(50-57, **无服务/无 agent 时返回 undefined 而非谎报 path**，52-54 注释)、`leave`(58-73, 仅当会话当前 cwd 在 path 内才切回 fallback) |
| `isWithin()` | working-directory.js 77-85 | 跨平台路径包含判断 |

#### project-skills 三件套

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `PROJECT_SKILL_ROOTS` | project-skills.js 6 | `['.dsh/skills','.agents/skills','.claude/skills']` |
| `safePath()` | project-skills.js 12-17 | 三根之一且每段无 `.`/`..`/反斜杠/控制符；根本身可为 tracked 文件(13-14 注释) |
| `identity()` | 18-23 | 目录身份三元组（必须是真目录） |
| `inspectPath()` | 25-41 | 逐段 lstat，链接/特殊文件即失败 |
| `boundedRead()` | 42-66 | `O_NOFOLLOW` 读 + 读前后 stat/ino/dev 一致性校验(56-60) |
| `assertSkillTree()` | 67-80 | 全树巡检（≤10000 节点、深度 ≤64） |
| `inventory()` | 84-115 | 快照收集（`MAX_FILES=5000`、`MAX_BYTES=64MB`，7-8 行；空目录记录进 `emptyDirectories`） |
| `ProjectSkillStore` | 117-258 | 方法全表：`constructor(directory)`(119-121)；`file(root)`(122, `<sha256(resolve(root))>.json`)；`snapshot(source)`(123-126)；`load(root)`(127-150, 2MB 上限、校验 version/root/identity/phase/files 全集与去重)；`carry(snapshot,target)`(151-206, 冲突预检先行(160 注释)→`wx` 独占发布 copying 清单(188-192)→创建目录/文件→回读哈希校验(195-199)→`ready` 原子 rename(202-205))；`scope(root)`(207-210)；`paths(root)`(211)；`state(root,tracked)`(212-244, 计算指纹 + modified)；`assertRemovable(root,tracked)`(245-256)；`forget(root)`(257) |
| `trackedSkillPaths()` | 259-267 | 从 `ls-files --stage -z` + `ls-tree` 提取 tracked 路径集合 |
| `hasDeliverableStatus()` | 269-282 | 只有 `??` 记录且路径属于携带 Skills 才不算 dirty（268 注释） |
| `assertSkillPath()` | 283-286 | 单路径安全断言 |
| `readSkillFiles()/createSkillDirectories()/createSkillFiles()` | project-skill-io.js 37-69 / 70-77 / 78-95 | 读取带每文件限额与剩余 64MB 总量预算(39)、`O_NOFOLLOW`+ino/dev 校验(43-49)；创建走 `O_WRONLY\|O_CREAT\|O_EXCL\|O_NOFOLLOW`(82) + chmod + fsync + 写后复验(91-93)；路径白名单 `.dsh/.agents/.claude → skills`(14) |
| `managedSkillRoot()` | project-skill-provider.js 15-45 | 从 registry 的 `ready` 记录反查 cwd 所属 managed root；`.git` 指针与反向 `gitdir` 回链双向验证(25-40)，任一不符返回 null（信任链） |
| `ClaudeProjectSkillProvider` | project-skill-provider.js 47-132 | 额外的 `.claude/skills` 项目 Skill 源：`run()` 串行化(55-59)；`provider(root)` LRU≤32 缓存 `FileSystemSkillProvider`(65-80)；`list/listNow`(81-103, 每个候选 `assertSkillPath` 校验后 `rank:250, source:'project-claude'`)；`get/getNow`(104-119)；`observeHostMutation`(120-124)；`dispose`(125-131) |
| `mountProjectSkillProvider()` | 133-146 | 注入 `['skills']` 服务，注册 provider、监听 `fs/observed`、effect 卸载 |

#### worktree-creation.js — 创建安全链

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `createWorktree()` | 12-148 | 独占 `mkdir(target)` 声明所有权(42, 注释「已存在目录（含空）不属于本次尝试」) → 证据链 `evidence`（root/parent/commonDir 三重身份 + 随机 lockReason, 47-55）→ `git worktree add --detach --no-checkout --lock --reason`(49) → 记录 gitDir 身份与 metadataFingerprint(50-55) → `verifyIdentity`(57) → sparse 分支 `reset --hard`(70) 或 `read-tree` + index 指纹 + `checkout-index --all`(73-76, 注释「read-tree 先发布完整 index，checkout-index 无 -f 不覆盖他人文件」) → 复验 → `worktree unlock`(79)。失败路径：未注册时若能证明目录仍空且身份一致则 `rmdir` 并报可重试(85-110)；已注册且静默时**先转移 quarantine 再复验再删除**(113-145)；任何验证不确定 → `WorktreeCreationFailure(rolledBack:false)` 保留现场(146) |
| `verifyIdentity()` | 149-177 | `.git` 指针/gitdir 回链/commondir/HEAD/locked 全量校验；任何 `.lock` 残留即失败(175-176) |
| `verifyRollbackMetadata()` | 178-196 | metadata/index 指纹 + ORIG_HEAD 内容 |
| `metadataFingerprint()` | 197-228 | 白名单键遍历哈希；`index/gitdir/ORIG_HEAD` 语义单独校验(200-203)；未知对象、symlink、>1MB 文件即失败(210-223) |
| `verifyUnmodified()` | 229-320 | 完整 index 必须等于授权 base：submodule 拒绝(238-239)、未知目录/文件拒绝(250-264)、`check-attr` filter/working-tree-encoding 拒绝(265-272)、逐 blob 重算哈希(273-307)、staged/diff/unknown 三重零检查(308-319)——**语义比较不能授权删除**（240-241 注释） |

#### managed-worktree-path.js

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `sanitizeManagedWorktreeLabel()` | 12-25 | NFC、Windows 非法字符→`-`、压缩连字符、40 码点截断、保留名加 `_` |
| `createManagedWorktreeRepositoryKey()` | 33-35 | sha256(canonicalGitRoot) 前 12 hex |
| `sanitizeBranchSegment()` | 39-48 | 分支片段净化（保留 `-`/`_`/`.`/`/`） |
| `createSessionBranchCandidates()` | 55-64 | `feat/sess-<会话>[--主题]` + `-2..-n` 候选 |
| `createManagedWorktreeDirectoryName()` | 66-70 | `<repo>--<id8>--worktree` |
| `createTopicManagedWorktreeDirectoryName()` | 77-84 | `<topic>-<YYYYMMDD>[-<id>]` |
| `createTopicDateStamp()` | 86-91 | 本地 YYYYMMDD |
| `createManagedWorktreePathCandidates()` | 102-133 | 配置了 `worktreesRoot` 时两个容器都落到该根下（116-124）；否则兄弟目录 `<repo>--worktrees` + 状态目录回退(125-131) |

### 5. Host 控制台

#### lib/console-host/errors.js
- `domainError()` 3-5：Error + `code`（+可选 `continuation`）。
- `consoleFailure()` 6-32：领域错误 → 结构化 outcome；**非领域错误原样透出 message**（21-24 ponytail 注释：本地控制台刻意如此，远程序列化前须截断/替换）。
- `failure()` 33-43 / `outcome()` 44-51：outcome 包装器。

#### lib/console-host/projection.js

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `review(record)` / `commitOid(record)` / `deliveryProof(record,observed)` / `iteration(record)` | 5-21 / 22-24 / 25-43 / 44-46 | 评审/提交/交付证明投影（无 observed proof 时 `commitInLocalHistory:null`，41 行） |
| `capabilities()` | 47-85 | 16 能力位；`create:false` 恒定(64)；`returnToLocal` 仅 owner 且已交付(78-83)；linkedRead 时 open 需 owner 存活(64) |
| `fallbackOid()` | 86-90 | proof.localHeadAfter → commitOid → applyBaseOid → baseOid |
| `sourceBranchFromRef()` | 91-93 | `refs/heads/` 剥离 |
| `projectRecord()` | 94-152 | Summary 投影；`sourceBranch` 用 `sessionBranch ?? sourceRef`（113-117 注释：session 分支优先，避免把「碰巧从其分叉的 Local 分支」当作归属）；retained 态带 `retention/retainedAt/expiresAt`(118-122)；`cleanupMessage` 经 `hostPersistedCleanupMessage` 本地化(123-125)；preview_detached 带 `previewRecovery`(142-149) |
| `projectDetails()` | 153-221 | Details 投影；`currentBranch = settledLocalBranch ?? snapshot.branch ?? sessionBranch`（165-177 注释：已交付 owner 回到 Local 后胶囊必须显示真实所在分支）；owner 且非 linkedRead 时携带四种 `recoveryContinuation` 投影(178-219) |
| `projectLocal()` | 222-260 | Local 目标投影；`capabilities.create` 仅当非 `unversioned`(238)；其余全部 false(245-254) |

#### lib/console-host/control-plane.js（1366 行）

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `recordOf()` / `sidebarTaskState()` / `readyReview()` / `previewReview()` | 9-14 / 15-32 / 33-38 / 39-45 | 记录取用与状态判定（交付优先，16-18 注释） |
| `applyConflictContinuation()` | 56-76 | 把冲突结果固化为 `worktree_apply_conflict` continuation（requestId 形如 `apply-conflict:<checkoutId>:<reviewId>:<rev>:<oid>`，69 行） |
| `preflightFailure()` | 77-91 | blocked 原因 → 错误码映射 |
| `createWorktreeConsoleControlPlane()` | 92-1366 | 返回约 36 个 RPC 实现。内部工具：`unboundLocalTarget`(94-118)、`callerTarget`(119-129, `target_unselected` 时降级为 Local 投影)、`verifyCallerRoot`(130-206, owner 活 cwd/交付后 Local 边界/项目根三段授权，含 realpath 记忆化 152-162 与「交付 settled 且 Local 根已消失」特例 185-189)、`authorize`(207-227)、`linkedReadAccess`(228-277, 验收槽位持有者经锚定 checkout 的精确复核 258-275)、`observe`(278-292) 与 `observeFromCaller`(314-335, 复用 caller 已付的 triple-spawn 观察，296-313 注释)、`settledLocalBranch`(361-387)、`acceptanceHolder`(391-400)、`projectReviewSlot`(401-419)、`withCreation`(505-526, session+canonical root 双键互斥)、`createTarget`(527-541)。RPC 端点：`sidebarTopology`(543-602, 含 memberships 与 badge 清除逻辑 562-569)、`current`(603-610)、`gitOverview`(611-625)、`gitGraph`(626-632)、`gitCreateBranch`(633-639)、`gitSwitchBranch`(640-656, 交付中禁止切分支 642-651)、`gitPruneMergedBranches`(657-659)、`gitListTags`(660-668)、`gitCreateTag`(669-682)、`gitDeleteTag`(683-699, **先删 remote 再删 local**，686-687 注释)、`gitPushTag`(700-710)、`listAbandoned`(711-713)、`restoreAbandoned`(714-718)、`list`(719-797, 批量观察 749-757 与降级观察 771-778)、`preflightCreate`(798-817, empty→单次确认 token，确认表容量 500/5 分钟过期 810-813)、`createWithInitialCommit`(818-837)、`create`(838)、`initProject`(839-844)、`inspect`(845)、`reviewDiff`(846-889, diff 前后双 preflight 856-881)、`preflight`(890-903)、`previewRecoveryPreflight`(904-919)、`preparePreviewRecoveryAnalysis`(920-943)、`createPreviewRecoveryHandoff`(944-977)、`checkpoint`(978-1007)、`preview`(1008-1031, 冲突→`apply_conflict`+continuation 1022-1024)、`resumeRevision`(1032-1086, 冲突恢复 CAS 1041-1073)、`prepareReviewRegeneration`(1087-1108)、`rollbackPreview`(1109-1129)、`discard`(1130-1160, source 会话且 owner 缺席的清理通道 1150-1158)、`finalize`(1161-1201)、`finalizePreview`(1202-1248)、`setRetention`(1249-1258)、`setPermanent`(1259-1268)、`retryCleanup`(1269-1277)、`clearSidebarBadge`(1278-1290, 仅终态)、`beginNextIteration`(1291-1330, lineage/cwd 双重身份校验 1316-1321)、`returnToLocal`(1341-1364, 仅已交付记录；幂等——已解绑时返回 Local 投影 1353-1358；设计动机注释 1331-1340) |

#### lib/console-host/review-diff.js

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| 常量 | 7-9 | `REVIEW_DIFF_MAX_FILES=200`、`REVIEW_DIFF_MAX_PATCH_BYTES=100KB`、`REVIEW_DIFF_MAX_PAYLOAD_BYTES=1MB` |
| `ReviewDiffStaleError` | 10-15 | diff 与快照失配 |
| `git()` | 16-51 | 直 spawn（非 subprocess 端口），输出超限置 `truncated` |
| `projectPath()` | 52-57 | 项目相对路径白名单校验 |
| `utf8Prefix()` | 58-66 | UTF-8 边界安全截断 |
| `parseNameStatus()` | 70-94 | R/C 折叠为 renamed（79-80 ponytail 注释） |
| `createGitWorktreeReviewDiffReader()` | 101-211 | 临时 index + 独立 objects 目录（`GIT_OBJECT_DIRECTORY`+alternates, 111-118）重放 base，剔除携带 Skills(121-139)，diff 后逐文件批并行取证（`REVIEW_DIFF_BATCH_SIZE=8`，157-171），1MB payload 预算内逐个裁剪(180-202)；`ReviewDiffStaleError` 当 changedFiles 与快照失配(149-151) |

#### lib/console-host/service.js — Typert RPC 服务

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `WorktreeConsoleService` | 40-315（export 316） | 继承 `TypertRemoteService`，`super(hostContext,'gitWorktree')`(160)；全部方法 `@Remote` 装饰（81-150 的降级装饰器样板）。方法全表：`constructor`(157-165, `diagFile` 与 `officialWorkspaceActive`)、`appendDiag`(167-174, ndjson best-effort)、`sidebarTopology`(175-187, 注入 `workspaceClientFlavor`+`officialWorkspaceActive` 并写诊断)、`clientBootReport`(188-191)、`current`(192-205, 计时诊断)、`list`(206-208)、`preflightCreate`(209-211)、`createWithInitialCommit`(212-214)、`create`(215-217)、`initProject`(218-220)、`inspect`(221-223)、`reviewDiff`(224-226)、`preflight`(227-229)、`previewRecoveryPreflight`(230-234)、`preparePreviewRecoveryAnalysis`(235-239)、`createPreviewRecoveryHandoff`(240-244)、`preview`(245-247)、`checkpoint`(248-252)、`prepareReviewRegeneration`(253-255)、`resumeRevision`(256-260)、`rollbackPreview`(261-263)、`discard`(264-266)、`finalize`(267-269)、`finalizePreview`(270-274)、`setRetention`(275-277)、`setPermanent`(278-280)、`retryCleanup`(281-283)、`beginNextIteration`(284-286)、`returnToLocal`(287-289)、`clearSidebarBadge`(290-292)、`gitOverview`(293-295)、`gitGraph`(296-298)、`gitCreateBranch`(299-301)、`gitSwitchBranch`(302-304)、`gitPruneMergedBranches`(305-307)、`listAbandoned`(308-310)、`restoreAbandoned`(311-313)。除前三个外均为 `withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? hostContext), () => controlPlane.<op>(agent.id, ...))` 直通 |

#### lib/console-remote/schemas.js / descriptors.js

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| 基础 schema | schemas.js 5-26 | `sessionIdSchema/checkoutIdSchema/reviewIdSchema/commitMessageSchema/revisionSchema/gitOidSchema(40\|64 hex)/oidSchema(unversioned\|unborn\|oid)/previewIdSchema/generationSchema(64 hex)/requestIdSchema/branchNameSchema(19-21)/retentionSchema/retainedModeSchema` |
| `capabilitiesSchema` | 54-76 | `returnToLocal: z.boolean().default(false)`（70-75 注释：**新增能力位必须容忍缺失**——旧 Host 不认识该键，必填会让整条 `current` 塌成「不可用」） |
| `targetSummarySchema` / `targetDetailsSchema` | 92-125 / 174-180 | 全部 strict object |
| `consoleErrorSchema` | 187-196 | `continuation` 仅 `apply_conflict` 可携带(192-195 superRefine) |
| `outcomeSchema()` | 197-202 | `ok:true/false` 判别联合 |
| preflight / recovery 系列 | 256-344 | `preflightSchema`(ready/local_advanced/already_in_local/conflict/blocked)、`previewRecoveryProofSchema`(311-328, rollback/finalize 各 safe\|blocked)、`previewRecoveryPreflightSchema`(329-341) |
| git / tag / abandoned 系列 | 351-425 | `gitOverviewResponseSchema/gitGraphResponseSchema(max 1000 commits)/gitPruneResponseSchema/gitTagSchema(pushed 可 null, 400-401 注释)/abandonedSnapshotSchema/restoreAbandonedResponseSchema` |
| `strictCodec()` | descriptors.js 7-11 | `mode:'strict'` + 惰性 `create()`（DSH 0.2）+ 旧 `schema` 字段兼容(8-9 注释) |
| `agentParameter` / `json()` / `descriptor()` | 12-27 / 19-27 / 28-38 | agentId 走 lookup wire；每个方法 = `gitWorktree/<method>` + 参数 codecs + 严格结果 codec |
| `WORKTREE_CONSOLE_DESCRIPTORS` | 39-191 | 全部 36 个方法的描述符表 |
| `WORKTREE_CONSOLE_REMOTE` | 192-195 | `{package:'dsh-git-worktree', descriptors}` |

#### lib/i18n/*

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `normalizeLanguage()` | core.js 1-3 | `/^en(-|$)/i → 'en'`，否则 `'zh'` |
| `createTranslator()` | core.js 4-9 | `{key}` 插值，缺参保留原样 |
| `hostMessages` | host-messages.js 2-1752 | 约 470 条双语宿主文案（键稳定，用户数据只走插值，1 行注释） |
| `hostRegistrationMessage()` | host-messages.js 1754-1756 | 注册元数据 `zh + ' / ' + en` |
| `persistedCleanupKeys` / `hostPersistedCleanupMessage()` | 1762 / 1763-1766 | **按精确中文串匹配**历史持久化的 cleanup 消息再本地化；文案不可改（1757-1761 注释） |
| AsyncLocalStorage 语言栈 | host.js 5-33 | `currentHostLanguage`(6-8)、`withHostLanguage`(9-11)、`languageFromSettings`(13-24, 只读 settings seam)、`languageForInvocation`(26-29)、`hostMessage`(30-33) |

### 6. 模型与命令表面

#### lib/tools.js

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `parseWorktreeRetention()` | 7-14 | 枚举校验，缺省 `DEFAULT_WORKTREE_RETENTION` |
| `sessionIdOf()` | 15-21 | `agent.session.id` 守卫 |
| `renderJson()` | 23-25 | 模型与 ToolView 共用的规范化 JSON 输出 |
| `leaveCheckoutBeforeRemoval()` | 32-44 | 删除类操作前恢复 cwd；**失败返回原因，调用方必须中止删除**（27-31 注释） |
| `enterCheckout()` | 53-65 | 优先从台账 `resolveRoots` 取根（49-52 注释：验证路径可能把会话困在 Worktree 外） |
| `registerTools()` | 67-655 | 注册 9 个工具：`worktree_create`(73-135, in-place：`targetSessionId=sourceSessionId`，107-108 注释必须传 createOptions 才触发 local→isolated 升级；输出含 `cwdSelected`)、`worktree_list`(136-192)、`worktree_resume_revision`(193-234, Ready→Working 自动恢复编辑)、`worktree_begin_next_iteration`(235-278)、`worktree_ready_for_review`(279-364, 隔离会话的最终模型动作，参数 summary/details/validationStatus/tests/suggestedCommitMessage)、`worktree_deliver`(365-467, **`isAutoDeliverEnabled()` 为 false 时直接拒绝**，411-413；Ready 态缺省用 `suggestedCommitMessage`(420-424)；先 leave 再 finish，失败重新 enter(443-447))、`worktree_cleanup`(468-520)、`worktree_prune_branches`(521-589)、`worktree_merge`(590-654, forward/reverse) |

#### lib/commands.js — `/worktree` 命令

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `targetText()` / `finishedText()` | 6-15 / 24-30 | status 输出与 finish 结果文案（含 autoPush 附加信息） |
| `RETENTIONS` / `usage()` | 22 / 23 | 合法保留值集合 / 用法串 |
| `registerWorktreeCommand()` | 32-223 | 内部 `leaveCheckout`(39-51) 与 `enterCheckout`(52-64)；子命令：`status`(76-78)、`list`(79-87)、`continue`(88-96)、`next`(97-107, 重建后重新 enter cwd)、`finalize [reviewId rev] [retention]`(108-146, 验收卡过期校验 120-123)、`finish <message>`(147-170)、`discard`(171-192)、`remove <checkoutId>`(193-213)、default 报用法(214-215)。所有删除类动作先 `leaveCheckout`，失败即中止(125-127、153-155、174-176、202-204) |

### 7. 浏览器 Client

#### client 根

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `WORKTREE_CONSOLE_ADAPTER_SERVICE` | index.js 13 | `'worktreeConsole'` |
| `inject` | index.js 15 | `['slots','workspaces','sessions','conversation','connection','locale']` |
| `servicesOf()` | index.js 16-24 | 从 ctx 收集 UI 服务（含可选 `uiWorkspace`） |
| `apply()` | index.js 26-67 | 用 Proxy 包装 `ctx.slots.register` 使每个注册组件自动包 `ClientI18nProvider`(30-36)；注入样式 `<style>`（自标 `data-plugin`，44-45 注释解释 claimStyles 所有权问题）；注册两个 ToolView：`worktree_create`→`WorktreeCreateRow`(57)、`worktree_ready_for_review`→`WorktreeReviewRow`(58)；有 adapter 时再挂 `registerTargetConsole`(61) 与 `registerPreSessionWorktree`(65) |
| `parseCreateTool()` / `parseReviewTool()` / `reviewArgs()` 等 | model.js 35-54 / 91-126 / 55-90 | 从**已记录的** tool call/result 切片重建纯模型（`ToolLifecycle: running/ok/error/stopped`，65 行注释） |
| `readClientLanguage()` 等 | i18n.js 12-20 / 21-24 / 26-33 / 34-38 / 40-42 | `ClientI18nProvider`+`useSyncExternalStore` 读取宿主 locale；`translatorForServices` 调用时解析 |
| `navigateToSession()/selectedSessionId()/openExistingSession()/waitForProjectedSessionPath()/openIsolatedTarget()/openAuthorizedWorktreeTarget()/prefillSessionDraft()/finalizeCurrentSession()` | actions.js 11-18 / 20-29 / 31-37 / 38-78 / 80-111 / 116-139 / 141-147 / 149-162 | 导航优先 `uiWorkspace.openSession`，回退 `sessions.open`，都没有则抛错(17)；`openIsolatedTarget` 幂等注册 workspace→create session→2s 内等待投影 cwd 匹配→导航(80-111)；`finalizeCurrentSession` 以显式命令 `/worktree finalize <reviewId> <rev> <retention>` 提交(157) |
| `WorktreeCreateRow` | WorktreeCreateRow.js 7-41 | 创建结果卡片：checkoutId/base/workspace 路径打开按钮 + 「打开隔离会话」按钮（含 mounting 守卫 12-16） |
| `WorktreeReviewRow` | WorktreeReviewRow.js 13-91 | 评审卡宿主行：本地 evidence(22-34) + `adapter.current` 活目标(54-77) + `WORKTREE_REVIEW_REFRESH_EVENT` 刷新(39-49)；`target_unselected` 错误整卡隐藏(78-79) |

#### client/console-remote

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `FAST_TIMEOUT_MS` / `SLOW_TIMEOUT_MS` | adapter.js 27 / 28 | 30s / 180s（21-26 注释：Web RPC carrier 无超时，客户端兜底；服务端继续跑、变更加安全可重试） |
| `FAST_METHODS` | adapter.js 31-36 | sidebarTopology/current/inspect/previewRecoveryPreflight/gitOverview/gitGraph/listAbandoned |
| `createWorktreeConsoleRemoteAdapter()` | adapter.js 49-128 | `invoke(method, call)`：竞速超时(57-62) → codec 拒绝识别 `malformed_response`(17-20) → strict zod 解析(76-84)；返回 35 个方法映射(86-127) |
| `inject` / `apply()` | console-remote/index.js 40-44 / 46-180 | inject 过滤 `remote.directoryPicker`/`remoteAccess`（13-39 注释详述三个宿主代际的启动死锁/14 entries did not activate 事故）；apply：`remote.$mount(contribution)`(48) → `provide('worktreeConsole')`(57) → `mountSettingsCard`(58) → `sidebarTopology` 探测 flavor(84-92) → 按 `legacy`(93-101)/`modern`(102-138)/`alpha\|next`(139-174)/其他(175-179) 分支选择 `registerManagedWorkspaceSidebar` 或 `registerDecoratedWorkspaceSidebar`（`officialWorkspaceActive===true` 时走 decorate，146-153 注释）→ `reportBoot`(69-83) 向宿主上报分支与耗时 |

#### client/review-console

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `createRequestCache()` | request-cache.js 11-104 | ponytail 注释（2-10）：每 adapter 一个 WeakMap、单飞 read、generation 防失效后旧响应回写；`read/invalidate/useSnapshot` |
| `readReviewPreflight` 等 | preflight-cache.js 2-15 | identity 键 = sessionId+checkoutId+revision+reviewId |
| `readPreviewRecoveryPreflight` 等 | preview-recovery-cache.js 2-15 | +expectedPreviewId |
| `WORKTREE_REVIEW_REFRESH_EVENT` / `requestWorktreeReviewRefresh()` | status-events.js 1 / 3-5 | window CustomEvent 通知所有评审面重读 |
| `recovery-continuation.js` | 1-492 | 恢复请求队列：localStorage 持久化（`STORAGE_PREFIX='dsh-git-worktree:recovery:v1:'`，6 行；`persistSnapshot/readPersisted` 18-68）；`validRequest` 严格校验(88-117)；`attempt()`(222-325, 发送前**再次** inspect 并比对 `targetMatchesRequest`(142-171)，`sessionReady` 需主视图选中+cwd 匹配+会话 open(182-196))；导出 `buildWorktreeRecoveryPrompt`(326-334)、`enqueueWorktreeRecovery`(336-370)、`restoreWorktreeRecovery`(371-429, rebuilding runtime 时 sending 态报错)、`retryWorktreeRecovery`(430-441, cancelled 也可重发)、`get/subscribe/useWorktreeRecoverySnapshot`(442-458)、`cancelWorktreeRecovery`(460-467)、`detachWorktreeRecoveryRuntime`(469-478)、`clearWorktreeRecovery`(479-492) |
| `ReviewIcon` | ReviewIcon.js 3-14 | lucide 图标映射 |
| `WorktreeReviewPanel` / `reviewIsStale()` | WorktreeReviewPanel.js 33-42 / 21-32 | 紧凑评审卡；stale 判定 = target 回到 working 或 revision/reviewId 失配 |
| `DeliveryProof` | DeliveryProof.js 17-34 | 交付证明卡/紧凑行 |
| `PreflightStatus` | PreflightStatus.js 16-40 | 只读同步预检状态 + 冲突恢复入口按钮(28) |
| `ReviewDetailsModal` | ReviewDetailsModal.js 21-65 | 详情模态（焦点陷阱 24-55、列表折叠 `COLLAPSED_LIST_LIMIT=5` 12 行） |
| `ReviewActions` | ReviewActions.js 42-892 | 评审动作中枢：`DEFAULT_RETAIN_ENVIRONMENT=true`(41)；内部操作函数 `previewLocal`(369-402)、`checkpoint`(410-449, requestId=`checkpoint:<generation>` 15-17)、`resumeRevision`(450-470)、`rollbackPreview`(471-537)、`submitCommit`(538-612, finish 前强制 preflight 546-560；finalize_preview 需 recoveryProof 562-591)、`discard`(613-637)、`startConflictRecovery`(197-282)、`startReviewRegeneration`(283-340)、`analyzeRecovery`(656-712) / `handoffRecovery`(713-774, 二次 inspect 验证后向 agent 发 prompt)、`retryCleanup`(775-794)、`openHolder`(795-815)；stale 错误分流(164-183) |
| `reviewEvidenceFromTarget()` / `reviewIdentityFromTarget()` | index.js 3-10 / 12-21 | target → evidence / CAS identity |

#### client/target-console

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `branch-overview-cache.js` | 1-85 | 模块级 60s TTL 缓存 + epoch 防飞行回写（8-11 注释）；导出 `cachedBranchOverview`(19-21)、`invalidateBranchOverview`(25-28)、`patchBranchOverview`(30-36)、`fetchOverview`(37-65)、`ensureBranchOverview`(71-76)、`refreshBranchOverviewInBackground`(78-85) |
| `current-polling.js` | 1-120 | `Poll` 类(15-103)：5s 轮询（`DELAY`=3 行），**隐藏文档降频到 60s**（4-10 注释：隐藏窗口轮询白白烧 git spawn）、`visibilitychange` 立即恢复(35-38)、最后一个订阅者释放时停止(52-64)；`subscribeCurrent()`(105-120) 按 adapter+sessionId+language 去重 |
| `mergeRefs()` / `computeGraphLanes()` | BranchGraphModal.js 9-28 / 36-106 | `foo`+`origin/foo` 合并徽章；GitHub 风格泳道拓扑（lane 复用、洞回收 40-67），`LANE_COLORS/LANE_WIDTH/ROW_HEIGHT` 等 107-112；`BranchGraphModal`(141-183, 分页 `INITIAL_LIMIT=200`/`PAGE_STEP=100`) |
| `TagManagerModal` | TagManagerModal.js 9-139 | 列表一次 RPC；**每次变更后重读列表**（4-7 注释）；`load` 不清 error 以免抹掉 push 失败提示（24-26 注释） |
| `TargetStatusAction` | TargetStatusAction.js 31-631 | 会话头目标胶囊：状态映射(14-26)、分支 chip 标签(133-135)、非 Git 仓库专属「初始化仓库」流（117-125 注释 + `initializeRepository` 246-280）、分支列表（搜索框超越 `MAX_BRANCH_ITEMS=12` 481-501）、切换成功用乐观补丁避免重取（178-197）、prune dry-run 预览(281-306)、discard/retryCleanup/beginNextIteration/returnToLocal 动作(340-437)、Graph/Tags/Manager 模态(622-630) |
| `WorktreeConsoleView` | WorktreeConsoleView.js 54-453 | 管理面板：`refresh` 并行三 RPC(93-129)、`applyMutation`(151-171)、`ATTENTION_RANK` 排序(40-52, 425-434)、创建目标并打开(193-252)、discard/重试清理/保留期/常驻标记(253-398)、放弃快照恢复条(371-398, 439-452 渲染) |
| `WorktreeHeroChip` | WorktreeHeroChip.js 70-124 | 空会话 hero 行胶囊：lazily `require('react-dom')` 探测 portal（5-21，失败则不渲染）、`findHeroRowFrom`(34-63) 结构优先 + MutationObserver + 4s 有界轮询兜底 |
| `WorktreeManagerModal` / `WorktreeReviewStatus` | WorktreeManagerModal.js 6-9 / WorktreeReviewStatus.js 13-107 | 管理入口模态；composer 上方紧凑交付 dock（独立恢复态渲染 63-65；终态可 dismiss，75-78；`renderStatus` 复用 ReviewActions） |
| `registerTargetConsole()` | index.js 6-26 | 三个 slot 注册：`conversation.session.header.actions`(10-15)、`conversation.input.dock`×2（review-status 16-20、hero-chip 21-25） |

#### client/pre-session

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `readHarnessInput()` / `adaptHarnessInputActions()` | harness-input.js 1-6 / 8-17 | 新旧宿主 composer API（`imageIds` vs `attachmentIds`）归一 |
| `PreSessionWorktreeController` | controller.js 32-188 | `prepare()` 单飞(40-50)；`run()`(51-153)：composer 阻断块(70)→`create/createWithInitialCommit`(78-80)→建 workspace/session(84-96)→`handoff`(98-117, **从最终源 CAS 到目标写入与源清空之间无 await**，106-108 注释；保留 agentPreset 67-68)→`using()` 持引用(121-126)→归档源会话(131-135)；失败走 `rollback()`(154-187, discard→幂等 archive→删 workspace)；token 单次使用（148-150 注释） |
| `PreSessionWorktreeToggle` | PreSessionWorktreeToggle.js 23-158 | 空会话「在 Worktree 中开始」开关：`scopeRef` 渲染期失效旧续体(34-40)、preflightCreate 三态确认模态(88-119)、Modal 确认(157) |
| `registerPreSessionWorktree()` | index.js 6-22 | slot `conversation.input.left`（order 40），composerPhase 推导(9-12) |

#### client/settings-card

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `settingsBooleanField()/settingsNumberField()/settingsTextField()` | form-model.js 27-42 / 49-63 / 70-79 | 草稿文本↔写入 的字段转换 |
| `SettingsFormModel` | form-model.js 87-263 | 方法全表：`constructor(scope,specs)`(100-104)；`bind(project)`(110-114)；`shell()`(119-130, available/writable/dirty/invalid/saving/failed)；`field(field)`(136-148)；`actions()`(153-169, edit/resetField/save/discard)；`save()`(178-200, revision 闸 `baseline?.revision`(187)，失败保留草稿)；`dispose()`(202)；私有 `plan/stage/spec/snapshotOf/sectionValue/baseValue/userLayer/stored/publish`(208-262)；设计动机注释（9-18：staged 编辑 vs 逐控件提交） |
| `WORKTREE_SETTINGS_NS` | worktree-settings-card.js 3 | `'dsh-git-worktree'` |
| `WorktreeSettingsCardController` | worktree-settings-card.js 4-31 | `constructor` 建 5 字段表单(8-14)；`projection()`(17-26)；`inject()`(27-29, face 含 `hooks.worktreeCard`)；`dispose()`(30) |
| `mountSettingsCard()` | index.js 17-39 | fail-soft 读 `configForms`/`slots`(21-24)；`whileServed` 期间注入 `plugins.bundle.config` slot(34-38)；`ctx.get` 是 fail-soft 读的注释(18-20) |
| `WorktreeSettingsCard` | WorktreeSettingsCard.js 99-136 | 内联样式的表单渲染（自包含原因见 2-7 注释：插件自带的 client-ui-primitives 早于共享 SettingsForm） |

## Architecture

```text
                ┌──────────────────────────────────────┐
                │  lib/index.js  apply() 插件装配入口    │
                └───────┬──────────────────┬───────────┘
                        ▼                  ▼
   ┌─────────────────────────────┐  ┌────────────────────────────────┐
   │ adapters/  端口适配层         │  │ 领域核心（host-agnostic）        │
   │  git.js ──► git 子进程       │─►│  session-checkout-apply.js 引擎  │
   │  files.js ─ 目录身份/隔离区   │  │  concurrent-session-guard.js    │
   │  registry.js ─ 原子 JSON     │  │  checkpoint.js  CAS generation  │
   │  lookup.js / working-dir.js  │  │  session-checkout-module.js *   │
   │  worktree-creation.js        │  └───────────────┬────────────────┘
   └─────────────────────────────┘                  ▼
   ┌───────────────────────────────────────────────────────────────┐
   │ 表面层: tools.js(模型工具) · commands.js(/worktree)             │
   │         console-host/service.js ◄─ control-plane.js ◄─ 投影    │
   └──────────────────────────┬────────────────────────────────────┘
                              │ Typert RPC（console-remote 严格 zod schema）
                              ▼
   ┌───────────────────────────────────────────────────────────────┐
   │ client/ 浏览器: console-remote/adapter.js ─► 各 UI 面板         │
   │   review-console · target-console · pre-session · settings-card│
   └───────────────────────────────────────────────────────────────┘
```

\* `lib/session-checkout-module.js` 是状态机本体，在 `lib/index.js:29` 导入、`158-173` 装配，但源码不在本文件集内（见 [[session-checkout-module]]）。

关键架构不变量（源码注释反复强调）：

1. **授权证据与导航数据分离**：`getSessionCwd`（ports.d.ts:32-40）单独存在，因为 owner 会话的活 cwd 是 worktree 根而非 Local 根；`control-plane.js` 的 `verifyCallerRoot`(130-206) 据此做三段授权。
2. **目录身份 = 删除授权**：删除 Worktree 残余必须由 `DirectoryIdentity`（device/inode/birthtimeNs）+ 指纹 + `verifyUnmodified` 共同证明，缺一即保留现场（worktree-creation.js:113-145、console-contract.js:79 的 `checkout_mismatch → open_recovery`）。
3. **交付不写 Local**：`commitIsolated`（apply.js:910-986）提交到会话分支，`worktree_merge` 是独立的一步；旧的写回 Local 路径（`finish`，1523-1705）仍被 Console 的 `finalize` 用于 Preview 提交流。
4. **能力位可增量**：`capabilitiesSchema.returnToLocal` 用 `default(false)`（schemas.js:70-75），客户端/宿主两份独立部署产物不会因新增键互崩。

## Data Flow

**Flow A：插件挂载**（lib/index.js:136-230）
`apply()` → `mountWorkspaceProviderLifecycle`(141) 决定 UI 接管态 → 建状态目录与空 hooks 目录(142-145) → 五个端口/存储就绪(152-157) → `createSessionCheckoutModule` 装配状态机(158-173) → `WorktreeConsoleService` 挂 RPC(174-181) → 三类表面注册(182-184) → `ready` 事件触发 `reconcile()` 恢复孤儿/需恢复记录(188-199) → 15 分钟保留期维护定时器 + 24h 自动 prune(200-223)。

**Flow B：模型创建 Worktree（worktree_create）**
`lib/tools.js:73-135` → `module.createIsolatedTarget`（状态机）→ `git.createDetachedWorktree`(git.js:325-336，先拒绝携带 Project Skills 本地改动) → `createWorktree`(worktree-creation.js:12-148)：独占 mkdir 声明 → `worktree add --detach --no-checkout --lock` → 三重身份证据 → read-tree/checkout-index → 双次 verifyIdentity → unlock；随后 `attachWorktreeBranch`(git.js:401-415) 以 CAS 建会话分支，`enterCheckout`(tools.js:53-65) 把会话 cwd 切进去；输出 `{kind:'worktree_target_created', checkoutId, cwdSelected, ...}` 供 `WorktreeCreateRow` 渲染。

**Flow C：评审与交付（模型路径）**
`worktree_ready_for_review`(tools.js:279-364) → 状态机固化 isolated 指纹 → `worktree_deliver`(365-467) 在 `autoDeliver` 开启时走 `operate({action:'finish'})` → 引擎 `commitIsolated`(apply.js:910-986) 把工作区提交到会话分支（**完全不读 Local**），之后 `pushBranch` best-effort 推送（git.js:416-433，绝不 force）、按 retention 清理冻结环境。

**Flow D：Console RPC（人工验收路径）**
浏览器 `createWorktreeConsoleRemoteAdapter`(adapter.js:49-128) 按 descriptors 严格 schema 发送 → `WorktreeConsoleService`（service.js，`agentId` 由 Gateway 解析）→ `control-plane`（control-plane.js:92-1366）`authorize` + `verifyCallerRoot` → `module.operate/inspect/...` → 引擎执行（Preview 写 Local 用 `preview`/`finalize`/`rollback`，全部走 index.lock CAS 与补偿回滚，apply.js:1316-1522）→ `projection.js` 投影为 path-free Summary/Details → 客户端 `ReviewActions`(ReviewActions.js) 驱动 UI，preflight 结果经 `request-cache.js` 单飞缓存。

**Flow E：恢复与放弃**
Preview 漂移 → `preview_detached` + `previewRecovery`；客户端 `usePreviewRecoveryPreflight` 评估出 `WorktreePreviewRecoveryProof`（types.d.ts:246-264，含 rollback/finalize 双结论与 generation）→ `analyzeRecovery`/`handoffRecovery`（ReviewActions.js:656-774）二次 inspect 验证后经 `prompt()` 向 agent 发只读恢复请求；冲突路径则 `resumeRevision` + `enqueueWorktreeRecovery`（recovery-continuation.js:336-370，localStorage 持久化、发送前完整身份复验）。带未提交内容放弃 → `snapshotAbandonedWorktree`(git.js:750-770) 固化为 `refs/dsh-worktree/abandoned/<checkoutId>`，之后 `restoreAbandoned`(771-779) 在 Local 重建分支。

## Connections

- [[session-checkout-module]] — 领域状态机本体；由 `lib/index.js:158-173` 装配，`lib/index.d.ts:72-161` 声明其完整接口（`inspect/bind/operate/...`）。
- [[session-checkout-apply]] — 即本文 `lib/session-checkout-apply.js`；`session-checkout-module` 通过 `lib/session-checkout-apply.d.ts:218-266` 的 `SessionCheckoutApplyEngine` 接口调用它。
- [[tools]] 与 [[commands]] — 模型工具与 `/worktree` 命令的注册面；两者都依赖 [[working-directory]] 适配器保证删除前 cwd 安全。
- [[console-contract]] — Host 与 Client 共享的 JSON 契约；`console-remote/descriptors.js` 与 `schemas.js` 是它的 wire 层。
- [[host-compat]] 与 [[workspace-provider-lifecycle]] — 宿主代际探测与 `uiWorkspace` 选举；结果经 `WorktreeConsoleService.sidebarTopology`（service.js:175-187）透传给 client 引导分支。
- [[project-skills]] — Project Skills 存储/IO/provider 三件套，被 git 端口（dirty 判定、评审剔除）、apply 引擎（指纹剔除）与 review-diff 读取。
- [[worktree-creation]] — 创建安全链；`SessionCheckoutGitPort.createDetachedWorktree`（ports.d.ts:110）与 `WorktreeCreationEvidence`（ports.d.ts:276-288）是它与领域层的接缝。
- [[registry]] / [[safe-file]] — 持久化底座；`ManagedCheckoutsRegistry`（ports.d.ts:526-531）是全部状态的唯一事实源。
- [[concurrent-session-guard]] — `session-target-context.js:12-19` 的后台刷新为它喂数据，`runtimeContext` 同步消费。
- [[i18n]] — `hostMessage` 被所有宿主侧文件引用；客户端使用 `client/i18n.js` 的独立 React 栈。

## Known Issues

1. **safe-file 无跨进程锁**：`lib/adapters/safe-file.js:76-78`（ponytail 注释）——唯一 tmp + 原子 rename 消除了互踩与半写提升，但文件级 last-writer-wins 仍在，需要强一致时要再引入 lock 文件。
2. **本地控制台错误文本泄露上限**：`lib/console-host/errors.js:21-24`——非领域错误原样透出第三方 message（仅本地 UI；远程序列化 WorktreeConsoleError 前必须截断/替换）。
3. **Web RPC 无服务端超时**：`lib/client/console-remote/adapter.js:21-28`——handler 卡死会永久 pending，客户端用 30s/180s 兜底失败；服务端工作继续，变更加安全重试。
4. **plans map 单槽**：`lib/session-checkout-apply.js:1053-1059`——同一 isolated checkout 的新 plan 会顶替旧 plan；重复 `calculatePlan` 不会泄漏，但旧 revision 立即失效。
5. **样式所有权需自标**：`lib/client/index.js:44-45`——client-module 系统会认领任何无 `data-plugin` 的 `<style>`，故样式表必须带本 bundle 的注册 id。
6. **hero chip 依赖 react-dom 探测**：`lib/client/target-console/WorktreeHeroChip.js:9-20`——`require('react-dom')` 失败时整个 hero 胶囊静默不渲染（降级而非报错）。
7. **Loader 1.0.6 fiber 保留问题**：`lib/workspace-provider-lifecycle.js:116-132` 与 `231-242`——`update()` 不等待 dispose 且保留死 fiber，`fiber.await()` 会在保留迁移上自旋；disable 必须显式等旧 fiber，restore 必须按状态 `init()`，卸载需等离开 UNLOADING 再 withdraw `entry.fiber`。
8. **cleanup 消息靠精确字符串匹配**：`lib/i18n/host-messages.js:1762-1766`——`hostPersistedCleanupMessage` 用精确 zh 串识别历史持久化消息；修改这些 zh 文案会破坏恢复判别。
9. **切换分支冲突识别靠 stderr 正则**：`lib/adapters/git.js:571-572`——匹配 `is already used by|already checked out at`；可靠性依赖同文件 111 行的 `LC_ALL=C`。
10. **确认 token 单次使用**：`lib/client/pre-session/controller.js:148-150`——即使只有客户端 handoff 失败，初始提交确认 token 也作废，需重新走 preflight。
11. **settings 表单为并行维护的裁剪副本**：`lib/client/settings-card/form-model.js:4-7`——从宿主 0.1.7-rc.2 的 settings-form 模型裁剪而来，与上游可能漂移。
12. **takeover 默认关闭**：`lib/index.js:110`（`enableWorkspaceProvider` 默认 false）与 `lib/workspace-provider-lifecycle.js:45-62`——takeover 会把官方 ui-workspace 条目从宿主 client graph 中移除，影响所有导入它的包，因此 legacy 宿主仅 opt-in；modern 0.2.x 宿主上 decorate 路径结构性崩溃，takeover 实际是必须的（flag 在那里只是 advisory，见同文件 46-51 注释）。
13. **预检确认表硬编码上限**：`lib/console-host/control-plane.js:810-813`——确认 token 表最多 500 条、5 分钟过期，超限删除最旧条目（FIFO，非 LRU）。
