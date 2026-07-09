import type { DatabaseInfo, Envelope, SchemaInfo, TableInfo, TableSchema } from '#shared/types'

export function useSchema(connId: string) {
  return {
    async databases() {
      return await $fetch<Envelope<DatabaseInfo[]>>(`/api/connections/${connId}/databases`)
    },
    async schemas() {
      return await $fetch<Envelope<SchemaInfo[]>>(`/api/connections/${connId}/schemas`)
    },
    async tables(schema: string) {
      return await $fetch<Envelope<TableInfo[]>>(`/api/connections/${connId}/tables`, { query: { schema } })
    },
    async describe(schema: string, table: string) {
      return await $fetch<Envelope<TableSchema>>(`/api/connections/${connId}/tables/${schema}/${table}`)
    },
  }
}
