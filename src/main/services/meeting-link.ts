/**
 * Meeting Link Detection — extract video conference URLs from text.
 *
 * Direct port of Python MEETING_PATTERNS (in_your_face.py lines 267-296).
 * Supports: Zoom, Google Meet, Teams, Webex, GoToMeeting, Skype,
 *           Discord, Slack Huddle, Around, Whereby, Jitsi, BlueJeans, Chime.
 *
 * Usage:
 *   const result = extractMeetingLink(eventDescription)
 *   if (result) {
 *     console.log(result.url, result.service)
 *   }
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MeetingLinkResult {
  url: string
  service: string
}

// ─── Patterns ───────────────────────────────────────────────────────────────

/**
 * Ordered list of regex patterns for common video conferencing services.
 * Each entry is [pattern, serviceName]. First match wins.
 */
const MEETING_PATTERNS: [RegExp, string][] = [
  // Zoom
  [/https?:\/\/[\w.-]*zoom\.us\/[jw]\/\d+[^\s<>"']*/i, 'Zoom'],
  // Google Meet
  [/https?:\/\/meet\.google\.com\/[a-z-]+/i, 'Google Meet'],
  // Microsoft Teams
  [/https?:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s<>"']+/i, 'Teams'],
  [/https?:\/\/teams\.live\.com\/meet\/[^\s<>"']+/i, 'Teams'],
  // Webex
  [/https?:\/\/[\w.-]*webex\.com\/[\w.-]+\/j\.php\?[^\s<>"']+/i, 'Webex'],
  [/https?:\/\/[\w.-]*webex\.com\/meet\/[^\s<>"']+/i, 'Webex'],
  // GoToMeeting
  [/https?:\/\/[\w.-]*gotomeeting\.com\/join\/\d+/i, 'GoToMeeting'],
  // Skype
  [/https?:\/\/join\.skype\.com\/[^\s<>"']+/i, 'Skype'],
  // Discord
  [/https?:\/\/discord\.gg\/[^\s<>"']+/i, 'Discord'],
  // Slack Huddle
  [/https?:\/\/[\w.-]*slack\.com\/[\w/-]+huddle[^\s<>"']*/i, 'Slack'],
  // Around
  [/https?:\/\/[\w.-]*around\.co\/[^\s<>"']+/i, 'Around'],
  // Whereby
  [/https?:\/\/whereby\.com\/[^\s<>"']+/i, 'Whereby'],
  // Jitsi
  [/https?:\/\/meet\.jit\.si\/[^\s<>"']+/i, 'Jitsi'],
  // BlueJeans
  [/https?:\/\/[\w.-]*bluejeans\.com\/\d+/i, 'BlueJeans'],
  // Chime (Amazon)
  [/https?:\/\/chime\.aws\/\d+/i, 'Chime']
]

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Extract a meeting link and its service name from arbitrary text.
 * Searches description, location, or any text for known conference URLs.
 *
 * @param text Text to scan (event description, location, etc.)
 * @returns {MeetingLinkResult | null} First matching link, or null if none found.
 */
export function extractMeetingLink(text: string | null | undefined): MeetingLinkResult | null {
  if (!text) return null

  for (const [pattern, service] of MEETING_PATTERNS) {
    const match = text.match(pattern)
    if (match) {
      return { url: match[0], service }
    }
  }

  return null
}

/**
 * Extract meeting link from multiple text fields (typical for a calendar event).
 * Checks fields in priority order:
 *   1. hangoutLink (Google Meet auto-generated)
 *   2. conferenceData entry points
 *   3. location field
 *   4. description field
 *
 * @param fields Object with optional text fields to check.
 * @returns First meeting link found, or null.
 */
export function extractMeetingLinkFromEvent(fields: {
  hangoutLink?: string | null
  conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[]; conferenceSolution?: { name: string } } | null
  location?: string | null
  description?: string | null
}): MeetingLinkResult | null {
  // 1. hangoutLink (Google Meet)
  if (fields.hangoutLink) {
    return { url: fields.hangoutLink, service: 'Google Meet' }
  }

  // 2. conferenceData video entry point
  if (fields.conferenceData?.entryPoints) {
    for (const ep of fields.conferenceData.entryPoints) {
      if (ep.entryPointType === 'video' && ep.uri) {
        const service = fields.conferenceData.conferenceSolution?.name ?? 'Meeting'
        return { url: ep.uri, service }
      }
    }
  }

  // 3. location field
  const fromLocation = extractMeetingLink(fields.location)
  if (fromLocation) return fromLocation

  // 4. description field
  const fromDescription = extractMeetingLink(fields.description)
  if (fromDescription) return fromDescription

  return null
}

/**
 * Get a CSS-friendly badge class hint for a meeting service.
 * Used by the renderer to apply colored badges.
 */
export function getMeetingBadgeType(service: string | null): 'zoom' | 'meet' | 'teams' | 'generic' {
  if (!service) return 'generic'
  const lower = service.toLowerCase()
  if (lower.includes('zoom')) return 'zoom'
  if (lower.includes('meet')) return 'meet'
  if (lower.includes('teams')) return 'teams'
  return 'generic'
}
