/** Hands out a stamp per request; a response applies only while no newer request has been stamped (calling it again also retires every older one) */
export function newestOnly(): () => () => boolean {
  let latest = 0
  return () => {
    const mine = ++latest
    return () => mine === latest
  }
}

/** Stamps for the settings rows: a reload's answer is dropped by a newer reload or by any mutation that started after it; a mutation's answer is dropped only by a later mutation */
export function settingsStamps(): { reload: () => () => boolean; mutate: () => () => boolean; stop: () => void } {
  let reloads = 0
  let mutations = 0
  return {
    reload: () => {
      const r = ++reloads
      const m = mutations
      return () => r === reloads && m === mutations
    },
    mutate: () => {
      const m = ++mutations
      return () => m === mutations
    },
    stop: () => { reloads++; mutations++ }
  }
}

export interface AccountWatchDeps<T> {
  fetch: () => Promise<T>
  onValue: (value: T) => void
  onError: () => void
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (timer: unknown) => void
  /** Window focus */
  onFocus: (fn: () => void) => () => void
  /** Launcher shown, account changed, licence changed: each asks for a fresh look */
  onRefreshEvents: Array<(fn: () => void) => () => void>
}

/** Delay before the extra look after coming back from a checkout, in case the payment's webhook was still on its way */
export const RECHECK_AFTER_CHECKOUT_MS = 6000

/** Keeps the balance row current: looks on start and on each event, and once more shortly after a focus that follows a checkout. Newest answer wins. */
export function watchAccount<T>(deps: AccountWatchDeps<T>): { checkoutOpened: () => void; stop: () => void } {
  const stamp = newestOnly()
  const timers: unknown[] = []
  let returning = false
  const refresh = (): void => {
    const current = stamp()
    deps.fetch().then((value) => { if (current()) deps.onValue(value) }, () => { if (current()) deps.onError() })
  }
  refresh()
  const offs = [
    deps.onFocus(() => {
      const afterCheckout = returning
      returning = false
      refresh()
      if (afterCheckout) timers.push(deps.setTimer(refresh, RECHECK_AFTER_CHECKOUT_MS))
    }),
    ...deps.onRefreshEvents.map((on) => on(refresh))
  ]
  return {
    checkoutOpened: () => { returning = true },
    stop: () => {
      stamp()
      offs.forEach((off) => off())
      timers.forEach(deps.clearTimer)
    }
  }
}
