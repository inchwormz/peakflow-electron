/** Drawn icons for launcher rows: the panel's icon set plus a few of the launcher's own. */

import type { LauncherGlyph } from '@shared/launcher/types'
import { Icon, type IconName } from '../panel/icons'

const OWN: Partial<Record<LauncherGlyph, string>> = {
  app: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
  eject: '<path d="M12 5 5 13h14z"/><path d="M5 18h14"/>',
  restart: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5"/>',
  logout: '<path d="M14 4.5h4.5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H14"/><path d="M10 16l-4-4 4-4"/><path d="M6 12h9"/>',
  coffee: '<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8.5 3.5v2M12 3.5v2"/>',
  kill: '<circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6M15 9l-6 6"/>',
  calc: '<rect x="5.5" y="3.5" width="13" height="17" rx="2"/><path d="M8.5 7.5h7"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01"/>',
  window: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M12 5v14"/>'
}

const FROM_PANEL: Partial<Record<LauncherGlyph, IconName>> = {
  file: 'file', settings: 'settings', power: 'power', lock: 'lock', trash: 'trash', globe: 'globe', search: 'search',
  link: 'link', text: 'text', sparkle: 'sparkle', plus: 'plus', keyboard: 'keyboard', focusdim: 'focusdim',
  liquidfocus: 'liquidfocus', screenslap: 'screenslap', quickboard: 'quickboard'
}

export function Glyph({ name }: { name: LauncherGlyph | undefined }): React.JSX.Element {
  const panel = name ? FROM_PANEL[name] : undefined
  if (panel) return <Icon name={panel} />
  const own = (name && OWN[name]) || OWN.app!
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden dangerouslySetInnerHTML={{ __html: own }} />
  )
}
