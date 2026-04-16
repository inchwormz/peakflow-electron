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

test('main bundle does not keep source-layout QuickBoard runtime requires', () => {
  execSync(`${npmCommand()} run build`, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true
  })

  const bundle = readFileSync(join(repoRoot, 'out', 'main', 'index.js'), 'utf8')
  const forbiddenRequires = [
    `require("./services/clipboard-collections")`,
    `require("./services/clipboard-sequential")`,
    `require("./services/clipboard-transforms")`,
    `require("./services/clipboard-ai")`,
    `require("./services/clipboard-workflows")`,
    `require("./services/clipboard-forms")`,
    `require("./services/clipboard-suggestions")`,
    `require("./services/clipboard-ocr")`,
    `require("./native/keyboard")`
  ]

  for (const forbidden of forbiddenRequires) {
    assert.equal(
      bundle.includes(forbidden),
      false,
      `built main bundle still contains runtime source require: ${forbidden}`
    )
  }
})
