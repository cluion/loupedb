import { describe, it, expect, afterEach } from 'vitest'
import { startPgContainer, type PgTestHandle } from './helpers/pg-container'
import { createConnectionManager } from '../server/database/core/connectionManager'
import { ensurePostgresRegistered } from '../server/database/drivers/postgres/register'
import type { ConnectionConfig } from '#shared/types'

ensurePostgresRegistered()
let handle: PgTestHandle | null = null
afterEach(async () => { if (handle) { await handle.container.stop(); handle = null } })

function cfg(h: PgTestHandle['config']): ConnectionConfig {
  return {
    name: 't', driver: 'postgres', host: h.host, port: h.port,
    database: h.database, username: h.username, password: h.password, ssl: 'disable',
    environment: 'development', safetyMode: 'normal',
  }
}

describe('ConnectionManager', () => {
  it('open/get/close lifecycle', async () => {
    handle = await startPgContainer()
    const mgr = createConnectionManager({ maxSessions: 5, idleTimeoutMs: 60_000 })
    const id = await mgr.open(cfg(handle.config))
    expect(mgr.get(id)).toBeDefined()
    expect(mgr.get(id)!.driver.status).toBe('connected')
    await mgr.close(id)
    expect(mgr.get(id)).toBeUndefined()
  })

  it('throws when maxSessions exceeded', async () => {
    handle = await startPgContainer()
    const mgr = createConnectionManager({ maxSessions: 1, idleTimeoutMs: 60_000 })
    await mgr.open(cfg(handle.config))
    await expect(mgr.open(cfg(handle.config))).rejects.toThrow(/max/)
    await mgr.closeAll()
  })

  it('closeAll clears every session', async () => {
    handle = await startPgContainer()
    const mgr = createConnectionManager({ maxSessions: 5, idleTimeoutMs: 60_000 })
    const a = await mgr.open(cfg(handle.config))
    const b = await mgr.open(cfg(handle.config))
    await mgr.closeAll()
    expect(mgr.get(a)).toBeUndefined()
    expect(mgr.get(b)).toBeUndefined()
  })

  it('sweepIdle disconnects idle sessions', async () => {
    handle = await startPgContainer()
    const mgr = createConnectionManager({ maxSessions: 5, idleTimeoutMs: 1 })
    const id = await mgr.open(cfg(handle.config))
    await new Promise((r) => setTimeout(r, 50))
    await mgr.sweepIdle()
    expect(mgr.get(id)).toBeUndefined()
  })

  it('closing a parent cascades to its sibling child sessions', async () => {
    handle = await startPgContainer()
    const mgr = createConnectionManager({ maxSessions: 5, idleTimeoutMs: 60_000 })
    const root = await mgr.open(cfg(handle.config))
    const child = await mgr.open(cfg(handle.config), root)
    const grandchild = await mgr.open(cfg(handle.config), child)
    await mgr.close(root)
    expect(mgr.get(root)).toBeUndefined()
    expect(mgr.get(child)).toBeUndefined()
    expect(mgr.get(grandchild)).toBeUndefined()
  })

  it('closing a child leaves the parent alive', async () => {
    handle = await startPgContainer()
    const mgr = createConnectionManager({ maxSessions: 5, idleTimeoutMs: 60_000 })
    const root = await mgr.open(cfg(handle.config))
    const child = await mgr.open(cfg(handle.config), root)
    await mgr.close(child)
    expect(mgr.get(child)).toBeUndefined()
    expect(mgr.get(root)).toBeDefined()
    await mgr.closeAll()
  })

  it('get refreshes lastActiveAt so active sessions survive sweep', async () => {
    handle = await startPgContainer()
    const mgr = createConnectionManager({ maxSessions: 5, idleTimeoutMs: 200 })
    const id = await mgr.open(cfg(handle.config))
    await new Promise((r) => setTimeout(r, 120))
    mgr.get(id) // touch
    await new Promise((r) => setTimeout(r, 120))
    await mgr.sweepIdle() // 240ms since open but only 120ms since touch
    expect(mgr.get(id)).toBeDefined()
    await mgr.closeAll()
  })
})
