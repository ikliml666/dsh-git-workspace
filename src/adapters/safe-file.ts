import { hostMessage } from '../i18n/host.js'
/**
 * 崩溃安全的 JSON 文件读写工具
 *
 * 解决系统强制关机/崩溃时 JSON 索引文件被截断导致数据丢失的问题。
 * - 写入：唯一命名 tmp → rename（POSIX 原子操作）+ .bak 备份
 * - 读取：主文件 → 最新可解析的 .tmp 残留 → .bak 回退，多层容错
 */

import { randomUUID } from 'node:crypto'
import {
  writeFileSync, renameSync, existsSync, copyFileSync, readFileSync, unlinkSync, readdirSync, statSync, mkdirSync,
} from 'node:fs'
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
 * 本函数不持锁：唯一 tmp + 原子 rename 已消除「tmp 互踩」与「半写提升」。
 * 「读-改-写」的跨进程互斥由 withFileLock 提供，调用方按需组合。
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

/** 持有者进程已退出、或持有时间超过该阈值，锁文件即视为陈旧可回收。 */
const LOCK_STALE_MS = 30_000
const LOCK_RETRY_DELAY_MS = 25
const LOCK_DEFAULT_TIMEOUT_MS = 10_000

interface FileLockPayload {
  pid: number
  createdAt: number
  token: string
}

export interface FileLockOptions {
  timeoutMs?: number
  staleAfterMs?: number
}

/** 同进程已持有的锁：read() 的 legacy 迁移会回调 write()，内层必须复用而不是再抢一次。 */
const heldLocks = new Map<string, string>()

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM 表示进程存在但属于其他用户；只有 ESRCH 才是已退出。
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function readLockPayload(lockPath: string): FileLockPayload | null {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, 'utf-8')) as unknown
    if (!isRecordPayload(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

function isRecordPayload(value: unknown): value is FileLockPayload {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<FileLockPayload>
  return typeof candidate.pid === 'number' && typeof candidate.createdAt === 'number' && typeof candidate.token === 'string'
}

/** 不可解析的锁文件按 mtime 判龄：持有者刚用 `wx` 占位、内容还没落盘时也读不出 JSON。 */
function lockIsStale(lockPath: string, staleAfterMs: number): boolean {
  const payload = readLockPayload(lockPath)
  if (!payload) {
    let ageMs: number
    try {
      ageMs = Date.now() - statSync(lockPath).mtimeMs
    } catch {
      return true
    }
    if (ageMs <= staleAfterMs) return false
    console.warn(hostMessage('lockFileUnreadableReclaimed', { p0: lockPath }))
    return true
  }
  return !processAlive(payload.pid) || Date.now() - payload.createdAt > staleAfterMs
}

function tryCreateLock(lockPath: string, token: string): boolean {
  try {
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, createdAt: Date.now(), token } satisfies FileLockPayload), { encoding: 'utf-8', flag: 'wx' })
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  }
}

function acquireFileLock(lockPath: string, token: string, options: FileLockOptions): void {
  const timeoutMs = options.timeoutMs ?? LOCK_DEFAULT_TIMEOUT_MS
  const staleAfterMs = options.staleAfterMs ?? LOCK_STALE_MS
  const deadline = Date.now() + timeoutMs
  mkdirSync(dirname(lockPath), { recursive: true })
  for (;;) {
    if (tryCreateLock(lockPath, token)) return
    if (lockIsStale(lockPath, staleAfterMs)) {
      try { unlinkSync(lockPath) } catch { /* 另一回收者已删除；下面的重试会再竞争一次 */ }
      if (tryCreateLock(lockPath, token)) return
    }
    if (Date.now() >= deadline) {
      const error = new Error(hostMessage('checkoutRegistryLockTimeout', { p0: timeoutMs, p1: lockPath })) as NodeJS.ErrnoException
      error.code = 'ELOCKTIMEOUT'
      throw error
    }
    sleepSync(LOCK_RETRY_DELAY_MS)
  }
}

/** 只删自己持有的锁：token 不符说明锁已过期回收并被他人重建。 */
function releaseFileLock(lockPath: string, token: string): void {
  const payload = readLockPayload(lockPath)
  if (payload?.token !== token) {
    console.warn(hostMessage('lockFileOwnedByAnother', { p0: lockPath }))
    return
  }
  try {
    unlinkSync(lockPath)
  } catch (error) {
    // Windows 上删除可能因短暂文件句柄占用失败；改名到临时名再删，失败仅告警。
    const code = (error as NodeJS.ErrnoException).code
    try {
      if (code === 'ENOENT') return
      renameSync(lockPath, `${lockPath}.${randomUUID()}.stale`)
    } catch {
      console.warn(hostMessage('lockFileReleaseFailed', { p0: lockPath }))
    }
  }
}

/**
 * 在跨进程互斥下执行同步操作。锁文件 `<target>.lock` 携带 pid、创建时间与持有者 token，
 * 写者之间不再以「最后写入者获胜」的方式互相覆盖读-改-写窗口。
 */
export function withFileLock<T>(targetPath: string, operation: () => T, options: FileLockOptions = {}): T {
  const lockPath = `${targetPath}.lock`
  const heldToken = heldLocks.get(lockPath)
  if (heldToken) return operation()
  const token = randomUUID()
  acquireFileLock(lockPath, token, options)
  heldLocks.set(lockPath, token)
  try {
    return operation()
  } finally {
    heldLocks.delete(lockPath)
    releaseFileLock(lockPath, token)
  }
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
