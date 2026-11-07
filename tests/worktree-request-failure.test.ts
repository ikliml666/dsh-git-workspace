import { afterEach, describe, expect, test, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Session } from '@deepseek-ai/dsh-session'
import { createSessionCheckoutModule } from '../src/session-checkout-module.ts'
import { createNodeSessionCheckoutDependencies } from './support/production-adapters.ts'
import { WORKTREE_REQUEST_RECORD, mountWorktreeRequest, pendingWorktreeRequest, requestWorktree } from '../src/worktree-request.ts'
import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import type { OfficialWorktreesPort } from '../src/ports.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} 失败: ${result.stderr}`)
  return result.stdout.trim()
}

/**
 * 建树失败时，原因必须落进 session log：pre-step 之后没有第二次机会跟用户
 * 说话，只写 console 等于用户永远看不见「为什么没建起来」。
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-request-failure-'))
  roots.push(root)
  const repo = join(root, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-b', 'main')
  git(repo, 'config', 'user.name', 'Test User')
  git(repo, 'config', 'user.email', 'test@example.test')
  writeFileSync(join(repo, 'file.txt'), 'base\n')
  git(repo, 'add', 'file.txt')
  git(repo, 'commit', '-m', 'base')

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
  // 官方服务直接抛错，模拟「建树这一步失败」——分支被占、磁盘满、git 超时都走这里。
  const create = vi.fn<OfficialWorktreesPort['create']>(async () => {
    throw new Error('git worktree add 失败: 磁盘空间不足')
  })
  dependencies.officialWorktrees = () => ({ create, restore: vi.fn() as never })

  return { root, repo, module: createSessionCheckoutModule(dependencies) }
}

describe('a queued request whose creation fails', () => {
  test('keeps the request, returns the messages, and records why', async () => {
    const env = fixture()
    const session = Session.create('session-1')
    const listeners: ((payload: unknown, next: () => unknown) => unknown)[] = []
    const ctx = {
      get: (name: string) => (name === 'workingDirectory'
        ? { get: () => env.repo, set: async (_agent: unknown, path: string) => path }
        : undefined),
      on: (name: string, listener: (payload: unknown, next: () => unknown) => unknown) => {
        if (name === 'agent/pre-step') listeners.push(listener)
        return () => {}
      },
    }
    mountWorktreeRequest(ctx as never, env.module)

    requestWorktree(session, 'main')
    const inbox = { prepend: vi.fn() }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await listeners[0]!(
      { agent: { session, inbox }, step: 1, messages: [{ id: 1 }, { id: 2 }] },
      () => 'continued',
    )

    // 消息按逆序还回队列：prepend 插队头，逆序插才是用户发出的顺序。
    expect(inbox.prepend).toHaveBeenCalledTimes(2)
    expect(inbox.prepend.mock.calls.map(call => call[1])).toEqual([{ id: 2 }, { id: 1 }])
    expect(result).toEqual({ kind: 'reject' })
    expect(warn).toHaveBeenCalled()

    // 关键：原因必须能从 session log 读出来，且请求仍然待办（重发即重试）。
    expect(pendingWorktreeRequest(session)).toEqual({
      from: 'main',
      failure: 'git worktree add 失败: 磁盘空间不足',
    })
    warn.mockRestore()
  }, 60_000)

  test('re-queueing clears the recorded failure so the next attempt starts clean', () => {
    // 失败后用户又点了一次菜单（可能换了基点分支）：旧的失败原因必须让位，
    // 否则胶囊会一直显示一条已经过期的错误。
    const session = Session.create('session-1')
    requestWorktree(session, 'main')
    appendPluginRecord(session, WORKTREE_REQUEST_RECORD, { action: 'failed', reason: '磁盘空间不足' })
    expect(pendingWorktreeRequest(session)).toEqual({ from: 'main', failure: '磁盘空间不足' })

    requestWorktree(session, 'release')
    expect(pendingWorktreeRequest(session)).toEqual({ from: 'release', failure: null })
  })

  test('a failure with nothing queued records nothing', () => {
    // 失败记录只在有请求时才有意义；没有待办时挂一条原因会让胶囊显示一个
    // 不存在的「待建」任务。
    const session = Session.create('session-1')
    appendPluginRecord(session, WORKTREE_REQUEST_RECORD, { action: 'failed', reason: 'stale' })
    expect(pendingWorktreeRequest(session)).toBeNull()
  })
})
