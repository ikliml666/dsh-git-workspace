import { hostMessage, withHostLanguage, languageForInvocation } from './i18n/host.js'
import { hostRegistrationMessage } from './i18n/host-messages.js'
/**
 * `/worktree` human command surface. Destructive verbs are intentionally
 * user-initiated; model tools stop at Ready for Review.
 * @module dsh-git-worktree/commands
 */

import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/dsh-commands'
import type { SessionCheckoutModule } from './index.js'
import { createSessionWorkingDirectoryPort } from './adapters/working-directory.js'
import type { SessionTargetView, WorktreeRetentionMode } from './types.js'
import { DEFAULT_WORKTREE_RETENTION } from './types.js'

function targetText(target: SessionTargetView): string {
  const lines = [
    hostMessage('checkoutPhase', { p0: target.checkout.label, p1: target.checkout.kind, p2: target.checkout.phase }),
    hostMessage('commandDirty', { value: String(target.dirty) }),
    hostMessage('commandCurrent', { branch: target.current.branch ?? hostMessage('commandDetached'), oid: target.current.oid.slice(0, 7) }),
  ]
  if (target.delivery) lines.push(hostMessage('commandDelivery', { state: target.delivery.state }))
  return lines.join('\n')
}

function sessionIdOf(agent: unknown): string {
  const session = (agent as { session?: { id: unknown } } | undefined)?.session
  if (!session || typeof session.id !== 'string') throw new Error(hostMessage('worktreeCanOnlyBeUsedInADSHAgent'))
  return session.id
}

const RETENTIONS = new Set<WorktreeRetentionMode>(['cleanup', 'retain_24h', 'retain_3d', 'retain_manual'])
const usage = () => hostMessage('usageWorktreeStatusListContinueNextFinalizeReviewIdRevision')

function finishedText(result: Extract<Awaited<ReturnType<SessionCheckoutModule['operate']>>, { status: 'finished' }>): string {
  const base = hostMessage('finishedCommittedFileSAsCleanup', { p0: result.changedFiles.length, p1: result.commitOid?.slice(0, 7) ?? hostMessage('commandNoOp'), p2: result.cleanup })
  if (!result.push || result.push.status === 'pushed') {
    return result.push ? `${base} ${hostMessage('autoPushOutcome', { p0: hostMessage('autoPushPushed') })}` : base
  }
  return `${base} ${hostMessage('autoPushOutcome', { p0: result.push.status === 'skipped' ? result.push.message ?? '' : hostMessage('autoPushFailed', { p0: result.push.message ?? '' }) })}`
}

