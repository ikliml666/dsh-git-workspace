---
title: "隔离工作树创建与交付链路设计"
type: decision
source_files:
  - src/adapters/worktree-creation.ts
  - src/console-host/control-plane.ts
tags:
  - design
  - create
  - delivery
  - worktree
  - isolation
---

## Overview

本决策文档详细阐述了隔离工作树（Isolated Worktree）的创建机制及其与源会话（Source Session）分支的关系。核心结论是：**创建工作树时传入的 `branch` 参数仅用于确定“基准提交”（Base OID），绝不改变工作树的 Detached HEAD 状态，也不影响最终交付的目标分支。**

交付目标始终锁定为**源会话当前检出的分支**。这意味着，无论用户从哪个分支创建隔离工作树，最终的代码变更都必须通过 `update-ref` CAS 操作写回源会话的原始分支头。这种设计确保了交付链路的确定性，避免了因工作树 Adopt 分支而导致的预期错乱。

## Key Components

### `src/adapters/worktree-creation.ts`

**职责**：工作树创建的核心协调器，负责从注册到检出的全流程控制，确保原子性和身份一致性。

*   **`createWorktree(localRoot, target, baseOid, run, saveEvidence?)`** (L16)
    *   **输入**：本地仓库根、目标路径、基础 OID、运行命令执行器。
    *   **行为**：
        1.  **身份验证与预检**：使用 `samePath`（跨平台大小写敏感处理）和 `sameIdentity`（JSON 序列化比对）确保父目录、公共目录和目标目录在操作期间未被篡改。通过 `files.inspectDirectoryIdentity` 获取目录标识。
        2.  **元数据指纹**：调用 `metadataFingerprint` 函数递归遍历 `.git` 目录，对非动态文件（排除 index, gitdir, ORIG_HEAD）计算 SHA256 哈希。允许的文件列表硬编码在代码中（如 HEAD, commondir, locked 等）。
        3.  **创建流程**：
            *   创建目标目录并标记 `claimed = true`。
            *   保存证据（包含锁原因 UUID）。
            *   执行 `git worktree add --detach --no-checkout --lock` 进行注册。**注意：此处强制使用 `--detach`，不 Checkout 任何分支。**
            *   验证 `.git` 指针文件及反向链接的一致性。
            *   **检出策略分支**：若启用稀疏检出 (`core.sparseCheckout`)，则执行 `reset --hard`；否则执行 `read-tree` 生成索引快照，计算 `indexFingerprint`，再执行 `checkout-index --all`。
        4.  **错误处理与清理**：
            *   **未注册阶段失败**：若仅创建了目录但未注册到 git，且满足特定静默条件（目录空、身份未变、元数据无新增），则尝试删除目录并抛出 `WorktreeCreationFailure(true)`（可安全忽略/重试）。
            *   **已注册阶段失败**：若注册后失败，进入回滚逻辑。首先验证当前状态，然后将工作树移动到隔离区（`.failed-{uuid}`），再次验证隔离后的状态，最后强制移除工作树注册。若回滚过程中出现异常，抛出 `WorktreeCreationFailure(false)`（不可忽略，需人工介入或保留现场）。
    *   **完整性校验函数**：
        *   `verifyIdentity` (L108)：深度校验 `.git` 指针、反向链接、HEAD OID、锁原因及无残留 `.lock` 文件。
        *   `verifyRollbackMetadata` (L138)：校验元数据指纹和索引指纹是否保持不变，检查 ORIG_HEAD 内容。
        *   `verifyUnmodified` (L155)：最复杂的校验函数。比对 `ls-files` 输出与实际文件系统。检查子模块残留、过滤属性转换痕迹、逐个校验文件哈希（支持符号链接和普通文件）、检查索引条目是否被修改（`diff-index`, `ls-files -v`）、确认无未知文件或变更。

### `src/console-host/control-plane.ts`

**职责**：工作树控制台的控制平面核心实现。作为 Host 侧的“调度器”和“授权者”，它接收来自 UI/Client 的请求，执行严格的身份验证（Authorization）、状态一致性检查（CAS），并协调底层的 `SessionCheckoutModule`、Git 端口和注册表（Registry）。

