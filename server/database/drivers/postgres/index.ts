import type { ConnectionConfig, ConnectionStatus, BrowseOpts } from '#shared/types'
import type { DatabaseDriver } from '../../core/driver'
import { createConnection, type PostgresHandle } from './connection'
import { listSchemas, listTables, describeTable } from './schema'
import { executeUnsafe, browseTable, type CancellableQuery } from './query'

export function createPostgresDriver(config: ConnectionConfig): DatabaseDriver {
  let handle: PostgresHandle | null = null
  let status: ConnectionStatus = 'closed' // per-instance state via closure
  const activeQueries = new Map<string, CancellableQuery>()
  const oidCache = new Map<number, string>()

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

    async execute(sqlText: string, params: ReadonlyArray<unknown> = [], queryId?: string) {
      if (!handle) throw new Error('not connected')
      return executeUnsafe(handle.sql, sqlText, params, queryId, activeQueries, oidCache)
    },
    async browse(schema: string, table: string, opts: BrowseOpts, queryId?: string) {
      if (!handle) throw new Error('not connected')
      return browseTable(handle.sql, schema, table, opts, queryId, activeQueries, oidCache)
    },

    // implemented by later tasks
    async cancel() { throw new Error('not implemented: cancel') },
    // eslint-disable-next-line require-yield
    async* stream() { throw new Error('not implemented: stream') },
  }
}
