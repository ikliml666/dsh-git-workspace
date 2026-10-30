---
title: worktree_lifecycle_management_core 概览
type: module
source_files:
  - src/index.ts
  - src/session-checkout-apply.ts
  - src/session-checkout-module.ts
  - src/concurrent-session-guard.ts
  - src/creation-failure.ts
  - src/host-compat.ts
  - src/managed-worktree-path.ts
  - src/session-target-context.ts
  - src/workspace-provider-lifecycle.ts
tags: []
generated_by: fsoft-native
fsoft_page: worktree_lifecycle_management_core.md
---
# worktree_lifecycle_management_core 概览

`worktree_lifecycle_management_core` 是本项目的 **Git worktree 生命周期管理核心域模块**。它并不直接暴露给用户使用，而是封装了 worktree 的路径推导、创建、失败处理、宿主环境兼容、会话切换（checkout）以及工作区提供者（workspace provider）的生命周期编排，供上层控制台、远程会话与客户端组合调用。

## 模块目标

该模块承担以下职责：

- 以 `managed-worktree-path.ts` 统一推导受管 worktree 的目录结构，避免硬编码路径散落各处。
- 在 `session-checkout` 中根据当前会话上下文决定是否需要新建、复用或切换 worktree，保障多会话并发下的隔离性。
- 通过 `creation-failure.ts` 对创建失败进行结构化分类与上报，便于上层重试或提示。
- 借助 `host-compat.ts` 屏蔽 Windows、macOS、Linux 等宿主环境差异（如路径分隔符、权限、符号链接等）。
- 通过 `session-target-context.ts` 表达「当前会话希望切换到哪个分支/路径/工作区」的上下文对象，作为 checkout 决策的输入。
- 通过 `workspace-provider-lifecycle.ts` 管理外部工作区提供者（如远程 dev container、容器运行时等）的初始化、健康检查与销毁。
- `index.ts` 对外统一再导出上述能力，方便外部模块以单一入口导入。

## 架构图

### 模块组成与依赖关系

```mermaid
flowchart TB
    Index["index.ts（统一出口）"]
    Path["managed-worktree-path.ts<br/>路径推导"]
    Session["session-checkout<br/>会话切换编排"]
    Failure["creation-failure.ts<br/>失败分类"]
    Host["host-compat.ts<br/>宿主兼容"]
    Ctx["session-target-context.ts<br/>会话目标上下文"]
    Ws["workspace-provider-lifecycle.ts<br/>工作区提供者生命周期"]
    Concurrency["concurrency<br/>并发原语"]

    Index --> Path
    Index --> Session
    Index --> Failure
    Index --> Host
    Index --> Ctx
    Index --> Ws

    Session --> Ctx
    Session --> Path
    Session --> Ws
    Session --> Concurrency
    Path --> Host
    Failure --> Host
    Ws --> Host
```

### 一次会话切换（checkout）的典型流程

```mermaid
flowchart TD
    A["上层调用方传入会话目标上下文"] --> B["session-target-context 解析目标分支/路径/工作区"]
    B --> C["managed-worktree-path 计算期望目录"]
    C --> D{"目录已存在?"}
    D -- "是" --> E["校验是否为合法受管 worktree"]
    D -- "否" --> F["调用 Git 创建 worktree"]
    F --> G{"创建成功?"}
    G -- "是" --> H["workspace-provider-lifecycle 启动/校验工作区提供者"]
    G -- "否" --> I["creation-failure 结构化归类并上报"]
    E -- "合法" --> H
    E -- "非法" --> I
    H --> J["返回可使用的 worktree 路径与会话句柄"]
    I --> K["上层决定重试或终止"]
```

## 核心组件文档

各子模块的详细说明请参见以下文档：

- [统一出口 index.ts](worktree_lifecycle_management_core/worktree_lifecycle_management_core_index.md)
- [会话切换编排 session-checkout](worktree_lifecycle_management_core/session_checkout.md)
- [创建失败处理 creation-failure.ts](worktree_lifecycle_management_core/creation_failure.md)
- [宿主兼容层 host-compat.ts](worktree_lifecycle_management_core/host_compat.md)
- [受管 worktree 路径推导 managed-worktree-path.ts](worktree_lifecycle_management_core/managed_worktree_path.md)
- [会话目标上下文 session-target-context.ts](worktree_lifecycle_management_core/session_target_context.md)
- [工作区提供者生命周期 workspace-provider-lifecycle.ts](worktree_lifecycle_management_core/workspace_provider_lifecycle.md)

> 备注：`concurrency` 子模块目前尚未生成独立文档，它主要为 `session-checkout` 提供会话级并发原语（如互斥锁、去重），后续将补充。