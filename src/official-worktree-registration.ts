import { resolve } from 'node:path'
import type {
  ManagedCheckoutRecord,
  SessionCheckoutGitPort,
  SessionCheckoutLookupPort,
  SessionCheckoutRegistryPort,
} from './ports.js'

export interface OfficialWorktreeRegistrationDependencies {
  lookup: SessionCheckoutLookupPort
  git: SessionCheckoutGitPort
  registry: SessionCheckoutRegistryPort
  createCheckoutId(): string
}

/** 一次官方 `worktrees.create` 的结果，加它所属的项目与会话。 */
export interface OfficialWorktreeRegistration {
  ownerSessionId: string
  projectId: string
  projectName: string
  localRoot: string
  /** 官方建好的 checkout 目录。 */
  path: string
  /** 官方建好的分支名（同时是目录名）。 */
  branch: string
  /** 分叉基准提交。 */
  baseCommit: string
}

/**
 * 把官方 `worktrees.create` 刚建好的一棵树登记进台账。
 *
 * 官方的 `worktrees` 服务负责真正的 Git 操作，本插件负责把它记进台账，这样
 * 列表、交付、评审、清理对这棵树一样有效。归属不需要猜测——调用方就是这棵树
 * 的 owner。
 */
export async function registerOfficialWorktree(
  dependencies: OfficialWorktreeRegistrationDependencies,
  registration: OfficialWorktreeRegistration,
): Promise<ManagedCheckoutRecord> {
  const { git, registry } = dependencies
  const snapshot = await git.inspect(registration.path)
  if (snapshot === null) {
    throw new Error(`The new worktree at ${registration.path} is not a readable Git checkout`)
  }
  const checkoutId = dependencies.createCheckoutId()
  const record: ManagedCheckoutRecord = {
    checkoutId,
    projectId: registration.projectId,
    projectName: registration.projectName,
    ownerSessionId: registration.ownerSessionId,
    sourceSessionId: registration.ownerSessionId,
    localRoot: resolve(registration.localRoot),
    managedRoot: resolve(registration.path),
    managedGitRoot: resolve(snapshot.root),
    gitCommonDir: snapshot.commonDir,
    gitDir: snapshot.gitDir,
    baseOid: registration.baseCommit,
    sourceRef: snapshot.headRef,
    sessionBranch: registration.branch,
    // 官方已经完成 checkout，这棵树从诞生起就是就绪态。
    phase: 'ready',
    delivery: { state: 'working', iteration: 1 },
    journal: null,
    revision: 1,
  }
  registry.update(next => ({
    ...next,
    revision: next.revision + 1,
    managedCheckouts: { ...next.managedCheckouts, [checkoutId]: record },
    sessionBindings: {
      ...next.sessionBindings,
      [registration.ownerSessionId]: {
        sessionId: registration.ownerSessionId,
        projectId: registration.projectId,
        projectName: registration.projectName,
        target: { kind: 'isolated', checkoutId },
        ownerSessionId: registration.ownerSessionId,
        sourceRef: snapshot.headRef,
        sourceOid: snapshot.headOid,
        revision: (next.sessionBindings[registration.ownerSessionId]?.revision ?? 0) + 1,
      },
    },
  }))
  return record
}
