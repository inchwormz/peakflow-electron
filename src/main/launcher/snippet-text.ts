/** Resolve saved snippet placeholders locally, just before pasting. */
export function fillPlaceholders(text: string, readClipboard: () => string, now = new Date()): string {
  return text
    .replace(/\{date\}/g, () => now.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }))
    .replace(/\{time\}/g, () => now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))
    .replace(/\{clipboard\}/g, () => readClipboard())
}
