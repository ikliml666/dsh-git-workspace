import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { readJsonFileSafe, withFileLock, writeJsonFileAtomic, writeTextFileAtomic } from '../src/adapters/safe-file.js'

const dirs: string[] = []
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-git-worktree-safe-file-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('Safe JSON file persistence', () => {
  test('the newest parsable tmp residue is promoted on read and the rest is cleaned', () => {
    const dir = scratch()
    const path = join(dir, 'index.json')
    writeFileSync(`${path}.111.older.tmp`, JSON.stringify({ value: 'older' }), 'utf8')
    writeFileSync(`${path}.222.newest.tmp`, JSON.stringify({ value: 'newest' }), 'utf8')
    writeFileSync(`${path}.333.truncated.tmp`, '{"value": "trunc', 'utf8')
    utimesSync(`${path}.111.older.tmp`, new Date(1000), new Date(1000))
    utimesSync(`${path}.222.newest.tmp`, new Date(2000), new Date(2000))

    expect(readJsonFileSafe<{ value: string }>(path)).toEqual({ value: 'newest' })
    expect(readJsonFileSafe<{ value: string }>(path)).toEqual({ value: 'newest' })
    expect(readdirSync(dir).filter(name => name.endsWith('.tmp'))).toEqual([])
  })

  test('legacy fixed <file>.tmp residue is also promoted', () => {
    const dir = scratch()
    const path = join(dir, 'index.json')
    writeFileSync(`${path}.tmp`, JSON.stringify({ value: 'legacy' }), 'utf8')

    expect(readJsonFileSafe<{ value: string }>(path)).toEqual({ value: 'legacy' })
    expect(readdirSync(dir).filter(name => name.endsWith('.tmp'))).toEqual([])
  })

  test('when no residue is parsable, tmp files are cleaned and null is returned', () => {
    const dir = scratch()
    const path = join(dir, 'index.json')
    writeFileSync(`${path}.444.truncated.tmp`, '{"value": "trunc', 'utf8')
    writeFileSync(`${path}.555.empty.tmp`, '   ', 'utf8')

    expect(readJsonFileSafe<{ value: string }>(path)).toBeNull()
    expect(readdirSync(dir).filter(name => name.endsWith('.tmp'))).toEqual([])
  })

  test('atomic writes leave no tmp behind and the .bak keeps the previous good content', () => {
    const dir = scratch()
    const path = join(dir, 'index.json')
    writeJsonFileAtomic(path, { round: 1 })
    expect(readJsonFileSafe<{ round: number }>(path)).toEqual({ round: 1 })
    expect(readdirSync(dir).filter(name => name.endsWith('.tmp'))).toEqual([])

    writeJsonFileAtomic(path, { round: 2 })
    expect(JSON.parse(readFileSync(`${path}.bak`, 'utf8'))).toEqual({ round: 1 })
    writeFileSync(path, '{broken', 'utf8')
    expect(readJsonFileSafe<{ round: number }>(path)).toEqual({ round: 1 })
    expect(readJsonFileSafe<{ round: number }>(path)).toEqual({ round: 1 })
  })

  test('writeTextFileAtomic replaces the whole content', () => {
    const dir = scratch()
    const path = join(dir, 'journal.jsonl')
    writeTextFileAtomic(path, 'one\n')
    writeTextFileAtomic(path, 'one\ntwo\n')
    expect(readFileSync(path, 'utf8')).toBe('one\ntwo\n')
    expect(readdirSync(dir).filter(name => name.endsWith('.tmp'))).toEqual([])
  })
})

describe('Cross-process file lock', () => {
  const lockPathOf = (path: string): string => `${path}.lock`

  test('the lock file is created while held and removed on release', () => {
    const dir = scratch()
    const path = join(dir, 'registry.json')
    withFileLock(path, () => {
      expect(existsSync(lockPathOf(path))).toBe(true)
    })
    expect(existsSync(lockPathOf(path))).toBe(false)
  })

  test('a lock left by a dead pid is reclaimed', () => {
    const dir = scratch()
    const path = join(dir, 'registry.json')
    writeFileSync(lockPathOf(path), JSON.stringify({ pid: 0x7ffffff, createdAt: Date.now(), token: 'dead-holder' }), 'utf8')

    expect(withFileLock(path, () => 'acquired', { timeoutMs: 2000 })).toBe('acquired')
    expect(existsSync(lockPathOf(path))).toBe(false)
  })

  test('a lock older than the stale threshold is reclaimed even if its pid is alive', () => {
    const dir = scratch()
    const path = join(dir, 'registry.json')
    writeFileSync(lockPathOf(path), JSON.stringify({ pid: process.pid, createdAt: Date.now() - 60_000, token: 'slow-holder' }), 'utf8')

    expect(withFileLock(path, () => 'acquired', { timeoutMs: 2000, staleAfterMs: 30_000 })).toBe('acquired')
  })

  test('an old unreadable lock file is reclaimed instead of blocking forever', () => {
    const dir = scratch()
    const path = join(dir, 'registry.json')
    writeFileSync(lockPathOf(path), '{not json', 'utf8')
    utimesSync(lockPathOf(path), new Date(1000), new Date(1000))

    expect(withFileLock(path, () => 'acquired', { timeoutMs: 2000 })).toBe('acquired')
  })

  test('a fresh unreadable lock file is not stolen from a holder that is still writing it', () => {
    const dir = scratch()
    const path = join(dir, 'registry.json')
    writeFileSync(lockPathOf(path), '', 'utf8')

    expect(() => withFileLock(path, () => 'unreachable', { timeoutMs: 120 }))
      .toThrowError(/120ms/u)
    expect(existsSync(lockPathOf(path))).toBe(true)
  })

  test('a live foreign lock makes the acquisition fail loudly on timeout', () => {
    const dir = scratch()
    const path = join(dir, 'registry.json')
    writeFileSync(lockPathOf(path), JSON.stringify({ pid: process.pid, createdAt: Date.now(), token: 'other-owner' }), 'utf8')

    expect(() => withFileLock(path, () => 'unreachable', { timeoutMs: 120, staleAfterMs: 60_000 }))
      .toThrowError(/120ms/u)
    expect(JSON.parse(readFileSync(lockPathOf(path), 'utf8')).token).toBe('other-owner')
  })

  test('nested acquisition in one process does not deadlock', () => {
    const dir = scratch()
    const path = join(dir, 'registry.json')

    expect(withFileLock(path, () => withFileLock(path, () => 'inner'))).toBe('inner')
    expect(existsSync(lockPathOf(path))).toBe(false)
  })
})
