---
title: Review Console 评审操作与恢复
type: module
source_files:
  - src/client/review-console/index.ts
  - src/client/review-console/WorktreeReviewPanel.tsx
  - src/client/review-console/ReviewActions.tsx
  - src/client/review-console/PreflightStatus.tsx
  - src/client/review-console/ReviewDetailsModal.tsx
  - src/client/review-console/DeliveryProof.tsx
  - src/client/review-console/ReviewIcon.tsx
  - src/client/review-console/preflight-cache.ts
  - src/client/review-console/preview-recovery-cache.ts
  - src/client/review-console/recovery-continuation.ts
  - src/client/review-console/status-events.ts
  - src/client/review-console/review-console.styles.ts
  - src/client/review-console/request-cache.ts
tags: [client, review, preflight, recovery]
---

# Review Console 评审操作与恢复

评审证据展示与全部 Worktree 变更动作的执行中枢：预检门禁、预览/检查点/回滚/提交/丢弃，以及 apply 冲突后的只读恢复与持久化恢复队列。数据源与导航编排分别来自 [[client-boot|Client Boot]] 与 [[target-console|Target Console]]。

## Overview

Review Console 模块负责管理 Git Worktree 的审查（Review）生命周期。它包含两个主要部分：
1. **UI 组件层**：渲染紧凑卡片（Dock）、详情模态框、交付证明，并提供用户交互入口。
2. **状态与逻辑层**：处理复杂的异步状态机，包括预检（Preflight）、冲突恢复（Recovery Continuation）、会话等待、以及通过 `binding.session.prompt` 与 Host/Agent 通信。

核心安全机制包括：
*   **身份强校验**：所有向 Host 发送的请求必须经过严格的身份一致性验证，确保目标状态（Checkout ID, Session ID, Revision, State, RecoveryProof）与请求发出时一致。
*   **单飞行缓存**：使用 `request-cache.ts` 实现基于 `WeakMap` 的身份键控缓存，支持并发控制和 React `useSyncExternalStore` 集成。
*   **持久化恢复**：通过 `localStorage` 持久化恢复请求上下文，确保在页面刷新或会话切换后能正确重试或取消。

## Key Components

### 1. 入口与辅助函数 (`src/client/review-console/index.ts`)

导出公共 API 和数据转换函数。

*   **`reviewEvidenceFromTarget` (L15)**
    *   **职责**：将 `WorktreeConsoleTargetSummary` 中的 review 数据投影为 `WorktreeReviewEvidence`。
    *   **逻辑**：若 `target.review` 为空则返回 `null`。支持注入额外的 `detailsMarkdown`。
*   **`reviewIdentityFromTarget` (L27)**
    *   **职责**：构建 `WorktreeReviewIdentity`，用于 Finalize 和高级读取操作。
    *   **依赖**：`sessionId`, `target.checkoutId`, `target.revision`, `target.review.reviewId`。任一缺失返回 `null`。
*   **导出类型**：
    *   `WorktreeReviewEvidence`: 扩展自 `WorktreeConsoleReviewSummary`，增加可选的 `detailsMarkdown`。
    *   `WorktreeReviewIdentity`: 包含 `sessionId`, `checkoutId`, `expectedRevision`, `expectedReviewId`。
    *   `WorktreeReviewPanelProps`: 接收 `review`, `identity?`, `target?`, `unavailableMessage?`。

### 2. 只读面板 (`src/client/review-console/WorktreeReviewPanel.tsx`)

展示审查结果的紧凑卡片（Compact Card/Dock）。

*   **类型定义 (L9-L26)**
    *   `WorktreeReviewEvidence`: 见 index.ts 定义。
    *   `WorktreeReviewIdentity`: 见 index.ts 定义。
    *   `WorktreeReviewPanelProps`: 见 index.ts 定义。
*   **`validationLabel` / `testStatusLabel` (L28, L34)**
    *   **职责**：根据状态映射国际化文本。
    *   **逻辑**：按 `passed/failed/partial/not-run` 映射 i18n 标签。
*   **`reviewIsStale` (L42)**
    *   **职责**：判断审查证据是否过期。
    *   **逻辑**：
        *   若 `target` 不存在，返回 `false`（不过期）。
        *   若 `target.state` 为 `working`，视为过期。
        *   若 `target.state` 不在白名单 (`ready_for_review`, `preview_active` 等) 中，不过期。
        *   比较 `target.revision` 与 `identity?.expectedRevision` (默认 fallback 到 `review.revision`) 以及 `target.review.reviewId`。
