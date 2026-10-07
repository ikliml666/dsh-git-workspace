import { hostMessage, withHostLanguage, languageForInvocation } from './i18n/host.js'
import { hostRegistrationMessage } from './i18n/host-messages.js'
/**
 * Model-facing worktree tools. The model can reserve a real target session,
 * inspect its own scoped worktrees, invalidate an unsynced review before
 * further file edits, safely begin a cleaned same-session iteration, and stop
 * at Ready for Review. worktree_deliver commits/pushes/cleans and is refused
 * while the autoDeliver setting is off — delivery then goes through
 * worktree_ready_for_review plus the human acceptance bar. Discard/Remove
 * remain human commands surfaced by the client ToolView.
 * @module dsh-git-worktree/tools
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { SessionCheckoutModule } from './index.js'
import type { WorktreeValidationStatus } from './types.js'

const WORKTREE_RETENTION_VALUES = ['cleanup', 'retain_24h', 'retain_3d', 'retain_manual'] as const

function parseWorktreeRetention(value: unknown): (typeof WORKTREE_RETENTION_VALUES)[number] {
  if (value === undefined) return 'cleanup'
  if (typeof value === 'string' && (WORKTREE_RETENTION_VALUES as readonly string[]).includes(value)) {
    return value as (typeof WORKTREE_RETENTION_VALUES)[number]
  }
  throw new Error(hostMessage('worktreeDeliverInvalidRetention', { p0: String(value) }))
}

function sessionIdOf(agent: unknown): string {
  const session = (agent as { session?: { id: unknown } } | undefined)?.session
  if (!session || typeof session.id !== 'string') {
    throw new Error(hostMessage('worktreeToolsCanOnlyBeCalledInADSH'))
  }
  return session.id
}

/** Canonical logged payload consumed by both the model and the keyed ToolView. */
function renderJson(value: unknown): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

