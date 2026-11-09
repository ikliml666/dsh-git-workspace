import type {
  WorktreeConsoleAdapter,
  WorktreeConsoleBeginNextIterationRequest,
  WorktreeConsoleCheckpointRequest,
  WorktreeConsoleCreatePreviewRecoveryHandoffRequest,
  WorktreeConsoleAbandonedListResponse,
  WorktreeConsoleCreatePreviewRecoveryHandoffResponse,
  WorktreeConsoleCreateRequest,
  WorktreeConsoleCreateResponse,
  WorktreeConsoleCurrentRequest,
  WorktreeConsoleCurrentResponse,
  WorktreeConsoleDiscardRequest,
  WorktreeConsoleFinalizePreviewRequest,
  WorktreeConsoleDeliverRequest,
  WorktreeConsoleFinalizeRequest,
  WorktreeConsoleGitBranch,
  WorktreeConsoleGitCreateTagRequest,
  WorktreeConsoleGitDeleteTagRequest,
  WorktreeConsoleGitGraphResponse,
  WorktreeConsoleGitCommitLocalRequest,
  WorktreeConsoleGitCommitLocalResponse,
  WorktreeConsoleGitMutationResponse,
  WorktreeConsoleGitOverviewResponse,
  WorktreeConsoleGitPushTagRequest,
  WorktreeConsoleGitTag,
  WorktreeConsoleGitTagListResponse,
  WorktreeConsoleGitTagMutationResponse,
  WorktreeConsoleInspectRequest,
  WorktreeConsoleInspectResponse,
  WorktreeConsoleListRequest,
  WorktreeConsoleListResponse,
  WorktreeConsoleMutationResponse,
  WorktreeConsoleOutcome,
  WorktreeConsolePreflightRequest,
  WorktreeConsolePreflightResponse,
  WorktreeConsolePreparePreviewRecoveryAnalysisRequest,
  WorktreeConsolePreviewRecoveryPreflightRequest,
  WorktreeConsolePreviewRecoveryPreflightResponse,
  WorktreeConsoleRestoreAbandonedRequest,
  WorktreeConsoleRestoreAbandonedResponse,
  WorktreeConsoleReturnToLocalRequest,
  WorktreeConsoleReturnToLocalResponse,
  WorktreeConsolePrepareRegenerationRequest,
  WorktreeConsolePreviewRequest,
  WorktreeConsoleRetryCleanupRequest,
  WorktreeConsoleClearSidebarBadgeRequest,
  WorktreeConsoleResumeRevisionRequest,
  WorktreeConsoleRollbackPreviewRequest,
  WorktreeConsoleReviewDiffRequest,
  WorktreeConsoleReviewDiffResponse,
  WorktreeConsoleSetRetentionRequest,
  WorktreeConsoleSetPermanentRequest,
  WorktreeConsoleTargetDetails,
  WorktreeConsoleCreateWorktreeRequest,
  WorktreeConsoleCreateWorktreeResponse,
} from '../../src/console-contract.js'

export type WorktreeConsoleFixtureMethod = keyof WorktreeConsoleAdapter

export interface WorktreeConsoleFixtureCall {
  method: WorktreeConsoleFixtureMethod
  request: unknown
}

function readyTarget(): WorktreeConsoleTargetDetails {
  return {
    project: { id: 'project-1', name: 'Fixture Project' },
    checkoutId: 'checkout-1',
    sourceSessionId: 'source-session',
    ownerSessionId: 'target-session',
    targetSessionId: 'target-session',
    iteration: 1,
    revision: 7,
    state: 'ready_for_review',
    phase: 'ready',
    dirty: true,
    currentOid: 'b'.repeat(40),
    sourceOid: 'a'.repeat(40),
    currentBranch: null,
    commitOid: null,
    sourceBranch: 'main',
    managedRoot: '/fixture/project-worktrees/checkout-1',
    sourceRoot: '/fixture/project',
    capabilities: {
      create: false,
      open: true,
      inspect: true,
      discard: true,
      preflight: true,
      preview: true,
      checkpoint: true,
      resumeRevision: true,
      rollbackPreview: false,
      finalize: true,
      finalizePreview: false,
      setRetention: false,
      setPermanent: false,
      retryCleanup: false,
      beginNextIteration: false,
      returnToLocal: false,
    },
    checkpointGeneration: '9'.repeat(64),
    review: {
      reviewId: 'review-1',
      revision: 7,
      iteration: 1,
      preparedAt: 1,
      summary: 'Fixture review',
      validationStatus: 'passed',
      validationSummary: 'focused tests passed',
      tests: [{ command: 'pnpm test', status: 'passed' }],
      changedFiles: ['src/index.ts'],
      suggestedCommitMessage: 'fix: fixture review',
    },
  }
}