*   **`WorktreeReviewPanel` 组件 (L55)**
    *   **状态管理**：`detailsExpanded` (控制详情展开)，受 `review.reviewId` 和 `review.revision` 重置。
    *   **渲染逻辑**：显示标题、摘要、验证状态、文件数、Checkpoint 数。
    *   **详情区域**：显示 Identity (ID前8位+Revision)、验证摘要、测试列表 (`review.tests`)。
    *   **错误提示**：若 `invalidReason` (stale) 或 `unavailableMessage` 存在，显示底部状态条。

### 3. 核心交互组件 (`src/client/review-console/ReviewActions.tsx`)

处理所有突变操作（Mutation）的状态机、预检、恢复和 UI 反馈。这是本批最复杂的文件。

*   **Props (L30-L48)**
    *   包含 `review`, `adapter`, `services`, `identity`, `target`, `disabled`, `onStale`, `onTargetChange` 等。
    *   支持 `proofVariant` ('compact') 和 `renderStatus` 回调。
*   **内部状态 (L58-L83)**
    *   `submitting`: 当前正在执行的 Mutation 类型 (`'preview' | 'checkpoint' | ... | 'finalize_preview' | 'discard'`)。
    *   `commitMode`: `'finish' | 'finalize_preview'`。
    *   `checkpointOpen`, `discardOpen`: 模态框开关。
    *   `commitMessage`, `checkpointMessage`: 输入文本。
    *   `retainEnvironment`, `retention`: 提交时的环境保留策略。
    *   `runtimeConflict`: 运行时冲突对象。
    *   `mutationLock`: 防止并发提交。
    *   `observedTargetRevision`, `observedReviewSlot`: 用于检测目标变化。
    *   Hooks: `useWorktreeRecoverySnapshot`, `useReviewPreflight`, `usePreviewRecoveryPreflight`。
*   **关键副作用 (L85-L123)**
    *   恢复工作树恢复 (`restoreWorktreeRecovery`)。
    *   重置表单状态当 `review.reviewId` 变化时。
    *   监听外部点击和 Escape 键关闭更多菜单 (`moreMenuRef`)。
    *   监听 `target.revision` 变化清除消息/错误。
    *   监听 `target.reviewSlot` 从 `waiting` 变为 `available` 时刷新预检缓存。
*   **核心操作流方法**
    *   **`begin` / `finish` (L125-L133)**: 原子性锁定与解锁提交状态。
    *   **`finishError` (L135)**: 统一错误处理。特殊处理 `apply_conflict` (设置 `runtimeConflict`) 和 `stale_target/local/isolated` (触发 `onStale` 或刷新预检)。
    *   **`applyTarget` (L148)**: 更新目标并请求审查刷新。
    *   **`startConflictRecovery` (L163)**: 处理冲突恢复。
        *   读取最新预检，验证身份一致性 (`sameStrings` 检查 conflictingFiles)。
        *   调用 `adapter.resumeRevision`。
        *   验证返回值身份，获取 `recoveryContinuation` 并入队 (`enqueueRecovery`)。
    *   **`startReviewRegeneration` (L204)**: 处理孤立过时导致的阻塞恢复。调用 `adapter.prepareReviewRegeneration` 并入队。
    *   **`recoverPreflight` (L243)**: 路由冲突或阻塞恢复。
    *   **`previewLocal` (L258)**: 本地预览流程。先读预检，确认无冲突/阻塞后调用 `adapter.preview`。
    *   **`checkpoint` (L303)**: 保存阶段。校验消息长度 (<=500)，调用 `adapter.checkpoint`，验证返回的 checkpoint 序列号和 target 状态。
    *   **`resumeRevision` (L343)**: 恢复编辑。调用 `adapter.resumeRevision`，可能预填充会话草稿 (`prefillSessionDraft`)。
    *   **`rollbackPreview` (L358)**: 回滚预览。
        *   若处于 `preview_detached`，需获取 `recoveryProof` (通过 `readPreviewRecoveryPreflight`)。
        *   调用 `adapter.rollbackPreview`，传入 `recoveryProof`。
    *   **`submitCommit` (L413)**: 提交/最终化。
        *   区分 `finish` (直接提交) 和 `finalize_preview` (从 detached 状态最终化)。
        *   `finalize_preview` 需要获取 `previewProof` 并验证其 `finalize.status === 'safe'`。
        *   调用 `adapter.finalize` 或 `adapter.finalizePreview`。
        *   处理 `retention` 模式 (`cleanup` vs `retain_*`)。
    *   **`discard` (L473)**: 丢弃更改。调用 `adapter.discard`，若处于活跃预览则自动尝试 `rollbackPreview`。
    *   **`analyzeRecovery` / `handoffRecovery` (L503, L543)**: 高级恢复操作。
        *   获取 `freshRecoveryProof`。
        *   调用 `adapter.preparePreviewRecoveryAnalysis` 或 `adapter.createPreviewRecoveryHandoff`。
        *   验证返回值身份。
        *   通过 `binding.session.prompt.call` 向 Agent 发送特定指令文本，执行只读分析或移交工作树。
    *   **`openHolder` (L593)**: 打开持有任务的工作树。
