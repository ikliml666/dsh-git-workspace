import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Loader, type Entry, type EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import type { ToolGuard } from '@deepseek-ai/dsh-tools'
import { mountOfficialWorktreeTakeover, type OfficialWorktreeTakeoverResult } from '../src/official-worktree-takeover.js'

const WORKTREE_SERVICE = '@deepseek-ai/dsh-experimental-worktree'
const WORKTREE_TOOL = '@deepseek-ai/dsh-experimental-tool-worktree'
const HOST = 'fixture-takeover-host'

const disposals: Array<() => Promise<void>> = []
afterEach(async () => { for (const dispose of disposals.splice(0).reverse()) await dispose() })

interface Harness {
  ctx: Context
  /** Guards the Host currently has registered, in registration order. */
  guards: ToolGuard[]
  /** What the takeover reported at activation. */
  result: () => OfficialWorktreeTakeoverResult | undefined
  entry: (name: string) => Entry
}

async function boot(data: EntryOptions[]): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'worktree-takeover-'))
  const paths = new Map<string, string>()
  for (const [index, name] of [WORKTREE_SERVICE, WORKTREE_TOOL, HOST].entries()) {
    const root = join(dir, String(index))
    mkdirSync(root)
    const manifest = join(root, 'package.json')
    writeFileSync(manifest, JSON.stringify({ name, exports: { './client': './client.js' } }))
    writeFileSync(join(root, 'client.js'), `window.__ModuleLoader__.load({id: ${JSON.stringify(name)}, factory: () => ({})});`)
    paths.set(name, manifest)
  }
  const ctx = new Context()
  disposals.push(async () => {
    await ctx.fiber.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  const guards: ToolGuard[] = []
  // The real Tools service registers globally without a scoped context; the
  // fixture only needs that contract plus a disposer per registration.
  ctx.provide('tools', {
    guard: (guard: ToolGuard) => {
      guards.push(guard)
      return () => {
        const index = guards.indexOf(guard)
        if (index >= 0) guards.splice(index, 1)
      }
    },
  } as never)
  await ctx.plugin(Loader, { baseUrl: pathToFileURL(join(dir, 'entry.js')).href })
  let result: OfficialWorktreeTakeoverResult | undefined
  ctx.loader.internal = {
    version: 'v2',
    import: async (name: string) => name === HOST
      ? {
        inject: { tools: { required: true }, loader: { required: true } },
        async apply(hostCtx: Context) {
          result = await mountOfficialWorktreeTakeover(hostCtx)
        },
      }
      : { apply() {} },
    resolveSync: (_base: string, request: { specifier: string }) => {
      const path = paths.get(request.specifier.replace(/\/package\.json$/, ''))
      if (!path) throw new Error(`unexpected package ${request.specifier}`)
      return { url: pathToFileURL(path).href }
    },
  } as never
  await ctx.loader.root.update(data)
  await ctx.loader.await()
  await new Promise(resolve => setImmediate(resolve))
  const entry = (name: string): Entry => {
    const found = [...ctx.loader.entries()].find(candidate => candidate.options.name === name)
    if (found === undefined) throw new Error(`fixture: missing entry ${name}`)
    return found
  }
  return { ctx, guards, entry, result: () => result }
}

const officialEntries = (): EntryOptions[] => [
  { id: 'worktree', name: WORKTREE_SERVICE },
  { id: 'tool-worktree', name: WORKTREE_TOOL },
  { id: 'host', name: HOST },
]

describe('Official Worktree takeover (real Cordis Loader)', () => {
  test('disables the official Worktree service and tool entries', async () => {
    const { entry, result } = await boot(officialEntries())
    expect(entry(WORKTREE_SERVICE).options.disabled).toBe(true)
    expect(entry(WORKTREE_TOOL).options.disabled).toBe(true)
    expect(entry(WORKTREE_SERVICE).disabled).toBe(true)
    expect(entry(WORKTREE_TOOL).disabled).toBe(true)
    expect(result()?.disabled.sort()).toEqual(['tool-worktree', 'worktree'])
  })

  test('denies create_worktree by tool name and leaves every other tool alone', async () => {
    const { guards } = await boot(officialEntries())
    expect(guards).toHaveLength(1)
    expect(guards[0]!({ name: 'create_worktree' } as never)).toContain('dsh-git-worktree')
    expect(guards[0]!({ name: 'worktree_create' } as never)).toBeUndefined()
    expect(guards[0]!({ name: 'write' } as never)).toBeUndefined()
  })

  test('leaves an entry the user disabled alone and reports it as overridden', async () => {
    const data = officialEntries()
    data[1]!.disabled = true
    const { entry, result, guards } = await boot(data)
    expect(entry(WORKTREE_TOOL).options.disabled).toBe(true)
    expect(result()).toEqual({ disabled: ['worktree'], overridden: ['tool-worktree'] })
    // The guard is registered either way: a user-disabled entry can be
    // re-enabled at any time, and the guard is what keeps the tool hidden.
    expect(guards).toHaveLength(1)
  })

  test('restores the official entries when the host plugin unloads', async () => {
    const { entry, guards } = await boot(officialEntries())
    expect(entry(WORKTREE_TOOL).options.disabled).toBe(true)
    await entry(HOST).update({ disabled: true }, false, true)
    await new Promise(resolve => setImmediate(resolve))
    expect(guards).toHaveLength(0)
    expect(entry(WORKTREE_SERVICE).options.disabled).toBeUndefined()
    expect(entry(WORKTREE_TOOL).options.disabled).toBeUndefined()
  })

  test('takes over entries an Include adds after activation', async () => {
    const { ctx, entry } = await boot([{ id: 'host', name: HOST }])
    await ctx.loader.root.update([{ id: 'host', name: HOST }, { id: 'tool-worktree', name: WORKTREE_TOOL }])
    await ctx.loader.await()
    await new Promise(resolve => setImmediate(resolve))
    expect(entry(WORKTREE_TOOL).options.disabled).toBe(true)
  })
})
