import type { BrowseOpts, CellUpdateInput, CellUpdateResult, Envelope, QueryResult, RowDeleteInput, RowInsertInput, RowMutationResult, ScriptExecutionResult, TableChangesInput, TableChangesResult, TransactionState } from '#shared/types'

export function useQuery(connId: string) {
  return {
    async execute(sql: string, params: ReadonlyArray<unknown> = [], queryId?: string) {
      return await $fetch<Envelope<QueryResult>>(`/api/connections/${connId}/query`, {
        method: 'POST', body: { sql, params, queryId },
      })
    },
    async executeScript(sql: string, queryId?: string) {
      return await $fetch<Envelope<ScriptExecutionResult>>(`/api/connections/${connId}/script`, {
        method: 'POST', body: { sql, queryId },
      })
    },
    async transactionStatus() {
      return await $fetch<Envelope<TransactionState>>(`/api/connections/${connId}/transaction`)
    },
    async transaction(action: 'begin' | 'commit' | 'rollback') {
      return await $fetch<Envelope<TransactionState>>(`/api/connections/${connId}/transaction`, {
        method: 'POST', body: { action },
      })
    },
    async browse(schema: string, table: string, opts: BrowseOpts) {
      return await $fetch<Envelope<QueryResult>>(`/api/connections/${connId}/browse`, {
        method: 'POST', body: { schema, table, opts },
      })
    },
    async updateCell(input: CellUpdateInput) {
      const schema = encodeURIComponent(input.schema)
      const table = encodeURIComponent(input.table)
      return await $fetch<Envelope<CellUpdateResult>>(`/api/connections/${connId}/tables/${schema}/${table}/cell`, {
        method: 'PATCH',
        body: {
          column: input.column,
          value: input.value,
          originalValue: input.originalValue,
          identity: input.identity,
        },
      })
    },
    async insertRow(input: RowInsertInput) {
      const schema = encodeURIComponent(input.schema)
      const table = encodeURIComponent(input.table)
      return await $fetch<Envelope<RowMutationResult>>(`/api/connections/${connId}/tables/${schema}/${table}/rows`, {
        method: 'POST', body: { values: input.values },
      })
    },
    async deleteRow(input: RowDeleteInput) {
      const schema = encodeURIComponent(input.schema)
      const table = encodeURIComponent(input.table)
      return await $fetch<Envelope<RowMutationResult>>(`/api/connections/${connId}/tables/${schema}/${table}/rows`, {
        method: 'DELETE', body: { identity: input.identity, version: input.version },
      })
    },
    async applyTableChanges(input: TableChangesInput) {
      const schema = encodeURIComponent(input.schema)
      const table = encodeURIComponent(input.table)
      return await $fetch<Envelope<TableChangesResult>>(
        `/api/connections/${connId}/tables/${schema}/${table}/changes`,
        { method: 'POST', body: { changes: input.changes } },
      )
    },
    async cancel(queryId: string) {
      return await $fetch<Envelope<void>>(`/api/connections/${connId}/cancel`, {
        method: 'POST', body: { queryId },
      })
    },
    // queryId must be in the url - the server registers the stream under it
    // so POST /cancel can abort the stream
    streamUrl(schema: string, table: string, queryId: string, batchSize = 100) {
      const p = new URLSearchParams({ schema, table, queryId, batchSize: String(batchSize) })
      return `/api/connections/${connId}/stream?${p}`
    },
  }
}
