# dsh-git-worktree 概述

## 仓库定位

`dsh-git-worktree` 是 dsh（Deep Shell）生态中的 **Git worktree 工作区生命周期管理插件**。它为 dsh 提供完整的 `git worktree` 操作能力：基于会话目标上下文自动创建、托管、复用并清理隔离的 Git 工作树，支持多会话并发、主机兼容性适配、创建失败回滚，以及控制台侧的工作区宿主（console host）与远程（console remote）服务控制。

## 核心架构

```mermaid
flowchart TB
    subgraph 构建与配置["构建与配置"]
        PKG["package.json#59 pnpm-workspace.yaml#59 tsconfig.json#59 CI#59 vitest"]
    end

    subgraph 共享契约["共享契约与领域端口 (src)"]
        TYPES["核心类型与端口"]
        ADAPTERS["适配器 (src/adapters)"]
    end

    subgraph 生命周期核心["工作区生命周期管理核心 (src)"]
        INDEX["入口 index.ts"]
        SESSION["会话 checkout"]
        CONCUR["并发控制"]
        FAIL["creation-failure.ts 创建失败处理"]
        HOSTC["host-compat.ts 主机兼容"]
        PATH["managed-worktree-path.ts 托管路径"]
        TARGET["session-target-context.ts 目标上下文"]
        WSP["workspace-provider-lifecycle.ts 提供器生命周期"]
    end

    subgraph 控制台["控制台控制面与服务 (src)"]
        HOST["console-host 工作区宿主"]
        REMOTE["console-remote 远程控制"]
    end

    CLIENT["客户端 (src/client)"]

    PKG --> INDEX
    TYPES --> ADAPTERS
    ADAPTERS --> INDEX
    INDEX --> SESSION
    INDEX --> CONCUR
    SESSION --> FAIL
    SESSION --> HOSTC
    SESSION --> PATH
    SESSION --> TARGET
    INDEX --> WSP
    HOST --> WSP
    REMOTE --> HOST
    CLIENT --> REMOTE
```

## 端到端调用流

```mermaid
sequenceDiagram
    participant U as dsh 会话目标
    participant C as 客户端 (src/client)
    participant R as console-remote
    participant H as console-host
    participant W as 工作区提供器生命周期
    participant L as 生命周期核心 (index.ts)
    participant G as git worktree / 文件系统

    U->>C: 发起会话工作区请求
    C->>R: 远程调用控制面
    R->>H: 派发宿主任务
    H->>W: 托管并复用工作区提供器
    W->>L: 创建/复用会话工作树
    L->>L: 解析 session-target-context
    L->>L: 计算 managed-worktree-path
    L->>L: host-compat 主机适配
    L->>G: git worktree add#59 checkout
    G-->>L: 工作树就绪或失败
    alt 创建失败
        L->>L: creation-failure 回滚/清理
    end
    L-->>W: 返回工作区句柄
    W-->>H: 宿主状态同步
    H-->>R: 结果回执
    R-->>C: 返回可操作的工作区
```

## 核心模块文档

| 模块 | 职责 | 文档 |
| --- | --- | --- |
| 构建与配置 | 包清单、pnpm workspace、TypeScript 编译、CI、测试基础设施与 Cordis 补丁 | [build_and_configuration.md](build_and_configuration.md) |
| 共享契约与领域端口 | 核心类型、领域端口及 `src/adapters` 适配器实现 | [shared_contracts_and_domain_ports.md](shared_contracts_and_domain_ports.md) |
| 工作区生命周期管理核心 | 会话 checkout、并发、创建失败回滚、主机兼容、托管路径、目标上下文与提供器生命周期 | [worktree_lifecycle_management_core.md](worktree_lifecycle_management_core.md) |
| 控制台控制面与服务 | `console-host` 工作区宿主与 `console-remote` 远程控制服务 | [console_control_plane_and_services.md](console_control_plane_and_services.md) |
| 客户端 | 面向调用方的客户端封装 | [client.md](client.md) |

## 构建、测试与部署

本仓库采用 pnpm workspace + TypeScript 构建，通过 `package.json` 中的脚本（`build`、`check:publish`、`dev:dsh`、`dev:dsh:smoke` 等）完成编译、发布前检查与本地 dsh 集成联调；CI 由 `.github/workflows/ci.yml` 的 `check` 工作流驱动，测试基础设施基于 `vitest.config.ts`。详细的构建、打包、发布与配置说明请参见 [Build, Deployment and Configuration 模块文档](build_and_configuration.md)。