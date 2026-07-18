import type { BinaryCellReadInput, CellUpdateInput, ConnectionConfig, ConnectionStatus, BrowseOpts, RowDeleteInput, RowInsertInput, TableChangesInput, TransactionState } from '#shared/types'
import type { DatabaseDriver } from '../../core/driver'
import { createConnection, type PostgresHandle, type PostgresSession } from './connection'
import { listDatabases, listSchemas, listTables, listColumns, listFunctions, describeTable } from './schema'
import { deleteTableRow, executeUnsafe, browseTable, insertTableRow, readTableBinaryCell, updateTableCell, type CancellableQuery } from './query'
import { cancelQuery, streamTable } from './stream'

function withoutLeadingComments(source: string): string {
  let sql = source
  while (true) {
    const trimmed = sql.trimStart()
    if (trimmed.startsWith('--')) {
      const newline = trimmed.indexOf('\n')
      sql = newline < 0 ? '' : trimmed.slice(newline + 1)
      continue
    }
    if (trimmed.startsWith('/*')) {
      const closing = trimmed.indexOf('*/', 2)
      if (closing < 0) return trimmed
      sql = trimmed.slice(closing + 2)
      continue
    }
    return trimmed
  }
}

function isTransactionBoundary(source: string): boolean {
  return /^(?:begin\b|start\s+transaction\b|commit\b|end\b|rollback\b|abort\b|prepare\s+transaction\b)/i
    .test(withoutLeadingComments(source))
}

function changeError(message: string): Error {
  return Object.assign(new Error(message), { code: 'INVALID_CHANGES', severity: 'ERROR' })
}

function identitySignature(identity: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(Object.keys(identity).sort().map((key) => [key, identity[key]]))
}

