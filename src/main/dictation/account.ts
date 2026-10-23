import { randomUUID } from 'node:crypto'
import { shell } from 'electron'
import Store from 'electron-store'
import { getCredential } from '../security/credentials'
import { createAccountClient } from './account-core'

const TOPUP_URL = import.meta.env.MAIN_VITE_DICTATION_TOPUP_URL
const API_URL = import.meta.env.MAIN_VITE_DICTATION_API_URL || 'https://getpeakflow.pro/api/dictation'
const store = new Store<{ deviceId: string }>({ name: 'dictation-account' })

function deviceId(): string {
  const saved = store.get('deviceId')
  if (typeof saved === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved)) return saved
  const id = randomUUID()
  store.set('deviceId', id)
  return id
}

const client = createAccountClient({
  topupUrl: TOPUP_URL,
  apiUrl: API_URL,
  readLicence: () => getCredential('license', 'key'),
  readDevice: deviceId,
  fetch: (url, init) => fetch(url, init),
  openExternal: (url) => shell.openExternal(url)
})

export const { getDictationAccount, openDictationCheckout } = client
