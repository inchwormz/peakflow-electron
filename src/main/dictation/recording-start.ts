/** Renderer readiness is an explicit handshake, not webContents.isLoading(). */
export class RecordingStart<T> {
  private listening = false
  private pending: T | undefined
  get isReady(): boolean { return this.listening }
  private send: (value: T) => void
  constructor(send: (value: T) => void) { this.send = send }
  start(value: T): void {
    if (this.listening) this.send(value)
    else this.pending = value
  }
  ready(): void {
    this.listening = true
    if (this.pending !== undefined) {
      const value = this.pending
      this.pending = undefined
      this.send(value)
    }
  }
  cancel(): void { this.pending = undefined }
  reset(): void { this.cancel(); this.listening = false }
}
