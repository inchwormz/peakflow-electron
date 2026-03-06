/**
 * SettingsPanel — Tabbed settings for QuickBoard.
 *
 * Tabs: General | Transforms | Triggers | Hotkeys | Data
 */

import { useState } from 'react'
import {
  DS,
  NavButton,
  SectionLabel,
  SettingRow,
  Toggle,
  navBarStyle,
  settingNumStyle,
  clearBtnStyle,
  type SettingsTab
} from './shared'
import { TransformBuilder } from './TransformBuilder'
import { TriggerBuilder } from './TriggerBuilder'
import { HotkeySettings } from './HotkeySettings'
import { ImportExport } from './ImportExport'

interface SettingsPanelProps {
  maxItems: number
  plainText: boolean
  encrypt: boolean
  historyCount: number
  tagCount: number
  onMaxItemsChange: (val: number) => void
  onPlainTextChange: () => void
  onEncryptChange: () => void
  onClearHistory: () => void
  onBack: () => void
  onRerunOnboarding?: () => void
}

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'transforms', label: 'Transforms' },
  { id: 'triggers', label: 'Triggers' },
  { id: 'hotkeys', label: 'Hotkeys' },
  { id: 'data', label: 'Data' },
  { id: 'ai', label: 'AI' }
]

export function SettingsPanel({
  maxItems,
  plainText,
  encrypt,
  historyCount,
  tagCount,
  onMaxItemsChange,
  onPlainTextChange,
  onEncryptChange,
  onClearHistory,
  onBack,
  onRerunOnboarding
}: SettingsPanelProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        animation: 'fadeIn 0.2s ease'
      }}
    >
      {/* Nav bar */}
      <div style={navBarStyle}>
        {/* @ts-expect-error -- Electron-specific CSS */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, WebkitAppRegion: 'no-drag' }}>
          <NavButton icon="&#9664;" onClick={onBack} />
          <span style={{ fontSize: 13, fontWeight: 400, color: DS.textPrimary, fontFamily: "'Silkscreen', cursive" }}>
            Settings
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} />
      </div>

      {/* Tab row */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          padding: '8px 24px 0',
          borderBottom: `1px solid ${DS.border}`,
          overflowX: 'auto'
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '8px 10px',
              border: 'none',
              borderBottom: `2px solid ${activeTab === tab.id ? DS.accent : 'transparent'}`,
              background: 'transparent',
              color: activeTab === tab.id ? DS.textPrimary : DS.textDim,
              fontSize: 10,
              fontWeight: activeTab === tab.id ? 600 : 400,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'color 0.15s, border-color 0.15s',
              whiteSpace: 'nowrap'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ padding: '12px 24px 24px', flex: 1, overflowY: 'auto' }}>
        {activeTab === 'general' && (
          <>
            <SectionLabel>History</SectionLabel>
            <SettingRow label="Max items" borderBottom>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="number"
                  value={maxItems}
                  min={10}
                  max={2000}
                  onChange={(e) => onMaxItemsChange(parseInt(e.target.value) || 50)}
                  style={settingNumStyle}
                />
                <span style={{ fontSize: 10, color: DS.textDim }}>clips</span>
              </div>
            </SettingRow>
            <SettingRow label="Keyboard shortcut" borderBottom>
              <span style={{ fontSize: 11, color: DS.textDim, fontWeight: 500 }}>
                Ctrl+Shift+V
              </span>
            </SettingRow>

            <SectionLabel>Options</SectionLabel>
            <SettingRow label="Plain text mode" borderBottom>
              <Toggle checked={plainText} onChange={onPlainTextChange} />
            </SettingRow>
            <SettingRow label="Encrypt history">
              <Toggle checked={encrypt} onChange={onEncryptChange} />
            </SettingRow>

            <button onClick={onClearHistory} style={clearBtnStyle}>
              Clear All History
            </button>
          </>
        )}

        {activeTab === 'transforms' && <TransformBuilder />}
        {activeTab === 'triggers' && <TriggerBuilder />}
        {activeTab === 'hotkeys' && <HotkeySettings />}
        {activeTab === 'data' && (
          <ImportExport
            stats={{
              items: historyCount,
              tags: tagCount,
              transforms: 0,
              triggers: 0
            }}
          />
        )}

        {activeTab === 'ai' && (
          <>
            <SectionLabel>AI Features</SectionLabel>
            <div style={{ fontSize: 10, color: DS.textDim, marginBottom: 12 }}>
              AI transforms, onboarding, and smart suggestions require a Pro license.
            </div>
            {onRerunOnboarding && (
              <button
                onClick={onRerunOnboarding}
                style={{
                  width: '100%',
                  padding: 10,
                  borderRadius: 8,
                  border: `1px solid ${DS.accent}44`,
                  background: DS.accent + '11',
                  color: DS.accent,
                  fontSize: 11,
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  marginBottom: 12
                }}
              >
                Re-run AI Setup Wizard
              </button>
            )}
            <SettingRow label="Smart suggestions" borderBottom>
              <span style={{ fontSize: 10, color: DS.textDim }}>
                Based on clipboard patterns
              </span>
            </SettingRow>
          </>
        )}
      </div>
    </div>
  )
}
