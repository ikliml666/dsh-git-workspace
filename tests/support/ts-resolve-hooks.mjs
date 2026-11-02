// Vitest 之外的子进程里直接跑 TS 源码：把相对 './x.js' 解析回同目录的 x.ts。
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const candidate = new URL(specifier, context.parentURL)
      const tsPath = fileURLToPath(candidate).replace(/\.js$/u, '.ts')
      if (existsSync(tsPath)) return { url: pathToFileURL(tsPath).href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})
