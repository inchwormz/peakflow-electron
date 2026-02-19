/**
 * SettingsView — Duration settings, behavior toggles, blocked sites.
 *
 * Matches LiquidFocus_Redesign.html settings exactly:
 *   - Tab bar: Duration / Behavior / Sites
 *   - Duration: number inputs (Focus, Short break, Long break, Interval)
 *   - Behavior: toggle switches (Auto-start, Sound, Ticking, Strict, Webcam)
 *   - Sites: 2-column grid with small toggles
 *   - All persisted via config:set IPC calls
 */

import { useState, useEffect, useCallback, type CSSProperties } from 'react'
import { DS } from './LiquidFocus'
import { IPC_INVOKE } from '@shared/ipc-types'
import { ToolId } from '@shared/tool-ids'

// ─── Distraction sites database ─────────────────────────────────────────────

const DISTRACTION_SITES: Record<string, string> = {
  YouTube: 'youtube.com',
  Facebook: 'facebook.com',
  Instagram: 'instagram.com',
  Twitter: 'twitter.com',
  LinkedIn: 'linkedin.com',
  Reddit: 'reddit.com',
  TikTok: 'tiktok.com',
  Netflix: 'netflix.com',
  Twitch: 'twitch.com',
  Pinterest: 'pinterest.com',
  Amazon: 'amazon.com',
  Discord: 'discord.com'
}

// ─── Types ──────────────────────────────────────────────────────────────────

type SettingsTab = 'duration' | 'behavior' | 'sites' | 'integrations'

interface SettingsViewProps {
  onBack: () => void
  onShowTasks: () => void
}

interface LiquidFocusConfig {
  work_duration: number
  break_duration: number
  long_break_duration: number
  sessions_before_long: number
  alert_sound: boolean
  auto_start_breaks: boolean
  focus_detection_enabled: boolean
  focus_away_threshold_secs: number
  todoist_project_filter: string
  distraction_sites: string[]
}

// ─── Component ──────────────────────────────────────────────────────────────

export function SettingsView({ onBack, onShowTasks }: SettingsViewProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<SettingsTab>('duration')
  const [config, setConfig] = useState<LiquidFocusConfig>({
    work_duration: 25,
    break_duration: 5,
    long_break_duration: 15,
    sessions_before_long: 4,
    alert_sound: true,
    auto_start_breaks: false,
    focus_detection_enabled: false,
    focus_away_threshold_secs: 5,
    distraction_sites: Object.values(DISTRACTION_SITES)
  })

  // Load config on mount
  useEffect(() => {
    window.peakflow
      .invoke(IPC_INVOKE.CONFIG_GET, { tool: ToolId.LiquidFocus })
      .then((cfg) => {
        if (cfg && typeof cfg === 'object') {
          setConfig(cfg as LiquidFocusConfig)
        }
      })
      .catch(() => {})
  }, [])

  // Save a config key
  const saveConfigKey = useCallback((key: string, value: unknown) => {
    window.peakflow
      .invoke(IPC_INVOKE.CONFIG_SET, {
        tool: ToolId.LiquidFocus,
        key,
        value
      })
      .catch(() => {})

    setConfig((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleBack = useCallback(() => {
    onBack()
  }, [onBack])

  // ── Styles ────────────────────────────────────────────────────────────

  const navBar: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '20px 24px 0',
    flexShrink: 0
  }

  const tabBar: CSSProperties = {
    display: 'flex',
    gap: 2,
    background: DS.surface,
    borderRadius: 10,
    padding: 3,
    margin: '12px 24px 16px',
    flexShrink: 0
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      {/* Nav bar */}
      <div style={navBar}>
        <div style={{ display: 'flex', gap: 8 }}>
          <NavBtn onClick={handleBack}>&#9664;</NavBtn>
        </div>
        <span
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: DS.white,
            letterSpacing: 0.5
          }}
        >
          Settings
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <TextNavBtn onClick={onShowTasks}>Tasks</TextNavBtn>
        </div>
      </div>

      {/* Tab bar */}
      <div style={tabBar}>
        {(['duration', 'behavior', 'sites', 'integrations'] as SettingsTab[]).map((tab) => (
          <TabButton
            key={tab}
            label={tab === 'integrations' ? 'Sync' : tab.charAt(0).toUpperCase() + tab.slice(1)}
            isActive={activeTab === tab}
            onClick={() => setActiveTab(tab)}
          />
        ))}
      </div>

      {/* Tab content */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0 24px 20px',
          scrollbarWidth: 'thin',
          scrollbarColor: `${DS.elevated} transparent`
        }}
      >
        {activeTab === 'duration' && (
          <DurationTab config={config} onSave={saveConfigKey} />
        )}
        {activeTab === 'behavior' && (
          <BehaviorTab config={config} onSave={saveConfigKey} />
        )}
        {activeTab === 'sites' && (
          <SitesTab config={config} onSave={saveConfigKey} />
        )}
        {activeTab === 'integrations' && (
          <IntegrationsTab config={config} onSave={saveConfigKey} onShowTasks={onShowTasks} />
        )}
      </div>
    </div>
  )
}

