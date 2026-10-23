/** The top-up amounts on sale, in US dollars. Each has its own Lemon Squeezy checkout. */
export type TopupAmount = 5 | 10 | 15 | 20

/**
 * Only display data crosses IPC; licence keys and checkout URLs stay in main.
 * `amounts` lists the top-ups whose checkout is configured in this build.
 */
export type DictationAccount =
  | { state: 'hidden' | 'devices' }
  | { state: 'no_addon'; amounts?: TopupAmount[] }
  | { state: 'ok' | 'low' | 'empty'; balanceMicros: number; minutesLeft: number; disabled: boolean; blocked: null | 'disabled' | 'daily_limit'; amounts?: TopupAmount[] }
