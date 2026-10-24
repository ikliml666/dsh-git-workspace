---
title: Review Console 评审操作与恢复
type: module
source_files:
  - src/client/review-console/index.ts
  - src/client/review-console/WorktreeReviewPanel.tsx
  - src/client/review-console/ReviewActions.tsx
  - src/client/review-console/PreflightStatus.tsx
  - src/client/review-console/DeliveryProof.tsx
  - src/client/review-console/ReviewIcon.tsx
  - src/client/review-console/preflight-cache.ts
  - src/client/review-console/status-events.ts
  - src/client/review-console/request-cache.ts
tags: [client, review, preflight, recovery]
---

# Review Console 评审操作与恢复

评审证据展示与全部 Worktree 变更动作的执行中枢：预检门禁、预览/检查点/回滚/提交/丢弃，以及 apply 冲突后的只读恢复与持久化恢复队列。数据源与导航编排分别来自 [[client-boot]] 与 [[target-console]]。

## Overview

Review Console 模块负责管理 Git Worktree 的审查（Review）生命周期。它包含以下部分：

1. **UI 组件层**：渲染紧凑卡片（`WorktreeReviewPanel`）、预检状态（`PreflightStatus`）、交付证明（`DeliveryProof`）、图标（`ReviewIcon`）以及最核心的交互组件（`ReviewActions`）。
2. **状态与逻辑层**：`ReviewActions` 处理复杂的异步状态机，包括预检（Preflight）、冲突恢复（Recovery Continuation）、会话等待、以及通过 `binding.session.prompt` 与 Host/Agent 通信。
3. **缓存基础设施**：`preflight-cache.ts` 与 `request-cache.ts` 提供基于 `WeakMap` 的身份键控单飞行缓存，并与 React `useSyncExternalStore` 集成。
4. **事件总线**：`status-events.ts` 定义全局事件以通知所有挂载的 Review 表面重新读取 Host 权威目标。

核心安全机制包括：
*   **身份强校验**：所有向 Host 发送的请求必须经过严格的身份一致性验证（如 `ReviewActions.tsx` L515-L528 对 checkpoint 返回值的校验），确保目标状态与请求发出时一致。
*   **单飞行缓存**：`request-cache.ts` 的 `createRequestCache`（L41-L150）实现并发控制，避免重复请求。
*   **恢复队列**：通过 `recovery-continuation.ts`（由 `ReviewActions.tsx` 导入但未在本模块源文件中提供）持久化恢复请求上下文，本模块仅消费 `useWorktreeRecoverySnapshot` 等钩子。

## Key Components

### 1. 入口与辅助函数 (`src/client/review-console/index.ts`)

导出公共 API 和数据转换函数。

*   **`WorktreeReviewPanel` (L4)**：从 `./WorktreeReviewPanel.js` 重导出审查面板组件。
*   **类型导出 (L5-L9)**：`WorktreeReviewEvidence`、`WorktreeReviewIdentity`、`WorktreeReviewPanelProps`。
*   **`reviewEvidenceFromTarget` (L12-L21)**
    *   **参数**：`target: WorktreeConsoleTargetSummary`, `detailsMarkdown?: string`
    *   **返回**：`WorktreeReviewEvidence | null`
    *   **职责**：将 `target.review` 投影为 `WorktreeReviewEvidence`；若 `target.review` 为空则返回 `null`；支持注入额外的 `detailsMarkdown`。
*   **`reviewIdentityFromTarget` (L24-L35)**
    *   **参数**：`sessionId: string`, `target: WorktreeConsoleTargetSummary`
    *   **返回**：`WorktreeReviewIdentity | null`
    *   **职责**：构建 `WorktreeReviewIdentity`（含 `sessionId`, `checkoutId`, `expectedRevision`, `expectedReviewId`）；若 `target.checkoutId` 或 `target.review` 缺失则返回 `null`。

### 2. 只读面板 (`src/client/review-console/WorktreeReviewPanel.tsx`)

展示审查结果的紧凑卡片（Compact Card/Dock）。

*   **接口 `WorktreeReviewEvidence` (L9-L11)**：扩展自 `WorktreeConsoleReviewSummary`，字段：
    *   `detailsMarkdown?: string`：可选的详情 Markdown。
*   **接口 `WorktreeReviewIdentity` (L13-L18)**：字段：
    *   `sessionId: string`
    *   `checkoutId: string`
    *   `expectedRevision: number`
    *   `expectedReviewId: string`
*   **接口 `WorktreeReviewPanelProps` (L20-L25)**：字段：
    *   `review: WorktreeReviewEvidence`
    *   `identity?: WorktreeReviewIdentity`
    *   `target?: WorktreeConsoleTargetSummary`
    *   `unavailableMessage?: string`
