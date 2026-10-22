---
title: Session Checkout Apply Pipeline
type: module
source_files:
  - src/session-checkout-apply.ts
tags:
  - apply
  - merge
  - checkpoint
  - git-plumbing
---

## Overview

`src/session-checkout-apply.ts`（2680 行）是隔离会话的「搬运引擎」：把 Isolated Worktree 里的任务增量与 Local checkout 的当前状态做三方合并，并在会话分支交付或 Preview/Apply 流程中写回目标仓库。对外导出三个符号：

- `SessionCheckoutApplyEngine` 接口（src/session-checkout-apply.ts:278-316）
- `DefaultSessionCheckoutApplyEngine` 实现类（src/session-checkout-apply.ts:1174-2674，非导出，仅经工厂可见）
- `createSessionCheckoutApplyEngine(options?)` 工厂（src/session-checkout-apply.ts:2676-2680）

三条设计主线贯穿全文件：

1. **合并计算永不污染真实仓库**：所有 merge 都在 `mkdtemp` 出来的临时 object 目录与临时 checkout 里计算（`gitObjectEnvironment`，src/session-checkout-apply.ts:492-500；`computeMerge`，src/session-checkout-apply.ts:705-801），源仓库只被读取。
2. **Local 的每一次写入之前都必须有持久化证据**：`preview.beforeWrite`、`rollback.beforeWrite`、`finalize.beforeCommit`、`checkpoint.beforeCommit` 四个回调把 journal 持久化插在真实写入之前（src/session-checkout-apply.ts:299、306-307、313-314、168-169）。
3. **两条语义互斥的收口路径**：会话分支交付（`commitIsolated`，src/session-checkout-apply.ts:1972-2063）**完全不碰 Local**；历史遗留的 Local 写入三段路径（`plan`→`preview`→`finalize` 与 `plan`→`apply`→`finish`）仍保留在文件中，供 Apply/Preview 路径与历史记录收口使用。

各入口的读写范围：

| 场景 | 入口方法 | 是否读写 Local |
| --- | --- | --- |
| 会话分支交付（当前交付路径） | `reviewIsolated` + `commitIsolated` | 完全不读不写 |
| 评审快照（带 Local 侧校验的旧路径） | `inspectReview` | 只读 Local（解析其 git root、比对 object 目录与前缀） |
| 提交前 checkpoint（Managed Worktree 内） | `checkpoint` / `recoverCheckpoint` | 只写 Worktree，不碰 Local |
| Preview / Rollback / Finalize（旧三段路径） | `preflight`/`plan` → `preview` → `finalize`，另加 `rollback`、`assessPreviewRecovery` | 写 Local |
| 直接 Apply（旧三段路径） | `preflight`/`plan` → `apply` → `finish` | 写 Local |

引擎本体无外部状态，唯一的进程内状态是计划表 `plans: Map<string, StoredPlan>`（src/session-checkout-apply.ts:1175）：`plan()` 把补丁、计划与 scope 存进 Map（src/session-checkout-apply.ts:1616-1618，内部调用 `calculatePlan`），`apply()`/`preview()`/`finish()` 用它做 CAS 复验（`planMatches`，src/session-checkout-apply.ts:928-939），成功后删除（src/session-checkout-apply.ts:1811、1949、2473、2644）。`preflight()` 走同一条计算但 `persistPlan=false`（src/session-checkout-apply.ts:1612-1614），因此不产生可执行计划。

## Key Components

### 计划与结果类型

- `ApplyPlanInput`（src/session-checkout-apply.ts:13-17）：`baseOid`（会话配置的基线 commit）、`isolatedPath`（Worktree 内项目目录）、`localPath`（Local 项目目录）。
- `ApplyPlan`（src/session-checkout-apply.ts:19-30）：`revision`（`randomUUID()`，src/session-checkout-apply.ts:1685）、`localFingerprint`、`isolatedFingerprint`、`effectiveBaseOid`、`baseStrategy`、`localHeadOid`、`localHeadRef`（`string | null`，注释说明 null 表示 Local 处于 detached HEAD，Apply 允许而 Finish 拒绝自动提交）、`isolatedHeadOid`、`changedFiles`。
- `ReviewSnapshotResult`（src/session-checkout-apply.ts:32-37）：`{status:'ready', isolatedFingerprint, isolatedHeadOid, changedFiles}`——Worktree 侧指纹 CAS 的唯一来源。
- `InspectReviewResult = ReviewSnapshotResult | ApplyPlanErrorResult`（src/session-checkout-apply.ts:39）。
- `ApplyReadyPlanResult`（src/session-checkout-apply.ts:41-44）`{status:'ready', plan}`；`ApplyConflictPlanResult`（src/session-checkout-apply.ts:46-59）额外带 `conflictingFiles` 与可选 `conflictDetails: ApplyConflictDetail[]`，并携带**冲突计算时的真实 `localHeadOid`**，让隔离会话能在当前 Worktree 内同步并就地解冲突；`ApplyPlanErrorResult`（src/session-checkout-apply.ts:61-64）；三者联合为 `ApplyPlanResult`（src/session-checkout-apply.ts:66）。
- `ApplySuccessResult`（src/session-checkout-apply.ts:68-73）：`{status:'applied', changedFiles, nextBaseOid}`，`nextBaseOid` 是不创建 ref 的内部 snapshot commit，只作后续 Apply 的基线；`ApplyResult = ApplySuccessResult | ApplyErrorResult`（src/session-checkout-apply.ts:80）。

