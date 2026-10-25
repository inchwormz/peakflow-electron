/** Esc belongs to dictation only from a live recording press through its release. */
export class EscapeSession {
  recording = false
  private down = false
  feed(isDown: boolean): { swallow: boolean; cancel: boolean } {
    if (isDown) {
      if (this.down) return { swallow: true, cancel: false }
      if (!this.recording) return { swallow: false, cancel: false }
      this.down = true
      return { swallow: true, cancel: true }
    }
    const swallow = this.down
    this.down = false
    return { swallow, cancel: false }
  }
}
