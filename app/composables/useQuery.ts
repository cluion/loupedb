import type { BinaryCellReadInput, BrowseOpts, CellUpdateInput, CellUpdateResult, Envelope, QueryResult, RowDeleteInput, RowInsertInput, RowMutationResult, ScriptExecutionResult, TableChangesInput, TableChangesResult, TransactionState } from '#shared/types'

function responseFileName(response: Response, fallback: string): string {
  const disposition = response.headers.get('content-disposition') ?? ''
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/iu)?.[1]
  if (encoded) {
    try { return decodeURIComponent(encoded) } catch { /* use the fallback */ }
  }
  return fallback
}

async function responseError(response: Response): Promise<Error> {
  try {
    const payload = await response.json() as {
      ok?: boolean
      error?: { message?: string }
      message?: string
      statusMessage?: string
    }
    return new Error(payload.error?.message ?? payload.message ?? payload.statusMessage ?? 'binary download failed')
  } catch {
    return new Error(`binary download failed (${response.status})`)
  }
}

export function useQuery(connId: string) {
  return {
    async execute(
      sql: string,
      params: ReadonlyArray<unknown> = [],
      queryId?: string,
      confirmedDangerous = false,
    ) {
      return await $fetch<Envelope<QueryResult>>(`/api/connections/${connId}/query`, {
        method: 'POST', body: { sql, params, queryId, ...(confirmedDangerous ? { confirmedDangerous } : {}) },
      })
    },
    async executeScript(sql: string, queryId?: string, confirmedDangerous = false) {
      return await $fetch<Envelope<ScriptExecutionResult>>(`/api/connections/${connId}/script`, {
        method: 'POST', body: { sql, queryId, ...(confirmedDangerous ? { confirmedDangerous } : {}) },
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
    async updateCell(input: CellUpdateInput, confirmedDangerous = false) {
      const schema = encodeURIComponent(input.schema)
      const table = encodeURIComponent(input.table)
      return await $fetch<Envelope<CellUpdateResult>>(`/api/connections/${connId}/tables/${schema}/${table}/cell`, {
        method: 'PATCH',
        body: {
          column: input.column,
          value: input.value,
          originalValue: input.originalValue,
          identity: input.identity,
          ...(confirmedDangerous ? { confirmedDangerous } : {}),
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
    async deleteRow(input: RowDeleteInput, confirmedDangerous = false) {
      const schema = encodeURIComponent(input.schema)
      const table = encodeURIComponent(input.table)
      return await $fetch<Envelope<RowMutationResult>>(`/api/connections/${connId}/tables/${schema}/${table}/rows`, {
        method: 'DELETE',
        body: {
          identity: input.identity,
          version: input.version,
          ...(confirmedDangerous ? { confirmedDangerous } : {}),
        },
      })
    },
    async applyTableChanges(input: TableChangesInput, confirmedDangerous = false) {
      const schema = encodeURIComponent(input.schema)
      const table = encodeURIComponent(input.table)
      return await $fetch<Envelope<TableChangesResult>>(
        `/api/connections/${connId}/tables/${schema}/${table}/changes`,
        {
          method: 'POST',
          body: { changes: input.changes, ...(confirmedDangerous ? { confirmedDangerous } : {}) },
        },
      )
    },
    async downloadBinaryCell(input: BinaryCellReadInput) {
      const schema = encodeURIComponent(input.schema)
      const table = encodeURIComponent(input.table)
      const response = await fetch(`/api/connections/${connId}/tables/${schema}/${table}/binary`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          column: input.column, identity: input.identity, version: input.version,
        }),
      })
      if (!response.ok || response.headers.get('content-type')?.includes('application/json')) {
        throw await responseError(response)
      }
      return {
        blob: await response.blob(),
        fileName: responseFileName(response, `${input.table}-${input.column}.bin`),
      }
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