### 会话分支交付

- `CommitIsolatedInput`（src/session-checkout-apply.ts:82-91）：`isolatedPath`、`baseOid`（变更集基准，`changedFiles` 报告 `baseOid..新提交`，提交本身总是接在 Worktree HEAD 之后）、`commitMessage`、`excludePaths?: string[]`（Worktree 相对 pathspec，永不被纳入提交的宿主运行期产物）、`branchRef?: string | null`（交付目标分支；给出时校验 Worktree HEAD 确在该分支上，否则拒绝提交）。
- `CommitIsolatedSuccess`（src/session-checkout-apply.ts:93-103）：`commitOid`（Worktree 与 HEAD 原本一致时为 HEAD 本身且 `created=false`）、`changedFiles`、`isolatedFingerprint`（提交之后的干净 HEAD 指纹，供清理阶段 CAS）、`branch`（`refs/heads/…`，仍 detached 时为 null）、`created`。
- `CommitIsolatedResult = CommitIsolatedSuccess | ApplyErrorResult`（src/session-checkout-apply.ts:105）。
- `ReviewIsolatedInput`（src/session-checkout-apply.ts:107-111）：`isolatedPath`、`baseOid`、`excludePaths?`；`ReviewIsolatedResult = ReviewSnapshotResult | ApplyErrorResult`（src/session-checkout-apply.ts:113）。

### 结束与预览

- `FinishSuccessResult`（src/session-checkout-apply.ts:116-123）：`changedFiles`、`commitOid`（`null` 表示 Worktree 与 Local 已一致、未创建空提交）、`nextBaseOid`；`FinishResult = FinishSuccessResult | ApplyErrorResult`（src/session-checkout-apply.ts:125）。
- `PreviewReceipt`（src/session-checkout-apply.ts:127-146）十七个字段：`previewId`、`reviewId`、`iteration`、`previewedAt`（`Date.now()`，src/session-checkout-apply.ts:1905）、`configuredBaseOid`、`effectiveBaseOid`、`baseStrategy`、`localHeadOid`、`localHeadRef`、`localFingerprintBefore`、`localFingerprintPreview`（构造时先填 `''`，写入成功后回填，src/session-checkout-apply.ts:1912 与 1950-1953）、`localWorkingTreeOid`、`localIndexTreeOid`、`previewWorkingTreeOid`、`isolatedHeadOid`、`isolatedFingerprint`、`isolatedSnapshotOid`、`changedFiles`。
- `PreviewSuccessResult`（src/session-checkout-apply.ts:148-152）、`PreviewResult`（src/session-checkout-apply.ts:154）、`RollbackSuccessResult`（src/session-checkout-apply.ts:156-159，status 固定 `'preview_rolled_back'`）、`RollbackResult`（src/session-checkout-apply.ts:161）。

### Checkpoint 与 Preview 恢复评估

- `CheckpointInput`（src/session-checkout-apply.ts:163-170）：`isolatedPath`、`expectedFingerprint`、`expectedHeadOid`、`commitMessage`、可选 `beforeCommit(prepared: {commitOid, parentOid, indexTreeOid, changedFiles})`——注释说明它在 detached HEAD/index 变更**之前**持久化已准备的提交与 Host journal。
- `CheckpointSuccessResult`（src/session-checkout-apply.ts:172-178）`{status:'checkpointed', commitOid, parentOid, changedFiles, isolatedFingerprint}`；`CheckpointResult`（src/session-checkout-apply.ts:180）。
- `CheckpointRecoverySuccessResult`（src/session-checkout-apply.ts:182-185）：`status` 取 `'checkpoint_recovered' | 'checkpoint_aborted'`，附 `isolatedFingerprint`；`CheckpointRecoveryResult`（src/session-checkout-apply.ts:187）。
- `PreviewRecoveryActionBlockCode`（src/session-checkout-apply.ts:189-193）：`stale_local` / `preview_modified` / `commit_isolation_conflict` / `operation_not_allowed`。
- `PreviewRecoveryBlockedAction`（src/session-checkout-apply.ts:195-200）：`{status:'blocked', code, message, conflictingFiles?}`。
- `PreviewRecoverySafeRollback`（src/session-checkout-apply.ts:202-205）：`targetTreeOid`。
- `PreviewRecoverySafeFinalize`（src/session-checkout-apply.ts:207-213）：`taskTreeOid`、`finalIndexTreeOid`、`expectedWorkingTreeOid`、`commitRequired`。
- `PreviewRecoveryAssessment`（src/session-checkout-apply.ts:215-224）：`localFingerprint`、`localHeadOid`、`localHeadRef`、`localHeadTreeOid`、`localIndexTreeOid`、`localWorkingTreeOid`、`rollback`、`finalize`。

### 错误类型（八码）

