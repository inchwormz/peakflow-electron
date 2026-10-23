/**
 * Check: how PeakFlow finds the person's ChatGPT (Codex) and Claude CLIs.
 * - The login shell is not run at start-up or for a plain status check, only
 *   once AI is used, and as `-lc` (never interactive `-i`, which runs .zshrc).
 * - "Signed out" isn't trusted while the Connect AI screen is open (fresh), so
 *   it turns to Connected straight after sign-in.
 * - The Mac setup command checks for npm, installs into ~/.npm-global when
 *   npm's own folder needs an admin password, and signs in by full path.
 * Uses fake CLIs in a scratch home folder; nothing real is installed or run.
 * Run: node scripts/checks/local-ai-lookup.check.mts
 */
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const home = mkdtempSync(join(tmpdir(), 'pf-lookup-'))
const exe = (p: string, body: string): void => {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, `#!/bin/bash\n${body}\n`)
  chmodSync(p, 0o755)
}
// A fake login shell that records how it was started
exe(join(home, 'fake-shell'), `echo "$@" >> "${home}/shell-args"; printf "__PF_PATH__/usr/bin:/bin__PF_END__"`)
// A fake Codex that is signed in once the flag file exists
exe(join(home, '.local/bin/codex'), `echo x >> "${home}/codex-runs"; if [ "$1" = login ] && [ "$2" = status ]; then if [ -f "${home}/signed-in" ]; then echo "Logged in using ChatGPT"; exit 0; fi; echo "Not logged in"; exit 1; fi; exit 1`)
// Claude installed too, so both CLIs are cached by the first plain check
exe(join(home, '.local/bin/claude'), `if [ "$1" = auth ]; then echo '{"loggedIn": false}'; exit 1; fi; exit 1`)
process.env.HOME = home
process.env.SHELL = join(home, 'fake-shell')
process.env.PATH = '/usr/bin:/bin'

const stub = (src: string): string => `data:text/javascript,${encodeURIComponent(src)}`
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'electron') return { url: stub(`export const app = { getPath: () => ${JSON.stringify(join(home, 'userData'))} }`), shortCircuit: true }
    if (spec === 'electron-store') return { url: stub('export default class { get() {} set() {} delete() {} }'), shortCircuit: true }
    if (spec === './local-ai-args' || spec === './local-ai-spawn') return { url: pathToFileURL(join(root, `src/main/services/${spec.slice(2)}.ts`)).href, shortCircuit: true }
    return next(spec, ctx)
  }
})
const ai = await import(pathToFileURL(join(root, 'src/main/services/local-ai.ts')).href)
const codex = async (look?: object): Promise<{ installed: boolean; signedIn?: boolean }> => (await ai.listAiProviders(look)).find((p: { id: string }) => p.id === 'codex')

// Start-up / plain status: found in ~/.local/bin, signed out, and no shell run
assert.deepEqual(await codex(), { id: 'codex', label: 'ChatGPT', installed: true, signedIn: false })
assert.ok(!existsSync(join(home, 'shell-args')), 'login shell ran for a plain status check')

// Signs in: a plain check may still say signed out (30 s), the Connect AI screen sees it at once
writeFileSync(join(home, 'signed-in'), '')
assert.equal((await codex()).signedIn, false)
assert.equal((await codex({ deep: true, fresh: true })).signedIn, true)

// AI used: the login shell runs once, as -lc
await codex({ deep: true })
await codex({ deep: true })
const shellRuns = readFileSync(join(home, 'shell-args'), 'utf8').trim().split('\n')
assert.equal(shellRuns.length, 1, `login shell ran ${shellRuns.length} times`)
assert.ok(shellRuns[0].startsWith('-lc '), shellRuns[0])

// The Connect AI screen asks every few seconds: overlapping fresh checks share one CLI run
writeFileSync(join(home, 'codex-runs'), '')
const { unlinkSync } = await import('node:fs')
unlinkSync(join(home, 'signed-in'))
ai.refreshAiProviders()
await Promise.all([codex({ fresh: true }), codex({ fresh: true }), codex({ fresh: true })])
assert.equal(readFileSync(join(home, 'codex-runs'), 'utf8').trim().split('\n').length, 1)

// Mac setup for ChatGPT: npm's folder isn't writable, so it installs to ~/.npm-global and signs in by full path
const sys = join(home, 'sys')
mkdirSync(join(sys, 'lib/node_modules'), { recursive: true })
chmodSync(join(sys, 'lib/node_modules'), 0o555)
exe(join(home, 'fakebin/npm'), `if [ "$1" = prefix ]; then echo "${sys}"; exit 0; fi
if [ "$1" = install ]; then p="$4"; mkdir -p "$p/bin"; printf '#!/bin/bash\\necho "codex $@ via $0"\\n' > "$p/bin/codex"; chmod +x "$p/bin/codex"; echo "installed to $p"; exit 0; fi; exit 1`)
exe(join(home, 'fakebin/open'), `echo "open $@"`)
const setup = (path: string): string => {
  const r = spawnSync('/bin/bash', ['-c', ai.aiSetupCommand('codex')], { env: { HOME: home, PATH: path }, encoding: 'utf8' })
  return `${r.status} ${r.stdout}${r.stderr}`
}
const out = setup(`${join(home, 'fakebin')}:/usr/bin:/bin`)
assert.ok(out.startsWith('0 '), out)
assert.ok(out.includes(`installed to ${home}/.npm-global`), out)
assert.ok(out.includes(`codex login via ${home}/.npm-global/bin/codex`), out)
// No npm: says why, opens nodejs.org, stops
exe(join(home, 'nonpm/open'), `echo "open $@"`)
const none = setup(`${join(home, 'nonpm')}:/usr/bin:/bin`)
assert.ok(none.startsWith('1 ') && none.includes('needs Node.js') && none.includes('open https://nodejs.org'), none)
chmodSync(join(sys, 'lib/node_modules'), 0o755)

// Claude on a Mac signs in by full path
assert.ok(ai.aiSetupCommand('claude').includes('~/.local/bin/claude auth login'))
console.log('local-ai-lookup: ok')
process.exit(0)
