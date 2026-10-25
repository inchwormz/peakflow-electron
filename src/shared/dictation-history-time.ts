/** Short local-calendar times for recent dictations. `now` is injectable for checks. */
export function historyTime(at: number, now = new Date()): string {
  const date = new Date(at)
  if (!Number.isFinite(date.getTime())) return ''
  const elapsed = Math.max(0, now.getTime() - at)
  if (elapsed < 60_000) return 'Just now'
  // Calendar comparison (rather than 24-hour blocks) also handles daylight saving.
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (date >= yesterday && date < day) return 'Yesterday'
  if (date >= day) {
    if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} min ago`
    return `${Math.floor(elapsed / 3_600_000)} h ago`
  }
  const weekday = date.toLocaleDateString('en-NZ', { weekday: 'short' })
  const month = date.toLocaleDateString('en-NZ', { month: 'short' })
  return `${weekday} ${date.getDate()} ${month}${date.getFullYear() !== now.getFullYear() ? ` ${date.getFullYear()}` : ''}`
}
