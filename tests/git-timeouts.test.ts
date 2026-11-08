import { afterEach, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createDshGitPort } from '../src/adapters/git.js'
import { Config, apply } from '../src/index.js'
import { gitTimeoutMs, validateGitTimeouts } from '../src/adapters/git-options.js'
import { ProjectSkillStore } from '../src/adapters/project-skills.js'

afterEach(() => vi.useRealTimers())
it('keeps command termination grace separate from a customized query deadline', async () => {
  vi.useFakeTimers()
  let signal: AbortSignal | undefined
  let grace: number | undefined
  let finish!: (value: { exitCode: number }) => void
  const ctx = { subprocess: { spawn(spec: { signal: AbortSignal; graceMs: number }) {
    signal = spec.signal
    grace = spec.graceMs
    return { done: new Promise(resolve => { finish = resolve }), collected: {} }
  } } } as unknown as Context
  const projectSkills = new ProjectSkillStore('/unused')
  vi.spyOn(projectSkills, 'paths').mockResolvedValue(null)
  vi.spyOn(projectSkills, 'forget').mockResolvedValue(undefined)
  const port = createDshGitPort(ctx, { hooksPath: '/hooks', gitTimeoutMs: 40_000, projectSkills })
  const pending = port.removeWorktree('/repo', '/managed')
  await vi.advanceTimersByTimeAsync(40_001)
  expect(signal?.aborted).toBe(false)
  expect(grace).toBe(1_000)
  finish({ exitCode: 0 })
  await pending
})

it('keeps ordinary, creation and removal deadlines independent', () => {
  expect(gitTimeoutMs(['status'], {})).toBe(120_000)
  expect(gitTimeoutMs(['worktree', 'add'], {})).toBe(300_000)
  expect(gitTimeoutMs(['worktree', 'remove'], {})).toBe(300_000)
  const config = { gitTimeoutMs: 45_000, worktreeAddTimeoutMs: 600_000 }
  expect(gitTimeoutMs(['status'], config)).toBe(45_000)
  expect(gitTimeoutMs(['worktree', 'add'], config)).toBe(600_000)
  expect(gitTimeoutMs(['worktree', 'remove'], config)).toBe(300_000)
  // schemastery >=3.18.4 wraps volatile fields as live references; unwrap to assert values.
  const resolveField = (source: Record<string, unknown>, key: string) => {
    const value = source[key]
    return typeof value === 'object' && value !== null && typeof (value as { get?: unknown }).get === 'function'
      ? (value as { get: () => unknown }).get()
      : value
  }
  expect(resolveField(Config({}) as Record<string, unknown>, 'gitTimeoutMs')).toBe(120_000)
  expect(resolveField(Config({}) as Record<string, unknown>, 'worktreeAddTimeoutMs')).toBe(300_000)
  expect(resolveField(Config(config) as Record<string, unknown>, 'gitTimeoutMs')).toBe(45_000)
  expect(resolveField(Config(config) as Record<string, unknown>, 'worktreeAddTimeoutMs')).toBe(600_000)
})

it.each([0, -1, NaN, Infinity, 999, 1000.5, 3_600_001, '300000'])('rejects invalid timeout %s before mounting or touching state', async value => {
  for (const key of ['gitTimeoutMs', 'worktreeAddTimeoutMs']) {
    const config = { [key]: value } as { gitTimeoutMs?: number; worktreeAddTimeoutMs?: number }
    expect(() => createDshGitPort({} as Context, { hooksPath: '/hooks', ...config })).toThrow(RangeError)
    await expect(apply({} as Context, config)).rejects.toThrow(RangeError)
  }
})

it('reads volatile timeout fields as live references on every command', () => {
  let timeout: number | undefined = 45_000
  const config = { gitTimeoutMs: { get: () => timeout } }
  expect(gitTimeoutMs(['status'], config)).toBe(45_000)
  timeout = 90_000
  expect(gitTimeoutMs(['status'], config)).toBe(90_000)
  timeout = undefined
  expect(gitTimeoutMs(['status'], config)).toBe(120_000)
  expect(gitTimeoutMs(['worktree', 'add'], { worktreeAddTimeoutMs: { get: () => undefined } })).toBe(300_000)
})

it('validates volatile timeout references at mount', () => {
  expect(() => validateGitTimeouts({ gitTimeoutMs: { get: () => 45_000 }, worktreeAddTimeoutMs: { get: () => undefined } })).not.toThrow()
  expect(() => validateGitTimeouts({ gitTimeoutMs: { get: () => 999 } })).toThrow(RangeError)
  expect(() => validateGitTimeouts({ worktreeAddTimeoutMs: { get: () => 3_600_001 } })).toThrow(RangeError)
})

it('marks exactly the settings-editable fields volatile in the Config schema', () => {
  for (const key of ['gitTimeoutMs', 'worktreeAddTimeoutMs', 'autoDeliver', 'autoPush']) {
    expect((Config.dict?.[key]?.meta as { volatile?: boolean } | undefined)?.volatile).toBe(true)
  }
  for (const key of ['stateDir', 'enableWorkspaceProvider']) {
    expect((Config.dict?.[key]?.meta as { volatile?: boolean } | undefined)?.volatile).toBeUndefined()
  }
})
