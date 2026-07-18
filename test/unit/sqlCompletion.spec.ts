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
        functions: [
          {
            schema: 'public', name: 'total_items', arguments: '', resultType: 'bigint', kind: 'function',
          },
          {
            schema: 'public', name: 'score', arguments: 'value integer', resultType: 'integer', kind: 'function',
          },
          {
            schema: 'public', name: 'score', arguments: 'value numeric', resultType: 'numeric', kind: 'function',
          },
        ],
      },
      {
        schema: 'app', tables: [{ schema: 'app', name: 'users' }],
        columns: [{ table: 'users', name: 'id' }], functions: [],
      },
    ])
    expect(ns).toEqual({
      public: {
        items: ['id', 'label'],
        bare: [],
        'total_items()': {
          self: { label: 'total_items()', type: 'function', detail: '() → bigint', apply: 'total_items(' },
          children: [],
        },
        'score()': {
          self: {
            label: 'score()', type: 'function', detail: '2 overloads',
            info: '(value integer) → integer\n(value numeric) → numeric', apply: 'score(',
          },
          children: [],
        },
      },
      app: { users: ['id'] },
    })
  })
})

const { schemasMock, tablesMock, columnsMock, functionsMock } = vi.hoisted(() => ({
  schemasMock: vi.fn(async () => ({ ok: true as const, data: [{ name: 'public' }] })),
  tablesMock: vi.fn(async () => ({ ok: true as const, data: [{ schema: 'public', name: 'items' }] })),
  columnsMock: vi.fn(async () => ({ ok: true as const, data: [{ table: 'items', name: 'id' }] })),
  functionsMock: vi.fn(async () => ({
    ok: true as const,
    data: [{ schema: 'public', name: 'lookup_item', arguments: 'id integer', resultType: 'text', kind: 'function' }],
  })),
}))
mockNuxtImport('useSchema', () => () => ({
  schemas: schemasMock, tables: tablesMock, columns: columnsMock, functions: functionsMock,
  databases: vi.fn(), describe: vi.fn(),
}))

describe('useSqlCompletion', () => {
  it('loads schemas, tables and columns into a namespace', async () => {
    const c = useSqlCompletion('conn-load')
    await c.ensureLoaded()
    expect(c.namespace.value).toEqual({
      public: {
        items: ['id'],
        'lookup_item()': {
          self: {
            label: 'lookup_item()', type: 'function', detail: '(id integer) → text', apply: 'lookup_item(',
          },
          children: [],
        },
      },
    })
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
