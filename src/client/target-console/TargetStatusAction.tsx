import { subscribeCurrent } from './current-polling.js'
import { ReviewIcon } from '../review-console/ReviewIcon.js'
import { useClientLanguage, useClientTranslator, defaultClientTranslator, type ClientTranslator } from '../i18n.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Menu, Modal, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  WorktreeConsoleAdapter,
  WorktreeConsoleGitOverviewResponse,
  WorktreeConsoleGitPruneResponse,
  WorktreeConsoleTargetDetails,
} from '../../console-contract.js'
import { branchNameSchema } from '../../console-remote/schemas.js'
import { openExistingSession, type WorktreeClientServices } from '../actions.js'
import { requestWorktreeReviewRefresh } from '../review-console/status-events.js'
import { WorktreeManagerModal } from './WorktreeManagerModal.js'
import { BranchGraphModal } from './BranchGraphModal.js'
import { TagManagerModal } from './TagManagerModal.js'
import {
  ensureBranchOverview,
  cachedBranchOverview,
  invalidateBranchOverview,
  patchBranchOverview,
  refreshBranchOverviewInBackground,
} from './branch-overview-cache.js'

export interface TargetStatusActionProps {
  sessionId: string
  adapter: WorktreeConsoleAdapter
  services: WorktreeClientServices
}

const STATE_LABELS = (t: ClientTranslator = defaultClientTranslator) => ({
  local: t("local.state"),
  creating: t("creating.2"),
  working: t("editing"),
  ready_for_review: t("ready.for.review"),
  preview_active: t("reviewing.in.local"),
  preview_detached: t("preview.awaiting.recovery"),
  retained: t("retained"),
  cleanup_pending: t("cleanup.pending"),
  recovery_required: t("recovery.required"),
  delivered: t("delivered"),
  discarded: t("discarded"),
})

function shortOid(value: string): string {
  return value === 'unversioned' ? value : value.slice(0, 7)
}

