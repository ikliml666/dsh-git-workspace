/**
 * Workspace contention notice.
 *
 * Every Session starts in the Local checkout, and the harness happily runs
 * several Sessions in the same workspace at once. Two Sessions editing one
 * Local checkout lose each other's branch switches, commits and working-tree
 * edits, and a branch that is already checked out in another Worktree cannot be
 * switched to at all. Those are the two facts this module reports so the model
 * isolates through `worktree_create` before it mutates files.
 *
 * The module is pure and synchronous: the dynamic system-prompt provider may not
 * await, so the caller collects the asynchronous facts (live Sessions from the
 * harness store, one cached `git worktree list` probe) and passes them in.
 *
 * @module dsh-git-worktree/workspace-contention
 */

import { resolve } from 'node:path'
import type { WorktreeOccupancyEntry } from './ports.js'

/** Facts the caller has already collected; this module performs no I/O. */
export interface WorkspaceContentionInput {
  /** Ids of the other live Sessions rooted in the same Local checkout. */
  readonly otherSessionIds: readonly string[]
  /** The Local checkout root this Session would work in. */
  readonly localRoot: string
  /** Short branch name checked out in Local; null when HEAD is detached. */
  readonly localBranch: string | null
  /** Every Worktree Git reports for this repository, the Local checkout included. */
  readonly worktrees: readonly WorktreeOccupancyEntry[]
  /** Path equality for the host platform (case-insensitive on Windows). */
  readonly samePath: (left: string, right: string) => boolean
}

export interface WorkspaceContentionFacts {
  /** Other live Sessions sharing the Local checkout. */
  readonly otherSessionIds: readonly string[]
  /** Short branch name checked out in Local, when known. */
  readonly localBranch: string | null
  /** Worktrees other than Local that check out the same branch. */
  readonly branchHolders: readonly string[]
}

/** Apply the two contention rules; `clear` is the overwhelmingly common answer. */
export function detectWorkspaceContention(input: WorkspaceContentionInput): WorkspaceContentionFacts {
  const branchHolders = input.localBranch === null
    ? []
    : input.worktrees
      .filter((entry) => entry.branch === input.localBranch)
      .filter((entry) => !input.samePath(entry.path, input.localRoot))
      .map((entry) => entry.path)
  return {
    otherSessionIds: [...input.otherSessionIds],
    localBranch: input.localBranch,
    branchHolders,
  }
}

/**
 * The instruction appended to runtime context, or an empty string when nothing
 * contends. Short on purpose: it repeats on every assembly until the Session
 * isolates, so it must stay one glance long.
 */
export function renderWorkspaceContentionNotice(
  facts: WorkspaceContentionFacts,
  localRoot: string,
): string {
  if (facts.otherSessionIds.length === 0 && facts.branchHolders.length === 0) return ''
  const lines: string[] = []
  if (facts.otherSessionIds.length > 0) {
    const count = facts.otherSessionIds.length
    const verb = count === 1 ? 'Session is' : 'Sessions are'
    lines.push(`Workspace contention: ${count} other live ${verb} working in this same Local checkout (${localRoot}).`)
  }
  if (facts.branchHolders.length > 0) {
    lines.push(`Branch "${facts.localBranch}" is also checked out in another Worktree (${facts.branchHolders.join(', ')}); switching or merging that branch in Local conflicts with it.`)
  }
  lines.push('Before changing files, call worktree_create so this task runs in its own Worktree. Do not edit the Local checkout while another Session shares it.')
  return lines.join('\n')
}
/** Minimal live-Session projection the Local-session scan needs from the host. */
export interface LocalSessionScanLookup {
  listLiveSessions?(): readonly { id: string; cwd?: string }[]
  getSessionCwd?(sessionId: string): string | undefined
  getSession(sessionId: string): { projectId?: string } | undefined
  /** Runtime state of the Session's own Agent; undefined when the host cannot answer. */
  sessionAgentState?(sessionId: string): { status: 'idle' | 'running'; origin?: 'subagent' } | undefined
}

/** Inputs for deciding which live Sessions still contend for one Local checkout. */
export interface LocalSessionScanInput {
  readonly lookup: LocalSessionScanLookup
  readonly sessionId: string
  /** Local checkout root the calling Session would work in. */
  readonly localRoot: string
  /** Project identity of the calling Session, when the registry can name it. */
  readonly ownProjectId?: string
  /** Managed Worktree roots: a cwd inside one is already isolated. */
  readonly isolatedRoots: readonly string[]
  /** Sessions already bound to an isolated target. */
  readonly isolatedSessionIds: readonly string[]
}

function normalizedBoundary(path: string): string {
  const slashed = resolve(path).replace(/\\/gu, '/').replace(/\/+$/u, '')
  return process.platform === 'win32' ? slashed.toLowerCase() : slashed
}

function isWithinBoundary(candidate: string, root: string): boolean {
  const normalizedCandidate = normalizedBoundary(candidate)
  const normalizedRoot = normalizedBoundary(root)
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`)
}

/**
 * Ids of live Sessions still contending for the same Local checkout. A Session
 * that already moved into a Worktree does not contend: it is bound to an
 * isolated target, or its cwd already sits in a managed root or in the official
 * `.agents/worktrees` pool (adoption can lag the cwd change by one event).
 */
export function otherLocalSessionIds(input: LocalSessionScanInput): string[] {
  const listLiveSessions = input.lookup.listLiveSessions
  if (typeof listLiveSessions !== 'function') return []
  const officialPool = `${normalizedBoundary(input.localRoot)}/.agents/worktrees`
  const isolatedSessions = new Set(input.isolatedSessionIds)
  return listLiveSessions()
    .filter((session) => session.id !== input.sessionId)
    .filter((session) => !isolatedSessions.has(session.id))
    .filter((session) => {
      // "Live in the store" is not "working right now": an idle Session keeps
      // its cwd forever, and counting it would block branch operations on a
      // checkout nobody is actually editing. Delegated child agents work inside
      // the parent's checkout by design and never contend for it.
      const agentState = input.lookup.sessionAgentState?.(session.id)
      if (agentState !== undefined) {
        if (agentState.status !== 'running') return false
        if (agentState.origin === 'subagent') return false
      }
      const liveCwd = input.lookup.getSessionCwd?.(session.id)
      const sessionCwd = typeof liveCwd === 'string' ? liveCwd : session.cwd
      // A Session with no cwd cannot be proven to share this checkout; guessing
      // would refuse operations on evidence the host never supplied.
      if (sessionCwd === undefined) return false
      if (isWithinBoundary(sessionCwd, officialPool)) return false
      if (input.isolatedRoots.some((root) => isWithinBoundary(sessionCwd, root))) return false
      // Same Workspace is the strong signal; a textual boundary only covers
      // Sessions the registry cannot place yet.
      if (input.ownProjectId !== undefined && input.lookup.getSession(session.id)?.projectId === input.ownProjectId) {
        return true
      }
      return isWithinBoundary(sessionCwd, input.localRoot) || isWithinBoundary(input.localRoot, sessionCwd)
    })
    .map((session) => session.id)
}