/** Register the safe model-facing worktree tools. */
export function registerTools(ctx: Context, module: SessionCheckoutModule): void {
  ctx.tools.register(defineTool({
    name: 'worktree_create',
    description: hostRegistrationMessage('reserveAUniqueManagedGitWorktreeAndADistinct'),
    parameters: {
      topic: {
        type: 'string',
        description: hostRegistrationMessage('optionalTopicForHumanReadableWorktreeNaming'),
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true },
          checkoutId: { type: 'string', required: true },
          targetSessionId: { type: 'string', required: true },
          managedRoot: { type: 'string', required: true },
          phase: { type: 'string', required: true },
          currentOid: { type: 'string', required: true },
          sourceSessionId: { type: 'string', required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(args, exec) {
      return withHostLanguage(languageForInvocation(exec.agent, ctx), async () => {
        const sourceSessionId = sessionIdOf(exec.agent)
        const targetSessionId = randomUUID()
        const topic = typeof args?.topic === 'string' && args.topic.trim() ? args.topic.trim() : undefined
        const launch = await module.createIsolatedTarget(sourceSessionId, targetSessionId, topic ? { topic } : undefined)
        return {
          kind: 'worktree_target_created',
          checkoutId: launch.target.checkout.id,
          targetSessionId,
          managedRoot: launch.managedRoot,
          phase: launch.target.checkout.phase,
          currentOid: launch.target.current.oid,
          sourceSessionId,
        }
      })
    },
    presentCall: () => ({ card: 'generic', title: hostRegistrationMessage('createIsolatedSessionTarget'), kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'worktree_list',
    description: hostRegistrationMessage('listManagedWorktreesVisibleToTheCurrentSessionResults'),
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true },
          worktrees: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                checkoutId: { type: 'string', required: true },
                projectName: { type: 'string', required: true },
                ownerSessionId: { type: 'string', required: true },
                iteration: { type: 'number', required: true },
                revision: { type: 'number', required: true },
                state: { type: 'string', required: true },
                phase: { type: 'string', required: true },
                dirty: { type: 'boolean', required: true },
                commitOid: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(_args, exec) {
      return withHostLanguage(languageForInvocation(exec.agent, ctx), async () => {
        const sessionId = sessionIdOf(exec.agent)
        const summaries = await module.listManagedWorktreesForSession(sessionId)
        return {
          kind: 'worktree_list',
          worktrees: summaries.map((summary) => ({
            checkoutId: summary.checkoutId,
            projectName: summary.project.name,
            ownerSessionId: summary.ownerSessionId,
            iteration: summary.iteration,
            revision: summary.revision,
            state: summary.state,
            phase: summary.phase,
            dirty: summary.dirty,
            commitOid: summary.commitOid ?? undefined,
          })),
        }
      })
    },
    presentCall: () => ({ card: 'generic', title: hostRegistrationMessage('listManagedWorktrees'), kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'worktree_resume_revision',
    description: hostRegistrationMessage('whenTheCurrentIsolatedSessionIsReadyForReview'),
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true },
          checkoutId: { type: 'string', required: true },
          iteration: { type: 'number', required: true },
          revision: { type: 'number', required: true },
          phase: { type: 'string', required: true },
          sessionId: { type: 'string', required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(_args, exec) {
      return withHostLanguage(languageForInvocation(exec.agent, ctx), async () => {
        const sessionId = sessionIdOf(exec.agent)
        const current = await module.inspect(sessionId)
        if (current.delivery?.state !== 'ready_for_review') {
          throw new Error(hostMessage('theCurrentWorktreeHasNoUnsyncedReviewToResume372', { p0: current.delivery?.state ?? 'unknown' }))
        }
        const target = await module.resumeRevision(
          sessionId,
          current.revision,
          current.delivery.review.reviewId,
        )
        if (target.delivery?.state !== 'working') {
          throw new Error(hostMessage('worktreeDidNotReturnToWorkingState', { p0: target.delivery?.state ?? 'unknown' }))
        }
        return {
          kind: 'worktree_revision_resumed',
          checkoutId: target.checkout.id,
          iteration: target.delivery.iteration,
          revision: target.revision,
          phase: target.checkout.phase,
          sessionId,
        }
      })
    },
    presentCall: () => ({ card: 'generic', title: hostRegistrationMessage('resumeWorktreeRevision'), kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'worktree_begin_next_iteration',
    description: hostRegistrationMessage('whenTheCurrentIsolatedSessionHasBeenDeliveredAnd'),
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true },
          checkoutId: { type: 'string', required: true },
          iteration: { type: 'number', required: true },
          phase: { type: 'string', required: true },
          currentOid: { type: 'string', required: true },
          sessionId: { type: 'string', required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(_args, exec) {
      return withHostLanguage(languageForInvocation(exec.agent, ctx), async () => {
        const sessionId = sessionIdOf(exec.agent)
        const current = await module.inspect(sessionId)
        const target = await module.beginNextIteration(sessionId, current.revision)
        if (target.delivery?.state !== 'working') {
          throw new Error(hostMessage('theNextWorktreeIterationDidNotEnterWorkingState', { p0: target.delivery?.state ?? 'unknown' }))
        }
        return {
          kind: 'worktree_next_iteration_started',
          checkoutId: target.checkout.id,
          iteration: target.delivery.iteration,
          phase: target.checkout.phase,
          currentOid: target.current.oid,
          sessionId,
        }
      })
    },
    presentCall: () => ({ card: 'generic', title: hostRegistrationMessage('startNextWorktreeIteration'), kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'worktree_ready_for_review',
    description: hostRegistrationMessage('onlyForWorktreeSessionsThatHaveAlreadySelectedAn'),
    parameters: {
      summary: {
        type: 'string',
        required: true,
        description: hostRegistrationMessage('oneLineSummaryOfTheChangeMax240Chars'),
      },
      details: {
        type: 'string',
        description: hostRegistrationMessage('optionalFullMarkdownDetailsMax12000Chars'),
      },
      validationStatus: {
        type: 'string',
        required: true,
        enum: ['passed', 'failed', 'partial', 'not_run'],
      },
      validationSummary: {
        type: 'string',
        description: hostRegistrationMessage('optionalOneLineValidationOutcome'),
      },
      tests: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            command: { type: 'string', required: true },
            status: { type: 'string', required: true, enum: ['passed', 'failed', 'not_run'] },
            summary: { type: 'string' },
          },
        },
      },
      suggestedCommitMessage: {
        type: 'string',
        required: true,
        description: hostRegistrationMessage('suggestedCommitMessageForTheHumanAcceptanceAction'),
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true },
          state: { type: 'string', required: true },
          reviewId: { type: 'string', required: true },
          revision: { type: 'number', required: true },
          iteration: { type: 'number', required: true },
          changedFiles: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(args, exec) {
      return withHostLanguage(languageForInvocation(exec.agent, ctx), async () => {
        const sessionId = sessionIdOf(exec.agent)
        const target = await module.markReadyForReview(sessionId, {
          summary: args.summary,
          detailsMarkdown: args.details,
          validationStatus: args.validationStatus as WorktreeValidationStatus,
          validationSummary: args.validationSummary,
          tests: (args.tests ?? []).map((test) => ({
            command: test.command,
            status: test.status as 'passed' | 'failed' | 'not_run',
            ...(test.summary ? { summary: test.summary } : {}),
          })),
          suggestedCommitMessage: args.suggestedCommitMessage,
      })
      if (target.delivery?.state !== 'ready_for_review') {
        throw new Error(hostMessage('worktreeDidNotEnterAReviewableState', { p0: target.delivery?.state ?? 'unknown' }))
      }
      return {
        kind: 'worktree_ready_for_review',
        state: target.delivery.state,
        reviewId: target.delivery.review.reviewId,
        revision: target.revision,
        iteration: target.delivery.review.iteration,
        changedFiles: target.delivery.review.changedFiles,
      }
      })
    },
    presentCall: () => ({ card: 'generic', title: hostRegistrationMessage('readyForWorktreeReview'), kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'worktree_deliver',
    description: hostRegistrationMessage('worktreeDeliverDescription'),
    parameters: {
      commitMessage: {
        type: 'string',
        description: hostRegistrationMessage('worktreeDeliverCommitMessage'),
      },
      retention: {
        type: 'string',
        enum: ['cleanup', 'retain_24h', 'retain_3d', 'retain_manual'],
        description: hostRegistrationMessage('worktreeDeliverRetention'),
      },
      report: {
        type: 'string',
        description: hostRegistrationMessage('worktreeDeliverReport'),
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true },
          state: { type: 'string', required: true },
          commitOid: { type: 'string' },
          changedFiles: { type: 'array', required: true, items: { type: 'string' } },
          cleanup: { type: 'string', required: true },
          push: {
            type: 'object',
            additionalProperties: false,
            properties: {
              status: { type: 'string', required: true },
              message: { type: 'string' },
            },
          },
          report: { type: 'string' },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(args, exec) {
      return withHostLanguage(languageForInvocation(exec.agent, ctx), async () => {
        const sessionId = sessionIdOf(exec.agent)
        const current = await module.inspect(sessionId)
        if (!module.isAutoDeliverEnabled()) {
          throw new Error(hostMessage('worktreeDeliverDisabledByAutoDeliver'))
        }
        const deliveryState = current.delivery?.state
        if (deliveryState !== 'working' && deliveryState !== 'ready_for_review') {
          throw new Error(hostMessage('worktreeDeliverNotAllowedInState', { p0: deliveryState ?? 'unknown' }))
        }
        let commitMessage = typeof args?.commitMessage === 'string' ? args.commitMessage.trim() : ''
        let expectedReviewId: string | undefined
        if (deliveryState === 'ready_for_review') {
          expectedReviewId = current.delivery!.review.reviewId
          if (!commitMessage) commitMessage = current.delivery!.review.suggestedCommitMessage.trim()
        }
        if (!commitMessage) {
          throw new Error(hostMessage('worktreeDeliverRequiresCommitMessage'))
        }
        const result = await module.operate({
          sessionId,
          expectedRevision: current.revision,
          action: 'finish',
          commitMessage,
          retention: parseWorktreeRetention(args?.retention),
          ...(expectedReviewId ? { expectedReviewId } : {}),
        })
        if (result.status !== 'finished') {
          const detail = result.status === 'error' ? result.message
            : result.status === 'conflict' ? `${result.code}: ${result.conflictingFiles.join(', ')}`
            : result.status
          throw new Error(hostMessage('worktreeDeliverUnexpectedResult', { p0: detail }))
        }
        return {
          kind: 'worktree_delivered',
          state: result.target.delivery?.state ?? 'unknown',
          ...(result.commitOid ? { commitOid: result.commitOid } : {}),
          changedFiles: result.changedFiles,
          cleanup: result.cleanup,
          ...(result.push ? { push: { status: result.push.status, ...(result.push.message ? { message: result.push.message } : {}) } } : {}),
          ...(typeof args?.report === 'string' && args.report.trim() ? { report: args.report.trim() } : {}),
        }
      })
    },
    presentCall: () => ({ card: 'generic', title: hostRegistrationMessage('deliverWorktreeChangesNow'), kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'worktree_cleanup',
    description: hostRegistrationMessage('worktreeCleanupDescription'),
    parameters: {
      checkoutId: { type: 'string', description: hostRegistrationMessage('worktreeCleanupCheckoutId') },
      expectedRevision: { type: 'number', description: hostRegistrationMessage('worktreeCleanupExpectedRevision') },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true },
          checkoutId: { type: 'string', required: true },
          state: { type: 'string', required: true },
          phase: { type: 'string', required: true },
          revision: { type: 'number', required: true },
          cleanupMessage: { type: 'string' },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(args, exec) {
      return withHostLanguage(languageForInvocation(exec.agent, ctx), async () => {
        const sessionId = sessionIdOf(exec.agent)
        const checkoutId = typeof args?.checkoutId === 'string' ? args.checkoutId.trim() : ''
        const expectedRevision = typeof args?.expectedRevision === 'number' ? Math.floor(args.expectedRevision) : Number.NaN
        if (!checkoutId) throw new Error(hostMessage('worktreeCleanupRequiresCheckoutId'))
        if (!Number.isFinite(expectedRevision)) throw new Error(hostMessage('worktreeCleanupRequiresExpectedRevision'))
        const summary = await module.manageManagedWorktreeForSession(sessionId, {
          checkoutId,
          expectedRevision,
          action: 'cleanup_retained',
        })
        return {
          kind: 'worktree_cleanup',
          checkoutId: summary.checkoutId,
          state: summary.state,
          phase: summary.phase,
          revision: summary.revision,
          ...(summary.cleanupMessage ? { cleanupMessage: summary.cleanupMessage } : {}),
        }
      })
    },
    presentCall: () => ({ card: 'generic', title: hostRegistrationMessage('cleanupFinishedWorktree'), kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'worktree_prune_branches',
    description: hostRegistrationMessage('worktreePruneBranchesDescription'),
    parameters: {
      dryRun: { type: 'boolean', description: hostRegistrationMessage('worktreePruneBranchesDryRun') },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true },
          dryRun: { type: 'boolean', required: true },
          headBranch: { type: 'string' },
          pruned: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                oid: { type: 'string', required: true },
              },
            },
          },
          skipped: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                oid: { type: 'string', required: true },
                reason: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(args, exec) {
      return withHostLanguage(languageForInvocation(exec.agent, ctx), async () => {
        const sessionId = sessionIdOf(exec.agent)
        const result = await module.pruneMergedBranchesForSession(sessionId, { dryRun: args?.dryRun === true })
        return {
          kind: 'worktree_prune_branches',
          dryRun: result.dryRun,
          ...(result.headBranch ? { headBranch: result.headBranch } : {}),
          pruned: result.pruned.map((entry) => ({ name: entry.name, oid: entry.oid })),
          skipped: result.skipped.map((entry) => ({
            name: entry.name,
            oid: entry.oid,
            ...(entry.reason ? { reason: entry.reason } : {}),
          })),
        }
      })
    },
    presentCall: () => ({ card: 'generic', title: hostRegistrationMessage('pruneMergedLocalBranches'), kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'worktree_merge',
    description: hostRegistrationMessage('worktreeMergeDescription'),
    parameters: {
      sourceBranch: { type: 'string', description: hostRegistrationMessage('worktreeMergeSourceBranch') },
      dryRun: { type: 'boolean', description: hostRegistrationMessage('worktreeMergeDryRun') },
      direction: { type: 'string', description: hostRegistrationMessage('worktreeMergeDirection') },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true },
          direction: { type: 'string', required: true },
          dryRun: { type: 'boolean', required: true },
          sourceBranch: { type: 'string', required: true },
          localBranch: { type: 'string' },
          targetBranch: { type: 'string' },
          type: { type: 'string', required: true },
          mergedFiles: { type: 'array', items: { type: 'string' } },
          conflictingFiles: { type: 'array', items: { type: 'string' } },
          conflictDetails: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                file: { type: 'string', required: true },
                diff: { type: 'string', required: true },
              },
            },
          },
          reason: { type: 'string' },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(args, exec) {
      return withHostLanguage(languageForInvocation(exec.agent, ctx), async () => {
        const sessionId = sessionIdOf(exec.agent)
        const sourceBranch = typeof args?.sourceBranch === 'string' ? args.sourceBranch.trim() : ''
        if (!sourceBranch) throw new Error(hostMessage('worktreeMergeSourceBranchRequired'))
        const direction = args?.direction === 'reverse' ? 'reverse' : args?.direction === 'forward' ? 'forward' : undefined
        const result = await module.mergeBranchForSession(sessionId, { sourceBranch, dryRun: args?.dryRun === true, ...(direction ? { direction } : {}) })
        if (result.type === 'failed') throw new Error(result.reason || hostMessage('gitOperationFailedGit', { p0: 'merge', p1: sourceBranch }))
        return {
          kind: 'worktree_merge',
          direction: result.direction,
          dryRun: result.dryRun,
          sourceBranch: result.sourceBranch,
          ...(result.localBranch ? { localBranch: result.localBranch } : {}),
          ...(result.targetBranch ? { targetBranch: result.targetBranch } : {}),
          type: result.type,
          ...(result.mergedFiles ? { mergedFiles: result.mergedFiles } : {}),
          ...(result.conflictingFiles ? { conflictingFiles: result.conflictingFiles } : {}),
          ...(result.conflictDetails ? { conflictDetails: result.conflictDetails } : {}),
          ...(result.reason ? { reason: result.reason } : {}),
        }
      })
    },
    presentCall: () => ({ card: 'generic', title: hostRegistrationMessage('mergeWorktreeBranch'), kind: 'other', rawInput: {} }),
  }))
}
