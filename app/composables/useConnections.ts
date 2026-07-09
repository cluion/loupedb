import type { ConnectionConfig, Envelope, SslMode } from '#shared/types'

export type ConnectionInput = Omit<Partial<ConnectionConfig>, 'ssl'> & { ssl?: SslMode | 'auto' }

export function useConnections() {
  return {
    async list() {
      return await $fetch<Envelope<Omit<ConnectionConfig, 'password'>[]>>('/api/connections')
    },
    async create(input: ConnectionInput) {
      return await $fetch<Envelope<{ id: string }>>('/api/connections', { method: 'POST', body: input })
    },
    // reconnect a saved connection - the password never passes through the client
    async openSaved(name: string) {
      return await $fetch<Envelope<{ id: string }>>('/api/connections/open', { method: 'POST', body: { name } })
    },
    async remove(id: string) {
      return await $fetch<Envelope<{ closed: boolean }>>(`/api/connections/${id}`, { method: 'DELETE' })
    },
  }
}
