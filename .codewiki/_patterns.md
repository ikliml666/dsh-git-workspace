---
title: dsh-git-worktree 仓库反复出现的模式
type: pattern
source_files:
  - scripts/check-publish.mjs
  - scripts/check-workspace-sidebar-version.mjs
  - scripts/clean-lib.mjs
  - scripts/dev-dsh-lib.mjs
  - scripts/workspace-sidebar-upstream.mjs
  - scripts/workspace-sidebar-upstream-next.mjs
  - scripts/workspace-sidebar-upstream-alpha.mjs
  - src/index.ts
  - src/ports.ts
  - src/console-contract.ts
  - src/console-host/errors.ts
  - src/session-checkout-apply.ts
  - src/adapters/safe-file.ts
  - src/adapters/git.ts
  - src/adapters/registry.ts
  - lib/index.js
  - lib/console-host/errors.js
  - lib/adapters/safe-file.js
  - lib/console-remote/schemas.js
  - lib/workspace-provider-lifecycle.js
  - tests/dev-dsh.test.ts
  - tests/support/production-adapters.ts
  - tests/session-checkout-module.test.ts
  - tests/console-host.test.ts
  - tests/workspace-provider-lifecycle.test.ts
  - lib/adapters/files.js
  - lib/adapters/git.js
  - lib/adapters/registry.js
  - lib/client/workspace-sidebar/index.js
  - lib/index.d.ts
  - lib/ports.js
  - package.json
  - scripts/dev-dsh.mjs
  - src/adapters/git-options.ts
  - src/adapters/worktree-creation.ts
  - src/client/workspace-sidebar/index.tsx
  - src/console-remote/descriptors.ts
  - src/console-remote/schemas.ts
  - tests/adapters-safe-file.test.ts
  - tests/client-polling-diagnostic.test.tsx
  - tests/console-remote.test.ts
  - tests/support/worktree-console.ts
tags: [pattern, naming-convention, error-handling, build-test, directory-convention, fail-closed]
---

## Overview

基于 `scripts/`、`src/`、`lib/`、`tests/` 四个模块文章的源码证据，`dsh-git-worktree` 仓库在命名约定、错误处理风格、构建/测试流程与目录约定上反复出现若干跨层模式。这些模式贯穿构建期脚本、运行时插件主源码（src 与 lib 同构）、以及 Vitest 套件，是理解仓库一致性的关键。本文档逐节总结这些模式并给出具体文件/函数/行号作为证据。

## Patterns

### 1. 失败封闭（fail-closed）的校验与门禁风格

仓库在发布门禁、上游源码派生、CAS 写入、注册表读取等所有外部边界处均采用“失败即终止、绝不静默放行”的策略。

- `scripts/check-publish.mjs` 的 `fail(message)`（行 16）打印 `check-publish: FAIL: …` 后调用 `process.exit(1)`；7 个检查任一不通过即终止发布。
- `scripts/check-workspace-sidebar-version.mjs`（行 11–14）解析官方 locale 包并断言其 `version` 等于导出常量，不等即抛错。
- `scripts/workspace-sidebar-upstream.mjs` 的 `replaceExactlyOnce`（行 27–34）在 seam 缺失或多次出现时抛错，防止上游漂移被静默接受；`readOfficialWorkspaceClient`（行 11–25）断言版本与 SHA-256。
- `lib/adapters/registry.js` 的 `read()`（行 385–397）校验失败响亮抛 `registry_corrupt`；`tests/support/production-adapters.ts` 的 `AtomicJsonCheckoutRegistry.read()`（行 496–506）同语义。
- `src/adapters/git.ts` 的 `createDshGitPort` 中 `attachWorktreeBranch`（行 405–425）使用 `update-ref` CAS（行 411），旧值不匹配即失败。

### 2. 目录身份 + CAS 作为删除与并发写入安全边界

所有“删除受管目录”和“并发写引用”都以物理目录身份（device/inode/birthtimeNs）与修订/CAS 为前提，不依赖路径字符串猜测。

