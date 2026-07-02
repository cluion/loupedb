import type { ConnectionConfig, ConnectionStatus } from '#shared/types'
import type { DatabaseDriver } from '../../core/driver'
import { createConnection, type PostgresHandle } from './connection'

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

    // implemented by later tasks
    async listSchemas() { throw new Error('not implemented: listSchemas') },
    async listTables() { throw new Error('not implemented: listTables') },
    async describeTable() { throw new Error('not implemented: describeTable') },
    async execute() { throw new Error('not implemented: execute') },
    async browse() { throw new Error('not implemented: browse') },
    async cancel() { throw new Error('not implemented: cancel') },
    // eslint-disable-next-line require-yield
    async* stream() { throw new Error('not implemented: stream') },
  }
}
