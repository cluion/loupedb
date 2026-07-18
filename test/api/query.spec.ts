import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'
import postgres from 'postgres'
import { startPgContainer, type PgTestHandle } from '../helpers/pg-container'
import type { Envelope, QueryResult, ScriptExecutionResult, TransactionState } from '#shared/types'

process.env.LOUPEDB_MASTER_KEY = 'a'.repeat(64)
process.env.LOUPEDB_DATA_DIR = mkdtempSync(join(tmpdir(), 'loupedb-api-'))

describe('query API', async () => {
  await setup({ server: true, browser: false })

  let handle: PgTestHandle
  let connId: string
  let safeConnId: string
  let readOnlyConnId: string

  beforeAll(async () => {
    handle = await startPgContainer()
    const seedSql = postgres({
      host: handle.config.host, port: handle.config.port, database: handle.config.database,
      username: handle.config.username, password: handle.config.password,
    })
    await seedSql.unsafe(`create table items (id serial primary key, label text)`).simple()
    await seedSql.unsafe(`insert into items (label) values ('a'), ('b')`).simple()
    await seedSql.unsafe(`
      create function write_item(value text) returns integer language plpgsql as $$
      begin
        insert into items (label) values (value);
        return 1;
      end
      $$
    `).simple()
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

    const safe = await $fetch<Envelope<{ id: string }>>('/api/connections', {
      method: 'POST',
      body: {
        name: 'query-safe', driver: 'postgres', host: handle.config.host, port: handle.config.port,
        database: handle.config.database, username: handle.config.username, password: handle.config.password,
        environment: 'production', safetyMode: 'safe',
      },
    })
    if (!safe.ok) throw new Error('setup safe connection failed')
    safeConnId = safe.data.id

    const readOnly = await $fetch<Envelope<{ id: string }>>('/api/connections', {
      method: 'POST',
      body: {
        name: 'query-read-only', driver: 'postgres', host: handle.config.host, port: handle.config.port,
        database: handle.config.database, username: handle.config.username, password: handle.config.password,
        environment: 'production', safetyMode: 'read-only',
      },
    })
    if (!readOnly.ok) throw new Error('setup read-only connection failed')
    readOnlyConnId = readOnly.data.id
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

  it('requires explicit Safe mode confirmation before dangerous query or script execution', async () => {
    const blocked = await $fetch<Envelope<QueryResult>>(`/api/connections/${safeConnId}/query`, {
      method: 'POST', body: { sql: "update items set label = 'blocked' where id = 2" },
    })
    expect(!blocked.ok && blocked.error.code).toBe('SAFETY_CONFIRMATION_REQUIRED')

    const script = await $fetch<Envelope<ScriptExecutionResult>>(`/api/connections/${safeConnId}/script`, {
      method: 'POST', body: { sql: "select 99; delete from items where id = 2;" },
    })
    expect(!script.ok && script.error.code).toBe('SAFETY_CONFIRMATION_REQUIRED')

    const confirmed = await $fetch<Envelope<QueryResult>>(`/api/connections/${safeConnId}/query`, {
      method: 'POST',
      body: {
        sql: "update items set label = 'confirmed' where id = 2",
        confirmedDangerous: true,
      },
    })
    expect(confirmed.ok && confirmed.data.affectedRows).toBe(1)
    await $fetch(`/api/connections/${safeConnId}/query`, {
      method: 'POST',
      body: { sql: "update items set label = 'b' where id = 2", confirmedDangerous: true },
    })
  })

  it('enforces Read-only in both API policy and PostgreSQL session', async () => {
    const read = await $fetch<Envelope<QueryResult>>(`/api/connections/${readOnlyConnId}/query`, {
      method: 'POST', body: { sql: 'select count(*)::int as total from items' },
    })
    expect(read.ok).toBe(true)

    const blockedSql = await $fetch<Envelope<QueryResult>>(`/api/connections/${readOnlyConnId}/query`, {
      method: 'POST', body: { sql: 'create table read_only_blocked(id int)' },
    })
    expect(!blockedSql.ok && blockedSql.error.code).toBe('READ_ONLY_MODE')

    // SELECT itself passes the policy classifier; PostgreSQL's read-only
    // transaction setting still blocks a writing function.
    const writingFunction = await $fetch<Envelope<QueryResult>>(`/api/connections/${readOnlyConnId}/query`, {
      method: 'POST', body: { sql: "select write_item('blocked function')" },
    })
    expect(!writingFunction.ok && writingFunction.error.code).toBe('25006')

    const blockedGridInsert = await $fetch<Envelope<QueryResult>>(
      `/api/connections/${readOnlyConnId}/tables/public/items/rows`,
      { method: 'POST', body: { values: { label: 'blocked grid' } } },
    )
    expect(!blockedGridInsert.ok && blockedGridInsert.error.code).toBe('READ_ONLY_MODE')
  })

  it('manages a connection-level manual transaction', async () => {
    const status = await $fetch<Envelope<TransactionState>>(`/api/connections/${connId}/transaction`)
    expect(status).toEqual({ ok: true, data: { status: 'idle', startedAt: null } })

    const begin = await $fetch<Envelope<TransactionState>>(`/api/connections/${connId}/transaction`, {
      method: 'POST', body: { action: 'begin' },
    })
    expect(begin.ok && begin.data.status).toBe('active')
    await $fetch<Envelope<QueryResult>>(`/api/connections/${connId}/query`, {
      method: 'POST', body: { sql: "update items set label = 'pending' where id = 2" },
    })
    const inside = await $fetch<Envelope<QueryResult>>(`/api/connections/${connId}/query`, {
      method: 'POST', body: { sql: 'select label from items where id = 2' },
    })
    expect(inside.ok && inside.data.rows).toEqual([{ label: 'pending' }])

    const rollback = await $fetch<Envelope<TransactionState>>(`/api/connections/${connId}/transaction`, {
      method: 'POST', body: { action: 'rollback' },
    })
    expect(rollback).toEqual({ ok: true, data: { status: 'idle', startedAt: null } })
    const after = await $fetch<Envelope<QueryResult>>(`/api/connections/${connId}/query`, {
      method: 'POST', body: { sql: 'select label from items where id = 2' },
    })
    expect(after.ok && after.data.rows).toEqual([{ label: 'b' }])
  })

  it('reports an aborted transaction until rollback', async () => {
    await $fetch(`/api/connections/${connId}/transaction`, {
      method: 'POST', body: { action: 'begin' },
    })
    const failed = await $fetch<Envelope<QueryResult>>(`/api/connections/${connId}/query`, {
      method: 'POST', body: { sql: 'select * from missing_in_transaction' },
    })
    expect(failed.ok).toBe(false)
    const status = await $fetch<Envelope<TransactionState>>(`/api/connections/${connId}/transaction`)
    expect(status.ok && status.data.status).toBe('failed')
    const commit = await $fetch<Envelope<TransactionState>>(`/api/connections/${connId}/transaction`, {
      method: 'POST', body: { action: 'commit' },
    })
    expect(!commit.ok && commit.error.code).toBe('TX_FAILED')
    await $fetch(`/api/connections/${connId}/transaction`, {
      method: 'POST', body: { action: 'rollback' },
    })
  })

  it('POST /query returns PostgreSQL notices and warnings', async () => {
    const r = await $fetch<Envelope<QueryResult>>(`/api/connections/${connId}/query`, {
      method: 'POST',
      body: { sql: `do $$ begin raise notice 'api notice'; raise warning 'api warning'; end $$` },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.messages).toMatchObject([
        { severity: 'notice', message: 'api notice', code: '00000' },
        { severity: 'warning', message: 'api warning', code: '01000' },
      ])
    }
  })

  it('sql error returns fail envelope with redacted-safe message', async () => {
    const r = await $fetch<Envelope<QueryResult>>(`/api/connections/${connId}/query`, {
      method: 'POST', body: { sql: 'select * from does_not_exist' },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('42P01') // undefined_table
  })

  it('sql error keeps messages emitted before the failure', async () => {
    const r = await $fetch<Envelope<QueryResult>>(`/api/connections/${connId}/query`, {
      method: 'POST',
      body: { sql: `do $$ begin raise notice 'before api failure'; raise exception 'boom'; end $$` },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.messages?.[0]?.message).toBe('before api failure')
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
