/**
 * QuickBoard's "paste the next one" actions (paste queue, workflows, form
 * fill). Every entry point that pastes (the panel over IPC and the
 * ⇧⌘N / Ctrl+Shift+N shortcut) goes through here, so each paste needs
 * QuickBoard access. The licensing rules themselves live in checkAccess.
 */

import { ToolId } from '@shared/tool-ids'
import { checkAccess } from './security/access-check'
import { withToolAccess } from './security/access-guard'
import { startQueue, pasteNext } from './services/clipboard-sequential'
import { getWorkflowStatus, workflowPasteNext } from './services/clipboard-workflows'
import { getFormFillStatus, formPasteNext } from './services/clipboard-forms'

const guard = <T>(action: () => T, denied: () => T): Promise<T> => withToolAccess(checkAccess, ToolId.QuickBoard, action, denied)

export function guardedQueueStart(itemIds: string[]): Promise<void> {
  return guard(() => startQueue(itemIds), () => {})
}

export function guardedQueueNext(): Promise<boolean> {
  return guard(() => pasteNext(), () => false)
}

export function guardedWorkflowPasteNext(): Promise<ReturnType<typeof workflowPasteNext>> {
  return guard(() => workflowPasteNext(), () => null)
}

export function guardedFormPasteNext(): Promise<ReturnType<typeof formPasteNext>> {
  return guard(() => formPasteNext(), () => null)
}

/** The paste-next shortcut: the active workflow, else the form fill, else the paste queue. */
export function guardedPasteNextAny(): Promise<void> {
  return guard(() => {
    if (getWorkflowStatus().active) workflowPasteNext()
    else if (getFormFillStatus().active) formPasteNext()
    else pasteNext()
  }, () => {})
}
