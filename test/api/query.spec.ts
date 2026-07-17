import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'
import postgres from 'postgres'
import { startPgContainer, type PgTestHandle } from '../helpers/pg-container'
import type { Envelope, QueryResult, ScriptExecutionResult } from '#shared/types'

process.env.LOUPEDB_MASTER_KEY = 'a'.repeat(64)
process.env.LOUPEDB_DATA_DIR = mkdtempSync(join(tmpdir(), 'loupedb-api-'))

describe('query API', async () => {
  await setup({ server: true, browser: false })

  let handle: PgTestHandle
  let connId: string

  beforeAll(async () => {
    handle = await startPgContainer()
    const seedSql = postgres({
      host: handle.config.host, port: handle.config.port, database: handle.config.database,
      username: handle.config.username, password: handle.config.password,
    })
    await seedSql.unsafe(`create table items (id serial primary key, label text)`).simple()
    await seedSql.unsafe(`insert into items (label) values ('a'), ('b')`).simple()
    await seedSql.end()

    const created = await $fetch<Envelope<{ id: string }>>('/api/connections', {
      method: 'POST',
      body: {
        name: 'query-t', driver: 'postgres', host: handle.config.host, port: handle.config.port,
        database: handle.config.database, username: handle.config.username, password: handle.config.password,
      },
    })
    if (!created.ok) throw new Error('setup connection failed')
    connId = created.data.id
  })
  afterAll(async () => { await handle.container.stop() })

  it('POST /query executes sql and returns QueryResult envelope', async () => {
    const r = await $fetch<Envelope<QueryResult>>(`/api/connections/${connId}/query`, {
      method: 'POST', body: { sql: 'select id, label from items order by id' },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.columns.map(c => c.name)).toEqual(['id', 'label'])
      expect(r.data.rows).toHaveLength(2)
    }
  })

  it('POST /query with params', async () => {
    const r = await $fetch<Envelope<QueryResult>>(`/api/connections/${connId}/query`, {
      method: 'POST', body: { sql: 'select label from items where id > $1', params: [1] },
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.rows.map(x => x.label)).toEqual(['b'])
  })

  it('sql error returns fail envelope with redacted-safe message', async () => {
    const r = await $fetch<Envelope<QueryResult>>(`/api/connections/${connId}/query`, {
      method: 'POST', body: { sql: 'select * from does_not_exist' },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('42P01') // undefined_table
  })

  it('POST /script executes statements sequentially and returns every result', async () => {
    const r = await $fetch<Envelope<ScriptExecutionResult>>(`/api/connections/${connId}/script`, {
      method: 'POST',
      body: {
        sql: `select 'first' as step;
update items set label = upper(label) where id = 1;
select label from items where id = 1;`,
      },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.status).toBe('success')
      expect(r.data.statements).toHaveLength(3)
      expect(r.data.statements.map((entry) => entry.status)).toEqual(['success', 'success', 'success'])
      const [first, update, last] = r.data.statements
      if (first?.status === 'success') expect(first.result.rows).toEqual([{ step: 'first' }])
      if (update?.status === 'success') expect(update.result.affectedRows).toBe(1)
      if (last?.status === 'success') expect(last.result.rows).toEqual([{ label: 'A' }])
    }
  })

  it('POST /script keeps completed results and stops at the first error', async () => {
    const r = await $fetch<Envelope<ScriptExecutionResult>>(`/api/connections/${connId}/script`, {
      method: 'POST', body: { sql: 'select 1 as ok; select * from missing_script_table; select 3;' },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.status).toBe('error')
      expect(r.data.statements).toHaveLength(2)
      expect(r.data.statements[0]?.status).toBe('success')
      expect(r.data.statements[1]?.status).toBe('error')
      const failed = r.data.statements[1]
      if (failed?.status === 'error') expect(failed.error.code).toBe('42P01')
    }
  })
})
