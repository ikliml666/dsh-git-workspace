---
title: "非 Git 目录渐进增强：显式确认下的 init + 首次提交，而非静默或死路"
type: decision
source_files:
  - src/adapters/initial-commit.ts
  - src/console-host/control-plane.ts
tags:
  - design
  - non-git
  - onboarding
---

## Overview

本文档记录了对非 Git 目录（包括完全未初始化的目录和存在未跟踪文件的“未出生”仓库）的处理决策。核心变更在于引入显式的用户确认流程，将原本可能导致静默失败或无操作的死角转化为可执行的增量操作。

主要涉及两个层面：
1. **底层适配层 (`src/adapters/initial-commit.ts`)**：实现了 `initializeProject` 方法，用于在用户确认后执行 `git init`、`git add` 和 `git commit`。该方法具备严格的预检逻辑，确保不会意外覆盖已有版本控制数据，且对身份配置缺失等错误原样抛出。同时引入了 `initializeEmptyRepository` 以支持带指纹校验的原子化空仓库初始化。
2. **控制台控制平面 (`src/console-host/control-plane.ts`)**：新增 `initProject` RPC 接口，通过 `withCreation` 互斥守卫保证线程安全，并调用底层适配层完成初始化。同时，`preflightCreate` 逻辑更新，能够识别空仓库指纹并引导用户进行显式确认，而 `createWithInitialCommit` 则处理基于指纹 CAS 的空仓库创建。

## Key Components

### src/adapters/initial-commit.ts

该文件定义了 `initialCommitActions` 工厂函数，返回一系列用于处理初始提交的辅助函数。

- **`GitCommitProtocol` (Line 9)**: 接口定义，包含 `prepare` 字符串和 `beforeCommit()` 异步方法，用于在执行 git 命令前准备输入和进行前置检查。
- **`Run` 类型 (Line 11)**: 定义执行 git 命令的函数签名，接收根路径、参数数组和可选输入，返回包含退出码、标准输出和标准错误的对象。
- **`initialCommitActions(inspect, run)` (Lines 14-136)**: 工厂函数。
    - **`checked(root, args, input)` (Lines 17-21)**: 包装器，执行 git 命令并在失败时抛出 `SessionCheckoutError`。
    - **`identity(path, trackChanges)` (Lines 22-25)**: 生成文件或目录的唯一标识符，基于设备号、inode 和时间戳。若为符号链接则抛出 `stale_local` 错误。
    - **`indexBytes(gitDir)` (Lines 26-29)**: 读取 `.git/index` 文件的 base64 编码内容，用于指纹计算。若文件不存在返回空字符串。
    - **`preflightInitialCommit(root)` (Lines 30-58)**: 预检函数，判断仓库状态。
        - 如果快照为 `null`，抛出 `not_git_repository`。
        - 如果 `headOid` 不为 `unborn`，返回 `kind: 'ready'`。
        - 如果存在文件或非空索引，返回 `kind: 'files'`。
        - 否则，计算包含文件系统结构、HEAD、索引等内容的 SHA-256 指纹，返回 `kind: 'empty'`。
    - **`initializeEmptyRepository(root, fingerprint, assertAuthorized)` (Lines 59-104)**: 初始化空仓库。
        - 使用锁机制 (`index.lock`) 防止并发竞争。
        - 验证指纹一致性。
        - 检查作者/提交者身份。
        - 创建空树并提交。
        - 使用 `update-ref --stdin` 进行原子性 HEAD 更新。
    - **`initializeProject(root)` (Lines 107-120)**: **核心新增功能**。
        - 检查是否已有提交，若有则拒绝 (`operation_not_allowed`, `projectAlreadyVersioned`)。
        - 若为非 Git 目录，执行 `git init -b main`。
        - 检查 `GIT_AUTHOR_IDENT`，缺失则报错 (`initialIdentityMissing`)。
        - 执行 `git add -A` 和 `git commit -m "Initial commit"`。
        - **注意**: 此方法不进行指纹 CAS 校验，依赖用户显式确认的安全性。
