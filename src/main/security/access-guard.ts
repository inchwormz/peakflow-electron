/**
 * Run a tool action only when the access check allows it. The panel's gate is
 * only UI; main-process action handlers call this so an expired trial can't
 * start a tool through IPC or a shortcut. Fails closed if the check throws.
 * Pure (the check is passed in) so scripts/checks can test it.
 */
export type AccessCheck = (toolId: string) => Promise<{ allowed: boolean }>

export async function withToolAccess<T>(
  check: AccessCheck,
  toolId: string,
  action: () => T | Promise<T>,
  denied: () => T | Promise<T>
): Promise<T> {
  let allowed = false
  try {
    allowed = (await check(toolId)).allowed === true
  } catch (err) {
    console.warn(`[Access] check failed for ${toolId}:`, err)
  }
  if (!allowed) {
    console.warn(`[Access] ${toolId} action blocked: no access`)
    return denied()
  }
  return action()
}
