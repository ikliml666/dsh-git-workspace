# v0.12.0 发布说明（候选；待 clean Local 和 CI 验收）

本版将 DSH 开发基线从 `0.2.1-rc.2` 切换到 `0.2.1-rc.3`，并新增 Git 标签管理与三项分支/胶囊体验优化。本版完整包含 tag `v0.11.0` 的全部变更。

## 主要更新

- DSH devDependencies 精确锁定 `0.2.1-rc.3`（Cordis 4.0.5、loader 1.0.6、include 1.0.10、schemastery 3.18.5）；官方 Workspace Browser 派生门禁的版本与编译后 Client SHA-256 同步对齐 rc.3（`9c2c17a6…6544`，232824 字节），locale peer 精确清单追加 `|| 0.2.1-rc.3`。核心 DSH peer 的 caret 范围 `^0.2.1-rc.1` 已天然覆盖 rc.3，无需改写。
- rc.2→rc.3 的官方源码差异集中在 Workspace Client 的预会话草稿语义（`whenDraftExists` 取代 `clearPreviousDraft`、空白 Session 复用按 `agentPreset` 过滤、`openWorkspaceSession` 分支并入 `openWorkspace`），插件装饰依赖的 9 个文本接缝全部存活，装饰逻辑零改动；插件未调用受影响的新签名。
- Git 标签管理（target-console）：分支菜单新增「管理标签」入口，支持列出本地标签、创建轻量/附注标签、可选同步推送、单独推送未推送标签，删除前二次确认并可同时删除 `origin` 同名标签。新增 Remote 方法 `gitListTags` / `gitCreateTag` / `gitDeleteTag` / `gitPushTag`，发布门禁方法面同步为 38 项。图谱区分标签与分支并把标签徽章以绿色 `⌗` 前缀渲染，可在任意提交上打标签；`ls-remote` 失败时推送状态记为未知而非误报未推送。
- 分支弹层支持搜索：超过 12 条分支时显示搜索框，回车切换首个匹配，关闭菜单自动清空。
- 分支切换成功反馈：确认后在胶囊上显示约 900ms 的「已切换到 <分支>」提示。
- WorktreeHeroChip 定位优化：以 DOM 结构解析加 MutationObserver 替代固定 250ms×40 轮询，hero 行出现即挂载胶囊。

## 兼容与迁移

DSH 开发基线从 `0.2.1-rc.2` 切换到 `0.2.1-rc.3`；`0.1.x` Host 继续使用 `0.9.x` 插件线，其兼容记录不变。无 Worktree registry、Review 或 Recovery 数据迁移。`minimumReleaseAgeExclude` 已覆盖 `0.2.1-rc.3` 精确锁定依赖；受 `minimumReleaseAge` 供应链防护影响的环境请显式指定 `dsh-git-worktree@0.12.0` 安装。

## 验证状态（2026-10-24；发布前需 clean Local 和 CI）

源码基线在 Windows x64（Node 24.19.0、pnpm 12.5.1）完成 `0.2.1-rc.3` 适配验证：typecheck 0 诊断、build 通过、sidebar 版本/SHA 门禁与发布门禁通过，52 个测试文件 722 passed、4 skipped，focused lifecycle 27 passed；仅为源码兼容验证，未验收真实浏览器、AI 对话、桌面或完整流程，详见 [0.2.1-rc.3 验证报告](compatibility/0.2.1-rc.3.md)。正式发布仍须 clean Local 门禁、推送精确 release commit 并等待 CI 成功，再创建 annotated tag 与 GitHub Release，并完成真实安装 smoke。

**npm 状态：尚未发布 `0.12.0`。**
