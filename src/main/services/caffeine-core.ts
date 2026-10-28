import { CAFFEINE_MAX_MINUTES, type CaffeineState } from '../../shared/caffeine'

export type CaffeinePrefs = Pick<CaffeineState, 'keepScreenOn' | 'defaultMinutes'>
type BlockerType = 'prevent-display-sleep' | 'prevent-app-suspension'

export function validCaffeineMinutes(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= CAFFEINE_MAX_MINUTES)
}

export function validCaffeinePrefs(value: unknown): value is Partial<CaffeinePrefs> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prefs = value as Record<string, unknown>
  return Object.keys(prefs).every(key => key === 'keepScreenOn' || key === 'defaultMinutes') &&
    (!('keepScreenOn' in prefs) || typeof prefs.keepScreenOn === 'boolean') &&
    (!('defaultMinutes' in prefs) || validCaffeineMinutes(prefs.defaultMinutes))
}

export interface CaffeineEffects<Timer> {
  blocker: { start(type: BlockerType): number; stop(id: number): void; isStarted(id: number): boolean }
  now(): number
  setTimer(callback: () => void, ms: number): Timer
  clearTimer(timer: Timer): void
  savePrefs(prefs: CaffeinePrefs): void
  changed(state: CaffeineState): void
}

/** Owns only Caffeine's blocker and timer; never shares another tool's resources. */
export class CaffeineCore<Timer> {
  private state: CaffeineState
  private blockerId: number | null = null
  private timer: Timer | null = null
  private generation = 0
  private effects: CaffeineEffects<Timer>

  constructor(effects: CaffeineEffects<Timer>, prefs: Partial<CaffeinePrefs> = {}) {
    this.effects = effects
    this.state = {
      active: false, endsAt: null, minutes: null,
      keepScreenOn: typeof prefs.keepScreenOn === 'boolean' ? prefs.keepScreenOn : true,
      defaultMinutes: validCaffeineMinutes(prefs.defaultMinutes) ? prefs.defaultMinutes : null
    }
  }

  getState(): CaffeineState { return { ...this.state } }

  private acquire(keepScreenOn: boolean): number {
    const id = this.effects.blocker.start(keepScreenOn ? 'prevent-display-sleep' : 'prevent-app-suspension')
    if (!this.effects.blocker.isStarted(id)) throw new Error('[Caffeine] Sleep blocker did not start')
    return id
  }

  private clearTimer(): void {
    this.generation++
    if (this.timer !== null) this.effects.clearTimer(this.timer)
    this.timer = null
  }

  private armTimer(): void {
    if (this.state.endsAt === null) return
    const generation = this.generation
    const delay = Math.max(1, Math.min(2 ** 31 - 1, this.state.endsAt - this.effects.now()))
    this.timer = this.effects.setTimer(() => {
      if (generation !== this.generation) return
      this.timer = null
      if (!this.checkExpiry()) this.armTimer()
    }, delay)
  }

  start(minutes: unknown): CaffeineState {
    if (!validCaffeineMinutes(minutes)) return this.getState()
    if (this.blockerId === null || !this.effects.blocker.isStarted(this.blockerId)) {
      this.blockerId = this.acquire(this.state.keepScreenOn)
    }
    this.clearTimer()
    this.state = { ...this.state, active: true, minutes, endsAt: minutes === null ? null : this.effects.now() + minutes * 60_000 }
    this.armTimer()
    this.effects.changed(this.getState())
    return this.getState()
  }

  stop(): CaffeineState {
    this.clearTimer()
    if (this.blockerId !== null && this.effects.blocker.isStarted(this.blockerId)) this.effects.blocker.stop(this.blockerId)
    this.blockerId = null
    if (this.state.active) {
      this.state = { ...this.state, active: false, endsAt: null, minutes: null }
      this.effects.changed(this.getState())
    }
    return this.getState()
  }

  /** Called on resume/unlock too: timers may have paused while the Mac slept. */
  checkExpiry(): boolean {
    if (this.state.active && this.state.endsAt !== null && this.effects.now() >= this.state.endsAt) {
      this.stop()
      return true
    }
    return false
  }

  setPrefs(value: unknown): CaffeineState {
    if (!validCaffeinePrefs(value)) return this.getState()
    const prefs = { keepScreenOn: this.state.keepScreenOn, defaultMinutes: this.state.defaultMinutes, ...value }
    if (prefs.keepScreenOn === this.state.keepScreenOn && prefs.defaultMinutes === this.state.defaultMinutes) return this.getState()
    // Acquire first, so a screen-mode change never leaves a gap in protection.
    const replacement = this.state.active && prefs.keepScreenOn !== this.state.keepScreenOn ? this.acquire(prefs.keepScreenOn) : null
    try {
      this.effects.savePrefs(prefs)
    } catch (error) {
      if (replacement !== null && this.effects.blocker.isStarted(replacement)) this.effects.blocker.stop(replacement)
      throw error
    }
    if (replacement !== null) {
      const previous = this.blockerId
      this.blockerId = replacement
      if (previous !== null && this.effects.blocker.isStarted(previous)) this.effects.blocker.stop(previous)
    }
    this.state = { ...this.state, ...prefs }
    this.effects.changed(this.getState())
    return this.getState()
  }
}
