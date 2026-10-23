/**
 * Only the newest async request may deliver its answer. Each `next()` returns
 * a check that stays true until a newer request starts (or `cancel()` runs),
 * so a slow reply can't overwrite a newer one.
 */
export function createLatest(): { next: () => () => boolean; cancel: () => void } {
  let seq = 0
  return {
    next() {
      const id = ++seq
      return () => id === seq
    },
    cancel() {
      seq++
    }
  }
}
