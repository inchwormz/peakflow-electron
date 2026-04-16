import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..')
const licenseSource = readFileSync(join(repoRoot, 'src', 'main', 'security', 'license.ts'), 'utf8')

test('license policy fails closed on corrupt product ids', () => {
  assert.match(licenseSource, /if \(isNaN\(productId\)\) return false/)
})

test('license policy maps the known all-tools product explicitly', () => {
  assert.match(licenseSource, /863806:\s*'all'/)
})

test('unknown product ids do not default to all-tools access', () => {
  assert.match(licenseSource, /PRODUCT_TOOL_MAP\[productId\] \?\? null/)
})
