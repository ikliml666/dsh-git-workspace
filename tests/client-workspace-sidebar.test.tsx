// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ClientI18nProvider } from '../src/client/i18n.js'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceSnapshot as WorkspaceListState } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceBrowserProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { WorktreeConsoleAdapter } from '../src/console-contract.js'
import { WORKTREE_REVIEW_REFRESH_EVENT } from '../src/client/review-console/status-events.js'
import {
  ManagedOfficialWorkspaceBrowser,
  registerDecoratedWorkspaceSidebar,
  registerManagedWorkspaceSidebar,
} from '../src/client/workspace-sidebar/index.js'
import { createWorktreeConsoleAdapterFixture } from './support/worktree-console.js'

const localSession = 'local-session' as SessionId
const ownerSession = 'owner-session' as SessionId
const localWorkspace = 'project-local' as WorkspaceId
const managedWorkspace = 'managed-workspace' as WorkspaceId

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function state() {
  const sessions = {
    current: localSession,
    ids: [localSession, ownerSession],
    byId: {
      [localSession]: {
        id: localSession, displayTitle: '普通 Local 会话', cwd: 'D:/project', blank: false,
        running: false, updatedAt: 1, origin: 'user' as const,
      },
      [ownerSession]: {
        id: ownerSession, displayTitle: '修复验收卡', cwd: 'D:/project-worktrees/task', blank: false,
        running: false, updatedAt: 2, origin: 'user' as const,
      },
    },
  } as unknown as SessionListState
  const workspaces = {
    items: [
      { workspaceId: localWorkspace, title: 'demo', path: 'D:/project', createdAt: new Date(0).toISOString(), sessionIds: [localSession] },
      { workspaceId: managedWorkspace, title: 'demo--uuid--worktree', path: 'D:/project-worktrees/task', createdAt: new Date(0).toISOString(), sessionIds: [ownerSession] },
    ],
    archivedSessionIds: [], state: 'idle', phase: 'ready', error: null, baselinesReady: true,
  } as unknown as WorkspaceListState
  return { sessions, workspaces }
}

function adapter(): WorktreeConsoleAdapter {
  const fixture = createWorktreeConsoleAdapterFixture().adapter
  return {
    ...fixture,
    sidebarTopology: vi.fn(async () => ({
      ok: true as const,
      value: {
        projects: [{
          project: { id: localWorkspace, name: 'demo' },
          tasks: [{
            checkoutId: 'checkout-1', ownerSessionId: ownerSession, sourceSessionId: localSession,
            iteration: 1, revision: 3, phase: 'ready' as const, state: 'ready_for_review' as const,
          }],
        }],
      },
    })),
  }
}

function browserProps(snapshot = state()): WorkspaceBrowserProps {
  return {
    wide: true,
    expandSidebar: vi.fn(),
    useSessions: selector => selector(snapshot.sessions),
    useWorkspaces: selector => selector(snapshot.workspaces),
    startSession: vi.fn(),
    open: vi.fn(),
    renameSession: vi.fn(),
    forkSession: vi.fn(),
    archiveSession: vi.fn(),
    insertSessionBefore: vi.fn(),
  } as unknown as WorkspaceBrowserProps
}

