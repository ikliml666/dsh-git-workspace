import { relative, resolve, isAbsolute } from 'node:path'
import type {
  ManagedCheckoutRecord,
  SessionCheckoutGitPort,
  SessionCheckoutLookupPort,
  SessionCheckoutRegistryPort,
} from './ports.js'

/**
 * 官方目录布局：`<repositoryRoot>/.agents/worktrees/<branch>`。
 *
 * 只认这个前缀是有意的：`git worktree list` 会把用户手工 `git worktree add`
 * 出来的一切也列出来，那些工作树不属于本插件，纳管它们等于凭空接管用户的
 * 目录。
 */
const OFFICIAL_WORKTREE_DIRECTORY = '.agents/worktrees'

export interface OfficialWorktreeAdoptionDependencies {
  lookup: SessionCheckoutLookupPort
  git: SessionCheckoutGitPort
  registry: SessionCheckoutRegistryPort
  createCheckoutId(): string
}

export interface OfficialWorktreeAdoptionResult {
  adopted: string[]
}

/** 官方 worktree 路径是否位于本项目官方的 `.agents/worktrees` 下。 */
function isOfficialWorktree(localRoot: string, path: string): boolean {
  const officialRoot = resolve(localRoot, OFFICIAL_WORKTREE_DIRECTORY)
  const candidate = relative(officialRoot, resolve(path))
  return candidate !== '' && !candidate.startsWith('..') && !isAbsolute(candidate)
}

/**
 * 把官方实验性 Worktree 工具创建的工作树纳管进本插件台账。
 *
 * 官方工具只做「创建工作树 + 切目录」，不写任何台账；接管它之后那些已经建好
 * 的工作树既不会出现在列表里，也交付不了、清理不了。这里按 git 的权威列表
 * 反查一次，把仍然是某个活跃会话当前目录的那些接进台账。
 *
 * 归属只能来自「谁正站在这棵树里」：官方工具不改 header.cwd，所以必须读宿主
 * 的实时工作目录（`getSessionCwd`）。多个会话同时站在同一棵树里时无法判定
 * 唯一 owner，跳过而不是猜。
 */
export async function adoptOfficialWorktrees(
  dependencies: OfficialWorktreeAdoptionDependencies,
): Promise<OfficialWorktreeAdoptionResult> {
  const { lookup, git, registry } = dependencies
  if (typeof git.listWorktrees !== 'function') return { adopted: [] }
  if (typeof lookup.listProjects !== 'function') return { adopted: [] }
  const ownerCwd = lookup.getSessionCwd
  if (ownerCwd === undefined) return { adopted: [] }

  const liveSessions = typeof lookup.listLiveSessions === 'function' ? lookup.listLiveSessions() : []
  if (liveSessions.length === 0) return { adopted: [] }

  // 每个活跃会话的实时目录 → 会话 id。重复的目录说明无法判定唯一 owner。
  const sessionsByCwd = new Map<string, string[]>()
  for (const session of liveSessions) {
    const cwd = ownerCwd(session.id)
    if (cwd === undefined) continue
    const key = normalize(cwd)
    sessionsByCwd.set(key, [...(sessionsByCwd.get(key) ?? []), session.id])
  }

  const adopted: string[] = []
  for (const project of lookup.listProjects()) {
    let listed
    try {
      listed = await git.listWorktrees(project.root)
    } catch {
      // 单个项目读不出工作树列表不该拦住其它项目的纳管。
      continue
    }
    for (const entry of listed) {
      if (!isOfficialWorktree(project.root, entry.path)) continue
      const owners = sessionsByCwd.get(normalize(entry.path))
      if (owners === undefined || owners.length !== 1) continue
      const ownerSessionId = owners[0]!

      const current = registry.read()
      if (isTracked(current.managedCheckouts, entry.path)) continue
      if (current.sessionBindings[ownerSessionId]?.target.kind === 'isolated') continue

      const snapshot = await git.inspect(entry.path)
      if (snapshot === null) continue

      const checkoutId = dependencies.createCheckoutId()
      const branchRef = entry.branchRef
      const sessionBranch = branchRef?.startsWith('refs/heads/')
        ? branchRef.slice('refs/heads/'.length)
        : undefined
      const record: ManagedCheckoutRecord = {
        checkoutId,
        projectId: project.id,
        projectName: project.name,
        ownerSessionId,
        localRoot: resolve(project.root),
        managedRoot: resolve(entry.path),
        managedGitRoot: resolve(snapshot.root),
        gitCommonDir: snapshot.commonDir,
        gitDir: snapshot.gitDir,
        baseOid: snapshot.headOid,
        sourceRef: snapshot.headRef,
        ...(sessionBranch === undefined ? {} : { sessionBranch }),
        // 已经存在于磁盘上且可读的一棵树就是就绪态：不需要创建、没有进行中的
        // journal，交付会按 tree 比较决定是否新建提交。
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
          [ownerSessionId]: {
            sessionId: ownerSessionId,
            projectId: project.id,
            projectName: project.name,
            target: { kind: 'isolated', checkoutId },
            ownerSessionId,
            sourceRef: snapshot.headRef,
            sourceOid: snapshot.headOid,
            revision: (next.sessionBindings[ownerSessionId]?.revision ?? 0) + 1,
          },
        },
      }))
      adopted.push(entry.path)
    }
  }
  return { adopted }
}

/** 台账里是否已经有记录指向这棵树（按工作树根或 Git 目录两边对齐）。 */
function isTracked(
  recorded: Record<string, ManagedCheckoutRecord>,
  path: string,
): boolean {
  const target = normalize(path)
  return Object.values(recorded).some(record =>
    record.phase !== 'discarded'
    && (normalize(record.managedRoot) === target || normalize(record.managedGitRoot) === target))
}

function normalize(path: string): string {
  const absolute = resolve(path)
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}
