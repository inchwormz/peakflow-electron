/**
 * Writes the guide's drawings (src/shared/permission-art.ts) for the website's
 * getpeakflow.pro/mac-permissions pages, so the app and the site show the same
 * pictures. One JSON file: { en|de|es: { step: svg } }.
 * Run: node scripts/export-permission-art.mts <out.json>
 */
import { writeFileSync } from 'node:fs'
import { permissionArt, ART_LABELS_EN, type ArtLabels, type ArtStep } from '../src/shared/permission-art.ts'

// The names macOS itself shows in each language
const LABELS: Record<string, { accessibility: ArtLabels; microphone: ArtLabels }> = {
  en: { accessibility: ART_LABELS_EN, microphone: { ...ART_LABELS_EN, list: 'Microphone' } },
  de: {
    accessibility: { list: 'Bedienungshilfen', other: 'Andere App', applications: 'Programme', open: 'Öffnen', cancel: 'Abbrechen' },
    microphone: { list: 'Mikrofon', other: 'Andere App', applications: 'Programme', open: 'Öffnen', cancel: 'Abbrechen' }
  },
  es: {
    accessibility: { list: 'Accesibilidad', other: 'Otra app', applications: 'Aplicaciones', open: 'Abrir', cancel: 'Cancelar' },
    microphone: { list: 'Micrófono', other: 'Otra app', applications: 'Aplicaciones', open: 'Abrir', cancel: 'Cancelar' }
  }
}
const STEPS: ArtStep[] = ['remove', 'add', 'choose', 'switch']
const out: Record<string, Record<string, string>> = {}
for (const [lang, l] of Object.entries(LABELS)) {
  out[lang] = {}
  // The page's <figcaption> carries the words; the label here is filled in by the page builder
  for (const s of STEPS) out[lang][s] = permissionArt(s, '@@ALT@@', l.accessibility)
  out[lang].toggle = permissionArt('toggle', '@@ALT@@', l.microphone)
}
writeFileSync(process.argv[2], JSON.stringify(out))
console.log(`wrote ${process.argv[2]}`)
