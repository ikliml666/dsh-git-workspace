import { ClientI18nProvider, useClientTranslator } from '../i18n.js'
import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, type ComponentType } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceSnapshot as WorkspaceListState } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { IconBranchOutlineRegular, IconTrashOutlineRegular, MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import { apply as applyOfficialWorkspace } from 'virtual:dsh-official-workspace-client'
import type { WorkspaceBrowserProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { WorktreeConsoleAdapter, WorktreeSidebarTask, WorktreeSidebarTopologyResponse } from '../../console-contract.js'
import { WORKTREE_REVIEW_REFRESH_EVENT } from '../review-console/status-events.js'
import { selectedSessionId } from '../actions.js'
import { projectManagedWorkspaceSidebar, sidebarBadgeTasks } from './model.js'

const EMPTY_TOPOLOGY: WorktreeSidebarTopologyResponse = { projects: [] }
// These official actions do not create another Session or change its Workspace
// ownership. Keep their native menus, overlays and injected callbacks intact.
const OWNER_SAFE_SESSION_ACTIONS = new Set(['pin', 'rename', 'archive'])

/**
 * Latest sidebar topology, shared with slot-registered menu entries that live
 * outside the Browser React tree and cannot receive props from it.
 */
let sharedTopology: WorktreeSidebarTopologyResponse | undefined
const sharedTopologyListeners = new Set<() => void>()

function setSharedTopology(value: WorktreeSidebarTopologyResponse | undefined): void {
  sharedTopology = value
  for (const listener of [...sharedTopologyListeners]) listener()
}

function useSharedTopology(): WorktreeSidebarTopologyResponse | undefined {
  return useSyncExternalStore(
    listener => {
      sharedTopologyListeners.add(listener)
      return () => { sharedTopologyListeners.delete(listener) }
    },
    () => sharedTopology,
  )
}

/** Ephemeral presentation metadata consumed only by the gated official Browser derivative. */
export interface ManagedWorktreeSessionDecoration {
  kind: 'managed-worktree'
  state: WorktreeSidebarTopologyResponse['projects'][number]['tasks'][number]['state']
  label: string
  originalTitle: string
}

interface ManagedWorkspaceGuard {
  ready: boolean
  sessionIds: ReadonlySet<string>
  workspaceIds: ReadonlySet<string>
  blockSession(id: string): boolean
  blockWorkspace(id: string): boolean
}

interface OfficialWorkspaceBrowserProps extends WorkspaceBrowserProps {
  adapter: WorktreeConsoleAdapter
  OfficialBrowser: ComponentType<WorkspaceBrowserProps>
  guard?: ManagedWorkspaceGuard
  /** Raw slot registration for the clear-badge menu entry; runs on mount so the official seat declaration always exists first. */
  registerSessionMenuEntry?: (descriptor: Record<string, unknown>, component: ComponentType<any>) => unknown
}

/**
 * Preserve the complete official Workspace Browser and change only its data
 * projection plus mutations that are unsafe for one-to-one Managed owners.
 */
export function ManagedOfficialWorkspaceBrowser({
  adapter,
  OfficialBrowser,
  guard,
  registerSessionMenuEntry,
  ...officialProps
}: OfficialWorkspaceBrowserProps) {
  const t = useClientTranslator()
  const props = officialProps as unknown as WorkspaceBrowserProps
  const workspaceState = props.useWorkspaces((state: WorkspaceListState) => state) as WorkspaceListState
  const sessionState = props.useSessions((state: SessionListState) => state) as SessionListState
  const [topology, setTopology] = useState<WorktreeSidebarTopologyResponse>(EMPTY_TOPOLOGY)
  const [topologyVerified, setTopologyVerified] = useState(false)
  const workspaceKey = workspaceState.items
    .map(workspace => `${workspace.workspaceId}:${workspace.sessionIds.join(',')}`)
    .join('|')
  const sessionKey = sessionState.ids.join('|')

  // The badge menu entry attaches on mount: the official seat (and its inject
  // hooks) is always declared by the time a Browser component can render, and
  // apply-time registration would pollute the declaration ledgers in both modes.
  useEffect(() => {
    if (typeof registerSessionMenuEntry !== 'function') return
    let dispose: unknown
    registerClearSidebarBadgeEntry((descriptor, component) => { dispose = registerSessionMenuEntry(descriptor, component) }, adapter)
    return () => {
      if (typeof dispose === 'function') (dispose as () => void)()
    }
  }, [registerSessionMenuEntry, adapter])

  useEffect(() => {
    let active = true
    const refresh = (): void => {
      if (guard) guard.ready = false
      void adapter.sidebarTopology().then(outcome => {
        if (!active) return
        setTopology(outcome.ok ? outcome.value : EMPTY_TOPOLOGY)
        setTopologyVerified(outcome.ok)
        setSharedTopology(outcome.ok ? outcome.value : undefined)
      }, () => {
        if (active) {
          setTopology(EMPTY_TOPOLOGY)
          setTopologyVerified(false)
          setSharedTopology(undefined)
        }
      })
    }
    refresh()
    window.addEventListener(WORKTREE_REVIEW_REFRESH_EVENT, refresh)
    return () => {
      active = false
      if (guard) guard.ready = false
      setSharedTopology(undefined)
      window.removeEventListener(WORKTREE_REVIEW_REFRESH_EVENT, refresh)
    }
  }, [adapter, guard, sessionKey, workspaceKey])

  const projection = useMemo(() => projectManagedWorkspaceSidebar({
    workspaces: workspaceState.items,
    sessions: sessionState.byId,
    topology,
    archivedSessionIds: workspaceState.archivedSessionIds,
    currentSessionId: selectedSessionId(sessionState),
  }, t), [sessionState.byId, sessionState.ids, topology, workspaceState.items, workspaceState.archivedSessionIds, t])

  useLayoutEffect(() => {
    if (!guard) return
    guard.sessionIds = projection.protectedSessionIds
    guard.workspaceIds = projection.protectedWorkspaceIds
    guard.ready = topologyVerified
    return () => { guard.ready = false }
  }, [guard, projection, topologyVerified])

  const projectedWorkspaceState = useMemo<WorkspaceListState>(() => ({
    ...workspaceState,
    items: projection.workspaces.map(workspace => projection.protectedWorkspaceIds.has(workspace.workspaceId)
      ? { ...workspace, __dshGitWorktreeProtected: true }
      : workspace) as unknown as WorkspaceListState['items'],
  }), [projection.protectedWorkspaceIds, projection.workspaces, workspaceState])
  const projectedSessionState = useMemo<SessionListState>(() => {
    const byId = { ...sessionState.byId }
    for (const sessionId of projection.suppressedSessionIds) delete byId[sessionId as keyof typeof byId]
    for (const [sessionId, task] of Object.entries(projection.managedBySessionId)) {
      const summary = byId[sessionId as keyof typeof byId]
      if (!summary || !task) continue
      byId[sessionId as keyof typeof byId] = {
        ...summary,
        // Keep the canonical title untouched. The official derivative renders
        // this metadata as a fixed icon/badge before the truncating title.
        __dshGitWorktree: {
          kind: 'managed-worktree',
          state: task.state,
          label: task.label,
          originalTitle: summary.displayTitle,
        } satisfies ManagedWorktreeSessionDecoration,
      } as typeof summary
    }
    return {
      ...sessionState,
      ids: sessionState.ids.filter(sessionId => !projection.suppressedSessionIds.has(sessionId)),
      byId,
    }
  }, [projection.managedBySessionId, projection.suppressedSessionIds, sessionState])

  const useProjectedWorkspaces = (<T,>(selector: (state: WorkspaceListState) => T): T =>
    selector(projectedWorkspaceState)) as WorkspaceBrowserProps['useWorkspaces']
  const useProjectedSessions = (<T,>(selector: (state: SessionListState) => T): T =>
    selector(projectedSessionState)) as WorkspaceBrowserProps['useSessions']
  const protectedIds = projection.protectedSessionIds
  const protectedWorkspaceIds = projection.protectedWorkspaceIds

  return <OfficialBrowser
    {...props}
    useWorkspaces={useProjectedWorkspaces}
    useSessions={useProjectedSessions}
    startSession={async (workspaceId: WorkspaceId) => {
      if (protectedWorkspaceIds.has(workspaceId)) return
      await props.startSession(workspaceId)
    }}
    forkSession={(sessionId: SessionId) => {
      if (protectedIds.has(sessionId)) return
      props.forkSession(sessionId)
    }}
    insertSessionBefore={async (workspaceId: WorkspaceId, sessionId: SessionId, beforeSessionId?: SessionId) => {
      if (
        protectedWorkspaceIds.has(workspaceId)
        || protectedIds.has(sessionId)
        || projection.relocatedSessionIds.has(sessionId)
        || (beforeSessionId !== undefined && (protectedIds.has(beforeSessionId) || projection.relocatedSessionIds.has(beforeSessionId)))
      ) return
      await props.insertSessionBefore(workspaceId, sessionId, beforeSessionId)
    }}
  />
}

interface SidebarRegistrationContext {
  slots: {
    inject(name: string, callback: () => unknown): void
    register(descriptor: Record<string, unknown>, component: ComponentType<any>): unknown
  }
  [key: string]: unknown
}

/**
 * Resolve the directory picker service only when an action actually needs it.
 * On the modern Host the picker provider entry waits for `uiWorkspace`, so the
 * managed context may not have the service while `uiWorkspace` is starting;
 * every picker call must therefore re-read the service at invocation time.
 */
function deferredRemoteDirectoryPicker(ctx: SidebarRegistrationContext): unknown {
  const resolve = (): Record<string, unknown> => {
    const get = (ctx as { get?: (name: string) => unknown }).get
    const picker = typeof get === 'function' ? get.call(ctx, 'remote.directoryPicker') : undefined
    if (picker === undefined || picker === null) {
      throw new Error('The directory picker service is not active yet.')
    }
    return picker as Record<string, unknown>
  }
  return new Proxy({}, {
    get(_target, key) {
      const picker = resolve()
      const value = picker[key as string]
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(picker) : value
    },
  })
}

function officialContextProxy(
  ctx: SidebarRegistrationContext,
  adapter: WorktreeConsoleAdapter,
): SidebarRegistrationContext {
  // Service-level guards also cover the newer official shortcut/menu seats,
  // which call uiWorkspace directly rather than invoking Browser props.
  const guard: ManagedWorkspaceGuard = {
    ready: false,
    sessionIds: new Set(),
    workspaceIds: new Set(),
    blockSession(id) { return !this.ready || this.sessionIds.has(id) },
    blockWorkspace(id) { return !this.ready || this.workspaceIds.has(id) },
  }
  // Raw registration for the clear-badge menu entry: the official-context
  // proxy hides non-pin menu entries on managed owner rows, which is exactly
  // where the entry must appear.
  const registerRawSlotEntry = (descriptor: Record<string, unknown>, component: ComponentType<any>): unknown =>
    ctx.slots.register(descriptor, component)
  const proxySlots = new Proxy(ctx.slots, {
    get(target, key, receiver) {
      if (key === 'register') {
        return (descriptor: Record<string, unknown>, component: ComponentType<any>): unknown => {
          if (
            (descriptor.name === 'sidebar.workspaces.session.menu.item'
              || descriptor.name === 'sidebar.workspaces.session.row.action')
            && !OWNER_SAFE_SESSION_ACTIONS.has(descriptor.id as string)
          ) {
            // Fork and unclassified actions must not bypass managed ownership.
            // Safe official actions remain available even before topology loads.
            const Action = component
            const GuardedAction = (props: { sessionId?: string }) =>
              typeof props.sessionId === 'string' && !guard.blockSession(props.sessionId)
                ? <Action {...props} />
                : null
            return target.register(descriptor, GuardedAction)
          }
          if (descriptor.name !== 'sidebar.workspaces') return target.register(descriptor, component)
          const OfficialBrowser = component as ComponentType<WorkspaceBrowserProps>
          const Browser = (props: WorkspaceBrowserProps) => <ClientI18nProvider locale={typeof ctx.get === 'function' ? ctx.get('locale') : undefined}><ManagedOfficialWorkspaceBrowser
            {...props}
            adapter={adapter}
            OfficialBrowser={OfficialBrowser}
            guard={guard}
            registerSessionMenuEntry={registerRawSlotEntry}
          /></ClientI18nProvider>
          return target.register(descriptor, Browser)
        }
      }
      return Reflect.get(target, key, receiver)
    },
  })

  return new Proxy(ctx, {
    get(target, key, receiver) {
      if (key === 'slots') return proxySlots
      if (key === 'remoteAccess') {
        // 0.2.2-rc.1 reads `ctx.remoteAccess.source(...)` as a property, not
        // through `ctx.get`, so answering only the `get` form leaves the
        // official row hooks crashing on a missing service. Both forms defer
        // to the host; the stub covers hosts older than 0.2.1.
        return (typeof target.get === 'function'
          ? (target.get as (service: string) => unknown).call(target, key as string)
          : undefined) ?? { source: () => ({}) }
      }
      if (key === 'remote' && target.remote !== undefined && target.remote !== null) {
        // The official apply reads `ctx.remote.directoryPicker` once while
        // constructing `uiWorkspace`; hand back a deferred facade so that the
        // read never fails (and never blocks) before the picker activates.
        const remote = target.remote as Record<string, unknown>
        return new Proxy(remote, {
          get(remoteTarget, remoteKey, remoteReceiver) {
            if (remoteKey === 'directoryPicker') return deferredRemoteDirectoryPicker(ctx)
            return Reflect.get(remoteTarget, remoteKey, remoteReceiver)
          },
        })
      }
      if (key === 'get' && typeof target.get === 'function') {
        return (name: string) => name === '__dshGitWorktreeManagedGuard'
          ? guard
          : name === 'remote.directoryPicker'
            ? deferredRemoteDirectoryPicker(ctx)
            // The root entry inject never declares `remoteAccess` (0.2.0-rc.2
            // hosts lack the service and a static declaration would strand the
            // whole web boot), so the inlined 0.2.1 official apply reads it
            // through this proxy: hand back a harmless stub unless the host
            // actually provides one.
            : name === 'remoteAccess'
              ? ((target.get as (service: string) => unknown).call(target, name) ?? { source: () => ({}) })
              : (target.get as (service: string) => unknown).call(target, name)
      }
      return Reflect.get(target, key, receiver)
    },
  })
}

/**
 * Apply the version- and hash-gated official Workspace Client exactly once,
 * replacing only its Browser component while preserving its declaration tree,
 * locale, picker, stores, and directory-flow authorization.
 */
export function registerManagedWorkspaceSidebar(
  ctx: SidebarRegistrationContext,
  adapter: WorktreeConsoleAdapter,
  applyWorkspace: (ctx: Context) => void = applyOfficialWorkspace,
): void {
  applyWorkspace(officialContextProxy(ctx, adapter) as unknown as Context)
}

/** Props the official row menu hands to every `session.menu.item` entry. */
interface OfficialSessionMenuEntryProps {
  sessionId?: string
  useMenuOpenState?: () => readonly [boolean, (open: boolean) => void]
}

/**
 * Menu entry on terminal-state rows (discarded/finalized): clears the sidebar
 * status badge. The host suppresses a cleared badge from the topology, so the
 * row loses icon/badge/menu entry on the next refresh — no reset path needed.
 */
function ClearSidebarBadgeMenuItem({ adapter, sessionId, useMenuOpenState }: OfficialSessionMenuEntryProps & { adapter: WorktreeConsoleAdapter }) {
  const t = useClientTranslator()
  const topology = useSharedTopology()
  // The slot inject always provides useMenuOpenState (a plain pair getter,
  // not a real React hook); the fallback only satisfies the type checker.
  const [, setMenuOpen] = useMenuOpenState?.() ?? [false, () => {}]
  const task = useMemo<WorktreeSidebarTask | undefined>(() => {
    for (const project of topology?.projects ?? []) {
      for (const candidate of project.tasks ?? []) {
        if (candidate.ownerSessionId === sessionId) return candidate
      }
    }
    return undefined
  }, [topology, sessionId])
  if (!sessionId || !task || (task.state !== 'discarded' && task.state !== 'finalized')) return null
  return <MenuItemButton
    icon={<IconTrashOutlineRegular />}
    onSelect={() => {
      setMenuOpen(false)
      void adapter.clearSidebarBadge({
        sessionId,
        checkoutId: task.checkoutId,
        expectedRevision: task.revision,
      }).then(outcome => {
        if (outcome.ok) {
          window.dispatchEvent(new CustomEvent(WORKTREE_REVIEW_REFRESH_EVENT, { detail: { sessionId } }))
        } else {
          console.warn('[dsh-git-worktree] clearSidebarBadge failed:', outcome.error?.message)
        }
      }, error => {
        console.warn('[dsh-git-worktree] clearSidebarBadge failed:', error)
      })
    }}
  >{t('clear.sidebar.badge')}</MenuItemButton>
}

function registerClearSidebarBadgeEntry(
  register: (descriptor: Record<string, unknown>, component: ComponentType<any>) => unknown,
  adapter: WorktreeConsoleAdapter,
): void {
  const Entry = (props: OfficialSessionMenuEntryProps) => <ClearSidebarBadgeMenuItem {...props} adapter={adapter} />
  register({
    name: 'sidebar.workspaces.session.menu.item',
    id: 'clear-sidebar-badge',
    order: 500,
  }, Entry)
}

/** Structural view of the ui-slots registry service, limited to the decorate face. */
interface SlotRegistryService {
  register(descriptor: Record<string, unknown>, component: ComponentType<any>): unknown
  inject(name: string, callback: () => unknown): unknown
}

/** Props the official row hands to every row-seat entry. */
interface OfficialSessionRowEntryProps {
  sessionId?: string
}

/** Seat key, threaded through so one component serves both row seats. */
interface RowSeatProps extends OfficialSessionRowEntryProps {
  seat?: string
}

/**
 * Row seats this plugin may decorate. The Host declares BOTH seats from its
 * own `sidebar.workspaces` entry:
 *   - `sidebar.session.row.leading` — a 16px slot before the row title,
 *     rendered only when the row's primary status is idle (archived rows and
 *     rows showing status dots leave it empty);
 *   - `sidebar.session.row.hover` — the hover card body, mounted while the
 *     row's popover is open.
 * There is NO `sidebar.session.row.trailing` seat in DSH 0.2.x: injecting that
 * name waits for a declaration that never arrives, so the callback never runs
 * and the badge never mounts. Hence the branch glyph (upstream's identity mark,
 * 16px, fits the narrow leading seat) plus the state chip in the hover card.
 */
const ROW_SEATS = ['sidebar.session.row.leading', 'sidebar.session.row.hover'] as const

/**
 * Upstream identity mark, reused verbatim so the decorated path looks like the
 * takeover path: a branch glyph in the row's limited seat, and the same glyph
 * plus the state chip inside the hover card. Colours come from the existing
 * `.dsh-git-worktree-sidebar-icon[data-worktree-state]` rules in styles.ts,
 * which mirror upstream's palette for the same state names.
 */
function WorktreeIdentity(
  { state, stateLabel, label, chip }: { state: string; stateLabel: string; label: string; chip: boolean },
) {
  return <>
    <span
      className="dsh-git-worktree-sidebar-icon"
      data-dsh-git-worktree-badge={state}
      data-worktree-state={state}
      role="img"
      aria-label={label}
      title={label}
    ><IconBranchOutlineRegular /></span>
    {chip
      ? <span
        className="dsh-git-worktree-sidebar-badge"
        data-worktree-state={state}
        title={label}
      >{stateLabel}</span>
      : null}
  </>
}

/**
 * Inline row decoration for Managed Worktree owner sessions, matching the
 * upstream takeover rendering: the branch glyph followed by the state chip.
 * Upstream injects that pair straight into the row, between the leading seat
 * and the title; Mode B cannot re-render the row, so both seats available to it
 * (`sidebar.session.row.leading`, `sidebar.session.row.hover`) render the same
 * pair and styles.ts relaxes the leading seat's fixed 16px width for it.
 * Rows without a managed task render nothing.
 */
function WorktreeStatusBadgeEntry({ sessionId, seat }: RowSeatProps) {
  const t = useClientTranslator()
  const topology = useSharedTopology()
  const task = useMemo(() => (sessionId === undefined
    ? undefined
    : sidebarBadgeTasks(topology ?? EMPTY_TOPOLOGY, t)
      .find(candidate => candidate.ownerSessionId === sessionId)), [topology, sessionId, t])
  if (!task) return null
  // Both seats render the upstream identity mark: branch glyph + state chip.
  // The seat's fixed 16px width is relaxed for our decoration in styles.ts, so
  // the row-leading seat shows the same pill the takeover path renders inline.
  return <WorktreeIdentity
    state={task.state}
    stateLabel={task.stateLabel}
    label={task.label}
    chip
  />
}

/**
 * Mode B: the official Workspace Client is live on this Host (takeover
 * disabled), so replaying the module apply would re-provide uiWorkspace and
 * collide with the already-registered service. Decorate instead through the
 * registry's own extension seams — list entries in the official Browser's
 * declared child seats. Shadowing `sidebar.workspaces` itself is a dead end:
 * the shadow entry can never re-declare the official children (one declarer
 * per slot), and `renderSlot` authorizes only the declaring entry, so a
 * derivative Browser crashes on its first child render. Child-seat entries
 * render through the OFFICIAL entry's renderSlot, so the authorization is
 * intact by construction.
 */
export function registerDecoratedWorkspaceSidebar(
  ctx: SidebarRegistrationContext,
  adapter: WorktreeConsoleAdapter,
): void {
  const read = (service: string): unknown =>
    typeof ctx.get === 'function' ? (ctx.get as (name: string) => unknown)(service) : undefined
  const slots = read('slots') as SlotRegistryService | undefined
  if (!slots || typeof slots.register !== 'function' || typeof slots.inject !== 'function') {
    throw new Error('The official Workspace is active but the slot registry is unavailable.')
  }
  // The Browser wrapper that normally feeds sharedTopology does not mount in
  // this mode, so the slot-registered entries below need their own feed.
  const refresh = (): void => {
    void adapter.sidebarTopology().then(outcome => {
      setSharedTopology(outcome.ok ? outcome.value : undefined)
    }, () => {
      setSharedTopology(undefined)
    })
  }
  refresh()
  window.addEventListener(WORKTREE_REVIEW_REFRESH_EVENT, refresh)
  // The Host declares its row seats from the `sidebar.workspaces` entry:
  // `sidebar.session.row.leading` (16px, idle rows only) and
  // `sidebar.session.row.hover` (the hover popover body). A trailing seat does
  // not exist in DSH 0.2.x — injecting it waits forever for a declaration that
  // never comes, so the callback would never run and the badge never mounts.
  // Register into every real seat instead.
  for (const seat of ROW_SEATS) {
    slots.inject(seat, () => slots.register(
      { name: seat, id: 'dsh-git-worktree-status', order: 500 },
      (props: OfficialSessionRowEntryProps) => <ClientI18nProvider locale={read('locale')}><WorktreeStatusBadgeEntry {...props} seat={seat} /></ClientI18nProvider>,
    ))
  }
  slots.inject('sidebar.workspaces.session.menu.item', () => registerClearSidebarBadgeEntry(
    (descriptor, component) => slots.register(descriptor, component), adapter))
  const disposer = (): void => {
    window.removeEventListener(WORKTREE_REVIEW_REFRESH_EVENT, refresh)
    setSharedTopology(undefined)
  }
  if (typeof ctx.effect === 'function') (ctx.effect as (collect: () => unknown) => unknown)(() => disposer)
}
