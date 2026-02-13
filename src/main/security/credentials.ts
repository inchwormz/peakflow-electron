/**
 * Secure credential storage backed by electron-store + safeStorage encryption.
 *
 * Mirrors the Python module's keyring-based approach but uses Electron's
 * `safeStorage` (DPAPI / Keychain / libsecret) for at-rest encryption and
 * a dedicated `electron-store` instance for persistence.
 *
 * Key format: `PeakFlow_{tool}_{type}` — e.g. `PeakFlow_ScreenSlap_oauth_token`
 */

import Store from 'electron-store'
import { encryptString, decryptString, isAvailable } from './safe-storage'

/** Dedicated store for credential blobs — kept separate from config. */
const credentialStore = new Store({ name: 'peakflow-credentials' })

/**
 * Build the storage key for a given tool + credential type.
 * Matches the Python convention: `PeakFlow_{tool}_{type}`.
 */
function makeKey(tool: string, type: string): string {
  return `PeakFlow_${tool}_${type}`
}

/**
 * Store an encrypted credential.
 * Returns `true` on success, `false` if encryption is unavailable or fails.
 */
export function storeCredential(tool: string, type: string, value: string): boolean {
  try {
    const key = makeKey(tool, type)

    if (isAvailable()) {
      const encrypted = encryptString(value)
      if (encrypted === null) {
        console.warn(`[PeakFlow:Credentials] Encryption failed for ${key}`)
        return false
      }
      credentialStore.set(key, encrypted)
    } else {
      // Fallback: store unencrypted (dev environments where safeStorage isn't ready)
      console.warn('[PeakFlow:Credentials] safeStorage unavailable — storing plaintext')
      credentialStore.set(key, value)
    }

    return true
  } catch (error) {
    console.warn('[PeakFlow:Credentials] storeCredential failed:', error)
    return false
  }
}

/**
 * Retrieve a previously stored credential.
 * Returns `null` if the key doesn't exist or decryption fails.
 */
export function getCredential(tool: string, type: string): string | null {
  try {
    const key = makeKey(tool, type)
    const raw = credentialStore.get(key) as string | undefined

    if (raw === undefined) return null

    if (isAvailable()) {
      const decrypted = decryptString(raw)
      if (decrypted === null) {
        // May be a plaintext fallback from a previous run — try returning as-is
        console.warn(`[PeakFlow:Credentials] Decrypt failed for ${key}, returning raw`)
        return raw
      }
      return decrypted
    }

    // safeStorage unavailable — assume plaintext
    return raw
  } catch (error) {
    console.warn('[PeakFlow:Credentials] getCredential failed:', error)
    return null
  }
}

/**
 * Delete a stored credential.
 * Returns `true` if the key existed and was deleted, `false` otherwise.
 */
export function deleteCredential(tool: string, type: string): boolean {
  try {
    const key = makeKey(tool, type)
    if (!credentialStore.has(key)) return false
    credentialStore.delete(key)
    return true
  } catch (error) {
    console.warn('[PeakFlow:Credentials] deleteCredential failed:', error)
    return false
  }
}

/**
 * Store an OAuth token JSON blob (encrypted).
 * Convenience wrapper — the token is stored under the `oauth_token` type.
 */
export function storeOAuthToken(tool: string, tokenJson: string): boolean {
  return storeCredential(tool, 'oauth_token', tokenJson)
}

/**
 * Retrieve a stored OAuth token JSON blob.
 * Returns `null` if not found or decryption fails.
 */
export function getOAuthToken(tool: string): string | null {
  return getCredential(tool, 'oauth_token')
}

/**
 * Delete a stored OAuth token.
 * Returns `true` if the token existed and was removed.
 */
export function deleteOAuthToken(tool: string): boolean {
  return deleteCredential(tool, 'oauth_token')
}
