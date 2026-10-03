---
title: git spawn 预算与 list 延迟
type: learning
source_files:
  - src/adapters/git.ts
  - src/session-checkout-module.ts
  - src/console-host/control-plane.ts
tags: [performance, spawn-budget, git, list-latency]
---

# git spawn 预算与 list 延迟

## 现象与成本模型

- dsh web 源码模式下每次 `ctx.subprocess.spawn` 的固定单价 ≈125ms（harness runner 启动税已由 harness 侧 `freshBuiltRunnerEntry` 从 ~358ms 修到 ~125ms）；list/current 的耗时几乎完全由 **spawn 次数 × 125ms** 解释。
- 修复前 list 链 spawn 计数：callerTarget `inspectLocal` 5（inspect 4 + status 1，全串行）+ 每条记录 observe 9（`validateManagedCheckoutDetailed` 双端 inspect 8 + status 1，全串行）。3 条记录 ≈ 32 次 spawn ≈ 3.6s（实测 3647ms 吻合）。

## 三个杠杆（2026-09-29 实施后）

1. **合并**：`git.inspect` 方法中 `symbolic-ref --quiet HEAD` 作为并行 promise 提前发起（`src/adapters/git.ts:243`），挂 `catch(() => undefined)` noop 防 unhandledRejection（`:244`），随后单次 `rev-parse --show-toplevel --path-format=absolute --git-common-dir --absolute-git-dir HEAD^{commit}` 一次性取全部位置事实（`:245–247`）。输出按参数顺序一行一值，行数 ≠4 即回退逐项读取（换行路径歧义）；unborn/broken HEAD 分类逻辑原样保留在回退分支（`:263–306`）。
2. **并行读**：`inspectLocal` 与 `validateManagedCheckoutDetailed` 的独立 git 读并发化。`inspectLocal`（`:src/session-checkout-module.ts:220–246`）提前起 `statusPromise`（`:224`）并立即挂 `promise.catch(() => undefined)`（`:226`），仅在快照证明是仓库时才消费（`:231`）。`validateManagedCheckoutDetailed`（`:554–610`）同样提前起 status promise（`:577–578`），再用 `Promise.all` 并行执行 `dependencies.git.inspect(canonicalManagedRoot)` 和 `dependencies.git.inspect(canonicalLocalRoot)`（`:579–582`），将原本 3 次串行 reduce 为 1 次（双 inspect 同批 + 1 次 status）。
3. **批量**：`list` 端点（`:src/console-host/control-plane.ts:649–717`）检查模块是否提供 `observeManagedCheckouts` 批量方法（`:678`）；若未提供则逐条降级 `observe(record)`（`:700`）。当前模块侧未实现批量 observe，因此 list 仍走串行观察，但预留了批量接口槽位以便未来接入锁内并行验证。当年 client-rpc-watchdog 决策否决「客户端并行 observe」的理由正是锁内重串行化——正确解法是把并行移到**锁内**（服务端改锁粒度），而不是客户端发并发请求。

## 安全边界

- 锁内并行验证是安全的：exclusive 锁下没有 mutation 交错，读的是同一 registry 快照；并行不会引入竞态。
- 逐条 observe 的错误语义（checkout_missing / checkout_mismatch 整体抛出）在批量入口保持一致。
- `not-a-repo → null` 判定基于合并调用的 stderr 分类（`:src/adapters/git.ts:263`）；合并调用失败但非 not-a-repo 时走原逐项路径二次分类（`:266–306`），不会误判。
- status promise 的 noop catch 仅防 unhandledRejection 冒泡，不吞实际错误——仅在快照证明是仓库时才 await status（`:src/session-checkout-module.ts:231`、`:577–578`），确保错误仍被消费。

(End of file - total 32 lines)
