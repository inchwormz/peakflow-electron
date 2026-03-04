/**
 * FocusDim Service — dims everything except the active window.
 *
 * Creates one transparent overlay BrowserWindow per monitor and uses
 * CSS clip-path to carve out a rectangular "hole" on the monitor that
 * contains the active window. All other monitors get a full dim.
 *
 * Per-monitor overlays solve the Electron/Windows limitation where a
 * single transparent window cannot reliably span multiple displays
 * (transparency breaks, DPI mismatches, rendering artifacts).
 *
 * Uses native Win32 API (GetForegroundWindow + DwmGetWindowAttribute)
 * via koffi FFI for real foreground window tracking.
 *
 * State is persisted via config-store so settings survive app restarts.
 */

import { BrowserWindow, screen, powerMonitor, globalShortcut } from 'electron'
import { ToolId } from '@shared/tool-ids'
import { IPC_SEND } from '@shared/ipc-types'
import { getConfig, setConfig } from './config-store'
import type { FocusDimConfig } from '@shared/config-schemas'
import { getActiveWindow, getAllVisibleWindows, getWindowsForExeNames, getProcessExeName, clearPidExeCache, getVisibleAppList, type WindowRect, type DisplayBounds } from '../native/active-window'

// ─── Legacy color key → hex migration map ────────────────────────────────────

const LEGACY_COLOR_MAP: Record<string, string> = {
  black: '#000000',
  dark_purple: '#1a0a2e',
  dark_blue: '#0a1628',
  dark_gray: '#151515'
}

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FocusDimState {
  enabled: boolean
  opacity: number
  dimColor: string
  showBorder: boolean
  fadeDuration: number
  peekDuration: number
  peeking: boolean
  hotkey: string
  autoRevealDesktop: boolean
  highlightMode: 'active' | 'app' | 'all'
  dragEscape: boolean
  excludedApps: Array<{ exe: string; name: string }>
}

export interface DisplayInfo {
  id: number
  label: string
  bounds: Electron.Rectangle
  disabled: boolean
}

interface OverlayEntry {
  window: BrowserWindow
  displayId: number
  bounds: Electron.Rectangle
  scaleFactor: number
  /** Physical pixel bounds (bounds * scaleFactor) for matching against Win32 coords */
  physicalBounds: { x: number; y: number; width: number; height: number }
}

// ─── Service class ───────────────────────────────────────────────────────────

class FocusDimService {
  private overlays: OverlayEntry[] = []
  private trackingInterval: ReturnType<typeof setInterval> | null = null
  private _enabled = false
  private _peeking = false
  private _desktopRevealed = false
  private _lastRect = { x: 0, y: 0, w: 0, h: 0 }
  private _lastRectsHash = ''
  private _desktopNullTicks = 0
  private _dragMoveTicks = 0
  private _dragStableTicks = 0
  private _dragging = false
  private _lastTrackWindowId = ''
  private _lastTrackX = 0
  private _lastTrackY = 0
  private peekTimer: ReturnType<typeof setTimeout> | null = null
  private displayChangeHandler: (() => void) | null = null
  private suspendHandler: (() => void) | null = null
  private resumeHandler: (() => void) | null = null

  /** Read current config from the persistent store, migrating legacy color keys */
  private getConf(): FocusDimConfig {
    const conf = getConfig(ToolId.FocusDim) as FocusDimConfig
    // One-time migration: legacy color key → hex
    if (conf.dim_color in LEGACY_COLOR_MAP) {
      conf.dim_color = LEGACY_COLOR_MAP[conf.dim_color]
      setConfig(ToolId.FocusDim, 'dim_color', conf.dim_color)
    }
    return conf
  }

  /** Persist a single config key */
  private setConf(key: string, value: unknown): void {
    setConfig(ToolId.FocusDim, key, value)
  }