| 接口 | 行号 | code |
| --- | --- | --- |
| `InvalidInputApplyError` | src/session-checkout-apply.ts:226-229 | `invalid_input` |
| `InvalidPlanApplyError` | src/session-checkout-apply.ts:231-234 | `invalid_plan` |
| `StaleLocalApplyError` | src/session-checkout-apply.ts:236-239 | `stale_local` |
| `StaleIsolatedApplyError` | src/session-checkout-apply.ts:241-244 | `stale_isolated` |
| `GitApplyError` | src/session-checkout-apply.ts:246-251 | `git_error`，带可选 `recoveryState?: 'unchanged' \| 'uncertain'`（Host 只有拿到 `unchanged` 才可清 planning journal） |
| `CommitIsolationApplyError` | src/session-checkout-apply.ts:253-256 | `commit_isolation_conflict` |
| `OperationNotAllowedApplyError` | src/session-checkout-apply.ts:258-261 | `operation_not_allowed` |
| `PreviewModifiedApplyError` | src/session-checkout-apply.ts:263-266 | `preview_modified` |

八者联合为 `ApplyError`（src/session-checkout-apply.ts:268-276）。

### 引擎接口与注入点

`SessionCheckoutApplyEngine`（src/session-checkout-apply.ts:278-316）方法清单：

| 方法 | 行号 | 说明 |
| --- | --- | --- |
| `inspectReview(input)` | 279 | 带 Local 侧校验的评审快照 |
| `checkpoint(input)` | 280 | Worktree 内 checkpoint |
| `recoverCheckpoint(input)` | 281 | 中断恢复；入参 `{isolatedPath, commitOid, parentOid, expectedIndexTreeOid}` |
| `preflight(input)` | 283 | 复用真实 Apply merge 计算，但不持久化可执行计划、不修改任一 checkout |
| `plan(input)` | 284 | 同上但持久化到 `plans` |
| `apply(plan)` | 285 | 把已存补丁写进 Local 工作区 |
| `finish(plan, {commitMessage})` | 286 | 建提交 + 保留 staged + 推 ref |
| `commitIsolated?(input)` | 291 | 可选方法；会话分支交付，完全不读写 Local |
| `reviewIsolated?(input)` | 293 | 可选方法；只看 Worktree 的评审快照 |
| `preview(plan, options)` | 294-300 | options 含 `previewId`/`reviewId`/`iteration`/`beforeWrite(receipt)` |
| `assessPreviewRecovery({localPath, receipt})` | 302 | 严格只读的 Preview 恢复评估，不持久化可执行计划 |
| `rollback({localPath, receipt, beforeWrite?})` | 303-308 | 回滚预览，`beforeWrite` 在最终 Local CAS 之前 |
| `finalize({localPath, receipt, commitMessage, beforeCommit?})` | 309-315 | 预览转提交，`beforeCommit(commitOid)` 在 commit object 已建、branch ref 未更新时调用 |

`SessionCheckoutApplyEngineOptions`（src/session-checkout-apply.ts:318-328）：`projectSkills?: ProjectSkillStore`（319）与四个测试/宿主 seam——`beforeFinalLocalValidation`（321）、`afterLocalWriteBeforeVerification`（323）、`beforeFinalIsolatedValidation`（325）、`afterIsolatedWriteBeforeVerification`（327）。

### 内部类型

- `GitResult`（src/session-checkout-apply.ts:330-334）：`exitCode`、`stdout: Buffer`、`stderr: string`。
- `CheckoutSnapshot`（src/session-checkout-apply.ts:336-344）：`fingerprint`、`headOid`、`headRef`、`headTreeOid`、`indexTreeOid`、`treeOid`、`indexEntries: Buffer`。
- `ApplyScope`（src/session-checkout-apply.ts:346-351）：`isolatedGitRoot`、`localGitRoot`、`projectPrefix`、`sourceObjects`。
- `StoredPlan`（src/session-checkout-apply.ts:353-358）：`input`、`patch`、`plan`、`scope`。
- `MergeReadyResult`（360-365）/`MergeConflictResult`（367-371）/`MergeResult`（373）；`TreeMergeReadyResult`（375-378）/`TreeMergeResult`（380）。
- `GitCommandFailure extends Error`（src/session-checkout-apply.ts:668-675）：保留 `args` 与 `result`，消息取 stderr，为空时用本地化的 `gitExitedWithCode`。

### 内部函数：git 原语层

