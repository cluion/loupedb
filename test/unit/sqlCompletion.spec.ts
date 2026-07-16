// @vitest-environment nuxt
import { describe, it, expect, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { buildSqlNamespace } from '../../app/utils/sqlCompletion'
import { useSqlCompletion } from '../../app/composables/useSqlCompletion'

describe('buildSqlNamespace', () => {
  it('nests schema → table → columns and keeps column-less tables', () => {
    const ns = buildSqlNamespace([
      {
        schema: 'public',
        tables: [{ schema: 'public', name: 'items' }, { schema: 'public', name: 'bare' }],
        columns: [
          { table: 'items', name: 'id' },
          { table: 'items', name: 'label' },
        ],
      },
      { schema: 'app', tables: [{ schema: 'app', name: 'users' }], columns: [{ table: 'users', name: 'id' }] },
    ])
    expect(ns).toEqual({
      public: { items: ['id', 'label'], bare: [] },
      app: { users: ['id'] },
    })
  })
})

const { schemasMock, tablesMock, columnsMock } = vi.hoisted(() => ({
  schemasMock: vi.fn(async () => ({ ok: true as const, data: [{ name: 'public' }] })),
  tablesMock: vi.fn(async () => ({ ok: true as const, data: [{ schema: 'public', name: 'items' }] })),
  columnsMock: vi.fn(async () => ({ ok: true as const, data: [{ table: 'items', name: 'id' }] })),
}))
mockNuxtImport('useSchema', () => () => ({
  schemas: schemasMock, tables: tablesMock, columns: columnsMock,
  databases: vi.fn(), describe: vi.fn(),
}))

describe('useSqlCompletion', () => {
  it('loads schemas, tables and columns into a namespace', async () => {
    const c = useSqlCompletion('conn-load')
    await c.ensureLoaded()
    expect(c.namespace.value).toEqual({ public: { items: ['id'] } })
  })

  it('caches per connection id and does not refetch', async () => {
    const c1 = useSqlCompletion('conn-cache')
    await c1.ensureLoaded()
    const calls = schemasMock.mock.calls.length
    await useSqlCompletion('conn-cache').ensureLoaded()
    expect(schemasMock.mock.calls.length).toBe(calls)
  })

  it('leaves the namespace null when the schema listing fails', async () => {
    schemasMock.mockResolvedValueOnce({
      ok: false, error: { code: 'X', message: 'boom', severity: 'error', retryable: false },
    } as never)
    const c = useSqlCompletion('conn-fail')
    await c.ensureLoaded()
    expect(c.namespace.value).toBeNull()
  })
})
