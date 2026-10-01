---
title: Session Checkout State Machine
type: module
source_files:
  - src/session-checkout-module.ts
  - src/types.ts
  - src/ports.ts
  - src/checkpoint.ts
  - src/creation-failure.ts
  - src/managed-worktree-path.ts
tags:
  - state-machine
  - checkout
  - recovery
  - retention
---

# Session Checkout State Machine

`createSessionCheckoutModule`（src/session-checkout-module.ts:189，全文件 4280 行几乎都在此工厂内）是插件核心：从 Domi 移植的 session-checkout 状态机（头注释 src/session-checkout-module.ts:65），保留 receipt-first Local Preview、回滚/finalize、项目验收槽、崩溃恢复与 fingerprint CAS，同时把所有权适配到 Harness 分离的 source Local Session 与 target owner Session。进程内全部状态持久化于 `ManagedCheckoutsRegistry`（version 2，src/ports.ts:365）。

## 领域类型（src/types.ts）

- `SessionCheckoutPhase`（src/types.ts:18）：preparing | ready | applying(废弃 v1) | mutating | recovery_required | finalized | retained | discarded。
- `WorktreeDeliveryView`（src/types.ts:85）七态：working / ready_for_review / preview_active / preview_detached(reason stale_local|preview_modified, attemptedAction) / finalized(commitOid, proof, cleanup) / retained(retention, retainedAt, expiresAt) / delivered(iteration, commitOid, proof)。
- `WorktreePreviewRecoveryProof`（src/types.ts:262）：preview 恢复的完整指纹证明（receiptFingerprint、local 五树 Oid、rollback/finalize 各自 safe|blocked、generation）。
- `SESSION_CHECKOUT_ERROR_CODES`（src/types.ts:512-542）：28 个领域错误码（registry_corrupt、commit_isolation_conflict、project_acceptance_busy、recovery_unsafe 等）。

## 端口契约（src/ports.ts）

领域只依赖端口：`SessionCheckoutLookupPort`（src/ports.ts:39，getSidebarMemberships 仅导航证据、永不作授权）、`SessionCheckoutGitPort`（src/ports.ts:61，inspect/createDetachedWorktree/removeWorktree/retainInternalArtifact/isAncestor/pushBranch?）、`SessionCheckoutFilesPort`（src/ports.ts:94，含 inspectDirectoryIdentity/quarantineDirectoryTree）、`SessionCheckoutRegistryPort`（src/ports.ts:372）。journal（src/ports.ts:140-176）把 create 与 7 种 mutation 拆成 planning→writing_local→updating_ref→replacing_index→removing_worktree 等步骤，是崩溃恢复的依据。

## 绑定与互斥锁

- `resolveBinding`（src/session-checkout-module.ts:892）：持久化绑定校验；项目不匹配仅当 (discarded+delivered+原 workspace 根缺失+resolvedPathsEqual(workspace.root, record.managedRoot)) 或 canonical 化后相等才放行，否则 `project_mismatch`。
- **withBindingLock**（src/session-checkout-module.ts:959）：`bindingQueue` Promise 链式互斥队列（src/session-checkout-module.ts:931）。三模式 exclusive / maintenance / maintenance_draining——maintenance 允许只读 inspect 并发旁路；释放时先关旁路、再等已启动 inspect 结束，之后 mutation 才接管队列（src/session-checkout-module.ts:983）。
- `inspectAvailable`（src/session-checkout-module.ts:1014）：按 activeBindingOperation 模式选择旁路/等待/正常路径；后台 reconcile/retention 可能因 Windows 文件占用持续数十秒（src/session-checkout-module.ts:1006）。
- `validateManagedCheckoutDetailed`（src/session-checkout-module.ts:530）：托管身份三读并行——managed/local 双 `git.inspect` 并发 + `status` 提前起（挂 noop catch 防未消费 rejection，仅在验证通过路径 await，失败→unavailable 语义不变）；checkpoint 链校验仍在快照就绪后串行。
- `observeManagedCheckout`（src/session-checkout-module.ts:3728）：纯读（registry.read + validateManagedCheckout，不写 registry）。**批量入口 `observeManagedCheckouts`**（src/session-checkout-module.ts:3740）：一次 `withBindingLock` 内 `Promise.all` 并行验证多个 checkout，list 面板观察从「N 次 × 5 spawn」锁内串行降为单锁批量；单条失败整体抛错（与逐条语义一致）；接口可选方法（src/index.ts:157），宿主模块缺批量方法时 control-plane 回退逐条。
- 返回对象（src/session-checkout-module.ts:4206-4280）：mutation 端点全部 withBindingLock；reconcile/cleanupExpiredRetained 以 `{allowConcurrentInspect: true}` 进入 maintenance；只读 listManagedWorktrees 不加锁（src/session-checkout-module.ts:4263）。

## 目标创建

