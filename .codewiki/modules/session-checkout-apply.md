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

`src/session-checkout-apply.ts`（2397 行）实现 `SessionCheckoutApplyEngine`（src/session-checkout-apply.ts:240）——状态机（[[session-checkout-module|Session Checkout Module]]）在两侧仓库之间搬运任务增量的执行引擎。设计核心：**所有 merge 计算发生在临时 object 目录，绝不改动两侧真实仓库**；Local 的任何写入都以持久化 journal/receipt 为先决条件。

## 计划与快照

- `ApplyPlan`（src/session-checkout-apply.ts:17）：{revision, localFingerprint, isolatedFingerprint, effectiveBaseOid, baseStrategy, localHeadOid, localHeadRef(null=detached), isolatedHeadOid, changedFiles}。plans 存于 `DefaultSessionCheckoutApplyEngine` 内存 Map（src/session-checkout-apply.ts:1070），apply/preview/finish 后删除——单次使用。
- `captureSnapshot`（src/session-checkout-apply.ts:526）：HEAD rev-parse + symbolic-ref（允许 exit1→detached null）+ ls-files --stage -z + staged patch；临时 index 先 `read-tree HEAD` 还原真实 staged 语义、apply staged patch、再 `add -A`，两次 `write-tree` 得 indexTreeOid/treeOid。
- `snapshotFingerprint`（src/session-checkout-apply.ts:509）：sha256(headOid\0headRef|DETACHED\0indexEntries\0treeOid)；携带 project skills 时指纹叠加 carried.fingerprint（src/session-checkout-apply.ts:574）。
- `createSnapshotCommit`（src/session-checkout-apply.ts:579）：commit-tree，author/committer `Domi Apply <domi-apply@localhost>`。

## Merge 计算

- `gitObjectEnvironment`（src/session-checkout-apply.ts:413）：`GIT_OBJECT_DIRECTORY=临时 objects + GIT_ALTERNATE_OBJECT_DIRECTORIES=源 objects`——merge 在临时 object 目录算，不动两仓真实 objects。
- `selectEffectiveApplyBase`（src/session-checkout-apply.ts:471）：recorded base 必须证明在两侧真实提交历史中才允许 ancestry 前移（上次 apply 的内部 snapshot commit 无 ref、不在分支历史 → 第二次 apply 保守用 recorded_base）；三策略 `ApplyBaseStrategy`：recorded_base | isolated_contains_local_head | local_contains_isolated_head。
- `computeMerge`（src/session-checkout-apply.ts:601）：两侧 snapshot commit（父=effectiveBase）→ 临时 merge checkout（`git init --template=` 空、hooks 禁用、autocrlf=false）→ checkout --detach local + merge --no-commit --no-ff isolated → 冲突取 diff-filter=U -z 按项目前缀过滤；ready 产 mergedTree + binary patch + changedFiles。
- `computeTreeMerge`（src/session-checkout-apply.ts:699）：三方 tree merge（base/ours/theirs 临时 commit），用于任务增量剥离与 staged 恢复。

## git 原语与并发

- `runGit`（src/session-checkout-apply.ts:348）：spawn git；win32 加 `-c core.longpaths=true`；一律 `-c core.quotePath=false`；`GIT_TERMINAL_PROMPT=0`；30s SIGTERM 超时（GIT_TIMEOUT_MS=30_000，src/session-checkout-apply.ts:345）。
- `writeIndexLock`（src/session-checkout-apply.ts:1042）：open `<indexPath>.lock` flag 'wx'+sync——Git canonical index.lock 协议；EEXIST 即 isIndexLockContention（src/session-checkout-apply.ts:1063）。checkpoint 锁以内容 `${indexLockPath}.dsh-${commitOid}` == commitOid 证明所有权（checkpointLockMarkerOwned，src/session-checkout-apply.ts:1025）。

## 引擎操作语义

- `inspectReview`（src/session-checkout-apply.ts:1306）：同 object 目录（pathsMatch）+ 同项目前缀校验，出前缀 → invalid_input；返回 {ready, isolatedFingerprint, isolatedHeadOid, changedFiles}——module 的 fingerprint CAS 全靠它。
- `calculatePlan`（src/session-checkout-apply.ts:1365）：preflight 不持久化（src/session-checkout-apply.ts:1357）、plan 持久化（src/session-checkout-apply.ts:1361）；冲突时返回真实 localHeadOid 供 Isolated 会话同步。
- `checkpoint`（src/session-checkout-apply.ts:1079）：仅 detached HEAD 允许（operation_not_allowed）；CAS expectedHeadOid/fingerprint；createUserCommit 后 `beforeCommit`（Host journal 先于 HEAD/index 变更持久化）→ 重建 final index → 真 index 加 index.lock+marker → 邻接 index → update-ref --no-deref HEAD（CAS old-value）→ rename 邻接 index → marker 清理；失败回滚 ref CAS，回滚失败置 recoveryState 'uncertain' 并保留恢复证据。
- `recoverCheckpoint`（src/session-checkout-apply.ts:1215）：headOid==parentOid → `checkpoint_aborted`；headOid==commitOid → 树/index 一致性校验后 `checkpoint_recovered`；其他 HEAD → stale_isolated。
- `preview`：beforeWrite receipt 回调——Local 写入前 journal 必须已持久化，失败不得触碰 Local；`assessPreviewRecovery` 严格只读；`rollback` 的 beforeWrite 在最终 Local CAS 前；`finalize` 的 beforeCommit 在 commit object 已建、branch ref 未更新时持久化恢复信息。
- Options seams（src/session-checkout-apply.ts:273）：beforeFinalLocalValidation / afterLocalWriteBeforeVerification / beforeFinalIsolatedValidation / afterIsolatedWriteBeforeVerification——测试注入点。

失败分类纪律：stale_local/stale_isolated/invalid_plan 等码可证明 Local 未被触碰（状态机直接回 ready，见 [[session-checkout-module|Session Checkout Module]]）；其余（git_error 等）交由 reconcile 判定 recovery_required。
