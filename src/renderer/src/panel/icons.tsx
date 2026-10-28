/**
 * Linear-style line icons (24 grid, 1.5 stroke, round joins), ported from the
 * approved prototype (artifacts/2026-10-19-app-redesign/full/icons.js).
 * The markup is static and trusted (no user data), so it is injected directly.
 */

import type { CSSProperties } from 'react'

const P = {
    focusdim: '<path d="M4 8V6a2 2 0 0 1 2-2h2"/><path d="M16 4h2a2 2 0 0 1 2 2v2"/><path d="M20 16v2a2 2 0 0 1-2 2h-2"/><path d="M8 20H6a2 2 0 0 1-2-2v-2"/><rect x="8.5" y="8.5" width="7" height="7" rx="1.5"/>',
    liquidfocus: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.2 1.6"/><path d="M10 2.5h4"/>',
    screenslap: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15l1.5-2z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    quickboard: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M9.5 10h5M9.5 13.5h5M9.5 17h3"/>',
    mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v2.5"/>',
    snapgrid: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M12 4.5v15M12 12h8.5"/>',
    guarana: '<circle cx="12" cy="14" r="6.5"/><circle cx="12" cy="14" r="2.4" fill="currentColor"/><path d="M12 7.5V5c0-1.5 1.5-2.5 3.5-2.5 0 1.8-1.3 3-3.5 3"/>',
    chev: '<path d="m7 10 5 5 5-5"/>',
    chevR: '<path d="m10 7 5 5-5 5"/>',
    chevL: '<path d="m14 7-5 5 5 5"/>',
    check: '<path d="M5 12.5 9.5 17 19 7.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    listcheck: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="m3.5 6 1.5 1.5 2.5-3"/><path d="m3.5 12 1.5 1.5 2.5-3"/><path d="M4 18h3"/>',
    star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5z"/>',
    starF: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5z" fill="currentColor"/>',
    pin: '<path d="M9 4h6l-1 6 3 3v1H7v-1l3-3-1-6z" /><path d="M12 14v6"/>',
    pencil: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/>',
    trash: '<path d="M4.5 7h15"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l1 13h9l1-13"/>',
    play: '<path d="M8 5.5v13l10.5-6.5L8 5.5z" fill="currentColor"/>',
    pause: '<path d="M8.5 5.5v13M15.5 5.5v13" stroke-width="2.5"/>',
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor"/>',
    skip: '<path d="M6 5.5v13l9-6.5-9-6.5z"/><path d="M18.5 5.5v13"/>',
    reset: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5"/>',
    lock: '<rect x="5" y="11" width="14" height="9.5" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
    link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>',
    text: '<path d="M5 6.5V5h14v1.5"/><path d="M12 5v14M9.5 19h5"/>',
    code: '<path d="m15.5 17.5 5.5-5.5-5.5-5.5"/><path d="m8.5 6.5-5.5 5.5 5.5 5.5"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m20.5 16-5-5-8.5 8.5"/>',
    file: '<path d="M6 3.5h8l4.5 4.5v12.5H6z"/><path d="M14 3.5V8h4.5"/>',
    tag: '<path d="M3.5 12V4.5H11l9 9-7.5 7.5-9-9z"/><circle cx="8" cy="9" r="1.2"/>',
    zap: '<path d="M13 3 4.5 13.5H11l-1 7.5 8.5-10.5H12L13 3z"/>',
    form: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M8 9h8M8 12.5h8M8 16h5"/>',
    wand: '<path d="m4 20 11-11"/><path d="m13 7 2-2 4 4-2 2"/><path d="M18.5 3v2.5M21 5.5h-2.5M7 3.5V5M7.75 4.25h-1.5"/>',
    sparkle: '<path d="M12 3.5 13.8 10.2 20.5 12 13.8 13.8 12 20.5 10.2 13.8 3.5 12 10.2 10.2z"/>',
    download: '<path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4.5 19.5h15"/>',
    upload: '<path d="M12 15V4"/><path d="m7.5 8.5 4.5-4.5 4.5 4.5"/><path d="M4.5 19.5h15"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.4-5.7L20 8.5"/><path d="M20 4v4.5h-4.5"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8.5-8.5M16.5 6.5l2.5 2.5M14 9l2 2"/>',
    gift: '<rect x="4" y="9" width="16" height="11" rx="1.5"/><path d="M3 9h18M12 9v11"/><path d="M12 9C10 5 6.5 5.5 7.5 7.5S12 9 12 9zM12 9c2-4 5.5-3.5 4.5-1.5S12 9 12 9z"/>',
    bug: '<rect x="7.5" y="8" width="9" height="12" rx="4.5"/><path d="M9.5 8a2.5 2.5 0 0 1 5 0"/><path d="M4 13h3.5M16.5 13H20M5 8.5l2.5 1.5M19 8.5 16.5 10M5 18.5 7.5 17M19 18.5 16.5 17"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.2"/>',
    puzzle: '<path d="M9 4.5h3.5v2a1.75 1.75 0 0 0 3.5 0v-2H19.5V9h-2a1.75 1.75 0 0 0 0 3.5h2v7H16v-2a1.75 1.75 0 0 0-3.5 0v2H4.5V16h2a1.75 1.75 0 0 0 0-3.5h-2V4.5H9"/>',
    monitor: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M9 20h6M12 16.5V20"/>',
    camera: '<path d="M4 8.5h3l1.5-2.5h7L17 8.5h3v11H4z"/><circle cx="12" cy="13.5" r="3.2"/>',
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7.5 14h9"/>',
    power: '<path d="M12 3.5V11"/><path d="M7 6.5a7.5 7.5 0 1 0 10 0"/>',
    settings: '<circle cx="12" cy="12" r="2.8"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M6 18l1.4-1.4M16.6 7.4 18 6"/>',
    more: '<circle cx="6" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="18" cy="12" r="1" fill="currentColor"/>',
    mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z"/>',
    log: '<path d="M6 3.5h8l4.5 4.5v12.5H6z"/><path d="M9 12h6M9 15.5h6M9 8.5h3"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    up: '<path d="m7 14 5-5 5 5"/>',
    down: '<path d="m7 10 5 5 5-5"/>',
    ext: '<path d="M14 4.5h5.5V10"/><path d="M19.5 4.5 11 13"/><path d="M17 14v5.5H4.5V7H10"/>',
    shield: '<path d="M12 3.5 19 6v6c0 4.5-3 7.5-7 8.5-4-1-7-4-7-8.5V6l7-2.5z"/>',
    person: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c1-3.5 3.8-5 7-5s6 1.5 7 5"/>',
    logo: '<path d="M2 19 8 9l4 6 3-4 7 8z" fill="currentColor" stroke="none"/>',
  } as const

export type IconName = keyof typeof P

export function Icon({ name, className, style, title }: { name: IconName; className?: string; style?: CSSProperties; title?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden={title ? undefined : true}
      dangerouslySetInnerHTML={{ __html: (title ? `<title>${title}</title>` : '') + P[name] }}
    />
  )
}
