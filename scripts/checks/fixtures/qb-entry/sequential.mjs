import { state } from './state.mjs'
export const startQueue = (ids) => { state.calls.push(`start:${ids.join(',')}`) }
export const pasteNext = () => { state.calls.push('queue-paste'); return true }
