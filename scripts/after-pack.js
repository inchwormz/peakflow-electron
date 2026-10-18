/**
 * afterPack hook: drop koffi files the packaged platform can never load.
 *
 * koffi ships prebuilt binaries for ~18 OS/CPU pairs plus its C sources
 * (~84 MB). PeakFlow only loads the binary for the OS it runs on, so the
 * Mac app keeps darwin_* and the Windows app keeps win32_*. Runs before
 * code signing, so the signature covers the trimmed bundle.
 */

const fs = require('fs')
const path = require('path')

exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName // 'darwin' | 'win32' | 'linux'
  const resourcesDir =
    platform === 'darwin'
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : path.join(context.appOutDir, 'resources')

  const koffiDir = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules', 'koffi')
  if (!fs.existsSync(koffiDir)) {
    console.log('[after-pack] koffi not unpacked here; nothing to trim')
    return
  }

  let removed = 0
  for (const unused of ['src', 'vendor', 'doc']) {
    const target = path.join(koffiDir, unused)
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true })
      removed++
    }
  }

  const binDir = path.join(koffiDir, 'build', 'koffi')
  if (fs.existsSync(binDir)) {
    for (const entry of fs.readdirSync(binDir)) {
      if (!entry.startsWith(`${platform}_`)) {
        fs.rmSync(path.join(binDir, entry), { recursive: true, force: true })
        removed++
      }
    }
    console.log(`[after-pack] koffi binaries kept for ${platform}: ${fs.readdirSync(binDir).join(', ')}`)
  }
  console.log(`[after-pack] removed ${removed} unused koffi folders`)
}
