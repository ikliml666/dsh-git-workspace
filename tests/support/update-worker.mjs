// registry.update 的跨进程替身：同一个锁文件、同样的「锁内读-改-写」。
import { readFileSync, writeFileSync } from 'node:fs'
import './ts-resolve-hooks.mjs'

const { withFileLock } = await import('../../src/adapters/safe-file.ts')

const [target, worker] = process.argv.slice(2)

function record(checkoutId) {
  const oid = 'a'.repeat(40)
  return {
    checkoutId, projectId: 'project-1', projectName: 'Project',
    ownerSessionId: 'target-session', localRoot: '/local', managedRoot: '/managed',
    managedGitRoot: '/managed', gitCommonDir: '/git/common', gitDir: '/git/worktrees/one',
    baseOid: oid, sourceRef: 'refs/heads/main', phase: 'ready', journal: null, revision: 7,
    delivery: { state: 'working', iteration: 1 },
  }
}

for (const suffix of ['a', 'b']) {
  withFileLock(target, () => {
    const registry = JSON.parse(readFileSync(target, 'utf-8'))
    registry.revision += 1
    registry.managedCheckouts[`worker-${worker}-${suffix}`] = record(`worker-${worker}-${suffix}`)
    writeFileSync(target, JSON.stringify(registry))
  }, { timeoutMs: 30_000 })
}
