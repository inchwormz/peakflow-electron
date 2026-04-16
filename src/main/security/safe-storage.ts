/**
 * Electron safeStorage wrapper.
 *
 * Provides a thin abstraction over Electron's `safeStorage` API which uses
 * the OS-level credential store (DPAPI on Windows, Keychain on macOS,
 * libsecret on Linux) to encrypt/decrypt strings at rest.
 *
 * All functions are synchronous and return safe defaults on failure so the
 * caller never needs to catch.
 */

import { safeStorage } from 'electron'

/**
 * Check whether the OS credential backend is available.
 * Must be true before any encrypt/decrypt calls will succeed.
 */
export function isAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    console.warn('[PeakFlow:SafeStorage] Failed to check availability')
    return false
  }
}

/**
 * Encrypt a plaintext string and return it as a base64-encoded string.
 * Returns `null` if encryption is unavailable or fails.
 */
export function encryptString(data: string): string | null {
  try {
    if (!isAvailable()) {
      console.warn('[PeakFlow:SafeStorage] Encryption not available')
      return null
    }
    const encrypted = safeStorage.encryptString(data)
    return encrypted.toString('base64')
  } catch (error) {
    console.warn('[PeakFlow:SafeStorage] encryptString failed:', error)
    return null
  }
}

/**
 * Decrypt a base64-encoded encrypted string back to plaintext.
 * Returns `null` if decryption fails or the input is invalid.
 */
export function decryptString(encrypted: string, warnOnFailure = true): string | null {
  try {
    if (!isAvailable()) {
      console.warn('[PeakFlow:SafeStorage] Encryption not available')
      return null
    }
    const buffer = Buffer.from(encrypted, 'base64')
    return safeStorage.decryptString(buffer)
  } catch (error) {
    if (warnOnFailure) {
      console.warn('[PeakFlow:SafeStorage] decryptString failed:', error)
    }
    return null
  }
}

/**
 * Encrypt a JSON-serialisable object and return the base64 ciphertext.
 * Returns `null` on failure.
 */
export function encryptJson(data: Record<string, unknown>): string | null {
  try {
    const json = JSON.stringify(data)
    return encryptString(json)
  } catch (error) {
    console.warn('[PeakFlow:SafeStorage] encryptJson failed:', error)
    return null
  }
}

/**
 * Decrypt a base64 ciphertext back into a parsed JSON object.
 * Returns `null` if decryption or parsing fails.
 */
export function decryptJson(encrypted: string): Record<string, unknown> | null {
  try {
    const json = decryptString(encrypted)
    if (json === null) return null
    return JSON.parse(json) as Record<string, unknown>
  } catch (error) {
    console.warn('[PeakFlow:SafeStorage] decryptJson failed:', error)
    return null
  }
}
