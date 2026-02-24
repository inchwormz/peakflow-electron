/**
 * Extension Server — localhost HTTP server for Chrome extension communication.
 *
 * Exposes LiquidFocus timer state and blocked sites list on 127.0.0.1:17832
 * so the PeakFlow Chrome extension can poll GET /status to know when to
 * block distraction sites during work sessions.
 */

import { createServer, IncomingMessage, ServerResponse, Server } from 'http'
import { getLiquidFocusService } from './liquidfocus'
import { getConfig } from './config-store'
import { ToolId } from '@shared/tool-ids'
import type { LiquidFocusConfig } from '@shared/config-schemas'

const PORT = 17832
const HOST = '127.0.0.1'

let server: Server | null = null

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  // CORS headers for chrome-extension:// origins
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  // Only GET /status is valid
  if (req.method !== 'GET' || req.url !== '/status') {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
    return
  }

  try {
    const timerState = getLiquidFocusService().getTimerState()
    const isWorkSession = timerState.status === 'running' && timerState.mode === 'work'

    let sites: string[] = []
    if (isWorkSession) {
      const config = getConfig(ToolId.LiquidFocus) as LiquidFocusConfig
      sites = config.distraction_sites ?? []
    }

    const body = JSON.stringify({
      active: isWorkSession,
      mode: isWorkSession ? 'work' : timerState.status === 'running' ? timerState.mode : 'idle',
      sites,
      remaining: isWorkSession ? timerState.remaining : 0
    })

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(body)
  } catch (err) {
    // Service not initialized yet or other error — return idle state
    console.warn('[ExtensionServer] Error reading timer state:', err)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ active: false, mode: 'idle', sites: [], remaining: 0 }))
  }
}

export function initExtensionServer(): void {
  if (server) return

  server = createServer(handleRequest)

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[ExtensionServer] Port ${PORT} already in use — extension server disabled`)
      server = null
      return
    }
    console.error('[ExtensionServer] Server error:', err)
  })

  server.listen(PORT, HOST, () => {
    console.log(`[ExtensionServer] Listening on http://${HOST}:${PORT}`)
  })
}

export function destroyExtensionServer(): void {
  if (!server) return
  server.close(() => {
    console.log('[ExtensionServer] Shut down')
  })
  server = null
}
