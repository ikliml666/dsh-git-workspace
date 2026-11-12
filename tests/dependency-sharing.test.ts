import { describe, expect, test } from 'vitest'
import { dependencyRootOf, findDependencyDrift } from '../src/dependency-sharing.js'

// join() 在 Windows 产出反斜杠，测试里统一成 / 再查表。
const toKey = (path: string): string => path.split(/[\\/]/u).join('/')
const reader = (files: Record<string, string>) => (path: string): string | null => files[toKey(path)] ?? null

describe('dependency sharing safety', () => {
  test('a dependency directory resolves to the package root that declares it', () => {
    expect(dependencyRootOf('android/frontend/node_modules')).toBe('android/frontend')
    expect(dependencyRootOf('node_modules')).toBe('.')
    expect(dependencyRootOf('node_modules/@scope/pkg/node_modules')).toBe('node_modules/@scope/pkg')
  })

  test('identical declarations allow sharing', () => {
    const files = {
      '/local/app/package.json': '{"dependencies":{}}',
      '/local/app/pnpm-lock.yaml': 'lockfileVersion: 9',
      '/worktree/app/package.json': '{"dependencies":{}}',
      '/worktree/app/pnpm-lock.yaml': 'lockfileVersion: 9',
    }
    expect(findDependencyDrift('/local', '/worktree', 'app/node_modules', reader(files))).toBeNull()
  })

  test('a drifted package.json blocks sharing', () => {
    const files = {
      '/local/app/package.json': '{"dependencies":{"a":"1"}}',
      '/worktree/app/package.json': '{"dependencies":{"a":"2"}}',
    }
    expect(findDependencyDrift('/local', '/worktree', 'app/node_modules', reader(files)))
      .toEqual({ manifest: 'package.json' })
  })

  test('a drifted lockfile blocks sharing even when package.json matches', () => {
    const files = {
      '/local/app/package.json': '{}',
      '/local/app/package-lock.json': '{"lockfileVersion":3}',
      '/worktree/app/package.json': '{}',
      '/worktree/app/package-lock.json': '{"lockfileVersion":2}',
    }
    expect(findDependencyDrift('/local', '/worktree', 'app/node_modules', reader(files)))
      .toEqual({ manifest: 'package-lock.json' })
  })

  test('a declaration that exists on only one side is drift', () => {
    const files = {
      '/local/app/package.json': '{}',
      '/local/app/yarn.lock': '# yarn lockfile v1',
      '/worktree/app/package.json': '{}',
    }
    expect(findDependencyDrift('/local', '/worktree', 'app/node_modules', reader(files)))
      .toEqual({ manifest: 'yarn.lock' })
  })

  test('no declaration files at all means there is nothing to compare', () => {
    expect(findDependencyDrift('/local', '/worktree', 'app/node_modules', reader({}))).toBeNull()
  })
})
