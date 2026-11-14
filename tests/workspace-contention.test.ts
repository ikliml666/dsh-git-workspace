import { describe, expect, test } from 'vitest'
import type { WorktreeOccupancyEntry } from '../src/ports.ts'
import { detectWorkspaceContention, otherLocalSessionIds, renderWorkspaceContentionNotice } from '../src/workspace-contention.ts'

const localRoot = '/repo'
const samePath = (left: string, right: string): boolean => left === right
const worktrees: WorktreeOccupancyEntry[] = [
  { path: '/repo', branch: 'main' },
  { path: '/repo/.agents/worktrees/feat-a', branch: 'feat-a' },
]

describe('Workspace contention', () => {
  test('Given no other Session and no branch holder Then the notice stays empty', () => {
    const facts = detectWorkspaceContention({
      otherSessionIds: [],
      localRoot,
      localBranch: 'main',
      worktrees,
      samePath,
    })
    expect(facts).toEqual({ otherSessionIds: [], localBranch: 'main', branchHolders: [] })
    expect(renderWorkspaceContentionNotice(facts, localRoot)).toBe('')
  })

  test('Given another live Session shares the Local checkout Then the notice counts it and points at worktree_create', () => {
    const facts = detectWorkspaceContention({
      otherSessionIds: ['other'],
      localRoot,
      localBranch: 'main',
      worktrees,
      samePath,
    })
    const notice = renderWorkspaceContentionNotice(facts, localRoot)
    expect(notice).toContain('1 other live Session is working in this same Local checkout (/repo)')
    expect(notice).toContain('call worktree_create')
    expect(notice).not.toContain('Branch "')
  })

  test('Given two other Sessions share the checkout Then the notice uses the plural form', () => {
    const facts = detectWorkspaceContention({
      otherSessionIds: ['other-a', 'other-b'],
      localRoot,
      localBranch: 'main',
      worktrees,
      samePath,
    })
    expect(renderWorkspaceContentionNotice(facts, localRoot)).toContain('2 other live Sessions are working')
  })

  test('Given another Worktree checks out the Local branch Then the branch is reported as held', () => {
    const facts = detectWorkspaceContention({
      otherSessionIds: [],
      localRoot,
      localBranch: 'feat-a',
      worktrees,
      samePath,
    })
    expect(facts.branchHolders).toEqual(['/repo/.agents/worktrees/feat-a'])
    const notice = renderWorkspaceContentionNotice(facts, localRoot)
    expect(notice).toContain('Branch "feat-a" is also checked out in another Worktree (/repo/.agents/worktrees/feat-a)')
    expect(notice).toContain('call worktree_create')
  })

  test('Given the Local checkout itself is the only holder Then no branch occupies it', () => {
    const facts = detectWorkspaceContention({
      otherSessionIds: [],
      localRoot,
      localBranch: 'main',
      worktrees,
      samePath,
    })
    expect(facts.branchHolders).toEqual([])
  })

  test('Given a running subagent in the same checkout Then it does not contend', () => {
    const live = [
      { id: 'self', cwd: '/repo' },
      { id: 'child-agent', cwd: '/repo' },
    ]
    const ids = otherLocalSessionIds({
      lookup: {
        listLiveSessions: () => live,
        getSession: () => ({ projectId: 'p1' }),
        sessionAgentState: (id) => ({ status: 'running', ...(id === 'child-agent' ? { origin: 'subagent' as const } : {}) }),
      },
      sessionId: 'self',
      localRoot: '/repo',
      ownProjectId: 'p1',
      isolatedRoots: [],
      isolatedSessionIds: [],
    })
    expect(ids).toEqual([])
  })

  test('Given an idle Session while another runs Then only the running one contends', () => {
    const live = [
      { id: 'self', cwd: '/repo' },
      { id: 'idle-session', cwd: '/repo' },
      { id: 'busy-session', cwd: '/repo' },
    ]
    const ids = otherLocalSessionIds({
      lookup: {
        listLiveSessions: () => live,
        getSession: () => ({ projectId: 'p1' }),
        sessionAgentState: (id) => ({ status: id === 'idle-session' ? 'idle' : 'running' }),
      },
      sessionId: 'self',
      localRoot: '/repo',
      ownProjectId: 'p1',
      isolatedRoots: [],
      isolatedSessionIds: [],
    })
    expect(ids).toEqual(['busy-session'])
  })

  test('Given live Sessions in the same project Then only the ones still in Local are listed', () => {
    const live = [
      { id: 'self', cwd: '/repo' },
      { id: 'same-project', cwd: '/elsewhere' },
      { id: 'isolated-binding', cwd: '/repo' },
      { id: 'in-managed-tree', cwd: '/worktrees/a' },
      { id: 'in-official-pool', cwd: '/repo/.agents/worktrees/feat' },
      { id: 'no-cwd' },
    ]
    const ids = otherLocalSessionIds({
      lookup: {
        listLiveSessions: () => live,
        getSession: (id) => ({ projectId: id === 'same-project' || id === 'self' ? 'p1' : 'p-' + id }),
      },
      sessionId: 'self',
      localRoot: '/repo',
      ownProjectId: 'p1',
      isolatedRoots: ['/worktrees/a'],
      isolatedSessionIds: ['isolated-binding'],
    })
    expect(ids).toEqual(['same-project'])
  })

  test('Given a host without a live-session store Then the scan stays silent', () => {
    expect(otherLocalSessionIds({
      lookup: { getSession: () => ({ projectId: 'p1' }) },
      sessionId: 'self',
      localRoot: '/repo',
      isolatedRoots: [],
      isolatedSessionIds: [],
    })).toEqual([])
  })
  test('Given the Local HEAD is detached Then no branch holder can be derived', () => {
    const facts = detectWorkspaceContention({
      otherSessionIds: [],
      localRoot,
      localBranch: null,
      worktrees: [{ path: '/repo/.agents/worktrees/feat-a', branch: null }],
      samePath,
    })
    expect(facts.branchHolders).toEqual([])
    expect(renderWorkspaceContentionNotice(facts, localRoot)).toBe('')
  })
})
