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
    expect(r.command).toBe('SELECT')
    expect(r.executionMs).toBeGreaterThanOrEqual(0)
    await driver.disconnect()
  })

  it('execute with params and affectedRows on DML', async () => {
    const driver = await setup()
    const r = await driver.execute(`update items set qty = qty + 1 where qty > $1`, [1])
    expect(r.affectedRows).toBe(2)
    expect(r.command).toBe('UPDATE')
    await driver.disconnect()
  })

  it('keeps statements and scripts on one manual transaction until rollback', async () => {
    const driver = await setup()
    expect(driver.transactionStatus()).toEqual({ status: 'idle', startedAt: null })
    expect((await driver.beginTransaction()).status).toBe('active')

    await driver.execute('update items set qty = 77 where id = 1')
    const scriptResults = []
    for await (const result of driver.executeScript([
      'update items set label = upper(label) where id = 1',
      'select label, qty from items where id = 1',
    ])) scriptResults.push(result)
    expect(scriptResults[1]?.rows).toEqual([{ label: 'A', qty: 77 }])

    const outside = await driver.browse('public', 'items', { limit: 1, offset: 0, orderBy: 'id' })
    expect(outside.rows[0]).toMatchObject({ label: 'a', qty: 1 })
    expect(await driver.rollbackTransaction()).toEqual({ status: 'idle', startedAt: null })
    const after = await driver.execute('select label, qty from items where id = 1')
    expect(after.rows).toEqual([{ label: 'a', qty: 1 }])
    await driver.disconnect()
  })

  it('commits a manual transaction', async () => {
    const driver = await setup()
    await driver.beginTransaction()
    await driver.execute('update items set qty = 88 where id = 1')
    expect(await driver.commitTransaction()).toEqual({ status: 'idle', startedAt: null })
    const after = await driver.execute('select qty from items where id = 1')
    expect(after.rows).toEqual([{ qty: 88 }])
    await driver.disconnect()
  })

  it('marks a failed manual transaction and requires rollback', async () => {
    const driver = await setup()
    await driver.beginTransaction()
    await expect(driver.execute('select * from missing_transaction_table')).rejects.toMatchObject({ code: '42P01' })
    expect(driver.transactionStatus().status).toBe('failed')
    await expect(driver.commitTransaction()).rejects.toMatchObject({ code: 'TX_FAILED' })
    expect((await driver.rollbackTransaction()).status).toBe('idle')
    await expect(driver.execute('select 1')).resolves.toMatchObject({ rows: [{ '?column?': 1 }] })
    await driver.disconnect()
  })

  it('keeps transaction boundary SQL on the safe control path', async () => {
    const driver = await setup()
    await expect(driver.execute('/* leading */ commit')).rejects.toMatchObject({ code: 'TX_CONTROL' })
    expect(driver.transactionStatus().status).toBe('idle')

    await driver.beginTransaction()
    await expect(driver.execute('rollback')).rejects.toMatchObject({ code: 'TX_CONTROL' })
    expect(driver.transactionStatus().status).toBe('active')
    const script = driver.executeScript(['select 1', 'commit'])[Symbol.asyncIterator]()
    await expect(script.next()).rejects.toMatchObject({ code: 'TX_CONTROL' })
    expect(driver.transactionStatus().status).toBe('active')
    await driver.rollbackTransaction()
    await driver.disconnect()
  })

  it('captures notices per concurrent query, script statement and failed query', async () => {
    const driver = await setup()
    const [first, second] = await Promise.all([
      driver.execute(`do $$ begin perform pg_sleep(0.1); raise notice 'first notice'; end $$`),
      driver.execute(`do $$ begin raise warning 'second warning'; end $$`),
    ])
    expect(first.messages).toMatchObject([{ severity: 'notice', message: 'first notice', code: '00000' }])
    expect(second.messages).toMatchObject([{ severity: 'warning', message: 'second warning', code: '01000' }])

    const scriptResults = []
    for await (const result of driver.executeScript([
      `do $$ begin raise notice 'script one'; end $$`,
      `do $$ begin raise warning 'script two'; end $$`,
    ])) scriptResults.push(result)
    expect(scriptResults[0]?.messages?.[0]?.message).toBe('script one')
    expect(scriptResults[1]?.messages?.[0]?.message).toBe('script two')

    try {
      await driver.execute(`do $$ begin raise notice 'before failure'; raise exception 'boom'; end $$`)
      expect.unreachable('query should fail')
    } catch (cause) {
      expect(cause).toMatchObject({ messages: [{ severity: 'notice', message: 'before failure' }] })
    }
    await driver.disconnect()
  })

  it('executeScript keeps every statement on one reserved connection', async () => {
    const driver = await setup()
    const results = []
    for await (const result of driver.executeScript([
      'create temporary table script_values (value int)',
      'insert into script_values values (7)',
      'select value from script_values',
    ])) results.push(result)

    expect(results).toHaveLength(3)
    expect(results[2]?.rows).toEqual([{ value: 7 }])
    await driver.disconnect()
  })

  it('executeScript rolls back an explicit transaction left open by the script', async () => {
    const driver = await setup()
    for await (const _result of driver.executeScript([
      'begin',
      'update items set qty = 99 where id = 1',
    ])) { /* consume every statement */ }

    const result = await driver.execute('select qty from items where id = 1')
    expect(result.rows).toEqual([{ qty: 1 }])
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

  it('browse ignores non-whitelisted filter operator (runtime injection guard)', async () => {
    const driver = await setup()
    const r = await driver.browse('public', 'items', {
      limit: 10, offset: 0,
      filter: [{ column: 'qty', op: '= 1 or 1=1 --' as never, value: 1 }],
    })
    expect(r.rows.length).toBe(3) // malicious op dropped, unfiltered result
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