- `bindTarget`（src/session-checkout-module.ts:3937）：签名 `(sessionId, choice, createAttempt=0, requestStartedAt, sourceSessionId, createOptions?: {topic?, branch?})`。已有 isolated 绑定且该 checkout 已 delivered/finalized/retained → 解绑并以 nextIteration 重建；local 绑定幂等返回；否则 target_already_bound。空仓库（headOid 'unborn'）要求先走 initialCommit 确认（src/session-checkout-module.ts:4007）。**branch 选项**（src/session-checkout-module.ts:4013-4019）：createOptions.branch 给定时以 `git.resolveLocalBranchTip(localGitRoot, branch)` 的 tip 为 baseOid（不存在的分支 → invalid_input `branchDoesNotExist`），worktree 仍 detached 创建于该 tip；binding.sourceRef/sourceOid 仍记录源会话分支与 HEAD，交付语义不变（决策见 [[create-from-branch-is-base-only|Create From Branch Is Base Only]]）。路径候选取 [8,12,32] 三档身份长度（src/session-checkout-module.ts:4025），优先 sibling 容器避免 Local 看到未跟踪目录（src/session-checkout-module.ts:4036），同名未知目录只有空目录可回收；`git worktree add`（detached）由 createDetachedWorktree 执行并回写 creation evidence；失败路径区分「有 .git 的部分 checkout → markRecoveryRequired」与「可清理残余 → 删记录、回滚绑定、createAttempt<1 时换 fallback 重试一次」。
- `createIsolatedTarget`（src/session-checkout-module.ts:4243）：要求独立预分配的 targetSessionId（与 source 相同即 invalid_input）；source 无绑定则先自动绑 local；createOptions 可带 topic（路径命名）或 branch（基准分支）；返回 `IsolatedTargetLaunch{targetSessionId, managedRoot, target}`。
- `beginNextIterationTarget`（src/session-checkout-module.ts:3760）：前提是前代 checkout 已 discarded+delivered，且 owner 会话的不可变 cwd 正是 `predecessor.managedRoot`（src/session-checkout-module.ts:3783）；**复用同一 managedRoot 路径**创建新 record（predecessorCheckoutId，src/session-checkout-module.ts:3824），baseOid 取 Local 当前 HEAD；Local 侧 git commonDir、项目相对路径、容器身份全部复验。

## 操作生命周期（operateTarget 分发 src/session-checkout-module.ts:3383）

- apply（src/session-checkout-module.ts:1779）：CAS revision → 项目验收槽互斥 → applyEngine.plan → conflict 返回 `canRetryAfterRefresh:false` → isolatedFingerprint 失配即 stale_isolated → writing_local → 成功后 `applyBaseOid = nextBaseOid`。
- preview（src/session-checkout-module.ts:2212）：receipt-first——beforeWrite 回调先 `retainPreviewArtifacts`（4 个内部 ref previews/<previewId>/…，src/session-checkout-module.ts:1950）并持久化 journal artifacts_retained，才允许触碰 Local。
- checkpoint（src/session-checkout-module.ts:1358）：requestId 幂等重放、`checkpointGenerationForRecord` CAS（src/checkpoint.ts:16）；preview_active 时先回滚再打 checkpoint。
- finish（src/session-checkout-module.ts:2907）：直连交付；legacy 守卫（src/session-checkout-module.ts:2929）禁止旧 apply 路径写过的 worktree 直接 finish；内部先 preview 再 finalize；autoPush 尽力 push（src/session-checkout-module.ts:3164，绝不 force，失败只报告）。
- finalize_preview（src/session-checkout-module.ts:2739）/ rollback_preview（src/session-checkout-module.ts:2398）：preview_detached 必须携带 `WorktreePreviewRecoveryProof` 且 `recoveryProofMatches`（generation 自校验，src/session-checkout-module.ts:2106）。
- discard（src/session-checkout-module.ts:3207）：preview_detached 拒绝丢弃（恢复优先）；dirty（工作树不净或有 checkpoint）且无 confirmDirty → dirty_confirmation_required。
- recover（src/session-checkout-module.ts:3335）：create journal 带证据或 mutating 中 → recovery_unsafe（无法证明 Local 未被修改）；`validateManagedCheckout` 通过才回 ready。

## 恢复与收敛

- `reconcile`（src/session-checkout-module.ts:1032）：predecessor 复用、finalized 继续收口、checkpoint journal 逐 step 恢复（updating_ref → applyEngine.recoverCheckpoint，产出 checkpoint_aborted/checkpoint_recovered）、preview receipt 未落盘可证明 Local 未触碰 → ready、孤儿检测；最后 withCleanupTimeout 清 finalized + cleanupExpiredRetained。
- `detachPreviewAfterLocalDrift`（src/session-checkout-module.ts:2359）：Local 漂移后 preview 转 preview_detached，等待用户经 UI 恢复。
- `markRecoveryRequired`（src/session-checkout-module.ts:475）：CAS revision+phase 后才持久化 recovery。

## 保留与清理

