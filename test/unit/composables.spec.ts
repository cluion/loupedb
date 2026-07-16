// @vitest-environment nuxt
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useConnections } from '../../app/composables/useConnections'
import { useSchema } from '../../app/composables/useSchema'
import { useQuery } from '../../app/composables/useQuery'
import { useSavedQueries } from '../../app/composables/useSavedQueries'

const fetchMock = vi.fn(async () => ({ ok: true, data: null }))
beforeEach(() => {
  fetchMock.mockClear()
  vi.stubGlobal('$fetch', fetchMock)
})

describe('useConnections', () => {
  it('create posts body to /api/connections', async () => {
    const input = { name: 'n', host: 'h', port: 5432, database: 'd', username: 'u', password: 'p', ssl: 'auto' as const }
    await useConnections().create(input)
    expect(fetchMock).toHaveBeenCalledWith('/api/connections', { method: 'POST', body: input })
  })

  it('openSaved posts only the name to /api/connections/open', async () => {
    await useConnections().openSaved('saved')
    expect(fetchMock).toHaveBeenCalledWith('/api/connections/open', { method: 'POST', body: { name: 'saved' } })
  })

  it('list gets /api/connections', async () => {
    await useConnections().list()
    expect(fetchMock).toHaveBeenCalledWith('/api/connections')
  })

  it('remove deletes /api/connections/:id', async () => {
    await useConnections().remove('abc')
    expect(fetchMock).toHaveBeenCalledWith('/api/connections/abc', { method: 'DELETE' })
  })

  it('removeSaved deletes /api/connections/saved/:name with encoding', async () => {
    await useConnections().removeSaved('my conn')
    expect(fetchMock).toHaveBeenCalledWith('/api/connections/saved/my%20conn', { method: 'DELETE' })
  })

  it('openDatabase posts the target database to /use-database', async () => {
    await useConnections().openDatabase('c1', 'seconddb')
    expect(fetchMock).toHaveBeenCalledWith('/api/connections/c1/use-database', {
      method: 'POST', body: { database: 'seconddb' },
    })
  })
})

describe('useSchema', () => {
  it('builds schema exploration requests', async () => {
    const s = useSchema('c1')
    await s.databases()
    expect(fetchMock).toHaveBeenCalledWith('/api/connections/c1/databases')
    await s.schemas()
    expect(fetchMock).toHaveBeenCalledWith('/api/connections/c1/schemas')
    await s.tables('app')
    expect(fetchMock).toHaveBeenCalledWith('/api/connections/c1/tables', { query: { schema: 'app' } })
    await s.describe('app', 'users')
    expect(fetchMock).toHaveBeenCalledWith('/api/connections/c1/tables/app/users')
  })
})

describe('useQuery', () => {
  it('execute posts sql with queryId', async () => {
    await useQuery('c1').execute('select 1', 'q1')
    expect(fetchMock).toHaveBeenCalledWith('/api/connections/c1/query', {
      method: 'POST', body: { sql: 'select 1', queryId: 'q1' },
    })
  })

  it('browse posts schema/table/opts', async () => {
    const opts = { limit: 10, offset: 0 }
    await useQuery('c1').browse('public', 'items', opts)
    expect(fetchMock).toHaveBeenCalledWith('/api/connections/c1/browse', {
      method: 'POST', body: { schema: 'public', table: 'items', opts },
    })
  })

  it('cancel posts queryId', async () => {
    await useQuery('c1').cancel('q9')
    expect(fetchMock).toHaveBeenCalledWith('/api/connections/c1/cancel', {
      method: 'POST', body: { queryId: 'q9' },
    })
  })

  it('streamUrl carries queryId so server-side cancel can find the stream', () => {
    const url = useQuery('c1').streamUrl('public', 'logs', 'sq1', 50)
    expect(url).toBe('/api/connections/c1/stream?schema=public&table=logs&queryId=sq1&batchSize=50')
  })
})

describe('useSavedQueries', () => {
  it('list gets /api/saved-queries', async () => {
    await useSavedQueries().list()
    expect(fetchMock).toHaveBeenCalledWith('/api/saved-queries')
  })

  it('save posts name and sql', async () => {
    await useSavedQueries().save('daily', 'select 1;')
    expect(fetchMock).toHaveBeenCalledWith('/api/saved-queries', {
      method: 'POST', body: { name: 'daily', sql: 'select 1;' },
    })
  })

  it('remove deletes with encoded name', async () => {
    await useSavedQueries().remove('my query')
    expect(fetchMock).toHaveBeenCalledWith('/api/saved-queries/my%20query', { method: 'DELETE' })
  })
})
