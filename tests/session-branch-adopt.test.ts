import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createNodeSessionCheckoutDependencies } from './support/production-adapters.js'
import { createSessionCheckoutModule } from '../src/session-checkout-module.js'
import { createDshGitPort } from '../src/adapters/git.js'

/** 隔离宿主环境里的 GIT_* 变量，否则 adapter 会读到本仓库的仓库指针。 */
function testEnvironment(overrides: Record<string, string | undefined> = {}) {
  const env = {
    ...process.env,
    ...overrides,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  }
  for (const key of Object.keys(env)) {
    if (env[key] === undefined || /^GIT_(AUTHOR_|COMMITTER_|DIR$|WORK_TREE$|INDEX_FILE$)/.test(key)) delete env[key]
  }
  return env
}

/**
 * 回归：存量（legacy）记录 adopt 到会话分支。
 *
 * 修复前创建的 Worktree 一律是 detached HEAD，记录里也没有 `sessionBranch`。
 * 这类记录交付时不能直接失败，也不能退回写 Local：必须补建本会话分支、把交付
 * 提交放上去，并把 `sessionBranch` 写回记录——这样胶囊之后也能显示分支名。
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-branch-adopt-'))
  const repo = join(root, 'repo')
  mkdirSync(repo)
  const git = (...args: string[]) => {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', env: testEnvironment() })
    if (result.status) throw Error(`${args.join(' ')}: ${result.stderr}`)
    return result.stdout.trim()
  }
  /** 与 git 相同，但允许失败（用于断言「这条 ref 不存在」）。 */
  const tryGit = (...args: string[]) => {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', env: testEnvironment() })
    return result.status === 0 ? result.stdout.trim() : null
  }
  git('init', '-b', 'main')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.test')
  writeFileSync(join(repo, 'shared.txt'), 'base\n')
  git('add', '.')
  git('commit', '-m', 'base')
  const ctx = {
    subprocess: {
      spawn(options: { argv: string[]; cwd: string; stdio: { stdin: string }; env?: Record<string, string | undefined> }) {
        const child = spawn('git', options.argv.slice(1), { cwd: options.cwd, env: testEnvironment(options.env) })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', data => { stdout += data })
        child.stderr.on('data', data => { stderr += data })
        if (options.stdio.stdin !== 'pipe') child.stdin.end()
        const done = new Promise<{ exitCode: number | null }>(resolve => child.on('close', exitCode => resolve({ exitCode })))
        return {
          done,
          terminate: () => { if (child.exitCode === null) child.kill() },
          waitForExit: async () => { await done; return true },
          stdin: child.stdin,
          collected: {
            stdout: { readFrom: () => ({ text: stdout }) },
            stderr: { readFrom: () => ({ text: stderr }) },
          },
        }
      },
    },
  } as unknown as Context
  const port = createDshGitPort(ctx, { hooksPath: join(root, 'no-hooks') })
  const sessions = new Map([['source', { id: 'source', projectId: 'project' }]])
  const projects = new Map([['project', { id: 'project', name: 'Project', root: repo }]])
  const lookup = {
    getSession: (id: string) => sessions.get(id),
    getProject: (id: string) => projects.get(id),
    getUnboundTargetPolicy: () => 'unselected' as const,
  }
  const configDir = join(root, 'config')
  const dependencies = createNodeSessionCheckoutDependencies({ configDir, lookup })
  dependencies.git = port
  dependencies.inheritLocalChanges = false
  return {
    root, repo, git, tryGit, port, dependencies, projects, sessions, configDir,
    cleanup: () => rmSync(root, { force: true, recursive: true }),
  }
}

it('adopts a legacy detached record onto a Session branch at delivery', async () => {
  const env = fixture()
  try {
    const module = createSessionCheckoutModule(env.dependencies)
    const launch = await module.createIsolatedTarget('source', 'owner', { topic: 'adopt' })
    env.projects.set('owner-project', { id: 'owner-project', name: 'Owner', root: launch.managedRoot })
    env.sessions.set('owner', { id: 'owner', projectId: 'owner-project' })

    // 把记录改造成「修复前创建」的样子：Worktree 脱离分支，记录里没有 sessionBranch，
    // sourceRef 是分叉来源（可能正是别的会话的分支）。
    env.git('-C', launch.managedRoot, 'checkout', '--detach')
    const legacyBranch = env.git('-C', launch.managedRoot, 'rev-parse', 'HEAD')
    const legacy = env.dependencies.registry.read()
    const recordId = Object.keys(legacy.managedCheckouts)[0]
    const legacyRegistry = {
      ...legacy,
      managedCheckouts: {
        ...legacy.managedCheckouts,
        [recordId]: { ...legacy.managedCheckouts[recordId], sourceRef: 'refs/heads/someone-elses-branch', revision: legacy.managedCheckouts[recordId].revision + 1 },
      },
    }
    delete (legacyRegistry.managedCheckouts[recordId] as { sessionBranch?: string }).sessionBranch
    env.dependencies.registry.write(legacyRegistry)
    // 确认真的处于 detached HEAD（symbolic-ref 取不到分支会以非 0 退出）。
    expect(env.tryGit('-C', launch.managedRoot, 'symbolic-ref', '--quiet', 'HEAD')).toBeNull()

    writeFileSync(join(launch.managedRoot, 'shared.txt'), 'base\nlegacy adopt\n')
    const ready = await module.inspect('owner')

    const delivered = await module.operate({
      action: 'finish',
      sessionId: 'owner',
      expectedRevision: ready.revision,
      commitMessage: 'fix: legacy adopt',
      retention: 'retain_manual',
    })
    if (delivered.status !== 'finished') throw Error(JSON.stringify(delivered))

    // 交付落在**本会话**新建的分支上，而不是分叉来源那条（那可能是别人的分支）。
    const branch = (delivered as { branch?: string }).branch
    expect(branch).toBe('feat/sess-owner--adopt')
    expect(env.git('rev-parse', `refs/heads/${branch}`)).toBe(delivered.commitOid)
    expect(env.tryGit('rev-parse', '--verify', 'refs/heads/someone-elses-branch')).toBeNull()
    // 交付前那个 detached HEAD 提交是分叉点，分支从它之上只加一个提交。
    expect(env.git('rev-list', '--count', `${legacyBranch}..${branch}`)).toBe('1')

    // 记录被回填：之后胶囊能从记录里读到分支名。
    const adopted = env.dependencies.registry.read().managedCheckouts[recordId]
    expect(adopted.sessionBranch).toBe(`refs/heads/${branch}`)
    expect(adopted.sourceRef).toBe(`refs/heads/${branch}`)
    // Local 依旧没有被写过。
    expect(env.git('symbolic-ref', 'HEAD')).toBe('refs/heads/main')
  } finally {
    env.cleanup()
  }
}, 120_000)
