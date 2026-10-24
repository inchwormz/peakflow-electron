// Release guard: the dictation top-up links are baked into out/main at build
// time from MAIN_VITE_DICTATION_TOPUP_URL_5/_10/_20 (src/main/dictation/account.ts).
// If a tier's link was missing at build time, PeakFlow ships without it.
// Run after `npm run build`, before electron-builder. Never prints env values.
// Env is loaded exactly as electron-vite does for production builds.
// TOPUP_CHECK_OUT_DIR overrides the built main folder (used only for testing the guard).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = process.env.TOPUP_CHECK_OUT_DIR || join(root, 'out', 'main')

// Same resolution as vite: .env, .env.local, .env.production, .env.production.local,
// then real process.env values (with the MAIN_VITE_ prefix) take precedence.
const env = { ...loadEnv('production', root, 'MAIN_VITE_') }
for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith('MAIN_VITE_') && value !== undefined) env[key] = value
}

// Mirrors src/main/dictation/account.ts: _5 falls back to the legacy single link.
const tiers = [
  { name: 'US$5', value: env.MAIN_VITE_DICTATION_TOPUP_URL_5 || env.MAIN_VITE_DICTATION_TOPUP_URL },
  { name: 'US$10', value: env.MAIN_VITE_DICTATION_TOPUP_URL_10 },
  { name: 'US$20', value: env.MAIN_VITE_DICTATION_TOPUP_URL_20 },
]

const problems = []
for (const tier of tiers) {
  if (!tier.value) problems.push(`${tier.name} link not set`)
}

if (!existsSync(outDir)) {
  console.error(`topup-links: FAIL. built main process folder is missing. Run \`npm run build\` first.`)
  process.exit(1)
}
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f)
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : []
})
const built = walk(outDir).map((file) => readFileSync(file, 'utf8')).join('\n')

for (const tier of tiers) {
  if (tier.value && !built.includes(tier.value)) problems.push(`${tier.name} link not in the built bundle`)
}

if (problems.length) {
  for (const problem of problems) console.error(`topup-links: FAIL. ${problem}. Release builds need all three dictation top-up links; see .env.example`)
  process.exit(1)
}
console.log('topup-links: OK. all three top-up links are in the built main process.')
