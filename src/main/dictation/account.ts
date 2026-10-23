import { shell } from 'electron'
import { fetchAddonStatus, type AddonAuth } from './addon'
import { createAccountClient } from './account-core'

/** Use the transcription path's licence and persistent device id. */
export function createDictationAccountClient(readAuth: () => AddonAuth | null): ReturnType<typeof createAccountClient> {
  return createAccountClient({
    topupUrls: {
      // The older single link still works as the $5 top-up
      5: import.meta.env.MAIN_VITE_DICTATION_TOPUP_URL_5 || import.meta.env.MAIN_VITE_DICTATION_TOPUP_URL,
      10: import.meta.env.MAIN_VITE_DICTATION_TOPUP_URL_10,
      15: import.meta.env.MAIN_VITE_DICTATION_TOPUP_URL_15,
      20: import.meta.env.MAIN_VITE_DICTATION_TOPUP_URL_20
    },
    readAuth,
    fetchStatus: fetchAddonStatus,
    openExternal: (url) => shell.openExternal(url)
  })
}
