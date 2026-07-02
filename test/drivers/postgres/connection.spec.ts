import { describe, it, expect, afterEach } from 'vitest'
import { startPgContainer, type PgTestHandle } from '../../helpers/pg-container'
import { createPostgresDriver } from '../../../server/database/drivers/postgres'

let handle: PgTestHandle | null = null
afterEach(async () => { if (handle) { await handle.container.stop(); handle = null } })

describe('postgres driver lifecycle', () => {
  it('status is connected after connect and closed after disconnect', async () => {
    handle = await startPgContainer()
    const driver = createPostgresDriver({
      name: 't', driver: 'postgres', host: handle.config.host, port: handle.config.port,
      database: handle.config.database, username: handle.config.username,
      password: handle.config.password, ssl: 'disable',
    })
    expect(driver.status).toBe('closed')
    await driver.connect()
    expect(driver.status).toBe('connected')
    await driver.disconnect()
    expect(driver.status).toBe('closed')
  })

  it('each driver instance tracks its own status', async () => {
    handle = await startPgContainer()
    const cfg = {
      name: 't', driver: 'postgres', host: handle.config.host, port: handle.config.port,
      database: handle.config.database, username: handle.config.username,
      password: handle.config.password, ssl: 'disable',
    } as const
    const a = createPostgresDriver(cfg)
    const b = createPostgresDriver(cfg)
    await a.connect()
    expect(a.status).toBe('connected')
    expect(b.status).toBe('closed') // b must not share a's state
    await a.disconnect()
  })
})
