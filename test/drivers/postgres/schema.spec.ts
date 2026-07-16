import { describe, it, expect, afterEach } from 'vitest'
import postgres from 'postgres'
import { startPgContainer, type PgTestHandle } from '../../helpers/pg-container'
import { createPostgresDriver } from '../../../server/database/drivers/postgres'
import type { DatabaseDriver } from '../../../server/database/core/driver'

let handle: PgTestHandle | null = null
afterEach(async () => { if (handle) { await handle.container.stop(); handle = null } })

// seed with a direct postgres.js connection - driver.execute arrives in a later task
async function setup(): Promise<DatabaseDriver> {
  handle = await startPgContainer()
  const seedSql = postgres({
    host: handle.config.host, port: handle.config.port, database: handle.config.database,
    username: handle.config.username, password: handle.config.password,
  })
  await seedSql.unsafe(`create schema if not exists app`).simple()
  await seedSql.unsafe(`create type app.color as enum ('red','green')`).simple()
  await seedSql.unsafe(`create table app.users (
    id serial primary key,
    name text not null,
    data jsonb,
    fav app.color,
    created timestamptz default now()
  )`).simple()
  await seedSql.unsafe(`create table app.posts (
    id serial primary key,
    author_id int not null references app.users (id)
  )`).simple()
  await seedSql.end()

  const driver = createPostgresDriver({
    name: 't', driver: 'postgres', host: handle.config.host, port: handle.config.port,
    database: handle.config.database, username: handle.config.username,
    password: handle.config.password, ssl: 'disable',
  })
  await driver.connect()
  return driver
}

describe('postgres driver schema exploration', () => {
  it('listDatabases lists connectable databases and excludes templates', async () => {
    const driver = await setup()
    const dbs = await driver.listDatabases()
    const names = dbs.map(d => d.name)
    expect(names).toContain('loupedb_test')
    expect(names).not.toContain('template0')
    expect(names).not.toContain('template1')
    await driver.disconnect()
  })

  it('listSchemas excludes system schemas and includes app', async () => {
    const driver = await setup()
    const schemas = await driver.listSchemas()
    const names = schemas.map(s => s.name)
    expect(names).toContain('app')
    expect(names).not.toContain('pg_catalog')
    expect(names).not.toContain('information_schema')
    await driver.disconnect()
  })

  it('listTables returns tables of the app schema', async () => {
    const driver = await setup()
    const tables = await driver.listTables('app')
    expect(tables.map(t => t.name)).toEqual(expect.arrayContaining(['users', 'posts']))
    expect(tables.every(t => t.schema === 'app')).toBe(true)
    await driver.disconnect()
  })

  it('listColumns returns every column of the schema in one call', async () => {
    const driver = await setup()
    const cols = await driver.listColumns('app')
    const users = cols.filter(c => c.table === 'users').map(c => c.name)
    expect(users).toEqual(['id', 'name', 'data', 'fav', 'created']) // ordinal order
    expect(cols.filter(c => c.table === 'posts').map(c => c.name)).toEqual(['id', 'author_id'])
    await driver.disconnect()
  })

  it('describeTable returns normalized columns, pk and fk', async () => {
    const driver = await setup()
    const ts = await driver.describeTable('app', 'users')
    expect(ts.primaryKey).toEqual(['id'])
    const col = (n: string) => ts.columns.find(c => c.name === n)
    expect(col('id')?.type).toBe('integer')
    expect(col('name')?.nullable).toBe(false)
    expect(col('data')?.type).toBe('json')
    expect(col('fav')?.type).toBe('enum') // custom enum resolved via pg_type kind
    expect(col('created')?.type).toBe('datetime')

    const posts = await driver.describeTable('app', 'posts')
    expect(posts.foreignKeys).toHaveLength(1)
    expect(posts.foreignKeys[0]).toMatchObject({
      columns: ['author_id'],
      referencesSchema: 'app',
      referencesTable: 'users',
      referencesColumns: ['id'],
    })
    await driver.disconnect()
  })
})
