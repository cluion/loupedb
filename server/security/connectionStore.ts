import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ConnectionConfig } from '#shared/types'
import { encrypt, decrypt } from './crypto'

interface StoredConnection {
  readonly name: string
  readonly driver: ConnectionConfig['driver']
  readonly host: string
  readonly port: number
  readonly database: string
  readonly username: string
  readonly passwordEnc: string
  readonly ssl: ConnectionConfig['ssl']
}

function dataDir(): string {
  return process.env.LOUPEDB_DATA_DIR ?? './data'
}

function file(): string {
  return join(dataDir(), 'connections.json')
}

export async function saveConnections(list: ReadonlyArray<ConnectionConfig>): Promise<void> {
  // fields are built explicitly - spreading the config would leak the
  // plaintext password field into the file
  const stored: StoredConnection[] = list.map((c) => ({
    name: c.name, driver: c.driver, host: c.host, port: c.port,
    database: c.database, username: c.username,
    passwordEnc: encrypt(c.password), ssl: c.ssl,
  }))
  await mkdir(dataDir(), { recursive: true })
  await writeFile(file(), JSON.stringify(stored, null, 2), 'utf8')
}

export async function loadConnections(): Promise<ConnectionConfig[]> {
  try {
    const raw = await readFile(file(), 'utf8')
    const stored = JSON.parse(raw) as StoredConnection[]
    return stored.map((s) => ({
      name: s.name, driver: s.driver, host: s.host, port: s.port,
      database: s.database, username: s.username,
      password: decrypt(s.passwordEnc), ssl: s.ssl,
    }))
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}
