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

## Overview

在 `tests/git-unborn.test.ts` 与 `tests/session-checkout-apply.test.ts` 中，存在针对 Windows (Win32) 平台明确跳过 (`skipIf`) 或反向门控（`skipIf(process.platform !== 'win32')`）的测试用例。标题所述“4 个跳过用例”在历史版本中可能包含其他文件，但基于当前提供的源码，这两个文件共包含 3 个在 Win32 上跳过的用例与 1 个仅在 Win32 上运行的用例，合计 4 个平台门控用例。这些门控并非遗漏，而是基于 POSIX 与 Win32 文件系统语义差异（如换行符路径、执行位权限、符号链接、长路径限制）的有意设计。

本文档基于最新源码观察，详细解析这些测试的职责、实现逻辑及门控原因，确保未来维护者不会为了消除 "skipped" 计数而错误地启用它们。

## Key Components

### `tests/git-unborn.test.ts`

**职责**：验证 Git 工作树管理、未出生仓库（Unborn Repository）处理及 Skill 资源隔离行为。

*   **辅助函数**:
    *   `testEnvironment(overrides)` (17|)：构建测试环境，强制设置 `GIT_CONFIG_NOSYSTEM=1`，在 Win32 将全局配置指向 `NUL`，并清理敏感 Git 环境变量（如 `GIT_AUTHOR_*`、`GIT_DIR` 等）。
    *   `git(cwd, args, input?)` (24|)：同步执行 Git 命令的辅助函数，使用上述环境。
    *   `fixture()` (27|)：创建测试夹具，返回 `{ root, repo, hooks, ctx, port }`。
        *   `ctx.subprocess.spawn` (34-48|)：模拟子进程生成，支持 `beforeCommand` 钩子拦截 Git 参数，返回带有 `done`、`terminate`、`collected` 等方法的对象。
*   **核心测试场景**:
    *   **身份读取**：
        *   `it('reads fresh Git identity paths together for subdirectories and detached worktrees', ...)` (53|)：验证子目录和分离工作树的 Git 身份解析，调用 `port.inspect` (62|)。
        *   `it.skipIf(process.platform === 'win32')('falls back to single identity reads for a repository path containing a newline', ...)` (72|)：**[WIN32 SKIP]** 验证含换行符 (`\n`) 的仓库路径回退到单身份读取（`--git-common-dir` 调用两次）。由于 Win32 路径层对换行符的处理与 POSIX 不同，此测试依赖 POSIX 语义，故跳过。
    *   **生产 Git 适配器 - 未出生仓库** `describe('production Git adapter: unborn repositories', ...)` (83-250|)：覆盖 `headOid: 'unborn'` (86|)、指纹过期 (`stale_local`) (110|)、并发竞争 (151|)、授权中断 (206|) 等复杂场景。
    *   **Windows 长路径支持** (253|)：
        *   `it.skipIf(process.platform !== 'win32')('creates long-path Windows checkouts on the first attempt and next iteration without persistent config changes', ...)` (253|)：**[WIN32 ONLY]** 仅在 Win32 运行，验证模块处理超长路径（>260 字符）的能力，使用 `module.createIsolatedTarget` (284|)、`module.markReadyForReview` (293|)、`module.operate` (295|) 等。
    *   **Skill 资源携带与隔离**：
        *   `it('carries ignored project Skill resources on creation without making the checkout dirty', ...)` (312|)
        *   `it('keeps carried Skills out of review, checkpoint, preview and finalize and carries fresh Skills into the next iteration', ...)` (331|)
        *   `it('preserves tracked Skill edits and explicit promotion of a carried Skill into Git', ...)` (388|)
        *   `it('rejects local tracked Skill conflicts before creating and retains later auxiliary changes on cleanup', ...)` (411|)
        *   `it('preserves an evidenced checkout and Local when Skill carrying is interrupted after creation', ...)` (437|)

### `tests/session-checkout-apply.test.ts`

**职责**：对 `SessionCheckoutApplyEngine` 进行端到端集成测试，验证隔离工作区变更应用到本地仓库的安全性与原子性。

*   **辅助函数**:
    *   `runGit(cwd, args)` (32|)：同步执行 git 命令，禁用 `core.quotePath`，失败时抛错。
    *   `createFixture(options)` (38-62|)：创建包含 `local checkout` 和 `隔离 checkout` 的测试夹具，提交基础状态（tracked.txt、merge.txt、binary.dat）。
    *   `readyPlan(engine, fixture)` (65-70|)：调用 `engine.plan` 并断言状态为 `'ready'`，返回 `ApplyPlan`。
