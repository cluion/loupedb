import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setup, $fetch, fetch as testFetch } from '@nuxt/test-utils/e2e'
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
    await seedSql.unsafe(`create table notes (label text)`).simple()
    await seedSql.unsafe(`create table contacts (email text not null unique, label text)`).simple()
    await seedSql.unsafe(`insert into contacts values ('a@example.com', 'A')`).simple()
    await seedSql.unsafe(`create table batch_items (id serial primary key, label text not null)`).simple()
    await seedSql.unsafe(`insert into batch_items (label) values ('one'), ('two')`).simple()
    await seedSql.unsafe(`create table content_items (
      id serial primary key, document jsonb not null, tags text[] not null
    )`).simple()
    await seedSql.unsafe(`insert into content_items (document, tags)
      values ('{"status":"draft"}', array['alpha','beta'])`).simple()
    await seedSql.unsafe(`create table binary_items (id serial primary key, payload bytea)`).simple()
    await seedSql.unsafe(`insert into binary_items (payload) values (decode('000102ff', 'hex'))`).simple()
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
    if (r.ok) {
      expect(r.data.rows.map(x => x.label)).toEqual(['b', 'c'])
      expect(r.data.rowVersions).toHaveLength(2)
      expect(r.data.columns.map((column) => column.name)).not.toContain('__loupedb_xmin')
    }
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

  it('POST /browse applies multiple OR filters', async () => {
    const r = await $fetch<Envelope<QueryResult>>(`/api/connections/${connId}/browse`, {
      method: 'POST',
      body: {
        schema: 'public', table: 'items',
        opts: {
          limit: 10, offset: 0, filterCombinator: 'or',
          filter: [
            { column: 'label', op: '=', value: 'a' },
            { column: 'qty', op: '>=', value: 3 },
          ],
        },
      },
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.rows.map(row => row.label)).toEqual(['a', 'c'])
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

  it('PATCH /cell and POST /changes accept JSON and array cell values', async () => {
    const updatedJson = await $fetch<Envelope<{ affectedRows: 1; row: Record<string, unknown> }>>(
      `/api/connections/${connId}/tables/public/content_items/cell`,
      {
        method: 'PATCH',
        body: {
          column: 'document', value: { status: 'published' },
          originalValue: { status: 'draft' }, identity: { id: 1 },
        },
      },
    )
    expect(updatedJson).toMatchObject({
      ok: true, data: { affectedRows: 1, row: { document: { status: 'published' } } },
    })

    const browsed = await $fetch<Envelope<QueryResult>>(`/api/connections/${connId}/browse`, {
      method: 'POST',
      body: { schema: 'public', table: 'content_items', opts: { limit: 1, offset: 0 } },
    })
    if (!browsed.ok) throw new Error('structured cell browse failed')
    const updatedArray = await $fetch<Envelope<{ affectedRows: number }>>(
      `/api/connections/${connId}/tables/public/content_items/changes`,
      {
        method: 'POST',
        body: {
          changes: [{
            kind: 'update', column: 'tags', value: ['gamma', 'delta'], originalValue: ['alpha', 'beta'],
            identity: { id: 1 }, version: browsed.data.rowVersions![0],
          }],
        },
      },
    )
    expect(updatedArray).toMatchObject({ ok: true, data: { affectedRows: 1 } })
  })

  it('summarizes binary cells, downloads bytes and applies staged uploads', async () => {
    const browsed = await $fetch<Envelope<QueryResult>>(`/api/connections/${connId}/browse`, {
      method: 'POST',
      body: { schema: 'public', table: 'binary_items', opts: { limit: 1, offset: 0 } },
    })
    if (!browsed.ok) throw new Error('binary browse failed')
    expect(browsed.data.rows[0]!.payload).toMatchObject({
      $loupedb: 'binary', byteLength: 4, checksum: expect.stringMatching(/^[0-9a-f]{32}$/u),
    })
    const version = browsed.data.rowVersions![0]!
    const download = await testFetch(
      `/api/connections/${connId}/tables/public/binary_items/binary`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ column: 'payload', identity: { id: 1 }, version }),
      },
    )
    expect([...new Uint8Array(await download.arrayBuffer())]).toEqual([0, 1, 2, 255])
    expect(download.headers.get('content-disposition')).toContain('binary_items-payload.bin')

    const uploaded = await $fetch<Envelope<{ affectedRows: number }>>(
      `/api/connections/${connId}/tables/public/binary_items/changes`,
      {
        method: 'POST',
        body: {
          changes: [{
            kind: 'update', column: 'payload',
            value: {
              $loupedb: 'binary-upload', base64: 'bmV3AA==', byteLength: 4,
              fileName: 'new.bin', mediaType: 'application/octet-stream',
            },
            originalValue: browsed.data.rows[0]!.payload,
            identity: { id: 1 },
            version,
          }],
        },
      },
    )
    expect(uploaded).toMatchObject({ ok: true, data: { affectedRows: 1 } })
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

  it('POST and DELETE /rows insert then safely delete by PK and row version', async () => {
    const inserted = await $fetch<Envelope<{ affectedRows: 1; row: Record<string, unknown> }>>(
      `/api/connections/${connId}/tables/public/items/rows`,
      { method: 'POST', body: { values: { label: 'inserted', qty: 9 } } },
    )
    expect(inserted.ok).toBe(true)
    if (!inserted.ok) return
    const id = inserted.data.row.id
    const browsed = await $fetch<Envelope<QueryResult>>(`/api/connections/${connId}/browse`, {
      method: 'POST',
      body: {
        schema: 'public', table: 'items',
        opts: { limit: 1, offset: 0, filter: [{ column: 'id', op: '=', value: id }] },
      },
    })
    expect(browsed.ok).toBe(true)
    if (!browsed.ok) return

    const deleted = await $fetch<Envelope<{ affectedRows: 1; row: Record<string, unknown> }>>(
      `/api/connections/${connId}/tables/public/items/rows`,
      {
        method: 'DELETE',
        body: { identity: { id }, version: browsed.data.rowVersions![0] },
      },
    )
    expect(deleted.ok).toBe(true)
    if (deleted.ok) expect(deleted.data.row).toMatchObject({ id, label: 'inserted' })
  })

  it('PATCH and DELETE accept a complete unique key identity', async () => {
    const updated = await $fetch<Envelope<{ affectedRows: 1; row: Record<string, unknown> }>>(
      `/api/connections/${connId}/tables/public/contacts/cell`,
      {
        method: 'PATCH',
        body: {
          column: 'label', value: 'edited', originalValue: 'A',
          identity: { email: 'a@example.com' },
        },
      },
    )
    expect(updated.ok).toBe(true)

    const browsed = await $fetch<Envelope<QueryResult>>(`/api/connections/${connId}/browse`, {
      method: 'POST',
      body: {
        schema: 'public', table: 'contacts',
        opts: { limit: 1, offset: 0, filter: [{ column: 'email', op: '=', value: 'a@example.com' }] },
      },
    })
    if (!browsed.ok) throw new Error('browse setup failed')
    const deleted = await $fetch<Envelope<{ affectedRows: 1 }>>(
      `/api/connections/${connId}/tables/public/contacts/rows`,
      {
        method: 'DELETE',
        body: { identity: { email: 'a@example.com' }, version: browsed.data.rowVersions![0] },
      },
    )
    expect(deleted.ok).toBe(true)
  })

  it('POST /changes applies an atomic staged batch and rolls it all back on conflict', async () => {
    const browseBatch = async () => await $fetch<Envelope<QueryResult>>(`/api/connections/${connId}/browse`, {
      method: 'POST',
      body: { schema: 'public', table: 'batch_items', opts: { limit: 10, offset: 0, orderBy: 'id' } },
    })
    const initial = await browseBatch()
    if (!initial.ok) throw new Error('batch browse setup failed')
    const applied = await $fetch<Envelope<{ affectedRows: number }>>(
      `/api/connections/${connId}/tables/public/batch_items/changes`,
      {
        method: 'POST',
        body: {
          changes: [
            {
              kind: 'update', column: 'label', value: 'edited', originalValue: 'one',
              identity: { id: 1 }, version: initial.data.rowVersions![0],
            },
            { kind: 'insert', values: { label: 'three' } },
          ],
        },
      },
    )
    expect(applied).toMatchObject({ ok: true, data: { affectedRows: 2 } })

    const beforeConflict = await browseBatch()
    if (!beforeConflict.ok) throw new Error('batch conflict setup failed')
    await $fetch(`/api/connections/${connId}/tables/public/batch_items/cell`, {
      method: 'PATCH',
      body: { column: 'label', value: 'newer', originalValue: 'two', identity: { id: 2 } },
    })
    const conflict = await $fetch<Envelope<never>>(
      `/api/connections/${connId}/tables/public/batch_items/changes`,
      {
        method: 'POST',
        body: {
          changes: [
            {
              kind: 'update', column: 'label', value: 'must rollback', originalValue: 'edited',
              identity: { id: 1 }, version: beforeConflict.data.rowVersions![0],
            },
            { kind: 'delete', identity: { id: 2 }, version: beforeConflict.data.rowVersions![1] },
          ],
        },
      },
    )
    expect(conflict.ok).toBe(false)
    if (!conflict.ok) expect(conflict.error.code).toBe('ROW_CHANGED')
    const after = await browseBatch()
    if (!after.ok) throw new Error('batch verification failed')
    expect(after.data.rows).toEqual([
      { id: 1, label: 'edited' },
      { id: 2, label: 'newer' },
      { id: 3, label: 'three' },
    ])
  })

  it('POST /changes validates non-empty staged changes', async () => {
    const response = await $fetch<Envelope<never>>(
      `/api/connections/${connId}/tables/public/batch_items/changes`,
      { method: 'POST', body: { changes: [] } },
    )
    expect(response.ok).toBe(false)
    if (!response.ok) expect(response.error.code).toBe('VALIDATION')
  })

  it('DELETE /rows rejects a stale row version', async () => {
    const browsed = await $fetch<Envelope<QueryResult>>(`/api/connections/${connId}/browse`, {
      method: 'POST',
      body: {
        schema: 'public', table: 'items',
        opts: { limit: 1, offset: 0, filter: [{ column: 'id', op: '=', value: 2 }] },
      },
    })
    if (!browsed.ok) throw new Error('browse setup failed')
    await $fetch(`/api/connections/${connId}/tables/public/items/cell`, {
      method: 'PATCH',
      body: { column: 'label', value: 'newer', originalValue: 'b', identity: { id: 2 } },
    })
    const stale = await $fetch<Envelope<never>>(`/api/connections/${connId}/tables/public/items/rows`, {
      method: 'DELETE', body: { identity: { id: 2 }, version: browsed.data.rowVersions![0] },
    })
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.error.code).toBe('ROW_CHANGED')
  })

  it('allows insert but rejects delete on a table without a safe key', async () => {
    const inserted = await $fetch<Envelope<{ affectedRows: 1 }>>(
      `/api/connections/${connId}/tables/public/notes/rows`,
      { method: 'POST', body: { values: { label: 'note' } } },
    )
    expect(inserted.ok).toBe(true)
    const deleted = await $fetch<Envelope<never>>(`/api/connections/${connId}/tables/public/notes/rows`, {
      method: 'DELETE', body: { identity: { label: 'note' }, version: '1' },
    })
    expect(deleted.ok).toBe(false)
    if (!deleted.ok) expect(deleted.error.code).toBe('SAFE_EDIT_REQUIRED')
  })

  it('validates row mutation values and row versions', async () => {
    const complexValue = await $fetch<Envelope<never>>(`/api/connections/${connId}/tables/public/items/rows`, {
      method: 'POST', body: { values: { label: { nested: true } } },
    })
    expect(complexValue.ok).toBe(false)
    if (!complexValue.ok) expect(complexValue.error.code).toBe('VALIDATION')

    const invalidVersion = await $fetch<Envelope<never>>(`/api/connections/${connId}/tables/public/items/rows`, {
      method: 'DELETE', body: { identity: { id: 1 }, version: 'not-an-xmin' },
    })
    expect(invalidVersion.ok).toBe(false)
    if (!invalidVersion.ok) expect(invalidVersion.error.code).toBe('VALIDATION')
  })
})
