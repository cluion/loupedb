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
      rowVersions: rows.map((_, index) => String(index + 10)),
      executionMs: 1,
    },
  }
}

const { browseMock, deleteRowMock, describeMock, insertRowMock, updateCellMock } = vi.hoisted(() => ({
  browseMock: vi.fn(async (_s: string, _t: string, _o: BrowseOpts) =>
    ({ ok: true, data: { columns: [], rows: [], executionMs: 0 } })),
  describeMock: vi.fn(),
  deleteRowMock: vi.fn(),
  insertRowMock: vi.fn(),
  updateCellMock: vi.fn(),
}))

mockNuxtImport('useQuery', () => () => ({
  browse: browseMock,
  deleteRow: deleteRowMock,
  insertRow: insertRowMock,
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
      columns: [
        { ...result([]).data.columns[0]!, editable: true, insertable: true, defaultValue: "nextval('items_id_seq')" },
        { ...result([]).data.columns[1]!, nullable: false, editable: true, insertable: true },
      ],
      primaryKey: ['id'], uniqueKeys: [], foreignKeys: [],
    },
  })
  updateCellMock.mockReset()
  updateCellMock.mockResolvedValue({
    ok: true, data: { affectedRows: 1, row: { id: 1, label: 'edited' } },
  })
  insertRowMock.mockReset()
  insertRowMock.mockResolvedValue({
    ok: true, data: { affectedRows: 1, row: { id: 2, label: 'new' } },
  })
  deleteRowMock.mockReset()
  deleteRowMock.mockResolvedValue({
    ok: true, data: { affectedRows: 1, row: { id: 1, label: 'a' } },
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
    expect(w.findAll('th').map(th => th.text())).toEqual(['id', 'label', '操作'])
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
    await vi.waitFor(() => expect(w.findAll('td')).toHaveLength(3))

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

  it('uses a non-null unique key to edit and delete rows without a primary key', async () => {
    describeMock.mockResolvedValueOnce({
      ok: true,
      data: {
        schema: 'public', table: 'items',
        columns: [
          { ...result([]).data.columns[0]!, editable: true, insertable: true },
          { ...result([]).data.columns[1]!, editable: true, insertable: true },
        ],
        primaryKey: [],
        uniqueKeys: [{ name: 'items_label_key', columns: ['label'] }],
        foreignKeys: [],
      },
    })
    const w = await mountSuspended(DataGrid, { props })
    await vi.waitFor(() => expect(w.get('[data-testid="editability-status"]').text()).toContain('unique key'))

    await w.findAll('td')[0]!.trigger('dblclick')
    await w.get('[aria-label="編輯 id 第 1 列"]').setValue('2')
    await w.findAll('button').find(button => button.text() === '預覽寫入')!.trigger('click')
    expect(w.get('[aria-label="確認資料寫入"] pre').text()).toContain('"label" IS NOT DISTINCT FROM $2')
    await w.findAll('button').find(button => button.text() === '確認寫入 1 列')!.trigger('click')
    await vi.waitFor(() => expect(updateCellMock).toHaveBeenCalledWith({
      schema: 'public', table: 'items', column: 'id', value: '2',
      originalValue: 1, identity: { label: 'a' },
    }))

    await w.get('[aria-label="刪除第 1 列"]').trigger('click')
    expect(w.get('[aria-label="確認刪除資料列"] pre').text()).toContain('"label" IS NOT DISTINCT FROM $1')
    await w.findAll('button').find(button => button.text() === '確認刪除 1 列')!.trigger('click')
    await vi.waitFor(() => expect(deleteRowMock).toHaveBeenCalledWith({
      schema: 'public', table: 'items', identity: { label: 'a' }, version: '10',
    }))
  })

  it('keeps a row with a NULL unique key read-only', async () => {
    browseMock.mockResolvedValueOnce(result([{ id: 1, label: null }]) as never)
    describeMock.mockResolvedValueOnce({
      ok: true,
      data: {
        schema: 'public', table: 'items', columns: result([]).data.columns,
        primaryKey: [], uniqueKeys: [{ name: 'items_label_key', columns: ['label'] }], foreignKeys: [],
      },
    })
    const w = await mountSuspended(DataGrid, { props })
    await vi.waitFor(() => expect(w.find('table').exists()).toBe(true))
    await w.findAll('td')[0]!.trigger('dblclick')
    expect(w.find('[aria-label="編輯 id 第 1 列"]').exists()).toBe(false)
    expect(w.get('[aria-label="刪除第 1 列"]').attributes('disabled')).toBeDefined()
  })

  it('keeps every existing row read-only when the table has no safe key', async () => {
    describeMock.mockResolvedValueOnce({
      ok: true,
      data: {
        schema: 'public', table: 'items', columns: result([]).data.columns,
        primaryKey: [], uniqueKeys: [], foreignKeys: [],
      },
    })
    const w = await mountSuspended(DataGrid, { props })
    await vi.waitFor(() => expect(w.get('[data-testid="editability-status"]').text()).toContain('唯讀'))
    await w.findAll('td')[1]!.trigger('dblclick')
    expect(w.find('[aria-label="編輯 label 第 1 列"]').exists()).toBe(false)
    expect(updateCellMock).not.toHaveBeenCalled()
    expect(w.get('[aria-label="刪除第 1 列"]').attributes('disabled')).toBeDefined()
  })

  it('previews and inserts a row while omitting DEFAULT columns', async () => {
    const w = await mountSuspended(DataGrid, { props })
    await vi.waitFor(() => expect(w.find('table').exists()).toBe(true))
    await w.findAll('button').find(button => button.text() === '新增資料列')!.trigger('click')
    expect((w.get('[aria-label="id 輸入方式"]').element as HTMLSelectElement).value).toBe('default')
    await w.get('[aria-label="label 的值"]').setValue('new row')
    await w.findAll('button').find(button => button.text() === '預覽新增')!.trigger('click')
    expect(w.get('[aria-label="確認新增資料列"] pre').text()).toContain('INSERT INTO "public"."items" ("label")')

    await w.findAll('button').find(button => button.text() === '確認新增 1 列')!.trigger('click')
    await vi.waitFor(() => expect(insertRowMock).toHaveBeenCalledWith({
      schema: 'public', table: 'items', values: { label: 'new row' },
    }))
    await vi.waitFor(() => expect(w.text()).toContain('已新增 1 列'))
  })

  it('uses Clone to prefill non-PK values and keeps a serial PK on DEFAULT', async () => {
    const w = await mountSuspended(DataGrid, { props })
    await vi.waitFor(() => expect(w.find('[aria-label="Clone 第 1 列"]').exists()).toBe(true))
    await w.get('[aria-label="Clone 第 1 列"]').trigger('click')
    expect((w.get('[aria-label="id 輸入方式"]').element as HTMLSelectElement).value).toBe('default')
    expect((w.get('[aria-label="label 的值"]').element as HTMLInputElement).value).toBe('a')
  })

  it('clears unique key columns when cloning a row without a primary key', async () => {
    describeMock.mockResolvedValueOnce({
      ok: true,
      data: {
        schema: 'public', table: 'items',
        columns: [
          { ...result([]).data.columns[0]!, editable: true, insertable: true },
          { ...result([]).data.columns[1]!, nullable: false, editable: true, insertable: true },
        ],
        primaryKey: [], uniqueKeys: [{ name: 'items_label_key', columns: ['label'] }], foreignKeys: [],
      },
    })
    const w = await mountSuspended(DataGrid, { props })
    await vi.waitFor(() => expect(w.find('[aria-label="Clone 第 1 列"]').exists()).toBe(true))
    await w.get('[aria-label="Clone 第 1 列"]').trigger('click')
    expect((w.get('[aria-label="label 的值"]').element as HTMLInputElement).value).toBe('')
  })

  it('previews and deletes one row by PK and row version', async () => {
    const w = await mountSuspended(DataGrid, { props })
    await vi.waitFor(() => expect(w.find('[aria-label="刪除第 1 列"]').exists()).toBe(true))
    await w.get('[aria-label="刪除第 1 列"]').trigger('click')
    expect(w.get('[aria-label="確認刪除資料列"] pre').text()).toContain('"id" IS NOT DISTINCT FROM $1')
    expect(w.get('[aria-label="確認刪除資料列"] pre').text()).toContain('xmin::text = $2')
    await w.findAll('button').find(button => button.text() === '確認刪除 1 列')!.trigger('click')
    await vi.waitFor(() => expect(deleteRowMock).toHaveBeenCalledWith({
      schema: 'public', table: 'items', identity: { id: 1 }, version: '10',
    }))
    await vi.waitFor(() => expect(w.text()).toContain('已刪除 1 列'))
  })
})
