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

  it('updates one scalar cell by primary key and rejects a stale original value', async () => {
    const driver = await setup()
    const updated = await driver.updateCell({
      schema: 'public', table: 'items', column: 'label', value: 'edited',
      originalValue: 'a', identity: { id: 1 },
    })
    expect(updated).toMatchObject({ affectedRows: 1, row: { id: 1, label: 'edited', qty: 1 } })
    await expect(driver.updateCell({
      schema: 'public', table: 'items', column: 'label', value: 'overwritten',
      originalValue: 'a', identity: { id: 1 },
    })).rejects.toMatchObject({ code: 'ROW_CHANGED' })
    await driver.disconnect()
  })

  it('updates and deletes a row by a complete non-null unique key', async () => {
    const driver = await setup()
    await driver.execute('create table contacts (email text not null unique, label text)')
    await driver.execute("insert into contacts values ('a@example.com', 'A')")

    const updated = await driver.updateCell({
      schema: 'public', table: 'contacts', column: 'label', value: 'edited',
      originalValue: 'A', identity: { email: 'a@example.com' },
    })
    expect(updated).toMatchObject({ affectedRows: 1, row: { email: 'a@example.com', label: 'edited' } })
    await expect(driver.updateCell({
      schema: 'public', table: 'contacts', column: 'email', value: 'b@example.com',
      originalValue: 'a@example.com', identity: { email: 'a@example.com' },
    })).rejects.toMatchObject({ code: 'READ_ONLY_COLUMN' })

    const browsed = await driver.browse('public', 'contacts', {
      limit: 1, offset: 0, filter: [{ column: 'email', op: '=', value: 'a@example.com' }],
    })
    await expect(driver.deleteRow({
      schema: 'public', table: 'contacts', identity: { email: 'a@example.com' },
      version: browsed.rowVersions![0]!,
    })).resolves.toMatchObject({ affectedRows: 1, row: { label: 'edited' } })
    await driver.disconnect()
  })

  it('rejects NULL values from nullable unique keys as unsafe identities', async () => {
    const driver = await setup()
    await driver.execute('create table nullable_contacts (email text unique, label text)')
    await driver.execute("insert into nullable_contacts values (null, 'A'), (null, 'B')")
    await expect(driver.updateCell({
      schema: 'public', table: 'nullable_contacts', column: 'label', value: 'edited',
      originalValue: 'A', identity: { email: null },
    })).rejects.toMatchObject({ code: 'INVALID_IDENTITY' })
    await driver.disconnect()
  })

  it('inserts and deletes one row using PK plus the browsed row version', async () => {
    const driver = await setup()
    const inserted = await driver.insertRow({
      schema: 'public', table: 'items', values: { label: 'inserted', qty: 4 },
    })
    expect(inserted).toMatchObject({ affectedRows: 1, row: { label: 'inserted', qty: 4 } })
    const id = inserted.row.id
    const browsed = await driver.browse('public', 'items', {
      limit: 1, offset: 0, filter: [{ column: 'id', op: '=', value: id }],
    })
    expect(browsed.columns.map((column) => column.name)).toEqual(['id', 'label', 'qty'])
    expect(browsed.rows).toEqual([{ id, label: 'inserted', qty: 4 }])
    expect(browsed.rowVersions).toMatchObject([expect.stringMatching(/^\d+$/u)])

    const deleted = await driver.deleteRow({
      schema: 'public', table: 'items', identity: { id }, version: browsed.rowVersions![0]!,
    })
    expect(deleted).toMatchObject({ affectedRows: 1, row: { id, label: 'inserted' } })
    const after = await driver.execute('select count(*)::int as count from items where id = $1', [id])
    expect(after.rows).toEqual([{ count: 0 }])
    await driver.disconnect()
  })

  it('applies staged updates, inserts and deletes in one transaction', async () => {
    const driver = await setup()
    const browsed = await driver.browse('public', 'items', { limit: 3, offset: 0, orderBy: 'id' })
    const version = (id: number) => browsed.rowVersions![browsed.rows.findIndex((row) => row.id === id)]!
    const result = await driver.applyTableChanges({
      schema: 'public',
      table: 'items',
      changes: [
        {
          kind: 'update', column: 'label', value: 'edited', originalValue: 'a',
          identity: { id: 1 }, version: version(1),
        },
        {
          kind: 'update', column: 'qty', value: 10, originalValue: 1,
          identity: { id: 1 }, version: version(1),
        },
        { kind: 'insert', values: { label: 'inserted', qty: 4 } },
        { kind: 'delete', identity: { id: 2 }, version: version(2) },
      ],
    })
    expect(result.affectedRows).toBe(4)
    const after = await driver.execute('select label, qty from items order by id')
    expect(after.rows).toEqual([
      { label: 'edited', qty: 10 },
      { label: 'c', qty: 3 },
      { label: 'inserted', qty: 4 },
    ])
    await driver.disconnect()
  })

  it('rolls back every staged change when one row version is stale', async () => {
    const driver = await setup()
    const browsed = await driver.browse('public', 'items', { limit: 3, offset: 0, orderBy: 'id' })
    await driver.execute("update items set label = 'newer' where id = 2")
    await expect(driver.applyTableChanges({
      schema: 'public',
      table: 'items',
      changes: [
        {
          kind: 'update', column: 'label', value: 'should rollback', originalValue: 'a',
          identity: { id: 1 }, version: browsed.rowVersions![0]!,
        },
        { kind: 'delete', identity: { id: 2 }, version: browsed.rowVersions![1]! },
      ],
    })).rejects.toMatchObject({ code: 'ROW_CHANGED' })
    const after = await driver.execute('select id, label from items where id in (1, 2) order by id')
    expect(after.rows).toEqual([{ id: 1, label: 'a' }, { id: 2, label: 'newer' }])
    await driver.disconnect()
  })

  it('inserts DEFAULT VALUES when every field is omitted', async () => {
    const driver = await setup()
    await driver.execute("create table defaults_only (id serial primary key, label text not null default 'ready')")
    const inserted = await driver.insertRow({ schema: 'public', table: 'defaults_only', values: {} })
    expect(inserted).toMatchObject({ affectedRows: 1, row: { id: 1, label: 'ready' } })
    await driver.disconnect()
  })

  it('rejects delete when the row version changed after browsing', async () => {
    const driver = await setup()
    const browsed = await driver.browse('public', 'items', {
      limit: 1, offset: 0, filter: [{ column: 'id', op: '=', value: 1 }],
    })
    await driver.execute("update items set label = 'newer' where id = 1")
    await expect(driver.deleteRow({
      schema: 'public', table: 'items', identity: { id: 1 }, version: browsed.rowVersions![0]!,
    })).rejects.toMatchObject({ code: 'ROW_CHANGED' })
    await driver.disconnect()
  })

  it('keeps identity columns and tables without a safe key read-only', async () => {
    const driver = await setup()
    await expect(driver.updateCell({
      schema: 'public', table: 'items', column: 'id', value: 9,
      originalValue: 1, identity: { id: 1 },
    })).rejects.toMatchObject({ code: 'READ_ONLY_COLUMN' })

    await driver.execute('create table notes (label text)')
    await driver.execute("insert into notes values ('a')")
    await expect(driver.insertRow({
      schema: 'public', table: 'notes', values: { label: 'b' },
    })).resolves.toMatchObject({ affectedRows: 1, row: { label: 'b' } })
    await expect(driver.updateCell({
      schema: 'public', table: 'notes', column: 'label', value: 'edited',
      originalValue: 'a', identity: { label: 'a' },
    })).rejects.toMatchObject({ code: 'SAFE_EDIT_REQUIRED' })
    await expect(driver.deleteRow({
      schema: 'public', table: 'notes', identity: { label: 'a' }, version: '1',
    })).rejects.toMatchObject({ code: 'SAFE_EDIT_REQUIRED' })
    await driver.disconnect()
  })

  it('requires manual transactions to finish before inline editing', async () => {
    const driver = await setup()
    await driver.beginTransaction()
    await expect(driver.updateCell({
      schema: 'public', table: 'items', column: 'label', value: 'edited',
      originalValue: 'a', identity: { id: 1 },
    })).rejects.toMatchObject({ code: 'TX_ACTIVE' })
    await expect(driver.insertRow({
      schema: 'public', table: 'items', values: { label: 'blocked' },
    })).rejects.toMatchObject({ code: 'TX_ACTIVE' })
    await expect(driver.deleteRow({
      schema: 'public', table: 'items', identity: { id: 1 }, version: '1',
    })).rejects.toMatchObject({ code: 'TX_ACTIVE' })
    await expect(driver.applyTableChanges({
      schema: 'public', table: 'items',
      changes: [{
        kind: 'update', column: 'label', value: 'blocked', originalValue: 'a',
        identity: { id: 1 }, version: '1',
      }],
    })).rejects.toMatchObject({ code: 'TX_ACTIVE' })
    await driver.rollbackTransaction()
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
