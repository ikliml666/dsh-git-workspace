import { dirname, join } from 'node:path'

/**
 * 共享依赖目录前必须先证明两边的依赖声明一致。
 *
 * 主流的做法是每个 Worktree 自己安装依赖（pnpm store / Yarn PnP 让这一步很快），
 * 而不是把 node_modules 链到主 checkout：链接之后任何一次 `npm install` 都会写穿
 * 到主仓库，正在并行工作的其它会话会当场被换掉环境。
 *
 * 但大仓库里装一次要几分钟，只读共享仍有价值。所以共享的前提是：主仓库与
 * Worktree 的 package.json 与 lock 文件逐字节相同——依赖树没有漂移，链接才安全。
 */
export const DEPENDENCY_MANIFESTS = [
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'npm-shrinkwrap.json',
  'bun.lock',
  'bun.lockb',
] as const

/**
 * 依赖目录所属的包根：`android/frontend/node_modules` → `android/frontend`。
 * 嵌套依赖（`node_modules/a/node_modules`）取最后一个 node_modules 之前的部分。
 */
export function dependencyRootOf(relativePath: string): string {
  const segments = relativePath.split('/')
  const index = segments.lastIndexOf('node_modules')
  const root = index >= 0 ? segments.slice(0, index).join('/') : dirname(relativePath)
  // 顶层 node_modules 的父路径是空串，统一成当前目录。
  return root === '' ? '.' : root
}

export interface DependencyDrift {
  manifest: string
  /** 人可读的差异摘要：首个不同行，以及是否只差行尾/空白。 */
  detail?: string
}

/** 找出第一处不同的行；只差行尾空白时单独标注，避免被当成版本漂移。 */
function describeDifference(local: string, worktree: string): string {
  const left = local.split('\n')
  const right = worktree.split('\n')
  const limit = Math.max(left.length, right.length)
  for (let index = 0; index < limit; index += 1) {
    if (left[index] === right[index]) continue
    return (left[index] ?? '').trim() === (right[index] ?? '').trim()
      ? `line ${index + 1} differs only in trailing whitespace`
      : `line ${index + 1} differs`
  }
  return 'content differs'
}

/**
 * 返回第一个不一致的依赖声明文件；两边都没有声明文件时返回 null（无从判断，
 * 不阻断）。read 由调用方注入，便于测试与端口替换。
 */
export function findDependencyDrift(
  localRoot: string,
  worktreeRoot: string,
  relativePath: string,
  read: (path: string) => string | null,
): DependencyDrift | null {
  const root = dependencyRootOf(relativePath)
  // 行尾不是依赖内容：主仓库工作区常是 CRLF，Worktree 检出是 LF，逐字节比较会把
  // 「完全相同的声明」判成漂移，共享被全量拒绝。比较前统一成 LF。
  const normalize = (value: string | null): string | null =>
    value === null ? null : value.replace(/\r\n/g, '\n')
  for (const manifest of DEPENDENCY_MANIFESTS) {
    const local = normalize(read(join(localRoot, root, manifest)))
    const worktree = normalize(read(join(worktreeRoot, root, manifest)))
    if (local === null && worktree === null) continue
    // Worktree 侧读不到：该文件在那边不可见（被 .gitignore 忽略、未被跟踪，或根本没检出）。
    // 隔离工作区只含 git 跟踪内容，把 ignored 的锁文件纳入比较必然判「不一致」，
    // 依赖共享会永远失败。以 Worktree 能看到的声明为准。
    if (worktree === null) continue
    if (local === null) return { manifest, detail: 'missing in Local' }
    if (local !== worktree) return { manifest, detail: describeDifference(local, worktree) }
  }
  return null
}
