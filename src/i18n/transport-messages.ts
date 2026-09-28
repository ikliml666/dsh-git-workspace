import type { MessageCatalog } from './core.js'

export const transportMessages = {
  malformed: {
    zh: 'Remote {method} 返回了不符合 strict contract 的 payload',
    en: 'Remote {method} returned a payload that does not match the strict contract',
  },
  mountFailed: {
    zh: 'Worktree Console Remote namespace 挂载失败',
    en: 'Failed to mount the Worktree Console Remote namespace',
  },
  invokeTimeout: {
    zh: 'Remote {method} 在 {seconds} 秒内未返回响应，本次调用已中止。服务端操作可能仍在进行，可稍后重试或重启 dsh web。',
    en: 'Remote {method} returned no response within {seconds}s and the call was aborted. The server-side work may still be running; retry shortly or restart dsh web.',
  },
} as const satisfies MessageCatalog
