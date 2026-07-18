import type { ConnectionConfig, ConnectionSessionInfo, Envelope, SslMode } from '#shared/types'

export type ConnectionInput = Omit<Partial<ConnectionConfig>, 'ssl'> & { ssl?: SslMode | 'auto' }

export function useConnections() {
  return {
    async list() {
      return await $fetch<Envelope<Omit<ConnectionConfig, 'password'>[]>>('/api/connections')
    },
    async create(input: ConnectionInput) {
      return await $fetch<Envelope<ConnectionSessionInfo>>('/api/connections', { method: 'POST', body: input })
    },
    // reconnect a saved connection - the password never passes through the client
    async openSaved(name: string) {
      return await $fetch<Envelope<ConnectionSessionInfo>>('/api/connections/open', {
        method: 'POST', body: { name },
      })
    },
    async remove(id: string) {
      return await $fetch<Envelope<{ closed: boolean }>>(`/api/connections/${id}`, { method: 'DELETE' })
    },
    async removeSaved(name: string) {
      return await $fetch<Envelope<{ deleted: boolean }>>(`/api/connections/saved/${encodeURIComponent(name)}`, { method: 'DELETE' })
    },
    // pg sessions are bound to one database - browsing another database gets a
    // sibling session (same credentials) from the server
    async openDatabase(id: string, database: string) {
      return await $fetch<Envelope<{ id: string }>>(`/api/connections/${id}/use-database`, {
        method: 'POST', body: { database },
      })
    },
  }
}
