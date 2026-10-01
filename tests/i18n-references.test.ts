import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { clientMessages } from '../src/i18n/client-messages.js'
import { hostMessages } from '../src/i18n/host-messages.js'

// 回归护栏：代码里引用的字面 i18n 键必须存在于消息目录。
// 目录内部一致性（双语、占位符）由 i18n-catalogs.test.ts 负责。
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? walk(path) : /\.(ts|tsx)$/u.test(entry.name) ? [path] : []
  })
}

const srcRoot = fileURLToPath(new URL('../src', import.meta.url))
const files = walk(srcRoot).filter((path) => !path.includes(`${srcRoot.split(/[\\/]/u).pop() === 'src' ? join('src', 'i18n') : 'src/i18n'}`))

function literalKeys(source: string, pattern: RegExp): Set<string> {
  const keys = new Set<string>()
  for (const match of source.matchAll(pattern)) {
    if (match[1] !== undefined) keys.add(match[1])
  }
  return keys
}

const CLIENT_CALL = /(?<![\w$.])t\(\s*"((?:[^"\\]|\\.)*)"/gu
const HOST_CALL = /(?<![\w$.])(?:hostMessage|hostRegistrationMessage)\(\s*"((?:[^"\\]|\\.)*)"/gu

describe('i18n referenced keys exist in catalogs', () => {
  it('every literal t("…") in src/client resolves in clientMessages', () => {
    const missing: string[] = []
    for (const path of files.filter((path) => path.replace(/\\/gu, '/').includes('/src/client/'))) {
      for (const key of literalKeys(readFileSync(path, 'utf8'), CLIENT_CALL)) {
        if (!(key in clientMessages)) missing.push(`${path}: ${key}`)
      }
    }
    expect(missing, `missing client keys:\n${missing.join('\n')}`).toEqual([])
  })

  it('every literal hostMessage("…") in src resolves in hostMessages', () => {
    const missing: string[] = []
    for (const path of files.filter((path) => !path.replace(/\\/gu, '/').includes('/src/client/'))) {
      for (const key of literalKeys(readFileSync(path, 'utf8'), HOST_CALL)) {
        if (!(key in hostMessages)) missing.push(`${path}: ${key}`)
      }
    }
    expect(missing, `missing host keys:\n${missing.join('\n')}`).toEqual([])
  })
})
