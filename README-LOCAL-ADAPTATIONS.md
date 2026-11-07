# dsh-git-worktree 本地适配版（0.9.3-local.1）

基于上游 [wloops/dsh-git-worktree](https://github.com/wloops/dsh-git-worktree) `0.9.3`（a0435fa）的本地定制分支 `feat/local-adaptation-20260926`，按个人 Git 工作流调整。上游合并时以本文件所列取舍为准。

## 四项适配

### 1. 自动验收（agent 完成即自合）

上游验收流是 `worktree_ready_for_review` → 人工在 Workspace 预览 → 人工确认保存；本地哲学是 **agent 完成即自合**，不需要人工闸门。

- 新增模型工具 `worktree_deliver`（参数 `commitMessage?` / `retention?` 默认 `cleanup` / `report?`）：
  - `working` 状态：直接 `finish`，必须显式给 `commitMessage`；
  - `ready_for_review` 状态：缺省沿用 Review 建议的提交信息，并锁定 `expectedReviewId` 防竞态；
  - 复用 `module.operate({action:'finish'})` 的全部校验（expectedRevision、ownerSessionId、cleanupReason），只是不再要求人坐在预览前。
- 新配置 `autoDeliver`（默认 `true`）：working 态的运行时提示直接引导 agent 调用 `worktree_deliver`，跳过 ready_for_review 展示步骤。

### 2. 统一 worktree 根目录 + 主题命名

上游把 worktree 建在仓库同级 `<repo>--worktrees/` 或状态目录下，以 checkoutId 命名。本地统一收纳到：

```
E:\ik\Documents\trae_projects\worktrae\<项目>\<主题>-<YYYYMMDD>
```

- 新配置 `worktreesRoot`：设置后候选路径改为 `<worktreesRoot>/<repoKey|repoLabel>/…`；未设置时完全保持上游行为。
- `worktree_create` 新增可选 `topic`：参与目录命名 `sanitize(topic)-<YYYYMMDD>`（候选冲突时追加短 ID）。不提供主题时仍按仓库名命名。

### 3. 长超时

上游 `0.9.3` 已修复（gitTimeoutMs 默认 120s、worktree add 默认 300s，上限 1h），本地无需改动，仅在文档确认。

### 4. Workspace 接管显式 opt-in（规避“无法开启新对话”）

上游启用插件即接管官方 ui-workspace（`worktreeWorkspaceProvider` 服务存在 ⇒ patch 禁用官方条目）；任何接管失配都会让新对话的 Workspace 条目全部 pending。本地改为：

- 新配置 `enableWorkspaceProvider`（**默认 `false`**）：`mountWorkspaceProviderLifecycle` 开头检查 `options.enabled`，未显式开启时不提供接管服务，官方 ui-workspace 保持启用，Worktree 的 6 个模型工具与 `/worktree` 命令照常可用。
- 若确需受管 Workspace，显式设 `enableWorkspaceProvider: true` 并重启 DSH（patch 条件在 Loader 启动时求值）。

### 5. 以官方 Worktree 为底座（不再接管）

官方 `@deepseek-ai/dsh-experimental-forge-bundle` 会插入三条与工作树有关的条目：`worktree`（宿主 `worktrees` 服务）、`tool-worktree`（官方 `create_worktree` 工具）、`forge-worktree`（面板隔离组里的第二个服务实例）。这三条**全部保持启用**，全机只有官方一份 `git worktree add` 实现。

- **建树入口**：`worktree_create` 内部调宿主 `worktrees.create(agent, { name, from })`，目录由官方决定（`<repo>/.agents/worktrees/<branch>`）；官方 `create_worktree` 工具同样可用。两者建出的 checkout 都会由本插件登记成 `ready` 记录并建立 isolated binding，随后由本插件承担台账、交付、清理、恢复；改动查看与评论交给官方 forge 的 `ChangesTab` / `ForgeTab`。
- **登记的落点**：`registerOfficialWorktree()` 读一次 `git.inspect(path)` 拿真实 root/commonDir/gitDir/headRef，写成 `ManagedCheckoutRecord`；不猜测路径布局。
- **幂等**：官方每条请求都真的跑一次 `git worktree add`，所以 `createOfficialTarget` 在本会话已有未放弃的 isolated 记录时直接复用，避免留下第二棵没人认领的树。
- **分支名**：`feat/sess-<session>[--<topic>]` 候选逐个探空位（`resolveLocalBranchTip`），全被占用时明确报错，不拼随机后缀。
- **没有「预建树」**：官方 `worktrees.create` 必须传 live Agent，而「给还没启动的会话先建好树」拿不到 Agent。这个能力连同它的 UI（新建对话时的 Worktree 开关、会话内控制台的分支选择器与创建按钮）一起删除了。
- **`restore` 不由本插件提供**：官方条目的 `restore` 照常可用；本插件没有「原地重建已交付目录」的操作，续作走 `begin_next_iteration`。
- **会话走进去就登记**：官方 `create_worktree` 与 forge 面板建的树只存在于磁盘上。监听 `session/event` 的 `working-directory/change` —— 官方 `worktrees.create` 的最后一步是 `workingDirectory.set` —— 一旦 cwd 落在 `<repo>/.agents/worktrees/` 下且该会话还没有 binding，就把这棵树记为 `ready` 并建立 isolated binding。之后 `worktree_list` / `worktree_deliver` / `worktree_cleanup` 对它们一样有效。事件驱动而非轮询：不用为每个项目起 `git worktree list` 子进程。
- **台账里的分支是完整 ref**：`sessionBranch` 存 `refs/heads/...`，与 `attachSessionBranch` 写出的 `branchRef` 同形。交付时会拿 `git symbolic-ref HEAD` 的完整 ref 直接比对（`src/session-checkout-apply.ts:1555`），存短名会让交付误判成「HEAD 不在会话分支上」。
- **「新建工作树」收进目标胶囊**：官方 forge 面板在 `conversation.hero.options` 里注册的那对控件（`forge-panel.worktree`：分支按钮 + 「新建工作树」复选框）由本插件以 `priority: -1` 在同 id 上注册空组件盖掉——slot 只渲染 priority 最低的那条，于是那对控件整个让位，而 forge 的其余能力（变更请求、diff、review）不受影响。取代它的入口在 `🖥 <分支> ⌄` 胶囊菜单里，且只在 `state === 'local'` 时出现。
- **建树时机与官方一致**：点了菜单项只是往 session log 写一条 plugin record（`plugin:dsh-git-worktree/worktree-request`），真正的建树发生在 `agent/pre-step` 的第 1 步——勾选即建等于为用户还没打算发的消息付一次完整 checkout 的代价。请求存在 log 里而不是内存里，所以刷新页面、重启 Host 之后仍然有效。
- **建树失败不吞消息**：`inbox.claim()` 在 `agent/pre-step` 之前就执行，失败时那批消息已经离开队列，必须 `agent.inbox.prepend` 按逆序还回去，否则用户的消息凭空消失；请求保留，原因修好后重发即会重试。
- **交付入口在胶囊里**：评审状态条删掉后，交付落在 `🖥 <分支> ⌄` 菜单的「交付到会话分支」——填提交信息、确认，走 `deliver` RPC。它和 `finalize` 只差一条：不要求 `expectedReviewId`，所以会话停在 `working` 也能交付（`/worktree finalize` 那条老命令仍要求 `ready_for_review`，只留给脚本）。
- **评审 UI 不再自建**：`src/client/review-console/`（2615 行）、`WorktreeReviewRow`、验收状态条与 `worktree_ready_for_review` 工具都已删除。官方 `client-ui-forge` 自带 `ChangesTab`（本地改动或变更请求的 diff）、`ForgeTab`、`DiffFile`（统一/并排）、`ReviewComposer`、`SubmitReview`、`ChangedFiles`，同一件事不做两遍。`worktree_deliver` 本来就允许 `working` 直接交付（只有 `ready_for_review` 才要求带 `expectedReviewId`），所以交付路径不受影响。

## 配置示例（profile cordis.patch.yml / 插件配置）

```yaml
autoDeliver: true          # 引导 agent 用 worktree_deliver 自动验收
autoPush: true             # finish 后 best-effort git push 当前分支（绝不 --force）
worktreesRoot: E:\ik\Documents\trae_projects\worktrae
enableWorkspaceProvider: false
```

## 自动推送语义

`finish` 提交成功后，若 `autoPush` 开启：解析 Local 当前分支 → 查 `@{upstream}` → `git push <branch>`。无本地分支/无上游/推送失败都只把 `push` 结果（`pushed`/`skipped`/`failed` + message）附在完成输出里，绝不阻断验收，绝不强制推送。

## 安装方式（重要：必须用 link: 依赖，禁止原地覆盖 node_modules）

本插件的真源是本仓库；安装进 profile（`C:\Users\ik\.dsh\profiles\web`）用 **link: 依赖**，让 Market 的任何 `pnpm install` 都只重建符号链接、不会把本地版还原成 registry 版（曾因原地覆盖 node_modules 被 Market 更新触发的 install 还原为 stock 0.9.3）：

1. profile `package.json`：`"dsh-git-worktree": "link:E:/ik/Documents/trae_projects/1/dsh plugin/dsh-git-worktree"`
2. profile `pnpm-workspace.yaml` 加兜底（防 Market 改写 package.json 版本号）：
   ```yaml
   overrides:
     dsh-git-worktree: link:E:/ik/Documents/trae_projects/1/dsh plugin/dsh-git-worktree
   ```
3. 用宿主捆绑 pnpm 执行 `node E:\software\deepseek-harness\node_modules\.pnpm\pnpm@11.7.0\node_modules\pnpm\dist\pnpm.mjs install`（profile 目录下），重启 DSH 生效。运行时依赖从本仓库自身的 node_modules 解析，因此仓库里 pnpm install 过的 node_modules 必须保留。

迭代流程：改 `src/` → 仓库内 `pnpm run build` → 重启 DSH，无需重装。**不要在 Market 里对 dsh-git-worktree 点更新。**

注意：profile 的 pnpm 11 默认 `minimumReleaseAge`（1440min 冷静期）会对整个 lockfile 做策略校验，Market 引入的过新版本会卡住一切 install，需按 profile 惯例在 `minimumReleaseAgeExclude` 逐版本追加豁免（如 `dsh-git-worktree@0.9.3`）。

## 本地提交

- 分支 `feat/local-adaptation-20260926`（基于 v0.9.3 后 compat 修复 a0435fa）
- 测试：`pnpm test`（含新增 managed-worktree-path 主题命名 4 例、surface worktree_deliver 2 例、lifecycle opt-in 1 例）
