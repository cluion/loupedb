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
    await s.columns('app')
    expect(fetchMock).toHaveBeenCalledWith('/api/connections/c1/columns', { query: { schema: 'app' } })
    await s.functions('app')
    expect(fetchMock).toHaveBeenCalledWith('/api/connections/c1/functions', { query: { schema: 'app' } })
  })
})

describe('useQuery', () => {
  it('execute posts sql, positional params and queryId', async () => {
    await useQuery('c1').execute('select $1, $2', ['value', null], 'q1')
    expect(fetchMock).toHaveBeenCalledWith('/api/connections/c1/query', {
      method: 'POST', body: { sql: 'select $1, $2', params: ['value', null], queryId: 'q1' },
    })
  })

  it('executeScript posts the complete script with queryId', async () => {
    await useQuery('c1').executeScript('select 1; select 2;', 'q2')
    expect(fetchMock).toHaveBeenCalledWith('/api/connections/c1/script', {
      method: 'POST', body: { sql: 'select 1; select 2;', queryId: 'q2' },
    })
  })

  it('gets transaction status and posts transaction actions', async () => {
    const query = useQuery('c1')
    await query.transactionStatus()
    expect(fetchMock).toHaveBeenCalledWith('/api/connections/c1/transaction')
    await query.transaction('rollback')
    expect(fetchMock).toHaveBeenCalledWith('/api/connections/c1/transaction', {
      method: 'POST', body: { action: 'rollback' },
    })
  })

  it('browse posts schema/table/opts', async () => {
    const opts = { limit: 10, offset: 0 }
    await useQuery('c1').browse('public', 'items', opts)
    expect(fetchMock).toHaveBeenCalledWith('/api/connections/c1/browse', {
      method: 'POST', body: { schema: 'public', table: 'items', opts },
    })
  })

  it('updateCell patches a table cell with identity and original value', async () => {
    await useQuery('c1').updateCell({
      schema: 'public', table: 'daily items', column: 'label', value: 'updated',
      originalValue: 'old', identity: { id: 7 },
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/connections/c1/tables/public/daily%20items/cell', {
      method: 'PATCH',
      body: { column: 'label', value: 'updated', originalValue: 'old', identity: { id: 7 } },
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

  it('organize patches favorite, folder or tags by encoded name', async () => {
    await useSavedQueries().organize('daily report', { favorite: true, folder: 'Reports', tags: ['daily'] })
    expect(fetchMock).toHaveBeenCalledWith('/api/saved-queries/daily%20report', {
      method: 'PATCH', body: { favorite: true, folder: 'Reports', tags: ['daily'] },
    })
  })

  it('remove deletes with encoded name', async () => {
    await useSavedQueries().remove('my query')
    expect(fetchMock).toHaveBeenCalledWith('/api/saved-queries/my%20query', { method: 'DELETE' })
  })
})
