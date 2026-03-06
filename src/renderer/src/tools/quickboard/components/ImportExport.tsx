/**
 * ImportExport — Data management in Settings > Data tab.
 *
 * Export all history + tags + transforms + triggers to JSON.
 * Import from a previously exported file (merge or replace).
 *
 * NOTE: IPC channels for import/export are not yet implemented.
 */

import { useState, useCallback } from 'react'
import { DS, SectionLabel } from './shared'

interface DataStats {
  items: number
  tags: number
  transforms: number
  triggers: number
}

export function ImportExport({
  stats
}: {
  stats: DataStats
}): React.JSX.Element {
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge')
  const [statusMsg, setStatusMsg] = useState('')

  const handleExport = useCallback(() => {
    // Will call IPC_INVOKE.CLIPBOARD_EXPORT when implemented
    setStatusMsg('Export not yet connected to backend.')
    setTimeout(() => setStatusMsg(''), 3000)
  }, [])

  const handleImport = useCallback(() => {
    // Will call IPC_INVOKE.CLIPBOARD_IMPORT when implemented
    setStatusMsg('Import not yet connected to backend.')
    setTimeout(() => setStatusMsg(''), 3000)
  }, [])

  return (
    <div>
      <SectionLabel>Export</SectionLabel>
      <div style={{ fontSize: 11, color: DS.textDim, marginBottom: 8 }}>
        Save all history, tags, transforms, and triggers to a file.
      </div>
      <button
        onClick={handleExport}
        style={{
          width: '100%',
          padding: '10px 14px',
          borderRadius: 8,
          border: `1px solid ${DS.textGhost}`,
          background: DS.bgLight,
          color: DS.textPrimary,
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit'
        }}
      >
        Export to JSON
      </button>

      <div style={{ height: 1, background: DS.border, margin: '16px 0' }} />

      <SectionLabel>Import</SectionLabel>
      <div style={{ fontSize: 11, color: DS.textDim, marginBottom: 8 }}>
        Load from a previously exported file.
      </div>

      {/* Merge vs replace */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        {(['merge', 'replace'] as const).map((mode) => (
          <label
            key={mode}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
              fontSize: 11,
              color: importMode === mode ? DS.textPrimary : DS.textDim
            }}
            onClick={() => setImportMode(mode)}
          >
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                border: `2px solid ${importMode === mode ? DS.accent : DS.textGhost}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              {importMode === mode && (
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: DS.accent
                  }}
                />
              )}
            </div>
            {mode === 'merge' ? 'Merge with existing' : 'Replace everything'}
          </label>
        ))}
      </div>

      <button
        onClick={handleImport}
        style={{
          width: '100%',
          padding: '10px 14px',
          borderRadius: 8,
          border: `1px solid ${DS.textGhost}`,
          background: DS.bgLight,
          color: DS.textPrimary,
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit'
        }}
      >
        Import from JSON
      </button>

      {/* Status message */}
      {statusMsg && (
        <div style={{ fontSize: 10, color: DS.accent, marginTop: 8, textAlign: 'center' }}>
          {statusMsg}
        </div>
      )}

      <div style={{ height: 1, background: DS.border, margin: '16px 0' }} />

      {/* Stats */}
      <SectionLabel>Stats</SectionLabel>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8
        }}
      >
        {[
          { label: 'Items in history', value: stats.items },
          { label: 'Tags', value: stats.tags },
          { label: 'Transform pipes', value: stats.transforms },
          { label: 'Trigger rules', value: stats.triggers }
        ].map((s) => (
          <div
            key={s.label}
            style={{
              padding: 8,
              borderRadius: 6,
              background: DS.bgLight,
              border: `1px solid ${DS.border}`
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700, color: DS.textPrimary }}>{s.value}</div>
            <div style={{ fontSize: 9, color: DS.textDim, marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
