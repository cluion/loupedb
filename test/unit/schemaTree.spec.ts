// @vitest-environment nuxt
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import SchemaTree from '../../app/components/SchemaTree.vue'

const { databasesMock, schemasMock, tablesMock, openDatabaseMock, schemaIds } = vi.hoisted(() => ({
  databasesMock: vi.fn(async () => ({ ok: true as const, data: [{ name: 'appdb' }, { name: 'postgres' }] })),
  schemasMock: vi.fn(async () => ({ ok: true as const, data: [{ name: 'app' }, { name: 'public' }] })),
  tablesMock: vi.fn(async () => ({ ok: true as const, data: [{ schema: 'app', name: 'users' }] })),
  openDatabaseMock: vi.fn(async (_id: string, db: string) => ({ ok: true as const, data: { id: `sess-${db}` } })),
  schemaIds: [] as string[], // records which session id each useSchema() was created with
}))

mockNuxtImport('useSchema', () => (id: string) => {
  schemaIds.push(id)
  return { databases: databasesMock, schemas: schemasMock, tables: tablesMock, describe: vi.fn() }
})

mockNuxtImport('useConnections', () => () => ({
  openDatabase: openDatabaseMock,
  list: vi.fn(), create: vi.fn(), openSaved: vi.fn(), remove: vi.fn(),
}))

const props = { connectionId: 'root-conn' }

beforeEach(() => {
  databasesMock.mockClear()
  schemasMock.mockClear()
  tablesMock.mockClear()
  openDatabaseMock.mockClear()
  schemaIds.length = 0
})

async function expandDb(w: Awaited<ReturnType<typeof mountSuspended>>, name = 'appdb') {
  await vi.waitFor(() => expect(w.text()).toContain(name))
  await w.findAll('button').find(b => b.text().includes(name))!.trigger('click')
  await vi.waitFor(() => expect(w.text()).toContain('app'))
}

describe('SchemaTree (database > schema > table)', () => {
  it('lists databases on mount', async () => {
    const w = await mountSuspended(SchemaTree, { props })
    await vi.waitFor(() => expect(w.text()).toContain('appdb'))
    expect(w.text()).toContain('postgres')
    expect(databasesMock).toHaveBeenCalled()
  })

  it('expanding a database opens a sibling session and lists its schemas', async () => {
    const w = await mountSuspended(SchemaTree, { props })
    await expandDb(w)
    expect(openDatabaseMock).toHaveBeenCalledWith('root-conn', 'appdb')
    // schemas must be fetched via the sibling session, not the root one
    await vi.waitFor(() => expect(schemaIds).toContain('sess-appdb'))
    expect(w.text()).toContain('public')
  })

  it('expanding a schema lists tables and clicking one emits the sibling session id', async () => {
    const w = await mountSuspended(SchemaTree, { props })
    await expandDb(w)
    await w.findAll('button').find(b => b.text().includes('app') && !b.text().includes('appdb'))!.trigger('click')
    await vi.waitFor(() => expect(w.text()).toContain('users'))
    await w.findAll('button').find(b => b.text() === 'users')!.trigger('click')
    expect(w.emitted('select-table')).toEqual([['sess-appdb', 'appdb', 'app', 'users']])
  })

  it('reuses the sibling session when re-expanding the same database', async () => {
    const w = await mountSuspended(SchemaTree, { props })
    await expandDb(w)
    await w.findAll('button').find(b => b.text().includes('appdb'))!.trigger('click') // collapse
    await expandDb(w)
    expect(openDatabaseMock).toHaveBeenCalledTimes(1) // session cached, no second open
    expect(schemasMock).toHaveBeenCalledTimes(2) // schemas refetched each expand
  })

  it('an empty schema shows a placeholder instead of nothing', async () => {
    tablesMock.mockResolvedValueOnce({ ok: true, data: [] } as never)
    const w = await mountSuspended(SchemaTree, { props })
    await expandDb(w)
    await w.findAll('button').find(b => b.text().includes('app') && !b.text().includes('appdb'))!.trigger('click')
    await vi.waitFor(() => expect(w.text()).toContain('沒有資料表'))
  })

  it('failed sibling open shows the error and collapses back', async () => {
    openDatabaseMock.mockResolvedValueOnce({ ok: false, error: { code: 'X', message: 'no permission', severity: 'error', retryable: false } } as never)
    const w = await mountSuspended(SchemaTree, { props })
    await vi.waitFor(() => expect(w.text()).toContain('appdb'))
    await w.findAll('button').find(b => b.text().includes('appdb'))!.trigger('click')
    await vi.waitFor(() => expect(w.find('[role="alert"]').text()).toContain('no permission'))
  })
})
