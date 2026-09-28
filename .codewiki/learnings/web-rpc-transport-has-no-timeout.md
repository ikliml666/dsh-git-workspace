---
title: "Web RPC 传输层全程无超时：一次『创建中…』永久卡死的根因"
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

## 教训

- 「服务端已完成 + 客户端无反应」的排查顺序：先看服务端持久化证据（注册表 journal、workspace.json、会话目录），再断言传输层丢包。
- 诊断 Web RPC 必须带上认证：cookie `dsh-auth-<b64url(sha256(authority))>` 值为 `v1.<b64url(payload)>.<b64url(HMAC)>`，secret 在 `C:\Users\ik\.dsh\.credentials.yaml` 的 `client-connection/browser-session` 记录；`args` 必须是**单个普通对象**且键名匹配 descriptor（这里是 `agentId`）。
- 全量测试套件约 13 分钟（749s tests）；迭代时用 `pnpm vitest run tests/<file>` 单文件验证。
