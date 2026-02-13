/**
 * Secret detection utilities.
 *
 * Identifies strings that look like API keys, tokens, credit card numbers,
 * SSNs, or other secrets — used to prevent sensitive data from being
 * captured by QuickBoard or logged by ScreenSlap.
 *
 * Direct port of the Python `peakflow_security.py` secret-detection module.
 */

// ─── Sensitive Patterns ─────────────────────────────────────────────────────

/** Compiled patterns that match common secret formats. */
const SENSITIVE_PATTERNS: RegExp[] = [
  /^[a-zA-Z0-9_\-]{40,}$/,                         // Long alphanumeric (API keys)
  /^[0-9a-fA-F]{32,}$/,                             // Hex strings (hashes)
  /^AKIA[0-9A-Z]{16}$/,                              // AWS access keys
  /^gh[ps]_[A-Za-z0-9_]{36,}$/,                      // GitHub tokens
  /^sk[-_][a-zA-Z0-9]{20,}$/,                        // Stripe-style keys
  /^\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}$/,    // Credit card numbers
  /^\d{3}[-\s]?\d{2}[-\s]?\d{4}$/                    // SSN
]

// ─── Entropy ────────────────────────────────────────────────────────────────

/**
 * Calculate Shannon entropy for a string.
 *
 * Higher entropy = more random-looking = more likely a secret.
 * Typical English text scores ~3.5-4.0, random API keys score 4.5+.
 *
 * @param text    - The string to analyse
 * @param threshold - Entropy value above which the string is considered high-entropy (default 4.5)
 * @returns `true` if the string's entropy exceeds the threshold
 */
export function hasHighEntropy(text: string, threshold = 4.5): boolean {
  if (text.length === 0) return false

  // Count character frequencies
  const freq = new Map<string, number>()
  for (const ch of text) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1)
  }

  // Shannon entropy: -sum( p * log2(p) )
  const len = text.length
  let entropy = 0
  for (const count of freq.values()) {
    const p = count / len
    entropy -= p * Math.log2(p)
  }

  return entropy > threshold
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Determine whether a string looks like a secret or sensitive value.
 *
 * Applies the same heuristics as the Python implementation:
 *   1. Skip strings shorter than 8 characters
 *   2. Skip multi-line strings (newlines)
 *   3. Skip "sentence-like" strings (more than 3 whitespace-separated words)
 *   4. Check against all regex patterns
 *   5. For single-token strings >= 20 chars, run entropy analysis
 *
 * @param text - The candidate string to check
 * @returns `true` if the string matches a known secret pattern or has high entropy
 */
export function looksLikeSecret(text: string): boolean {
  try {
    // Too short to be a meaningful secret
    if (text.length < 8) return false

    // Multi-line strings are not secrets
    if (text.includes('\n') || text.includes('\r')) return false

    // Sentence-like text (more than 3 words) — skip
    const words = text.trim().split(/\s+/)
    if (words.length > 3) return false

    // Check against known secret patterns
    const trimmed = text.trim()
    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(trimmed)) return true
    }

    // Entropy check for single-token strings >= 20 chars
    if (words.length === 1 && trimmed.length >= 20) {
      if (hasHighEntropy(trimmed)) return true
    }

    return false
  } catch (error) {
    console.warn('[PeakFlow:SecretDetection] looksLikeSecret failed:', error)
    return false
  }
}
