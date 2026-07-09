// @vitest-environment nuxt
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import TableStructure from '../../app/components/TableStructure.vue'
import type { TableSchema } from '#shared/types'

const schema: TableSchema = {
  schema: 'public',
  table: 'todos',
  columns: [
    { name: 'id', nativeType: 'int4', type: 'integer', nullable: false, defaultValue: "nextval('todos_id_seq')" },
    { name: 'title', nativeType: 'text', type: 'string', nullable: false },
    { name: 'owner_id', nativeType: 'int4', type: 'integer', nullable: true },
  ],
  primaryKey: ['id'],
  foreignKeys: [{
    name: 'todos_owner_fk', columns: ['owner_id'],
    referencesSchema: 'public', referencesTable: 'users', referencesColumns: ['id'],
  }],
}

const { describeMock } = vi.hoisted(() => ({
  describeMock: vi.fn(async () => ({ ok: true as const, data: null as unknown })),
}))

mockNuxtImport('useSchema', () => () => ({
  describe: describeMock,
  databases: vi.fn(), schemas: vi.fn(), tables: vi.fn(),
}))

const props = { connectionId: 'c1', schema: 'public', table: 'todos' }

beforeEach(() => {
  describeMock.mockReset()
  describeMock.mockResolvedValue({ ok: true, data: schema } as never)
})

describe('TableStructure', () => {
  it('renders one row per column with native type and nullability', async () => {
    const w = await mountSuspended(TableStructure, { props })
    await vi.waitFor(() => expect(w.findAll('tbody tr')).toHaveLength(3))
    expect(w.text()).toContain('int4')
    expect(w.text()).toContain('title')
    expect(describeMock).toHaveBeenCalledWith('public', 'todos')
  })

  it('marks primary key and foreign key columns', async () => {
    const w = await mountSuspended(TableStructure, { props })
    await vi.waitFor(() => expect(w.findAll('tbody tr')).toHaveLength(3))
    const idRow = w.findAll('tbody tr')[0]!
    expect(idRow.text()).toContain('PK')
    const fkRow = w.findAll('tbody tr')[2]!
    expect(fkRow.text()).toContain('public.users(id)') // fk target spelled out
  })

  it('shows error envelope message', async () => {
    describeMock.mockResolvedValueOnce({ ok: false, error: { code: 'X', message: 'gone', severity: 'error', retryable: false } } as never)
    const w = await mountSuspended(TableStructure, { props })
    await vi.waitFor(() => expect(w.find('[role="alert"]').text()).toContain('gone'))
  })
})
