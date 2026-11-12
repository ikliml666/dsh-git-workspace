import { describe, expect, test } from 'vitest'
import { SessionCheckoutError } from '../src/index.js'
import { parseWorktreeConfig, resolveConfiguredPaths } from '../src/worktree-config.js'

// 断言只用语言无关的部分（文件路径、字段名、原始输入），
// 文案本身随 locale 变化，钉死英文或中文都会在另一种语言下失败。
describe('project worktree config', () => {
  test('a missing or empty file means no configuration', () => {
    expect(parseWorktreeConfig(null, '/repo/.dsh-worktree.json')).toEqual({ linkDeps: [], preservePaths: [] })
    expect(parseWorktreeConfig('  \n', '/repo/.dsh-worktree.json')).toEqual({ linkDeps: [], preservePaths: [] })
  })

  test('paths are normalized so both /node_modules and node_modules/ work', () => {
    const config = parseWorktreeConfig(JSON.stringify({
      linkDeps: ['/android/frontend/node_modules/', 'tauri-app\\node_modules'],
      preservePaths: ['changelogs/'],
    }), '/repo/.dsh-worktree.json')

    expect(config.linkDeps).toEqual(['android/frontend/node_modules', 'tauri-app/node_modules'])
    expect(config.preservePaths).toEqual(['changelogs'])
  })

  test('invalid JSON fails loudly instead of silently disabling the config', () => {
    expect(() => parseWorktreeConfig('{ nope', '/repo/.dsh-worktree.json'))
      .toThrow(SessionCheckoutError)
    expect(() => parseWorktreeConfig('{ nope', '/repo/.dsh-worktree.json'))
      .toThrow(/\.dsh-worktree\.json/)
  })

  test('a non-object payload is rejected', () => {
    expect(() => parseWorktreeConfig('["node_modules"]', '/repo/.dsh-worktree.json'))
      .toThrow(SessionCheckoutError)
  })

  test('a field that is not a string array is rejected', () => {
    expect(() => parseWorktreeConfig('{"linkDeps":"node_modules"}', '/repo/.dsh-worktree.json'))
      .toThrow(/linkDeps/)
    expect(() => parseWorktreeConfig('{"preservePaths":[1]}', '/repo/.dsh-worktree.json'))
      .toThrow(/preservePaths/)
  })

  test('paths may not escape the Worktree', () => {
    expect(() => parseWorktreeConfig('{"linkDeps":["../node_modules"]}', '/repo/.dsh-worktree.json'))
      .toThrow(/\.\.\/node_modules/)
    expect(() => parseWorktreeConfig('{"linkDeps":[""]}', '/repo/.dsh-worktree.json'))
      .toThrow(SessionCheckoutError)
  })

  test('explicit arguments win over the project config', () => {
    expect(resolveConfiguredPaths(['a/node_modules'], ['b/node_modules'])).toEqual(['a/node_modules'])
    expect(resolveConfiguredPaths(undefined, ['b/node_modules'])).toEqual(['b/node_modules'])
    // 显式空数组表示这一轮不用项目配置。
    expect(resolveConfiguredPaths([], ['b/node_modules'])).toEqual([])
  })
})
