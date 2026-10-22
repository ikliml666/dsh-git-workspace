/**
 * 宿主与插件自己写进会话 cwd 的运行期产物。
 *
 * 会话 cwd 就在受管 Worktree 里，因此 DSH 面板日志、桌面运行期标记这类文件
 * 会出现在工作区里；它们不是会话的交付物。把它们排除在评审变更集、交付提交
 * 与清理指纹之外，才能让「评审看到的」等于「交付出去的」，也才不会因为面板
 * 又写了几行日志就把一次合法交付判成 stale。
 *
 * 规则只覆盖插件确知由宿主写出的路径，不猜测业务目录（build/、dist/ 之类由
 * 用户自己的 .gitignore 决定，git 本来就已忽略未跟踪的忽略项）。
 */
export const HOST_RUNTIME_ARTIFACTS: readonly string[] = [
  '.dsh-ops',
  'desktop-runtime.json',
  '.dsh-runtime.json',
]

/**
 * 转成 git pathspec 排除项。目录按「整棵子树」排除，另加一层 `**` 变体以覆盖
 * 嵌套出现的情况（同一插件在子目录里再挂一份工作区时会发生）。
 */
export function deliveryExcludePathspecs(paths: readonly string[] = HOST_RUNTIME_ARTIFACTS): string[] {
  const specs: string[] = []
  for (const raw of paths) {
    const path = raw.trim().replace(/^[/\\]+/u, '').replace(/[/\\]+$/u, '')
    if (!path) continue
    specs.push(`:(exclude)${path}`, `:(exclude)${path}/**`, `:(exclude,glob)**/${path}`, `:(exclude,glob)**/${path}/**`)
  }
  return specs
}