- **`hostMessage` 导入 (Line 6)**: 用于国际化消息获取。

### src/console-host/control-plane.ts

该文件实现了 Worktree 的控制平面逻辑，包含大量的 RPC 处理方法。

- **`createWorktreeConsoleControlPlane(options)` (Lines 155-650+)**: 主工厂函数，创建控制平面实例。
    - **`localProject(sessionId)` (Lines 285-293)**: 获取当前会话关联的本地项目信息，确保其为本地工作区且存在。
    - **`withCreation(sourceSessionId, action)` (Lines 318-333)**: **关键互斥守卫**。
        - 使用 `creating` Set 存储 session key 和 root key。
        - 防止同一会话或同一根目录的并发初始化/创建操作。
        - 若冲突，抛出 `initialRepositoryBusy`。
    - **`preflightCreate(sourceSessionId)` (Lines 508-523)**: 创建前的预检。
        - 调用 `options.git.preflightInitialCommit`。
        - 若 `kind` 为 `ready`，返回分支列表。
        - 若 `kind` 为 `files`，删除旧确认令牌并返回 `kind: 'files'`。
        - 若 `kind` 为 `empty`，生成 UUID 作为确认令牌 (`confirmationToken`)，存入 `confirmations` Map，设置 5 分钟过期时间，返回 `kind: 'empty'` 及令牌。
    - **`createWithInitialCommit(sourceSessionId, confirmationToken)` (Lines 524-539)**: 带初始提交的创建。
        - 在 `withCreation` 保护下执行。
        - 验证确认令牌的有效性（匹配、未过期、指纹一致）。
        - 调用 `options.git.initializeEmptyRepository` 进行原子化空仓库初始化。
        - 成功后调用 `createTarget` 创建目标工作区。
    - **`initProject(sourceSessionId)` (Lines 540-545)**: **新增 RPC**。
        - 在 `withCreation` 保护下执行。
        - 检查 `options.git.initializeProject` 是否存在，不存在则抛错 (`initializationUnsupported`)。
        - 调用 `await options.git.initializeProject(project.root)`。
        - 返回 `true`。
    - **`create(sourceSessionId, branch)` (Lines 546-547)**: 常规创建工作区。
    - **其他组件**:
        - `sidebarTopology`: 侧边栏拓扑结构。
        - `current`: 获取当前会话状态。
        - `list`: 列出管理工作区。
        - `inspect`: 检查工作区详情。
        - `reviewDiff`: 审查差异。
        - `checkpoint`: 保存检查点。
        - `preview`: 预览更改。
        - `finalize`: 最终化提交。
        - `discard`: 丢弃更改。
        - `gitOverview`, `gitGraph`, `gitCreateBranch`, `gitSwitchBranch`, `gitPruneMergedBranches`: Git 相关操作。
        - `restoreAbandoned`, `listAbandoned`: 恢复废弃的工作区。
        - `setRetention`, `setPermanent`, `retryCleanup`: 管理保留策略。
        - `beginNextIteration`: 开始下一次迭代。

## Architecture

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                     Client / UI Layer                                      │
│  (触发 Init Project 请求) ────────────────────────────────────────────────────────────────►│
└─────────────────────────────────────────────────────────────────────────────────────────────┘
                                                              │
                                                              ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                              Control Plane (control-plane.ts)                               │
│  ┌───────────────────────────────────────────────────────────────────────────────────────┐  │
│  │  initProject(sourceSessionId)                                                        │  │
│  │  ├─ withCreation (互斥守卫: sessionKey + rootKey)                                    │  │
│  │  ├─ localProject (验证项目存在性与所有权)                                             │  │
│  │  └─ options.git.initializeProject(project.root)                                      │  │
│  └───────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────────────────────┐  │
│  │  preflightCreate(sourceSessionId)                                                    │  │
│  │  ├─ options.git.preflightInitialCommit                                               │  │
│  │  └─ 若 kind='empty': 生成 confirmationToken 并存入 Map                               │  │
│  └───────────────────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
                                                              │
                                                              ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                  Adapter Layer                                            │
