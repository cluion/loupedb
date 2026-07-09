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
  readonly parentId?: string
}

export interface ConnectionManager {
  open(config: ConnectionConfig, parentId?: string): Promise<string>
  get(id: string): DriverSession | undefined
  close(id: string): Promise<void>
  closeAll(): Promise<void>
  sweepIdle(): Promise<void>
}

export function createConnectionManager(opts: ConnectionManagerOptions): ConnectionManager {
  const sessions = new Map<string, DriverSession>()

  const touch = (id: string, s: DriverSession): DriverSession => {
    const next: DriverSession = { driver: s.driver, lastActiveAt: Date.now(), parentId: s.parentId }
    sessions.set(id, next)
    return next
  }

  // closing a session pulls its sibling children down with it - the ui opens
  // per-database child sessions that must not outlive their root connection
  async function closeSession(id: string): Promise<void> {
    const s = sessions.get(id)
    if (!s) return
    sessions.delete(id)
    const children = [...sessions.entries()]
      .filter(([, c]) => c.parentId === id)
      .map(([cid]) => cid)
    await Promise.all(children.map(closeSession))
    await s.driver.disconnect()
  }

  return {
    async open(config, parentId) {
      if (sessions.size >= opts.maxSessions) {
        throw new Error(`max sessions reached (${opts.maxSessions})`)
      }
      const driver = createDriver(config)
      await driver.connect()
      const id = randomUUID()
      sessions.set(id, { driver, lastActiveAt: Date.now(), parentId })
      return id
    },
    get(id) {
      const s = sessions.get(id)
      if (!s) return undefined
      return touch(id, s) // reading a session marks it active
    },
    close: closeSession,
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
