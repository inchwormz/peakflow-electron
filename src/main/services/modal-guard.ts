/**
 * Wraps a dialog function so the watchdog knows while a dialog is open
 * (no Electron imports, so scripts/checks can test it under plain Node).
 *
 * onOpen fires when the dialog opens and onClose fires exactly once: when the
 * call returns (sync), when its promise settles (async), or after maxOpenMs
 * if the promise never settles. Without that cap a dialog promise that never
 * settled would keep the watchdog paused forever, so a real freeze later on
 * would never be caught. The cap is safe: its timer runs on the main thread,
 * so if it can fire, the main thread (and its heartbeat) is alive.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => unknown

export function guardModal<F extends AnyFn>(
  original: F,
  thisArg: unknown,
  onOpen: () => void,
  onClose: () => void,
  maxOpenMs: number
): F {
  const wrapped = (...args: unknown[]): unknown => {
    onOpen()
    let closed = false
    let cap: ReturnType<typeof setTimeout> | null = null
    const close = (): void => {
      if (closed) return
      closed = true
      if (cap) clearTimeout(cap)
      onClose()
    }
    let result: unknown
    try {
      result = original.apply(thisArg, args)
    } catch (err) {
      close()
      throw err
    }
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      cap = setTimeout(close, maxOpenMs)
      cap.unref?.()
      ;(result as Promise<unknown>).then(close, close)
    } else {
      close()
    }
    return result
  }
  return wrapped as F
}