// ─── Duration Tab ───────────────────────────────────────────────────────────

function DurationTab({
  config,
  onSave
}: {
  config: LiquidFocusConfig
  onSave: (key: string, value: unknown) => void
}): React.JSX.Element {
  return (
    <>
      <SettingRow label="Focus session">
        <NumberInput
          value={config.work_duration}
          unit="min"
          onChange={(v) => onSave('work_duration', v)}
        />
      </SettingRow>
      <SettingRow label="Short break">
        <NumberInput
          value={config.break_duration}
          unit="min"
          onChange={(v) => onSave('break_duration', v)}
        />
      </SettingRow>
      <SettingRow label="Long break">
        <NumberInput
          value={config.long_break_duration}
          unit="min"
          onChange={(v) => onSave('long_break_duration', v)}
        />
      </SettingRow>
      <SettingRow label="Long break after" isLast>
        <NumberInput
          value={config.sessions_before_long}
          unit="sessions"
          onChange={(v) => onSave('sessions_before_long', Math.max(1, v))}
        />
      </SettingRow>
      <div
        style={{
          fontSize: 10,
          color: DS.textLabel,
          padding: '8px 0 0',
          lineHeight: 1.4
        }}
      >
        Duration changes apply when the timer is idle. Reset the timer to apply during a session.
      </div>
    </>
  )
}

// ─── Behavior Tab ───────────────────────────────────────────────────────────

function BehaviorTab({
  config,
  onSave
}: {
  config: LiquidFocusConfig
  onSave: (key: string, value: unknown) => void
}): React.JSX.Element {
  // Behavior settings are stored as additional config keys
  // We treat alert_sound as the "Sound alerts" toggle for now
  return (
    <>
      <SettingRow label="Sound alerts">
        <Toggle
          checked={config.alert_sound}
          onChange={(v) => onSave('alert_sound', v)}
        />
      </SettingRow>
      <SettingRow label="Auto-continue">
        <Toggle
          checked={config.auto_start_breaks}
          onChange={(v) => onSave('auto_start_breaks', v)}
        />
      </SettingRow>
      <SettingRow label="Webcam focus detection">
        <Toggle
          checked={config.focus_detection_enabled}
          onChange={(v) => onSave('focus_detection_enabled', v)}
        />
      </SettingRow>
      {config.focus_detection_enabled && (
        <SettingRow label="Away threshold" isLast>
          <NumberInput
            value={config.focus_away_threshold_secs}
            unit="sec"
            onChange={(v) => onSave('focus_away_threshold_secs', Math.max(1, v))}
          />
        </SettingRow>
      )}
      {!config.focus_detection_enabled && (
        <div
          style={{
            fontSize: 10,
            color: DS.textLabel,
            padding: '8px 0 4px',
            lineHeight: 1.5
          }}
        >
          Uses your webcam to detect when you look away. All processing is on-device — no video
          is stored or transmitted.
        </div>
      )}
    </>
  )
}

// ─── Sites Tab ──────────────────────────────────────────────────────────────

function SitesTab({
  config,
  onSave
}: {
  config: LiquidFocusConfig
  onSave: (key: string, value: unknown) => void
}): React.JSX.Element {
  const blockedSet = new Set(config.distraction_sites || [])

  const toggleSite = useCallback(
    (site: string) => {
      const current = new Set(config.distraction_sites || [])
      if (current.has(site)) {
        current.delete(site)
      } else {
        current.add(site)
      }
      onSave('distraction_sites', Array.from(current))
    },
    [config.distraction_sites, onSave]
  )

  return (
    <>
      <div
        style={{
          fontSize: 8,
          fontWeight: 600,
          letterSpacing: 2.5,
          textTransform: 'uppercase',
          color: DS.textLabel,
          marginBottom: 8
        }}
      >
        BLOCKED DURING FOCUS
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '2px 12px'
        }}
      >
        {Object.entries(DISTRACTION_SITES).map(([label, domain]) => (
          <div
            key={domain}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 0'
            }}
          >
            <span
              style={{
                fontSize: 12,
                color: DS.textSecondary
              }}
            >
              {label}
            </span>
            <SmallToggle
              checked={blockedSet.has(domain)}
              onChange={() => toggleSite(domain)}
            />
          </div>
        ))}
      </div>
    </>
  )
}

// ─── Integrations Tab ────────────────────────────────────────────────────────

interface TodoistStatus {
  connected: boolean
  error: string | null
}

