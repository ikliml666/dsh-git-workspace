/**
 * 用 lib/ 构建产物（不是 src/ 源码）在真实 Git 仓库跑完整生命周期。
 *
 * 单元测试跑的是 ts 源码，构建失败、导出丢失、编译产物与源码不一致这类问题
 * 它们看不见。这个用例把「插件真正被 Host 加载的那份代码」当成被测对象：
 * 官方布局建树 → 台账 → 评审 → 交付，全程真实 git 命令。
 */
import { afterEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createNodeSessionCheckoutDependencies } from './support/production-adapters.ts'

// @ts-expect-error 构建产物无类型声明对齐
import { createSessionCheckoutModule as createModuleFromLib } from '../lib/session-checkout-module.js'

const roots: string[] = []
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }) })

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败: ${r.stderr}`)
  return r.stdout.trim()
}

describe('lib/ 构建产物端到端', () => {
  test('官方布局建树 → 台账 → 评审 → 交付，全程真实 git', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-artifact-e2e-')))
    roots.push(root)
    const repo = join(root, 'repo')
    mkdirSync(repo)
    git(repo, 'init', '-b', 'main')
    git(repo, 'config', 'user.name', 'E2E')
    git(repo, 'config', 'user.email', 'e2e@example.test')
    git(repo, 'config', 'core.autocrlf', 'false')
    writeFileSync(join(repo, 'tracked.txt'), 'base\n')
    git(repo, 'add', 'tracked.txt')
    git(repo, 'commit', '-m', 'base')

    const sessions = new Map([['session-e2e', { id: 'session-e2e', projectId: 'p1' }]])
    const projects = new Map([['p1', { id: 'p1', name: 'repo', root: repo }]])
    const deps = createNodeSessionCheckoutDependencies({
      configDir: join(root, 'config'),
      lookup: {
        getSession: (id: string) => sessions.get(id),
        getProject: (id: string) => projects.get(id),
        getUnboundTargetPolicy: () => 'unselected',
      },
    })
    // 公共夹具刻意不带 attachWorktreeBranch（多数用例跑 detached HEAD 回退路径）。
    // 这个用例要验的是真实生产行为，所以按 src/adapters/git.ts:485 的语义补上：
    // 只动 ref 与 HEAD 指向，不碰工作区。
    deps.git.attachWorktreeBranch = async (managedRoot, branchRef, headOid, expectedOldOid) => {
      const zero = '0'.repeat(headOid.length)
      const update = spawnSync('git', ['update-ref', branchRef, headOid, expectedOldOid ?? zero], { cwd: managedRoot, encoding: 'utf-8' })
      if (update.status !== 0) throw new Error(update.stderr || `git update-ref ${branchRef} 失败`)
      const symbolic = spawnSync('git', ['symbolic-ref', 'HEAD', branchRef], { cwd: managedRoot, encoding: 'utf-8' })
      if (symbolic.status !== 0) throw new Error(symbolic.stderr || `git symbolic-ref HEAD ${branchRef} 失败`)
    }
    const module = createModuleFromLib(deps)
    const agent = { session: { id: 'session-e2e' } }

    // 假官方服务：真的 git worktree add 到官方布局
    const pool = join(repo, '.agents', 'worktrees')
    mkdirSync(pool, { recursive: true })
    writeFileSync(join(pool, '.gitignore'), '*\n')
    const branch = 'feat/sess-e2e'
    const path = join(pool, branch)
    git(repo, 'worktree', 'add', '-b', branch, path, 'HEAD')
    const baseCommit = git(path, 'rev-parse', 'HEAD')
    deps.officialWorktrees = () => ({
      create: async () => ({ path: realpathSync(path), branch, baseCommit, repositoryRoot: realpathSync(repo) }),
    })

    // 建树 + 登记
    const launch = await module.createOfficialTarget(agent, {})
    expect(launch.managedRoot).toBe(realpathSync(path))
    const registry = deps.registry.read()
    const record = registry.managedCheckouts[launch.target.checkout.id]
    expect(record.phase).toBe('ready')
    expect(registry.sessionBindings['session-e2e'].target).toEqual({ kind: 'isolated', checkoutId: launch.target.checkout.id })

    // 列表
    const list = await module.listManagedWorktreesForSession('session-e2e')
    expect(list.length).toBe(1)

    // 改文件 → 就绪评审
    writeFileSync(join(path, 'newfile.txt'), 'hello\n')
    const before = await module.inspect('session-e2e')
    const ready = await module.markReadyForReview('session-e2e', {
      expectedRevision: before.revision,
      summary: 'e2e',
      suggestedCommitMessage: 'test: e2e change',
      validationStatus: 'passed',
      validationSummary: 'ok',
      tests: [{ command: 'vitest', status: 'passed' as const, summary: 'ok' }],
    })
    expect(ready.delivery?.state).toBe('ready_for_review')

    // 交付
    const current = await module.inspect('session-e2e')
    const result = await module.operate({
      sessionId: 'session-e2e',
      expectedRevision: current.revision,
      action: 'finish',
      commitMessage: 'test: e2e change',
      retention: 'cleanup',
      expectedReviewId: current.delivery.review.reviewId,
    })
    if (result.status === 'error') console.log('ERROR-DETAIL>>', JSON.stringify(result))
    expect(result.status).toBe('finished')
    // 提交落在会话分支上，Local 未被写
    expect(git(repo, 'log', '-1', '--format=%s', `refs/heads/${branch}`)).toBe('test: e2e change')
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseCommit)
  }, 120_000)
})
