import type { CSSProperties } from 'react'

interface SliderProps {
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (value: number) => void
  size?: 'standard' | 'small'
  disabled?: boolean
  'aria-label'?: string
}

/**
 * Range slider matching PeakFlow desktop design specs.
 * Standard: 4px track, 16px thumb
 * Small:    3px track, 12px thumb
 */
export function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  size = 'standard',
  disabled = false,
  'aria-label': ariaLabel
}: SliderProps): React.JSX.Element {
  const isSmall = size === 'small'
  const trackHeight = isSmall ? 3 : 4
  const thumbSize = isSmall ? 12 : 16

  // Calculate fill percentage
  const percent = ((value - min) / (max - min)) * 100

  const containerStyle: CSSProperties = {
    position: 'relative',
    width: '100%',
    height: thumbSize,
    display: 'flex',
    alignItems: 'center',
    opacity: disabled ? 0.5 : 1
  }

  const trackStyle: CSSProperties = {
    position: 'absolute',
    width: '100%',
    height: trackHeight,
    borderRadius: trackHeight / 2,
    background: '#1a1a1a'
  }

  const fillStyle: CSSProperties = {
    position: 'absolute',
    height: trackHeight,
    borderRadius: trackHeight / 2,
    background: '#ffffff',
    width: `${percent}%`,
    transition: 'width 0.05s ease'
  }

  const inputStyle: CSSProperties = {
    position: 'absolute',
    width: '100%',
    height: thumbSize,
    margin: 0,
    padding: 0,
    opacity: 0,
    cursor: disabled ? 'not-allowed' : 'pointer',
    zIndex: 2
  }

  // We use a CSS-in-JS approach for the thumb via a style tag
  // since range input thumbs can't be fully styled via inline styles
  const sliderId = `slider-${Math.random().toString(36).slice(2, 8)}`

  return (
    <div style={containerStyle}>
      <style>{`
        #${sliderId}::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: ${thumbSize}px;
          height: ${thumbSize}px;
          border-radius: 50%;
          background: #ffffff;
          border: none;
          cursor: ${disabled ? 'not-allowed' : 'pointer'};
        }
        #${sliderId} {
          -webkit-appearance: none;
          background: transparent;
        }
      `}</style>

      {/* Track background */}
      <div style={trackStyle} />

      {/* Track fill */}
      <div style={fillStyle} />

      {/* Native range input */}
      <input
        id={sliderId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        aria-label={ariaLabel}
        style={inputStyle}
      />
    </div>
  )
}
