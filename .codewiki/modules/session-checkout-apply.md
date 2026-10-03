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

# Session Checkout Apply Pipeline

`src/session-checkout-apply.ts`（2485 行）导出 `SessionCheckoutApplyEngine` 接口（src/session-checkout-apply.ts:243）与 `DefaultSessionCheckoutApplyEngine` 实现（src/session-checkout-apply.ts:1130），由工厂函数 `createSessionCheckoutApplyEngine`（src/session-checkout-apply.ts:2481）构造——状态机在两侧仓库之间搬运任务增量的执行引擎。设计核心：**所有 merge 计算发生在临时 object 目录，绝不改动两侧真实仓库**；Local 的任何写入都以持久化 journal/receipt 为先决条件。

## 类型体系

- **计划相关**：`ApplyPlanInput`（src/session-checkout-apply.ts:12）{baseOid, isolatedPath, localPath} → `ApplyPlan`（src/session-checkout-apply.ts:18）{revision, localFingerprint, isolatedFingerprint, effectiveBaseOid, baseStrategy, localHeadOid, localHeadRef(null=detached), isolatedHeadOid, changedFiles}。
- **结果类型**：`InspectReviewResult = ReviewSnapshotResult | ApplyPlanErrorResult`（src/session-checkout-apply.ts:38）；`ApplyPlanResult = ApplyReadyPlanResult | ApplyConflictPlanResult | ApplyPlanErrorResult`（src/session-checkout-apply.ts:65）；`ApplyResult = ApplySuccessResult | ApplyErrorResult`（src/session-checkout-apply.ts:79）；`FinishResult = FinishSuccessResult | ApplyErrorResult`（src/session-checkout-apply.ts:90）。
- **Preview/Rollback**：`PreviewReceipt`（src/session-checkout-apply.ts:92）含 previewId/reviewId/iteration/configuredBaseOid/effectiveBaseOid/localHeadOid/workingTree Oids/isolatedSnapshotOid 等；`PreviewResult`（src/session-checkout-apply.ts:119）；`RollbackResult`（src/session-checkout-apply.ts:126）。
- **Checkpoint/Recovery**：`CheckpointInput`（src/session-checkout-apply.ts:128）含 beforeCommit 钩子；`CheckpointResult`（src/session-checkout-apply.ts:145）；`CheckpointRecoveryResult`（src/session-checkout-apply.ts:152），恢复结果可为 `checkpoint_recovered` 或 `checkpoint_aborted`。
- **Preview Recovery**：`PreviewRecoveryActionBlockCode`（src/session-checkout-apply.ts:154）stale_local/preview_modified/commit_isolation_conflict/operation_not_allowed；`PreviewRecoveryAssessment`（src/session-checkout-apply.ts:180）含 rollback/finalize 两个安全评估分支。
- **内部辅助**：`ApplyScope`（src/session-checkout-apply.ts:304）isolatedGitRoot/localGitRoot/projectPrefix/sourceObjects；`StoredPlan`（src/session-checkout-apply.ts:311）input + patch + plan + scope；`MergeReadyResult`/`MergeConflictResult`/`MergeResult`（src/session-checkout-apply.ts:318-331）；`TreeMergeReadyResult`/`TreeMergeResult`（src/session-checkout-apply.ts:333-338）；`GitCommandFailure`（src/session-checkout-apply.ts:340）。

## 引擎操作语义

