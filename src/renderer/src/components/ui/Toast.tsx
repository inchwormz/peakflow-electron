import { createContext, useCallback, useContext, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/* ─── Toast Types ────────────────────────────────────────────────────────── */

type ToastVariant = 'success' | 'error' | 'info'

interface ToastMessage {
  id: string
  text: string
  variant: ToastVariant
}

interface ToastContextValue {
  toast: (text: string, variant?: ToastVariant) => void
}

/* ─── Context ────────────────────────────────────────────────────────────── */

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return ctx
}

/* ─── Provider ───────────────────────────────────────────────────────────── */

interface ToastProviderProps {
  children: ReactNode
}

const TOAST_DURATION = 2500

export function ToastProvider({ children }: ToastProviderProps): React.JSX.Element {
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  const toast = useCallback((text: string, variant: ToastVariant = 'success') => {
    const id = Math.random().toString(36).slice(2, 10)
    setToasts((prev) => [...prev, { id, text, variant }])

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, TOAST_DURATION)
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {createPortal(
        <div style={containerStyle}>
          {toasts.map((t) => (
            <ToastItem key={t.id} message={t} />
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  )
}

/* ─── Toast Item ─────────────────────────────────────────────────────────── */

const variantColors: Record<ToastVariant, { bg: string; color: string }> = {
  success: { bg: '#4ae08a', color: '#0a0a0a' },
  error: { bg: '#f05858', color: '#ffffff' },
  info: { bg: '#5eb8ff', color: '#0a0a0a' }
}

function ToastItem({ message }: { message: ToastMessage }): React.JSX.Element {
  const colors = variantColors[message.variant]

  const style: CSSProperties = {
    background: colors.bg,
    color: colors.color,
    borderRadius: 20,
    padding: '8px 20px',
    fontSize: 11,
    fontWeight: 600,
    fontFamily: "'Be Vietnam Pro', 'Segoe UI', sans-serif",
    letterSpacing: '0.5px',
    animation: 'toast-fade 2.5s ease forwards',
    pointerEvents: 'auto',
    whiteSpace: 'nowrap'
  }

  return <div style={style}>{message.text}</div>
}

/* ─── Styles ─────────────────────────────────────────────────────────────── */

const containerStyle: CSSProperties = {
  position: 'fixed',
  bottom: 24,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 99999,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  pointerEvents: 'none'
}

/* Inject keyframe animation */
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement('style')
  styleSheet.textContent = `
    @keyframes toast-fade {
      0% { opacity: 0; transform: translateY(8px); }
      10% { opacity: 1; transform: translateY(0); }
      80% { opacity: 1; transform: translateY(0); }
      100% { opacity: 0; transform: translateY(-4px); }
    }
  `
  document.head.appendChild(styleSheet)
}
