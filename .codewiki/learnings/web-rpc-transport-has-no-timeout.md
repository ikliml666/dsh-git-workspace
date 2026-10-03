---
title: "Web RPC 传输层超时修复：从永久卡死到时中断"
type: learning
source_files:
  - "src/client/console-remote/adapter.ts"
  - "src/client/console-remote/index.ts"
  - "src/i18n/transport-messages.ts"
tags:
  - rpc
  - timeout
  - client
  - debugging
---

## 现象

用户点击「创建 Worktree」后按钮永远停在「创建中…」。服务端注册表日志显示 create 在 ~7 秒内正常完成（journal preparing → final，rev 15 → 16），但客户端 workspace/session 目录里始终没有目标会话记录——`openIsolatedTarget`（src/client/actions.ts:186-217）从未执行，说明 `adapter.create` 的响应从未到达客户端回调。

## 根因

dsh Web 端 RPC 传输链路**没有任何一层有超时**：

1. 浏览器侧 `createWebConnectionRpc.call`（@deepseek-ai/dsh-client-connection lib/client.js:4606-4635）用页面 `fetch` POST `{type:"client-request",rpcId,method,payload}` 信封，只等 `{type:"server-response",rpcId,result}`；无超时，仅 signal 可中断。
2. 网关 `connection.rpc.call`（@deepseek-ai/dsh-api-gateway lib/client.js:1601）为每个方法建 AbortController，但从不设时限定时器。
3. 宿主 `rpcFetchHandler`（deepseek-harness packages/client/connection/src/rpc-host.ts:261）`await handler(...)`——若 handler 永不 settle，响应永远不写回，fetch 无限 pending。

任一环节（宿主 handler 卡住、loopback 假死、页面后台节流）都会把 UI 永久冻结在 pending 态，且用户看不到任何错误。

## 修复方案

在 adapter 层引入客户端超时兜底（`src/client/console-remote/adapter.ts:46-74`）：

```typescript
/**
 * The Web RPC carrier has no timeout: a request whose server-side handler
 * stalls (binding-lock queue, hung git) would pend forever and freeze the
 * calling UI in its pending state. Fail the client side instead; server work
 * keeps running and mutating calls stay safe to retry.
 */
const FAST_TIMEOUT_MS = 30_000
const SLOW_TIMEOUT_MS = 180_000
// list/preflight/preflightCreate 全量重算（多记录时 20+ 次 git spawn）可能
// 逼近 30s，放 SLOW 档；其余快路径方法保持 30s。
const FAST_METHODS = new Set([
  'sidebarTopology', 'current', 'inspect',
  'previewRecoveryPreflight',
  'gitOverview', 'gitGraph',
  'listAbandoned',
])
```

核心机制（`adapter.ts:79-108`）：

1. `invoke<T>` 泛型函数包裹所有 remote 调用，使用 `Promise.race` 竞争：
   - `call(locale)` — 实际的 RPC 调用
   - `new Promise<{timedOut: true}>(resolve => setTimeout(resolve, timeoutMs))` — 超时计时器
2. 根据 method 是否在 `FAST_METHODS` 中分配不同超时阈值（30s / 180s）。
3. 超时返回 `timeoutOutcome`，携带 i18n 翻译后的错误信息。
4. catch 分支清理 timer 并区分 codec 拒绝（malformed_response）与普通传输错误（transport_unavailable）。
5. 响应校验层检查 `carrier.ok` 结构及 strict contract 解析。

## 数据流

```
用户操作 → adapter.create() 
  → invoke('create', call) 
    → remote.create(sessionId, branch, locale)
      → Web RPC fetch POST → 等待响应
        → [如果 180s 内无响应] → Promise.race 选择超时 Promise
          → timeoutOutcome({code:'timeout', message: invokeTimeout})
            → 错误信息经 transportMessages.invokeTimeout 翻译
              → 前端展示给用户
```

## 教训

- 「服务端已完成 + 客户端无反应」的排查顺序：先看服务端持久化证据（注册表 journal、workspace.json、会话目录），再断言传输层丢包。
- 诊断 Web RPC 必须带上认证：cookie `dsh-auth-<b64url(sha256(authority))>` 值为 `v1.<b64url(payload)>.<b64url(HMAC)>`，secret 在 `C:\Users\ik\.dsh\.credentials.yaml` 的 `client-connection/browser-session` 记录；`args` 必须是**单个普通对象**且键名匹配 descriptor（这里是 `agentId`）。
- 全量测试套件约 13 分钟（749s tests）；迭代时用 `pnpm vitest run tests/<file>` 单文件验证。
- **超时是客户端侧兜底，不是根治**：服务端 handler 仍会持续运行，但 mutating 调用因幂等性设计可安全重试。超时消息中的提示「服务端操作可能仍在进行，可稍后重试或重启 dsh web」正是基于此设计。
