# Changelog

本项目的显著变更记录在此文件中。版本号遵循 Semantic Versioning；在 `0.x` 阶段，minor 版本可能包含需要迁移的公开能力调整。

## [Unreleased]

### Fixed

- 提交图多分支 lane 膨胀与 refs 徽章裁切（2026-10-07）：`computeGraphLanes` 开新 lane 一律尾插、仅回收尾部 null——中间静默槽位永占，lane 数随分支总数单调增长（每条分支各占一条 lane，十几条分支即十几条贯穿竖线，且顶部截断边界提交各开新 lane 加剧）。修复：新 pending 先复用最左静默槽位，lane 数只随**并发**分支数增长；refs 徽章把本地与远程同名分支（`foo` + `origin/foo`）归并为单徽章（tooltip 列全名），CSS 限宽 12em 省略号防裁切，meta 内 author/时间不收缩优先保可读。

- 插件页设置卡保存后回显旧值（2026-10-04）：保存实际成功（组合层写入 cordis.patch.yml、revision 前进、覆盖标记更新），但卡片立即弹回旧值——根因是 schemastery 版本协议分叉：插件 dependencies 锁定 `@deepseek-ai/schemastery@3.18.2`，其 `Config['~standard'].validate` 对 `meta.volatile` 字段产出普通值；而宿主运行时是 3.18.4，volatile 字段解析为 cosmokit volatile 引用。cordis Loader 的 volatile-only 热更新（`_commitVolatile`）依赖 `volatileEntries(fiber.config)` 找引用原地 `updateVolatile`——普通值收集到 0 个引用，直接返回且不 remount，`fiber.config` 永停启动时旧值，describe 投影出的 `value` 因此永远是旧值（user 层/revision/磁盘均正常，重启后才恢复一致）。升级依赖到 3.18.4 接入引用协议（全链模拟实测 refs=7、保存后 value 即时更新），插件内所有读取点本就经 `liveConfigValue` 解引用、无需改动。

### Added

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
