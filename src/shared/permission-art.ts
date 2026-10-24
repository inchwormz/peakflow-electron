/**
 * Small drawings of the macOS System Settings screens a customer clicks
 * through when macOS forgets PeakFlow after an update (John, 24 Oct 2026:
 * "make it easy and visual"). Plain SVG markup, drawn here rather than
 * screenshotted, so the panel and getpeakflow.pro/mac-permissions show the
 * same pictures (scripts/export-permission-art.mjs writes the site's copy).
 *
 * Each drawing carries its own colours and follows the Mac's light or dark
 * appearance, like System Settings does. A page can force one with
 * data-mac-theme="light" or "dark" on any parent element.
 *
 * The markup is static: labels are escaped, and nothing comes from the user.
 */

export type ArtStep = 'remove' | 'add' | 'choose' | 'switch' | 'toggle'

/** Words drawn inside the pictures, in the customer's language. */
export interface ArtLabels {
  /** The list's name in System Settings: Accessibility, Microphone… */
  list: string
  /** A placeholder app in the list */
  other: string
  /** The Applications folder */
  applications: string
  open: string
  cancel: string
}

export const ART_LABELS_EN: ArtLabels = { list: 'Accessibility', other: 'Another app', applications: 'Applications', open: 'Open', cancel: 'Cancel' }

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const LIGHT = '--w:#ffffff;--bar:#f2f2f4;--ln:#dcdce0;--tx:#1d1d1f;--tx2:#86868b;--sel:#0a6cff;--seltx:#ffffff;--off:#d9d9de;--knob:#ffffff;--hi:#ff8a00;--pf:#111111;--pfi:#ffffff;--app:#a1a1a8'
const DARK = '--w:#1f1f21;--bar:#2a2a2d;--ln:#3d3d41;--tx:#f5f5f7;--tx2:#98989d;--sel:#0a84ff;--seltx:#ffffff;--off:#4a4a4e;--knob:#e8e8ea;--hi:#ffa31a;--pf:#f5f5f5;--pfi:#111111;--app:#6e6e73'

const STYLE =
  `<style>.pfa{${LIGHT}}` +
  `@media (prefers-color-scheme: dark){.pfa{${DARK}}}` +
  `[data-mac-theme=light] .pfa{${LIGHT}}[data-mac-theme=dark] .pfa{${DARK}}` +
  '.pfa .pa-w{fill:var(--w);stroke:var(--ln)}.pfa .pa-bar{fill:var(--bar)}.pfa .pa-ln{stroke:var(--ln);fill:none}' +
  '.pfa .pa-t{fill:var(--tx);font:500 9.5px -apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif}' +
  '.pfa .pa-t2{fill:var(--tx2);font:400 8.5px -apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif}' +
  '.pfa .pa-h{fill:var(--tx);font:700 11px -apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif}' +
  '.pfa .pa-sel{fill:var(--sel)}.pfa .pa-st{fill:var(--seltx)}.pfa .pa-on{fill:var(--sel)}.pfa .pa-off{fill:var(--off)}.pfa .pa-knob{fill:var(--knob)}' +
  '.pfa .pa-pf{fill:var(--pf)}.pfa .pa-pfi{fill:var(--pfi)}.pfa .pa-app{fill:var(--app)}' +
  '.pfa .pa-hi{fill:none;stroke:var(--hi);stroke-width:2.5}.pfa .pa-cur{fill:#111;stroke:#fff;stroke-width:1.1;stroke-linejoin:round}' +
  '.pfa .pa-btn{fill:var(--w);stroke:var(--ln)}.pfa .pa-sym{stroke:var(--tx);stroke-width:1.4;stroke-linecap:round;fill:none}</style>'

