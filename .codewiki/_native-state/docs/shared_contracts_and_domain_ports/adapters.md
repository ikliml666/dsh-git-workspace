# Adapters 适配层

本模块是 **DSH 宿主适配层（Hexagonal Architecture 的外围）**，把宿主机（DeepSeek Harness / Cordis 运行时）的具体能力——`ctx.subprocess` 子进程服务、`workspaceRegistry` 工作区服务、`sessions` 会话存储、`workingDirectory` 工作目录服务、`skills` 技能注册中心——适配为领域层定义的 **端口（Port）**。

领域状态机与 apply 引擎保持宿主无关、可用测试替身（fake）驱动；所有对宿主文件系统、Git 进程、注册表 JSON、技能目录的实际访问都收敛在 `src/adapters/` 之下。

## 模块定位

```mermaid
flowchart LR
    subgraph Domain["领域层（宿主无关）"]
        Ports["端口接口<br/>ports.ts / types.ts / console-contract.ts"]
        Engine["SessionCheckoutApplyEngine<br/>状态机"]
    end

    subgraph Adapters["本模块：Adapters 适配层"]
        Git["git.ts<br/>createDshGitPort"]
        Lookup["lookup.ts<br/>createDshLookupPort"]
        Registry["registry.ts<br/>AtomicJsonCheckoutRegistry"]
        Workdir["working-directory.ts<br/>createSessionWorkingDirectoryPort"]
        Skills["project-skills*.ts<br/>ProjectSkillStore / ClaudeProjectSkillProvider"]
        Files["files.ts<br/>createNodeFilesPort"]
    end

    subgraph Host["DSH 宿主运行时"]
        Sub["ctx.subprocess<br/>SubprocessHandle"]
        Ws["workspaceRegistry / sessions"]
        Wd["workingDirectory 服务"]
        Sk["skills 服务<br/>SkillProvider 注册表"]
        FS["Node fs / 插件状态目录"]
    end

    Ports -.定义契约.-> Engine
    Engine -->|依赖注入| Ports
    Git -.实现.-> Ports
    Lookup -.实现.-> Ports
    Registry -.实现.-> Ports
    Files -.实现.-> Ports
    Workdir -.独立工具端口.-> Ports

    Git --> Sub
    Lookup --> Ws
    Workdir --> Wd
    Skills --> Sk
    Git --> FS
    Registry --> FS
    Skills --> FS
```

如上图，`SessionCheckoutDependencies`（定义于 `src/ports.ts`）是组装入口：领域层只依赖四个核心端口 `lookup / git / files / registry`（外加 apply 引擎）；`working-directory` 与 `skills` 适配是旁挂能力。

## 子组件一览

| 文件 | 导出的核心类型 / 工厂 | 实现的端口或角色 |
| --- | --- | --- |
| `src/adapters/git.ts` | `createDshGitPort`、`GitPortOptions`、`GitCommandResult` | `SessionCheckoutGitPort` —— 全部 Git 操作的子进程后端 |
| `src/adapters/git-options.ts` | `GitTimeoutOptions`、`validateGitTimeouts`、`gitTimeoutMs` | Git 超时策略与校验 |
| `src/adapters/initial-commit.ts` | `initialCommitActions`、`GitCommitProtocol` | 空仓库首次提交（CAS + 锁） |
| `src/adapters/lookup.ts` | `createDshLookupPort`、`WorkspaceLike`、`WorkspaceRegistryLike`、`SessionStoreLike`、`LiveSessionLike` | `SessionCheckoutLookupPort` —— 会话 / 工作区映射 |
| `src/adapters/registry.ts` | `AtomicJsonCheckoutRegistry` | `SessionCheckoutRegistryPort` —— 持久化注册表 |
| `src/adapters/working-directory.ts` | `createSessionWorkingDirectoryPort`、`WorkingDirectoryServiceLike` | `SessionWorkingDirectoryPort` —— 把 Session 移进 / 移出 worktree |
| `src/adapters/project-skill-io.ts` | `SkillRead`、`SkillBytes`、`readSkillFiles` / `createSkillDirectories` / `createSkillFiles` | Skill 文件安全读写底层 |
| `src/adapters/project-skills.ts` | `ProjectSkillStore`、`SkillSnapshot`、`Manifest`、`Entry`、`CarriedSkillState` | Skill 快照 / 携带 / 溯源清单 |
| `src/adapters/project-skill-provider.ts` | `ClaudeProjectSkillProvider`、`Locator`、`managedSkillRoot`、`mountProjectSkillProvider` | 向宿主 `skills` 服务注册 `.claude/skills` 提供方 |
| `src/adapters/files.ts` | `createNodeFilesPort` | `SessionCheckoutFilesPort` —— 目录身份 / 隔离 / 删除 |
| `src/adapters/safe-file.ts` | `readJsonFileSafe`、`writeJsonFileAtomic` | 崩溃安全的 JSON 读写（注册表与 Skill 溯源共用） |

