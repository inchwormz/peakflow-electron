/** A refresh never overrides a deliberate Off. Only a new usable transition can enable. */
export const autoEnable = (wasUsable: boolean, usable: boolean, userOff: boolean): boolean => !wasUsable && usable && !userOff
export const toggleChoice = (enabled: boolean): { enabled: boolean; userOff: boolean } => ({ enabled, userOff: !enabled })