*   **UI 渲染逻辑 (L603-L628)**
    *   `primary` 按钮根据 `target.state` 动态变化 (`ready_for_review` -> Preview; `preview_active` -> Confirm; `preview_detached` -> Rollback/Check; `cleanup_pending` -> Retry Cleanup)。
    *   `more` 菜单包含 Checkpoint, Resume Editing, Skip Preview & Save, Rollback, Discard 等选项，受 `target.capabilities` 和 `allDisabled` 控制。
    *   模态框：`Checkpoint Modal` (含消息输入和字符计数), `Commit Modal` (含消息、Retention Checkbox/Select), `Discard Modal`。
    *   `PreflightStatus` 子组件 (仅在 ready 状态显示)。
    *   `Detached Preview Recovery` 信息区 (显示 proof, conflicts, blockers, actions)。
    *   `Runtime Conflict` 提示区。
    *   `Active Recovery` 状态指示器 (queued/sending/sent/cancelled/failed)。
    *   `DeliveryProof` (在 terminal 状态显示)。

### 4. 预检状态可视化 (`src/client/review-console/PreflightStatus.tsx`)

*   **`statusLabel` (L9)**: 映射预检状态 (`ready`, `local_advanced`, `already_in_local`, `conflict`, `blocked`) 为文本。
*   **`PreflightStatus` 组件 (L17)**
    *   处理 `idle`, `loading`, `error` 状态。
    *   成功状态：显示本地分支/OID、工作树 OID、有效基础 OID、变更文件数。
    *   冲突状态：列出冲突文件。
    *   阻塞状态：显示持有者信息 (`holder`)，并提供“打开持有任务”按钮。
    *   操作按钮：刷新、解决冲突 (`onRecovery`)、重新生成审查 (`onRecovery`)。

### 5. 详情模态框 (`src/client/review-console/ReviewDetailsModal.tsx`)

全屏/模态形式的审查详情视图。

*   **`validationText` / `validationIcon` (L10, L13)**: 辅助函数，用于图标和文本映射。
*   **`ReviewDetailsModal` 组件 (L17)**
    *   **焦点陷阱 (L22-L39)**: 打开模态时聚焦第一个可交互元素，Tab 键循环聚焦，关闭时恢复焦点。
    *   **内容渲染**:
        *   头部：标题、关闭按钮。
        *   主体：摘要、迭代号、文件数、验证状态。
        *   通知栏：根据状态 (`recovery`, `conflict`, `blocked`, `preview`, `saved`) 显示不同提示。
        *   文件列表：标记冲突文件。
        *   验证测试列表。
        *   版本详情：Review ID, Revision, Commit OID。

### 6. 交付证明 (`src/client/review-console/DeliveryProof.tsx`)

展示交付证明（Commit 后的证据）。

*   **`shortOid` (L4)**: 辅助函数，截断 OID。
*   **`validationLabel` (L8)**: 辅助函数，映射验证状态。
*   **`DeliveryProof` 组件 (L16)**
    *   **紧凑模式 (`compact`)**: 单行显示 Commit OID, Local Branch@Head, 文件数, 生命周期状态。
    *   **完整模式**: 显示 Commit OID, Local Head Before/After, 文件数, 验证状态, 本地历史确认 (`commitInLocalHistory`)。
    *   **生命周期状态**: `delivered` (已清理), `retained` (保留至某时间), `cleanup_pending` (待清理), `delivery.evidence.recorded`。

