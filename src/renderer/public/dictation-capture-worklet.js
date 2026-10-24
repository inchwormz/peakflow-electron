/* Runs on the audio rendering thread. The context requests 24 kHz mono. */
class DictationCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.pending = new Int16Array(2400) // 100 ms, including the opening samples
    this.used = 0
    this.first = true
    this.finished = false
    this.port.onmessage = ({ data }) => {
      if (!data.flush || this.finished) return
      this.finished = true
      this.flush()
      this.port.postMessage({ drained: true })
    }
  }

  flush() {
    if (!this.used) return
    const pcm = this.pending.slice(0, this.used).buffer
    this.port.postMessage({ pcm }, [pcm])
    this.used = 0
  }

  process(inputs) {
    const samples = inputs[0]?.[0]
    if (this.finished || !samples?.length) return true
    if (this.first) {
      this.first = false
      this.port.postMessage({ firstSampleAt: Date.now() })
    }
    for (const sample of samples) {
      const clamped = Math.max(-1, Math.min(1, sample))
      this.pending[this.used++] = Math.round(clamped * (clamped < 0 ? 32768 : 32767))
      if (this.used === this.pending.length) this.flush()
    }
    return true
  }
}
registerProcessor('dictation-capture', DictationCaptureProcessor)
