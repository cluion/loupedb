import { randomUUID } from 'node:crypto'
import type { ConnectionConfig } from '#shared/types'
import type { DatabaseDriver } from './driver'
import { createDriver } from './registry'

export interface ConnectionManagerOptions {
  readonly maxSessions: number
  readonly idleTimeoutMs: number
}

export interface DriverSession {
  readonly driver: DatabaseDriver
  readonly lastActiveAt: number
}

export interface ConnectionManager {
  open(config: ConnectionConfig): Promise<string>
  get(id: string): DriverSession | undefined
  close(id: string): Promise<void>
  closeAll(): Promise<void>
  sweepIdle(): Promise<void>
}

export function createConnectionManager(opts: ConnectionManagerOptions): ConnectionManager {
  const sessions = new Map<string, DriverSession>()

  const touch = (id: string, s: DriverSession): DriverSession => {
    const next: DriverSession = { driver: s.driver, lastActiveAt: Date.now() }
    sessions.set(id, next)
    return next
  }

  return {
    async open(config) {
      if (sessions.size >= opts.maxSessions) {
        throw new Error(`max sessions reached (${opts.maxSessions})`)
      }
      const driver = createDriver(config)
      await driver.connect()
      const id = randomUUID()
      sessions.set(id, { driver, lastActiveAt: Date.now() })
      return id
    },
    get(id) {
      const s = sessions.get(id)
      if (!s) return undefined
      return touch(id, s) // reading a session marks it active
    },
    async close(id) {
      const s = sessions.get(id)
      if (!s) return
      sessions.delete(id)
      await s.driver.disconnect()
    },
    async closeAll() {
      const all = [...sessions.values()]
      sessions.clear()
      await Promise.all(all.map((s) => s.driver.disconnect()))
    },
    async sweepIdle() {
      const now = Date.now()
      const expired = [...sessions.entries()].filter(([, s]) => now - s.lastActiveAt > opts.idleTimeoutMs)
      for (const [id] of expired) sessions.delete(id)
      await Promise.all(expired.map(([, s]) => s.driver.disconnect()))
    },
  }
}
