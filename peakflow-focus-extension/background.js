/**
 * PeakFlow Focus — Chrome Extension Service Worker
 *
 * Polls PeakFlow's localhost server every 2 seconds to check if a Pomodoro
 * work session is active. When active, dynamically adds declarativeNetRequest
 * rules to block distraction sites. When inactive, removes all rules.
 */

const SERVER_URL = 'http://127.0.0.1:17832/status'
const POLL_ALARM = 'peakflow-poll'
const RULE_ID_OFFSET = 1000

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
    chrome.storage.local.set({ peakflowState: data, connected: true })
  } catch {
    connected = false
    lastState = { active: false, mode: 'idle', sites: [], remaining: 0 }

    await removeAllRules()
    updateBadge(null)
    chrome.storage.local.set({ peakflowState: lastState, connected: false })
  }

  // 2-second poll via setTimeout; alarm is fallback to wake suspended worker
  setTimeout(pollServer, 2000)
}

// Alarm fallback — Chrome suspends service workers after 30s of inactivity.
// The alarm (minimum 0.5 min in production) wakes the worker; setTimeout
// handles the actual 2-second cadence while the worker is alive.
chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) {
    pollServer()
  }
})

// ─── Block Rules ───────────────────────────────────────────────────────────

async function updateBlockRules(state) {
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules()
  const removeIds = existingRules.map((r) => r.id)

  if (!state.active || !state.sites || state.sites.length === 0) {
    if (removeIds.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: removeIds })
    }
    return
  }

  // One rule per domain — redirect to blocked.html
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
  const removeIds = existingRules.map((r) => r.id)
  if (removeIds.length > 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: removeIds })
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

pollServer()
