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
import { DEFAULT_WORKTREE_RETENTION } from '../../types.js'
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
  /** 正在建树时为 true：建树要跑一次 `git worktree add`，不是瞬时动作。 */
  const [createWorktreeBusy, setCreateWorktreeBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** Why the last `current` probe failed; surfaced in the trigger tooltip. */
  const [failure, setFailure] = useState<{ code: string; message: string } | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [managerOpen, setManagerOpen] = useState(false)
  const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<'discard' | 'retry_cleanup' | 'begin_next_iteration' | 'return_to_local' | 'switch_branch' | null>(null)
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
  /** `git init` + first-commit confirmation for a non-Git project directory. */
  const [initializeOpen, setInitializeOpen] = useState(false)
  const [initializeBusy, setInitializeBusy] = useState(false)
  const [deliverOpen, setDeliverOpen] = useState(false)
  const [deliverMessage, setDeliverMessage] = useState('')
  const [deliverBusy, setDeliverBusy] = useState(false)
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
    setCreateWorktreeBusy(false)
    setDeliverOpen(false)
    setDeliverMessage('')
    setDeliverBusy(false)
    return subscribeCurrent(adapter, sessionId, language, result => {
      if ('error' in result) {
        const message = result.error instanceof Error ? result.error.message : String(result.error)
        setFailure({ code: 'client_error', message })
        setError(message)
      } else if (result.outcome.ok) {
        setTarget(result.outcome.value.target)
        // 官方建的树没能接进台账时，那棵树对本插件是隐形的：不说出来，用户
        // 只会看到「树建了但胶囊说没有」。只在有失败时覆盖——current 每 5 秒
        // 轮询一次，把 null 也写进去会立刻抹掉切换分支之类的短暂提示。
        if (result.outcome.value.adoptionFailure != null) setSwitchNotice(result.outcome.value.adoptionFailure)
        setFailure(null)
        setError(null)
      } else {
        // A failed probe leaves `target` null, so the chip can only fall back to
        // t('unavailable'). Keep the code and message so the trigger's tooltip
        // says WHY instead of making the user guess.
        setFailure({ code: result.outcome.error.code, message: result.outcome.error.message })
        setError(result.outcome.error.message)
      }
      setLoading(false)
    })
  }, [adapter, language, sessionId])

  // No branch-overview prefetch on mount: this capsule mounts for every
  // session, and `gitOverview` costs 3 git spawns the user never asked for.
  // The popover loads it on first expand instead (see the trigger's onClick).

  // A project directory that is not a Git repository is a normal, expected
  // answer — every plain folder produces it. Collapsing it into the same bare
  // "unavailable" as a real probe failure made the chip look broken on exactly
  // the sessions where nothing is wrong, so it gets its own label and an
  // explicit way out (initialize the repository).
  const notGitRepository = failure?.code === 'not_git_repository'
  const state = target?.state ?? (loading ? 'loading' : notGitRepository ? 'not_git_repository' : 'error')
  const stateLabel = state === 'loading'
    ? t("loading")
    : state === 'not_git_repository'
      ? t("not.a.git.repository")
      : state === 'error' ? t("unavailable") : STATE_LABELS(t)[state]
  // Git-graph-style chip: the branch name is the primary label; the worktree
  // state only fills in when no branch is known (loading/error/detached).
  const branchLabel = target?.currentBranch?.trim() ? target.currentBranch : null
  const triggerLabel = branchLabel ?? (target ? t("worktree.state.prefix", { p0: stateLabel }) : stateLabel)
  const expiry = target?.state === 'retained' && target.expiresAt
    ? new Date(target.expiresAt).toLocaleDateString(language === 'en' ? 'en-US' : 'zh-CN')
    : null
  const accessibleLabel = expiry === null ? t("session.target.label", { target: triggerLabel }) : t("session.target.expires", { p0: triggerLabel, p1: expiry })
  // When the probe failed the chip shows a bare "unavailable": put the real code
  // and message in the tooltip so the failure is diagnosable from the UI itself.
  const triggerTitle = failure === null
    ? t("session.target.and.linked.worktrees")
    : `${failure.code}: ${failure.message}`

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

  /**
   * 排队或撤回「下条消息在新工作树里开始」。
   *
   * 这里只写请求标记，不建树：建树发生在 Host 侧该会话的第一个 step 之前，
   * 所以勾了不发送不会留下没人用的 checkout。基点取当前分支（胶囊上写着
   * 的那个），没有分支时交给 Host 用 HEAD。
   */
  // 建树即点即建：不再写待办、不再等 turn 的第 1 步。返回的就是建好的目标，
  // 失败也当场可见——早先排队版本的全部困惑都来自「点了没反应，还得再发一条」。
  const createWorktreeNow = async (): Promise<void> => {
    if (pendingAction !== null || createWorktreeBusy) return
    const scope = actionScope.current
    const active = () => mounted.current && scope === actionScope.current
    setMenuOpen(false)
    setError(null)
    setCreateWorktreeBusy(true)
    try {
      const result = await adapter.createWorktree({ sessionId, from: target?.currentBranch ?? null })
      if (!active()) return
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      if (result.value.failure !== null) {
        // 菜单此刻已经收起：只写 error 的话用户看不到任何东西，而建树失败正是
        // 最需要立刻说明原因的时刻。放进胶囊自己的 notice 里。
        setSwitchNotice(t("worktree.create.failed", { p0: result.value.failure }))
        return
      }
      if (result.value.target !== null) {
        setTarget(result.value.target)
        setSwitchNotice(t("worktree.created", { p0: result.value.target.currentBranch ?? '' }))
      }
      requestWorktreeReviewRefresh(sessionId)
    } catch (reason) {
      if (active()) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (active()) setCreateWorktreeBusy(false)
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

  // 交付：评审面板删掉之后，客户端只剩这一个交付入口。它走 `deliver` RPC——
  // 不要求 reviewId，会话停在 working 也能直接交付（`/worktree finalize` 那条
  // 老命令仍然要求 ready_for_review，只留给脚本用）。
  const deliver = async (): Promise<void> => {
    if (!target?.checkoutId || deliverBusy) return
    const commitMessage = deliverMessage.trim()
    if (commitMessage.length === 0 || commitMessage.includes('\0')) {
      setError(t("deliver.invalid"))
      return
    }
    const scope = actionScope.current
    const active = () => mounted.current && scope === actionScope.current
    setDeliverBusy(true)
    setError(null)
    try {
      const outcome = await adapter.deliver({
        sessionId,
        checkoutId: target.checkoutId,
        expectedRevision: target.revision,
        commitMessage,
        // 与 `/worktree finish` 一致：不提保留策略就按默认走。
        retention: DEFAULT_WORKTREE_RETENTION,
      })
      if (!active()) return
      if (!outcome.ok) {
        setError(outcome.error.message)
        return
      }
      setDeliverOpen(false)
      setDeliverMessage('')
      setSwitchNotice(t("deliver.done", { p0: target.currentBranch ?? '' }))
      requestWorktreeReviewRefresh(sessionId)
    } catch (reason) {
      if (active()) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (active()) setDeliverBusy(false)
    }
  }

  const initializeRepository = async (): Promise<void> => {
    if (initializeBusy) return
    if (typeof adapter.initializeProject !== 'function') {
      setError(t("unavailable"))
      return
    }
    const scope = actionScope.current
    const active = () => mounted.current && scope === actionScope.current
    setInitializeBusy(true)
    setError(null)
    try {
      const outcome = await adapter.initializeProject({ sourceSessionId: sessionId })
      if (!active()) return
      if (!outcome.ok) {
        setError(outcome.error.message)
        return
      }
      setInitializeOpen(false)
      // Re-probe: the capsule must flip from "not a Git project" to the real
      // Local target without waiting for the 5s poll, and every dependent
      // entry (sidebar badge, review dock) needs the same invalidate.
      requestWorktreeReviewRefresh(sessionId)
      invalidateBranchOverview(sessionId)
    } catch (reason) {
      if (active()) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (active()) setInitializeBusy(false)
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

  const returnToLocal = async (): Promise<void> => {
    if (!target?.checkoutId || !target.capabilities.returnToLocal || pendingAction !== null) return
    const scope = actionScope.current
    const active = () => mounted.current && scope === actionScope.current
    setMenuOpen(false)
    setPendingAction('return_to_local')
    setError(null)
    try {
      const outcome = await adapter.returnToLocal({ sessionId, checkoutId: target.checkoutId })
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
  ) : notGitRepository ? (
    <span className="dsh-wtc-menu-summary">
      <strong>{t("not.a.git.repository")}</strong>
      <span>{t("initialize.git.repository.description")}</span>
      {error ? <span className="dsh-wtc-menu-error">{error}</span> : null}
    </span>
  ) : error ?? triggerLabel

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

  // A non-Git project has no branches, tags or review target to act on: offering
  // those rows would just fail on click. Its only real action is the conversion.
  const items: MenuEntry[] = notGitRepository ? [
    { id: 'summary', label: summary, disabled: true },
    { type: 'separator', id: 'summary-separator' },
    { id: 'initialize', icon: <ReviewIcon name="create" />, label: t("initialize.git.repository"), disabled: initializeBusy || typeof adapter.initializeProject !== 'function' },
  ] : [
    { id: 'summary', label: summary, disabled: true },
    { type: 'separator', id: 'summary-separator' },
    ...(overviewBranches.length > 0 && overview !== null ? [{ id: 'branches-title', label: <span className="dsh-wtc-branches-title">{t("branch.list.title")}{overview.dirtyCount > 0 ? <span className="dsh-wtc-branches-dirty">{t("branch.dirty.hint", { p0: overview.dirtyCount })}</span> : overview.dirtyCount < 0 ? <span className="dsh-wtc-branches-dirty">{t("branch.dirty.unknown")}</span> : null}</span>, disabled: true } satisfies MenuEntry] : []),
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
    ...(state === 'local'
      ? [{
        id: 'create_worktree',
        icon: <ReviewIcon name="branch" />,
        // 唯一的「新建工作树」入口；官方那对控件由本插件压掉。点了就建，
        // 不再排队等 turn 的第 1 步——想建树的人点完就在等着。
        label: createWorktreeBusy ? t("worktree.creating") : t("worktree.create.title"),
        disabled: pendingAction !== null || createWorktreeBusy,
      } satisfies MenuEntry]
      : []),
    { id: 'prune_branches', icon: <ReviewIcon name="refresh" />, label: t("branch.prune.title"), disabled: pendingAction !== null },
    { id: 'manage_tags', icon: <ReviewIcon name="list" />, label: t("tag.manager.title"), disabled: pendingAction !== null },
    { id: 'graph', icon: <ReviewIcon name="list" />, label: t("commit.graph.title"), disabled: pendingAction !== null },
    ...(target?.managedRoot && target.capabilities.open ? [{ id: 'reveal', icon: <ReviewIcon name="folder" />, label: t("open.current.working.location") } satisfies MenuEntry] : []),
    ...(target && target.sourceSessionId !== sessionId
      ? [{ id: 'source', icon: <ReviewIcon name="external" />, label: t("return.to.source.session") } satisfies MenuEntry]
      : []),
    ...(target?.capabilities.beginNextIteration ? [{ id: 'begin_next_iteration', icon: <ReviewIcon name="create" />, label: pendingAction === 'begin_next_iteration' ? t("creating") : t("start.next.iteration"), disabled: pendingAction !== null } satisfies MenuEntry] : []),
    // 评审面板已删，这里是客户端唯一的交付入口：会话做完工作就停在 working，
    // 交付完这棵树按保留策略收尾。只在有托管 checkout 且不是交付后态时出现。
    ...(target?.checkoutId && (target.state === 'working' || target.state === 'ready_for_review')
      ? [{ id: 'deliver', icon: <ReviewIcon name="send" />, label: pendingAction !== null || deliverBusy ? t("deliver.processing") : t("deliver.title"), disabled: pendingAction !== null || deliverBusy } satisfies MenuEntry]
      : []),
    ...(target?.capabilities.returnToLocal ? [{ id: 'return_to_local', icon: <ReviewIcon name="external" />, label: pendingAction === 'return_to_local' ? t("processing") : t("back.to.local.checkout"), disabled: pendingAction !== null } satisfies MenuEntry] : []),
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
          if (id === 'return_to_local') void returnToLocal()
          if (id === 'manager') { setMenuOpen(false); setManagerOpen(true) }
          if (id === 'retry_cleanup') void retryCleanup()
          if (id === 'discard') { setMenuOpen(false); setCleanupConfirmOpen(true) }
          if (id === 'create_branch') { setMenuOpen(false); setCreateName(''); setError(null); setCreateOpen(true) }
          if (id === 'create_worktree') void createWorktreeNow()
          if (id === 'deliver') { setMenuOpen(false); setError(null); setDeliverMessage(''); setDeliverOpen(true) }
          if (id === 'prune_branches') openPrunePreview()
          if (id === 'manage_tags') { setMenuOpen(false); setTagTarget(null); setTagsOpen(true) }
          if (id === 'graph') { setMenuOpen(false); setGraphOpen(true) }
          if (id === 'initialize') { setMenuOpen(false); setError(null); setInitializeOpen(true) }
          if (id.startsWith('branch:')) void switchBranch(id.slice('branch:'.length))
        }}
        anchor={(
          <button
            type="button"
            className="dsh-wtc-target-chip"
            data-target-state={state}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label={failure === null ? accessibleLabel : `${accessibleLabel} — ${triggerTitle}`}
            title={triggerTitle}
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
              : target ? <span className="dsh-wtc-target-branch">{triggerLabel}</span> : triggerLabel}
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
      <Modal
        open={initializeOpen}
        onClose={() => { if (!initializeBusy) setInitializeOpen(false) }}
        title={t("initialize.git.repository")}
        closeLabel={t("cancel")}
        description={t("initialize.git.repository.description")}
        footer={(
          <span className="dsh-wtc-confirm-actions">
            <button type="button" className="dsh-wtc-button" disabled={initializeBusy} onClick={() => setInitializeOpen(false)}>{t("cancel")}</button>
            <button type="button" className="dsh-wtc-button dsh-wtc-primary" disabled={initializeBusy} onClick={() => { void initializeRepository() }}>
              {initializeBusy ? t("processing") : t("initialize.git.repository.confirm")}
            </button>
          </span>
        )}
      >
        {error ? <span className="dsh-wtc-menu-error">{error}</span> : null}
      </Modal>
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
        open={deliverOpen}
        onClose={() => { if (!deliverBusy) setDeliverOpen(false) }}
        title={t("deliver.title")}
        closeLabel={t("cancel")}
        description={t("deliver.description")}
        footer={(
          <span className="dsh-wtc-confirm-actions">
            <button type="button" className="dsh-wtc-button" disabled={deliverBusy} onClick={() => setDeliverOpen(false)}>{t("cancel")}</button>
            <button
              type="button"
              className="dsh-wtc-button dsh-wtc-primary"
              disabled={deliverBusy || deliverMessage.trim().length === 0}
              onClick={() => { void deliver() }}
            >
              {deliverBusy ? t("deliver.processing") : t("deliver.confirm")}
            </button>
          </span>
        )}
      >
        <div className="dsh-wtc-create-branch">
          <input
            className="dsh-wtc-create-branch-input"
            value={deliverMessage}
            placeholder={t("deliver.placeholder")}
            autoFocus
            onChange={event => setDeliverMessage(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && !deliverBusy) void deliver() }}
          />
          {error ? <span className="dsh-wtc-menu-error">{error}</span> : null}
        </div>
      </Modal>
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
