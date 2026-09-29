import { ReviewIcon } from '../review-console/ReviewIcon.js'
import { useClientTranslator, defaultClientTranslator, type ClientTranslator } from '../i18n.js'
import { useEffect, useRef, useState } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorktreeConsoleAdapter, WorktreeConsoleTargetDetails } from '../../console-contract.js'
import type { PreSessionDraftActions, PreSessionDraftState, PreparePreSessionWorktreeRequest } from './controller.js'

export interface PreSessionWorktreeToggleProps {
  sessionId: string
  session: { composerPhase: string }
  input: PreSessionDraftState
  inputActions: PreSessionDraftActions
  adapter: WorktreeConsoleAdapter
  controller: { prepare(request: PreparePreSessionWorktreeRequest): Promise<WorktreeConsoleTargetDetails> }
}

type LoadState = 'loading' | 'idle' | 'preparing' | 'error' | 'unsupported'

// Last known target per (adapter, session): revisiting a Session renders it
// immediately and refreshes in the background instead of re-showing the
// loading pill. Keyed by adapter so a reloaded plugin or a fresh test fixture
// starts cold.
const lastTargets = new WeakMap<WorktreeConsoleAdapter, Map<string, WorktreeConsoleTargetDetails>>()

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

function snapshotInput(input: PreSessionDraftState): PreSessionDraftState {
  return { ...input, imageIds: [...input.imageIds], occurrences: [...input.occurrences] }
}

function confirmationDescription(input: PreSessionDraftState, t: ClientTranslator = defaultClientTranslator): string {
  const attachmentText = input.imageIds.length === 1 ? t('1.attachment') : t('attachments', { p0: input.imageIds.length })
  if (input.draft.trim() !== '' && input.imageIds.length > 0) return t('the.current.input.and.will.move.to.the', { p0: attachmentText })
  if (input.imageIds.length > 0) return t('will.move.to.the.new.worktree.session', { p0: attachmentText })
  if (input.draft.trim() !== '') return t('the.current.input.will.move.to.the.new')
  return t('a.new.worktree.session.will.be.created.the')
}

