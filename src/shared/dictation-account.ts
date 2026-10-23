/** Only display data crosses IPC; licence keys and checkout URLs stay in main. */
export type DictationAccount =
  | { state: 'hidden' | 'no_addon' | 'devices' }
  | { state: 'ok' | 'low' | 'empty'; balanceMicros: number; minutesLeft: number; disabled: boolean; blocked: null | 'disabled' | 'daily_limit' }
