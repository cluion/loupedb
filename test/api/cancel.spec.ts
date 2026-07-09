import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'
import { startPgContainer, type PgTestHandle } from '../helpers/pg-container'
import type { Envelope, QueryResult } from '#shared/types'

process.env.LOUPEDB_MASTER_KEY = 'a'.repeat(64)
process.env.LOUPEDB_DATA_DIR = mkdtempSync(join(tmpdir(), 'loupedb-api-'))

describe('cancel API', async () => {
  await setup({ server: true, browser: false })

  let handle: PgTestHandle
  let connId: string

  beforeAll(async () => {
    handle = await startPgContainer()
    const created = await $fetch<Envelope<{ id: string }>>('/api/connections', {
      method: 'POST',
      body: {
        name: 'cancel-t', driver: 'postgres', host: handle.config.host, port: handle.config.port,
        database: handle.config.database, username: handle.config.username, password: handle.config.password,
      },
    })
    if (!created.ok) throw new Error('setup connection failed')
    connId = created.data.id
  })
  afterAll(async () => { await handle.container.stop() })

  it('POST /cancel aborts a running query by queryId', async () => {
    const queryId = 'api-cancel-1'
    const long = $fetch<Envelope<QueryResult>>(`/api/connections/${connId}/query`, {
      method: 'POST', body: { sql: 'select pg_sleep(10)', queryId },
    })
    await new Promise((r) => setTimeout(r, 300))
    const cancel = await $fetch<Envelope<void>>(`/api/connections/${connId}/cancel`, {
      method: 'POST', body: { queryId },
    })
    expect(cancel.ok).toBe(true)
    const result = await long
    expect(result.ok).toBe(false) // query was cancelled, envelope carries the error
  })
})
