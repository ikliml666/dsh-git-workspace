# Changelog

本项目的显著变更记录在此文件中。版本号遵循 Semantic Versioning；在 `0.x` 阶段，minor 版本可能包含需要迁移的公开能力调整。

## [Unreleased]

### Fixed

- 顶部胶囊「不可用」无从诊断（2026-10-26，证据链纠正 + 可观测性补齐）：排查过程中曾把「诊断日志里没有 `kind:"current"` 记录」当作「`current()` 从未被调用」的硬证据，据此推断 gateway 的 agent lookup 在方法调用前失败。**这条推断是错的**——`src/console-host/service.ts` 的 `current()` 当时根本没有埋点（`grep "kind: 'current'" lib/console-host/service.js` 结果为 0），日志里没有它是因为没人写，不是因为没被调用。据此放弃了一个高成本的错误方向（改 gateway 传参）。
  - `src/console-host/service.ts` 的 `current()` 补上 `appendDiag({ kind: 'current', ok, agentId, code, message })`：胶囊挂载即会调一次 `current`，失败时的 `code`/`message` 直接落盘，可区分「会话未持验收位」「项目不匹配」「git 报错」三类。
  - `src/client/target-console/TargetStatusAction.tsx` 新增 `failure` 状态，记录 `current` 失败的真实 `{ code, message }`；触发按钮的 `title` 与 `aria-label` 在失败时改为 `${code}: ${message}`，不再只显示一个无从诊断的「不可用」（`state='error'` 时 `target` 为 null，标签只能退化成 `t('unavailable')`）。
  - 新增回归用例「current 失败时 tooltip 暴露真实错误码与消息」。
  - 验证：`tsc --noEmit` 0 诊断；`pnpm build` 通过（`lib/client.js` 1184.59 kB，产物含 `kind: 'current'` 1 处、`triggerTitle` 3 处）；`tests/client-target-console.test.tsx` 72 passed。真机重启后读 `~/.dsh/plugins/dsh-git-worktree/sidebar-diag.ndjson` 的 `kind:"current"` 记录即可定位真实错误码。

- 侧栏 Worktree 徽章始终不显示（2026-10-26，槽位事实纠正）：此前两次修复都把槽名改成 `sidebar.session.row.trailing`，但**该槽在 DSH 0.2.x 根本不存在**——用 `@electron/asar` 解包宿主 `app.asar` 统计字符串，`sidebar.session.row.trailing` 出现 **0** 次，官方 `sidebar.workspaces` 条目实际声明的是 `sidebar.session.row.leading`（行标题前的 16px 位，仅在行主状态为 idle 且不显示状态点时渲染）与 `sidebar.session.row.hover`（悬浮卡片正文，popover 打开时挂载）。`slots.inject` 等一个永不被声明的槽名，回调永不执行、徽章永不挂载，与真机现象完全一致。
  - 改为同时向两个真实槽位注册：`ROW_SEATS = ['sidebar.session.row.leading', 'sidebar.session.row.hover']`，同一组件按 `seat` 分派呈现——行首 16px 位渲染 7×7 状态圆点（颜色按 `BADGE_DOT_COLOR` 映射状态色，`aria-label`/`title` 承载完整文案；文字 chip 在 16px 里会被裁掉），hover 卡片渲染原有 168px 圆角「状态 · 分支」全文案 chip。
  - 「清除状态标签」菜单项仍注册在真实存在的 `sidebar.workspaces.session.menu.item`，不变。
  - 验证：`tsc --noEmit` 0 诊断；`pnpm build` 通过（`lib/client.js` 1184.04 kB，产物 `sidebar.session.row.leading` 7 处、`sidebar.session.row.hover` 6 处、`row.trailing` 仅剩注释 1 处）；`npx vitest run` 54 文件 **774 passed / 4 skipped**（Duration 671.86s）。真机验证待做。

- 空白会话无法直接开 Worktree（2026-10-26，从上游 wloops/dsh-git-worktree v0.11.0 回迁）：上一轮回滚把 pre-session 模块一并撤除，导致只能先建一个本地会话再转 Worktree。本轮重新移植上游整套 4 文件：
  - 新增 `src/client/pre-session/controller.ts`（237 行，准备流程状态机：草稿校验 → preflight → 创建/校准 → 归档临时本地会话 → 切到隔离会话，含 `AbortController` 取消与「会话已切换」保护）、`harness-input.ts`（31 行，`ClientInputActions` 适配）、`PreSessionWorktreeToggle.tsx`（180 行，composer 左侧「在 Worktree 中开始」开关，含 ready/empty/files 三态与错误浮层）、`index.tsx`（63 行，向 `conversation.input.left` 槽注册，order 40）。
  - `src/client/actions.ts` 新增 `PreSessionWorktreeServices`（在 `WorktreeClientServices` 上补 `sessions` / `workspaces.archiveSession` / `workspaces.delete` / `conversation.input.for()` / `conversation.blocks.set|storeFor`）。
  - `src/client/index.tsx` 的 `servicesOf` 返回类型放宽到 `PreSessionWorktreeServices`，并在 `registerTargetConsole` 之后调用 `registerPreSessionWorktree`；`slots.inject` 允许名加 `conversation.input.left`。
  - `src/i18n/client-messages.ts` 补 211 行上游文案（`pre.session.*`、`creating.isolated.worktree`、`detail.processing` 等）；`src/client/styles.ts` 补 `.dsh-wt-pre-session*` 样式（对齐 Harness PermissionSelect 的 24px 圆角触发器等）。
  - 新增 `tests/client-pre-session.test.tsx`。验证同上一条全量单测。

- 行尾徽章不显示（2026-10-25，**结论已被 2026-10-26 条目取代**）：`registerDecoratedWorkspaceSidebar` 里 `slots.inject` 的等待槽名误写成不存在的 `sidebar.workspaces.session.row.trailing`——官方 Browser 声明的行尾子槽真名是 `sidebar.session.row.trailing`（无 `workspaces` 层级），inject 等一个永不被声明的槽导致注册回调静默永不执行、徽章永不挂载。修正为正确槽名并补注释；对应测试断言同步修正。验证：`tsc --noEmit` 0 诊断、`pnpm build` 通过（`lib/client.js` 1155.03 kB，产物含 `slots.inject("sidebar.session.row.trailing")`）、`tests/client-workspace-sidebar.test.tsx` 12 passed；全量 53 文件此前 733 passed / 1 failed，唯一失败正是编码了错误槽名的旧断言。
- 装饰分支侧栏 `renderSlot` 崩溃（2026-10-25，依据 harness 源码定案重写）：对照 `deepseek-harness` 的 `dsh-client-ui-slots` 源码确认三条硬约束——每个子槽只允许一个声明者（重复声明 `children` 直接抛错）、`renderSlot` 只授权给**声明该子槽的条目**（`SlotOwnershipError`）、崩溃条目会 abdicate 让位同 cell 下一条。因此此前三条路全部走不通：影子注册拿不到子槽授权（派生 Browser 一调 `renderSlot('sidebar.workspaces.directoryFlow')` 即崩）、透传 `official.children` 撞「one declarer per slot」、原位偷换 `entry.component` 破坏宿主渲染契约导致布局崩坏（后两者均已 revert）。最终方案：**放弃装饰 Browser 本体，改用宿主官方扩展点**——通过 `slots.inject` 向官方 Browser 已声明的 list 子槽注册条目：`sidebar.session.row.trailing` 注册行尾「状态 · 分支」徽章（`WorktreeStatusBadgeEntry`，无受管任务渲染为空），`sidebar.workspaces.session.menu.item` 注册「清除状态标签」菜单项（复用 `ClearSidebarBadgeMenuItem`）；这些条目由官方条目自己的 `renderSlot` 渲染，授权天然完好。decorate 模式自带 topology 拉取（含 `WORKTREE_REVIEW_REFRESH_EVENT` 刷新）驱动 `sharedTopology`，不再依赖 Browser 包装组件。影子注册、subscribe 等待、`entriesOfSlot` 扫描逻辑全部移除；`model.ts` 的 `currentTasks` 改为导出 `sidebarBadgeTasks`。验证：`tsc --noEmit` 0 诊断、`pnpm build` 通过（`lib/client.js` 1155.04 kB）、`pnpm test` 53 个测试文件 **734 passed / 4 skipped**；新增用例断言不再注册 `sidebar.workspaces`、两个子槽各注册一条、徽章按 owner/普通行与刷新事件正确渲染。真机（宿主重启后）验证待做。

### Added

- 并发会话分支竞态防护（2026-10-25）：检测同一 Local 检出边界下多个 live 会话并发、且检测窗口内有其他会话新建本地分支时，向后启动的会话注入 runtimeContext 提示——禁止 `git switch -c`/`git checkout -b`，要求先 `worktree_create` 隔离改动。
  - 新增纯函数检测器 `src/concurrent-session-guard.ts`（`detectLocalBranchRace`，同步判定：更早启动的同边界会话 ≥1 且窗口内新建非受管分支 ≥1）。
  - LookupPort 新增可选 `listLiveSessions`（harness sessions store 同步投影，结构守卫降级空）；GitPort 新增可选 `branchCreationTimes`（一次 `git reflog show --all` 解析每分支最早 `branch: Created from` 时间）。
  - 模块新增公开 `refreshBranchRaceGuards()`（后台刷新各 Local root 缓存，45s 定时器在 session-target-context 注册），runtimeContext 在无 binding 与 Local 无 pending 两处接入；已隔离会话与受管分支排除在判定之外。
  - 新增 volatile 配置 `branchRaceGuard`（默认 true）与 `branchRaceWindowMs`（默认 30 分钟）。

- Git 标签管理（target-console 模块，2026-10-24）：分支菜单新增「管理标签」入口，弹层支持列出本地标签（附注/轻量、已推送状态、说明正文）、按名称创建轻量或附注标签、创建时可选同步推送到 `origin`、对未推送标签单独推送、删除前二次确认并可选同时删除 `origin` 上的同名标签。
  - 新增 Remote 方法 `gitListTags` / `gitCreateTag` / `gitDeleteTag` / `gitPushTag`（严格 descriptor + zod 校验，标签名走 `git check-ref-format` 同等规则），发布门禁方法面同步为 38 项。
  - 标签推送永不 force：本地创建成功而推送失败时仍保留标签并以提示报告失败原因；`gitPushTag` 单独推送失败返回 `git_error` 领域错误。
  - 提交图谱区分标签与分支：适配器装饰解析保留 `tag:` 标记，同名 tag 与 branch 不再合并为同一徽章，标签徽章以绿色 `⌗` 前缀渲染。
  - 图谱内可直接打标签：每条提交悬停显示「在此提交打标签」，图谱底栏新增「管理标签」，从提交行进入时弹层顶部标注「将指向提交 <oid>」并把该 commit 作为 `target` 传给 `gitCreateTag`；从菜单或底栏进入则以 HEAD 为目标。
  - 推送状态不再误报：`ls-remote` 失败（离线、无 `origin`）时标签推送状态记为未知并显示「推送状态未知」，不再静默判为未推送；未知状态下推送按钮保持可用。

### Fixed

- 修复侧边栏工作区行不显示 Worktree 标签（workspace-sidebar 模块，2026-10-25）：decorate 模式（官方 Workspace 保持活跃，`enableWorkspaceProvider` 为 `false`）下，影子注册包裹的是**官方** Browser 组件，而官方组件不认识插件投影注入的 `__dshGitWorktree` / `__dshGitWorktreeProtected` 字段，也没有分支图标与状态徽章类名，导致投影数据无人消费 —— 会话行只剩标题，Worktree 图标与「待验收 / 已完成」等标签全部静默丢失（`working` 状态按上游 594298b 的设计本就只留图标）。
  - 改为渲染派生的 `WorkspaceBrowser`（`scripts/workspace-sidebar-upstream.mjs` 逐处 seam 改写官方 client 得到的同版本浏览器，装饰读取已编译在内），并让派生模块导出该组件；官方槽位条目与其全部注入方仍原样存活。
  - 不改 `enableWorkspaceProvider`：把该 flag 置 `true` 会走禁用官方条目的接管路径，正是 2026-10-17 两次桌面崩溃的成因（同一条件表达式在 host apply 与 renderer 审计两处求值相反 → `uiWorkspace` 无人提供、17 个下游条目 pending），故 5312227 已将其降级为硬开关。
  - 验证：`typecheck` 0 诊断、`build` 通过（`lib/client.js` 1154.77 kB）、`check:publish` 全部通过、`pnpm test` 52 个测试文件 **725 passed / 4 skipped**。新增用例断言渲染的是派生 Browser 且 owner Session 收到 `__dshGitWorktree` 装饰、Local Session 没有；把修复回退后该用例失败、恢复后通过。

### Changed

- 侧边栏进行中行显示状态徽章（workspace-sidebar 模块，2026-10-25）：撤销上游 594298b「隐藏 working 文字 badge」的行为，`working` 状态与其他状态一致显示「进行中」徽章（有分支名时为「进行中 · <分支名>」）。理由：任务运行中恰是会话行最需要说明自己在做什么的时刻，只留一个 16px 分支图标让用户无法从侧栏判断任务状态。
  - 三个变体的派生改写同步放开条件：`scripts/workspace-sidebar-upstream.mjs` 的 `ManagedWorktreeIdentity` 去掉 `decoration.state !== "working" &&`，`scripts/workspace-sidebar-upstream-next.mjs` 与 `-alpha.mjs` 的行内徽章同理。
  - 上游回归用例 `tests/client-workspace-sidebar-status.test.tsx` 改为断言「working 也显示徽章」（原本断言 `toBeNull()`），并把 `keeps the %s badge unchanged` 的遍历范围从「除 working 外全部状态」扩到全部状态；回退该改动后 modern 变体 3 条用例失败，恢复后 30 条全通过。
  - 样式不变：`.dsh-git-worktree-sidebar-badge[data-worktree-state="working"]` 仍用 `--dsw-alias-state-business-primary` 配色，与图标同色。
  - 验证：`typecheck` 0 诊断、`build` 通过（`lib/client.js` 1154.77 kB，产物中已无 `decoration.state !== "working"` 条件）、`pnpm test` 52 个测试文件 **725 passed / 4 skipped**。

- 适配 DSH `0.2.1-rc.3`（基线适配，2026-10-24）：插件版本升至 `0.12.0`，DSH devDependencies 精确锁定 `0.2.1-rc.3`（核心 peer 的 caret 范围 `^0.2.1-rc.1` 已覆盖该版本，locale peer 精确清单追加 `|| 0.2.1-rc.3`），`minimumReleaseAgeExclude` 同步覆盖 rc.3 精确锁定依赖。官方 Workspace Browser 派生门禁版本与编译后 Client SHA-256 对齐 rc.3（`9c2c17a6…6544`，232824 字节），`src/host-compat.ts` 的 modern generation 注释与 `tests/host-compat.test.ts` 的 flavor 映射补充 rc.3，locale peer 精确清单追加 `|| 0.2.1-rc.3`。rc.2→rc.3 的实际源码差异集中在官方 Workspace Client 的预会话草稿语义（`whenDraftExists` 取代 `clearPreviousDraft` 布尔、空白 Session 复用按 `agentPreset` 过滤、`openWorkspaceSession` 分支合并），插件装饰的 9 个接缝全部存活，无需改动装饰逻辑；插件自身未调用受影响的新签名，`agentPreset` 仍按既有 Host 默认路径透传。
  - 验证（Windows x64，Node 24.19.0，pnpm 12.5.1，Cordis 4.0.5 / loader 1.0.6 / include 1.0.10 / schemastery 3.18.5，TypeScript 5.9.3 / Vitest 2.1.9 / tsdown 0.17.4）：`typecheck` 0 诊断、`build` 通过（`lib/client.js` 1154.72 kB）、`check:sidebar-version` 通过（ui-workspace 0.2.1-rc.3 + 0.1.6-alpha.2 + 0.1.7-rc.2 三路 SHA-256、locale 0.2.1-rc.3）、`check:publish` 全部通过（13 Host singleton、12 导出目标、38 项 strict Remote 方法）、`pnpm test` 52 个测试文件 **722 passed / 4 skipped**，其中 focused lifecycle 27 passed。
  - 仅源码兼容验证：未启动正式/隔离 DSH Profile，未做 rc.3 浏览器、真实 AI 对话、桌面端与 Windows 全流程验收。4 个 skipped 均为平台条件跳过（`tests/git-unborn.test.ts:72`、`tests/session-checkout-apply.test.ts:1225`、`:1241`、`tests/project-skills.test.ts:88` 为非 Windows 专用用例；本轮平台为 Windows，`tests/git-unborn.test.ts:253` 的 Windows 长路径用例已实际执行）。
- 吸收 dsh-git-graph 上游三项体验优化（target-console 模块，2026-10-24）：
  - 分支弹层支持搜索：分支超过 12 条时在菜单顶部展示搜索框，实时过滤分支列表，回车即切换首个匹配分支，无匹配时给出提示；关闭菜单自动清空搜索词。
  - 分支切换成功反馈：切换确认后在胶囊上显示约 900ms 的「已切换到 <分支>」绿色提示，避免快速关闭被误认为无操作。
  - WorktreeHeroChip 定位优化：以 DOM 结构解析（dock 出口的前向兄弟 → composerStack 祖先 → document 兜底）加 MutationObserver 替代固定 250ms×40 轮询，仅在结构解析失败时保留 500ms×8 有界兜底轮询，hero 行出现即挂载胶囊。

## [0.11.0] - 2026-10-18

`0.11.0` 将 DSH 基线从 `0.2.0-rc.2` 精确切换到 `0.2.1-rc.2`，并修复新版 Cordis/Loader 下的 Provider 生命周期；同时取消提交信息长度限制、精简验收冲突展示。本版完整包含 tag `v0.10.1` 的全部变更；`v0.10.1` 有 Git tag 与 GitHub Release 但从未发布到 npm，npm 用户应直接安装 `0.11.0`。