function InspectBrowser(props: WorkspaceBrowserProps) {
  const workspaces = props.useWorkspaces(value => value.items)
  const sessions = props.useSessions(value => value.byId)
  return <div>
    <button onClick={() => { void props.startSession(managedWorkspace) }}>new managed</button>
    <button onClick={() => { void props.renameSession(ownerSession, '新标题') }}>rename managed</button>
    <button onClick={() => { void props.archiveSession(ownerSession) }}>archive managed</button>
    <button onClick={() => { void props.forkSession(ownerSession) }}>fork managed</button>
    <button onClick={() => { void props.insertSessionBefore(localWorkspace, ownerSession, localSession) }}>move managed</button>
    <button onClick={() => { void props.renameSession(localSession, 'Local 新标题') }}>rename local</button>
    <button onClick={() => { void props.archiveSession(localSession) }}>archive local</button>
    <button onClick={() => { void props.forkSession(localSession) }}>fork local</button>
    {workspaces.map(workspace => <section key={workspace.workspaceId}>
      <h2>{workspace.title}</h2>
      {workspace.sessionIds.map(id => {
        const summary = sessions[id] as typeof sessions[typeof id] & {
          __dshGitWorktree?: { state: string; label: string; kind: string }
        }
        return <button
          key={id}
          data-worktree-kind={summary?.__dshGitWorktree?.kind}
          data-worktree-state={summary?.__dshGitWorktree?.state}
          data-worktree-label={summary?.__dshGitWorktree?.label}
          onClick={() => { props.open(id) }}
        >
          {summary?.displayTitle}
        </button>
      })}
    </section>)}
  </div>
}

