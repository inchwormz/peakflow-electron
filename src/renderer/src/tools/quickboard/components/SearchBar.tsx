/**
 * SearchBar — QuickBoard search input.
 */

import { forwardRef } from 'react'
import { DS, searchBoxStyle } from './shared'

interface SearchBarProps {
  searchQuery: string
  onSearchChange: (query: string) => void
}

export const SearchBar = forwardRef<HTMLInputElement, SearchBarProps>(
  function SearchBar({ searchQuery, onSearchChange }, ref) {
    return (
      <div style={{ padding: '12px 24px 0' }}>
        <input
          ref={ref}
          type="text"
          placeholder="Search clips..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          style={searchBoxStyle}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = DS.white
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = DS.border
          }}
        />
      </div>
    )
  }
)