> 说明：`files.ts` 与 `safe-file.ts` 虽在本目录下，但模块树未单列其组件；本文在相关数据流中一并引用。

## 装配关系（在 `src/index.ts::apply` 中）

```mermaid
sequenceDiagram
    participant Loader as Cordis 插件 Loader
    participant Apply as apply(ctx, config)
    participant Git as createDshGitPort
    participant Lookup as createDshLookupPort
    participant Reg as AtomicJsonCheckoutRegistry
    participant Mod as createSessionCheckoutModule
    participant Console as WorktreeConsoleService

    Loader->>Apply: 挂载插件（config 来自 cordis.patch.yml）
    Apply->>Apply: 解析 stateDir、创建 hooksPath 空钩子目录
    Apply->>Lookup: 动态解析 workspaceRegistry / sessions
    Apply->>Git: 注入 hooksPath、projectSkills、volatile 超时
    Apply->>Reg: 绑定 stateDir/managed-checkouts.json
    Apply->>Mod: 注入 lookup / git / files / registry / applyEngine
    Apply->>Console: 用同一组端口组装控制台控制面
    Apply->>Apply: 注册 tools、/worktree 命令、SessionTarget 上下文
    Note over Apply: ready 事件 → module.reconcile()
    Note over Apply: 每 15 分钟清理保留期 / 每 24h 自动 prune
```

领域层的其他页面：

- 端口契约与数据结构的完整定义见 [核心类型与端口](core_types_and_ports.md)。
- 状态机与 apply 引擎如何消费这些端口见 [Worktree 生命周期管理核心](../worktree_lifecycle_management_core.md)。
- 控制面 / 控制台服务如何复用同一组端口见 [控制台控制面与服务](../console_control_plane_and_services.md)。

## Git 适配（git.ts + git-options.ts + initial-commit.ts）

### 核心设计

`createDshGitPort(ctx, options)` 返回一个完整的 `SessionCheckoutGitPort` 实现，所有 Git 调用经由 `ctx.subprocess.spawn` 执行，不经过 shell 解释，argv 原样传递。关键加固策略：

```mermaid
flowchart TD
    Call["领域层调用 git.inspect / status / worktree add ..."]
    Run["runGit(ctx, cwd, args, options)"]
    Timeout["gitTimeoutMs(args, options)<br/>按子命令选超时"]
    Spawn["ctx.subprocess.spawn<br/>--no-pager / --no-optional-locks<br/>core.hooksPath=空目录<br/>core.longpaths (win32)"]
    Env["环境白名单<br/>剥离 GIT_DIR/GIT_WORK_TREE 等<br/>GIT_TERMINAL_PROMPT=0, LC_ALL=C"]
    Cap["输出上限<br/>1MiB 默认 / 16MiB status 与 WIP patch"]
    Result{"code / truncated?"}
    Call --> Run
    Run --> Timeout --> Spawn --> Env --> Cap --> Result
    Result -->|"code=0"| Ok["返回 GitCommandResult"]
    Result -->|"truncated"| Retry["调用方收窄重试（status 退化为 normal 模式）"]
    Result -->|"超时被 SIGTERM"| Fail["gitTimedOutMsAndWasTerminated"]
```

### 关键常量与超时

