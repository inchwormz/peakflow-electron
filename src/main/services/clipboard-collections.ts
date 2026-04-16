/**
 * Tag/collection management for QuickBoard clipboard items.
 */

import Store from 'electron-store'
import { getClipboardService } from './clipboard'

interface TagStore {
  tags: string[]
}

const store = new Store<TagStore>({
  name: 'quickboard-tags',
  defaults: { tags: [] }
})

export function getAllTags(): string[] {
  return store.get('tags')
}

export function setItemTags(itemId: string, tags: string[]): void {
  const svc = getClipboardService()
  svc.setItemTags(itemId, tags)

  // Auto-add new tags to the tag store
  const existing = new Set(store.get('tags'))
  let changed = false
  for (const t of tags) {
    if (!existing.has(t)) {
      existing.add(t)
      changed = true
    }
  }
  if (changed) store.set('tags', Array.from(existing))
}

export function manageTags(
  action: 'create' | 'rename' | 'delete' | 'reorder',
  payload: { name?: string; oldName?: string; newName?: string; tags?: string[] }
): string[] {
  const tags = store.get('tags')
  if (action === 'create' && payload.name) {
    if (!tags.includes(payload.name)) {
      store.set('tags', [...tags, payload.name])
    }
  } else if (action === 'delete' && payload.oldName) {
    store.set('tags', tags.filter((t) => t !== payload.oldName))
    getClipboardService().removeTagFromAll(payload.oldName)
  } else if (action === 'rename' && payload.oldName && payload.newName) {
    store.set('tags', tags.map((t) => (t === payload.oldName ? payload.newName! : t)))
    getClipboardService().renameTagOnAll(payload.oldName, payload.newName)
  } else if (action === 'reorder' && payload.tags) {
    store.set('tags', payload.tags)
  }
  return store.get('tags')
}