*   **`createWorktreeConsoleControlPlane(options)`** (L128)
    *   **工厂函数**：接受 `WorktreeConsoleControlPlaneOptions`，注入 `module`, `lookup`, `files`, `registry`, `git`, `reviewDiff` 等依赖。
    *   **并发控制**：
        *   `creating`: `Set<string>`，防止同一 Session 同时发起多个创建操作（L334）。
        *   `confirmations`: `Map<string, ...>`，存储空仓库初始化的确认令牌，带过期时间（5分钟，L296）和容量限制（500个，L287）。
    *   **主要方法**：
        *   `create(request)` / `createWithInitialCommit(request)`：使用 `withCreation` 锁机制防止并发创建。`create` 方法接收可选的 `branch` 参数，并将其透传给 `module.createIsolatedTarget()`。
        *   `authorize(callerId, record)` (L185)：核心授权逻辑。检查调用者是否为 Owner 或 Source Session，检查 Project ID 匹配，验证 CWD，对于非 discarded 状态，额外检查 `listManagedWorktreesForSession` 以确认可见性。
        *   `linkedReadAccess(sessionId, anchorId)` (L213)：处理链接会话的只读访问权限。允许隔离会话通过锚点（Anchor）访问同组的工作树，需验证锚点的接受槽持有者状态。
        *   `observe(targetId)` (L266)：获取记录的运行时状态。优先使用 `module.observeManagedCheckout`，否则回退到逐条 Git 检查。
        *   `details(targetId)` (L293)：组装详细的 Target 信息，包括链接读取的特殊 CAS 校验。

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                     Control Plane                           │
│  src/console-host/control-plane.ts                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │ authorize│  │ observe  │  │ create   │                  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                  │
│       │              │             │                        │
│       ▼              ▼             ▼                        │
│  ┌──────────────────────────────────────────┐               │
│  │          SessionCheckoutModule           │               │
│  │  (Adapter / Backend Implementation)      │               │
│  └──────────────────┬───────────────────────┘               │
│                     │                                       │
│                     ▼                                       │
│  ┌──────────────────────────────────────────┐               │
│  │         Worktree Creation Adapter        │               │
│  │  src/adapters/worktree-creation.ts       │               │
│  │  ┌────────────────────────────────────┐  │               │
│  │  │ createWorktree()                   │  │               │
│  │  │ 1. Verify Identities               │  │               │
│  │  │ 2. Register Worktree (--detach)    │  │               │
│  │  │ 3. Read-Tree / Reset               │  │               │
│  │  │ 4. Verify Unmodified               │  │               │
│  │  └────────────────────────────────────┘  │               │
│  └──────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

1.  **请求发起**：UI 发起 `create` 请求，携带可选的 `branch` 参数。
2.  **并发控制**：`control-plane.ts` 中的 `withCreation` 锁确保同一 Session 不会并发创建。
3.  **目标创建**：`create` 方法调用 `options.module.createIsolatedTarget(sourceSessionId, targetSessionId, branch)`。
    *   如果 `branch` 存在，它被传递给底层模块，用于确定初始的 `baseOid`。
    *   底层模块创建一个新的隔离 Session (`targetSessionId`)。
4.  **工作树初始化**：
    *   `worktree-creation.ts` 接管实际的文件系统操作。
    *   它使用 `baseOid`（源自源会话的指定分支 HEAD）来注册一个 Detached HEAD 的工作树。
    *   **关键点**：工作树本身不与任何分支关联（Detached），因此不存在“Adopt 分支”的概念。
5.  **交付链路**：
    *   用户在隔离工作树中进行开发。
    *   当准备交付时，系统比较隔离工作树的 HEAD 与源会话的 HEAD。
    *   由于工作树是 Detached 的，交付操作本质上是计算差异并将变更应用到源会话的当前分支上（通常通过 `merge` 或 `cherry-pick`，具体取决于实现，但决策层确保目标是源会话的分支）。
    *   最终，源会话的分支头被更新（`update-ref`），完成交付。

## Connections

*   [[session-management]]：管理源会话和目标会话的生命周期。
*   [[git-operations]]：底层 Git 命令的执行封装。
*   [[file-system-port]]：文件系统操作的抽象接口，用于身份验证和文件读写。