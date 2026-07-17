import type { ConnectionConfig, ConnectionStatus, BrowseOpts } from '#shared/types'
import type { DatabaseDriver } from '../../core/driver'
import { createConnection, type PostgresHandle } from './connection'
import { listDatabases, listSchemas, listTables, listColumns, describeTable } from './schema'
import { executeUnsafe, browseTable, type CancellableQuery } from './query'
import { cancelQuery, streamTable } from './stream'

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
        await handle.run(async (sql) => { await sql`select 1` }) // verify connectivity
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

    async listDatabases() {
      if (!handle) throw new Error('not connected')
      return handle.run(listDatabases)
    },
    async listSchemas() {
      if (!handle) throw new Error('not connected')
      return handle.run(listSchemas)
    },
    async listTables(schema: string) {
      if (!handle) throw new Error('not connected')
      return handle.run((sql) => listTables(sql, schema))
    },
    async listColumns(schema: string) {
      if (!handle) throw new Error('not connected')
      return handle.run((sql) => listColumns(sql, schema))
    },
    async describeTable(schema: string, table: string) {
      if (!handle) throw new Error('not connected')
      return handle.run((sql) => describeTable(sql, schema, table))
    },

    async execute(sqlText: string, params: ReadonlyArray<unknown> = [], queryId?: string) {
      if (!handle) throw new Error('not connected')
      const session = await handle.reserve()
      try {
        return await executeUnsafe(
          session.sql, sqlText, params, queryId, activeQueries, oidCache, session.takeMessages,
        )
      } finally {
        session.release()
      }
    },
    async* executeScript(statements: ReadonlyArray<string>, queryId?: string) {
      if (!handle) throw new Error('not connected')
      const session = await handle.reserve()
      try {
        for (const statement of statements) {
          yield await executeUnsafe(
            session.sql, statement, [], queryId, activeQueries, oidCache, session.takeMessages,
          )
        }
      } finally {
        // Never return a reserved connection with an open or aborted explicit
        // transaction. Outside a transaction PostgreSQL treats this as a no-op.
        try { await session.sql.unsafe('rollback') } catch { /* connection failure already makes it unusable */ }
        session.release()
      }
    },
    async browse(schema: string, table: string, opts: BrowseOpts, queryId?: string) {
      if (!handle) throw new Error('not connected')
      return handle.run((sql) => browseTable(sql, schema, table, opts, queryId, activeQueries, oidCache))
    },

    async cancel(queryId: string) {
      await cancelQuery(activeQueries, queryId)
    },
    async* stream(schema: string, table: string, opts: BrowseOpts, batchSize: number, queryId?: string) {
      if (!handle) throw new Error('not connected')
      const session = await handle.reserve()
      try {
        yield* streamTable(session.sql, schema, table, opts, batchSize, queryId, activeQueries)
      } finally {
        session.release()
      }
    },
  }
}