- `AMBIENT_GIT_ENV_PATTERN`（src/session-checkout-apply.ts:393）：匹配 `GIT_DIR`/`GIT_WORK_TREE`/`GIT_COMMON_DIR`/`GIT_INDEX_FILE`/`GIT_OBJECT_DIRECTORY`/`GIT_ALTERNATE_OBJECT_DIRECTORIES`/`GIT_NAMESPACE`/`GIT_CEILING_DIRECTORIES`/`GIT_DISCOVERY_ACROSS_FILESYSTEM`/`GIT_CONFIG_PARAMETERS`/`GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_*`/`GIT_CONFIG_VALUE_*`。
- `scrubbedAmbientGitEnv()`（src/session-checkout-apply.ts:395-401）：把命中的变量映射为 `undefined`，防止环境把 git 重定向到未授权仓库。
- `disabledGitHooksDirectory`（src/session-checkout-apply.ts:403）+ `disabledGitHooksPath()`（407-410）：进程级惰性 `mkdtempSync(join(tmpdir(), 'dsh-disabled-git-hooks-'))` 空目录，作为 `core.hooksPath` 禁用钩子。
- `GIT_TIMEOUT_MS = 30_000`（src/session-checkout-apply.ts:414）、`OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i`（415）。
- `runGit(cwd, args, options)`（src/session-checkout-apply.ts:417-479）：`spawn('git', ...)`，固定前缀 `--no-optional-locks`，win32 追加 `-c core.longpaths=true`，再加 `-c core.quotePath=false`、`-c core.fsmonitor=false`、`-c core.hooksPath=<空目录>`；env 为 scrubbed 环境 + `GIT_OPTIONAL_LOCKS=0`、`GIT_TERMINAL_PROMPT=0`、`LC_ALL=C`、`LANG=C`，`options.env` 最后合并（`GIT_INDEX_FILE` 等刻意注入口）。超时发 SIGTERM；`allowedExitCodes` 默认 `[0]`。
- `stdoutText`（481-483）、`parseNullSeparated`（485-490）。
- `gitObjectEnvironment(objectDirectory, sourceObjectDirectory)`（492-500）：`GIT_OBJECT_DIRECTORY` 指向临时目录，`GIT_ALTERNATE_OBJECT_DIRECTORIES` 拼接源 objects 与既有 alternates。
- `sourceObjectDirectory`（502-505）、`resolveGitRoot`（507-510）、`canonicalExistingPath`（512-518）。
- `projectPrefix`（520-526）：返回项目相对 git root 的前缀；越界（`..`、`../…`、绝对路径）返回 null。`isProjectPath`（528-530）、`toProjectPath`（532-534）。
- `pathsMatch`（920-926）：win32 下大小写不敏感比对规范化路径。

### 内部函数：合并计算层

- `isAncestor`（src/session-checkout-apply.ts:541-548）：`merge-base --is-ancestor`，允许 exit 0/1。
- `selectEffectiveApplyBase`（550-571）：recorded base 必须同时是 local HEAD 与 isolated HEAD 的祖先才允许 ancestry 前移；上次 Apply 的内部 snapshot 通常不在任一分支历史中，因此第二次 Apply 会保守走 `recorded_base`。三种 `ApplyBaseStrategy`：`recorded_base` / `isolated_contains_local_head` / `local_contains_isolated_head`。
- `changedTreePaths`（573-586）：`git diff --name-only -z --no-ext-diff --no-renames <base> <tree> --`。
- `snapshotFingerprint`（588-603）：`sha256(headOid \0 headRef||'DETACHED' \0 indexEntries \0 treeOid)`。
- `captureSnapshot(checkoutPath, indexPath, objectDirectory, sourceObjects, projectSkills?, excludes = deliveryExcludePathspecs())`（605-658）：见 Data Flow「计划与快照」。
- `createSnapshotCommit`（660-680）：`commit-tree`，作者/提交者固定 `Domi Apply <domi-apply@localhost>`，消息取 `label`。
- `collectConflictDetails`（683-703）：逐文件取差异，超 `CONFLICT_DETAIL_DIFF_LIMIT` 截断并附 `worktreeConflictDiffTruncated` 提示；超出 `CONFLICT_DETAIL_FILE_LIMIT` 的文件数追加一条汇总行（`worktreeConflictMoreFiles`）。
- `computeMerge`（705-801）：两侧 snapshot commit → 临时空仓库 → `checkout --detach` + `merge --no-commit --no-ff` → 冲突取 `diff --name-only --diff-filter=U -z`；ready 时产 mergedTree、binary patch 与 `changedFiles`，并用临时 central index 复算 `mergedTreeOid`。
- `computeTreeMerge(tempRoot, sourceObjects, objectDirectory, checkoutPath, label, baseTreeOid, oursTreeOid, theirsTreeOid)`（803-892）：纯 tree 三方合并，返回 `{status:'ready', treeOid}` 或冲突文件列表；用于任务增量剥离与 staged 恢复。
- `treePatch`（894-918）：两个 tree oid 之间的 binary patch。

### 内部函数：写盘与锁

- `planMatches`（src/session-checkout-apply.ts:928-939）：逐字段比对 revision、两个指纹、effectiveBaseOid、baseStrategy、localHeadOid、localHeadRef、isolatedHeadOid、changedFiles（含顺序）。
- `prepareIndexFromPatch`（941-953）：`read-tree base` + 可选 `apply --cached --binary` → `write-tree`。
- `createUserCommit`（955-966）：`commit-tree <tree> -p <parent>`，消息 `commitMessage.trim() + '\n'`。
- `prepareRollbackAssessment`（968-1041）：headRef 变更 → `stale_local`；HEAD 非快进祖先 → `stale_local`；Local HEAD 前移时依次跑 `preview-rollback-advanced-baseline`、`preview-rollback-preview-absence`、`preview-rollback-advanced-preview` 三次 tree merge，任一冲突或「预览内容已在 HEAD 中」→ `preview_modified`；最后 `preview-rollback` 求回滚目标 tree。
- `prepareFinalizeAssessment`（1043-1104）：非普通分支 → `operation_not_allowed`；headRef/HEAD 变化 → `stale_local`；`preview-finalize-separation`（冲突 → `preview_modified`）、`preview-task-isolation`（冲突 → `commit_isolation_conflict`）、任务 tree 与 HEAD tree 相同且 receipt 有变更 → `preview_modified`、`preview-index-preservation`（冲突 → `commit_isolation_conflict`）；`commitRequired = changedFiles.length > 0 && taskTree.treeOid !== current.headTreeOid`。
- `resolveIndexPath`（1106-1111）、`inspectIndexFileTree`（1113-1127：ENOENT → `{exists:false}`；`write-tree` 抛错 → `{exists:true, treeOid:null}`）。
- `checkpointLockMarkerOwned`（1129-1135）：marker 内容 trim 后等于 commitOid 才算本进程所有。
- `removeBestEffort`（1137-1144）：静默 unlink，忽略不存在。
- `writeIndexLock`（1146-1165）：`open(<index>.lock, 'wx')` + `writeFile` + `sync`；失败时只清理由本次调用创建的 lock。
- `isIndexLockContention`（1167-1172）：`error.code === 'EEXIST'`。

