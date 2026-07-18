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

const { browseMock, describeMock, updateCellMock } = vi.hoisted(() => ({
  browseMock: vi.fn(async (_s: string, _t: string, _o: BrowseOpts) =>
    ({ ok: true, data: { columns: [], rows: [], executionMs: 0 } })),
  describeMock: vi.fn(),
  updateCellMock: vi.fn(),
}))

mockNuxtImport('useQuery', () => () => ({
  browse: browseMock,
  updateCell: updateCellMock,
  execute: vi.fn(), cancel: vi.fn(), streamUrl: vi.fn(),
}))
mockNuxtImport('useSchema', () => () => ({ describe: describeMock }))

const props = { connectionId: 'c1', schema: 'public', table: 'items' }
const fullPage = [...Array(50)].map((_, i) => ({ id: i, label: `row${i}` }))

beforeEach(() => {
  browseMock.mockReset()
  browseMock.mockResolvedValue(result([{ id: 1, label: 'a' }]) as never)
  describeMock.mockReset()
  describeMock.mockResolvedValue({
    ok: true,
    data: {
      schema: 'public', table: 'items',
      columns: result([]).data.columns,
      primaryKey: ['id'], foreignKeys: [],
    },
  })
  updateCellMock.mockReset()
  updateCellMock.mockResolvedValue({
    ok: true, data: { affectedRows: 1, row: { id: 1, label: 'edited' } },
  })
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

  it('previews and confirms one parameterized cell update by primary key', async () => {
    const w = await mountSuspended(DataGrid, { props })
    await vi.waitFor(() => expect(w.findAll('td')).toHaveLength(2))

    await w.findAll('td')[1]!.trigger('dblclick')
    await w.get('[aria-label="編輯 label 第 1 列"]').setValue('edited')
    await w.findAll('button').find(button => button.text() === '預覽寫入')!.trigger('click')
    expect(w.get('[role="dialog"]').text()).toContain('最多更新 1 列')
    expect(w.get('[role="dialog"] pre').text()).toContain('UPDATE "public"."items"')
    expect(w.get('[role="dialog"] pre').text()).toContain('"id" IS NOT DISTINCT FROM $2')

    browseMock.mockResolvedValue(result([{ id: 1, label: 'edited' }]) as never)
    await w.findAll('button').find(button => button.text() === '確認寫入 1 列')!.trigger('click')
    await vi.waitFor(() => expect(updateCellMock).toHaveBeenCalledWith({
      schema: 'public', table: 'items', column: 'label', value: 'edited',
      originalValue: 'a', identity: { id: 1 },
    }))
    await vi.waitFor(() => expect(w.text()).toContain('已更新 1 列'))
  })

  it('keeps every cell read-only when the table has no primary key', async () => {
    describeMock.mockResolvedValueOnce({
      ok: true,
      data: {
        schema: 'public', table: 'items', columns: result([]).data.columns,
        primaryKey: [], foreignKeys: [],
      },
    })
    const w = await mountSuspended(DataGrid, { props })
    await vi.waitFor(() => expect(w.get('[data-testid="editability-status"]').text()).toContain('唯讀'))
    await w.findAll('td')[1]!.trigger('dblclick')
    expect(w.find('[aria-label="編輯 label 第 1 列"]').exists()).toBe(false)
    expect(updateCellMock).not.toHaveBeenCalled()
  })
})
