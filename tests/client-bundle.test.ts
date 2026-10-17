// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { describe, expect, test, vi } from 'vitest'
import { createWorktreeConsoleAdapterFixture } from './support/worktree-console.js'

interface ClientHandoff {
  id: string
  factory(require: (specifier: string) => unknown): Record<string, unknown>
}

function platformRequire(nodeRequire: NodeRequire, specifier: string): unknown {
  if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return { Modal: () => null, Menu: () => null }
  return nodeRequire(specifier)
}

/**
 * 0.2.1-rc.1 gateway `./client` export splits into node (pure ESM) and
 * browser (ModuleLoader handoff bundle); the handoff contract under test
 * lives in the browser artifact, so resolve it by file.
 */
function gatewayBrowserClientPath(): string {
  const nodeRequire = createRequire(import.meta.url)
  return resolve(join(dirname(nodeRequire.resolve('@deepseek-ai/dsh-api-gateway/package.json')), 'lib', 'client.browser.js'))
}

function executeBundle(code: string): ClientHandoff {
  let handoff: ClientHandoff | undefined
  const window = {
    __ModuleLoader__: {
      load(value: ClientHandoff) { handoff = value },
    },
  }
  new Function('window', code)(window)
  if (handoff === undefined) throw new Error('bundle did not register a ModuleLoader handoff')
  return handoff
}

/** Minimal shared configuration-forms service: the card mounts, its namespace is never served. */
function configFormsStub() {
  return {
    get: () => ({
      getSnapshot: () => ({ status: 'unavailable', value: undefined, base: undefined, user: undefined, writable: false, revision: undefined }),
      subscribe: () => () => {},
      mutate: async () => false,
    }),
    whileServed: (_names: readonly string[], callback: () => unknown) => { callback(); return () => {} },
  }
}

