import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'
import { startPgContainer, type PgTestHandle } from '../helpers/pg-container'
import type { Envelope } from '#shared/types'

// server process inherits these via spawn env
const dataDir = mkdtempSync(join(tmpdir(), 'loupedb-api-'))
process.env.LOUPEDB_MASTER_KEY = 'a'.repeat(64)
process.env.LOUPEDB_DATA_DIR = dataDir

describe('connections API', async () => {
  await setup({ server: true, browser: false })

  let handle: PgTestHandle
  beforeAll(async () => { handle = await startPgContainer() })
  afterAll(async () => { await handle.container.stop() })

  const body = (name: string, extra: Record<string, unknown> = {}) => ({
    name, driver: 'postgres', host: handle.config.host, port: handle.config.port,
    database: handle.config.database, username: handle.config.username,
    password: handle.config.password,
    ...extra,
  })

  it('POST creates a session and returns id, GET lists without password, DELETE closes', async () => {
    const created = await $fetch<Envelope<{ id: string }>>('/api/connections', { method: 'POST', body: body('t') })
    expect(created.ok).toBe(true)
    const id = created.ok ? created.data.id : ''
    expect(id).toBeTypeOf('string')
    expect(id.length).toBeGreaterThan(0)
    if (created.ok) {
      expect(created.data).toMatchObject({
        name: 't', environment: 'development', safetyMode: 'normal',
      })
    }

    const list = await $fetch<Envelope<Array<{
      name: string
      environment: string
      safetyMode: string
    }>>>('/api/connections')
    expect(list.ok).toBe(true)
    if (list.ok) {
      expect(list.data.find(c => c.name === 't')).toMatchObject({
        environment: 'development', safetyMode: 'normal',
      })
    }
    expect(JSON.stringify(list)).not.toContain(handle.config.password)

    const del = await $fetch<Envelope<{ closed: boolean }>>(`/api/connections/${id}`, { method: 'DELETE' })
    expect(del.ok).toBe(true)
  })

  it('POST /open reconnects a saved connection without resending password', async () => {
    await $fetch('/api/connections', { method: 'POST', body: body('saved') })
    const reopened = await $fetch<Envelope<{ id: string }>>('/api/connections/open', {
      method: 'POST', body: { name: 'saved' },
    })
    expect(reopened.ok).toBe(true)
    if (reopened.ok) {
      expect(reopened.data).toMatchObject({
        id: expect.any(String), name: 'saved', environment: 'development', safetyMode: 'normal',
      })
    }
  })

  it('defaults production connections to safe mode and persists explicit read-only mode', async () => {
    const production = await $fetch<Envelope<{
      id: string
      environment: string
      safetyMode: string
    }>>('/api/connections', {
      method: 'POST', body: body('prod-safe', { environment: 'production' }),
    })
    expect(production.ok && production.data).toMatchObject({
      environment: 'production', safetyMode: 'safe',
    })

    const readOnly = await $fetch<Envelope<{
      id: string
      environment: string
      safetyMode: string
    }>>('/api/connections', {
      method: 'POST',
      body: body('prod-read-only', { environment: 'production', safetyMode: 'read-only' }),
    })
    expect(readOnly.ok && readOnly.data).toMatchObject({
      environment: 'production', safetyMode: 'read-only',
    })
  })

  it('POST /open unknown name returns NOT_FOUND envelope', async () => {
    const r = await $fetch<Envelope<never>>('/api/connections/open', {
      method: 'POST', body: { name: 'ghost' },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND')
  })

  it('same-name POST upserts instead of appending duplicates', async () => {
    await $fetch('/api/connections', { method: 'POST', body: body('dup') })
    await $fetch('/api/connections', { method: 'POST', body: body('dup') })
    const list = await $fetch<Envelope<Array<{ name: string }>>>('/api/connections')
    if (list.ok) expect(list.data.filter(c => c.name === 'dup')).toHaveLength(1)
  })

  it('stored file contains no plaintext password', async () => {
    await $fetch('/api/connections', { method: 'POST', body: body('filecheck') })
    const raw = readFileSync(join(dataDir, 'connections.json'), 'utf8')
    expect(raw).not.toContain(handle.config.password)
  })

  it('POST without database defaults to the postgres maintenance db', async () => {
    const { database: _database, ...noDb } = body('nodb')
    const created = await $fetch<Envelope<{ id: string }>>('/api/connections', { method: 'POST', body: noDb })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const q = await $fetch<Envelope<{ rows: Array<{ db: string }> }>>(`/api/connections/${created.data.id}/query`, {
      method: 'POST', body: { sql: 'select current_database() as db' },
    })
    if (q.ok) expect(q.data.rows).toEqual([{ db: 'postgres' }])
  })

  it('DELETE /saved/:name removes the stored config', async () => {
    await $fetch('/api/connections', { method: 'POST', body: body('to-delete') })
    const del = await $fetch<Envelope<{ deleted: boolean }>>(`/api/connections/saved/to-delete`, { method: 'DELETE' })
    expect(del.ok).toBe(true)
    const list = await $fetch<Envelope<Array<{ name: string }>>>('/api/connections')
    if (list.ok) expect(list.data.map(c => c.name)).not.toContain('to-delete')
  })

  it('POST with unreachable host returns error envelope, not a crash', async () => {
    const r = await $fetch<Envelope<never>>('/api/connections', {
      method: 'POST',
      body: { ...body('bad'), port: 1, host: '127.0.0.1' },
    })
    expect(r.ok).toBe(false)
  })
})
