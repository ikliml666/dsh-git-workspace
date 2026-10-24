---
title: git spawn 预算与 list 延迟
type: learning
source_files:
  - src/adapters/git.ts
tags: [performance, spawn-budget, git, list-latency]
---

# git spawn 预算与 list 延迟

## 现象与成本模型

- `ctx.subprocess.spawn` 的固定单价 ≈125ms（harness runner 启动税已由 harness 侧 `freshBuiltRunnerEntry` 从 ~358ms 修到 ~125ms）；list/current 的耗时几乎完全由 **spawn 次数 × 125ms** 解释。
- 修复前 list 链 spawn 计数：callerTarget `inspectLocal` 5（旧 inspect 4 + status 1，全串行）+ 每条记录 observe 9（`validateManagedCheckoutDetailed` 双端 inspect 8 + status 1，全串行）。3 条记录 ≈ 32 次 spawn ≈ 3.6s（实测 3647ms 吻合）。
- 在当前 `src/adapters/git.ts` 中，`inspect` 方法（`src/adapters/git.ts:256-322`）正常路径通过单次 `rev-parse` 组合调用（行 261-263）加上并行的 `symbolic-ref`（行 259），将原本需要 4 次 spawn 的 inspect 压减至 2 次 spawn。这直接降低了上层 `inspectLocal` 与批量观察的基础开销。

## 三个杠杆（2026-09-29 实施后，后续批量接口已落地）

1. **合并（git.ts 层）**：`git.inspect` 方法中 `symbolic-ref --quiet HEAD` 作为并行 promise 提前发起（`src/adapters/git.ts:259`），挂 `catch(() => undefined)` noop 防 unhandledRejection（`:260`），随后单次 `rev-parse --show-toplevel --path-format=absolute --git-common-dir --absolute-git-dir HEAD^{commit}` 一次性取全部位置事实（`:261-263`）。输出按参数顺序一行一值，`lines.length === 4`（`:266`）即解析成功；行数 ≠4 即回退逐项读取（换行路径歧义，`:279-321`）；unborn/broken HEAD 分类逻辑原样保留在回退分支（`:298-321`）。

2. **并行读（caller 层基于 git.ts 接口）**：`inspectLocal` 与 `validateManagedCheckoutDetailed` 的独立 git 读并发化。`inspectLocal` 提前起 `statusPromise`（对应底层 `git.ts` 的 `status` 方法，`src/adapters/git.ts:331-335`）并立即挂 `promise.catch(() => undefined)`，仅在快照证明是仓库时才消费。`validateManagedCheckoutDetailed` 同样提前起 status promise，再用 `Promise.all` 并行执行 `dependencies.git.inspect(canonicalManagedRoot)`（底层 `src/adapters/git.ts:256`）和 `dependencies.git.inspect(canonicalLocalRoot)`，将原本 3 次串行 reduce 为 1 次（双 inspect 同批 + 1 次 status）。

3. **批量观察（锁内并行）**：`list` 端点检查模块是否提供 `observeManagedCheckouts` 批量方法；若提供则一次拿锁并行验证所有 checkoutId。`git.ts` 的轻量 `inspect`（`:256`）与 `status`（`:331`）使得批量映射（`Promise.all`）的 spawn 预算可控；若未提供或批量失败则逐条降级 `observe(record)`，且身份无法验证的记录以无观察投影呈现、面板其余记录照常渲染。当前模块侧 `observeManagedCheckouts` 是对 `observeManagedCheckout` 的 `Promise.all` 映射——仍是应用层串行，但通过 `withBindingLock` 统一拿锁确保没有 mutation 交错，避免客户端并发请求导致的锁内重串行化问题。当年 client-rpc-watchdog 决策否决「客户端并行 observe」的理由正是锁内重串行化——正确解法是把并行移到**锁内**（服务端改锁粒度），当前方案通过 `withBindingLock` 包裹整个批量调用实现这一点。

## 安全边界

- 锁内并行验证是安全的：exclusive 锁下没有 mutation 交错，读的是同一 registry 快照；并行不会引入竞态。
- 逐条 observe 的错误语义（checkout_missing / checkout_mismatch 整体抛出）在批量入口保持一致；批量失败时退回逐条降级观察，不拖垮整个面板。
- `not-a-repo → null` 判定基于合并调用的 stderr 分类（`src/adapters/git.ts:279`，匹配 `/^fatal: not a git repository/` 且 `!await hasGitMetadata(root)` 辅助判断）；合并调用失败但非 not-a-repo 时走原逐项路径二次分类（`:282-321`），不会误判。
- status promise 的 noop catch 仅防 unhandledRejection 冒泡，不吞实际错误——在 `git.ts` 的 `inspect` 中，`symbolicPromise` 的 noop catch（`:260`）仅防止未处理拒绝，合并调用 `combined` 的结果解析或回退分支中的 `throw new SessionCheckoutError` 仍会正确消费错误（如 `:285`、`:307`）。
