// @vitest-environment nuxt
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import SchemaTree from '../../app/components/SchemaTree.vue'

const { schemasMock, tablesMock } = vi.hoisted(() => ({
  schemasMock: vi.fn(async () => ({ ok: true as const, data: [{ name: 'app' }, { name: 'public' }] })),
  tablesMock: vi.fn(async () => ({ ok: true as const, data: [{ schema: 'app', name: 'users' }] })),
}))

mockNuxtImport('useSchema', () => () => ({
  schemas: schemasMock,
  tables: tablesMock,
  describe: vi.fn(),
}))

beforeEach(() => { schemasMock.mockClear(); tablesMock.mockClear() })

describe('SchemaTree', () => {
  it('lists schemas on mount', async () => {
    const w = await mountSuspended(SchemaTree, { props: { connectionId: 'c1' } })
    await vi.waitFor(() => expect(w.text()).toContain('app'))
    expect(w.text()).toContain('public')
  })

  it('expanding a schema loads and shows its tables', async () => {
    const w = await mountSuspended(SchemaTree, { props: { connectionId: 'c1' } })
    await vi.waitFor(() => expect(w.text()).toContain('app'))
    await w.find('button').trigger('click') // expand first schema (app)
    await vi.waitFor(() => expect(w.text()).toContain('users'))
    expect(tablesMock).toHaveBeenCalledWith('app')
  })

  it('clicking a table emits select-table', async () => {
    const w = await mountSuspended(SchemaTree, { props: { connectionId: 'c1' } })
    await vi.waitFor(() => expect(w.text()).toContain('app'))
    await w.find('button').trigger('click')
    await vi.waitFor(() => expect(w.text()).toContain('users'))
    await w.find('li button').trigger('click')
    expect(w.emitted('select-table')).toEqual([['app', 'users']])
  })

  it('collapsing hides tables', async () => {
    const w = await mountSuspended(SchemaTree, { props: { connectionId: 'c1' } })
    await vi.waitFor(() => expect(w.text()).toContain('app'))
    await w.find('button').trigger('click')
    await vi.waitFor(() => expect(w.text()).toContain('users'))
    await w.find('button').trigger('click') // collapse
    expect(w.text()).not.toContain('users')
  })
})
