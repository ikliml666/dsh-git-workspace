---
title: console_contract
type: module
source_files:
  - src/console-contract.ts
  - src/console-host/projection.ts
  - src/console-host/service.ts
  - src/console-host/errors.ts
  - src/console-remote/remote.ts
  - tests/console-contract.test.ts
  - tests/support/worktree-console.ts
tags: [console, contract, dto, adapter, request-response, host-client]
---

## Overview

`src/console-contract.ts` 是未来 Harness-native Worktree Console 的**纯 JSON 共享契约**模块。它刻意不包含任何 Cordis、React、Remote 或文件系统实现（见文件头注释 `src/console-contract.ts:1-9`）。Host 与 Client 三条并行的 track（Workspace Sidebar、Target Console、Review Console）都共享这些 DTO，并遵守一条唯一的权威规则：**每一次 Host 操作都会解析出调用方确切的 Session，并在执行时重新校验 project、owner、cwd、revision 与 review 身份**（`src/console-contract.ts:4-8`）。

模块对外暴露三类东西：

- **状态/投影原语**：`WORKTREE_CONSOLE_TARGET_STATES`、`WorktreeConsoleTargetState`、`worktreeReachedDelivery`、`consoleStateFromDomain`——把底层 domain 的 `phase` + `deliveryState` 投影成一个稳定、UI 面向的 `WorktreeConsoleTargetState`。
- **请求/响应 DTO**：`WorktreeConsole*Request` / `WorktreeConsole*Response`，覆盖创建、检查、预检、预览、检查点、回滚、定稿、保留、回到 Local、Git 操作、放弃快照等全部控制台能力。
- **统一能力/错误契约**：`WorktreeConsoleCapabilities`（按调用方身份算出来的按钮可用性）、`WorktreeConsoleError` / `WorktreeConsoleOutcome<T>` / `ERROR_META` / `worktreeConsoleErrorMeta`（一套客户端可据此决定「刷新 / 确认脏 / 打开恢复 / 重试」的恢复策略）、以及作为 Host↔Client 接缝的 `WorktreeConsoleAdapter` 接口。

## Key Components

本模块所有导出均在 `src/console-contract.ts`。下面按「常量 / 状态投影函数 / 状态与 DTO 类型 / 能力 / 错误契约 / 适配器接口」分组列出，行号以 `read_code` 返回的「行号| 」前缀为准。

### 常量与状态投影

- `WORKTREE_CONSOLE_TARGET_STATES`（26-38）：UI 面向的目标状态枚举，含 `local | creating | working | ready_for_review | preview_active | preview_detached | retained | cleanup_pending | recovery_required | delivered | discarded`。
- `WorktreeConsoleTargetState`（40）：`typeof WORKTREE_CONSOLE_TARGET_STATES[number]`。
- `WorktreeConsoleDeliveryState`（42-49）：domain 侧的交付状态（`working | ready_for_review | preview_active | preview_detached | finalized | retained | delivered`）。
- `WorktreeConsoleProjectionSource`（52-56）：投影所需的最小 domain 事实，只有 `kind`、`phase`、`deliveryState?` 三个字段。
- `worktreeReachedDelivery(phase, deliveryState?)`（64-73）：判定某记录是否「到达交付」（task 已落到用户手中），`delivered`/`finalized`/`retained` 三种 deliveryState 或 `finalized`/`retained` 两个 phase 都算完成；用于 Sidebar 终态标签，绝不能把已交付记录投影成「已放弃」。
- `consoleStateFromDomain(source)`（76-91）：把 `kind`+`phase`+`deliveryState` 投影成唯一稳定的 `WorktreeConsoleTargetState`。优先级：`local` → `recovery_required` → `creating`(preparing) → `delivered` → `discarded`（保留放弃前的交付标签，只有 `delivered` 能在 discarded 后存活）→ `retained`/`cleanup_pending`(`finalized`) → `preview_detached`/`preview_active`/`ready_for_review` → 兜底 `working`。`tests/console-contract.test.ts:21-38` 逐分支断言了这套映射。

### 错误契约