### 类方法与私有辅助

- `plans: Map<string, StoredPlan>`（src/session-checkout-apply.ts:1175）；`calculatePlan` 写入前会删掉同一 `isolatedPath` 的旧计划，保证每个 checkout 最多一条（src/session-checkout-apply.ts:1712-1718）。
- `constructor(private readonly options)`（1177）。
- `private captureSnapshot(checkoutPath, indexPath, objectDirectory, sourceObjects, excludes?)`（1179-1187）：把 `options.projectSkills` 与 `excludes` 透传给顶层函数。
- `checkpoint`（1189-1330）、`recoverCheckpoint`（1332-1418）、`inspectReview`（1420-1469）、`reviewIsolated`（1475-1511）、`commitIsolated`（1519-1610）。
- `preflight`（1612-1614）/`plan`（1616-1618）→ `private calculatePlan(input, persistPlan)`（1620-1737）。
- `apply`（1739-1818）、`preview`（1820-1960）、`assessPreviewRecovery`（1962-1988）、`rollback`（1990-2093）、`finalize`（2095-2369）、`finish`（2371-2657）。
- `private errorMessage(error)`（2659-2664）：`GitCommandFailure` 包成 `gitOperationFailed`（p0=子命令名、p1=stderr 消息），其他取 `Error.message`，未知取 `unknownGitError`。
- `private cleanup(path)`（2666-2673）：`rm -rf` 带 `maxRetries: 2`，失败只 `console.warn`，不掩盖主结果。

## Architecture

```text
┌─────────────────── src/session-checkout-apply.ts ────────────────────┐
│ 调用方（状态机 / worktree 工具）                                      │
│    │                                                                  │
│    ├─► commitIsolated (1519)                                          │
│    │     └─► captureSnapshot(1560) ─► createUserCommit (1570)          │
│    │           ▲ excludes: deliveryExcludePathspecs (1540)             │
│    │           └─► update-ref HEAD <new> <old> (1572)                  │
│    │               └─► git reset --quiet (1574)                        │
│    │                                                                  │
│    ├─► checkpoint (1189) ─► captureSnapshot ─► createUserCommit        │
│    │     └─► advanceHead (1241)                                        │
│    │           ├─ headRef===null ► update-ref --no-deref HEAD          │
│    │           └─ 否则            ► update-ref <headRef>               │
│    │                                                                  │
│    └─► plan/preview/finalize (1616/1820/2095) ─► 写 Local ─► finish    │
│                                                                        │
│ 共享底座：runGit(417) │ gitObjectEnvironment(492) │                    │
│           captureSnapshot(605) │ computeMerge(705) │                   │
│           computeTreeMerge(803) │ writeIndexLock(1146)                 │
└────────────────────────────────────────────────────────────────────────┘
```

三层职责：**快照层**（`captureSnapshot`/`snapshotFingerprint`/`changedTreePaths`）把「HEAD + index + working tree」压成一个可比较的 sha256；**合并层**（`computeMerge`/`computeTreeMerge`/`selectEffectiveApplyBase`）只在临时 objects 与临时 checkout 里算结果；**写层**（`createUserCommit`/`update-ref`/`writeIndexLock`/`rename`/`git apply`）每一步先比对指纹、后落盘，失败走补偿。

## Data Flow

### 1. 会话分支交付（当前交付路径，不碰 Local）

`reviewIsolated`（src/session-checkout-apply.ts:1475-1511）：

1. 校验 `baseOid` 符合 `OID_PATTERN`，否则 `invalid_input`（1476-1478）。
2. `resolveGitRoot(input.isolatedPath)` + `projectPrefix`，越界即 `invalid_input`（1481-1485）——**不解析 Local 的 git root**，这是与 `inspectReview`（其 1429-1440 会读 localPath、比对两侧 object 目录与前缀）的本质差别。
3. `git cat-file -e <baseOid>^{commit}` 确认基线存在（1486）。
4. `excludes = deliveryExcludePathspecs(input.excludePaths)`（1488），再 `captureSnapshot(..., excludes)`（1489-1495）。
5. `changedTreePaths(baseOid, isolated.treeOid)` 必须全部落在项目前缀内（1496-1499）。
6. 返回 `{ready, isolatedFingerprint, isolatedHeadOid, changedFiles}`（1500-1505）。

`commitIsolated`（src/session-checkout-apply.ts:1519-1610）：

