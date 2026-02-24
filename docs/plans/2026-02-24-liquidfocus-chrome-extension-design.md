# LiquidFocus Chrome Extension — Site Blocker

**Date:** 2026-02-24
**Status:** Approved

## Overview

Chrome extension that blocks distraction sites during LiquidFocus Pomodoro work sessions. Communicates with PeakFlow's Electron app via a local HTTP server.

## Architecture

```
PeakFlow Electron App                    Chrome Extension
┌─────────────────────┐                  ┌─────────────────────┐
│ LiquidFocusService  │                  │  Service Worker      │
│  (timer state)      │                  │  (background.js)     │
│        │            │                  │        │             │
│  ExtensionServer    │◄── GET /status ──│  Chrome Alarm (2s)   │
│  (127.0.0.1:17832)  │── JSON response─►│        │             │
│                     │                  │  declarativeNetRequest│
└─────────────────────┘                  │  (block/unblock)     │
                                         │        │             │
                                         │  Popup (status UI)   │
                                         │  blocked.html        │
                                         └─────────────────────┘
```

## Electron Side: Extension Server

**File:** `src/main/services/extension-server.ts`

- HTTP server on `127.0.0.1:17832` (localhost only)
- Single endpoint: `GET /status`
- Reads from existing `LiquidFocusService` singleton
- Starts on app launch, stops on quit
- CORS header for extension origin

**Response format:**
```json
{
  "active": true,
  "mode": "work",
  "sites": ["youtube.com", "reddit.com", "tiktok.com"],
  "remaining": 1423
}
```

When idle or on break:
```json
{
  "active": false,
  "mode": "idle",
  "sites": [],
  "remaining": 0
}
```

## Chrome Extension

**Name:** PeakFlow Focus
**Manifest version:** V3

### Permissions
- `declarativeNetRequest` — site blocking via dynamic rules
- `storage` — caching state/settings
- `alarms` — reliable periodic polling (survives service worker suspension)
- `host_permissions: ["http://127.0.0.1:17832/*"]`

### File Structure
```
peakflow-focus-extension/
  manifest.json
  background.js          — service worker, polls server, manages block rules
  popup.html + popup.js  — timer status, connection state, blocked sites list
  blocked.html           — redirect page when blocked site is visited
  icons/                 — 16, 48, 128px PeakFlow icons
```

### Blocking Mechanism

1. Chrome alarm fires every 2 seconds
2. Service worker fetches `http://127.0.0.1:17832/status`
3. If `active: true` and `mode: "work"`:
   - Build one `declarativeNetRequest` rule per blocked domain
   - Rule action: redirect to `blocked.html`
   - Apply via `updateDynamicRules()`
4. If `active: false` or on break:
   - Remove all dynamic rules (unblock everything)
5. If fetch fails (PeakFlow not running):
   - Remove all rules, set badge to "disconnected"

### Block Page (blocked.html)
- Branded page: "This site is blocked during your focus session"
- Shows blocked domain + time remaining
- "Back to work" button
- No bypass/unblock option

### Popup (popup.html)
- Connection status indicator
- Current mode (Working / Break / Idle)
- Time remaining countdown
- Currently blocked sites list
- Link to open PeakFlow settings

### Badge
- Green + remaining minutes during work sessions
- Gray "OFF" during breaks/idle
- Red "!" if disconnected

## Error Handling

| Scenario | Behavior |
|----------|----------|
| PeakFlow not running | Fail-open: remove all rules, show disconnected badge |
| PeakFlow starts after extension | Next poll (within 2s) picks up server, starts blocking |
| Site list changed mid-session | Next poll picks up updated list, rules update immediately |
| Port 17832 occupied | Server logs warning; v1 uses fixed port |
| Service worker suspended (MV3) | Alarms API wakes it; declarative rules persist independently |
| Multiple browsers | Each polls independently, all stay in sync |

## Distribution

- Chrome Web Store (primary) — $5 one-time developer fee, 1-5 day review
- Works on Edge (Chrome Web Store compatible), Brave (native Chrome extension support)
- Firefox would need separate MV2/MV3 adaptation (out of scope for v1)

## What Already Exists

LiquidFocus already has:
- Distraction sites list in settings (toggleable, persisted in electron-store)
- `distraction_sites: string[]` in config schema with 8 default sites
- Settings UI with Sites tab for managing the list

The extension makes this list *functional* — enforcing it in the browser.