- `inspectReview`（src/session-checkout-apply.ts:1366）：同 object 目录（pathsMatch）+ 同项目前缀校验，出前缀 → invalid_input；返回 {ready, isolatedFingerprint, isolatedHeadOid, changedFiles}——module 的 fingerprint CAS 全靠它。
- `preflight` / `plan`（src/session-checkout-apply.ts:1417-1423）：共用 `calculatePlan`（src/session-checkout-apply.ts:1425），preflight 不持久化（persistPlan=false）、plan 持久化到 plans Map（src/session-checkout-apply.ts:1131）；冲突时返回真实 localHeadOid 供 Isolated 会话同步。
- `checkpoint`（src/session-checkout-apply.ts:1139）：仅 detached HEAD 允许（operation_not_allowed）；CAS expectedHeadOid/fingerprint；createUserCommit 后 `beforeCommit`（Host journal 先于 HEAD/index 变更持久化）→ 重建 final index → 真 index 加 index.lock+marker → `update-ref --no-deref HEAD`（无 CAS old-value，直接指到新 commit）→ rename 邻接 index → marker 清理；失败回滚 ref CAS（带 old-value），回滚失败置 recoveryState 'uncertain' 并保留恢复证据。
- `recoverCheckpoint`（src/session-checkout-apply.ts:1275）：headOid==parentOid → 清锁/marker → `checkpoint_aborted`；headOid==commitOid → 树/index 一致性校验后 `checkpoint_recovered`；其他 HEAD → stale_isolated。
- `preview`（src/session-checkout-apply.ts:1625）：beforeWrite receipt 回调——Local 写入前 journal 必须已持久化，失败不得触碰 Local；创建 previewWorkingTreeOid 与 isolatedSnapshotOid。
- `assessPreviewRecovery`（src/session-checkout-apply.ts:1767）：严格只读 detached Preview 恢复评估，复用 prepareRollbackAssessment / prepareFinalizeAssessment。
- `rollback`（src/session-checkout-apply.ts:1795）：beforeWrite 在最终 Local CAS 前；计算 rollback patch 后 apply 恢复至预览前状态。
- `finalize`（src/session-checkout-apply.ts:1900）：beforeCommit 在 commit object 已建、branch ref 未更新时持久化恢复信息；C = H + (M - L) 剥离任务增量 → createUserCommit → 恢复用户 staged 状态 → writeIndexLock CAS → update-ref branch → 写后验证；回退补偿事务处理多阶段失败（refUpdated+!indexReplaced 走 ref CAS 回滚；refUpdated+indexReplaced 走备份还原补偿）。
- `finish`（src/session-checkout-apply.ts:2176）：复验 merge → 创建 nextBaseOid → C = H + (M - L) 任务隔离 → S' = C + (S - H) staged 恢复 → writeIndexLock → update-ref branch + rename index → 验证或回滚；worktree 回滚通过 `apply -R` 逆补丁。
- Options seams（src/session-checkout-apply.ts:276）：beforeFinalLocalValidation / afterLocalWriteBeforeVerification / beforeFinalIsolatedValidation / afterIsolatedWriteBeforeVerification——测试注入点。

## 错误类型纪律

八类 `ApplyError`（src/session-checkout-apply.ts:233-241）：invalid_input / invalid_plan / stale_local / stale_isolated / git_error / commit_isolation_conflict / operation_not_allowed / preview_modified。stale_local/stale_isolated/invalid_plan 等码可证明 Local 未被触碰（状态机直接回 ready）；其余（git_error 等）交由 reconcile 判定 recovery_required。

## Merge 计算

- `gitObjectEnvironment`（src/session-checkout-apply.ts:450）：`GIT_OBJECT_DIRECTORY=临时 objects + GIT_ALTERNATE_OBJECT_DIRECTORIES=源 objects`——merge 在临时 object 目录算，不动两仓真实 objects。
- `selectEffectiveApplyBase`（src/session-checkout-apply.ts:508）：recorded base 必须证明在两侧真实提交历史中才允许 ancestry 前移（上次 apply 的内部 snapshot commit 无 ref、不在分支历史 → 第二次 apply 保守用 recorded_base）；三策略 `ApplyBaseStrategy`：recorded_base | isolated_contains_local_head | local_contains_isolated_head。
- `computeMerge`（src/session-checkout-apply.ts:661）：两侧 snapshot commit（父=effectiveBase）→ 临时 merge checkout（`git init --template=` 空、hooks 禁用、autocrlf=false）→ checkout --detach local + merge --no-commit --no-ff isolated → 冲突取 diff-filter=U -z 按项目前缀过滤；`collectConflictDetails`（src/session-checkout-apply.ts:638）逐文件采集冲突 diff 并截断上限（CONFLICT_DETAIL_FILE_LIMIT / CONFLICT_DETAIL_DIFF_LIMIT）；ready 产 mergedTree + binary patch + changedFiles。
- `computeTreeMerge`（src/session-checkout-apply.ts:759）：三方 tree merge（base/ours/theirs 临时 commit），用于任务增量剥离与 staged 恢复。
- `treePatch`（src/session-checkout-apply.ts:850）：生成两个 tree oid 之间的 binary patch。

