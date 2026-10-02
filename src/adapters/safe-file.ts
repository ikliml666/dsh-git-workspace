import { hostMessage } from '../i18n/host.js'
/**
 * 崩溃安全的 JSON 文件读写工具
 *
 * 解决系统强制关机/崩溃时 JSON 索引文件被截断导致数据丢失的问题。
 * - 写入：唯一命名 tmp → rename（POSIX 原子操作）+ .bak 备份
 * - 读取：主文件 → 最新可解析的 .tmp 残留 → .bak 回退，多层容错
 */

import { randomUUID } from 'node:crypto'
import { writeFileSync, renameSync, existsSync, copyFileSync, readFileSync, unlinkSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const RETRYABLE_RENAME_CODES = new Set(
  process.platform === 'win32'
    ? ['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY']
    : ['EBUSY', 'ENOTEMPTY'],
)

function sleepSync(milliseconds: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
  } catch {
    const startedAt = Date.now()
    while (Date.now() - startedAt < milliseconds) { /* fallback for runtimes without SharedArrayBuffer */ }
  }
}

/** Preserve atomic rename semantics while tolerating transient Windows file-handle races. */
function renameAtomicWithRetry(source: string, target: string, maxAttempts = 5): void {
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      renameSync(source, target)
      return
    } catch (error) {
      lastError = error
      const code = (error as NodeJS.ErrnoException).code
      if (!code || !RETRYABLE_RENAME_CODES.has(code) || attempt === maxAttempts) break
      sleepSync(20 * 2 ** (attempt - 1))
    }
  }
  throw lastError
}

/**
 * 唯一命名的临时文件路径。固定 <file>.tmp 会让并发写者互相截断，
 * 且半写状态的 tmp 会被读取端误提升为主文件。
 */
function tmpPathFor(filePath: string): string {
  return `${filePath}.${process.pid}.${randomUUID()}.tmp`
}

/** 列出该主文件的全部 tmp 残留（含旧版固定 <file>.tmp），按 mtime 新→旧。 */
function listTmpFiles(filePath: string): string[] {
  const dir = dirname(filePath)
  const prefix = `${basename(filePath)}.`
  try {
    return readdirSync(dir)
      .filter(name => name.startsWith(prefix) && name.endsWith('.tmp'))
      .map(name => join(dir, name))
      .map(path => ({ path, mtime: statSync(path).mtimeMs }))
      .sort((left, right) => right.mtime - left.mtime)
      .map(item => item.path)
  } catch {
    return []
  }
}

function cleanupTmpFiles(filePath: string): void {
  for (const tmpPath of listTmpFiles(filePath)) {
    try { unlinkSync(tmpPath) } catch { /* ignore */ }
  }
}

/**
 * 原子写入 JSON 文件：write-to-unique-temp → rename
 * 写入前自动保留 .bak 备份
 * ponytail: 无跨进程锁——唯一 tmp + 原子 rename 已消除「tmp 互踩」与「半写提升」；
 * 文件级 last-writer-wins 仍在，需要强一致时再引入 lock 文件。
 */
export function writeJsonFileAtomic(filePath: string, data: object, skipBackup = false): void {
  const tmpPath = tmpPathFor(filePath)
  const bakPath = filePath + '.bak'

  // 备份当前文件（如果存在且可读）
  if (!skipBackup && existsSync(filePath)) {
    try {
      copyFileSync(filePath, bakPath)
    } catch {
      // 备份失败不阻塞写入
    }
  }

  // 写入临时文件
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8')

  // 原子重命名；Windows 短暂文件句柄占用时保持原子语义并有限重试。
  renameAtomicWithRetry(tmpPath, filePath)
}

/** 原子重写文本文件（用于 JSONL 会话等非单个 JSON 文档）。 */
export function writeTextFileAtomic(filePath: string, content: string): void {
  const tmpPath = tmpPathFor(filePath)
  writeFileSync(tmpPath, content, 'utf-8')
  renameAtomicWithRetry(tmpPath, filePath)
}

/**
 * 安全读取 JSON 索引文件
 * 优先读主文件，损坏则尝试最新可解析的 .tmp / .bak，都失败返回 null
 */
export function readJsonFileSafe<T>(filePath: string): T | null {
  const bakPath = filePath + '.bak'

  // 1. 尝试读取主文件
  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, 'utf-8')
      if (raw.trim().length > 0) {
        return JSON.parse(raw) as T
      }
    } catch {
      console.warn(hostMessage('corruptPrimaryIndex', { p0: filePath }))
    }
  }

  // 2. 检查 rename 前崩溃残留的 .tmp（可能多个），取最新且可完整解析的提升
  for (const tmpPath of listTmpFiles(filePath)) {
    try {
      const raw = readFileSync(tmpPath, 'utf-8')
      if (raw.trim().length === 0) throw new Error('empty tmp')
      const parsed = JSON.parse(raw) as T
      renameAtomicWithRetry(tmpPath, filePath)
      console.log(hostMessage('recoveredFromTmp', { p0: filePath }))
      cleanupTmpFiles(filePath)
      return parsed
    } catch {
      // 该 .tmp 无效，尝试下一个
    }
  }
  cleanupTmpFiles(filePath)

  // 3. Fallback 到 .bak
  if (existsSync(bakPath)) {
    try {
      const raw = readFileSync(bakPath, 'utf-8')
      if (raw.trim().length > 0) {
        const parsed = JSON.parse(raw) as T
        // 用 .bak 恢复主文件（跳过备份，避免用损坏的主文件覆盖好的 .bak）
        writeJsonFileAtomic(filePath, parsed as object, true)
        console.log(hostMessage('recoveredFromBak', { p0: filePath }))
        return parsed
      }
    } catch {
      console.error(hostMessage('corruptBackupIndex', { p0: bakPath }))
    }
  }

  return null // 全部失败，需要上层从 JSONL 重建
}
