/**
 * Check (2.1 review, release 2.1.1): no relative require() in the main process.
 *
 * electron-vite bundles src/main into one file (out/main/index.js) and leaves a
 * relative require('./services/bug-report') as it is. At run time there is no
 * such file next to the bundle, so the call throws: "Send Crash Report" after a
 * freeze, the Liquid Focus close guard and FocusDim's tray refresh all broke
 * this way. Use a static import instead (hotkeys.ts was fixed the same way).
 *
 * Scans the source, skipping comments. If a built bundle exists, scans it too.
 * Run: node scripts/checks/main-require.check.mts
 */
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const RELATIVE_REQUIRE = /\brequire\(\s*['"`]\.{1,2}\//

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return files(p)
    return /\.(ts|mts|cts|js)$/.test(name) ? [p] : []
  })
}

/** Lines with a relative require() outside // and block comments. */
export function relativeRequires(source: string): number[] {
  const hits: number[] = []
  let inBlock = false
  source.split('\n').forEach((raw, i) => {
    let line = raw
    if (inBlock) {
      const end = line.indexOf('*/')
      if (end < 0) return
      line = line.slice(end + 2)
      inBlock = false
    }
    line = line.replace(/\/\*.*?\*\//g, '')
    const open = line.indexOf('/*')
    if (open >= 0) {
      inBlock = true
      line = line.slice(0, open)
    }
    const code = line.replace(/\/\/.*$/, '')
    if (RELATIVE_REQUIRE.test(code)) hits.push(i + 1)
  })
  return hits
}

// The check itself must catch the pattern that shipped in 2.1.0
assert.deepEqual(relativeRequires("      const { sendViaEmail } = require('./services/bug-report')"), [1])
assert.deepEqual(relativeRequires("      const { rebuildTray } = require('../tray')"), [1])
assert.deepEqual(relativeRequires("// require('./active-window-win32') would look for a file that does not exist."), [])
assert.deepEqual(relativeRequires("const K = require('koffi')"), [])

const bad: string[] = []
for (const f of files(join(root, 'src/main'))) {
  for (const line of relativeRequires(readFileSync(f, 'utf8'))) bad.push(`${relative(root, f)}:${line}`)
}
assert.deepEqual(bad, [], `relative require() in the main process (use a static import):\n${bad.join('\n')}`)

// The built bundle: a relative require() is fine only when the bundler emitted
// that file next to it (a lazy chunk such as clipboard-link-preview-*.js)
const bundle = join(root, 'out/main/index.js')
if (existsSync(bundle)) {
  const missing = [...readFileSync(bundle, 'utf8').matchAll(/\brequire\(\s*['"`](\.{1,2}\/[^'"`]+)['"`]\s*\)/g)]
    .map((m) => m[1])
    .filter((target) => !existsSync(join(root, 'out/main', target)))
  assert.deepEqual(missing, [], `out/main/index.js requires files that aren't in the build: ${missing.join(', ')}. Rebuild, or fix the source`)
}

console.log('main-require: ok')
