import { afterEach, describe, expect, test, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createSessionCheckoutModule } from '../src/session-checkout-module.ts'
import { createNodeSessionCheckoutDependencies } from './support/production-adapters.ts'
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

/**
 * 假官方 `worktrees` 服务：真的用 `git worktree add` 在官方布局
 * `<repo>/.agents/worktrees/<branch>` 下建树，这样登记逻辑面对的是真实的
 * checkout 而不是编出来的路径。
 */
function officialFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-official-create-')))
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

  const create = vi.fn<OfficialWorktreesPort['create']>(async (_agent, request = {}) => {
    const branch = request.name ?? 'generated'
    const from = request.from ?? 'HEAD'
    const pool = join(repo, '.agents', 'worktrees')
    mkdirSync(pool, { recursive: true })
    // 官方 prepareDirectory 会在池目录写一个自忽略的 .gitignore（内容 `*`），
    // 否则整个池会被仓库当成未跟踪内容。漏掉它就会让本地 WIP 携带把新树
    // 自己拷进自己。
    writeFileSync(join(pool, '.gitignore'), '*\n')
    const path = join(pool, branch)
    git(repo, 'worktree', 'add', '-b', branch, path, from)
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
  // 生产适配器刻意不带 WIP 端口；这里补上，才能验证「官方没有、本插件补」的
  // 两件事真的发生。补丁必须原样传字节——runGit 会 trim，末尾换行丢了
  // git apply 会报 corrupt patch。
  dependencies.git.captureLocalWip = async (root) => {
    const diff = spawnSync('git', ['diff', '--binary', '--full-index', 'HEAD'], { cwd: root, encoding: 'utf-8' })
    if (diff.status !== 0) throw new Error(diff.stderr)
    return diff.stdout === '' ? null : diff.stdout
  }
  dependencies.git.applyWorktreePatch = async (root, patch) => {
    const applied = spawnSync('git', ['apply', '--binary', '--whitespace=nowarn', '-'], { cwd: root, input: patch, encoding: 'utf-8' })
    if (applied.status !== 0) throw new Error(applied.stderr)
  }
  dependencies.git.listUntrackedFiles = async (root) => {
    const listed = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf-8' })
    if (listed.status !== 0) throw new Error(listed.stderr)
    return listed.stdout.split('\0').filter(Boolean)
  }
  const module = createSessionCheckoutModule(dependencies)
  const agent = { session: { id: 'session-1' } }
  return { repo, create, module, agent, dependencies }
}

describe('creating a Worktree through the official service', () => {
  test('creates in the official layout and records the checkout as ready', async () => {
    const f = officialFixture()
    const launch = await f.module.createOfficialTarget(f.agent, {})

    expect(f.create).toHaveBeenCalledTimes(1)
    const created = f.create.mock.calls[0]![1]!
    expect(created.name).toMatch(/^feat\/sess-session-1/)
    expect(created.from).toBeUndefined()
    expect(launch.managedRoot).toBe(join(f.repo, '.agents', 'worktrees', created.name!))
    expect(launch.targetSessionId).toBe('session-1')
    expect(launch.target.checkout.phase).toBe('ready')
    expect(launch.target.current.branch).toBe(created.name)
  })

  test('binds the Session so the checkout shows up as its isolated target', async () => {
    const f = officialFixture()
    const launch = await f.module.createOfficialTarget(f.agent, {})

    const registry = f.dependencies.registry.read()
    const record = registry.managedCheckouts[launch.target.checkout.id]!
    expect(record.phase).toBe('ready')
    expect(record.delivery).toEqual({ state: 'working', iteration: 1 })
    expect(record.ownerSessionId).toBe('session-1')
    expect(record.localRoot).toBe(f.repo)
    expect(registry.sessionBindings['session-1']!.target).toEqual({
      kind: 'isolated',
      checkoutId: launch.target.checkout.id,
    })
  })

  test('maps branch to the official from so the base commit follows that branch tip', async () => {
    const f = officialFixture()
    git(f.repo, 'branch', 'feat/base-pick')
    git(f.repo, 'commit', '--allow-empty', '-m', 'ahead of main')
    const expectedBase = git(f.repo, 'rev-parse', 'feat/base-pick')

    const launch = await f.module.createOfficialTarget(f.agent, { branch: 'feat/base-pick' })

    expect(f.create.mock.calls[0]![1]!.from).toBe('feat/base-pick')
    expect(launch.target.source.oid).toBeDefined()
    expect(git(launch.managedRoot, 'rev-parse', 'HEAD')).toBe(expectedBase)
  })

  test('reuses the existing checkout instead of creating a second tree', async () => {
    const f = officialFixture()
    const first = await f.module.createOfficialTarget(f.agent, {})
    const second = await f.module.createOfficialTarget(f.agent, {})

    expect(f.create).toHaveBeenCalledTimes(1)
    expect(second.managedRoot).toBe(first.managedRoot)
    expect(second.target.checkout.id).toBe(first.target.checkout.id)
  })

  test('refuses to create without a mounted official service', async () => {
    const f = officialFixture()
    f.dependencies.officialWorktrees = () => undefined
    const bare = createSessionCheckoutModule(f.dependencies)

    await expect(bare.createOfficialTarget(f.agent, {}))
      .rejects.toThrow(/No worktrees service is mounted/)
    expect(f.create).not.toHaveBeenCalled()
  })

  test('reports a clear error when every candidate branch name is taken', async () => {
    const f = officialFixture()
    for (const suffix of ['', '-2', '-3', '-4', '-5']) {
      git(f.repo, 'branch', `feat/sess-session-1${suffix}`)
    }

    await expect(f.module.createOfficialTarget(f.agent, {}))
      .rejects.toThrow(/Every candidate branch name for this Session already exists/)
    expect(f.create).not.toHaveBeenCalled()
  })
})

describe('carrying what the official service does not', () => {
  test('copies the files listed in .worktreeinclude into the new checkout', async () => {
    const f = officialFixture()
    writeFileSync(join(f.repo, '.gitignore'), 'secret.env\n')
    writeFileSync(join(f.repo, '.worktreeinclude'), 'secret.env\n')
    writeFileSync(join(f.repo, 'secret.env'), 'TOKEN=1\n')
    git(f.repo, 'add', '.gitignore', '.worktreeinclude')
    git(f.repo, 'commit', '-m', 'ignore secret')

    const launch = await f.module.createOfficialTarget(f.agent, {})

    expect(readFileSync(join(launch.managedRoot, 'secret.env'), 'utf-8')).toBe('TOKEN=1\n')
  })

  test('carries uncommitted Local changes when the base is the Local HEAD', async () => {
    const f = officialFixture()
    writeFileSync(join(f.repo, 'tracked.txt'), 'changed locally\n')
    writeFileSync(join(f.repo, 'fresh.txt'), 'untracked\n')

    const launch = await f.module.createOfficialTarget(f.agent, {})

    expect(readFileSync(join(launch.managedRoot, 'tracked.txt'), 'utf-8')).toBe('changed locally\n')
    expect(readFileSync(join(launch.managedRoot, 'fresh.txt'), 'utf-8')).toBe('untracked\n')
  })

  test('does not carry Local changes when the base is a different branch tip', async () => {
    const f = officialFixture()
    git(f.repo, 'branch', 'feat/base-pick')
    git(f.repo, 'commit', '--allow-empty', '-m', 'ahead of main')
    writeFileSync(join(f.repo, 'tracked.txt'), 'changed locally\n')

    const launch = await f.module.createOfficialTarget(f.agent, { branch: 'feat/base-pick' })

    expect(readFileSync(join(launch.managedRoot, 'tracked.txt'), 'utf-8')).toBe('base\n')
  })
})