/** Blank-session directory menu mounted in Harness's public composer tool row. */
export function PreSessionWorktreeToggle({ sessionId, session, input, inputActions, adapter, controller }: PreSessionWorktreeToggleProps) {
  const t = useClientTranslator()
  const [target, setTarget] = useState<WorktreeConsoleTargetDetails | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<{ input: PreSessionDraftState; kind: 'ready' | 'empty' | 'files'; token?: string } | null>(null)
  const [initConfirm, setInitConfirm] = useState(false)
  const latestInput = useRef(input)
  latestInput.current = input
  const blank = session.composerPhase === 'blank'
  // Invalidate at render: an old continuation must never navigate or clear
  // the newly selected Session's draft, even before effect cleanup runs.
  const scopeRef = useRef({ sessionId, adapter, blank, alive: true, busy: false })
  if (scopeRef.current.sessionId !== sessionId || scopeRef.current.adapter !== adapter || scopeRef.current.blank !== blank) {
    scopeRef.current.alive = false
    scopeRef.current = { sessionId, adapter, blank, alive: true, busy: false }
  }
  const scope = scopeRef.current
  const isCurrent = (): boolean => scope.alive && scopeRef.current === scope

  const targetRef = useRef(target)
  targetRef.current = target

  const refreshCurrent = async (options?: { silent?: boolean }): Promise<void> => {
    if (scope.busy) return
    scope.busy = true
    const silent = options?.silent === true
    if (!silent) { setState('loading'); setError(null) }
    try {
      const outcome = await adapter.current({ sessionId })
      if (!isCurrent()) return
      if (!outcome.ok) {
        // 静默刷新失败且已有陈旧目标时保持现状：可用界面优先于闪回错误态。
        if (silent && targetRef.current !== null) return
        if (outcome.error.code === 'not_git_repository') lastTargets.get(adapter)?.delete(sessionId)
        setTarget(null)
        setState(outcome.error.code === 'not_git_repository' ? 'unsupported' : 'error')
        setError(outcome.error.code === 'not_git_repository' ? null : `${outcome.error.code}: ${outcome.error.message}`)
        return
      }
      let sessionCache = lastTargets.get(adapter)
      if (sessionCache === undefined) {
        sessionCache = new Map()
        lastTargets.set(adapter, sessionCache)
      }
      sessionCache.set(sessionId, outcome.value.target)
      setTarget(outcome.value.target)
      setState('idle')
      if (silent) setError(null)
    } catch (cause) {
      if (!isCurrent()) return
      if (silent && targetRef.current !== null) return
      setTarget(null)
      setState('error')
      setError(errorMessage(cause))
    } finally { scope.busy = false }
  }

  useEffect(() => {
    scope.alive = true
    setPending(null)
    const cached = lastTargets.get(adapter)?.get(sessionId) ?? null
    setTarget(cached)
    if (cached !== null) setState('idle')
    if (blank) void refreshCurrent(cached !== null ? { silent: true } : undefined)
    return () => { scope.alive = false }
  }, [scope])

  if (!blank) return null
  if (state === 'loading') {
    // A disabled placeholder keeps the composer row stable while the first
    // target lookup resolves, instead of popping the toggle in afterwards.
    return (
      <span className="dsh-wt-pre-session" data-state="loading">
        <button type="button" role="switch" aria-checked={false} aria-label={t('worktree')}
          className="dsh-wt-pre-session-toggle" disabled>
          <span className="dsh-wt-pre-session-check" aria-hidden="true" />
          <span>{t('worktree')}</span>
        </button>
      </span>
    )
  }
  if (target?.state === 'local' && !target.capabilities.create) return null

  const selected = target !== null && target.state !== 'local'
  const canCreate = target?.state === 'local' && target.capabilities.create
  const busy = state === 'preparing'
  const retryingLookup = state === 'error' && target === null
  const disabled = busy || selected || (!canCreate && !retryingLookup && state !== 'unsupported') || input.phase !== 'plain'

  const beginConfirmation = async (): Promise<void> => {
    if (disabled || scope.busy || !isCurrent()) return
    if (retryingLookup) { await refreshCurrent(); return }
    // 非 Git 目录：current 已报告 not_git_repository，直接进入初始化确认。
    if (state === 'unsupported') { setInitConfirm(true); return }
    scope.busy = true
    setState('preparing')
    setError(null)
    try {
      const captured = snapshotInput(latestInput.current)
      const outcome = adapter.preflightCreate ? await adapter.preflightCreate({ sourceSessionId: sessionId }) : null
      if (!isCurrent()) return
      if (outcome && !outcome.ok) {
        // 预检发现仓库不可用（例如 .git 在会话中途消失）：转入初始化确认。
        if (outcome.error.code === 'not_git_repository') {
          setTarget(null)
          setInitConfirm(true)
          setState('unsupported')
          return
        }
        throw new Error(`${outcome.error.code}: ${outcome.error.message}`)
      }
      const result = outcome?.ok ? outcome.value : { kind: 'ready' as const }
      setPending({ input: captured, kind: result.kind, token: result.kind === 'empty' ? result.confirmationToken : undefined })
      setState('idle')
    } catch (cause) {
      if (!isCurrent()) return
      setPending(null)
      setState('error')
      setError(errorMessage(cause))
    } finally { scope.busy = false }
  }

  const cancelConfirmation = (): void => {
    if (scope.busy) return
    setPending(null)
    setError(null)
    setState('idle')
  }

  // 本地适配（非 Git 渐进增强）：git init（缺失时）+ add -A + 首次提交。
  // reopen=true 时（未出生仓库带未跟踪文件）初始化后重新预检并回到常规创建确认。
  const runInitialize = async (reopen: boolean): Promise<void> => {
    if (scope.busy || !isCurrent()) return
    scope.busy = true
    setState('preparing')
    setError(null)
    try {
      if (!adapter.initializeProject) throw new Error(t('initialize.git.unsupported'))
      const outcome = await adapter.initializeProject({ sourceSessionId: sessionId })
      if (!isCurrent()) return
      if (!outcome.ok) throw new Error(`${outcome.error.code}: ${outcome.error.message}`)
      if (reopen && pending !== null) {
        const preflight = adapter.preflightCreate ? await adapter.preflightCreate({ sourceSessionId: sessionId }) : null
        if (!isCurrent()) return
        if (preflight && !preflight.ok) throw new Error(`${preflight.error.code}: ${preflight.error.message}`)
        const result = preflight?.ok ? preflight.value : { kind: 'ready' as const }
        setPending({ input: pending.input, kind: result.kind, token: result.kind === 'empty' ? result.confirmationToken : undefined })
        setState('idle')
        return
      }
      setInitConfirm(false)
      scope.busy = false
      await refreshCurrent()
    } catch (cause) {
      if (!isCurrent()) return
      setState('error')
      setError(errorMessage(cause))
    } finally { scope.busy = false }
  }

  const confirm = async (): Promise<void> => {
    if (pending === null || pending.kind === 'files' || scope.busy || !isCurrent()) return
    scope.busy = true
    setState('preparing')
    setError(null)
    const captured = pending
    try {
      const prepared = await controller.prepare({
        sessionId, input: captured.input, currentInput: () => latestInput.current,
        isCurrentSession: isCurrent, inputActions, initialCommitConfirmationToken: captured.token,
      })
      if (!isCurrent()) return
      setTarget(prepared)
      setPending(null)
      setState('idle')
    } catch (cause) {
      if (!isCurrent()) return
      // Tokens are single-use, including when only the client handoff failed.
      setPending(null)
      setState('error')
      setError(errorMessage(cause))
    } finally { scope.busy = false }
  }

  return (
    <span className="dsh-wt-pre-session" data-state={state}>
      <button type="button" role="switch" aria-checked={selected} aria-label={t('worktree')}
        aria-describedby={error ? `dsh-wt-pre-session-error-${sessionId}` : undefined}
        className="dsh-wt-pre-session-toggle" disabled={disabled}
        onClick={() => { void beginConfirmation() }}>
        <span className="dsh-wt-pre-session-check" aria-hidden="true">{selected ? <ReviewIcon name="confirm" /> : null}</span>
        <span>{t('worktree')}</span>
      </button>
      {error ? (
        <span id={`dsh-wt-pre-session-error-${sessionId}`} className="dsh-wt-pre-session-error" role="alert">
          {error} <button type="button" className="dsh-wt-button" disabled={busy} onClick={() => { void beginConfirmation() }}><ReviewIcon name="refresh" />{t('retry')}</button>
        </span>
      ) : null}
      <Modal className="dsh-wt-create-dialog" open={pending !== null || initConfirm}
        onClose={pending === null ? () => { setInitConfirm(false) } : cancelConfirmation}
        title={pending === null ? t('initialize.git.title') : pending.kind === 'empty' ? t('pre.session.initial.title') : t('start.in.a.worktree')}
        closeLabel={t('close')}
        description={pending === null ? t('initialize.git.description') : pending.kind === 'empty' ? t('pre.session.initial.description') : pending.kind === 'files' ? t('pre.session.files.description') : confirmationDescription(pending.input, t)}
        footer={(
          <>
            <button type="button" className="dsh-wt-button" disabled={busy}
              onClick={pending === null ? () => { setInitConfirm(false) } : cancelConfirmation}>{t('cancel')}</button>
            {pending !== null && pending.kind !== 'files' ? <button type="button" className="dsh-wt-button dsh-wt-primary" disabled={busy} onClick={() => { void confirm() }}>
              <ReviewIcon name="create" />{busy ? t('creating') : pending?.kind === 'empty' ? t('pre.session.initial.confirm') : t('create.and.switch')}
            </button> : <button type="button" className="dsh-wt-button dsh-wt-primary" disabled={busy} onClick={() => { void runInitialize(pending !== null) }}>
              {busy ? t('initializing.git') : t('initialize.git.confirm')}
            </button>}
          </>
        )}>
        {pending?.kind === 'empty' ? <p className="dsh-wt-pre-session-note">{confirmationDescription(pending.input, t)}</p> : null}
        {pending?.kind !== 'files' ? <p className="dsh-wt-pre-session-note">{t('the.local.session.will.not.receive.this.message')}</p> : null}
      </Modal>
    </span>
  )
}
