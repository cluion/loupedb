// @vitest-environment nuxt
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import DataGrid from '../../app/components/DataGrid.vue'
import type { QueryResult, BrowseOpts } from '#shared/types'

function result(rows: Array<Record<string, unknown>>): { ok: true; data: QueryResult } {
  return {
    ok: true,
    data: {
      columns: [
        { name: 'id', nativeType: 'int4', type: 'integer', nullable: false },
        { name: 'label', nativeType: 'text', type: 'string', nullable: true },
      ],
      rows,
      executionMs: 1,
    },
  }
}

const { browseMock } = vi.hoisted(() => ({
  browseMock: vi.fn(async (_s: string, _t: string, _o: BrowseOpts) =>
    ({ ok: true, data: { columns: [], rows: [], executionMs: 0 } })),
}))

mockNuxtImport('useQuery', () => () => ({
  browse: browseMock,
  execute: vi.fn(), cancel: vi.fn(), streamUrl: vi.fn(),
}))

const props = { connectionId: 'c1', schema: 'public', table: 'items' }
const fullPage = [...Array(50)].map((_, i) => ({ id: i, label: `row${i}` }))

beforeEach(() => {
  browseMock.mockReset()
  browseMock.mockResolvedValue(result([{ id: 1, label: 'a' }]) as never)
})

describe('DataGrid', () => {
  it('shows a loading state until the first page arrives', async () => {
    let release!: (v: unknown) => void
    browseMock.mockReturnValueOnce(new Promise((r) => { release = r }) as never)
    const w = await mountSuspended(DataGrid, { props })
    expect(w.text()).toContain('載入中')
    release(result([{ id: 1, label: 'a' }]))
    await vi.waitFor(() => expect(w.find('table').exists()).toBe(true))
    expect(w.text()).not.toContain('載入中')
  })

  it('renders headers and rows from browse', async () => {
    const w = await mountSuspended(DataGrid, { props })
    await vi.waitFor(() => expect(w.find('table').exists()).toBe(true))
    expect(w.findAll('th').map(th => th.text())).toEqual(['id', 'label'])
    expect(w.text()).toContain('a')
    expect(browseMock).toHaveBeenCalledWith('public', 'items', expect.objectContaining({ limit: 50, offset: 0 }))
  })

  it('clicking a header toggles orderBy asc/desc', async () => {
    const w = await mountSuspended(DataGrid, { props })
    await vi.waitFor(() => expect(w.find('th').exists()).toBe(true))
    await w.find('th').trigger('click')
    expect(browseMock).toHaveBeenLastCalledWith('public', 'items', expect.objectContaining({ orderBy: 'id', orderDir: 'asc' }))
    await w.find('th').trigger('click')
    expect(browseMock).toHaveBeenLastCalledWith('public', 'items', expect.objectContaining({ orderBy: 'id', orderDir: 'desc' }))
  })

  it('next page advances offset; last page disables next button', async () => {
    browseMock.mockResolvedValue(result(fullPage) as never) // full page = not last
    const w = await mountSuspended(DataGrid, { props })
    await vi.waitFor(() => expect(w.find('table').exists()).toBe(true))
    const next = w.findAll('button').find(b => b.text() === '下一頁')!
    expect(next.attributes('disabled')).toBeUndefined()
    await next.trigger('click')
    expect(browseMock).toHaveBeenLastCalledWith('public', 'items', expect.objectContaining({ offset: 50 }))

    browseMock.mockResolvedValue(result([{ id: 99, label: 'last' }]) as never) // short page = last
    await w.findAll('button').find(b => b.text() === '下一頁')!.trigger('click')
    await vi.waitFor(() => {
      const btn = w.findAll('button').find(b => b.text() === '下一頁')!
      expect(btn.attributes('disabled')).toBeDefined()
    })
  })

  it('prev button disabled at offset 0', async () => {
    const w = await mountSuspended(DataGrid, { props })
    await vi.waitFor(() => expect(w.find('table').exists()).toBe(true))
    expect(w.findAll('button').find(b => b.text() === '上一頁')!.attributes('disabled')).toBeDefined()
  })

  it('applying a filter resets offset and passes filter to browse', async () => {
    browseMock.mockResolvedValue(result(fullPage) as never)
    const w = await mountSuspended(DataGrid, { props })
    await vi.waitFor(() => expect(w.find('table').exists()).toBe(true))
    await w.findAll('button').find(b => b.text() === '下一頁')!.trigger('click') // offset 50

    await w.find('select[aria-label="filter column"]').setValue('label')
    await w.find('select[aria-label="filter op"]').setValue('like')
    await w.find('input[placeholder="值"]').setValue('%a%')
    await w.find('form').trigger('submit')

    expect(browseMock).toHaveBeenLastCalledWith('public', 'items', expect.objectContaining({
      offset: 0,
      filter: [{ column: 'label', op: 'like', value: '%a%' }],
    }))
  })
})