/** PeakFlow's icon: a dark tile with a white peak. */
function pfIcon(x: number, y: number, s = 13): string {
  return `<rect class="pa-pf" x="${x}" y="${y}" width="${s}" height="${s}" rx="${s * 0.24}"/>` +
    `<path class="pa-pfi" d="M${x + s * 0.2} ${y + s * 0.74}L${x + s * 0.44} ${y + s * 0.3}L${x + s * 0.58} ${y + s * 0.54}L${x + s * 0.66} ${y + s * 0.42}L${x + s * 0.82} ${y + s * 0.74}Z"/>`
}

function appIcon(x: number, y: number, s = 13): string {
  return `<rect class="pa-app" x="${x}" y="${y}" width="${s}" height="${s}" rx="${s * 0.24}"/>`
}

function toggle(x: number, y: number, on: boolean, onBlue = false): string {
  // On a selected (blue) row the blue track would vanish, so it gets a white edge
  return `<rect class="${on ? 'pa-on' : 'pa-off'}" x="${x}" y="${y}" width="22" height="13" rx="6.5"${onBlue ? ' style="stroke:#fff;stroke-width:1.2"' : ''}/>` +
    `<circle class="pa-knob" cx="${on ? x + 15.5 : x + 6.5}" cy="${y + 6.5}" r="5"/>`
}

/** The mouse pointer, its tip at (x, y). */
function cursor(x: number, y: number): string {
  return `<path class="pa-cur" transform="translate(${x} ${y})" d="M0 0V14.5L3.8 11L6.6 16.6L9 15.5L6.3 10H11.3Z"/>`
}

interface Row {
  name: string
  peakflow?: boolean
  selected?: boolean
  on?: boolean
}

/** A System Settings list: rows with a switch each, and the + and − buttons under them. */
function list(title: string, rows: Row[], buttons: boolean): string {
  let s = `<rect class="pa-w" x="6" y="6" width="248" height="128" rx="10"/>` +
    `<path class="pa-sym" d="M20 22l-3-3.5 3-3.5" opacity=".45"/><text class="pa-h" x="30" y="23">${esc(title)}</text>` +
    `<rect class="pa-w" x="18" y="34" width="224" height="${buttons ? 90 : 72}" rx="7"/>`
  rows.forEach((r, i) => {
    const y = 36 + i * 22
    if (r.selected) s += `<rect class="pa-sel" x="20" y="${y}" width="220" height="21" rx="5"/>`
    s += r.peakflow ? pfIcon(28, y + 4) : appIcon(28, y + 4)
    s += `<text class="${r.selected ? 'pa-t pa-st' : 'pa-t'}" x="48" y="${y + 14}">${esc(r.name)}</text>`
    s += toggle(210, y + 4, !!r.on, !!r.selected)
  })
  if (buttons) {
    s += `<path class="pa-ln" d="M18 106H242"/><path class="pa-ln" d="M40 106V124M62 106V124"/>` +
      `<path class="pa-sym" d="M29 115h6M32 112v6"/><path class="pa-sym" d="M48 115h6"/>`
  }
  return s
}

function svg(body: string, label: string): string {
  return `<svg class="pfa" viewBox="0 0 260 140" role="img" aria-label="${esc(label)}" xmlns="http://www.w3.org/2000/svg">${STYLE}${body}</svg>`
}

/**
 * One step's drawing. `label` is read out by screen readers (use the step's
 * own words); `labels` are the words drawn inside the picture.
 */