- `src/ports.ts` 定义 `DirectoryIdentity`（行 232–236）：`device`/`inode`/`birthtimeNs` 三元组。
- `lib/adapters/files.js` 的 `quarantineDirectoryTree`（行 54–74）身份不匹配时尽力搬回并抛 `checkout_mismatch`，绝不删除身份不符对象；`tests/support/production-adapters.ts` 的 `quarantineDirectoryTree`（行 93–113）同约束。
- `src/adapters/worktree-creation.ts` 的 `verifyIdentity`（行 126–148）拒绝任何 `.lock` 残留；`lib/adapters/git.js` 的 `createDshGitPort` 中 `removeWorktree`（行 337–347）先 `assertRemovable` 再删。
- CAS 修订推进：`tests/support/worktree-console.ts` 的 stateful fixture（行 518–532）要求 `expectedRevision` 匹配，否则返 `stale_target`；`tests/console-host.test.ts` 的 `plane` 组装控制面并用 `registry(record)`（行 81–86）验证修订。

### 3. 崩溃安全 JSON 与原子写（tmp + rename + .bak）

持久化注册表与配置均经“唯一临时文件 + 原子 rename + 备份”模式，避免半写与并发互踩。

- `src/adapters/safe-file.ts` 的 `writeJsonFileAtomic`（行 82–100）写 tmp → rename，先拷 `.bak`；`readJsonFileSafe`（行 113–161）三级回退：主文件 → 最新 `.tmp` 提升 → `.bak` 恢复。
- `lib/adapters/safe-file.js` 的 `writeJsonFileAtomic`（行 79–95）与 `readJsonFileSafe`（行 106–154）同实现；`tmpPathFor`（行 46–48）用 `<file>.<pid>.<uuid>.tmp` 防止并发互踩。
- `src/adapters/registry.ts` 的 `AtomicJsonCheckoutRegistry`（行 397–415）`write()` 经 `writeJsonFileAtomic`；`lib/adapters/registry.js` 同。
- `tests/adapters-safe-file.test.ts`（行 19–73）断言 tmp 晋升、bak 恢复与损坏清空。

### 4. 上游官方客户端派生的版本/SHA-256 钉扎与精确字符串 seam

构建期从钉扎的 `@deepseek-ai/dsh-client-ui-workspace[-next|-alpha]` 读取源码，经版本 + SHA-256 门禁后用精确字符串替换注入受管 Worktree 控制。

- `scripts/workspace-sidebar-upstream.mjs`：`WORKSPACE_UI_VERSION`/`WORKSPACE_CLIENT_SHA256`（行 5–7）、`readOfficialWorkspaceClient`（行 11–25）、`decorateOfficialWorkspaceClient`（行 49–174）。
- `scripts/workspace-sidebar-upstream-next.mjs`：`NEXT_WORKSPACE_VERSION`/`NEXT_WORKSPACE_SHA256`（行 5–6）、`once` 替换器（行 23–29）。
- `scripts/workspace-sidebar-upstream-alpha.mjs`：`ALPHA_WORKSPACE_VERSION`/`ALPHA_WORKSPACE_SHA256`（行 6–7）、`decorateAlphaWorkspaceClient`（行 33–100）。
- `scripts/check-workspace-sidebar-version.mjs`（行 15–18）在发布前重校三派生的版本 + SHA-256。

### 5. 严格 Typert / Zod schema 与旧 Host 兼容的缺省 false 能力位

Console 远程契约使用 strict codec，且新增能力位必须用 `.default(false)` 而非 `optional()`，以容忍独立部署的旧 Host。

- `src/console-remote/schemas.ts` 的 `capabilitiesSchema`（行 84–106）中 `returnToLocal` 用 `.default(false)`（注释 100–105）。
- `lib/console-remote/schemas.js` 的 `capabilitiesSchema`（行 54–76）同约束（注释 70–75）。
- `src/console-remote/descriptors.ts` 的 `strictCodec`（行 52–56）同时挂 legacy `schema` 与 0.2 的 `create()`。
- `tests/console-remote.test.ts`（行 215）断言旧 Host 缺 `returnToLocal` 时客户端不塌。

### 6. 构建前清场与发布门禁串联（npm scripts 驱动）

构建与发布由 `package.json` 的 npm scripts 显式编排，构建前强制清 `lib/`，发布前跑多道门禁。

