const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const projectRoot = path.resolve(__dirname, '..')
const helperRoot = path.join(projectRoot, 'sidecar', 'darwin', 'PeakFlowHelper')
const outputPath = path.join(projectRoot, 'resources', 'darwin', 'peakflow-helper')

function ensureMac() {
  if (process.platform !== 'darwin') {
    console.log('[prepare-mac-helper] Skipping helper build on non-macOS host')
    return false
  }

  return true
}

// Build one binary per CPU with the plain SwiftPM build system (works with the
// Command Line Tools; multi-arch `--arch a --arch b` needs full Xcode), then
// merge them with lipo so one helper serves both the Apple-silicon and the
// Intel downloads.
const TRIPLES = ['arm64-apple-macosx13.0', 'x86_64-apple-macosx13.0']

function runSwiftBuild() {
  for (const triple of TRIPLES) {
    const result = spawnSync('swift', ['build', '-c', 'release', '--triple', triple], {
      cwd: helperRoot,
      stdio: 'inherit'
    })
    if (result.status !== 0) {
      process.exit(result.status ?? 1)
    }
  }
}

function findBuiltHelper() {
  const slices = TRIPLES.map((triple) =>
    path.join(helperRoot, '.build', triple.replace(/13\.0$/, ''), 'release', 'PeakFlowHelper')
  )
  for (const slice of slices) {
    if (!fs.existsSync(slice)) {
      throw new Error(`PeakFlowHelper slice not found after swift build: ${slice}`)
    }
  }

  const universal = path.join(helperRoot, '.build', 'PeakFlowHelper-universal')
  const lipo = spawnSync('lipo', ['-create', ...slices, '-output', universal], { stdio: 'inherit' })
  if (lipo.status !== 0) {
    process.exit(lipo.status ?? 1)
  }
  return universal
}

function copyHelper(sourcePath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  // Replace, don't overwrite: writing over a signed Mach-O in place keeps the
  // kernel's cached signature, and macOS then kills the new binary (exit 137).
  fs.rmSync(outputPath, { force: true })
  fs.copyFileSync(sourcePath, outputPath)
  fs.chmodSync(outputPath, 0o755)
  console.log(`[prepare-mac-helper] Copied helper to ${outputPath}`)
}

if (ensureMac()) {
  runSwiftBuild()
  copyHelper(findBuiltHelper())
}
