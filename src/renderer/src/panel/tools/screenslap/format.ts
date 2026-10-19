/**
 * ScreenSlap types and wording shared by the panel screens and the
 * full-screen alert (tools/screenslap/AlertOverlay.tsx).
 */

export interface CalendarEvent {
  id: string
  summary: string
  startTime: string
  endTime: string
  durationMinutes: number
  meetingLink: string | null
  meetingService: string | null
  location: string | null
  description: string | null
  allDay: boolean
}

export interface CalendarStatus {
  connected: boolean
  source: 'ical' | null
  email: string | null
  lastFetched: string | null
  error: string | null
}

export interface AlertInfo {
  eventId: string
  summary: string
  startTime: string
  timeFormatted: string
  timeUntil: string
  meetingLink: string | null
  meetingService: string | null
  durationMinutes: number
}

export interface ScreenSlapState {
  monitoring: boolean
  activeAlert: AlertInfo | null
  cachedEventCount: number
  lastFetch: string | null
}

/** "Google Meet" → "Meet", so buttons read "Join Meet" as in the prototype. */
export function appName(service: string | null | undefined): string {
  if (!service) return 'meeting'
  if (/meet/i.test(service)) return 'Meet'
  return service
}

function parts(d: Date): { hm: string; ap: string } {
  const h = d.getHours()
  return { hm: `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`, ap: h >= 12 ? 'PM' : 'AM' }
}

/** 3:32 PM */
export function fmtTime(iso: string | Date): string {
  const p = parts(new Date(iso))
  return `${p.hm} ${p.ap}`
}

/** 3:32 – 4:00 PM, or 11:30 AM – 12:15 PM across noon. */
export function fmtRange(startIso: string, endIso: string): string {
  const a = parts(new Date(startIso))
  const b = parts(new Date(endIso))
  return a.ap === b.ap ? `${a.hm} – ${b.hm} ${b.ap}` : `${a.hm} ${a.ap} – ${b.hm} ${b.ap}`
}

/** 30m, 1h, 1h 30m */
export function fmtDuration(min: number): string {
  if (min < 60) return `${Math.max(0, min)}m`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

/** "3 min", "1 h 20 min": the gap until a start time (ms > 0). */
export function fmtGap(ms: number): string {
  const min = Math.max(1, Math.ceil(ms / 60_000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

/** "2 minutes", "1 minute", "1 hour 5 minutes" (for the full-screen alert). */
export function fmtGapLong(ms: number): string {
  const min = Math.max(1, Math.ceil(ms / 60_000))
  const mins = (n: number): string => `${n} minute${n === 1 ? '' : 's'}`
  if (min < 60) return mins(min)
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${h} hour${h === 1 ? '' : 's'}${m ? ` ${mins(m)}` : ''}`
}

/** "just now", "5 min ago", "2 h ago" */
export function fmtAgo(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  return `${Math.floor(min / 60)} h ago`
}

export function isToday(ev: CalendarEvent, now = new Date()): boolean {
  const s = new Date(now)
  s.setHours(0, 0, 0, 0)
  const e = new Date(s)
  e.setDate(e.getDate() + 1)
  const start = new Date(ev.startTime).getTime()
  const end = new Date(ev.endTime).getTime()
  // Starts today, or is still running from before midnight
  return (start >= s.getTime() && start < e.getTime()) || (start < s.getTime() && end > s.getTime())
}
