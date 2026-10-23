// Stand-in for PeakFlowHelper used by helper-client.check.mts.
// Modes: crash (exit at once), echo (reply "<id> {"cmd":...}"),
// slow (first "slow" request answered after 250 ms, others at once), hang (never reply).
import { createInterface } from 'node:readline'

const mode = process.argv[2]
if (mode === 'crash') process.exit(3)

const rl = createInterface({ input: process.stdin })
let slowSeen = false
rl.on('line', (line) => {
  const m = /^(\d+) (\S+)/.exec(line)
  if (line === 'exit') process.exit(0)
  if (!m || mode === 'hang') return
  const [, id, cmd] = m
  const reply = () => process.stdout.write(`${id} ${JSON.stringify({ cmd, id: Number(id) })}\n`)
  if (mode === 'slow' && cmd === 'slow' && !slowSeen) {
    slowSeen = true
    setTimeout(reply, 250)
  } else {
    reply()
  }
})