export function permissionArt(step: ArtStep, label: string, labels: ArtLabels = ART_LABELS_EN): string {
  const L = labels
  switch (step) {
    case 'remove':
      // PeakFlow selected (listed twice, as after a few updates), the − button ringed
      return svg(
        list(L.list, [
          { name: 'PeakFlow', peakflow: true, selected: true, on: true },
          { name: 'PeakFlow', peakflow: true, on: true },
          { name: L.other, on: true }
        ], true) +
          `<rect class="pa-hi" x="42" y="107.5" width="18" height="15" rx="4"/>` + cursor(53, 117),
        label
      )
    case 'add':
      return svg(
        list(L.list, [{ name: L.other, on: true }], true) +
          `<rect class="pa-hi" x="20" y="107.5" width="18" height="15" rx="4"/>` + cursor(31, 117),
        label
      )
    case 'choose': {
      // The file chooser: Applications in the sidebar, PeakFlow selected, Open ringed
      let s = `<rect class="pa-w" x="6" y="6" width="248" height="128" rx="10"/>` +
        `<path class="pa-bar" d="M16 6H96V134H16A10 10 0 0 1 6 124V16A10 10 0 0 1 16 6Z"/><path class="pa-ln" d="M96 6V134"/>` +
        `<rect class="pa-off" x="12" y="20" width="78" height="17" rx="4"/>` +
        `<rect class="pa-app" x="17" y="24" width="9" height="9" rx="2"/><text class="pa-t" x="30" y="32" style="font-size:8.5px">${esc(L.applications)}</text>` +
        `<rect class="pa-ln" x="17" y="46" width="44" height="5" rx="2.5" style="fill:var(--off);stroke:none" opacity=".7"/>` +
        `<rect class="pa-ln" x="17" y="60" width="36" height="5" rx="2.5" style="fill:var(--off);stroke:none" opacity=".7"/>` +
        `<text class="pa-t2" x="106" y="22">${esc(L.applications)}</text>`
      const rows: Row[] = [{ name: L.other }, { name: 'PeakFlow', peakflow: true, selected: true }, { name: L.other }]
      rows.forEach((r, i) => {
        const y = 30 + i * 20
        if (r.selected) s += `<rect class="pa-sel" x="102" y="${y}" width="144" height="19" rx="5"/>`
        s += r.peakflow ? pfIcon(108, y + 3) : appIcon(108, y + 3)
        s += `<text class="${r.selected ? 'pa-t pa-st' : 'pa-t'}" x="127" y="${y + 13}">${esc(r.name)}</text>`
      })
      s += `<rect class="pa-btn" x="128" y="108" width="54" height="17" rx="5"/><text class="pa-t" x="155" y="119.5" text-anchor="middle">${esc(L.cancel)}</text>` +
        `<rect class="pa-sel" x="188" y="108" width="54" height="17" rx="5"/><text class="pa-t pa-st" x="215" y="119.5" text-anchor="middle">${esc(L.open)}</text>` +
        `<rect class="pa-hi" x="185" y="105" width="60" height="23" rx="7"/>` + cursor(234, 123)
      return svg(s, label)
    }
    case 'switch':
      return svg(
        list(L.list, [{ name: 'PeakFlow', peakflow: true, on: true }, { name: L.other, on: true }], true) +
          `<rect class="pa-hi" x="206" y="37" width="30" height="19" rx="9.5"/>` + cursor(224, 50),
        label
      )
    case 'toggle':
      // Microphone and Camera: no − and +, so switch PeakFlow off and on again
      return svg(
        `<rect class="pa-w" x="6" y="6" width="248" height="128" rx="10"/>` +
          `<path class="pa-sym" d="M20 22l-3-3.5 3-3.5" opacity=".45"/><text class="pa-h" x="30" y="23">${esc(L.list)}</text>` +
          `<rect class="pa-w" x="18" y="34" width="224" height="25" rx="7"/>` + pfIcon(28, 40) +
          `<text class="pa-t" x="48" y="50">PeakFlow</text>` + toggle(210, 40, false) +
          `<rect class="pa-w" x="18" y="92" width="224" height="25" rx="7"/>` + pfIcon(28, 98) +
          `<text class="pa-t" x="48" y="108">PeakFlow</text>` + toggle(210, 98, true) +
          `<path class="pa-sym" d="M221 63v24M216.5 82.5l4.5 4.5 4.5-4.5" style="stroke:var(--hi);stroke-width:2"/>` +
          `<rect class="pa-hi" x="206" y="95" width="30" height="19" rx="9.5"/>` + cursor(224, 108),
        label
      )
  }
}