1. 入参校验：`baseOid` 格式（1522-1524）、`commitMessage` 非空（1525-1528）且 ≤500 字符（1529-1531）。
2. 再次 `resolveGitRoot` + `projectPrefix` + `cat-file -e`（1534-1539）。
3. 读 `headOid`、`headTreeOid`、`symbolic-ref --quiet HEAD`（允许 exit 1 → `headRef` 为 null）（1541-1544）。
4. **分支守门**：`branchRef` 给定且 `headRef !== branchRef` 时返回 `operation_not_allowed`（`theWorktreeIsNotOnTheSessionBranch`）；注释明确「调用方保证先挂好会话分支，这里只做守门，避免把提交落到 detached HEAD 上丢线」（1545-1554）。
5. **提交树取自评审快照**：`captureSnapshot(isolatedGitRoot, pending.index, null, null, excludes)`（1560-1566）。注释（1556-1558）说明这条临时 index 路径已排除宿主运行期产物与随会话携带的 Project Skills，因此交付提交不会把它们带进会话分支；**直接对真实 index 做 `add -A` 会把它们一起提交**。
6. `created = pending.treeOid !== headTreeOid`（1567）；无变更时 `commitOid` 取 `headOid`、不建提交（1568）。
7. 有变更时：`createUserCommit(...)`（1570）→ `git update-ref HEAD <commitOid> <headOid>`（1572，注释：HEAD 通常是符号引用，**默认 deref 会把分支一起推到新提交**，正是所需的「推进会话分支」）→ `git reset --quiet`（1574，把 index 归位到新 HEAD，**工作区文件不动**）。
8. 提交后再快照一次（1578-1584）：`snapshot.headOid !== commitOid` 视为 `git_error`（1585-1587）；`changedTreePaths(baseOid, snapshot.treeOid)` 做前缀校验（1588-1591）；返回 `{committed, commitOid, changedFiles, isolatedFingerprint, branch: headRef, created}`（1592-1599）。
9. catch 中特判 `empty ident|who you are|please tell me who` → `invalid_input` + `initialIdentityMissing`（1601-1605），让模型看到可执行提示而不是 `empty ident` 原文。

### 2. checkpoint / recoverCheckpoint（Managed Worktree 内）

`checkpoint`（src/session-checkout-apply.ts:1189-1330）：

1. 入参校验：消息非空且 ≤500、`expectedHeadOid` 匹配 `OID_PATTERN`、`expectedFingerprint` 非空（1190-1193）。
2. `captureSnapshot` 后比对 `headOid`/`fingerprint`，不符即 `stale_isolated`（1206-1209）；变更路径必须落在项目前缀内（1210-1213）；无变更 → `operation_not_allowed`（1215-1217）。
3. `createUserCommit`（1219）→ `input.beforeCommit?.({commitOid, parentOid, indexTreeOid, changedFiles})`（1220）——journal 先落盘。
4. 用 `prepareIndexFromPatch(..., commitOid, 空 patch)` 生成干净 index（1222-1223），在真实 index 旁登记 `${realIndexPath}.lock` 与 marker `${lockPath}.dsh-${commitOid}`（1224-1231）。
5. `beforeFinalIsolatedValidation?.()` 后再次快照校验（1233-1237）。
6. **分支感知的 HEAD 推进** `advanceHead`（1241-1249）：`headRef === null` 时用 `['update-ref', '--no-deref', 'HEAD', nextOid, previousOid]`；否则用 `['update-ref', headRef, nextOid, previousOid]`。注释（1242-1243）：分支挂载的 Worktree 必须推进分支，**对符号 HEAD 用 `--no-deref` 会把它 detach 并孤立交付所用的会话分支**。两个分支都带 old-value，即真正的 CAS（旧文宣称的「无 CAS old-value」已不成立）。
7. `advanceHead` → `rename(adjacentIndex, realIndexPath)` → 删 marker；失败时若 ref 已推进则用 `advanceHead(snapshot.headOid, commitOid)` 反向回滚，回滚再失败置 `recoveryState: 'uncertain'` 并保留恢复证据，否则 `'unchanged'`（1250-1281）。
8. 写后验证（1283-1297）：`headOid === commitOid`、**`headRef === snapshot.headRef`（HEAD 指向不变）**、`headTreeOid === snapshot.treeOid`、`indexTreeOid === snapshot.treeOid`、`treeOid === snapshot.treeOid` 全部成立才算 `checkpointed`——旧版「必须是 detached HEAD」的断言已放宽为「HEAD 指向不变」。
9. `finally` 中 `preserveRecoveryEvidence` 为真则保留邻接 index 与 marker，否则删除，并清理临时目录（1323-1329）。

`recoverCheckpoint`（src/session-checkout-apply.ts:1332-1418）：三个 OID 均校验（1333-1335）；`snapshot.headOid === parentOid` → 清掉可证明属于本进程的残留 lock/marker 后返回 `checkpoint_aborted`（1350-1359）；`headOid !== commitOid` → `stale_isolated`（1360-1362）；工作区有新增改动或 index 有新 staged 改动 → 分别 `stale_isolated`（1363-1368）；随后重建干净 index、加锁、二次校验、`rename` 就位，最终要求 `headRef` 未变且 index/tree 都等于 HEAD tree（1401-1409）。

### 3. 计划与快照

`captureSnapshot`（src/session-checkout-apply.ts:605-658）是全局指纹来源：

