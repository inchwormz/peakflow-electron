import { state } from './state.mjs'
export const getFormFillStatus = () => ({ active: state.form })
export const formPasteNext = () => { state.calls.push('form-paste'); return { active: true, current: 1, total: 2, label: '' } }
