/**
 * DSH lookup adapter: maps sessions and projects onto the harness's
 * `workspaceRegistry` service (retrieved dynamically, like the ecosystem's
 * plugins, because the published package version lags the rc.6 runtime). A
 * session's project is found by scanning workspace session accounts; when a
 * cleaned immutable cwd makes Harness filter a still-live Session from that
 * projection, the immutable live header may restore the exact mapping. A
 * project record maps to a workspace's `id`/`title`/`path`. Missing service or
 * records degrade to `undefined`, which the state machine treats as
 * recovery/orphan facts rather than failures.
 * @module dsh-git-worktree/adapters/lookup
 */

import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionCheckoutLookupPort, SessionCheckoutProjectRecord, SessionCheckoutSessionRecord } from '../ports.js'

/** Minimal structural view of the harness workspace registry (see `@deepseek-ai/dsh-workspace`). */
export interface WorkspaceLike {
  readonly id: string
  readonly path: string
  readonly title: string
  readonly sessionIds: readonly string[]
}

export interface WorkspaceRegistryLike {
  list(): WorkspaceLike[]
  get(id: string): WorkspaceLike | undefined
  resolveByPath(path: string): Promise<WorkspaceLike | undefined>
  create(path: string, title?: string): Promise<WorkspaceLike>
  delete(id: string): Promise<boolean>
}

interface LiveSessionLike {
  readonly header?: { readonly cwd?: unknown }
}

/**
 * Minimal structural view of the host `workingDirectory` service
 * (`@deepseek-ai/dsh-working-directory`). Only the synchronous read is used
 * here; moving a Session stays the job of `adapters/working-directory.ts`.
 */
interface WorkingDirectoryLike {
  get(session: unknown): unknown
}

interface SessionStoreLike {
  get(sessionId: string): LiveSessionLike | undefined
  list?(): readonly { id?: unknown; header?: { readonly id?: unknown; readonly createdAt?: unknown; readonly cwd?: unknown } }[]
}

/** Minimal structural view of the host `agents` registry's live handle lookup. */
interface AgentLike {
  readonly status?: unknown
  readonly origin?: unknown
}

interface AgentRegistryLike {
  get?(sessionId: string): AgentLike | undefined
}

function isWorkspaceRegistryLike(value: unknown): value is WorkspaceRegistryLike {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as WorkspaceRegistryLike).list === 'function'
    && typeof (value as WorkspaceRegistryLike).get === 'function'
}

function isSessionStoreLike(value: unknown): value is SessionStoreLike {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as SessionStoreLike).get === 'function'
}

function isWorkingDirectoryLike(value: unknown): value is WorkingDirectoryLike {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as WorkingDirectoryLike).get === 'function'
}

function sameResolvedPath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left)
  const normalizedRight = resolve(right)
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