interface TodoistProject {
  id: string
  name: string
  color: string
}

function IntegrationsTab({
  config,
  onSave,
  onShowTasks
}: {
  config: LiquidFocusConfig
  onSave: (key: string, value: unknown) => void
  onShowTasks: () => void
}): React.JSX.Element {
  const [status, setStatus] = useState<TodoistStatus>({ connected: false, error: null })
  const [projects, setProjects] = useState<TodoistProject[]>([])
  const [loading, setLoading] = useState(false)

  // Load Todoist status on mount
  useEffect(() => {
    window.peakflow
      .invoke(IPC_INVOKE.TODOIST_GET_STATUS)
      .then((s) => {
        const st = s as TodoistStatus
        setStatus(st)
        if (st.connected) {
          window.peakflow
            .invoke(IPC_INVOKE.TODOIST_GET_PROJECTS)
            .then((p) => setProjects(p as TodoistProject[]))
            .catch(() => {})
        }
      })
      .catch(() => {})
  }, [])

  const handleConnect = useCallback(async () => {
    setLoading(true)
    try {
      const result = (await window.peakflow.invoke(IPC_INVOKE.TODOIST_AUTHENTICATE)) as TodoistStatus
      setStatus(result)
      if (result.connected) {
        const p = (await window.peakflow.invoke(IPC_INVOKE.TODOIST_GET_PROJECTS)) as TodoistProject[]
        setProjects(p)
        // Navigate to Tasks view so user sees imported tasks
        onShowTasks()
      }
    } catch {
      setStatus({ connected: false, error: 'Authentication failed' })
    }
    setLoading(false)
  }, [onShowTasks])

  const handleDisconnect = useCallback(async () => {
    const result = (await window.peakflow.invoke(IPC_INVOKE.TODOIST_DISCONNECT)) as TodoistStatus
    setStatus(result)
    setProjects([])
    onSave('todoist_project_filter', '')
  }, [onSave])

  const connBtnStyle: CSSProperties = {
    padding: '10px 20px',
    borderRadius: 10,
    border: 'none',
    fontFamily: "'Be Vietnam Pro', 'Segoe UI', sans-serif",
    fontSize: 12,
    fontWeight: 600,
    cursor: loading ? 'wait' : 'pointer',
    transition: 'all 0.2s'
  }

  return (
    <>
      <div
        style={{
          fontSize: 8,
          fontWeight: 600,
          letterSpacing: 2.5,
          textTransform: 'uppercase',
          color: DS.textLabel,
          marginBottom: 12
        }}
      >
        TODOIST
      </div>

      {/* Connection status + button */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 0',
          borderBottom: `1px solid ${DS.surface}`
        }}
      >
        <div>
          <div style={{ fontSize: 13, color: DS.textSecondary, fontWeight: 400 }}>Status</div>
          <div
            style={{
              fontSize: 11,
              color: status.connected ? DS.green : DS.textLabel,
              marginTop: 2,
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: status.connected ? DS.green : '#333',
                display: 'inline-block'
              }}
            />
            {status.connected ? 'Connected' : 'Not connected'}
          </div>
        </div>

        {status.connected ? (
          <button
            onClick={handleDisconnect}
            style={{
              ...connBtnStyle,
              background: 'transparent',
              border: `1px solid ${DS.red}`,
              color: DS.red
            }}
          >
            Disconnect
          </button>
        ) : (
          <button
            onClick={handleConnect}
            disabled={loading}
            style={{
              ...connBtnStyle,
              background: DS.green,
              color: DS.bg,
              opacity: loading ? 0.5 : 1
            }}
          >
            {loading ? 'Connecting...' : 'Connect'}
          </button>
        )}
      </div>

      {/* Error message */}
      {status.error && (
        <div
          style={{
            fontSize: 11,
            color: DS.red,
            padding: '8px 0'
          }}
        >
          {status.error}
        </div>
      )}

      {/* Project filter */}
      {status.connected && (
        <div
          style={{
            padding: '12px 0',
            borderBottom: `1px solid ${DS.surface}`
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <div>
              <div style={{ fontSize: 13, color: DS.textSecondary, fontWeight: 400 }}>
                Project filter
              </div>
              <div style={{ fontSize: 10, color: DS.textLabel, marginTop: 2 }}>
                Import tasks from a specific project
              </div>
            </div>
          </div>
          <select
            value={config.todoist_project_filter || ''}
            onChange={(e) => onSave('todoist_project_filter', e.target.value)}
            style={{
              width: '100%',
              marginTop: 8,
              background: DS.borderInputBg,
              border: `1px solid ${DS.borderInput}`,
              borderRadius: 10,
              padding: '9px 12px',
              fontFamily: "'Be Vietnam Pro', 'Segoe UI', sans-serif",
              fontSize: 12,
              color: DS.white,
              outline: 'none',
              cursor: 'pointer',
              appearance: 'none',
              WebkitAppearance: 'none'
            }}
          >
            <option value="" style={{ background: DS.bg }}>
              All projects
            </option>
            {projects.map((p) => (
              <option key={p.id} value={p.id} style={{ background: DS.bg }}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Info note */}
      <div
        style={{
          fontSize: 10,
          color: DS.textLabel,
          padding: '16px 0 8px',
          lineHeight: 1.5
        }}
      >
        Connect Todoist to import tasks into LiquidFocus. Completing a task here will also mark it
        done in Todoist.
      </div>
    </>
  )
}

// ─── Shared Sub-components ──────────────────────────────────────────────────

function SettingRow({
  label,
  children,
  isLast
}: {
  label: string
  children: React.ReactNode
  isLast?: boolean
}): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 0',
        borderBottom: isLast ? 'none' : `1px solid ${DS.surface}`
      }}
    >
      <span
        style={{
          fontSize: 13,
          fontWeight: 400,
          color: DS.textSecondary
        }}
      >
        {label}
      </span>
      {children}
    </div>
  )
}

function NumberInput({
  value,
  unit,
  onChange
}: {
  value: number
  unit: string
  onChange: (value: number) => void
}): React.JSX.Element {
  const [localValue, setLocalValue] = useState(String(value))

  useEffect(() => {
    setLocalValue(String(value))
  }, [value])

  const handleBlur = useCallback(() => {
    const num = parseInt(localValue) || value
    onChange(num)
  }, [localValue, value, onChange])

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input
        type="text"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => e.key === 'Enter' && handleBlur()}
        style={{
          width: 44,
          textAlign: 'center',
          background: 'transparent',
          border: 'none',
          fontFamily: "'Be Vietnam Pro', 'Segoe UI', sans-serif",
          fontSize: 15,
          fontWeight: 600,
          color: DS.white,
          outline: 'none'
        }}
      />
      <span
        style={{
          fontSize: 11,
          fontWeight: 400,
          color: DS.textDim
        }}
      >
        {unit}
      </span>
    </div>
  )
}

