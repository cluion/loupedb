import type { Envelope, SavedQuery, SavedQueryOrganizationPatch } from '#shared/types'

export function useSavedQueries() {
  return {
    async list() {
      return await $fetch<Envelope<SavedQuery[]>>('/api/saved-queries')
    },
    async save(name: string, sql: string) {
      return await $fetch<Envelope<SavedQuery>>('/api/saved-queries', {
        method: 'POST', body: { name, sql },
      })
    },
    async organize(name: string, patch: SavedQueryOrganizationPatch) {
      return await $fetch<Envelope<SavedQuery>>(`/api/saved-queries/${encodeURIComponent(name)}`, {
        method: 'PATCH', body: patch,
      })
    },
    async remove(name: string) {
      return await $fetch<Envelope<{ deleted: boolean }>>(`/api/saved-queries/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      })
    },
  }
}
