---
title: 平台门控测试：win32 上跳过的 4 个用例均为有意设计
type: learning
source_files:
  - tests/git-unborn.test.ts
  - tests/session-checkout-apply.test.ts
tags:
  - testing
  - windows
---

# 平台门控测试：win32 上跳过的 4 个用例均为有意设计

## Overview

在 `tests/git-unborn.test.ts`、`tests/project-skills.test.ts` 和 `tests/session-checkout-apply.test.ts` 中，存在 4 个针对 Windows (Win32) 平台明确跳过 (`skipIf`) 的测试用例。这些跳过并非遗漏或死代码，而是基于 POSIX 与 Win32 文件系统语义差异（如换行符路径、执行位权限、符号链接）的有意设计。

本文档基于最新源码观察，详细解析这些测试的职责、实现逻辑及跳过原因，确保未来维护者不会为了消除 "skipped" 计数而错误地启用它们。

## Key Components

### `tests/git-unborn.test.ts`

**职责**：验证 Git 工作树管理、未出生仓库（Unborn Repository）处理及 Skill 资源隔离行为。

*   **辅助函数**:
    *   `testEnvironment(overrides)` (17|)：构建测试环境，强制设置 `GIT_CONFIG_NOSYSTEM=1`，在 Win32 将全局配置指向 `NUL`。
    *   `git(cwd, args, input?)` (24|)：同步执行 Git 命令的辅助函数。
    *   `fixture()` (27|)：创建测试夹具，返回 `{ root, repo, hooks, ctx, port }`。
        *   `ctx.subprocess.spawn` (34-48|)：模拟子进程生成，支持 `beforeCommand` 钩子拦截。
*   **核心测试场景**:
    *   **身份读取**：
        *   `it('reads fresh Git identity paths...')` (53|)：验证子目录和分离工作树的 Git 身份解析。
        *   `it.skipIf(process.platform === 'win32')('falls back to single identity reads...')` (72|)：**[WIN32 SKIP]** 验证含换行符的路径回退逻辑。由于 Win32 路径层对 `\n` 的处理与 POSIX 不同，此测试依赖 POSIX 语义，故跳过。
    *   **生产 Git 适配器 - 未出生仓库** (83-248|)：覆盖 `headOid: 'unborn'`、指纹过期 (`stale_local`)、并发竞争、授权中断等复杂场景。
    *   **Windows 长路径支持** (253|)：
        *   `it.skipIf(process.platform !== 'win32')('creates long-path Windows checkouts...')` (253|)：仅在 Win32 运行，验证模块处理超长路径的能力。
    *   **Skill 资源携带与隔离** (312-463|)：验证 `.agents/skills/` 下的忽略文件携带、隔离及冲突处理。

### `tests/session-checkout-apply.test.ts`

**职责**：对 `SessionCheckoutApplyEngine` 进行端到端集成测试，验证隔离工作区变更应用到本地仓库的安全性与原子性。

*   **辅助函数**:
    *   `runGit(cwd, args)` (31-35|)：同步执行 git 命令。
    *   `createFixture(options)` (37-62|)：创建包含 `local checkout` 和 `isolated checkout` 的测试夹具。
    *   `readyPlan(engine, fixture)` (64-69|)：调用 `engine.plan` 并断言状态为 `'ready'`。
*   **核心测试场景**:
    *   **Checkpoint 流程** (72-185|)：验证检查点保存、陈旧隔离检测、恢复及空阶段拒绝。
    *   **Preflight & Apply** (187-232|)：验证预检只读性及基本应用（以 unstaged 形式 patch）。
    *   **Preview, Rollback, Finalize** (262-489|)：验证预览持久化、回滚竞态、终态化验证故障及补偿。
    *   **Fast-Forward & Branch Switches** (491-642|)：验证快进、分支切换及非快进重写下的行为。
    *   **Finish 复杂场景** (644-784|)：验证无关工作接受、快进后完成、任务仅提交、分离 hunk 及 Detached HEAD 拒绝。
    *   **Base Strategy & Conflict Handling** (835-1058|)：验证重基隔离、增量应用、本地包含隔离头及内容/文本/二进制冲突。
    *   **Monorepo Inheritance** (969-985|)：验证 monorepo 中项目外 commit 的继承。
    *   **Platform Specifics**:
        *   `it('applies executable mode changes correctly')` (1224|)：**[WIN32 SKIP]** `test.skip` on Win32。依赖 `core.filemode=true` 与 chmod，Windows 上 git 恒视 filemode 为 false，NTFS 无 exec-bit 语义。
        *   `it('applies symlink creation correctly')` (1240|)：**[WIN32 SKIP]** `test.skip` on Win32。需要符号链接权限/语义，Windows 上 `fs.symlink` 需特权或开发者模式。

## Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│                    Test Runner (Vitest)                      │
│                                                              │
│  ┌─────────────────────┐     ┌────────────────────────────┐  │
│  │ git-unborn.test.ts  │     │ session-checkout-apply.ts  │  │
│  │                     │     │                            │  │
│  │ - Identity Reads    │     │ - Checkpoint               │  │
│  │ - Unborn Repos      │     │ - Preflight                │  │
│  │ - Long Paths (Win)  │     │ - Apply                    │  │
│  │ - Skills Carry      │     │ - Preview/Rollback         │  │
│  └─────────┬───────────┘     └──────────┬─────────────────┘  │
│            │                           │                     │
│            ▼                           ▼                     │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              DSH Git Port / Engine                     │  │
│  │  - createDshGitPort                                   │  │
│  │  - SessionCheckoutApplyEngine                         │  │
│  │  - createNodeSessionCheckoutDependencies              │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## Data Flow

### `git-unborn.test.ts`
1.  **Fixture Setup**：通过 `fixture()` 创建临时 Git 仓库和模拟子进程上下文。
2.  **Port Creation**：`createDshGitPort` 初始化 Git 端口，注入钩子路径。
3.  **Test Execution**：
    *   直接调用 Git 命令验证元数据（如 `inspect`）。
    *   通过 `control.preflightCreate` -> `control.createWithInitialCommit` 触发高层业务流。
    *   验证 `port.initializeEmptyRepository` 在不同并发和状态下的行为。

### `session-checkout-apply.test.ts`
1.  **Fixture Setup**：创建 `local checkout` 和 `isolated checkout`，提交基础状态。
2.  **Engine Initialization**：`createSessionCheckoutApplyEngine` 创建引擎实例。
3.  **Flow Execution**：
    *   `plan` / `preflight`：计算 `baseStrategy` 和 `changedFiles`。
    *   `checkpoint`：将隔离工作区状态打包为 commit。
    *   `apply` / `preview`：将隔离变更以 unstaged 形式 patch 到本地。
    *   `finalize` / `rollback`：根据 receipt 提交或撤销预览变更。
4.  **Verification**：检查本地仓库 HEAD、status、refs 是否符合预期，验证竞态条件下的错误码（如 `stale_local`）。

## Connections

*   [[learnings/platform-gated-tests-win32]]：本文档所属的学习记录模块。
*   [[src/session-checkout-apply.ts]]：`SessionCheckoutApplyEngine` 的实现文件，被 `tests/session-checkout-apply.test.ts` 测试。
*   [[src/git-port.ts]]：Git 端口接口定义，被 `tests/git-unborn.test.ts` 中的 `createDshGitPort` 使用。
*   [[tests/project-skills.test.ts]]：另一个涉及 Win32 平台门控的测试文件，关注 Skill 资源的执行位权限。

## Known Issues

### Win32 平台门控用例清单

以下 4 个用例在 Win32 平台上被跳过，原因是它们依赖 POSIX 特有的文件系统语义，在 Windows 上无法正确运行或断言无效。

| 位置 | 用例 | 跳过条件 | 为什么不能在 win32 跑 |
| --- | --- | --- | --- |
| `tests/git-unborn.test.ts:72` | newline 仓库路径回退单身份读取 | `skipIf(win32)` | 目录名含 `\n` 依赖 POSIX 文件系统语义，Win32 路径层行为不同且不可靠 |
| `tests/project-skills.test.ts:88` | 保留可执行位并保护后续权限变更 | `skipIf(win32)` | 断言 chmod 0o755/0o644 的 exec-bit，NTFS 无此语义 |
| `tests/session-checkout-apply.test.ts:1224` | Isolated 可执行位变更同步 Local | `win32 ? test.skip : test` | 依赖 `core.filemode=true` 与 chmod，Windows 上 git 恒视 filemode 为 false |
| `tests/session-checkout-apply.test.ts:1240` | Isolated 新增 symlink 同步 Local | `win32 ? test.skip : test` | 需要符号链接权限/语义，Windows 上 `fs.symlink` 需特权或开发者模式 |

### 对策

- 修改这些用例前先确认平台语义，不要为了消灭 skipped 而删除或强行启用。
- 若未来新增依赖 POSIX 语义（exec-bit、symlink、换行路径、大小写敏感）的用例，沿用 `skipIf(process.platform === 'win32')` 惯例。