1. `rev-parse HEAD`、`rev-parse <head>^{tree}`、`symbolic-ref --quiet HEAD`（允许 exit 1 → `headRef=null`）、`ls-files --stage -z` 取 `indexEntries`（614-618）。
2. `diff --cached --binary --full-index --no-ext-diff --no-textconv --no-renames <head>` 取已 staged 补丁（619-631）。
3. 临时 index（`GIT_INDEX_FILE=indexPath`）先 `read-tree <head>` 还原 HEAD，再 `apply --cached` 叠加 staged 补丁，`write-tree` 得 `indexTreeOid`（637-644）。
4. **在还原了 staged 语义的 index 上** `git add -A -- . <excludes>`（646）叠加 working tree，`write-tree` 得 `treeOid`（653）。`excludes` 是新增的末位可选参数，默认 `deliveryExcludePathspecs()`（612），因此 `.dsh-ops/`、`desktop-runtime.json`、`.dsh-runtime.json` 这类宿主运行期产物不进 `treeOid`。
5. `projectSkills.paths()` 为真时用 `trackedSkillPaths(indexEntries, headPaths)` 算出随会话携带的 skill 路径，`update-index --force-remove` 把它们从临时 index 剔除（647-652），并把 `carried.fingerprint` 叠进最终指纹（654-655）。
6. 返回 `{fingerprint, headOid, headRef, headTreeOid, indexTreeOid, treeOid, indexEntries}`（657）。

### 4. 旧三段路径：plan / preview / finalize 与 apply / finish

`calculatePlan`（src/session-checkout-apply.ts:1620-1737）：同 object 目录（`pathsMatch`，1634-1636）+ 同项目前缀（1637-1641）→ 两侧 `captureSnapshot`（1644-1655）→ `selectEffectiveApplyBase`（1656-1661）→ 前缀过滤（1662-1674）→ `computeMerge`（1675-1684）→ 冲突返回真实 `localHeadOid` 与 `conflictDetails`（1686-1699）；ready 时组装 `ApplyPlan`，`persistPlan` 为真才写入 `plans`（1712-1730）。

`apply`（1739-1818）：`planMatches` CAS → 复核 repository identity（1750-1753）→ Local/Isolated 双指纹复验（1754-1772）→ 建无 ref 的 `nextBaseOid` 内部 commit（1776-1792）→ `beforeFinalLocalValidation` 后第三次 Local 复验（1794-1806）→ `git apply --binary`（1808-1810）→ 删计划并返回。

`preview`（1820-1960）：身份校验（1832-1835）→ Local/Isolated 复验（1846-1867，此路径额外比对 `headRef`）→ 持久快照指纹比对（1869-1886）→ `prepareIndexFromPatch` 得 `previewWorkingTreeOid` 与 `isolatedSnapshotOid`（1887-1900）→ 组 `preparedReceipt`（1901-1920）→ 最终 Local 复验（1922-1931）→ `options.beforeWrite(preparedReceipt)`（1932）→ `git apply`（1933-1935）→ 写后快照必须等于 `previewWorkingTreeOid`（1936-1947）→ 回填 `localFingerprintPreview`（1950-1953）。

`rollback`（1990-2093）：`prepareRollbackAssessment` 出 target tree → `treePatch` 生成逆补丁 → `input.beforeWrite?.()` **先于** 最终 CAS（2026-2028，注释说明 journal 持久化可能 await registry I/O，因此必须在权威 CAS 之前完成，且从快照到 `git apply` 之间没有回调/yield 缝隙）→ Local 复验（2030-2042）→ `git apply` → `afterLocalWriteBeforeVerification` → 快照必须命中 `snapshotFingerprint(current.headOid, current.headRef, current.indexEntries, targetTreeOid)`（2044-2086）。

`finalize`（2095-2369）：`prepareFinalizeAssessment` → `commitRequired` 为假时只复验并返回 `{finished, changedFiles: [], commitOid: null, nextBaseOid: receipt.isolatedSnapshotOid}`（2136-2157）→ 否则 `treePatch` 出 task/finalIndex 两份补丁、各自 `prepareIndexFromPatch` 复算并比对（2159-2201）→ 计算 `expectedFingerprint`（2197-2202）→ `input.beforeCommit?.(commitOid)`（2203）→ 备份真实 index（2209-2210）→ `writeIndexLock` 占住 `index.lock`（2212-2221）→ 复验且原 index 字节未变（2222-2236）→ `update-ref <branchRef> <commitOid> <current.headOid>`（2242）→ `rename` 就位（2244）→ 写后独立验证（2251-2282）→ 失败按 `refUpdated`/`indexReplaced`/`backupIndex` 三态做补偿事务（2285-2317），补偿也失败则保留备份并报 `uncertain`（2352-2361）。

`finish`（2371-2657）：`planMatches` + 非普通分支拒绝（2373-2385）→ 双指纹复验（2398-2419）→ 重新 `computeMerge` 并要求 `changedFiles` 完全一致（2421-2442）→ 建 `nextBaseOid`（2444-2460）→ `merge.changedFiles.length === 0` 时只复验并返回空提交（2462-2475）→ 任务隔离 `C = H + (M - L)`（2477-2496）、staged 恢复 `S' = C + (S - H)`（2498-2517）→ `prepareIndexFromPatch` + `createUserCommit`（2519-2545）→ `beforeFinalLocalValidation` 复验（2554-2567）→ `writeIndexLock` + 二次复验（2569-2592）→ `git apply` merge 补丁 + `update-ref` + `rename`（2594-2609）→ 失败时用 ref 反向 CAS 与 `git apply -R` 逆补丁补偿（2610-2642）。

