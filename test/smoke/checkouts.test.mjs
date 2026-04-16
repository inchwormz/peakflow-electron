import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..')

const trialExpired = readFileSync(
  join(repoRoot, 'src', 'renderer', 'src', 'components', 'licensing', 'TrialExpired.tsx'),
  'utf8'
)
const statusBar = readFileSync(
  join(repoRoot, 'src', 'renderer', 'src', 'components', 'layout', 'StatusBar.tsx'),
  'utf8'
)

test('TrialExpired opens checkout through shell IPC, not window.open', () => {
  assert.match(trialExpired, /IPC_INVOKE\.SHELL_OPEN_EXTERNAL/)
  assert.doesNotMatch(trialExpired, /window\.open\(/)
})

test('StatusBar opens checkout through shell IPC, not window.open', () => {
  assert.match(statusBar, /IPC_INVOKE\.SHELL_OPEN_EXTERNAL/)
  assert.doesNotMatch(statusBar, /window\.open\(/)
})