describe('Managed Workspace sidebar', () => {
  test('applies one official declaration tree while wrapping only the Browser component', () => {
    const descriptors: Record<string, unknown>[] = []
    const components: unknown[] = []
    const context = {
      effect: vi.fn((setup: () => unknown) => { setup() }),
      locale: { register: vi.fn() },
      slots: {
        inject: (_name: string, callback: () => unknown) => { callback() },
        register: (descriptor: Record<string, unknown>, component: unknown) => {
          descriptors.push(descriptor)
          components.push(component)
          return () => {}
        },
      },
    }

    registerManagedWorkspaceSidebar(context, adapter())

    expect(descriptors).toEqual([
      expect.objectContaining({
        name: 'sidebar.workspaces',
        children: {
          'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' },
        },
      }),
      expect.objectContaining({
        name: 'conversation.hero.workspace',
        children: {
          'conversation.hero.workspace.directoryFlow': { kind: 'single', scope: 'root' },
        },
      }),
    ])
    expect(components[0]).not.toBe(components[1])
    expect(context.locale.register).toHaveBeenCalledWith('workspace', {})
  })

  test('blocks official shortcut mutations until topology is verified, then only protects owners', async () => {
    let deliver!: (value: Awaited<ReturnType<WorktreeConsoleAdapter['sidebarTopology']>>) => void
    const port = adapter()
    const originalTopology = await port.sidebarTopology()
    port.sidebarTopology = vi.fn(() => new Promise(resolve => { deliver = resolve }))
    let guard!: { ready: boolean; blockSession(id: string): boolean; blockWorkspace(id: string): boolean }
    let Browser!: typeof InspectBrowser
    const context = {
      get: (name: string) => name === '__dshGitWorktreeManagedGuard' ? guard : undefined,
      slots: {
        inject: (_name: string, callback: () => unknown) => { callback() },
        register: (descriptor: Record<string, unknown>, component: typeof InspectBrowser) => {
          if (descriptor.name === 'sidebar.workspaces') Browser = component
          return () => {}
        },
      },
    }
    registerManagedWorkspaceSidebar(context, port, (proxy: any) => {
      guard = proxy.get('__dshGitWorktreeManagedGuard')
      proxy.slots.inject('sidebar.workspaces', () => proxy.slots.register({ name: 'sidebar.workspaces' }, InspectBrowser))
    })
    const view = render(<Browser {...browserProps()} />)
    expect(guard.ready).toBe(false)
    expect(guard.blockSession(localSession)).toBe(true)
    expect(guard.blockWorkspace(localWorkspace)).toBe(true)
    deliver(originalTopology)
    await waitFor(() => expect(guard.ready).toBe(true))
    expect(guard.blockSession(ownerSession)).toBe(true)
    expect(guard.blockWorkspace(managedWorkspace)).toBe(true)
    expect(guard.blockSession(localSession)).toBe(false)
    expect(guard.blockWorkspace(localWorkspace)).toBe(false)
    view.unmount()
    expect(guard.ready).toBe(false)
  })

  test('projects one owner Session, allows rename/archive, and silently blocks second-session operations', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
    const props = browserProps()
    render(<ManagedOfficialWorkspaceBrowser
      {...props}
      adapter={adapter()}
      OfficialBrowser={InspectBrowser}
    />)

    await waitFor(() => expect(screen.getByText('修复验收卡').getAttribute('data-worktree-kind')).toBe('managed-worktree'))
    const owner = screen.getByText('修复验收卡')
    expect(owner.getAttribute('data-worktree-state')).toBe('ready_for_review')
    expect(owner.getAttribute('data-worktree-label')).toBe('待验收')
    expect(screen.getByText('普通 Local 会话').getAttribute('data-worktree-kind')).toBeNull()
    expect(screen.queryByText('修复验收卡 · 待验收')).toBeNull()
    expect(screen.getByText('demo')).toBeTruthy()
    expect(screen.queryByText('demo--uuid--worktree')).toBeNull()
    fireEvent.click(owner)
    fireEvent.click(screen.getByText('rename managed'))
    fireEvent.click(screen.getByText('archive managed'))
    fireEvent.click(screen.getByText('fork managed'))
    fireEvent.click(screen.getByText('move managed'))
    fireEvent.click(screen.getByText('new managed'))
    fireEvent.click(screen.getByText('rename local'))
    fireEvent.click(screen.getByText('archive local'))
    fireEvent.click(screen.getByText('fork local'))

    expect(props.open).toHaveBeenCalledWith(ownerSession)
    expect(props.renameSession).toHaveBeenCalledWith(ownerSession, '新标题')
    expect(props.archiveSession).toHaveBeenCalledWith(ownerSession)
    expect(props.renameSession).toHaveBeenCalledWith(localSession, 'Local 新标题')
    expect(props.archiveSession).toHaveBeenCalledWith(localSession)
    expect(props.forkSession).toHaveBeenCalledTimes(1)
    expect(props.forkSession).toHaveBeenCalledWith(localSession)
    expect(props.insertSessionBefore).not.toHaveBeenCalled()
    expect(props.startSession).not.toHaveBeenCalled()
    expect(alert).not.toHaveBeenCalled()
  })

  test('reprojects an archived owner missing from the list and restores it on unarchive', async () => {
    const props = browserProps()
    const snapshot = state()
    const remote = adapter()
    const archivedWorkspaces = { ...snapshot.workspaces, archivedSessionIds: [ownerSession] }
    const missingOwner = {
      ...snapshot.sessions,
      ids: [localSession],
      byId: { [localSession]: snapshot.sessions.byId[localSession] },
    } as SessionListState
    const view = render(<ManagedOfficialWorkspaceBrowser
      {...props}
      useWorkspaces={selector => selector(archivedWorkspaces)}
      useSessions={selector => selector(missingOwner)}
      adapter={remote}
      OfficialBrowser={InspectBrowser}
    />)
    await waitFor(() => expect(screen.queryByText('demo--uuid--worktree')).toBeNull())
    view.rerender(<ManagedOfficialWorkspaceBrowser
      {...props}
      useWorkspaces={selector => selector(snapshot.workspaces)}
      useSessions={selector => selector(snapshot.sessions)}
      adapter={remote}
      OfficialBrowser={InspectBrowser}
    />)
    await waitFor(() => expect(screen.getByRole('button', { name: '修复验收卡' }).getAttribute('data-worktree-label')).toBe('待验收'))
    expect(screen.queryByText('demo--uuid--worktree')).toBeNull()
  })

  test('falls back to the untouched official projection when topology is unavailable', async () => {
    const props = browserProps()
    const unavailable = {
      ...createWorktreeConsoleAdapterFixture().adapter,
      sidebarTopology: vi.fn(async () => ({
        ok: false as const,
        error: { code: 'transport_unavailable' as const, message: 'offline' },
      })),
    }
    render(<ManagedOfficialWorkspaceBrowser
      {...props}
      adapter={unavailable}
      OfficialBrowser={InspectBrowser}
    />)

    await waitFor(() => expect(unavailable.sidebarTopology).toHaveBeenCalled())
    expect(screen.getByText('demo')).toBeTruthy()
    expect(screen.getByText('demo--uuid--worktree')).toBeTruthy()
    expect(screen.queryByText('修复验收卡 · 待验收')).toBeNull()
  })
})

