# LiquidFocus Chrome Extension — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Chrome extension that blocks distraction sites during LiquidFocus Pomodoro work sessions, communicating with PeakFlow via a localhost HTTP server.

**Architecture:** PeakFlow's main process runs a tiny HTTP server on `127.0.0.1:17832` that exposes timer state + blocked sites. The Chrome extension (Manifest V3) polls this endpoint every 2 seconds via the alarms API and uses `declarativeNetRequest` to dynamically add/remove blocking rules. When a user visits a blocked site during a work session, they're redirected to a branded "blocked" page.

**Tech Stack:** Node.js `http` module (Electron side), Chrome Extension Manifest V3 APIs (`declarativeNetRequest`, `alarms`, `storage`)

**Design doc:** `docs/plans/2026-02-24-liquidfocus-chrome-extension-design.md`

---

## Task 1: Extension Server — Electron HTTP endpoint

**Files:**
- Create: `src/main/services/extension-server.ts`
- Modify: `src/main/index.ts:21,112,132`

**Step 1: Create `extension-server.ts`**

This service spins up a localhost-only HTTP server that the Chrome extension polls. It reads directly from the existing `LiquidFocusService` singleton.

```typescript
/**
 * Extension Server — localhost HTTP endpoint for the PeakFlow Focus Chrome extension.
 *
 * Exposes LiquidFocus timer state + distraction site list so the browser extension
 * can enforce site blocking during Pomodoro work sessions.
 *
 * Binds to 127.0.0.1 only (no external access). Port 17832.
 */

import { createServer, IncomingMessage, ServerResponse, Server } from 'http'
import { getLiquidFocusService } from './liquidfocus'
import { getConfig } from './config-store'
import { ToolId } from '@shared/tool-ids'
import type { LiquidFocusConfig } from '@shared/config-schemas'

const PORT = 17832
const HOST = '127.0.0.1'

let server: Server | null = null

function handleRequest(_req: IncomingMessage, res: ServerResponse): void {
  // CORS — allow any origin on localhost (extension origin is chrome-extension://...)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET')
  res.setHeader('Content-Type', 'application/json')

  if (_req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (_req.url !== '/status') {
    res.writeHead(404)
    res.end(JSON.stringify({ error: 'not found' }))
    return
  }

  try {
    const svc = getLiquidFocusService()
    const timer = svc.getTimerState()
    const cfg = getConfig(ToolId.LiquidFocus) as LiquidFocusConfig

    const isBlocking = timer.status === 'running' && timer.mode === 'work'

    const payload = {
      active: isBlocking,
      mode: timer.status === 'idle' ? 'idle' : timer.mode,
      sites: isBlocking ? (cfg.distraction_sites || []) : [],
      remaining: timer.remaining
    }

    res.writeHead(200)
    res.end(JSON.stringify(payload))
  } catch (err) {
    console.error('[ExtensionServer] Error building status:', err)
    res.writeHead(500)
    res.end(JSON.stringify({ error: 'internal error' }))
  }
}

export function initExtensionServer(): void {
  if (server) return

  server = createServer(handleRequest)

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[ExtensionServer] Port ${PORT} in use — extension server disabled`)
    } else {
      console.error('[ExtensionServer] Server error:', err.message)
    }
    server = null
  })

  server.listen(PORT, HOST, () => {
    console.log(`[ExtensionServer] Listening on http://${HOST}:${PORT}`)
  })
}

export function destroyExtensionServer(): void {
  if (server) {
    server.close()
    server = null
    console.log('[ExtensionServer] Stopped')
  }
}
```

**Step 2: Wire into `src/main/index.ts`**

Add import alongside other service imports (after line 23):

```typescript
import { initExtensionServer, destroyExtensionServer } from './services/extension-server'
```

Add init call after `initTodoist()` (after line 114):

```typescript
    initExtensionServer()
```

Add destroy call in `before-quit` handler (after line 131):

```typescript
    destroyExtensionServer()
```

**Step 3: Build and verify**

Run: `npm run build`
Expected: Clean build, no type errors.

Manual test: With PeakFlow running, open a browser to `http://127.0.0.1:17832/status` — should see JSON response.