function Toggle({
  checked,
  onChange
}: {
  checked: boolean
  onChange: (value: boolean) => void
}): React.JSX.Element {
  return (
    <div
      onClick={() => onChange(!checked)}
      style={{
        position: 'relative',
        width: 36,
        height: 20,
        cursor: 'pointer'
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: checked ? DS.green : DS.elevated,
          borderRadius: 10,
          transition: 'background 0.25s'
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 3,
          left: checked ? 19 : 3,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: checked ? DS.white : '#444',
          transition: 'all 0.25s'
        }}
      />
    </div>
  )
}

function SmallToggle({
  checked,
  onChange
}: {
  checked: boolean
  onChange: () => void
}): React.JSX.Element {
  return (
    <div
      onClick={onChange}
      style={{
        position: 'relative',
        width: 30,
        height: 16,
        cursor: 'pointer'
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: checked ? DS.green : DS.elevated,
          borderRadius: 8,
          transition: 'background 0.25s'
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 16 : 2,
          width: 12,
          height: 12,
          borderRadius: '50%',
          background: checked ? DS.white : '#333',
          transition: 'all 0.25s'
        }}
      />
    </div>
  )
}

function TabButton({
  label,
  isActive,
  onClick
}: {
  label: string
  isActive: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: 7,
        border: 'none',
        borderRadius: 8,
        background: isActive ? DS.borderLight : 'transparent',
        color: isActive ? DS.white : DS.textLabel,
        fontFamily: "'Be Vietnam Pro', 'Segoe UI', sans-serif",
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        cursor: 'pointer',
        transition: 'all 0.2s'
      }}
    >
      {label}
    </button>
  )
}

function NavBtn({
  children,
  onClick
}: {
  children: React.ReactNode
  onClick: () => void
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        border: `1px solid ${hovered ? '#444' : 'rgba(255,255,255,0.15)'}`,
        background: hovered ? DS.elevated : 'transparent',
        color: DS.white,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 14,
        transition: 'all 0.2s',
        fontFamily: 'inherit',
        padding: 0
      }}
    >
      {children}
    </button>
  )
}

function TextNavBtn({
  children,
  onClick
}: {
  children: React.ReactNode
  onClick: () => void
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        height: 32,
        paddingInline: 12,
        borderRadius: 16,
        border: `1px solid ${hovered ? '#444' : 'rgba(255,255,255,0.15)'}`,
        background: hovered ? DS.elevated : 'transparent',
        color: DS.white,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.5,
        transition: 'all 0.2s',
        fontFamily: "'Be Vietnam Pro', 'Segoe UI', sans-serif",
        padding: '0 12px'
      }}
    >
      {children}
    </button>
  )
}