/** Register the `/worktree` command. */
export function registerWorktreeCommand(ctx: Context, module: SessionCheckoutModule): void {
  // Delivery and discard may remove the checkout. Now that worktree_create really
  // moves the Session into it (official ctx.workingDirectory.set parity), the
  // command must step back out first or the Session is left in a deleted cwd.
  const workingDirectory = createSessionWorkingDirectoryPort(ctx)
  // A failed leave MUST abort the removal: going ahead would leave the Session
  // cwd pointing at a directory that no longer exists.
  const leaveCheckout = async (agent: unknown, checkoutId: string): Promise<string | undefined> => {
    try {
      const roots = module.resolveRoots?.(checkoutId)
      if (!roots) return undefined
      await workingDirectory.leave(agent, roots.managedRoot, roots.localRoot)
      return undefined
    } catch (error) {
      console.warn('[dsh-git-worktree] could not restore the Session cwd before removal:', error)
      return error instanceof Error ? error.message : String(error)
    }
  }
  // `cwd: undefined` = the host mounts no workingDirectory service (legitimate);
  // a real failure travels in `failure` so the command can report it instead of
  // claiming the Session works inside a Worktree it never entered.
  const enterCheckout = async (agent: unknown, checkoutId: string): Promise<{ cwd?: string; failure?: string }> => {
    try {
      const managedRoot = module.resolveRoots?.(checkoutId)?.managedRoot
        ?? await module.resolveManagedRoot?.(checkoutId)
      if (!managedRoot) return {}
      const cwd = await workingDirectory.enter(agent, managedRoot)
      return cwd === undefined ? {} : { cwd }
    } catch (error) {
      console.warn('[dsh-git-worktree] could not move this Session into the Worktree:', error)
      return { failure: error instanceof Error ? error.message : String(error) }
    }
  }
  // A failed move back into the surviving checkout must reach the user: the
  // Session is now standing in the Local boundary, where relative-path writes
  // hit the original repository.
  const enterNote = (failure: string | undefined): string =>
    failure === undefined ? '' : `\n${hostMessage('worktreeCwdCouldNotBeEntered', { p0: failure })}`
  ctx.commands.register({
    name: 'worktree',
    description: hostRegistrationMessage('inspectAndExplicitlyAcceptManagedWorktreeDelivery'),
    input: { hint: hostRegistrationMessage('statusListContinueNextFinalizeRetentionFinishMessageDiscard') },
    handler: async (invocation) => withHostLanguage(languageForInvocation(invocation.agent, ctx), async () => {
      const rawInput = invocation.rawInput.trim()
      const tokens = rawInput.split(/\s+/u).filter(Boolean)
      const verb = tokens[0] ?? 'status'
      const sessionId = sessionIdOf(invocation.agent)
      try {
        switch (verb) {
          case 'status': {
            return { kind: 'success', text: targetText(await module.inspect(sessionId)) }
          }
          case 'list': {
            const summaries = await module.listManagedWorktreesForSession(sessionId)
            if (summaries.length === 0) return { kind: 'success', text: hostMessage('noManagedWorktreesVisibleToThisSession') }
            return {
              kind: 'success',
              text: summaries.map((summary) => (
                `${summary.checkoutId}  ${summary.project.name}  i${summary.iteration}  ${summary.state}/${summary.phase}  ${hostMessage('commandDirty', { value: String(summary.dirty) })}`
              )).join('\n'),
            }
          }
          case 'continue': {
            const current = await module.inspect(sessionId)
            if (current.delivery?.state !== 'ready_for_review') {
              return { kind: 'error', text: hostMessage('theCurrentWorktreeHasNoUnsyncedReadyForReview') }
            }
            const target = await module.resumeRevision(
              sessionId,
              current.revision,
              current.delivery.review.reviewId,
            )
            const iteration = target.delivery?.state === 'working' ? target.delivery.iteration : 0
            return { kind: 'success', text: hostMessage('resumedWorktreeIterationLocalWasNotModified', { p0: iteration }) }
          }
          case 'next': {
            const current = await module.inspect(sessionId)
            const target = await module.beginNextIteration(sessionId, current.revision)
            // The recreated checkout is the Session's cwd again (official parity).
            const entered = await enterCheckout(invocation.agent, target.checkout.id)
            const iteration = target.delivery?.state === 'working' ? target.delivery.iteration : 0
            const started = hostMessage('startedWorktreeIterationInTheCurrentSession', { p0: iteration })
            return {
              kind: 'success',
              text: entered.failure !== undefined
                ? `${started}\n${hostMessage('worktreeCwdCouldNotBeEntered', { p0: entered.failure })}`
                : `${started}${entered.cwd ? `\n${entered.cwd}` : ''}`,
            }
          }
          case 'finalize': {
            const hasReviewIdentity = tokens[1] !== undefined && !RETENTIONS.has(tokens[1] as WorktreeRetentionMode)
            const expectedReviewId = hasReviewIdentity ? tokens[1] : undefined
            const parsedRevision = hasReviewIdentity ? Number(tokens[2]) : undefined
            const retention = (hasReviewIdentity ? tokens[3] : tokens[1] ?? DEFAULT_WORKTREE_RETENTION) as WorktreeRetentionMode
            if (!RETENTIONS.has(retention) || (hasReviewIdentity && (!expectedReviewId || !Number.isSafeInteger(parsedRevision)))) {
              return { kind: 'error', text: usage() }
            }
            const target = await module.inspect(sessionId)
            if (target.delivery?.state !== 'ready_for_review') {
              return { kind: 'error', text: hostMessage('theCurrentWorktreeIsNotReadyForReviewAnd') }
            }
            if (expectedReviewId && (
              target.delivery.review.reviewId !== expectedReviewId
              || target.revision !== parsedRevision
            )) {
              return { kind: 'error', text: hostMessage('thisReviewCardHasExpiredConfirmTheLatestReady') }
            }
            const leaveFailure = await leaveCheckout(invocation.agent, target.checkout.id)
            if (leaveFailure !== undefined) {
              return { kind: 'error', text: hostMessage('worktreeCwdCouldNotBeRestoredBeforeRemoval', { p0: leaveFailure }) }
            }
            const result = await module.operate({
              action: 'finish',
              sessionId,
              expectedRevision: parsedRevision ?? target.revision,
              commitMessage: target.delivery.review.suggestedCommitMessage,
              retention,
              ...(expectedReviewId ? { expectedReviewId } : {}),
            })
            if (result.status === 'finished') return { kind: 'success', text: finishedText(result) }
            // The checkout outlived the failed finish: put the Session back in it.
            const back = await enterCheckout(invocation.agent, target.checkout.id)
            if (result.status === 'conflict') {
              return { kind: 'error', text: `${hostMessage('conflictNLocalHEADSyncAndResolveConflictsInWorktree', { p0: result.conflictingFiles.join('、'), p1: result.localHeadOid.slice(0, 7) })}${enterNote(back.failure)}` }
            }
            if (result.status === 'error') return { kind: 'error', text: `${result.code}: ${result.message}${enterNote(back.failure)}` }
            return { kind: 'error', text: `${hostMessage('finalizeDidNotReturnTheExpectedResult')}${enterNote(back.failure)}` }
          }
          case 'finish': {
            const commitMessage = rawInput.slice(verb.length).trim()
            if (!commitMessage) return { kind: 'error', text: usage() }
            const target = await module.inspect(sessionId)
            const leaveFailure = await leaveCheckout(invocation.agent, target.checkout.id)
            if (leaveFailure !== undefined) {
              return { kind: 'error', text: hostMessage('worktreeCwdCouldNotBeRestoredBeforeRemoval', { p0: leaveFailure }) }
            }
            const result = await module.operate({
              action: 'finish',
              sessionId,
              expectedRevision: target.revision,
              commitMessage,
            })
            if (result.status === 'finished') return { kind: 'success', text: finishedText(result) }
            const back = await enterCheckout(invocation.agent, target.checkout.id)
            if (result.status === 'conflict') return { kind: 'error', text: `${hostMessage('commandConflict', { files: result.conflictingFiles.join('、') })}${enterNote(back.failure)}` }
            if (result.status === 'error') return { kind: 'error', text: `${result.code}: ${result.message}${enterNote(back.failure)}` }
            return { kind: 'error', text: `${hostMessage('finishDidNotReturnTheExpectedResult')}${enterNote(back.failure)}` }
          }
          case 'discard': {
            const target = await module.inspect(sessionId)
            const leaveFailure = await leaveCheckout(invocation.agent, target.checkout.id)
            if (leaveFailure !== undefined) {
              return { kind: 'error', text: hostMessage('worktreeCwdCouldNotBeRestoredBeforeRemoval', { p0: leaveFailure }) }
            }
            const result = await module.operate({
              action: 'discard',
              sessionId,
              expectedRevision: target.revision,
              confirmDirty: true,
              ...(target.delivery?.state === 'preview_active' ? { rollbackPreview: true } : {}),
            })
            // A failed discard keeps the checkout; return the Session into it.
            const back = result.status === 'discarded' ? {} : await enterCheckout(invocation.agent, target.checkout.id)
            return result.status === 'discarded'
              ? { kind: 'success', text: hostMessage('worktreeDiscardedThisSessionTargetIsNoLongerAvailable') }
              : result.status === 'error'
                ? { kind: 'error', text: `${result.code}: ${result.message}${enterNote(back.failure)}` }
                : { kind: 'error', text: `${hostMessage('discardDidNotReturnTheExpectedResult')}${enterNote(back.failure)}` }
          }
          case 'remove': {
            const checkoutId = tokens[1]
            if (!checkoutId) return { kind: 'error', text: usage() }
            const summaries = await module.listManagedWorktreesForSession(sessionId, { checkoutId })
            const summary = summaries[0]
            if (!summary) return { kind: 'error', text: hostMessage('noManagedWorktreeVisibleToThisSession', { p0: checkoutId }) }
            const leaveFailure = await leaveCheckout(invocation.agent, checkoutId)
            if (leaveFailure !== undefined) {
              return { kind: 'error', text: hostMessage('worktreeCwdCouldNotBeRestoredBeforeRemoval', { p0: leaveFailure }) }
            }
            await module.manageManagedWorktreeForSession(sessionId, {
              checkoutId,
              expectedRevision: summary.revision,
              action: 'discard',
              confirmDirty: true,
              ...(summary.state === 'preview_active' ? { rollbackPreview: true } : {}),
            })
            return { kind: 'success', text: hostMessage('removedWorktree', { p0: checkoutId }) }
          }
          default:
            return { kind: 'error', text: hostMessage('unknownVerb', { p0: JSON.stringify(verb), p1: usage() }) }
        }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    }),
  })
}