/** Build the lookup port over Harness workspace and live-session projections. */
export function createDshLookupPort(ctx: Context): SessionCheckoutLookupPort {
  const registry = (): WorkspaceRegistryLike | undefined => {
    const candidate: unknown = ctx.get('workspaceRegistry')
    return isWorkspaceRegistryLike(candidate) ? candidate : undefined
  }
  const sessions = (): SessionStoreLike | undefined => {
    const candidate: unknown = ctx.get('sessions')
    return isSessionStoreLike(candidate) ? candidate : undefined
  }
  const workingDirectory = (): WorkingDirectoryLike | undefined => {
    const candidate: unknown = ctx.get('workingDirectory')
    return isWorkingDirectoryLike(candidate) ? candidate : undefined
  }
  const agents = (): AgentRegistryLike | undefined => {
    const candidate: unknown = ctx.get('agents')
    return candidate !== null && typeof candidate === 'object'
      && typeof (candidate as AgentRegistryLike).get === 'function'
      ? candidate as AgentRegistryLike
      : undefined
  }
  /**
   * The header cwd frozen at Session creation, read through one narrow helper.
   * It answers navigation identity (`listLiveSessions`, the `getSession`
   * recovery branch) and is the fallback when the host has no
   * `workingDirectory` service. Non-string and absent values collapse to
   * `undefined` here.
   */
  const liveHeaderCwd = (sessionId: string): string | undefined => {
    const liveCwd = sessions()?.get(sessionId)?.header?.cwd
    return typeof liveCwd === 'string' ? liveCwd : undefined
  }
  /**
   * The Session's LIVE working directory, read from the host projection this
   * plugin itself uses to move a Session into a checkout. `header.cwd` cannot
   * answer this: the Harness freezes it at creation and a Session that was
   * moved afterwards (`workingDirectory.set`) still carries the Local root
   * there, which made the branch capsule report `project_mismatch` for every
   * Managed Worktree opened inside an existing Session.
   */
  const liveWorkingDirectory = (sessionId: string): string | undefined => {
    const session = sessions()?.get(sessionId)
    if (session === undefined) return undefined
    const service = workingDirectory()
    if (service === undefined) return undefined
    const current: unknown = service.get(session)
    return typeof current === 'string' ? current : undefined
  }

  return {
    getSidebarMemberships: async (managedRoots) => {
      if (managedRoots.length === 0) return []
      const workspaces = registry()?.list() ?? []
      const query = ctx.get('sessionQuery') as {
        listSessions?(): Promise<readonly { header: { id: string; cwd?: string } }[]>
      } | undefined
      // Query headers, not transcript bodies or cached projection metadata.
      // A missing directory must not erase historical navigation identity.
      const headers = query?.listSessions ? (await query.listSessions()).map(item => item.header) : []
      return [...new Set(managedRoots)].map(managedRoot => {
        const matches = workspaces.filter(workspace => sameResolvedPath(workspace.path, managedRoot))
        return {
          managedRoot,
          workspaceIds: matches.map(workspace => workspace.id),
          sessionIds: [...new Set([
            ...matches.flatMap(workspace => [...workspace.sessionIds]),
            ...headers.filter(header => typeof header.cwd === 'string' && sameResolvedPath(header.cwd, managedRoot))
              .map(header => header.id),
          ])],
        }
      })
    },
    sessionAgentState: (sessionId) => {
      const registry = agents()
      // A missing service is "cannot answer"; a missing Agent for a listed
      // Session means it has no driver, so it is neither running nor contending.
      if (registry === undefined) return undefined
      const agent = registry.get?.(sessionId)
      if (agent === undefined) return undefined
      if (agent.status !== 'idle' && agent.status !== 'running') return undefined
      return {
        status: agent.status,
        ...(agent.origin === 'subagent' ? { origin: 'subagent' as const } : {}),
      }
    },
    listLiveSessions: () => {
      // Creation order from the store; only header fields the guard needs.
      // Structurally-unknown projections degrade to an empty list, which
      // keeps the branch-race guard silent rather than guessing.
      const store = sessions()
      if (!store?.list) return []
      try {
        return store.list()
          .map((session) => {
            const header = session?.header
            const id = typeof header?.id === 'string'
              ? header.id
              : (typeof session?.id === 'string' ? session.id : undefined)
            if (!id) return undefined
            return {
              id,
              ...(typeof header?.createdAt === 'number' ? { createdAt: header.createdAt } : {}),
              ...(typeof header?.cwd === 'string' ? { cwd: header.cwd } : {}),
            }
          })
          .filter((session): session is { id: string; createdAt?: number; cwd?: string } => session !== undefined)
      } catch {
        return []
      }
    },
    getSession: (sessionId): SessionCheckoutSessionRecord | undefined => {
      const workspaces = registry()?.list() ?? []
      for (const workspace of workspaces) {
        if (workspace.sessionIds.includes(sessionId)) {
          return { id: sessionId, projectId: workspace.id }
        }
      }

      // Harness filters Workspace.sessionIds when an immutable cwd no longer
      // resolves. A cleaned delivered Session can still be live and retain that
      // exact cwd in its header, so recover only this authenticated live case.
      const liveCwd = liveHeaderCwd(sessionId)
      if (liveCwd === undefined) return undefined
      const matches = workspaces.filter(workspace => sameResolvedPath(workspace.path, liveCwd))
      return matches.length === 1
        ? { id: sessionId, projectId: matches[0]!.id }
        : undefined
    },
    getSessionCwd: (sessionId): string | undefined => {
      // Authorization evidence must be the directory the Session is standing in
      // RIGHT NOW: a Managed Worktree opened inside an existing Session moves it
      // with `workingDirectory.set`, which never touches the frozen header. The
      // header only answers for hosts without the service (and for a freshly
      // created target, whose header already IS its worktree root).
      return liveWorkingDirectory(sessionId) ?? liveHeaderCwd(sessionId)
    },
    getProject: (projectId): SessionCheckoutProjectRecord | undefined => {
      const workspace = registry()?.get(projectId)
      return workspace
        ? { id: workspace.id, name: workspace.title, root: workspace.path }
        : undefined
    },
  }
}
