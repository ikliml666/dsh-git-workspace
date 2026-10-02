import { mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { readJsonFileSafe, writeJsonFileAtomic, writeTextFileAtomic } from '../src/adapters/safe-file.js'

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
