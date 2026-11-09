import { describe, expect, test } from 'vitest'
import { parseLocalBranchSwitchIssue } from '../src/adapters/git.js'

describe('parseLocalBranchSwitchIssue', () => {
  test('extracts the tracked-file list Git refuses to overwrite', () => {
    const issue = parseLocalBranchSwitchIssue([
      "error: Your local changes to the following files would be overwritten by checkout:",
      '\tsrc/app.ts',
      '\t"src/with space.ts"',
      'Please commit your changes or stash them before you switch branches.',
    ].join('\n'))

    expect(issue.code).toBe('tracked-changes-would-be-overwritten')
    expect(issue.paths).toEqual(['src/app.ts', 'src/with space.ts'])
    expect(issue.detail).toContain('would be overwritten')
  })

  test('extracts the untracked-file list Git refuses to overwrite', () => {
    const issue = parseLocalBranchSwitchIssue([
      'error: The following untracked working tree files would be overwritten by switch:',
      '\tdocs/new.md',
      'Aborting',
    ].join('\n'))

    expect(issue.code).toBe('untracked-changes-would-be-overwritten')
    expect(issue.paths).toEqual(['docs/new.md'])
  })

  test('classifies a branch checked out in another worktree', () => {
    const issue = parseLocalBranchSwitchIssue("fatal: 'feature' is already used by worktree at 'D:/other'")
    expect(issue.code).toBe('branch-in-other-worktree')
    expect(issue.paths).toEqual([])
  })

  test('classifies unresolved conflicts and in-progress operations', () => {
    expect(parseLocalBranchSwitchIssue('error: you need to resolve your current index first').code)
      .toBe('conflicts-present')
    expect(parseLocalBranchSwitchIssue('fatal: cannot switch branch while merging').code)
      .toBe('operation-in-progress')
  })

  test('classifies a missing target and keeps unknown refusals verbatim', () => {
    expect(parseLocalBranchSwitchIssue("fatal: invalid reference: nope").code).toBe('target-branch-not-found')
    const unknown = parseLocalBranchSwitchIssue('fatal: something entirely new')
    expect(unknown.code).toBe('unknown')
    expect(unknown.detail).toBe('fatal: something entirely new')
  })
})
