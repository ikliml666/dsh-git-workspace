---
title: "客户端 RPC 超时看门狗：30s/180s 预算与被否决的替代方案"
type: decision
source_files:
  - "src/client/console-remote/adapter.ts"
  - "src/console-contract.ts"
  - "src/console-remote/schemas.ts"
tags:
  - rpc
  - timeout
  - design
  - client
---

## 背景

Web RPC 传输层（fetch 信封 + 网关 + 宿主 handler）全程无超时，宿主卡住即 UI 永久冻结（见 [[web-rpc-transport-has-no-timeout]]）。需要一层客户端防护。

## 决定

在 `src/client/console-remote/adapter.ts` 的 `invoke()` 里用 `Promise.race` 给每次远程调用加看门狗：

- `FAST_TIMEOUT_MS = 30_000`，适用 `FAST_METHODS`（sidebarTopology/current/list/inspect/preflight/preflightCreate/previewRecoveryPreflight——全是只读快路径）。
- `SLOW_TIMEOUT_MS = 180_000`，适用其余全部方法（create/discard/finalize 等真实变更，服务端含 git 操作，给足余量）。
- 超时返回结构化错误 `{ code: 'timeout', category: 'unavailable', retryable: true }`，文案见 `src/i18n/transport-messages.ts` 的 `invokeTimeout`（提示服务端操作可能仍在进行、可稍后重试）。

## 否决的替代方案

- **AbortSignal 打通到传输层**：网关的 `token.abort.signal` 是内部实现（lib/client.js:1653），跨包不可插拔；放弃。
- **control-plane list() 并行化 observe**：`withBindingLock`（src/session-checkout-module.ts:959，Promise 链式互斥队列）会把所有模块操作重新串行化（observeManagedCheckout 也在锁内，:4273），客户端并行毫无收益；放弃。list 慢（~5.5s，每条记录一次 git inspect+status）是锁语义的代价，只能靠减小锁粒度解决，不在本次范围。（2026-09-29 后续：锁粒度已在服务端解决——模块新增批量 `observeManagedCheckouts`，一次 withBindingLock 内并行验证全部记录，配合 git.inspect spawn 合并，见 [[learnings/git-spawn-budget-list-latency|git spawn 预算与 list 延迟]]。）
- **openIsolatedTarget 静默返回修复**：复核发现超时/路径不匹配路径本就抛可见错误，唯一静默分支是 `!isActive()`（会话已切走，属正确行为）；不需要修。

## 重试安全性

create/discard 等变更方法超时后重试是安全的：服务端按 `session:<id>` / `root:<canonical>` 键的 `withCreation` 并发守卫（src/console-host/control-plane.ts:443-471）会返回 `operation_not_allowed` 而非重复执行，且 checkout 绑定可恢复现有状态。
