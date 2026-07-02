import type { ConnectionConfig } from '#shared/types'
import type { DatabaseDriver } from './driver'

export type DriverFactory = (config: ConnectionConfig) => DatabaseDriver

const registry = new Map<string, DriverFactory>()

export function registerDriver(name: string, factory: DriverFactory): void {
  registry.set(name, factory)
}

export function getDriverFactory(name: string): DriverFactory {
  const factory = registry.get(name)
  if (!factory) throw new Error(`Unknown driver: ${name}`)
  return factory
}

export function createDriver(config: ConnectionConfig): DatabaseDriver {
  return getDriverFactory(config.driver)(config)
}

export function clearRegistry(): void {
  registry.clear()
}