## 计划与快照

- `captureSnapshot`（src/session-checkout-apply.ts:563）：HEAD rev-parse + symbolic-ref（允许 exit1→detached null）+ ls-files --stage -z + staged patch；临时 index 先 `read-tree HEAD` 还原真实 staged 语义、apply staged patch、再 `add -A`，两次 `write-tree` 得 indexTreeOid/treeOid；携带 project skills 时指纹叠加 carried.fingerprint（src/session-checkout-apply.ts:603-611）。
- `snapshotFingerprint`（src/session-checkout-apply.ts:546）：sha256(headOid\0headRef|DETACHED\0indexEntries\0treeOid)。
- `createSnapshotCommit`（src/session-checkout-apply.ts:616）：commit-tree，author/committer `Domi Apply <domi-apply@localhost>`。
- `changedTreePaths`（src/session-checkout-apply.ts:531）：diff --name-only -z 列 base/tree 间变更文件。

## git 原语与并发

- `runGit`（src/session-checkout-apply.ts:375）：spawn git；win32 加 `-c core.longpaths=true`；一律 `-c core.quotePath=false`；`GIT_TERMINAL_PROMPT=0`；30s SIGTERM 超时（GIT_TIMEOUT_MS=30_000，src/session-checkout-apply.ts:372）。通过 `scrubbedAmbientGitEnv`（src/session-checkout-apply.ts:353）清除可能重定向仓库路径的环境变量（匹配 `AMBIENT_GIT_ENV_PATTERN`，src/session-checkout-apply.ts:351）；hooks 通过惰性创建的临时空目录禁用（`disabledGitHooksPath`，src/session-checkout-apply.ts:365-368）。
- `writeIndexLock`（src/session-checkout-apply.ts:1102）：open `<indexPath>.lock` flag 'wx'+sync——Git canonical index.lock 协议；`isIndexLockContention`（src/session-checkout-apply.ts:1123）检测 EEXIST 错误码。checkpoint 锁以内容 `${indexLockPath}.dsh-${commitOid}` == commitOid 证明所有权（`checkpointLockMarkerOwned`，src/session-checkout-apply.ts:1085）。
- `planMatches`（src/session-checkout-apply.ts:884）：CAS 比较 revision + 全部 ApplyPlan 字段。
- `pathsMatch`（src/session-checkout-apply.ts:876）：跨平台规范化路径比对（win32 大小写不敏感）。
- `prepareIndexFromPatch`（src/session-checkout-apply.ts:897）：read-tree base + apply patch → write-tree。
- `createUserCommit`（src/session-checkout-apply.ts:911）：commit-tree 创建用户级提交。
- `prepareRollbackAssessment`（src/session-checkout-apply.ts:924）：检查 headRef/headOid 一致性 → computeTreeMerge 推进基线/预览缺失 → 最终 rollback tree 合并。
- `prepareFinalizeAssessment`（src/session-checkout-apply.ts:999）：检查 branch ref → previewRemoval 分离确认 → taskTree 任务隔离 → finalIndexTree 索引保存。
- `resolveIndexPath`（src/session-checkout-apply.ts:1062）：rev-parse --git-path index 获取真实 index 路径。
- `inspectIndexFileTree`（src/session-checkout-apply.ts:1069）：尝试 open indexPath → write-tree 获取 treeOid。
- `removeBestEffort`（src/session-checkout-apply.ts:1093）：unlink 临时文件，静默忽略 ENOENT。
