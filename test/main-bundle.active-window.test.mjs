import test from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

test('main bundle does not keep source-layout active-window runtime requires', () => {
  execSync(`${npmCommand()} run build`, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true
  })

  const bundle = readFileSync(join(repoRoot, 'out', 'main', 'index.js'), 'utf8')
  for (const forbidden of [
    `require("./active-window-win32")`,
    `require("./active-window-darwin")`
  ]) {
    assert.equal(
      bundle.includes(forbidden),
      false,
      `built main bundle still contains runtime source require: ${forbidden}`
    )
  }
})
