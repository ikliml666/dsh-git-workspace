# 仓库模式集

dsh-git-worktree 反复出现的横切模式。出处均为 文件:行号（相对仓库根）。Host↔Client 共享契约 src/console-contract.ts 是多数模式的地基。

## 1. Strict Typert 契约三层校验

- 第一层（契约）：src/console-contract.ts 全 JSON-only 共享（无 Cordis/React/Remote 依赖），注释明确 authority rule——会话/项目/owner/cwd/revision/review 一律以 Host 执行时校验为准。
- 第二层（传输）：Remote 适配器对每个返回强制 `descriptor.result.mode === 'strict'` + `schema.parse` 重解码（src/client/console-remote/adapter.ts:90-98），失败一律 `'malformed_response'`。
- 第三层（组件）：变更/导航前再次核验身份——三元身份 + capabilities（src/client/actions.ts:223-250）、创建后六项校验（src/client/target-console/WorktreeConsoleView.tsx:194-250）、冲突五元组（src/client/review-console/ReviewActions.tsx:280-286）。
- 读也 CAS：`ReviewDiffRequest` 绑定 expectedRevision+expectedReviewId（src/console-contract.ts:394-399），评审读与 Finalize 同一身份。

## 2. 错误码 meta 驱动 UI

- src/console-contract.ts:504-537 `ERROR_META` 用 `satisfies Record<code, {category, recovery, retryable}>` 静态穷举全部错误码；分类 permission/stale/confirmation/recovery/conflict/unavailable/invalid/internal 与恢复动作 none/refresh/confirm_dirty/open_recovery/retry 枚举在 :416-425。
- UI 不认识具体码：`errorText` 按 `worktreeConsoleErrorMeta(code).recovery` 附加下一步提示（src/client/target-console/WorktreeConsoleView.tsx:49-59）；错误条渲染 `error.category.*`/`error.recovery.*` 翻译键（src/client/review-console/ReviewActions.tsx:1180-1182）。
- stale 类错误触发自动重读而非报错（src/client/target-console/WorktreeConsoleView.tsx:186-192、TargetStatusAction.tsx 的 stale_target → refresh）。

## 3. sessionGeneration/isActive 代际守卫

- 会话/面板切换用递增 generation 让旧异步续体自动作废：src/client/target-console/WorktreeConsoleView.tsx:119-131（useLayoutEffect bump + isActive）；src/client/target-console/WorktreeReviewStatus.tsx:55-71（附 revision 单调不回退守卫 :64）；src/client/target-console/TargetStatusAction.tsx:49-54（渲染期 bump actionScope）；src/client/pre-session/PreSessionWorktreeToggle.tsx:47-53（scopeRef 换届，旧 prepare 续体不得导航/清空新草稿）。
- 轮询与缓存层同一思想：Poll 以 generation 快照守卫发布（src/client/target-console/current-polling.ts:56-72）、preflight 条目以 entry.generation 守卫（src/client/review-console/preflight-cache.ts:54-95）。

## 4. data-plugin 样式注入防误删

- DSH client-module 系统会"收养" head 中无 data-plugin 的 `<style>` 并在自身模块失效时删除（src/client/index.tsx:64-67 注释）。
- 插件样式因此自打所有权标签：`dataset.dshGitWorktree` / `dataset.plugin` / `dataset.pluginCss`（src/client/index.tsx:68-76），卸载按引用移除。
- 样式聚合用 `String.raw` 常量：src/client/styles.ts:3 `WORKTREE_STYLES` 内插 `REVIEW_CONSOLE_STYLES`（:143）；src/client/target-console/target-console.styles.ts:1、src/client/review-console/review-console.styles.ts:1 同构。

## 5. 客户端轮询缓存与单飞

- src/client/target-console/current-polling.ts:7-73 `WeakMap<adapter, Map<key, Poll>>` + 5s DELAY：首订阅者拉起定时器并监听刷新事件，末订阅者离开即清理；语言参与订阅键隔离翻译结果（:76-89）。
- :10 契约注释 "Display-only observation. Never used to authorize a mutation or Git cleanup."——轮询只驱动显示，授权走显式 preflight/inspect。
- 预检缓存 src/client/review-console/preflight-cache.ts:54-83 与 src/client/review-console/preview-recovery-cache.ts:60-131：`entry.promise` 单飞 + `force` 绕缓存（写前强制）+ generation 守卫发布。

## 6. Promise.race 超时看门狗

- Web RPC 载体无超时，卡死的 Host handler 会永久挂起调用 UI（src/client/console-remote/adapter.ts:41-46 注释：客户端侧失败、服务端继续跑、变更调用可安全重试）。
- `FAST_TIMEOUT_MS = 30_000` / `SLOW_TIMEOUT_MS = 180_000`（:47-48），`FAST_METHODS` 仅 7 个读方法（:49-52）。
- `invoke` 用 `Promise.race([call(locale), timer])`（:76-81）把超时折叠为错误码 `'timeout'` 的 Outcome（:54-65、:87-89），UI 按 `recovery: 'retry'` 呈现重试入口。