## Connections

- [[delivery-excludes]]：`deliveryExcludePathspecs()` 来自 `src/delivery-excludes.ts`（src/session-checkout-apply.ts:2），既是 `captureSnapshot` 的默认 `excludes`（612），也被 `reviewIsolated`/`commitIsolated` 用调用方 `excludePaths` 叠加（1488、1540）。宿主运行期产物因此不进评审变更集、交付提交与清理指纹。
- [[project-skills]]：`ProjectSkillStore` 与 `trackedSkillPaths` 来自 `src/adapters/project-skills.ts`（src/session-checkout-apply.ts:1）；`captureSnapshot` 在 `projectSkills.paths()` 为真时把随会话携带的 skill 路径从临时指数剔除，并把 `carried.fingerprint` 叠进指纹（647-655）。
- [[types]]：`ApplyBaseStrategy`、`ApplyConflictDetail`、`CONFLICT_DETAIL_DIFF_LIMIT`、`CONFLICT_DETAIL_FILE_LIMIT` 来自 `src/types.js`（src/session-checkout-apply.ts:10-11）。
- [[i18n-host]]：所有面向用户/模型的文案经 `hostMessage(...)` 输出（src/session-checkout-apply.ts:3）；本文件不硬编码中文错误串。
- 交付之后的分支合并由 `worktree_merge` / 会话验收一侧决定：`commitIsolated` 只把提交落在会话分支上，何时把该分支合出去不是本模块的职责（见其头部注释，src/session-checkout-apply.ts:1518-1524）。

## Known Issues

- **两套收口路径并存且语义相反**：`commitIsolated` 完全不碰 Local，而 `plan`→`apply`→`finish`、`plan`→`preview`→`finalize` 仍写 Local 的工作区、索引与分支。同一个引擎类承载两种语义，调用方必须在入口处选定；`commitIsolated`/`reviewIsolated` 在接口上标为可选方法（src/session-checkout-apply.ts:291、293），替身实现需自行做能力探测。
- **`commitIsolated` 的 `update-ref HEAD` 在 detached 时只移动 HEAD**：`update-ref HEAD <new> <old>`（src/session-checkout-apply.ts:2205）依赖 HEAD 是符号引用才会把分支一起推到新提交；若 Worktree 已经 detached，该调用只移动 HEAD 本身、分支不动，返回 `branch: null` 的「成功」。`branchRef` 守门（1545-1554）只在调用方显式传 `branchRef` 时才拦得住。
- **`commitIsolated` 的 ref→index 两步无补偿**：`update-ref`（1572）与 `git reset --quiet`（1574）顺序执行，方法体内没有针对这一步的 try/catch 回滚，`reset` 失败会留下「HEAD 已推进、index 仍指旧树」的中间态；相比之下 `checkpoint`（1250-1281）与 `finish`（2610-2642）都有显式补偿与 `recoveryState` 标注。
- **`captureSnapshot` 的 `excludes` 是 pathspec 追加而非删除语义**：`git add -A -- . <excludes>`（src/session-checkout-apply.ts:646）把排除项拼在 pathspec 之后，只有 `deliveryExcludePathspecs()` 产出的排除式 pathspec 才真正生效；调用方自填的 `excludePaths` 若是裸路径，不但不会排除，还会被当成额外纳入的 pathspec。
- **`collectConflictDetails` 的注释与命令不一致**：注释写「逐文件采集 combined 冲突 diff」（src/session-checkout-apply.ts:683），实际执行的是普通 `git diff -- <file>`（690），并非 `--cc`/`--base` 形式；而且传入的 `conflictingFiles` 在 `computeMerge` 里已被映射成项目相对路径（753-755），`git diff -- file` 却按仓库相对路径求值，项目位于子目录时该命令可能取不到差异，只会返回空 diff。
- **`preview` 的 `localFingerprintPreview` 先空后填**：构造 `preparedReceipt` 时置 `''`（src/session-checkout-apply.ts:1912），`beforeWrite` 收到的 receipt 不含预览后指纹；只有写入成功后的最终 receipt 才带真实值（1950-1953）。宿主若把 `beforeWrite` 的入参直接持久化为「预览后指纹」，会落一个空串。
- **进程级钩子目录不回收**：`disabledGitHooksDirectory`（src/session-checkout-apply.ts:403-410）是模块级单例，`mkdtempSync` 一次后永不删除，长驻 Host 进程会在系统临时目录持续留下空目录。
- **`plans` 只按 `isolatedPath` 去重**：同一 checkout 上第二次 `plan()` 会覆盖旧计划（1712-1718），因此一个 Worktree 无法同时持有两份计划——第一份 revision 永久失配，其 `apply`/`preview`/`finish` 只能拿到 `invalid_plan`。
- **`OID_PATTERN` 只认 40/64 位十六进制**（src/session-checkout-apply.ts:415）：所有 `baseOid`/`expectedHeadOid`/`commitOid`/`expectedIndexTreeOid` 入参都以此为准，缩写 OID 或 `HEAD~1` 这类 rev 表达式一律 `invalid_input`。