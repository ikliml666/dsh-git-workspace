import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import { createDshGitPort } from '../src/adapters/git.js'

const roots: string[] = []

function testEnvironment(): Record<string, string | undefined> {
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' }
  for (const key of Object.keys(env)) {
    if (env[key] === undefined || /^GIT_(AUTHOR_|COMMITTER_|DIR$|WORK_TREE$|INDEX_FILE$)/.test(key)) delete env[key]
  }
  return env
}

function git(cwd: string, args: string[]) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', env: testEnvironment() })
}

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-tags-')))
  roots.push(root)
  const repo = join(root, 'repo')
  await mkdir(repo)
  git(repo, ['init', '-b', 'main'])
  // Annotated tags need a committer identity; the isolated config gives none.
  git(repo, ['config', 'user.name', 'Test'])
  git(repo, ['config', 'user.email', 'test@example.test'])
  git(repo, ['commit', '--allow-empty', '-m', 'base'])
  const ctx = {
    subprocess: {
      spawn(options: { argv: string[]; cwd: string; stdio: { stdin: string }; env?: Record<string, string | undefined> }) {
        const child = spawn('git', options.argv.slice(1), { cwd: options.cwd, env: testEnvironment() })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (data: Buffer) => { stdout += data.toString() })
        child.stderr.on('data', (data: Buffer) => { stderr += data.toString() })
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
  return { root, repo, port }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Git tag port', () => {
  it('creates a lightweight tag and lists it with an unknown push state without a remote', async () => {
    const { repo, port } = await fixture()

    await port.createTag(repo, 'v1.0.0')
    const tags = await port.listTags(repo)

    expect(tags.map(tag => tag.name)).toEqual(['v1.0.0'])
    const tag = tags[0]!
    expect(tag.annotated).toBe(false)
    // A lightweight tag points straight at the commit, so both oids coincide.
    expect(tag.oid).toBe(tag.commitOid)
    expect(tag.message).toBeNull()
    // No `origin` exists, so the remote was never queried: reporting `false`
    // here would claim "not pushed" for a repository that cannot push at all.
    expect(tag.pushed).toBeNull()
    expect(git(repo, ['rev-parse', 'refs/tags/v1.0.0']).stdout.trim()).toBe(tag.commitOid)
  })

  it('creates an annotated tag whose message survives the round trip', async () => {
    const { repo, port } = await fixture()

    await port.createTag(repo, 'v2.0.0', { message: 'second release' })
    const [tag] = await port.listTags(repo)

    expect(tag).toMatchObject({ name: 'v2.0.0', annotated: true, message: 'second release' })
    // An annotated tag has its own tag object oid distinct from the commit.
    expect(tag!.oid).not.toBe(tag!.commitOid)
    expect(git(repo, ['cat-file', '-t', tag!.oid]).stdout.trim()).toBe('tag')
    expect(git(repo, ['cat-file', '-t', tag!.commitOid]).stdout.trim()).toBe('commit')
  })

  it('creates a tag on an explicit target commit rather than HEAD', async () => {
    const { repo, port } = await fixture()
    const first = git(repo, ['rev-parse', 'HEAD']).stdout.trim()
    git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-m', 'second'])

    await port.createTag(repo, 'v-old', { target: first })
    const [tag] = await port.listTags(repo)

    expect(tag!.commitOid).toBe(first)
  })

  it('rejects a duplicate tag name instead of overwriting it', async () => {
    const { repo, port } = await fixture()
    await port.createTag(repo, 'v1.0.0')

    await expect(port.createTag(repo, 'v1.0.0')).rejects.toMatchObject({ code: 'git_operation_failed' })
    expect(git(repo, ['rev-parse', 'refs/tags/v1.0.0']).status).toBe(0)
  })

  it('rejects a tag name that git itself would refuse', async () => {
    const { repo, port } = await fixture()

    await expect(port.createTag(repo, 'bad name')).rejects.toMatchObject({ code: 'git_operation_failed' })
    expect(git(repo, ['tag', '--list']).stdout.trim()).toBe('')
  })

  it('deletes a local tag and reports a missing tag as an error', async () => {
    const { repo, port } = await fixture()
    await port.createTag(repo, 'v1.0.0')

    await port.deleteLocalTag(repo, 'v1.0.0')
    expect(await port.listTags(repo)).toEqual([])
    await expect(port.deleteLocalTag(repo, 'v1.0.0')).rejects.toMatchObject({ code: 'git_operation_failed' })
  })

  it('marks a tag pushed once it exists on the remote', async () => {
    const { root, repo, port } = await fixture()
    const remote = join(root, 'remote.git')
    git(root, ['init', '--bare', '-b', 'main', remote])
    git(repo, ['remote', 'add', 'origin', remote])
    await port.createTag(repo, 'v1.0.0')

    expect((await port.listTags(repo))[0]!.pushed).toBe(false)
    expect(await port.pushTag(repo, 'v1.0.0')).toMatchObject({ ok: true })
    expect((await port.listTags(repo))[0]!.pushed).toBe(true)
    expect(git(remote, ['tag', '--list']).stdout.trim()).toBe('v1.0.0')
  })

  it('reports a failed push without throwing, so the local tag survives', async () => {
    const { repo, port } = await fixture()
    await port.createTag(repo, 'v1.0.0')

    // No origin is configured: the push must fail as data, not as an exception.
    expect(await port.pushTag(repo, 'v1.0.0')).toMatchObject({ ok: false })
    expect(git(repo, ['tag', '--list']).stdout.trim()).toBe('v1.0.0')
  })

  it('deletes the remote tag while keeping the local one when asked for the remote only', async () => {
    const { root, repo, port } = await fixture()
    const remote = join(root, 'remote.git')
    git(root, ['init', '--bare', '-b', 'main', remote])
    git(repo, ['remote', 'add', 'origin', remote])
    await port.createTag(repo, 'v1.0.0')
    await port.pushTag(repo, 'v1.0.0')

    expect(await port.deleteRemoteTag(repo, 'v1.0.0')).toMatchObject({ ok: true })
    expect(git(remote, ['tag', '--list']).stdout.trim()).toBe('')
    expect(git(repo, ['tag', '--list']).stdout.trim()).toBe('v1.0.0')
    expect((await port.listTags(repo))[0]!.pushed).toBe(false)
  })

  it('keeps the tag marker in graph decorations so tags and branches stay distinguishable', async () => {
    const { repo, port } = await fixture()
    await port.createTag(repo, 'v1.0.0')

    const commits = await port.graphLog(repo, 5)
    const head = commits[0]!

    expect(head.refs).toContain('tag:v1.0.0')
    expect(head.refs).toContain('main')
    // The bare branch ref must not be mistaken for a tag marker.
    expect(head.refs).not.toContain('tag:main')
  })
})
