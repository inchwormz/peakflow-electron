import { state } from './state.mjs'
export const getWorkflowStatus = () => ({ active: state.workflow })
export const workflowPasteNext = () => { state.calls.push('workflow-paste'); return { active: true, current: 1, total: 2, label: '' } }
