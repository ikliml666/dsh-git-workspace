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

import type { Context } from '@deepseek-ai/cordis'
import type {
  WorktreeConsoleGitMutationResponse,
  WorktreeConsoleOutcome,
  WorktreeConsoleReturnToLocalRequest,
  WorktreeConsoleReturnToLocalResponse,
} from './console-contract.js'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { SessionCheckoutModule } from './index.js'
import type { WorktreeValidationStatus } from './types.js'
import { DEFAULT_WORKTREE_RETENTION } from './types.js'
import { createSessionWorkingDirectoryPort } from './adapters/working-directory.js'
import type { SessionWorkingDirectoryPort } from './adapters/working-directory.js'

const WORKTREE_RETENTION_VALUES = ['cleanup', 'retain_24h', 'retain_3d', 'retain_manual'] as const

function parseWorktreeRetention(value: unknown): (typeof WORKTREE_RETENTION_VALUES)[number] {
  if (value === undefined) return DEFAULT_WORKTREE_RETENTION
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

/**
 * Restore the Session cwd before an operation that may delete its checkout.
 * Returns a non-null reason when the cwd could NOT be restored; the caller must
 * then abort the removal, otherwise the Session is left standing in a directory
 * that is about to disappear.
 */
async function leaveCheckoutBeforeRemoval(
  port: SessionWorkingDirectoryPort,
  module: SessionCheckoutModule,
  agent: unknown,
  checkoutId: string,
): Promise<string | undefined> {
  try {
    const roots = module.resolveRoots?.(checkoutId)
    if (!roots) return undefined
    await port.leave(agent, roots.managedRoot, roots.localRoot)
    return undefined
  } catch (error) {
    console.warn('[dsh-git-worktree] could not restore the Session cwd before removal:', error)
    return error instanceof Error ? error.message : String(error)
  }
}

/**
 * Enter a checkout (or keep the guidance fallback) after resolving its root.
 * `cwd: undefined` means the host mounts no workingDirectory service, which is
 * a legitimate degradation. A real error is reported through `failure` instead
 * of being folded into that same undefined: after a failed delivery the Session
 * belongs back inside the surviving checkout, and a silent no-op would send
 * every relative-path write into the original repository.
 *
 * The root is read from the ledger first: `resolveManagedRoot` runs a full Git
 * validation under the global lock, and a validation failure (mid-recovery
 * checkout, transient git error) must not strand the Session outside the
 * Worktree it is about to work in. The validation path is only a fallback for
 * modules that cannot answer from the ledger.
 */
async function enterCheckout(
  port: SessionWorkingDirectoryPort,
  module: SessionCheckoutModule,
  agent: unknown,
  checkoutId: string,
): Promise<{ cwd?: string; failure?: string }> {
  try {
    const managedRoot = module.resolveRoots?.(checkoutId)?.managedRoot
      ?? await module.resolveManagedRoot?.(checkoutId)
    if (!managedRoot) return {}
    const cwd = await port.enter(agent, managedRoot)
    return cwd === undefined ? {} : { cwd }
  } catch (error) {
    console.warn('[dsh-git-worktree] could not move this Session into the Worktree:', error)
    return { failure: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Local-checkout branch operations the model shares with the console.
 *
 * The console RPC and this tool must go through the same guard
 * (`assertLocalHeadMutable`): a model-initiated switch moves the Local HEAD that
 * every pending delivery is computed against, so it cannot bypass that check.
 */
export interface WorktreeConsolePort {
  gitSwitchBranch(sessionId: string, branch: string): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitMutationResponse>>
  gitCreateBranchAndSwitch(sessionId: string, branch: string): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitMutationResponse>>
  /**
   * Release a delivered owner back to Local. The callback moves the Session cwd
   * out of the checkout first; the console injects the very same one, so a model
   * call cannot leave the cwd behind in a frozen directory.
   */
  returnToLocal(
    request: WorktreeConsoleReturnToLocalRequest,
    leaveCheckout?: (sessionId: string, managedRoot: string, localRoot: string) => Promise<void>,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsoleReturnToLocalResponse>>
}

/**
 * What the model should do after a refused switch. The console renders the same
 * refusal as a "commit, then switch" button; the model gets the sentence because
 * it has to pick the action itself.
 */
/** 只接受非空字符串的相对路径列表；空列表等价于没传。 */
function parseRelativePaths(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  // 空数组是显式意图（不用项目配置），不能折叠成「没传」。
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(item => item !== '')
}

function switchNextAction(code: string, fallback: string): string {
  switch (code) {
    case 'tracked-changes-would-be-overwritten':
    case 'untracked-changes-would-be-overwritten':
      return hostMessage('worktreeSwitchCommitThenRetry')
    case 'conflicts-present':
      return hostMessage('worktreeSwitchResolveConflictsFirst')
    case 'operation-in-progress':
      return hostMessage('worktreeSwitchOperationInProgress')
    case 'branch-in-other-worktree':
      return hostMessage('worktreeSwitchBranchInOtherWorktree')
    case 'target-branch-not-found':
      return hostMessage('worktreeSwitchTargetBranchMissing')
    case 'invalid-branch-name':
      return hostMessage('worktreeSwitchInvalidBranchName')
    default:
      return fallback
  }
}

/** Register the safe model-facing worktree tools. */
export function registerTools(ctx: Context, module: SessionCheckoutModule, control: WorktreeConsolePort): void {
  // Official parity: the experimental create_worktree bundle ends creation with
  // ctx.workingDirectory.set(agent, path), so the Session really works inside
  // the new checkout. This port reproduces that for a Managed Worktree, and
  // degrades to a no-op when the host does not mount the service.
  const workingDirectory = createSessionWorkingDirectoryPort(ctx)
  ctx.tools.register(defineTool({
    name: 'worktree_create',
    description: hostRegistrationMessage('reserveAUniqueManagedGitWorktreeAndADistinct'),
    parameters: {
      topic: {
        type: 'string',
        description: hostRegistrationMessage('optionalTopicForHumanReadableWorktreeNaming'),
      },
      branch: {
        type: 'string',
        description: hostRegistrationMessage('optionalLocalBranchWhoseCurrentTipBecomesThe'),
      },
      linkDeps: {
        type: 'array',
        items: { type: 'string' },
        description: hostRegistrationMessage('worktreeLinkDepsDescription'),
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
          branch: { type: 'string' },
          sourceSessionId: { type: 'string', required: true },
          cwd: { type: 'string' },
          cwdSelected: { type: 'boolean', required: true },
          cwdError: { type: 'string' },
          linkedDeps: { type: 'array', items: { type: 'string' } },
          linkFailures: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { path: { type: 'string', required: true }, reason: { type: 'string', required: true } },
            },
          },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(args, exec) {
      return withHostLanguage(languageForInvocation(exec.agent, ctx), async () => {
        // 建树走宿主的 worktrees 服务：全机只有一份 `git worktree add` 实现，
        // 目录固定在 `<repo>/.agents/worktrees/<branch>`。本插件随后把结果记进
        // 台账，列表、交付、评审、清理对它一样有效。
        const sourceSessionId = sessionIdOf(exec.agent)
        const targetSessionId = sourceSessionId
        const topic = typeof args?.topic === 'string' && args.topic.trim() ? args.topic.trim() : undefined
        const branch = typeof args?.branch === 'string' && args.branch.trim() ? args.branch.trim() : undefined
        const linkDeps = parseRelativePaths(args?.linkDeps)
        const launch = await module.createOfficialTarget(
          exec.agent,
          topic || branch || linkDeps
            ? {
                ...(topic ? { topic } : {}),
                ...(branch ? { branch } : {}),
                ...(linkDeps ? { linkDeps } : {}),
              }
            : {},
        )
        // Official-mechanism parity: enter the new checkout so relative paths,
        // file tools and subprocesses all resolve inside it. A host without the
        // workingDirectory service keeps the guidance path; a real failure is
        // reported in `cwdError` so the caller is not told the cwd moved when it
        // did not.
        const entered = await enterCheckout(workingDirectory, module, exec.agent, launch.target.checkout.id)
        return {
          kind: 'worktree_target_created',
          checkoutId: launch.target.checkout.id,
          targetSessionId,
          managedRoot: launch.managedRoot,
          phase: launch.target.checkout.phase,
          currentOid: launch.target.current.oid,
          // 创建即建好会话分支：Worktree 不再是 detached HEAD，对话栏的分支标签
          // 与后续交付目标都来自这里。
          ...(launch.target.current.branch ? { branch: launch.target.current.branch } : {}),
          sourceSessionId,
          cwdSelected: entered.cwd !== undefined,
          ...(entered.cwd === undefined ? {} : { cwd: entered.cwd }),
          ...(entered.failure === undefined ? {} : { cwdError: entered.failure }),
          ...(launch.linkResult === undefined
            ? {}
            : { linkedDeps: launch.linkResult.linked, linkFailures: launch.linkResult.failures }),
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
                branch: { type: 'string' },
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
            ...(summary.branch ? { branch: summary.branch } : {}),
            // Omit instead of emitting a present-but-empty key: the host rejects
            // `undefined` here as "not lossless JSON", and null/'' carry no commit.
            ...(summary.commitOid ? { commitOid: summary.commitOid } : {}),
          })),
        }
      })
    },
    presentCall: () => ({ card: 'generic', title: hostRegistrationMessage('listManagedWorktrees'), kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'worktree_begin_next_iteration',
    description: hostRegistrationMessage('whenTheCurrentIsolatedSessionHasBeenDeliveredAnd'),
    parameters: {
      linkDeps: {
        type: 'array',
        items: { type: 'string' },
        description: hostRegistrationMessage('worktreeLinkDepsDescription'),
      },
    },
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
          cwd: { type: 'string' },
          cwdError: { type: 'string' },
          linkedDeps: { type: 'array', items: { type: 'string' } },
          linkFailures: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { path: { type: 'string', required: true }, reason: { type: 'string', required: true } },
            },
          },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(args, exec) {
      return withHostLanguage(languageForInvocation(exec.agent, ctx), async () => {
        const sessionId = sessionIdOf(exec.agent)
        const current = await module.inspect(sessionId)
        const linkDeps = parseRelativePaths(args?.linkDeps)
        const target = linkDeps === undefined
          ? await module.beginNextIteration(sessionId, current.revision)
          : await module.beginNextIteration(sessionId, current.revision, linkDeps)
        if (target.delivery?.state !== 'working') {
          throw new Error(hostMessage('theNextWorktreeIterationDidNotEnterWorkingState', { p0: target.delivery?.state ?? 'unknown' }))
        }
        // The previous iteration cleaned this cwd up, so the host restored the
        // original project. Re-enter the recreated checkout (official parity);
        // a failure is reported rather than silently leaving the Session in the
        // Local boundary while the iteration is already running.
        const entered = await enterCheckout(workingDirectory, module, exec.agent, target.checkout.id)
        return {
          kind: 'worktree_next_iteration_started',
          checkoutId: target.checkout.id,
          iteration: target.delivery.iteration,
          phase: target.checkout.phase,
          currentOid: target.current.oid,
          sessionId,
          ...(entered.cwd === undefined ? {} : { cwd: entered.cwd }),
          ...(entered.failure === undefined ? {} : { cwdError: entered.failure }),
          ...(target.linkResult === undefined
            ? {}
            : { linkedDeps: target.linkResult.linked, linkFailures: target.linkResult.failures }),
        }
      })
    },
    presentCall: () => ({ card: 'generic', title: hostRegistrationMessage('startNextWorktreeIteration'), kind: 'other', rawInput: {} }),
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
      preservePaths: {
        type: 'array',
        items: { type: 'string' },
        description: hostRegistrationMessage('worktreePreservePathsDescription'),
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
          branch: { type: 'string' },
          changedFiles: { type: 'array', required: true, items: { type: 'string' } },
          preservedFiles: { type: 'array', items: { type: 'string' } },
          droppedIgnoredFiles: { type: 'array', items: { type: 'string' } },
          cleanup: { type: 'string', required: true },
          /** 交付后会话所在的目录（通常在 Local）。 */
          cwd: { type: 'string' },
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
        // Delivery may remove the checkout. Move the Session out of it first so
        // no live cwd is left pointing at a deleted directory; when that move
        // fails the removal must not go ahead.
        const leaveFailure = await leaveCheckoutBeforeRemoval(workingDirectory, module, exec.agent, current.checkout.id)
        if (leaveFailure !== undefined) {
          throw new Error(hostMessage('worktreeCwdCouldNotBeRestoredBeforeRemoval', { p0: leaveFailure }))
        }
        const preservePaths = parseRelativePaths(args?.preservePaths)
        const result = await module.operate({
          sessionId,
          expectedRevision: current.revision,
          action: 'finish',
          commitMessage,
          retention: parseWorktreeRetention(args?.retention),
          ...(expectedReviewId ? { expectedReviewId } : {}),
          ...(preservePaths ? { preservePaths } : {}),
        })
        if (result.status !== 'finished') {
          // The checkout survived the failed delivery, so the Session belongs
          // back inside it: leaving it in the Local boundary would send every
          // relative-path write into the original repository. When that move
          // back fails the caller must hear both facts, not just the delivery
          // error.
          const entered = await enterCheckout(workingDirectory, module, exec.agent, current.checkout.id)
          const detail = result.status === 'error' ? result.message
            : result.status === 'conflict' ? `${result.code}: ${result.conflictingFiles.join(', ')}`
            : result.status
          if (entered.failure !== undefined) {
            throw new Error(hostMessage('worktreeCwdCouldNotBeRestoredAfterFailedDelivery', { p0: detail, p1: entered.failure }))
          }
          throw new Error(hostMessage('worktreeDeliverUnexpectedResult', { p0: detail }))
        }
        // 交付前已把会话移回 Local；把这件事告诉模型，否则它会以为还站在树里。
        const deliveredCwd = workingDirectory.current(exec.agent)
        return {
          kind: 'worktree_delivered',
          state: result.target.delivery?.state ?? 'unknown',
          ...(result.commitOid ? { commitOid: result.commitOid } : {}),
          // 交付提交落在会话分支上（Local 未被写），把分支名交回调用方用于后续合并。
          ...(result.branch ? { branch: result.branch } : {}),
          changedFiles: result.changedFiles,
          ...(result.preservedFiles === undefined ? {} : { preservedFiles: result.preservedFiles }),
          ...(result.droppedIgnoredFiles === undefined ? {} : { droppedIgnoredFiles: result.droppedIgnoredFiles }),
          cleanup: result.cleanup,
          ...(result.push ? { push: { status: result.push.status, ...(result.push.message ? { message: result.push.message } : {}) } } : {}),
          ...(typeof args?.report === 'string' && args.report.trim() ? { report: args.report.trim() } : {}),
          ...(deliveredCwd === undefined ? {} : { cwd: deliveredCwd }),
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
          /** 清理后会话所在的目录（通常在 Local）。 */
          cwd: { type: 'string' },
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
        // The checkout may be removed here; leave it first (session cwd safety).
        const leaveFailure = await leaveCheckoutBeforeRemoval(workingDirectory, module, exec.agent, checkoutId)
        if (leaveFailure !== undefined) {
          throw new Error(hostMessage('worktreeCwdCouldNotBeRestoredBeforeRemoval', { p0: leaveFailure }))
        }
        const summary = await module.manageManagedWorktreeForSession(sessionId, {
          checkoutId,
          expectedRevision,
          action: 'cleanup_retained',
        })
        const cleanedCwd = workingDirectory.current(exec.agent)
        return {
          kind: 'worktree_cleanup',
          checkoutId: summary.checkoutId,
          state: summary.state,
          phase: summary.phase,
          revision: summary.revision,
          ...(summary.cleanupMessage ? { cleanupMessage: summary.cleanupMessage } : {}),
          ...(cleanedCwd === undefined ? {} : { cwd: cleanedCwd }),
        }
      })
    },
    presentCall: () => ({ card: 'generic', title: hostRegistrationMessage('cleanupFinishedWorktree'), kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'worktree_switch_branch',
    description: hostRegistrationMessage('worktreeSwitchBranchDescription'),
    parameters: {
      branch: {
        type: 'string',
        description: hostRegistrationMessage('worktreeSwitchBranchBranch'),
      },
      create: {
        type: 'boolean',
        description: hostRegistrationMessage('worktreeSwitchBranchCreate'),
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true },
          branch: { type: 'string', required: true },
          created: { type: 'boolean', required: true },
          code: { type: 'string' },
          paths: { type: 'array', items: { type: 'string' } },
          nextAction: { type: 'string' },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(args, exec) {
      return withHostLanguage(languageForInvocation(exec.agent, ctx), async () => {
        const sessionId = sessionIdOf(exec.agent)
        const branch = typeof args?.branch === 'string' ? args.branch.trim() : ''
        if (!branch) throw new Error(hostMessage('worktreeSwitchBranchRequiresBranch'))
        const create = args?.create === true
        // 与控制面同一条守卫：切分支移动的是 Local HEAD，而它正是所有待交付
        // apply 的基线，模型不能绕过这条检查。
        const result = create
          ? await control.gitCreateBranchAndSwitch(sessionId, branch)
          : await control.gitSwitchBranch(sessionId, branch)
        if (result.ok) return { kind: 'worktree_branch_switched', branch: result.value.branch, created: create }
        // 拒绝是正常答案，不是异常：模型要靠 code/paths 决定「先提交再切」还是换目标分支。
        const issue = result.error.switchIssue
        return {
          kind: 'worktree_branch_switch_blocked',
          branch,
          created: create,
          code: issue?.code ?? result.error.code,
          ...(issue !== undefined && issue.paths.length > 0 ? { paths: issue.paths } : {}),
          nextAction: switchNextAction(issue?.code ?? result.error.code, result.error.message),
        }
      })
    },
    presentCall: () => ({ card: 'generic', title: hostRegistrationMessage('switchBranch'), kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'worktree_return_to_local',
    description: hostRegistrationMessage('worktreeReturnToLocalDescription'),
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true },
          state: { type: 'string', required: true },
          branch: { type: 'string' },
          cwd: { type: 'string' },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(_args, exec) {
      return withHostLanguage(languageForInvocation(exec.agent, ctx), async () => {
        const sessionId = sessionIdOf(exec.agent)
        let checkoutId: string | null = null
        try {
          const current = await module.inspect(sessionId)
          checkoutId = current.checkout.kind === 'isolated' ? current.checkout.id : null
        } catch (error) {
          // `target_unselected` 就是「还没绑到任何目标」，等价于已经在 Local。
          // 其它失败必须照原样抛出去，不能把探测失败说成「已在 Local」。
          const code = (error as { code?: string } | undefined)?.code
          if (code !== 'target_unselected') throw error
        }
        const settled = workingDirectory.current(exec.agent)
        if (checkoutId === null) {
          return {
            kind: 'worktree_returned_to_local',
            state: 'local',
            ...(settled === undefined ? {} : { cwd: settled }),
          }
        }
        // 与控制面同一条路径：先移出检出、再解绑。未交付的 worktree 在这里被拒绝。
        const result = await control.returnToLocal(
          { sessionId, checkoutId },
          async (_targetSessionId, managedRoot, localRoot) => {
            await workingDirectory.leave(exec.agent, managedRoot, localRoot)
          },
        )
        if (!result.ok) throw new Error(result.error.message)
        const moved = workingDirectory.current(exec.agent)
        return {
          kind: 'worktree_returned_to_local',
          state: 'local',
          ...(result.value.target.currentBranch ? { branch: result.value.target.currentBranch } : {}),
          ...(moved === undefined ? {} : { cwd: moved }),
        }
      })
    },
    presentCall: () => ({ card: 'generic', title: hostRegistrationMessage('worktreeReturnedToLocal'), kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'worktree_prune_branches',
    description: hostRegistrationMessage('worktreePruneBranchesDescription'),
    parameters: {
      dryRun: { type: 'boolean', description: hostRegistrationMessage('worktreePruneBranchesDryRun') },
      olderThanDays: { type: 'number', description: hostRegistrationMessage('worktreePruneBranchesOlderThanDays') },
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
        const olderThanDays = args?.olderThanDays
        const result = await module.pruneMergedBranchesForSession(sessionId, {
          dryRun: args?.dryRun === true,
          ...(typeof olderThanDays === 'number' && Number.isFinite(olderThanDays) && olderThanDays > 0
            ? { olderThanDays: Math.floor(olderThanDays) }
            : {}),
        })
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
          nextAction: { type: 'string' },
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
          // 合并本身不移动会话；模型可能还站在树里，这里明确给出回 Local 的入口。
          nextAction: hostMessage('worktreeMergeThenReturnToLocal'),
        }
      })
    },
    presentCall: () => ({ card: 'generic', title: hostRegistrationMessage('mergeWorktreeBranch'), kind: 'other', rawInput: {} }),
  }))
}
