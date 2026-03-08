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

function runSwiftBuild() {
  const result = spawnSync('swift', ['build', '-c', 'release'], {
    cwd: helperRoot,
    stdio: 'inherit'
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function findBuiltHelper() {
  const candidates = [
    path.join(helperRoot, '.build', 'apple', 'Products', 'Release', 'PeakFlowHelper'),
    path.join(helperRoot, '.build', 'release', 'PeakFlowHelper')
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  throw new Error('PeakFlowHelper binary not found after swift build')
}

function copyHelper(sourcePath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.copyFileSync(sourcePath, outputPath)
  fs.chmodSync(outputPath, 0o755)
  console.log(`[prepare-mac-helper] Copied helper to ${outputPath}`)
}

if (ensureMac()) {
  runSwiftBuild()
  copyHelper(findBuiltHelper())
}