### Changed

- DSH peers/devDependencies 精确锁定 `0.2.1-rc.2`；Cordis 4.0.5、cordis-plugin-loader 1.0.6、cordis-plugin-include 1.0.10、schemastery 3.18.5 及锁文件同步。Workspace 版本/SHA 门禁与 Fork mandatory seam 对齐新源码，保留 allowMigration、agentPreset 与官方草稿初始化；新派生不复用于 0.2.0 Host，历史 alpha/next 别名保持。
- 接入官方 remoteAccess Client 依赖，保持 directoryPicker 惰性防环；Remote 测试使用官方 owner Peer 和真实 browser 条件入口，非 owner 默认拒绝，不添加分享授权策略。
- 放行已核对的只读 session-id 菜单，Fork/未知动作继续阻断；预会话创建保留已记录的 agentPreset，未记录时使用 Host 默认，保留草稿/附件回归。
- `minimumReleaseAgeExclude` 覆盖 `0.2.1-rc.2` 精确锁定依赖与 Cordis/schemastery 新版，延续既有精确锁定豁免惯例。

### Fixed

- 修复 Cordis 4.0.5 / Loader 1.0.6 下 Provider 生命周期：显式释放 marker，不依赖并发卸载的顺序；等待禁用 fiber 真正结束，以公开 `entry.init()` 替换已销毁的官方 fiber；按身份撤回失败/禁用的 replacement fiber 并通知 Web registry。保留非阻塞启动、超时/在途保护、不持久化配置和根卸载不复活；补充同 fiber 重启及多轮启停回归。
- 取消提交信息的 500 字符限制并保留完整正文：贯通前端、RPC、Host 与 checkpoint 传递，移除历史 Review 截断与 registry 正文长度上限，统一非空与 NUL 校验，保持身份与幂等门禁；补充长正文、Unicode、重启恢复回归并更新文档。
- 验收冲突展示精简：摘要与操作统一为顶部布局，冲突提示独立紧凑展示；冲突文件列表移入验收详情并复用列表展开与长路径换行；突出解决冲突操作，冲突时隐藏不可用的预览按钮。

### Compatibility

- 基线适配通过新鲜隔离源码验证（typecheck/build/sidebar/发布门禁通过；43 个测试文件 607 passed、1 skipped，focused lifecycle 24 passed）；仅为源码兼容验证，未验收真实浏览器、AI 对话、桌面或 Windows 全流程。详见 [0.2.1-rc.2 验证报告](docs/compatibility/0.2.1-rc.2.md)。
- 无 Worktree registry、Review 或 Recovery 数据迁移；`0.1.x` Host 继续使用 `0.9.x` 插件线，其兼容记录不变。

## [0.10.1] - 2026-10-07

`0.10.1` 恢复托管会话被过度屏蔽的官方侧边栏操作，收敛行内状态展示，并让验收详情的长列表默认折叠；是无数据迁移的补丁版。

### Added

- 验收详情的修改文件与验证记录超过 5 项时默认只显示前 5 项，提供各自独立的展开全部/收起按钮；重新打开详情或切换验收（checkout/review/revision）时重置折叠状态，保留总数与验证状态提示；补齐中英文文案、`aria-expanded`/`aria-controls` 无障碍属性及交互样式。

### Fixed

- 恢复托管会话行的官方重命名、归档及归档恢复入口：`pin`、`rename`、`archive` 视为不创建 Session、不改变 Workspace 归属的安全官方操作，alpha、next、modern 三版 Client 派生同步放行其原生菜单与回调，并在 `uiWorkspace` 实例上保存 guard，避免 Cordis Context 派生丢失引用；Fork 等可能破坏托管归属的操作继续被阻止，安全操作也不再依赖拓扑加载完成。新增三版真实回调回归测试。
- 托管会话处于 working 状态时仅隐藏行内 Worktree 文字标签，保留 Worktree 图标、官方运行指示器、完整悬停状态（modern 在官方 HoverCard，旧派生在分支原生 tooltip）及其他状态标签；新增三版行组件渲染回归，不装饰普通会话。

### Documentation

- README 与使用指南的安装/排错示例更新到 `0.10.0`，环境要求按 Host 版本分线（`0.10.0` 面向 DSH `0.2.0-rc.2`；`0.1.x` Host 继续使用 `0.9.x` 插件线），并说明刚发布的版本可能被 `minimumReleaseAge` 供应链防护静默回退到旧版，需显式指定精确版本安装。

### Fixed

- 侧栏 Worktree 徽章只剩状态、看不到分支名（2026-10-23）：`src/client/workspace-sidebar/model.ts:59` 早已把标签拼成 `${stateLabel} · ${task.sourceBranch}`，但现代侧栏走的是脚本装饰的官方 Browser，装饰里的 `managedWorktreeDecoration`（`scripts/workspace-sidebar-upstream.mjs`）只用 `value.state` 去查 i18n 状态文案、把模型算好的 `value.label` 整个丢掉，于是徽章恒定只显示「进行中 / 待验收 / 已完成」，分支名永远不出现——宿主侧 `dsh-git-worktree` 的投影一切正常，断点在最后一跳的渲染。装饰改为「优先用 `value.label`，缺失才退回 `dshGitWorktree.state.*` 文案」，并给徽章加 `title`（`.dsh-git-worktree-sidebar-badge` 宽度从 76px 放宽到 168px，超长时 ellipsis，悬停仍可读全文）。验证：`npx tsc --noEmit` 0 错误；`npx vitest run tests/client-workspace-sidebar-model.test.ts tests/client-workspace-sidebar-profile.test.ts` 24 passed；`npm run build` 通过且 `lib/client.js` 内含新判据；用真实台账 `C:/Users/ik/.dsh/plugins/dsh-git-worktree/managed-checkouts.json`（12 条记录 / 9 个拓扑任务）跑 `lib/client/workspace-sidebar/model.js` 投影，标签实际产出为 `进行中 · chore/dsh-rc2-upgrade-20260925`、`进行中 · feat/local-adaptation-20260926`、`进行中 · main`、`已放弃 · fix/sess-session--dock-action-click` 等，分支名已随状态一同显示。

- 存量 detached Worktree 交付必报 `stale_isolated`，adopt 出的分支还会丢掉原主题（2026-10-23）：挂会话分支的能力是本轮新增的，修复前创建的记录一律是 detached HEAD 且没有 `sessionBranch`。这类记录交付时走 adopt 分支——但 adopt 原本写在 `operateFinish` 里，即**先补建会话分支再重算指纹**，而 `snapshotFingerprint`（`src/session-checkout-apply.ts:588`）把 `headRef` 也算进哈希，detached 记 `DETACHED`、挂分支记 `refs/heads/feat/sess-…`，两个指纹必然不同，于是每条 legacy 记录交付都会被自己的 adopt 动作判成「验收后 Worktree 又变了」。修法是把挂分支提前到 `markReadyForReview`（`src/session-checkout-module.ts:1625`）：先 `ensureSessionBranch` 再 `inspectReview`，验收指纹从此覆盖交付期真实的 HEAD 身份，交付阶段不再改变它。同时补两处配套：①`ManagedCheckoutRecord` 新增 `sessionTopic`（`src/ports.ts`），创建与 `begin_next_iteration` 时持久化 agent 给的主题——adopt 时若不沿用它会退回 `record.projectName`，adopt 出来的分支名就跟创建时不是同一条（实测 `feat/sess-owner--Project` 而非 `feat/sess-owner--adopt`），胶囊上的分支名也会跟着漂移；②`attachSessionBranch` 遇到同名分支已存在时不再一律跳过换名，改为「正指向当前 HEAD、或可作为快进祖先（`isAncestor`）」才复用，否则换下一个候选名，绝不覆盖带着别的提交的同名分支。验证：`npx tsc --noEmit` 0 错误；全量 `npx vitest run` 48 files / 639 passed + 4 skipped（exit 0）；新增 `tests/session-branch-adopt.test.ts`（构造 legacy detached 记录 + `sourceRef` 指向别人分支，断言 adopt 后分支为 `feat/sess-owner--adopt`、提交只在其上多一个、`sessionBranch`/`sourceRef` 回填、别人的 ref 不被创建、Local 仍是 `refs/heads/main`）与 `tests/session-branch-label.test.ts`（创建后与交付后，`control.current` 的 `currentBranch`/`sourceBranch` 都等于会话分支）。顺带把 `CHANGELOG.md` 里此前重复插入的两份包头与一份被取代的旧稿清掉。

- 发布门禁恒失败：Remote 方法白名单缺 `clearSidebarBadge`（2026-10-22）：`scripts/check-publish.mjs` 的 `expectedRemoteMethods` 停在 33 个方法，而 82a3e31 新增的 `clearSidebarBadge` RPC 早已登记进 `./typert` 与 `./remote` 的共享 descriptor 数组，于是 `npm run check:publish` 恒定报 `manual Remote methods differ from the required surface: … beginNextIteration, clearSidebarBadge, gitCreateBranch …`——门禁与被门禁的对象长期不同步，任何人跑发布检查都会看到一条与本次改动无关的红灯。按 descriptor 实际顺序把 `clearSidebarBadge` 补进白名单（`beginNextIteration` 之后）。验证：`npm run check:publish` 全部 ok（`manual strict ./typert + ./remote contribution (34 methods)`、`all checks passed`）。

- 交付把改动写进**别人的分支**：Worktree 身份改为「会话自己的分支」，交付只在会话分支提交、Local 完全不动（2026-10-22）：用户报告并行会话场景下，`worktree_create(topic=…)` 时 Local 停在另一个会话的主题分支 `fix/sess-session--dock-action-click` 上，插件未校验归属就把 `sourceRef` 记成它并从其 HEAD 分叉，十二轮编辑后 `worktree_deliver` 又把提交 `update-ref` 写回同一分支——7 个文件修复混进他人分支，还污染了对方工作区。根因是身份错位：`sourceRef` 取的是「Local 此刻 HEAD 在哪」（`src/session-checkout-module.ts` 的 `bindTarget` 里 `sourceRef: snapshot.headRef`），而 Local HEAD 是**多会话共享的可变状态**，不是本会话的事实。改为按「本会话 + 主题」派生身份：新增 `createSessionBranchCandidates`（`src/managed-worktree-path.ts`：`feat/sess-<会话>[--<主题>]`，重名兜 `-2`…`-5`）与 git 端口 `attachWorktreeBranch(managedRoot, branchRef, headOid, expectedOldOid)`（`src/adapters/git.ts`：`update-ref` + `symbolic-ref`，只动 ref 与 HEAD 指向，不碰工作区，创建路径原有的 read-tree/checkout-index/证据回滚全套校验照旧），创建与 `worktree_begin_next_iteration` 成功后立即挂分支并把记录的 `sessionBranch`/`sourceRef` 与 binding 改记会话分支；交付链整段重写为「`reviewIsolated` 算隔离侧指纹 + `commitIsolated` 在 Worktree 内 `commit-tree` 后推进分支」，删掉 `plan`/`preview`/`finalize` 三段写 Local 的旧路径（journal step 相应改为 `committing_session_branch`），`proof.localBranch` 记会话分支、自动 push 改推该分支（新分支无 upstream 时退化为「已跳过」备注，绝不误推 Local）。由此连带修掉三处同源缺陷：①对话栏分支标签丢失——胶囊 `TargetStatusAction` 的主标签取 `target.currentBranch`，而 detached Worktree 的 `inspect().branch` 恒为 null，胶囊只好回退成「Worktree · 状态」，worktree 挂上分支后标签自然恢复；②迭代链断裂——交付不再写 Local 后若仍以 Local HEAD 为基点，上一轮提交会整段丢失（`tests/git-unborn.test.ts:253` 的 `expected 'base\n' to be 'iteration one\n'` 即此症），改为以 `resolveLocalBranchTip(predecessor 会话分支)` 为 `iterationBaseOid`，解析不到才退回 Local HEAD；同处还把回填后的 binding（`sourceRef`/`sourceOid` 指向新会话分支）用作返回 target 视图的依据，否则创建完成那一瞬间的 target 仍报着旧分叉点；③checkpoint 只能写 detached Worktree——`update-ref --no-deref HEAD` 在符号 HEAD 下会把 HEAD 写成脱离分支（`src/session-checkout-apply.ts`），改为 `headRef` 非空时用 `update-ref <branchRef>` 推进分支，并把「必须是 detached」断言放宽为「HEAD 指向不变」。配套修掉用户报告的四条：②交付快照把宿主运行期产物并进比对——新增 `src/delivery-excludes.ts`（`HOST_RUNTIME_ARTIFACTS=['.dsh-ops','desktop-runtime.json','.dsh-runtime.json']`，每个名字生成 `:(exclude)N`/`:(exclude)N/**`/`:(exclude,glob)**/N`/`:(exclude,glob)**/N/**` 四条 pathspec），`captureSnapshot` 与 `commitIsolated` 统一透传，`.dsh-ops/` 不再进评审变更集、交付提交与清理指纹；③`apply_conflict` 只说路径不说原因——新增 `explainApplyConflict`（先 `listUntrackedFiles` 命中判 `untracked_conflict`，再 `status().dirty` 判 `local_dirty`，否则 `content_conflict`），`reason` 类型扩为三值并附 `resolveHint` 给出可执行命令；④写保护 hook 也按写入方向判定：宿主持久 hook `worktree-write-guard.js`（在`C:/Users/ik/.dsh/hooks/`，不在本插件仓库也不在宿主 asar 内）原先对 bash 命令只做「命令文本是否包含Local 路径」的子串匹配，不区分该路径是读取源还是写入目标，于是 `cp "<Local>/x" "<worktree>/x"`（Local 只是读取源）与 `git -C <Local> status` 一并被误拦；改为 `analyzeCommand` 先按 `;`/`&&`/`||`/`|`/换行切段、再逐段切词，只认真正的写入目标（重定向、`cp`/`mv`/`rsync`/`install`/`ln`/`scp` 的目标参数、`touch`/`mkdir`/`rm`/`tee`/`chmod` 这类全体参数即目标、`dd of=`、`sed -i`、`sort -o`、`find -delete`、PowerShell 写 cmdlet、git 只读与写子命令分流、内联 `node -e writeFileSync` 等），只有写入目标落在 Local才拦；同一处还修掉两处判据 bug——双引号内 Windows 路径的反斜杠只在应转义的字符前才算转义（原先一律吞掉反斜杠，导致 `"E:\\ik\\…"` 被咬碎、绝大多数写入目标匹配不上）；以及 `normalize` 折叠重复分隔符，使内联脚本里的 `E:\\\\ik\\\\…` 与台账的 `E:\\ik\\…` 可比。验证：方阵自测 36 条（16 条「Local 仅作读取源 / 只读子命令 / 写入 worktree」必须放行，20 条「写 Local」必须拦截）全通过；端到端自测 18 条（真实子进程 + 假台账经 `DSH_WORKTREE_LEDGER` 注入 + 真实 stdin 载荷，覆盖 edit/write/bash 三工具、裸 UUID 的 UI 隔离会话不受约束、四条交付后放行、台账损坏 fail-open）全通过；两份自测留在 `C:/Users/ik/.dsh/hooks/__tests__/` 便于回归。⑤交付后「人已在 Local 却禁止写 Local」——`runtimeContext` 新增 finalized/retained 且 cwd 已在 worktree 之外的措辞分支，明说「Working boundary 是 Local、普通 Local 工作已恢复、提交在会话分支、合并是 worktree_merge、新改动先 begin_next_iteration」，不再输出「Isolated Checkout + write-guard 拦 Local」的自相矛盾状态；另把 `worktree_merge` 的归属校验做到能区分「不是本会话的」与「属于另一个会话 X 的分支」（新 host message `worktreeMergeSourceBelongsAnotherSession`），并给 apply/preview/finalize_preview 三条旧写 Local 路径加闸（会话分支存在即拒绝并指向 deliver→merge）。验证：`npx tsc --noEmit` 0 错误、`npx vitest run` 46 files / 635 passed + 4 skipped（exit 0）、`npx vitest run tests/session-branch-delivery.test.ts` 2 passed；新增回归测试 `tests/session-branch-delivery.test.ts` 两条（①复现用户场景：Local 停在他人分支并带未提交文件，创建后断言 Worktree 分支为 `feat/sess-owner--sleep-wake` 且不等于他人分支，交付后断言提交只在会话分支、`rev-list` 只多一个提交、`show --name-only` 只有被改文件、`.dsh-ops/` 不在变更集，Local 的 HEAD/当前分支/未跟踪文件/索引全部原样，`refs/heads/main` 未动；②两个会话同 topic 各得自己的分支），既有断言同步改为「提交在会话分支」语义（`tests/session-checkout-module.test.ts` 两处、`tests/git-unborn.test.ts` 两处、`tests/host-query-budget.test.ts` 的 preview 度量改走 deliver 并给出新预算 90）。

  胶囊侧另补一层兜底：即便 Worktree 一时不可观察（冻结/已清理/瞬时失败导致 `inspect().branch` 为 null），投影也不再塌成裸状态标签——`projectDetails` 的 `currentBranch` 改为「实时 Git 优先、记录里的 `sessionBranch` 兜底」，侧栏与 target 摘要的 `sourceBranch` 也改为「会话分支优先于 `sourceRef`」（legacy 记录的 `sourceRef` 可能是别人会话的分支，拿它贴标签会重演归因错误）；两条回归测试钉住「detached 观测下仍显示会话分支」与「无会话分支的 legacy 记录回落 `sourceRef` 且不凭空造分支名」（`tests/console-host.test.ts`）。