### 7. 图标库 (`src/client/review-console/ReviewIcon.tsx`)

*   **`ReviewIcon` 组件**: 使用 `lucide-react` 图标封装。
*   **样式类名**: 固定为 `dsh-wt-icon`。
*   **支持的图标**: file, branch, check, warning, minus, close, list, more, preview, confirm, rollback, edit, save, discard, local, down, create, search, manager, retain, send, shield, help, folder, external, refresh, chevron, pin, pinOff 等。

### 8. 预检缓存 (`src/client/review-console/preflight-cache.ts`)

审查预检 (`preflight`) 的缓存管理。

*   **`cache`**: 使用 `createRequestCache` 创建。Key 由 `sessionId`, `checkoutId`, `expectedRevision`, `expectedReviewId` 组成。
*   **导出**: `readReviewPreflight` (读), `invalidateReviewPreflight` (失效), `useReviewPreflight` (React Hook)。
*   **特性**: 单飞行 (single-flight)，`force` 参数可绕过缓存。

### 9. 预览恢复预检缓存 (`src/client/review-console/preview-recovery-cache.ts`)

预览恢复预检 (`previewRecoveryPreflight`) 的缓存管理。

*   **`cache`**: Key 额外包含 `expectedPreviewId`。
*   **导出**: `readPreviewRecoveryPreflight`, `invalidatePreviewRecoveryPreflight`, `usePreviewRecoveryPreflight`。

### 10. 恢复请求持久队列 (`src/client/review-console/recovery-continuation.ts`)

管理 Worktree 恢复请求（Recovery Request）的持久化队列、状态机及发送流程。

*   **接口**：
    *   `WorktreeApplyConflictRecoveryRequest`: 处理应用冲突恢复，包含 `localHeadOid`, `conflictingFiles`。
    *   `WorktreeReviewRegenerationRequest`: 处理审查再生，仅含 `revision`。
    *   `WorktreeRecoverySnapshot`: 当前状态快照 `{ status, request, error? }`。
    *   `RecoveryEntry`: 内部条目，持有 `snapshot`, `adapter`, `services`, `isActive`, `abort`, `unsubscribers`, `listeners`。
*   **状态枚举**：`WorktreeRecoveryStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled'`。
*   **存储前缀**：`STORAGE_PREFIX = 'dsh-git-worktree:recovery:v1:'`。
*   **导出函数/钩子**：
    *   `enqueueWorktreeRecovery(input)`: 入队新请求。若存在相同 `sessionId`+`requestId` 则更新上下文；否则取消旧条目并创建新条目。执行 `validRequest` 校验。
    *   `restoreWorktreeRecovery(input)`: 从 `localStorage` 恢复状态。若原状态为 `sending` 或 `failed`，标记为失败或重新排队。
    *   `retryWorktreeRecovery(sessionId)`: 对 `failed` 或 `cancelled` 状态的条目重新触发 `attempt`。
    *   `getWorktreeRecoverySnapshot(sessionId)`: 获取当前快照。
    *   `subscribeWorktreeRecovery(sessionId, listener)`: 订阅状态变更。
    *   `useWorktreeRecoverySnapshot(sessionId)`: React Hook，基于 `useSyncExternalStore` 订阅恢复状态。
    *   `cancelWorktreeRecovery(sessionId, requestId?)`: 取消特定请求。
    *   `detachWorktreeRecoveryRuntime(sessionId)`: 模拟运行时卸载，保留持久化数据。
    *   `clearWorktreeRecovery(sessionId)`: 清除内存和存储。
    *   `buildWorktreeRecoveryPrompt(request, t)`: 构建发送给 Host 的提示文本。

