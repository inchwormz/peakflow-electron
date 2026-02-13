/**
 * Persistent configuration store.
 *
 * Each tool gets its own `electron-store` instance so config files stay
 * small and tool-specific. Values are merged with DEFAULT_CONFIGS on read
 * so new config keys introduced in updates are always present.
 */

import Store from 'electron-store'
import { ToolId } from '@shared/tool-ids'
import { DEFAULT_CONFIGS } from '@shared/config-schemas'
import type { ToolConfig } from '@shared/config-schemas'

/** Cache of Store instances keyed by ToolId */
const stores = new Map<ToolId, Store>()

/**
 * Get or create an electron-store instance for a specific tool.
 * Each store is saved to a separate JSON file (e.g. `config-focusdim.json`).
 */
function getStore(tool: ToolId): Store {
  let store = stores.get(tool)
  if (!store) {
    store = new Store({
      name: `config-${tool}`,
      clearInvalidConfig: true
    })
    stores.set(tool, store)
  }
  return store
}

/**
 * Retrieve the full config for a tool, merged with defaults.
 * Missing keys are filled in from DEFAULT_CONFIGS so the renderer
 * always receives a complete config object.
 */
export function getConfig(tool: ToolId): ToolConfig {
  const defaults = DEFAULT_CONFIGS[tool]
  if (!defaults) {
    throw new Error(`[PeakFlow] getConfig: unknown tool "${tool}"`)
  }

  const store = getStore(tool)
  const persisted = store.store as Record<string, unknown>

  // Merge: persisted values override defaults
  return { ...defaults, ...persisted } as ToolConfig
}

/**
 * Set a single config key for a tool and persist it.
 */
export function setConfig(tool: ToolId, key: string, value: unknown): void {
  const defaults = DEFAULT_CONFIGS[tool]
  if (!defaults) {
    throw new Error(`[PeakFlow] setConfig: unknown tool "${tool}"`)
  }

  if (!(key in defaults)) {
    console.warn(`[PeakFlow] setConfig: unknown key "${key}" for tool "${tool}"`)
  }

  const store = getStore(tool)
  store.set(key, value)
  console.log(`[PeakFlow] Config saved: ${tool}.${key} = ${JSON.stringify(value)}`)
}

/**
 * Retrieve the full config for a tool (alias for getConfig).
 * Provided for symmetry with the IPC channel name `config:get-all`.
 */
export function getAllConfig(tool: ToolId): ToolConfig {
  return getConfig(tool)
}
