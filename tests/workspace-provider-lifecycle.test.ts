import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Group, Loader, type EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import Include, { applyEntryPatches, entryListSchema, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { ClientModuleRegistry } from '@deepseek-ai/dsh-client-modules'
import { mountWorkspaceProviderLifecycle } from '../src/workspace-provider-lifecycle.js'
import type { WorkspaceClientFlavor } from '../src/host-compat.js'

const require = createRequire(import.meta.url)
const yaml = createRequire(require.resolve('@deepseek-ai/cordis-plugin-include'))('js-yaml') as {
  load(text: string, options: { schema: unknown }): unknown
}
const OFFICIAL = '@deepseek-ai/dsh-client-ui-workspace'
const WORKTREE = 'dsh-git-worktree'
const disposals: Array<() => Promise<void>> = []
afterEach(async () => { for (const dispose of disposals.splice(0).reverse()) await dispose() })

function entries(disabled: boolean): EntryOptions[] {
  const patch = yaml.load(readFileSync(resolve('cordis.patch.yml'), 'utf8'), { schema: entryListSchema }) as PatchOptions[]
  return applyEntryPatches([{ id: 'ui-workspace', name: OFFICIAL }], [
    ...patch,
    ...(disabled ? [{ id: WORKTREE, disabled: true }] : []),
  ], message => { throw new Error(message) })
}

async function boot(data: EntryOptions[], replayDisabled = false, delayedImport?: string, childEntries?: EntryOptions[], failApply = false, flavor: WorkspaceClientFlavor = 'legacy', takeover: boolean | { operationTimeoutMs?: number, wedge?: 'never' | 'deferred' } = true) {
  const dir = mkdtempSync(join(tmpdir(), 'workspace-provider-'))
  const paths = new Map<string, string>()
  for (const [index, name] of [OFFICIAL, WORKTREE, 'group-owner', 'fixture-include'].entries()) {
    const root = join(dir, String(index))
    mkdirSync(root)
    const manifest = join(root, 'package.json')
    writeFileSync(manifest, JSON.stringify({ name, exports: { './client': './client.js' }, ...([OFFICIAL, WORKTREE].includes(name) ? { dsh: { client: { platform: 'web' } } } : {}) }))
    writeFileSync(join(root, 'client.js'), `window.__ModuleLoader__.load({id: ${JSON.stringify(name)}, factory: () => ({})});`)
    paths.set(name, manifest)
  }
  if (childEntries) {
    const childPath = join(dir, 'child.json')
    writeFileSync(childPath, JSON.stringify(childEntries))
    data = [...data, { id: 'include', name: 'fixture-include', config: { path: pathToFileURL(childPath).href } }]
  }
  let applied = false
  const ctx = new Context()
  disposals.push(async () => { await ctx.fiber.dispose(); rmSync(dir, { recursive: true, force: true }) })
  await ctx.plugin(Loader, { baseUrl: pathToFileURL(join(dir, 'entry.js')).href })
  ctx.loader.internal = {
    version: 'v2',
    import: async (name: string) => {
      if (name === delayedImport) await new Promise(resolve => setTimeout(resolve, 20))
      return name === 'fixture-include' ? Include : name === 'group-owner' ? Group : name === WORKTREE
        ? { inject: { loader: { await: false } }, async apply(ctx: Context) {
          if (takeover.wedge) {
            const official = [...ctx.loader.entries()].find(entry => entry.options.name === OFFICIAL)
            if (official) {
              const real = official.update.bind(official)
              const wedged = takeover.wedge === 'deferred'
                ? (...args: Parameters<typeof real>) => new Promise<unknown>(resolve => {
                  setTimeout(() => { void real(...args).then(resolve, resolve) }, 30)
                })
                : () => new Promise<void>(() => {})
              Object.assign(official, { update: wedged })
            }
          }
          await mountWorkspaceProviderLifecycle(ctx, flavor, {
            enabled: takeover !== false,
            ...(typeof takeover === 'object' && takeover.operationTimeoutMs !== undefined
              ? { operationTimeoutMs: takeover.operationTimeoutMs } : {}),
          })
          applied = true
          if (failApply) throw new Error('fixture: replacement initialization failed')
        } }
        : { apply() {} }
    },
    resolveSync: (_base: string, request: { specifier: string }) => {
      const path = paths.get(request.specifier.replace(/\/package\.json$/, ''))
      if (!path) throw new Error(`unexpected package ${request.specifier}`)
      return { url: pathToFileURL(path).href }
    },
  } as never
  if (replayDisabled) {
    ctx.on('internal/plugin', fiber => {
      if (fiber.entry?.options.name !== WORKTREE || !fiber.uid) return
      // Market replays its persisted disable list when a bundle entry appears.
      void fiber.entry.update({ disabled: true }, false, true)
    })
  }
  // Register the actual module scanner before Loader entries, as in Web boot.
  ctx.provide('webServer', { register: () => () => {} } as never)
  await ctx.plugin(ClientModuleRegistry)
  await ctx.loader.root.update(data)
  await ctx.loader.await()
  // Election reconciliation is fire-and-forget by contract; let its Loader
  // operations and the module-registry flush land before assertions read them.
  await new Promise(resolve => setImmediate(resolve))
  return { ctx, applied: () => applied, graph: () => ctx.clientModules.graph().entries.map(entry => entry.id) }
}

describe('Workspace provider lifecycle (real Cordis Loader and Web module registry)', () => {
  test('the published patch no longer patches the official entry (the Host lifecycle owns the election)', () => {
    const official = entries(false).find(entry => entry.name === OFFICIAL)
    expect(official).toBeDefined()
    expect(official!.disabled).toBeUndefined()
  })

  test('a disabled Worktree entry with its bundle still installed boots the official Workspace', async () => {
    const legacy = entries(true)
    legacy[0]!.disabled = true
    expect((await boot(legacy)).graph()).toEqual([])

    const { graph } = await boot(entries(true))
    expect(graph()).toEqual([OFFICIAL])
  })

  test('an unknown Host generation leaves the official Workspace active', async () => {
    const { ctx, graph } = await boot(entries(false), false, undefined, undefined, false, 'unsupported')
    expect(graph()).toContain(OFFICIAL)
    expect(ctx.get('worktreeWorkspaceProvider')).toBeUndefined()
  })

  test('takeover is opt-in: an enabled Worktree entry without enableWorkspaceProvider keeps the official Workspace', async () => {
    const { ctx, graph } = await boot(entries(false), false, undefined, undefined, false, 'legacy', false)
    expect(graph()).toContain(OFFICIAL)
    expect(ctx.get('worktreeWorkspaceProvider')).toBeUndefined()
  })

  test('takeover stays opt-in on modern hosts: enableWorkspaceProvider is not advisory', async () => {
    const { ctx, graph } = await boot(entries(false), false, undefined, undefined, false, 'modern-rc5', false)
    expect(graph()).toContain(OFFICIAL)
    expect(ctx.get('worktreeWorkspaceProvider')).toBeUndefined()
  })

  test('the modern auto-takeover does not resurrect a user-disabled Worktree entry', async () => {
    const { ctx, graph } = await boot(entries(true), false, undefined, undefined, false, 'modern-rc5', false)
    expect(graph()).toEqual([OFFICIAL])
    expect(ctx.get('worktreeWorkspaceProvider')).toBeUndefined()
  })

  test.each([false, true])('enabled plugin keeps exactly the Managed provider (replacement first: %s)', async (replacementFirst) => {
    const data = entries(false)
    if (replacementFirst) data.reverse()
    expect((await boot(data)).graph()).toEqual([WORKTREE])
  })

  test.each([false, true])('disabled plugin restores the official provider (replacement first: %s)', async (replacementFirst) => {
    const data = entries(true)
    if (replacementFirst) data.reverse()
    expect((await boot(data)).graph()).toEqual([OFFICIAL])
  })

  test('a removed replacement entry leaves the official provider enabled', async () => {
    expect((await boot(entries(false).filter(entry => entry.name !== WORKTREE))).graph()).toEqual([OFFICIAL])
  })

  test('a disabled owning group does not suppress the official provider outside that group', async () => {
    const [official, replacement] = entries(false)
    const { graph } = await boot([
      official!,
      { id: 'group-owner', name: 'group-owner', disabled: true, config: [replacement!] },
    ])
    expect(graph()).toEqual([OFFICIAL])
  })

  test.each([false, true])('market disable replay restores the official provider (replacement first: %s)', async (replacementFirst) => {
    const data = entries(false)
    if (replacementFirst) data.reverse()
    expect((await boot(data, true)).graph()).toEqual([OFFICIAL])
  })

  test.each([OFFICIAL, WORKTREE])('provider election tolerates delayed module import: %s', async name => {
    expect((await boot(entries(false), false, name)).graph()).toEqual([WORKTREE])
  })

  test('a replacement discovered in a delayed Include removes the earlier official graph row', async () => {
    const [official, replacement] = entries(false)
    const { graph } = await boot([official!], false, 'fixture-include', [replacement!])
    expect(graph()).toEqual([WORKTREE])
  })

  test('a late official Include cannot create a second provider', async () => {
    const [official, replacement] = entries(false)
    const { graph } = await boot([replacement!], false, 'fixture-include', [official!])
    expect(graph()).toEqual([WORKTREE])
  })

  test('live disable, market replay and re-enable reconcile the Web graph without persisting flags', async () => {
    const { ctx, graph } = await boot(entries(false))
    const replacement = [...ctx.loader.entries()].find(entry => entry.options.name === WORKTREE)!
    const official = [...ctx.loader.entries()].find(entry => entry.options.name === OFFICIAL)!
    // Loader 1.1.0 replaces the tree's `write()` persistence hook with
    // `commit(change)`; only `EntryTree` mutations report through it, so a
    // lifecycle that touches entries directly must leave it untouched.
    const commit = vi.spyOn(official.parent.tree, 'commit')
    for (const disabled of [true, false, true]) {
      await replacement.update({ disabled }, false, true)
      await ctx.loader.await()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(graph()).toEqual([disabled ? OFFICIAL : WORKTREE])
      // A disable adopts (writes a plain `disabled: true` on the official
      // entry); a re-enable/restore deletes the key entirely — the lifecycle
      // never bakes a flag into the entry options beyond ownership itself.
      expect(official.options.disabled).toBe(disabled ? undefined : true)
    }
    expect(commit).not.toHaveBeenCalled()
  })

  test('restarting a live replacement retains its fiber and elects only its provider', async () => {
    const { ctx, graph } = await boot(entries(false))
    const replacement = [...ctx.loader.entries()].find(entry => entry.options.name === WORKTREE)!
    const fiber = replacement.fiber!
    await fiber.restart()
    await ctx.loader.await()
    await vi.waitFor(() => expect(graph()).toEqual([WORKTREE]))
    expect(replacement.fiber === fiber).toBe(true)
    expect(ctx.get('worktreeWorkspaceProvider')).toBe(true)
  })

  test('old generation cleanup cannot withdraw a concurrently initialized replacement fiber', async () => {
    const { ctx, graph } = await boot(entries(false))
    const replacement = [...ctx.loader.entries()].find(entry => entry.options.name === WORKTREE)!
    const old = replacement.fiber!
    // Entry disable schedules disposal, clearing uid before effects finish.
    // Re-enable can install the next generation while old cleanup is pending.
    // Direct fiber.dispose() on an enabled entry would intentionally persist a
    // user disable through Loader, so exercise the real entry update path.
    await replacement.update({ disabled: true }, false, true)
    const disposed = old.dispose()
    await replacement.update({ disabled: false }, false, true)
    const current = replacement.fiber!
    await disposed
    await current.await()
    await ctx.loader.await()
    await vi.waitFor(() => expect(graph()).toEqual([WORKTREE]))
    expect(current === old).toBe(false)
    expect(replacement.fiber === current).toBe(true)
    expect(ctx.get('worktreeWorkspaceProvider')).toBe(true)
  })

  test('failed replacement activation restores the official provider', async () => {
    const { ctx, graph } = await boot(entries(true), false, undefined, undefined, true)
    const replacement = [...ctx.loader.entries()].find(entry => entry.options.name === WORKTREE)!
    // Loader 1.0.6 update schedules activation; the fiber owns its outcome.
    await replacement.update({ disabled: false }, false, true)
    await expect(replacement.fiber!.await()).rejects.toThrow('fixture: replacement initialization failed')
    await ctx.loader.await()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(graph()).toEqual([OFFICIAL])
    expect(replacement.fiber).toBeUndefined()
    expect(replacement.options.disabled).toBe(false)
    expect(ctx.get('worktreeWorkspaceProvider')).toBeUndefined()
  })

  test('explicit user Workspace disabled overrides are not owned by the replacement lifecycle', async () => {
    const data = entries(false)
    data[0]!.disabled = true
    const { ctx, graph } = await boot(data)
    const replacement = [...ctx.loader.entries()].find(entry => entry.options.name === WORKTREE)!
    const official = [...ctx.loader.entries()].find(entry => entry.options.name === OFFICIAL)!
    await replacement.update({ disabled: true }, false, true)
    await ctx.loader.await()
    expect(official.options.disabled).toBe(true)
    expect(official.fiber).toBeUndefined()
    expect(graph()).toEqual([])
  })

  test('root disposal does not resurrect the official provider', async () => {
    const { ctx } = await boot(entries(false))
    const official = [...ctx.loader.entries()].find(entry => entry.options.name === OFFICIAL)!
    let restored = 0
    const off = ctx.on('internal/plugin', fiber => {
      if (fiber.uid && fiber.entry?.options.name === OFFICIAL) restored++
    })
    await ctx.fiber.dispose()
    off()
    expect(restored).toBe(0)
    expect(official.fiber?.uid ?? null).toBeNull()
  })

  test('restart after disable and re-enable reselects one provider without baking state into the patch', async () => {
    const original = readFileSync(resolve('cordis.patch.yml'), 'utf8')
    for (const disabled of [false, true, false, true]) {
      expect((await boot(entries(disabled))).graph()).toEqual([disabled ? OFFICIAL : WORKTREE])
    }
    expect(readFileSync(resolve('cordis.patch.yml'), 'utf8')).toBe(original)
  })

  test('a wedged official disable never blocks replacement activation', async () => {
    const { ctx, applied, graph } = await boot(entries(false), false, undefined, undefined, false, 'legacy',
      { operationTimeoutMs: 20, wedge: 'never' })
    expect(applied()).toBe(true)
    expect(ctx.get('worktreeWorkspaceProvider')).toBe(true)
    // In the fixture the official entry wins the boot race and activates
    // before the election flips the expression, so its graph row lingers
    // only while the wedged Loader operation refuses to settle; activation
    // itself was never held hostage, which is the regression this guards.
    expect(graph()).toEqual([OFFICIAL, WORKTREE])
  })

  test('a slow official disable lands after activation without a second provider', async () => {
    const { ctx, graph } = await boot(entries(false), false, undefined, undefined, false, 'legacy',
      { wedge: 'deferred' })
    expect(graph()).toContain(WORKTREE)
    await new Promise(resolve => setTimeout(resolve, 60))
    const official = [...ctx.loader.entries()].find(entry => entry.options.name === OFFICIAL)!
    // Loader 1.0.6 retains the disposed fiber reference. Assert the public
    // disposal identity rather than pretty-printing a Cordis Context object.
    expect(official.fiber?.uid ?? null).toBeNull()
    expect(graph()).toEqual([WORKTREE])
  })
})
