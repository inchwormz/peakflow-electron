/** Native key codes are platform-specific. Main derives the label/kind from this allowlist. */
export interface NativeHoldKey {
  platform: 'darwin' | 'win32'
  code: number
  kind: 'mod' | 'key'
  label: string
}
export type LegacyHoldKey = 'rcmd' | 'ropt' | 'fn' | 'rctrl' | 'ralt'
const macMods: Record<number, string> = {54:'Right ⌘',55:'Left ⌘',56:'Left ⇧',60:'Right ⇧',58:'Left ⌥',61:'Right ⌥',59:'Left ⌃',62:'Right ⌃',63:'fn'}
const winMods: Record<number, string> = {160:'Left Shift',161:'Right Shift',162:'Left Ctrl',163:'Right Ctrl',164:'Left Alt',165:'Right Alt',91:'Left Win',92:'Right Win'}
const macFunctions = [122,120,99,118,96,97,98,100,101,109,103,111,105,107,113,106,64,79,80,90]
export function holdKeyFromCode(code: unknown, platform: string): NativeHoldKey | null {
  if (typeof code !== 'number' || !Number.isInteger(code) || !['darwin','win32'].includes(platform)) return null
  const mac = platform === 'darwin'
  const mod = (mac ? macMods : winMods)[code]
  const fn = mac ? macFunctions.indexOf(code) + 1 : code >= 112 && code <= 135 ? code - 111 : 0
  return mod || fn ? { platform: platform as NativeHoldKey['platform'], code, kind: mod ? 'mod' : 'key', label: mod || `F${fn}` } : null
}
export function normalizeHoldKey(value: unknown, platform: string): NativeHoldKey | null {
  if (typeof value === 'string') {
    const presets = platform === 'darwin' ? {fn:63,ropt:61,rcmd:54,rctrl:62} : {rctrl:163,ralt:165}
    return holdKeyFromCode(presets[value as keyof typeof presets], platform)
  }
  if (!value || typeof value !== 'object') return null
  const key = value as Partial<NativeHoldKey>
  return key.platform === platform ? holdKeyFromCode(key.code, platform) : null
}
// copy: The capture row uses the brief's exact wording.
export const HOLD_KEY_COPY = {
  // copy: Hold to talk
  label: 'Hold to talk',
  // copy: Change
  change: 'Change',
  // copy: Press the key you want to hold…
  recording: 'Press the key you want to hold…',
  // copy: Esc to cancel
  cancel: 'Esc to cancel',
  // copy: That key types text. Pick a modifier like Right ⌥, or a function key like F13. (Windows: Right Ctrl)
  rejection: (mac: boolean): string => `That key types text. Pick a modifier like ${mac ? 'Right ⌥' : 'Right Ctrl'}, or a function key like F13.`
}

/** Command v1 is Mac only and cannot share the ordinary dictation key. */
export function normalizeCommandKey(value: unknown, dictation: unknown, platform: string): NativeHoldKey | null {
  if (platform !== 'darwin') return null
  const key = normalizeHoldKey(value, platform)
  return key && key.code !== normalizeHoldKey(dictation, platform)?.code ? key : null
}
