import { useEffect } from 'react'

/**
 * Electron frameless windows on Windows can report a larger CSS viewport (100vh)
 * than the actual client area. Pin layout height to window.innerHeight instead.
 */
export function useWindowInnerHeight(): void {
  useEffect(() => {
    const sync = (): void => {
      const w = window.innerWidth
      const h = window.innerHeight
      document.documentElement.style.setProperty('--window-inner-width', `${w}px`)
      document.documentElement.style.setProperty('--window-inner-height', `${h}px`)
      document.documentElement.style.width = `${w}px`
      document.documentElement.style.height = `${h}px`
      document.body.style.width = `${w}px`
      document.body.style.height = `${h}px`
      const root = document.getElementById('root')
      if (root) {
        root.style.width = `${w}px`
        root.style.height = `${h}px`
      }
    }

    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])
}