│                                  (initial-commit.ts)                                       │
│  ┌───────────────────────────────────────────────────────────────────────────────────────┐  │
│  │  initializeProject(root)                                                             │  │
│  │  ├─ inspect (检查 headOid)                                                           │  │
│  │  ├─ git init -b main (若非 Git 目录)                                                 │  │
│  │  ├─ var GIT_AUTHOR_IDENT (验证身份)                                                  │  │
│  │  ├─ git add -A                                                                       │  │
│  │  └─ git commit -m "Initial commit"                                                   │  │
│  └───────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────────────────────┐  │
│  │  initializeEmptyRepository(root, fingerprint)                                        │  │
│  │  ├─ 锁机制 (index.lock)                                                              │  │
│  │  ├─ 指纹 CAS 校验                                                                    │  │
│  │  ├─ mktree + commit-tree                                                            │  │
│  │  └─ update-ref --stdin (原子 HEAD 更新)                                              │  │
│  └───────────────────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Data Flow

1. **预检阶段 (`preflightCreate`)**:
   - 客户端调用 `preflightCreate`。
   - 控制平面调用 `options.git.preflightInitialCommit`。
   - 适配器层检查仓库状态。如果是空仓库（`kind: 'empty'`），控制平面生成一个唯一的 `confirmationToken` 并将其与 `fingerprint`、`root`、`projectId` 一起存储在内存中的 `confirmations` Map 中，设置 5 分钟过期时间。
   - 控制平面返回 `kind: 'empty'` 和 `confirmationToken` 给客户端。

2. **显式确认与初始化 (`initProject`)**:
   - 用户在 UI 上确认执行初始化。
   - 客户端调用 `initProject` RPC。
   - 控制平面进入 `withCreation` 互斥块，锁定会话和根目录。
   - 控制平面调用 `options.git.initializeProject(project.root)`。
   - 适配器层执行以下步骤：
     a. 检查是否有现有提交，若有则拒绝。
     b. 如果不是 Git 仓库，执行 `git init -b main`。
     c. 检查 `GIT_AUTHOR_IDENT`，若缺失则报错。
     d. 执行 `git add -A` 和 `git commit -m "Initial commit"`。
   - 成功返回后，控制平面释放锁，返回 `true`。

3. **带初始提交的创建 (`createWithInitialCommit`)**:
   - 用户确认执行包含初始提交的创建。
   - 客户端调用 `createWithInitialCommit` RPC，附带 `confirmationToken`。
   - 控制平面进入 `withCreation` 互斥块。
   - 验证 `confirmationToken` 的有效性（匹配、未过期、指纹一致）。
   - 调用 `options.git.initializeEmptyRepository` 进行原子化空仓库初始化（包含锁、指纹 CAS、原子 HEAD 更新）。
   - 成功后调用 `createTarget` 创建目标工作区。
   - 清理 `confirmations` Map 中的条目。

## Connections

- [[session-checkout]]: 核心模块，提供 `SessionCheckoutModule` 接口，被 `control-plane.ts` 依赖。
- [[ports]]: 定义 `GitCheckoutSnapshot`, `SessionCheckoutGitPort` 等端口类型，被上述两文件共享。
- [[i18n/host]]: 提供 `hostMessage` 函数，用于国际化错误提示。

## Known Issues

- **内存泄漏风险**: `confirmations` Map 中的条目仅在 `createWithInitialCommit` 成功时清除。如果用户取消或超时，条目可能残留。虽然代码中有定期清理逻辑（在 `preflightCreate` 中检查过期时间），但在高并发场景下可能需要更完善的清理机制。
- **身份配置依赖**: `initializeProject` 依赖于 `GIT_AUTHOR_IDENT` 的存在。如果系统环境中未配置用户邮箱和姓名，初始化将失败。需要确保在调用前正确配置 Git 身份。
- **并发限制**: `withCreation` 互斥守卫仅在同一进程内有效。在分布式部署或多进程环境中，需要额外的分布式锁机制来防止竞态条件。