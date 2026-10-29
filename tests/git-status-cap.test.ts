import { createDshGitPort } from '../src/adapters/git.js'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'

/**
 * `git status --untracked-files=all` prints one record per untracked file, so a
 * repository holding an un-ignored dependency tree (a venv, a build cache)
 * produces megabytes of records. The subprocess service keeps only an
 * in-memory tail and reports the read as `lossy`; treating that as a Git
 * failure turned every 5s header-chip poll into "Git 操作失败: git status …",
 * which is what these tests lock down.
 */

const roots: string[] = []
const OVERFLOW = 2 * 1024 * 1024

function testEnvironment(overrides: Record<string, string | undefined> = {}) {
  const env = { ...process.env, ...overrides, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' }
  for (const key of Object.keys(env)) {
    if (env[key] === undefined || /^GIT_(AUTHOR_|COMMITTER_|DIR$|WORK_TREE$|INDEX_FILE$)/.test(key)) delete env[key]
  }
  return env
}

function git(cwd: string, args: string[]) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', env: testEnvironment() })
}

interface OverflowRule {
  /** Argv substring that marks a read whose stream must overflow. */
  match: string
  /** Text handed back for an overflowing read: the tail of a much longer stream. */
  tail: string
}

/**
 * A `ctx.subprocess` double that runs the real git binary but reproduces the
 * service's bounded collection: a read that overflowed its cap is `lossy` and
 * keeps only the tail.
 */
function overflowingContext(rule: OverflowRule) {
  const calls: string[][] = []
  const ctx = {
    subprocess: {
      spawn(options: { argv: string[]; cwd: string; stdio: { stdin: string } }) {
        const args = options.argv.slice(1)
        calls.push(args)
        const overflows = args.some(arg => arg.includes(rule.match))
        const child = spawn('git', args, { cwd: options.cwd, env: testEnvironment() })
        let stdout = '', stderr = ''
        let exited: number | null = null
        child.stdout.on('data', data => { stdout += data })
        child.stderr.on('data', data => { stderr += data })
        if (options.stdio.stdin !== 'pipe') child.stdin.end()
        const done = new Promise<{ exitCode: number | null }>(resolve => child.on('close', code => { exited = code; resolve({ exitCode: code }) }))
        return {
          done,
          terminate: () => { if (child.exitCode === null) child.kill() },
          waitForExit: async () => { await done; return true },
          stdin: child.stdin,
          collected: {
            stdout: {
              // Only a successful read can grow past the cap; a failing git
              // writes a short error line, never an overflow.
              readFrom: () => overflows && exited === 0
                ? { text: rule.tail, nextOffset: OVERFLOW, lossy: true }
                : { text: stdout, nextOffset: stdout.length, lossy: false },
            },
            stderr: { readFrom: () => ({ text: stderr, nextOffset: stderr.length, lossy: false }) },
          },
        }
      },
    },
  } as unknown as Context
  return { ctx, calls }
}

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-status-cap-')))
  roots.push(root)
  const repo = join(root, 'repo')
  await mkdir(repo)
  git(repo, ['init', '-b', 'main'])
  await writeFile(join(repo, 'tracked.txt'), 'base')
  git(repo, ['add', 'tracked.txt'])
  git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-m', 'base'])
  return { root, repo }
}

afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('status under an overflowing untracked listing', () => {
  it('retries with the collapsed untracked mode instead of reporting a Git failure', async () => {
    const { root, repo } = await fixture()
    // The precise read overflows; the collapsed read is what still answers.
    await mkdir(join(repo, 'vendor'))
    await writeFile(join(repo, 'vendor', 'lib.js'), 'x')
    const { ctx, calls } = overflowingContext({ match: '--untracked-files=all', tail: '?? vendor/\0?? build/\0' })
    const port = createDshGitPort(ctx, { hooksPath: join(root, 'no-hooks') })

    await expect(port.status(repo)).resolves.toEqual({ dirty: true })
    const modes = calls.filter(args => args.includes('--porcelain=v1')).map(args => args.find(arg => arg.startsWith('--untracked-files=')))
    expect(modes).toEqual(['--untracked-files=all', '--untracked-files=normal'])
  })

  it('still reports clean when every surviving record is carried Project Skills', async () => {
    const { root, repo } = await fixture()
    const { ctx } = overflowingContext({ match: '--untracked-files=all', tail: '' })
    const port = createDshGitPort(ctx, { hooksPath: join(root, 'no-hooks') })
    await expect(port.status(repo)).resolves.toEqual({ dirty: false })
  })

  it('surfaces a real Git failure unchanged, without retrying narrower', async () => {
    const { root, repo } = await fixture()
    const { ctx, calls } = overflowingContext({ match: '--untracked-files=all', tail: '' })
    const port = createDshGitPort(ctx, { hooksPath: join(root, 'no-hooks') })
    const missing = join(root, 'not-a-repository')
    await mkdir(missing)

    await expect(port.status(missing)).rejects.toMatchObject({ code: 'git_operation_failed' })
    // A genuine failure must not be masked by a narrower retry: exactly one spawn.
    expect(calls.filter(args => args.includes('status'))).toHaveLength(1)
  })
})

describe('branchOverview under an overflowing untracked listing', () => {
  it('keeps the branch list and reports an unknown count rather than a false clean', async () => {
    const { root, repo } = await fixture()
    const { ctx } = overflowingContext({ match: '--untracked-files=', tail: '' })
    const port = createDshGitPort(ctx, { hooksPath: join(root, 'no-hooks') })

    const overview = await port.branchOverview?.(repo)
    expect(overview?.branches.map(branch => branch.name)).toEqual(['main'])
    expect(overview?.dirtyCount).toBe(-1)
  })

  it('counts entries from the collapsed read when only the precise mode overflows', async () => {
    const { root, repo } = await fixture()
    await mkdir(join(repo, 'vendor'))
    await writeFile(join(repo, 'vendor', 'lib.js'), 'x')
    const { ctx } = overflowingContext({ match: '--untracked-files=all', tail: '' })
    const port = createDshGitPort(ctx, { hooksPath: join(root, 'no-hooks') })

    const overview = await port.branchOverview?.(repo)
    expect(overview?.branches.map(branch => branch.name)).toEqual(['main'])
    expect(overview?.dirtyCount).toBe(1)
  })
})
