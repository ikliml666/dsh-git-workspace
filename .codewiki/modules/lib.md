---
title: lib
type: module
source_files:
  - lib/index.js
  - lib/ports.js
  - lib/ports.d.ts
  - lib/types.d.ts
  - lib/adapters/files.js
  - lib/adapters/git-options.js
  - lib/adapters/git.js
  - lib/adapters/git.d.ts
  - lib/adapters/initial-commit.js
  - lib/adapters/lookup.js
  - lib/adapters/project-skill-io.js
  - lib/adapters/project-skill-provider.js
  - lib/adapters/project-skills.js
  - lib/adapters/registry.js
  - lib/adapters/safe-file.js
  - lib/adapters/working-directory.js
  - lib/adapters/worktree-creation.js
  - lib/checkpoint.js
  - lib/commit-message.js
  - lib/concurrent-session-guard.js
  - lib/console-contract.js
  - lib/console-contract.d.ts
  - lib/console-host/control-plane.js
  - lib/console-host/errors.js
  - lib/console-host/projection.js
  - lib/console-host/review-diff.js
  - lib/console-host/service.js
  - lib/console-remote/descriptors.js
  - lib/console-remote/schemas.js
  - lib/creation-failure.js
  - lib/delivery-excludes.js
  - lib/host-compat.js
  - lib/i18n/core.js
  - lib/i18n/host.js
  - lib/i18n/host-messages.js
  - lib/managed-worktree-path.js
  - lib/session-checkout-apply.js
  - lib/session-target-context.js
  - lib/tools.js
  - lib/commands.js
  - lib/workspace-provider-lifecycle.js
  - lib/client/index.js
  - lib/client/i18n.js
  - lib/client/model.js
  - lib/client/actions.js
  - lib/client/WorktreeCreateRow.js
  - lib/client/WorktreeReviewRow.js
  - lib/client/console-remote/adapter.js
  - lib/client/console-remote/index.js
  - lib/client/pre-session/controller.js
  - lib/client/pre-session/PreSessionWorktreeToggle.js
  - lib/client/pre-session/harness-input.js
  - lib/client/pre-session/index.js
  - lib/client/review-console/DeliveryProof.js
  - lib/client/review-console/PreflightStatus.js
  - lib/client/review-console/ReviewActions.js
  - lib/client/review-console/ReviewDetailsModal.js
  - lib/client/review-console/ReviewIcon.js
  - lib/client/review-console/WorktreeReviewPanel.js
  - lib/client/review-console/index.js
  - lib/client/review-console/preflight-cache.js
  - lib/client/review-console/preview-recovery-cache.js
  - lib/client/review-console/recovery-continuation.js
  - lib/client/review-console/request-cache.js
  - lib/client/review-console/status-events.js
  - lib/client/settings-card/WorktreeSettingsCard.js
  - lib/client/settings-card/form-model.js
  - lib/client/settings-card/index.js
  - lib/client/settings-card/worktree-settings-card.js
  - lib/client/target-console/BranchGraphModal.js
  - lib/client/target-console/TagManagerModal.js
  - lib/client/target-console/TargetStatusAction.js
  - lib/client/target-console/WorktreeConsoleView.js
  - lib/client/target-console/WorktreeHeroChip.js
  - lib/client/target-console/WorktreeManagerModal.js
  - lib/client/target-console/WorktreeReviewStatus.js
  - lib/client/target-console/branch-overview-cache.js
  - lib/client/target-console/current-polling.js
  - lib/client/target-console/index.js
  - lib/client/workspace-sidebar/index.js
  - lib/client/workspace-sidebar/model.js
tags: [dsh-git-worktree, git-worktree, plugin, adapters, session-checkout, console, react-client]
---

## Overview

`lib/` 是 `dsh-git-worktree` 插件（会话级托管 Git Worktree）的全部运行时代码。它把「一个 Agent 会话在一个隔离的受管 worktree 里干活、评审、再交付回仓库」这条链路拆成五层：

1. **端口层**（`lib/ports.js` / `lib/ports.d.ts` / `lib/types.d.ts`）：定义 `SessionCheckoutGitPort`、`SessionCheckoutFilesPort`、`SessionCheckoutLookupPort`、`SessionCheckoutRegistryPort` 等宿主无关接口，以及稳定错误码 `SESSION_CHECKOUT_ERROR_CODES`（`lib/types.d.ts:499`）。
2. **适配器层**（`lib/adapters/`）：用 Node fs、`ctx.subprocess`、宿主 `workspaceRegistry`/`sessions`/`workingDirectory` 服务实现上述端口；含崩溃安全的注册表存储与 Project Skills 搬运。
3. **领域引擎**（`lib/session-checkout-apply.js`）：`DefaultSessionCheckoutApplyEngine` 实现快照指纹、三方合并、Local 预览/回滚/终审、checkpoint、以及「会话分支交付」`commitIsolated`。
4. **服务面**：模型工具（`lib/tools.js`）、`/worktree` 命令（`lib/commands.js`）、运行时上下文（`lib/session-target-context.js`）、Worktree Console 的宿主 RPC（`lib/console-host/`）与 strict zod 描述符（`lib/console-remote/`）。
5. **浏览器客户端**（`lib/client/`）：React ToolView、评审控制台、目标胶囊、空白会话预创建、侧栏投影与设置页。

所有用户可见文案经 `lib/i18n/`（`hostMessage`/`withHostLanguage`，按调用现场语言解析）；宿主代际探测在 `lib/host-compat.js`；官方 Workspace 接管选举在 `lib/workspace-provider-lifecycle.js`。

> 注意：状态机模块工厂 `createSessionCheckoutModule` 来自 `./session-checkout-module.js`（`lib/index.js:29` 引入），该文件源码不在本文清单内——本文覆盖其全部依赖与外围。

## Key Components

### 插件入口 `lib/index.js`

| 成员 | 行号 | 用途 |
| --- | --- | --- |
| `SessionCheckoutError` | 4-15 | 领域错误类；字段 `code`（稳定错误码）与继承的 `message`；构造器 10-14 置 `name='SessionCheckoutError'` |
| `inject` | 46 | 插件注入清单 `{ tools:{}, commands:{}, subprocess:{}, loader:{await:false} }`；**必须具名导出**，否则首次 `ctx.tools` 访问抛 "cannot get property without inject"（原因见 40-45 注释） |
| `volatile(schema)` | 48-52 | 给 schemastery 字段打 `meta.volatile`：设置页编辑写 `cordis.patch.yml` 不重挂载，值以 live 引用到达 |
| `Config` | 53-111 | 插件配置 schema（字段见下表） |
| `resolveWorktreesRootValue` | 112-115 | `liveConfigValue(raw)?.trim()` → `resolve()`，空值返回 `undefined` |
| `resolveStateDir` | 116-121 | `config.stateDir` 优先，否则 `$DSH_HOME/plugins/dsh-git-worktree`（`DSH_HOME` 缺省 `~/.dsh`，119 行） |
| `RETENTION_MAINTENANCE_INTERVAL_MS` | 122 | 保留期维护定时器：15 分钟 |
| `AUTO_PRUNE_INTERVAL_MS` / `AUTO_PRUNE_FIRST_RUN_DELAY_MS` / `AUTO_PRUNE_OLDER_THAN_DAYS` | 124-126 | 每日自动剪枝已合并分支；首跑延迟 60s；阈值 7 天 |
| `apply(ctx, config)` | 136-230 | 插件挂载主流程（见 Data Flow §1） |

`Config` 字段（行号=定义行）：

| 字段 | 行 | 类型/默认 | volatile |
| --- | --- | --- | --- |
| `stateDir` | 60 | string，可省 | 否 |
| `gitTimeoutMs` | 63 | number，默认 `DEFAULT_GIT_TIMEOUT_MS`(120000) | 是 |
| `worktreeAddTimeoutMs` | 64 | number，默认 300000 | 是 |
| `autoDeliver` | 71 | boolean，默认 true | 是 |
| `autoPush` | 76 | boolean，默认 true | 是 |
| `worktreesRoot` | 83 | string | 是 |
| `inheritLocalChanges` | 89 | boolean，默认 true | 是 |
| `worktreeKeepCount` | 94 | number 0..500，默认 15 | 是 |
| `branchRaceGuard` | 101 | boolean，默认 true | 是 |
| `branchRaceWindowMs` | 103 | number 60s..24h，默认 30 分钟 | 是 |
| `enableWorkspaceProvider` | 110 | boolean，默认 false（**默认不接管官方 Workspace**） | 否 |

### 端口与领域类型

`lib/ports.js` 唯一运行时导出：`liveConfigValue(value)`（10-15 行）——值带 `.get()` 时取实时值，否则原样返回（volatile 配置的统一读取口）。

`lib/ports.d.ts` 关键模型（字段全部列出）：

