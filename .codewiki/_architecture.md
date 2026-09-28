# dsh-git-worktree 系统总览

dsh-git-worktree 是 DeepSeek Harness 的 Git worktree 会话目标插件：让一个会话把代码改动隔离到受管 worktree（Isolated Checkout），在 Local Preview → 验收 → 交付 → 清理的生命周期中，绝不越权触碰用户的源仓库工作区。插件入口见 [[host-overview|Host Entry and Registration Surface]]。

## 三层结构

1. **宿主插件**（host 侧）：入口与注册面（src/index.ts、src/commands.ts、src/tools.ts）装配端口适配层（[[adapters|Adapter Layer]]）、核心状态机（[[session-checkout-module|Session Checkout State Machine]]）与执行引擎（[[session-checkout-apply|Session Checkout Apply Pipeline]]）。
2. **strict Typert RPC**：`gitWorktree` 服务的 24 个方法由 descriptors + zod strict schema 固定线缆契约（src/console-remote/），宿主实现为 WorktreeConsoleService（src/console-host/service.ts），控制面与投影见 [[console-host|Console Host Control Plane]]。
3. **客户端 UI**：Worktree 卡片/验收界面通过 RPC 读取 capabilities 与状态投影；用户独占破坏性动作（Finish/Discard/Remove），模型工具止步 Ready for Review。

## Checkout 状态机

phase 流转：preparing → ready → mutating（操作中）→ recovery_required → finalized → retained → discarded（applying 为废弃 v1 残留）。delivery 七态：working / ready_for_review / preview_active / preview_detached / finalized / retained / delivered。

关键流转：

- 创建：bindTarget/createIsolatedTarget → detached `git worktree add` → phase ready；creation evidence 先落 journal 再建目录，失败按 rolledBack 与否决定删除记录或 markRecoveryRequired。
- 验收：markReadyForReview（isolatedFingerprint CAS）→ reviewSlot（项目级验收互斥，同一 localRoot 同时只允许一个验收任务）→ preview（receipt-first：4 个内部 ref previews/<previewId>/… 先持久化才允许写 Local）→ 用户 finalize（commit + 可选 retention）或 rollback。
- 交付：finish（内部 preview→finalize；autoPush 尽力推送、绝不 force）→ finalized → cleanup（quarantine `.dsh-wt-cleanup--<id8>--<opId>` → remove → 空容器回收）→ delivered；retain_24h/retain_3d/retain_manual 由 15 分钟定时器到期清理。
- 迭代：beginNextIteration 复用前代 managedRoot 作为新 owner 会话的不可变 cwd（predecessorCheckoutId），iteration+1、baseOid 取 Local 当前 HEAD。
- 恢复：一切操作携带 expectedRevision/expectedReviewId/expectedGeneration CAS token（checkpointGenerationForRecord）；崩溃后 reconcile 按 journal step 收敛（checkpoint 可 recoverCheckpoint；preview receipt 未落盘可证明 Local 未被触碰）；Local 漂移 → preview_detached + WorktreePreviewRecoveryProof 五元组指纹证明。

## 客户端 boot 注册流

客户端装配时 import WORKTREE_CONSOLE_REMOTE（descriptors 贡献，src/console-remote/descriptors.ts:189）→ 调 `gitWorktree/clientBootReport` 上报（服务端记 ndjson 诊断）→ sidebarTopology/current/list 渲染卡片 → 按 capabilities 决定可点按钮；host-compat 探测 WorkspaceClientFlavor（legacy/alpha/next，src/host-compat.ts:7-12）决定 UI 行为开关，诊断随 sidebarTopology 上报。

## 持久化布局

- `<stateDir>/managed-checkouts.json`：唯一权威状态（AtomicJsonCheckoutRegistry，version 2，{revision, sessionBindings, managedCheckouts}）。
- `<stateDir>/project-skills`：项目技能存储；`<stateDir>/sidebar-diag.ndjson`：RPC 诊断。
- 受管 worktree：默认仓库旁 sibling 容器 `<repo>--worktrees`（避免污染 Local 的未跟踪列表）；配置 worktreesRoot 后在 `<root>/<project>/<topic>-<YYYYMMDD>`；身份路径候选 8/12/32 三档（src/session-checkout-module.ts:4013）。
