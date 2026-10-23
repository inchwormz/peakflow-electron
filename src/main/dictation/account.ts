import { shell } from 'electron'
import { fetchAddonStatus, type AddonAuth } from './addon'
import { createAccountClient } from './account-core'

/** Use the transcription path's licence and persistent device id. */
export function createDictationAccountClient(readAuth: () => AddonAuth | null): ReturnType<typeof createAccountClient> {
  return createAccountClient({
    topupUrl: import.meta.env.MAIN_VITE_DICTATION_TOPUP_URL,
    readAuth,
    fetchStatus: fetchAddonStatus,
    openExternal: (url) => shell.openExternal(url)
  })
}
