# Wiki Index

## Decision

- [[decisions/client-rpc-watchdog-budget|Worktree Console RPC 适配器：超时看门狗与契约校验]]
- [[decisions/volatile-settings-live-config|volatile 设置字段与 LiveValue 运行时解包]]
- [[decisions/create-from-branch-is-base-only|隔离工作树创建与交付链路设计]]
- [[decisions/non-git-incremental-enablement|非 Git 目录渐进增强：显式确认下的 init + 首次提交，而非静默或死路]]
## Learning

- [[learnings/web-rpc-transport-has-no-timeout|Web RPC 传输层超时修复：从永久卡死到时中断]]
- [[learnings/git-spawn-budget-list-latency|git spawn 预算与 list 延迟]]
- [[learnings/host-rc-bump-breaks-exact-pin-peers|宿主 rc 升级会拒载精确钉版本的 dsh-* peer]]
- [[learnings/platform-gated-tests-win32|平台门控测试：win32 上跳过的 4 个用例均为有意设计]]
## Module

- [[modules/adapters|Adapters 适配层]]
- [[modules/client|Client 模块（浏览器端用户界面层）]]
- [[modules/console-host|Console 宿主机（console_host）模块]]
- [[modules/managed-worktree-path|Managed Worktree 路径命名模块]]
- [[modules/session-checkout|Session Checkout：交付引擎与模块状态机]]
- [[modules/session-target-context|Session Target 运行时上下文（session_target_context）]]
- [[modules/client-core/client-pre-session|client_pre_session]]
- [[modules/client-core/client-review-console|client_review_console]]
- [[modules/client-core/client-target-console|client_target_console]]
- [[modules/console-control-plane-and-services|console 控制平面与服务模块概览]]
- [[modules/console-remote|console_remote：Typert Remote 服务契约层]]
- [[modules/lib|lib — dsh-git-worktree 插件主源码]]
- [[modules/scripts|scripts]]
- [[modules/src|src]]
- [[modules/tests|tests]]
- [[modules/worktree-lifecycle-management-core|worktree_lifecycle_management_core 概览]]
- [[modules/shared-contracts-and-domain-ports|共享契约与领域端口模块]]
- [[modules/creation-failure|创建失败处理（creation_failure）]]
- [[modules/host-compat|宿主版本兼容（host_compat）]]
- [[modules/workspace-provider-lifecycle|工作区 Provider 生命周期]]
- [[modules/worktree-lifecycle-management-core-index|工作树生命周期管理核心入口（src/index.ts）]]
- [[modules/concurrency|并发与会话分支竞争防护（Concurrency）]]
- [[modules/build-and-configuration|构建与配置（build_and_configuration）]]
- [[modules/core-types-and-ports|核心类型与端口（core_types_and_ports）]]
- [[modules/project-foundation-and-localization|项目基础与本地化模块概览]]