- 新建会话卡顿：Session Target 胶囊挂载即预取分支总览（2026-10-22）：`TargetStatusAction` 此前在 mount 时无条件 `ensureBranchOverview()`，而这个胶囊对**每个**会话都挂载，于是每开一个新会话就白付一次 `gitOverview` 的 git 子进程成本（`projectRootFor` 的 `git inspect` + `branchOverview` 的 `for-each-ref` 与 `status --porcelain -uall`，实测该仓库约 0.5s 量级，其中 `status -uall` 一项就 170ms/585k pack 对象）——用户根本没打开 popover。改为按需：删除挂载期预取 effect，`branch-overview-cache` 的 60s TTL + flights 单飞缓存保留；popover trigger 的 onClick 先试 `refreshBranchOverviewInBackground()`（有快照则 stale-while-revalidate），返回 `null`（无缓存）时才 `ensureBranchOverview()` 真拉一次。副作用仅限「会话刚打开、首次展开 popover」多等一次请求，之后仍走缓存。验证：typecheck 0 错误、`pnpm run build` 通过（lib/client.js 1125.44 kB）、全量 45 files / 631 passed + 4 skipped；新增回归测试 1 条（挂载后 `fixture.calls` 无 `gitOverview`，点击 trigger 后才出现且分支列表渲染出来）。

- 已完成 Worktree 的 owner 会话分支胶囊仍显示「不可用」（2026-10-19）：10-18 的 settled-owner 修复只放行 `phase:'discarded' + delivery.state:'delivered'`（清理完成态），而交付默认保留策略是 `DEFAULT_WORKTREE_RETENTION='retain_24h'`（`src/types.ts:39`）——交付后 24h 内记录停在 `phase:'retained' + delivery.state:'retained'`（cleanup pending 则为 `phase:'finalized' + state:'finalized'`），owner 会话 cwd 已切回 Local 但 `expectedRoot` 仍是 `managedRoot`，`verifyCallerRoot`（`src/console-host/control-plane.ts:228`）落 258 行 `project_mismatch`（「当前 Session cwd 与 Worktree 授权边界不一致」），分支胶囊轮询 error 态显示「不可用」。任务侧 `consoleStateFromDomain`/`worktreeReachedDelivery`（`src/console-contract.ts`）本就把 delivered/finalized/retained 三种都视为完成终态，门禁侧却只认一种。修复：抽出 `deliveredToOwner` 谓词（owner + `delivery.state ∈ {delivered, finalized, retained}`），`cleanedOwnerCwd` 与 `settledOwner` 两处放行条件统一复用——交付事实成立即以 Local 边界（canonicalize 后等于 `record.localRoot`）放行 owner 只读访问，不再要求 phase 必须为 discarded；非 owner 会话、Local 边界不匹配的记录仍走原 `project_mismatch` 拒绝路径。验证：typecheck 0 错误、`pnpm run build` 通过（lib 已重建，host 侧需重启桌面应用生效）、全量 45 files / 630 passed + 4 skipped；新增回归测试 2 条（retained 保留期内 owner `control.current` 成功且投影 `state:'retained'`、finalized cleanup pending 时 `control.inspect` 成功且投影 `state:'cleanup_pending'`，均以 ownerLocalLookup 模拟真实 owner cwd 在 Local）。

- 已交付 Worktree 的 owner 会话显示「不可用」（2026-10-18）：cleanup 成功后记录落成 `phase:'discarded' + delivery.state:'delivered'`，managedRoot 随即被删；而 `authorize` → `verifyCallerRoot`（`src/console-host/control-plane.ts:228`）对 owner 仍以 `record.managedRoot` 为授权边界，`canonicalize(project.root)`（Local 根）永远不等于那个已删除的目录，于是 `project_mismatch`——target chip 落 `error` 态、显示 `t("unavailable")`（「不可用」），错误明细是「当前 Session cwd 与 Worktree 授权边界不一致」，已交付任务的只读历史与分支面板全部打不开。修复：`verifyCallerRoot` 增加 settled-owner 分支——owner + `phase:'discarded'` + `delivery.state:'delivered'` 时，只要会话项目根与 `record.localRoot` canonicalize 后一致，就以 Local 根为授权边界放行；原有「项目根本身已被移除」的 cleanedOwnerCwd 分支保留（legacy handoff 场景）。验证：typecheck 0 错误、`pnpm run build` 通过（lib 已重建：host 侧需重启桌面应用生效）、全量 45 files / 628 passed + 4 skipped；新增测试 1 条（owner 在已交付记录上 `inspect` 成功且投影 `state:'delivered'`），并把既有 delivered proof 投影测试的 lookup 改成真实形态（owner 会话的项目根是 Local，不是 managedRoot）。

- Worktree 生命周期审计的待决策项与技术债收口（2026-10-18）：①`worktree_merge` 缺 acceptance 互斥（P2）：`mergeBranchForSession` 只校验 sourceBranch 归属，未查项目级 acceptance slot——另一个会话 preview/finalize/finish 期间，真实合并会绕过 preview 收据直接改写 Local，绕过 checkpoint/preflight 已有的 `project_acceptance_busy` 门禁。改为写操作前复用 `findProjectAcceptanceHolder`（新增 `includeSelf` 选项：本会话自己持有同一 Local 的预览时同样拒绝，因为 merge 会在该 Local 执行写命令）；`dryRun` 仍放行（只在临时 worktree 试合，不改工作树）。②`operateRecover` 遇 journal 一律拒绝（P2）：`recovery_required` + 非 create journal（或 `phase:'mutating'`）原先只能干等 reconcile。改为在已持有的 binding 锁内调用内部 `reconcile()`，重读记录，仅在收敛为 `ready` 且 journal 清空时继续 `validateManagedCheckout`，否则保留原 `recovery_unsafe` 拒绝——「恢复」按钮不再空转。③终态记录可被 Recover 复活（P3）：已交付（`delivery.state:'delivered'`）或 finalized/retained 的记录只要目录残留，recover 的 `validateManagedCheckout` 会把 phase 改回 `ready`，已完成任务重新出现在进行中列表；新增终态门禁返回 `operation_not_allowed` + 新 host message `thisWorktreeHasAlreadyReachedATerminalDeliveryState`，收口仍交给 reconcile/cleanup。④trunk 硬编码与合并基准错误（P3）：`pruneMergedBranchesInRepo` 写死 `main`/`master`，且以当前 HEAD 判定「已合并」——会话停在 feature 分支时，已合入主干的兄弟分支因「未合入当前分支」永远删不掉。git port 新增可选 `defaultBranch()`（`origin/HEAD` → `init.defaultBranch`，不猜 main），trunk 判定带上推断值，合并基准改为 trunk tip，trunk 未知或本地不存在才回退当前 HEAD。⑤cleanup 原因靠本地化文案反推（P3）：`retryableCleanupBlock`/summary 每次从 zh/en 文案关键词反推 `WorktreeCleanupReason`，文案一改即失配；delivery 的 finalized/retained 新增结构化 `cleanupReason` 持久字段，`block()`/catch 写入，读出优先字段、legacy 记录回退文案解析（`persistedCleanupReason`），`block()` 的 reason 参数改为必填。⑥侧栏与面板双份状态判定（P3）：`sidebarTaskState` 与 `consoleStateFromDomain` 各自实现「delivery 优先」，前两轮已因漂移修过；抽出 `worktreeReachedDelivery(phase, deliveryState)` 到 `src/console-contract.ts`，control-plane 复用。验证：typecheck 0 错误、`pnpm run build` 通过（lib 产物已重建：桌面 profile 以 junction 直连仓库构建产物，旧 lib 停在 10-18 13:37，前两轮修复未进 UI——这也是「已完成分支仍显示已放弃」的直接原因）、全量 45 files / 627 passed + 4 skipped；新增测试 6 条（prune 按配置默认分支判合并、merge 在 acceptance preview 中拒绝而 dryRun 放行、终态记录 Recover 不复活、cleanupReason 结构化与 legacy 双路径、`worktreeReachedDelivery` 终态投影）。

### Added

- 侧栏状态标签清除（2026-10-18）：已放弃/已完成（终态）Worktree 的侧栏徽章此前只能等记录被清理（Retention 到期或手动 cleanup）才消失。新增行菜单项「清除状态标签」（zh）/"Clear status badge"（en）：owner 行右键（官方 `sidebar.workspaces.session.menu.item` 槽，order 500）出现该入口，点击经新 RPC `clearSidebarBadge`（descriptor `gitWorktree/clearSidebarBadge`，参数 checkoutId+expectedRevision）走 `manageManagedWorktreeForSession(action:'clear_sidebar_badge')`——幂等且**不 bump record.revision**，仅在 record 上记 `sidebarBadgeClearedRevision = 清除时的 revision`（任何后续 revision 变更自然使标记失效，无需重置路径）；成功后客户端派发 `WORKTREE_REVIEW_REFRESH_EVENT` 触发侧栏刷新。宿主控制面做终态门禁（仅 `discarded`/`finalized` 可清除，否则 `operation_not_allowed`，新 host message `onlyATerminalWorktreeBadgeCanBeCleared`），`sidebarTopology` 对已清除的终态记录**跳过 task 投影**（保留 directory membership 收集），客户端投影随之不再挂徽章/图标/菜单项——记录本体与验收证据原样保留。客户端菜单项在 Browser 挂载时注册（`registerSessionMenuEntry` prop，raw slot 注册绕过 GuardedAction 代理，使入口出现在 managed owner 行），从共享 topology store（useSyncExternalStore）读任务终态决定渲染。验证：typecheck 0 错误、build 通过（lib/client.js 1124.74 kB）、全量 45 files / 616 passed + 4 skipped；新增测试 6 条（module 幂等+不 bump revision、control-plane 终态门禁+topology 抑制、remote descriptor 清单、client 挂载注册+终态门控+RPC 参数+刷新事件）。

### Fixed

- 保留策略两处失效：配额清理从未生效、清理受阻后永不重试（2026-10-18）：①`enforceWorktreeKeepCount`（`src/session-checkout-module.ts:4189`）把超限记录交给 `operateDiscard({confirmDirty:true})` 逐出，但 `operateDiscard` 的门禁是 `phase !== 'ready' && phase !== 'recovery_required'` 即 `operation_not_allowed`（同文件 `:3418`），已交付记录恒为 `finalized`/`retained`——于是 `worktreeKeepCount`（默认 15）**从实现起从未真正清理过任何记录**，每次启动只在 `console.warn` 里刷一条失败。改为直接调用同一套 `cleanupFinalized` 安全链（receipt、quarantine、放弃前快照），逐出语义即「已交付后的安全清理」；失败时记录 `cleanup:'pending'` 并保留重试资格，不再以 operationError 退出。②`cleanupExpiredRetained`（`:4161`）只筛 `cleanup === 'scheduled'`，而 `cleanupFinalized` 失败时把记录置为 `cleanup:'blocked'`（`:2836`）——首次到期清理只要撞上 Windows 文件占用，该记录就**永远不再被到期清理**，worktree 与分支永久留在磁盘。改为额外接受 `retryableCleanupBlock(record)`（`:4148`，覆盖 `directory_busy`/`quarantine_busy` 两类瞬时原因），下一次维护继续清理；`identity_changed`/`modified_after_finalize` 等非瞬时原因仍保持 blocked 不重试，避免对已变形的目录反复动刀。验证：typecheck 0 错误、`pnpm run build` 通过、全量 `pnpm vitest run` 45 files / 619 passed + 4 skipped；新增测试 3 条（配额逐出真清理并断言 `phase:'discarded'`+目录消失、到期清理首次受阻记为 blocked 且第二次继续清理、保留窗口未到期/永久豁免/到期三种状态各自成立）。

- 已交付并清理的 Worktree 被侧栏显示成「已放弃」+ 交付默认立即删环境（2026-10-18）：用户反馈「进行中的会话在退出程序后被自动标记为已放弃」。核对全仓只找到 5 处写 `phase:'discarded'`（`cleanupFinalized`、`operateDiscard` 三分支），全部由显式动作触发，reconcile 从不放弃，也**没有**「退出程序即放弃」的路径；真因是 `sidebarTaskState`（`src/console-host/control-plane.ts:113`）判断顺序缺陷——`phase === 'discarded'` 排在 delivery 检查之前，而交付成功后的清理终态正是「`phase:'discarded'` + `delivery.state:'delivered'`」（台账 5 条实据，deliveredAt 10-12 起），于是 `:119` 的 `delivered → 'finalized'` 永远轮不到，重启后这些已完成会话全挂「已放弃」。修复：delivery 优先于 phase——`delivered`/`finalized`/`retained`（或 `phase` 为 `finalized`/`retained`）一律 `'finalized'`（已完成），`'discarded'` 只留给「discard 且从未交付」的真放弃；`sidebarTopology` 的徽章清除抑制与 `clearSidebarBadge` 门禁本就同时接受两个终态，行为不变。同一处根因的第二半：交付默认 `retention` 由 `cleanup`（立即删环境）改为 `retain_24h`（保留 24h 后由 retention timer 自动清理），交付后误删不可挽回就此消除。默认值收敛为单一常量 `DEFAULT_WORKTREE_RETENTION`（`src/types.ts`），替换 7 处散落的 `'cleanup'` 字面量：`src/tools.ts` 的 `parseWorktreeRetention`、`src/session-checkout-module.ts` 四处 `input.retention ?? …`（finalize_preview/finish 的 journal 与 retention）、`src/commands.ts` 的 `/worktree finalize` 默认；客户端 `ReviewActions` 的保留开关默认勾选（`DEFAULT_RETAIN_ENVIRONMENT`，同时修正了原本在 useEffect 里把它重置为 false 的隐藏默认），按钮随之默认「确认交付并保留环境」，工具描述文案（`worktreeDeliverRetention` zh/en）改为 retain_24h 为默认。显式传 `cleanup` 的调用方（含既有测试）语义完全不变。验证：typecheck 0 错误、build 通过、全量 `pnpm test` 通过；测试同步：`sidebarTopology` 用例改为断言「delivered+discarded → finalized」并新增一条真放弃（discarded+working → discarded）钉住区分，`surface` 默认 retention 断言改 retain_24h，`client-review-console` 五处改为断言默认勾选与 retain_24h。

- 审核修复：控制面门禁与状态词表四处偏差（2026-10-18）：对 Worktree 生命周期做整体审计与情景测试，修掉 1 个 P1 与 3 个 P2。①`src/console-host/control-plane.ts:1269` 的 RPC 门禁只接受 `predecessor.managedRoot`，而 in-place 会话交付后 workspace 已 leave 回 `localRoot`、managedRoot 又被清理删除 —— 面板「开始下一轮」按钮恒 `project_mismatch`（工具路径 `beginNextIterationTarget` 早已两者皆接受，`src/session-checkout-module.ts:4241`），改为两者皆接受并补注释。②详情面板把「真放弃」显示成「已交付」：`consoleStateFromDomain`（`src/console-contract.ts:58`）把 `phase === 'discarded'` 一律投影为 `delivered`，而 `operateDiscard` 只改 phase 不动 delivery（`src/session-checkout-module.ts:3394/3412/3483`）——侧栏写「已放弃」、面板 chip 写「已交付」，同一记录两套说法。修法：`WORKTREE_CONSOLE_TARGET_STATES` 补 `'discarded'`，函数改为 delivery 优先（`delivered → delivered`，`phase discarded → discarded`，discarded 保留放弃前的 delivery 上下文），客户端 `STATE_LABELS`/`ATTENTION_RANK`/`TargetStatusAction` 与 `target-console.styles` 两处 `delivered` 选择器同步补 `discarded`（复用既有 i18n key）。③`needsAttention` 白名单只放行 `cleanup_pending`/`recovery_required`（`src/console-host/control-plane.ts:733`），而 `summarizeManagedWorktree` 把 `preview_detached` 也归入 `needs_attention`——预览漂移的记录在「需要关注」筛选里永远看不到，改为三态放行。④`gitSwitchBranch` 的「交付期禁止切 Local 分支」只匹配 `record.ownerSessionId`（同文件 `:643`），最常发起切分支的 Local source 会话（身份是 `sourceSessionId`）完全不受保护，改为 owner 或 source 任一匹配即拦。验证：typecheck 0 错误、`pnpm run build` 通过（lib/client.js 1125.51 kB）、全量 `pnpm test` 45 files / 622 passed + 4 skipped；新增测试 3 条（in-place 门禁放行并做回退反证、preview-detached 进入 attention 列表、source 会话切分支被拦）+ discarded 三条投影断言。

- 审核修复：会话 cwd 与 worktree 生命周期六处缺陷（2026-10-18）：对上一轮 cwd 改造做代码审核，修掉 3 个真 bug + 1 处浪费 + 2 个连带死锁。①`leave` 失败仍继续删 checkout（`src/tools.ts` 的 `leaveCheckoutBeforeRemoval`、`src/commands.ts` 的 `leaveCheckout` 原本只有 `Promise<void>` 且吞掉异常）→ 会话 cwd 会悬空指向已删目录；改为返回失败原因，`worktree_deliver`/`worktree_cleanup` 与 `/worktree finalize|deliver|discard|cleanup` 四个 verb 在失败时**中止删除**并回报原因（新增 host message `worktreeCwdCouldNotBeRestoredBeforeRemoval`）；deliver/discard 失败后还会 `enterCheckout` 把会话送回 checkout（否则先 leave 再失败就把会话丢在 checkout 之外）。②`runtimeContext` 的 cwd 判定用 `pathsEqual`（只判相等）→ 会话 `cd` 进子目录后被误判为「不在 worktree 内」而重新施加绝对路径规则；新增 `pathIsWithin` 改判包含关系。③`worktree_begin_next_iteration` 的 workspace 校验只接受 `ownerWorkspace.root === predecessor.managedRoot`，而 in-place 会话的 workspace 始终是 `localRoot`，且 `managedRoot` 在交付清理后已删除 → 每一轮 in-place 的下一轮都必然抛 `project_mismatch`（用过一次交付就无法再开新迭代）；改为两者皆接受。④`enterCheckout` 走 `resolveManagedRoot`（Git IO + 全局锁，校验失败即放弃）→ 改以纯台账 `resolveRoots` 优先、`resolveManagedRoot` 仅作回退。⑤交付并清理后 `runtimeContext` 仍宣称 `Authoritative cwd: <已删除目录>` + 「只许写 authoritative cwd」，而 `~/.dsh/hooks/worktree-write-guard.js` 又拦住 Local 写入 → 两处都写不了，会话被彻底锁死；`runtimeContext` 新增 delivered+discarded 分支明确「Local boundary 恢复为工作边界，ordinary Local work 允许」，hook 同步在 `phase === 'discarded'` 或 `delivery.state === 'delivered'` 时放行。验证：typecheck 0 错误、build 通过（lib/client.js 1121.15 kB）、check:publish all checks passed、全量 45 files / 612 passed + 4 skipped；新增回归测试 4 条（cleanup 在 cwd 移出不成功时不删目录、子目录 cwd 不重新施加绝对路径规则、in-place 下一轮能启动、delivered 态不再宣称已删目录），其中 in-place 下一轮与 delivered 态两条做过回退修复的反向验证（回退后失败、恢复后通过）。