- `retainFinalized`（src/session-checkout-module.ts:2505）：finalized → retained{retention, expiresAt}；`WorktreeRetentionMode` cleanup/retain_24h/retain_3d/retain_manual（src/types.ts:32）。
- `cleanupFinalized`（src/session-checkout-module.ts:2553）：fingerprint CAS（cleanupNewChanges）→ beginRemoval（journal removing_worktree）→ git.removeWorktree → 仍存在则 validateDetachedCleanupResidue → quarantineAndRemove（隔离名 `.dsh-wt-cleanup--<checkoutId8>--<operationId>`）→ collectEmptyManagedContainer 回收空容器（src/session-checkout-module.ts:2537）。失败按 quarantine_busy|directory_busy 落 cleanupMessage（zh 子串映射 cleanupReasonForMessage，src/session-checkout-module.ts:127）。
- `cleanupExpiredRetained`（src/session-checkout-module.ts:3868）：到期 retained 记录逐个 withCleanupTimeout（30s，src/session-checkout-module.ts:91——单个占用记录不能卡住启动收敛）清理；`permanent === true` 的记录豁免（src/session-checkout-module.ts:3852 filter）。
- `enforceWorktreeKeepCount`（src/session-checkout-module.ts:3890）：codex 对齐的 LRU 上限。候选 = phase/delivery 均为 finalized|retained 且 `permanent !== true`，按 `managedUpdatedAt` 升序，超出 `worktreeKeepCount` 的最旧部分逐个走 **完整 discard 安全链**（`operateDiscard(..., {confirmDirty: true})`——含 G2 放弃前快照，快照失败即中止逐出）并受 withCleanupTimeout 保护。keepCount 0 = 禁用，默认 15（src/index.ts worktreeKeepCount volatile 配置，LiveValue 支持）；挂载点：reconcileOnReady 与 retentionTimer 在 cleanupExpiredRetained 之后顺序调用（src/index.ts:339-361）。

## 放弃快照与常驻标记（codex 对齐）

- **G2 放弃前快照**：`SessionCheckoutGitPort.snapshotAbandonedWorktree?/restoreAbandonedSnapshot?`（src/ports.ts）；实现见 src/adapters/git.ts `abandonedSnapshotRef(checkoutId) = refs/dsh-worktree/abandoned/<checkoutId>`（必须在 checkoutRefRoot 之外，否则 releaseApplyBaseBestEffort 连删）。operateDiscard 在 dirty 且 confirmDirty 后、removeWorktree 前快照（add -A → write-tree → commit-tree → update-ref），失败中止 discard；成功记 `abandonedSnapshotOid/abandonedSnapshotAt`（src/ports.ts ManagedCheckoutRecord）。恢复 = `restoreAbandonedWorktreeSnapshot`（模块）→ 在 localRoot 建 `worktree-restore-<oid8>` 分支并释放 ref。控制台：`listAbandoned`/`restoreAbandoned` 远程命令 + WorktreeConsoleView 底部「可恢复的放弃快照」strip。
- **G4 permanent 常驻**：`ManagedCheckoutRecord.permanent?: boolean`；`manageManagedWorktree` action `set_permanent`（src/session-checkout-module.ts:3826，discarded/delivered 拒绝 `aDeliveredWorktreeCannotBeMarkedPermanent`）；豁免 cleanupExpiredRetained 与 enforceWorktreeKeepCount，**手动清理不受限**。控制台 `setPermanent` 命令 + 行内 pin/pinOff 按钮（ReviewIcon pin/pinOff）+ facts 里「常驻」徽标。

## 管理面与授权

- `listManagedWorktreesForSession`（src/session-checkout-module.ts:3639）：只列 projectId 匹配且 owner|source 为本会话的 checkout。
- `manageManagedWorktreeForSession`（src/session-checkout-module.ts:3655）：owner 或 source（owner 会话仍在时 source 无权）；`manageManagedWorktree`（src/session-checkout-module.ts:3783）支持 discard/set_retention/set_permanent/cleanup——owner 会话可尚未存在，故不重新经 lookup 解析（src/session-checkout-module.ts:3681）。
- `bulkCleanupManagedWorktrees`（src/session-checkout-module.ts:3577）：候选逐个双重 CAS 后 cleanupFinalized({allowLegacyResidue:true})。
- `runtimeContext`（src/session-checkout-module.ts:807）：同步 registry 快照生成模型上下文指引（未选目标/preview_active/preview_detached/handoff/working+autoDeliver→worktree_deliver/delivered→begin_next_iteration）。

## 支撑模块

- `checkpointGenerationForRecord`（src/checkpoint.ts:16）：canonicalJson（键排序、丢 undefined）sha256 CAS token，仅 ready_for_review|preview_active 有效。
- `WorktreeCreationFailure`（src/creation-failure.ts:2）：`rolledBack` 标志——「创建失败不是把空路径推断为安全的许可」（src/creation-failure.ts:1）。
- 路径命名（src/managed-worktree-path.ts）：`sanitizeManagedWorktreeLabel`（src/managed-worktree-path.ts:15，40 码点、Windows 保留名前缀 `_`）、`createManagedWorktreeRepositoryKey`（src/managed-worktree-path.ts:38，sha256 前 12 位）、topic 命名 `<topic>-<YYYYMMDD>`（src/managed-worktree-path.ts:66）。
