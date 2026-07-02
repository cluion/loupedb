import { describe, it, expect, afterEach } from 'vitest'
import postgres from 'postgres'
import { startPgContainer, type PgTestHandle } from '../../helpers/pg-container'
import { createPostgresDriver } from '../../../server/database/drivers/postgres'
import type { DatabaseDriver } from '../../../server/database/core/driver'

let handle: PgTestHandle | null = null
afterEach(async () => { if (handle) { await handle.container.stop(); handle = null } })

async function setup(seedLogs = false): Promise<DatabaseDriver> {
  handle = await startPgContainer()
  if (seedLogs) {
    const seedSql = postgres({
      host: handle.config.host, port: handle.config.port, database: handle.config.database,
      username: handle.config.username, password: handle.config.password,
    })
    await seedSql.unsafe(`create table logs (id serial primary key)`).simple()
    await seedSql.unsafe(`insert into logs (id) select generate_series(1, 25)`).simple()
    await seedSql.end()
  }
  const driver = createPostgresDriver({
    name: 't', driver: 'postgres', host: handle.config.host, port: handle.config.port,
    database: handle.config.database, username: handle.config.username,
    password: handle.config.password, ssl: 'disable',
  })
  await driver.connect()
  return driver
}

describe('postgres driver cancel/stream', () => {
  it('cancel aborts a running long query', async () => {
    const driver = await setup()
    const queryId = 'q1'
    const exec = driver.execute(`select pg_sleep(5)`, [], queryId)
    await new Promise((r) => setTimeout(r, 200))
    await driver.cancel(queryId)
    await expect(exec).rejects.toThrow()
    await driver.disconnect()
  })

  it('stream yields rows in batches', async () => {
    const driver = await setup(true)
    const batches: number[] = []
    for await (const batch of driver.stream('public', 'logs', { limit: 100, offset: 0 }, 10)) {
      batches.push(batch.length)
    }
    expect(batches).toEqual([10, 10, 5])
    await driver.disconnect()
  })

  it('cancel stops an in-flight stream by queryId', async () => {
    const driver = await setup(true)
    const batches: number[] = []
    for await (const batch of driver.stream('public', 'logs', { limit: 100, offset: 0 }, 10, 'sq1')) {
      batches.push(batch.length)
      await driver.cancel('sq1') // cancel after first batch
    }
    expect(batches).toEqual([10]) // no further batches
    await driver.disconnect()
  })

  it('stream rejects invalid identifiers', async () => {
    const driver = await setup(true)
    const iterate = async () => {
      for await (const _ of driver.stream('public', 'logs"; drop table logs;--', { limit: 10, offset: 0 }, 5)) { void _ }
    }
    await expect(iterate()).rejects.toThrow(/invalid identifier/)
    await driver.disconnect()
  })
})