  /** Broadcast state change to all renderer windows + sync tray */
  private broadcastState(): void {
    const state = this.getState()
    const overlayIds = new Set(this.overlays.map((o) => o.window.id))
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed() && !overlayIds.has(win.id)) {
        win.webContents.send(IPC_SEND.FOCUSDIM_STATE_CHANGED, state)
      }
    })
    // Lazy-import to avoid circular dep (tray imports from windows, which imports services)
    try {
      const { rebuildTray } = require('../tray')
      rebuildTray()
    } catch { /* tray not ready yet during init */ }
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Initialize the service. Called once during app startup.
   */
  init(): void {
    // Always start disabled — user must explicitly toggle on via hotkey or UI.
    this.setConf('enabled', false)
    console.log('[FocusDim] Service initialized')
  }

  /** Get the current state for the renderer */
  getState(): FocusDimState {
    const conf = this.getConf()
    return {
      enabled: this._enabled,
      opacity: conf.opacity,
      dimColor: conf.dim_color,
      showBorder: conf.show_border,
      fadeDuration: conf.fade_duration,
      peekDuration: conf.peek_duration,
      peeking: this._peeking,
      hotkey: conf.hotkey,
      autoRevealDesktop: conf.auto_reveal_desktop,
      highlightMode: conf.highlight_mode,
      dragEscape: conf.drag_escape,
      excludedApps: conf.excluded_apps ?? []
    }
  }

  /** Toggle dimming on/off */
  toggle(): FocusDimState {
    if (this._enabled) {
      this.disable()
    } else {
      this.enable()
    }
    return this.getState()
  }

  /** Enable the dim overlay */
  enable(): void {
    if (this._enabled && this.overlays.length > 0) {
      // Already enabled — just update styles
      this.updateAllOverlays()
      return
    }

    this._enabled = true
    this.setConf('enabled', true)
    clearPidExeCache()
    this.createOverlayWindows()
    this.listenForDisplayChanges()
    this.startTracking()
    this.broadcastState()
    console.log('[FocusDim] Enabled')
  }

  /** Disable the dim overlay */
  disable(): void {
    this.cancelPeek()
    this._enabled = false
    this._lastRect = { x: 0, y: 0, w: 0, h: 0 }
    this._lastRectsHash = ''
    this.setConf('enabled', false)
    clearPidExeCache()
    this.stopTracking()
    this.stopListeningForDisplayChanges()
    this.destroyAllOverlays()
    this.broadcastState()
    console.log('[FocusDim] Disabled')
  }

  /** Set the dim opacity (0-1) */
  setOpacity(opacity: number): void {
    const clamped = Math.max(0, Math.min(1, opacity))
    this.setConf('opacity', clamped)
    this.updateAllOverlays()
    this.broadcastState()
  }

  /** Set the dim color by hex value */
  setColor(hex: string): void {
    if (!HEX_RE.test(hex)) {
      console.warn(`[FocusDim] Invalid hex color: ${hex}`)
      return
    }
    this.setConf('dim_color', hex)
    this.updateAllOverlays()
    this.broadcastState()
  }

  /** Set fade duration in ms (0-5000) */
  setFadeDuration(ms: number): void {
    const clamped = Math.max(0, Math.min(5000, Math.round(ms)))
    this.setConf('fade_duration', clamped)
    // Rebuild overlays since fade is baked into CSS
    if (this._enabled) {
      this.destroyAllOverlays()
      this.createOverlayWindows()
    }
    this.broadcastState()
  }

  /** Temporarily hide dim overlays, then auto-restore */
  peek(): void {
    if (!this._enabled) return

    if (this._peeking) {
      // Already peeking — cancel and restore immediately
      this.cancelPeek()
      return
    }

    this._peeking = true
    // Hide all overlay divs (both 4-div and clip-path)
    for (const entry of this.overlays) {
      if (entry.window.isDestroyed()) continue
      entry.window.webContents.executeJavaScript(`
        (function() {
          var ids = ['dim-top','dim-left','dim-right','dim-bottom'];
          for (var i = 0; i < ids.length; i++) {
            var el = document.getElementById(ids[i]);
            if (el) el.style.opacity = '0';
          }
          var c = document.getElementById('dim-canvas');
          if (c) c.style.display = 'none';
          var border = document.getElementById('border-frame');
          if (border) border.style.display = 'none';
        })();
      `).catch(() => {})
    }
    this.broadcastState()

    const conf = this.getConf()
    this.peekTimer = setTimeout(() => {
      this.cancelPeek()
    }, conf.peek_duration * 1000)
  }

  /** Cancel active peek and restore overlays */
  private cancelPeek(): void {
    if (this.peekTimer) {
      clearTimeout(this.peekTimer)
      this.peekTimer = null
    }
    this._peeking = false
    this.updateAllOverlays()
    this.broadcastState()
  }

  /** Set peek duration in seconds (1-10) */
  setPeekDuration(seconds: number): void {
    const clamped = Math.max(1, Math.min(10, Math.round(seconds)))
    this.setConf('peek_duration', clamped)
    this.broadcastState()
  }

  /** Set auto-reveal on desktop focus */
  setAutoRevealDesktop(enabled: boolean): void {
    this.setConf('auto_reveal_desktop', enabled)
    this.broadcastState()
  }

  /**
   * Change the toggle hotkey. Returns true on success.
   * On failure, re-registers the old hotkey and returns false.
   */
  setHotkey(newAccelerator: string): boolean {
    const conf = this.getConf()
    const oldAccelerator = this.configToElectronAccelerator(conf.hotkey)
    const newElectronAccel = this.configToElectronAccelerator(newAccelerator)

    // Unregister old
    try { globalShortcut.unregister(oldAccelerator) } catch { /* may not be registered */ }

    // Try registering new
    const ok = globalShortcut.register(newElectronAccel, () => this.toggle())
    if (!ok) {
      // Re-register old
      globalShortcut.register(oldAccelerator, () => this.toggle())
      console.warn(`[FocusDim] Failed to register hotkey: ${newElectronAccel}`)
      return false
    }

    this.setConf('hotkey', newAccelerator)
    console.log(`[FocusDim] Hotkey changed: ${oldAccelerator} → ${newElectronAccel}`)
    this.broadcastState()
    return true
  }

  /** Convert config format (ctrl+shift+d) to Electron accelerator (CommandOrControl+Shift+D) */
  private configToElectronAccelerator(hotkey: string): string {
    return hotkey
      .split('+')
      .map((part) => {
        const lower = part.trim().toLowerCase()
        if (lower === 'ctrl' || lower === 'control') return 'CommandOrControl'
        if (lower === 'cmd' || lower === 'command') return 'CommandOrControl'
        // Capitalize first letter for Electron format
        return lower.charAt(0).toUpperCase() + lower.slice(1)
      })
      .join('+')
  }

  /** Get all displays with disabled state */
  getDisplays(): DisplayInfo[] {
    const conf = this.getConf()
    const disabledSet = new Set(conf.disabled_displays)
    return screen.getAllDisplays().map((d, i) => ({
      id: d.id,
      label: `Display ${i + 1} (${d.bounds.width}x${d.bounds.height})`,
      bounds: d.bounds,
      disabled: disabledSet.has(d.id)
    }))
  }

  /** Set which displays are disabled, then rebuild overlays */
  setDisabledDisplays(ids: number[]): void {
    this.setConf('disabled_displays', ids)
    if (this._enabled) {
      this.destroyAllOverlays()
      this.createOverlayWindows()
    }
    this.broadcastState()
  }

  /** Set highlight mode: 'active', 'app', or 'all' */
  setHighlightMode(mode: 'active' | 'app' | 'all'): void {
    this.setConf('highlight_mode', mode)
    this._lastRect = { x: 0, y: 0, w: 0, h: 0 }
    this._lastRectsHash = ''
    this.broadcastState()
  }

  /** Toggle or set the border highlight */
  setBorder(show: boolean): void {
    this.setConf('show_border', show)
    this.updateAllOverlays()
    this.broadcastState()
  }

  /** Get all running apps (unique exe names with window titles), excluding PeakFlow and already-excluded apps. */
  getRunningApps(): Array<{ exe: string; name: string }> {
    const conf = this.getConf()
    const excludedSet = new Set((conf.excluded_apps ?? []).map((a) => a.exe))
    return getVisibleAppList(excludedSet)
  }

  /** Add an app to the exclusion whitelist by exe name and display name. */
  addExcludedAppByExe(exe: string, name: string): { exe: string; name: string } | null {
    const conf = this.getConf()
    const existing = conf.excluded_apps ?? []
    if (existing.some((a) => a.exe === exe)) return null

    const entry = { exe, name: name || exe }
    this.setConf('excluded_apps', [...existing, entry])
    this._lastRect = { x: 0, y: 0, w: 0, h: 0 }
    this._lastRectsHash = ''
    this.broadcastState()
    return entry
  }

  /** Remove an app from the exclusion whitelist by exe name. */
  removeExcludedApp(exe: string): void {
    const conf = this.getConf()
    const existing = conf.excluded_apps ?? []
    const updated = existing.filter((a) => a.exe !== exe)
    this.setConf('excluded_apps', updated)
    this._lastRect = { x: 0, y: 0, w: 0, h: 0 }
    this._lastRectsHash = ''
    this.broadcastState()
  }

  /** Clean up when app is quitting */
  destroy(): void {
    this.cancelPeek()
    this.stopTracking()
    this.stopListeningForDisplayChanges()
    this.destroyAllOverlays()
    console.log('[FocusDim] Service destroyed')
  }

  // ─── Display Change Handling ────────────────────────────────────────────

  private listenForDisplayChanges(): void {
    if (this.displayChangeHandler) return

    this.displayChangeHandler = (): void => {
      if (!this._enabled) return
      console.log('[FocusDim] Display configuration changed — rebuilding overlays')
      this.destroyAllOverlays()
      this.createOverlayWindows()
    }

    this.suspendHandler = (): void => {
      if (!this._enabled) return
      console.log('[FocusDim] System suspend — destroying overlays')
      this.destroyAllOverlays()
    }

    this.resumeHandler = (): void => {
      if (!this._enabled) return
      console.log('[FocusDim] System resume — rebuilding overlays')
      this.createOverlayWindows()
    }

    screen.on('display-added', this.displayChangeHandler)
    screen.on('display-removed', this.displayChangeHandler)
    screen.on('display-metrics-changed', this.displayChangeHandler)
    powerMonitor.on('suspend', this.suspendHandler)
    powerMonitor.on('resume', this.resumeHandler)
  }

  private stopListeningForDisplayChanges(): void {
    if (!this.displayChangeHandler) return
    screen.removeListener('display-added', this.displayChangeHandler)
    screen.removeListener('display-removed', this.displayChangeHandler)
    screen.removeListener('display-metrics-changed', this.displayChangeHandler)

    if (this.suspendHandler) powerMonitor.removeListener('suspend', this.suspendHandler)
    if (this.resumeHandler) powerMonitor.removeListener('resume', this.resumeHandler)

    this.displayChangeHandler = null
    this.suspendHandler = null
    this.resumeHandler = null
  }

  // ─── Overlay Window Management ───────────────────────────────────────────

  private createOverlayWindows(): void {
    this.destroyAllOverlays()

    const allDisplays = screen.getAllDisplays()
    const conf = this.getConf()
    const hex = conf.dim_color
    const disabledSet = new Set(conf.disabled_displays)
    const displays = allDisplays.filter((d) => !disabledSet.has(d.id))

    for (const display of displays) {
      const { x, y, width, height } = display.bounds
      const overlayHtml = this.buildOverlayHtml(hex, conf.opacity, conf.show_border, conf.fade_duration)

      const win = new BrowserWindow({
        x,
        y,
        width,
        height,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        focusable: false,
        hasShadow: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        closable: false,
        show: false,
        enableLargerThanScreen: true,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false
        }
      })

      win.setIgnoreMouseEvents(true)
      // Use 'screen-saver' level to ensure overlay renders above ALL other windows
      win.setAlwaysOnTop(true, 'screen-saver')
      win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(overlayHtml)}`)

      const sf = display.scaleFactor || 1
      // DPI origin: screen.dipToScreenPoint handles multi-monitor offsets correctly.
      // Simple `x * sf` only works for the primary monitor at (0,0).
      const physOrigin = screen.dipToScreenPoint({ x, y })
      const entry: OverlayEntry = {
        window: win,
        displayId: display.id,
        bounds: { x, y, width, height },
        scaleFactor: sf,
        physicalBounds: {
          x: physOrigin.x,
          y: physOrigin.y,
          width: width * sf,
          height: height * sf
        }
      }

      win.once('ready-to-show', () => {
        if (!win.isDestroyed()) {
          win.showInactive()
          // Correct size mismatch on portrait/scaled monitors where Electron
          // may clamp the window dimensions below the requested DIP size.
          // Must run AFTER showInactive — Windows ignores setBounds on hidden windows.
          const actual = win.getBounds()
          if (actual.width !== width || actual.height !== height) {
            console.warn(`[FocusDim] Overlay size mismatch on display ${display.id}: requested ${width}x${height}, got ${actual.width}x${actual.height} — correcting`)
            win.setBounds({ x, y, width, height })
          }
        }
      })

      win.on('closed', () => {
        this.overlays = this.overlays.filter((o) => o.window !== win)
      })

      this.overlays.push(entry)
    }

    console.log(`[FocusDim] Created ${displays.length} overlay(s) for ${displays.length} display(s)`)
  }

  private destroyAllOverlays(): void {
    for (const entry of this.overlays) {
      if (!entry.window.isDestroyed()) {
        entry.window.destroy()
      }
    }
    this.overlays = []
  }

  /**
   * Build the overlay HTML string. The overlay is a fullscreen div
   * with a CSS clip-path that creates a rectangular hole for the active window.
   */
  private buildOverlayHtml(
    color: string,
    opacity: number,
    showBorder: boolean,
    fadeDuration: number
  ): string {
    // Use 4 separate divs (top/left/right/bottom) instead of clip-path polygon.
    // This avoids sub-pixel rounding, evenodd quirks, and percentage math errors.
    const dimStyle = `position:fixed; background:${color}; opacity:${opacity}; pointer-events:none; z-index:1; transition:opacity ${fadeDuration}ms ease;`
    return `<!DOCTYPE html>