### Added

- 会话内直接切进 Worktree（官方 `create_worktree` 机制对齐）（2026-10-18）：此前 `worktree_create` 虽把 checkout 绑到当前会话（in-place），但**会话 cwd 仍在原目录**，模型必须靠绝对路径绕行、UI 卡片还催用户「打开隔离会话」再开一个新对话。根因是与官方实验包 `@deepseek-ai/dsh-experimental-worktree` 的最后一环缺失：其 `WorktreeService.create()` 末尾执行 `ctx.workingDirectory.set(agent, path)`，这才是「会话真的进去」的唯一机制（`packages/session/working-directory`，`get` 同步读投影 / `set` 校验目录存在后 commit 并注入 user 可见的 cwd 变更消息 / `ensure` 目录消失时回退 `header.cwd ?? defaultDirectory`）。新增 `src/adapters/working-directory.ts`：`createSessionWorkingDirectoryPort(ctx)` 用 `ctx.get('workingDirectory')` 动态解析（cordis `get(name, strict)` 对非 ACTIVE 服务返回 undefined），导出 `current`/`enter`/`leave` 三态端口——宿主未挂载该服务时 `enter` 返回 `undefined`（不谎报 cwd），插件退回既有 guidance 行为。接入点四处：①`worktree_create` 成功后 `enter` 新 checkout，输出新增 `cwd`/`cwdSelected`；②`worktree_begin_next_iteration` 同样进入重建的 checkout；③`worktree_deliver` / `worktree_cleanup`（工具层）与 `/worktree finalize|deliver|discard|cleanup`（命令层）在可能删除 checkout 前 `leave` 回 `localRoot`，避免会话 cwd 指向已删除目录；④`src/session-target-context.ts` 把 `port.current(context.agent)` 传给 `runtimeContext(sessionId, cwd?)`，原先靠 `sessionId.startsWith('session-')` 猜「cwd 还在 Local」的粗略判断改为 `pathsEqual(cwd, record.managedRoot)` 精确判定，只有确实不在 worktree 内才注入绝对路径警告；`pending` 记录 owner 就是本会话时不再误报「handoff pending，请打开隔离会话」，改为「本会话已拥有 checkout，勿重复创建」。配套新增 `resolveRoots(checkoutId)`（纯台账读，无 Git IO）。`worktree_create` 另增可选 `branch` 参数（对齐官方 `create_worktree({name,from})` 的 `from`：以指定本地分支 tip 为起点，走既有 `resolveLocalBranchTip` 端口）。UI 侧 `WorktreeCreateRow`：`cwdSelected` 为真时不再渲染「打开隔离会话」按钮（那条路径会 `sessions.create` 出第二个会话），只显示状态行。验证：typecheck 0 错误、build 通过（lib/client.js 1121.15 kB）、全量 45 files / 607 passed + 4 skipped；新增 `tests/working-directory-adapter.test.ts`（enter 真移动 / 无服务降级 / current 不抛 / leave 仅在内含时回退 / 前缀相近的兄弟路径不误判）、`tests/surface.test.ts` 两条（cwdSelected 真值与无服务时 false）、`tests/client-toolview.test.tsx` 一条（cwdSelected 时不渲染开会话按钮且不 create 第二会话）。

### Fixed

- `worktree_list` 在真实宿主报 "uplink item is not a lossless JSON value"（2026-10-18）：真实会话内调用时工具直接失败，而 `tests/surface.test.ts` 全绿——测试断言的是模块方法返回值，不经过宿主工具输出通道，所以这个 bug 在测试里天然不可见。根因是 `src/tools.ts` 输出对象里有**存在但值为 `undefined` 的键**：`commitOid: summary.commitOid ?? undefined`（`?? undefined` 等于没兜底），未提交的 checkout 正好走到这条路径；宿主 `packages/api/gateway/src/client/index.ts:579` 的 `isRemoteUplinkItem` 逐键校验，`undefined` 不算 lossless JSON 即抛错（`packages/api/gateway/src/gateway-stream-protocol.ts:167`、`packages/api/gateway/src/client/remote-events.ts:248` 是同一套校验）。修复：改为条件展开 `...(summary.commitOid ? { commitOid: summary.commitOid } : {})`，键直接不出现——`commitOid` 类型是 `string | null | undefined`，只判 `undefined` 会让 `null` 漏过去，故用真值判断。同族隐患复查：`worktree_create` 的 `cwd`、`worktree_deliver` 的 `push`/`report`、`worktree_cleanup` 的 `cleanupMessage`、`worktree_merge` 的 `localBranch` 早已是条件展开写法。验证：typecheck 0 错误、`pnpm test` 45 files / 607 passed + 4 skipped、build 通过（lib/client.js 1123.41 kB）。

- web boot 双崩溃根因修复：ui-workspace 条件 disabled 表达式改为 Host 侧 Loader 选举（2026-10-17）：桌面 0.2.1-rc.2 两次 `17 entries did not activate` web boot 崩溃（crash-2026-10-17T10-11-18 与 T12-25-38，同签名）根因闭环——cordis.patch.yml 给官方 `@deepseek-ai/dsh-client-ui-workspace` 条目挂的 `disabled: !!js "!!get('worktreeWorkspaceProvider') && ..."` 表达式在两个不同时刻求值出相反结果：①Host 侧插件 apply 期间，插件 fiber 仍处 LOADING（state=1），cordis strict 服务读要求 ACTIVE（state=2）才返回值，`get('worktreeWorkspaceProvider')` 恒 undefined → 表达式 false → 接管选举失败 → officialWorkspaceActive=true → client 走 decorate 分支不 provide uiWorkspace（sidebar-diag `decorate-pending` 实证）；②renderer 审计在 loader.await() 之后跑，此时插件已 ACTIVE，同一表达式求值 true → 官方条目被 skip 不启动 → uiWorkspace 无人提供 → 17 个下游条目 pending → StartupError → bootFailed 崩溃。同一表达式依赖求值时刻的 fiber 状态，机制根本不成立（同构探针实锤：apply 中求值 false、loader.await 后重读 true）。修复：彻底删除 patch 的 disabled 表达式块（cordis.patch.yml 仅留 insert 插件条目），`src/workspace-provider-lifecycle.ts` 重写为 Host 侧确定性选举——owned() 只按条目名匹配（不再文本匹配 `__jsExpr`），接管用 `entry.update({disabled:true},false,true)` 写普通布尔（所有后续读取确定性），adopted 集合记录本方禁用条目、teardown 时 restore（`{disabled:null}` 删键）；用户先行禁用的官方条目永不触碰（overridden）；遗留 `__jsExpr` 条件视为本方所有（升级替换）；插件自身条目被 market 禁用（replay）时 selfDisabled() 守卫让位官方 provider，re-enable 后事件重入正常接管。配套：`scripts/check-publish.mjs` 门禁改为「patch 不得含任何 `!!js` 表达式、不得 patch 官方 ui-workspace 条目、WORKSPACE_PROVIDER_CONDITION 导出必须退役」，expectedRemoteMethods 清单更新为 33 方法（缺 clientBootReport/gitOverview/gitGraph/initProject/setPermanent/gitCreateBranch/gitSwitchBranch/gitPruneMergedBranches/listAbandoned/restoreAbandoned——HEAD 版该门禁先在旧 patch 断言处失败，非本次引入）；`tests/workspace-provider-lifecycle.test.ts` 适配新语义（25 测试）、`tests/client-workspace-sidebar-profile.test.ts` 改断言 patch 不含官方条目/表达式。验证：typecheck 0 错误、build 通过（lib/client.js 1120.63 kB）、全量 44 files/599 tests passed + 4 skipped、check:publish all checks passed。

- 桌面宿主 0.2.1-rc.2 判定插件「与当前 dsh 不兼容」（2026-10-17）：宿主 `evaluatePluginCompatibility`（app.asar 反编译核验）对每个 `@deepseek-ai/dsh-*` peer 用**无选项** semver `satisfies(runtimeVersion, range)` 逐一判定，任一 UNMET 即整包 incompatible；`dsh-client-locale` 的精确版本清单止于 `0.2.1-rc.1`，对 rc.2 全部不命中（精确版本 range 不含 prerelease 向上匹配）。修复：locale peer 清单追加 `|| 0.2.1-rc.2`（其余 13 个 `^0.2.1-rc.1` peer 实测已命中 rc.2，无需动）。宿主另有 `dsh plugin allow-version` 豁免机制（name@version 精确键），但 peer 对齐优于每次升级手动豁免。验证：semver 逐项复测、typecheck 0 错误、host-compat 测试 3/3。

- root inject 静态继承 remoteAccess 导致 0.2.0-rc.2 桌面 web boot 全崩（2026-10-17）：0.2.1-rc.1 适配（cb03f32）构建的新 client.js 通过官方 workspace 内联把 0.2.1 新增的 `remoteAccess` 服务静态并入根 `inject`；桌面 profile 以 junction 直连插件仓库构建产物，0.2.0-rc.2 宿主 renderer 无该服务 provider，插件 entry 永久 pending(waiting for service: remoteAccess)，连带整页 `14 entries did not activate`，DSH 无法启动（logs/web-boot 10-17T10:11Z 崩溃即此）。修复：root inject 在既有 `remote.directoryPicker` 过滤上同模式追加过滤 `remoteAccess`（版本敏感服务不进根 inject 的纪律正式化，教训已记全局规则）；managed 分支的 officialContextProxy 对 `ctx.get('remoteAccess')` 返回宿主值或无害 stub `{source:()=>({})}`（内联官方 apply 仅读 `.source`），使用点声明面不变。配套 `tests/client-bundle.test.ts` inject 断言移除 remoteAccess 并新增 not.toContain 防回退断言。验证：typecheck 0 错误、build 通过、全量 44 files/599 tests passed + 4 skipped。桌面 profile 的插件挂载在崩溃后被 18:26 清理移除（非本修复范围），重启后需重新挂载。

### Changed

- 适配宿主 0.2.1-rc.1（2026-10-17）：全量对照 npm 0.2.1-rc.1 与桌面 app.asar 解包验证。①peerDependencies：14 个 host 包追加 `|| ^0.2.1-rc.1`，dsh-client-locale 精确清单追加 `|| 0.2.1-rc.1`；devDependencies 全部 0.2.0-rc.2→0.2.1-rc.1（alpha/next 别名 pin 不动）；pnpm-workspace.yaml minimumReleaseAgeExclude 同步扩展。②侧栏闸门：`scripts/workspace-sidebar-upstream.mjs` ui/locale 版本→0.2.1-rc.1、client SHA-256→`52765aac…`（8 个装饰接缝逐一核验在新 client.js 唯一存活，0 改动）。③host-compat：0.2.x 兜底 modern 已覆盖，注释锚点更新为 0.2.1-rc.1；`tests/host-compat.test.ts` locale peer 期望同步。④runtimeContext isolated 分支新增一行引导：宿主实验性 `create_worktree` 工具（0.2.1 新增 OPTIONAL_BUNDLES，默认关闭，创建无台账 `.agents/worktrees` 副本）与本插件受管 checkout 无关，隔离交付/合并/清理一律走 worktree_* 工具。⑤B 组遗留处置：上会话遗留的 cordis.patch.yml 移除表达式与 lifecycle.ts `get→ctx.get` 改动经宿主机制调研后回滚——0.2.1-rc.1 的 cordis-plugin-loader 1.0.5 用 `with(ctx){eval(expr)}` 在 host 侧 Entry.ctx 求值（Loader 构造即 provide 'loader' 服务），且表达式因 `&&` 短路在 `enableWorkspaceProvider:false`（本 profile 现状）下永不触碰 `loader.entries()`，历史 web boot 崩溃根因是 Profile 损坏与 uiWorkspace 双注册（非表达式本身）。验证：typecheck 0 错误、build 通过、check:sidebar-version 闸门通过、全量 44 files/599 tests passed + 4 skipped。

### Fixed

- 权限拒绝测试用例在 Windows 上失真（2026-10-15）：`tests/session-checkout-module.test.ts` 的容器权限拒绝用例连续调用两次 `createIsolatedTarget`（第一次断言抛 EPERM、第二次断言不抛「不可信目录」），但 Windows 的 `mkdirSync(recursive:true)` 失败前可能已创建部分父级目录——第二次调用看到已部分存在的 sibling 容器（注入的 2 次失败也已耗尽）即走成功路径 resolve，用例在本机稳定失败。修复：合并为单次调用，捕获错误后同时断言「含 EPERM: operation not permitted」与「不含不可信目录/trusted directory」，测试意图不变且跨平台确定性。

### Fixed

- 「Worktree 回退容器不是可信目录」误报吞掉真实失败原因（2026-10-14）：`bindTarget` 容器信任判定把 ensureDirectory 的一切失败（含 EPERM/EACCES 等环境性权限拒绝）都归为「目录不可信」，fail-closed 静默重试 sibling 后再失败即抛该文案——真实根因（如历史 deny-ACE 沙箱 ACL 拦截 mkdir）被完全掩盖，用户无从下手。修复：区分失败形态——`!containerExisted` 分支的 ensureDirectory 抛错（EPERM/EACCES）时，最终 throw 改抛新文案 `theWorktreeContainerCouldNotBeCreatedOrAccessed`（含容器路径与 `{code}: {message}`），提示检查目录文件权限；文件/符号链接/非空外来内容等真不可信形态仍走原「不可信目录」错误，信任语义未放宽。配套 `tests/session-checkout-module.test.ts` 新增用例（createContext 注入 `ensureDirectoryFailures`）：断言错误含 EPERM 且不含「不可信目录/trusted directory」。

- 分支总览失败后缓存永挂陈旧快照（2026-10-11）：`branch-overview-cache.ts` 的 doc 声称「失败时清槽」，但 fetch flight 的 `.then(!ok)` 与 `.catch` 分支从未删除 cache 槽——gitOverview 持续失败（如仓库迁移/宿主重启后 agent 失联）期间，分支菜单永远展示最后一次成功抓取的旧分支列表（用户「清理了分支却还显示」的观感放大器）。修复：失败路径在 epoch 未变（无中途乐观补丁）时 `cache.delete(sessionId)`，失败后立即改走重取，且不覆盖 patch 中的乐观状态。配套 `tests/client-branch-overview-cache.test.ts` 新增 3 用例：拒绝 flight 清槽+下次重取、`!ok` outcome 清槽、失败不清踩乐观补丁。

- 目标状态菜单新增「清理已合并分支」（2026-10-11）：面板此前只有自动清理（7 天阈值，后台静默）与 `worktree_prune_branches` 工具，UI 无任何删分支入口——「已清理分支后菜单仍列出」的另一半根因即在此（清理从未发生过，面板如实展示未清理状态）。新增 prune RPC 全链路：`WorktreeConsoleGitPruneResponse`（dryRun/headBranch/pruned/skipped，skipped 恒带 reason）+ strict schema/descriptor/remote 声明 + control-plane `gitPruneMergedBranches`（直通 `module.pruneMergedBranchesForSession`，`git branch -d` 语义绝不强删、当前与 main/master 永不进候选）+ client adapter（SLOW 180s 档，prune 需 N 次 isAncestor）+ 菜单项（create_branch 与 graph 之间）与 dryRun 预览弹窗（可删/跳过清单，空态与加载态，确认后真删并失效缓存立即重取）。i18n 8 个 key（zh/en）；`tests/console-remote.test.ts` METHODS 补 `gitPruneMergedBranches`。全量 44 files/591 tests 通过（typecheck + build + vitest）。

- 接管谎报致 uiWorkspace 注册冲突（2026-10-11）：宿主重装（0.2.0-rc.2 重写）后 profile cordis.yml 被 write-back 重写回 `disabled: false`，插件的 ui-workspace disabled jsExpr 未进 live tree——`owned()` 为空、无任何 disable 操作发生，但 `mountWorkspaceProviderLifecycle` 仍无条件返回 `officialWorkspaceActive: false`；Web 客户端据此走 managed 分支重放官方 apply，`new UiWorkspaceService` 再次 provide `uiWorkspace` 即抛 `service "uiWorkspace" has been registered at <mf>`，侧边栏 boot 连续失败（08:58 起 sidebar-diag.ndjson 185 次 registered:false）。修复：选举结果如实上报——owned 条目已禁用（或禁用中）→ 维持 managed 接管；owned 为空（patch 未合并）或 disable 后仍可求值为 false → 返回 `officialWorkspaceActive: true`，客户端落到 decorated 共存分支（官方 Workspace 活着时的安全路径），boot 不再崩，并留 warn 日志标明回退原因。配套：25 个 lifecycle 测试全过，全量 588 测试通过。

