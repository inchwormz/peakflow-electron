/**
 * ClipRow — Individual clipboard entry row with provenance strip.
 *
 * Left-edge 3px color strip indicates content type:
 *   text=#555, code=#ffe17c, url=#eab308, image=#f05858, file=#666
 */

import { useState } from 'react'
import {
  DS,
  STRIP_COLORS,
  ActionButton,
  clipPreviewStyle,
  clipMetaStyle,
  clipBadgeStyle,
  type ClipboardItem
} from './shared'

export function ClipRow({
  item,
  time,
  showBadge,
  isSelected,
  queueNumber,
  onSelect,
  onPin,
  onDelete,
  onDoubleClick,
  onContextMenu
}: {
  item: ClipboardItem
  time: string
  showBadge: boolean
  isSelected: boolean
  /** If set, renders a numbered badge for sequential paste queue */
  queueNumber?: number
  onSelect: () => void
  onPin: (e: React.MouseEvent) => void
  onDelete: (e: React.MouseEvent) => void
  onDoubleClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false)

  const isQueued = queueNumber != null
  const rowBg = isQueued ? '#1a1a0a' : isSelected ? DS.bgLight : hovered ? DS.bgLight : 'transparent'
  const stripColor = STRIP_COLORS[item.contentType] || DS.textDim

  // File size formatter
  const fmtSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1048576).toFixed(1)} MB`
  }

  // Content type icon (no emoji — single char for density)
  const typeIcon = (): string => {
    switch (item.contentType) {
      case 'code': return '</>'
      case 'url': return '\u2197'   // ↗
      case 'image': return '\u25A3' // ▣
      case 'file': return '\u25A1'  // □
      default: return '\u00B6'      // ¶ (pilcrow for text)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        cursor: 'pointer',
        marginBottom: 2,
        transition: 'background 0.15s',
        alignItems: 'stretch',
        background: rowBg,
        borderRadius: '0 10px 10px 0'
      }}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Provenance strip — 3px left edge */}
      <div
        style={{
          width: 3,
          borderRadius: '3px 0 0 3px',
          background: stripColor,
          flexShrink: 0,
          opacity: isQueued || isSelected || hovered ? 1 : 0.5,
          transition: 'opacity 0.15s'
        }}
      />

      {/* Queue number badge OR type icon */}
      <div
        style={{
          width: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          paddingLeft: 6
        }}
      >
        {queueNumber != null ? (
          <span
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: DS.accent,
              color: DS.bg,
              fontSize: 10,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            {queueNumber}
          </span>
        ) : item.linkFavicon ? (
          <img
            src={item.linkFavicon}
            alt=""
            style={{ width: 16, height: 16, borderRadius: 3 }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          <span style={{ fontSize: 11, color: stripColor, opacity: 0.7, fontFamily: 'monospace' }}>
            {typeIcon()}
          </span>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, minWidth: 0, padding: '8px 8px 8px 4px' }}>
        {/* IMAGE content */}
        {item.type === 'image' && item.imageDataUrl ? (
          <>
            <img
              src={item.imageDataUrl}
              alt="clipboard image"
              style={{
                maxWidth: 100,
                maxHeight: 48,
                borderRadius: 4,
                display: 'block'
              }}
            />
            {item.ocrText && (
              <div
                style={{
                  fontSize: 9,
                  color: DS.textDim,
                  marginTop: 3,
                  lineHeight: 1.3,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontStyle: 'italic'
                }}
              >
                {item.ocrText.slice(0, 80)}{item.ocrText.length > 80 ? '\u2026' : ''}
              </div>
            )}
          </>
        ) : item.type === 'file' && item.fileMeta?.length ? (
          /* FILE content */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {item.fileMeta.slice(0, 3).map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: DS.textSecondary, fontWeight: 500 }}>
                  {f.name}
                </span>
                <span style={{ fontSize: 9, color: DS.textDim }}>
                  {fmtSize(f.size)}
                </span>
              </div>
            ))}
            {item.fileMeta.length > 3 && (
              <span style={{ fontSize: 9, color: DS.textDim }}>
                +{item.fileMeta.length - 3} more
              </span>
            )}
          </div>
        ) : (
          /* TEXT / CODE / URL content */
          <>
            {item.linkTitle && (
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: DS.textPrimary,
                  marginBottom: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {item.linkTitle}
              </div>
            )}
            <div style={clipPreviewStyle}>{item.editedText || item.preview}</div>
          </>
        )}

        {/* Meta row — always shown */}
        <div style={clipMetaStyle}>
          <span>{time}</span>
          {item.sourceApp && (
            <span style={{ color: DS.textDim }}>{item.sourceApp}</span>
          )}
          {showBadge && item.copyCount > 1 && (
            <span style={clipBadgeStyle}>&times;{item.copyCount}</span>
          )}
          {item.tags.length > 0 && (
            <span style={{ color: DS.textDim }}>
              {item.tags.slice(0, 2).map((t) => `#${t}`).join(' ')}
              {item.tags.length > 2 ? ` +${item.tags.length - 2}` : ''}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          flexShrink: 0,
          padding: '8px 8px 8px 0',
          opacity: hovered || isQueued ? 1 : 0,
          transition: 'opacity 0.15s'
        }}
      >
        <ActionButton
          icon={item.pinned ? '\u2605' : '\u2606'}
          defaultColor={item.pinned ? DS.yellow : DS.textGhost}
          hoverColor={DS.yellow}
          onClick={onPin}
        />
        <ActionButton
          icon="\u00D7"
          defaultColor={DS.textGhost}
          hoverColor={DS.red}
          onClick={onDelete}
        />
      </div>
    </div>
  )
}
