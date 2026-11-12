import type { ClientTranslator } from '../i18n.js'

/**
 * Relative commit time shared by the commit graph and the branch picker, so both
 * surfaces phrase "how old" the same way instead of each inventing a format.
 */
export function formatRelativeTime(epochSeconds: number, t: ClientTranslator): string {
  const elapsed = Math.max(0, Math.floor(Date.now() / 1000 - epochSeconds))
  if (elapsed < 60) return t("time.just.now")
  if (elapsed < 3600) return t("time.minutes.ago", { p0: Math.floor(elapsed / 60) })
  if (elapsed < 86400) return t("time.hours.ago", { p0: Math.floor(elapsed / 3600) })
  if (elapsed < 30 * 86400) return t("time.days.ago", { p0: Math.floor(elapsed / 86400) })
  const date = new Date(epochSeconds * 1000)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