*   **`validationLabel` (L27-L32)**：根据 `validationStatus`（`passed/failed/partial/其他`）映射 i18n 文本。
*   **`testStatusLabel` (L34-L38)**：根据测试 `status`（`passed/failed/其他`）映射 i18n 文本。
*   **`reviewIsStale` (L40-L52)**：判断证据是否过期。
    *   逻辑：若 `target` 不存在返回 `false`；若 `target.state === 'working'` 返回 `true`；若 state 不在白名单（`ready_for_review`, `preview_active`, `preview_detached`, `cleanup_pending`, `recovery_required`, `retained`）返回 `false`；比较 `target.revision` 与 `identity?.expectedRevision ?? review.revision` 以及 `target.review.reviewId`。
*   **`WorktreeReviewPanel` 组件 (L54-L117)**：
    *   状态：`detailsExpanded` (L57)，受 `review.reviewId` 和 `review.revision` 变化重置 (L58)。
    *   渲染：标题、摘要、验证状态、文件数、Checkpoint 数（L66-L91）；详情区显示 Identity 前8位+Revision、验证摘要、测试列表 (L93-L113)；底部状态条显示 stale 或 unavailable 信息 (L115)。

### 3. 核心交互组件 (`src/client/review-console/ReviewActions.tsx`)

处理所有突变操作（Mutation）的状态机、预检、恢复和 UI 反馈。

*   **接口 `ReviewActionsProps` (L35-L50)**：字段含 `review`, `adapter?`, `services?`, `identity?`, `target?`, `disabled`, `unavailableMessage`, `renderStatus?`, `proofVariant?`, `focusReview?`, `isActive?`, `onStale`, `onTargetChange`。
*   **类型 `Mutation` (L52)**：`'preview' | 'checkpoint' | 'resume_revision' | 'recovery' | 'recovery_analysis' | 'recovery_handoff' | 'open_holder' | 'rollback' | 'finish' | 'finalize_preview' | 'discard' | 'retry_cleanup'`。
*   **类型 `CommitMode` (L53)**：`'finish' | 'finalize_preview'`。
*   **辅助函数**：
    *   `checkpointRequestIdForGeneration` (L55-L57)：生成 `checkpoint:${generation}` 请求 ID。
    *   `isStale` (L59-L61)：判断错误码是否为 `stale_target`/`stale_isolated`/`stale_local`。
    *   `sameStrings` (L63-L65)：长度与逐元素比较字符串数组。
    *   `preflightMessage` (L67-L74)：映射 `WorktreeApplyPreflightView` 状态为 i18n 文本。
*   **`ReviewActions` 组件 (L82-L96 起，主体至 L1198)**：
    *   内部状态：`submitting` (L101), `commitMode` (L102), `checkpointOpen` (L103), `discardOpen` (L104), `commitMessage` (L105), `checkpointMessage` (L106), `retainEnvironment` (L108), `retention` (L109), `runtimeConflict` (L113), `mutationLock` (L114), `observedTargetRevision` (L115), `observedReviewSlot` (L116) 等。
    *   Hook：`useWorktreeRecoverySnapshot` (L117), `useReviewPreflight` (L125), `usePreviewRecoveryPreflight` (L139)。
    *   关键方法（均定义在组件内）：
        *   `begin` (L214-L221)：加锁并设置 `submitting`。
        *   `finish` (L223-L226)：解锁。
        *   `finishError` (L232-L251)：统一错误处理，特殊处理 `apply_conflict` 与 stale 错误。
        *   `applyTarget` (L253-L258)：更新目标并广播刷新事件。
        *   `enqueueRecovery` (L260-L263)：调用 `enqueueWorktreeRecovery`。
        *   `startConflictRecovery` (L265-L358)：冲突恢复流程，校验身份后调用 `adapter.resumeRevision`。
        *   `startReviewRegeneration` (L360-L422)：孤立过时阻塞恢复，调用 `adapter.prepareReviewRegeneration`。
        *   `recoverPreflight` (L424-L432)：路由冲突或阻塞恢复。
        *   `recoverRuntimeConflict` (L434-L451)：用运行时冲突对象调用 `startConflictRecovery`。
        *   `previewLocal` (L453-L485)：本地预览，先强刷预检再调 `adapter.preview`。
        *   `openCheckpoint` (L487-L492)：打开检查点模态，需 `target.capabilities.checkpoint` (L488)。
        *   `checkpoint` (L494-L534)：保存阶段，校验消息与返回身份。
        *   `resumeRevision` (L536-L559)：恢复编辑，可选预填草稿。
        *   `rollbackPreview` (L561-L623)：回滚预览，detached 状态需先取 `recoveryProof`。
        *   `submitCommit` (L625-L697)：提交/最终化，区分 `finish` 与 `finalize_preview`，处理保留策略。
        *   `discard` (L699-L722)：丢弃更改，活跃预览时尝试回滚。
        *   `freshRecoveryProof` (L724-L739)：读取最新恢复预检证明。
        *   `analyzeRecovery` (L741-L795)：只读分析，通过 `binding.session.prompt.call` 发指令。
        *   `handoffRecovery` (L797-L856)：移交新工作树，类似分析流程。
        *   `retryCleanup` (L858-L876)：重试环境清理。
        *   `openHolder` (L878-L895)：打开持有任务的工作树。
    *   UI 渲染：`primary` 按钮根据 `target.state` 动态切换 (L923-L948)；`more` 菜单 (L965-L1021)；三个模态框（Checkpoint L1026, Commit L1054, Discard L1096）；`PreflightStatus` (L1114-L1123)；detached 恢复区 (L1124-L1163)；运行时冲突区 (L1164-L1169)；活动恢复指示 (L1170-L1187)；`DeliveryProof` (L1188)。