*   **核心测试场景** `describe('SessionCheckoutApplyEngine', ...)` (72|)：
    *   **Checkpoint 流程** (73-186|)：验证检查点保存、陈旧隔离检测、恢复及空阶段拒绝。
    *   **Preflight & Apply** (188-232|)：验证预检只读性及基本应用（以 unstaged 形式 patch）。
    *   **Preview, Rollback, Finalize** (263-390|)：验证预览持久化、回滚竞态、终态化验证故障及补偿。
    *   **Fast-Forward & Branch Switches** (392-643|)：验证快进、分支切换及非快进重写下的行为。
    *   **Finish 复杂场景** (645-785|)：验证无关工作接受、快进后完成、任务仅提交、分离 hunk 及 Detached HEAD 拒绝。
    *   **Base Strategy & Conflict Handling** (836-1059|)：验证重基隔离、增量应用、本地包含隔离头及内容/文本/二进制冲突。
    *   **Monorepo Inheritance** (970-986|)：验证 monorepo 中项目外 commit 的继承。
    *   **Platform Specifics**:
        *   `;(process.platform === 'win32' ? test.skip : test)('Given Isolated changes executable mode When applied Then Local receives an unstaged mode change', ...)` (1225-1239|)：**[WIN32 SKIP]** 依赖 `core.filemode=true` 与 `chmod` (1230|)，Windows 上 git 恒视 filemode 为 false，NTFS 无 exec-bit 语义。
        *   `;(process.platform === 'win32' ? test.skip : test)('Given symlinks are available and Isolated adds one When applied Then Local receives an unstaged symlink', ...)` (1241-1255|)：**[WIN32 SKIP]** 需要符号链接权限/语义，`fs.symlink` (1245|) 在 Windows 上需特权或开发者模式。

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
│  │  - createDshGitPort (src/adapters/git.ts)             │  │
│  │  - SessionCheckoutApplyEngine (src/session-checkout-apply.ts) │
│  │  - createNodeSessionCheckoutDependencies              │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## Data Flow

### `tests/git-unborn.test.ts`
1.  **Fixture Setup**：通过 `fixture()` (27|) 创建临时 Git 仓库和模拟子进程上下文（`ctx` 含 `subprocess.spawn` 34-48|）。
2.  **Port Creation**：`createDshGitPort` (49|) 初始化 Git 端口，注入钩子路径。
3.  **Test Execution**：
    *   直接调用 Git 命令验证元数据（如 `port.inspect` (62|)、`port.preflightInitialCommit!` (93|)）。
    *   通过 `control.preflightCreate` (187|) -> `control.createWithInitialCommit` (192|) 触发高层业务流（使用 `createWorktreeConsoleControlPlane` 185|）。
    *   验证 `port.initializeEmptyRepository` (95|) 在不同并发和状态下的行为（如 `stale_local` 拒绝）。

### `tests/session-checkout-apply.test.ts`
1.  **Fixture Setup**：`createFixture` (38|) 创建 `local checkout` 和 `隔离 checkout`，提交基础状态。
2.  **Engine Initialization**：`createSessionCheckoutApplyEngine` 调用散见各测试（如 84|, 119|, 162|, 192| 等）创建引擎实例。
3.  **Flow Execution**：
    *   `plan` / `preflight`：计算 `baseStrategy` 和 `changedFiles`（如 `engine.plan` 在 66| 被 `readyPlan` 调用）。
    *   `checkpoint`：将隔离工作区状态打包为 commit（`engine.checkpoint` 89|）。
    *   `apply` / `preview`：将隔离变更以 unstaged 形式 patch 到本地（`engine.apply` 206|、`engine.preview` 269|）。
    *   `finalize` / `rollback`：根据 receipt 提交或撤销预览变更（`engine.finalize` 380|、`engine.rollback` 307|）。
4.  **Verification**：检查本地仓库 HEAD、status、refs 是否符合预期，验证竞态条件下的错误码（如 `stale_local` 1142|、`stale_isolated` 1217|）。

## Connections

*   [[src/session-checkout-apply.ts]]：`SessionCheckoutApplyEngine` 的实现文件，被 `tests/session-checkout-apply.test.ts` 中的 `createSessionCheckoutApplyEngine` 使用。
*   [[src/adapters/git.ts]]：Git 端口接口定义，被 `tests/git-unborn.test.ts` 中的 `createDshGitPort` (49|) 使用。
*   [[tests/git-unborn.test.ts]]：本文分析的未出生仓库与 Win32 长路径门控测试。
*   [[tests/session-checkout-apply.test.ts]]：本文分析的 Apply 引擎与 POSIX 语义门控测试。

## Known Issues

### Win32 平台门控用例清单

基于当前两个源文件，共存在 4 个平台门控用例（3 个在 Win32 跳过，1 个仅在 Win32 运行）。它们依赖 POSIX 特有的文件系统语义，在 Windows 上无法正确运行或断言无效。

| 位置 | 用例 | 门控条件 | 为什么不能在 win32 跑 / 仅 win32 |
| --- | --- | --- | --- |
| `tests/git-unborn.test.ts:72` | newline 仓库路径回退单身份读取 | `skipIf(win32)` | 目录名含 `\n` 依赖 POSIX 文件系统语义，Win32 路径层行为不同且不可靠 |
| `tests/git-unborn.test.ts:253` | 长路径 Windows checkouts | `skipIf(!win32)` | 仅在 Win32 验证超长路径（>260）处理能力，POSIX 无此限制故跳过 |
| `tests/session-checkout-apply.test.ts:1225` | Isolated 可执行位变更同步 Local | `win32 ? test.skip : test` | 依赖 `core.filemode=true` 与 `chmod` (1230|)，Windows 上 git 恒视 filemode 为 false |
| `tests/session-checkout-apply.test.ts:1241` | Isolated 新增 symlink 同步 Local | `win32 ? test.skip : test` | 需要符号链接权限/语义，`fs.symlink` (1245|) 在 Windows 上需特权或开发者模式 |

### 对策

- 修改这些用例前先确认平台语义，不要为了消灭 skipped 而删除或强行启用。
- 若未来新增依赖 POSIX 语义（exec-bit、symlink、换行路径、大小写敏感）的用例，沿用 `skipIf(process.platform === 'win32')` 惯例；对于仅验证 Windows 特有行为（如长路径）的用例，使用 `skipIf(process.platform !== 'win32')`。