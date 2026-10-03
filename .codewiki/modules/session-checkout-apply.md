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

`src/session-checkout-apply.ts`（2457 行）导出 `SessionCheckoutApplyEngine` 接口（src/session-checkout-apply.ts:240）与 `DefaultSessionCheckoutApplyEngine` 实现（src/session-checkout-apply.ts:1103），由工厂函数 `createSessionCheckoutApplyEngine`（src/session-checkout-apply.ts:2453）构造——状态机在两侧仓库之间搬运任务增量的执行引擎。设计核心：**所有 merge 计算发生在临时 object 目录，绝不改动两侧真实仓库**；Local 的任何写入都以持久化 journal/receipt 为先决条件。

## 计划与快照

- `ApplyPlan`（src/session-checkout-apply.ts:17）：{revision, localFingerprint, isolatedFingerprint, effectiveBaseOid, baseStrategy, localHeadOid, localHeadRef(null=detached), isolatedHeadOid, changedFiles}。plans 存于 `DefaultSessionPlans` 内存 Map（src/session-checkout-apply.ts:1104），apply/preview/finish 后删除——单次使用。
- `captureSnapshot`（src/session-checkout-apply.ts:559）：HEAD rev-parse + symbolic-ref（允许 exit1→detached null）+ ls-files --stage -z + staged patch；临时 index 先 `read-tree HEAD` 还原真实 staged 语义、apply staged patch、再 `add -A`，两次 `write-tree` 得 indexTreeOid/treeOid；携带 project skills 时指纹叠加 carried.fingerprint（src/session-checkout-apply.ts:600-607）。
- `snapshotFingerprint`（src/session-checkout-apply.ts:542）：sha256(headOid\0headRef|DETACHED\0indexEntries\0treeOid)。
- `createSnapshotCommit`（src/session-checkout-apply.ts:612）：commit-tree，author/committer `Domi Apply <domi-apply@localhost>`。

## Merge 计算

- `gitObjectEnvironment`（src/session-checkout-apply.ts:446）：`GIT_OBJECT_DIRECTORY=临时 objects + GIT_ALTERNATE_OBJECT_DIRECTORIES=源 objects`——merge 在临时 object 目录算，不动两仓真实 objects。
- `selectEffectiveApplyBase`（src/session-checkout-apply.ts:504）：recorded base 必须证明在两侧真实提交历史中才允许 ancestry 前移（上次 apply 的内部 snapshot commit 无 ref、不在分支历史 → 第二次 apply 保守用 recorded_base）；三策略 `ApplyBaseStrategy`：recorded_base | isolated_contains_local_head | local_contains_isolated_head。
- `computeMerge`（src/session-checkout-apply.ts:634）：两侧 snapshot commit（父=effectiveBase）→ 临时 merge checkout（`git init --template=` 空、hooks 禁用、autocrlf=false）→ checkout --detach local + merge --no-commit --no-ff isolated → 冲突取 diff-filter=U -z 按项目前缀过滤；ready 产 mergedTree + binary patch + changedFiles。
- `computeTreeMerge`（src/session-checkout-apply.ts:732）：三方 tree merge（base/ours/theirs 临时 commit），用于任务增量剥离与 staged 恢复。
- `treePatch`（src/session-checkout-apply.ts:823）：生成两个 tree oid 之间的 binary patch。

## git 原语与并发

- `runGit`（src/session-checkout-apply.ts:371）：spawn git；win32 加 `-c core.longpaths=true`；一律 `-c core.quotePath=false`；`GIT_TERMINAL_PROMPT=0`；30s SIGTERM 超时（GIT_TIMEOUT_MS=30_000，src/session-checkout-apply.ts:368）。通过 `scrubbedAmbientGitEnv`（src/session-checkout-apply.ts:349）清除可能重定向仓库路径的环境变量；hooks 通过惰性创建的临时空目录禁用（src/session-checkout-apply.ts:357-364）。
- `writeIndexLock`（src/session-checkout-apply.ts:1075）：open `<indexPath>.lock` flag 'wx'+sync——Git canonical index.lock 协议；`isIndexLockContention`（src/session-checkout-apply.ts:1096）检测 EEXIST 错误码。checkpoint 锁以内容 `${indexLockPath}.dsh-${commitOid}` == commitOid 证明所有权（`checkpointLockMarkerOwned`，src/session-checkout-apply.ts:1058）。

## 引擎操作语义

- `inspectReview`（src/session-checkout-apply.ts:1339）：同 object 目录（pathsMatch）+ 同项目前缀校验，出前缀 → invalid_input；返回 {ready, isolatedFingerprint, isolatedHeadOid, changedFiles}——module 的 fingerprint CAS 全靠它。
- `preflight` / `plan`（src/session-checkout-apply.ts:1390-1396）：共用 `calculatePlan`（src/session-checkout-apply.ts:1398），preflight 不持久化（persistPlan=false）、plan 持久化到 plans Map；冲突时返回真实 localHeadOid 供 Isolated 会话同步。
- `checkpoint`（src/session-checkout-apply.ts:1112）：仅 detached HEAD 允许（operation_not_allowed）；CAS expectedHeadOid/fingerprint；createUserCommit 后 `beforeCommit`（Host journal 先于 HEAD/index 变更持久化）→ 重建 final index → 真 index 加 index.lock+marker → update-ref --no-deref HEAD（CAS old-value）→ rename 邻接 index → marker 清理；失败回滚 ref CAS，回滚失败置 recoveryState 'uncertain' 并保留恢复证据。
- `recoverCheckpoint`（src/session-checkout-apply.ts:1248）：headOid==parentOid → `checkpoint_aborted`；headOid==commitOid → 树/index 一致性校验后 `checkpoint_recovered`；其他 HEAD → stale_isolated。
- `preview`（src/session-checkout-apply.ts:1597）：beforeWrite receipt 回调——Local 写入前 journal 必须已持久化，失败不得触碰 Local；创建 previewWorkingTreeOid 与 isolatedSnapshotOid。
- `assessPreviewRecovery`（src/session-checkout-apply.ts:1739）：严格只读 detached Preview 恢复评估，复用 prepareRollbackAssessment / prepareFinalizeAssessment。
- `rollback`（src/session-checkout-apply.ts:1767）：beforeWrite 在最终 Local CAS 前；计算 rollback patch 后 apply 恢复至预览前状态。
- `finalize`（src/session-checkout-apply.ts:1872）：beforeCommit 在 commit object 已建、branch ref 未更新时持久化恢复信息；C = H + (M - L) 剥离任务增量 → createUserCommit → 恢复用户 staged 状态 → index.lock CAS → update-ref branch → 写后验证；回退补偿事务处理多阶段失败。
- `finish`（src/session-checkout-apply.ts:2148）：复验 merge → 创建 nextBaseOid → C = H + (M - L) 任务隔离 → S' = C + (S - H) staged 恢复 → writeIndexLock → update-ref + rename index → 验证或回滚。
- Options seams（src/session-checkout-apply.ts:273）：beforeFinalLocalValidation / afterLocalWriteBeforeVerification / beforeFinalIsolatedValidation / afterIsolatedWriteBeforeVerification——测试注入点。

## 错误类型纪律

八类 `ApplyError`（src/session-checkout-apply.ts:230-238）：invalid_input / invalid_plan / stale_local / stale_isolated / git_error / commit_isolation_conflict / operation_not_allowed / preview_modified。stale_local/stale_isolated/invalid_plan 等码可证明 Local 未被触碰（状态机直接回 ready）；其余（git_error 等）交由 reconcile 判定 recovery_required。