- `WORKTREE_CONSOLE_ERROR_CODES`（609-614）：在 `SESSION_CHECKOUT_ERROR_CODES` 之上追加 `transport_unavailable | malformed_response | timeout`。
- `WorktreeConsoleErrorCode`（616）：错误码联合类型。
- `WorktreeConsoleErrorCategory`（617-625）：`permission | stale | confirmation | recovery | conflict | unavailable | invalid | internal`。
- `WorktreeConsoleRecovery`（626）：客户端恢复动作 `'none' | 'refresh' | 'confirm_dirty' | 'open_recovery' | 'retry'`。
- `WorktreeConsoleError`（688-693）：`{ code, message, details?, continuation? }`。
- `WorktreeConsoleOutcome<T>`（695-697）：判别联合 `{ ok: true; value: T } | { ok: false; error: WorktreeConsoleError }`，是全部 Host/Remote 方法的统一返回包。
- `WorktreeConsoleErrorMeta`（699-703）：`{ category, recovery, retryable }`。
- `ERROR_META`（705-738）：以 `satisfies Record<WorktreeConsoleErrorCode, WorktreeConsoleErrorMeta>` 静态校验的码→策略表，逐码定义了 category/recovery/retryable（如 `not_owner`→permission/none/false，`stale_target`→stale/refresh/true，`dirty_confirmation_required`→confirmation/confirm_dirty/true，`transport_unavailable`→unavailable/retry/true）。
- `worktreeConsoleErrorMeta(code)`（740-742）：查询函数，返回 `ERROR_META[code]`。`tests/console-contract.test.ts:54-75` 断言了 `not_owner`/`stale_target`/`dirty_confirmation_required`/`transport_unavailable` 四类映射。

### 能力标志

- `WorktreeConsoleCapabilities`（98-124）：17 个布尔能力。注释强调 `checkpoint`（保存已审查快照为 managed-worktree-only 阶段）、`resumeRevision`（失效未同步审查并继续同一轮迭代）、`finalize`（跳过 Local Preview 的 Ready→Commit 直通路）、`beginNextIteration`（重建已清理交付 owner 的不可变 cwd 用于下一轮）、`returnToLocal`（仅在 Session 仍指向 `isolated` 时把其解绑回 Local）等语义。`capabilities()` 在 `src/console-host/projection.ts:62-105` 按 caller 身份（owner/source/linkedRead）与记录阶段算出这些布尔值。
- `WorktreeConsolePreviewRecovery`（126-131）：预览脱离信息 `{ previewId, detachedAt, reason, attemptedAction }`。

### 状态与目标 DTO

- `WorktreeConsoleProject`（93-96）：`{ id, name }`。
- `WorktreeConsoleTargetSummary`（148-179）：**无路径**的目标摘要行，供列表/胶囊状态用。全部字段：`project`、`checkoutId`、`sourceSessionId`、`ownerSessionId`、`targetSessionId?`、`iteration`、`revision`、`state`、`phase`、`dirty`、`currentOid`、`commitOid?`、`sourceBranch?`、`retention?`、`retainedAt?`、`expiresAt?`、`permanent?`、`cleanupMessage?`、`deliveryProof?`、`review?`、`checkpoints?`、`checkpointGeneration?`、`reviewSlot?`、`reviewSlotOwnerSessionId?`、`reviewSlotHolder?`、`previewRecovery?`、`capabilities`。注意 `retainedAt`/`expiresAt`/`cleanupMessage` 仅在 `delivery.state==='retained'|'finalized'` 时由 `projectRecord` 现算（`src/console-host/projection.ts:151-158`）。
- `WorktreeConsoleTargetDetails`（181-195）：在 Summary 之上增加 `managedRoot?`、`sourceRoot?`（Host 校验过的 Local 根，仅供 source Session 导航）、`sourceOid`、`currentBranch?`、`recoveryContinuation?`（owner-only 的一次性授权恢复 continuation）。
- `WorktreeConsoleCurrentRequest`/`Response`（197-203）：`current` 轮询，返回 `target: WorktreeConsoleTargetDetails`。
- `WorktreeConsoleListRequest`/`Response`（205-214）：`list`，支持 `needsAttention?`/`includeDelivered?`，返回 `project` 与 `worktrees: WorktreeConsoleTargetSummary[]`。

### 工作区侧边栏 DTO

