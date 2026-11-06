---
title: worktree_client_interface_layer：Worktree 浏览器端客户端界面层总览
description: 本模块是 dsh-git-worktree 插件全部浏览器端用户界面的集合，对应源码路径 src/client/。作为连接 Node 端 Host 权威域与 Harness 宿主 UI 平台的薄适配层，本层不承担任何 Git 操作、worktree 状态机推进、权限校验或冲突判定职责——所有业务权威逻辑均在…
---

# worktree_client_interface_layer：Worktree 浏览器端客户端界面层总览

!!! info "Generated documentation"
    This page was written by CodeWiki from the source code at commit [`f93ba818`](https://github.com/wloops/dsh-git-worktree/commit/f93ba8188971886c09b4c40e12c746a23853c229) on 2026-11-06 with `doubao-seed-2.1-lite`. Check the code before relying on details.

本模块是 dsh-git-worktree 插件全部浏览器端用户界面的集合，对应源码路径 `src/client/`。作为连接 Node 端 Host 权威域与 Harness 宿主 UI 平台的薄适配层，本层不承担任何 Git 操作、worktree 状态机推进、权限校验或冲突判定职责——所有业务权威逻辑均在 Host 侧完成，客户端仅负责 DTO 投影、用户操作编排、宿主版本适配与回放稳定的 UI 渲染。

## 模块核心职责
- 浏览器 bundle 入口装配与 Remote 传输适配，统一封装超时控制、错误归一化、strict 响应校验
- 宿主服务（sessions、workspaces、conversation、uiWorkspace、locale）的版本差异适配与导航编排
- 所有用户可见 Worktree 界面的渲染：目标控制台、验收控制台、预会话开关、工作区侧栏、设置卡片
- 历史工具调用卡片的回放稳定模型，保证旧会话打开时的渲染结果与操作时一致，不依赖任何实时状态
- 统一的客户端本地化、作用域样式体系与跨界面刷新事件广播
- 全链路的优雅降级：在 Host 能力缺失时仍保证历史会话可正常回放，不出现整体崩溃

## 整体架构
```mermaid
flowchart TB
    subgraph HOST["Host 权威侧（Node 进程）"]
        DOMAIN["core_worktree_domain_and_infrastructure<br/>SessionCheckout 状态机 / Apply 引擎 / Git 适配器"]
        CONSOLE_SVC["worktree_console_protocol_and_host_service<br/>WorktreeConsoleService + ControlPlane + Remote 服务端"]
    end
    CONTRACT["src/console-contract.ts<br/>WorktreeConsoleAdapter 接口 / 纯 JSON DTO / 错误码定义"]

    subgraph CLIENT_LAYER["worktree_client_interface_layer（浏览器端 src/client）"]
        subgraph BASE["基础基座层"]
            REMOTE["client_console_remote<br/>boot 入口 · Typert RPC 适配 · 超时与校验管道"]
            CORE["client_core<br/>插件装配 · 宿主 actions 编排 · i18n · 样式 · 工具卡片模型"]
        end
        subgraph SURFACE["用户界面层"]
            TARGET["client_target_console<br/>目标胶囊 · 验收 dock · 管理面板 · Git 图/标签弹窗"]
            REVIEW["client_review_console<br/>验收证据面板 · 交付动作编排 · 预检缓存 · 恢复投递"]
            PRESESSION["client_pre_session<br/>空白会话 Worktree 创建开关"]
            SIDEBAR["client_workspace_sidebar<br/>工作区侧栏状态徽章 · 受管操作守卫"]
            SETTINGS["client_settings_card<br/>插件设置页暂存表单"]
        end
    end

    PLATFORM["Harness 宿主 UI 平台<br/>slots · sessions · workspaces · conversation · uiWorkspace · locale"]

    DOMAIN --> CONSOLE_SVC
    CONSOLE_SVC -->|"Typert Web RPC 传输"| CONTRACT
    CONTRACT -->|"adapter 调用与 DTO 消费"| REMOTE
    REMOTE -->|"provide worktreeConsole 服务"| CORE
    CORE -->|"装配注入 services / translator"| TARGET
    CORE -->|"装配注入 services / translator"| REVIEW
    CORE -->|"注册入口调用"| PRESESSION
    REMOTE -->|"按宿主 flavor 分支装配"| SIDEBAR
    REMOTE -->|"mountSettingsCard"| SETTINGS
    TARGET -->|"读取/写入宿主槽位与服务"| PLATFORM
    REVIEW -->|"读取/写入宿主槽位与服务"| PLATFORM
    PRESESSION -->|"读取/写入宿主槽位与服务"| PLATFORM
    SIDEBAR -->|"读取/写入宿主槽位与服务"| PLATFORM
    SETTINGS -->|"读取/写入宿主配置与槽位"| PLATFORM
```

层与 Host 侧的唯一接缝是 `WorktreeConsoleAdapter` 契约，所有跨进程调用的错误归一化、身份校验、重试逻辑都在该接缝之后完成，界面组件从不直接接触 RPC 层对象。所有写操作都遵循「只读预检先于写入」原则，UI 层不本地持有任何业务权威值，Host 返回的 CAS 身份是所有变更操作的唯一依据。

## 核心组件文档
- [client_core：Worktree 浏览器端入口与会话编排核心](worktree_client_interface_layer/client_core.md)：客户端界面层根模块，负责插件入口装配、回放稳定的 ToolView 模型、宿主运行时操作编排、本地化与样式基座，是所有子模块的依赖汇聚点。
- [客户端控制台 Remote 适配层（client_console_remote）](worktree_client_interface_layer/client_console_remote.md)：浏览器 bundle 启动入口与 Remote 传输适配层，把 Host 侧 Typert RPC 方法包装为统一的 `WorktreeConsoleAdapter`，实现双档超时、错误归一化与 strict 响应校验。
- [client_target_console：会话目标控制台（浏览器端）](worktree_client_interface_layer/client_target_console.md)：会话目标控制台，渲染会话头部目标胶囊、composer 上方的验收状态 dock、工作树管理面板、提交图与标签管理弹窗，内置共享的目标状态轮询与分支总览缓存。
- [client_review_console：受管 Worktree 验收控制台（浏览器端）](worktree_client_interface_layer/client_review_console.md)：受管 Worktree 验收控制台，负责验收证据展示、只读预检、交付动作编排与分离态恢复请求的持久化排队投递。
- [client_pre_session：空白会话「在 Worktree 中开始」开关](worktree_client_interface_layer/client_pre_session.md)：空白会话「在 Worktree 中开始」开关，支持在会话创建前直接迁移草稿与附件到隔离工作树会话，内置 scope 失效守卫与原子交接流程。
- [工作区侧边栏（client_workspace_sidebar）](worktree_client_interface_layer/client_workspace_sidebar.md)：工作区侧边栏集成模块，在原生工作区会话行展示受管 worktree 状态徽章，提供受管操作的突变守卫，支持接管与装饰两种宿主兼容模式。
- [Worktree 设置卡（client_settings_card）](worktree_client_interface_layer/client_settings_card.md)：插件设置页，以暂存表单形式编辑插件易失配置，支持带 revision 围栏的安全写入。

??? abstract "Documented components (88)"
    - [`__file__`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5CWorktreeCreateRow.tsx) — `src\client\WorktreeCreateRow.tsx`
    - [`__file__`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5CWorktreeReviewRow.tsx) — `src\client\WorktreeReviewRow.tsx`
    - [`ClientSessionBinding`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Cactions.ts) — `src\client\actions.ts`
    - [`ClientSessionSnapshot`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Cactions.ts) — `src\client\actions.ts`
    - [`ClientSessions`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Cactions.ts) — `src\client\actions.ts`
    - [`ClientWorkspaces`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Cactions.ts) — `src\client\actions.ts`
    - [`IsolatedTargetLocation`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Cactions.ts) — `src\client\actions.ts`
    - [`PreSessionWorktreeServices`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Cactions.ts) — `src\client\actions.ts`
    - [`SnapshotStore`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Cactions.ts) — `src\client\actions.ts`
    - [`WorktreeClientServices`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Cactions.ts) — `src\client\actions.ts`
    - [`MenuEntry`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Charness-platform.d.ts) — `src\client\harness-platform.d.ts`
    - [`ClientLocaleSource`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Ci18n.tsx) — `src\client\i18n.tsx`
    - [`ClientContextLike`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Cindex.tsx) — `src\client\index.tsx`
    - [`ParsedTool`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Cmodel.ts) — `src\client\model.ts`
    - [`ReviewArgs`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Cmodel.ts) — `src\client\model.ts`
    - [`ToolCallBlockLike`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Cmodel.ts) — `src\client\model.ts`
    - [`ToolCallViewPropsLike`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Cmodel.ts) — `src\client\model.ts`
    - [`ToolContentBlock`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Cmodel.ts) — `src\client\model.ts`
    - [`WorktreeCreatePayload`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Cmodel.ts) — `src\client\model.ts`
    - [`WorktreeReviewPayload`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Cmodel.ts) — `src\client\model.ts`
    - [`__file__`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Cstyles.ts) — `src\client\styles.ts`
    - [`createWorktreeConsoleRemoteAdapter`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Cconsole-remote%5Cadapter.ts) — `src\client\console-remote\adapter.ts`
    - [`ConsoleClientContext`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Cconsole-remote%5Cindex.ts) — `src\client\console-remote\index.ts`
    - [`Context`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Cconsole-remote%5Cindex.ts) — `src\client\console-remote\index.ts`
    - [`PreSessionWorktreeToggleProps`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Cpre-session%5CPreSessionWorktreeToggle.tsx) — `src\client\pre-session\PreSessionWorktreeToggle.tsx`
    - [`PreSessionDraftActions`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Cpre-session%5Ccontroller.ts) — `src\client\pre-session\controller.ts`
    - [`PreSessionDraftState`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Cpre-session%5Ccontroller.ts) — `src\client\pre-session\controller.ts`
    - [`PreSessionWorktreeController`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Cpre-session%5Ccontroller.ts) — `src\client\pre-session\controller.ts`
    - [`PreSessionWorktreeError`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Cpre-session%5Ccontroller.ts) — `src\client\pre-session\controller.ts`
    - [`PreparePreSessionWorktreeRequest`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Cpre-session%5Ccontroller.ts) — `src\client\pre-session\controller.ts`
    - [`HarnessInputActions`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Cpre-session%5Charness-input.ts) — `src\client\pre-session\harness-input.ts`
    - [`PreSessionSlotContextLike`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Cpre-session%5Cindex.tsx) — `src\client\pre-session\index.tsx`
    - [`PreSessionSlotProps`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Cpre-session%5Cindex.tsx) — `src\client\pre-session\index.tsx`
    - [`__file__`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Creview-console%5CDeliveryProof.tsx) — `src\client\review-console\DeliveryProof.tsx`
    - [`PreflightStatus`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Creview-console%5CPreflightStatus.tsx) — `src\client\review-console\PreflightStatus.tsx`
    - [`__file__`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Creview-console%5CReviewActions.tsx) — `src\client\review-console\ReviewActions.tsx`
    - [`validationIcon`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Creview-console%5CReviewDetailsModal.tsx) — `src\client\review-console\ReviewDetailsModal.tsx`
    - [`ReviewIcon`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Creview-console%5CReviewIcon.tsx) — `src\client\review-console\ReviewIcon.tsx`
    - [`WorktreeReviewEvidence`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Creview-console%5CWorktreeReviewPanel.tsx) — `src\client\review-console\WorktreeReviewPanel.tsx`
    - [`WorktreeReviewIdentity`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Creview-console%5CWorktreeReviewPanel.tsx) — `src\client\review-console\WorktreeReviewPanel.tsx`
    - [`WorktreeReviewPanelProps`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Creview-console%5CWorktreeReviewPanel.tsx) — `src\client\review-console\WorktreeReviewPanel.tsx`
    - [`reviewEvidenceFromTarget`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Creview-console%5Cindex.ts) — `src\client\review-console\index.ts`
    - [`PreflightSnapshot`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Creview-console%5Cpreflight-cache.ts) — `src\client\review-console\preflight-cache.ts`
    - [`PreviewRecoverySnapshot`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Creview-console%5Cpreview-recovery-cache.ts) — `src\client\review-console\preview-recovery-cache.ts`
    - [`PersistedRecovery`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Creview-console%5Crecovery-continuation.ts) — `src\client\review-console\recovery-continuation.ts`
    - [`RecoveryEntry`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Creview-console%5Crecovery-continuation.ts) — `src\client\review-console\recovery-continuation.ts`
    - [`WorktreeApplyConflictRecoveryRequest`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Creview-console%5Crecovery-continuation.ts) — `src\client\review-console\recovery-continuation.ts`
    - [`WorktreeRecoverySnapshot`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Creview-console%5Crecovery-continuation.ts) — `src\client\review-console\recovery-continuation.ts`
    - [`WorktreeReviewRegenerationRequest`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Creview-console%5Crecovery-continuation.ts) — `src\client\review-console\recovery-continuation.ts`
    - [`Entry`](https://github.com/wloops/dsh-git-worktree/blob/f93ba8188971886c09b4c40e12c746a23853c229/src%5Cclient%5Creview-console%5Crequest-cache.ts) — `src\client\review-console\request-cache.ts`
    - … and 38 more