**Step 4: Commit**

```bash
git add src/main/services/extension-server.ts src/main/index.ts
git commit -m "feat: add localhost HTTP server for Chrome extension communication"
```

---

## Task 2: Chrome Extension — Manifest and scaffolding

**Files:**
- Create: `peakflow-focus-extension/manifest.json`
- Create: `peakflow-focus-extension/background.js`
- Create: `peakflow-focus-extension/popup.html`
- Create: `peakflow-focus-extension/popup.js`
- Create: `peakflow-focus-extension/blocked.html`

**Step 1: Create `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "PeakFlow Focus",
  "version": "1.0.0",
  "description": "Block distracting sites during PeakFlow Pomodoro focus sessions",
  "permissions": [
    "declarativeNetRequest",
    "storage",
    "alarms"
  ],
  "host_permissions": [
    "http://127.0.0.1:17832/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    }
  },
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  }
}
```

**Step 2: Create placeholder icon files**

Create `peakflow-focus-extension/icons/` directory. For now, use simple colored PNGs (16x16, 48x48, 128x128) as placeholders. These can be replaced with PeakFlow-branded icons later.

**Step 3: Commit scaffolding**

```bash
git add peakflow-focus-extension/manifest.json peakflow-focus-extension/icons/
git commit -m "feat: scaffold Chrome extension manifest and icons"
```

---

## Task 3: Chrome Extension — Service worker (background.js)

**Files:**
- Create: `peakflow-focus-extension/background.js`

**Step 1: Write the service worker**

This is the core logic — polls the Electron server, manages blocking rules, updates badge.

```javascript
/**
 * PeakFlow Focus — Chrome Extension Service Worker
 *
 * Polls PeakFlow's localhost server every 2 seconds to check if a Pomodoro
 * work session is active. When active, dynamically adds declarativeNetRequest
 * rules to block distraction sites. When inactive, removes all rules.
 */

const SERVER_URL = 'http://127.0.0.1:17832/status'
const POLL_ALARM = 'peakflow-poll'
const POLL_INTERVAL_MINUTES = 0.0333 // ~2 seconds (minimum Chrome allows is 0.5 min in production, so we supplement with setTimeout)
const RULE_ID_OFFSET = 1000 // Rule IDs start at 1000 to avoid conflicts

// ─── State ─────────────────────────────────────────────────────────────────

let lastState = { active: false, mode: 'idle', sites: [], remaining: 0 }
let connected = false

// ─── Polling ───────────────────────────────────────────────────────────────

async function pollServer() {
  try {
    const res = await fetch(SERVER_URL, { signal: AbortSignal.timeout(3000) })
    const data = await res.json()
    connected = true

    const stateChanged =
      data.active !== lastState.active ||
      data.mode !== lastState.mode ||
      JSON.stringify(data.sites) !== JSON.stringify(lastState.sites)

    lastState = data

    if (stateChanged) {
      await updateBlockRules(data)
    }

    updateBadge(data)

    // Persist state for popup
    chrome.storage.local.set({ peakflowState: data, connected: true })
  } catch {
    connected = false
    lastState = { active: false, mode: 'idle', sites: [], remaining: 0 }

    // Remove all block rules when disconnected (fail-open)
    await removeAllRules()
    updateBadge(null)

    chrome.storage.local.set({
      peakflowState: lastState,
      connected: false
    })
  }

  // Schedule next poll (Chrome alarms have 1-minute minimum in production,
  // so we use setTimeout for the 2-second interval, with an alarm as a
  // fallback to wake the service worker if it gets suspended)
  setTimeout(pollServer, 2000)
}

// Alarm as a fallback to restart polling if service worker was suspended
chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) {
    pollServer()
  }
})

// ─── Block Rules ───────────────────────────────────────────────────────────

async function updateBlockRules(state) {
  // Remove all existing dynamic rules first
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules()
  const removeIds = existingRules.map(r => r.id)

  if (!state.active || !state.sites || state.sites.length === 0) {
    if (removeIds.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: removeIds
      })
    }
    return
  }

  // Build one rule per domain — redirect to blocked.html
  const addRules = state.sites.map((domain, i) => ({
    id: RULE_ID_OFFSET + i,
    priority: 1,
    action: {
      type: 'redirect',
      redirect: {
        extensionPath: `/blocked.html?site=${encodeURIComponent(domain)}&remaining=${state.remaining}`
      }
    },
    condition: {
      urlFilter: `||${domain}`,
      resourceTypes: ['main_frame']
    }
  }))

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: removeIds,
    addRules
  })
}

async function removeAllRules() {
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules()
  const removeIds = existingRules.map(r => r.id)
  if (removeIds.length > 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: removeIds
    })
  }
}

// ─── Badge ─────────────────────────────────────────────────────────────────

function updateBadge(state) {
  if (!state || !connected) {
    chrome.action.setBadgeText({ text: '!' })
    chrome.action.setBadgeBackgroundColor({ color: '#EF4444' })
    chrome.action.setTitle({ title: 'PeakFlow Focus — Disconnected' })
    return
  }

  if (state.active && state.mode === 'work') {
    const mins = Math.ceil(state.remaining / 60)
    chrome.action.setBadgeText({ text: `${mins}` })
    chrome.action.setBadgeBackgroundColor({ color: '#22C55E' })
    chrome.action.setTitle({ title: `PeakFlow Focus — ${mins}m remaining` })
  } else {
    chrome.action.setBadgeText({ text: 'OFF' })
    chrome.action.setBadgeBackgroundColor({ color: '#6B7280' })
    chrome.action.setTitle({ title: 'PeakFlow Focus — Idle' })
  }
}

// ─── Init ──────────────────────────────────────────────────────────────────

// Start polling immediately on service worker activation
pollServer()
```

