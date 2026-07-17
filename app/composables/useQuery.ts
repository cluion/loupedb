import type { BrowseOpts, Envelope, QueryResult, ScriptExecutionResult } from '#shared/types'

export function useQuery(connId: string) {
  return {
    async execute(sql: string, queryId?: string) {
      return await $fetch<Envelope<QueryResult>>(`/api/connections/${connId}/query`, {
        method: 'POST', body: { sql, queryId },
      })
    },
    async executeScript(sql: string, queryId?: string) {
      return await $fetch<Envelope<ScriptExecutionResult>>(`/api/connections/${connId}/script`, {
        method: 'POST', body: { sql, queryId },
      })
    },
    async browse(schema: string, table: string, opts: BrowseOpts) {
      return await $fetch<Envelope<QueryResult>>(`/api/connections/${connId}/browse`, {
        method: 'POST', body: { schema, table, opts },
      })
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
