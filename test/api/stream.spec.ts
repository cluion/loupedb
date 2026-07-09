import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setup, $fetch, url } from '@nuxt/test-utils/e2e'
import postgres from 'postgres'
import { startPgContainer, type PgTestHandle } from '../helpers/pg-container'
import type { Envelope } from '#shared/types'

process.env.LOUPEDB_MASTER_KEY = 'a'.repeat(64)
process.env.LOUPEDB_DATA_DIR = mkdtempSync(join(tmpdir(), 'loupedb-api-'))

function parseSseData(raw: string): unknown[] {
  return raw.split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => JSON.parse(line.slice(5).trim()))
}

describe('stream API', async () => {
  await setup({ server: true, browser: false })

  let handle: PgTestHandle
  let connId: string

  beforeAll(async () => {
    handle = await startPgContainer()
    const seedSql = postgres({
      host: handle.config.host, port: handle.config.port, database: handle.config.database,
      username: handle.config.username, password: handle.config.password,
    })
    await seedSql.unsafe(`create table logs (id serial primary key)`).simple()
    await seedSql.unsafe(`insert into logs (id) select generate_series(1, 25)`).simple()
    await seedSql.end()

    const created = await $fetch<Envelope<{ id: string }>>('/api/connections', {
      method: 'POST',
      body: {
        name: 'stream-t', driver: 'postgres', host: handle.config.host, port: handle.config.port,
        database: handle.config.database, username: handle.config.username, password: handle.config.password,
      },
    })
    if (!created.ok) throw new Error('setup connection failed')
    connId = created.data.id
  })
  afterAll(async () => { await handle.container.stop() })

  it('GET /stream pushes SSE batches until done', async () => {
    const res = await fetch(url(`/api/connections/${connId}/stream?schema=public&table=logs&queryId=s1&batchSize=10`))
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const events = parseSseData(await res.text()) as Array<Record<string, unknown>[]>
    const batches = events.filter(Array.isArray)
    expect(batches.map(b => b.length)).toEqual([10, 10, 5])
  })

  it('unknown connection id yields an error event', async () => {
    const res = await fetch(url(`/api/connections/nope/stream?schema=public&table=logs&batchSize=10`))
    const events = parseSseData(await res.text())
    expect(events.some(e => typeof e === 'object' && e !== null && 'error' in e)).toBe(true)
  })

  it('invalid identifier yields an error event, not table content', async () => {
    const res = await fetch(url(`/api/connections/${connId}/stream?schema=public&table=${encodeURIComponent('logs"; drop')}&batchSize=10`))
    const events = parseSseData(await res.text())
    expect(events.some(e => typeof e === 'object' && e !== null && 'error' in e)).toBe(true)
  })
})
