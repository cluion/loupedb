import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'
import postgres from 'postgres'
import { startPgContainer, type PgTestHandle } from '../helpers/pg-container'
import type { Envelope, QueryResult } from '#shared/types'

process.env.LOUPEDB_MASTER_KEY = 'a'.repeat(64)
process.env.LOUPEDB_DATA_DIR = mkdtempSync(join(tmpdir(), 'loupedb-api-'))

describe('browse API', async () => {
  await setup({ server: true, browser: false })

  let handle: PgTestHandle
  let connId: string

  beforeAll(async () => {
    handle = await startPgContainer()
    const seedSql = postgres({
      host: handle.config.host, port: handle.config.port, database: handle.config.database,
      username: handle.config.username, password: handle.config.password,
    })
    await seedSql.unsafe(`create table items (id serial primary key, label text, qty int)`).simple()
    await seedSql.unsafe(`insert into items (label, qty) values ('a', 1), ('b', 2), ('c', 3)`).simple()
    await seedSql.end()

    const created = await $fetch<Envelope<{ id: string }>>('/api/connections', {
      method: 'POST',
      body: {
        name: 'browse-t', driver: 'postgres', host: handle.config.host, port: handle.config.port,
        database: handle.config.database, username: handle.config.username, password: handle.config.password,
      },
    })
    if (!created.ok) throw new Error('setup connection failed')
    connId = created.data.id
  })
  afterAll(async () => { await handle.container.stop() })

  it('POST /browse paginates with orderBy', async () => {
    const r = await $fetch<Envelope<QueryResult>>(`/api/connections/${connId}/browse`, {
      method: 'POST',
      body: { schema: 'public', table: 'items', opts: { limit: 2, offset: 1, orderBy: 'id', orderDir: 'asc' } },
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.rows.map(x => x.label)).toEqual(['b', 'c'])
  })

  it('POST /browse applies parameterized filter', async () => {
    const r = await $fetch<Envelope<QueryResult>>(`/api/connections/${connId}/browse`, {
      method: 'POST',
      body: {
        schema: 'public', table: 'items',
        opts: { limit: 10, offset: 0, filter: [{ column: 'qty', op: '>', value: 1 }] },
      },
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.rows).toHaveLength(2)
  })

  it('PATCH /cell updates exactly one row and rejects stale writes', async () => {
    const updated = await $fetch<Envelope<{ affectedRows: 1; row: Record<string, unknown> }>>(
      `/api/connections/${connId}/tables/public/items/cell`,
      {
        method: 'PATCH',
        body: { column: 'label', value: 'edited', originalValue: 'a', identity: { id: 1 } },
      },
    )
    expect(updated.ok).toBe(true)
    if (updated.ok) expect(updated.data).toMatchObject({ affectedRows: 1, row: { id: 1, label: 'edited' } })

    const stale = await $fetch<Envelope<never>>(`/api/connections/${connId}/tables/public/items/cell`, {
      method: 'PATCH',
      body: { column: 'label', value: 'lost update', originalValue: 'a', identity: { id: 1 } },
    })
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.error.code).toBe('ROW_CHANGED')
  })

  it('PATCH /cell validates row identity and keeps primary keys read-only', async () => {
    const missingIdentity = await $fetch<Envelope<never>>(`/api/connections/${connId}/tables/public/items/cell`, {
      method: 'PATCH', body: { column: 'label', value: 'x', originalValue: 'edited', identity: {} },
    })
    expect(missingIdentity.ok).toBe(false)
    if (!missingIdentity.ok) expect(missingIdentity.error.code).toBe('VALIDATION')

    const primaryKey = await $fetch<Envelope<never>>(`/api/connections/${connId}/tables/public/items/cell`, {
      method: 'PATCH', body: { column: 'id', value: 9, originalValue: 1, identity: { id: 1 } },
    })
    expect(primaryKey.ok).toBe(false)
    if (!primaryKey.ok) expect(primaryKey.error.code).toBe('READ_ONLY_COLUMN')
  })
})
