import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import {
  createManagedWorktreeDirectoryName,
  createManagedWorktreePathCandidates,
  createManagedWorktreeRepositoryKey,
  createTopicDateStamp,
  createTopicManagedWorktreeDirectoryName,
  sanitizeManagedWorktreeLabel,
} from '../src/managed-worktree-path.ts'

describe('managed worktree path', () => {
  test('保留中文并清理 Windows 非法字符与空格', () => {
    expect(sanitizeManagedWorktreeLabel('  修复 Worktree: 路径/命名？  ')).toBe('修复-Worktree-路径-命名？')
  })

  test('处理 Windows 保留名、空名称与过长仓库名', () => {
    expect(sanitizeManagedWorktreeLabel('CON')).toBe('_CON')
    expect(sanitizeManagedWorktreeLabel('')).toBe('repository')
    expect(Array.from(sanitizeManagedWorktreeLabel('很长'.repeat(30))).length).toBe(40)
  })

  test('物理目录只包含可信仓库名、Checkout 短 ID 和 worktree 后缀', () => {
    expect(createManagedWorktreeDirectoryName({
      repositoryName: 'dsh-git-worktree',
      checkoutId: '85846a61-4a12-41cf-8ecc-1e3f2fef7e40',
    })).toBe('dsh-git-worktree--85846a61--worktree')
  })

  test('短 ID 路径冲突时可以确定性扩展到更长 identity', () => {
    expect(createManagedWorktreeDirectoryName({
      repositoryName: 'dsh-git-worktree',
      checkoutId: '85846a61-4a12-41cf-8ecc-1e3f2fef7e40',
      identityLength: 12,
    })).toBe('dsh-git-worktree--85846a614a12--worktree')
    expect(createManagedWorktreeDirectoryName({
      repositoryName: 'dsh-git-worktree',
      checkoutId: '85846a61-4a12-41cf-8ecc-1e3f2fef7e40',
      identityLength: 32,
    })).toBe('dsh-git-worktree--85846a614a1241cf8ecc1e3f2fef7e40--worktree')
  })

  test('候选路径集中到仓库同级容器，并在插件 worktrees 根按仓库 key 回退', () => {
    const candidates = createManagedWorktreePathCandidates({
      localGitRoot: join('D:', 'workspace', 'dsh-git-worktree'),
      managedCheckoutsRoot: join('C:', 'Users', 'A', '.dsh', 'plugins', 'dsh-git-worktree'),
      repositoryKey: '345d83347b',
      checkoutId: '85846a61-4a12-41cf-8ecc-1e3f2fef7e40',
    })

    const directoryName = 'dsh-git-worktree--85846a61--worktree'
    expect(candidates.siblingContainer).toBe(join('D:', 'workspace', 'dsh-git-worktree--worktrees'))
    expect(candidates.siblingRoot).toBe(join('D:', 'workspace', 'dsh-git-worktree--worktrees', directoryName))
    expect(candidates.fallbackRoot).toBe(join(
      'C:', 'Users', 'A', '.dsh', 'plugins', 'dsh-git-worktree', 'worktrees', '345d83347b', directoryName,
    ))
  })

  test('fallback repository key 绑定 canonical Git root 而不是可冲突的 basename', () => {
    expect(createManagedWorktreeRepositoryKey('D:/workspace/team-a/repo'))
      .not.toBe(createManagedWorktreeRepositoryKey('D:/workspace/team-b/repo'))
    expect(createManagedWorktreeRepositoryKey('D:/workspace/team-a/repo')).toMatch(/^[a-f0-9]{12}$/)
  })

  test('主题命名：<主题>-<YYYYMMDD>，首候选无后缀，冲突候选追加短 ID', () => {
    expect(createTopicManagedWorktreeDirectoryName({
      topic: '修复 Worktree: 命名？',
      dateStamp: '20260926',
      checkoutId: '85846a61-4a12-41cf-8ecc-1e3f2fef7e40',
    })).toBe('修复-Worktree-命名？-20260926')
    expect(createTopicManagedWorktreeDirectoryName({
      topic: '修复命名',
      dateStamp: '20260926',
      checkoutId: '85846a61-4a12-41cf-8ecc-1e3f2fef7e40',
      identityLength: 12,
    })).toBe('修复命名-20260926-85846a614a12')
  })

  test('主题日期取本地日期，格式为 YYYYMMDD', () => {
    expect(createTopicDateStamp(new Date(2026, 8, 26, 23, 59))).toBe('20260926')
    expect(createTopicDateStamp(new Date(2026, 0, 5, 0, 0))).toBe('20260105')
  })

  test('配置 worktreesRoot 后候选集中到 <root>/<项目>（主题模式）或 <root>/<repoKey>（默认命名）', () => {
    const topicCandidates = createManagedWorktreePathCandidates({
      localGitRoot: join('D:', 'workspace', 'dsh-git-worktree'),
      managedCheckoutsRoot: join('C:', 'Users', 'A', '.dsh', 'plugins', 'dsh-git-worktree'),
      repositoryKey: '345d83347b',
      checkoutId: '85846a61-4a12-41cf-8ecc-1e3f2fef7e40',
      topic: '自动验收',
      dateStamp: '20260926',
      worktreesRoot: join('E:', 'ik', 'Documents', 'trae_projects', 'worktrae'),
    })
    expect(topicCandidates.siblingContainer).toBe(join('E:', 'ik', 'Documents', 'trae_projects', 'worktrae', 'dsh-git-worktree'))
    expect(topicCandidates.siblingRoot).toBe(join('E:', 'ik', 'Documents', 'trae_projects', 'worktrae', 'dsh-git-worktree', '自动验收-20260926'))
    expect(topicCandidates.fallbackContainer).toBe(topicCandidates.siblingContainer)
    expect(topicCandidates.fallbackRoot).toBe(topicCandidates.siblingRoot)

    const stockCandidates = createManagedWorktreePathCandidates({
      localGitRoot: join('D:', 'workspace', 'dsh-git-worktree'),
      managedCheckoutsRoot: join('C:', 'Users', 'A', '.dsh', 'plugins', 'dsh-git-worktree'),
      repositoryKey: '345d83347b',
      checkoutId: '85846a61-4a12-41cf-8ecc-1e3f2fef7e40',
      worktreesRoot: join('E:', 'ik', 'Documents', 'trae_projects', 'worktrae'),
    })
    expect(stockCandidates.siblingContainer).toBe(join('E:', 'ik', 'Documents', 'trae_projects', 'worktrae', '345d83347b'))
    expect(stockCandidates.siblingRoot).toBe(join('E:', 'ik', 'Documents', 'trae_projects', 'worktrae', '345d83347b', 'dsh-git-worktree--85846a61--worktree'))
  })

  test('未配置 worktreesRoot 时保持上游同级容器 + 状态目录回退行为', () => {
    const candidates = createManagedWorktreePathCandidates({
      localGitRoot: join('D:', 'workspace', 'dsh-git-worktree'),
      managedCheckoutsRoot: join('C:', 'Users', 'A', '.dsh'),
      repositoryKey: '345d83347b',
      checkoutId: '85846a61-4a12-41cf-8ecc-1e3f2fef7e40',
      topic: '自动验收',
    })
    expect(candidates.siblingContainer).toBe(join('D:', 'workspace', 'dsh-git-worktree--worktrees'))
    expect(candidates.siblingRoot).toBe(join('D:', 'workspace', 'dsh-git-worktree--worktrees', 'dsh-git-worktree--85846a61--worktree'))
  })
})
