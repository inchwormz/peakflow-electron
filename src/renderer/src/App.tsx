import { lazy, Suspense, useMemo, type ReactNode } from 'react'
import { AppShell } from './components/layout/AppShell'
import { TitleBar } from './components/layout/TitleBar'
import { ToolId, SystemWindowId, TOOL_DISPLAY_NAMES } from '@shared/tool-ids'
import { Dashboard } from './tools/dashboard/Dashboard'
import { AlertOverlay } from './tools/screenslap/AlertOverlay'
import { TrialExpired } from './components/licensing/TrialExpired'
import { IPC_INVOKE } from '@shared/ipc-types'

/** Lazy-load heavy tool bundles so the Dashboard hub does not pull TF.js / clipboard UI on startup. */
const FocusDim = lazy(() => import('./tools/focusdim/FocusDim').then((m) => ({ default: m.FocusDim })))
const QuickBoard = lazy(() => import('./tools/quickboard/QuickBoard').then((m) => ({ default: m.QuickBoard })))
const ScreenSlap = lazy(() => import('./tools/screenslap/ScreenSlap').then((m) => ({ default: m.ScreenSlap })))
const MeetReady = lazy(() => import('./tools/meetready/MeetReady').then((m) => ({ default: m.MeetReady })))
const LiquidFocus = lazy(() => import('./tools/liquidfocus/LiquidFocus').then((m) => ({ default: m.LiquidFocus })))
const LiquidFocusMini = lazy(() =>
  import('./tools/liquidfocus/LiquidFocusMini').then((m) => ({ default: m.LiquidFocusMini }))
)
const SoundSplit = lazy(() => import('./tools/soundsplit/SoundSplit').then((m) => ({ default: m.SoundSplit })))

function ToolSuspense({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center text-xs" style={{ color: 'var(--text-dim)' }}>
          Loading…
        </div>
      }
    >
      {children}
    </Suspense>
  )
}

/* ─── Placeholder Tool Views ─────────────────────────────────────────────── */

function ToolPlaceholder({ toolId }: { toolId: ToolId }): React.JSX.Element {
  const displayName = TOOL_DISPLAY_NAMES[toolId]

  // Per-tool accent colors for visual distinction
  const accentColors: Record<ToolId, string> = {
    [ToolId.FocusDim]: '#ffe17c',
    [ToolId.QuickBoard]: '#ffe17c',
    [ToolId.ScreenSlap]: '#ffe17c',
    [ToolId.MeetReady]: '#ffe17c',
    [ToolId.LiquidFocus]: '#ffe17c',
    [ToolId.SoundSplit]: '#ffe17c'
  }

  const accent = accentColors[toolId]

  return (
    <>
      <TitleBar title={displayName} />
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6">
        <div
          className="text-3xl font-semibold tracking-tight"
          style={{ color: accent, fontFamily: "'Outfit', sans-serif" }}
        >
          {displayName}
        </div>
        <div
          className="text-sm font-mono"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Coming soon
        </div>
        <div
          className="mt-6 px-4 py-2 rounded-lg text-xs font-mono"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-dim)',
            color: 'var(--text-secondary)'
          }}
        >
          toolId: {toolId}
        </div>
      </div>
    </>
  )
}

/* ─── Debug / Landing View ───────────────────────────────────────────────── */

function DebugLanding(): React.JSX.Element {
  const tools = Object.values(ToolId)

  return (
    <>
      <TitleBar title="PeakFlow" showMaximize={false} />
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8">
        <div
          className="text-4xl font-bold tracking-tight"
          style={{ color: 'var(--accent)', fontFamily: "'Outfit', sans-serif" }}
        >
          PeakFlow
        </div>
        <div
          className="text-sm max-w-xs text-center leading-relaxed"
          style={{ color: 'var(--text-secondary)' }}
        >
          Electron renderer is running. No tool specified in query params.
        </div>

        {/* Tool grid for debugging */}
        <div className="grid grid-cols-2 gap-3 mt-4 w-full max-w-sm">
          {tools.map((id) => (
            <div
              key={id}
              className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-mono"
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-dim)',
                color: 'var(--text-secondary)'
              }}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: 'var(--text-tertiary)' }}
              />
              {TOOL_DISPLAY_NAMES[id]}
            </div>
          ))}
        </div>

        <div
          className="mt-2 text-xs font-mono"
          style={{ color: 'var(--text-ghost)' }}
        >
          Pass ?toolId=focusdim to load a tool
        </div>
      </div>
    </>
  )
}

/* ─── App Router ─────────────────────────────────────────────────────────── */

export default function App(): React.JSX.Element {
  const { toolId, systemId } = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('toolId')

    // Check for system windows first (e.g. screenslap-alert)
    if (raw && Object.values(SystemWindowId).includes(raw as SystemWindowId)) {
      return { toolId: null, systemId: raw as SystemWindowId }
    }

    // Then check for tool windows
    if (raw && Object.values(ToolId).includes(raw as ToolId)) {
      return { toolId: raw as ToolId, systemId: null }
    }

    return { toolId: null, systemId: null }
  }, [])

  // Route to the correct tool component, falling back to placeholder
  const renderTool = (): React.JSX.Element => {
    // System windows (no app shell chrome)
    if (systemId === SystemWindowId.ScreenSlapAlert) {
      return <AlertOverlay />
    }

    if (systemId === SystemWindowId.LiquidFocusMini) {
      return (
        <ToolSuspense>
          <LiquidFocusMini />
        </ToolSuspense>
      )
    }

    // Trial expired / tool not licensed lock screen
    if (systemId === SystemWindowId.TrialExpired) {
      const params = new URLSearchParams(window.location.search)
      const deniedTool = params.get('deniedTool') ?? undefined
      const reason = params.get('reason') ?? undefined
      return (
        <TrialExpired
          deniedTool={deniedTool}
          reason={reason}
          onActivated={() => {
            window.peakflow.invoke(IPC_INVOKE.WINDOW_CLOSE).catch(() => {})
            if (deniedTool) {
              window.peakflow.invoke(IPC_INVOKE.WINDOW_OPEN, { toolId: deniedTool }).catch(() => {})
            }
          }}
        />
      )
    }

    // Dashboard hub
    if (systemId === SystemWindowId.Dashboard) {
      return <Dashboard />
    }

    if (!toolId) return <Dashboard />
    switch (toolId) {
      case ToolId.FocusDim:
        return (
          <ToolSuspense>
            <FocusDim />
          </ToolSuspense>
        )
      case ToolId.QuickBoard:
        return (
          <ToolSuspense>
            <QuickBoard />
          </ToolSuspense>
        )
      case ToolId.ScreenSlap:
        return (
          <ToolSuspense>
            <ScreenSlap />
          </ToolSuspense>
        )
      case ToolId.MeetReady:
        return (
          <ToolSuspense>
            <MeetReady />
          </ToolSuspense>
        )
      case ToolId.LiquidFocus:
        return (
          <ToolSuspense>
            <LiquidFocus />
          </ToolSuspense>
        )
      case ToolId.SoundSplit:
        return (
          <ToolSuspense>
            <SoundSplit />
          </ToolSuspense>
        )
      default:
        return <ToolPlaceholder toolId={toolId} />
    }
  }

  // System windows render without AppShell (no title bar, no chrome)
  if (systemId === SystemWindowId.ScreenSlapAlert || systemId === SystemWindowId.LiquidFocusMini) {
    return renderTool()
  }

  return (
    <AppShell>
      {renderTool()}
    </AppShell>
  )
}
