import type { ConnectionConfig, ConnectionStatus } from '#shared/types'
import type { DatabaseDriver } from '../../core/driver'
import { createConnection, type PostgresHandle } from './connection'
import { listSchemas, listTables, describeTable } from './schema'

export function createPostgresDriver(config: ConnectionConfig): DatabaseDriver {
  let handle: PostgresHandle | null = null
  let status: ConnectionStatus = 'closed' // per-instance state via closure

  return {
    config,
    async connect() {
      status = 'connecting'
      try {
        handle = createConnection(config)
        await handle.sql`select 1` // verify connectivity
        status = 'connected'
      } catch (err) {
        status = 'error'
        throw err
      }
    },
    async disconnect() {
      if (handle) { await handle.close(); handle = null }
      status = 'closed'
    },
    get status() { return status },

    async listSchemas() {
      if (!handle) throw new Error('not connected')
      return listSchemas(handle.sql)
    },
    async listTables(schema: string) {
      if (!handle) throw new Error('not connected')
      return listTables(handle.sql, schema)
    },
    async describeTable(schema: string, table: string) {
      if (!handle) throw new Error('not connected')
      return describeTable(handle.sql, schema, table)
    },

    // implemented by later tasks
    async execute() { throw new Error('not implemented: execute') },
    async browse() { throw new Error('not implemented: browse') },
    async cancel() { throw new Error('not implemented: cancel') },
    // eslint-disable-next-line require-yield
    async* stream() { throw new Error('not implemented: stream') },
  }
}
