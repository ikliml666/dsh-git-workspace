import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ManagedCheckoutRecord, ManagedCheckoutsRegistry } from '../src/ports.js'
import { AtomicJsonCheckoutRegistry } from '../src/adapters/registry.js'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)

const dirs: string[] = []
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-git-workspace-registry-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  vi.restoreAllMocks()
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function readyRecord(checkoutId: string): ManagedCheckoutRecord {
  return {
    checkoutId, projectId: 'project-1', projectName: 'Project',
    ownerSessionId: 'target-session', localRoot: '/local', managedRoot: '/managed',
    managedGitRoot: '/managed', gitCommonDir: '/git/common', gitDir: '/git/worktrees/one',
    baseOid: A, sourceRef: 'refs/heads/main', phase: 'ready', journal: null, revision: 7,
    delivery: { state: 'working', iteration: 1 },
  }
}

function bindingRecord(ownerSessionId: string): ManagedCheckoutsRegistry['sessionBindings'][string] {
  return {
    sessionId: 'session-1', projectId: 'project-1', projectName: 'Project',
    target: { kind: 'unselected' }, ownerSessionId,
    sourceRef: 'refs/heads/main', sourceOid: A, revision: 3,
  }
}

function writeRegistry(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value), 'utf8')
}

function registryOf(
  managedCheckouts: Record<string, unknown>,
  sessionBindings: Record<string, unknown> = {},
): unknown {
  return { version: 2, revision: 5, sessionBindings, managedCheckouts }
}

describe('Per-record degradation', () => {
  test('one invalid record is dropped while every valid record stays readable', () => {
    const dir = scratch()
    const path = join(dir, 'managed-checkouts.json')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    writeRegistry(path, registryOf({
      'checkout-good': readyRecord('checkout-good'),
      'checkout-broken': { ...readyRecord('checkout-broken'), phase: 'not-a-phase' },
      'checkout-also-good': readyRecord('checkout-also-good'),
    }))

    const registry = new AtomicJsonCheckoutRegistry(path).read()

    expect(Object.keys(registry.managedCheckouts)).toEqual(['checkout-good', 'checkout-also-good'])
    expect(warn.mock.calls.flat().join('\n')).toContain('checkout-broken')
  })

  test('an invalid session binding is dropped while valid bindings and checkouts survive', () => {
    const dir = scratch()
    const path = join(dir, 'managed-checkouts.json')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    writeRegistry(path, registryOf(
      { 'checkout-good': readyRecord('checkout-good') },
      {
        'session-good': bindingRecord('owner-1'),
        'session-broken': { ...bindingRecord('owner-2'), revision: 'three' },
      },
    ))

    const registry = new AtomicJsonCheckoutRegistry(path).read()

    expect(Object.keys(registry.sessionBindings)).toEqual(['session-good'])
    expect(Object.keys(registry.managedCheckouts)).toEqual(['checkout-good'])
    expect(warn.mock.calls.flat().join('\n')).toContain('session-broken')
  })

  test('degraded reads leave the file on disk untouched', () => {
    const dir = scratch()
    const path = join(dir, 'managed-checkouts.json')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const original = registryOf({
      'checkout-good': readyRecord('checkout-good'),
      'checkout-broken': { checkoutId: 'checkout-broken' },
    })
    writeRegistry(path, original)
    const before = readFileSync(path, 'utf8')

    new AtomicJsonCheckoutRegistry(path).read()

    expect(readFileSync(path, 'utf8')).toBe(before)
    expect(JSON.parse(before)).toEqual(original)
  })

  test('a broken top-level structure still fails loud as registry_corrupt', () => {
    const dir = scratch()
    const path = join(dir, 'managed-checkouts.json')
    writeRegistry(path, { version: 2, revision: 5, sessionBindings: [], managedCheckouts: {} })

    expect(() => new AtomicJsonCheckoutRegistry(path).read()).toThrowError(/managed-checkouts\.json/u)
  })

  test('an unknown version is still rejected instead of being silently degraded', () => {
    const dir = scratch()
    const path = join(dir, 'managed-checkouts.json')
    writeRegistry(path, { version: 3, revision: 1, sessionBindings: {}, managedCheckouts: {} })

    expect(() => new AtomicJsonCheckoutRegistry(path).read()).toThrowError(/managed-checkouts\.json/u)
  })
})

