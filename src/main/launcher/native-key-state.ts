import type { KeyEvent } from './key-taps'

// One transition table drives the executable TS model and emitted Windows C#.
// Each rule requires all positive inputs and none of its negative inputs.
const inputNames = ['capture', 'down', 'up', 'repeat', 'already', 'hold', 'active', 'physicalHold', 'alone', 'suppress'] as const
type Input = typeof inputNames[number]
type Rule = { action: number; yes: Input[]; no: Input[] }
const rules: Rule[] = [
  { action: 1, yes: ['capture','down'], no: ['repeat','already'] },
  { action: 2, yes: ['hold','down','alone'], no: ['capture','repeat','already','physicalHold'] },
  { action: 4, yes: ['hold','up','active'], no: [] },
  { action: 8, yes: ['down','active'], no: ['hold'] },
  { action: 16, yes: ['hold','down','suppress'], no: ['capture','repeat','already'] }
]
export function nativeKeyDecision(input: Record<Input, boolean>): number {
  return rules.reduce((bits,r)=>r.yes.every(k=>input[k]) && r.no.every(k=>!input[k]) ? bits | r.action : bits,0)
}
export function csharpNativeKeyDecision(): string {
  return `static int Decide(${inputNames.map(n=>`bool ${n}`).join(', ')}) {\n int result = 0;\n${rules.map(r=>` if (${[...r.yes.map(n=>n),...r.no.map(n=>`!${n}`)].join(' && ')}) result |= ${r.action};`).join('\n')}\n return result;\n}`
}
export interface NativeKeyInput { code: number; down: boolean; up: boolean; repeat: boolean; physical: Set<number>; modifier: boolean; suppress: boolean; otherModifier: boolean }
export class NativeKeyState {
  private key = 0
  private capture = false
  private active = false
  private physicalHold = false
  private pressed = new Set<number>()
  private paired = new Set<number>()
  configure(key: number, capture: boolean, physical: Set<number>): KeyEvent[] {
    const events: KeyEvent[] = []
    if (key !== this.key || (capture && !this.capture)) {
      if (this.active) events.push('cancel')
      this.active = this.physicalHold = false
    }
    if (capture && !this.capture) this.pressed = new Set(physical)
    this.key = key; this.capture = capture
    return events
  }
  interrupt(): KeyEvent[] {
    const events: KeyEvent[] = this.active ? ['cancel'] : []
    this.active = this.physicalHold = false;this.pressed.clear();this.paired.clear()
    return events
  }
  feed(e: NativeKeyInput): { swallow: boolean; recorded?: number; events: KeyEvent[] } {
    const events: KeyEvent[] = []
    // The current event is not in the OS async state yet. Reconcile OTHER keys only.
    for (const code of this.pressed) if (code !== e.code && !e.physical.has(code)) this.pressed.delete(code)
    if (this.physicalHold && e.code !== this.key && !e.physical.has(this.key)) {
      if (this.active) events.push('cancel')
      this.active = this.physicalHold = false
    }
    const already = this.pressed.has(e.code)
    if(e.up) this.pressed.delete(e.code)
    const wasPaired = this.paired.has(e.code)
    if(wasPaired) {
      if(e.up) this.paired.delete(e.code)
      // A hold's paired release must still end its own active hold.
      if(e.code!==this.key || this.capture) return {swallow:true,events}
      if(e.down) return {swallow:true,events}
    }
    const alone = !e.modifier || (!e.otherModifier && [...this.pressed].every(k=>k===e.code || (this.key===0xA5 && k===0xA2)))
    const action=nativeKeyDecision({capture:this.capture,down:e.down,up:e.up,repeat:e.repeat,already,hold:e.code===this.key,active:this.active,physicalHold:this.physicalHold,alone,suppress:e.suppress})
    if(e.down) this.pressed.add(e.code)
    if(action&1) {this.capture=false;this.active=this.physicalHold=false;this.paired.add(e.code);return {swallow:true,recorded:e.code,events}}
    if(e.code===this.key && e.down && !already && !e.repeat) this.physicalHold=true
    if(action&2) {this.active=true;events.push('down')}
    if(action&4) {this.active=false;events.push('up')}
    if(e.code===this.key && e.up) this.physicalHold=false
    if(action&8) {this.active=false;events.push('cancel')}
    if(action&16) this.paired.add(e.code)
    return {swallow:!!(action&16) || (e.up && wasPaired),events}
  }
}
