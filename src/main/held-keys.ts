/**
 * Shortcuts that PeakFlow holds only while something needs them (review S7).
 * QuickBoard's ⇧⌘N (paste next) and ⇧⌘Q (cancel) are taken from other apps
 * (Chrome's incognito window, Finder's new folder, Log Out) only while a
 * paste queue, workflow or form fill is running.
 *
 * No Electron import: the register/unregister calls are passed in, so
 * scripts/checks can drive it.
 */

export interface KeyApi {
  register: (accel: string, fn: () => void) => boolean
  unregister: (accel: string) => void
  isRegistered: (accel: string) => boolean
}

export class HeldKeys {
  private held = new Set<string>()

  constructor(
    private api: KeyApi,
    private keys: ReadonlyArray<{ accel: string; action: () => void }>
  ) {}

  /** Take the keys when `want` is true, give them back when false. Returns the keys now held. */
  sync(want: boolean): string[] {
    if (want) {
      for (const k of this.keys) {
        if (this.held.has(k.accel)) continue
        if (this.api.isRegistered(k.accel)) continue // another PeakFlow shortcut has it
        if (this.api.register(k.accel, k.action)) this.held.add(k.accel)
      }
    } else {
      for (const a of this.held) this.api.unregister(a)
      this.held.clear()
    }
    return [...this.held]
  }

  isHeld(accel: string): boolean {
    return this.held.has(accel)
  }
}