| 常量 / 配置 | 默认值 | 含义 |
| --- | --- | --- |
| `DEFAULT_GIT_TIMEOUT_MS` | 120 000 ms | 普通 Git 命令超时 |
| `DEFAULT_WORKTREE_ADD_TIMEOUT_MS` | 5 min | `git worktree add` 超时 |
| `worktree remove` 超时 | 5 min（硬编码） | Windows 长路径删除硬上限 |
| `MAX_GIT_TIMEOUT_MS` | 60 min | `validateGitTimeouts` 允许上限 |
| `GIT_COLLECT_BYTES` | 1 MiB | 普通命令 stdout/stderr 收集上限 |
| `STATUS_COLLECT_BYTES` / `WIP_PATCH_COLLECT_BYTES` | 16 MiB | `status --untracked-files=all` 与二进制 patch 的宽上限 |

`gitTimeoutMs` 每次调用即时读取 `LiveValue`，因此设置页（settings）上修改 `gitTimeoutMs` / `worktreeAddTimeoutMs` 无需重新挂载插件即可对下一条命令生效。

### 内部 ref 命名空间

插件产物使用独立的 Git ref 命名空间，避免与用户 ref 冲突：

```
refs/dsh-worktree/session-checkouts/<sha256(checkoutId)[:24]>/<artifact>
refs/dsh-worktree/abandoned/<checkoutId>
```

- `checkoutRefRoot` 用 checkoutId 的 SHA-256 前 24 位做命名空间键。
- `apply-base` 等内部 artifact 通过 `internalArtifactRef` 写入；artifact 名逐段经过 `assertArtifactName` 白名单校验。
- **放弃快照 ref 刻意放在 `checkoutRefRoot` 之外**：discard 流程会释放整个 per-checkout 命名空间，但新写入的安全快照不能随之被释放。

### 空仓库首次提交（initial-commit.ts）

`initialCommitActions(inspect, run)` 返回三个动作，仅在 Console 确认的宿主动作中调用：

```mermaid
stateDiagram-v2
    [*] --> preflight: preflightInitialCommit(root)
    preflight --> ready: headOid !== unborn
    preflight --> files: 目录非空 / index 非空
    preflight --> empty: 目录空且 index 空
    empty --> initializeEmptyRepository: 用户确认
    initializeEmptyRepository --> [*]: 返回初始提交 OID
    files --> initializeProject: 用户显式适配
    ready --> [*]: 拒绝执行（已有提交）
```

`initializeEmptyRepository` 的并发安全靠三重指纹 CAS + 文件锁：

1. 计算 `fingerprint`（root / gitDir / commonDir 身份、HEAD 内容、index bytes、文件清单）。
2. 抢占 `index.lock`（`open(..., 'wx')`），再次比对指纹；EEXIST 说明有竞争初始化者 → `operation_not_allowed`。
3. `mktree` 建空树、`commit-tree` 建提交，最后 `update-ref --stdin` 用 `prepare/beforeCommit` 回调在 HEAD 锁内做最后一次指纹比对（compare-and-swap，old=40 个 0）。
4. `finally` 中反向关闭并 `unlink` 自己创建的锁——清理失败不掩盖主错误。

## Lookup 适配（lookup.ts）

### 结构视图（Structural Typing）

因为已发布包版本滞后于 rc.6 运行时，lookup 适配**动态**从 `ctx.get('workspaceRegistry')`、`ctx.get('sessions')`、`ctx.get('sessionQuery')` 取服务，并用最小结构类型描述：

```mermaid
classDiagram
    class WorkspaceLike {
        +string id
        +string path
        +string title
        +string[] sessionIds
    }
    class WorkspaceRegistryLike {
        +list() WorkspaceLike[]
        +get(id) WorkspaceLike
        +resolveByPath(path) Promise~WorkspaceLike~
        +create(path, title) Promise~WorkspaceLike~
        +delete(id) boolean
    }
    class LiveSessionLike {
        +header.cwd unknown
    }
    class SessionStoreLike {
        +get(sessionId) LiveSessionLike
        +list() SessionHeader[]
    }
    class SessionCheckoutLookupPort {
        +getSession(sessionId) SessionCheckoutSessionRecord
        +getProject(projectId) SessionCheckoutProjectRecord
        +getSessionCwd(sessionId) string
        +listLiveSessions() LiveSession[]
        +getSidebarMemberships(managedRoots) SidebarDirectoryMembership[]
    }

    WorkspaceRegistryLike ..> WorkspaceLike : 返回
    SessionStoreLike ..> LiveSessionLike : 返回
    createDshLookupPort ..> SessionCheckoutLookupPort : 实现
```

### 会话 → 项目映射的两条路径