- `WorktreeSidebarTaskState`（216-223）：`working | ready_for_review | preview_active | preview_detached | recovery_required | finalized | discarded`。
- `WorktreeSidebarTask`（226-236）：只读任务身份，`{ checkoutId, ownerSessionId, sourceSessionId, iteration, revision, phase, state, sourceBranch? }`。
- `WorktreeSidebarProject`（238-243）：`{ project, tasks, memberships? }`，memberships 含 `workspaceIds`/`sessionIds`。
- `WorktreeSidebarTopologyResponse`（245-251）：`projects`、`workspaceClientFlavor?`（`legacy|alpha|next|modern|unsupported`，Host 锁定版本，未知代际不得挂载猜测的 Client Browser）、`officialWorkspaceActive?`（Host 选举结果）。
- `WorktreeClientBootReport`（253-263）：Client 上报实际跑的是哪条 sidebar 分支（`flavor`/`branch`/`registered`/`detail?`/`elapsedMountMs?`/`elapsedTopologyMs?`）。

### 创建与检查/预检 DTO

- `WorktreeConsoleCreatePreflightResponse`（266-269）：判别联合 `{ kind: 'ready'; branches? } | { kind: 'empty'; confirmationToken } | { kind: 'files' }`。
- `WorktreeConsoleCreateRequest`/`Response`（271-281）：创建，`branch?` 指定从哪个本地分支 tip 起线；响应含 `target`、`targetSessionId`、`managedRoot`。
- `WorktreeConsoleInspectRequest`/`Response`（283-290）：按 `checkoutId` 查看，返回 `target: WorktreeConsoleTargetDetails`。
- `WorktreeConsoleDiscardRequest`（292-298）：放弃，带 `expectedRevision`、`confirmDirty`、`rollbackPreview?`。
- `WorktreeConsolePreflightRequest`/`Response`（300-309）：`preflight: WorktreeApplyPreflightView`。
- `WorktreeConsolePreviewRequest`（311-316）：进入预览，带 `expectedRevision`/`expectedReviewId`。
- `WorktreeConsoleCheckpointRequest`（318-326）：检查点，`expectedGeneration`/`requestId`/`commitMessage`。
- `WorktreeConsoleResumeRevisionRequest`（328-335）：失效审查并续作，`conflictContinuation?` 为显式冲突恢复时 Host 在 CAS 下重跑冲突预检。
- `WorktreeConsolePreviewRecoveryPreflightRequest`/`Response`（337-347）：预览恢复预检。
- `WorktreeConsolePreparePreviewRecoveryAnalysisRequest`（349-351）：在预检请求上追加 `recoveryProof`。
- `WorktreeConsoleCreatePreviewRecoveryHandoffRequest`/`Response`（353-359）：恢复交接，响应扩展出 `recoveryContinuation: WorktreePreviewRecoveryHandoffProof`。
- `WorktreeConsoleRollbackPreviewRequest`（361-367）：回滚预览，`resumeRevision?`/`recoveryProof?`。
- `WorktreeConsoleFinalizeRequest`（369-377）：定稿，`commitMessage` + `retention: WorktreeRetentionMode`。
- `WorktreeConsoleFinalizePreviewRequest`（379-387）：预览内定稿，可选 `recoveryProof?`。
- `WorktreeConsoleSetRetentionRequest`（389-394）：`retention: Exclude<WorktreeRetentionMode,'cleanup'>`。
- `WorktreeConsoleSetPermanentRequest`（396-402）：常驻标记豁免自动清理。
- `WorktreeConsoleRetryCleanupRequest`（404-408）、`WorktreeConsoleBeginNextIterationRequest`（410-414）、`WorktreeConsoleClearSidebarBadgeRequest`（416-421）：清除终态徽章。
- `WorktreeConsoleReturnToLocalRequest`/`Response`（430-437）：解绑已交付隔离会话回 Local；注释明确**仅针对已交付的 Worktree**，未交付的拒绝。
- `WorktreeConsoleMutationResponse`（439-445）：所有变更类操作的统一响应，`{ target: WorktreeConsoleTargetSummary, changedFiles?, commitOid?, checkpoint?, recoveryContinuation? }`。

### 放弃快照 DTO

- `WorktreeConsoleAbandonedSnapshot`（448-454）：`{ checkoutId, projectName, snapshotOid, snapshotAt, revision }`。
- `WorktreeConsoleAbandonedListRequest`/`Response`（456-462）、`WorktreeConsoleRestoreAbandonedRequest`/`Response`（464-472）。

### Git 工具 DTO