- modern 宿主（0.2.x）Workspace 接管改为自动启用（2026-10-10）：`enableWorkspaceProvider` 原为全局 opt-in（默认 false），未显式开启时 0.2.x 宿主走 decorated 注册路径，而 0.2.x Workspace Browser 对声明的子槽调用 `renderSlot`，decorated 条目拿不到子槽席位即崩（`renderSlot is not a function`，会话行与新建会话工作区选择一并失效）——默认安装即坏。修复：lifecycle 门禁改为按 flavor 分代——`modern` 自动接管（flag 降级为 advisory，仅记录日志）；`legacy`（0.1.x，历史上接管曾致新会话损坏）与 `unsupported` 世代维持原 opt-in 语义。配套：`tests/workspace-provider-lifecycle.test.ts` fixture 第 6 参泛化为 flavor 并新增两测试（modern 未开 flag 即接管成功；modern 自动接管不复活用户显式禁用的插件条目）。

- boot report 被网关拒绝（2026-10-08）：每会话启动必现 `[dsh-git-worktree] boot report result: ok:false gateway/input-invalid, endpoint gitWorktree/clientBootReport, field report`——decorate 路径（official Workspace 保持活跃时）上报 `branch: 'modern'`，而 `clientBootReportSchema` 的 `z.enum` 漏列 `modern`（TS 接口 `console-contract.ts:223` 有、运行时 schema 没有，编译期查不出）。修复：schema 枚举补 `modern`，`tests/console-remote.test.ts` 增 decorate 路径上报断言防回退；顺带把 boot report 的静默吞错改为 console 输出（diag/boot-report-instrument 插桩转正，本条日志即由其暴露）。

- 新宿主 0.2.1-alpha.1 上 Git Workspace 不注册（2026-10-07）：`workspaceClientFlavorForAgentVersion` 硬编码四个版本锚点，未列版本一律 `unsupported`，宿主升到 0.2.1-alpha.1 后 client 侧落到 no-register 分支（sidebar-diag.ndjson 203 次 `registered:false`），隔离会话全部失效。修复：`0.2.x` 系未列版本兜底 `modern`——modern 分支消费的宿主面（slots/sessions/workspaces/locale/remote/layout/shortcuts 服务与 `sidebar.workspaces` 及子槽契约）已逐项对照 0.2.1-alpha.1 宿主源码验证未变；`0.1.x`（三种 flavor 并存，映射不确定）与 `0.3+`（未经源码验证）的未知版本保持 `unsupported`，维持「只选源码验证世代」纪律。dev 宿主 0.1.7-rc.2（next）不受影响。

- 提交图多分支 lane 膨胀与 refs 徽章裁切（2026-10-07）：`computeGraphLanes` 开新 lane 一律尾插、仅回收尾部 null——中间静默槽位永占，lane 数随分支总数单调增长（每条分支各占一条 lane，十几条分支即十几条贯穿竖线，且顶部截断边界提交各开新 lane 加剧）。修复：新 pending 先复用最左静默槽位；**收敛分支的重复 pending 合并**（多条兄弟分支尾提交共享同一父时，各链尾渲染后槽位留的是同 oid 重复 pending 而非 null，仅找 null 槽永远复用不了——保留最左副本、释放槽当 hole 复用，真实仓库拓扑验证 10 条 lane 收敛到 2 条真实并发）。refs 徽章把本地与远程同名分支（`foo` + `origin/foo`）归并为单徽章（tooltip 列全名），CSS 限宽 12em 省略号防裁切，meta 内 author/时间不收缩优先保可读。

- 插件页设置卡保存后回显旧值（2026-10-04）：保存实际成功（组合层写入 cordis.patch.yml、revision 前进、覆盖标记更新），但卡片立即弹回旧值——根因是 schemastery 版本协议分叉：插件 dependencies 锁定 `@deepseek-ai/schemastery@3.18.2`，其 `Config['~standard'].validate` 对 `meta.volatile` 字段产出普通值；而宿主运行时是 3.18.4，volatile 字段解析为 cosmokit volatile 引用。cordis Loader 的 volatile-only 热更新（`_commitVolatile`）依赖 `volatileEntries(fiber.config)` 找引用原地 `updateVolatile`——普通值收集到 0 个引用，直接返回且不 remount，`fiber.config` 永停启动时旧值，describe 投影出的 `value` 因此永远是旧值（user 层/revision/磁盘均正常，重启后才恢复一致）。升级依赖到 3.18.4 接入引用协议（全链模拟实测 refs=7、保存后 value 即时更新），插件内所有读取点本就经 `liveConfigValue` 解引用、无需改动。

### Added

- worktree_create in-place 绑定：不切换工作区直接创建（2026-10-11）：`worktree_create` 此前 `targetSessionId=randomUUID()` 预分配一个从未存在的隔离会话，模型被迫停工等用户切工作区（「Worktree 即一对一独立会话」的架构约束所致）。现改为 in-place——`createIsolatedTarget(sourceSessionId, sourceSessionId, options)` 允许 target===source，`bindTarget` 新增 local→isolated 升级分支（仅认「同会话 + createAttempt 0 + 带 createOptions」的 createIsolatedTarget 调用形，普通 `bind` 仍拒绝静默改绑），台账 ownerSessionId=源会话，授权校验（`sessionId===ownerSessionId`）、交付目标（localRoot HEAD）、`beginNextIteration` 循环全部零改动自然生效。runtimeContext isolated 分支对 `session-` 前缀会话（in-place 特征，UI 预分配隔离会话是裸 UUID）注入「cwd 仍在 Local、必须以 managedRoot 绝对路径落笔」强提示。配套宿主级写保护 hook `~/.dsh/hooks/worktree-write-guard.js`（PreToolUse matcher `edit|write|bash`）：in-place 会话对 localRoot 的写入（含 bash 命令中路径 token 的反斜杠/正斜杠/MSYS POSIX 三形态）exit 2 拦截并提示改写 managedRoot——写保护从物理隔离降级为「提示注入 + hook 硬拦截」双层，普通 local 会话与 UI 隔离会话行为完全不变。`tests/session-checkout-module.test.ts` 新增 6 用例（in-place 创建/升级、runtimeContext 提示、幂等复用、bind 拒绝、review-resume 闭环）。全量 44 files/598 tests 通过（typecheck + vitest）。

- 托管项目超龄已合并分支自动清理（2026-10-07）：插件后台每日定时（启动 60s 后首跑，之后每 24h）扫台账托管项目的 Local 仓库，自动删除「已完全合并进 HEAD + tip 提交早于 7 天 + 非当前/主干分支」的本地分支——`git branch -d` 语义绝不强删，被 worktree 占用等删除失败逐条记因，清扫结果（删除清单）写 host 日志；单项目失败不阻塞其余项目。`worktree_prune_branches` 配套新增可选 `olderThanDays`（按 tip 提交时间过滤；手动调用不传则不做时间过滤，保持原行为）。git port 新增可选 `branchTipTimes`（一条 `for-each-ref --format=%(committerdate:unix)` 拿全部本地分支 tip 时间）。

- worktree_merge 反向同步 `direction='reverse'`（2026-10-07）：把 Local 当前分支合进任务 worktree 的当前分支，冲突现场天然留在任务 worktree、Local 不被触碰——任务分支落后 trunk 过多时先反向同步消化冲突，再正向合并。dryRun 语义不变（临时 detached worktree 零改动探测）；门控与正向共用（sourceBranch 必须 owned，reverse 时语义为接收分支）；输出新增 `direction`/`targetBranch`。

- 插件页设置卡片（2026-10-03）：把 volatile 配置（`autoDeliver`/`autoPush`/`worktreesRoot`/`gitTimeoutMs`/`worktreeAddTimeoutMs`）投影为插件详情页描述与组件列表之间的暂存表单卡——经共享配置表单服务读有效值（用户层>组合层>schema 默认，覆盖标记按存在性而非值比较），revision 栅栏原子保存，暂存编辑所见即所存。修复两处此前卡片永不显示的接线错误：slot 由 `plugins.item`（官方插件列表）改为 `plugins.bundle.config`（key=包名，组合包详情页配置区）；client 入口 `inject` 声明 `slots`/`configForms`（cordis 只解析本 fiber 声明过的服务名，未声明时 `ctx.get` 恒为 undefined、挂载静默 no-op）。

- 交付推送改默认关闭由用户配置控制（2026-10-03）：本机 `cordis.patch.yml` 的 `dsh-git-worktree.autoPush` 置 `false`（交付仍落 Local 分支与快照，只是不再自动 push；可在设置卡片随时打开）。

### Added

- worktree 分支合并工具与冲突详情（2026-10-03）：新增 `worktree_merge`（把本会话托管 worktree 的当前分支合并进 Local 当前分支；门控=source 必须是本会话 owner/source 的某个托管 worktree 当前分支，Local 自身分支拒绝作来源；`dryRun` 先在临时 detached worktree 零改动试合并，正式合并 `--no-ff`，冲突不回滚、冲突状态留给模型就地解决提交）。配套：git port 新增可选 `mergeLocalBranch`（tests 支撑适配器同语义复刻）；模块新增 `mergeBranchForSession`（绑锁内执行）。Apply 引擎冲突结果新增 `conflictDetails`（逐文件 combined diff，≤6 文件、每文件 ≤4KB 截断），`worktree_merge`/`preflight`/`operate` 冲突结果全部透传，模型无需离开会话即可读取冲突内容。

- 模型清理工具（2026-10-03）：新增 `worktree_cleanup`（封装 `manageManagedWorktreeForSession` 的 `cleanup_retained`，`checkoutId`+`expectedRevision` 必填 CAS，仅限本会话拥有且已交付/保留终态的 checkout，脏工作树拒绝，走标准隔离区删除链路）与 `worktree_prune_branches`（安全清理当前会话项目里已完全合并的本地分支：`git branch -d` 语义绝不强删，当前分支/main/master/未合并分支一律跳过并说明原因，建议先 `dryRun` 预览）。配套：git port 新增可选 `deleteLocalBranch`；模块新增 `pruneMergedBranchesForSession`（绑锁内执行）；`worktree_list` 输出每条加 `revision` 字段供 CAS 校验取值。

- 空白会话 Worktree 胶囊（2026-10-01）：新会话顶行「标准模式」旁显示 Session Target 分支胶囊（复用会话头 TargetStatusAction，经 `conversation.input.dock` 挂载后 portal 进 hero 工作区行），分支切换/新建/提交图/Manager 直达；宿主缺 react-dom 时自动隐藏，不影响其余客户端功能。

- Worktree 面板行内保留期选择（2026-10-01）：`retain_24h`/`retain_3d`/`retain_manual` 直接在行内下拉切换（此前仅有契约、能力位与适配器方法，无 UI 入口）；恢复放弃快照后面板自动刷新列表。

- i18n 引用键护栏测试（2026-10-01）：扫描 `src/` 断言 `t(...)` 与 `hostMessage(...)`/`hostRegistrationMessage(...)` 的字面键均存在于对应中英文目录，杜绝改键名漏改目录。

- Worktree 面板列表过滤（2026-10-01）：逻辑链接列表头新增「只看需要关注」与「包含已交付」两个开关，接通 list 端点既有的 `needsAttention`/`includeDelivered` 服务端参数（此前契约与客户端适配器已支持、UI 未接入）；切换即重取，计数徽章随结果更新。

- 会话 Target 胶囊分支化（融合 dsh-client-ui-git-graph 交互）：胶囊主标签优先显示本地仓库当前分支名（git-branch 图标 + chevron），无分支信息时回退 `Worktree · 状态`；面板新增本地分支列表（当前分支/会话分支置顶、最多 12 项、显示 upstream 与会话徽章）、新建本地分支（`check-ref-format` 预校验）与提交图弹窗（topo-order 泳道渲染、200 条起步/每次 +100 分页、请求乱序守卫）。宿主配套 4 个控制台端点：`gitOverview`/`gitGraph`（只读）与 `gitCreateBranch`/`gitSwitchBranch`（变更，均作用于本地仓库根）；owner 会话交付验收中途（ready_for_review/preview_active/preview_detached/recovery_required）拒绝切换本地分支（`localBranchSwitchBlockedDuringDelivery`），非验收期本地漂移由既有 stale_local 机制容错。
- 分支概览读取性能：模块级 60s TTL 缓存 + 胶囊挂载预取 + 面板打开时 stale-while-revalidate，展开分支面板不再每次现拉 git（此前与 git-graph 原版一致为每次展开冷拉，Windows 冷 spawn 最坏 ~3.5s）。

- 客户端设置页（Plugins 页卡片，借鉴 dsh-worktree-panel）：把 volatile 配置字段（`autoDeliver`/`autoPush`/`worktreesRoot`/`gitTimeoutMs`/`worktreeAddTimeoutMs`）投影为中文标签的开关与输入框，暂存编辑、revision 栅栏原子保存；写入经宿主 settings 服务落 cordis.patch.yml，不重挂载插件。设置服务缺失时静默不挂载。
- 上述五个配置字段改为 volatile（`meta.volatile`），值以 `{get()}` LiveRef 到达、消费方逐次解包：超时对下一条 git 命令生效，`autoDeliver`/`autoPush` 对下一次指引/交付生效，`worktreesRoot` 对之后新建的 worktree 生效（换根只影响新建，既有 worktree 原地不动）；`stateDir`/`enableWorkspaceProvider` 保持启动期语义。
- `worktree_create` 支持可选 `branch` 基准分支参数：预检返回本地分支列表，控制台创建表单提供分支下拉（聚焦懒加载、当前源分支默认项）。branch 只决定创建基点，交付仍写源会话分支（[[.codewiki/decisions/create-from-branch-is-base-only.md]]）。
- 放弃前安全快照与恢复（codex 对齐）：确认放弃带修改的 Worktree 时，先把全部改动（含 untracked）固化为 `refs/dsh-worktree/abandoned/<checkoutId>` 快照提交（快照失败则中止放弃、不删任何内容），面板底部新增「可恢复的放弃快照」区，一键在本地仓库建 `worktree-restore-<oid8>` 分支找回；快照随恢复或记录清理释放。
- Worktree 常驻标记（codex 对齐 permanent）：面板行内 pin/unpin 切换，常驻记录豁免保留期到期清理与 keep-count LRU（手动清理不受限）；已交付记录拒绝标记。
- Worktree 总量 LRU 收口（codex 对齐 worktree-keep-count，默认 15、0 关闭、volatile 可热更）：超出上限时按最近更新时间从最旧的已交付记录开始逐出，逐出走完整放弃安全链（含放弃前快照），常驻与进行中的会话豁免；随启动 reconcile 与保留期巡检周期执行。
- 非 Git 目录渐进增强：未纳入版本控制的工作目录可从开关直接创建初始提交（`git init -b main`）后继续使用隔离开关；已有提交的仓库拒绝该操作（`projectAlreadyVersioned`）。
- 侧边栏任务携带 `sourceBranch`，任务标签显示 `状态 · 分支`；worktree 移除后自动回收 worktreesRoot 下的空项目容器（遇任何用户字节即停）。
- 创建 Isolated Checkout 时支持仓库根 `.worktreeinclude` 清单（.gitignore 语法，与 Conductor/Codex 同语义）：仅复制「被 gitignore 且被清单匹配」的文件（如 `.env.local`、本地证书），tracked 文件永不复制。匹配交给 git 原生完成（`ls-files --others --ignored` 两次调用取交集，清单经 `--exclude-from` 注入，不受仓库 .gitignore 之外的 excludes 影响语义）；被 ignore 的 `AGENTS.override.md` 自动带入、符号链接跳过、已存在的目标文件不覆盖，逐文件失败仅告警不阻塞创建。

### Changed

- 提交图弹窗加宽（2026-10-03）：`BranchGraphModal` 弹窗卡片从默认 380px 加宽到 `min(720px, calc(100vw - 32px))`（复用审查详情弹窗 `dsh-wt-details-modal` 的加宽模式），提交主题与 refs 徽章不再过度截断。

- 合并上游 0.10.0（2026-10-02）：收入 DSH 0.2.0-rc.2 适配、Workspace Provider 生命周期非阻塞化（10s 上限+在途防重入）、strict codec `modern` flavor、`remote.directoryPicker` 注入过滤、Typert/Skill locator 等上游改进；本地适配全部保留（Workspace 接管严格 opt-in、依赖宽区间、autoDeliver/autoPush/worktreesRoot），本地版本记为 `0.10.0-local.1`。

- 死代码与缓存收敛（2026-10-02）：审查报告 ponytail 清理项落地——删除 client i18n 死键 60 个（zh/en 成对，动态拼键的 `error.*` 19 个键保留）、`onTimingEvent` 测试管线、`flavorFromAnchors`（锚点解析注释迁移至仍存活的 `workspaceFlavorDiagnostics`）与 host 死键 `initialHasFiles`；preflight-cache 与 preview-recovery-cache 两个同构缓存收敛为 `createRequestCache` 工厂（新增 `src/client/review-console/request-cache.ts`：按 adapter WeakMap 分桶、identity 串共享、单飞 in-flight、generation 防旧响应回写；两文件缩为薄封装，对外导出名与签名不变，消费者零改动；实测无 TTL 语义，未引入）。i18n 引用护栏与既有缓存测试全绿守护（570 通过）。

- 提交图弹窗重绘为 GitHub 风格 SVG 泳道（2026-10-02）：`computeGraphLanes` 由逐行字形快照改为输出边几何（泳道列 + 行内 0/0.5/1 纵向锚点），渲染改为每行内联 SVG——相邻行线段首尾相接，跨行连线无缝，分支开出与汇入画三次贝塞尔曲线，节点为泳道配色圆点（合并提交不再用 ◆）；行高固定 36px、行距归零，元信息行不再换行。新增 `tests/branch-graph-lanes.test.ts` 锁泳道拓扑（线性/分支汇合/根提交）。

- 移除新会话 composer 的预会话 Worktree 开关（`conversation.input.left` 槽位，2026-10-01）：空白会话不再显示「Worktree」切换与草稿交接确认流程；Worktree 创建入口保留在会话 Header 的关联 Manager 与 `/worktree` 命令，恢复请求的草稿预填（`prefillSessionDraft`）不受影响。