```mermaid
flowchart TD
    Q["getSession(sessionId)"]
    Scan["遍历 workspaceRegistry.list()<br/>找 workspace.sessionIds 包含 sessionId"]
    Found{"找到？"}
    Q --> Scan --> Found
    Found -->|是| R1["返回 projectId = workspace.id"]
    Found -->|否| LiveCwd["读 liveHeaderCwd(sessionId)"]
    LiveCwd --> Match["按 path 精确匹配 workspace"]
    Match --> R2["唯一匹配 → 恢复映射<br/>否则 undefined（孤儿事实）"]
```

第二条路径是必要的：当 Harness 因「cwd 已被清理」把 live Session 从 `Workspace.sessionIds` 投影中过滤掉时，只有 immutable live header 仍保留原始 cwd，可用于恢复精确映射。缺失服务或记录一律降级为 `undefined`，由状态机当作 **recovery / orphan 事实**处理，而不是失败。

`listLiveSessions` 只取 header 字段（id / createdAt / cwd），供给并发分支竞争守卫（见 [并发守卫](../worktree_lifecycle_management_core/concurrency.md)）；结构未知时返回空列表，守卫保持沉默而非猜测。

## 注册表适配（registry.ts + safe-file.ts）

### 持久化文件布局

```mermaid
flowchart LR
    subgraph StateDir["插件 stateDir"]
        JSON["managed-checkouts.json<br/>主文件"]
        BAK["managed-checkouts.json.bak<br/>上次写入前备份"]
        TMP["managed-checkouts.json.&lt;pid&gt;.&lt;uuid&gt;.tmp<br/>唯一命名临时文件"]
    end

    W["writeJsonFileAtomic"] -->|"copyFileSync → .bak"| BAK
    W -->|"writeFileSync"| TMP
    W -->|"renameSync（Windows EBUSY 退避重试）"| JSON
    R["readJsonFileSafe"] -->|主文件损坏| TMP
    R -->|.tmp 也坏| BAK
    R -->|都坏| Null["返回 null<br/>由 read() 决定空表或报错"]
```

写入侧刻意**不用跨进程锁**：唯一命名 tmp + 原子 rename 已经消除「tmp 互踩」与「半写提升」；文件级 last-writer-wins 可接受。读取侧是三层容错：主文件 → 最新可解析的 `.tmp` 残留（提升为主文件）→ `.bak`。

### 读路径的校验闸门

```mermaid
flowchart TD
    Read["AtomicJsonCheckoutRegistry.read()"]
    Safe["readJsonFileSafe → unknown"]
    V{"isRegistry(value)?"}
    Read --> Safe --> V
    V -->|version=2 且全部字段通过类型守卫| Ok["原样返回"]
    V -->|version=1 且 sessionBindings 合法| Migrate["migrateLegacyRegistry<br/>非 ready/discard 阶段 → recovery_required"]
    Migrate --> Write["立即 write 迁移结果"]
    V -->|其他损坏| E{"文件存在?"}
    E -->|不存在| Empty["返回 emptyRegistry()"]
    E -->|存在| Err["抛 registry_corrupt<br/>托管访问停止"]
```

每个嵌套字段（`isSessionBinding`、`isManagedCheckout`、`isReview`、`isCheckpoint`、`isPreviewReceipt`、`isDeliveryProof`、`isJournal`、`isRecoveryContinuation`）都有独立的类型守卫：OID 必须是 40/64 位十六进制、路径必须是无空字节的安全相对路径、checkpoint 的 `sequence` 必须严格自增、`requestId` 唯一性也被校验。**损坏文件响亮失败，绝不被静默覆盖**——这是 Domi 沿用的安全边界。

## Working Directory 适配（working-directory.ts）

这是让 Session *真正进入* 新建 worktree 的机制（官方 experimental worktree bundle 的最后一步即 `ctx.workingDirectory.set(agent, path)`）：