test('switches only managed sidebar badges while official labels and session titles remain intact', async () => {
  const props = browserProps()
  const remote = adapter()
  const view = render(<ClientI18nProvider language="en"><ManagedOfficialWorkspaceBrowser {...props} adapter={remote} OfficialBrowser={InspectBrowser as never} /></ClientI18nProvider>)
  await waitFor(() => expect(screen.getByRole('button', { name: '修复验收卡' }).getAttribute('data-worktree-label')).toBe('Ready for review'))
  expect(screen.getByText('demo')).toBeTruthy()
  view.rerender(<ClientI18nProvider language="zh"><ManagedOfficialWorkspaceBrowser {...props} adapter={remote} OfficialBrowser={InspectBrowser as never} /></ClientI18nProvider>)
  expect(screen.getByRole('button', { name: '修复验收卡' }).getAttribute('data-worktree-label')).toBe('待验收')
  expect(screen.getByText('demo')).toBeTruthy()
  expect(remote.sidebarTopology).toHaveBeenCalledTimes(1)
})


test('renders Host-proven historical members under Local without giving them owner badges', async () => {
  const snapshot = state()
  const historical = 'historical' as SessionId
  snapshot.sessions.ids.push(historical)
  snapshot.sessions.byId[historical] = { ...snapshot.sessions.byId[ownerSession]!, id: historical, displayTitle: '历史会话', blank: false }
  const remote = adapter()
  const original = remote.sidebarTopology.bind(remote)
  remote.sidebarTopology = async () => {
    const result = await original()
    if (result.ok) result.value.projects[0]!.memberships = { workspaceIds: [managedWorkspace], sessionIds: [ownerSession, historical] }
    return result
  }
  const props = browserProps(snapshot)
  render(<ManagedOfficialWorkspaceBrowser {...props} adapter={remote} OfficialBrowser={InspectBrowser} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '历史会话' })).toBeTruthy())
  expect(screen.queryByText('demo--uuid--worktree')).toBeNull()
  const row = screen.getByRole('button', { name: '历史会话' })
  expect(row.getAttribute('data-worktree-kind')).toBeNull()
  fireEvent.click(row)
  expect(props.open).toHaveBeenCalledWith(historical)
})