/** Interactive Session Target capsule with source-linked management actions. */
export function TargetStatusAction({ sessionId, adapter, services }: TargetStatusActionProps) {
  const t = useClientTranslator()
  const language = useClientLanguage()

  const [target, setTarget] = useState<WorktreeConsoleTargetDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // The capsule used to collapse every failure into a bare 「不可用」, which is
  // unfalsifiable from the outside: a Session that is simply not isolated, a
  // Gateway lookup rejection and a git fault all looked identical. The domain
  // code (and the transport failure's own name) now rides along, so the chip
  // itself says which link of the chain broke.
  const [failure, setFailure] = useState<{ code: string; message: string } | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [managerOpen, setManagerOpen] = useState(false)
  const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<'discard' | 'retry_cleanup' | 'begin_next_iteration' | 'switch_branch' | null>(null)
  const [overview, setOverview] = useState<WorktreeConsoleGitOverviewResponse | null>(null)
  const [graphOpen, setGraphOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createBusy, setCreateBusy] = useState(false)
  const [pruneOpen, setPruneOpen] = useState(false)
  const [prunePreview, setPrunePreview] = useState<WorktreeConsoleGitPruneResponse | null>(null)
  const [pruneLoading, setPruneLoading] = useState(false)
  const [pruneBusy, setPruneBusy] = useState(false)
  const [branchQuery, setBranchQuery] = useState('')
  const [switchNotice, setSwitchNotice] = useState<string | null>(null)
  const [tagsOpen, setTagsOpen] = useState(false)
  /** Commit the next created tag points at; null means HEAD. */
  const [tagTarget, setTagTarget] = useState<string | null>(null)
  const actionScope = useRef(0)
  const activeSession = useRef(sessionId)
  if (activeSession.current !== sessionId) {
    activeSession.current = sessionId
    actionScope.current += 1
  }
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    requestWorktreeReviewRefresh(sessionId)
  }, [sessionId])

  useEffect(() => {
    setTarget(null)
    setLoading(true)
    setError(null)
    setFailure(null)
    setMenuOpen(false)
    setManagerOpen(false)
    setCleanupConfirmOpen(false)
    setPendingAction(null)
    setOverview(null)
    setGraphOpen(false)
    setCreateOpen(false)
    setCreateName('')
    setCreateBusy(false)
    setPruneOpen(false)
    setPrunePreview(null)
    setPruneLoading(false)
    setPruneBusy(false)
    setTagsOpen(false)
    setTagTarget(null)
    setBranchQuery('')
    setSwitchNotice(null)
    return subscribeCurrent(adapter, sessionId, language, result => {
      if ('error' in result) {
        const message = result.error instanceof Error ? result.error.message : String(result.error)
        setError(message)
        setFailure({ code: 'client_request_failed', message })
      } else if (result.outcome.ok) {
        setTarget(result.outcome.value.target)
        setError(null)
        setFailure(null)
      } else {
        setError(result.outcome.error.message)
        setFailure({ code: result.outcome.error.code, message: result.outcome.error.message })
      }
      setLoading(false)
    })
  }, [adapter, language, sessionId])

  // No branch-overview prefetch on mount: this capsule mounts for every
  // session, and `gitOverview` costs 3 git spawns the user never asked for.
  // The popover loads it on first expand instead (see the trigger's onClick).

  const state = target?.state ?? (loading ? 'loading' : 'error')
  const stateLabel = state === 'loading' ? t("loading") : state === 'error' ? t("unavailable") : STATE_LABELS(t)[state]
  // Git-graph-style chip: the branch name is the primary label; the worktree
  // state only fills in when no branch is known (loading/error/detached).
  const branchLabel = target?.currentBranch?.trim() ? target.currentBranch : null
  // A failed observation is labelled with its own code instead of the shared
  // 「不可用」: `target_unselected` means "this Session is not isolated" (the
  // normal state of an ordinary Session), while `gateway/lookup-*`,
  // `transport_unavailable` and `malformed_response` mean the call never
  // reached the Host — completely different repairs.
  const failureLabel = failure === null ? null : `${stateLabel} · ${failure.code}`
  const triggerLabel = branchLabel ?? (target ? t("worktree.state.prefix", { p0: stateLabel }) : failureLabel ?? stateLabel)
  const expiry = target?.state === 'retained' && target.expiresAt
    ? new Date(target.expiresAt).toLocaleDateString(language === 'en' ? 'en-US' : 'zh-CN')
    : null
  const accessibleLabel = expiry === null ? t("session.target.label", { target: triggerLabel }) : t("session.target.expires", { p0: triggerLabel, p1: expiry })
  // Hovering the chip is the fastest way to read the full reason without
  // opening the menu (a toast would be lost the moment the pointer moves).
  const chipTitle = failure === null
    ? t("session.target.and.linked.worktrees")
    : failure.message

  const reveal = (): void => {
    if (!target?.managedRoot) return
    setMenuOpen(false)
    void services.workspaces.openPath(target.managedRoot).catch(reason => {
      if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  const openSource = (): void => {
    if (!target || target.sourceSessionId === sessionId) return
    setMenuOpen(false)
    if (target.sourceRoot === null || !openExistingSession(services, target.sourceSessionId, target.sourceRoot)) {
      setError(t("the.source.session.cwd.cannot.be.matched.to"))
    }
  }

  const switchBranch = async (branch: string): Promise<void> => {
    if (pendingAction !== null) return
    const scope = actionScope.current
    const active = () => mounted.current && scope === actionScope.current
    setMenuOpen(false)
    setPendingAction('switch_branch')
    setError(null)
    try {
      const outcome = await adapter.gitSwitchBranch(sessionId, branch)
      if (!active()) return
      if (!outcome.ok) {
        setError(outcome.error.message)
        return
      }
      patchBranchOverview(sessionId, current => ({
        ...current,
        branch: outcome.value.branch,
        branches: current.branches.map(item => ({ ...item, isCurrent: item.name === outcome.value.branch })),
      }))
      // 乐观补丁即最终态：switch 的 RPC 已确认分支，直接读回补丁后的缓存，
      // 省一次 invalidate+ensure 重取（4 个 git spawn + UI 闪回旧值）。
      const patched = cachedBranchOverview(sessionId)
      if (patched !== null) setOverview(patched)
      // Git-graph-style switch feedback: the chip keeps the confirmed branch
      // visible as a notice for a beat, so a fast close is not mistaken for
      // a no-op.
      if (active()) {
        setSwitchNotice(t("branch.switch.success", { p0: branch }))
        window.setTimeout(() => {
          if (active()) setSwitchNotice(null)
        }, 900)
      }
      requestWorktreeReviewRefresh(sessionId)
    } catch (reason) {
      if (active()) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (active()) setPendingAction(null)
    }
  }

  const createBranch = async (): Promise<void> => {
    const name = createName.trim()
    if (!name || createBusy) return
    if (!branchNameSchema.safeParse(name).success) {
      setError(t("branch.create.invalid"))
      return
    }
    const scope = actionScope.current
    const active = () => mounted.current && scope === actionScope.current
    setCreateBusy(true)
    setError(null)
    try {
      const outcome = await adapter.gitCreateBranch(sessionId, name)
      if (!active()) return
      if (!outcome.ok) {
        setError(outcome.error.message)
        return
      }
      setCreateOpen(false)
      setCreateName('')
      invalidateBranchOverview(sessionId)
      void ensureBranchOverview(adapter, sessionId).then(value => {
        if (active() && value !== null) setOverview(value)
      })
    } catch (reason) {
      if (active()) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (active()) setCreateBusy(false)
    }
  }

  const openPrunePreview = (): void => {
    setMenuOpen(false)
    setError(null)
    setPrunePreview(null)
    setPruneLoading(true)
    setPruneOpen(true)
    const scope = actionScope.current
    const active = () => mounted.current && scope === actionScope.current
    void adapter.gitPruneMergedBranches(sessionId, true).then(outcome => {
      if (!active()) return
      setPruneLoading(false)
      if (!outcome.ok) {
        setPruneOpen(false)
        setError(outcome.error.message)
        return
      }
      setPrunePreview(outcome.value)
    }).catch(reason => {
      if (!active()) return
      setPruneLoading(false)
      setPruneOpen(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  const confirmPrune = async (): Promise<void> => {
    if (pruneBusy || pruneLoading) return
    const scope = actionScope.current
    const active = () => mounted.current && scope === actionScope.current
    setPruneBusy(true)
    setError(null)
    try {
      const outcome = await adapter.gitPruneMergedBranches(sessionId, false)
      if (!active()) return
      if (!outcome.ok) {
        setError(outcome.error.message)
        return
      }
      setPruneOpen(false)
      setPrunePreview(null)
      // 分支已被删除：失效缓存并立即重取，菜单随即反映新分支集。
      invalidateBranchOverview(sessionId)
      void ensureBranchOverview(adapter, sessionId).then(value => {
        if (active() && value !== null) setOverview(value)
      })
    } catch (reason) {
      if (active()) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (active()) setPruneBusy(false)
    }
  }

  const retryCleanup = async (): Promise<void> => {
    if (!target?.checkoutId || !target.capabilities.retryCleanup || pendingAction !== null) return
    const scope = actionScope.current
    const active = () => mounted.current && scope === actionScope.current
    setMenuOpen(false)
    setPendingAction('retry_cleanup')
    setError(null)
    try {
      const outcome = await adapter.retryCleanup({
        sessionId,
        checkoutId: target.checkoutId,
        expectedRevision: target.revision,
      })
      if (!active()) return
      if (!outcome.ok) {
        setError(outcome.error.message)
        if (outcome.error.code === 'stale_target') void refresh()
        return
      }
      setTarget(current => current ? {
        ...current,
        ...outcome.value.target,
        ...(outcome.value.target.phase === 'discarded' ? { managedRoot: null } : {}),
      } : current)
      requestWorktreeReviewRefresh(sessionId)
    } catch (reason) {
      if (active()) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (active()) setPendingAction(null)
    }
  }

  const beginNextIteration = async (): Promise<void> => {
    if (!target?.checkoutId || !target.capabilities.beginNextIteration || pendingAction !== null) return
    const scope = actionScope.current
    const active = () => mounted.current && scope === actionScope.current
    setMenuOpen(false)
    setPendingAction('begin_next_iteration')
    setError(null)
    try {
      const outcome = await adapter.beginNextIteration({ sessionId, checkoutId: target.checkoutId, expectedRevision: target.revision })
      if (!active()) return
      if (!outcome.ok) {
        setError(outcome.error.message)
        if (outcome.error.code === 'stale_target') void refresh()
        return
      }
      setTarget(current => current ? { ...current, ...outcome.value.target } : current)
      requestWorktreeReviewRefresh(sessionId)
    } catch (reason) {
      if (active()) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (active()) setPendingAction(null)
    }
  }

  const discard = async (): Promise<void> => {
    if (!target?.checkoutId || !target.capabilities.discard || pendingAction !== null) return
    const scope = actionScope.current
    const active = () => mounted.current && scope === actionScope.current
    setCleanupConfirmOpen(false)
    setPendingAction('discard')
    setError(null)
    try {
      const outcome = await adapter.discard({
        sessionId,
        checkoutId: target.checkoutId,
        expectedRevision: target.revision,
        confirmDirty: true,
        ...(target.state === 'preview_active' || target.capabilities.rollbackPreview
          ? { rollbackPreview: true }
          : {}),
      })
      if (!active()) return
      if (!outcome.ok) {
        setError(outcome.error.message)
        if (outcome.error.code === 'stale_target') void refresh()
        return
      }
      setTarget(current => current ? {
        ...current,
        ...outcome.value.target,
        ...(outcome.value.target.phase === 'discarded' ? { managedRoot: null } : {}),
      } : current)
      requestWorktreeReviewRefresh(sessionId)
    } catch (reason) {
      if (active()) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (active()) setPendingAction(null)
    }
  }

  const summary = target ? (
    <span className="dsh-wtc-menu-summary">
      <strong>{branchLabel ?? t("worktree.state.prefix", { p0: stateLabel })}</strong>
      <span>{target.project.name}</span>
      <span>{t("source")} {shortOid(target.sourceOid)} {t("current")} {shortOid(target.currentOid)} {t("iteration.2")} {target.iteration}</span>
      {expiry ? <span>{t("retained.until")} {expiry}</span> : null}
      {error ? <span className="dsh-wtc-menu-error">{error}</span> : null}
    </span>
  ) : failure !== null
    // No target at all: the observation itself failed, so the menu leads with
    // the machine-readable code and keeps the raw message underneath.
    ? (
      <span className="dsh-wtc-menu-summary">
        <strong className="dsh-wtc-menu-error">{stateLabel} · {failure.code}</strong>
        <span className="dsh-wtc-menu-error">{failure.message}</span>
      </span>
    )
    : error ?? triggerLabel

  const MAX_BRANCH_ITEMS = 12
  const overviewBranches = overview?.branches ?? []
  const sessionBranch = target?.currentBranch ?? null
  const sortedBranches = [...overviewBranches].sort((left, right) => {
    const leftCurrent = left.isCurrent || left.name === sessionBranch ? 0 : 1
    const rightCurrent = right.isCurrent || right.name === sessionBranch ? 0 : 1
    if (leftCurrent !== rightCurrent) return leftCurrent - rightCurrent
    return left.name.localeCompare(right.name)
  })
  // Git-graph-style picker: past the item cap the list stays reachable via a
  // filter box instead of a dead "N more" line; an active query lifts the cap.
  const query = branchQuery.trim().toLowerCase()
  const matchedBranches = query === ''
    ? sortedBranches
    : sortedBranches.filter(branch => branch.name.toLowerCase().includes(query))
  const showBranchSearch = sortedBranches.length > MAX_BRANCH_ITEMS
  const visibleBranches = query === '' && showBranchSearch
    ? matchedBranches.slice(0, MAX_BRANCH_ITEMS)
    : matchedBranches
  const hiddenBranchCount = query === '' ? sortedBranches.length - visibleBranches.length : 0

  const items: MenuEntry[] = [
    { id: 'summary', label: summary, disabled: true },
    { type: 'separator', id: 'summary-separator' },
    ...(overviewBranches.length > 0 && overview !== null ? [{ id: 'branches-title', label: <span className="dsh-wtc-branches-title">{t("branch.list.title")}{overview.dirtyCount > 0 ? <span className="dsh-wtc-branches-dirty">{t("branch.dirty.hint", { p0: overview.dirtyCount })}</span> : null}</span>, disabled: true } satisfies MenuEntry] : []),
    ...(showBranchSearch ? [{ id: 'branch-search', disabled: true, label: (
      <span className="dsh-wtc-branch-search">
        <input
          value={branchQuery}
          placeholder={t("branch.search.placeholder")}
          autoFocus
          onChange={event => { setBranchQuery(event.target.value) }}
          onKeyDown={event => {
            // The box shares the menu card: keep Enter/arrows local so typing
            // a filter and hitting Enter picks the first match instead of
            // walking the list rows.
            if (event.key === 'Enter') {
              event.preventDefault()
              event.stopPropagation()
              // Same gate as the menu rows: a switch already in flight must not
              // be doubled by Enter, which has no disabled state of its own.
              if (pendingAction !== null) return
              const first = visibleBranches.find(branch => !branch.isCurrent)
              if (first) void switchBranch(first.name)
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Tab') {
              event.stopPropagation()
            }
          }}
        />
      </span>
    ) } satisfies MenuEntry] : []),
    ...(query !== '' && matchedBranches.length === 0 ? [{ id: 'branch-search-empty', label: <span className="dsh-wtc-branches-more">{t("branch.search.empty")}</span>, disabled: true } satisfies MenuEntry] : []),
    ...visibleBranches.map(branch => ({
      id: `branch:${branch.name}`,
      icon: <ReviewIcon name="branch" />,
      label: (
        <span className="dsh-wtc-branch-item" data-branch-current={branch.isCurrent ? '' : undefined} title={branch.name}>
          {branch.name}
          {branch.name === sessionBranch && !branch.isCurrent ? <span className="dsh-wtc-branch-session">{t("branch.session.badge")}</span> : null}
          {branch.upstream ? <span className="dsh-wtc-branch-upstream">{branch.upstream}</span> : null}
        </span>
      ),
      disabled: branch.isCurrent || pendingAction !== null,
    }) satisfies MenuEntry),
    ...(hiddenBranchCount > 0 ? [{ id: 'branches-more', label: <span className="dsh-wtc-branches-more">{t("branch.list.more", { p0: hiddenBranchCount })}</span>, disabled: true } satisfies MenuEntry] : []),
    ...(overviewBranches.length > 0 ? [{ type: 'separator' as const, id: 'branches-separator' }] : []),
    { id: 'create_branch', icon: <ReviewIcon name="create" />, label: t("branch.create.title"), disabled: pendingAction !== null },
    { id: 'prune_branches', icon: <ReviewIcon name="refresh" />, label: t("branch.prune.title"), disabled: pendingAction !== null },
    { id: 'manage_tags', icon: <ReviewIcon name="list" />, label: t("tag.manager.title"), disabled: pendingAction !== null },
    { id: 'graph', icon: <ReviewIcon name="list" />, label: t("commit.graph.title"), disabled: pendingAction !== null },
    ...(target?.managedRoot && target.capabilities.open ? [{ id: 'reveal', icon: <ReviewIcon name="folder" />, label: t("open.current.working.location") } satisfies MenuEntry] : []),
    ...(target && target.sourceSessionId !== sessionId
      ? [{ id: 'source', icon: <ReviewIcon name="external" />, label: t("return.to.source.session") } satisfies MenuEntry]
      : []),
    ...(target?.capabilities.beginNextIteration ? [{ id: 'begin_next_iteration', icon: <ReviewIcon name="create" />, label: pendingAction === 'begin_next_iteration' ? t("creating") : t("start.next.iteration"), disabled: pendingAction !== null } satisfies MenuEntry] : []),
    ...(target ? [{ id: 'manager', icon: <ReviewIcon name="manager" />, label: t("manage.linked.worktrees") } satisfies MenuEntry] : []),
  ]
  const footer: MenuEntry[] = target?.capabilities.retryCleanup
    ? [{ id: 'retry_cleanup', icon: <ReviewIcon name="refresh" />, label: pendingAction === 'retry_cleanup' ? t("processing") : t("retry.environment.cleanup"), disabled: pendingAction !== null }]
    : target?.capabilities.discard
      ? [{ id: 'discard', icon: <ReviewIcon name="discard" />, label: pendingAction === 'discard' ? t("processing") : t("discard.task.and.clean.up.worktree"), danger: true, disabled: pendingAction !== null }]
      : []

  return (
    <>
      <Menu
        open={menuOpen}
        align="end"
        portal
        compact
        onClose={() => { setMenuOpen(false); setBranchQuery('') }}
        items={items}
        footer={footer}
        onSelect={(id) => {
          if (id === 'reveal') reveal()
          if (id === 'source') openSource()
          if (id === 'begin_next_iteration') void beginNextIteration()
          if (id === 'manager') { setMenuOpen(false); setManagerOpen(true) }
          if (id === 'retry_cleanup') void retryCleanup()
          if (id === 'discard') { setMenuOpen(false); setCleanupConfirmOpen(true) }
          if (id === 'create_branch') { setMenuOpen(false); setCreateName(''); setError(null); setCreateOpen(true) }
          if (id === 'prune_branches') openPrunePreview()
          if (id === 'manage_tags') { setMenuOpen(false); setTagTarget(null); setTagsOpen(true) }
          if (id === 'graph') { setMenuOpen(false); setGraphOpen(true) }
          if (id.startsWith('branch:')) void switchBranch(id.slice('branch:'.length))
        }}
        anchor={(
          <button
            type="button"
            className="dsh-wtc-target-chip"
            data-target-state={state}
            data-target-failure={failure?.code}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label={accessibleLabel}
            title={chipTitle}
            onClick={() => {
              if (menuOpen) {
                setMenuOpen(false)
                setBranchQuery('')
                return
              }
              setMenuOpen(true)
              // Stale-while-revalidate when a snapshot exists; otherwise this is
              // the first expand and the branch list must be fetched now.
              const value = refreshBranchOverviewInBackground(adapter, sessionId)
              if (value !== null) {
                if (value !== overview) setOverview(value)
              } else {
                void ensureBranchOverview(adapter, sessionId).then(fetched => {
                  if (fetched !== null && mounted.current) setOverview(fetched)
                })
              }
            }}
          >
            <ReviewIcon name={target?.state === 'local' ? 'local' : 'branch'} className="dsh-wtc-target-kind" />
            {branchLabel !== null
              ? <span className="dsh-wtc-target-branch">{branchLabel}</span>
              : target ? <span className="dsh-wtc-target-branch">{triggerLabel}</span> : <span className="dsh-wtc-target-branch">{triggerLabel}</span>}
            {switchNotice !== null ? <span className="dsh-wtc-switch-notice">{switchNotice}</span> : null}
            {expiry ? <span className="dsh-wtc-target-expiry">· {expiry}</span> : null}
            <ReviewIcon name="down" className="dsh-wtc-target-chevron" />
          </button>
        )}
      />
      <WorktreeManagerModal
        open={managerOpen}
        sessionId={sessionId}
        adapter={adapter}
        services={services}
        focusCheckoutId={target?.checkoutId}
        onClose={() => setManagerOpen(false)}
        onTargetChange={() => {
          requestWorktreeReviewRefresh(sessionId)
        }}
      />
      <Modal
        open={cleanupConfirmOpen}
        onClose={() => setCleanupConfirmOpen(false)}
        title={t("discard.task.and.clean.up.worktree.2")}
        closeLabel={t("cancel.worktree.cleanup")}
        description={target?.state === 'preview_active' || target?.capabilities.rollbackPreview
          ? t("host.will.safely.roll.back.local.preview.first")
          : t("undelivered.worktree.changes.will.be.permanently.discarded.local.2")}
        footer={(
          <span className="dsh-wtc-confirm-actions">
            <button type="button" className="dsh-wtc-button" onClick={() => setCleanupConfirmOpen(false)}>{t("cancel")}</button>
            <button type="button" className="dsh-wtc-button dsh-wtc-danger" disabled={pendingAction !== null} onClick={() => { void discard() }}>
              {t("confirm.worktree.cleanup")} </button>
          </span>
        )}
      />
      <BranchGraphModal
        open={graphOpen}
        adapter={adapter}
        sessionId={sessionId}
        t={t}
        currentBranch={overview?.branch ?? target?.currentBranch ?? null}
        onClose={() => setGraphOpen(false)}
        onTagCommit={(oid) => { setGraphOpen(false); setTagTarget(oid); setTagsOpen(true) }}
        onManageTags={() => { setGraphOpen(false); setTagTarget(null); setTagsOpen(true) }}
      />
      <TagManagerModal
        open={tagsOpen}
        adapter={adapter}
        sessionId={sessionId}
        t={t}
        target={tagTarget}
        onClose={() => { setTagsOpen(false); setTagTarget(null) }}
      />
      <Modal
        open={createOpen}
        onClose={() => { if (!createBusy) setCreateOpen(false) }}
        title={t("branch.create.title")}
        closeLabel={t("cancel")}
        description={t("branch.create.description")}
        footer={(
          <span className="dsh-wtc-confirm-actions">
            <button type="button" className="dsh-wtc-button" disabled={createBusy} onClick={() => setCreateOpen(false)}>{t("cancel")}</button>
            <button
              type="button"
              className="dsh-wtc-button dsh-wtc-primary"
              disabled={createBusy || createName.trim().length === 0}
              onClick={() => { void createBranch() }}
            >
              {createBusy ? t("processing") : t("branch.create.confirm")}
            </button>
          </span>
        )}
      >
        <div className="dsh-wtc-create-branch">
          <input
            className="dsh-wtc-create-branch-input"
            value={createName}
            placeholder={t("branch.create.placeholder")}
            autoFocus
            onChange={event => setCreateName(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && !createBusy) void createBranch() }}
          />
          {error ? <span className="dsh-wtc-menu-error">{error}</span> : null}
        </div>
      </Modal>
      <Modal
        open={pruneOpen}
        onClose={() => { if (!pruneBusy) setPruneOpen(false) }}
        title={t("branch.prune.title")}
        closeLabel={t("cancel")}
        description={t("branch.prune.description")}
        footer={(
          <span className="dsh-wtc-confirm-actions">
            <button type="button" className="dsh-wtc-button" disabled={pruneBusy} onClick={() => setPruneOpen(false)}>{t("cancel")}</button>
            <button
              type="button"
              className="dsh-wtc-button dsh-wtc-danger"
              disabled={pruneBusy || pruneLoading || prunePreview === null || prunePreview.pruned.length === 0}
              onClick={() => { void confirmPrune() }}
            >
              {pruneBusy ? t("branch.prune.processing") : t("branch.prune.confirm")}
            </button>
          </span>
        )}
      >
        <div className="dsh-wtc-create-branch">
          {pruneLoading ? <span>{t("branch.prune.loading")}</span> : prunePreview === null ? null : (
            <div className="dsh-wtc-prune-preview">
              {prunePreview.pruned.length === 0 && prunePreview.skipped.length === 0 ? <span>{t("branch.prune.none")}</span> : (
                <>
                  {prunePreview.pruned.length > 0 ? (
                    <div>
                      <span>{t("branch.prune.pruned", { p0: prunePreview.pruned.length })}</span>
                      <ul>{prunePreview.pruned.map(entry => <li key={entry.oid}>{entry.name}</li>)}</ul>
                    </div>
                  ) : null}
                  {prunePreview.skipped.length > 0 ? (
                    <div>
                      <span>{t("branch.prune.skipped", { p0: prunePreview.skipped.length })}</span>
                      <ul>{prunePreview.skipped.map(entry => <li key={entry.oid}>{entry.reason ? `${entry.name} — ${entry.reason}` : entry.name}</li>)}</ul>
                    </div>
                  ) : null}
                </>
              )}
              {error ? <span className="dsh-wtc-menu-error">{error}</span> : null}
            </div>
          )}
        </div>
      </Modal>
    </>
  )
}
