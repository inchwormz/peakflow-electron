import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..')

test('release artifact paths exist after unpack build', () => {
  const expected = [
    join(repoRoot, 'release', 'win-unpacked', 'PeakFlow.exe'),
    join(repoRoot, 'release', 'win-unpacked', 'resources', 'app.asar'),
    join(repoRoot, 'release', 'win-unpacked', 'resources', 'tray-icon.png'),
    join(repoRoot, 'release', 'win-unpacked', 'resources', 'icon.png')
  ]

  for (const file of expected) {
    assert.equal(existsSync(file), true, `missing expected release artifact: ${file}`)
  }
})
