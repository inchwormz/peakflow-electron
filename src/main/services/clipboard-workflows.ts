/**
 * Named workflow storage for QuickBoard.
 * Workflows are multi-step clipboard sequences (sequential paste queues)
 * pre-populated by AI onboarding or created manually.
 */

import Store from 'electron-store'
import { clipboard } from 'electron'
import { simulateCtrlV } from '../native/keyboard'

export interface WorkflowItem {
  label: string
  text: string
}

export interface Workflow {
  id: string
  name: string
  description: string
  items: WorkflowItem[]
  isAiGenerated: boolean
  createdAt: string
}

const store = new Store<{ workflows: Workflow[] }>({
  name: 'quickboard-workflows',
  defaults: { workflows: [] }
})

// ─── Active workflow state ───────────────────────────────────────────────────

let activeWorkflow: { workflow: Workflow; currentIndex: number } | null = null

// ─── CRUD ────────────────────────────────────────────────────────────────────

export function getWorkflows(): Workflow[] {
  return store.get('workflows', [])
}

export function saveWorkflow(workflow: Omit<Workflow, 'id' | 'createdAt'>): Workflow {
  const id = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const full: Workflow = {
    ...workflow,
    id,
    createdAt: new Date().toISOString()
  }
  const all = store.get('workflows', [])
  all.push(full)
  store.set('workflows', all)
  return full
}

export function saveBulkWorkflows(
  workflows: Array<{ name: string; description: string; items: WorkflowItem[] }>
): Workflow[] {
  const existing = store.get('workflows', [])
  const created: Workflow[] = workflows.map((w) => ({
    id: `wf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: w.name,
    description: w.description,
    items: w.items,
    isAiGenerated: true,
    createdAt: new Date().toISOString()
  }))
  store.set('workflows', [...existing, ...created])
  return created
}

export function deleteWorkflow(workflowId: string): Workflow[] {
  const all = store.get('workflows', [])
  const filtered = all.filter((w) => w.id !== workflowId)
  store.set('workflows', filtered)
  return filtered
}

export function updateWorkflow(
  workflowId: string,
  updates: Partial<Pick<Workflow, 'name' | 'description' | 'items'>>
): Workflow[] {
  const all = store.get('workflows', [])
  const idx = all.findIndex((w) => w.id === workflowId)
  if (idx >= 0) {
    Object.assign(all[idx], updates)
    store.set('workflows', all)
  }
  return all
}

// ─── Workflow execution (sequential paste) ───────────────────────────────────

export function startWorkflow(workflowId: string): { active: boolean; current: number; total: number; label: string } {
  const all = store.get('workflows', [])
  const wf = all.find((w) => w.id === workflowId)
  if (!wf || wf.items.length === 0) {
    return { active: false, current: 0, total: 0, label: '' }
  }
  activeWorkflow = { workflow: wf, currentIndex: 0 }
  // Write first item to clipboard
  clipboard.writeText(wf.items[0].text)
  return {
    active: true,
    current: 1,
    total: wf.items.length,
    label: wf.items[0].label
  }
}

export function workflowPasteNext(): { active: boolean; current: number; total: number; label: string } | null {
  if (!activeWorkflow) return null

  // Paste current
  setTimeout(() => simulateCtrlV(), 80)

  activeWorkflow.currentIndex++

  if (activeWorkflow.currentIndex >= activeWorkflow.workflow.items.length) {
    const total = activeWorkflow.workflow.items.length
    activeWorkflow = null
    return { active: false, current: total, total, label: '' }
  }

  // Write next item
  const next = activeWorkflow.workflow.items[activeWorkflow.currentIndex]
  clipboard.writeText(next.text)

  return {
    active: true,
    current: activeWorkflow.currentIndex + 1,
    total: activeWorkflow.workflow.items.length,
    label: next.label
  }
}

export function cancelWorkflow(): void {
  activeWorkflow = null
}

export function getWorkflowStatus(): { active: boolean; current: number; total: number; label: string } {
  if (!activeWorkflow) return { active: false, current: 0, total: 0, label: '' }
  const item = activeWorkflow.workflow.items[activeWorkflow.currentIndex]
  return {
    active: true,
    current: activeWorkflow.currentIndex + 1,
    total: activeWorkflow.workflow.items.length,
    label: item?.label ?? ''
  }
}
