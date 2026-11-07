import { afterEach, describe, expect, test, vi } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Session } from '@deepseek-ai/dsh-session'
import { createSessionCheckoutModule } from '../src/session-checkout-module.ts'
import { createNodeSessionCheckoutDependencies } from './support/production-adapters.ts'
import { pendingWorktreeRequest, requestWorktree, cancelWorktreeRequest } from '../src/worktree-request.ts'
import type { OfficialWorktreesPort } from '../src/ports.ts'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} 失败: ${result.stderr}`)
  return result.stdout.trim()
}

/** 官方布局建树的假服务：真的跑 `git worktree add`，并记录耗时。 */
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-perf-create-')))
  temporaryRoots.push(root)
  const repo = join(root, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-b', 'main')
  git(repo, 'config', 'user.name', 'Test User')
  git(repo, 'config', 'user.email', 'test@example.test')
  git(repo, 'config', 'core.autocrlf', 'false')
  writeFileSync(join(repo, 'tracked.txt'), 'base\n')
  git(repo, 'add', 'tracked.txt')
  git(repo, 'commit', '-m', 'base')

  const pool = join(repo, '.agents', 'worktrees')
  const create = vi.fn<OfficialWorktreesPort['create']>(async (_agent, request = {}) => {
    const branch = request.name ?? 'generated'
    mkdirSync(pool, { recursive: true })
    writeFileSync(join(pool, '.gitignore'), '*\n')
    const path = join(pool, branch)
    git(repo, 'worktree', 'add', '-b', branch, path, request.from ?? 'HEAD')
    return {
      path: realpathSync(path),
      branch,
      baseCommit: git(path, 'rev-parse', 'HEAD'),
      repositoryRoot: realpathSync(repo),
    }
  })

  const sessions = new Map([['session-1', { id: 'session-1', projectId: 'project-1' }]])
  const projects = new Map([['project-1', { id: 'project-1', name: 'repo', root: repo }]])
  const dependencies = createNodeSessionCheckoutDependencies({
    configDir: join(root, 'config'),
    lookup: {
      getSession: id => sessions.get(id),
      getProject: id => projects.get(id),
      getUnboundTargetPolicy: () => 'unselected',
    },
  })
  dependencies.officialWorktrees = () => ({ create, restore: vi.fn() as never })
  dependencies.git.captureLocalWip = async (cwd) => {
    const diff = spawnSync('git', ['diff', '--binary', '--full-index', 'HEAD'], { cwd, encoding: 'utf-8' })
    if (diff.status !== 0) throw new Error(diff.stderr)
    return diff.stdout === '' ? null : diff.stdout
  }
  dependencies.git.applyWorktreePatch = async (cwd, patch) => {
    const applied = spawnSync('git', ['apply', '--binary', '--whitespace=nowarn', '-'], { cwd, input: patch, encoding: 'utf-8' })
    if (applied.status !== 0) throw new Error(applied.stderr)
  }
  dependencies.git.listUntrackedFiles = async (cwd) => {
    const listed = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd, encoding: 'utf-8' })
    if (listed.status !== 0) throw new Error(listed.stderr)
    return listed.stdout.split('\0').filter(entry => entry !== '')
  }

  const module = createSessionCheckoutModule(dependencies)
  return { root, repo, module, create, dependencies }
}

type Sample = { readonly label: string; readonly ms: number; readonly commands: number }

function report(samples: readonly Sample[]): void {
  for (const sample of samples) {
    console.log(JSON.stringify({ perf: sample.label, ms: Math.round(sample.ms), commands: sample.commands }))
  }
}

describe('creating a Worktree through the official service', () => {
  test('a first creation finishes inside one checkout budget', async () => {
    const env = fixture()
    const agent = { session: { id: 'session-1' } }
    const started = performance.now()
    const launch = await env.module.createOfficialTarget(agent)
    const elapsed = performance.now() - started
    report([{ label: 'createOfficialTarget (fresh)', ms: elapsed, commands: env.create.mock.calls.length }])

    expect(launch.managedRoot.endsWith(join('.agents', 'worktrees', 'feat', 'sess-session-1'))).toBe(true)
    expect(launch.target.checkout.kind).toBe('isolated')
    expect(env.create).toHaveBeenCalledTimes(1)
    // 建树是「一条命令 + 一次 reset --hard + 一次 inspect」，不该因为补回
    // .worktreeinclude 与 WIP 就退化成几十次进程往返。
    expect(elapsed).toBeLessThan(15_000)
  }, 60_000)

  test('a repeated request reuses the tree instead of adding a second one', async () => {
    const env = fixture()
    const agent = { session: { id: 'session-1' } }
    await env.module.createOfficialTarget(agent)
    const started = performance.now()
    const again = await env.module.createOfficialTarget(agent)
    const elapsed = performance.now() - started
    report([{ label: 'createOfficialTarget (reuse)', ms: elapsed, commands: env.create.mock.calls.length }])

    expect(again.target.checkout.kind).toBe('isolated')
    // 复用路径不碰 Git，也不该再调一次官方建树。
    expect(env.create).toHaveBeenCalledTimes(1)
    expect(elapsed).toBeLessThan(1_000)
  }, 60_000)
})

describe('folding the queued request out of the session log', () => {
  // 每次 `current` 请求都会折叠一次日志（胶囊轮询、菜单重开都会触发），所以这里
  // 量的是单次调用的成本如何随日志长度增长，而不是把它重复一百次凑一个好看的总数。
  test('a single fold stays cheap as the log grows', () => {
    const samples: { size: number; perCallMs: number }[] = []
    for (const size of [10, 1_000, 10_000]) {
      const session = Session.create('session-1')
      for (let index = 0; index < size; index++) requestWorktree(session, index % 2 === 0 ? 'main' : null)
      cancelWorktreeRequest(session)
      requestWorktree(session, 'main')
      const rounds = 100
      const started = performance.now()
      for (let round = 0; round < rounds; round++) expect(pendingWorktreeRequest(session)).toEqual({ from: 'main', failure: null })
      samples.push({ size, perCallMs: (performance.now() - started) / rounds })
    }
    report(samples.map(sample => ({ label: `pendingWorktreeRequest over ${sample.size} records (per call)`, ms: sample.perCallMs, commands: 0 })))
    // 单次折叠是纯内存线性扫描：10k 条记录也必须在 10ms 内，否则每次轮询都会拖慢胶囊。
    for (const sample of samples) expect(sample.perCallMs).toBeLessThan(10)
  }, 60_000)
})
