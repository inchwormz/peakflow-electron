/**
 * Put one QuickBoard clip back on the clipboard, by type. Returns false when
 * nothing was written, so callers never send a paste that would re-paste the
 * previous clipboard. Pure (writers are passed in) for scripts/checks.
 */

export interface ClipLike {
  type: 'text' | 'image' | 'file'
  text: string | null
  editedText?: string
  imagePath?: string
  filePaths?: string[]
}

export interface ClipWriters {
  text: (text: string) => void
  image: (path: string) => boolean
  files: (paths: string[]) => boolean
}

export function writeClip(item: ClipLike, w: ClipWriters, textOverride?: string): boolean {
  if (item.type === 'text') {
    const text = textOverride ?? item.editedText ?? item.text ?? ''
    if (!text) return false
    w.text(text)
    return true
  }
  if (item.type === 'image') return !!item.imagePath && w.image(item.imagePath)
  if (item.type === 'file') return !!item.filePaths?.length && w.files(item.filePaths)
  return false
}
