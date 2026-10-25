export interface WeeklyStats { week: string; words: number; spokenSeconds: number }

/** Local calendar date, ISO Monday weeks and ISO week-year. UTC maths avoids DST shifts. */
export function isoWeek(now = new Date()): string {
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const year = d.getUTCFullYear()
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7)
  return `${year}-W${String(week).padStart(2, '0')}`
}
export function weeklyNow(saved: WeeklyStats | undefined, now = new Date()): WeeklyStats {
  const week = isoWeek(now)
  return saved?.week === week ? saved : { week, words: 0, spokenSeconds: 0 }
}
export function addWeekly(saved: WeeklyStats | undefined, text: string, durationMs: number, now = new Date()): WeeklyStats {
  const s = weeklyNow(saved, now)
  const words = (text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? []).length
  return { week: s.week, words: s.words + words, spokenSeconds: s.spokenSeconds + (Number.isFinite(durationMs) ? Math.max(0, durationMs) / 1000 : 0) }
}
export function minutesSaved(s: WeeklyStats): number {
  return Math.max(0, Math.round(s.words / 40 - s.spokenSeconds / 60))
}