function outcome<T>(value: T): WorktreeConsoleOutcome<T> {
  return { ok: true, value }
}

export interface WorktreeConsoleAdapterFixture {
  adapter: WorktreeConsoleAdapter
  calls: WorktreeConsoleFixtureCall[]
  target: WorktreeConsoleTargetDetails
}

/** Shared deterministic fake used by the three parallel Worktree Console tracks. */
export function createWorktreeConsoleAdapterFixture(stateful = false): WorktreeConsoleAdapterFixture {
  const calls: WorktreeConsoleFixtureCall[] = []
  let target = readyTarget()
  const record = <TRequest>(method: WorktreeConsoleFixtureMethod, request: TRequest): void => {
    calls.push({ method, request })
  }
  const delivered = (): WorktreeConsoleMutationResponse => {
    const { managedRoot: _managedRoot, sourceRoot: _sourceRoot, sourceOid: _sourceOid, currentBranch: _currentBranch, ...summary } = target
    return {
      target: {
        ...summary,
        state: 'delivered',
        phase: 'discarded',
        dirty: false,
        commitOid: 'c'.repeat(40),
        deliveryProof: {
          localBranch: 'main',
          localHeadBefore: 'a'.repeat(40),
          localHeadAfter: 'c'.repeat(40),
          changedFiles: ['src/index.ts'],
          validationStatus: target.review?.validationStatus,
          validationSummary: target.review?.validationSummary,
          commitInLocalHistory: true,
        },
        capabilities: {
          create: false,
          open: false,
          inspect: true,
          discard: false,
          preflight: false,
          preview: false,
          checkpoint: false,
          resumeRevision: false,
          rollbackPreview: false,
          finalize: false,
          finalizePreview: false,
          setRetention: false,
          setPermanent: false,
          retryCleanup: false,
          beginNextIteration: true,
          returnToLocal: true,
        },
      },
      changedFiles: ['src/index.ts'],
      commitOid: 'c'.repeat(40),
    }
  }

  // Mutable tag state: the tag UI reads it back after every mutation.
  const tags: WorktreeConsoleGitTag[] = []

  const adapter: WorktreeConsoleAdapter = {
    async sidebarTopology() {
      record('sidebarTopology', {})
      return outcome({ projects: [], workspaceClientFlavor: 'legacy' })
    },
    async current(request: WorktreeConsoleCurrentRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleCurrentResponse>> {
      record('current', request)
      return outcome({ target, adoptionFailure: null })
    },
    async list(request: WorktreeConsoleListRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleListResponse>> {
      record('list', request)
      return outcome({ project: target.project, worktrees: [target] })
    },
    async create(request: WorktreeConsoleCreateRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleCreateResponse>> {
      record('create', request)
      return outcome({ target, targetSessionId: target.ownerSessionId, managedRoot: target.managedRoot! })
    },
    async initializeProject(request: { sourceSessionId: string }): Promise<WorktreeConsoleOutcome<boolean>> {
      record('initializeProject', request)
      return outcome(true)
    },
    async inspect(request: WorktreeConsoleInspectRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleInspectResponse>> {
      record('inspect', request)
      return outcome({ target })
    },
    async reviewDiff(request: WorktreeConsoleReviewDiffRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleReviewDiffResponse>> {
      record('reviewDiff', request)
      return outcome({
        reviewId: request.expectedReviewId,
        revision: request.expectedRevision,
        files: [{ path: 'src/index.ts', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new\n', truncated: false }],
        truncated: false,
      })
    },
    async preflight(request: WorktreeConsolePreflightRequest): Promise<WorktreeConsoleOutcome<WorktreeConsolePreflightResponse>> {
      record('preflight', request)
      return outcome({
        preflight: {
          status: 'ready', localModified: false, checkoutId: request.checkoutId, reviewId: request.expectedReviewId,
          revision: request.expectedRevision, configuredBaseOid: 'a'.repeat(40), effectiveBaseOid: 'a'.repeat(40),
          baseStrategy: 'recorded_base', localBranch: 'main', localHeadOid: 'a'.repeat(40), isolatedHeadOid: 'b'.repeat(40),
          changedFiles: ['src/index.ts'],
        },
      })
    },
    async previewRecoveryPreflight(request: WorktreeConsolePreviewRecoveryPreflightRequest): Promise<WorktreeConsoleOutcome<WorktreeConsolePreviewRecoveryPreflightResponse>> {
      record('previewRecoveryPreflight', request)
      return outcome({ preflight: {
        status: 'assessed', localModified: false,
        proof: {
          sessionId: request.sessionId,
          checkoutId: request.checkoutId,
          reviewId: request.expectedReviewId,
          previewId: request.expectedPreviewId,
          revision: request.expectedRevision,
          generation: '1'.repeat(64),
          receiptFingerprint: '2'.repeat(64),
          localFingerprint: '3'.repeat(64),
          localHeadOid: 'a'.repeat(40),
          localHeadRef: 'refs/heads/main',
          localHeadTreeOid: 'b'.repeat(40),
          localIndexTreeOid: 'c'.repeat(40),
          localWorkingTreeOid: 'd'.repeat(40),
          rollback: { status: 'safe', targetTreeOid: 'e'.repeat(40) },
          finalize: {
            status: 'safe', taskTreeOid: 'f'.repeat(40), finalIndexTreeOid: '1'.repeat(40),
            expectedWorkingTreeOid: 'd'.repeat(40), commitRequired: true,
          },
        },
      } })
    },
    async preparePreviewRecoveryAnalysis(request: WorktreeConsolePreparePreviewRecoveryAnalysisRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
      record('preparePreviewRecoveryAnalysis', request)
      return outcome({ target, recoveryContinuation: {
        kind: 'worktree_preview_recovery_analysis', requestId: 'analysis-1', checkoutId: request.checkoutId,
        reviewId: request.expectedReviewId, previewId: request.expectedPreviewId,
        revision: request.expectedRevision, generation: request.recoveryProof.generation,
      } })
    },
    async createPreviewRecoveryHandoff(request: WorktreeConsoleCreatePreviewRecoveryHandoffRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleCreatePreviewRecoveryHandoffResponse>> {
      record('createPreviewRecoveryHandoff', request)
      return outcome({
        target,
        targetSessionId: target.ownerSessionId,
        managedRoot: target.managedRoot!,
        recoveryContinuation: {
          kind: 'worktree_preview_recovery_handoff', requestId: 'handoff-1', checkoutId: target.checkoutId!,
          sourceCheckoutId: request.checkoutId, reviewId: request.expectedReviewId, previewId: request.expectedPreviewId,
          revision: request.expectedRevision, generation: request.recoveryProof.generation,
        },
      })
    },
    async preview(request: WorktreeConsolePreviewRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
      record('preview', request)
      return outcome({ target: {
        ...target,
        state: 'preview_active',
        revision: target.revision + 1,
        capabilities: { ...target.capabilities, preflight: false, preview: false, resumeRevision: false, rollbackPreview: true, finalize: false, finalizePreview: true },
      }, changedFiles: ['src/index.ts'] })
    },
    async checkpoint(request: WorktreeConsoleCheckpointRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
      record('checkpoint', request)
      const saved = {
        checkpointId: 'checkpoint-1', sequence: 1, reviewId: request.expectedReviewId, createdAt: 2,
        summary: target.review!.summary, validationStatus: target.review!.validationStatus,
        changedFiles: [...target.review!.changedFiles],
      }
      const {
        review: _review,
        checkpointGeneration: _generation,
        managedRoot: _managedRoot,
        sourceRoot: _sourceRoot,
        sourceOid: _sourceOid,
        currentBranch: _currentBranch,
        ...working
      } = target
      return outcome({
        target: {
          ...working,
          state: 'working',
          revision: target.revision + 3,
          checkpoints: [saved],
          capabilities: {
            ...target.capabilities,
            preflight: false,
            preview: false,
            checkpoint: false,
            resumeRevision: false,
            rollbackPreview: false,
            finalize: false,
            finalizePreview: false,
          },
        },
        checkpoint: saved,
        changedFiles: [...saved.changedFiles],
      })
    },
    async resumeRevision(request: WorktreeConsoleResumeRevisionRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
      record('resumeRevision', request)
      const {
        review: _review,
        reviewSlot: _slot,
        managedRoot: _managedRoot,
        sourceRoot: _sourceRoot,
        sourceOid: _sourceOid,
        currentBranch: _currentBranch,
        ...working
      } = target
      const recoveryContinuation = request.conflictContinuation ? {
        ...request.conflictContinuation,
        requestId: 'host-authority-conflict-1',
        revision: target.revision + 1,
      } : undefined
      return outcome({ target: {
        ...working,
        state: 'working',
        revision: target.revision + 1,
        ...(recoveryContinuation ? { recoveryContinuation } : {}),
        capabilities: {
          ...target.capabilities,
          preflight: false,
          preview: false,
          resumeRevision: false,
          rollbackPreview: false,
          finalize: false,
          finalizePreview: false,
        },
      }, ...(recoveryContinuation ? { recoveryContinuation } : {}) })
    },
    async prepareReviewRegeneration(request: WorktreeConsolePrepareRegenerationRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
      record('prepareReviewRegeneration', request)
      const recoveryContinuation = {
        kind: 'worktree_review_regeneration' as const,
        requestId: 'host-authority-regeneration-1',
        checkoutId: request.checkoutId,
        reviewId: request.expectedReviewId,
        revision: request.expectedRevision,
      }
      return outcome({
        target: { ...target, recoveryContinuation },
        recoveryContinuation,
      })
    },
    async rollbackPreview(request: WorktreeConsoleRollbackPreviewRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
      record('rollbackPreview', request)
      if (request.resumeRevision) {
        const { review: _review, reviewSlot: _slot, ...working } = target
        return outcome({ target: {
          ...working,
          state: 'working',
          revision: target.revision + 1,
          capabilities: { ...target.capabilities, preflight: false, preview: false, resumeRevision: false, rollbackPreview: false, finalize: false, finalizePreview: false },
        }, changedFiles: ['src/index.ts'] })
      }
      return outcome({ target: { ...target, state: 'ready_for_review', revision: target.revision + 1, capabilities: { ...readyTarget().capabilities } }, changedFiles: ['src/index.ts'] })
    },
    async discard(request: WorktreeConsoleDiscardRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
      record('discard', request)
      return outcome(delivered())
    },
    async finalize(request: WorktreeConsoleFinalizeRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
      record('finalize', request)
      return outcome(delivered())
    },
    async deliver(request: WorktreeConsoleDeliverRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
      record('deliver', request)
      return outcome(delivered())
    },
    async finalizePreview(request: WorktreeConsoleFinalizePreviewRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
      record('finalizePreview', request)
      return outcome(delivered())
    },
    async setRetention(request: WorktreeConsoleSetRetentionRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
      record('setRetention', request)
      return outcome({ target: { ...target, state: 'retained', phase: 'retained', retention: request.retention } })
    },
    async setPermanent(request: WorktreeConsoleSetPermanentRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
      record('setPermanent', request)
      return outcome({ target: { ...target, permanent: request.permanent } })
    },
    async retryCleanup(request: WorktreeConsoleRetryCleanupRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
      record('retryCleanup', request)
      return outcome(delivered())
    },
    async clearSidebarBadge(request: WorktreeConsoleClearSidebarBadgeRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
      record('clearSidebarBadge', request)
      return outcome(delivered())
    },
    async beginNextIteration(request: WorktreeConsoleBeginNextIterationRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
      record('beginNextIteration', request)
      const {
        review: _review,
        reviewSlot: _slot,
        managedRoot: _managedRoot,
        sourceRoot: _sourceRoot,
        sourceOid: _sourceOid,
        currentBranch: _currentBranch,
        ...working
      } = target
      return outcome({ target: {
        ...working,
        checkoutId: 'checkout-2',
        iteration: target.iteration + 1,
        revision: request.expectedRevision + 2,
        state: 'working',
        phase: 'ready',
        dirty: false,
        commitOid: null,
        capabilities: { ...target.capabilities, preflight: false, preview: false, resumeRevision: false, finalize: false, beginNextIteration: false },
      } })
    },
    async createWorktree(request: WorktreeConsoleCreateWorktreeRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleCreateWorktreeResponse>> {
      record('createWorktree', request)
      // 点击即建：回一条建好的目标（失败态由各个用例自己覆盖这个方法）。
      return outcome({ target, failure: null })
    },
    async returnToLocal(request: WorktreeConsoleReturnToLocalRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleReturnToLocalResponse>> {
      record('returnToLocal', request)
      const {
        review: _review,
        reviewSlot: _slot,
        deliveryProof: _deliveryProof,
        ...released
      } = target
      return outcome({ target: {
        ...released,
        checkoutId: null,
        ownerSessionId: 'target-session',
        targetSessionId: null,
        iteration: 0,
        revision: target.revision + 1,
        state: 'local',
        phase: 'local',
        dirty: false,
        commitOid: null,
        currentBranch: 'main',
        sourceSessionId: 'target-session',
        capabilities: { ...target.capabilities, discard: false, retryCleanup: false, beginNextIteration: false, returnToLocal: false },
      } })
    },
    async gitOverview(sessionId: string): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitOverviewResponse>> {
      record('gitOverview', sessionId)
      const branches: WorktreeConsoleGitBranch[] = target.currentBranch
        ? [{ name: target.currentBranch, oid: target.currentOid, isCurrent: true, upstream: null }, { name: 'main', oid: 'a'.repeat(40), isCurrent: false, upstream: 'origin/main' }]
        : [{ name: 'main', oid: 'a'.repeat(40), isCurrent: true, upstream: 'origin/main' }]
      return outcome({
        root: target.sourceRoot ?? '/fixture/project',
        branch: target.currentBranch,
        headOid: target.currentOid,
        branches,
        dirtyCount: target.dirty ? 1 : 0,
      })
    },
    async gitGraph(sessionId: string, limit?: number): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitGraphResponse>> {
      record('gitGraph', { sessionId, limit })
      return outcome({ root: target.sourceRoot ?? '/fixture/project', branch: target.currentBranch, commits: [] })
    },
    async gitCreateBranchAndSwitch(sessionId: string, name: string): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitMutationResponse>> {
      record('gitCreateBranchAndSwitch', { sessionId, name })
      return outcome({ branch: name })
    },
    async gitSwitchBranch(sessionId: string, branch: string): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitMutationResponse>> {
      record('gitSwitchBranch', { sessionId, branch })
      return outcome({ branch })
    },
    async gitCommitLocalChanges(request: WorktreeConsoleGitCommitLocalRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitCommitLocalResponse>> {
      record('gitCommitLocalChanges', request)
      return outcome({ commitOid: 'c'.repeat(40) })
    },
    async listAbandoned(sessionId: string): Promise<WorktreeConsoleOutcome<WorktreeConsoleAbandonedListResponse>> {
      record('listAbandoned', sessionId)
      return outcome({ snapshots: [] })
    },
    async restoreAbandoned(request: WorktreeConsoleRestoreAbandonedRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleRestoreAbandonedResponse>> {
      record('restoreAbandoned', request)
      return outcome({ checkoutId: request.checkoutId, branch: `worktree-restore-${request.checkoutId.slice(0, 8)}` })
    },
    async gitListTags(sessionId: string): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitTagListResponse>> {
      record('gitListTags', sessionId)
      return outcome({
        root: target.sourceRoot ?? '/fixture/project',
        tags: tags.map(tag => ({ ...tag })),
      })
    },
    async gitCreateTag(request: WorktreeConsoleGitCreateTagRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitTagMutationResponse>> {
      record('gitCreateTag', request)
      if (tags.some(tag => tag.name === request.name)) {
        return { ok: false, error: { code: 'git_operation_failed', message: `tag '${request.name}' already exists` } }
      }
      tags.push({
        name: request.name,
        oid: 'c'.repeat(40),
        commitOid: target.currentOid,
        annotated: (request.message ?? '').trim() !== '',
        message: (request.message ?? '').trim() === '' ? null : request.message!.trim(),
        pushed: request.push === true,
      })
      return outcome({ tag: request.name, ...(request.push === true ? { pushed: true } : {}) })
    },
    async gitDeleteTag(request: WorktreeConsoleGitDeleteTagRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitTagMutationResponse>> {
      record('gitDeleteTag', request)
      const index = tags.findIndex(tag => tag.name === request.name)
      if (index === -1) return { ok: false, error: { code: 'git_operation_failed', message: `tag '${request.name}' not found` } }
      tags.splice(index, 1)
      return outcome({ tag: request.name, ...(request.remote === true ? { pushed: true } : {}) })
    },
    async gitPushTag(request: WorktreeConsoleGitPushTagRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitTagMutationResponse>> {
      record('gitPushTag', request)
      const tag = tags.find(entry => entry.name === request.name)
      if (tag === undefined) return { ok: false, error: { code: 'git_operation_failed', message: `tag '${request.name}' not found` } }
      tag.pushed = true
      return outcome({ tag: request.name, pushed: true })
    },
  }

  if (stateful) {
    for (const method of ['preview', 'rollbackPreview', 'resumeRevision', 'finalizePreview'] as const) {
      const operation = adapter[method].bind(adapter)
      Object.assign(adapter, { [method]: async (request: Parameters<typeof operation>[0]) => {
        if (request.expectedRevision !== target.revision) return { ok: false, error: { code: 'stale_target', message: 'Revision changed' } }
        const result = await operation(request as never)
        if (result.ok) {
          // Host journaling and completion each advance CAS; callers must use returned identity.
          result.value.target.revision = target.revision + 3
          target = { ...target, ...result.value.target, review: result.value.target.review }
        }
        return result
      } })
    }
  }
  return { adapter, calls, get target() { return target } }
}
