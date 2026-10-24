/** Runs calls one at a time in the order they were made; a failing call rejects only its own caller. No Electron imports, so this can be checked from Node. */
export function serial(): <T>(fn: () => T | Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve()
  return (fn) => {
    const run = tail.then(fn)
    tail = run.catch(() => undefined)
    return run
  }
}