export function createPostgresDriver(config: ConnectionConfig): DatabaseDriver {
  let handle: PostgresHandle | null = null
  let status: ConnectionStatus = 'closed' // per-instance state via closure
  const activeQueries = new Map<string, CancellableQuery>()
  const oidCache = new Map<number, string>()
  let transaction: {
    readonly session: PostgresSession
    readonly startedAt: number
    status: 'active' | 'failed'
  } | null = null
  let transactionQueue = Promise.resolve()

  async function acquireTransactionLock(): Promise<() => void> {
    const previous = transactionQueue
    let release!: () => void
    transactionQueue = new Promise<void>((resolve) => { release = resolve })
    await previous
    return release
  }

  function transactionState(): TransactionState {
    return transaction
      ? { status: transaction.status, startedAt: transaction.startedAt }
      : { status: 'idle', startedAt: null }
  }

  function transactionError(code: string, message: string): Error {
    return Object.assign(new Error(message), { code, severity: 'ERROR' })
  }

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
      const unlock = await acquireTransactionLock()
      try {
        if (transaction) {
          try { await transaction.session.sql.unsafe('rollback') } catch { /* closing the connection also rolls back */ }
          transaction.session.release()
          transaction = null
        }
        if (handle) { await handle.close(); handle = null }
      } finally {
        unlock()
      }
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
    async listFunctions(schema: string) {
      if (!handle) throw new Error('not connected')
      return handle.run((sql) => listFunctions(sql, schema))
    },
    async describeTable(schema: string, table: string) {
      if (!handle) throw new Error('not connected')
      return handle.run((sql) => describeTable(sql, schema, table))
    },

    async execute(sqlText: string, params: ReadonlyArray<unknown> = [], queryId?: string) {
      if (!handle) throw new Error('not connected')
      if (isTransactionBoundary(sqlText)) {
        throw transactionError('TX_CONTROL', 'use the transaction controls to begin, commit or rollback')
      }
      const currentHandle = handle
      const unlock = await acquireTransactionLock()
      if (transaction) {
        const current = transaction
        try {
          return await executeUnsafe(
            current.session.sql, sqlText, params, queryId, activeQueries, oidCache,
            current.session.takeMessages,
          )
        } catch (cause) {
          current.status = 'failed'
          throw cause
        } finally {
          unlock()
        }
      }
      unlock()
      const session = await currentHandle.reserve()
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
      const currentHandle = handle
      const unlock = await acquireTransactionLock()
      if (transaction) {
        const current = transaction
        if (statements.some(isTransactionBoundary)) {
          unlock()
          throw transactionError('TX_CONTROL', 'transaction control statements cannot run inside manual mode')
        }
        try {
          for (const statement of statements) {
            yield await executeUnsafe(
              current.session.sql, statement, [], queryId, activeQueries, oidCache,
              current.session.takeMessages,
            )
          }
        } catch (cause) {
          current.status = 'failed'
          throw cause
        } finally {
          unlock()
        }
        return
      }
      unlock()
      const session = await currentHandle.reserve()
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
    transactionStatus() {
      return transactionState()
    },
    async beginTransaction() {
      if (!handle) throw new Error('not connected')
      const currentHandle = handle
      const unlock = await acquireTransactionLock()
      try {
        if (transaction) return transactionState()
        const session = await currentHandle.reserve()
        try {
          await session.sql.unsafe('begin')
          session.takeMessages()
          transaction = { session, status: 'active', startedAt: Date.now() }
          return transactionState()
        } catch (cause) {
          session.release()
          throw cause
        }
      } finally {
        unlock()
      }
    },
    async commitTransaction() {
      const unlock = await acquireTransactionLock()
      try {
        if (!transaction) return transactionState()
        if (transaction.status === 'failed') {
          throw transactionError('TX_FAILED', 'transaction is aborted; rollback is required')
        }
        const current = transaction
        try {
          await current.session.sql.unsafe('commit')
          current.session.takeMessages()
          transaction = null
          current.session.release()
          return transactionState()
        } catch (cause) {
          current.status = 'failed'
          throw cause
        }
      } finally {
        unlock()
      }
    },
    async rollbackTransaction() {
      const unlock = await acquireTransactionLock()
      try {
        if (!transaction) return transactionState()
        const current = transaction
        try {
          await current.session.sql.unsafe('rollback')
          current.session.takeMessages()
        } finally {
          transaction = null
          current.session.release()
        }
        return transactionState()
      } finally {
        unlock()
      }
    },
    async browse(schema: string, table: string, opts: BrowseOpts, queryId?: string) {
      if (!handle) throw new Error('not connected')
      return handle.run((sql) => browseTable(sql, schema, table, opts, queryId, activeQueries, oidCache))
    },

    async readBinaryCell(input: BinaryCellReadInput) {
      const unlock = await acquireTransactionLock()
      try {
        if (!handle) throw new Error('not connected')
        return await handle.run((sql) => readTableBinaryCell(sql, input))
      } finally {
        unlock()
      }
    },

    async updateCell(input: CellUpdateInput) {
      const unlock = await acquireTransactionLock()
      try {
        if (!handle) throw new Error('not connected')
        if (transaction) {
          throw transactionError('TX_ACTIVE', 'finish the manual transaction before editing table data')
        }
        return await handle.run((sql) => updateTableCell(sql, input))
      } finally {
        unlock()
      }
    },

    async insertRow(input: RowInsertInput) {
      const unlock = await acquireTransactionLock()
      try {
        if (!handle) throw new Error('not connected')
        if (transaction) {
          throw transactionError('TX_ACTIVE', 'finish the manual transaction before inserting table data')
        }
        return await handle.run((sql) => insertTableRow(sql, input))
      } finally {
        unlock()
      }
    },

    async deleteRow(input: RowDeleteInput) {
      const unlock = await acquireTransactionLock()
      try {
        if (!handle) throw new Error('not connected')
        if (transaction) {
          throw transactionError('TX_ACTIVE', 'finish the manual transaction before deleting table data')
        }
        return await handle.run((sql) => deleteTableRow(sql, input))
      } finally {
        unlock()
      }
    },

    async applyTableChanges(input: TableChangesInput) {
      if (!input.changes.length) throw changeError('at least one staged change is required')
      const deletedRows = new Set(
        input.changes.filter((change) => change.kind === 'delete')
          .map((change) => identitySignature(change.identity)),
      )
      if (input.changes.some((change) => (
        change.kind === 'update' && deletedRows.has(identitySignature(change.identity))
      ))) {
        throw changeError('a row cannot be updated and deleted in the same batch')
      }

      const unlock = await acquireTransactionLock()
      let session: PostgresSession | null = null
      try {
        if (!handle) throw new Error('not connected')
        if (transaction) {
          throw transactionError('TX_ACTIVE', 'finish the manual transaction before applying table changes')
        }
        session = await handle.reserve()
        await session.sql.unsafe('begin')
        session.takeMessages()
        const results = []
        const versionCheckedRows = new Set<string>()
        for (const change of input.changes) {
          if (change.kind === 'insert') {
            results.push(await insertTableRow(session.sql, {
              schema: input.schema, table: input.table, values: change.values,
            }))
          } else if (change.kind === 'update') {
            const signature = identitySignature(change.identity)
            results.push(await updateTableCell(session.sql, {
              schema: input.schema,
              table: input.table,
              column: change.column,
              value: change.value,
              originalValue: change.originalValue,
              identity: change.identity,
              ...(versionCheckedRows.has(signature) ? {} : { version: change.version }),
            }))
            versionCheckedRows.add(signature)
          } else {
            results.push(await deleteTableRow(session.sql, {
              schema: input.schema,
              table: input.table,
              identity: change.identity,
              version: change.version,
            }))
          }
        }
        await session.sql.unsafe('commit')
        session.takeMessages()
        return { affectedRows: results.length, results }
      } catch (cause) {
        if (session) {
          try { await session.sql.unsafe('rollback') } catch { /* preserve the original mutation error */ }
          session.takeMessages()
        }
        throw cause
      } finally {
        session?.release()
        unlock()
      }
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
