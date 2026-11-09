import { createTranslator, normalizeLanguage, type Language } from '../../i18n/core.js'
import { transportMessages } from '../../i18n/transport-messages.js'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  WorktreeConsoleAbandonedListResponse,
  WorktreeConsoleAdapter,
  WorktreeConsoleCurrentResponse,
  WorktreeConsoleGitGraphResponse,
  WorktreeConsoleGitCommitLocalResponse,
  WorktreeConsoleGitMutationResponse,
  WorktreeConsoleGitOverviewResponse,
  WorktreeConsoleGitPruneResponse,
  WorktreeConsoleGitTagListResponse,
  WorktreeConsoleGitTagMutationResponse,
  WorktreeConsoleInspectResponse,
  WorktreeConsoleListResponse,
  WorktreeConsoleMutationResponse,
  WorktreeConsoleOutcome,
  WorktreeConsoleRestoreAbandonedResponse,
  WorktreeConsoleReturnToLocalResponse,
  WorktreeConsoleCreateWorktreeResponse,
  WorktreeSidebarTopologyResponse,
} from '../../console-contract.js'
import type { GitWorktreeRemote } from '../../console-remote/remote.js'
import { WORKTREE_CONSOLE_DESCRIPTORS } from '../../console-remote/descriptors.js'

function transport<T>(message: string): WorktreeConsoleOutcome<T> {
  return { ok: false, error: { code: 'transport_unavailable', message } }
}

function malformed<T>(method: string, locale: Language): WorktreeConsoleOutcome<T> {
  return { ok: false, error: { code: 'malformed_response', message: createTranslator(transportMessages, locale)('malformed', { method }) } }
}

function messageOf(value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'object' && value !== null && 'message' in value) return String(value.message)
  return String(value)
}

function isCodecRejection(value: unknown): boolean {
  const message = messageOf(value)
  return message.includes('rejected "') || message.includes('返回了不符合 strict contract')
}

/**
 * The Web RPC carrier has no timeout: a request whose server-side handler
 * stalls (binding-lock queue, hung git) would pend forever and freeze the
 * calling UI in its pending state. Fail the client side instead; server work
 * keeps running and mutating calls stay safe to retry.
 */
const FAST_TIMEOUT_MS = 30_000
const SLOW_TIMEOUT_MS = 180_000
// list/preflight 全量重算（多记录时 20+ 次 git spawn）可能逼近 30s，放 SLOW
// 档；其余快路径方法保持 30s。
const FAST_METHODS = new Set([
  'sidebarTopology', 'current', 'inspect',
  'previewRecoveryPreflight',
  'gitOverview', 'gitGraph',
  'listAbandoned',
])

function timeoutOutcome<T>(method: string, locale: Language, timeoutMs: number): WorktreeConsoleOutcome<T> {
  return {
    ok: false,
    error: {
      code: 'timeout',
      message: createTranslator(transportMessages, locale)('invokeTimeout', {
        method,
        seconds: Math.round(timeoutMs / 1000),
      }),
    },
  }
}

