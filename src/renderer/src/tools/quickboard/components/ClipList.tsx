/**
 * ClipList — Virtualized scrolling list for clipboard items.
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { type ClipboardItem, emptyStateStyle } from './shared'

const ROW_HEIGHT = 64
const OVERSCAN = 5

interface ClipListProps {
  items: ClipboardItem[]
  selectedIndex: number
  renderRow: (item: ClipboardItem, index: number) => React.ReactNode
}

export function ClipList({ items, selectedIndex, renderRow }: ClipListProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(400)

  useEffect(() => {
    if (containerRef.current) {
      setContainerHeight(containerRef.current.clientHeight)
    }
  }, [])

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  // Auto-scroll to keep selected item visible
  useEffect(() => {
    if (!containerRef.current) return
    const itemTop = selectedIndex * ROW_HEIGHT
    const itemBottom = itemTop + ROW_HEIGHT
    const viewTop = containerRef.current.scrollTop
    const viewBottom = viewTop + containerRef.current.clientHeight

    if (itemTop < viewTop) {
      containerRef.current.scrollTop = itemTop
    } else if (itemBottom > viewBottom) {
      containerRef.current.scrollTop = itemBottom - containerRef.current.clientHeight
    }
  }, [selectedIndex])

  if (items.length === 0) {
    return <div style={emptyStateStyle}>No clips found</div>
  }

  const totalHeight = items.length * ROW_HEIGHT
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const endIndex = Math.min(items.length, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN)
  const visibleItems = items.slice(startIndex, endIndex)

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '0 24px 16px',
        minHeight: 0
      }}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        {visibleItems.map((item, i) => (
          <div
            key={item.id}
            style={{
              position: 'absolute',
              top: (startIndex + i) * ROW_HEIGHT,
              left: 0,
              right: 0
            }}
          >
            {renderRow(item, startIndex + i)}
          </div>
        ))}
      </div>
    </div>
  )
}
