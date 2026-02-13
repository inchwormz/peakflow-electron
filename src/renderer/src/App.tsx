import { useMemo } from 'react'
import { AppShell } from './components/layout/AppShell'
import { TitleBar } from './components/layout/TitleBar'
import { ToolId, TOOL_DISPLAY_NAMES } from '@shared/tool-ids'
import { FocusDim } from './tools/focusdim/FocusDim'

/* ─── Placeholder Tool Views ─────────────────────────────────────────────── */

function ToolPlaceholder({ toolId }: { toolId: ToolId }): React.JSX.Element {
  const displayName = TOOL_DISPLAY_NAMES[toolId]

  // Per-tool accent colors for visual distinction
  const accentColors: Record<ToolId, string> = {
    [ToolId.FocusDim]: '#a78bfa',      // violet
    [ToolId.QuickBoard]: '#4ae08a',     // green
    [ToolId.ScreenSlap]: '#f05858',     // red
    [ToolId.MeetReady]: '#5eb8ff',      // blue
    [ToolId.LiquidFocus]: '#e8a237',    // amber
    [ToolId.SoundSplit]: '#f472b6'      // pink
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
  const toolId = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('toolId')
    if (raw && Object.values(ToolId).includes(raw as ToolId)) {
      return raw as ToolId
    }
    return null
  }, [])

  // Route to the correct tool component, falling back to placeholder
  const renderTool = (): React.JSX.Element => {
    if (!toolId) return <DebugLanding />
    switch (toolId) {
      case ToolId.FocusDim:
        return <FocusDim />
      default:
        return <ToolPlaceholder toolId={toolId} />
    }
  }

  return (
    <AppShell>
      {renderTool()}
    </AppShell>
  )
}