### 4. 预检状态可视化 (`src/client/review-console/PreflightStatus.tsx`)

*   **`shortOid` (L7-L9)**：截断字符串前8位。
*   **`statusLabel` (L11-L19)**：映射预检状态为文本。
*   **`PreflightStatus` 组件 (L21-L113)**：
    *   Props：`snapshot`, `target?`, `compact?`, `onRefresh`, `onRecovery`, `onOpenHolder`, `busy`。
    *   处理 `idle`(L40), `loading`(L41), `error`(L44) 及成功分支；冲突态显示解决按钮 (L54-L74)；阻塞态显示持有者信息与重生成/打开按钮 (L76-L111)。

### 5. 交付证明 (`src/client/review-console/DeliveryProof.tsx`)

*   **`shortOid` (L4-L6)**：同上前8位。
*   **`validationLabel` (L8-L14)**：映射 `validationStatus`（`passed/failed/partial/not_run/其他`）。
*   **`DeliveryProof` 组件 (L16-L47)**：
    *   Props：`target: WorktreeConsoleTargetSummary`, `compact?`。
    *   紧凑模式 (L29-L35)：单行显示 commit OID、本地分支@头、文件数、生命周期。
    *   完整模式 (L36-L47)：定义列表展示 commit、local head before/after、文件数、验证、本地历史确认 (`commitInLocalHistory`)。

### 6. 图标库 (`src/client/review-console/ReviewIcon.tsx`)

*   **`icons` 映射 (L8-L15)**：键包括 `file, branch, check, warning, minus, close, list, more, preview, confirm, rollback, edit, save, discard, local, down, create, search, manager, retain, send, shield, help, folder, external, refresh, chevron, pin, pinOff`。
*   **类型 `ReviewIconName` (L16)**：上述键的联合。
*   **`ReviewIcon` 组件 (L18-L21)**：渲染 `lucide-react` 图标，固定类名 `dsh-wt-icon`，尺寸18。

### 7. 预检缓存 (`src/client/review-console/preflight-cache.ts`)

*   **类型 `PreflightSnapshot` (L5)**：重导出 `RequestSnapshot<WorktreeApplyPreflightView>`。
*   **`cache` (L7-L15)**：通过 `createRequestCache` 创建，key 由 `sessionId, checkoutId, expectedRevision, expectedReviewId` 拼接 (L8-L13)，request 调用 `adapter.preflight` (L14)。
*   **导出**：
    *   `readReviewPreflight` (L18)：别名 `cache.read`，强制刷新用于写前。
    *   `invalidateReviewPreflight` (L21)：别名 `cache.invalidate`。
    *   `useReviewPreflight` (L23)：别名 `cache.useSnapshot`。

### 8. 全局事件广播 (`src/client/review-console/status-events.ts`)

*   **常量 `WORKTREE_REVIEW_REFRESH_EVENT` (L1)**：`'dsh-git-worktree:review-refresh'`。
*   **`requestWorktreeReviewRefresh` (L4-L6)**：分发 `CustomEvent`，detail 含 `sessionId`。

### 9. 请求缓存基础设施 (`src/client/review-console/request-cache.ts`)

提供基于 `WeakMap` 的身份键控请求缓存，支持单飞行与 React 集成。