describe('built Client ModuleLoader artifact', () => {
  test('inlines strict Remote codecs instead of requiring packages absent from the browser module table', () => {
    const source = readFileSync(resolve('lib/client.js'), 'utf8')
    const required = [...new Set([...source.matchAll(/require\(["']([^"']+)["']\)/gu)].map(match => match[1]))]
    expect(required).toEqual([
      'react',
      'react/jsx-runtime',
      '@deepseek-ai/dsh-client-ui-primitives',
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-client-store',
    ])
  })

  test('Given the emitted browser script When it executes Then it registers the package id and materializable exports', () => {
    const handoff = executeBundle(readFileSync(resolve('lib/client.js'), 'utf8'))
    expect(handoff.id).toBe('dsh-git-worktree')
    const nodeRequire = createRequire(import.meta.url)
    const clientExports = handoff.factory(specifier => platformRequire(nodeRequire, specifier))
    expect(clientExports.apply).toBeTypeOf('function')
    expect(clientExports.inject).toEqual([
      'slots',
      'sessions',
      'workspaces',
      'locale',
      'remote',
      'layout',
      'shortcuts',
      'configForms',
    ])
    expect(clientExports.inject).not.toContain('conversation')
    expect(clientExports.inject).not.toContain('connection')
    // The modern picker provider entry waits for `uiWorkspace`; requiring it at
    // entry scope would deadlock the web boot (provider cycle).
    expect(clientExports.inject).not.toContain('remote.directoryPicker')
    // The 0.2.1-only `remoteAccess` service is likewise version-sensitive: the
    // desktop profile loads this bundle on 0.2.0-rc.2 through a junction, and a
    // static declaration left that host's web boot pending forever
    // ("14 entries did not activate", 2026-10-17). The managed proxy stubs it.
    expect(clientExports.inject).not.toContain('remoteAccess')
  })

  test('restores uiWorkspace before conversation, then mounts Worktree surfaces and withdraws them with the fiber', async () => {
    const nodeRequire = createRequire(import.meta.url)
    const gatewayPath = gatewayBrowserClientPath()
    const gateway = executeBundle(readFileSync(gatewayPath, 'utf8')).factory(nodeRequire) as {
      apply(ctx: Context): void
      inject: string[]
    }
    const worktreeHandoff = executeBundle(readFileSync(resolve('lib/client.js'), 'utf8'))
    const worktree = worktreeHandoff.factory(specifier => platformRequire(nodeRequire, specifier)) as {
      apply(ctx: Context): void
      inject: string[]
    }
    const fixture = createWorktreeConsoleAdapterFixture()
    const expected = await fixture.adapter.current({ sessionId: 'agent-1' })
    const call = vi.fn(async (_url: string, method: string) => ({
      ok: true as const,
      value: method === 'gitWorktree/sidebarTopology' ? await fixture.adapter.sidebarTopology() : expected,
    }))
    const ctx = new Context()
    await ctx.plugin(TypertRegistry)
    ctx.provide('connection', {
      rpc: { call },
      registerGenerationSource: () => () => {},
      start: () => ({ stop() {} }),
    } as never)
    await ctx.plugin({ inject: gateway.inject, apply: gateway.apply })
    const register = vi.fn()
    ctx.provide('slots', {
      inject(_name: string, callback: () => unknown) { callback() },
      register: vi.fn((...args: unknown[]) => { register(...args); return () => {} }),
      registerFactory: vi.fn(() => () => {}),
      provideRoot() {},
      entries: () => [],
      subscribe: () => () => {},
    } as never)
    ctx.provide('configForms', configFormsStub() as never)
    const source = <T,>(snapshot: T) => ({
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
    })
    ctx.provide('workspaces', {
      list: source({ items: [], archivedSessionIds: [], phase: 'ready' }),
    } as never)
    ctx.provide('sessions', {
      list: source({ ids: [], byId: {}, current: undefined, phase: 'ready' }),
      clear() {},
      open() {},
      searchResultLimit: 100,
    } as never)
    ctx.provide('locale', { register: vi.fn(), bind: () => () => '' } as never)
    ctx.provide('remote.directoryPicker', {} as never)
    // The 0.2.1 official workspace apply reads `ctx.remoteAccess` for the
    // slot-root keyed hook; the real service comes from the gateway client.
    ctx.provide('remoteAccess', { source: () => ({}) } as never)
    ctx.provide('layout', { beginNavigation: () => new AbortController().signal } as never)
    ctx.provide('shortcuts', { register: vi.fn(() => () => {}) } as never)

    const fiber = ctx.plugin({ inject: worktree.inject, apply: worktree.apply })
    await fiber
    expect(ctx.worktreeConsole).toBeDefined()
    expect(ctx.uiWorkspace).toBeDefined()

    // uiConversation cannot activate before uiWorkspace exists. The package
    // root must therefore settle without the conversation service, while the
    // conversation-dependent Worktree surfaces remain in their child fiber.
    expect(register.mock.calls.map(call => call[0])).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'tool.call.toolview', key: 'worktree_create' }),
    ]))

    ctx.provide('conversation', {
      blocks: { set() {}, storeFor: () => ({ getSnapshot: () => undefined }) },
      input: { for: () => ({ setDraft() {}, addImages: () => true, removeImage() {} }) },
    } as never)
    await vi.waitFor(() => expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'tool.call.toolview', key: 'worktree_create' }),
      expect.any(Function),
    ))

    // The client-module system adopts any head <style> without data-plugin for
    // whichever module materializes next and sweeps it on that module's
    // invalidation/prune. The sheet must carry this bundle's registration id.
    const sheet = document.querySelector('style[data-dsh-git-worktree]')
    expect(sheet?.getAttribute('data-plugin')).toBe(worktreeHandoff.id)
    for (const el of document.querySelectorAll('style:not([data-plugin])')) el.setAttribute('data-plugin', 'foreign-chunk')
    for (const el of document.querySelectorAll('style[data-plugin="foreign-chunk"]')) el.remove()
    expect(document.querySelector('style[data-dsh-git-worktree]')).not.toBeNull()

    const descriptors = register.mock.calls.map(call => call[0])
    expect(descriptors).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'tool.call.toolview', key: 'worktree_create' }),
      expect.objectContaining({ name: 'tool.call.toolview', key: 'worktree_ready_for_review' }),
      expect.objectContaining({ name: 'conversation.session.header.actions', id: 'worktree-target' }),
      expect.objectContaining({ name: 'conversation.input.dock', id: 'worktree-review-status' }),
    ]))
    expect(descriptors).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'conversation.view', id: 'worktree' }),
    ]))
    expect(descriptors.filter(descriptor => descriptor.name === 'sidebar.workspaces')).toHaveLength(1)
    expect(descriptors.filter(descriptor => descriptor.name === 'conversation.hero.workspace')).toHaveLength(1)
    await expect(ctx.worktreeConsole.current({ sessionId: 'agent-1' })).resolves.toEqual(expected)
    expect(call).toHaveBeenCalledWith('/api', 'gitWorktree/current', { args: { agentId: 'agent-1', locale: 'zh' } }, expect.any(AbortSignal))
    expect((ctx.remote as unknown as Record<string, unknown>).gitWorktree).toBeDefined()

    await fiber.dispose()
    expect((ctx.remote as unknown as Record<string, unknown>).gitWorktree).toBeUndefined()
    expect(document.querySelector('style[data-dsh-git-worktree]')).toBeNull()
  })

  test('boots a modern Host whose picker provider waits for uiWorkspace, then resolves picker calls lazily', async () => {
    const nodeRequire = createRequire(import.meta.url)
    const gatewayPath = gatewayBrowserClientPath()
    const gateway = executeBundle(readFileSync(gatewayPath, 'utf8')).factory(nodeRequire) as {
      apply(ctx: Context): void
      inject: string[]
    }
    const worktree = executeBundle(readFileSync(resolve('lib/client.js'), 'utf8'))
      .factory(specifier => platformRequire(nodeRequire, specifier)) as {
      apply(ctx: Context): void
      inject: string[]
    }
    const fixture = createWorktreeConsoleAdapterFixture()
    const expected = await fixture.adapter.current({ sessionId: 'agent-1' })
    const modernTopology = await fixture.adapter.sidebarTopology()
    // The 0.2.x directory-picker provider entry is pending on uiWorkspace, so
    // this context deliberately never provides `remote.directoryPicker` up front.
    const call = vi.fn(async (_url: string, method: string) => ({
      ok: true as const,
      value: method === 'gitWorktree/sidebarTopology'
        ? { ...modernTopology, value: { ...modernTopology.value, workspaceClientFlavor: 'modern' } }
        : expected,
    }))
    const ctx = new Context()
    await ctx.plugin(TypertRegistry)
    ctx.provide('connection', {
      rpc: { call },
      registerGenerationSource: () => () => {},
      start: () => ({ stop() {} }),
    } as never)
    await ctx.plugin({ inject: gateway.inject, apply: gateway.apply })
    const register = vi.fn()
    ctx.provide('slots', {
      inject(_name: string, callback: () => unknown) { callback() },
      register: vi.fn((...args: unknown[]) => { register(...args); return () => {} }),
      registerFactory: vi.fn(() => () => {}),
      provideRoot() {},
      entries: () => [],
      subscribe: () => () => {},
    } as never)
    ctx.provide('configForms', configFormsStub() as never)
    const source = <T,>(snapshot: T) => ({
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
    })
    ctx.provide('workspaces', {
      list: source({ items: [], archivedSessionIds: [], phase: 'ready' }),
    } as never)
    ctx.provide('sessions', {
      list: source({ ids: [], byId: {}, current: undefined, phase: 'ready' }),
      clear() {},
      open() {},
      searchResultLimit: 100,
    } as never)
    ctx.provide('locale', { register: vi.fn(), bind: () => () => '' } as never)
    // The 0.2.1 official workspace apply reads `ctx.remoteAccess` for the
    // slot-root keyed hook; the real service comes from the gateway client.
    ctx.provide('remoteAccess', { source: () => ({}) } as never)
    ctx.provide('layout', { beginNavigation: () => new AbortController().signal } as never)
    ctx.provide('shortcuts', { register: vi.fn(() => () => {}) } as never)

    const fiber = ctx.plugin({ inject: worktree.inject, apply: worktree.apply })
    await fiber
    // Without the filtered inject this fiber could never settle: the entry
    // would wait for `remote.directoryPicker`, which waits for `uiWorkspace`.
    expect(ctx.uiWorkspace).toBeDefined()

    // Picker actions fail cleanly while the provider entry is still absent.
    await expect(ctx.uiWorkspace.pickDirectory()).rejects.toThrow(/not active/)

    // Once the provider entry activates below uiWorkspace, the same call path
    // reaches the real service without restarting the plugin.
    const pick = vi.fn(async () => ({ ok: true }))
    ctx.provide('remote.directoryPicker', { pick } as never)
    await ctx.uiWorkspace.pickDirectory()
    expect(pick).toHaveBeenCalledOnce()

    await fiber.dispose()
  })
})

test('Lucide is bundled as selected ESM icons while React stays a host dependency', () => {
  const source = readFileSync(resolve('lib/client.js'), 'utf8')
  expect(source).not.toMatch(/require\(["']lucide-react["']\)/)
  expect(source).not.toContain('dist/cjs/lucide-react.js')
  expect(source).not.toContain('react.development.js')
  expect(source).not.toContain('react.production.min.js')
  expect(source).toContain('lucide-')
  expect(source).toMatch(/require\(["']react["']\)/)
})
