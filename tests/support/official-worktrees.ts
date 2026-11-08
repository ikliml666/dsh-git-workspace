/**
 * 测试用的官方 `worktrees` 服务替身。
 *
 * 本插件不再自己建树：产品路径是「Host 的 worktrees 服务做 Git，本插件记账」。
 * 因此每个需要一棵真树的测试都要注入这个替身——它真的跑 `git worktree add`，
 * 落在官方布局 `<repo>/.agents/worktrees/<branch>` 下。
 */

import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import type { OfficialWorktreesPort } from '../../src/ports.js'

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

export interface OfficialWorktreesFixture {
  port: OfficialWorktreesPort
  /** 这个替身建过的树，按建树顺序。 */
  created: Array<{ path: string; branch: string; baseCommit: string }>
  /** 每次 `create` 收到的请求，供断言基点与分支名。 */
  requests: Array<{ branch: string; from: string }>
}

export function createOfficialWorktreesFixture(repositoryRoot: string): OfficialWorktreesFixture {
  const created: OfficialWorktreesFixture['created'] = []
  const requests: OfficialWorktreesFixture['requests'] = []
  let counter = 0
  return {
    created,
    requests,
    port: {
      create: async (_agent, request = {}) => {
        counter += 1
        const branch = request.name ?? `dsh-fixture-${counter}`
        const from = request.from ?? 'HEAD'
        requests.push({ branch, from })
        const pool = join(repositoryRoot, '.agents', 'worktrees')
        mkdirSync(pool, { recursive: true })
        // 官方 prepareDirectory 会写一个自忽略的 .gitignore；漏掉它，「继承本地
        // 未提交修改」会把新树自己拷进自己。
        writeFileSync(join(pool, '.gitignore'), '*\n')
        const path = join(pool, branch)
        git(repositoryRoot, ['worktree', 'add', '-b', branch, path, from])
        const entry = { path: realpathSync(path), branch, baseCommit: git(path, ['rev-parse', 'HEAD']).trim() }
        created.push(entry)
        return { ...entry, repositoryRoot: realpathSync(repositoryRoot) }
      },
      restore: async () => {
        throw new Error('restore is not used by these tests')
      },
    },
  }
}
