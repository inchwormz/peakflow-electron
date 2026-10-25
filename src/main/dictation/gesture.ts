/** Clean physical presses only. Shortcut cancels cannot stop hands-free audio. */
export class DictationGesture {
  locked = false
  private downAt: number | null = null
  private lastTapUp = -Infinity
  private second = false

  feed(event: 'down' | 'up' | 'cancel', now: number): 'start' | 'drop' | 'stop' | 'lock' | 'none' {
    if (event === 'cancel') {
      this.downAt = null
      this.lastTapUp = -Infinity
      return this.locked ? 'none' : 'drop'
    }
    if (event === 'down') {
      if (this.downAt !== null) return 'none'
      this.downAt = now
      this.second = now - this.lastTapUp <= 400
      return this.locked ? 'none' : 'start'
    }
    if (this.downAt === null) return 'none'
    const tap = now - this.downAt < 300
    this.downAt = null
    if (this.locked) {
      if (!tap) return 'none'
      this.reset()
      return 'stop'
    }
    if (tap && this.second) {
      this.locked = true
      this.lastTapUp = -Infinity
      return 'lock'
    }
    this.lastTapUp = tap ? now : -Infinity
    return tap ? 'drop' : 'stop'
  }

  reset(): void {
    this.locked = false
    this.downAt = null
    this.lastTapUp = -Infinity
    this.second = false
  }
}