export function createWorktreeConsoleRemoteAdapter(remote: GitWorktreeRemote, getLanguage: () => Language = () => 'zh'): WorktreeConsoleAdapter {
  const descriptors = new Map(WORKTREE_CONSOLE_DESCRIPTORS.map(descriptor => [descriptor.method, descriptor]))

  async function invoke<T>(method: string, call: (locale: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<T>>>): Promise<WorktreeConsoleOutcome<T>> {
    const locale = normalizeLanguage(getLanguage())
    const timeoutMs = FAST_METHODS.has(method) ? FAST_TIMEOUT_MS : SLOW_TIMEOUT_MS
    let carrier: RemoteResult<WorktreeConsoleOutcome<T>> | { timedOut: true }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      carrier = await Promise.race([
        call(locale),
        new Promise<{ timedOut: true }>(resolve => {
          timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs)
        }),
      ])
    } catch (error) {
      globalThis.clearTimeout(timer)
      return isCodecRejection(error) ? malformed(method, locale) : transport(messageOf(error))
    }
    globalThis.clearTimeout(timer)
    if (carrier !== null && typeof carrier === 'object' && 'timedOut' in carrier) {
      return timeoutOutcome(method, locale, timeoutMs)
    }
    if (typeof carrier !== 'object' || carrier === null || typeof carrier.ok !== 'boolean') return malformed(method, locale)
    if (!carrier.ok) return isCodecRejection(carrier.error) ? malformed(method, locale) : transport(carrier.error.message)
    const descriptor = descriptors.get(method)
    if (descriptor?.result.mode !== 'strict') return malformed(method, locale)
    try {
      return descriptor.result.create().parse(carrier.value) as WorktreeConsoleOutcome<T>
    } catch {
      return malformed(method, locale)
    }
  }

  return {
    sidebarTopology: () => invoke<WorktreeSidebarTopologyResponse>('sidebarTopology', locale => remote.sidebarTopology(locale)),
    current: request => invoke<WorktreeConsoleCurrentResponse>('current', locale => remote.current(request.sessionId, locale)),
    list: request => invoke<WorktreeConsoleListResponse>('list', locale => remote.list(request.sessionId, request.needsAttention, request.includeDelivered, locale)),
    initializeProject: request => invoke<boolean>('initProject', locale => remote.initProject(request.sourceSessionId, locale)),
    inspect: request => invoke<WorktreeConsoleInspectResponse>('inspect', locale => remote.inspect(request.sessionId, request.checkoutId, locale)),
    discard: request => invoke<WorktreeConsoleMutationResponse>('discard', locale => remote.discard(request.sessionId, request.checkoutId, request.expectedRevision, request.confirmDirty, request.rollbackPreview, locale)),
    deliver: request => invoke<WorktreeConsoleMutationResponse>('deliver', locale => remote.deliver(request.sessionId, request.checkoutId, request.expectedRevision, request.commitMessage, request.retention, locale)),
    setRetention: request => invoke<WorktreeConsoleMutationResponse>('setRetention', locale => remote.setRetention(request.sessionId, request.checkoutId, request.expectedRevision, request.retention, locale)),
    setPermanent: request => invoke<WorktreeConsoleMutationResponse>('setPermanent', locale => remote.setPermanent(request.sessionId, request.checkoutId, request.expectedRevision, request.permanent, locale)),
    retryCleanup: request => invoke<WorktreeConsoleMutationResponse>('retryCleanup', locale => remote.retryCleanup(request.sessionId, request.checkoutId, request.expectedRevision, request.discardPostDeliveryChanges, locale)),
    beginNextIteration: request => invoke<WorktreeConsoleMutationResponse>('beginNextIteration', locale => remote.beginNextIteration(request.sessionId, request.checkoutId, request.expectedRevision, locale)),
    returnToLocal: request => invoke<WorktreeConsoleReturnToLocalResponse>('returnToLocal', locale => remote.returnToLocal(request.sessionId, request.checkoutId, locale)),
    createWorktree: request => invoke<WorktreeConsoleCreateWorktreeResponse>('createWorktree', locale => remote.createWorktree(request.sessionId, request.from, locale)),
    clearSidebarBadge: request => invoke<WorktreeConsoleMutationResponse>('clearSidebarBadge', locale => remote.clearSidebarBadge(request.sessionId, request.checkoutId, request.expectedRevision, locale)),
    gitOverview: sessionId => invoke<WorktreeConsoleGitOverviewResponse>('gitOverview', locale => remote.gitOverview(sessionId, locale)),
    gitGraph: (sessionId, limit) => invoke<WorktreeConsoleGitGraphResponse>('gitGraph', locale => remote.gitGraph(sessionId, limit, locale)),
    gitCreateBranch: (sessionId, name) => invoke<WorktreeConsoleGitMutationResponse>('gitCreateBranch', locale => remote.gitCreateBranch(sessionId, name, locale)),
    gitSwitchBranch: (sessionId, branch) => invoke<WorktreeConsoleGitMutationResponse>('gitSwitchBranch', locale => remote.gitSwitchBranch(sessionId, branch, locale)),
    gitCommitLocalChanges: request => invoke<WorktreeConsoleGitCommitLocalResponse>('gitCommitLocalChanges', locale => remote.gitCommitLocalChanges(request.sessionId, request.message, locale)),
    gitPruneMergedBranches: (sessionId, dryRun) => invoke<WorktreeConsoleGitPruneResponse>('gitPruneMergedBranches', locale => remote.gitPruneMergedBranches(sessionId, dryRun, locale)),
    gitListTags: sessionId => invoke<WorktreeConsoleGitTagListResponse>('gitListTags', locale => remote.gitListTags(sessionId, locale)),
    gitCreateTag: request => invoke<WorktreeConsoleGitTagMutationResponse>('gitCreateTag', locale => remote.gitCreateTag(request.sessionId, request.name, request.message, request.target, request.push, locale)),
    gitDeleteTag: request => invoke<WorktreeConsoleGitTagMutationResponse>('gitDeleteTag', locale => remote.gitDeleteTag(request.sessionId, request.name, request.remote, locale)),
    gitPushTag: request => invoke<WorktreeConsoleGitTagMutationResponse>('gitPushTag', locale => remote.gitPushTag(request.sessionId, request.name, locale)),
    listAbandoned: request => invoke<WorktreeConsoleAbandonedListResponse>('listAbandoned', locale => remote.listAbandoned(request.sessionId, locale)),
    restoreAbandoned: request => invoke<WorktreeConsoleRestoreAbandonedResponse>('restoreAbandoned', locale => remote.restoreAbandoned(request.sessionId, request.checkoutId, locale)),
  }
}
