/**
 * ClipRow — Individual clipboard entry row.
 */

import { useState } from 'react'
import {
  DS,
  ActionButton,
  clipIconStyle,
  clipPreviewStyle,
  clipMetaStyle,
  clipBadgeStyle,
  type ClipboardItem
} from './shared'

export function ClipRow({
  item,
  icon,
  time,
  showBadge,
  isSelected,
  onSelect,
  onPin,
  onDelete,
  onDoubleClick,
  onContextMenu
}: {
  item: ClipboardItem
  icon: string
  time: string
  showBadge: boolean
  isSelected: boolean
  onSelect: () => void
  onPin: (e: React.MouseEvent) => void
  onDelete: (e: React.MouseEvent) => void
  onDoubleClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false)

  const rowBg = isSelected ? DS.bgLight : hovered ? DS.bgLight : 'transparent'

  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        padding: '10px 12px',
        borderRadius: 10,
        cursor: 'pointer',
        marginBottom: 2,
        transition: 'background 0.15s',
        alignItems: 'flex-start',
        background: rowBg
      }}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Icon — show favicon for URL clips if available */}
      {item.linkFavicon ? (
        <img
          src={item.linkFavicon}
          alt=""
          style={{ width: 20, height: 20, borderRadius: 4, flexShrink: 0, marginTop: 2 }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
      ) : (
        <div style={clipIconStyle}>{icon}</div>
      )}

      {/* Body */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {item.type === 'image' && item.imageDataUrl ? (
          <>
            <img
              src={item.imageDataUrl}
              alt="clipboard image"
              style={{
                maxWidth: 100,
                maxHeight: 60,
                borderRadius: 4,
                display: 'block'
              }}
            />
            {/* Show OCR text below image if available */}
            {item.ocrText && (
              <div style={{ fontSize: 9, color: DS.textDim, marginTop: 4, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                OCR: {item.ocrText.slice(0, 80)}{item.ocrText.length > 80 ? '...' : ''}
              </div>
            )}
          </>
        ) : (
          <>
            {/* Show link title for URL clips */}
            {item.linkTitle && (
              <div style={{ fontSize: 10, fontWeight: 600, color: DS.textPrimary, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.linkTitle}
              </div>
            )}
            <div style={clipPreviewStyle}>{item.preview}</div>
          </>
        )}

        {/* Meta row */}
        <div style={clipMetaStyle}>
          <span>{time}</span>
          {item.sourceApp && (
            <span style={{ color: DS.textDim }}>{item.sourceApp}</span>
          )}
          {showBadge && item.copyCount > 1 && (
            <span style={clipBadgeStyle}>&times;{item.copyCount}</span>
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
          flexShrink: 0
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