- `scripts/clean-lib.mjs`（行 1–7）`rmSync('../lib/', {recursive:true, force:true})`，由 `package.json` 的 `build`（行 71）调用。
- `package.json` 的 `check:publish`/`check:publish:release`/`check:sidebar-version`（行 75–77）与 `prepublishOnly`（行 82）串联 `check-publish.mjs` 与 `check-workspace-sidebar-version.mjs`。
- `scripts/dev-dsh.mjs` 主流程（行 46–98）经 `dev-dsh-lib.mjs` 的 `installLocalSnapshot`（行 466–528）打包 `dsh-git-worktree-<snapshotId>.tgz`（版本号带 `-dev.<snapshotId>` 后缀）并 `plugin add`。

### 7. src 与 lib 同构的目录/文件命名约定

`src/` 为 TS 源码、`lib/` 为编译产出，二者保持完全镜像的目录层级与文件名（仅扩展名 `.ts`↔`.js`/`.d.ts`）。

- `src/index.ts` ↔ `lib/index.js` + `lib/index.d.ts`：`inject`（src 行 253 / lib 行 46）、`Config`（src 行 261–319 / lib 行 53–111）、`apply`（src 行 358–459 / lib 行 136–230）。
- `src/adapters/git.ts` ↔ `lib/adapters/git.js`：`runGit`、`createDshGitPort` 行号与签名一致。
- `src/console-host/errors.ts` ↔ `lib/console-host/errors.js`：`consoleFailure` 均原样透出第三方错误文本（src 行 13–41 / lib 行 6–32）。
- `src/client/workspace-sidebar/index.tsx` ↔ `lib/client/workspace-sidebar/index.js`：`registerManagedWorkspaceSidebar`/`registerDecoratedWorkspaceSidebar` 同 seat 约束。

### 8. volatile 配置经 LiveValue 实时读取

设置页可热改的配置字段标记为 volatile，运行时每次调用经 `liveConfigValue` 或 `volatile()` 解包实时读取，避免重启插件。

- `src/index.ts` 的 `volatile<T>()`（行 256–259）打 `meta.volatile`；`Config` 中 `gitTimeoutMs`/`worktreeAddTimeoutMs`/`autoDeliver` 等支持 volatile（行 268–318）。
- `lib/index.js` 的 `volatile(schema)`（行 48–52）与 `Config`（行 53–111）同。
- `src/ports.ts` 的 `liveConfigValue`（行 560–565）统一读 `LiveValue` 或普通值；`lib/ports.js` 的 `liveConfigValue`（行 10–15）同实现。
- `src/adapters/git-options.ts` 的 `gitTimeoutMs`（行 21–27）注释：volatile 值每次调用实时读。

### 9. 测试套件把回归写进测试注释并复用共享假体

测试以 `tests/support/` 为基座，确定性假实现记录每次调用，且几乎每个测试注明其防住的 bug（Issue #6、分支标签丢失等）。

- `tests/support/worktree-console.ts` 的 `createWorktreeConsoleAdapterFixture`（行 124–534）记录 `calls: WorktreeConsoleFixtureCall[]`；stateful 模式（行 518–532）实现 CAS。
- `tests/support/production-adapters.ts` 的 `createNodeSessionCheckoutDependencies`（行 514–775）装配真实 Node git/files 端口。
- `tests/session-checkout-module.test.ts`（行 350 起）逐测试标注回归：delivered 后 runtime 不声称已删 cwd（行 1095）、v1→v2 迁移（行 2652）等。
- `tests/client-polling-diagnostic.test.tsx`（行 2 注释 Issue #6）断言 30s 内 `current` 只发 1 次共享请求。
- `tests/workspace-provider-lifecycle.test.ts`（行 103–309）29 个场景断言选举归属与补丁文件无 `!!js`/`disabled:`。

### 10. Workspace Provider 选举默认让位、显式 opt-in 接管

官方 Workspace 客户端接管默认关闭，仅当 `enableWorkspaceProvider === true` 且 flavor 非 unsupported 时才接管，否则让位官方客户端。

- `src/index.ts` 的 `Config.enableWorkspaceProvider`（行 318，默认 false）。
- `lib/index.js` 同字段（行 110，默认 false）。
- `lib/workspace-provider-lifecycle.js` 的 `mountWorkspaceProviderLifecycle`（行 44–293）：未开启或 unsupported 直接返回 `{officialWorkspaceActive:true}`（行 55–62）。
- `tests/workspace-provider-lifecycle.test.ts`（行 124–134）断言 takeover 需显式 opt-in 且 modern host 上非 advisory。
