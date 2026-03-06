/**
 * SettingsPanel — QuickBoard settings view.
 */

import {
  DS,
  NavButton,
  SectionLabel,
  SettingRow,
  Toggle,
  navBarStyle,
  settingNumStyle,
  clearBtnStyle
} from './shared'

interface SettingsPanelProps {
  maxItems: number
  plainText: boolean
  encrypt: boolean
  onMaxItemsChange: (val: number) => void
  onPlainTextChange: () => void
  onEncryptChange: () => void
  onClearHistory: () => void
  onBack: () => void
}

export function SettingsPanel({
  maxItems,
  plainText,
  encrypt,
  onMaxItemsChange,
  onPlainTextChange,
  onEncryptChange,
  onClearHistory,
  onBack
}: SettingsPanelProps): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        animation: 'fadeIn 0.2s ease'
      }}
    >
      {/* Settings nav bar */}
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

      {/* Settings body */}
      <div style={{ padding: '12px 24px 24px', flex: 1 }}>
        <SectionLabel>History</SectionLabel>

        {/* Max items */}
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

        {/* Keyboard shortcut (read-only) */}
        <SettingRow label="Keyboard shortcut" borderBottom>
          <span
            style={{
              fontSize: 11,
              color: DS.textDim,
              fontWeight: 500
            }}
          >
            Ctrl+Shift+V
          </span>
        </SettingRow>

        <SectionLabel>Options</SectionLabel>

        {/* Plain text mode */}
        <SettingRow label="Plain text mode" borderBottom>
          <Toggle checked={plainText} onChange={onPlainTextChange} />
        </SettingRow>

        {/* Encrypt history */}
        <SettingRow label="Encrypt history">
          <Toggle checked={encrypt} onChange={onEncryptChange} />
        </SettingRow>

        {/* Clear All History button */}
        <button onClick={onClearHistory} style={clearBtnStyle}>
          Clear All History
        </button>
      </div>
    </div>
  )
}
