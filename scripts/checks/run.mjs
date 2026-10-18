// Runs every scripts/checks/*.check.mts with Node's built-in TypeScript stripping.
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
let failed = 0
for (const file of readdirSync(dir).filter((f) => f.endsWith('.check.mts')).sort()) {
  const r = spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', join(dir, file)], { stdio: 'inherit' })
  if (r.status !== 0) { failed++; console.error(`FAIL ${file}`) }
}
process.exit(failed ? 1 : 0)
