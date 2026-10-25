import { spawn } from 'child_process'
import { getMacHelperPath } from './mac-helper'
import { EXCLUDED_APPS } from '../security/excluded-apps'

export interface CommandSelection {
  text: string
  replace(text: string, keyCode: number, onPaste: () => void, current: () => boolean): Promise<boolean>
  cancel(): void
}
export type CommandCapture = { ok: true; selection: CommandSelection } | { ok: false; error: string }

/** Retain AX identities in the same native process from capture to replacement. */
export function captureNativeCommandSelection(signal: AbortSignal): Promise<CommandCapture> {
  if (process.platform !== 'darwin' || signal.aborted) return Promise.resolve({ ok: false, error: 'Command unavailable' })
  return new Promise((resolve) => {
    const child = spawn(getMacHelperPath(), ['command-selection'], { stdio: ['pipe', 'pipe', 'ignore'] })
    let captured = false
    let closed = false
    let result: ((ok: boolean) => void) | undefined
    let onPaste: (() => void) | undefined
    let current = (): boolean => !signal.aborted
    let buffer = ''
    const send = (data: object): void => { if (!closed && child.stdin.writable) child.stdin.write(JSON.stringify(data) + '\n') }
    const cancel = (): void => {
      send({ cancel: true })
      if (!captured) resolve({ ok: false, error: 'Cancelled' })
    }
    const timer = setTimeout(() => { cancel(); child.stdin.end() }, 3000)
    const close = (): void => {
      closed = true
      clearTimeout(timer)
      signal.removeEventListener('abort', cancel)
      if (!captured) resolve({ ok: false, error: 'Couldn’t check selection' })
      result?.(false)
    }
    child.once('error', close)
    child.once('exit', close)
    child.stdin.on('error', () => {})
    signal.addEventListener('abort', cancel, { once: true })
    send({ excluded: EXCLUDED_APPS })
    if (signal.aborted) cancel()
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      let end: number
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
        try {
          const reply = JSON.parse(line) as { stage?: string; text?: string; error?: string; ok?: boolean }
          if (reply.stage === 'capture' && !captured) {
            clearTimeout(timer)
            if (signal.aborted) { cancel(); continue }
            if (typeof reply.text !== 'string' || !reply.text.trim() || Buffer.byteLength(reply.text) > 2000) {
              resolve({ ok: false, error: reply.error ?? 'Unsupported selection' }); child.stdin.end(); continue
            }
            captured = true
            let used = false
            resolve({ ok: true, selection: {
              text: reply.text, cancel,
              replace: (text, keyCode, started, valid) => {
                current = valid
                if (used || closed || signal.aborted) return Promise.resolve(false)
                used = true
                onPaste = started
                return new Promise<boolean>((done) => {
                  const timeout = setTimeout(() => { cancel(); child.stdin.end(); result?.(false) }, 8000)
                  result = (ok) => { clearTimeout(timeout); done(ok) }
                  send({ text, keyCode })
                })
              }
            } })
          } else if (reply.stage === 'validate') send({ authorize: !signal.aborted && current() })
          else if (reply.stage === 'pasting') onPaste?.()
          else if (reply.stage === 'result') { result?.(reply.ok === true); child.stdin.end() }
        } catch { /* Only the bounded native protocol is accepted; never log its contents. */ }
      }
    })
  })
}
