# Harness compatibility / Harness 兼容性

[中文](#中文) · [English](#english)

## 中文

**兼容性描述的是插件版本与 Harness 运行环境的组合，不是“只有最新 DSH 才能用”。** 新增一个版本的测试记录不会撤销旧组合的支持；未验证也不等于不兼容。

### 验证矩阵（2026-09-11）

| 插件 | Harness | 证据与范围 |
| --- | --- | --- |
| `0.8.0` | `0.1.2-rc.1` | 当时的开发/构建基线。typecheck、build、30 个测试文件通过（431 passed、2 skipped），含 Session Target、Review、Recovery、Local 写入保护回归。本轮未重做此组合的真实浏览器全流程。 |
| `0.8.0` | `0.1.5-rc.1` | 用户报告可用；隔离官方 Profile 安装和配置组合成功。Host 的 231 个 DSH 包均为 rc.1；关键动态导入、strict Typert 正常调用/非法输入拒绝通过；以新 Host 包运行的 39 项 Remote、Workspace provider 生命周期和工具表面测试通过。真实 Web 到达首次引导，但本轮未完成引导后的界面与会话端到端验收，故为**部分验证**，不是已知不兼容。 |
| `0.8.0` | `0.1.5-rc.2`、`0.1.5-alpha.*` | 本轮未验证，不声明兼容或不兼容。 |
| `0.7.4`、`0.7.5` | `0.1.2-rc.1` | 历史修复针对的组合：分别修复 Workspace/Conversation 启动环和插件启停 provider 协调。见 CHANGELOG；不是本轮对历史版本的重新测试。 |
| `0.7.3` | `0.1.2-rc.1` | 已知可能出现 Workspace/Conversation 启动循环依赖，修复始于 `0.7.4`。 |
| `0.7.2` 及更早 | `0.1.2-rc.1` | 使用已移除的 `dsh-client-runtime`，不适用于此 Host 包线。这不意味着这些插件在原来的旧 Host 上也不可用。 |

没有逐项验证的中间版本不能由两端版本推导为连续兼容范围。当前正常工作的已验证旧组合不需要因为上游发布新版而被强制替换。

### Issue #9 后续检查（2026-09-25；插件 0.9.3）

插件 `0.9.3` 在 strict Remote codec 中同时保留旧版 `schema` 和新版 `create()`；Client 会话切换优先使用新版 `uiWorkspace.openSession`，旧版回退到 `sessions.open`；新版选中会话读取唯一的 `retainedBy.mainView`，冲突则拒绝危险操作。官方 Workspace Browser 已分别从 rc.1、`0.1.6-alpha.2` 和 `0.1.7-rc.2` 精确版本/SHA 派生，按 Host 实际解析的 `dsh-agent` 包版本只注册一个 Slot 树；未知版本保留官方 Workspace，不猜测来源。受管会话/工作区在新版派生中屏蔽危险行操作、保留状态标记。**构建和单元测试不是新版 Host 的浏览器验收。**

| Harness | 当前状态 |
| --- | --- |
| `0.1.2-rc.1` | 锁定依赖的构建和测试基线；以上新增回归可运行。 |
| `0.1.5-rc.3` | npm `latest` 标签（本次检查）；尚未用独立 Profile 联调，不声明支持。 |
| `0.1.6-alpha.2` | 已完成对应官方 Browser 的精确派生、strict codec 和新版导航/会话选择适配，通过本地构建与源码结构回归；**尚未在隔离 Profile 启动、渲染或完成创建/切换联调，不声明运行时兼容**。 |
| `0.1.7-rc.2` | 对应官方 Browser 精确派生。以源码 Host 在全新隔离 `DSH_HOME` 完成 Profile 首次/重复无豁免安装、配置 smoke 和 Web 启动；真实浏览器完成页面渲染、Worktree 开关、一次性仓库的预会话创建与草稿迁移、受管侧栏「进行中」标记及刷新后恢复选中。**未配置 API Key，未验收 AI 对话、Review/恢复/清理全流程；不声明完整运行时兼容。** |

隔离联调命令见 [本地开发](USAGE.md#本地开发)。源码 Host 的 `sessions.create()` 仅登记目标身份；本轮真实创建曾因立刻借用未 retain 的 binding 而自动回滚，现经官方 `sessions.using()` 持有目标引用、完成草稿迁移与导航后复测通过。下一步仍需在 alpha.2 独立 Profile、配置好 API Key 的测试环境验证真实对话与 Worktree 生命周期；未知上游版本不会自动使用任何派生 Browser。

### 0.2.0-rc.2 适配（2026-09-30；插件 0.10.0）

插件 `0.10.0` 将 DSH peers 与开发依赖整体切换到 `0.2.0-rc.2`（精确版本），官方 Workspace Browser 派生门禁从 rc.1 换为 0.2.0-rc.2（版本/SHA-256 双门禁），保留 `0.1.6-alpha.2`、`0.1.7-rc.2` 两个旧代派生；运行时仍按 Host 解析的 `dsh-agent` 版本只选择一个派生。本轮修复：`remote.directoryPicker` 注入环导致的 Web 启动死锁、strict codec 缺失 `modern` flavor、四条派生 seam 与 `IconBranchOutlineRegular` 图标命名对齐 0.2.0。

| 验证项 | 结果 |
| --- | --- |
| 隔离 `DSH_HOME` + 源码 Host（`dsh-v0.2.0-rc.2`）dev 安装（typecheck/build/pack/profile install） | 通过，多次重复 |
| Web 启动 | 全部条目激活（修复前 12 条目 pending、插件卡 loading） |
| 真实 Chromium（自动化驱动） | 页面渲染、会话创建、侧栏列表 |
| Worktree 开关 → 确认 → 预会话创建 | Worktree 实际创建，托管行带「进行中」标记（`data-managed-worktree`），无渲染错误 |
| 单元/类型 | typecheck 通过；40 个测试文件 552 passed / 1 skipped |

**未验收（不声明完整运行时兼容）**：API Key 配置下的真实 AI 对话；Review/预览/交付/回滚/恢复/清理全流程；Windows；npm 安装版 Host（本轮仅源码 runner）；桌面端。插件 peers 精确锁定 `0.2.0-rc.2`：0.1.x Host 不在 0.10.0 目标内，0.1.x 用户继续使用 0.9.x 插件线（其对 0.1.x 的支持记录见上节，不因本节而撤销）。

### 0.2.1-rc.2 适配（插件 0.11.0；发布前源码兼容验证）

插件 `0.11.0` 已发布到 npm，DSH peers 与开发依赖精确锁定 `0.2.1-rc.2`。该版本不需要 Worktree registry、Review 或 Recovery 数据迁移；历史组合的支持记录不变。

以下为发布前、包版本仍为 `0.10.1` 时的源码兼容验证记录，不代表对最终 `0.11.0` 发布包重新进行了测试或全流程验收。全新项目内隔离安装后，typecheck、build、sidebar 版本/SHA 门禁、发布检查均通过；43 个测试文件 **607 passed / 1 skipped**，其中真实 Cordis Loader/Web registry 生命周期 **24 passed**。本轮修复 live disable 后官方 Provider 未恢复及 replacement 激活失败后的双 Provider：显式释放 marker、等待禁用 fiber、通过公开 `entry.init()` 替换已销毁引用，并按身份撤回失败/禁用的 replacement 引用。配置不持久化，启动仍不等待选举，保留超时和在途保护。

**该验证仅覆盖源码兼容性**：验证期间未启动正式/隔离 DSH Profile，未完成 `0.2.1-rc.2` 浏览器、真实 AI、桌面或 Windows 全流程；旧版本的浏览器证据不可转用为新版本验收。唯一 skipped 是 Windows 专用长路径测试。确切命令、根因和审查入口见 [0.2.1-rc.2 报告](compatibility/0.2.1-rc.2.md)，机器结果见 [JSON](compatibility/0.2.1-rc.2-validation.json)。

### 0.2.1-rc.3 适配（插件 0.12.0；源码兼容验证）

插件 `0.12.0` 将 DSH 开发依赖精确锁定到 `0.2.1-rc.3`（核心 peer 的 caret 范围 `^0.2.1-rc.1` 已覆盖该版本，locale peer 精确清单追加 `|| 0.2.1-rc.3`），官方 Workspace Browser 派生门禁的版本与编译后 Client SHA-256 同步对齐（`9c2c17a66a5c20de00ac2852cb76debb5237439e97f877403bcaa2a471086544`，232824 字节）。该版本不需要 Worktree registry、Review 或 Recovery 数据迁移；历史组合的支持记录不变。

`0.2.1-rc.2 → 0.2.1-rc.3` 的实际源码差异集中在官方 Workspace Client 的预会话草稿语义：`whenDraftExists`（`"replace" | "keep"`）取代原来的 `clearPreviousDraft` 布尔、空白 Session 复用按 `agentPreset` 投影值过滤、`openWorkspaceSession` 的预会话分支并入 `openWorkspace`。插件装饰依赖的 9 个文本接缝全部存活（`__dshGitWorktreeManagedGuard`、`dshGitWorktree.managed`、`dshGitWorktree.state.working`、`managedWorktreeDecoration`、`ManagedWorktreeIdentity`、`__dshGitWorktreeProtected`、`__dshGitWorktree`、`data-managed-worktree` 均进入派生产物；`visibleSessionMenuItems` 标记在 rc.2 与 rc.3 都不存在，其所在接缝为可选，两代行为一致），装饰逻辑本身无需改动。插件未调用受影响的新签名，`agentPreset` 仍按既有 Host 默认路径透传。

| 验证项 | 结果 |
| --- | --- |
| 平台 | Windows x64，Node 24.19.0，pnpm 12.5.1 |
| 依赖解析 | Cordis 4.0.5、cordis-plugin-loader 1.0.6、cordis-plugin-include 1.0.10、schemastery 3.18.5、全部 `@deepseek-ai/dsh-*` 为 0.2.1-rc.3；TypeScript 5.9.3 / Vitest 2.1.9 / tsdown 0.17.4 |
| `typecheck` | 通过，0 诊断 |
| `build` | 通过，`lib/client.js` 1154.72 kB |
| `check:sidebar-version` | 通过：ui-workspace 0.2.1-rc.3 + 0.1.6-alpha.2 + 0.1.7-rc.2 三路 SHA-256，locale 0.2.1-rc.3 |
| `check:publish` | 通过：13 Host singleton、12 导出目标、38 项 strict Remote 方法、挂载补丁、NOTICE 与浏览器 ModuleLoader/惰性 directory-picker |
| `pnpm test` | 52 个测试文件 **722 passed / 4 skipped**，无失败 |
| focused lifecycle | `tests/workspace-provider-lifecycle.test.ts` 27 passed |

**仅源码兼容验证**：本轮未启动正式或隔离 DSH Profile，未完成 `0.2.1-rc.3` 浏览器渲染与交互、API Key 下的真实 AI 对话、Review/预览/交付/回滚/恢复/清理全流程、桌面端与 Windows 端到端验收。旧版本的浏览器与运行时证据不可转用为本组合的验收证据。4 个 skipped 均为平台条件跳过（`tests/git-unborn.test.ts:72`、`tests/session-checkout-apply.test.ts:1225`、`:1241`、`tests/project-skills.test.ts:88` 为非 Windows 专用用例），`tests/git-unborn.test.ts:253` 的 Windows 长路径用例在本轮平台实际执行而非跳过。详见 [0.2.1-rc.3 报告](compatibility/0.2.1-rc.3.md)。

### 0.2.1-rc.4 适配（插件 0.13.0；源码兼容验证）

插件 `0.13.0` 将 DSH 开发依赖精确锁定到 `0.2.1-rc.4`（核心 peer 的 caret 范围 `^0.2.1-rc.1` 已覆盖该版本，locale peer 精确清单追加 `|| 0.2.1-rc.4`），官方 Workspace Browser 派生门禁的版本常量同步对齐 rc.4。**rc.4 相对 rc.3 是纯版本号重发**：把全部 `@deepseek-ai/dsh-*` 包逐文件按 SHA-256 与仓库已装的 rc.3 比对，唯一差异是各包 `package.json` 的版本字段，以及 `@deepseek-ai/dsh-client-modules/lib/index.js` 里一个内嵌构建 commit 标记（`be72761` → `ec17a2c`，等长 42376 字节、无逻辑差异）。官方 Workspace Client 在 rc.3 与 rc.4 之间**字节完全相同**（232824 字节，SHA-256 `9c2c17a66a5c20de00ac2852cb76debb5237439e97f877403bcaa2a471086544`），因此门禁只移动版本常量、SHA-256 常量保持原值——这是一个真检查而非假设：若产物有变，构建会当场被门禁拒绝。

8 个必需文本接缝全部进入派生产物，装饰逻辑零改动；`visibleSessionMenuItems` 在上游任何一代都不存在，它由插件自身装饰引入，其 `replaceIfPresent` 接缝缺席是预期行为。该版本不需要 Worktree registry、Review 或 Recovery 数据迁移；历史组合的支持记录不变。

| 验证项 | 结果 |
| --- | --- |
| 平台 | Windows x64，Node 24.19.0，pnpm 12.5.1 |
| 依赖解析 | Cordis 4.0.5、cordis-plugin-loader 1.0.6、cordis-plugin-include 1.0.10、schemastery 3.18.5、全部 `@deepseek-ai/dsh-*` 为 0.2.1-rc.4；TypeScript 5.9.3 / Vitest 2.1.9 / tsdown 0.17.4 |
| `typecheck` | 通过，0 诊断 |
| `build` | 通过，`lib/client.js` 1192.39 kB |
| `check:sidebar-version` | 通过：ui-workspace 0.2.1-rc.4 + 0.1.6-alpha.2 + 0.1.7-rc.2 三路 SHA-256，locale 0.2.1-rc.4 |
| `check:publish` | 通过：13 Host singleton、12 导出目标、39 项 strict Remote 方法、挂载补丁、NOTICE 与浏览器 ModuleLoader/惰性 directory-picker |
| `pnpm test` | 54 个测试文件 **795 passed / 4 skipped**，无失败 |
| focused lifecycle | `tests/workspace-provider-lifecycle.test.ts` 27 passed |
| 接缝探针（对 rc.4 `lib/client.js`） | 源 232824 字节，`ALL 8 REQUIRED SEAMS OK`，派生 236427 字节 |

顺带修掉一处**继承自 master 基线的门禁失败**：`scripts/check-publish.mjs` 的预期方法表仍停在 38 项，而 `./remote` 早已因「回到 Local」能力新增了 `returnToLocal`（第 39 项）。`git diff --stat master -- scripts/check-publish.mjs src/console-remote/ tests/console-remote.test.ts` 为空，可证该不一致非本轮引入；现已把 `returnToLocal` 补入方法表，门禁报告 39 项。

**仅源码兼容验证**：本轮未启动正式或隔离 DSH Profile，未完成 `0.2.1-rc.4` 浏览器渲染与交互、API Key 下的真实 AI 对话、Review/预览/交付/回滚/恢复/清理全流程、桌面端与 Windows 端到端验收。旧版本的浏览器与运行时证据不可转用为本组合的验收证据。4 个 skipped 均为平台条件跳过（`tests/git-unborn.test.ts:72`、`tests/session-checkout-apply.test.ts:1225`、`:1241`、`tests/project-skills.test.ts:88` 为非 Windows 专用用例），`tests/git-unborn.test.ts:253` 的 Windows 长路径用例在本轮平台实际执行而非跳过。详见 [0.2.1-rc.4 报告](compatibility/0.2.1-rc.4.md)，机器结果见 [JSON](compatibility/0.2.1-rc.4-validation.json)。

### 0.2.1-rc.5 适配（插件 0.13.0；源码兼容验证）

插件 `0.13.0` 将 DSH 开发依赖精确锁定到 `0.2.1-rc.5`（核心 peer 的 caret 范围 `^0.2.1-rc.1` 已覆盖该版本，locale peer 精确清单追加 `|| 0.2.1-rc.5`），官方 Workspace Browser 派生门禁的版本常量同步对齐 rc.5。**rc.5 相对 rc.4 同样是纯版本号重发**：把仓库父工作树里已装的 rc.4 与本次安装的 rc.5 全部 70 个 `@deepseek-ai/dsh-*` 包逐文件按 SHA-256 比对（探针 `.dsh-ops/rc5-compare.mjs`，1280 个文件里 1209 个字节完全相同、合计 10014178 字节），唯一差异是 70 个包各自的 `package.json` 版本字段（等长），以及 `@deepseek-ai/dsh-client-modules/lib/index.js` 里一个内嵌构建 commit 标记（`ec17a2c` → `d4db512`，等长 42342 字节，首个差异在第 24827 字节、无逻辑差异）。`node_modules/.bin` 下的 shim 被有意排除：pnpm 用绝对 store 路径重写它们，任何两次安装都必然不同，且不含包逻辑。

官方 Workspace Client 在 rc.4 与 rc.5 之间**字节完全相同**（232824 字节，SHA-256 `9c2c17a66a5c20de00ac2852cb76debb5237439e97f877403bcaa2a471086544`），因此门禁只移动版本常量（`scripts/workspace-sidebar-upstream.mjs:5-6`）、SHA-256 常量保持原值——这是一个真检查而非假设：若产物有变，构建会当场被门禁拒绝。移动常量之前先用 `npm pack` 独立确认了 tarball（`106330` 字节）。

8 个必需文本接缝全部进入派生产物，装饰逻辑零改动；派生产物与 rc.4 的派生结果字节相同（236427 字节，SHA-256 `9b3a2e6a49cef3b121df9c157efec4f5c36cede681199526495700b0111777f2`）。`visibleSessionMenuItems` 在上游任何一代都不存在，它由插件自身装饰引入，其 `replaceIfPresent` 接缝缺席是预期行为。该版本不需要 Worktree registry、Review 或 Recovery 数据迁移；历史组合的支持记录不变。

| 验证项 | 结果 |
| --- | --- |
| 平台 | Windows x64，Node 24.19.0，pnpm 12.5.1 |
| 依赖解析 | Cordis 4.0.5、cordis-plugin-loader 1.0.6、cordis-plugin-include 1.0.10、schemastery 3.18.5、全部 `@deepseek-ai/dsh-*` 为 0.2.1-rc.5；TypeScript 5.9.3 / Vitest 2.1.9 / tsdown 0.17.4 |
| `typecheck` | 通过，0 诊断 |
| `build` | 通过，`lib/client.js` 1192.67 kB |
| `check:sidebar-version` | 通过：ui-workspace 0.2.1-rc.5 + 0.1.6-alpha.2 + 0.1.7-rc.2 三路 SHA-256，locale 0.2.1-rc.5 |
| `check:publish` | 通过：13 Host singleton、12 导出目标、39 项 strict Remote 方法、挂载补丁、NOTICE 与浏览器 ModuleLoader/惰性 directory-picker |
| `pnpm test` | 55 个测试文件 **800 passed / 4 skipped**，无失败 |
| focused lifecycle | `tests/workspace-provider-lifecycle.test.ts` 27 passed |
| 接缝探针（对 rc.5 `lib/client.js`） | 源 232824 字节，`ALL 8 REQUIRED SEAMS OK`，派生 236427 字节 |

**仅源码兼容验证**：本轮未启动正式或隔离 DSH Profile，未完成 `0.2.1-rc.5` 浏览器渲染与交互、API Key 下的真实 AI 对话、Review/预览/交付/回滚/恢复/清理全流程、桌面端与 Windows 端到端验收。旧版本的浏览器与运行时证据不可转用为本组合的验收证据。4 个 skipped 均为平台条件跳过（`tests/git-unborn.test.ts:72`、`tests/session-checkout-apply.test.ts:1225`、`:1241`、`tests/project-skills.test.ts:88` 为非 Windows 专用用例），`tests/git-unborn.test.ts:253` 的 Windows 长路径用例在本轮平台实际执行而非跳过。详见 [0.2.1-rc.5 报告](compatibility/0.2.1-rc.5.md)，机器结果见 [JSON](compatibility/0.2.1-rc.5-validation.json)。

### 0.2.2-rc.1 适配（插件 0.14.0；源码兼容 + 隔离运行时冒烟）

插件 `0.14.0` 将 DSH 开发依赖精确锁定到 `0.2.2-rc.1`，vendor 线整体跟随上游升级（Cordis `4.0.5 → 4.1.0`、loader `1.0.6 → 1.1.0`、include `1.0.10 → 1.1.0`、schemastery `3.18.5 → 3.19.0`），并把 DSH peers 从「精确枚举」改成开区间 `^0.1.2-rc.1 || ^0.1.6-alpha.2 || ^0.1.7-rc.2 || ^0.2.0-rc.1`。`engines.node` 同步提到 `>=24.9.0`。

**rc.5 → rc.1 是真实源码变更，不是版本号重发**：官方 Workspace Client 从 232824 字节涨到 284999 字节，SHA-256 也变了。三处上游契约切换直接影响本插件：

1. **内置 Session 动作离开 slot 台账**。rc.5 注册 `{ name: 'sidebar.workspaces.session.menu.item', id: 'session-id', order: 450 }`；rc.1 产物里 `session-id` 字面量归零，改为 `ctx.contextMenus.register({ id: 'session.<id>', target: 'session', order, observe, resolve })` 依次注册 pin(100)/rename(200)/fork(300)/id(450)/archive(600)。
2. **行组件新增 contextMenus 钩子、上下文新增该服务**。官方 `inject` 变 10 项且 `contextMenus` 排首位；插件通过过滤 `officialWorkspaceInject` 自动继承。
3. **`apply` 直接读 `ctx.remoteAccess` 属性**，不再走 `ctx.get('remoteAccess')`。注册代理原先只应答 `get` 形式，导致官方行钩子崩成 `slot entry crashed in 'sidebar.workspaces'`——**这个缺陷单元测试测不出来（测试注入了真实服务），只在真实浏览器里暴露**，本轮已修并补两条回归。

38 个装饰接缝中 2 个因 rc.1 插入 `cwd` 字段而失效，均收窄到 rc.5/rc.1 公共前缀。**收窄锚点不等于一份产物能跨两代运行**：装饰是构建期编译进产物的，绑定一份选定版本的官方 Client，所以现在发两套派生 —— `virtual:dsh-official-workspace-client-rc5`（来源 `0.2.1-rc.5`，SHA-256 `9c2c17a6…6544`）与 `virtual:dsh-official-workspace-client`（来源 `0.2.2-rc.1`，SHA-256 `bb31f787…9f89`）。两处失效锚点因此被收窄成一份接缝定义，供两套派生共用：

- `session node metadata`：rc.1 在 `updatedAt` 与 `pendingInteraction` 之间插入 `...s.cwd === void 0 || s.cwd === "" ? {} : { cwd: s.cwd },`，锚点收窄为 `archived: archived.has(s.id),
				updatedAt: s.updatedAt,`。
- `hover Worktree identity`：rc.1 在 `displayTitle` children 块与 `!node.blank` 之间插入渲染 `cwd` 的 `hoverPath` div，锚点收窄为 `children: displayTitle(node, t)
					}),`。

依赖侧两个契约也变了：**Cordis 4.1.0 的 `ctx.plugin()` 返回 `Object.create(fiber)`**，Loader 把该包装对象存进 `entry.fiber`，于是 `entry.fiber === ctx.fiber` 为假、`Object.getPrototypeOf(entry.fiber) === ctx.fiber` 为真（4.0.5 存的是 fiber 本身）。生命周期原本只做恒等比较，导致失败激活后 `entry.fiber` 永不清空、Web 图上留下插件死行；现同时接受两种形态。**Loader 1.1.0 把 `EntryTree.write()` 换成 `commit(change)`**，回归测试相应改为 spy `commit`。

本轮**启动了隔离 Host 做浏览器验收**（这不只是源码兼容）：在 `DSH_HOME=E:/tmp/dsh-rc1-home` 的 `probe` profile 里 link 本插件，以 0.2.2-rc.1 源码树启动 Web，用 Chromium 自动化验证两条分支——装饰共存（官方 Browser 在、`decorated sidebar registered`、无 page error）与接管（官方 Browser 退出模块图、侧栏渲染出「工作区 / 默认工作区 / 新会话 / 更多」、无 page error）均通过。接管分支就是在这里暴露了第 3 条契约切换。

| 验证项 | 结果 |
| --- | --- |
| 平台 | Windows x64，Node 24.19.0，pnpm 12.5.1 |
| 依赖解析 | Cordis 4.1.0、cordis-plugin-loader 1.1.0、cordis-plugin-include 1.1.0、schemastery 3.19.0、全部 `@deepseek-ai/dsh-*` 为 0.2.2-rc.1；TypeScript 5.9.3 / Vitest 2.1.9 / tsdown 0.17.4 |
| `typecheck` | 通过，0 诊断 |
| `build` | 通过，`lib/client.js` 1247.67 kB |
| `check:sidebar-version` | 通过：ui-workspace 0.2.2-rc.1 + 0.1.6-alpha.2 + 0.1.7-rc.2 三路 SHA-256，locale 0.2.2-rc.1 |
| `check:publish` | 通过：13 Host singleton、12 导出目标、39 项 strict Remote 方法、挂载补丁、NOTICE 与浏览器 ModuleLoader/惰性 directory-picker |
| `pnpm test` | 56 个测试文件 **840 passed / 4 skipped**，无失败 |
| focused lifecycle | `tests/workspace-provider-lifecycle.test.ts` 27 passed |
| 接缝探针（对 rc.1 `lib/client.js`） | 源 284999 字节，`ALL 8 REQUIRED SEAMS OK`，派生 288602 字节 |
| 隔离 Host + 真实 Chromium | 装饰共存与接管两条分支均渲染通过，无 page error |

**未验收（不声明完整运行时兼容）**：隔离 profile 未配置 API Key，真实 AI 对话与 Review/预览/交付/回滚/恢复/清理全流程未跑；Host 启动目录不在受管工作树内，浏览器里未做受管 checkout 的创建与交付（侧栏按预期报 `not_git_repository`）；桌面端、发布打包未验收；`alpha`（`0.1.6-alpha.2`）与 `next`（`0.1.7-rc.2`）两条派生过了门禁与单测，但未做浏览器冒烟。详见 [0.2.2-rc.1 报告](compatibility/0.2.2-rc.1.md)，机器结果见 [JSON](compatibility/0.2.2-rc.1-validation.json)。

### 三种版本约束不要混淆（当前源码）

1. **开发基线**：DSH 开发依赖精确为 `0.2.2-rc.1`；Cordis `4.1.0`、loader `1.1.0`、include `1.1.0`、schemastery `3.19.0`。旧 alpha/next Browser 别名仅用于构建来源门禁，不是私有 Host singleton。
2. **安装声明**：当前 DSH peers 统一为开区间 `^0.1.2-rc.1 || ^0.1.6-alpha.2 || ^0.1.7-rc.2 || ^0.2.0-rc.1`（含原先精确枚举的 locale）。Harness 用 `semver.satisfies(..., { includePrerelease: true })` 判定，该范围放行 `0.2.2-rc.1`、拒绝 `0.3.x`；Cordis peer 为 `^4.0.5`（4.1.0 满足）。这是 package.json 的安装声明，不是所有 peer patch 版本的运行时证明。`0.9.3` 历史上的多数 DSH `^0.1.2-rc.1` 与 locale `0.1.2-rc.1 || 0.1.7-rc.2` 不再是当前声明；历史记录仍保留。官方 Profile 由 Host 提供运行时，不能为了消除 peer 警告补装另一套 singleton。
3. **Workspace 派生**：当前 bundle 来源为 `0.2.2-rc.1`、`0.1.6-alpha.2`、`0.1.7-rc.2`，逐一经过版本/SHA-256 门禁。Host 实际解析的 `dsh-agent` 版本选择单一派生；新 modern 不复用于 `0.2.0`，未知版本保留官方 Provider。保留旧派生不等于当前 peers 支持旧 Host，来源门禁也不是浏览器验收。

历史可用组合不因当前源码升级被撤销；未覆盖的运行时生命周期仍需单独验收。

### 升级与回退

- `0.1.5-rc.1` 使用 Session V3 数据格式；不要用旧 Host 读取升级后的新日志。测试新版本请使用隔离 `DSH_HOME` 和测试仓库；迁移前备份原环境，回退时恢复原数据而不是只降级 npm 包。
- `0.1.2-rc.1` 移除了可选 SQLite Session 后端，旧数据应先用原版本导出。
- CLI 版本不等于完整 Profile 包版本。记录实际解析的 DSH 包；例如 `^0.1.5-rc.1` 可以解析到同核心版本的后续 RC。本轮安装结果未混入 rc.2。
- 2026-09-11 查询官方 npm：`latest=0.1.5-rc.1`、`next=0.1.5-rc.2`。这些是本轮时间点的记录，不是永久更新承诺。

本轮没有足够证据要求已经正常使用 `0.1.5-rc.1` 的用户降级，也没有足够证据宣布所有新版本完全兼容。完整检测证据与限制见 [2026-09-11 检测报告](compatibility/2026-09-11.md)。

## English

**Compatibility belongs to a plugin/Host combination, not to “the newest DSH only.”** Testing a newer Host does not withdraw older support; untested does not mean incompatible.

| Plugin | Harness | Evidence and scope |
| --- | --- | --- |
| `0.8.0` | `0.1.2-rc.1` | Development/build baseline at that time. Typecheck, build and 30 test files passed (431 passed, 2 skipped), including Session Target, Review, Recovery and Local write-protection regressions. No fresh browser end-to-end run for this combination in this check. |
| `0.8.0` | `0.1.5-rc.1` | User-reported working; isolated official Profile installation/configuration, imports and strict Typert checks passed. All 231 installed Host DSH packages were rc.1. 39 focused Remote, Workspace provider lifecycle and tool-surface tests passed with new Host packages. The real Web UI reached onboarding, but post-onboarding UI and Session end-to-end acceptance remain incomplete: **partially verified**, not known incompatible. |
| `0.8.0` | `0.1.5-rc.2`, `0.1.5-alpha.*` | Not tested in this check; neither compatibility nor incompatibility is claimed. |
| `0.7.4`, `0.7.5` | `0.1.2-rc.1` | Historical targeted fixes for the Workspace/Conversation boot cycle and provider enable/disable lifecycle respectively; see CHANGELOG. Not newly retested here. |
| `0.7.3` | `0.1.2-rc.1` | Known possible Workspace/Conversation activation cycle; fixed starting in `0.7.4`. |
| `0.7.2` and earlier | `0.1.2-rc.1` | Depend on the removed `dsh-client-runtime`; unsuitable for this Host line. This does not invalidate their original older-Host combinations. |

Do not infer a continuous supported range from isolated passing versions.

### Issue #9 follow-up (2026-09-25; plugin 0.9.3)

Plugin `0.9.3` carries both `schema` (legacy) and `create()` (new strict Typert). Client navigation prefers `uiWorkspace.openSession` and falls back to `sessions.open` on older Hosts; the selected new-generation Session comes from a unique `retainedBy.mainView`, failing closed on ambiguity. The official Workspace Browser is derived separately from exact rc.1, `0.1.6-alpha.2`, and `0.1.7-rc.2` source/SHA gates. The Host-resolved `dsh-agent` version selects exactly one authorized Slot tree; unknown generations retain the official provider. Managed rows keep Worktree status and suppress unsafe actions. **Builds and unit tests are not browser acceptance on a new Host.**

| Harness | Current status |
| --- | --- |
| `0.1.2-rc.1` | Pinned build/test baseline; new regression tests run on this line. |
| `0.1.5-rc.3` | npm `latest` at this check; no isolated Profile run, not claimed supported. |
| `0.1.6-alpha.2` | Matching official Browser is now source/SHA-gated, with strict-codec and new navigation/selection adaptations. Local build/source-seam tests pass; **no isolated Profile startup, render, creation or navigation smoke yet. No runtime compatibility claim.** |
| `0.1.7-rc.2` | Official Browser remains version/SHA-gated. A fresh isolated source-Host Profile installed twice without bypass, passed config smoke, and rendered in a real Web browser. A disposable Git Workspace exercised the Worktree switch, pre-session creation, draft transfer, managed-row status and selection after reload. **Without an API key, AI conversation and the full review/recovery/cleanup lifecycle remain untested; this is not a complete runtime compatibility claim.** |

The isolated development command is in [Local development](USAGE.md#本地开发). In rc.2, `sessions.create()` only catalogues an identity; an initial attempt borrowed an unretained binding and was safely rolled back. The controller now uses official `sessions.using()` through draft handoff and navigation, confirmed in the real browser. Alpha.2 still needs an independent Profile run, and AI conversation / Worktree lifecycle need an API-key-enabled test environment. Unknown upstream generations are not assigned a derived Browser.

### 0.2.0-rc.2 adaptation (2026-09-30; plugin 0.10.0)

Plugin `0.10.0` moves all DSH peers and dev dependencies to `0.2.0-rc.2` (exact), switches the official Workspace Browser derivation gate from rc.1 to 0.2.0-rc.2 (version/SHA-256), and retains the `0.1.6-alpha.2` and `0.1.7-rc.2` derivations; the runtime still selects exactly one derivation from the Host-resolved `dsh-agent` version. Fixed this round: the Web-boot deadlock caused by the `remote.directoryPicker` injection cycle, the `modern` flavor missing from the strict codec, and four derivation seams plus the `IconBranchOutlineRegular` icon naming aligned with 0.2.0.

| Check | Result |
| --- | --- |
| Isolated `DSH_HOME` + source Host (`dsh-v0.2.0-rc.2`) dev install (typecheck/build/pack/profile install) | Passed, repeated multiple times |
| Web boot | All entries activate (before the fix: 12 entries pending, plugin stuck loading) |
| Real Chromium (automation-driven) | Page render, Session creation, sidebar list |
| Worktree switch → confirm → pre-session creation | Worktree actually created, managed row carries the in-progress mark (`data-managed-worktree`), no render errors |
| Unit/type | Typecheck passes; 40 test files, 552 passed / 1 skipped |

**Not accepted (no complete runtime compatibility claim)**: real AI conversation with an API key; the full review/preview/delivery/rollback/recovery/cleanup lifecycle; Windows; npm-installed Host (source runner only this round); desktop. Plugin peers are pinned to exact `0.2.0-rc.2`: 0.1.x Hosts are not a 0.10.0 target; 0.1.x users stay on the 0.9.x plugin line (its 0.1.x support records above are unaffected by this section).

### 0.2.1-rc.3 adaptation (plugin 0.12.0; source compatibility validation)

Plugin `0.12.0` pins DSH dev dependencies to exact `0.2.1-rc.3` (the core caret peer range `^0.2.1-rc.1` already covers it, and the locale peer enumeration gains `|| 0.2.1-rc.3`), and moves the official Workspace Browser derivation gate to the matching version and compiled Client SHA-256 (`9c2c17a66a5c20de00ac2852cb76debb5237439e97f877403bcaa2a471086544`, 232824 bytes). No Worktree registry, Review or Recovery data migration is required; historical compatibility records are unchanged.

The actual `0.2.1-rc.2 → 0.2.1-rc.3` source difference sits in the official Workspace Client's pre-session draft semantics: `whenDraftExists` (`"replace" | "keep"`) replaces the previous `clearPreviousDraft` boolean, blank-Session reuse filters on the `agentPreset` projection value, and the `openWorkspaceSession` pre-session branch folds into `openWorkspace`. All nine text seams the decoration depends on survive (`__dshGitWorktreeManagedGuard`, `dshGitWorktree.managed`, `dshGitWorktree.state.working`, `managedWorktreeDecoration`, `ManagedWorktreeIdentity`, `__dshGitWorktreeProtected`, `__dshGitWorktree`, `data-managed-worktree` all reach the derived artifact; `visibleSessionMenuItems` is absent on both rc.2 and rc.3, and its seam is optional, so both generations behave identically). The decoration logic itself needed no change, and the plugin does not call the changed signatures — `agentPreset` still flows through the existing Host-default path.

| Check | Result |
| --- | --- |
| Platform | Windows x64, Node 24.19.0, pnpm 12.5.1 |
| Resolved dependencies | Cordis 4.0.5, cordis-plugin-loader 1.0.6, cordis-plugin-include 1.0.10, schemastery 3.18.5, every `@deepseek-ai/dsh-*` at 0.2.1-rc.3; TypeScript 5.9.3 / Vitest 2.1.9 / tsdown 0.17.4 |
| `typecheck` | Passed, no diagnostics |
| `build` | Passed, `lib/client.js` 1154.72 kB |
| `check:sidebar-version` | Passed: ui-workspace 0.2.1-rc.3 + 0.1.6-alpha.2 + 0.1.7-rc.2 SHA-256 gates, locale 0.2.1-rc.3 |
| `check:publish` | Passed: 13 Host singletons, 12 export targets, 38 strict Remote methods, mount patch, NOTICE and browser ModuleLoader/lazy directory-picker |
| `pnpm test` | 52 test files, **722 passed / 4 skipped**, no failures |
| Focused lifecycle | `tests/workspace-provider-lifecycle.test.ts` 27 passed |

**Source compatibility only:** no formal or isolated DSH Profile was started this round, and no `0.2.1-rc.3` browser rendering/interaction, API-key AI conversation, full review/preview/delivery/rollback/recovery/cleanup lifecycle, desktop or Windows end-to-end acceptance was performed. Earlier browser and runtime evidence does not accept this combination. All four skips are platform-conditional (`tests/git-unborn.test.ts:72`, `tests/session-checkout-apply.test.ts:1225`, `:1241`, `tests/project-skills.test.ts:88` are non-Windows-only cases), while the Windows long-path case at `tests/git-unborn.test.ts:253` actually ran on this platform instead of skipping. See the [0.2.1-rc.3 report](compatibility/0.2.1-rc.3.md).

### 0.2.1-rc.4 adaptation (plugin 0.13.0; source compatibility validation)

Plugin `0.13.0` pins DSH dev dependencies to exact `0.2.1-rc.4` (the core caret peer range `^0.2.1-rc.1` already covers it, and the locale peer enumeration gains `|| 0.2.1-rc.4`), and moves the official Workspace Browser derivation gate's version constants to rc.4. **rc.4 is a pure version-number republish of rc.3**: every `@deepseek-ai/dsh-*` package was downloaded and compared file-by-file by SHA-256 against the rc.3 tree already installed here. The only differing files are each package's `package.json` (version fields) and `@deepseek-ai/dsh-client-modules/lib/index.js`, where one embedded build-commit marker changes `be72761` → `ec17a2c` at identical length (42376 bytes) with no logic difference.

The official Workspace Client is **byte-identical** between rc.3 and rc.4: 232824 bytes, SHA-256 `9c2c17a66a5c20de00ac2852cb76debb5237439e97f877403bcaa2a471086544`. The gate therefore moves only the version constants (`scripts/workspace-sidebar-upstream.mjs:5-6`) while the SHA-256 constant stays unchanged — a real check, not an assumption: a changed artifact would be rejected at build time.

All eight required text seams reach the derived artifact and the decoration logic needed no change. `visibleSessionMenuItems` is absent from upstream on every generation because the plugin's own decoration introduces that identifier; its `replaceIfPresent` seam is optional and its absence is the expected case. No Worktree registry, Review or Recovery data migration is required; historical compatibility records are unchanged.

| Check | Result |
| --- | --- |
| Platform | Windows x64, Node 24.19.0, pnpm 12.5.1 |
| Resolved dependencies | Cordis 4.0.5, cordis-plugin-loader 1.0.6, cordis-plugin-include 1.0.10, schemastery 3.18.5, every `@deepseek-ai/dsh-*` at 0.2.1-rc.4; TypeScript 5.9.3 / Vitest 2.1.9 / tsdown 0.17.4 |
| `typecheck` | Passed, no diagnostics |
| `build` | Passed, `lib/client.js` 1192.39 kB |
| `check:sidebar-version` | Passed: ui-workspace 0.2.1-rc.4 + 0.1.6-alpha.2 + 0.1.7-rc.2 SHA-256 gates, locale 0.2.1-rc.4 |
| `check:publish` | Passed: 13 Host singletons, 12 export targets, 39 strict Remote methods, mount patch, NOTICE and browser ModuleLoader/lazy directory-picker |
| `pnpm test` | 54 test files, **795 passed / 4 skipped**, no failures |
| Focused lifecycle | `tests/workspace-provider-lifecycle.test.ts` 27 passed |
| Seam probe against rc.4 `lib/client.js` | 232824 source bytes, `ALL 8 REQUIRED SEAMS OK`, 236427 derived bytes |

A baseline publish-gate failure was fixed in passing: `scripts/check-publish.mjs` still enumerated 38 strict Remote methods while `./remote` already exposed 39 — `returnToLocal` (the "return to Local" capability) had been added without extending the expected array. `git diff --stat master -- scripts/check-publish.mjs src/console-remote/ tests/console-remote.test.ts` was empty, proving the mismatch was inherited rather than introduced by this bump. The gate now reports 39 methods.

**Source compatibility only:** no formal or isolated DSH Profile was started this round, and no `0.2.1-rc.4` browser rendering/interaction, API-key AI conversation, full review/preview/delivery/rollback/recovery/cleanup lifecycle, desktop or Windows end-to-end acceptance was performed. Earlier browser and runtime evidence does not accept this combination. All four skips are platform-conditional (`tests/git-unborn.test.ts:72`, `tests/session-checkout-apply.test.ts:1225`, `:1241`, `tests/project-skills.test.ts:88` are non-Windows-only cases), while the Windows long-path case at `tests/git-unborn.test.ts:253` actually ran on this platform instead of skipping. See the [0.2.1-rc.4 report](compatibility/0.2.1-rc.4.md) and the [machine-readable JSON](compatibility/0.2.1-rc.4-validation.json).

### 0.2.1-rc.5 adaptation (plugin 0.13.0; source compatibility validation)

Plugin `0.13.0` pins DSH dev dependencies to exact `0.2.1-rc.5` (the core caret peer range `^0.2.1-rc.1` already covers it, and the locale peer enumeration gains `|| 0.2.1-rc.5`), and moves the official Workspace Browser derivation gate's version constants to rc.5. **rc.5 is a pure version-number republish of rc.4**: all 70 `@deepseek-ai/dsh-*` packages were compared file-by-file by SHA-256 between the rc.4 tree in the parent checkout and the rc.5 tree installed here (probe `.dsh-ops/rc5-compare.mjs`; 1209 of 1280 files are byte-identical, 10014178 bytes in total). The only differing files are each package's `package.json` (version fields only, identical lengths) and `@deepseek-ai/dsh-client-modules/lib/index.js`, where one embedded build-commit marker changes `ec17a2c` → `d4db512` at identical length (42342 bytes, first difference at byte 24827) with no logic difference. `node_modules/.bin` shims are excluded by design — pnpm rewrites them with absolute store paths, so they always differ and carry no package logic.

The official Workspace Client is **byte-identical** between rc.4 and rc.5: 232824 bytes, SHA-256 `9c2c17a66a5c20de00ac2852cb76debb5237439e97f877403bcaa2a471086544`. The gate therefore moves only the version constants (`scripts/workspace-sidebar-upstream.mjs:5-6`) while the SHA-256 constant stays unchanged — a real check, not an assumption: a changed artifact would be rejected at build time. The tarball (`106330` bytes) was confirmed independently via `npm pack` before the constants moved.

All eight required text seams reach the derived artifact and the decoration logic needed no change; the derived output is byte-identical to the rc.4 derivation (236427 bytes, SHA-256 `9b3a2e6a49cef3b121df9c157efec4f5c36cede681199526495700b0111777f2`). `visibleSessionMenuItems` is absent from upstream on every generation because the plugin's own decoration introduces that identifier; its `replaceIfPresent` seam is optional and its absence is the expected case. No Worktree registry, Review or Recovery data migration is required; historical compatibility records are unchanged.

| Check | Result |
| --- | --- |
| Platform | Windows x64, Node 24.19.0, pnpm 12.5.1 |
| Resolved dependencies | Cordis 4.0.5, cordis-plugin-loader 1.0.6, cordis-plugin-include 1.0.10, schemastery 3.18.5, every `@deepseek-ai/dsh-*` at 0.2.1-rc.5; TypeScript 5.9.3 / Vitest 2.1.9 / tsdown 0.17.4 |
| `typecheck` | Passed, no diagnostics |
| `build` | Passed, `lib/client.js` 1192.67 kB |
| `check:sidebar-version` | Passed: ui-workspace 0.2.1-rc.5 + 0.1.6-alpha.2 + 0.1.7-rc.2 SHA-256 gates, locale 0.2.1-rc.5 |
| `check:publish` | Passed: 13 Host singletons, 12 export targets, 39 strict Remote methods, mount patch, NOTICE and browser ModuleLoader/lazy directory-picker |
| `pnpm test` | 55 test files, **800 passed / 4 skipped**, no failures |
| Focused lifecycle | `tests/workspace-provider-lifecycle.test.ts` 27 passed |
| Seam probe against rc.5 `lib/client.js` | 232824 source bytes, `ALL 8 REQUIRED SEAMS OK`, 236427 derived bytes |

**Source compatibility only:** no formal or isolated DSH Profile was started this round, and no `0.2.1-rc.5` browser rendering/interaction, API-key AI conversation, full review/preview/delivery/rollback/recovery/cleanup lifecycle, desktop or Windows end-to-end acceptance was performed. Earlier browser and runtime evidence does not accept this combination. All four skips are platform-conditional (`tests/git-unborn.test.ts:72`, `tests/session-checkout-apply.test.ts:1225`, `:1241`, `tests/project-skills.test.ts:88` are non-Windows-only cases), while the Windows long-path case at `tests/git-unborn.test.ts:253` actually ran on this platform instead of skipping. See the [0.2.1-rc.5 report](compatibility/0.2.1-rc.5.md) and the [machine-readable JSON](compatibility/0.2.1-rc.5-validation.json).

### 0.2.2-rc.1 adaptation (plugin 0.14.0; source compatibility plus isolated runtime smoke)

Plugin `0.14.0` pins DSH dev dependencies to exact `0.2.2-rc.1`, follows the vendor line upstream (Cordis `4.0.5 → 4.1.0`, loader `1.0.6 → 1.1.0`, include `1.0.10 → 1.1.0`, schemastery `3.18.5 → 3.19.0`), and replaces the exact DSH peer enumeration with the open range `^0.1.2-rc.1 || ^0.1.6-alpha.2 || ^0.1.7-rc.2 || ^0.2.0-rc.1`. `engines.node` moves to `>=24.9.0`.

**rc.5 → rc.1 is a real source change, not a version-number republish**: the official Workspace Client grows from 232824 to 284999 bytes and its SHA-256 changes. Three upstream contract changes bear on this plugin:

1. **Built-in Session actions leave the slot ledger.** rc.5 registered `{ name: 'sidebar.workspaces.session.menu.item', id: 'session-id', order: 450 }`; the rc.1 artifact contains no `session-id` literal at all and registers `ctx.contextMenus.register({ id: 'session.<id>', target: 'session', order, observe, resolve })` for pin(100)/rename(200)/fork(300)/id(450)/archive(600).
2. **Row components gain contextMenus hooks and the context gains the service.** The official `inject` list is now 10 entries with `contextMenus` first; the plugin inherits it by filtering `officialWorkspaceInject`.
3. **`apply` reads `ctx.remoteAccess` as a property**, not through `ctx.get('remoteAccess')`. The registration proxy answered only the `get` form, so the official row hook crashed as `slot entry crashed in 'sidebar.workspaces'` — **a defect unit tests could not catch, because they inject a real service; only the real browser exposed it.** Fixed this round with two new regressions.

Two of the 38 decoration seams broke because rc.1 inserted a `cwd` field. Both were narrowed to the rc.5/rc.1 common prefix which now form ONE seam definition shared by BOTH derivatives.. Narrowed anchors do not make a single artifact run on both generations: decoration is compiled into the artifact at build time and binds one official Client version, so the plugin now ships two derivatives — `virtual:dsh-official-workspace-client-rc5` (from `0.2.1-rc.5`, SHA-256 `9c2c17a6…6544`) and `virtual:dsh-official-workspace-client` (from `0.2.2-rc.1`, SHA-256 `bb31f787…9f89`):

- `session node metadata`: rc.1 inserts `...s.cwd === void 0 || s.cwd === "" ? {} : { cwd: s.cwd },` between `updatedAt` and `pendingInteraction`; the anchor narrowed to `archived: archived.has(s.id),
				updatedAt: s.updatedAt,`.
- `hover Worktree identity`: rc.1 inserts a `hoverPath` div rendering `cwd` between the `displayTitle` children block and the `!node.blank` guard; the anchor narrowed to `children: displayTitle(node, t)
					}),`.

Two dependency contracts moved as well. **Cordis 4.1.0's `ctx.plugin()` returns `Object.create(fiber)`**, and Loader stores that wrapper on `entry.fiber`, so `entry.fiber === ctx.fiber` is false while `Object.getPrototypeOf(entry.fiber) === ctx.fiber` is true (4.0.5 stored the fiber itself). The lifecycle compared by identity only, so a failed activation never cleared `entry.fiber` and the Web graph kept a dead plugin row; the comparison now accepts both forms. **Loader 1.1.0 replaces the `EntryTree.write()` persistence hook with `commit(change)`**, so the lifecycle regression now spies on `commit`.

This round **launched an isolated Host and smoked the UI in a real browser** — not source compatibility alone: a `probe` profile under `DSH_HOME=E:/tmp/dsh-rc1-home` with the plugin linked in, started from the 0.2.2-rc.1 source tree, driven by Chromium automation on both branches. Decorate (`enableWorkspaceProvider: false`) kept the official Browser in the module graph with `decorated sidebar registered` and no page error; takeover (`enableWorkspaceProvider: true`) removed the official Browser from the module graph, rendered the sidebar (工作区 / 默认工作区 / 新会话 / 更多) and showed no page error. The takeover branch is what exposed item 3 above.

| Check | Result |
| --- | --- |
| Platform | Windows x64, Node 24.19.0, pnpm 12.5.1 |
| Resolved dependencies | Cordis 4.1.0, cordis-plugin-loader 1.1.0, cordis-plugin-include 1.1.0, schemastery 3.19.0, every `@deepseek-ai/dsh-*` at 0.2.2-rc.1; TypeScript 5.9.3 / Vitest 2.1.9 / tsdown 0.17.4 |
| `typecheck` | Passed, no diagnostics |
| `build` | Passed, `lib/client.js` 1247.67 kB |
| `check:sidebar-version` | Passed: ui-workspace 0.2.2-rc.1 + 0.1.6-alpha.2 + 0.1.7-rc.2 SHA-256 gates, locale 0.2.2-rc.1 |
| `check:publish` | Passed: 13 Host singletons, 12 export targets, 39 strict Remote methods, mount patch, NOTICE and browser ModuleLoader/lazy directory-picker |
| `pnpm test` | 56 test files, **840 passed / 4 skipped**, no failures |
| Focused lifecycle | `tests/workspace-provider-lifecycle.test.ts` 27 passed |
| Seam probe against rc.1 `lib/client.js` | 284999 source bytes, `ALL 8 REQUIRED SEAMS OK`, 288602 derived bytes |
| Isolated Host + real Chromium | Both branches render with no page error |

**Not accepted (no complete runtime compatibility claim):** the isolated profile had no API key, so real AI conversation and the full review/preview/delivery/rollback/recovery/cleanup lifecycle did not run; the Host started outside a managed checkout, so managed-checkout creation and delivery were not exercised in the browser (the sidebar correctly reported `not_git_repository`); desktop and release packaging remain unaccepted; the `alpha` (`0.1.6-alpha.2`) and `next` (`0.1.7-rc.2`) derivations passed the gates and unit tests but were not browser-smoked. See the [0.2.2-rc.1 report](compatibility/0.2.2-rc.1.md) and the [machine-readable JSON](compatibility/0.2.2-rc.1-validation.json).

**Separate three current constraints:** (1) DSH dev dependencies are exact `0.2.2-rc.1`, with Cordis `4.1.0`, loader `1.1.0`, include `1.1.0` and schemastery `3.19.0`. (2) Every DSH peer is the open range `^0.1.2-rc.1 || ^0.1.6-alpha.2 || ^0.1.7-rc.2 || ^0.2.0-rc.1` (including the formerly exact locale enumeration). Harness resolves compatibility with `semver.satisfies(..., { includePrerelease: true })`, so the range admits `0.2.2-rc.1` and rejects `0.3.x`; the Cordis peer stays `^4.0.5` (4.1.0 satisfies it). This does not prove every permitted patch version. The historical `0.9.3` caret/locale constraints above are not the current manifest; never install private Host singletons merely to suppress Profile peer warnings. (3) Current Browser sources are individually version/SHA-gated `0.2.2-rc.1`, `0.1.6-alpha.2` and `0.1.7-rc.2`. Host-resolved agent version selects one derivative; the new modern source is not reused on `0.2.0`, and unknown versions keep the official Provider. Keeping old derivations does not extend current peer support to old Hosts. Neither gate nor package selection proves browser acceptance. Historical working combinations are not withdrawn.

**Migration:** rc.1 of the 0.1.5 line uses Session V3; older Hosts cannot read upgraded logs. Back up the original environment and test with an isolated `DSH_HOME`/repository. Rollback requires original data, not just an older npm package. The 0.1.2-rc.1 line also removed the optional SQLite backend; export old data with the original version first. Record resolved packages rather than the CLI version alone: a caret may resolve a later RC. This run found no rc.2 mixing. Registry tags observed on 2026-09-11 were `latest=0.1.5-rc.1`, `next=0.1.5-rc.2`.

There is no established reason from this check to force working rc.1 users to downgrade, nor sufficient evidence to claim complete forward compatibility. See the [validation report](compatibility/2026-09-11.md) for limitations.