- `GitCheckoutSnapshot`（52-59）：`root`、`commonDir`、`gitDir`、`branch`（null=detached）、`headOid`（可为 `'unborn'`）、`headRef`。
- `DirectoryIdentity`（238-242）：`device`、`inode`、`birthtimeNs`（均为字符串化的 stat 值）——目录身份三元组，清理/隔离的 CAS 基础。
- `SessionCheckoutLookupPort`（27-51）：`getSidebarMemberships?`、`getSession`、`getProject`、`getSessionCwd?`（40 行，owner 会话的实时 cwd，是授权证据，与 `getSession` 分离）、`listLiveSessions?`（46-50，分支竞态守卫数据源）。
- `SessionCheckoutGitPort`（94-237）：`inspect`、`findContainingWorktreeRoot`、`status`、`createDetachedWorktree`、`attachWorktreeBranch?`（118，CAS 语义：`expectedOldOid` 为 null 时仅当分支不存在才创建）、`removeWorktree`、`retain/releaseApplyBase`、`retainInternalArtifact`/`readInternalArtifact`/`releaseInternalArtifacts`、`isAncestor`，以及大量「Local adaptation」可选方法（`pushBranch?`、`repairWorktreeLinks?`、`pruneWorktrees?`、`branchOverview?`、`defaultBranch?`、`branchTipTimes?`、`branchCreationTimes?`、`deleteLocalBranch?`、`mergeLocalBranch?`、`graphLog?`、`createLocalBranch?`、`switchLocalBranch?`、标签四件套、`captureLocalWip?`/`applyWorktreePatch?`/`listUntrackedFiles?`、`snapshotAbandonedWorktree?`/`restoreAbandonedSnapshot?`、`preflightInitialCommit?`/`initializeEmptyRepository?`/`initializeProject?`、`listWorktreeincludeFiles?`）。
- `SessionCheckoutFilesPort`（243-260）：`exists`、`canonicalize`、`inspectDirectoryIdentity`、`ensureDirectory`、`removeEmptyDirectoryTree`、`quarantineDirectoryTree`、`removeDirectoryTree`、`measureDirectoryBytes`、`readTextFile?`、`copyFile?`、`isSymbolicLink?`。
- `WorktreeCreationEvidence`（276-288）：`root`、`rootIdentity`、`parentIdentity`、`commonDir`、`commonIdentity`、`lockReason`、`gitDir?`、`gitIdentity?`、`metadataFingerprint?`、`indexFingerprint?`、`quarantinePath?`。
- `ManagedCheckoutJournal`（289-323）：create 日志（`operation:'create'`，step `creating_worktree`，带 `creation?: WorktreeCreationEvidence`，294-296）与 mutation 日志（`operation: 'apply'|'preview'|'checkpoint'|'rollback_preview'|'finish'|'finalize_preview'|'cleanup'`，step 七选一，`baseOid/planRevision/previewId/reviewId/…/resumeRevision/changedFiles` 等，297-322）。
- `ManagedCheckoutDelivery`（426-471，7 个状态判别联合）：`working{iteration}`；`ready_for_review{review}`；`preview_active{review, preview}`；`preview_detached{review, preview, detachedAt, reason:'stale_local'|'preview_modified', attemptedAction}`；`finalized{review, commitOid, proof?, isolatedFingerprint, finalizedAt, cleanup:'pending'|'blocked', cleanupMessage?}`；`retained{…, retention, retainedAt, expiresAt, cleanup:'scheduled'|'blocked'}`；`delivered{iteration, commitOid, proof?, deliveredAt}`。
- `ManagedCheckoutRecord`（472-525）字段：`checkoutId`(473)、`predecessorCheckoutId?`(474)、`projectId`/`projectName`(476-477)、`ownerSessionId`(478)、`sourceSessionId?`(479)、`localRoot`(481)、`managedRoot`(483)、`managedGitRoot`(485)、`gitCommonDir`/`gitDir`(487-488)、`baseOid`(489)、`applyBaseOid?`(490)、`previousReview?`(492)、`checkpoints?`(494)、`recoveryContinuation?`(496)、`abandonedSnapshotOid?`/`abandonedSnapshotAt?`(498-499)、`permanent?`(501)、`sidebarBadgeClearedRevision?`(503)、`sourceRef`(505)、`sessionBranch?`(506-513)、`sessionTopic?`(514-520)、`phase`(521)、`delivery`(522)、`journal`(523)、`revision`(524)。
- `ManagedCheckoutsRegistry`（526-531）：`version:2`、`revision`、`sessionBindings: Record<string, SessionBindingRecord>`（SessionBindingRecord 定义在 261-271：`sessionId/projectId/projectName/target/ownerSessionId/inheritedFromSessionId?/sourceRef/sourceOid/revision`）、`managedCheckouts: Record<string, ManagedCheckoutRecord>`。
- `LiveValue<T>`（537-539）：`{ get(): T }`。

`lib/types.d.ts` 常量与类型：`SessionTargetRef`（10-17）、`SessionCheckoutPhase`（19-21，含 deprecated `applying`）、`WorktreeRetentionMode`（24）、`DEFAULT_WORKTREE_RETENTION`（30，默认 `retain_24h`）、`CONFLICT_DETAIL_FILE_LIMIT = 6`（439）、`CONFLICT_DETAIL_DIFF_LIMIT = 4096`（440）、`SESSION_CHECKOUT_ERROR_CODES`（499，29 个稳定错误码）。

### 适配器层 `lib/adapters/`

#### `files.js` — Node fs 文件端口

| 函数 | 行号 | 用途 |
| --- | --- | --- |
| `measureDirectoryBytes` | 13-25 | 递归测字节数；符号链接计 0 |
| `removeEmptyDirectoryTree` | 26-38 | 仅当整棵树无文件/链接才逐级 `rmdir`，否则返回 false |
| `inspectDirectoryIdentity` | 39-50 | `lstat(bigint)` 取 `{device, inode, birthtimeNs}`；非目录/符号链接返回 null |
| `directoryIdentitiesEqual` | 51-53 | 三元组全等比较 |
| `quarantineDirectoryTree` | 54-74 | 校验 quarantine 路径同父且未占用（61），`rename` 后重验身份；身份不匹配则尝试搬回并抛 `checkout_mismatch`（67-73），**绝不删除身份不符对象** |
| `removeDirectoryTree` | 75-88 | 拒绝非目录/符号链接根（79-81），`rm` 带平台化重试（85-86：win32 6 次/其他 2 次，150ms 间隔） |
| `createNodeFilesPort()` | 90-116 | 组装端口：`exists`、`canonicalize`、`inspectDirectoryIdentity`、`ensureDirectory`、`removeEmptyDirectoryTree`、`quarantineDirectoryTree`、`removeDirectoryTree`、`measureDirectoryBytes`、`readTextFile`、`copyFile`（先建父目录、先删同名）、`isSymbolicLink` |

#### `git-options.js` — Git 超时

| 成员 | 行号 | 用途 |
| --- | --- | --- |
| `DEFAULT_GIT_TIMEOUT_MS = 120_000` | 2 | 普通命令默认超时 |
| `DEFAULT_WORKTREE_ADD_TIMEOUT_MS = 5*60_000` | 3 | `worktree add` 默认 5 分钟 |
| `MAX_GIT_TIMEOUT_MS = 60*60_000` | 4 | 上限 1 小时 |
| `validateGitTimeouts(options)` | 5-12 | 校验两字段为 1000..MAX 的安全整数，否则 RangeError |
| `gitTimeoutMs(args, options)` | 13-21 | 按命令选超时：`worktree add`→`worktreeAddTimeoutMs`；`worktree remove` 固定 5 分钟（18-19）；其余→`gitTimeoutMs`；volatile 字段每次调用现读（14-15 注释） |

#### `git.js` — `ctx.subprocess` Git 端口（核心适配器）

模块注释（6-24）声明强化项：禁用 hooks、`--no-optional-locks`、禁终端交互、C locale、Windows 上 `worktree remove` 5 分钟硬上限、内部引用命名空间 `refs/dsh-worktree/session-checkouts/<key>`；并说明与官方实验版 worktree 服务的**有意分歧**（15-22）：不做 `sandbox.confine`，因为受管 checkout 在会话工作区之外。

| 成员 | 行号 | 用途 |
| --- | --- | --- |
| `GIT_TERMINATION_GRACE_MS` / `GIT_COLLECT_BYTES` / `WIP_PATCH_COLLECT_BYTES` | 32 / 34 / 36 | 终止宽限 1s；每流收集上限 1MiB；WIP 二进制补丁 16MiB |
| `parseDecoration` | 42-53 | `%D` → ref 名数组；`tag: ` 前缀转 `tag:<name>`；丢弃 `HEAD -> ` |
| `settleCreationTree` | 54-70 | 创建期进程树静默判定：terminate + waitForExit（10s 上限） |
| `runGit` | 76-183 | 单命令执行：argv 原样传递；ambient `GIT_*` 路由变量置 undefined（105-108）；`GIT_OPTIONAL_LOCKS=0`、`GIT_TERMINAL_PROMPT=0`、`LC_ALL/LANG=C`（109-112）；stdin 支持字符串或 `GitCommitProtocol`（`prepare`→等 `prepare: ok`→`beforeCommit`→`commit\n`/`abort\n`，115-139）；返回 outcome 对象（非零退出是否算错由调用方决定）；创建期走 deadline + quiescent 判定（143-160）；输出 lossy 或超时/信号终止均返回明确错误（166-171） |
| `runGitChecked` | 184-190 | 非零即抛 `git_operation_failed` |
| `checkoutRefRoot` | 191-194 | `refs/dsh-worktree/session-checkouts/<sha256(checkoutId)[0:24]>` |
| `assertArtifactName` / `internalArtifactRef` / `applyBaseRef` | 195-201 / 202-205 / 206-208 | 内部 artifact 名校验（每段 `[A-Za-z0-9][A-Za-z0-9._-]*`）与 ref 拼接 |
| `abandonedSnapshotRef` | 214-217 | `refs/dsh-worktree/abandoned/<checkoutId>`——**故意在 checkoutRefRoot 之外**，discard 释放整个命名空间时不能带走新写的安全快照（209-213 注释） |
| `hasGitMetadata` | 218-234 | 沿父目录找 `.git` 判定是否在仓库内（区分 ENOENT 与其他错误） |

`createDshGitPort(ctx, options)`（236-782，options 见 `git.d.ts:11-11`：`hooksPath` 必填、`projectSkills?`、超时字段）返回的端口方法：

