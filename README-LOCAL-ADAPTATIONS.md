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
