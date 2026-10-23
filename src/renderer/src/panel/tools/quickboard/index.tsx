/**
 * QuickBoard in the v2 panel. Wired to the existing clipboard service
 * (clipboard:* IPC); behaviour is unchanged, only the UI is new.
 * Prototype routes: quickboard (+ filter, search, empty, select, queue,
 * suggestions states), edit, transform, translate, AI processing/error,
 * workflows(/edit), forms(/edit), setup/1–4, settings/*.
 */

import { useEffect } from 'react'
import type { PanelToolModule } from '../../types'
import { usePanelVisible } from '../../hooks'
import { MainList } from './MainList'
import { AiRun, EditClip, PasteAs, Translate } from './ClipPages'
import { EditForm, EditWorkflow, Forms, Workflows } from './Sequences'
import { Setup1, Setup2, Setup3, Setup4, SetupError, SetupGenerating } from './Setup'
import { AiSettings, EditPipeline, General, ImportExport, SettingsRoot, Shortcuts, TransformsPage } from './Settings'
import { reloadHistory, useQB } from './store'

function useStatus(): string {
  const s = useQB()
  const visible = usePanelVisible()
  useEffect(() => {
    if (visible) reloadHistory()
  }, [visible])
  if (!s.history) return ''
  const n = s.history.length
  return `${n} ${n === 1 ? 'clip' : 'clips'}`
}

export const quickboardTool: PanelToolModule = {
  id: 'quickboard',
  name: 'QuickBoard',
  desc: 'Clipboard history, snippets and paste tools',
  icon: 'quickboard',
  useStatus,
  routes: {
    quickboard: { kind: 'tool', tool: 'quickboard', view: MainList },
    'quickboard/edit/:id': { kind: 'sub', back: 'quickboard', title: 'Edit clip', view: EditClip },
    'quickboard/transform/:id': { kind: 'sub', back: 'quickboard', title: 'Paste as…', view: PasteAs },
    'quickboard/translate/:id': { kind: 'sub', back: 'quickboard', title: 'Translate to', view: Translate },
    'quickboard/ai/:id/:type/:lang': { kind: 'sub', back: 'quickboard', title: 'Paste as…', view: AiRun },
    'quickboard/workflows': { kind: 'sub', back: 'quickboard', title: 'Workflows', view: Workflows },
    'quickboard/workflows/edit/:id': { kind: 'sub', back: 'quickboard/workflows', title: (p) => (p.id === 'new' ? 'New workflow' : 'Edit workflow'), view: EditWorkflow },
    'quickboard/forms': { kind: 'sub', back: 'quickboard', title: 'Forms', view: Forms },
    'quickboard/forms/edit/:id': { kind: 'sub', back: 'quickboard/forms', title: (p) => (p.id === 'new' ? 'New form' : 'Edit form'), view: EditForm },
    'quickboard/setup/1': { kind: 'sub', back: 'quickboard/settings/ai', title: 'QuickBoard setup', view: Setup1 },
    'quickboard/setup/2': { kind: 'sub', back: 'quickboard/setup/1', title: 'QuickBoard setup', view: Setup2 },
    'quickboard/setup/3': { kind: 'sub', back: 'quickboard/setup/2', title: 'QuickBoard setup', view: Setup3 },
    'quickboard/setup/generating': { kind: 'sub', back: 'quickboard/setup/3', title: 'QuickBoard setup', view: SetupGenerating },
    'quickboard/setup/4': { kind: 'sub', back: 'quickboard/setup/3', title: 'QuickBoard setup', view: Setup4 },
    'quickboard/setup/error': { kind: 'sub', back: 'quickboard/setup/3', title: 'QuickBoard setup', view: SetupError },
    'quickboard/settings': { kind: 'sub', back: 'quickboard', title: 'QuickBoard settings', view: SettingsRoot },
    'quickboard/settings/general': { kind: 'sub', back: 'quickboard/settings', title: 'General', view: General },
    'quickboard/settings/transforms': { kind: 'sub', back: 'quickboard/settings', title: 'Transforms', view: TransformsPage },
    'quickboard/settings/pipeline/:id': { kind: 'sub', back: 'quickboard/settings/transforms', title: (p) => (p.id === 'new' ? 'New pipeline' : 'Edit pipeline'), view: EditPipeline },
    'quickboard/settings/hotkeys': { kind: 'sub', back: 'quickboard/settings', title: 'Shortcuts', view: Shortcuts },
    'quickboard/settings/data': { kind: 'sub', back: 'quickboard/settings', title: 'Import and export', view: ImportExport },
    'quickboard/settings/ai': { kind: 'sub', back: 'quickboard/settings', title: 'AI', view: AiSettings }
  }
}
