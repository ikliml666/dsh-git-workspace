---
title: 核心 Worktree 领域与基础设施模块
type: module
source_files:
  - src/adapters/files.ts
  - src/adapters/git-options.ts
  - src/adapters/git.ts
  - src/adapters/initial-commit.ts
  - src/adapters/lookup.ts
  - src/adapters/project-skill-io.ts
  - src/adapters/project-skill-provider.ts
  - src/adapters/project-skills.ts
  - src/adapters/registry.ts
  - src/adapters/safe-file.ts
  - src/adapters/working-directory.ts
  - src/adapters/worktree-creation.ts
  - src/checkpoint.ts
  - src/commands.ts
  - src/commit-message.ts
  - src/creation-failure.ts
  - src/delivery-excludes.ts
  - src/host-compat.ts
  - src/managed-worktree-path.ts
  - src/tools.ts
  - src/concurrent-session-guard.ts
  - src/index.ts
  - src/ports.ts
  - src/session-checkout-apply.ts
  - src/session-checkout-module.ts
  - src/session-target-context.ts
  - src/types.ts
  - src/workspace-provider-lifecycle.ts
tags: []
generated_by: fsoft-native
fsoft_page: core_worktree_domain_and_infrastructure.md
---
# 核心 Worktree 领域与基础设施模块
## 模块定位与核心用途
本模块是 dsh-git-worktree 插件的核心组成，承担「宿主无关业务逻辑」与「真实 DeepSeek Harness（DSH）运行环境」之间的桥梁作用，核心价值包括：
1.  **隔离工作区全生命周期管理**：为会话级隔离 Worktree 提供与宿主环境解耦的可靠业务能力，覆盖会话绑定、隔离工作区创建、评审交付、本地预览、回滚、检查点保存、崩溃恢复、过期资源清理的完整流程。
2.  **稳定跨层契约体系**：通过统一的端口接口、持久化数据模型、对外视图与操作类型定义，严格分离领域逻辑与外部基础设施，从结构上消除层间耦合与循环依赖。
3.  **安全强化的基础设施适配**：将领域端口落地为生产级适配器实现，内置多重安全保障：Git 命令直传不经 Shell、原子文件写入、跨进程文件锁、崩溃恢复机制、目录身份校验、Worktree 误删防护。
4.  **可独立测试的纯规则层**：收敛无副作用的业务规则逻辑（如 Worktree 命名、检查点 CAS 代次生成、交付排除规则、提交信息校验、创建失败安全语义），可完全脱离宿主环境完成单元测试。

## 模块架构
模块严格遵循单向依赖原则，通过契约层解耦领域逻辑与基础设施实现，整体架构与依赖关系如下图所示：
```mermaid
flowchart TB
    subgraph CORE["core_worktree_domain_and_infrastructure 模块"]
        subgraph DOMAIN["session_checkout_domain 领域层"]
            CONTRACTS["领域契约层<br/>端口接口/数据模型/视图类型"]
            ENGINE["交付引擎层<br/>快照校验/三方合并/并发守卫"]
            RUNTIME["运行时装配层<br/>状态机/依赖注入/生命周期管理"]
        end

        subgraph ADAPTERS["src_adapters 基础设施适配层"]
            GITAD["Git 执行族<br/>命令出口/超时控制/创建回滚"]
            PERSISTAD["持久化族<br/>原子写/文件锁/目录身份校验"]
            SKILLAD["项目技能族<br/>私有资源携带/读写隔离"]
            HOSTAD["宿主桥接族<br/>Cordis 服务适配/优雅降级"]
        end

        subgraph OPS["worktree_core_operations 核心操作层"]
            RULES["纯函数规则层<br/>命名/CAS代次/排除规则"]
            TOOLS["宿主注册面<br/>模型工具/斜杠命令暴露"]
        end
    end

    subgraph EXTERNAL["外部依赖与上层消费方"]
        HOST["DSH 宿主服务<br/>Cordis 运行时/工作目录管理"]
        GITBIN["git 可执行文件"]
        NODEFS["node:fs 文件系统"]
        DISK[("插件持久化状态目录")]
        CONSOLE["上层控制台服务"]
        CLIENT["客户端交互界面"]
    end

    RUNTIME --> ENGINE
    RUNTIME --> CONTRACTS
    ENGINE --> CONTRACTS
    ADAPTERS -. "实现契约定义的端口" .-> CONTRACTS
    RUNTIME -->|注入适配器实例| ADAPTERS
    OPS --> RUNTIME
    TOOLS --> RULES
    GITAD --> GITBIN
    GITAD --> NODEFS
    PERSISTAD --> NODEFS
    PERSISTAD --> DISK
    SKILLAD --> NODEFS
    SKILLAD --> DISK
    HOSTAD --> HOST
    RUNTIME --> HOST
    RUNTIME --> CONSOLE
    CONTRACTS --> CLIENT
```
架构设计遵循单向依赖规则：领域层仅依赖自身定义的契约，适配器层实现契约接口但不反向依赖领域逻辑，核心操作层基于领域运行时能力向上暴露用户交互入口，所有层间交互均通过稳定契约完成，保障领域逻辑可独立测试、基础设施实现可按需替换。

## 核心组件文档索引
本模块由三个内聚的核心子组件构成，各组件的详细设计与实现说明可参考对应文档：
1.  **[会话检出领域模块](session-checkout-domain.md)**
    作为宿主无关的核心领域层，定义统一的端口与类型契约，实现 Git 字节级安全写操作、检查点并发守卫、会话检出状态机与运行时装配，是整个模块的业务逻辑核心。
2.  **[宿主适配层](src-adapters.md)**
    作为模块的基础设施边界，将领域契约定义的端口逐一落地为可在真实 DSH 宿主上运行的适配器实现，涵盖 Git 命令安全出口、崩溃安全持久化、随会话携带的项目技能资源、Cordis 服务桥接与降级逻辑，内置多重安全强化机制。
3.  **[核心操作与纯函数工具层](worktree-core-operations.md)**
    作为模块最薄的独立层，收敛可无副作用单测的纯规则逻辑（如 Worktree 命名、检查点代次生成、交付排除规则、创建失败安全语义），并将领域能力注册为模型可见工具与用户可调用的 `/worktree` 斜杠命令，严格遵守「删除操作前必须迁移会话工作目录」的安全契约。