import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { saveConnections, loadConnections } from '../../server/security/connectionStore'
import type { ConnectionConfig } from '#shared/types'

const tmpDir = join(process.cwd(), '.tmp-store-test')
const conn: ConnectionConfig = {
  name: 'local', driver: 'postgres', host: 'localhost', port: 5432,
  database: 'db', username: 'root', password: 'p@ss', ssl: 'disable',
  environment: 'production', safetyMode: 'safe',
}

describe('connectionStore', () => {
  beforeEach(() => {
    process.env.LOUPEDB_MASTER_KEY = 'a'.repeat(64)
    process.env.LOUPEDB_DATA_DIR = tmpDir
    mkdirSync(tmpDir, { recursive: true })
  })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('load restores saved connections including password', async () => {
    await saveConnections([conn])
    const loaded = await loadConnections()
    expect(loaded[0]!.password).toBe('p@ss')
    expect(loaded[0]!.host).toBe('localhost')
    expect(loaded[0]!.ssl).toBe('disable')
    expect(loaded[0]).toMatchObject({ environment: 'production', safetyMode: 'safe' })
  })

  it('file contains no plaintext password field', async () => {
    await saveConnections([conn])
    const raw = readFileSync(join(tmpDir, 'connections.json'), 'utf8')
    expect(raw).not.toContain('p@ss')
    expect(raw).not.toContain('"password"') // only passwordEnc may exist
  })

  it('load returns empty list when file does not exist', async () => {
    const loaded = await loadConnections()
    expect(loaded).toEqual([])
  })

  it('migrates legacy saved connections to development normal mode', async () => {
    await saveConnections([conn])
    const path = join(tmpDir, 'connections.json')
    const stored = JSON.parse(readFileSync(path, 'utf8')) as Array<Record<string, unknown>>
    delete stored[0]!.environment
    delete stored[0]!.safetyMode
    writeFileSync(path, JSON.stringify(stored), 'utf8')

    const loaded = await loadConnections()
    expect(loaded[0]).toMatchObject({ environment: 'development', safetyMode: 'normal' })
  })
})
