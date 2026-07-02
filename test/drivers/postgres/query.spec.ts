import { describe, it, expect, afterEach } from 'vitest'
import postgres from 'postgres'
import { startPgContainer, type PgTestHandle } from '../../helpers/pg-container'
import { createPostgresDriver } from '../../../server/database/drivers/postgres'
import type { DatabaseDriver } from '../../../server/database/core/driver'

let handle: PgTestHandle | null = null
afterEach(async () => { if (handle) { await handle.container.stop(); handle = null } })

async function setup(): Promise<DatabaseDriver> {
  handle = await startPgContainer()
  const seedSql = postgres({
    host: handle.config.host, port: handle.config.port, database: handle.config.database,
    username: handle.config.username, password: handle.config.password,
  })
  await seedSql.unsafe(`create table items (id serial primary key, label text not null, qty int)`).simple()
  await seedSql.unsafe(`insert into items (label, qty) values ('a', 1), ('b', 2), ('c', 3)`).simple()
  await seedSql.end()
  const driver = createPostgresDriver({
    name: 't', driver: 'postgres', host: handle.config.host, port: handle.config.port,
    database: handle.config.database, username: handle.config.username,
    password: handle.config.password, ssl: 'disable',
  })
  await driver.connect()
  return driver
}

describe('postgres driver execute/browse', () => {
  it('execute SELECT returns columns, rows and normalized types', async () => {
    const driver = await setup()
    const r = await driver.execute(`select id, label, qty from items order by id`)
    expect(r.columns.map(c => c.name)).toEqual(['id', 'label', 'qty'])
    expect(r.columns.map(c => c.type)).toEqual(['integer', 'string', 'integer'])
    expect(r.rows.length).toBe(3)
    expect(r.executionMs).toBeGreaterThanOrEqual(0)
    await driver.disconnect()
  })

  it('execute with params and affectedRows on DML', async () => {
    const driver = await setup()
    const r = await driver.execute(`update items set qty = qty + 1 where qty > $1`, [1])
    expect(r.affectedRows).toBe(2)
    await driver.disconnect()
  })

  it('browse paginates with limit/offset', async () => {
    const driver = await setup()
    const p1 = await driver.browse('public', 'items', { limit: 2, offset: 0, orderBy: 'id', orderDir: 'asc' })
    const p2 = await driver.browse('public', 'items', { limit: 2, offset: 2, orderBy: 'id', orderDir: 'asc' })
    expect(p1.rows.map(r => r.label)).toEqual(['a', 'b'])
    expect(p2.rows.map(r => r.label)).toEqual(['c'])
    await driver.disconnect()
  })

  it('browse parameterizes filter and ignores non-whitelisted orderBy', async () => {
    const driver = await setup()
    const r = await driver.browse('public', 'items', {
      limit: 10, offset: 0, orderBy: 'evil; drop',
      filter: [{ column: 'qty', op: '>', value: 1 }],
    })
    expect(r.rows.map(x => x.label).sort()).toEqual(['b', 'c'])
    await driver.disconnect()
  })

  it('browse ignores non-whitelisted filter column', async () => {
    const driver = await setup()
    const r = await driver.browse('public', 'items', {
      limit: 10, offset: 0,
      filter: [{ column: 'nope; drop table items;', op: '=', value: 1 }],
    })
    expect(r.rows.length).toBe(3) // filter dropped, table intact
    await driver.disconnect()
  })
})
