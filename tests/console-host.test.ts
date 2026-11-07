import { longCommitMessage } from './support/commit-message.js'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { SessionCheckoutModule } from '../src/index.js'
import type {
  ManagedCheckoutRecord,
  ManagedCheckoutsRegistry,
  SessionCheckoutFilesPort,
  SessionCheckoutGitPort,
  SessionCheckoutLookupPort,
  SessionCheckoutRegistryPort,
} from '../src/ports.js'
import type { SessionTargetView } from '../src/types.js'
import { checkpointGenerationForRecord } from '../src/checkpoint.js'
import { createWorktreeConsoleControlPlane } from '../src/console-host/control-plane.js'
import {
  createGitWorktreeReviewDiffReader,
  REVIEW_DIFF_MAX_PATCH_BYTES,
  REVIEW_DIFF_MAX_PAYLOAD_BYTES,
} from '../src/console-host/review-diff.js'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)

function runGit(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}

function local(sessionId = 'source-session'): SessionTargetView {
  return {
    project: { id: 'project-1', name: 'Project' },
    checkout: { id: 'local', kind: 'local', label: 'Local', phase: 'ready' },
    source: { ref: 'refs/heads/main', oid: A },
    current: { branch: 'main', oid: A },
    ownership: 'owner', dirty: false, revision: 1,
  }
}

function readyRecord(): ManagedCheckoutRecord {
  return {
    checkoutId: 'checkout-1', projectId: 'project-1', projectName: 'Project',
    ownerSessionId: 'target-session', sourceSessionId: 'source-session',
    localRoot: '/local', managedRoot: '/managed', managedGitRoot: '/managed',
    gitCommonDir: '/git/common', gitDir: '/git/worktrees/one', baseOid: A,
    sourceRef: 'refs/heads/main', phase: 'ready', journal: null, revision: 7,
    delivery: {
      state: 'ready_for_review',
      review: {
        reviewId: 'review-1', iteration: 1, preparedAt: 1, summary: 'Ready',
        validationStatus: 'passed', tests: [], changedFiles: ['src/index.ts'],
        suggestedCommitMessage: 'fix: persisted review', isolatedFingerprint: 'fingerprint-1', isolatedHeadOid: B,
      },
    },
  }
}

/** Narrow a fresh record's delivery to its review payload for mutation. */
function readyReviewOf(record: ManagedCheckoutRecord): ManagedWorktreeReviewRecord {
  if (record.delivery.state !== 'ready_for_review') throw new Error('fixture')
  return record.delivery.review
}

/** A Worktree that reached delivery and is still inside the retention window. */
function retainedRecord(): ManagedCheckoutRecord {
  const record = readyRecord()
  record.phase = 'retained'
  record.revision = 9
  record.sessionBranch = 'refs/heads/feat/sess-target-session--task'
  record.delivery = {
    state: 'retained', review: readyReviewOf(record), commitOid: B, isolatedFingerprint: 'fingerprint-1',
    retention: 'retain_24h', retainedAt: 10, expiresAt: 20, cleanup: 'scheduled',
  }
  return record
}

function registry(record = readyRecord()): SessionCheckoutRegistryPort {
  const value: ManagedCheckoutsRegistry = {
    version: 2, revision: 1, sessionBindings: {}, managedCheckouts: { [record.checkoutId]: record },
  }
  return { read: () => structuredClone(value), write: vi.fn(), update: () => { throw new Error('control plane must not update the registry') } }
}

function moduleDouble(record = readyRecord()): SessionCheckoutModule {
  const isolated: SessionTargetView = {
    project: { id: record.projectId, name: record.projectName },
    checkout: { id: record.checkoutId, kind: 'isolated', label: 'Task', phase: record.phase },
    source: { ref: record.sourceRef, oid: record.baseOid },
    current: { branch: null, oid: B }, ownership: 'owner', dirty: true, revision: record.revision,
    delivery: {
      state: 'ready_for_review',
      review: {
        reviewId: 'review-1', iteration: 1, preparedAt: 1, summary: 'Ready', validationStatus: 'passed',
        tests: [], changedFiles: ['src/index.ts'], suggestedCommitMessage: 'fix: persisted review',
      },
    },
  }
  return {
    inspect: vi.fn(async sessionId => sessionId === 'target-session' ? isolated : local(sessionId)),
    runtimeContext: vi.fn(),
    preflight: vi.fn(async () => ({
      status: 'ready', localModified: false, checkoutId: record.checkoutId, reviewId: 'review-1', revision: 7,
      configuredBaseOid: A, effectiveBaseOid: A, baseStrategy: 'recorded_base', localBranch: 'main',
      localHeadOid: A, isolatedHeadOid: B, changedFiles: ['src/index.ts'],
    })),
    runExclusiveSessionMutation: vi.fn(), bind: vi.fn(), beginNextIteration: vi.fn(), resumeRevision: vi.fn(),
    prepareReviewRegeneration: vi.fn(), markReadyForReview: vi.fn(),
    createIsolatedTarget: vi.fn(async (sourceSessionId, targetSessionId) => ({ targetSessionId, managedRoot: '/managed', target: isolated })),
    operate: vi.fn(), listManagedWorktrees: vi.fn(), inspectManagedWorktreeCleanup: vi.fn(), bulkCleanupManagedWorktrees: vi.fn(),
    listManagedWorktreesForSession: vi.fn(async sessionId => sessionId === 'intruder-session' ? [] : [{
      checkoutId: record.checkoutId, revision: record.revision, ownerSessionId: record.ownerSessionId, ownerSessionTitle: 'Task',
      project: { id: record.projectId, name: record.projectName }, iteration: 1, state: 'ready_for_review', phase: record.phase,
      dirty: true, commitOid: null, approximateBytes: null, updatedAt: 1, canCleanup: false,
    }]),
    manageManagedWorktreeForSession: vi.fn(), manageManagedWorktree: vi.fn(),
    resolveManagedRoot: vi.fn(async () => '/managed'), cleanupExpiredRetained: vi.fn(), reconcile: vi.fn(),
  } as unknown as SessionCheckoutModule
}

function lookupDouble(): SessionCheckoutLookupPort {
  return {
    getSession: sessionId => ({ id: sessionId, projectId: sessionId === 'target-session' ? 'workspace-target' : 'project-1' }),
    getProject: projectId => ({ id: projectId, name: 'Project', root: projectId === 'workspace-target' ? '/managed' : '/local' }),
  }
}

/** A live owner Session's project root is the Local checkout, never the managed root. */
function ownerLocalLookup(): SessionCheckoutLookupPort {
  const lookup = lookupDouble()
  lookup.getProject = vi.fn(projectId => ({ id: projectId, name: 'Project', root: '/local' }))
  return lookup
}

function filesDouble(): SessionCheckoutFilesPort {
  return {
    exists: () => true,
    canonicalize: vi.fn(async path => path),
    inspectDirectoryIdentity: vi.fn(), ensureDirectory: vi.fn(), removeEmptyDirectoryTree: vi.fn(),
    quarantineDirectoryTree: vi.fn(), removeDirectoryTree: vi.fn(), measureDirectoryBytes: vi.fn(),
  }
}

function gitDouble(): SessionCheckoutGitPort {
  return {
    inspect: vi.fn(async () => ({ root: '/managed', commonDir: '/git/common', gitDir: '/git/worktrees/one', branch: null, headOid: B, headRef: 'HEAD' })),
    findContainingWorktreeRoot: vi.fn(), status: vi.fn(async () => ({ dirty: true })), createDetachedWorktree: vi.fn(),
    removeWorktree: vi.fn(), retainApplyBase: vi.fn(), releaseApplyBase: vi.fn(), retainInternalArtifact: vi.fn(),
    readInternalArtifact: vi.fn(), releaseInternalArtifacts: vi.fn(), isAncestor: vi.fn(),
  }
}

function plane(record = readyRecord(), overrides: {
  lookup?: SessionCheckoutLookupPort
  files?: SessionCheckoutFilesPort
  registry?: SessionCheckoutRegistryPort
  git?: SessionCheckoutGitPort
} = {}) {
  const module = moduleDouble(record)
  return {
    module,
    control: createWorktreeConsoleControlPlane({
      module,
      lookup: overrides.lookup ?? lookupDouble(),
      files: overrides.files ?? filesDouble(),
      registry: overrides.registry ?? registry(record), git: overrides.git ?? gitDouble(), createTargetSessionId: () => 'host-target',
      reviewDiff: { read: vi.fn(async input => ({ reviewId: input.reviewId, revision: input.revision, files: [], truncated: false })) },
      setWorktreeRequest: () => null,
      pendingWorktreeRequest: () => null,
    }),
  }
}

