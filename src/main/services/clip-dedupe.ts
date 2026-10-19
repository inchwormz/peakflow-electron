/**
 * What QuickBoard remembers to avoid recording the same copy twice. Pure so
 * scripts/checks can test the transitions.
 */

export interface DedupeState {
  lastTextHash: string
  lastImageHash: string
  lastFileKey: string
}

/**
 * Files were copied. Remember them (and their names as text, so the names
 * aren't recorded as a text clip). Forget the last image, so copying that
 * same image again after the files is recorded again.
 */
export function afterFileCapture(fileKey: string, namesTextHash: string): DedupeState {
  return { lastFileKey: fileKey, lastTextHash: namesTextHash, lastImageHash: '' }
}