*   **类型 `RequestSnapshot<TPreflight>` (L9-L13)**：`'idle' | 'loading' | 'success' | 'error'`。
*   **接口 `Entry<TPreflight>` (L15-L20)**：内部条目，含 `snapshot, listeners, promise?, generation`。
*   **接口 `RequestCache<TIdentity, TPreflight>` (L22-L30)**：定义 `read`, `invalidate`, `useSnapshot` 签名。
*   **`createRequestCache` (L41-L150，导出)**：
    *   `read` (L78-L109)：单飞行，非强制时返回缓存；发布 `loading`；`generation` 校验防过期发布。
    *   `invalidate` (L111-L117)：增加 generation，清 promise，发 `idle`。
    *   `useSnapshot` (L119-L148)：React Hook，用 `useSyncExternalStore` 订阅，返回 `{ snapshot, refresh }`。

## Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│                     Review Console Module                     │
├───────────────────────┬──────────────────────┬───────────────┤
│ UI Components         │ Logic & State        │ Infrastructure│
│                      │                      │               │
│ WorktreeReviewPanel  │ ReviewActions        │ preflight-    │
│ (Panel.tsx L54)      │ (Actions.tsx L82)    │ cache.ts L7   │
│ PreflightStatus      │   Mutation Machine   │ request-      │
│ (L21)                │   Preflight/Recovery  │ cache.ts L41  │
│ DeliveryProof (L16)  │                      │ status-events │
│ ReviewIcon (L18)     │                      │ (L4)          │
└──────────┬───────────┴──────────┬───────────┴───────┬───────┘
           │                      │                   │
           ▼                      ▼                   ▼
     User Action ──► begin() ──► read preflight ──► adapter call
           ▲                      │                   │
           │                      ▼                   ▼
           └──── applyTarget() ◄─ identity verify ◄─ cache publish
```

## Data Flow

### 1. 正常评审操作流
```
用户点击操作按钮 (ReviewActions.tsx L923-L948)
  → begin(mutation) 加锁 (L214)
  → readReviewPreflight(force=true) 或 readPreviewRecoveryPreflight (L455, L632)
  → 预检 success 且非 blocked/conflict (L130-L132, L469)
    → adapter.<operation>(identity) (如 L473 preview)
    → outcome.ok ? applyTarget(nextTarget) (L253) : finishError(error) (L232)
  → finish() 解锁 (L223)
  → requestWorktreeReviewRefresh(sessionId) 广播刷新 (status-events.ts L4)
```

### 2. 冲突恢复流
```
检测到 apply_conflict 或 stale_isolated (ReviewActions.tsx L233, L429)
  → startConflictRecovery / startReviewRegeneration (L265, L360)
  → adapter.resumeRevision / prepareReviewRegeneration (L301, L391)
  → 获取 recoveryContinuation 并校验 (L330-L343, L401-L408)
  → enqueueWorktreeRecovery (L260, 内部调 recovery-continuation.ts)
  → 活动恢复状态通过 useWorktreeRecoverySnapshot 展示 (L117, L1170-L1187)
```

### 3. 缓存与状态同步
```
组件挂载 → useReviewPreflight / usePreviewRecoveryPreflight (preflight-cache.ts L23)
  → createRequestCache.read (request-cache.ts L78)
    ├── WeakMap<Adapter, Map> 隔离 (L51-L60)
    ├── 单飞行共享 Promise (L84)
    ├── generation 校验忽略过期响应 (L93, L105)
    └── publish → useSyncExternalStore 更新 (L73, L135)
```

## Connections

- **Client Boot** (`[[client-boot]]`)：评审数据源入口，`reviewEvidenceFromTarget` / `reviewIdentityFromTarget` 转换函数（index.ts L12, L24）。
- **Target Console** (`[[target-console]]`)：Dock 内紧凑状态条与终态 dismiss 逻辑（`ReviewActions.tsx` L953, L1188）。
- **console-contract** (`[[console-contract]]`)：`WorktreeConsoleAdapter` / `WorktreeConsoleTargetSummary` / `WorktreeConsoleError` 类型契约（各文件 import）。
- **actions** (`[[client-actions]]`)：`openAuthorizedWorktreeTarget` / `openIsolatedTarget` / `prefillSessionDraft` 等（ReviewActions.tsx L16-L20 导入）。

## Known Issues

- 无已知功能性 issue。恢复队列依赖外部 `recovery-continuation.ts` 持久化（未在本次提供源文件中），浏览器进程崩溃后恢复尽力而为，Host 身份校验仍是权威。
- `request-cache.ts` 使用 WeakMap 绑定 adapter（L51），remount 后新 adapter 会清空旧缓存——这是预期行为而非 bug。
- 部分动作受 `target.capabilities` 限制（如 `ReviewActions.tsx` L488 `target.capabilities.checkpoint`、L924 `target.capabilities.preview`），若宿主未授权则按钮禁用，非代码缺陷。