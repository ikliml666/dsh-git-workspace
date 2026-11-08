import { relative, resolve } from 'node:path'
import type {
  GitCheckoutSnapshot,
  ManagedCheckoutRecord,
  SessionCheckoutGitPort,
  SessionCheckoutLookupPort,
  SessionCheckoutRegistryPort,
} from './ports.js'

/**
 * 官方目录布局：`<repositoryRoot>/.agents/worktrees/<branch>`。
 *
 * 只认这个前缀是有意的：用户手工 `git worktree add` 出来的目录不属于本插件，
 * 纳管它们等于凭空接管别人的目录。
 */
const OFFICIAL_WORKTREE_DIRECTORY = '.agents/worktrees'

export interface OfficialWorktreeRegistrationDependencies {
  lookup: SessionCheckoutLookupPort
  git: SessionCheckoutGitPort
  registry: SessionCheckoutRegistryPort
  createCheckoutId(): string
}

/** 一次官方 `worktrees.create` 的结果，加它所属的项目与会话。 */
export interface OfficialWorktreeRegistration {
  ownerSessionId: string
  projectId: string
  projectName: string
  localRoot: string
  /** 官方建好的 checkout 目录。 */
  path: string
  /** 分叉基准提交。 */
  baseCommit: string
  /** 调用方已读过的这棵树的 Git 身份；不给就由登记函数自己读一次。 */
  snapshot?: GitCheckoutSnapshot
  /**
   * 建树时用的主题。
   *
   * 官方分支名是 `feat/sess-<会话>--<主题>`，而交付时重建分支要用同一个主题；
   * 不记下来就会退回项目名，产出一条不同的会话分支，看起来像换了归属。
   */
  sessionTopic?: string
}

/** 这个目录是否位于本项目官方的 `.agents/worktrees` 下。 */
export function isOfficialWorktreePath(localRoot: string, path: string): boolean {
  const officialRoot = resolve(localRoot, OFFICIAL_WORKTREE_DIRECTORY)
  const candidate = relative(officialRoot, resolve(path))
  return candidate !== '' && !candidate.startsWith('..')
}

/**
 * 把官方 `worktrees.create` 刚建好的一棵树登记进台账。
 *
 * 官方的 `worktrees` 服务负责真正的 Git 操作，本插件负责把它记进台账，这样
 * 列表、交付、评审、清理对这棵树一样有效。归属不需要猜测——调用方就是这棵树
 * 的 owner。
 */
export async function registerOfficialWorktree(
  dependencies: OfficialWorktreeRegistrationDependencies,
  registration: OfficialWorktreeRegistration,
): Promise<ManagedCheckoutRecord> {
  const { git, registry } = dependencies
  const snapshot = registration.snapshot ?? await git.inspect(registration.path)
  if (snapshot === null) {
    throw new Error(`The new worktree at ${registration.path} is not a readable Git checkout`)
  }
  const checkoutId = dependencies.createCheckoutId()
  if (snapshot.headRef === null || !snapshot.headRef.startsWith('refs/heads/')) {
    throw new Error(`The new worktree at ${registration.path} is not on a branch, so it cannot back a Session`)
  }
  const record: ManagedCheckoutRecord = {
    checkoutId,
    projectId: registration.projectId,
    projectName: registration.projectName,
    ownerSessionId: registration.ownerSessionId,
    sourceSessionId: registration.ownerSessionId,
    localRoot: resolve(registration.localRoot),
    managedRoot: resolve(registration.path),
    managedGitRoot: resolve(snapshot.root),
    gitCommonDir: snapshot.commonDir,
    gitDir: snapshot.gitDir,
    baseOid: registration.baseCommit,
    sourceRef: snapshot.headRef,
    // 台账里的分支一律是完整 ref，与 attachSessionBranch 写出的 branchRef 同形。
    sessionBranch: snapshot.headRef,
    ...(registration.sessionTopic === undefined ? {} : { sessionTopic: registration.sessionTopic }),
    // 官方已经完成 checkout，这棵树从诞生起就是就绪态。
    phase: 'ready',
    delivery: { state: 'working', iteration: 1 },
    journal: null,
    revision: 1,
  }
  registry.update(next => ({
    ...next,
    revision: next.revision + 1,
    managedCheckouts: { ...next.managedCheckouts, [checkoutId]: record },
    sessionBindings: {
      ...next.sessionBindings,
      [registration.ownerSessionId]: {
        sessionId: registration.ownerSessionId,
        projectId: registration.projectId,
        projectName: registration.projectName,
        target: { kind: 'isolated', checkoutId },
        ownerSessionId: registration.ownerSessionId,
        sourceRef: snapshot.headRef,
        sourceOid: snapshot.headOid,
        revision: (next.sessionBindings[registration.ownerSessionId]?.revision ?? 0) + 1,
      },
    },
  }))
  return record
}

/**
 * 会话走到一棵官方建的工作树里时，把它接进台账。
 *
 * 官方 `worktrees.create` 的最后一步是 `workingDirectory.set`，因此
 * `working-directory/change` 是「这棵树建好了且有人站在里面」的唯一可靠信号
 * —— 比轮询 `git worktree list` 及时，也不需要为每个项目起子进程。
 *
 * 只接管 `.agents/worktrees/` 下的路径；会话已有 binding、或这棵树已在台账里
 * 时什么都不做（官方每条请求都真的建树，重复登记会产生指向同一目录的两条记录）。
 * 返回登记的结果，未接管时返回 undefined。
 */
export async function adoptWorktreeForSession(
  dependencies: OfficialWorktreeRegistrationDependencies,
  sessionId: string,
  cwd: string,
): Promise<ManagedCheckoutRecord | undefined> {
  const projectId = dependencies.lookup.getSession(sessionId)?.projectId
  if (projectId === undefined) return undefined
  const project = dependencies.lookup.getProject(projectId)
  if (project === undefined) return undefined
  if (!isOfficialWorktreePath(project.root, cwd)) return undefined

  const registry = dependencies.registry.read()
  if (registry.sessionBindings[sessionId] !== undefined) return undefined
  if (isTracked(registry.managedCheckouts, cwd)) return undefined

  // 走到这里说明 cwd 确实在官方目录下，所以「读不出 Git」与「不在分支上」不是
  // 「这棵树不归我管」，而是接管失败：静默跳过会让那棵树永远进不了台账，而
  // 交付、清理、列表全靠台账定位。让调用方决定怎么把原因说出来。
  const snapshot = await dependencies.git.inspect(cwd)
  if (snapshot === null) {
    throw new Error(`${cwd} is under ${OFFICIAL_WORKTREE_DIRECTORY} but is not a readable Git checkout`)
  }
  if (!snapshot.headRef.startsWith('refs/heads/')) {
    throw new Error(`${cwd} is under ${OFFICIAL_WORKTREE_DIRECTORY} but is not on a branch`)
  }
  return registerOfficialWorktree(dependencies, {
    ownerSessionId: sessionId,
    projectId,
    projectName: project.name,
    localRoot: project.root,
    path: snapshot.root,
    baseCommit: snapshot.headOid,
    snapshot,
  })
}

/** 台账里是否已经有记录指向这棵树（按工作树根或 Git 目录两边对齐）。 */
function isTracked(recorded: Record<string, ManagedCheckoutRecord>, path: string): boolean {
  const target = normalize(path)
  return Object.values(recorded).some(record =>
    record.phase !== 'discarded'
    && (normalize(record.managedRoot) === target || normalize(record.managedGitRoot) === target))
}

function normalize(path: string): string {
  const absolute = resolve(path)
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}