**Step 2: Verify extension loads**

1. Open `chrome://extensions/`
2. Enable Developer mode
3. Click "Load unpacked" → select `peakflow-focus-extension/`
4. Should see the extension with no errors in the service worker console

**Step 3: Commit**

```bash
git add peakflow-focus-extension/background.js
git commit -m "feat: service worker with polling, declarativeNetRequest blocking, and badge"
```

---

## Task 4: Chrome Extension — Block page (blocked.html)

**Files:**
- Create: `peakflow-focus-extension/blocked.html`

**Step 1: Create the block page**

This is what users see when they try to visit a blocked site. Clean, branded, no bypass.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Site Blocked — PeakFlow Focus</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f0f0f;
      color: #e5e5e5;
    }

    .container {
      text-align: center;
      max-width: 480px;
      padding: 48px 32px;
    }

    .icon {
      font-size: 64px;
      margin-bottom: 24px;
      opacity: 0.8;
    }

    h1 {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 12px;
      color: #fff;
    }

    .site-name {
      font-size: 16px;
      color: #a3a3a3;
      margin-bottom: 32px;
    }

    .site-name strong {
      color: #f87171;
    }

    .timer {
      font-size: 40px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: #22c55e;
      margin-bottom: 8px;
    }

    .timer-label {
      font-size: 13px;
      color: #737373;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 40px;
    }

    .back-btn {
      display: inline-block;
      padding: 12px 28px;
      background: #262626;
      color: #e5e5e5;
      border: 1px solid #404040;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      text-decoration: none;
      transition: background 0.15s;
    }

    .back-btn:hover {
      background: #333;
    }

    .brand {
      margin-top: 48px;
      font-size: 12px;
      color: #525252;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">&#128683;</div>
    <h1>This site is blocked</h1>
    <p class="site-name">
      <strong id="blocked-domain">—</strong> is on your distraction list
    </p>
    <div class="timer" id="timer">--:--</div>
    <div class="timer-label">remaining in focus session</div>
    <a href="javascript:history.back()" class="back-btn">Back to work</a>
    <p class="brand">PeakFlow Focus</p>
  </div>

  <script>
    const params = new URLSearchParams(window.location.search)
    const site = params.get('site') || 'this site'
    let remaining = parseInt(params.get('remaining') || '0', 10)

    document.getElementById('blocked-domain').textContent = site

    function formatTime(secs) {
      const m = Math.floor(secs / 60)
      const s = secs % 60
      return `${m}:${String(s).padStart(2, '0')}`
    }

    function updateTimer() {
      document.getElementById('timer').textContent = formatTime(remaining)
      if (remaining > 0) {
        remaining--
        setTimeout(updateTimer, 1000)
      }
    }

    updateTimer()
  </script>
</body>
</html>
```

**Step 2: Verify**

Load the extension, start a LiquidFocus work session, navigate to a blocked site. Should redirect to this page with the domain name and countdown.

**Step 3: Commit**

```bash
git add peakflow-focus-extension/blocked.html
git commit -m "feat: branded block page with countdown timer"
```

---

## Task 5: Chrome Extension — Popup UI (popup.html + popup.js)

**Files:**
- Create: `peakflow-focus-extension/popup.html`
- Create: `peakflow-focus-extension/popup.js`

**Step 1: Create `popup.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      width: 280px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #141414;
      color: #e5e5e5;
      padding: 16px;
    }

    .header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
    }

    .header h1 {
      font-size: 14px;
      font-weight: 600;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .status-dot.connected { background: #22c55e; }
    .status-dot.disconnected { background: #ef4444; }

    .mode {
      font-size: 12px;
      color: #a3a3a3;
      margin-bottom: 12px;
    }

    .timer-display {
      font-size: 32px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      text-align: center;
      padding: 12px 0;
      margin-bottom: 12px;
    }

    .timer-display.work { color: #22c55e; }
    .timer-display.break { color: #60a5fa; }
    .timer-display.idle { color: #525252; }

    .divider {
      border: none;
      border-top: 1px solid #262626;
      margin: 12px 0;
    }

    .section-title {
      font-size: 11px;
      font-weight: 600;
      color: #737373;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 8px;
    }

    .site-list {
      list-style: none;
      max-height: 120px;
      overflow-y: auto;
    }

    .site-list li {
      font-size: 12px;
      color: #a3a3a3;
      padding: 3px 0;
    }

    .site-list li::before {
      content: '\1F6AB ';
      font-size: 10px;
    }

    .empty-state {
      font-size: 12px;
      color: #525252;
      font-style: italic;
    }

    .disconnected-msg {
      text-align: center;
      padding: 20px 0;
      color: #a3a3a3;
      font-size: 13px;
    }

    .disconnected-msg .icon { font-size: 24px; margin-bottom: 8px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="status-dot" id="status-dot"></div>
    <h1>PeakFlow Focus</h1>
  </div>

  <div id="connected-view">
    <div class="mode" id="mode-text">—</div>
    <div class="timer-display idle" id="timer-display">--:--</div>
    <hr class="divider">
    <div class="section-title">Blocked sites</div>
    <ul class="site-list" id="site-list"></ul>
    <div class="empty-state" id="empty-state" style="display:none">No sites blocked right now</div>
  </div>

  <div id="disconnected-view" style="display:none">
    <div class="disconnected-msg">
      <div class="icon">&#128268;</div>
      <div>PeakFlow is not running</div>
      <div style="font-size:11px;color:#525252;margin-top:4px">Launch PeakFlow to enable site blocking</div>
    </div>
  </div>

  <script src="popup.js"></script>
</body>
</html>
```

**Step 2: Create `popup.js`**

```javascript
/**
 * PeakFlow Focus — Popup script
 * Reads cached state from storage and renders status UI.
 */

function formatTime(secs) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function getModeText(state) {
  if (!state.active && state.mode === 'idle') return 'Timer is idle'
  if (state.active && state.mode === 'work') return 'Focus session in progress'
  if (state.mode === 'short_break') return 'Short break'
  if (state.mode === 'long_break') return 'Long break'
  return 'Idle'
}

function render(state, isConnected) {
  const dot = document.getElementById('status-dot')
  const connView = document.getElementById('connected-view')
  const discView = document.getElementById('disconnected-view')

  if (!isConnected) {
    dot.className = 'status-dot disconnected'
    connView.style.display = 'none'
    discView.style.display = 'block'
    return
  }

  dot.className = 'status-dot connected'
  connView.style.display = 'block'
  discView.style.display = 'none'

  // Mode text
  document.getElementById('mode-text').textContent = getModeText(state)

  // Timer
  const timerEl = document.getElementById('timer-display')
  timerEl.textContent = formatTime(state.remaining || 0)
  timerEl.className = 'timer-display ' + (state.active ? 'work' : state.mode === 'idle' ? 'idle' : 'break')

  // Site list
  const listEl = document.getElementById('site-list')
  const emptyEl = document.getElementById('empty-state')
  listEl.innerHTML = ''

  if (state.sites && state.sites.length > 0) {
    emptyEl.style.display = 'none'
    state.sites.forEach(site => {
      const li = document.createElement('li')
      li.textContent = site
      listEl.appendChild(li)
    })
  } else {
    emptyEl.style.display = 'block'
  }
}

// Load state from storage and render
chrome.storage.local.get(['peakflowState', 'connected'], (data) => {
  const state = data.peakflowState || { active: false, mode: 'idle', sites: [], remaining: 0 }
  const isConnected = data.connected || false
  render(state, isConnected)
})

// Live update while popup is open
chrome.storage.onChanged.addListener((changes) => {
  if (changes.peakflowState || changes.connected) {
    chrome.storage.local.get(['peakflowState', 'connected'], (data) => {
      render(
        data.peakflowState || { active: false, mode: 'idle', sites: [], remaining: 0 },
        data.connected || false
      )
    })
  }
})
```

**Step 3: Verify**

Load extension, click the extension icon in the toolbar. Popup should show connection status, timer, and blocked sites (or "PeakFlow is not running" if the app isn't open).

**Step 4: Commit**

```bash
git add peakflow-focus-extension/popup.html peakflow-focus-extension/popup.js
git commit -m "feat: popup UI showing timer status, connection state, and blocked sites"
```

---

## Task 6: Integration test — end-to-end flow

**Step 1: Start PeakFlow**

Run: `npm run build && npx electron .`

Verify: `http://127.0.0.1:17832/status` returns `{"active":false,"mode":"idle","sites":[],"remaining":0}`

**Step 2: Load the Chrome extension**

1. Open `chrome://extensions/` → Developer mode → Load unpacked → select `peakflow-focus-extension/`
2. Verify: badge shows gray "OFF"
3. Click extension icon → should show "Timer is idle", connected

**Step 3: Start a work session**

1. Open LiquidFocus in PeakFlow → Start timer
2. Wait 2-3 seconds for the extension to poll
3. Verify: badge turns green with minutes remaining
4. Navigate to `youtube.com` → should redirect to `blocked.html` with countdown
5. Click "Back to work" → should go back

**Step 4: Pause/stop session**

1. Pause or reset the timer in LiquidFocus
2. Wait 2-3 seconds
3. Verify: badge turns gray "OFF"
4. Navigate to `youtube.com` → should load normally

**Step 5: Test disconnection**

1. Quit PeakFlow
2. Wait 2-3 seconds
3. Verify: badge shows red "!"
4. Navigate to `youtube.com` → should load normally (fail-open)

**Step 6: Commit all remaining changes**

```bash
git add peakflow-focus-extension/
git commit -m "feat: PeakFlow Focus Chrome extension v1.0 — site blocking during Pomodoro sessions"
```

---

## Task 7: Generate extension icons

**Step 1: Create PeakFlow-branded icons**

Generate 16x16, 48x48, and 128x128 PNG icons for the extension. These should use PeakFlow's visual identity (the existing tray icon or app icon can be adapted).

Place in `peakflow-focus-extension/icons/`:
- `icon-16.png`
- `icon-48.png`
- `icon-128.png`

**Step 2: Commit**

```bash
git add peakflow-focus-extension/icons/
git commit -m "feat: add PeakFlow Focus extension icons"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Electron HTTP server | `extension-server.ts`, `index.ts` |
| 2 | Extension manifest + scaffold | `manifest.json`, `icons/` |
| 3 | Service worker (polling + blocking) | `background.js` |
| 4 | Block page | `blocked.html` |
| 5 | Popup UI | `popup.html`, `popup.js` |
| 6 | End-to-end integration test | Manual verification |
| 7 | Extension icons | `icons/` |
