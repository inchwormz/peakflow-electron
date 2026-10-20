/** Window content height sent through PANEL_RESIZE (main caps it at 640px). */
export const HEAD_H = 44
export const BODY_PAD = 28 // .p-body: 12px top + 16px bottom
export const FLUSH_BODY_PAD = 14 // .p-body.flush: 6px top + 8px bottom
export const MENU_TOP = 40 // .ddm is positioned relative to .p-head
export const MENU_INSET = 6 // equal left, right and bottom clearance
export const DIALOG_H = 280

export function panelHeight(body: number, menu: number | null, dialog: boolean, flush = false): number {
  const page = HEAD_H + (flush ? FLUSH_BODY_PAD : BODY_PAD) + body
  // The old 44 + (menu + 52) counted the header twice and left 56px below it.
  const dropdown = menu != null ? MENU_TOP + menu + MENU_INSET : 0
  return Math.max(page, dropdown, dialog ? DIALOG_H : 0)
}
