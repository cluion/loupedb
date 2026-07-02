import postgres from 'postgres'
import type { ConnectionConfig } from '#shared/types'

export interface PostgresHandle {
  readonly sql: ReturnType<typeof postgres>
  close(): Promise<void>
}

// connection status is NOT stored here: module-level state would be shared
// across all driver instances - each driver holds status in its own closure
export function createConnection(config: ConnectionConfig): PostgresHandle {
  const ssl = config.ssl === 'disable' ? false : config.ssl
  const sql = postgres({
    host: config.host, port: config.port, database: config.database,
    username: config.username, password: config.password, ssl,
    max: 3, idle_timeout: 1800, connect_timeout: 10,
    connection: { statement_timeout: 30000, application_name: 'loupedb' },
    onnotice: () => {},
  })
  return {
    sql,
    async close() { await sql.end({ timeout: 5 }) },
  }
}