```mermaid
sequenceDiagram
    participant Tool as 工具层调用方
    participant Port as SessionWorkingDirectoryPort
    participant Svc as ctx.workingDirectory（可选挂载）

    Tool->>Port: enter(agent, managedRoot)
    alt 宿主未挂载 workingDirectory
        Port-->>Tool: 返回 undefined（不动 Session）
    else agent 缺失（非 live）
        Port-->>Tool: 返回 undefined（不谎报已选 cwd）
    else 正常
        Port->>Svc: set(agent, path)
        Svc-->>Port: 生效目录
        Port-->>Tool: 生效目录
    end

    Note over Tool,Svc: discard / remove 前：leave(agent, managedRoot, fallback)
    Tool->>Port: leave(agent, path, fallback)
    Port->>Svc: get(session) 判断是否仍在 path 内
    alt 不在 path 内
        Port-->>Tool: undefined
    else 在 path 内
        Port->>Svc: set(agent, fallback)
        Port-->>Tool: 恢复的 fallback
    end
```

宿主不挂载该服务时，插件退化为「仅指引（guidance-only）」行为——模型提示仍会告知 worktree 位置，但 Session 的 cwd 不动。

## Project Skills 适配（project-skill-io / project-skills / project-skill-provider）

这是把 Local 检出中的 `.dsh/skills` / `.agents/skills` / `.claude/skills` 携带进新建 worktree、并让宿主技能发现能在受管 worktree 内读到 `.claude/skills` 的完整链路。

### 安全边界常量

- `PROJECT_SKILL_ROOTS = ['.dsh/skills', '.agents/skills', '.claude/skills']`
- `MAX_FILES = 5000`、`MAX_BYTES = 64 MiB`
- 树遍历：最大 10000 条目、深度 64
- 溯源清单文件上限：2 MiB，权限 `0600`

### 携带（carry）流程

```mermaid
flowchart TD
    Snap["ProjectSkillStore.snapshot(source)<br/>inventory 遍历三个 skill root"]
    Carry["carry(snapshot, target)"]
    Loaded{"load(target)<br/>溯源清单已存在?"}
    Precheck["全部冲突预检：<br/>已有文件内容 hash 比对<br/>目录冲突检查"]
    Manifest["写临时 manifest: phase=copying<br/>flag=wx 排他发布"]
    MkDir["createSkillDirectories（逐段 lstat 防符号链接）"]
    MkFile["createSkillFiles（O_CREAT|O_EXCL|O_NOFOLLOW）"]
    Verify["回读全部文件 hash 比对"]
    Ready["manifest.phase=ready<br/>tmp → rename 原子发布"]

    Snap --> Carry --> Loaded
    Loaded -->|已存在| Err["拒绝重复携带"]
    Loaded -->|不存在| Precheck --> Manifest --> MkDir --> MkFile --> Verify --> Ready
```

### 文件读写底层（project-skill-io.ts）

`readSkillFiles` / `createSkillFiles` / `createSkillDirectories` 每个操作前后都做两道防线：

1. `checkRoot(root, identity)`：用 `dev:ino:birthtimeNs` 比对根目录身份，检测 checkout 根被替换。
2. `checkPath`：逐段 `lstat`，拒绝符号链接、拒绝 `..` / 绝对路径 / 控制字符，路径白名单限定在三个 skill root 之下。

打开文件一律带 `O_NOFOLLOW`，写文件带 `O_EXCL`（拒绝覆盖），写完 `fsync`。注释明确说明：这些检查支持的是**可信本地创建**，不是对抗另一进程恶意替换祖先的原子包含。

### 状态监测与删除保护

- `state(root, tracked)`：对比 manifest 中每个文件的 hash/mode、检测新增文件、目录缺失，产出 `CarriedSkillState { paths, fingerprint, modified }`。
- `assertRemovable(root, tracked)`：删除受管 worktree 前调用——若 carried Skills 被修改，拒绝删除并提示用户保留该 worktree；发现清单外的新 Skill 资源也拒绝删除。

### 宿主 Skill 提供方（project-skill-provider.ts）

```mermaid
flowchart LR
    Host["宿主 skills 服务"]
    Provider["ClaudeProjectSkillProvider<br/>name=worktree-project-claude"]
    Root["managedSkillRoot(registry)<br/>从注册表反查受管根"]
    FS["FileSystemSkillProvider<br/>.claude/skills, watch=true"]

    Host -->|registerProvider| Provider
    Provider --> Root
    Root -->|"cwd 在某个 ready checkout 内<br/>且 .git 指针双向验证"| FS
    FS -->|"候选重新打标<br/>source=project-claude, rank=250"| Provider
    Provider --> Host
```

