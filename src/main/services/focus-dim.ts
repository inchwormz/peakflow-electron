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

import { BrowserWindow, screen } from 'electron'
import { ToolId } from '@shared/tool-ids'
import { IPC_SEND } from '@shared/ipc-types'
import { getConfig, setConfig } from './config-store'
import type { FocusDimConfig } from '@shared/config-schemas'
import { getActiveWindow } from '../native/active-window'

// ─── Dim color presets (must match Python + renderer) ────────────────────────

const DIM_COLORS: Record<string, string> = {
  black: '#000000',
  dark_purple: '#1a0a2e',
  dark_blue: '#0a1628',
  dark_gray: '#151515'
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FocusDimState {
  enabled: boolean
  opacity: number
  dimColor: string
  showBorder: boolean
  fadeDuration: number
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
  private displayChangeHandler: (() => void) | null = null

  /** Read current config from the persistent store */
  private getConf(): FocusDimConfig {
    return getConfig(ToolId.FocusDim) as FocusDimConfig
  }

  /** Persist a single config key */
  private setConf(key: string, value: unknown): void {
    setConfig(ToolId.FocusDim, key, value)
  }

  /** Broadcast state change to all renderer windows */
  private broadcastState(): void {
    const state = this.getState()
    const overlayIds = new Set(this.overlays.map((o) => o.window.id))
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed() && !overlayIds.has(win.id)) {
        win.webContents.send(IPC_SEND.FOCUSDIM_STATE_CHANGED, state)
      }
    })
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
      fadeDuration: conf.fade_duration
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
    this.createOverlayWindows()
    this.listenForDisplayChanges()
    this.startTracking()
    this.broadcastState()
    console.log('[FocusDim] Enabled')
  }

  /** Disable the dim overlay */
  disable(): void {
    this._enabled = false
    this.setConf('enabled', false)
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

  /** Set the dim color by key name */
  setColor(colorKey: string): void {
    if (!(colorKey in DIM_COLORS)) {
      console.warn(`[FocusDim] Unknown color key: ${colorKey}`)
      return
    }
    this.setConf('dim_color', colorKey)
    this.updateAllOverlays()
    this.broadcastState()
  }

  /** Toggle or set the border highlight */
  setBorder(show: boolean): void {
    this.setConf('show_border', show)
    this.updateAllOverlays()
    this.broadcastState()
  }

  /** Set fade duration in ms */
  setFadeDuration(ms: number): void {
    this.setConf('fade_duration', Math.max(0, Math.min(2000, ms)))
    this.updateAllOverlays()
    this.broadcastState()
  }

  /** Clean up when app is quitting */
  destroy(): void {
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
    screen.on('display-added', this.displayChangeHandler)
    screen.on('display-removed', this.displayChangeHandler)
    screen.on('display-metrics-changed', this.displayChangeHandler)
  }

  private stopListeningForDisplayChanges(): void {
    if (!this.displayChangeHandler) return
    screen.removeListener('display-added', this.displayChangeHandler)
    screen.removeListener('display-removed', this.displayChangeHandler)
    screen.removeListener('display-metrics-changed', this.displayChangeHandler)
    this.displayChangeHandler = null
  }

  // ─── Overlay Window Management ───────────────────────────────────────────

  private createOverlayWindows(): void {
    this.destroyAllOverlays()

    const displays = screen.getAllDisplays()
    const conf = this.getConf()
    const hex = DIM_COLORS[conf.dim_color] || '#000000'

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
      const entry: OverlayEntry = {
        window: win,
        displayId: display.id,
        bounds: { x, y, width, height },
        scaleFactor: sf,
        physicalBounds: {
          x: x * sf,
          y: y * sf,
          width: width * sf,
          height: height * sf
        }
      }

      win.once('ready-to-show', () => {
        if (!win.isDestroyed()) {
          win.showInactive()
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
    return `<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; }
  html, body { width: 100vw; height: 100vh; overflow: hidden; background: transparent; }
  #dim-overlay {
    position: fixed; inset: 0;
    background: ${color};
    opacity: ${opacity};
    transition: opacity ${fadeDuration}ms ease, clip-path 0.05s linear;
    clip-path: polygon(
      0% 0%, 0% 100%, 100% 100%, 100% 0%,
      0% 0%
    );
    pointer-events: none;
    z-index: 1;
  }
  #border-frame {
    position: fixed;
    border: 3px solid rgba(168, 85, 247, 0.9);
    border-radius: 4px;
    pointer-events: none;
    z-index: 2;
    transition: all 0.05s linear;
    display: ${showBorder ? 'block' : 'none'};
    box-shadow: 0 0 12px rgba(168, 85, 247, 0.3);
  }
</style></head><body>
<div id="dim-overlay"></div>
<div id="border-frame"></div>
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
    if (this.overlays.length === 0) return

    const conf = this.getConf()
    const hex = DIM_COLORS[conf.dim_color] || '#000000'
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

        // Convert to logical pixels for CSS
        const logRelX = physRelX / sf
        const logRelY = physRelY / sf
        const logW = rect.w / sf
        const logH = rect.h / sf

        const l = (logRelX / lb.width) * 100
        const t = (logRelY / lb.height) * 100
        const r = ((logRelX + logW) / lb.width) * 100
        const bPct = ((logRelY + logH) / lb.height) * 100

        const clipPath = `polygon(
          0% 0%, 0% 100%, ${l}% 100%, ${l}% ${t}%,
          ${r}% ${t}%, ${r}% ${bPct}%, ${l}% ${bPct}%,
          ${l}% 100%, 100% 100%, 100% 0%
        )`

        entry.window.webContents.executeJavaScript(`
          (function() {
            var overlay = document.getElementById('dim-overlay');
            var border = document.getElementById('border-frame');
            if (overlay) {
              overlay.style.clipPath = ${JSON.stringify(clipPath)};
              overlay.style.background = ${JSON.stringify(hex)};
              overlay.style.opacity = ${conf.opacity};
            }
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
        const fullDim = `polygon(0% 0%, 0% 100%, 100% 100%, 100% 0%)`
        entry.window.webContents.executeJavaScript(`
          (function() {
            var overlay = document.getElementById('dim-overlay');
            var border = document.getElementById('border-frame');
            if (overlay) {
              overlay.style.clipPath = ${JSON.stringify(fullDim)};
              overlay.style.background = ${JSON.stringify(hex)};
              overlay.style.opacity = ${conf.opacity};
            }
            if (border) {
              border.style.display = 'none';
            }
          })();
        `).catch(() => { /* overlay may be closing */ })
      }
    }
  }

  /** Push style-only updates to all overlays (no position change) */
  private updateAllOverlays(): void {
    const conf = this.getConf()
    const hex = DIM_COLORS[conf.dim_color] || '#000000'

    for (const entry of this.overlays) {
      if (entry.window.isDestroyed()) continue
      entry.window.webContents.executeJavaScript(`
        (function() {
          var overlay = document.getElementById('dim-overlay');
          var border = document.getElementById('border-frame');
          if (overlay) {
            overlay.style.background = ${JSON.stringify(hex)};
            overlay.style.opacity = ${conf.opacity};
            overlay.style.transition = 'opacity ${conf.fade_duration}ms ease, clip-path 0.05s linear';
          }
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
    this.trackingInterval = setInterval(() => this.trackActiveWindow(), 50)
  }

  private stopTracking(): void {
    if (this.trackingInterval) {
      clearInterval(this.trackingInterval)
      this.trackingInterval = null
    }
  }

  /**
   * Get the active window rect using native Win32 API.
   * Calls GetForegroundWindow() + DwmGetWindowAttribute() for accurate bounds.
   */
  private trackActiveWindow(): void {
    if (!this._enabled || this.overlays.length === 0) return

    const activeWin = getActiveWindow()

    if (activeWin) {
      this.sendOverlayUpdate({
        x: activeWin.x,
        y: activeWin.y,
        w: activeWin.w,
        h: activeWin.h
      })
      return
    }

    // No valid foreground window (e.g., desktop is focused) — dim everything
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
