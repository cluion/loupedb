import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'
import postgres from 'postgres'
import { startPgContainer, type PgTestHandle } from '../helpers/pg-container'
import type { Envelope, TableSchema, SchemaInfo, TableInfo, TableColumnInfo } from '#shared/types'

process.env.LOUPEDB_MASTER_KEY = 'a'.repeat(64)
process.env.LOUPEDB_DATA_DIR = mkdtempSync(join(tmpdir(), 'loupedb-api-'))

describe('schema exploration API', async () => {
  await setup({ server: true, browser: false })

  let handle: PgTestHandle
  let connId: string

  beforeAll(async () => {
    handle = await startPgContainer()
    const seedSql = postgres({
      host: handle.config.host, port: handle.config.port, database: handle.config.database,
      username: handle.config.username, password: handle.config.password,
    })
    await seedSql.unsafe(`create schema app`).simple()
    await seedSql.unsafe(`create table app.users (id serial primary key, name text not null)`).simple()
    await seedSql.end()

    const created = await $fetch<Envelope<{ id: string }>>('/api/connections', {
      method: 'POST',
      body: {
        name: 'schema-t', driver: 'postgres', host: handle.config.host, port: handle.config.port,
        database: handle.config.database, username: handle.config.username, password: handle.config.password,
      },
    })
    if (!created.ok) throw new Error('setup connection failed')
    connId = created.data.id
  })
  afterAll(async () => { await handle.container.stop() })

  it('GET /schemas lists user schemas', async () => {
    const r = await $fetch<Envelope<SchemaInfo[]>>(`/api/connections/${connId}/schemas`)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.map(s => s.name)).toContain('app')
  })

  it('GET /tables?schema=app lists tables', async () => {
    const r = await $fetch<Envelope<TableInfo[]>>(`/api/connections/${connId}/tables?schema=app`)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.map(t => t.name)).toContain('users')
  })

  it('GET /columns?schema=app lists all columns for completion', async () => {
    const r = await $fetch<Envelope<TableColumnInfo[]>>(`/api/connections/${connId}/columns?schema=app`)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).toContainEqual({ table: 'users', name: 'id' })
      expect(r.data).toContainEqual({ table: 'users', name: 'name' })
    }
  })

  it('GET /tables/app/users describes the table', async () => {
    const r = await $fetch<Envelope<TableSchema>>(`/api/connections/${connId}/tables/app/users`)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.primaryKey).toEqual(['id'])
      expect(r.data.columns.find(c => c.name === 'name')?.type).toBe('string')
    }
  })

  it('unknown connection id returns NO_CONN envelope', async () => {
    const r = await $fetch<Envelope<never>>(`/api/connections/nope/schemas`)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('NO_CONN')
  })
})
