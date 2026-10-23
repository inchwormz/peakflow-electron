// Module hooks for checks that load real src/ files: '@shared/x' → src/shared/x.ts,
// extensionless relative imports → .ts, TypeScript (incl. enums) via esbuild,
// and named specifiers replaced by fakes: installTsHooks({ 'electron': url, './panel': url }).
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { transformSync } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
export const srcUrl = (p) => pathToFileURL(join(root, p)).href

export function installTsHooks(fakes = {}) {
  registerHooks({
    resolve(spec, ctx, next) {
      if (fakes[spec]) return { url: fakes[spec], shortCircuit: true }
      if (spec.startsWith('@shared/')) return { url: srcUrl('src/shared/' + spec.slice(8) + '.ts'), shortCircuit: true }
      if (spec.startsWith('.') && ctx.parentURL?.endsWith('.ts') && !/\.[cm]?[jt]s$/.test(spec)) return next(spec + '.ts', ctx)
      return next(spec, ctx)
    },
    load(url, ctx, next) {
      if (!url.startsWith('file:') || !url.endsWith('.ts')) return next(url, ctx)
      const src = readFileSync(fileURLToPath(url), 'utf8')
      let code = transformSync(src, { loader: 'ts', format: 'esm' }).code
      // Main-process files are bundled as CommonJS and use __dirname
      if (code.includes('__dirname')) code = `const __dirname = ${JSON.stringify(dirname(fileURLToPath(url)))};\n` + code
      return { format: 'module', source: code, shortCircuit: true }
    }
  })
}

/** A fake module from source text. */
export const fake = (code) => 'data:text/javascript,' + encodeURIComponent(code)
