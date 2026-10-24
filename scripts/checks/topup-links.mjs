// Release guard: the dictation top-up links are baked into out/main at build
// time from MAIN_VITE_DICTATION_TOPUP_URL_5/_10/_20 (src/main/dictation/account.ts).
// If they were missing at build time, PeakFlow ships with no top-up links.
// Run after `npm run build`, before electron-builder. Never prints env values.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const names = ['MAIN_VITE_DICTATION_TOPUP_URL_5', 'MAIN_VITE_DICTATION_TOPUP_URL_10', 'MAIN_VITE_DICTATION_TOPUP_URL_20']
const urlPattern = /https:\/\/[a-z0-9-]+\.lemonsqueezy\.com\/checkout\/buy\/[A-Za-z0-9-]+/g
const fail = (message) => { console.error(`topup-links: FAIL. ${message}`); process.exit(1) }

// Names set in .env (values are only checked for presence, never printed).
const envNames = new Set()
const envPath = join(root, '.env')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (m && m[2].trim() !== '') envNames.add(m[1])
  }
}
const missingEnv = names.filter((n) => !envNames.has(n) && !(process.env[n] || '').trim())

// Collect every built main-process chunk.
const mainDir = join(root, 'out', 'main')
if (!existsSync(mainDir)) fail('out/main is missing. Run `npm run build` first.')
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f)
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : []
})
const found = new Set()
for (const file of walk(mainDir)) {
  for (const url of readFileSync(file, 'utf8').match(urlPattern) ?? []) found.add(url)
}

if (missingEnv.length) console.error(`topup-links: not set in .env or the environment: ${missingEnv.join(', ')}`)
if (found.size < names.length) {
  fail(`built main process has ${found.size} of ${names.length} dictation top-up checkout links. ` +
    'Release builds need the three dictation top-up links; see .env.example')
}
if (missingEnv.length) {
  fail(`${missingEnv.length} top-up link name(s) missing. Release builds need the three dictation top-up links; see .env.example`)
}
console.log(`topup-links: OK. built main process contains ${found.size} distinct top-up checkout links.`)
