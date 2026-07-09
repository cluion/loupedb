import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'
import postgres from 'postgres'
import { startPgContainer, type PgTestHandle } from '../helpers/pg-container'
import type { Envelope, DatabaseInfo, QueryResult } from '#shared/types'

process.env.LOUPEDB_MASTER_KEY = 'a'.repeat(64)
process.env.LOUPEDB_DATA_DIR = mkdtempSync(join(tmpdir(), 'loupedb-api-'))

describe('multi-database API', async () => {
  await setup({ server: true, browser: false })

  let handle: PgTestHandle
  let connId: string

  beforeAll(async () => {
    handle = await startPgContainer()
    const admin = postgres({
      host: handle.config.host, port: handle.config.port, database: handle.config.database,
      username: handle.config.username, password: handle.config.password,
    })
    await admin.unsafe(`create database seconddb`).simple()
    await admin.end()

    // seed a table inside the second database
    const second = postgres({
      host: handle.config.host, port: handle.config.port, database: 'seconddb',
      username: handle.config.username, password: handle.config.password,
    })
    await second.unsafe(`create table widgets (id serial primary key, label text)`).simple()
    await second.unsafe(`insert into widgets (label) values ('w1')`).simple()
    await second.end()

    const created = await $fetch<Envelope<{ id: string }>>('/api/connections', {
      method: 'POST',
      body: {
        name: 'multi-t', driver: 'postgres', host: handle.config.host, port: handle.config.port,
        database: handle.config.database, username: handle.config.username, password: handle.config.password,
      },
    })
    if (!created.ok) throw new Error('setup connection failed')
    connId = created.data.id
  })
  afterAll(async () => { await handle.container.stop() })

  it('GET /databases lists all connectable databases on the server', async () => {
    const r = await $fetch<Envelope<DatabaseInfo[]>>(`/api/connections/${connId}/databases`)
    expect(r.ok).toBe(true)
    if (r.ok) {
      const names = r.data.map(d => d.name)
      expect(names).toContain('loupedb_test')
      expect(names).toContain('seconddb')
      expect(names).not.toContain('template0')
    }
  })

  it('POST /use-database opens a sibling session to another database', async () => {
    const r = await $fetch<Envelope<{ id: string }>>(`/api/connections/${connId}/use-database`, {
      method: 'POST', body: { database: 'seconddb' },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.id).not.toBe(connId)

    // the sibling session really is bound to seconddb
    const q = await $fetch<Envelope<QueryResult>>(`/api/connections/${r.data.id}/query`, {
      method: 'POST', body: { sql: 'select label from widgets' },
    })
    expect(q.ok).toBe(true)
    if (q.ok) expect(q.data.rows).toEqual([{ label: 'w1' }])
  })

  it('POST /use-database with the current database returns the same session', async () => {
    const r = await $fetch<Envelope<{ id: string }>>(`/api/connections/${connId}/use-database`, {
      method: 'POST', body: { database: handle.config.database },
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.id).toBe(connId)
  })

  it('deleting the root connection cascades to its sibling sessions', async () => {
    const created = await $fetch<Envelope<{ id: string }>>('/api/connections', {
      method: 'POST',
      body: {
        name: 'cascade-t', driver: 'postgres', host: handle.config.host, port: handle.config.port,
        database: handle.config.database, username: handle.config.username, password: handle.config.password,
      },
    })
    if (!created.ok) throw new Error('setup failed')
    const sibling = await $fetch<Envelope<{ id: string }>>(`/api/connections/${created.data.id}/use-database`, {
      method: 'POST', body: { database: 'seconddb' },
    })
    if (!sibling.ok) throw new Error('sibling failed')

    await $fetch(`/api/connections/${created.data.id}`, { method: 'DELETE' })
    const after = await $fetch<Envelope<never>>(`/api/connections/${sibling.data.id}/schemas`)
    expect(after.ok).toBe(false)
    if (!after.ok) expect(after.error.code).toBe('NO_CONN')
  })

  it('POST /use-database on unknown session returns NO_CONN', async () => {
    const r = await $fetch<Envelope<never>>(`/api/connections/nope/use-database`, {
      method: 'POST', body: { database: 'seconddb' },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('NO_CONN')
  })
})