**关键逻辑行号参考**：
*   **持久化存储 (`persistSnapshot` / `readPersisted`)**: L58-L96。使用 `localStorage`，版本号为 `1`。读取时严格校验 JSON 结构、字段长度、字符集（禁止 `\0`, `\r`, `\n`），非法数据直接删除存储项。
*   **请求校验 (`validRequest`)**: L113-L148。严格检查 `kind`, `sessionId` (<=200), `requestId` (<=500), `checkoutId`, `reviewId`, `revision`。针对 `worktree_apply_conflict` 额外校验 `localHeadOid` (40/64位hex) 和 `conflictingFiles` (<=500个, 路径安全)。
*   **路径匹配 (`samePath`)**: L157-L161。区分 Windows (`[A-Za-z]:`) 和 POSIX 路径，统一转为 `/` 后比较（Windows 不区分大小写）。
*   **目标匹配 (`targetMatchesRequest`)**: L163-L191。核心安全逻辑。对比 `inspected` 结果中的 `target` 与 `request`。要求 `state` 正确 (`working` 或 `ready_for_review`)，且 `recoveryContinuation` 证明中的所有字段（`kind`, `requestId`, `checkoutId`, `reviewId`, `revision`, `localHeadOid`, `conflictingFiles`）完全一致。
*   **尝试发送 (`attempt`)**: L225-L305。
    *   检查 `isCurrent` 和 `activeSessionState`。
    *   调用 `adapter.inspect` 获取最新目标状态。
    *   若会话未就绪 (`sessionReady` 返回 false)，调用 `waitForSession` 启动轮询。
    *   就绪后，再次 `inspect` 确认。
    *   设置 `AbortController`，调用 `binding.session.prompt` 发送恢复请求。
    *   捕获错误并发布 `failed` 状态。
*   **等待会话 (`waitForSession`)**: L213-L223。监听 `sessions.list` 变化，若会话失配则取消；每 250ms 轮询 `attempt`。

### 11. 全局事件广播 (`src/client/review-console/status-events.ts`)

定义全局事件以通知所有挂载的 Review 表面重新读取 Host 权威目标。

*   **常量**: `WORKTREE_REVIEW_REFRESH_EVENT = 'dsh-git-worktree:review-refresh'`。
*   **函数**: `requestWorktreeReviewRefresh(sessionId)`。通过 `window.dispatchEvent` 分发 CustomEvent，detail 包含 `sessionId`。

### 12. CSS 样式 (`src/client/review-console/review-console.styles.ts`)

集中管理 Review Console 相关的 CSS 样式字符串。

*   **变量定义**: `REVIEW_CONSOLE_STYLES` 是巨大的模板字符串。
*   **CSS 变量**: `--wt-ink`, `--wt-muted`, `--wt-line`, `--wt-panel`, `--wt-green`, `--wt-amber`, `--wt-red`。
*   **主要类名**:
    *   `.dsh-wt-review-panel`, `.dsh-wt-review-dock`, `.dsh-wt-details-modal`.
    *   状态图标: `.dsh-wt-review-status-icon` (根据 `data-validation` 变色).
    *   验证详情: `.dsh-wt-review-validation-details`, `.dsh-wt-test-list`.
    *   操作菜单: `.dsh-wt-more-menu`, `.dsh-wt-more-content`.
    *   预检信息: `.dsh-wt-preflight` (支持 `conflict`, `blocked`, `error` 状态).
    *   交付证明: `.dsh-wt-delivery-proof`.
    *   响应式: `@media (max-width: 620px)` 调整 Dock 和 Modal 布局。

### 13. 请求缓存基础设施 (`src/client/review-console/request-cache.ts`)

提供基于 `WeakMap` 的身份键控请求缓存，支持单飞行（single-flight）并发控制和 React `useSyncExternalStore` 集成。

*   **类型**: `RequestSnapshot<TPreflight>` 联合类型 (`idle`, `loading`, `success`, `error`)。
*   **工厂函数**: `createRequestCache<TIdentity, TPreflight>(options)`。
    *   **参数**: `key(identity)` 生成唯一字符串；`request(adapter, identity)` 执行实际异步请求。
    *   **数据结构**: `caches: WeakMap<Adapter, Map<String, Entry>>`。确保不同 Adapter 实例数据隔离。
    *   **方法**:
        *   `read(adapter, identity, force?)`: 
            *   若已有 promise 且非强制，加入等待（单飞行）。
            *   若非强制且有成功/错误快照，直接返回。
            *   发布 `loading`，记录 `generation`。
            *   执行 `options.request`，成功后发布 `success` 或 `error`。
            *   清理 `promise` 引用。
        *   `invalidate(adapter, identity)`: 增加 `generation`，清除 `promise`，发布 `idle`。防止过时响应覆盖新状态。
        *   `useSnapshot(adapter, identity, enabled)`: React Hook。
            *   订阅 `entry.listeners`。
            *   `getSnapshot` 返回当前条目快照。
            *   `useEffect` 在依赖变化时触发初始 `read`。
            *   返回 `{ snapshot, refresh() }`，`refresh` 强制重新请求。

