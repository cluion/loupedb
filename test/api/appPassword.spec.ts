import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { setup, url } from '@nuxt/test-utils/e2e'

process.env.LOUPEDB_MASTER_KEY = 'a'.repeat(64)
process.env.LOUPEDB_DATA_DIR = mkdtempSync(join(tmpdir(), 'loupedb-api-'))
process.env.LOUPEDB_APP_PASSWORD = 'hunter2'

describe('app password middleware', async () => {
  await setup({ server: true, browser: false })

  it('rejects /api requests without credentials with 401', async () => {
    const res = await fetch(url('/api/connections'))
    expect(res.status).toBe(401)
  })

  it('accepts requests with correct cookie', async () => {
    const res = await fetch(url('/api/connections'), {
      headers: { cookie: 'loupedb_app_pw=hunter2' },
    })
    expect(res.status).toBe(200)
  })

  it('accepts requests with correct header', async () => {
    const res = await fetch(url('/api/connections'), {
      headers: { 'x-loupedb-password': 'hunter2' },
    })
    expect(res.status).toBe(200)
  })

  it('rejects wrong password with 401', async () => {
    const res = await fetch(url('/api/connections'), {
      headers: { cookie: 'loupedb_app_pw=wrong' },
    })
    expect(res.status).toBe(401)
  })

  it('does not gate non-api paths', async () => {
    const res = await fetch(url('/'))
    expect(res.status).toBe(200)
  })
})
