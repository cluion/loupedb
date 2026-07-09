import type { ConnectionManager } from '../database/core/connectionManager'

let instance: ConnectionManager | null = null

export function setConnectionManager(manager: ConnectionManager): void {
  instance = manager
}

export function useConnectionManager(): ConnectionManager {
  if (!instance) throw new Error('ConnectionManager not initialized (nitro plugin has not run)')
  return instance
}