<html><head><title>__peakflow_dim__</title><style>
  * { margin: 0; padding: 0; }
  html, body { width: 100vw; height: 100vh; overflow: hidden; background: transparent; }
</style></head><body>
<div id="dim-top" style="${dimStyle} left:0; top:0; right:0; height:100%;"></div>
<div id="dim-left" style="${dimStyle} left:0; top:0; width:0; height:100%;"></div>
<div id="dim-right" style="${dimStyle} right:0; top:0; width:0; height:100%;"></div>
<div id="dim-bottom" style="${dimStyle} left:0; bottom:0; right:0; height:0;"></div>
<canvas id="dim-canvas" style="position:fixed; inset:0; pointer-events:none; z-index:1; display:none;" width="1" height="1"></canvas>
<div id="border-frame" style="position:fixed; border:3px solid rgba(168,85,247,0.9); border-radius:4px; pointer-events:none; z-index:2; transition:all 0.05s linear; display:${showBorder ? 'block' : 'none'}; box-shadow:0 0 12px rgba(168,85,247,0.3);"></div>
</body></html>`
  }

  /**
   * Determine which display contains the center of the given rect.
   * `rect` is in physical pixel coords (from Win32 API).
   * Falls back to the display with the most overlap.
   */
  private findOverlayForRect(rect: { x: number; y: number; w: number; h: number }): OverlayEntry | null {
    const cx = rect.x + rect.w / 2
    const cy = rect.y + rect.h / 2

    // Use physical bounds for matching since Win32 returns physical pixels
    for (const entry of this.overlays) {
      const b = entry.physicalBounds
      if (cx >= b.x && cx < b.x + b.width && cy >= b.y && cy < b.y + b.height) {
        return entry
      }
    }

    // Fallback: find overlay with most overlap area (physical coords)
    let bestEntry: OverlayEntry | null = null
    let bestOverlap = 0
    for (const entry of this.overlays) {
      const b = entry.physicalBounds
      const overlapX = Math.max(0, Math.min(rect.x + rect.w, b.x + b.width) - Math.max(rect.x, b.x))
      const overlapY = Math.max(0, Math.min(rect.y + rect.h, b.y + b.height) - Math.max(rect.y, b.y))
      const overlap = overlapX * overlapY
      if (overlap > bestOverlap) {
        bestOverlap = overlap
        bestEntry = entry
      }
    }
    return bestEntry
  }

  /**
   * Send updated clip-path to the overlay that contains the active window.
   * All other overlays get a full dim (no cutout).
   */
  private sendOverlayUpdate(rect: { x: number; y: number; w: number; h: number }): void {
    if (this.overlays.length === 0 || this._peeking) return

    const conf = this.getConf()
    const hex = conf.dim_color
    const activeOverlay = this.findOverlayForRect(rect)

    for (const entry of this.overlays) {
      if (entry.window.isDestroyed()) continue

      if (entry === activeOverlay) {
        // This monitor has the active window — carve a cutout
        // Convert physical pixel coords (Win32) → logical coords (Electron/CSS)
        const sf = entry.scaleFactor
        const pb = entry.physicalBounds
        const lb = entry.bounds

        // Physical-pixel relative position on this display
        const physRelX = rect.x - pb.x
        const physRelY = rect.y - pb.y

        // Convert to logical pixels for CSS positioning
        const logRelX = physRelX / sf
        const logRelY = physRelY / sf
        const logW = rect.w / sf
        const logH = rect.h / sf

        // 4-div approach: top covers above window, left/right cover sides,
        // bottom covers below window. Pixel-perfect, no percentage rounding.
        const screenW = lb.width
        const screenH = lb.height
        const topH = Math.max(0, logRelY)
        const botTop = Math.min(screenH, logRelY + logH)
        const botH = Math.max(0, screenH - botTop)
        const leftW = Math.max(0, logRelX)
        const rightLeft = Math.min(screenW, logRelX + logW)
        const rightW = Math.max(0, screenW - rightLeft)
        const midH = botTop - topH

        entry.window.webContents.executeJavaScript(`
          (function() {
            var t = document.getElementById('dim-top');
            var l = document.getElementById('dim-left');
            var r = document.getElementById('dim-right');
            var b = document.getElementById('dim-bottom');
            var border = document.getElementById('border-frame');
            var bg = ${JSON.stringify(hex)};
            var op = ${conf.opacity};
            if (t) { t.style.left='0'; t.style.top='0'; t.style.right='0'; t.style.height='${topH}px'; t.style.width=''; t.style.background=bg; t.style.opacity=op; }
            if (l) { l.style.left='0'; l.style.top='${topH}px'; l.style.width='${leftW}px'; l.style.height='${midH}px'; l.style.right=''; l.style.bottom=''; l.style.background=bg; l.style.opacity=op; }
            if (r) { r.style.left='${rightLeft}px'; r.style.top='${topH}px'; r.style.width='${rightW}px'; r.style.height='${midH}px'; r.style.right=''; r.style.bottom=''; r.style.background=bg; r.style.opacity=op; }
            if (b) { b.style.left='0'; b.style.top='${botTop}px'; b.style.right='0'; b.style.height='${botH}px'; b.style.width=''; b.style.background=bg; b.style.opacity=op; }
            if (border) {
              border.style.left = '${logRelX}px';
              border.style.top = '${logRelY}px';
              border.style.width = '${logW}px';
              border.style.height = '${logH}px';
              border.style.display = ${conf.show_border ? "'block'" : "'none'"};
            }
          })();
        `).catch(() => { /* overlay may be closing */ })
      } else {
        // This monitor does NOT have the active window — full dim, no cutout
        entry.window.webContents.executeJavaScript(`
          (function() {
            var t = document.getElementById('dim-top');
            var l = document.getElementById('dim-left');
            var r = document.getElementById('dim-right');
            var b = document.getElementById('dim-bottom');
            var border = document.getElementById('border-frame');
            var bg = ${JSON.stringify(hex)};
            var op = ${conf.opacity};
            if (t) { t.style.height='100%'; t.style.background=bg; t.style.opacity=op; }
            if (l) { l.style.width='0'; }
            if (r) { r.style.width='0'; }
            if (b) { b.style.height='0'; }
            if (border) { border.style.display = 'none'; }
          })();
        `).catch(() => { /* overlay may be closing */ })
      }
    }
  }

  /**
   * Send canvas-based overlay update for multiple window cutouts.
   * Fills canvas with dim color, then uses clearRect to punch transparent holes.
   * Avoids clip-path polygon which causes diagonal line artifacts on transparent Electron windows.
   */
  private sendMultiRectOverlayUpdate(rects: WindowRect[], activeRect?: WindowRect): void {
    if (this.overlays.length === 0 || this._peeking) return

    const conf = this.getConf()
    const hex = conf.dim_color

    for (const entry of this.overlays) {
      if (entry.window.isDestroyed()) continue

      const sf = entry.scaleFactor
      const pb = entry.physicalBounds
      const lb = entry.bounds

      // Find which rects overlap this display, clip and convert to logical pixels
      const localRects: Array<{ x: number; y: number; w: number; h: number }> = []
      for (const rect of rects) {
        const overlapX = Math.max(0, Math.min(rect.x + rect.w, pb.x + pb.width) - Math.max(rect.x, pb.x))
        const overlapY = Math.max(0, Math.min(rect.y + rect.h, pb.y + pb.height) - Math.max(rect.y, pb.y))
        if (overlapX <= 0 || overlapY <= 0) continue

        const clippedLeft = Math.max(rect.x, pb.x)
        const clippedTop = Math.max(rect.y, pb.y)
        const clippedRight = Math.min(rect.x + rect.w, pb.x + pb.width)
        const clippedBottom = Math.min(rect.y + rect.h, pb.y + pb.height)

        const logX = (clippedLeft - pb.x) / sf
        const logY = (clippedTop - pb.y) / sf
        const logW = (clippedRight - clippedLeft) / sf
        const logH = (clippedBottom - clippedTop) / sf

        if (logW > 0 && logH > 0) {
          localRects.push({ x: logX, y: logY, w: logW, h: logH })
        }
      }

      const sw = lb.width
      const sh = lb.height

      if (localRects.length === 0) {
        // No windows on this display: full dim via canvas
        entry.window.webContents.executeJavaScript(`
          (function() {
            var c = document.getElementById('dim-canvas');
            if (!c) return;
            c.width = ${sw}; c.height = ${sh};
            c.style.display = 'block';
            var ctx = c.getContext('2d');
            ctx.globalAlpha = ${conf.opacity};
            ctx.fillStyle = ${JSON.stringify(hex)};
            ctx.fillRect(0, 0, ${sw}, ${sh});
            var b = document.getElementById('border-frame');
            if (b) b.style.display = 'none';
          })();
        `).catch(() => {})
        continue
      }

      // Build the rects array as inline JSON for the executeJavaScript call
      const rectsJson = JSON.stringify(localRects)

      // Border tracks the active window, not just the first rect
      let borderJs = `var b = document.getElementById('border-frame'); if (b) b.style.display = 'none';`
      if (conf.show_border && activeRect) {
        // Convert active window physical coords to logical coords on this display
        const aOverlapX = Math.max(0, Math.min(activeRect.x + activeRect.w, pb.x + pb.width) - Math.max(activeRect.x, pb.x))
        const aOverlapY = Math.max(0, Math.min(activeRect.y + activeRect.h, pb.y + pb.height) - Math.max(activeRect.y, pb.y))
        if (aOverlapX > 0 && aOverlapY > 0) {
          const bx = (Math.max(activeRect.x, pb.x) - pb.x) / sf
          const by = (Math.max(activeRect.y, pb.y) - pb.y) / sf
          const bw = (Math.min(activeRect.x + activeRect.w, pb.x + pb.width) - Math.max(activeRect.x, pb.x)) / sf
          const bh = (Math.min(activeRect.y + activeRect.h, pb.y + pb.height) - Math.max(activeRect.y, pb.y)) / sf
          borderJs = `var b = document.getElementById('border-frame'); if (b) { b.style.display = 'block'; b.style.left = '${bx}px'; b.style.top = '${by}px'; b.style.width = '${bw}px'; b.style.height = '${bh}px'; }`
        }
      }

      entry.window.webContents.executeJavaScript(`
        (function() {
          var c = document.getElementById('dim-canvas');
          if (!c) return;
          c.width = ${sw}; c.height = ${sh};
          c.style.display = 'block';
          var ctx = c.getContext('2d');
          ctx.globalAlpha = ${conf.opacity};
          ctx.fillStyle = ${JSON.stringify(hex)};
          ctx.fillRect(0, 0, ${sw}, ${sh});
          var rects = ${rectsJson};
          for (var i = 0; i < rects.length; i++) {
            var r = rects[i];
            ctx.clearRect(r.x, r.y, r.w, r.h);
          }
          ${borderJs}
        })();
      `).catch(() => {})
    }
  }

  /** Hide the canvas (when switching to 4-div mode) */
  private hideCanvas(): void {
    for (const entry of this.overlays) {
      if (entry.window.isDestroyed()) continue
      entry.window.webContents.executeJavaScript(`
        (function() {
          var c = document.getElementById('dim-canvas');
          if (c) c.style.display = 'none';
        })();
      `).catch(() => {})
    }
  }

  /** Hide the 4 div elements (when switching to clip-path mode) */
  private hideFourDivs(): void {
    for (const entry of this.overlays) {
      if (entry.window.isDestroyed()) continue
      entry.window.webContents.executeJavaScript(`
        (function() {
          var ids = ['dim-top','dim-left','dim-right','dim-bottom'];
          for (var i = 0; i < ids.length; i++) {
            var el = document.getElementById(ids[i]);
            if (el) el.style.opacity = '0';
          }
        })();
      `).catch(() => {})
    }
  }

  /** Push style-only updates to all overlays (no position change) */
  private updateAllOverlays(): void {
    const conf = this.getConf()
    const hex = conf.dim_color

    // Reset dirty check so canvas mode redraws on next tick with new settings
    this._lastRect = { x: 0, y: 0, w: 0, h: 0 }
    this._lastRectsHash = ''

    for (const entry of this.overlays) {
      if (entry.window.isDestroyed()) continue
      entry.window.webContents.executeJavaScript(`
        (function() {
          var ids = ['dim-top','dim-left','dim-right','dim-bottom'];
          for (var i = 0; i < ids.length; i++) {
            var el = document.getElementById(ids[i]);
            if (el) {
              el.style.background = ${JSON.stringify(hex)};
              el.style.opacity = ${conf.opacity};
            }
          }
          var border = document.getElementById('border-frame');
          if (border) {
            border.style.display = ${conf.show_border ? "'block'" : "'none'"};
          }
        })();
      `).catch(() => { /* overlay may be closing */ })
    }
  }

  // ─── Active Window Tracking ──────────────────────────────────────────────

  /**
   * Start polling for the active window position.
   * Uses native Win32 GetForegroundWindow via koffi FFI.
   */
  private startTracking(): void {
    if (this.trackingInterval) return

    // Update immediately then poll
    this.trackActiveWindow()
    this.trackingInterval = setInterval(() => this.trackActiveWindow(), 16)
  }

  private stopTracking(): void {
    if (this.trackingInterval) {
      clearInterval(this.trackingInterval)
      this.trackingInterval = null
    }
  }

  /** Fade all overlays to opacity 0 (drag started) */
  private fadeOutForDrag(): void {
    const conf = this.getConf()
    const fadeMs = Math.min(conf.fade_duration, 150)
    for (const entry of this.overlays) {
      if (entry.window.isDestroyed()) continue
      entry.window.webContents.executeJavaScript(`
        (function() {
          var ids = ['dim-top','dim-left','dim-right','dim-bottom'];
          for (var i = 0; i < ids.length; i++) {
            var el = document.getElementById(ids[i]);
            if (el) { el.style.transition = 'opacity ${fadeMs}ms ease'; el.style.opacity = '0'; }
          }
          var c = document.getElementById('dim-canvas');
          if (c) { c.style.transition = 'opacity ${fadeMs}ms ease'; c.style.opacity = '0'; }
          var border = document.getElementById('border-frame');
          if (border) { border.style.transition = 'opacity ${fadeMs}ms ease'; border.style.opacity = '0'; }
        })();
      `).catch(() => {})
    }
  }

  /** Fade all overlays back to configured opacity (drag ended) */
  private fadeInAfterDrag(): void {
    const conf = this.getConf()
    const fadeMs = conf.fade_duration
    for (const entry of this.overlays) {
      if (entry.window.isDestroyed()) continue
      entry.window.webContents.executeJavaScript(`
        (function() {
          var ids = ['dim-top','dim-left','dim-right','dim-bottom'];
          for (var i = 0; i < ids.length; i++) {
            var el = document.getElementById(ids[i]);
            if (el) { el.style.transition = 'opacity ${fadeMs}ms ease'; el.style.opacity = '${conf.opacity}'; }
          }
          var c = document.getElementById('dim-canvas');
          if (c) { c.style.transition = 'opacity ${fadeMs}ms ease'; c.style.opacity = '1'; }
          var border = document.getElementById('border-frame');
          if (border) { border.style.transition = 'opacity ${fadeMs}ms ease'; border.style.opacity = '1'; }
        })();
      `).catch(() => {})
    }
  }

  /**
   * Get the active window rect using native Win32 API.
   * Branches on highlight_mode:
   *   'active' — single window, 4-div approach
   *   'app'    — all windows from active app's process, clip-path
   *   'all'    — all visible windows, clip-path
   */
  private trackActiveWindow(): void {
    if (!this._enabled || this.overlays.length === 0) return

    const conf = this.getConf()
    const activeWin = getActiveWindow()

    if (activeWin) {
      this._desktopNullTicks = 0

      // ── Drag detection ──────────────────────────────────────────────
      if (conf.drag_escape) {
        const windowId = `${activeWin.pid}:${activeWin.title}`
        const sameWindow = windowId === this._lastTrackWindowId
        const posChanged = activeWin.x !== this._lastTrackX || activeWin.y !== this._lastTrackY

        if (sameWindow && posChanged) {
          this._dragMoveTicks++
          this._dragStableTicks = 0
          if (this._dragMoveTicks >= 3 && !this._dragging) {
            this._dragging = true
            this.fadeOutForDrag()
          }
        } else if (this._dragging) {
          this._dragStableTicks++
          if (this._dragStableTicks >= 60) {
            this._dragging = false
            this._dragMoveTicks = 0
            this._dragStableTicks = 0
            this.fadeInAfterDrag()
            this._lastRect = { x: 0, y: 0, w: 0, h: 0 }
            this._lastRectsHash = ''
          }
        } else {
          this._dragMoveTicks = 0
        }

        this._lastTrackWindowId = windowId
        this._lastTrackX = activeWin.x
        this._lastTrackY = activeWin.y

        if (this._dragging) return
      }

      const wasDesktopRevealed = this._desktopRevealed
      this._desktopRevealed = false

      // Force redraw after returning from desktop reveal (canvas was hidden)
      if (wasDesktopRevealed) {
        this._lastRectsHash = ''
        this._lastRect = { x: 0, y: 0, w: 0, h: 0 }
      }

      // Collect excluded app rects if any are configured
      const excludedApps = conf.excluded_apps ?? []
      const hasExclusions = excludedApps.length > 0
      let excludedRects: WindowRect[] = []
      let dispBounds: DisplayBounds[] | undefined
      if (hasExclusions) {
        dispBounds = this.overlays.map(o => ({
          x: o.physicalBounds.x, y: o.physicalBounds.y,
          w: o.physicalBounds.width, h: o.physicalBounds.height
        }))
        const exeNames = excludedApps.map(a => a.exe)
        excludedRects = getWindowsForExeNames(exeNames, dispBounds)
      }

      if (conf.highlight_mode === 'active') {
        const rect = { x: activeWin.x, y: activeWin.y, w: activeWin.w, h: activeWin.h }

        if (hasExclusions && excludedRects.length > 0) {
          // Active + excluded rects: use canvas multi-rect
          const allRects = [rect, ...excludedRects]
          const activeKey = `A:${rect.x},${rect.y},${rect.w},${rect.h}`
          const hash = activeKey + '|' + allRects.map(r => `${r.x},${r.y},${r.w},${r.h}`).sort().join('|')
          if (hash === this._lastRectsHash) return
          this._lastRectsHash = hash
          this.hideFourDivs()
          this.sendMultiRectOverlayUpdate(allRects, rect)
          return
        }

        // No exclusions: simple 4-div approach
        const lr = this._lastRect
        if (rect.x === lr.x && rect.y === lr.y && rect.w === lr.w && rect.h === lr.h) return
        this._lastRect = rect
        this.hideCanvas()
        this.sendOverlayUpdate(rect)
        return
      }

      // Multi-rect modes: enumerate windows
      if (!dispBounds) {
        dispBounds = this.overlays.map(o => ({
          x: o.physicalBounds.x, y: o.physicalBounds.y,
          w: o.physicalBounds.width, h: o.physicalBounds.height
        }))
      }
      let rects: WindowRect[]
      if (conf.highlight_mode === 'app') {
        rects = getAllVisibleWindows(activeWin.pid, dispBounds)
      } else {
        rects = getAllVisibleWindows(undefined, dispBounds)
      }

      // Merge excluded app rects (dedup by matching exact coords)
      if (hasExclusions && excludedRects.length > 0) {
        const existingKeys = new Set(rects.map(r => `${r.x},${r.y},${r.w},${r.h}`))
        for (const er of excludedRects) {
          const key = `${er.x},${er.y},${er.w},${er.h}`
          if (!existingKeys.has(key)) {
            rects.push(er)
            existingKeys.add(key)
          }
        }
      }

      if (rects.length === 0) {
        // Fallback to single active window
        this.hideCanvas()
        this.sendOverlayUpdate({ x: activeWin.x, y: activeWin.y, w: activeWin.w, h: activeWin.h })
        return
      }

      // Dirty check: hash rects + active window (so border follows focus changes)
      const activeKey = `A:${activeWin.x},${activeWin.y},${activeWin.w},${activeWin.h}`
      const hash = activeKey + '|' + rects.map(r => `${r.x},${r.y},${r.w},${r.h}`).sort().join('|')
      if (hash === this._lastRectsHash) return
      this._lastRectsHash = hash

      this.hideFourDivs()
      this.sendMultiRectOverlayUpdate(rects, { x: activeWin.x, y: activeWin.y, w: activeWin.w, h: activeWin.h })
      return
    }

    // Desktop focused — debounce to avoid flicker when closing a single window
    // (Windows briefly focuses desktop before Z-ordering to next window).
    // At 16ms polling, 6 ticks ≈ 100ms — enough to ride out transient focus changes.
    this._desktopNullTicks++
    if (this._desktopNullTicks < 6) return

    if (conf.auto_reveal_desktop) {
      if (!this._desktopRevealed) {
        this._desktopRevealed = true
        for (const entry of this.overlays) {
          if (entry.window.isDestroyed()) continue
          entry.window.webContents.executeJavaScript(`
            (function() {
              var ids = ['dim-top','dim-left','dim-right','dim-bottom'];
              for (var i = 0; i < ids.length; i++) {
                var el = document.getElementById(ids[i]);
                if (el) el.style.opacity = '0';
              }
              var c = document.getElementById('dim-canvas');
              if (c) c.style.display = 'none';
              var border = document.getElementById('border-frame');
              if (border) border.style.display = 'none';
            })();
          `).catch(() => {})
        }
      }
      return
    }

    this.sendOverlayUpdate({ x: -10000, y: -10000, w: 1, h: 1 })
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let instance: FocusDimService | null = null

export function getFocusDimService(): FocusDimService {
  if (!instance) {
    instance = new FocusDimService()
  }
  return instance
}

export function initFocusDim(): void {
  getFocusDimService().init()
}

export function destroyFocusDim(): void {
  if (instance) {
    instance.destroy()
    instance = null
  }
}