- Worktree 控制台客户端减负（2026-10-01）：创建/放弃/常驻/保留期变更成功后不再全量重拉三路 RPC（`applyMutation` 局部补丁即最终态），放弃改为只刷新「可恢复快照」区；切换本地分支改用乐观补丁直接呈现最终态，省去 invalidate+重取（少 4 次 spawn、不再闪旧值）；`list`/`preflight`/`preflightCreate` 等 20-25 次 spawn 的重方法从 30s 快超时挪入 180s 慢超时（Windows 冷 spawn 不再误报超时）。

- Worktree 控制台错误条与评审控制台统一（2026-10-01）：错误提示改用 `error.detail` 模板（「{message}（{category}；恢复方式：{recovery}）」）与 `error.category.*`/`error.recovery.*` 翻译键，不再裸显机器错误码，两类控制台的错误呈现一致。

- 宿主读取链路减 spawn（2026-10-01）：checkpoint 头不变量校验由 3n+1 次串行 git 改为两轮并行取证（语义与短路顺序不变）；`.worktreeinclude` 两次 `ls-files` 并行；内部 ref 清理由 1+N 次 `update-ref` 合并为单次 `update-ref --stdin`；交付评审 diff 由逐文件串行 numstat+patch（200 文件最坏 400 次 spawn）改为 8 个一批并行取数，payload 预算折叠顺序不变。

- Worktree 面板读取链路减 spawn：`git.inspect` 的 4 次顺序 git 调用合并为 1 次 `rev-parse`（`symbolic-ref` 并行补分支；unborn/broken HEAD 与换行路径歧义保留原逐项回退）；Local inspect 与托管校验的 git 读取并行化（inspect ∥ status、双端 inspect 并行）；`list` 的逐记录观察合并为批量 `observeManagedCheckouts`（一次 binding lock 并行验证；宿主模块缺批量方法时回退逐条 observe）。
- 预会话开关陈旧优先渲染（stale-while-revalidate）：上次已知目标按（适配器、会话）缓存，重进会话立即呈现并后台静默刷新，加载占位胶囊只在冷启动出现；静默刷新失败时保留陈旧界面不闪回错误态。

### Fixed

- 遗留项批次：审查报告 P3 加固（2026-10-02）：四路审查报告遗留项的第二批（死代码与缓存收敛见 Changed 节）。
  - git 端口加固：abandoned 快照 ref 拼接前过 `assertArtifactName`；`push` 的分支参数补 `--` 分隔。
  - apply 路径 runGit 补齐 git.ts 同款卫生：ambient `GIT_*` 路由变量清洗（`options.env` 故意注入通道最后展开、始终胜出）、`--no-optional-locks`、`core.fsmonitor=false`、`core.hooksPath=空目录`；超时默认 30s 不变但可经 `options.timeoutMs` 覆盖。
  - apply plans Map 收敛：同一 isolatedPath 的新 plan 落库前取代旧条目，映射不再随重复 calculatePlan 无上限增长。
  - uncertain 交付错误（写失败且回滚亦失败）文案点名备份 index 文件路径，`.domi-backup-*` 残留可发现可清理（不加清扫器，保留证据语义）。
  - 清理原因判定去 i18n 耦合：在线调用点显式传结构化 reason；文本匹配仅兜底历史持久化的 cleanupMessage，且 zh/en 关键词成对（runGit 清洗后 git 输出为 LC_ALL=C 英文，纯中文匹配会永久失效）。
  - 控制面 `restoreAbandoned` 入口补 `authorize`（module 侧已有，纵深防御）。
  - `worktree_deliver` 的 `retention` 参数改运行时白名单校验（非法值 `invalid_input`，原先 `as` 断言静默直通）。
  - initial-commit 锁清理 finally 包 try/catch，清理失败不掩盖主错误。
  - 客户端 UI：Hero 胶囊迟挂载改 250ms 轮询重试（10s 上限，注释标注 MutationObserver 升级路径）；TargetStatusAction 的 `Worktree · ` 前缀与 `Local` 状态文案走 i18n、discard 确认对带 rollbackPreview 能力的 target 告知回滚行为；WorktreeConsoleView 的 loadBranches 补会话代际守卫（旧会话回调不再写入新会话分支列表）；WorktreeCreateRow 的 opening 态成功后与卸载时复位（原先永久禁用）；console-remote 拓扑失败文案走 i18n + `sessions.open` 空值防护；ReviewActions 孤立 refresh 图标、WorktreeReviewRow 死变量删除。
  - 测试：console-remote 路由断言适配新 i18n 文案（zh/en 双锚点）。全量 44 文件 570 通过/0 失败/4 跳过。

- 审查加固批次：autoDeliver 门控与八项并发/状态竞态修复（2026-10-02）：四路审查（RPC/宿主、客户端、git/生命周期、ponytail 全树）后的集中修复。
  - autoDeliver 门控：`autoDeliver=false` 时模型工具 `worktree_deliver` 直接拒绝（模块新增 `isAutoDeliverEnabled()`，宿主文案 `worktreeDeliverDisabledByAutoDeliver`，zh+en）；面板/控制面等人工路径不受影响，`tools.ts` 头注释与实际行为同步。
  - finish 索引锁：`session-checkout-apply.ts` 的 finish 段补齐 finalize 同款锁协议（`writeIndexLock` → 持锁复检 → `rename` 上主），finish 与 finalize/create 并发不再互踩 git index。
  - 原子 JSON 写唯一 tmp：`writeJsonFileAtomic`/`writeTextFileAtomic` 改用 pid+随机后缀唯一 tmp 名，恢复逻辑改为扫描同名 `*.tmp` 取最新可解析者提升并清理其余（旧版固定 `.tmp` 仍兼容识别），消除两并发写者互相提升对方半成品的竞态。
  - registry 字段长度上限：`markReadyForReview` 与 `operateFinish` 补 caps（summary≤240、suggestedCommitMessage/validationSummary/tests[].command|summary≤500、detailsMarkdown≤12000、finish commitMessage≤500，超限 `invalid_input`，新增 3 个宿主消息键 zh+en）。
  - 清理超时放宽：`CHECKOUT_CLEANUP_TIMEOUT_MS` 30s→120s（Windows 冷 spawn 下重清理不再轻易越过窗口；后台操作本就不被该超时取消，注释说明升级路径）。
  - TargetStatusAction 陈旧会话守卫：switchBranch/createBranch/retryCleanup/discard 补 actionScope 捕获守卫（对齐 beginNextIteration），会话切换后迟到的 resolve 不再写错会话状态。
  - 分支概览缓存补丁守卫：flight resolve 回写按 patchEpoch 门控，切换分支后的乐观本地视图不再被迟到的 overview 拉取覆盖回旧值。
  - cancelled 恢复可重发：`retryWorktreeRecovery` 接受 cancelled 状态，恢复面板对 cancelled 也显示 Resend 按钮（重发前仍走完整重校验）。
  - 测试：新增 tests/adapters-safe-file（5 用例）与 tests/client-branch-overview-cache（3 用例）；session-checkout-module 增长度上限与磁盘自愈用例；recovery-continuation 增 cancelled 重发用例；surface 的 deliver 工具桩补 `isAutoDeliverEnabled`。全量 44 文件 574 通过/0 失败/4 跳过（此前基线 563）。

- 交付后「已提交 · 环境保留」dock 排版炸裂与无法收起（2026-10-01）：交付证明整卡 grid 直接塞进 dock 横向 flex 行，max-content 把左侧文案挤成一字宽竖排。现终态 dock 改为紧凑单行（`proofVariant='compact'` 交付证明 + 关闭按钮），完整交付证明只经「查看详情」弹窗展示；dock 可按会话身份收起（checkoutId+reviewId 失效，新一轮验收自动重现）。dock 内动作列改纵向 flex 并限制证明卡 min-width，根治挤压。

- Worktree 面板 `list` 不再因单条记录身份无法验证（`checkout_mismatch`）而整体失败：批量观察失败退回逐条降级观察，验证不过的记录以无观察投影（回退 oid 与模块 summary）照常呈现，面板其余记录不受影响。

- 客户端样式表注入改用 `data-plugin="dsh-git-worktree"` 自标记。此前 `<style>` 无 `data-plugin`，会被 dsh client-modules 的 `claimStyles` 认领给"任意后物化的模块"，该模块 invalidate/prune/物化失败时 `removeOwnedStyles` 即误删本插件样式表，Worktree 开关与 Local 徽章会在运行期间自动回退为浏览器默认描边样式。

- 仓库迁移后 Worktree 台账自愈（2026-09-30）：仓库被移动/重命名后，台账中残留指向旧路径的 `localRoot`，导致新会话绑定 Isolated Checkout 直接报"非 Git 项目"且旧 worktree 的 `.git` 指针断链。现在绑定前自动检测台账中指向已消失路径的记录：admin 目录仍挂在当前仓库 `.git/worktrees/` 下的，执行 `git worktree repair` 修复双向链接，并就地改写记录的 `localRoot`/`gitCommonDir`/`gitDir` 与项目归属；修复不可行时维持原有 `not_git_repository` 拒绝，但错误信息列出失效路径并提示仓库可能已被移动。`reconcile` 汇总新增 `staleRootCheckoutIds` 并在启动日志告警；Worktree 面板对本地根目录已消失的记录强制呈现 `needs_attention`，不再假报 `working`。

- 外部删除的 Worktree 可直接放弃（2026-09-30）：台账记录的 worktree 目录连同 git 顶层已被外部删除（用户手动清理等）时，「放弃任务」此前会误入 `recovery_required`（"Isolated Checkout 身份无法确认，需要恢复"）死路——磁盘上已无可保护内容，恢复注定失败。现在 ready 记录在 `managedRoot` 与 `managedGitRoot` 均缺失时直接清台账置 `discarded`，并 best-effort `git worktree prune --expire now` 清理残余 admin 注册（新增可选端口方法 `pruneWorktrees`）。

- 交付/放弃后的空壳 cwd 清扫（2026-09-30）：交付或放弃移除 worktree 后，owner 会话可能仍开着，宿主会把已删目录重建为空壳 cwd，导致"提交后 worktree 没删干净"的观感。`reconcile` 现在会清扫 `discarded` 记录下被重建的空目录（`removeEmptyDirectoryTree` 遇任何用户字节即停，绝不误删）并回收空容器。

- 兼容 dsh 0.2.0-rc.2（2026-09-30）：宿主升级后 bundle 加载器启动预检（app-boot `plugin-compatibility.ts`，semver `includePrerelease:true` 逐项校验 `@deepseek-ai/dsh-*` peer）判定 `@deepseek-ai/dsh-client-locale` 的精确钉版本 `0.2.0-rc.1` 不匹配运行时 `0.2.0-rc.2`，启动时跳过加载本插件（"skipping profile bundle"）。peer 范围追加 `|| 0.2.0-rc.2` 修复；其余 `^0.2.0-rc.1` 风格 peer 同元组预发布天然覆盖 rc.2，无需改动。应急替代：`dsh plugin allow-version` 精确版本豁免（未采用）。

## [0.9.3-local.1] - 2026-09-26

本地适配版本：在 `0.9.3` 基础上按个人 Git 工作流（agent 完成即自合、统一 worktree 根目录、大规模仓库长超时、Workspace 接管显式 opt-in）调整行为。上游合并时可能产生冲突，取舍以本地需求为准。

### Added

- `worktree_deliver` 模型工具：agent 无需人工预览确认即可原地完成验收（`finish`），自动提交到 Local 当前分支；`ready_for_review` 状态缺省沿用 Review 建议提交信息并锁定对应 reviewId，`working` 状态必须显式提供 `commitMessage`；可选 `retention`（默认 `cleanup`）与 `report`。
- 配置项 `autoDeliver`（默认 `true`）：启用后 working 态运行时提示引导 agent 调用 `worktree_deliver` 而非 `worktree_ready_for_review`。
- 配置项 `autoPush`（默认 `true`）：`finish` 成功后对 Local 当前分支执行 best-effort `git push`（绝不 `--force`）；无本地分支、无上游或推送失败只记录结果，不阻断验收。结果通过 `SessionCheckoutFinishedResult.push`（`pushed`/`skipped`/`failed`）暴露，并在 `/worktree` 完成文案中展示。
- 配置项 `worktreesRoot`：设置后受管 worktree 统一落到 `<worktreesRoot>/<repoKey|repoLabel>/<主题>-<YYYYMMDD>` 布局；`worktree_create` 新增可选 `topic` 参与命名（未设置 `worktreesRoot` 或未提供主题时保持上游默认命名）。
- 配置项 `enableWorkspaceProvider`（默认 `false`）：Workspace 接管改为显式 opt-in；未开启时插件不再禁用官方 ui-workspace，规避"启用后无法开启新对话"的接管失配问题。开启仍需重启 DSH 生效。

### Compatibility

- 默认配置下（`enableWorkspaceProvider: false`）官方 Workspace 保持启用，Worktree 模型工具与命令照常可用；此前依赖插件自动接管官方 Workspace 的用户需显式设置 `enableWorkspaceProvider: true` 并重启。
- `gitTimeoutMs`/`worktreeAddTimeoutMs` 沿用上游 `0.9.3` 的 120s/300s 默认值（上游 #7 已修复），本地未再调整。

## [0.10.0] - 2026-09-30

`0.10.0` 适配 DSH `0.2.0-rc.2`，修复桌面端插件安装时因旧版 peerDependencies 声明而被拒绝的问题，并同步更新新版 Workspace、Typert、Skill 和 Client 运行时接口；同时修复新版 Host 的 Web 启动死锁、strict codec 世代判定与派生 seam 失配。

### Fixed
- 宿主端插件启动不再被 Workspace Provider 选举阻塞：`WorktreeConsoleService`、工具、命令和 Session Target 上下文先行挂载，Provider 生命周期移到最后并以非阻塞方式执行；对 Loader 禁用/恢复官方 `ui-workspace` 条目的单次操作增加 10 秒上限与在途防重入，卡住时告警并等待下一个 Loader 事件重试，避免新版 cordis-plugin-loader 并发启动下 `entry.update()` → `fiber.dispose()` 互等导致 `remote.gitWorktree` RPC 处理器永远无法就位。新增真实 Loader 时序回归测试覆盖「官方禁用操作永不返回时宿主 apply 仍完成」与「延迟生效的禁用最终落地且不产生双 Provider」。
- 修复 0.2.0 Web 启动死锁：入口 inject 过滤 `remote.directoryPicker`（其提供者条目等待 `uiWorkspace`，原样继承官方完整列表会形成三方循环等待，插件卡 loading、12 条目 pending）；目录选择器改在托管上下文中延迟解析，调用时才读取真实服务。
- `sidebarTopologyResponseSchema` 补充 `modern` flavor，修复 strict codec 拒绝 Host 世代判定导致无法识别已安装的 Workspace 生成。
- 对齐 0.2.0 Workspace 派生 seam：`protectedManagedWorkspace` 定义、托管行 drag 与 new-session 抑制修正 needle，修复渲染抛 `ReferenceError` 后 slot 错误边界将整个会话列表替换为空死格；托管行徽章图标改用 `IconBranchOutlineRegular`（0.2.0 primitives 移除尺寸后缀变体）。新增 `WT_DEBUG_SEAMS=1` 派生 seam 审计开关。
- 将 DSH Host/Client 依赖、插件兼容声明和发布版本切换到 `0.2.0-rc.2`。
- 支持 DSH 0.2 的现代 Workspace Browser、懒加载 Typert codec 和 Skill locator，同时保留旧 codec 字段的运行时兼容。
- 更新 DSH 0.2 客户端构建、侧边栏兼容门禁和回归测试。

## [0.9.3] - 2026-09-25

`0.9.3` 适配 Harness 新旧协议与三版官方 Workspace Browser，同时修复隔离源码开发安装及预会话草稿迁移。新版 Host 的验证仍有明确边界；本次发布不等于宣布所有 Harness 版本完整兼容。

### Fixed

- strict Remote codec 同时提供旧版 `schema` 与新版 `create()`；会话导航优先使用 `uiWorkspace.openSession`，旧版回退到 `sessions.open`。新版只从唯一的 `retainedBy.mainView` 判定当前 Session，归属歧义时拒绝危险操作；旧版快照缺少 `byId` 时仍可按 `current` 安全读取。
- `0.1.7-rc.2` 源码 Host 中，预会话迁移通过 `sessions.using()` 持有目标 Session 引用直至草稿交接与导航结束，避免创建后 binding 尚未 retain 便被借用而回滚。
- 隔离开发命令修复源码 CLI、空 Profile 初始化和 pnpm 选择；默认 Workspace、缓存及安装环境与正式 Profile 隔离。
- 受管侧栏收紧状态标记间距，在新版官方 Browser 派生中保留安全的悬停固定操作，并屏蔽可能破坏受管归属的行操作。

### Compatibility

- 按 Host 实际解析的 `dsh-agent` 版本选择来自 `0.1.2-rc.1`、`0.1.6-alpha.2` 或 `0.1.7-rc.2` 的精确版本/SHA-256 门禁的官方 Workspace Browser 派生；未知版本保留官方 Workspace，不猜测或强制覆盖。
- locale peer 精确接受 `0.1.2-rc.1 || 0.1.7-rc.2`；其他 DSH peer 声明保持原范围。开发构建基线仍为 `0.1.2-rc.1`，两个新版 Browser 别名仅供来源门禁与构建。
- `0.1.7-rc.2` 仅在隔离源码 Host/Profile 实测安装、Web 渲染、Worktree 开关、预会话创建与草稿迁移、受管侧栏状态及刷新后选中；未配置 API Key，未验收 AI 对话及 Review/恢复/清理全流程。`0.1.6-alpha.2` 尚无隔离 Profile 运行时联调，`0.1.5-rc.3` 也未联调；不声明这些组合完整兼容。升级新 Host 的 Session 数据前应备份并在隔离环境验证，回退时恢复原数据。
- 无 Worktree registry、Review 或 Recovery 数据迁移；现有可用的旧组合无需因本次版本升级而强制替换 Host。详见 [兼容性矩阵](docs/COMPATIBILITY.md)。

