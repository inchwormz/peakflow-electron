import { useEffect, useState } from 'react'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'
import type { DictationAccount } from '@shared/dictation-account'
import { invoke } from '../panel/hooks'

// copy: Get dictation
const GET_DICTATION = 'Get dictation'
// copy: Add $5
const ADD_FIVE = 'Add $5'
// copy: Dictation balance
const BALANCE_LABEL = 'Dictation balance'
// copy: Dictation
const DICTATION_LABEL = 'Dictation'
// copy: $5 buys about 15 hours of talking. Unused time never expires.
const OFFER = '$5 buys about 15 hours of talking. Unused time never expires.'
// copy: Dictation is paused. Add $5 to keep going.
const PAUSED = 'Dictation is paused. Add $5 to keep going.'
// copy: Couldn’t open the checkout. Try again.
const CHECKOUT_ERROR = 'Couldn’t open the checkout. Try again.'

export function DictationAccountRow(): React.JSX.Element | null {
  const [account, setAccount] = useState<DictationAccount>({ state: 'hidden' })
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    let revision = 0
    const refresh = (): void => {
      const request = ++revision
      void invoke<DictationAccount>(IPC_INVOKE.DICTATION_ACCOUNT).then((value) => {
        if (live && request === revision) setAccount(value)
      }).catch(() => {
        if (live && request === revision) setAccount({ state: 'hidden' })
      })
    }
    refresh()
    window.addEventListener('focus', refresh)
    const shown = window.peakflow.on(IPC_SEND.LAUNCHER_SHOWN, refresh)
    const licensed = window.peakflow.on(IPC_SEND.LICENSE_STATUS_CHANGED, refresh)
    return () => {
      live = false
      window.removeEventListener('focus', refresh)
      shown()
      licensed()
    }
  }, [])
  if (account.state === 'hidden') return null
  const buy = account.state === 'no_addon'
  const empty = account.state === 'empty'
  let balance = ''
  if ('balanceMicros' in account) {
    const dollars = (account.balanceMicros / 1_000_000).toFixed(2)
    const hours = Math.round(account.minutesLeft / 60)
    const minutes = Math.round(account.minutesLeft)
    // copy: $4.07 left · about 15 hours (or about 1 hour / 30 minutes / 1 minute)
    balance = `$${dollars} left · about ${hours >= 1 ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`}`
  }
  const open = async (): Promise<void> => {
    setOpening(true)
    setError('')
    try {
      if (!await invoke<boolean>(IPC_INVOKE.DICTATION_CHECKOUT)) setError(CHECKOUT_ERROR)
    } catch {
      setError(CHECKOUT_ERROR)
    } finally {
      setOpening(false)
    }
  }
  return (
    <div className="lc-set">
      <div aria-live="polite">
        <div className="lbl">{buy ? DICTATION_LABEL : BALANCE_LABEL}</div>
        {buy && <div className="sub">{OFFER}</div>}
        {balance && <div className="sub">{balance}</div>}
        {empty && <div className="sub">{PAUSED}</div>}
        {error && <div className="sub" role="alert">{error}</div>}
      </div>
      {(buy || account.state === 'low' || empty) && (
        <button className="btn" disabled={opening} onClick={() => void open()}>{buy ? GET_DICTATION : ADD_FIVE}</button>
      )}
    </div>
  )
}