describe('registerDecoratedWorkspaceSidebar (Mode B: official Workspace stays live)', () => {
  function fakeRegistry() {
    const registered: Array<{ descriptor: Record<string, unknown>; component: unknown }> = []
    const injected: string[] = []
    const service = {
      register: (descriptor: Record<string, unknown>, component: unknown) => {
        registered.push({ descriptor, component })
        return () => {}
      },
      inject: (name: string, callback: () => unknown) => {
        injected.push(name)
        callback()
      },
    }
    return { service, registered, injected }
  }

  function decorateCtx(service: unknown) {
    const effect = vi.fn()
    const ctx: any = {
      get: (key: string) => key === 'slots'
        ? service
        : key === 'locale' ? { getSnapshot: () => ({ active: 'en' }), subscribe: () => () => {} } : undefined,
      effect,
    }
    return { ctx, effect }
  }

  test('decorates through the official child seats instead of shadowing the Browser', () => {
    const registry = fakeRegistry()
    const { ctx, effect } = decorateCtx(registry.service)
    registerDecoratedWorkspaceSidebar(ctx, adapter())
    // Never touches the Browser cell: shadowing cannot re-declare children and
    // renderSlot only authorizes the declaring entry, so this mode must keep
    // the official entry rendering.
    expect(registry.registered.filter(entry => entry.descriptor.name === 'sidebar.workspaces')).toHaveLength(0)
    // DSH 0.2.x declares exactly these two row seats; a trailing seat does not
    // exist, and injecting it would wait forever for a declaration that never
    // arrives (the badge would never mount).
    expect(registry.injected).toContain('sidebar.session.row.leading')
    expect(registry.injected).toContain('sidebar.session.row.hover')
    expect(registry.injected).not.toContain('sidebar.session.row.trailing')
    expect(registry.injected).toContain('sidebar.workspaces.session.menu.item')
    const leading = registry.registered.find(entry => entry.descriptor.name === 'sidebar.session.row.leading')
    expect(leading?.descriptor).toMatchObject({ name: 'sidebar.session.row.leading', id: 'dsh-git-worktree-status' })
    const hover = registry.registered.find(entry => entry.descriptor.name === 'sidebar.session.row.hover')
    expect(hover?.descriptor).toMatchObject({ name: 'sidebar.session.row.hover', id: 'dsh-git-worktree-status' })
    const menu = registry.registered.find(entry => entry.descriptor.name === 'sidebar.workspaces.session.menu.item')
    expect(menu?.descriptor).toMatchObject({ id: 'clear-sidebar-badge' })
    // The topology feed is released with the client fiber.
    expect(effect).toHaveBeenCalledTimes(1)
    const disposer = effect.mock.calls[0]?.[0] as () => void
    expect(() => disposer()).not.toThrow()
  })

  test('renders the worktree status badge for owner rows and nothing for ordinary rows', async () => {
    const registry = fakeRegistry()
    const { ctx } = decorateCtx(registry.service)
    const remote = adapter()
    registerDecoratedWorkspaceSidebar(ctx, remote)
    const badge = registry.registered.find(entry => entry.descriptor.name === 'sidebar.session.row.hover')
    expect(badge).toBeDefined()
    const Badge = badge!.component as (props: { sessionId?: string; seat?: string }) => unknown

    const owner = render(<Badge sessionId={ownerSession} />)
    await waitFor(() => expect(owner.container.textContent).toContain('Ready for review'))
    const badgeNode = owner.container.querySelector('[data-dsh-git-worktree-badge="ready_for_review"]')
    expect(badgeNode?.getAttribute('title')).toBe('Ready for review')
    owner.unmount()

    const ordinary = render(<Badge sessionId={localSession} />)
    expect(ordinary.container.textContent).toBe('')
    ordinary.unmount()

    // The review refresh event re-pulls the topology and updates the badge.
    const owner2 = render(<Badge sessionId={ownerSession} />)
    remote.sidebarTopology = vi.fn(async () => ({
      ok: true as const,
      value: {
        projects: [{
          project: { id: localWorkspace, name: 'demo' },
          tasks: [{
            checkoutId: 'checkout-1', ownerSessionId: ownerSession, sourceSessionId: localSession,
            iteration: 1, revision: 4, phase: 'finalized' as const, state: 'finalized' as const,
            sourceBranch: 'feat/demo',
          }],
        }],
      },
    }))
    fireEvent(window, new CustomEvent(WORKTREE_REVIEW_REFRESH_EVENT, { detail: { sessionId: ownerSession } }))
    await waitFor(() => expect(owner2.container.textContent).toContain('Completed · feat/demo'))
    owner2.unmount()
  })

  test('mirrors the upstream identity mark in both row seats', async () => {
    const registry = fakeRegistry()
    const { ctx } = decorateCtx(registry.service)
    registerDecoratedWorkspaceSidebar(ctx, adapter())
    const leading = registry.registered.find(entry => entry.descriptor.name === 'sidebar.session.row.leading')
    const hover = registry.registered.find(entry => entry.descriptor.name === 'sidebar.session.row.hover')
    expect(leading).toBeDefined()
    expect(hover).toBeDefined()
    const Leading = leading!.component as (props: { sessionId?: string; seat?: string }) => unknown
    const Hover = hover!.component as (props: { sessionId?: string; seat?: string }) => unknown

    // The leading seat is 16px wide: the branch glyph carries the identity and
    // the state words live in the tooltip, exactly like the upstream takeover.
    const leadNode = render(<Leading sessionId={ownerSession} seat="sidebar.session.row.leading" />)
    await waitFor(() => expect(leadNode.container.querySelector('.dsh-git-worktree-sidebar-icon')).not.toBeNull())
    expect(leadNode.container.querySelector('.dsh-git-worktree-sidebar-badge')).toBeNull()
    expect(leadNode.container.querySelector('.dsh-git-worktree-sidebar-icon')?.getAttribute('title'))
      .toBe('Ready for review')
    leadNode.unmount()

    // The hover card has room for the glyph AND the state chip.
    const hoverNode = render(<Hover sessionId={ownerSession} seat="sidebar.session.row.hover" />)
    await waitFor(() => expect(hoverNode.container.textContent).toContain('Ready for review'))
    expect(hoverNode.container.querySelector('.dsh-git-worktree-sidebar-icon')).not.toBeNull()
    expect(hoverNode.container.querySelector('.dsh-git-worktree-sidebar-badge')?.textContent)
      .toBe('Ready for review')
    hoverNode.unmount()
  })

  test('fails loudly when the slot registry is unavailable', () => {
    const { ctx } = decorateCtx(undefined)
    expect(() => registerDecoratedWorkspaceSidebar(ctx, adapter())).toThrow(/slot registry/u)
  })

  test('fails loudly when the registry has no inject seam', () => {
    const { ctx } = decorateCtx({ register: () => () => {} })
    expect(() => registerDecoratedWorkspaceSidebar(ctx, adapter())).toThrow(/slot registry/u)
  })

  test('mounts the clear-badge menu entry, clears a terminal badge, and refreshes the sidebar', async () => {
    const terminal = adapter()
    const clearSidebarBadge = vi.fn(async () => ({ ok: true as const, value: { target: {} } as never }))
    terminal.clearSidebarBadge = clearSidebarBadge
    let entry!: ComponentType<{ sessionId?: string; useMenuOpenState?: () => readonly [boolean, (open: boolean) => void] }>
    const Entry = (menuProps: { sessionId?: string }) => {
      const EntryComponent = entry
      return EntryComponent ? <EntryComponent {...menuProps} /> : null
    }
    const props = browserProps()
    const view = render(<ManagedOfficialWorkspaceBrowser
      {...props}
      adapter={terminal}
      OfficialBrowser={InspectBrowser}
      registerSessionMenuEntry={(descriptor, component) => {
        expect(descriptor).toMatchObject({ name: 'sidebar.workspaces.session.menu.item', id: 'clear-sidebar-badge' })
        entry = component
        return () => {}
      }}
    />)
    await waitFor(() => expect(screen.getByRole('button', { name: '修复验收卡' })).toBeTruthy())
    expect(entry).toBeDefined()

    // Non-terminal rows render nothing.
    const hidden = render(<Entry sessionId={ownerSession} />)
    expect(hidden.container.textContent).toBe('')
    hidden.unmount()

    // Terminal rows offer the entry after a topology refresh; selecting it routes the RPC.
    terminal.sidebarTopology = vi.fn(async () => ({
      ok: true as const,
      value: {
        projects: [{
          project: { id: localWorkspace, name: 'demo' },
          tasks: [{
            checkoutId: 'checkout-1', ownerSessionId: ownerSession, sourceSessionId: localSession,
            iteration: 1, revision: 9, phase: 'discarded' as const, state: 'discarded' as const,
          }],
        }],
      },
    }))
    fireEvent(window, new CustomEvent(WORKTREE_REVIEW_REFRESH_EVENT, { detail: { sessionId: ownerSession } }))
    const entryView = render(<Entry sessionId={ownerSession} />)
    const clearButton = await waitFor(() => {
      const button = entryView.container.querySelector('button')
      expect(button?.textContent).toContain('状态标签')
      return button!
    })
    fireEvent.click(clearButton)
    await waitFor(() => expect(clearSidebarBadge).toHaveBeenCalledWith({
      sessionId: ownerSession, checkoutId: 'checkout-1', expectedRevision: 9,
    }))
    entryView.unmount()
    view.unmount()
  })
})
