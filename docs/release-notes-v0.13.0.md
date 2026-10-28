# v0.13.0 发布说明（候选；待 clean Local 和 CI 验收）

本版将 DSH 开发基线从 `0.2.1-rc.3` 切换到 `0.2.1-rc.4`。本版完整包含 tag `v0.12.0` 的全部变更。

## 主要更新

- DSH devDependencies 精确锁定 `0.2.1-rc.4`（Cordis 4.0.5、loader 1.0.6、include 1.0.10、schemastery 3.18.5）；`minimumReleaseAgeExclude` 覆盖 rc.4 精确锁定依赖；核心 DSH peer 的 caret 范围 `^0.2.1-rc.1` 已天然覆盖 rc.4，locale peer 精确清单追加 `|| 0.2.1-rc.4`。
- **rc.4 是 rc.3 的纯版本号重发**：全部相关 `@deepseek-ai/dsh-*` 包逐文件 SHA-256 比对后，唯一差异是各包 `package.json` 版本字段与 `dsh-client-modules/lib/index.js` 里一个内嵌构建 commit 标记（`be72761` → `ec17a2c`，等长、无逻辑差异）。官方 Workspace Client 字节完全相同（232824 字节，SHA-256 `9c2c17a6…6544`），因此派生门禁只移动版本常量、SHA-256 常量保持原值；8 个必需文本接缝全部存活，装饰逻辑零改动。
- 修正发布门禁的过期方法表：`scripts/check-publish.mjs` 仍按 38 项 strict Remote 方法校验，而 `./remote` 早已因「回到 Local」能力暴露 `returnToLocal`（第 39 项）。该不一致继承自 `master` 基线（`git diff --stat master -- scripts/check-publish.mjs src/console-remote/ tests/console-remote.test.ts` 为空），本版一并修掉，门禁恢复通过并报告 39 项。

## 兼容与迁移

DSH 开发基线从 `0.2.1-rc.3` 切换到 `0.2.1-rc.4`；`0.1.x` Host 继续使用 `0.9.x` 插件线，其兼容记录不变。无 Worktree registry、Review 或 Recovery 数据迁移。受 `minimumReleaseAge` 供应链防护影响的环境请显式指定 `dsh-git-worktree@0.13.0` 安装。

## 验证状态（2026-10-28；发布前需 clean Local 和 CI）

源码基线在 Windows x64（Node 24.19.0、pnpm 12.5.1）完成 `0.2.1-rc.4` 适配验证：typecheck 0 诊断、build 通过（`lib/client.js` 1192.39 kB）、sidebar 版本/SHA 门禁与发布门禁通过、54 个测试文件 795 passed / 4 skipped、focused lifecycle 27 passed、接缝探针 `ALL 8 REQUIRED SEAMS OK`；仅为源码兼容验证，未验收真实浏览器、AI 对话、桌面或完整流程，详见 [0.2.1-rc.4 验证报告](compatibility/0.2.1-rc.4.md)。正式发布仍须 clean Local 门禁、推送精确 release commit 并等待 CI 成功，再创建 annotated tag 与 GitHub Release，并完成真实安装 smoke。

**npm 状态：尚未发布 `0.13.0`。**