describe('Worktree Console Host control plane', () => {
  it('projects an unselected live Git Session as Local without mutating its binding', async () => {
    const { module, control } = plane()
    vi.mocked(module.inspect).mockRejectedValueOnce(Object.assign(
      new Error('会话尚未选择 Session Target'),
      { code: 'target_unselected' },
    ))

    const result = await control.current('source-session')

    expect(result).toMatchObject({
      ok: true,
      value: {
        target: {
          state: 'local',
          phase: 'local',
          sourceSessionId: 'source-session',
          managedRoot: null,
          capabilities: { create: true },
        },
      },
    })
    expect(module.bind).not.toHaveBeenCalled()
  })

  it('names the Session own branch on the target even when the Worktree reads as detached', async () => {
    const record = readyRecord()
    record.sessionBranch = 'refs/heads/feat/sess-target-session--labels'
    const { control } = plane(record)

    const result = await control.current('target-session')

    expect(result).toMatchObject({
      ok: true,
      value: {
        target: {
          currentBranch: 'feat/sess-target-session--labels',
          sourceBranch: 'feat/sess-target-session--labels',
        },
      },
    })
  })

  it('falls back to the fork point for a legacy record that has no session branch', async () => {
    const { control } = plane()

    const result = await control.current('target-session')

    // The git double reports a detached Worktree and the fixture predates
    // session branches, so both labels stay on the recorded source ref rather
    // than inventing a branch.
    expect(result).toMatchObject({
      ok: true,
      value: { target: { currentBranch: null, sourceBranch: 'main' } },
    })
  })

  it('does not advertise Worktree creation for a bound Local Session outside a Git repository', async () => {
    const { module, control } = plane()
    vi.mocked(module.inspect).mockResolvedValueOnce({
      ...local('source-session'),
      source: { ref: 'WORKING_TREE', oid: 'unversioned' },
      current: { branch: null, oid: 'unversioned' },
    })

    await expect(control.current('source-session')).resolves.toMatchObject({
      ok: true,
      value: { target: { state: 'local', currentOid: 'unversioned', capabilities: { create: false } } },
    })
  })

  it('reports an unbound non-Git Session as unsupported without reading Git status', async () => {
    const gitPort = gitDouble()
    vi.mocked(gitPort.inspect).mockResolvedValueOnce(null)
    const { module, control } = plane(readyRecord(), { git: gitPort })
    vi.mocked(module.inspect).mockRejectedValueOnce(Object.assign(
      new Error('会话尚未选择 Session Target'),
      { code: 'target_unselected' },
    ))

    await expect(control.current('source-session')).resolves.toMatchObject({
      ok: false,
      error: { code: 'not_git_repository' },
    })
    expect(gitPort.status).not.toHaveBeenCalled()
  })


  it('projects path-free Sidebar tasks and keeps only the latest iteration for one owner Session', async () => {
    const previous = readyRecord()
    previous.checkoutId = 'checkout-previous'
    previous.phase = 'discarded'
    previous.delivery = { state: 'delivered', iteration: 1, commitOid: A, deliveredAt: 10 }
    previous.revision = 9
    const current = readyRecord()
    current.checkoutId = 'checkout-current'
    if (current.delivery.state !== 'ready_for_review') throw new Error('fixture must be ready')
    current.delivery.review.iteration = 2
    current.revision = 3
    const other = readyRecord()
    other.checkoutId = 'checkout-discarded'
    other.ownerSessionId = 'discarded-owner'
    other.sourceSessionId = 'discarded-source'
    other.phase = 'discarded'
    other.delivery = { state: 'delivered', iteration: 1, commitOid: null, deliveredAt: 12 }
    // A discard whose delivery never happened is the only real abandonment.
    const abandoned = readyRecord()
    abandoned.checkoutId = 'checkout-abandoned'
    abandoned.ownerSessionId = 'abandoned-owner'
    abandoned.sourceSessionId = 'abandoned-source'
    abandoned.phase = 'discarded'
    abandoned.delivery = { state: 'working', iteration: 1 }

    const sidebarRegistry: ManagedCheckoutsRegistry = {
      version: 2,
      revision: 3,
      sessionBindings: {},
      managedCheckouts: {
        [previous.checkoutId]: previous,
        [current.checkoutId]: current,
        [other.checkoutId]: other,
        [abandoned.checkoutId]: abandoned,
      },
    }
    const { control } = plane(current, {
      registry: { read: () => structuredClone(sidebarRegistry), write: vi.fn(), update: () => { throw new Error('control plane must not update the registry') } },
    })

    await expect(control.sidebarTopology()).resolves.toEqual({
      ok: true,
      value: {
        projects: [{
          project: { id: 'project-1', name: 'Project' },
          tasks: [
            expect.objectContaining({
              checkoutId: 'checkout-current',
              ownerSessionId: 'target-session',
              iteration: 2,
              state: 'ready_for_review',
            }),
            expect.objectContaining({
              checkoutId: 'checkout-discarded',
              ownerSessionId: 'discarded-owner',
              // Delivered to Local and then cleaned up: a completed task, not an abandoned one.
              state: 'finalized',
            }),
            expect.objectContaining({
              checkoutId: 'checkout-abandoned',
              ownerSessionId: 'abandoned-owner',
              state: 'discarded',
            }),
          ],
        }],
      },
    })
  })

  it('carries directory memberships from every iteration without exposing paths', async () => {
    const old = readyRecord()
    old.checkoutId = 'old'
    old.managedRoot = '/old-root'
    old.delivery = { state: 'delivered', iteration: 1, commitOid: A, deliveredAt: 10 }
    const current = readyRecord()
    current.managedRoot = '/new-root'
    readyReviewOf(current).iteration = 2
    const lookup = {
      getProject: vi.fn(), getSession: vi.fn(),
      getSidebarMemberships: vi.fn(async () => [
        { managedRoot: '/old-root', workspaceIds: ['empty-old'], sessionIds: ['cold'] },
        { managedRoot: '/new-root', workspaceIds: ['current'], sessionIds: ['target-session'] },
      ]),
    }
    const { control } = plane(current, {
      lookup,
      registry: { read: () => ({ version: 2, revision: 1, sessionBindings: {}, managedCheckouts: { old, current } }), write: vi.fn() },
    })
    const result = await control.sidebarTopology()
    expect(lookup.getSidebarMemberships).toHaveBeenCalledWith(['/old-root', '/new-root'])
    expect(result.ok && result.value.projects[0]?.memberships).toEqual({ workspaceIds: ['empty-old', 'current'], sessionIds: ['cold', 'target-session'] })
    expect(JSON.stringify(result)).not.toContain('/old-root')
    expect(JSON.stringify(result)).not.toContain('/new-root')
    expect(result.ok && result.value.projects[0]?.tasks).toHaveLength(1)
  })

  it('projects a cleaned delivered owner even though its immutable Workspace path is temporarily absent', async () => {
    const delivered = readyRecord()
    delivered.phase = 'discarded'
    delivered.revision = 9
    delivered.delivery = { state: 'delivered', iteration: 1, commitOid: B, deliveredAt: 10 }
    const lookup = lookupDouble()
    lookup.getSession = sessionId => ({ id: sessionId, projectId: sessionId === 'target-session' ? 'workspace-target' : 'project-1' })
    lookup.getProject = projectId => ({ id: projectId, name: 'Project', root: projectId === 'workspace-target' ? '/managed' : '/local' })
    const files = filesDouble()
    files.exists = path => path !== '/managed'
    const { module, control } = plane(delivered, { lookup, files })
    vi.mocked(module.inspect).mockResolvedValue({
      project: { id: delivered.projectId, name: delivered.projectName },
      checkout: { id: delivered.checkoutId, kind: 'isolated', label: 'Task', phase: 'discarded' },
      source: { ref: delivered.sourceRef, oid: delivered.baseOid },
      current: { branch: 'main', oid: B }, ownership: 'owner', dirty: false, revision: delivered.revision,
      delivery: { state: 'delivered', iteration: 1, commitOid: B, deliveredAt: 10 },
    })

    const result = await control.current('target-session')

    expect(result).toMatchObject({
      ok: true,
      value: { target: { state: 'delivered', managedRoot: null, capabilities: { beginNextIteration: true } } },
    })
  })

  it('resumes the exact unsynced review without writing Local or changing checkout identity', async () => {
    const record = readyRecord()
    let registryValue: ManagedCheckoutsRegistry = {
      version: 2, revision: 1, sessionBindings: {}, managedCheckouts: { [record.checkoutId]: record },
    }
    const registryPort: SessionCheckoutRegistryPort = {
      read: () => structuredClone(registryValue),
      write: nextValue => { registryValue = structuredClone(nextValue) },
      update: mutate => { registryValue = mutate(structuredClone(registryValue)); return registryValue },
    }
    const { module, control } = plane(record, { registry: registryPort })
    vi.mocked(module.resumeRevision).mockImplementation(async () => {
      const current = registryValue.managedCheckouts[record.checkoutId]!
      registryValue = {
        ...registryValue,
        revision: registryValue.revision + 1,
        managedCheckouts: {
          ...registryValue.managedCheckouts,
          [record.checkoutId]: { ...current, revision: 8, delivery: { state: 'working', iteration: 1 } },
        },
      }
      return {
        project: { id: record.projectId, name: record.projectName },
        checkout: { id: record.checkoutId, kind: 'isolated', label: 'Task', phase: 'ready' },
        source: { ref: record.sourceRef, oid: record.baseOid }, current: { branch: null, oid: B },
        ownership: 'owner', dirty: true, revision: 8, delivery: { state: 'working', iteration: 1 },
      }
    })

    const result = await control.resumeRevision({
      sessionId: 'target-session', checkoutId: 'checkout-1', expectedRevision: 7, expectedReviewId: 'review-1',
    })

    expect(result).toMatchObject({
      ok: true,
      value: { target: { checkoutId: 'checkout-1', state: 'working', iteration: 1, revision: 8 } },
    })
    expect(module.resumeRevision).toHaveBeenCalledWith('target-session', 7, 'review-1')
  })

  it('persists and returns an exact Host conflict proof before renderer continuation', async () => {
    const record = readyRecord()
    let value: ManagedCheckoutsRegistry = {
      version: 2, revision: 1, sessionBindings: {}, managedCheckouts: { [record.checkoutId]: record },
    }
    const registryPort: SessionCheckoutRegistryPort = {
      read: () => structuredClone(value),
      write: nextValue => { value = structuredClone(nextValue) },
      update: mutate => { value = mutate(structuredClone(value)); return value },
    }
    const { module, control } = plane(record, { registry: registryPort })
    vi.mocked(module.preflight!).mockResolvedValue({
      status: 'conflict', localModified: false, checkoutId: record.checkoutId, reviewId: 'review-1', revision: 7,
      configuredBaseOid: A, effectiveBaseOid: A, baseStrategy: 'recorded_base', localBranch: 'main',
      localHeadOid: A, isolatedHeadOid: B, changedFiles: ['src/index.ts'], conflictingFiles: ['src/index.ts'],
    })
    vi.mocked(module.resumeRevision).mockImplementation(async (_sessionId, _revision, _reviewId, recovery) => {
      if (!recovery) throw new Error('expected recovery')
      const current = value.managedCheckouts[record.checkoutId]!
      value = {
        ...value,
        revision: value.revision + 1,
        managedCheckouts: {
          ...value.managedCheckouts,
          [record.checkoutId]: {
            ...current,
            revision: 8,
            delivery: { state: 'working', iteration: 1 },
            recoveryContinuation: { ...recovery, workingRevision: 8 },
          },
        },
      }
      return {
        project: { id: record.projectId, name: record.projectName },
        checkout: { id: record.checkoutId, kind: 'isolated', label: 'Task', phase: 'ready' },
        source: { ref: record.sourceRef, oid: record.baseOid }, current: { branch: null, oid: B },
        ownership: 'owner', dirty: true, revision: 8, delivery: { state: 'working', iteration: 1 },
      }
    })

    const result = await control.resumeRevision({
      sessionId: 'target-session', checkoutId: 'checkout-1', expectedRevision: 7, expectedReviewId: 'review-1',
      conflictContinuation: {
        kind: 'worktree_apply_conflict', requestId: 'renderer-context-only', checkoutId: 'checkout-1',
        reviewId: 'review-1', revision: 7, localHeadOid: A, conflictingFiles: ['src/index.ts'],
      },
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        target: { state: 'working', revision: 8 },
        recoveryContinuation: {
          kind: 'worktree_apply_conflict', checkoutId: 'checkout-1', reviewId: 'review-1', revision: 8,
          localHeadOid: A, conflictingFiles: ['src/index.ts'], requestId: expect.stringMatching(/^conflict-recovery:/),
        },
      },
    })
    expect(module.resumeRevision).toHaveBeenCalledWith(
      'target-session', 7, 'review-1', expect.objectContaining({
        kind: 'worktree_apply_conflict', requestId: expect.stringMatching(/^conflict-recovery:/), readyRevision: 7,
      }),
    )
  })

  it('persists a separate read-only regeneration proof without resuming Working', async () => {
    const record = readyRecord()
    let value: ManagedCheckoutsRegistry = {
      version: 2, revision: 1, sessionBindings: {}, managedCheckouts: { [record.checkoutId]: record },
    }
    const registryPort: SessionCheckoutRegistryPort = {
      read: () => structuredClone(value),
      write: nextValue => { value = structuredClone(nextValue) },
      update: mutate => { value = mutate(structuredClone(value)); return value },
    }
    const { module, control } = plane(record, { registry: registryPort })
    vi.mocked(module.prepareReviewRegeneration!).mockImplementation(async (_sessionId, revision, reviewId, requestId) => {
      const proof = { kind: 'worktree_review_regeneration' as const, requestId, reviewId, revision }
      value = {
        ...value,
        revision: value.revision + 1,
        managedCheckouts: { ...value.managedCheckouts, [record.checkoutId]: { ...record, recoveryContinuation: proof } },
      }
      return proof
    })

    const result = await control.prepareReviewRegeneration({
      sessionId: 'target-session', checkoutId: 'checkout-1', expectedRevision: 7, expectedReviewId: 'review-1',
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        target: { state: 'ready_for_review', revision: 7 },
        recoveryContinuation: {
          kind: 'worktree_review_regeneration', checkoutId: 'checkout-1', reviewId: 'review-1', revision: 7,
          requestId: expect.stringMatching(/^review-regeneration:/),
        },
      },
    })
    expect(module.resumeRevision).not.toHaveBeenCalled()
  })

  it('saves an exact generation-bound checkpoint and returns the Working projection without leaking internal refs', async () => {
    const record = readyRecord()
    const generation = checkpointGenerationForRecord(record)
    if (!generation) throw new Error('expected checkpoint generation')
    let value: ManagedCheckoutsRegistry = {
      version: 2, revision: 1, sessionBindings: {}, managedCheckouts: { [record.checkoutId]: record },
    }
    const registryPort: SessionCheckoutRegistryPort = {
      read: () => structuredClone(value),
      write: nextValue => { value = structuredClone(nextValue) },
      update: mutate => { value = mutate(structuredClone(value)); return value },
    }
    const { module, control } = plane(record, { registry: registryPort })
    vi.mocked(module.operate).mockImplementation(async operation => {
      if (operation.action !== 'checkpoint') throw new Error('expected checkpoint')
      const checkpoint = {
        checkpointId: 'checkpoint-1', sequence: 1, reviewId: operation.expectedReviewId, createdAt: 2,
        summary: 'Ready', validationStatus: 'passed' as const, changedFiles: ['src/index.ts'],
      }
      const current = value.managedCheckouts[record.checkoutId]!
      value.managedCheckouts[record.checkoutId] = {
        ...current,
        revision: 10,
        delivery: { state: 'working', iteration: 1 },
        checkpoints: [{
          ...checkpoint,
          requestId: operation.requestId,
          requestedRevision: operation.expectedRevision,
          generation: operation.expectedGeneration,
          iteration: 1,
          commitOid: B,
          parentOid: A,
          commitMessage: operation.commitMessage,
        }],
      }
      return {
        status: 'checkpointed',
        target: { ...(await module.inspect('target-session')), revision: 10, delivery: { state: 'working', iteration: 1 }, checkpoints: [checkpoint] },
        checkpoint,
        changedFiles: ['src/index.ts'],
      }
    })

    const result = await control.checkpoint({
      sessionId: 'target-session', checkoutId: 'checkout-1', expectedRevision: 7, expectedReviewId: 'review-1',
      expectedGeneration: generation, requestId: `checkpoint:${generation}`, commitMessage: longCommitMessage,
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        target: { state: 'working', revision: 10, checkpoints: [expect.objectContaining({ sequence: 1 })] },
        checkpoint: { checkpointId: 'checkpoint-1', sequence: 1 },
      },
    })
    expect(module.operate).toHaveBeenCalledWith({
      action: 'checkpoint', sessionId: 'target-session', expectedRevision: 7, expectedReviewId: 'review-1',
      expectedGeneration: generation, requestId: `checkpoint:${generation}`, commitMessage: longCommitMessage,
    })
    expect(JSON.stringify(result)).not.toContain('refs/dsh')
  })

  it('returns a structured apply-conflict continuation from a Preview race', async () => {
    const { module, control } = plane()
    vi.mocked(module.operate).mockResolvedValue({
      status: 'conflict', code: 'apply_conflict', reason: 'content_conflict',
      target: { ...(await module.inspect('target-session')), revision: 9 },
      baseStrategy: 'recorded_base', effectiveBaseOid: A, localHeadOid: A, isolatedHeadOid: B,
      canRetryAfterRefresh: false, conflictingFiles: ['src/index.ts'],
    })

    const result = await control.preview({
      sessionId: 'target-session', checkoutId: 'checkout-1', expectedRevision: 7, expectedReviewId: 'review-1',
    })

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'apply_conflict',
        message: 'Local Preview 预检发现内容冲突',
        continuation: {
          kind: 'worktree_apply_conflict',
          requestId: `apply-conflict:checkout-1:review-1:9:${A}`,
          checkoutId: 'checkout-1', reviewId: 'review-1', revision: 9,
          localHeadOid: A, conflictingFiles: ['src/index.ts'],
        },
      },
    })
  })

  it('rejects a stale review identity before resuming revision', async () => {
    const { module, control } = plane()
    const result = await control.resumeRevision({
      sessionId: 'target-session', checkoutId: 'checkout-1', expectedRevision: 7, expectedReviewId: 'review-old',
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'stale_target' } })
    expect(module.resumeRevision).not.toHaveBeenCalled()
  })

  it('starts iteration 2 for the exact delivered owner while preserving the immutable cwd identity', async () => {
    const delivered = readyRecord()
    delivered.phase = 'discarded'
    delivered.revision = 9
    delivered.delivery = {
      state: 'delivered', iteration: 1, commitOid: B, deliveredAt: 10,
    }
    const next: ManagedCheckoutRecord = {
      ...delivered,
      checkoutId: 'checkout-2',
      predecessorCheckoutId: delivered.checkoutId,
      phase: 'ready',
      delivery: { state: 'working', iteration: 2 },
      journal: null,
      revision: 11,
      baseOid: B,
      gitDir: '/git/worktrees/two',
    }
    let registryValue: ManagedCheckoutsRegistry = {
      version: 2, revision: 1,
      sessionBindings: {},
      managedCheckouts: { [delivered.checkoutId]: delivered },
    }
    const registryPort: SessionCheckoutRegistryPort = {
      read: () => structuredClone(registryValue),
      write: nextValue => { registryValue = structuredClone(nextValue) },
      update: mutate => { registryValue = mutate(structuredClone(registryValue)); return registryValue },
    }
    const lookup = lookupDouble()
    lookup.getSession = sessionId => ({ id: sessionId, projectId: sessionId === 'target-session' ? 'workspace-target' : 'project-1' })
    lookup.getProject = projectId => ({ id: projectId, name: 'Project', root: projectId === 'workspace-target' ? '/managed' : '/local' })
    const { module, control } = plane(delivered, { registry: registryPort, lookup })
    vi.mocked(module.beginNextIteration).mockImplementation(async () => {
      registryValue = {
        ...registryValue,
        revision: registryValue.revision + 1,
        managedCheckouts: { ...registryValue.managedCheckouts, [next.checkoutId]: next },
      }
      return {
        project: { id: next.projectId, name: next.projectName },
        checkout: { id: next.checkoutId, kind: 'isolated', label: 'Task', phase: 'ready' },
        source: { ref: next.sourceRef, oid: next.baseOid },
        current: { branch: null, oid: B }, ownership: 'owner', dirty: false, revision: next.revision,
        delivery: { state: 'working', iteration: 2 },
      }
    })

    const result = await control.beginNextIteration({
      sessionId: 'target-session', checkoutId: delivered.checkoutId, expectedRevision: delivered.revision,
    })

    expect(result).toMatchObject({
      ok: true,
      value: { target: { checkoutId: 'checkout-2', ownerSessionId: 'target-session', state: 'working', iteration: 2 } },
    })
    expect(module.beginNextIteration).toHaveBeenCalledWith('target-session', delivered.revision)
  })

  it('lets an in-place owner rooted at the Local boundary through the workspace gate', async () => {
    const delivered = readyRecord()
    delivered.phase = 'discarded'
    delivered.revision = 9
    delivered.delivery = { state: 'delivered', iteration: 1, commitOid: B, deliveredAt: 10 }
    const lookup = lookupDouble()
    // An in-place Session keeps its Workspace at the Local boundary while the
    // predecessor record still names the managed root that cleanup removed.
    lookup.getProject = () => ({ id: 'workspace-target', name: 'Project', root: '/local' })
    const { module, control } = plane(delivered, { lookup })
    vi.mocked(module.beginNextIteration).mockRejectedValue(new Error('module reached'))

    await control.beginNextIteration({
      sessionId: 'target-session', checkoutId: delivered.checkoutId, expectedRevision: delivered.revision,
    })

    expect(module.beginNextIteration).toHaveBeenCalledWith('target-session', delivered.revision)
  })

  it('keeps a preview-detached record in the attention filter', async () => {
    const record = readyRecord()
    record.delivery = {
      state: 'preview_detached',
      review: {
        reviewId: 'review-1', iteration: 1, preparedAt: 1, summary: 'Ready', validationStatus: 'passed',
        tests: [], changedFiles: ['src/index.ts'], suggestedCommitMessage: 'fix: persisted review',
        isolatedFingerprint: 'fingerprint-1', isolatedHeadOid: B,
      },
      preview: { previewId: 'preview-1' }, detachedAt: 2, reason: 'stale_local', attemptedAction: 'discard',
    } as unknown as ManagedCheckoutRecord['delivery']
    const { control } = plane(record)

    const result = await control.list({ sessionId: 'source-session', needsAttention: true })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected list success')
    expect(result.value.worktrees.map(row => row.state)).toEqual(['preview_detached'])
  })

  it('blocks a Local branch switch from the source Session while delivery is pending', async () => {
    const git = { ...gitDouble(), switchLocalBranch: vi.fn(async () => undefined) }
    const { control } = plane(readyRecord(), { git })

    const result = await control.gitSwitchBranch('source-session', 'feature')

    expect(result).toMatchObject({ ok: false, error: { code: 'operation_not_allowed' } })
    expect(git.switchLocalBranch).not.toHaveBeenCalled()
  })

  it('blocks a Local branch switch while another Session delivers onto the same local root', async () => {
    const other = readyRecord()
    other.checkoutId = 'checkout-2'
    other.ownerSessionId = 'other-session'
    other.sourceSessionId = 'other-source'
    const foreign: SessionCheckoutRegistryPort = {
      read: () => structuredClone({
        version: 2, revision: 1, sessionBindings: {}, managedCheckouts: { 'checkout-2': other },
      }),
      write: vi.fn(),
      update: () => { throw new Error('control plane must not update the registry') },
    }
    const git = { ...gitDouble(), switchLocalBranch: vi.fn(async () => undefined) }
    const { control } = plane(readyRecord(), { registry: foreign, git })

    const result = await control.gitSwitchBranch('third-session', 'feature')

    expect(result).toMatchObject({ ok: false, error: { code: 'operation_not_allowed' } })
    expect(git.switchLocalBranch).not.toHaveBeenCalled()
  })

  it('still creates a Local branch while another Session delivers onto the same local root', async () => {
    const other = readyRecord()
    other.checkoutId = 'checkout-2'
    other.ownerSessionId = 'other-session'
    other.sourceSessionId = 'other-source'
    const foreign: SessionCheckoutRegistryPort = {
      read: () => structuredClone({
        version: 2, revision: 1, sessionBindings: {}, managedCheckouts: { 'checkout-2': other },
      }),
      write: vi.fn(),
      update: () => { throw new Error('control plane must not update the registry') },
    }
    const git = { ...gitDouble(), createLocalBranch: vi.fn(async () => undefined) }
    const { control } = plane(readyRecord(), { registry: foreign, git })

    const result = await control.gitCreateBranch('third-session', 'feature')

    expect(result).toMatchObject({ ok: true, value: { branch: 'feature' } })
    expect(git.createLocalBranch).toHaveBeenCalledWith('/local', 'feature')
  })

  it('lists local tags through the git port', async () => {
    const tags = [{ name: 'v1.0.0', oid: 'c'.repeat(40), commitOid: 'b'.repeat(40), annotated: true, message: 'release', pushed: false }]
    const git = { ...gitDouble(), listTags: vi.fn(async () => tags) }
    const { control } = plane(readyRecord(), { git })

    const result = await control.gitListTags('source-session')

    expect(result).toMatchObject({ ok: true, value: { tags } })
    expect(git.listTags).toHaveBeenCalledWith('/local')
  })

  it('creates a tag and reports the push result without failing the local create', async () => {
    const git = {
      ...gitDouble(),
      createTag: vi.fn(async () => undefined),
      pushTag: vi.fn(async () => ({ ok: false, message: 'no remote' })),
    }
    const { control } = plane(readyRecord(), { git })

    const result = await control.gitCreateTag({ sessionId: 'source-session', name: 'v1.0.0', push: true })

    expect(git.createTag).toHaveBeenCalledWith('/local', 'v1.0.0', { message: undefined, target: undefined })
    // The tag exists locally; only the push failed, so this is still a success.
    expect(result).toMatchObject({ ok: true, value: { tag: 'v1.0.0', pushed: false, pushMessage: 'no remote' } })
  })

  it('reports a tag push failure as a reportable outcome, not a failed mutation', async () => {
    const git = { ...gitDouble(), pushTag: vi.fn(async () => ({ ok: false, message: 'no remote' })) }
    const { control } = plane(readyRecord(), { git })

    const result = await control.gitPushTag({ sessionId: 'source-session', name: 'v1.0.0' })

    // A rejected push leaves the local tag intact, so it matches the create-with-push
    // channel instead of surfacing as a domain error.
    expect(result).toMatchObject({ ok: true, value: { tag: 'v1.0.0', pushed: false, pushMessage: 'no remote' } })
  })

  it('deletes a tag locally and on origin when asked for both', async () => {
    const git = {
      ...gitDouble(),
      deleteLocalTag: vi.fn(async () => undefined),
      deleteRemoteTag: vi.fn(async () => ({ ok: true })),
    }
    const { control } = plane(readyRecord(), { git })

    const result = await control.gitDeleteTag({ sessionId: 'source-session', name: 'v1.0.0', remote: true })

    expect(git.deleteLocalTag).toHaveBeenCalledWith('/local', 'v1.0.0')
    expect(git.deleteRemoteTag).toHaveBeenCalledWith('/local', 'v1.0.0')
    expect(result).toMatchObject({ ok: true, value: { tag: 'v1.0.0', pushed: true } })
  })

  it('keeps the local tag when the origin delete fails', async () => {
    const git = {
      ...gitDouble(),
      deleteLocalTag: vi.fn(async () => undefined),
      deleteRemoteTag: vi.fn(async () => ({ ok: false, message: 'no remote' })),
    }
    const { control } = plane(readyRecord(), { git })

    const result = await control.gitDeleteTag({ sessionId: 'source-session', name: 'v1.0.0', remote: true })

    // Origin is deleted first, so a failed remote delete never destroys the only copy.
    expect(git.deleteLocalTag).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: true, value: { tag: 'v1.0.0', pushed: false, pushMessage: 'no remote' } })
  })

  it('observes list records in one module batch when the module supports batch observation', async () => {
    const record = readyRecord()
    const { module, control } = plane(record)
    const snapshot = { root: '/managed', commonDir: '/git/common', gitDir: '/git/worktrees/one', branch: null, headOid: B, headRef: 'HEAD' }
    const batch = vi.fn(async (checkoutIds: string[]) => checkoutIds.map(checkoutId => ({ managedRoot: '/managed', snapshot, dirty: false })))
    module.observeManagedCheckouts = batch

    const listed = await control.list({ sessionId: 'target-session' })

    expect(batch).toHaveBeenCalledTimes(1)
    expect(batch).toHaveBeenCalledWith([record.checkoutId])
    expect(listed).toMatchObject({
      ok: true,
      value: { worktrees: [expect.objectContaining({ checkoutId: record.checkoutId, dirty: false })] },
    })
  })

  it('degrades an unverifiable record to an unobserved projection instead of failing the whole list', async () => {
    const first = readyRecord()
    const broken: ManagedCheckoutRecord = {
      ...readyRecord(),
      checkoutId: 'checkout-2',
      ownerSessionId: 'target-session-2',
      managedRoot: '/managed-2',
      managedGitRoot: '/managed-2',
      gitDir: '/git/worktrees/two',
      revision: 8,
    }
    const value: ManagedCheckoutsRegistry = {
      version: 2,
      revision: 1,
      sessionBindings: {},
      managedCheckouts: { [first.checkoutId]: first, [broken.checkoutId]: broken },
    }
    const registryPort: SessionCheckoutRegistryPort = { read: () => structuredClone(value), write: vi.fn(), update: () => { throw new Error('control plane must not update the registry') } }
    const lookup = lookupDouble()
    lookup.getSession = sessionId => ({
      id: sessionId,
      projectId: sessionId === 'target-session'
        ? 'workspace-target'
        : sessionId === 'target-session-2' ? 'workspace-target-2' : 'project-1',
    })
    lookup.getProject = projectId => ({
      id: projectId,
      name: 'Project',
      root: projectId === 'workspace-target'
        ? '/managed'
        : projectId === 'workspace-target-2' ? '/managed-2' : '/local',
    })
    const git = gitDouble()
    git.inspect = vi.fn(async root => root === '/managed-2'
      ? null
      : { root: '/managed', commonDir: '/git/common', gitDir: '/git/worktrees/one', branch: null, headOid: B, headRef: 'HEAD' })
    const { module, control } = plane(first, { registry: registryPort, lookup, git })
    // 批量观察整体拒绝（任一记录身份无法验证时模块侧 Promise.all 的行为），
    // list 必须退回逐条观察：健康记录保留新鲜观察，坏记录降级为无观察投影。
    module.observeManagedCheckouts = vi.fn(async () => {
      throw Object.assign(new Error('会话不存在'), { code: 'session_not_found' })
    })
    vi.mocked(module.resolveManagedRoot).mockImplementation(async checkoutId => checkoutId === 'checkout-2' ? '/managed-2' : '/managed')
    vi.mocked(module.listManagedWorktreesForSession).mockResolvedValue([
      {
        checkoutId: first.checkoutId, revision: first.revision, ownerSessionId: first.ownerSessionId, ownerSessionTitle: 'Task 1',
        project: { id: first.projectId, name: first.projectName }, iteration: 1, state: 'ready_for_review', phase: first.phase,
        dirty: true, commitOid: null, approximateBytes: null, updatedAt: 1, canCleanup: false,
      },
      {
        checkoutId: broken.checkoutId, revision: broken.revision, ownerSessionId: broken.ownerSessionId, ownerSessionTitle: 'Task 2',
        project: { id: broken.projectId, name: broken.projectName }, iteration: 1, state: 'ready_for_review', phase: broken.phase,
        dirty: false, commitOid: null, approximateBytes: null, updatedAt: 2, canCleanup: false,
      },
    ])

    const listed = await control.list({ sessionId: 'target-session' })

    expect(module.observeManagedCheckouts).toHaveBeenCalledTimes(1)
    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    expect(listed.value.worktrees.map(worktree => worktree.checkoutId)).toEqual(['checkout-1', 'checkout-2'])
    expect(listed.value.worktrees[0]).toMatchObject({ dirty: true })
    expect(listed.value.worktrees[1]).toMatchObject({ dirty: false })
  })

  it('lets an owner list and inspect a same-source sibling without inheriting mutation capabilities', async () => {
    const first = readyRecord()
    const sibling: ManagedCheckoutRecord = {
      ...readyRecord(),
      checkoutId: 'checkout-2',
      ownerSessionId: 'target-session-2',
      managedRoot: '/managed-2',
      managedGitRoot: '/managed-2',
      gitDir: '/git/worktrees/two',
      revision: 8,
    }
    const value: ManagedCheckoutsRegistry = {
      version: 2,
      revision: 1,
      sessionBindings: {},
      managedCheckouts: { [first.checkoutId]: first, [sibling.checkoutId]: sibling },
    }
    const registryPort: SessionCheckoutRegistryPort = { read: () => structuredClone(value), write: vi.fn(), update: () => { throw new Error('control plane must not update the registry') } }
    const lookup = lookupDouble()
    lookup.getSession = sessionId => ({
      id: sessionId,
      projectId: sessionId === 'target-session'
        ? 'workspace-target'
        : sessionId === 'target-session-2' ? 'workspace-target-2' : 'project-1',
    })
    lookup.getProject = projectId => ({
      id: projectId,
      name: 'Project',
      root: projectId === 'workspace-target'
        ? '/managed'
        : projectId === 'workspace-target-2' ? '/managed-2' : '/local',
    })
    const { module, control } = plane(first, { registry: registryPort, lookup })
    vi.mocked(module.resolveManagedRoot).mockImplementation(async checkoutId => checkoutId === 'checkout-2' ? '/managed-2' : '/managed')
    vi.mocked(module.listManagedWorktreesForSession).mockResolvedValue([
      {
        checkoutId: first.checkoutId, revision: first.revision, ownerSessionId: first.ownerSessionId, ownerSessionTitle: 'Task 1',
        project: { id: first.projectId, name: first.projectName }, iteration: 1, state: 'ready_for_review', phase: first.phase,
        dirty: true, commitOid: null, approximateBytes: null, updatedAt: 1, canCleanup: false,
      },
      {
        checkoutId: sibling.checkoutId, revision: sibling.revision, ownerSessionId: sibling.ownerSessionId, ownerSessionTitle: 'Task 2',
        project: { id: sibling.projectId, name: sibling.projectName }, iteration: 1, state: 'ready_for_review', phase: sibling.phase,
        dirty: true, commitOid: null, approximateBytes: null, updatedAt: 2, canCleanup: false,
      },
    ])

    const listed = await control.list({ sessionId: 'target-session' })
    expect(listed).toMatchObject({
      ok: true,
      value: {
        worktrees: [
          expect.objectContaining({ checkoutId: 'checkout-1' }),
          expect.objectContaining({
            checkoutId: 'checkout-2',
            capabilities: expect.objectContaining({
              open: true,
              inspect: true,
              discard: false,
              preview: false,
              finalize: false,
              retryCleanup: false,
            }),
          }),
        ],
      },
    })
    if (!listed.ok) throw new Error('expected linked list success')
    expect(listed.value.worktrees[1]).not.toHaveProperty('managedRoot')

    const inspected = await control.inspect('target-session', 'checkout-2')
    expect(inspected).toMatchObject({
      ok: true,
      value: { target: { checkoutId: 'checkout-2', managedRoot: '/managed-2' } },
    })

    const preview = await control.preview({
      sessionId: 'target-session', checkoutId: 'checkout-2', expectedRevision: 8, expectedReviewId: 'review-1',
    })
    expect(preview).toMatchObject({ ok: false, error: { code: 'not_owner' } })
  })

  it('keeps read-only Preflight available while exposing a path-free acceptance holder and disabling Local mutations', async () => {
    const waiting = readyRecord()
    waiting.checkoutId = 'checkout-waiting'
    waiting.ownerSessionId = 'target-session'
    waiting.managedRoot = '/managed'
    waiting.managedGitRoot = '/managed'
    waiting.gitDir = '/git/worktrees/waiting'
    const holderReviewRecord = readyRecord()
    if (holderReviewRecord.delivery.state !== 'ready_for_review') throw new Error('expected ready review fixture')
    const holder: ManagedCheckoutRecord = {
      ...holderReviewRecord,
      checkoutId: 'checkout-holder',
      ownerSessionId: 'holder-session',
      sourceSessionId: 'other-source',
      managedRoot: '/holder',
      managedGitRoot: '/holder',
      gitDir: '/git/worktrees/holder',
      revision: 9,
      delivery: {
        state: 'preview_active',
        review: holderReviewRecord.delivery.review,
        preview: {
          previewId: 'preview-1', reviewId: 'review-1', iteration: 1, previewedAt: 1,
          configuredBaseOid: A, effectiveBaseOid: A, baseStrategy: 'recorded_base',
          localHeadOid: A, localHeadRef: 'refs/heads/main', localFingerprintBefore: 'local-before',
          localFingerprintPreview: 'local-preview', localWorkingTreeOid: A, localIndexTreeOid: A,
          previewWorkingTreeOid: B, isolatedHeadOid: B, isolatedFingerprint: 'fingerprint-1',
          isolatedSnapshotOid: B, changedFiles: ['src/index.ts'],
        },
      },
    }
    const value: ManagedCheckoutsRegistry = {
      version: 2, revision: 1, sessionBindings: {},
      managedCheckouts: { [waiting.checkoutId]: waiting, [holder.checkoutId]: holder },
    }
    const lookup = lookupDouble()
    lookup.getSession = sessionId => ({
      id: sessionId,
      projectId: sessionId === 'target-session' ? 'workspace-target'
        : sessionId === 'holder-session' ? 'workspace-holder' : 'project-1',
    })
    lookup.getProject = projectId => ({
      id: projectId, name: 'Project',
      root: projectId === 'workspace-target' ? '/managed'
        : projectId === 'workspace-holder' ? '/holder' : '/local',
    })
    const { module, control } = plane(waiting, {
      registry: { read: () => structuredClone(value), write: vi.fn(), update: () => { throw new Error('control plane must not update the registry') } },
      lookup,
    })
    vi.mocked(module.resolveManagedRoot).mockImplementation(async checkoutId => checkoutId === holder.checkoutId ? '/holder' : '/managed')
    vi.mocked(module.preflight!).mockResolvedValue({
      status: 'blocked', localModified: false, checkoutId: waiting.checkoutId, reviewId: 'review-1', revision: waiting.revision,
      reason: 'project_acceptance_busy', message: 'busy',
      blocker: { checkoutId: holder.checkoutId, ownerSessionId: holder.ownerSessionId, revision: holder.revision, state: 'preview_active' },
    })

    const current = await control.current('target-session')
    expect(current).toMatchObject({
      ok: true,
      value: {
        target: {
          reviewSlot: 'waiting',
          reviewSlotHolder: { checkoutId: 'checkout-holder', ownerSessionId: 'holder-session', revision: 9, state: 'preview_active' },
          capabilities: { preflight: true, preview: false, finalize: false },
        },
      },
    })
    expect(JSON.stringify(current)).not.toContain('/holder')
    expect(await control.preflight({
      sessionId: 'target-session', checkoutId: waiting.checkoutId, expectedRevision: waiting.revision, expectedReviewId: 'review-1',
    })).toMatchObject({
      ok: true,
      value: { preflight: { reason: 'project_acceptance_busy', blocker: { checkoutId: 'checkout-holder' } } },
    })

    const opened = await control.inspect('target-session', holder.checkoutId)
    expect(opened).toMatchObject({
      ok: true,
      value: {
        target: {
          checkoutId: holder.checkoutId,
          managedRoot: '/holder',
          capabilities: { open: true, inspect: true, preview: false, finalize: false },
        },
      },
    })

    vi.mocked(module.resolveManagedRoot).mockImplementationOnce(async () => {
      value.managedCheckouts[holder.checkoutId]!.delivery = { state: 'working', iteration: 1 }
      return '/holder'
    })
    const releasedDuringObserve = await control.inspect('target-session', holder.checkoutId)
    expect(releasedDuringObserve).toMatchObject({ ok: false, error: { code: 'not_owner' } })
    expect(JSON.stringify(releasedDuringObserve)).not.toContain('/holder')
  })

  it('does not extend acceptance-holder read access to another cross-source Worktree', async () => {
    const anchor = readyRecord()
    const unrelated: ManagedCheckoutRecord = {
      ...readyRecord(), checkoutId: 'checkout-unrelated', ownerSessionId: 'other-owner', sourceSessionId: 'other-source',
      managedRoot: '/other', managedGitRoot: '/other', gitDir: '/git/worktrees/other',
    }
    const value: ManagedCheckoutsRegistry = {
      version: 2, revision: 1, sessionBindings: {},
      managedCheckouts: { [anchor.checkoutId]: anchor, [unrelated.checkoutId]: unrelated },
    }
    const { control } = plane(anchor, { registry: { read: () => structuredClone(value), write: vi.fn(), update: () => { throw new Error('control plane must not update the registry') } } })
    expect(await control.inspect('target-session', unrelated.checkoutId)).toMatchObject({ ok: false, error: { code: 'not_owner' } })
  })

  it('projects durable delivery proof while preserving dynamic Local-history evidence', async () => {
    const delivered = readyRecord()
    delivered.phase = 'discarded'
    delivered.revision = 9
    delivered.delivery = {
      state: 'delivered', iteration: 1, commitOid: B, deliveredAt: 10,
      proof: {
        localBranch: 'main', localHeadBefore: A, localHeadAfter: B, changedFiles: ['src/index.ts'],
        validationStatus: 'passed', validationSummary: 'full validation passed',
      },
    }
    const { module, control } = plane(delivered, { lookup: ownerLocalLookup() })
    vi.mocked(module.inspect).mockResolvedValue({
      project: { id: delivered.projectId, name: delivered.projectName },
      checkout: { id: delivered.checkoutId, kind: 'isolated', label: 'Task', phase: 'discarded' },
      source: { ref: delivered.sourceRef, oid: delivered.baseOid }, current: { branch: 'main', oid: B },
      ownership: 'owner', dirty: false, revision: delivered.revision,
      delivery: {
        state: 'delivered', iteration: 1, commitOid: B, deliveredAt: 10,
        proof: {
          ...delivered.delivery.proof,
          commitInLocalHistory: true,
        },
      },
    })

    expect(await control.current('target-session')).toMatchObject({
      ok: true,
      value: {
        target: {
          state: 'delivered',
          deliveryProof: {
            localBranch: 'main', localHeadBefore: A, localHeadAfter: B,
            changedFiles: ['src/index.ts'], validationStatus: 'passed',
            validationSummary: 'full validation passed', commitInLocalHistory: true,
          },
        },
      },
    })
  })

  it('rejects a live same-project Session that is neither source nor owner before revealing managedRoot', async () => {
    const { module, control } = plane()
    const result = await control.inspect('intruder-session', 'checkout-1')
    expect(result).toEqual({ ok: false, error: { code: 'not_owner', message: '当前 Session 无权访问该 Worktree' } })
    expect(module.resolveManagedRoot).not.toHaveBeenCalled()
  })

  it('fails closed when the live owner Workspace cwd no longer matches managedRoot', async () => {
    const lookup = lookupDouble()
    lookup.getProject = vi.fn(projectId => ({ id: projectId, name: 'Project', root: '/elsewhere' }))
    const { module, control } = plane(readyRecord(), { lookup })
    const result = await control.inspect('target-session', 'checkout-1')
    expect(result).toMatchObject({ ok: false, error: { code: 'project_mismatch' } })
    expect(module.resolveManagedRoot).not.toHaveBeenCalled()
  })

  it('authorizes the owner through its live immutable cwd, not the Workspace Local root', async () => {
    // A managed owner Session's cwd IS its worktree root while the task runs;
    // the Workspace project root is always the Local path. Authorizing against
    // the project root rejected every owner call with `project_mismatch`, so
    // the top capsule reported a failure for a perfectly healthy checkout.
    //
    // The fixture MUST be `ownerLocalLookup()`: with `lookupDouble()` the
    // project root of the owner Session is already `/managed`, which equals
    // `expectedRoot`, so this assertion would pass with or without the fix and
    // prove nothing.
    const lookup = ownerLocalLookup()
    lookup.getSessionCwd = vi.fn(sessionId => sessionId === 'target-session' ? '/managed' : undefined)
    const { control } = plane(readyRecord(), { lookup })
    const result = await control.inspect('target-session', 'checkout-1')
    expect(result).toMatchObject({ ok: true, value: { target: { state: 'ready_for_review' } } })
  })

  it('still fails closed when the owner live cwd matches neither managedRoot nor the Local root', async () => {
    const lookup = ownerLocalLookup()
    lookup.getSessionCwd = vi.fn(() => '/somewhere-else')
    const { module, control } = plane(readyRecord(), { lookup })
    const result = await control.inspect('target-session', 'checkout-1')
    expect(result).toMatchObject({ ok: false, error: { code: 'project_mismatch' } })
    expect(module.resolveManagedRoot).not.toHaveBeenCalled()
  })

  it('never lifts the Workspace-root gate for a source Session that sits in the Local checkout', async () => {
    // The live-cwd evidence is owner-only. A source Session is SUPPOSED to run
    // at the Local boundary, so accepting its cwd would hand it the owner's
    // managedRoot without ever proving the Workspace identity.
    const lookup = lookupDouble()
    lookup.getProject = vi.fn(projectId => ({ id: projectId, name: 'Project', root: '/elsewhere' }))
    lookup.getSessionCwd = vi.fn(sessionId => sessionId === 'source-session' ? '/local' : undefined)
    const { module, control } = plane(readyRecord(), { lookup })
    const result = await control.inspect('source-session', 'checkout-1')
    expect(result).toMatchObject({ ok: false, error: { code: 'project_mismatch' } })
    expect(module.resolveManagedRoot).not.toHaveBeenCalled()
  })

  it('keeps a delivered Worktree readable for its owner after cleanup removed the environment', async () => {
    const delivered = readyRecord()
    delivered.phase = 'discarded'
    delivered.delivery = { state: 'delivered', iteration: 1, commitOid: B, deliveredAt: 10 }
    // The owner Session's project root is the Local checkout; the old managedRoot
    // no longer exists, so the authorization boundary falls back to Local.
    const { control } = plane(delivered, { lookup: ownerLocalLookup() })
    const result = await control.inspect('target-session', delivered.checkoutId)
    expect(result).toMatchObject({ ok: true, value: { target: { state: 'delivered' } } })
  })

  it('keeps the owner readable when the retired managedRoot path no longer canonicalizes', async () => {
    // The record keeps the old managedRoot path after cleanup deletes it, and
    // `realpath` on a missing path throws ENOENT. That raw error escaped
    // authorize() and surfaced as `git_error`, which the top capsule rendered
    // as "unavailable" forever — the settled-owner branch below was
    // unreachable. The plain `filesDouble()` cannot catch this: its `exists`
    // always answers true and its `canonicalize` is the identity, so the
    // missing-directory path is never taken. This fixture models the disk.
    //
    // `getSessionCwd` MUST answer: the owner fast path is skipped entirely
    // when the live cwd is unknown, so without it the ENOENT line is never
    // reached and the assertion proves nothing. After delivery the owner is
    // back at the Local checkout, which is what the real session reports.
    const delivered = readyRecord()
    delivered.phase = 'discarded'
    delivered.delivery = { state: 'delivered', iteration: 1, commitOid: B, deliveredAt: 10 }
    const lookup = ownerLocalLookup()
    lookup.getSessionCwd = vi.fn(() => '/local')
    const files = filesDouble()
    files.exists = path => path !== '/managed'
    files.canonicalize = vi.fn(async (path: string) => {
      if (path === '/managed') throw Object.assign(new Error(`ENOENT: no such file or directory, realpath '${path}'`), { code: 'ENOENT' })
      return path
    })
    const { control } = plane(delivered, { lookup, files })
    const result = await control.inspect('target-session', delivered.checkoutId)
    expect(result).toMatchObject({ ok: true, value: { target: { state: 'delivered' } } })
  })

  it('keeps a retained owner readable at the Local boundary during the default retention window', async () => {
    const retained = readyRecord()
    retained.phase = 'retained'
    retained.revision = 9
    retained.delivery = {
      state: 'retained', review: readyReviewOf(retained), commitOid: B, isolatedFingerprint: 'fingerprint-1',
      retention: 'retain_24h', retainedAt: 10, expiresAt: 20, cleanup: 'scheduled',
    }
    const { module, control } = plane(retained, { lookup: ownerLocalLookup() })
    vi.mocked(module.inspect).mockResolvedValue({
      project: { id: retained.projectId, name: retained.projectName },
      checkout: { id: retained.checkoutId, kind: 'isolated', label: 'Task', phase: 'retained' },
      source: { ref: retained.sourceRef, oid: retained.baseOid },
      current: { branch: 'main', oid: B }, ownership: 'owner', dirty: false, revision: retained.revision,
      delivery: { state: 'retained', iteration: 1, commitOid: B, retainedAt: 10 },
    })
    // retain_24h is the default delivery retention: the owner Session's cwd is
    // back at the Local boundary while the frozen environment still exists, and
    // the branch chip polling must not read it as an authorization failure.
    const result = await control.current('target-session')
    expect(result).toMatchObject({ ok: true, value: { target: { state: 'retained', managedRoot: '/managed' } } })
  })

  it('keeps a finalized owner readable at the Local boundary while cleanup is still pending', async () => {
    const finalized = readyRecord()
    finalized.phase = 'finalized'
    finalized.revision = 9
    finalized.delivery = {
      state: 'finalized', review: readyReviewOf(finalized), commitOid: B, isolatedFingerprint: 'fingerprint-1',
      finalizedAt: 10, cleanup: 'pending',
    }
    const { control } = plane(finalized, { lookup: ownerLocalLookup() })
    const result = await control.inspect('target-session', finalized.checkoutId)
    expect(result).toMatchObject({ ok: true, value: { target: { state: 'cleanup_pending' } } })
  })

  it('names the Local branch on a retained Worktree the owner already left', async () => {
    const retained = retainedRecord()
    const git = gitDouble()
    // The frozen environment still reports the task branch; the chip must
    // follow the branch the Session actually stands on after delivery.
    vi.mocked(git.inspect).mockImplementation(async root => ({
      root,
      commonDir: '/git/common',
      gitDir: '/git/worktrees/one',
      branch: root === '/local' ? 'main' : 'feat/sess-target-session--task',
      headOid: B,
      headRef: 'HEAD',
    }))
    const lookup = ownerLocalLookup()
    lookup.getSessionCwd = () => '/local'
    const { control } = plane(retained, { lookup, git })

    const result = await control.current('target-session')

    expect(result).toMatchObject({ ok: true, value: { target: { currentBranch: 'main', state: 'retained' } } })
  })

  it('keeps naming the Worktree branch while the owner is still inside the frozen environment', async () => {
    const retained = retainedRecord()
    const git = gitDouble()
    vi.mocked(git.inspect).mockImplementation(async root => ({
      root,
      commonDir: '/git/common',
      gitDir: '/git/worktrees/one',
      branch: root === '/managed' ? 'feat/sess-target-session--task' : 'main',
      headOid: B,
      headRef: 'HEAD',
    }))
    const lookup = ownerLocalLookup()
    lookup.getSessionCwd = () => '/managed'
    const { control } = plane(retained, { lookup, git })

    const result = await control.current('target-session')

    expect(result).toMatchObject({
      ok: true,
      value: { target: { currentBranch: 'feat/sess-target-session--task', state: 'retained' } },
    })
  })

  it('reuses the caller inspection instead of re-validating the same checkout', async () => {
    // `current` first runs `module.inspect`, whose isolated path already pays one
    // `git status` plus two `git inspect` spawns. Re-observing the very same
    // record through `observeManagedCheckout` repeated that triple spawn and was
    // a third of every 5s poll — the reported "chip is slow to read the branch".
    const record = readyRecord()
    const { control, module } = plane(record)
    const reobserve = vi.fn()
    module.observeManagedCheckout = reobserve as unknown as SessionCheckoutModule['observeManagedCheckout']
    vi.mocked(module.inspect).mockResolvedValue({
      ...local('target-session'),
      checkout: { id: 'checkout-1', kind: 'isolated', label: 'Task', phase: 'ready' },
      current: { branch: 'feat/live', oid: B },
      dirty: false,
      revision: record.revision,
    })

    const result = await control.current('target-session')

    expect(reobserve).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: true, value: { target: { currentBranch: 'feat/live', dirty: false } } })
  })

  it('revalidates when the registry revision advances after the caller inspection', async () => {
    const staleRecord = readyRecord()
    const currentRecord = { ...staleRecord, revision: staleRecord.revision + 1 }
    const { control, module } = plane(staleRecord, {
      registry: {
        read: () => ({ version: 2, revision: 2, sessionBindings: {}, managedCheckouts: { [currentRecord.checkoutId]: structuredClone(currentRecord) } }),
        write: vi.fn(),
        update: () => { throw new Error('control plane must not update the registry') },
      },
    })
    const reobserve = vi.fn(async () => ({
      managedRoot: '/managed',
      snapshot: { root: '/managed', commonDir: '/git/common', gitDir: '/git/worktrees/one', branch: 'feat/current', headOid: B, headRef: 'HEAD' },
      localSnapshot: { root: '/local', commonDir: '/git/common', gitDir: '/.git', branch: 'main', headOid: A, headRef: 'HEAD' },
      dirty: false,
    }))
    module.observeManagedCheckout = reobserve as unknown as SessionCheckoutModule['observeManagedCheckout']
    vi.mocked(module.inspect).mockResolvedValue({
      ...local('target-session'),
      checkout: { id: staleRecord.checkoutId, kind: 'isolated', label: 'Task', phase: 'ready' },
      current: { branch: 'feat/stale', oid: A },
      revision: staleRecord.revision,
    })

    const result = await control.current('target-session')

    expect(reobserve).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      ok: true,
      value: { target: { currentBranch: 'feat/current', revision: currentRecord.revision } },
    })
  })

  it('uses the fresh registry proof when the caller proof belongs to an older revision', async () => {
    const retained = retainedRecord()
    const currentRecord = {
      ...retained,
      revision: retained.revision + 1,
      delivery: {
        ...retained.delivery,
        proof: { localBranch: 'main', localHeadBefore: A, localHeadAfter: B, changedFiles: ['current.ts'] },
      },
    }
    const { control, module } = plane(retained, {
      lookup: ownerLocalLookup(),
      registry: {
        read: () => ({ version: 2, revision: 2, sessionBindings: {}, managedCheckouts: { [currentRecord.checkoutId]: structuredClone(currentRecord) } }),
        write: vi.fn(),
        update: () => { throw new Error('control plane must not update the registry') },
      },
    })
    vi.mocked(module.inspect).mockResolvedValue({
      ...local('target-session'),
      checkout: { id: retained.checkoutId, kind: 'isolated', label: 'Task', phase: 'retained' },
      revision: retained.revision,
      delivery: {
        state: 'retained',
        review: retained.delivery.review,
        commitOid: B,
        proof: { localBranch: 'main', localHeadBefore: A, localHeadAfter: A, changedFiles: ['stale.ts'], commitInLocalHistory: true },
        retention: 'retain_24h', retainedAt: 10, expiresAt: 20, cleanup: 'scheduled',
      },
    })

    const result = await control.current('target-session')

    expect(result).toMatchObject({
      ok: true,
      value: { target: { revision: currentRecord.revision, deliveryProof: { changedFiles: ['current.ts'], commitInLocalHistory: null } } },
    })
    expect(JSON.stringify(result)).not.toContain('stale.ts')
  })

  it('takes the delivered Local branch from the observation instead of a third inspect', async () => {
    // Identity validation already inspects the Local side to prove both roots
    // share one repository. Carrying that snapshot out removes the extra
    // `git rev-parse` the chip used to pay just to name `master`.
    const retained = retainedRecord()
    const git = gitDouble()
    const lookup = ownerLocalLookup()
    lookup.getSessionCwd = () => '/local'
    const { control, module } = plane(retained, { lookup, git })
    vi.mocked(module.inspect).mockResolvedValue({
      ...local('target-session'),
      checkout: { id: retained.checkoutId, kind: 'isolated', label: 'Task', phase: 'retained' },
      current: { branch: 'feat/sess-target-session--task', oid: B },
      dirty: false,
    })
    module.observeManagedCheckout = vi.fn(async () => ({
      managedRoot: '/managed',
      snapshot: { root: '/managed', commonDir: '/git/common', gitDir: '/git/worktrees/one', branch: 'feat/sess-target-session--task', headOid: B, headRef: 'HEAD' },
      localSnapshot: { root: '/local', commonDir: '/git/common', gitDir: '/.git', branch: 'main', headOid: A, headRef: 'HEAD' },
      dirty: false,
    })) as unknown as SessionCheckoutModule['observeManagedCheckout']

    const result = await control.current('target-session')

    expect(result).toMatchObject({ ok: true, value: { target: { currentBranch: 'main', state: 'retained' } } })
    expect(vi.mocked(git.inspect)).not.toHaveBeenCalled()
  })

  it('offers the owner a way back to Local only after the Worktree reached delivery', async () => {
    const retained = retainedRecord()
    const { control } = plane(retained, { lookup: ownerLocalLookup() })

    const delivered = await control.current('target-session')
    expect(delivered).toMatchObject({ ok: true, value: { target: { capabilities: { returnToLocal: true } } } })

    const working = readyRecord()
    const pending = plane(working)
    const pendingResult = await pending.control.current('target-session')
    expect(pendingResult).toMatchObject({ ok: true, value: { target: { capabilities: { returnToLocal: false } } } })
  })

  it('rebinds a delivered owner from the frozen Worktree back to the Local checkout', async () => {
    const retained = retainedRecord()
    const registryPort = registry(retained)
    registryPort.read = () => ({
      version: 2,
      revision: 1,
      sessionBindings: {
        'target-session': {
          sessionId: 'target-session',
          projectId: retained.projectId,
          projectName: retained.projectName,
          target: { kind: 'isolated', checkoutId: retained.checkoutId },
          ownerSessionId: 'target-session',
          sourceRef: retained.sourceRef,
          sourceOid: retained.baseOid,
          revision: 1,
        },
      },
      managedCheckouts: { [retained.checkoutId]: retained },
    })
    const { module, control } = plane(retained, { lookup: ownerLocalLookup(), registry: registryPort })
    vi.mocked(module.bind).mockResolvedValue(local('target-session'))

    const result = await control.returnToLocal({ sessionId: 'target-session', checkoutId: retained.checkoutId })

    expect(module.bind).toHaveBeenCalledWith('target-session', { kind: 'local' })
    expect(result).toMatchObject({ ok: true, value: { target: { state: 'local', checkoutId: null } } })
  })

  it('refuses to release a Worktree that has not reached delivery', async () => {
    const working = readyRecord()
    const { module, control } = plane(working, { lookup: ownerLocalLookup() })

    const result = await control.returnToLocal({ sessionId: 'target-session', checkoutId: working.checkoutId })

    expect(result).toMatchObject({ ok: false, error: { code: 'operation_not_allowed' } })
    expect(module.bind).not.toHaveBeenCalled()
  })

  it('reports the Local projection instead of failing when the owner already left', async () => {
    const retained = retainedRecord()
    const { module, control } = plane(retained, { lookup: ownerLocalLookup() })
    vi.mocked(module.inspect).mockResolvedValue(local('target-session'))

    const result = await control.returnToLocal({ sessionId: 'target-session', checkoutId: retained.checkoutId })

    expect(module.bind).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: true, value: { target: { state: 'local' } } })
  })

  it('keeps list rows path-free while authorized detail contains the validated managedRoot', async () => {
    const { control } = plane()
    const listed = await control.list({ sessionId: 'source-session' })
    expect(listed.ok).toBe(true)
    if (!listed.ok) throw new Error('expected list success')
    expect(listed.value.worktrees).toHaveLength(1)
    expect(listed.value.worktrees[0]).not.toHaveProperty('managedRoot')
    const inspected = await control.inspect('source-session', 'checkout-1')
    expect(inspected).toMatchObject({ ok: true, value: { target: { managedRoot: '/managed' } } })
  })

  it('finalizes only the persisted review identity with the complete long user-confirmed commit message', async () => {
    const { module, control } = plane()
    vi.mocked(module.operate).mockResolvedValue({
      status: 'finished', target: local(), changedFiles: ['src/index.ts'], commitOid: B, cleanup: 'discarded',
    })
    const result = await control.finalize({
      sessionId: 'target-session', checkoutId: 'checkout-1', expectedRevision: 7,
      expectedReviewId: 'review-1', commitMessage: longCommitMessage, retention: 'cleanup',
    })
    expect(result.ok).toBe(true)
    expect(module.operate).toHaveBeenCalledWith({
      sessionId: 'target-session', expectedRevision: 7, action: 'finish', expectedReviewId: 'review-1',
      commitMessage: longCommitMessage, retention: 'cleanup',
    })
  })

  it('returns the same structured continuation when direct Finalize races into a conflict', async () => {
    const { module, control } = plane()
    vi.mocked(module.operate).mockResolvedValue({
      status: 'conflict', code: 'apply_conflict', reason: 'content_conflict',
      target: { ...(await module.inspect('target-session')), revision: 9 },
      baseStrategy: 'recorded_base', effectiveBaseOid: A, localHeadOid: A, isolatedHeadOid: B,
      canRetryAfterRefresh: false, conflictingFiles: ['src/index.ts'],
    })

    const result = await control.finalize({
      sessionId: 'target-session', checkoutId: 'checkout-1', expectedRevision: 7,
      expectedReviewId: 'review-1', commitMessage: 'feat: finish', retention: 'cleanup',
    })

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'apply_conflict',
        continuation: {
          kind: 'worktree_apply_conflict', checkoutId: 'checkout-1', reviewId: 'review-1', revision: 9,
          localHeadOid: A, conflictingFiles: ['src/index.ts'],
        },
      },
    })
  })

  it('rejects an empty or NUL-containing user Commit Message before any Local operation', async () => {
    const { module, control } = plane()
    for (const commitMessage of ['   ', 'feat: bad\0message']) {
      const result = await control.finalize({
        sessionId: 'target-session', checkoutId: 'checkout-1', expectedRevision: 7,
        expectedReviewId: 'review-1', commitMessage, retention: 'cleanup',
      })
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
    }
    expect(module.operate).not.toHaveBeenCalled()
  })

  it('accepts a complete long message for preview finalization and rejects invalid bodies without operating', async () => {
    const record = readyRecord()
    if (record.delivery.state !== 'ready_for_review') throw new Error('expected ready')
    record.delivery = {
      state: 'preview_active', review: record.delivery.review,
      preview: {
        previewId: 'preview-1', reviewId: 'review-1', iteration: 1, previewedAt: 1,
        configuredBaseOid: A, effectiveBaseOid: A, baseStrategy: 'recorded_base',
        localHeadOid: A, localHeadRef: 'refs/heads/main',
        localFingerprintBefore: 'before', localFingerprintPreview: 'preview',
        localWorkingTreeOid: A, localIndexTreeOid: A, previewWorkingTreeOid: B, isolatedSnapshotOid: B,
        changedFiles: ['src/index.ts'], isolatedHeadOid: B, isolatedFingerprint: 'fingerprint-1',
      },
    }
    const { module, control } = plane(record)
    vi.mocked(module.operate).mockResolvedValue({
      status: 'finished', target: local(), changedFiles: ['src/index.ts'], commitOid: B, cleanup: 'discarded',
    })
    const request = {
      sessionId: 'target-session', checkoutId: 'checkout-1', expectedRevision: 7,
      expectedReviewId: 'review-1', commitMessage: longCommitMessage, retention: 'cleanup' as const,
    }
    for (const commitMessage of [' \n ', 'feat: bad\0message']) {
      expect(await control.finalizePreview({ ...request, commitMessage })).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
    }
    expect(module.operate).not.toHaveBeenCalled()
    expect(await control.finalizePreview(request)).toMatchObject({ ok: true })
    expect(module.operate).toHaveBeenCalledWith(expect.objectContaining({ action: 'finalize_preview', commitMessage: longCommitMessage }))
  })

  it('rejects source-side Discard after the owner Session is live', async () => {
    const { module, control } = plane()
    const result = await control.discard({
      sessionId: 'source-session', checkoutId: 'checkout-1', expectedRevision: 7, confirmDirty: true,
    })
    expect(result).toEqual({
      ok: false,
      error: { code: 'not_owner', message: 'Owner Session 已接管该 Worktree，只有 owner 可以 Discard' },
    })
    expect(module.manageManagedWorktreeForSession).not.toHaveBeenCalled()
  })

  it('allows the Local source to discard only an unopened owner reservation', async () => {
    const lookup = lookupDouble()
    lookup.getSession = vi.fn(sessionId => sessionId === 'target-session'
      ? undefined
      : { id: sessionId, projectId: 'project-1' })
    const { module, control } = plane(readyRecord(), { lookup })
    const result = await control.discard({
      sessionId: 'source-session', checkoutId: 'checkout-1', expectedRevision: 7, confirmDirty: true,
    })
    expect(result.ok).toBe(true)
    expect(module.manageManagedWorktreeForSession).toHaveBeenCalledWith('source-session', {
      checkoutId: 'checkout-1', expectedRevision: 7, action: 'discard', confirmDirty: true,
    })
  })

  it('routes owner Discard through the Preview-aware operation and keeps retention/cleanup owner-scoped', async () => {
    const { module, control } = plane()
    vi.mocked(module.operate).mockResolvedValueOnce({ status: 'discarded', checkoutId: 'checkout-1', changedFiles: [] })
    await control.discard({ sessionId: 'target-session', checkoutId: 'checkout-1', expectedRevision: 7, confirmDirty: true })
    await control.setRetention({ sessionId: 'target-session', checkoutId: 'checkout-1', expectedRevision: 8, retention: 'retain_manual' })
    await control.retryCleanup({ sessionId: 'target-session', checkoutId: 'checkout-1', expectedRevision: 9 })
    expect(module.operate).toHaveBeenCalledWith({
      action: 'discard', sessionId: 'target-session', expectedRevision: 7, confirmDirty: true,
    })
    expect(module.manageManagedWorktreeForSession).toHaveBeenNthCalledWith(1, 'target-session', {
      checkoutId: 'checkout-1', expectedRevision: 8, action: 'set_retention', retention: 'retain_manual',
    })
    expect(module.manageManagedWorktreeForSession).toHaveBeenNthCalledWith(2, 'target-session', {
      checkoutId: 'checkout-1', expectedRevision: 9, action: 'retry_cleanup',
    })
  })

  it('refuses retention, permanence and cleanup for the Local source Session even once the owner Session is gone', async () => {
    const lookup = lookupDouble()
    lookup.getSession = vi.fn(sessionId => sessionId === 'target-session'
      ? undefined
      : { id: sessionId, projectId: 'project-1' })
    const { module, control } = plane(retainedRecord(), { lookup })

    for (const result of await Promise.all([
      control.setRetention({ sessionId: 'source-session', checkoutId: 'checkout-1', expectedRevision: 9, retention: 'retain_manual' }),
      control.setPermanent({ sessionId: 'source-session', checkoutId: 'checkout-1', expectedRevision: 9, permanent: true }),
      control.retryCleanup({ sessionId: 'source-session', checkoutId: 'checkout-1', expectedRevision: 9 }),
    ])) {
      expect(result).toMatchObject({ ok: false, error: { code: 'not_owner' } })
    }
    expect(module.manageManagedWorktreeForSession).not.toHaveBeenCalled()
  })

  it('refuses to clear the sidebar badge of a non-terminal Worktree', async () => {
    const { module, control } = plane()
    await expect(control.clearSidebarBadge({ sessionId: 'source-session', checkoutId: 'checkout-1', expectedRevision: 7 }))
      .resolves.toMatchObject({ ok: false, error: { code: 'operation_not_allowed' } })
    expect(module.manageManagedWorktreeForSession).not.toHaveBeenCalled()
  })

  it('routes a terminal sidebar badge clear through the session-scoped mutation and stops projecting the task', async () => {
    const discarded = readyRecord()
    discarded.phase = 'discarded'
    discarded.delivery = { state: 'delivered', iteration: 1, commitOid: B, deliveredAt: 10 }
    const lookup = {
      getProject: vi.fn((_projectId: string) => ({ id: 'project-1', name: 'Project', root: '/local' })),
      getSession: vi.fn((sessionId: string) => ({ id: sessionId, projectId: 'project-1' })),
    }
    const { module, control } = plane(discarded, { lookup })
    await expect(control.clearSidebarBadge({ sessionId: 'source-session', checkoutId: 'checkout-1', expectedRevision: 7 }))
      .resolves.toMatchObject({ ok: true })
    expect(module.manageManagedWorktreeForSession).toHaveBeenCalledWith('source-session', {
      checkoutId: 'checkout-1', expectedRevision: 7, action: 'clear_sidebar_badge',
    })

    const cleared: ManagedCheckoutRecord = { ...discarded, sidebarBadgeClearedRevision: discarded.revision }
    const suppressed = plane(discarded, {
      lookup,
      registry: { read: () => ({ version: 2, revision: 1, sessionBindings: {}, managedCheckouts: { [cleared.checkoutId]: cleared } }), write: vi.fn() },
    })
    await expect(suppressed.control.sidebarTopology()).resolves.toEqual({
      ok: true,
      value: { projects: [{ project: { id: 'project-1', name: 'Project' }, tasks: [] }] },
    })
  })

  it('drops all diff bytes when the reviewed snapshot becomes stale during the read', async () => {
    const { module, control } = plane()
    vi.mocked(module.preflight!).mockResolvedValueOnce({
      status: 'ready', localModified: false, checkoutId: 'checkout-1', reviewId: 'review-1', revision: 7,
      configuredBaseOid: A, effectiveBaseOid: A, baseStrategy: 'recorded_base', localBranch: 'main',
      localHeadOid: A, isolatedHeadOid: B, changedFiles: ['src/index.ts'],
    }).mockResolvedValueOnce({
      status: 'blocked', localModified: false, checkoutId: 'checkout-1', reviewId: 'review-1', revision: 7,
      reason: 'stale_isolated', message: 'changed after review',
    })
    const result = await control.reviewDiff({
      sessionId: 'target-session', checkoutId: 'checkout-1', expectedRevision: 7, expectedReviewId: 'review-1',
    })
    expect(result).toEqual({ ok: false, error: { code: 'stale_isolated', message: 'Ready 后 Isolated 内容已变化，Diff bytes 已丢弃' } })
    expect(JSON.stringify(result)).not.toContain('@@')
  })

  it('enforces the complete 1 MiB response budget across individually bounded patches', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-console-total-budget-'))
    try {
      runGit(root, ['init'])
      runGit(root, ['config', 'user.email', 'fixture@example.com'])
      runGit(root, ['config', 'user.name', 'Fixture'])
      writeFileSync(join(root, 'base.txt'), 'base\n')
      runGit(root, ['add', '.'])
      runGit(root, ['commit', '-m', 'base'])
      const baseOid = runGit(root, ['rev-parse', 'HEAD'])
      const changedFiles: string[] = []
      for (let index = 0; index < 12; index += 1) {
        const path = `large-${String(index).padStart(2, '0')}.txt`
        changedFiles.push(path)
        writeFileSync(join(root, path), `${String(index)}${'x'.repeat(REVIEW_DIFF_MAX_PATCH_BYTES + 4096)}`)
      }
      const result = await createGitWorktreeReviewDiffReader().read({
        managedRoot: root, baseOid, reviewId: 'review-total', revision: 8, changedFiles,
      })
      expect(result.truncated).toBe(true)
      expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(REVIEW_DIFF_MAX_PAYLOAD_BYTES)
      expect(result.files.length).toBeLessThan(changedFiles.length)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)

  it('renders binary and rename entries within the file, patch, and file-count budgets', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-console-diff-test-'))
    try {
      runGit(root, ['init'])
      runGit(root, ['config', 'user.email', 'fixture@example.com'])
      runGit(root, ['config', 'user.name', 'Fixture'])
      writeFileSync(join(root, '000-binary.bin'), Buffer.from([0, 1, 2]))
      writeFileSync(join(root, '001-old.txt'), 'old\n')
      writeFileSync(join(root, 'base.txt'), 'base\n')
      runGit(root, ['add', '.'])
      runGit(root, ['commit', '-m', 'base'])
      const baseOid = runGit(root, ['rev-parse', 'HEAD'])

      writeFileSync(join(root, '000-binary.bin'), Buffer.from([0, 9, 8, 7]))
      runGit(root, ['mv', '001-old.txt', '001-new.txt'])
      writeFileSync(join(root, '002-large.txt'), 'x'.repeat(REVIEW_DIFF_MAX_PATCH_BYTES + 4096))
      const extra: string[] = []
      for (let index = 0; index < 201; index += 1) {
        const path = `100-file-${String(index).padStart(3, '0')}.txt`
        extra.push(path)
        writeFileSync(join(root, path), `${index}\n`)
      }
      const changedFiles = ['000-binary.bin', '001-old.txt', '001-new.txt', '002-large.txt', ...extra].sort()
      const result = await createGitWorktreeReviewDiffReader().read({
        managedRoot: root, baseOid, reviewId: 'review-1', revision: 7, changedFiles,
      })

      expect(result.files).toHaveLength(200)
      expect(result.truncated).toBe(true)
      expect(result.files.find(file => file.path === '000-binary.bin')).toMatchObject({ status: 'binary', patch: null })
      expect(result.files.find(file => file.path === '001-new.txt')).toMatchObject({ status: 'renamed', previousPath: '001-old.txt' })
      const large = result.files.find(file => file.path === '002-large.txt')
      expect(large?.truncated).toBe(true)
      expect(Buffer.byteLength(large?.patch ?? '', 'utf8')).toBeLessThanOrEqual(REVIEW_DIFF_MAX_PATCH_BYTES)
      expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(REVIEW_DIFF_MAX_PAYLOAD_BYTES)
      expect(result.files.every(file => !file.path.startsWith('/') && !file.path.includes('..'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 120_000)
})