describe('Atomic update', () => {
  test('update writes inside the lock and releases it', () => {
    const dir = scratch()
    const path = join(dir, 'managed-checkouts.json')
    const registry = new AtomicJsonCheckoutRegistry(path)
    registry.write({
      version: 2, revision: 1, sessionBindings: {}, managedCheckouts: { 'checkout-1': readyRecord('checkout-1') },
    })

    const next = registry.update((value) => structuredClone({
      ...value,
      revision: value.revision + 1,
      managedCheckouts: { ...value.managedCheckouts, 'checkout-2': readyRecord('checkout-2') },
    }))

    expect(Object.keys(next.managedCheckouts)).toEqual(['checkout-1', 'checkout-2'])
    expect(JSON.parse(readFileSync(path, 'utf8')).revision).toBe(2)
    expect(existsSync(`${path}.lock`)).toBe(false)
  })

  test('concurrent updates in one process do not lose each other writes', async () => {
    const dir = scratch()
    const path = join(dir, 'managed-checkouts.json')
    const registry = new AtomicJsonCheckoutRegistry(path)
    registry.write({ version: 2, revision: 0, sessionBindings: {}, managedCheckouts: {} })

    await Promise.all(Array.from({ length: 12 }, (_unused, index) => Promise.resolve().then(() => registry.update((value) => ({
      ...value,
      revision: value.revision + 1,
      managedCheckouts: { ...value.managedCheckouts, [`checkout-${index}`]: readyRecord(`checkout-${index}`) },
    })))))

    const reloaded = new AtomicJsonCheckoutRegistry(path).read()
    expect(Object.keys(reloaded.managedCheckouts)).toHaveLength(12)
    expect(reloaded.revision).toBe(12)
  })

  test('concurrent updates from separate processes do not lose updates', () => {
    const dir = scratch()
    const path = join(dir, 'managed-checkouts.json')
    const registry = new AtomicJsonCheckoutRegistry(path)
    registry.write({ version: 2, revision: 0, sessionBindings: {}, managedCheckouts: {} })

    const worker = fileURLToPath(new URL('./support/update-worker.mjs', import.meta.url))
    const children = [0, 1, 2, 3].map((index) => spawn(process.execPath, [worker, path, String(index)], { stdio: 'pipe' }))
    return Promise.all(children.map((child) => new Promise<void>((resolve, reject) => {
      child.on('error', reject)
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker exited with ${code}`))))
    }))).then(() => {
      const reloaded = new AtomicJsonCheckoutRegistry(path).read()
      expect(Object.keys(reloaded.managedCheckouts).sort()).toEqual([
        'worker-0-a', 'worker-0-b', 'worker-1-a', 'worker-1-b',
        'worker-2-a', 'worker-2-b', 'worker-3-a', 'worker-3-b',
      ])
      expect(reloaded.revision).toBe(8)
    })
  })

  test('update never overwrites a registry it could not read', () => {
    const dir = scratch()
    const path = join(dir, 'managed-checkouts.json')
    writeRegistry(path, { version: 2, revision: 1, sessionBindings: [], managedCheckouts: {} })
    const before = readFileSync(path, 'utf8')

    expect(() => new AtomicJsonCheckoutRegistry(path).update((value) => value)).toThrowError(/managed-checkouts\.json/u)
    expect(readFileSync(path, 'utf8')).toBe(before)
  })
})

describe('Update versus a degraded read', () => {
  test('a record dropped by read is still written back unchanged by update', () => {
    const dir = scratch()
    const path = join(dir, 'managed-checkouts.json')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    writeRegistry(path, registryOf({
      'checkout-good': readyRecord('checkout-good'),
      'checkout-broken': { checkoutId: 'checkout-broken' },
    }))

    new AtomicJsonCheckoutRegistry(path).update((value) => ({
      ...value,
      revision: value.revision + 1,
      managedCheckouts: { ...value.managedCheckouts, 'checkout-new': readyRecord('checkout-new') },
    }))

    const onDisk = JSON.parse(readFileSync(path, 'utf8'))
    expect(Object.keys(onDisk.managedCheckouts).sort()).toEqual([
      'checkout-broken', 'checkout-good', 'checkout-new',
    ])
    expect(onDisk.revision).toBe(6)
  })
})
