/* Reports first-sample timing only. MediaRecorder buffers the audio separately. */
class DictationCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.first = true
  }

  process(inputs) {
    if (this.first && inputs[0]?.[0]?.length) {
      this.first = false
      this.port.postMessage({ firstSampleAt: Date.now() })
    }
    return true
  }
}
registerProcessor('dictation-capture', DictationCaptureProcessor)
