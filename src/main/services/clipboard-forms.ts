/**
 * Form Fill Profiles for QuickBoard.
 * Named profiles of ordered field values for rapid form completion.
 * Uses sequential paste engine for field-by-field pasting.
 */

import Store from 'electron-store'
import { clipboard } from 'electron'
import { simulateCtrlV } from '../native/keyboard'

export interface FormField {
  label: string
  value: string
  type: 'text' | 'template'
}

export interface FormProfile {
  id: string
  name: string
  fields: FormField[]
  createdAt: string
  isAiGenerated: boolean
}

const store = new Store<{ profiles: FormProfile[] }>({
  name: 'quickboard-forms',
  defaults: { profiles: [] }
})

// ─── Active form fill state ──────────────────────────────────────────────────

let activeFill: { profile: FormProfile; currentIndex: number } | null = null

// ─── CRUD ────────────────────────────────────────────────────────────────────

export function getFormProfiles(): FormProfile[] {
  return store.get('profiles', [])
}

export function saveFormProfile(
  profile: Omit<FormProfile, 'id' | 'createdAt'> & { id?: string }
): FormProfile {
  const all = store.get('profiles', [])

  if (profile.id) {
    // Update existing
    const idx = all.findIndex((p) => p.id === profile.id)
    if (idx >= 0) {
      all[idx] = { ...all[idx], ...profile, id: all[idx].id }
      store.set('profiles', all)
      return all[idx]
    }
  }

  // Create new
  const id = `fp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const full: FormProfile = {
    id,
    name: profile.name,
    fields: profile.fields,
    createdAt: new Date().toISOString(),
    isAiGenerated: profile.isAiGenerated
  }
  all.push(full)
  store.set('profiles', all)
  return full
}

export function saveBulkFormProfiles(
  profiles: Array<{ name: string; fields: FormField[] }>
): FormProfile[] {
  const existing = store.get('profiles', [])
  const created: FormProfile[] = profiles.map((p) => ({
    id: `fp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: p.name,
    fields: p.fields,
    createdAt: new Date().toISOString(),
    isAiGenerated: true
  }))
  store.set('profiles', [...existing, ...created])
  return created
}

export function deleteFormProfile(profileId: string): FormProfile[] {
  const all = store.get('profiles', [])
  const filtered = all.filter((p) => p.id !== profileId)
  store.set('profiles', filtered)
  return filtered
}

// ─── Form fill execution ─────────────────────────────────────────────────────

export function startFormFill(
  profileId: string
): { active: boolean; current: number; total: number; label: string } {
  const all = store.get('profiles', [])
  const profile = all.find((p) => p.id === profileId)
  if (!profile || profile.fields.length === 0) {
    return { active: false, current: 0, total: 0, label: '' }
  }
  activeFill = { profile, currentIndex: 0 }
  // Write first field value to clipboard
  clipboard.writeText(profile.fields[0].value)
  return {
    active: true,
    current: 1,
    total: profile.fields.length,
    label: profile.fields[0].label
  }
}

export function formPasteNext(): {
  active: boolean
  current: number
  total: number
  label: string
} | null {
  if (!activeFill) return null

  // Paste current field
  setTimeout(() => simulateCtrlV(), 80)

  activeFill.currentIndex++

  if (activeFill.currentIndex >= activeFill.profile.fields.length) {
    const total = activeFill.profile.fields.length
    activeFill = null
    return { active: false, current: total, total, label: '' }
  }

  // Write next field value to clipboard
  const next = activeFill.profile.fields[activeFill.currentIndex]
  clipboard.writeText(next.value)

  return {
    active: true,
    current: activeFill.currentIndex + 1,
    total: activeFill.profile.fields.length,
    label: next.label
  }
}

export function cancelFormFill(): void {
  activeFill = null
}

export function getFormFillStatus(): {
  active: boolean
  current: number
  total: number
  label: string
} {
  if (!activeFill) return { active: false, current: 0, total: 0, label: '' }
  const field = activeFill.profile.fields[activeFill.currentIndex]
  return {
    active: true,
    current: activeFill.currentIndex + 1,
    total: activeFill.profile.fields.length,
    label: field?.label ?? ''
  }
}