- `WorktreeConsoleFileStatus`（481）：`added|modified|deleted|renamed|binary`。
- `WorktreeConsoleDiffFile`（483-489）：`{ path, previousPath?, status, patch: string|null, truncated }`。
- `WorktreeConsoleReviewDiffRequest`/`Response`（492-504）：审查 diff，`files` + `truncated`。
- `WorktreeConsoleGitBranch`/`GitOverviewResponse`（507-520）、`GitPruneEntry`/`GitPruneResponse`（522-534）、`GitGraphCommit`/`GitGraphResponse`（536-551，`authorTime` 为 epoch 秒）、`GitMutationResponse`（553-556）、`GitTag`/`GitTagListResponse`（558-576，含 `pushed: boolean|null` 表示远程查询失败不得报「未推送」）、`GitTagMutationResponse`（578-584）、`GitCreateTagRequest`（586-595）、`GitDeleteTagRequest`（597-602）、`GitPushTagRequest`（604-607）。

### 恢复 continuation 与 adapter 接口

- `WorktreeApplyConflictContinuation`（628-639）、`WorktreeApplyConflictRecoveryProof`（641-650）、`WorktreeReviewRegenerationProof`（652-658）、`WorktreePreviewRecoveryAnalysisProof`（660-668）、`WorktreePreviewRecoveryHandoffProof`（670-679）：四种 `kind` 标记的 continuation/proof，`WorktreeRecoveryProof`（681-685）为其联合。
- `WorktreeConsoleContinuation`（686）= `WorktreeApplyConflictContinuation`。
- `WorktreeConsoleAdapter`（744-784）：**归一化的 Client 接缝**，把 Remote 传输细节藏在单一适配器后。所有方法均返回 `Promise<WorktreeConsoleOutcome<...>>`：`sidebarTopology`、`current`、`list`、`create`、`inspect`、`reviewDiff`、`preflight`、`previewRecoveryPreflight`、`preparePreviewRecoveryAnalysis`、`createPreviewRecoveryHandoff`、`preview`、`checkpoint`、`resumeRevision`、`prepareReviewRegeneration`、`rollbackPreview`、`discard`、`finalize`、`finalizePreview`、`setRetention`、`setPermanent`、`retryCleanup`、`beginNextIteration`、`returnToLocal`、`clearSidebarBadge`、`gitOverview`、`gitGraph`、`gitCreateBranch`、`gitSwitchBranch`、`gitPruneMergedBranches`、`gitListTags`、`gitCreateTag`、`gitDeleteTag`、`gitPushTag` 为必填；`preflightCreate?`、`createWithInitialCommit?`、`initializeProject?`、`listAbandoned?`、`restoreAbandoned?` 为可选。`tests/console-contract.test.ts:77-97` 用 `createWorktreeConsoleAdapterFixture` 校验了 `current`+`finalize` 的可重放调用序列。

## Architecture

`console-contract` 是零实现的纯类型/契约层，三条消费链路共享同一组 DTO。Host 侧把 `@deepseek-ai/dsh-typert-protocol` 的 Remote 方法包成 `WorktreeConsoleService`（`src/console-host/service.ts:35`），在 `controlPlane` 里用 `console-contract` 的 DTO 描述请求/响应；投影由 `src/console-host/projection.ts` 的 `projectRecord`/`projectDetails`/`projectLocal` 把内部 `ManagedCheckoutRecord` 映射成 `WorktreeConsoleTargetSummary`/`Details`。Client 侧只依赖归一化的 `WorktreeConsoleAdapter`（`src/console-contract.ts:745`），真实传输由 `src/console-remote/remote.ts` 的 `gitWorktree/*` Typert Remote 命名空间承载。

```text
┌─────────────────────────────┐      ┌─────────────────────────────┐
│ Client tracks (Sidebar /    │      │ Host: WorktreeConsoleService│
│ Target / Review Console)    │      │ (console-host/service.ts:35)│
└───────────────┬─────────────┘      └───────────────┬─────────────┘
                │ WorktreeConsoleAdapter             │ controlPlane.*
                │ (console-contract.ts:744)          │ (console-host/control-plane.ts)
                ▼                                     ▼
┌─────────────────────────────┐      ┌─────────────────────────────┐
│ console-remote/remote.ts    │ Typert│ console-host/projection.ts │
│ gitWorktree/* namespace      │ RPC  │ projectRecord/projectDetails│
│ (Typed Remote seam)         │──────►│ (record → Summary/Details)  │
└───────────────┬─────────────┘      └───────────────┬─────────────┘
                │                                     │
                │        shared DTOs / Outcome<T)     │
                └──────────► src/console-contract.ts ◄┘
                           (state, requests, responses,
                            capabilities, errors, adapter)
```

## Data Flow

## Connections

## Known Issues
