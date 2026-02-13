/**
 * PeakFlow Security Module — barrel re-exports.
 *
 * Import from `./security` to access all security functionality.
 *
 * @example
 * ```ts
 * import { checkAccess, looksLikeSecret, isExcludedApp } from './security'
 * ```
 */

// Encryption primitives
export {
  isAvailable as isSafeStorageAvailable,
  encryptString,
  decryptString,
  encryptJson,
  decryptJson
} from './safe-storage'

// Credential management
export {
  storeCredential,
  getCredential,
  deleteCredential,
  storeOAuthToken,
  getOAuthToken,
  deleteOAuthToken
} from './credentials'

// Secret detection
export { looksLikeSecret, hasHighEntropy } from './secret-detection'

// Excluded applications
export { EXCLUDED_APPS, isExcludedApp } from './excluded-apps'

// Trial management
export { TRIAL_DAYS, getInstallDate, getTrialDaysRemaining, isTrialActive } from './trial'

// License validation
export {
  LICENSE_CACHE_DAYS,
  CHECKOUT_URL,
  isLicensed,
  validateLicenseOnline,
  activateLicense,
  deactivateLicense
} from './license'

// Access gate
export { checkAccess } from './access-check'