## Architecture

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Review Console Module                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────┐      ┌──────────────────────┐      ┌───────────────┐ │
│  │ UI Components    │      │ Logic & State Mgmt   │      │ Persistence   │ │
│  │                  │      │                      │      │               │ │
│  │ • WorktreeReview │      │ • ReviewActions      │◄────►│ • Recovery    │ │
│  │   Panel          │      │   (Mutation Machine) │      │   Continuation│ │
│  │ • PreflightStatus│      │                      │      │   (Queue)     │ │
│  │ • DetailsModal   │      │ • Request Cache      │      │               │ │
│  │ • DeliveryProof  │      │   (Single-Flight)    │      │ • localStorage│ │
│  │ • ReviewIcon     │      │                      │      │               │ │
│  └────────┬─────────┘      └──────────┬───────────┘      └───────┬───────┘ │
│           │                          │                           │         │
│           │                          │                           │         │
│           ▼                          ▼                           ▼         │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                   Data Flow & Validation                            │  │
│  │                                                                     │  │
│  │  User Action → Precheck (Cache) → Adapter Call → Target Update      │  │
│  │                ↑                     ↓                              │  │
│  │                └─── Identity Verification (Strong Match) ◄─────────┘  │
│  │                                                                     │  │
│  │  Recovery: Enqueue → Inspect Target → Wait Session → Prompt Host    │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. 正常评审操作流
```
用户点击操作按钮
  → begin(mutation) 加锁
  → readReviewPreflight(force=true) 或 readPreviewRecoveryPreflight(force=true)
  → 预检 success 且非 blocked/conflict
    → adapter.<operation>(identity)
    → outcome.ok ? applyTarget(nextTarget) : finishError(error)
  → finish() 解锁
  → requestWorktreeReviewRefresh(sessionId) 广播刷新
```

### 2. 冲突恢复流
```
检测到 apply_conflict 或 stale_isolated
  → startConflictRecovery / startReviewRegeneration
  → adapter.resumeRevision / prepareReviewRegeneration
  → 获取 recoveryContinuation
  → enqueueWorktreeRecovery (写入 localStorage + 内存队列)
  → attempt:
      ├── inspect 目标状态
      ├── targetMatchesRequest 校验
      ├── sessionReady? → waitForSession (polling + subscribe)
      └── binding.session.prompt(buildWorktreeRecoveryPrompt, 'queue', abort.signal)
  → 发送结果 → update RecoveryEntry.snapshot → React Re-render
```

### 3. 缓存与状态同步
```
Component Mount
  → useReviewPreflight / usePreviewRecoveryPreflight
  → read(adapter, identity)
    ├── WeakMap lookup (per Adapter instance)
    ├── Single-flight (share Promise if loading)
    ├── Generation check (ignore stale responses)
    └── publish(success/error) → listeners callback → useSyncExternalStore update
```

## Connections

- **Client Boot** (`[[client-boot]]`)：评审数据源入口，`reviewEvidenceFromTarget` / `reviewIdentityFromTarget` 转换函数。
- **Target Console** (`[[target-console]]`)：Dock 内紧凑状态条与终态 dismiss 逻辑。
- **console-contract** (`src/console-contract.ts`)：`WorktreeConsoleAdapter` / `WorktreeConsoleTargetSummary` / `WorktreeConsoleError` 类型契约。
- **actions** (`src/client/actions.ts`)：`openAuthorizedWorktreeTarget` / `openIsolatedTarget` / `prefillSessionDraft` / `selectedSessionId`。

## Known Issues

- 无已知 issue。恢复队列依赖 localStorage 持久化，浏览器进程崩溃后恢复尽力而为，Host 身份校验仍是权威。
- `request-cache.ts` 使用 WeakMap 绑定 adapter，remount 后新 adapter 会清空旧缓存——这是预期行为而非 bug。