`managedSkillRoot` 是安全关键：只接受**宿主拥有的注册表记录**声明的根，并且双向验证 `.git` 文件指针与 `gitDir/gitdir` 回指，绝不接受 Skill 文件自己声称的根。provider 内部对每个根缓存一个 `FileSystemSkillProvider`（上限 32 个，LRU 淘汰最旧），所有 `list` / `get` 操作串行化排队（`this.run` 链），并在每次返回前对候选路径做 `assertSkillTree` / `assertSkillPath` 复检。

`mountProjectSkillProvider(ctx, registry)` 通过 `ctx.inject(['skills'])` 挂载，并把 `fs/observed` 事件转发给 provider 做失效观察；作用域退出时 `dispose()` 释放全部文件 watcher。

## 依赖与被依赖关系

```mermaid
flowchart TD
    subgraph adapters["src/adapters/"]
        git["git.ts"]
        gito["git-options.ts"]
        ic["initial-commit.ts"]
        lookup["lookup.ts"]
        reg["registry.ts"]
        wd["working-directory.ts"]
        sio["project-skill-io.ts"]
        ps["project-skills.ts"]
        psp["project-skill-provider.ts"]
        files["files.ts"]
        sf["safe-file.ts"]
    end

    ports["../ports.ts（SessionCheckoutGitPort / LookupPort / RegistryPort / FilesPort）"]
    types["../types.ts"]
    idx["../index.ts（SessionCheckoutError）"]
    i18n["../i18n/host.ts"]

    git --> gito
    git --> ps
    git --> ic
    git --> ports
    ic --> ports
    lookup --> ports
    reg --> sf
    reg --> ports
    wd --> ports
    ps --> sio
    psp --> ps
    files --> ports
    sio -.纯 fs.-> sio

    git --> idx
    ic --> idx
    reg --> idx
    files --> idx
    git --> i18n
    reg --> i18n
    files --> i18n
    sf --> i18n
```

与其他模块的关系：

- 上游契约：[核心类型与端口](core_types_and_ports.md) 定义了本层实现的全部端口接口（`SessionCheckoutGitPort`、`SessionCheckoutLookupPort`、`SessionCheckoutRegistryPort`、`SessionCheckoutFilesPort`、`InitialCommitPreflight`、`LiveValue` 等）。
- 消费方：[Worktree 生命周期管理核心](../worktree_lifecycle_management_core.md) 中的 `SessionCheckoutModule` 与 `SessionCheckoutApplyEngine` 通过 `SessionCheckoutDependencies` 拿到本层实例，自身不含任何宿主 I/O。
- 控制台复用：[控制台控制面与服务](../console_control_plane_and_services/console_host.md) 的 `WorktreeConsoleControlPlane` 直接复用同一组 `lookup / files / registry / git` 实例（见 `src/index.ts` 中 `createWorktreeConsoleControlPlane({...})` 的组装）。
- 构建与配置：本层的 volatile 配置（`gitTimeoutMs`、`worktreeAddTimeoutMs`）由 [构建与配置](../build_and_configuration.md) 中的 `cordis.patch.yml` / settings 页面投影，运行时以 `LiveValue` 注入。

## 设计取舍小结

1. **结构类型 + 动态解析**：`WorkspaceRegistryLike`、`WorkingDirectoryServiceLike` 等都是最小结构视图，服务缺失时降级为 `undefined` 而不是崩溃——宿主版本漂移（rc.6 / 0.2.x）不会让插件挂载失败。
2. **绝不沙化 git**：与官方 experimental worktree 服务不同，本插件的受管 checkout 在 session workspace *之外*，`sandbox.confine` 会拒绝创建目标目录；文件策略强制留在宿主自己的 file/shell 工具中。
3. **身份（identity）作为安全边界**：目录删除、Skill 携带、初始提交、注册表迁移全部依赖 `dev:ino:birthtimeNs` 指纹做 CAS，路径以安全相对路径白名单约束。
4. **ref 命名空间隔离**：所有插件内部 ref 落在 `refs/dsh-worktree/...` 下，且放弃快照 ref 刻意游离于 per-checkout 命名空间之外。
5. **崩溃安全优先**：注册表与 Skill 溯源都用「唯一 tmp → 原子 rename → .bak」三段式，进程强制结束不会留下半截状态。
