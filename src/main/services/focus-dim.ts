/**
 * FocusDim Service — dims everything except the active window.
 *
 * Creates a single fullscreen transparent overlay BrowserWindow and uses
 * CSS clip-path to carve out a rectangular "hole" where the active window
 * sits. This avoids the complexity of managing 4 separate overlay windows.
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

// ─── Service class ───────────────────────────────────────────────────────────

class FocusDimService {
  private overlayWindow: BrowserWindow | null = null
  private trackingInterval: ReturnType<typeof setInterval> | null = null
  private _enabled = false

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
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_SEND.FOCUSDIM_STATE_CHANGED, state)
      }
    })
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Initialize the service. Called once during app startup.
   * If the persisted config has `enabled: true`, auto-enables dimming.
   */
  init(): void {
    // Always start disabled — user must explicitly toggle on via hotkey or UI.
    // Previous sessions may have left enabled: true in the config store.
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
    if (this._enabled && this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      // Already enabled — just update
      this.updateOverlay()
      return
    }

    this._enabled = true
    this.setConf('enabled', true)
    this.createOverlayWindow()
    this.startTracking()
    this.broadcastState()
    console.log('[FocusDim] Enabled')
  }

  /** Disable the dim overlay */
  disable(): void {
    this._enabled = false
    this.setConf('enabled', false)
    this.stopTracking()
    this.destroyOverlayWindow()
    this.broadcastState()
    console.log('[FocusDim] Disabled')
  }

  /** Set the dim opacity (0-1) */
  setOpacity(opacity: number): void {
    const clamped = Math.max(0, Math.min(1, opacity))
    this.setConf('opacity', clamped)
    this.updateOverlay()
    this.broadcastState()
  }

  /** Set the dim color by key name */
  setColor(colorKey: string): void {
    if (!(colorKey in DIM_COLORS)) {
      console.warn(`[FocusDim] Unknown color key: ${colorKey}`)
      return
    }
    this.setConf('dim_color', colorKey)
    this.updateOverlay()
    this.broadcastState()
  }

  /** Toggle or set the border highlight */
  setBorder(show: boolean): void {
    this.setConf('show_border', show)
    this.updateOverlay()
    this.broadcastState()
  }

  /** Set fade duration in ms */
  setFadeDuration(ms: number): void {
    this.setConf('fade_duration', Math.max(0, Math.min(2000, ms)))
    this.broadcastState()
  }

  /** Clean up when app is quitting */
  destroy(): void {
    this.stopTracking()
    this.destroyOverlayWindow()
    console.log('[FocusDim] Service destroyed')
  }

  // ─── Overlay Window Management ───────────────────────────────────────────

  private createOverlayWindow(): void {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) return

    // Span all monitors
    const displays = screen.getAllDisplays()
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    for (const d of displays) {
      minX = Math.min(minX, d.bounds.x)
      minY = Math.min(minY, d.bounds.y)
      maxX = Math.max(maxX, d.bounds.x + d.bounds.width)
      maxY = Math.max(maxY, d.bounds.y + d.bounds.height)
    }

    const totalW = maxX - minX
    const totalH = maxY - minY

    this.overlayWindow = new BrowserWindow({
      x: minX,
      y: minY,
      width: totalW,
      height: totalH,
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

    // Make click-through
    this.overlayWindow.setIgnoreMouseEvents(true)

    // Load the overlay HTML with current state
    const conf = this.getConf()
    const hex = DIM_COLORS[conf.dim_color] || '#000000'
    const overlayHtml = this.buildOverlayHtml(hex, conf.opacity, conf.show_border, conf.fade_duration)
    this.overlayWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(overlayHtml)}`)

    this.overlayWindow.once('ready-to-show', () => {
      if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
        this.overlayWindow.showInactive()
      }
    })

    this.overlayWindow.on('closed', () => {
      this.overlayWindow = null
    })
  }

  private destroyOverlayWindow(): void {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.destroy()
    }
    this.overlayWindow = null
  }

  /**
   * Build the overlay HTML string. The overlay is a single fullscreen div
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
<script>
  // Listen for update messages from the main process
  window.addEventListener('message', (e) => {
    if (!e.data || e.data.type !== 'focusdim-update') return;
    const d = e.data;
    const overlay = document.getElementById('dim-overlay');
    const border = document.getElementById('border-frame');
    if (!overlay || !border) return;

    if (d.color !== undefined) overlay.style.background = d.color;
    if (d.opacity !== undefined) overlay.style.opacity = d.opacity;
    if (d.showBorder !== undefined) border.style.display = d.showBorder ? 'block' : 'none';
    if (d.fadeDuration !== undefined) {
      overlay.style.transition = 'opacity ' + d.fadeDuration + 'ms ease, clip-path 0.05s linear';
    }

    if (d.clipPath) overlay.style.clipPath = d.clipPath;
    if (d.borderRect) {
      border.style.left = d.borderRect.x + 'px';
      border.style.top = d.borderRect.y + 'px';
      border.style.width = d.borderRect.w + 'px';
      border.style.height = d.borderRect.h + 'px';
    }
  });
</script>
</body></html>`
  }

  /**
   * Send updated clip-path and styling to the overlay renderer.
   * `rect` is {x, y, w, h} in screen coordinates relative to overlay origin.
   */
  private sendOverlayUpdate(rect: { x: number; y: number; w: number; h: number }): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return

    const conf = this.getConf()
    const hex = DIM_COLORS[conf.dim_color] || '#000000'
    const overlayBounds = this.overlayWindow.getBounds()
    const ow = overlayBounds.width
    const oh = overlayBounds.height

    // Convert absolute screen coords to percentages relative to overlay
    const relX = rect.x - overlayBounds.x
    const relY = rect.y - overlayBounds.y

    // Build clip-path: full rect with a rectangular cutout
    const l = (relX / ow) * 100
    const t = (relY / oh) * 100
    const r = ((relX + rect.w) / ow) * 100
    const b = ((relY + rect.h) / oh) * 100

    // Clip-path polygon: outer rect going clockwise, inner cutout going counterclockwise
    const clipPath = `polygon(
      0% 0%, 0% 100%, ${l}% 100%, ${l}% ${t}%,
      ${r}% ${t}%, ${r}% ${b}%, ${l}% ${b}%,
      ${l}% 100%, 100% 100%, 100% 0%
    )`

    this.overlayWindow.webContents.executeJavaScript(`
      (function() {
        var overlay = document.getElementById('dim-overlay');
        var border = document.getElementById('border-frame');
        if (overlay) {
          overlay.style.clipPath = ${JSON.stringify(clipPath)};
          overlay.style.background = ${JSON.stringify(hex)};
          overlay.style.opacity = ${conf.opacity};
        }
        if (border) {
          border.style.left = '${relX}px';
          border.style.top = '${relY}px';
          border.style.width = '${rect.w}px';
          border.style.height = '${rect.h}px';
          border.style.display = ${conf.show_border ? "'block'" : "'none'"};
        }
      })();
    `).catch(() => { /* overlay may be closing */ })
  }

  /** Push style-only updates to the overlay (no position change) */
  private updateOverlay(): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return

    const conf = this.getConf()
    const hex = DIM_COLORS[conf.dim_color] || '#000000'

    this.overlayWindow.webContents.executeJavaScript(`
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
  private _debugLogCount = 0
  private trackActiveWindow(): void {
    if (!this._enabled || !this.overlayWindow || this.overlayWindow.isDestroyed()) return

    const activeWin = getActiveWindow()

    // Debug: log first 5 results to diagnose
    if (this._debugLogCount < 5) {
      this._debugLogCount++
      if (activeWin) {
        console.log(`[FocusDim] DEBUG: active window = "${activeWin.title}" class="${activeWin.className}" rect=${activeWin.x},${activeWin.y} ${activeWin.w}x${activeWin.h}`)
      } else {
        console.log('[FocusDim] DEBUG: getActiveWindow() returned null')
      }
    }

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
    this.sendOverlayUpdate({ x: -100, y: -100, w: 1, h: 1 })
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