## [0.9.2] - 2026-09-20

`0.9.2` 修复 Managed Worktree 未携带项目级 Skill 及其资源的问题：首次创建和交付后的下一轮创建都会获取一次 Local 快照，并让 `.claude/skills` 与既有 `.dsh/skills`、`.agents/skills` 一起在隔离 Session 中可用，同时保持辅助文件与正常 Git 交付隔离。

### Fixed

- 创建首次及下一轮 Managed Worktree 时一次性携带项目 `.dsh/skills`、`.agents/skills` 和 `.claude/skills` 的本地文件与资源，并接入 `.claude` Skill 加载；携带的辅助文件不自动混入交付，已跟踪改动与显式暂存保留正常 Git 语义。
- Local 中已跟踪 Skill 存在未提交修改、删除或基线冲突时保守拒绝，不静默覆盖；复制中断、不同内容、未知资源或链接会保留现场，不反向同步 Local，也不自动清理可能有价值的内容。
- Skill 快照复制改用 Node 文件 API，拒绝符号链接、junction 与项目外链接，并限制文件数、总大小、目录项和目录深度；无需增加原生复制工具依赖。

### Compatibility

- 新增 `@deepseek-ai/dsh-fs` peer，并使用与现有开发基线一致的 `0.1.2-rc.1`；`.claude` Skill 通过上游 filesystem Skill provider 加载。
- 现有 Managed Worktree 不自动补拷 Skill；在首次创建或完成交付后的下一轮创建时获取新快照。无需迁移 Worktree registry、Review、Recovery 或 Session 数据。

## [0.9.1] - 2026-09-15

`0.9.1` 修复 Windows 长路径和慢速仓库中 Worktree 创建失败或超时的问题，并减少状态与预览流程的重复 Git 查询；失败清理继续以可证明归属为前提，不修改用户 Git 配置、不全局 prune，也不删除未知锁或残留。

### Fixed

- Windows 下为创建、检出、状态与验收交付的 Git 调用启用命令级长路径支持，修复 Worktree 路径前缀增长导致的 Filename too long；不修改用户 Git 配置或跳过 LFS。
- Worktree 创建使用独立可配置的 5 分钟共享时限，普通 Git 默认从 30 秒提高至 2 分钟；失败后等待进程树退出，验证本次目录、元数据和残留内容后回滚并恢复原会话绑定，允许手动重试。无法证明安全的残留继续保留，不全局 prune、不删除未知锁；稀疏检出保持原生语义。
- 减少状态读取与 Worktree 管理列表的重复 Git 查询：复用同次只读请求的调用者检查及同次目录验证结果，保留预览、交付、清理的实时安全校验与锁。
- 合并 Git common directory 与 worktree Git directory 的身份路径查询，减少进程启动开销；对包含换行的路径保留单值查询回退。

### Compatibility

- 继续使用既有 DeepSeek Harness peer 范围和 Worktree registry；无需迁移数据或修改 Git 配置。
- 新增 `gitTimeoutMs`（默认 2 分钟）与 `worktreeAddTimeoutMs`（默认 5 分钟）配置，现有配置不需要补写。

## [0.9.0] - 2026-09-11

`0.9.0` 完善新会话创建、验收与项目导航体验：空仓库可在明确确认后安全建立首次提交；Worktree 入口恢复为与 DSH 工具栏协调的原生紧凑开关；验收区增加只读详情弹窗，并修复撤回预览、历史 Worktree 分组及慢请求轮询的状态问题。

### Added

- 新会话目录入口支持无提交 Git 仓库：Host 先执行只读预检，再经用户明确确认创建空首次提交；不纳入用户文件或暂存内容，不改写 Git 身份，并在状态变化或失败后安全拒绝、允许重试。
- 验收条新增 Lucide 图标化只读详情弹窗，集中展示文件列表、验证记录和版本信息；操作仍留在验收条，历史卡保持结果导向的精简展示。
- Host 为历史 Managed Worktree 提供不含路径的导航归属投影，侧边栏可将过滤后的历史分组和未归组会话安全合并回原项目，同时保留歧义项与普通成员。

### Changed

- 新建 Session 的目录入口改为 Harness 原生紧凑菜单与 Worktree 开关，跟随真实状态恢复，并与 DSH 工具栏尺寸、主题反馈和图标体系保持一致。
- cleanup 后的“开始下一轮修改”移至 owner Session 顶部 Worktree 菜单；验收条聚焦当前摘要、文件数、验证状态与交付操作。
- 统一 Worktree 管理、Preview、详情和更多操作的 Lucide 图标与间距，减少重复标题、常驻外框和开发辅助文案。

### Fixed

- 修复新版 Harness 中新会话 Worktree 开关点击后无响应：适配当前 `attachmentIds` 快照和源/目标 Session 输入操作，同时兼容旧版图片接口；草稿与附件可安全迁移到新 Session。
- 将输入快照创建纳入异常恢复，失败时释放忙碌锁、显示错误并允许重试，避免入口永久停留在准备状态。
- 撤回 Local Preview 后继续保留同一验收身份，避免旧异步结果覆盖；区分“撤回预览”和“继续修改”，并展示真实文件数、验证状态和 revision 防回退结果。
- 缓解 #6 的后台状态查询开销：状态按钮与验收栏共享按 Client adapter、会话及语言隔离的展示查询；慢请求完成后再调度，主动刷新合并并丢弃失效结果，避免重复轮询和未完成请求堆积。
- 展示查询在卸载时停止调度，重挂载不消费旧请求结果；创建、交付和清理的实时安全校验保持独立且不降级。
- 修正发布门禁的 Remote 方法清单，补入已存在且已有回归覆盖的 `preflightCreate` 与 `createWithInitialCommit`；不改变运行时协议。

### Documentation

- 增加新旧 Harness 兼容矩阵，区分开发基线、peer 声明、用户反馈、部分实测与未验证项；记录 `0.8.0` 对 `0.1.5-rc.1` 的隔离验证及端到端限制，不强制升级 Host，不扩大依赖声明。
- 清理过时 UI Skill 和并行开发交接稿，按当前实现更新 UI 维护指南、Console 模块职责与验证入口。

### Compatibility

- 开发与可重复构建基线仍为 DeepSeek Harness `0.1.2-rc.1`；`0.1.5-rc.1` 只有用户反馈和部分隔离验证，不扩大 peer 声明，也不要求现有用户升级 Host。
- 新增空仓库首次提交能力和历史导航投影，不迁移既有 Worktree registry、Review、Recovery 或 Session 数据。

## [0.8.0] - 2026-09-09

`0.8.0` 为插件增加 Client 与 Host 全链路中英文支持：界面、工具、命令和 Host 用户消息跟随 DSH 语言选择，并通过显式 Console 语言传递与异步上下文隔离保持并发会话正确；同时修复新建 Session 时 Worktree 入口因使用过期状态 seam 而崩溃的问题。

### Added

- 接入 DSH locale 与类型安全的中英文文案表，覆盖 Pre-session、Target/Review Console、ToolView、Workspace Sidebar、工具结果、命令回复和 Host 生命周期消息；插件不增加独立语言开关。
- Console contract 显式传递调用语言；Host 使用异步语言上下文隔离并发工具和命令，错误码、持久化判定及恢复协议继续保持语言无关。
- 新增语言标准化、中文回退、插值、运行时切换、并发隔离和 strict transport 回归，并将语言传递与翻译贡献规则收录到发布包的 `docs/i18n.md`。

### Fixed

- 新会话 Worktree 入口改用 DSH `0.1.2-rc.1` 标准 Session 与输入状态 hook，避免渲染期读取旧 store seam 导致崩溃；中英文环境下均覆盖确认、取消和会话状态变化。

## [0.7.5] - 2026-09-06

`0.7.5` 修复插件启停时官方 Workspace provider 与 Managed 聚合 provider 的生命周期协调：禁用插件后可靠恢复官方 `uiWorkspace`，启用时继续保留 Managed 会话聚合，不再因静态 bundle patch 残留导致 Web 会话阻塞。

### Fixed

- 修复 #4：插件条目禁用但 bundle patch 仍保留时，恢复官方 `uiWorkspace`，不再因双方均停用阻塞 Web 会话；启用时继续保留 Managed 会话聚合和侧边栏标记。
- Workspace 替换改为 Host 生命周期控制的条件选择；同步 Loader 与 Web 模块清单，覆盖延迟 Include、市场禁用状态回放和初始化失败恢复，不持久化官方禁用标志。
- 新增锁定 DSH `0.1.2-rc.1` 的真实 Loader / Include / ClientModuleRegistry 回归；切换后仍应完整重启 DSH 并重新加载页面。

## [0.7.4] - 2026-09-04

`0.7.4` 修复 `0.7.3` 在 DeepSeek Harness `0.1.2-rc.1` Web Client 中的启动循环依赖。插件现在先恢复被受控派生替换的官方 `uiWorkspace` 服务，再延迟加载依赖 Conversation 的 Worktree 界面。

### Fixed

- 将官方 Workspace Client 与 Worktree ToolView/Pre-session/Target/Review UI 拆分为两个 Cordis 激活阶段，消除 `dsh-git-worktree → conversation → uiWorkspace → dsh-git-worktree` 循环等待。
- 顶层 Client fiber 只等待官方 Workspace 的公开 prerequisites；`conversation` 与 `connection` 留在子 fiber，服务后续出现时再注册其余 Worktree UI。
- 增加无 Conversation 启动图回归和发布门禁，确保插件先提供 `uiWorkspace`，且官方 Workspace Slot declaration tree 仍只注册一次。

## [0.7.3] - 2026-09-03

`0.7.3` 将插件完整适配到 DeepSeek Harness `0.1.2-rc.1` 的 Host、Client、Remote Gateway 与 Workspace 模块边界，并重写中英文项目首页，让安装要求、Worktree 工作方式与安全限制更容易理解。

### Changed

- 用面向普通用户的语言重写中英文 README，保留 Git Worktree 隔离、多任务并行、人工验收与恢复能力说明，并明确该工作方式与 Domi/Pi Agent Runtime 开源实现的来源关系。

### Compatibility

- 将 DeepSeek Harness Host singleton、Client 模块与完整锁图统一升级到 `0.1.2-rc.1`，同时对齐 Cordis `4.0.2` 和 Schemastery `3.18.2`，避免 rc.2/rc.1 混合运行时。
- 适配 rc.1 的 Client 拆分：移除已停止发布的 `dsh-client-runtime`，改用 Session/Workspace API Controller、`dsh-client-store` 与 Cordis Context 的公开类型和模块边界。
- 重新固定官方 Workspace Client `0.1.2-rc.1` 的 bundle SHA-256，并更新 Managed owner Browser 派生 seam；官方 Picker、locale、store、目录选择授权和 Slot declaration tree 保持不变。
- 适配统一 Remote Gateway：Client Remote 现在包含 generation stream 与 Host facts，测试载体实现新的 Connection lifecycle，卸载后错误码按官方命名空间收敛为 `gateway/internal`。
- 已复核 Session 按需事件 API（`seq`、`eventAt()`、`snapshotEvents()`）和 `SessionSeq` / `SessionLogOffset` 强类型；插件不直接读取已移除的 `Session.events`，现有 Session Target、fork/resume、Recovery 与 Local fail-closed seam 保持不变。
- 补充 rc.1 Host 升级说明：Code Mode 更名为 PTC mode 且旧会话仍可读取；可选 SQLite Session 后端已移除，存量数据需使用旧版 Harness 导出；应用与插件安装统一通过 `dsh` Profile。

### Security

- 双语 README 跟随上游安全声明，明确 Harness 与本插件均未经独立安全审计，Worktree、审批和权限检查不构成绝对沙箱保证。

## [0.7.2] - 2026-08-30

`0.7.2` 修复 Review 历史提交信息的持久化上限、DSH Host singleton 包的依赖边界，以及非 Git Workspace 的 Worktree 入口显示，避免 registry 写入失败、重复 Host 实例和无效创建入口。

### Fixed

- `previousReview.suggestedCommitMessage` 在投影和 registry 加载修复阶段限制为 500 字符，并安全处理 UTF-16 高代理项，避免超长建议提交信息使后续状态无法持久化；已有受影响记录会在读取时自动收敛。
- 将 Cordis、Session、Agent、Commands、Subprocess、Tools、Typert 等 DSH Host singleton 包从运行时 dependencies 移至 peerDependencies，并以精确 devDependencies 保持构建测试可复现；发布门禁会拒绝 singleton 回流 dependencies、缺少 peer 或测试版本漂移。
- pre-session 在仓库检测完成前不再显示 Worktree 开关，非 Git Workspace 检测完成后保持隐藏；Host 对 `unversioned` 目标同步关闭 create capability，避免渲染竞态或绕过 Client 入口。

## [0.7.1] - 2026-08-28

`0.7.1` 修正项目聚合侧边栏的 Managed owner 菜单边界：恢复安全的会话整理操作，隐藏尚不具备 Worktree 生命周期语义的普通 Fork，并继续阻止会破坏唯一 owner 不变量的入口。

### Fixed

- Managed owner 恢复官方重命名与归档；归档仅影响侧边栏可见性，不放弃任务、不清理 Worktree，也不改变交付状态。
- 普通 Fork 从 Managed 菜单隐藏；Managed Workspace 的“新会话”和跨归属拖动继续被阻止，非法操作不再弹出浏览器原生提示框。
- 强化冲突 Workspace 的 fail-open 防护，并更新项目聚合、Ready 界面截图与双语使用说明。

## [0.7.0] - 2026-08-28

`0.7.0` 新增项目聚合侧边栏，将 Managed Worktree 的唯一 owner Session 直接显示为原 Local 项目下的任务行，同时以 fail-open 拓扑、生命周期操作限制和上游版本门禁保持官方 Workspace 行为兼容。

### Added

- 新增项目聚合侧边栏：Local Workspace 继续承载普通多会话，每个 Managed Worktree 则直接显示为唯一 owner Session 任务行，并展示进行中、待验收、预览、恢复、已完成或已放弃状态。

### Changed

- Managed Workspace 不再以 UUID 长路径重复占用顶级项目；cleanup 后的历史 owner Session 继续依据插件 Registry 归入原 Local 项目。
- Managed 任务行仅用于打开 owner Session，普通重命名、Fork、归档和拖动会被阻止，避免产生第二个会话或绕过 Worktree 生命周期；非托管 Workspace 保留官方操作，拓扑不可用时完整回退到原 Workspace 列表。
- 修复项目聚合 Browser 的两阶段真实启动回归：先消除重复 `sidebar.workspaces.directoryFlow` 声明，再改为版本与 SHA-256 门禁的官方 Workspace Client 单次衍生加载，保留 `renderSlot`/目录选择授权，避免 shadow 崩溃后静默回退官方侧栏。
- Managed Workspace 中可证明为空的预会话 launcher 不再阻止聚合；真实第二个 Session 仍 fail-open，物理 Workspace 未归并时也会禁止通过官方“新会话”入口创建第二个 Session。
- Managed owner 行改用官方 Branch Icon 与独立状态 Badge，任务标题保持原文；窄侧栏会优先保留 Worktree 身份和交付状态，而不是把状态截断在标题末尾。

## [0.6.1] - 2026-08-28

`0.6.1` 统一 Preview 与最终保存的用户文案，修复 pre-session source launcher 对并发 Worktree 创建的阻塞，并让普通 Local Checkout 正确使用正常助手回复结束任务；同时将项目首页和完整使用指南重新分层。

### Changed

- Review 主操作改为更直接的任务文案：Ready 使用“预览修改”，Preview 使用“确认并保存”，Direct Finish 使用“跳过预览并保存”；同步更新恢复、Checkpoint 与确认弹窗文案，不改变 Host 交付语义。
- 将中英文 README 收敛为 Mermaid 驱动的项目首页，新增双语 Usage 指南承接完整操作、恢复、命令与排错；同时修正 Checkpoint 迁移状态，并明确项目级 Worktree 插件与 Domi 桌面工作台之间的产品边界。

### Fixed

- pre-session handoff 成功后自动归档已清空的 Local source launcher，防止 Harness 的 New Session 复用该 reserved source 并错误阻塞下一项并发 Worktree 任务；owner Session 与项目级 Preview 串行约束保持不变。
- 普通 Local Checkout 现在明确使用正常助手回复结束，不再被引导调用 Worktree-only Ready 工具；若模型仍误调用，Client 会隐藏预期的 `target_unselected` 结果，同时保留其他真实 Worktree 错误。

## [0.6.0] - 2026-08-25

`0.6.0` 为长任务增加 Host-authoritative Worktree Checkpoint：用户可以把精确 Ready/Preview 阶段保存为隔离 Worktree 内部 Commit，清理当前施工状态后继续开发，同时保持 Local 完全不参与阶段提交，最终仍只交付一个累计任务 Commit。

### Added

- Review 卡新增“保存阶段并继续”；active Preview 使用“撤回 Preview，保存阶段并继续”，两者都通过同一个 Host mutation 完成，不由 Client 拆分撤回与保存请求。
- checkpoint domain、registry metadata、operation journal、内部 artifact retention 与 `recoverCheckpoint` 支持重启后收敛 HEAD/index，无法证明完整回滚时保留 `index.lock` 与恢复证据。
- strict Host/Remote/Client contract 新增 generation-bound `checkpoint` 方法；请求绑定 exact owner、checkout、revision、review、generation 与 single-flight request ID，完成请求支持精确幂等重放。
- Review 与关联 Manager 投影展示已保存阶段数量/摘要；Manager 继续只提供状态、导航和 owner lifecycle，不新增 Checkpoint mutation。