| 方法 | 行号 | 要点 |
| --- | --- | --- |
| `inspect` | 242-310 | 单次 `rev-parse`（4 值）+ 并行 `symbolic-ref` 快路径（243-265）；`not a git repository` 且无元数据→null（266-268/271-272）；多值输出含换行路径歧义时回退单值读取（280-285）；unborn HEAD 仅在 symbolic 有效且无任何 ref 时承认（288-297）；路径不跨调用缓存（275-276 注释） |
| `findContainingWorktreeRoot` | 311-319 | `rev-parse --show-toplevel` + realpath |
| `status` | 320-324 | `status --porcelain=v1 -z --untracked-files=all` + `projectSkills.scope` 剔除携带的 Skill 路径后判 dirty |
| `createDetachedWorktree` | 325-336 | 先校验 Project Skills 无未提交 tracked 改动（327-330）；deadline 传入 `createWorktree`（331-334）；随后 `projectSkills.carry`（335） |
| `removeWorktree` | 337-347 | 有携带 Skill 时先 `assertRemovable`（340-344），再 `worktree remove --force`，`forget` |
| `pruneWorktrees` | 348-350 | `worktree prune --expire now` |
| `retainApplyBase` / `releaseApplyBase` / `retainInternalArtifact` / `readInternalArtifact` / `releaseInternalArtifacts` | 351-353 / 354-356 / 357-359 / 360-367 / 368-380 | 内部 ref 生命周期；释放用**单次 spawn 事务**（`update-ref --stdin` 批量 delete，376-377） |
| `isAncestor` | 381-388 | `merge-base --is-ancestor`；0→true，1→false，其他抛错 |
| `listLocalBranches` / `resolveLocalBranchTip` | 389-392 / 393-400 | 分支清单（排序）；tip 校验 `/^[0-9a-f]{40,64}$/iu` |
| `attachWorktreeBranch` | 401-415 | 只动 ref 与 HEAD 指向、绝不碰工作区（402-403 注释）；`update-ref <branch> <new> <old|null→全零>` 实现 CAS（406-407），再 `symbolic-ref HEAD`（411） |
| `pushBranch` | 416-433 | 无本地分支/无 upstream→`{ok:false, message}`；`git push -- <branch>`，**绝不 force**（417-419 注释） |
| `repairWorktreeLinks` | 434-439 | 仓库搬家后 `worktree repair` |
| `listWorktreeincludeFiles` | 440-461 | 两次 `ls-files --others --ignored` 求交 = "匹配 ∧ gitignored"（`.worktreeinclude` 语义）；额外带入被 ignore 的 `AGENTS.override.md`（457-459） |
| `branchOverview` / `defaultBranch` / `branchTipTimes` / `branchCreationTimes` | 462-479 / 480-488 / 489-503 / 504-527 | 分支总览（含 dirtyCount）；trunk = `origin/HEAD` → `init.defaultBranch`（**绝不猜 'main'**）；tip 提交时间；创建时间取每分支 reflog 首条 `branch: Created from`（505-507 注释） |
| `deleteLocalBranch` | 528-533 | `branch -d`（绝不 -D），失败带原因 |
| `graphLog` | 534-556 | `log --branches --tags --remotes --topo-order --parents`，`\x1e` 分记录、`\0` 分字段 |
| `createLocalBranch` / `switchLocalBranch` | 557-566 / 567-578 | `check-ref-format` 先行；switch 失败时识别 "already used by worktree at"（571-575）给出专用文案 |
| `listTags` / `createTag` / `deleteLocalTag` / `pushTag` / `deleteRemoteTag` | 579-618 / 619-634 / 635-640 / 641-647 / 648-653 | 标签管理；`pushed` 三态（true/false/**null=远端不可查，不得误报未推送**，604-606）；所有 push 绝不 force（642） |
| `mergeLocalBranch` | 654-728 | dryRun 在 `mkdtemp` 临时 detached worktree 试合并（693-717，finally 必回收 712-716）；正式合并冲突**不 abort**，留现场并返回逐文件 diff（718-727）；冲突详情受 `CONFLICT_DETAIL_FILE_LIMIT/DIFF_LIMIT` 限制（656-676） |
| `captureLocalWip` / `applyWorktreePatch` / `listUntrackedFiles` | 729-737 / 738-744 / 745-749 | codex 对齐：`diff --binary --full-index HEAD`；`apply --binary`（原子，整包成败）；`ls-files --others --exclude-standard` |
| `snapshotAbandonedWorktree` / `restoreAbandonedSnapshot` | 750-770 / 771-779 | `add -A`→`write-tree`→`commit-tree`（显式身份 759-762）→`update-ref` 到 abandoned ref；恢复即建分支 + 删 ref |
| 组装 | 781 | `Object.assign(port, initialCommitActions(port.inspect, runSessionGit))` |

#### `initial-commit.js` — 空仓库初始化协议

`initialCommitActions(inspect, run)`（7-133）返回三个动作；内部助手：`checked`（9-14）、`identity`（15-20，`dev:ino:birthtimeNs[:mtimeNs:ctimeNs]`）、`indexBytes`（21-30）。

- `preflightInitialCommit(root)`（31-52）：快照非 unborn→`ready`；目录枚举**刻意不忽略任何 pattern**（38-39 注释：ignored/符号链接/嵌套仓库/空目录都需用户显式决策）→有文件即 `files`；否则对 `{snapshot, rootIdentity, canonicalIdentity, gitIdentity, commonIdentity, head, headIdentity, index, files}` 做 sha256 指纹→`empty`。
- `initializeEmptyRepository(root, fingerprint, assertAuthorized?)`（53-113）：三段式预检（before/current/latest，55/65/77）；`index.lock` 独占创建（61-64，`wx`）；`mktree` 空 stdin 建空树（75）；`commit-tree` 建初始提交（76）；`update-ref --stdin` 事务里 CAS 更新 unborn HEAD，`beforeCommit` 回调在锁下再次预检（83-94）；`EEXIST`→`initialRepositoryBusy`（98-100）；finally 逆序清理**只清理自己创建的锁**（103-112）。
- `initializeProject(root)`（117-131）：本地适配——非 Git/未出生仓库经用户确认变为有首次提交的仓库；`init -b main`（不写 config，123-124）、`add -A`、`commit`；已有提交的仓库拒绝（119-121）。

#### `lookup.js` — 会话/项目→Workspace 映射

`createDshLookupPort(ctx)`（33-134）：`registry()`/`sessions()`（34-41）动态探测 `workspaceRegistry`/`sessions` 服务并做结构守卫；`liveHeaderCwd`（49-52）收口 `sessions()?.get(id)?.header?.cwd`。端口方法：`getSidebarMemberships`（54-74，查 header 而非 transcript——目录缺失不得抹掉导航身份，60-61 注释）、`listLiveSessions`（75-102，结构未知降级为空列表）、`getSession`（103-120，Workspace.sessionIds 被宿主过滤时用 live header cwd 精确恢复，110-118）、`getSessionCwd`（121-126，managed owner 的 cwd 即其 immutable worktree 根）、`getProject`（127-132）。`sameResolvedPath`（25-31）做 win32 大小写不敏感路径比较。

#### Project Skills 三件套

- `project-skill-io.js`：`checkRoot`（6-11，身份三元组校验）、`checkPath`（12-36，逐段校验必须在 `.dsh/.agents/.claude` 的 `skills` 下、禁 `..`/控制字符/链接，可选建父目录）、`readSkillFiles`（37-69，`O_NOFOLLOW` 打开、双 stat 比对 inode/dev、总预算 64MiB）、`createSkillDirectories`（70-77）、`createSkillFiles`（78-95，`O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW` + chmod + fsync，写后复读校验）。
- `project-skills.js`：`PROJECT_SKILL_ROOTS = ['.dsh/skills','.agents/skills','.claude/skills']`（6）；上限 `MAX_FILES=5000`/`MAX_BYTES=64MiB`（7-8）；`safePath`（12-17）、`identity`（18-23）、`inspectPath`（25-41，逐段拒链接/junction）、`boundedRead`（42-66，读前后 stat 一致性）、`assertSkillTree`（67-80，≤10000 项/深度≤64）、`ownedSkillDirectories`（81-83）、`inventory`（84-115，收集文件+hash+空目录）。`ProjectSkillStore`（117-258）——宿主私有的 Skill 溯源存储（116 行注释：**绝不接受来自受管 checkout 的排除清单**）：
  - `constructor(directory)`（119-121）、`file(root)`（122，`<sha256(resolve(root))>.json`）
  - `snapshot(source)`（123-126）、`load(root)`（127-150，manifest 严格校验：version=1、root realpath、identity、phase、文件 hash/mode/去重）
  - `carry(snapshot, target)`（151-206）：先完成全部冲突预检（160-176）→`wx` 独占写 `phase:'copying'` manifest（188-192）→建目录/写文件→逐文件 hash 复验（195-199）→身份复验（200-201）→`phase:'ready'` 经 `.ready` 临时文件 rename 发布（202-205）
  - `scope`（207-210）、`paths`（211）、`state(root, tracked?)`（212-244，指纹 = 路径+hash+mode 串接 sha256，`modified` 标志）、`assertRemovable`（245-256，Skill 被改或出现新资源即拒绝删除）、`forget`（257）
  - `trackedSkillPaths(indexEntries, headPaths)`（259-267）、`hasDeliverableStatus(output, auxiliary, directories)`（269-282，仅 `??` 且命中 auxiliary 的记录视为辅助）、`assertSkillPath`（283-286）。
- `project-skill-provider.js`：`candidatePath`（7-13，兼容 DSH 0.1 `candidate.path` 与 0.2 `locator.path`）；`managedSkillRoot(registry)`（15-45，**用宿主记录解析根而非 Skill 文件自报**：校验 managedGitRoot 的 `.git` 指针与 `gitdir` 回链双向一致，25-40）；`ClaudeProjectSkillProvider`（47-132，name=`worktree-project-claude`，rank 250，串行化 `run()` 操作队列 55-59，provider LRU 上限 32 个 69-73，`list/get/observeHostMutation/dispose` 81-131）；`mountProjectSkillProvider(ctx, registry)`（133-146，注入 `['skills']`，订阅 `fs/observed`）。

#### `registry.js` — 崩溃安全的原子 JSON 注册表

校验器群（14-324）：`isOid`（28-30，40/64 位 hex）、`isSafeRelativePath`（34-40，禁绝对路径/`..`/控制字符）、`isSessionBinding`（48-58）、`isReview`（59-77）、`isCheckpoint`（87-104，`sequence` 连续、id/reviewId/requestId 唯一，299-306）、`isDelivery`（139-182，按 7 个 delivery.state 分别校验）、`isJournal`（183-242，旧 journal 的 `creation` 缺失视为无删除授权，194-195）、`isManagedCheckout`（283-314）、`isRegistry`（315-324）。

- `migrateLegacyRegistry(value)`（325-378）：v1→v2 保守迁移，非 ready/discarded 的 phase 一律落 `recovery_required`（350-352），revision+1。
- `AtomicJsonCheckoutRegistry`（380-402）：`read()`（385-397，`readJsonFileSafe`→`isRegistry`→否则尝试迁移→文件不存在给空表→**损坏则 loud fail** 抛 `registry_corrupt`，396）；`write()`（398-401，先建目录再 `writeJsonFileAtomic`）。

#### `safe-file.js` — 崩溃安全 JSON 读写

| 函数 | 行号 | 用途 |
| --- | --- | --- |
| `sleepSync` | 15-23 | `Atomics.wait` 同步睡眠（无 SharedArrayBuffer 时忙等回退） |
| `renameAtomicWithRetry` | 25-41 | rename 原子语义 + Windows 瞬时句柄竞争有限重试（EBUSY/EPERM/EACCES/ENOTEMPTY，12-14；指数退避 20ms 起） |
| `tmpPathFor` | 46-48 | `<file>.<pid>.<uuid>.tmp`——固定名 tmp 会让并发写者互踩、半写 tmp 被误提升（42-45 注释） |
| `listTmpFiles` / `cleanupTmpFiles` | 50-64 / 65-72 | 按 mtime 新→旧列出残留 tmp |
| `writeJsonFileAtomic` | 79-95 | 备份 `.bak` → 写唯一 tmp → 原子 rename；**无跨进程锁**（76-77 注释） |
| `writeTextFileAtomic` | 97-101 | 文本版（JSONL 会话等） |
| `readJsonFileSafe` | 106-154 | 主文件 → 最新可解析 tmp（可提升为主文件并清理其余，121-135）→ `.bak`（恢复时 skipBackup 防止坏主文件覆盖好备份，142-144）→ null |

#### `working-directory.js` — 会话 cwd 端口

`createSessionWorkingDirectoryPort(ctx)`（28-75）：动态探测宿主 `workingDirectory` 服务（29-36，无服务注册表的插件 Context 视同未挂载）；`current`（38-49）、`enter`（50-57，无服务/无 live Agent 返回 `undefined`——**调用方不得在 undefined 时声称已切换 cwd**，53-54 注释）、`leave`（58-73，仅当当前 cwd 在 `path` 内才搬回 fallback）。`isWithin`（77-85）跨平台包含判定。

#### `worktree-creation.js` — 创建与失败回滚（最敏感的安全代码）

| 函数 | 行号 | 用途 |
| --- | --- | --- |
| `createWorktree(localRoot, target, baseOid, run, saveEvidence)` | 12-148 | 五步：①`mkdir(target)` 独占占位（42）+ 根/父/commonDir 身份取证并 `saveEvidence`（44-48）；②`git worktree add --detach --no-checkout --lock --reason <uuid>`（49）；③gitDir 身份 + `metadataFingerprint`（50-55）；④`verifyIdentity` → sparse 走 `reset --hard`（67-71）/否则 `read-tree`+index 指纹+`checkout-index --all`（72-77）→再验证→`worktree unlock`（79）；⑤失败路径：未注册且 quiescent→目录为空、元数据未变则安全 `rmdir`（83-110）；已注册且 quiescent→完整验身份+`verifyUnmodified` 后 `worktree move` 进隔离区再 `remove --force`（113-145）；其余一律保留现场（146） |
| `verifyIdentity` | 149-177 | 根/父/commonDir/gitDir 身份 + `.git` 指针/`gitdir`/`commondir`/HEAD/locked 回链逐项校验；**存在任何 `.lock` 即失败**（174-176，含被打断的 read-tree 锁） |
| `verifyRollbackMetadata` | 178-196 | metadata/index 指纹不变；`ORIG_HEAD` 仍等于 baseOid |
| `metadataFingerprint` | 197-228 | 遍历 gitDir：仅允许白名单条目（208），`index/gitdir/ORIG_HEAD` 跳过（202-204，其语义另行校验），>1MiB 文件拒绝 |
| `verifyUnmodified` | 229-320 | 拒绝 submodule（238-239）；拒绝 filter/working-tree-encoding（265-272）；逐文件按 mode 重算 blob hash（273-307）；`diff-index`/`ls-files -v`/`ls-files --others`/`diff --name-status` 全干净且只允许 D 记录（308-319） |

`lib/creation-failure.js`：`WorktreeCreationFailure`（2-9），字段 `rolledBack: boolean`——「创建失败 ≠ 空目录可安全覆盖」。

### 领域核心

#### `session-checkout-apply.js` — Apply 引擎（1725 行）

基础设施：

- `GitCommandFailure`（12-20）；ambient `GIT_*` 环境清洗 `AMBIENT_GIT_ENV_PATTERN`/`scrubbedAmbientGitEnv`（23-28）；懒创建的禁 hooks 临时目录（29-36）；`GIT_TIMEOUT_MS = 30_000`（39，apply 路径命令短，可经 `options.timeoutMs` 覆盖）；`OID_PATTERN`（40）。
- `runGit`（41-100）：直接 spawn git（Windows 加 `core.longpaths=true`，44-46），`options.env` 是**刻意的注入通道**（GIT_INDEX_FILE 等），总是最后展开覆盖清洗后的环境（52-63）；超时 SIGTERM（91-94）。
- 合并基建：`selectEffectiveApplyBase`（153-168，ancestry 三策略 `recorded_base`/`isolated_contains_local_head`/`local_contains_isolated_head`）、`captureSnapshot`（184-228，HEAD 树 + staged 补丁回放 + 临时 index `add -A`（排除 `deliveryExcludePathspecs`）+ Project Skills 携带路径 force-remove；指纹 = sha256(headOid‖headRef‖indexEntries‖treeOid) 再叠携带指纹，173-183/225-227）、`createSnapshotCommit`（229-242，显式 Domi Apply 身份）、`computeMerge`（261-322，一次性仓库内三方合并，`GIT_ALTERNATE_OBJECT_DIRECTORIES` 复用源对象库；ready 返回 `{changedFiles, patch, mergedTreeOid}`，conflict 返回文件与逐文件 diff）、`computeTreeMerge`（323-376，纯 tree 级合并，用于 C = H + (M − L) 类推导）。
- 校验助手：`prepareRollbackAssessment`（420-473，Local 前进时的回滚基线重放）、`prepareFinalizeAssessment`（474-519，任务增量剥离 + index 保全评估）、`writeIndexLock`（559-581，Git 规范 index.lock 协议）、`isIndexLockContention`（582-587）。

`DefaultSessionCheckoutApplyEngine`（588-1721）公开方法：

| 方法 | 行号 | 要点 |
| --- | --- | --- |
| `checkpoint(input)` | 597-736 | 快照 CAS（613-616）→`beforeCommit` 预持久化（626）→相邻 index + `.lock.dsh-<oid>` 标记（627-636）→最终验证（637-641）→`advanceHead`（644-652，**分支附着时推进分支而非 `--no-deref`**，否则会 detach 并孤立会话分支）→rename index→独立写后验证（687-699）；失败回滚 HEAD，无法回滚则 `recoveryState:'uncertain'` 保留证据（662-677） |
| `recoverCheckpoint(input)` | 737-822 | 遗留 index.lock 的归属证明（marker 内容 == commitOid 且 tree 一致，751-763/776-782），恢复或判定 aborted |
| `inspectReview(input)` | 823-864 | 双端同仓库/同前缀校验（836-843）+ Isolated 快照与 changedFiles |
| `reviewIsolated(input)` | 869-902 | 只看 Worktree 的评审快照，完全不解析 Local（865-868 注释） |
| `commitIsolated(input)` | 910-986 | **会话分支交付，完全不碰 Local**（903-909 注释）：守门 `headRef === branch`（932-941）；提交树取自评审快照同一条构造路径以排除宿主产物与携带 Skills（942-946）；`update-ref HEAD` + `reset --quiet`（952-954）；`empty ident` 错误翻译为可执行提示（976-979） |
| `preflight` / `plan` / `calculatePlan` | 987-989 / 990-992 / 993-1081 | preflight 不持久化 plan；plan 存入 `plans` Map 且**每个 isolated checkout 只保留一份**（1053-1059） |
| `apply(plan)` | 1082-1132 | 仓库身份→Local/Isolated 指纹 CAS→持久 Isolated snapshot commit（nextBaseOid，1104-1110）→最后 Local 校验→`git apply` patch（1119-1121） |
| `preview(plan, options)` | 1133-1218 | 持久 receipt（`beforeWrite` 在任何 Local 写之前，1193）→`apply` patch→写后树一致校验（1197-1203） |
| `assessPreviewRecovery(input)` | 1219-1248 | 严格只读：rollback/finalize 两份安全性评估 |
| `rollback(input)` | 1249-1315 | `beforeWrite`（journal）→最终 CAS→`git apply` 回滚补丁→写后指纹精确比对（1291-1305），不匹配 `recoveryState:'uncertain'` |
| `finalize(input)` | 1316-1522 | index.lock 协议内完成 ref CAS + index 原子替换（1373-1407）；三级补偿：仍持锁回滚 ref（1435-1447）/备份 index 的 CAS 恢复（1448-1469）/证据不足拒绝部分回滚（1470-1472）；无法证明成功或完整回滚→保留备份 index 并 `uncertain`（1501-1510） |
| `finish(plan, options)` | 1523-1705 | 旧「写回 Local」路径：复验合并与文件集一致（1558-1568）→任务提交 C = H + (M − L)（1583-1593）→index 保全 S' = C + (S − H)（1594-1604）→index.lock 内 apply patch + `update-ref` + 换 index（1620-1653）→失败逆序回滚（1654-1688） |
| `errorMessage` / `cleanup` | 1706-1711 / 1712-1720 | 错误文案；临时目录清理失败只告警不掩盖主结果 |

工厂 `createSessionCheckoutApplyEngine(options)`（1722-1724）；`SessionCheckoutApplyEngineOptions`（`.d.ts:267-277`）含测试 seam：`beforeFinalLocalValidation`、`afterLocalWriteBeforeVerification`、`beforeFinalIsolatedValidation`、`afterIsolatedWriteBeforeVerification`。

#### 小型领域模块

| 文件 | 成员 | 行号 | 用途 |
| --- | --- | --- | --- |
| `checkpoint.js` | `canonicalJson` | 2-12 | 键排序、剔除 undefined 的规范 JSON |
| | `checkpointGenerationForRecord(record)` | 14-28 | 仅 `ready_for_review`/`preview_active` 有值；sha256 over `{checkoutId, revision, reviewId, isolatedHeadOid, isolatedFingerprint, checkpointCount, previewId, phase}`——checkpoint 的 CAS generation |
| `commit-message.js` | `isValidCommitMessage` | 2-4 | 非空白且无 NUL；500 字符非 Git 限制（1 行注释） |
| `concurrent-session-guard.js` | `cwdWithinLocalRoot` | 20-26 | cwd 缺失视为共享（保守） |
| | `detectLocalBranchRace(input)` | 28-49 | 纯同步谓词：更早的同根 live 会话 × 窗口内新建分支（排除 managed 分支）→`race_detected` |
| `delivery-excludes.js` | `HOST_RUNTIME_ARTIFACTS` | 12-16 | `'.dsh-ops'`、`'desktop-runtime.json'`、`'.dsh-runtime.json'` |
| | `deliveryExcludePathspecs` | 21-30 | 转 git pathspec 排除（含 `**` 嵌套变体）——保证「评审看到的 = 交付出去的」 |
| `managed-worktree-path.js` | `sanitizeManagedWorktreeLabel` | 12-25 | Windows 非法字符/保留名/40 码点截断 |
| | `createManagedWorktreeRepositoryKey` | 33-35 | `sha256(canonicalGitRoot)[0:12]` |
| | `sanitizeBranchSegment` / `createSessionBranchCandidates` | 39-48 / 55-64 | 会话分支候选 `feat/sess-<session>[--<topic>]`，重名 `-2..-N` |
| | `createManagedWorktreeDirectoryName` / `createTopicManagedWorktreeDirectoryName` / `createTopicDateStamp` | 66-70 / 77-84 / 86-91 | `<repo>--<id>--worktree` / `<topic>-<YYYYMMDD>[-<id>]` |
| | `createManagedWorktreePathCandidates` | 102-133 | 设了 `worktreesRoot` 时统一落在 `<worktreesRoot>/<projectLabel|repositoryKey>/` 下；否则兄弟容器 + 状态目录回退 |

### 服务面

#### `tools.js` — 模型工具（9 个）

助手：`parseWorktreeRetention`（7-14）、`sessionIdOf`（15-21）、`renderJson`（23-25，规范化 JSON 输出供模型与 keyed ToolView 共用）、`leaveCheckoutBeforeRemoval`（32-44，**恢复 cwd 失败必须中止删除**）、`enterCheckout`（53-65，优先从台账读根，避免全局锁下的 Git 验证拖住进入）。`registerTools(ctx, module)`（67-655）注册：

| 工具 | 行号 | 用途 |
| --- | --- | --- |
| `worktree_create` | 73-135 | in-place 创建（targetSessionId == 当前会话，109-110）；可选 `topic`/`branch`；返回含 `cwdSelected`/`cwd`（117-131） |
| `worktree_list` | 136-192 | 调用者可见的受管 worktree 摘要；`commitOid` 缺省时省略键而非输出空（184-186 注释） |
| `worktree_resume_revision` | 193-234 | Ready→Working（失效旧 Review，不碰 Local） |
| `worktree_begin_next_iteration` | 235-278 | 已交付+清理完成→重建 immutable cwd 开下一轮并重新进入（263-265） |
| `worktree_ready_for_review` | 279-364 | summary/details/validationStatus/tests/suggestedCommitMessage → 冻结评审快照 |
| `worktree_deliver` | 365-467 | 交付：`autoDeliver` 关闭时拒绝（411-413）；Ready 态缺省用 `suggestedCommitMessage`（420-424）；先 `leaveCheckoutBeforeRemoval`（431-434）再 `operate finish`；失败则把会话送回 checkout（443-447）；返回 `branch`（交付提交落点，457-458） |
| `worktree_cleanup` | 468-520 | 对 retained/finalized checkout 的 CAS 清理 |
| `worktree_prune_branches` | 521-589 | `git branch -d` 语义的已合并分支清理（dryRun/olderThanDays） |
| `worktree_merge` | 590-654 | 会话自有 worktree 分支 ⇄ Local 的双向合并（direction forward/reverse） |

#### `commands.js` — `/worktree` 命令

`registerWorktreeCommand(ctx, module)`（32-223）：`leaveCheckout`/`enterCheckout`（39-64，**leave 失败必须中止删除**，38-39 注释）；动词：`status`(76-78)、`list`(79-87)、`continue`(88-96)、`next`(97-107，创建后重新进入 checkout 101)、`finalize`(108-146，reviewId+revision 绑定与 retention 校验 109-123，失败把会话送回 139)、`finish <message>`(147-170)、`discard`(171-192)、`remove <checkoutId>`(193-213)、未知动词提示用法(214-215)。

#### `session-target-context.js`

`registerSessionTargetContext(ctx, module)`（6-32）：分支竞态守卫缓存的后台刷新（45s interval，12-19）；向 `systemPrompt.context` 注册 `git-worktree:session-target`（order 118），文本 = `module.runtimeContext(sessionId, workingDirectory.current(agent))`（24-29，同步、无 Git/文件 IO）。

#### `console-contract.*` — JSON-only 共享契约

运行时（`console-contract.js`）：`WORKTREE_CONSOLE_TARGET_STATES`（11-23，11 态）、`worktreeReachedDelivery`（30-36，delivered/finalized/retained 或终态 phase）、`consoleStateFromDomain`（38-63，**discarded phase 压过 retained/finalized 标签**，47-50 注释）、`WORKTREE_CONSOLE_ERROR_CODES`（64-69 = 29 领域码 + 3 传输码）、`ERROR_META`（70-103，每个码的 `category/recovery/retryable`）、`worktreeConsoleErrorMeta`（104-106）。

类型（`console-contract.d.ts`）：`WorktreeConsoleCapabilities`（33-59，16 个能力位含 `returnToLocal`）；`WorktreeConsoleReviewSummary`（67-78）；`WorktreeConsoleTargetSummary`（80-110，路径无关行：`project/checkoutId?/sourceSessionId/ownerSessionId/targetSessionId?/iteration/revision/state/phase/dirty/currentOid/commitOid?/sourceBranch/retention?/retainedAt?/expiresAt?/permanent?/cleanupMessage?/deliveryProof?/review?/checkpoints?/checkpointGeneration?/reviewSlot?/reviewSlotOwnerSessionId?/reviewSlotHolder?/previewRecovery?/capabilities`）；`WorktreeConsoleTargetDetails`（112-125，追加 `managedRoot/sourceRoot/sourceOid/currentBranch/recoveryContinuation?`）；错误与恢复凭证（480-546，`WorktreeApplyConflictContinuation` 484-495、四种 proof 496-532、`WorktreeConsoleOutcome` 540-546）；`WorktreeConsoleAdapter`（554-600，Client 侧规范化接口，40+ 方法）。

#### `console-host/` — 宿主 RPC 实现

- `errors.js`：`domainError`（3-5，Error + code + continuation）、`consoleFailure`（6-32，领域错误透传，否则折叠为 `git_error`；**第三方错误文案本地原样透出**，21-24 注释）、`failure`（33-43）、`outcome`（44-51，try/catch 包裹器）。
- `projection.js`：`capabilities(record, callerSessionId, ownerSessionAvailable, linkedRead)`（47-85，owner/source/linkedRead 三类授权矩阵）；`sourceBranchFromRef`（91-93）；`projectRecord`（94-152，`sessionBranch ?? sourceRef`——会话自有分支优先于 fork 点，113-116 注释）；`projectDetails`（153-221，含 `currentBranch` 的已交付例外：交付后 chip 必须显示用户实际所在分支，170-177 注释）；`projectLocal`（222-260）。
- `control-plane.js`：`createWorktreeConsoleControlPlane(options)`（92-1366）。关键内部：`verifyCallerRoot`（130-206，owner 的 live cwd = immutable worktree 根、已交付 settled 态回落 Local 边界、canonicalize 带 memo 154-162）；`authorize`（207-227，owner/source + 项目匹配 + 根校验 + 可见性）；`linkedReadAccess`（228-277，验收槽位持有者的精确读授权）；`observeFromCaller`（314-335，复用 `current` 已付的 3 次 spawn，296-313 注释）；`settledLocalBranch`（361-387）；`acceptanceHolder`/`projectReviewSlot`（391-419）；创建互斥 `withCreation`（505-526，session + root 双键）。全部端点（行号）：`sidebarTopology` 543-602、`current` 603-610、`gitOverview` 611-625、`gitGraph` 626-632、`gitCreateBranch` 633-639、`gitSwitchBranch` 640-656（交付中拒绝切分支 642-651）、`gitPruneMergedBranches` 657-659、`gitListTags` 660-668、`gitCreateTag` 669-682、`gitDeleteTag` 683-699（先远端后本地，685-686 注释）、`gitPushTag` 700-710、`listAbandoned` 711-713、`restoreAbandoned` 714-718、`list` 719-797（批量观察 746-757 + 逐条降级 770-778）、`preflightCreate` 798-817（empty 确认令牌 5 分钟/500 上限 809-815）、`createWithInitialCommit` 818-837、`create` 838、`initProject` 839-844、`inspect` 845、`reviewDiff` 846-889（读前后双重 preflight + 指纹比对 856-881）、`preflight` 890-903、`previewRecoveryPreflight` 904-919、`preparePreviewRecoveryAnalysis` 920-943、`createPreviewRecoveryHandoff` 944-977、`checkpoint` 978-1007、`preview` 1008-1031、`resumeRevision` 1032-1086（冲突恢复请求的严格身份校验 1042-1050）、`prepareReviewRegeneration` 1087-1108、`rollbackPreview` 1109-1129、`discard` 1130-1160、`finalize` 1161-1201、`finalizePreview` 1202-1248、`setRetention` 1249-1258、`setPermanent` 1259-1268、`retryCleanup` 1269-1277、`clearSidebarBadge` 1278-1290、`beginNextIteration` 1291-1330、`returnToLocal` 1341-1364（仅已交付记录可解绑，1331-1340 注释）。
- `review-diff.js`：常量 `REVIEW_DIFF_MAX_FILES=200`/`REVIEW_DIFF_MAX_PATCH_BYTES=100KiB`/`REVIEW_DIFF_MAX_PAYLOAD_BYTES=1MiB`（7-9）；`ReviewDiffStaleError`（10-15）；`createGitWorktreeReviewDiffReader(projectSkills?)`（101-211）：临时 object directory + `GIT_INDEX_FILE` 隔离环境（111-119）→`read-tree`+`add -A`→移除携带 Skills 的路径（121-140）→name-status 与 `expected` changedFiles 严格比对（148-151）→**按批 8 文件并行取证**（155-171，逐文件 2 spawn 串行最坏 400 次会顶爆 SLOW 180s，155-156 注释）→payload 预算折叠（180-198）；`parseNameStatus`（70-94，R/C 折叠为 renamed，78-80 注释）。
- `service.js`：`WorktreeConsoleService extends TypertRemoteService`（40-316，全部方法挂 `@Remote` 装饰器，81-115）。字段 `hostContext/controlPlane/diagFile/officialWorkspaceActive`（153-156）；`appendDiag`（167-174，ndjson 面包屑，绝不破坏 RPC）；`sidebarTopology`（175-187，注入 `workspaceClientFlavor`/`officialWorkspaceActive`）；`clientBootReport`（188-191）；`current`（192-205，**计时并记录失败 code/message 到 diag**，193-198 注释）；其余 30+ 方法（`list` 206-208、`preflightCreate` 209-211、`createWithInitialCommit` 212-214、`create` 215-217、`initProject` 218-220、`inspect` 221-223、`reviewDiff` 224-226、`preflight` 227-229、`previewRecoveryPreflight` 230-234、`preparePreviewRecoveryAnalysis` 235-239、`createPreviewRecoveryHandoff` 240-244、`preview` 245-247、`checkpoint` 248-252、`prepareReviewRegeneration` 253-255、`resumeRevision` 256-260、`rollbackPreview` 261-263、`discard` 264-266、`finalize` 267-269、`finalizePreview` 270-274、`setRetention` 275-277、`setPermanent` 278-280、`retryCleanup` 281-283、`beginNextIteration` 284-286、`returnToLocal` 287-289、`clearSidebarBadge` 290-292、`gitOverview` 293-295、`gitGraph` 296-298、`gitCreateBranch` 299-301、`gitSwitchBranch` 302-304、`gitPruneMergedBranches` 305-307、`listAbandoned` 308-310、`restoreAbandoned` 311-313）均为同一模式：`withHostLanguage(locale ?? languageFromSettings(agent.ctx))` 包裹 controlPlane 调用。

#### `console-remote/` — strict zod 契约与描述符

- `schemas.js`：基础 schema（`sessionIdSchema` 5、`checkoutIdSchema` 6、`commitMessageSchema` 8、`oidSchema` 11-15、`branchNameSchema` 19-21 等）；`capabilitiesSchema`（54-76）——`returnToLocal` 用 `.default(false)` 而非 `optional()`（70-75 注释：**新增能力位缺失不得让整条 `current` 校验失败**）；`targetSummarySchema`（92-125）、`targetDetailsSchema`（174-180）、`consoleErrorSchema`（187-196，continuation 仅允许 `apply_conflict`，192-195）、`outcomeSchema`（197-202）、`preflightSchema`（269-282）、`previewRecoveryProofSchema`（311-328）等全部响应 schema。
- `descriptors.js`：`strictCodec`（7-11，DSH 0.2 走 `create()`，保留 legacy `schema` 字段）、`agentParameter`（12-18）、`json`（19-27）、`descriptor`（28-38）；`WORKTREE_CONSOLE_DESCRIPTORS`（39-191，40 个方法的参数/结果 strict 编码）；`WORKTREE_CONSOLE_REMOTE`（192-195）。
- `remote.d.ts`：`TypertRemoteMap` 对 `gitWorktree/*` 全部方法的线类型声明。

#### `host-compat.js`

`workspaceClientFlavorForAgentVersion`（4-27，pinned 版本映射 + `0.2.x` 一律 modern、`0.1.x` 三代/`0.3+` unsupported）；`isModernGeneration`（28-31）；`agentVersionFromAnchor`（32-43）；`workspaceFlavorDiagnostics`（52-63，anchors 顺序 entry→cwd→plugin——link: 安装下插件自身 node_modules 会遮蔽宿主树，46-50 注释）；`hostWorkspaceClientFlavor`（64-66）。

#### `workspace-provider-lifecycle.js`

`mountWorkspaceProviderLifecycle(ctx, flavor?, options?)`（44-293）：未启用（55-58）或 unsupported 代际（59-62）直接返回官方 Workspace 存活。核心选举：Loader 侧 `entry.update({disabled: true})` 普通布尔禁用 + `ownedDisables` WeakSet 跨代所有权（17，13-16 注释）；每个操作 10s 天花板（9，`operate` 108-154）；`reconcile` 由 `internal/status`/`internal/plugin` 事件驱动重入（251-260）；卸载时恢复 adopted 条目（185-243）。**选举绝不阻塞插件激活**（35-42 注释）。

#### `i18n/`

- `core.js`：`normalizeLanguage`（1-3，`en*`→en 否则 zh）；`createTranslator`（4-9，`{name}` 插值，未知参数保留原样）。
- `host.js`：`AsyncLocalStorage` 每次调用一个不可变 locale 快照（5）；`currentHostLanguage`（6-8）、`withHostLanguage`（9-11）、`languageFromSettings`（13-24，只读公开 settings seam）、`languageForInvocation`（26-29）、`hostMessage`（30-33）。
- `host-messages.js`：`hostMessages`（2-1752，全部 zh/en 文案，键稳定、用户数据只作插值）；`hostRegistrationMessage`（1754-1756，双语拼接，用于注册元数据）；`hostPersistedCleanupMessage`（1763-1766，持久化清理消息的有限白名单投影，1757-1761 注释）。

### 浏览器客户端 `lib/client/`

#### 入口与基础

- `index.js`：`WORKTREE_CONSOLE_ADAPTER_SERVICE='worktreeConsole'`（13）；`inject`（15，`['slots','workspaces','sessions','conversation','connection','locale']`）；`servicesOf`（16-24）；`apply(ctx, adapterOverride?)`（26-67）——`localizedSlots` Proxy（30-36，包一层 `ClientI18nProvider`）、自标签 `<style>`（44-54，避免被其他模块的 claimStyles 认领）、注册 `worktree_create`/`worktree_ready_for_review` 两个 ToolView（55-58）、adapter 存在时注册 `registerTargetConsole` + `registerPreSessionWorktree`（60-66）。
- `i18n.js`：`readClientLanguage`（13-20）、`clientTranslator`（21-23）、`defaultClientTranslator`（24）、`ClientI18nProvider`（26-33，`useSyncExternalStore`）、`useClientLanguage`/`useClientTranslator`（34-38）、`translatorForServices`（40-42，命令式服务在调用时解析语言）。
- `model.js`：`parseCreateTool`（35-54，严格校验 `worktree_target_created` payload）、`reviewArgs`（55-90）、`parseReviewTool`（91-126，payload 与 args 双重校验）。
- `actions.js`：`navigateToSession`（11-18，优先 `uiWorkspace.openSession`）、`selectedSessionId`（20-29，retainedBy 契约）、`openExistingSession`（31-37，cwd 证明后才导航）、`waitForProjectedSessionPath`（38-78，2s 超时订阅投影）、`openIsolatedTarget`（80-111，幂等：建 Workspace→建预分配 Session→等 cwd 投影→导航）、`openAuthorizedWorktreeTarget`（116-139，先 `adapter.inspect` 验 checkout/owner 身份）、`prefillSessionDraft`（141-147，**绝不代发**）、`finalizeCurrentSession`（149-162，把验收卡确认转成显式 `/worktree finalize` 命令）。
- `WorktreeCreateRow.js`（7-41）/ `WorktreeReviewRow.js`（13-91，`services` prop 仅为兼容保留，5 行 `.d.ts` 注释；`target_unselected` 错误静默渲染 null，78-79）。

#### `client/console-remote/`

- `adapter.js`：`createWorktreeConsoleRemoteAdapter(remote, getLanguage)`（49-128）——每个方法 `invoke`（51-85）：locale 规范化、客户端侧超时竞速（FAST 30s / SLOW 180s，27-28；`FAST_METHODS` 31-36）、codec 拒绝识别（17-20）、成功结果过 `descriptor.result.create().parse`（79-84）。
- `index.js`：`inject`（40-44）——从官方 Workspace 注入清单中**剔除 `remote.directoryPicker` 与 `remoteAccess`**（18-31 注释：避免 web 启动死锁/rc.2 永久 pending），追加 `slots`/`configForms`（25-30 注释：cordis 只有本 fiber 声明的名字才解析得出）；`apply(ctx)`（46-180）：挂 remote 贡献→提供 `worktreeConsole` adapter→`sidebarTopology()` 探测 `workspaceClientFlavor`→按 flavor 分支 legacy/modern/alpha/next（officialWorkspaceActive=true 时走装饰分支 `registerDecoratedWorkspaceSidebar`，否则 `registerManagedWorkspaceSidebar` + 官方 apply），全程 `reportBoot` 面包屑（69-83）。

#### `client/review-console/`

- `request-cache.js`：`createRequestCache`（11-104）——每 adapter WeakMap、身份键、single-flight、generation 失效（2-9 注释）。
- `preflight-cache.js`（2-15）/`preview-recovery-cache.js`（2-15）：两个身份键只读缓存；**写前必须 force**（12/13 注释）。
- `recovery-continuation.js`（493 行）：恢复请求队列。`validRequest`（88-117，严格字段白名单）、`targetMatchesRequest`（142-171，Host 目标与请求逐字段比对）、`sessionReady`（182-196）、`attempt`（222-325，**发送前即刻二次 inspect**，265-266 注释）、`buildWorktreeRecoveryPrompt`（326-334）、`enqueueWorktreeRecovery`（336-370，localStorage 持久化 18-38）、`restoreWorktreeRecovery`（371-429）、`retryWorktreeRecovery`（430-441，cancelled 也允许重发，432 注释）、`useWorktreeRecoverySnapshot`（450-458）、`cancelWorktreeRecovery`/`detachWorktreeRecoveryRuntime`/`clearWorktreeRecovery`（460-492）。
- `ReviewActions.js`（42-892）：评审动作中枢——preflight 驱动的 `previewLocal`（369-402）、`checkpoint`（410-449，requestId=`checkpoint:<generation>` 15-17）、`resumeRevision`（450-470）、`rollbackPreview`（471-537，detached 态先取 fresh recovery proof 474-504）、`submitCommit`（538-612，finish/finalize_preview 双模式）、`discard`（613-637）、冲突恢复 `startConflictRecovery`（197-282）、评审再生成 `startReviewRegeneration`（283-340）、detached 恢复的 `analyzeRecovery`（656-712，向 owner 会话队列只读分析 prompt 699-703）与 `handoffRecovery`（713-774，新 worktree 交接）、`retryCleanup`（775-794）、`openHolder`（795-815）；默认保留冻结环境 `DEFAULT_RETAIN_ENVIRONMENT = true`（37-41）。
- 其余：`WorktreeReviewPanel.js`（`reviewIsStale` 21-32、面板 33-42）、`PreflightStatus.js`（`statusLabel` 7-15、组件 16-40）、`ReviewDetailsModal.js`（`validationText/validationIcon` 6-11、焦点陷阱 24-55、可折叠列表 13-20、弹窗 21-65）、`DeliveryProof.js`（17-34，交付证据卡）、`ReviewIcon.js`（icons 表 3-10、组件 11-14）、`index.js`（`reviewEvidenceFromTarget` 3-10、`reviewIdentityFromTarget` 12-21）、`status-events.js`（`WORKTREE_REVIEW_REFRESH_EVENT` 1、`requestWorktreeReviewRefresh` 3-5）。

#### `client/target-console/`

- `TargetStatusAction.js`（31-631）：会话头部的目标胶囊 + 弹出菜单。状态标签 `STATE_LABELS`（14-26）；probe 订阅（96-115，失败时 tooltip 带 code+message，107-112 注释）；`not_git_repository` 是正常答案，有专属标签与 `initialize` 出口（117-125 注释）；`switchBranch`（162-208，**乐观补丁即最终态**，183-185 注释）、`createBranch`（209-245）、`initializeRepository`（246-280）、prune 预览/确认（281-339）、`retryCleanup`（340-377）、`beginNextIteration`（378-407）、`returnToLocal`（408-437）、`discard`（438-479）；分支列表 >12 项启用过滤框（481-501）。
- `branch-overview-cache.js`：模块级 TTL 60s 缓存（12-15）；`patchEpochs` 保证 flight 解析不回写覆盖乐观补丁（8-10 注释，`fetchOverview` 37-65）；`ensureBranchOverview`（71-76，fresh-on-demand）、`refreshBranchOverviewInBackground`（78-85，stale-while-revalidate）、`patchBranchOverview`（30-36）、`invalidateBranchOverview`（25-28）。
- `current-polling.js`：`Poll` 类（15-103）——引用计数共享（首个订阅启动、最后一个释放 39-65）、隐藏文档降频至 60s（4-9 注释，`HIDDEN_DELAY` 10）、generation 防串台（66-73）；`subscribeCurrent`（105-120，adapter×session×language 键隔离）。
- `WorktreeConsoleView.js`（54-453）：完整管理面板（当前目标/列表/过滤/放弃确认/恢复快照条）；`ATTENTION_RANK` 排序（40-52）；`applyMutation`（151-171）、`openListedTarget`（399-424，走授权路径）。
- `WorktreeHeroChip.js`（70-124）：空白会话 hero 行的胶囊 portal；`resolvePortalRenderer`（5-21，react-dom 懒解析，缺省降级不炸包）；`findHeroRowFrom`（34-63，DOM 结构优先 + 有界轮询回退）。
- `WorktreeReviewStatus.js`（13-107）：composer 上方的紧凑交付状态条；独立恢复状态卡（58-65）；轮询订阅（39-57）。
- `BranchGraphModal.js`：`mergeRefs`（9-28，foo+origin/foo 合并徽章，tag 永不与同名分支合并）；`computeGraphLanes`（36-106，lane 拓扑移植，quiet lane 最左复用 44-66）；`BranchGraphModal`（141-183，SVG 渲染 + 分页加载 `INITIAL_LIMIT=200`/`PAGE_STEP=100`，111-112）。
- `TagManagerModal.js`（9-139）：标签管理；每次 mutation 后重读列表（4-8 注释）；**错误不得被重载抹掉**（23-27 注释）；push 失败是可报告结果而非 mutation 失败（125-128）。
- `WorktreeManagerModal.js`（6-9）：`WorktreeConsoleView` 的弹窗封装。`index.js`（6-26）：注册 `conversation.session.header.actions`（order 30）与 `conversation.input.dock` 两个 seat（review-status order 10、hero-chip order 20）。

#### `client/pre-session/`

- `harness-input.js`：`readHarnessInput`（1-6，`attachmentIds`↔`imageIds` 兼容）、`adaptHarnessInputActions`（8-17，**经原 receiver 绑定**，目标 input 可能是类实例）。
- `controller.js`：`PreSessionWorktreeError`（4-11，`recoveryRequired` 字段）；`sourceStillMatches`（18-26，确认时快照 vs 实时输入的 CAS）；`PreSessionWorktreeController`（32-188）：`prepare`（40-50，按 sessionId single-flight）、`run`（51-153）——blocking block（69-71）→`create/createWithInitialCommit`（78-80）→建 Workspace/Session（84-96）→`handoff`（98-117，**从最终源 CAS 到导航/清空无任何 await**，106-108 注释）→`using()` 持有引用（121-126）→归档源会话（132-135）→失败回滚 `rollback`（154-187，双 caller 尝试 discard + 幂等 archive + 删 Workspace）。
- `PreSessionWorktreeToggle.js`（23-158）：空白会话 composer 工具行的开关；scopeRef 渲染期失效（33-40 注释）；确认对话框（empty 令牌单次有效，148 注释）。
- `index.js`（6-22）：注册到 `conversation.input.left`（order 40）；blank 判定与 Harness conversationPhase 对齐（9-12 注释）。

#### `client/settings-card/`

- `form-model.js`：`settingsBooleanField`（27-42）/`settingsNumberField`（49-63）/`settingsTextField`（70-79）三种字段转换 spec；`SettingsFormModel`（87-263）——staged 编辑模型：`bind`（110-114，snapshot store）、`shell`（119-130）、`field`（136-148，overridden 由 user 层**存在性**而非值比较判定，16-18 注释）、`actions`（153-169）、`save`（178-200，revision 围栏 mutate，失败保留草稿）、`plan`（208-228）、`dispose`（202）。模块头注释（1-18）说明这是 harness settings-form 的自包含裁剪版。
- `worktree-settings-card.js`：`WORKTREE_SETTINGS_NS='dsh-git-worktree'`（3）；`WorktreeSettingsCardController`（4-31，五个字段 spec、`projection` 17-26、`inject` 27-29）。
- `WorktreeSettingsCard.js`（99-136）：内联样式的自包含表单（`view==='summary'` 只出一行简介，102-103）。
- `index.js`：`mountSettingsCard(ctx)`（17-39）——`ctx.get` fail-soft 读 `configForms`/`slots`（20-23）；`whileServed` 期间注册到 `plugins.bundle.config` slot（30-38，`plugins.item` 是官方列表槽，不会显示第三方卡片）。

#### `client/workspace-sidebar/`

- `model.js`：`sidebarBadgeTasks`（11-36，按 owner 去重取最新 iteration/revision）；`projectManagedWorkspaceSidebar`（42-163）——把每个 Managed Checkout 的 owner 会话合并回原 Local 项目；歧义成员关系 fail-open（37-41 注释）；`memberships` 存在的项目走目录归属路径（104-153）。
- `index.js`：`ManagedOfficialWorkspaceBrowser`（34-154，保留官方 Browser 仅替换数据投影并封锁不安全的 startSession/forkSession/insertSessionBefore）；`officialContextProxy`（178-251，slot 注册拦截：非 owner-safe 会话动作按 guard 折叠为 null 192-206；`sidebar.workspaces` 条目替换为受管 Browser 207-211；`remote.directoryPicker` 延迟解析 221-232；`remoteAccess` stub 233-246）；`registerManagedWorkspaceSidebar`（257-259）；`registerDecoratedWorkspaceSidebar`（369-402，Mode B：官方 Browser 存活时经 `sidebar.session.row.leading`/`sidebar.session.row.hover` 两个真实 seat 注入身份徽章，308-320 注释解释了为何**不存在 trailing seat**）；`ClearSidebarBadgeMenuItem`（265-299）+ `registerClearSidebarBadgeEntry`（300-307）。

## Architecture

```text
┌──────────────────────────────────────────────────────────────────────┐
│ 插件入口 lib/index.js apply() (136-230)                               │
│  Config(volatile) ► 适配器装配 ► 定时维护(reconcile/保留期/自动剪枝)   │
└──────┬───────────────────────────────┬───────────────────────────────┘
       ▼                               ▼
┌───────────────────────┐   ┌─────────────────────────────────────────┐
│ 适配器 lib/adapters/   │   │ 领域引擎 lib/session-checkout-apply.js   │
│  git.js + files.js    │──►│ DefaultSessionCheckoutApplyEngine        │
│  registry.js+safe-file│   │ plan/apply/preview/rollback/finish/      │
│  lookup.js/working-dir│   │ checkpoint/commitIsolated (588-1721)     │
│  project-skills.js    │   └─────────────────────────────────────────┘
└──────────┬────────────┘
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 服务面: console-host/service.js(RPC) ► control-plane.js(授权/投影)    │
│   tools.js(模型工具) │ commands.js(/worktree) │ session-target-context│
└────────────────────────────────┬─────────────────────────────────────┘
                                 ▼  Typert Remote + strict zod 描述符
┌──────────────────────────────────────────────────────────────────────┐
│ 浏览器 lib/client/: console-remote/adapter.js ► review-console /      │
│   target-console / pre-session / workspace-sidebar / settings-card   │
└──────────────────────────────────────────────────────────────────────┘
```

分层约束：领域引擎只依赖 `ports`（宿主无关）；适配器把 DSH/Cordis 特性（`ctx.subprocess`、`workspaceRegistry`、volatile 配置）挡在端口后面；console-contract 是 Host/Client 唯一共享面（`console-contract.d.ts:118-126` 明示不含 Cordis/React/Remote/文件系统实现）。

## Data Flow

### 1. 插件挂载（`lib/index.js:136-230`）

1. `validateGitTimeouts(config)`（137）→ `mountWorkspaceProviderLifecycle`（141，默认不接管）。
2. 建 `stateDir` 与禁 hooks 目录（142-145）；`worktreesRoot` 包装为 live 引用（148-151）。
3. 装配端口：`lookup`（152）、`ProjectSkillStore`（153）、`createDshGitPort`（154）、`createNodeFilesPort`（155）、`AtomicJsonCheckoutRegistry`（156）；`mountProjectSkillProvider`（157）。
4. `createSessionCheckoutModule({...})`（158-173，状态机在 `session-checkout-module.js`）。
5. `new WorktreeConsoleService(ctx, createWorktreeConsoleControlPlane({...}))`（174-181，diag 文件 `sidebar-diag.ndjson`）。
6. `registerTools` / `registerWorktreeCommand` / `registerSessionTargetContext`（182-184）。
7. `ready` 事件 → `module.reconcile()` + `enforceWorktreeKeepCount`（188-199）；15 分钟保留期定时器（200-207）；每日自动剪枝（208-223）；卸载 effect 统一清理（224-229）。

### 2. Worktree 创建（`worktree_create`）

`tools.js:105-133` → `module.createIsolatedTarget`（分配独立 targetSessionId）→ `git.createDetachedWorktree`（`git.js:325-336`：Project Skills 预检 + deadline）→ `worktree-creation.js:createWorktree`（12-148，见 Key Components §files 同级小节：独占占位→`worktree add --lock`→`read-tree`/`checkout-index`→逐级身份与指纹验证）→ 会话分支挂接 `attachWorktreeBranch`（`git.js:401-415`，CAS update-ref）→ `tools.js:enterCheckout`（117，`workingDirectory.enter` 真正把会话搬进去；宿主无服务则返回 `undefined` 走引导路径）。

### 3. 评审与交付（两条路径）

**A. 会话分支交付（模型驱动）**：`worktree_ready_for_review`（`tools.js:279-364`）冻结评审快照 → 用户/模型 `worktree_deliver`（`tools.js:365-467`）：先 `leaveCheckoutBeforeRemoval` → `module.operate({action:'finish'})` → 引擎 `commitIsolated`（`session-checkout-apply.js:910-986`）把工作区提交到会话分支（**Local 的工作区/索引/HEAD 全程不动**）→ 清理 + 可选 `git.pushBranch`（`git.js:416-433`，绝不 force）。

**B. Console 验收（人驱动）**：Client `ReviewActions.previewLocal`（`ReviewActions.js:369-402`）→ adapter → `control-plane.preview`（`control-plane.js:1008-1031`）→ 引擎 `preview`（1133-1218，receipt 先持久化再写 Local）；之后 `rollbackPreview`（引擎 `rollback` 1249-1315）或 `finalize/finalizePreview`（引擎 `finalize` 1316-1522，index.lock 协议 + 三级补偿回滚）。

### 4. Console RPC 链路

Client `invoke`（`adapter.js:51-85`）→ `remote.gitWorktree.<method>` → 宿主 `WorktreeConsoleService.<method>`（`service.js`，`withHostLanguage` 包裹）→ `control-plane` 端点（`authorize`/`verifyCallerRoot` → `module.operate`/管理方法 → `mutationResponse`/`details` → `projectRecord/projectDetails/projectReviewSlot` 投影）→ `{ok, value|error}` outcome → Client 侧 `schemas.js` strict parse（`adapter.js:79-84`）。

### 5. 注册表持久化

`registry.js:read()`（385-397）：`readJsonFileSafe`（`safe-file.js:106-154`，主文件→tmp 残留→`.bak` 三级容错）→ `isRegistry` 严格校验 → v1 走 `migrateLegacyRegistry`（325-378）→ 损坏 loud fail `registry_corrupt`。`write()`（398-401）：`writeJsonFileAtomic`（`safe-file.js:79-95`，唯一 tmp + 原子 rename + `.bak` 备份）。

### 6. 运行时上下文与分支竞态守卫

每次系统提示装配：`session-target-context.js:20-31` → `module.runtimeContext(sessionId, liveCwd)`（同步）；后台每 45s `refreshBranchRaceGuards`（12-19）收集各 Local 根的分支创建时间（`git.branchCreationTimes`，`git.js:504-527`，读 reflog）；`detectLocalBranchRace`（`concurrent-session-guard.js:28-49`）判定「更早的同根会话 × 窗口内新分支」后，把「先用 worktree_create 隔离」写进上下文。

## Connections

- [[session-checkout-module]] —— 状态机模块工厂，`lib/index.js:29` 引入；本文覆盖其全部端口依赖（lookup/git/files/registry/applyEngine，`lib/index.js:158-173`）。
- [[session-checkout-apply]] —— 领域引擎 `lib/session-checkout-apply.js` 的独立详解入口。
- [[adapters]] —— `lib/adapters/` 各端口实现（files/git/lookup/registry/safe-file/working-directory/project-skills/worktree-creation）。
- [[client]] / [[console-host]] / [[console-remote]] —— 浏览器表面、宿主 RPC 实现与 strict 契约。
- [[tools]] / [[commands]] —— 模型工具与 `/worktree` 命令的参数/输出细节。
- [[i18n]] —— `hostMessage`、`withHostLanguage`、`hostRegistrationMessage` 的使用规则。
- [[types]] / [[ports]] —— 错误码表、`ManagedCheckoutRecord`/`WorktreeConsoleTargetSummary` 等数据模型。
- [[host-compat]] / [[workspace-provider-lifecycle]] —— 宿主代际探测与 Workspace 提供者选举。

## Known Issues

1. **safe-file 无跨进程锁**：`lib/adapters/safe-file.js:76-77`（ponytail 注释）——唯一 tmp + 原子 rename 已消除「tmp 互踩」与「半写提升」，但文件级 last-writer-wins 仍在；需要强一致时才引入 lock 文件。
2. **apply 路径 git 超时 30s**：`lib/session-checkout-apply.js:37-39`——与 `git.ts` 的 120s 默认不同，apply 命令假定很短，可用 `options.timeoutMs` 覆盖。
3. **禁 hooks 临时目录不清理**：`lib/session-checkout-apply.js:29-36`——模块级懒创建的 `dsh-disabled-git-hooks-*` mkdtemp 目录从不删除。
4. **plans Map 单槽**：`lib/session-checkout-apply.js:1053-1059`——同一 isolated checkout 的新 plan 会顶替旧的，防止 Map 随重复计算增长。
5. **第三方错误文案泄漏天花板**：`lib/console-host/errors.js:21-24`——本地 Console 故意原样透出第三方错误便于排查（有测试锚定）；一旦出现远程传输必须先脱敏。
6. **Web RPC 无服务端超时**：`lib/client/console-remote/adapter.js:31-38`——绑定锁队列/挂死的 git 会让请求永久 pend，客户端以 30s（快路径）/180s（慢路径，`FAST_METHODS` 31-36）自行失败；服务端继续跑，变更类调用可安全重试。
7. **与官方实验 worktree 服务的有意分歧**：`lib/adapters/git.js:15-22`——不做 `sandbox.confine`：受管 checkout 在会话工作区之外，workspace-write 限制会拒绝插件被要求创建的目录；文件策略仍由宿主自身工具执行。
8. **name-status R/C 折叠**：`lib/console-host/review-diff.js:78-80`——契约没有 'copied' 状态，copy 语义并入 'renamed'。
9. **隐藏窗口轮询降频**：`lib/client/target-console/current-polling.js:4-10`——`document.hidden` 时轮询 60s 一次（后台 GUI 也要花 `git status` + 2 次 rev-parse）；该观察仅用于显示，绝不授权变更或 Git 清理（14 行注释）。
10. **分支总览缓存的纪元护栏**：`lib/client/target-console/branch-overview-cache.js:8-10` 与 48-53——flight 解析时若 patch/invalidate 已自增纪元则不得回写，否则会踩掉 switch 确认后的乐观补丁；失败必须清槽避免陈旧快照带过期 TTL 展示（46-49）。
11. **设置页为自包含裁剪版**：`lib/client/settings-card/form-model.js:3-18`——harness `dsh-client-ui-primitives` 的 settings-form 模块晚于本插件，故裁剪自带；staged 文本只在自己保存时写入，overridden 以 user 层存在性判定。
12. **客户端 inject 清单的兼容性剔除**：`lib/client/console-remote/index.js:18-31` 与 40-44——`remote.directoryPicker`/`remoteAccess` 必须从注入中剔除（否则 web 启动死锁或 rc.2 永久 pending "waiting for service"），`slots`/`configForms` 必须显式声明（否则 `ctx.get` 永远 undefined，设置卡静默不挂载）。
13. **Workspace 选举的历史事故与 Loader 1.0.6 怪癖**：`lib/workspace-provider-lifecycle.js:19-42`（2026-10-17 两次崩溃源于客户端求值的 `!!js` disabled 表达式在两个不同步时刻结果相反）；`entry.update()` 不等待 dispose（116-121 注释）；`fiber.await()` 会在保留的失败 transition 上自旋（202-208 与 229-233 注释，2026-10-24 Windows 实测）。
14. **`inject` 必须具名导出**：`lib/index.js:40-45`——裸函数导出会无注入清单，首次 `ctx.tools` 访问直接报 "cannot get property without inject"。
15. **未提供的能力位必须缺省 false**：`lib/console-remote/schemas.js:70-75`——Client 与 Host 独立部署，旧 Host 不知道新键；写成必填会让整条 `current` payload 校验失败、胶囊塌成「不可用」。
16. **`gitOverview` 不预取**：`lib/client/target-console/TargetStatusAction.js:117-124`——胶囊对每个会话都挂载，而 `gitOverview` 需 3 次 git spawn；分支列表仅在首次展开弹出层时拉取。
17. **tag pushed 三态**：`lib/console-remote/schemas.js:394-402` 与 `lib/adapters/git.js:604-606`——`pushed: null`（远端不可查）不得被强转为 false 误报「未推送」。
18. **`services` prop 兼容保留**：`lib/client/WorktreeReviewRow.js`（`.d.ts` 第 5-6 行）——仅为现有 Client 注册器与历史 ToolView 兼容而保留；日志证据在没有它时仍可回放。