### Safety

- Checkpoint 只提交 managed Worktree 当前 staged、unstaged 与 untracked 的精确验收快照；Local branch/HEAD、refs、index、staged、unstaged、untracked 与 working-tree bytes 不被纳入阶段 Commit。
- active Preview 必须先在 Host 锁内安全撤回；acceptance holder、identity、revision/review/generation、Worktree fingerprint 与最终 CAS 任一变化都在写入前 fail closed。
- prepared Commit 先持久化 journal，再保留内部 ref；写后复验 detached HEAD、clean index 与 checkpoint tree。迟到请求、重复点击、旧 generation、外来 Session 和空阶段均被拒绝或安全去重。
- Checkpoint 会使旧 Review、Preview、Delivery/Recovery proof 失效并恢复 Working；多次阶段 Commit 仍只作为 Worktree 内部历史，最终 Finish/Finalize 向 Local 生成一个累计任务增量 Commit。
- strict Remote schema 保持 path-free，拒绝未知字段、危险路径和内部 `refs/dsh` 泄漏。

### Changed

- 包版本升级为 `0.6.0`；发布门禁与 Loader 方法面同步要求 `checkpoint` descriptor。
- 中英文 README、架构与发布 smoke 补充 Checkpoint 状态、不变量、恢复和人工验证边界。

## [0.5.0] - 2026-08-25

`0.5.0` 完成冲突与 detached Preview 的 Host 权威恢复闭环：恢复决策绑定 durable proof、严格 Remote contract 与写前后 CAS 复验，并将运行基线统一升级到 DeepSeek Harness `0.1.1-rc.2`。

### Compatibility

- 将全部直接 DeepSeek Harness 依赖与完整 peer 图从 `0.1.0-rc.8` 统一升级到 `0.1.1-rc.2`，避免 rc.8/rc.2 混合 runtime。
- rc.1 引入视觉模型支持并修复 Bubblewrap 可经宿主 `/proc/<pid>/root` 绕过文件约束的问题；插件不直接实现 sandbox，但使用修复后的统一 Host 包线。
- rc.2 继续收敛图片 Files API、预处理与 attachment pipeline；本项目接触的 Commands wire 仅新增可选 `originalDimensions`，现有 Worktree 协议不消费该字段。
- 验证结构化 Web Client 启动/inject、Session projection state/view 重构、Typert namespace 原子注册与 Connection transport hooks，不改变现有 Worktree Session Target、Recovery 与 Local 安全边界。
- 移除已过期的 rc.8 `minimumReleaseAgeExclude`；rc.2 依赖图现可直接通过仓库供应链冷却策略。

### Added

- `preview_detached` 新增 Host-authoritative Recovery Preflight：严格只读核对 durable receipt、四个 retained refs、Local HEAD/ref/tree/index/fingerprint、acceptance holder，并分别给出 rollback/finalize 的可证明结论与 64 位 generation。
- detached Preview 在同分支安全快进后可安全撤回或直接提交到最新 Local HEAD；写操作在 Host 锁内重算 proof/CAS，并保留后续 Commit、staged、unstaged 与 untracked 层。
- 无法证明安全时，Review Recovery surface 可显式请求精确 owner Agent 只读分析，或创建基于最新 Local HEAD 的 fresh managed Worktree handoff；旧 Worktree、Local、receipt 与 retained evidence 保持不变。
- Review Preflight 冲突新增显式“让 Agent 解决冲突”：先强制重检结构化 conflict identity，再通过 owner-only `resumeRevision` 恢复 Working，并使用 Harness 官方 `ISession.prompt()` 将 Local HEAD 与冲突文件交回精确 owner Session；不会自动 Preview、Finalize 或写入 Local。
- `stale_isolated` 新增独立的“重新生成验收结果”链路：保持 Ready 与严格 Read Only，不恢复 Working、不修改文件，只要求 Agent 等待后台写入停止、重新验证并生成新的 Ready Review。
- Preview/direct Finish 写前竞态返回 strict `worktree_apply_conflict` continuation，包含可去重的冲突 request ID、checkout/review/revision、Local HEAD 与受限冲突文件列表；显式恢复后由 Host 另行签发持久恢复 proof。

### Fixed

- rollback/finalize 增加独立写后 HEAD/ref/index/tree/fingerprint 验证；无法证明成功或完整回滚时保留 journal/artifacts 并进入 `recovery_required`，reconcile 不再仅凭 Commit HEAD 误报成功。
- detached Recovery Remote contract 使用 strict schemas，拒绝未知字段、非法 OID/generation、绝对/父级冲突路径与越界身份；Client 使用 identity-keyed single-flight cache，并在每次写操作、分析或 handoff 前强制重检。
- Recovery continuation 增加 Host-authoritative 持久 proof：conflict 在 mutation lock 内重跑 Preflight/CAS 后绑定 Ready/Working revision、review、Local HEAD 与安全相对冲突路径；`stale_isolated` 通过独立只读 Host 授权保持 Ready。浏览器持久请求严格穷举 kind 与精确字段，并在发送前逐字段复验 Host proof、cwd 与 active Session，关闭伪造 kind 绕过显式授权的路径。
- Recovery continuation 支持持久未发送请求、single-flight、重复点击去重、Session loading/streaming 延迟、Session 切换中止、旧请求被新请求替换，以及发送结果未知或失败后的显式重试。
- acceptance slot 从 `waiting` 释放为 `available` 时废弃旧 busy Preflight；自动预检失败不再因重渲染循环重试，改为用户显式“重新检查”。

## [0.4.0] - 2026-08-20

`0.4.0` 将 Worktree 验收升级为可预检、可恢复、可核验的交付闭环，并把关联 Worktree 的状态与导航入口集中到 Session Header；同时适配 DeepSeek Harness `0.1.0-rc.8` 与新的 Node.js 运行要求。

### Added

- Ready Review 卡与 composer dock 自动执行共享的严格只读 Preflight，展示 Local/Worktree HEAD、effective base、同步状态、冲突与 acceptance slot；真正 Preview 或 direct Finalize 前仍强制重新检查。
- `stale_local`、`stale_isolated`、冲突和过期 Review 增加明确恢复动作：重新检查，或恢复当前 Worktree 并预填重新验证、生成验收稿的请求；旧 Preview/Finalize 操作立即失效。
- `project_acceptance_busy` 返回 path-free 的 checkout/owner Session/state 摘要，并在 Host inspect、owner 身份和 canonical cwd 全部复验后导航到占用 Session。
- Finalize 后在 Review 卡与 composer dock 展示 durable Delivery Proof：Commit OID、Local branch/HEAD、changed files、validation 摘要，以及 cleanup/retention 结果。
- 将 Session Header 的 Target 状态胶囊升级为可点击控制面板，可直接打开当前工作位置、返回来源 Session、处理 owner cleanup，并在当前 Session 内打开“关联 Worktrees”管理器。
- source 与同源 target Session 现在都能列出并打开关联 Worktree；兄弟 Session 只获得只读发现与导航能力，不继承 Preview、Finalize、Discard 等 owner 写权限。

### Changed

- 关联 Worktree Manager 按当前目标和待处理状态排序，并复用已经存在的 Harness Session，避免导航时重复创建 Workspace/Session。
- Manager 聚焦状态、导航和 owner lifecycle，移除重复的“检查/验收”行操作及会破坏紧凑布局的展开详情；验收继续由专用 Review 卡与 composer dock 承担。
- 保持 `conversation.view` 标签页未挂载；管理入口集中在 Header 控制面板，避免与 Review 卡和 composer dock 重复。
- acceptance slot busy 时仅关闭 Local mutation capability，owner 的只读 Preflight 保持可用；跨 source 的额外 inspect 权限只对当前 Ready owner 的真实 slot holder 生效，且永不继承 mutation capability。
- Delivery Proof validation 字段以可选形式加入 version-2 registry，继续兼容历史记录。

### Compatibility

- 将 DeepSeek Harness 依赖与已验证兼容包线更新到 `0.1.0-rc.8`，并把 Node.js 运行要求同步为 `^22.19.0 || >=24.0.0`。
- 从干净安装重建纯 rc.8 DSH peer 图，避免 rc.7/rc.8 混用；已使用的 Session、Subprocess、Tool 与 Typert Remote 接口保持兼容。
- 补充独立社区插件声明，明确本项目不代表 DeepSeek 官方背书、合作或授权。

## [0.3.2] - 2026-08-19

`0.3.2` 将插件更新到已验证的 DeepSeek Harness `0.1.0-rc.7` 包线，并保持现有 Worktree Session Target 与验收交付接口兼容。

### Compatibility

- 将 DeepSeek Harness 依赖与已验证兼容包线更新到 `0.1.0-rc.7`；rc.6 → rc.7 的已使用公开类型与 Remote/Tool 注册接口保持兼容。
- 重新生成纯 rc.7 锁文件，消除 rc.6 peer 混用，并更新中英文环境要求与已知限制说明。

## [0.3.1] - 2026-08-18

`0.3.1` 修复验收卡操作菜单被卡片裁剪的问题，并将项目文档重组为中文优先、带完整产品流程截图的发布入口。

### Fixed

- Ready for Review Tool 卡片允许操作菜单溢出显示，避免菜单被卡片边界裁剪。
- 验收卡菜单改为向下展开，composer dock 中的同类菜单继续向上展开，并增加对应 CSS 回归测试。

### Changed

- 中文 README 成为默认入口，英文文档迁移到 `README.en.md`。
- 重写 Worktree 产品文档、迁移说明与架构入口，补充创建、Ready、Local Preview、提交、保留环境和下一轮修改的产品截图。
- 本地 DSH 开发 tarball staging 同步包含 `README.en.md`。

## [0.3.0] - 2026-08-17

`0.3.0` 完善同一 isolated Session 的连续修改体验：未同步 Review 可以安全恢复编辑，成功交付并 cleanup 后也能保留 Session ID、immutable cwd 与完整对话开始下一轮。

### Added

- cleanup 后在原 isolated Session 中开始 iteration + 1；新 checkout 从最新 Local HEAD 创建，并通过 `predecessorCheckoutId` 保留上一轮交付记录与迭代血缘。
- delivered composer dock 增加“开始下一轮修改”，模型增加 `worktree_begin_next_iteration`，人工命令增加 `/worktree next`。
- Host、strict Typert Remote、Client Adapter 与 Console Contract 增加 `beginNextIteration`；Remote 方法总数由 13 个增加到 14 个。
- cleanup 后 Harness 过滤缺失 cwd 的 Session 时，lookup adapter 可通过当前 live Session 的 immutable header cwd 恢复精确且唯一的 Workspace 身份。
- 新增 `worktree_resume_revision`、`/worktree continue` 与 Ready 更多菜单“继续修改”，在不写入 Local 的情况下使未同步 Review 失效并恢复同一 iteration。
- Worktree Console Contract、Host、strict Typert Remote 与 Client Adapter 增加 `resumeRevision`；Remote 方法总数由 14 个增加到 15 个。

### Fixed

- 修复 `worktree_ready_for_review` 输出 Schema，使其符合 Harness 工具结果契约。
- 发布产物门禁同步校验新增的 `beginNextIteration` 与 `resumeRevision` Remote 方法。
- 完善并稳定本地开发 Harness 的源码预览、验收输出提取、命令失败诊断与跨平台路径处理。

### Safety

- 下一轮仅允许已成功清理的 delivered owner，并校验 caller、Workspace、revision、Local Git common dir、managed path 与 predecessor lineage。
- 如果上一轮 managed path 已重新出现或包含未知内容，拒绝覆盖；retained、cleanup-pending 与 recovery 状态必须先完成清理或恢复。
- 创建中断且尚未形成 Worktree 时，reconcile 恢复 predecessor binding；存在无法确认的残留时进入 recovery 并保留现场。
- live Session cwd fallback 对 cold、无 cwd、路径不匹配或歧义映射继续 fail closed。
- resume-revision 严格校验 live owner Session、expected revision、expected review ID、Workspace/checkout 身份；转换只更新 registry delivery state，不修改 Local、Worktree bytes 或 Git refs。

### Changed

- Ready for Review 不再阻断普通对话：讨论类 follow-up 保持当前 Review；新的代码或文件修改由模型自动恢复 Working，不要求用户先同步或点击恢复编辑。
- 重写中英文 README，补充当前 Session Target 流程、安全边界、命令、模型工具和已知限制。
- `SessionCheckoutModule.beginNextIteration` 现在要求调用方传入 `expectedRevision`，避免基于过期 delivered 状态创建下一轮。

## [0.2.0] - 2026-08-17

`0.2.0` 将插件从单一 Worktree 管理器升级为 DeepSeek Harness 中完整、可验收、可撤回的 Worktree Session Target。

### Added

- 真实 source/target Session 分离：Host 分配唯一 checkout、managed root 与 target Session ID，source Session 始终保持 Local。
- blank Local Session 的 pre-session **Worktree** 开关与确认弹窗：确认前零副作用，确认后才创建 target、迁移未发送的文字/图片并打开独立 Session。
- Harness 官方 Slot 集成：
  - Create/Ready ToolView；
  - Header Session Target 状态胶囊；
  - `conversation.input.dock` 的 Ready、Preview 与 Recovery 状态条。
- 两阶段验收交付生命周期：
  - Ready for Review；
  - 不提交、可撤回的 Local Preview；
  - Preview 验收提交；
  - 撤回并恢复 Worktree 编辑；
  - 跳过验收直接提交；
  - cleanup 与 retain 策略。
- 项目级单 Preview 验收槽位、持久 Preview receipt、内部 Git refs、crash reconcile 与 cleanup retry。
- 13 个 strict Typert Remote 方法，覆盖 current/list/create/inspect、preflight、Preview/rollback/finalize、Discard、retention 与 cleanup。
- sibling managed Worktree 路径与安全 fallback；短 checkout identity 冲突时自动扩展，旧 registry 路径继续可管理。
- 一键本地 DSH 开发、临时 tarball 安装、profile smoke 与发布产物门禁。

### Safety

- Preview receipt 在触碰 Local 前持久化，并绑定 review、revision、isolated HEAD/fingerprint 和 Local HEAD/ref/fingerprint CAS。
- Local staged、unstaged、untracked 状态在 Preview、rollback 和 finalize 中保持分层语义；无法证明无损时 fail closed。
- 同分支 fast-forward 后的安全 rollback 使用三方反向合并，只移除 Preview delta，同时保留新 Commit 和 Preview 外 Local 修改。
- branch switch、non-fast-forward、重叠冲突、Preview 已进入 Commit、额外 Preview 修改或最终 CAS 漂移会进入 detached/recovery 状态，不覆盖用户修改。
- active Preview 的 Discard 必须先成功 rollback；detached Preview 保留 Worktree、receipt 与内部 refs 作为恢复证据。
- target Workspace cwd 必须 canonicalize 到 Host 记录的 managed root；caller/project/workspace/owner/review identity 全部 fail closed。
- owner Session live 后，source Session 不再拥有管理权限；其他 Session 不能依赖持久化 owner ID 越权管理。

### Changed

- Ready 主操作改为“同步到 Local 验收”；Preview 主操作改为“验收通过并提交”，撤回和 direct finish 收入“更多”菜单。
- 普通验收界面改为中文优先的紧凑摘要，验证详情默认折叠，不显示 Diff/Inspect 或平铺 Retention。
- 历史不可逆 `worktree_apply` 公开路径暂停；模型不再直接拥有 Finish、Discard 或 Remove 权限。
- `WorktreeConsoleView`、Host 控制面和 strict Remote 管理能力继续保留，但可见的项目级 `conversation.view` Worktree 页签暂不挂载，优先稳定 pre-session、独立 target Session 与 composer 验收主流程。
- managed Worktree 新路径采用 `<repo>--worktrees/<repo>--<checkout-short>--worktree`，不安全时回退到插件 stateDir。

### Compatibility

- 需要 DeepSeek Harness `0.1.0-rc.6` 包线与 Node.js 20 或更高版本。
- pnpm 10 的 Git 源安装可能需要在 profile `pnpm-workspace.yaml` 中允许 `dsh-git-worktree` 执行 `prepare`。
- `./manager` 不再是发布 export；Client/Host 集成改用正式 package entry、`./client`、strict `./typert` / `./remote` 与 `./console-contract`。
- 已经使用旧不可逆 Apply 的历史记录不会自动迁移到 Preview 生命周期，Finish/Discard 会保守拒绝并要求人工检查 Local。

## [0.1.2] - 2026-07-28

- 发布初版生产级 Worktree 管理、基础 apply/finish/discard 生命周期和安全清理。

[0.11.0]: https://github.com/wloops/dsh-git-worktree/compare/v0.10.1...v0.11.0
[0.10.1]: https://github.com/wloops/dsh-git-worktree/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/wloops/dsh-git-worktree/compare/v0.9.3...v0.10.0
[0.9.3]: https://github.com/wloops/dsh-git-worktree/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/wloops/dsh-git-worktree/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/wloops/dsh-git-worktree/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/wloops/dsh-git-worktree/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/wloops/dsh-git-worktree/compare/v0.7.5...v0.8.0
[0.7.5]: https://github.com/wloops/dsh-git-worktree/compare/v0.7.4...v0.7.5
[0.7.4]: https://github.com/wloops/dsh-git-worktree/compare/v0.7.3...v0.7.4
[0.7.3]: https://github.com/wloops/dsh-git-worktree/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/wloops/dsh-git-worktree/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/wloops/dsh-git-worktree/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/wloops/dsh-git-worktree/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/wloops/dsh-git-worktree/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/wloops/dsh-git-worktree/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/wloops/dsh-git-worktree/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/wloops/dsh-git-worktree/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/wloops/dsh-git-worktree/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/wloops/dsh-git-worktree/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/wloops/dsh-git-worktree/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/wloops/dsh-git-worktree/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/wloops/dsh-git-worktree/releases/tag/v0.1.2
