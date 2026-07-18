// @vitest-environment nuxt
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import SqlWorkspace from '../../app/components/SqlWorkspace.vue'
import { useQueryHistory } from '../../app/stores/queryHistory'
import {
  addSqlTab,
  closeSqlTab,
  createSqlWorkspace,
  moveSqlTab,
  renameSqlTab,
  restoreSqlWorkspace,
  serializeSqlWorkspace,
  updateSqlTab,
  type SqlTabContext,
} from '../../app/stores/sqlWorkspace'

const root: SqlTabContext = { connectionId: 'root-1', database: null, schema: null }
const app: SqlTabContext = { connectionId: 'child-1', database: 'appdb', schema: 'public' }

beforeEach(() => {
  localStorage.clear()
})

describe('SQL workspace state', () => {
  it('adds, renames, updates, reorders and closes independent tabs immutably', () => {
    const initial = createSqlWorkspace(root, 'tab-1')
    const second = addSqlTab(initial, app, 'tab-2')
    const edited = updateSqlTab(renameSqlTab(second, 'tab-2', 'Report'), 'tab-2', {
      sql: 'select * from reports',
    })
    const moved = moveSqlTab(edited, 'tab-2', 'tab-1')

    expect(initial.tabs).toHaveLength(1)
    expect(edited.tabs.map((tab) => [tab.title, tab.sql])).toEqual([
      ['Query 1', 'SELECT * FROM '],
      ['Report', 'select * from reports'],
    ])
    expect(moved.tabs.map((tab) => tab.id)).toEqual(['tab-2', 'tab-1'])

    const closed = closeSqlTab(moved, 'tab-2', root, 'tab-3')
    expect(closed.activeTabId).toBe('tab-1')
    expect(closed.tabs.map((tab) => tab.id)).toEqual(['tab-1'])
  })

  it('creates a fresh tab when the final tab is closed', () => {
    const state = createSqlWorkspace(root, 'tab-1')
    const closed = closeSqlTab(state, 'tab-1', app, 'tab-2')
    expect(closed.activeTabId).toBe('tab-2')
    expect(closed.tabs[0]).toMatchObject({ id: 'tab-2', connectionId: 'child-1', database: 'appdb' })
  })

  it('persists drafts and context but never query result rows', () => {
    const state = updateSqlTab(createSqlWorkspace(app, 'tab-1'), 'tab-1', {
      sql: 'select secret from users',
      result: { columns: [], rows: [{ secret: 'do-not-persist' }], executionMs: 2 },
      previousResult: { columns: [], rows: [{ secret: 'also-do-not-persist' }], executionMs: 1 },
    })
    const raw = serializeSqlWorkspace(state)
    expect(raw).not.toContain('do-not-persist')
    expect(raw).not.toContain('also-do-not-persist')

    const restored = restoreSqlWorkspace(raw, root)
    expect(restored?.tabs[0]).toMatchObject({
      sql: 'select secret from users', connectionId: 'child-1', database: 'appdb',
      result: null, previousResult: null,
    })
  })

  it('rejects malformed persisted state', () => {
    expect(restoreSqlWorkspace('{bad', root)).toBeNull()
    expect(restoreSqlWorkspace(JSON.stringify({ tabs: [] }), root)).toBeNull()
  })
})

const SqlEditorStub = {
  props: ['connectionId', 'modelValue', 'result', 'previousResult'],
  emits: ['update:modelValue', 'update:result', 'execution-started', 'executed'],
  template: `<textarea aria-label="SQL draft" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
}

const { listMock, saveMock, organizeMock, removeMock } = vi.hoisted(() => ({
  listMock: vi.fn(async () => ({ ok: true as const, data: [] as unknown[] })),
  saveMock: vi.fn(async () => ({ ok: true as const, data: {} })),
  organizeMock: vi.fn(),
  removeMock: vi.fn(async () => ({ ok: true as const, data: { deleted: true } })),
}))
mockNuxtImport('useSavedQueries', () => () => ({
  list: listMock, save: saveMock, organize: organizeMock, remove: removeMock,
}))

const savedDaily = {
  name: 'daily', sql: 'select 9 as nine;', favorite: false, folder: null, tags: [], createdAt: 1, updatedAt: 2,
}

async function mountWorkspace(workspaceId: string, historyLabel: string) {
  return await mountSuspended(SqlWorkspace, {
    props: { workspaceId, historyLabel, suggestedConnectionId: 'root-1' },
    global: { stubs: { SqlEditor: SqlEditorStub } },
  })
}

describe('SqlWorkspace', () => {
  it('creates, switches, renames and preserves drafts across tabs', async () => {
    const w = await mountSuspended(SqlWorkspace, {
      props: { workspaceId: 'workspace-tabs', historyLabel: 'tabs', suggestedConnectionId: 'root-1' },
      global: { stubs: { SqlEditor: SqlEditorStub } },
    })

    await w.get('textarea').setValue('select 1')
    await w.get('[aria-label="新增 SQL 分頁"]').trigger('click')
    await w.get('textarea').setValue('select 2')

    const activeTab = w.get('[role="tab"][aria-selected="true"]')
    await activeTab.trigger('dblclick')
    await w.get('[aria-label="重新命名 SQL 分頁"]').setValue('Second query')
    await w.get('[aria-label="重新命名 SQL 分頁"]').trigger('keyup.enter')
    expect(w.get('[role="tab"][aria-selected="true"]').text()).toContain('Second query')

    await w.get('[role="tab"]').trigger('click')
    expect((w.get('textarea').element as HTMLTextAreaElement).value).toBe('select 1')
  })

  it('updates only the active tab context when the selected database changes', async () => {
    const w = await mountSuspended(SqlWorkspace, {
      props: { workspaceId: 'workspace-context', historyLabel: 'ctx', suggestedConnectionId: 'root-1' },
      global: { stubs: { SqlEditor: SqlEditorStub } },
    })
    await w.get('[aria-label="新增 SQL 分頁"]').trigger('click')
    await w.setProps({ suggestedConnectionId: 'child-1', suggestedDatabase: 'appdb', suggestedSchema: 'public' })
    await nextTick()

    expect(w.get('[data-testid="sql-context"]').text()).toContain('appdb / public')
    expect(w.getComponent(SqlEditorStub).props('connectionId')).toBe('child-1')
    expect(w.findAll('[role="tab"]')[0]!.text()).toContain('root')
  })

  it('keeps the current and previous result independently in each tab', async () => {
    const w = await mountWorkspace('workspace-results', 'results')
    const first = { columns: [], rows: [{ value: 'first' }], executionMs: 2 }
    const second = { columns: [], rows: [{ value: 'second' }], executionMs: 3 }
    let editor = w.getComponent(SqlEditorStub)

    editor.vm.$emit('update:result', first)
    await nextTick()
    editor.vm.$emit('execution-started')
    await nextTick()
    editor = w.getComponent(SqlEditorStub)
    expect(editor.props('result')).toBeNull()
    expect(editor.props('previousResult')).toEqual(first)

    editor.vm.$emit('update:result', second)
    await w.get('[aria-label="新增 SQL 分頁"]').trigger('click')
    await w.findAll('[role="tab"]')[0]!.trigger('click')
    editor = w.getComponent(SqlEditorStub)
    expect(editor.props('result')).toEqual(second)
    expect(editor.props('previousResult')).toEqual(first)
  })
})

describe('SqlWorkspace history drawer', () => {
  it('records editor executions and lists them in the drawer', async () => {
    const w = await mountWorkspace('ws-hist-record', 'hist-record')
    w.getComponent(SqlEditorStub).vm.$emit('executed', {
      sql: 'select 7 as seven;', status: 'success', startedAt: 1000,
      durationMs: 12, rowCount: 1, affectedRows: null,
    })
    await nextTick()
    await w.get('[aria-label="查詢歷史"]').trigger('click')
    expect(w.text()).toContain('select 7 as seven;')
    expect(useQueryHistory('hist-record').entries.value).toHaveLength(1)
  })

  it('opens a history entry in a new tab without touching the current draft', async () => {
    useQueryHistory('hist-open').add({
      sql: 'select 8 as eight;', database: 'appdb', at: 1000, durationMs: 4,
      rowCount: 1, affectedRows: null, status: 'success',
    })
    const w = await mountWorkspace('ws-hist-open', 'hist-open')
    await w.get('[aria-label="查詢歷史"]').trigger('click')
    await w.get('[data-testid="history-entry"]').trigger('click')
    expect(w.findAll('[role="tab"]')).toHaveLength(2)
    expect((w.get('textarea').element as HTMLTextAreaElement).value).toBe('select 8 as eight;')
  })

  it('clears the history list', async () => {
    useQueryHistory('hist-clear').add({
      sql: 'select 1;', database: null, at: 1000, durationMs: 1,
      rowCount: 0, affectedRows: null, status: 'success',
    })
    const w = await mountWorkspace('ws-hist-clear', 'hist-clear')
    await w.get('[aria-label="查詢歷史"]').trigger('click')
    await w.get('[aria-label="清空歷史"]').trigger('click')
    expect(useQueryHistory('hist-clear').entries.value).toEqual([])
  })
})

describe('SqlWorkspace saved queries drawer', () => {
  beforeEach(() => {
    listMock.mockClear()
    saveMock.mockClear()
    organizeMock.mockReset().mockImplementation(async (name: string, patch: Record<string, unknown>) => ({
      ok: true, data: { ...savedDaily, name, ...patch, updatedAt: 3 },
    }))
    removeMock.mockClear()
    listMock.mockResolvedValue({ ok: true, data: [savedDaily] })
  })

  it('saves the active tab under its title', async () => {
    const w = await mountWorkspace('ws-saved-save', 'saved-save')
    await w.get('textarea').setValue('select 5 as five;')
    await w.get('[aria-label="已存查詢"]').trigger('click')
    await w.get('[aria-label="儲存目前分頁"]').trigger('click')
    await vi.waitFor(() => expect(saveMock).toHaveBeenCalled())
    expect(saveMock).toHaveBeenCalledWith('Query 1', 'select 5 as five;')
  })

  it('opens a saved query in a new tab titled after it', async () => {
    const w = await mountWorkspace('ws-saved-open', 'saved-open')
    await w.get('[aria-label="已存查詢"]').trigger('click')
    await vi.waitFor(() => expect(w.text()).toContain('daily'))
    await w.get('[data-testid="saved-entry"]').trigger('click')
    expect(w.findAll('[role="tab"]')).toHaveLength(2)
    expect(w.get('[role="tab"][aria-selected="true"]').text()).toContain('daily')
    expect((w.get('textarea').element as HTMLTextAreaElement).value).toBe('select 9 as nine;')
  })

  it('filters saved queries by the search box', async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: [
        savedDaily,
        {
          name: 'weekly rollup', sql: 'select 2;', favorite: false,
          folder: 'Reports', tags: ['weekly'], createdAt: 1, updatedAt: 1,
        },
      ],
    })
    const w = await mountWorkspace('ws-saved-search', 'saved-search')
    await w.get('[aria-label="已存查詢"]').trigger('click')
    await vi.waitFor(() => expect(w.text()).toContain('weekly rollup'))
    await w.get('[aria-label="搜尋已存查詢"]').setValue('daily')
    expect(w.text()).toContain('daily')
    expect(w.text()).not.toContain('weekly rollup')
  })

  it('favorites and organizes a saved query', async () => {
    const w = await mountWorkspace('ws-saved-organize', 'saved-organize')
    await w.get('[aria-label="已存查詢"]').trigger('click')
    await vi.waitFor(() => expect(w.text()).toContain('daily'))

    await w.get('[aria-label="收藏 daily"]').trigger('click')
    await vi.waitFor(() => expect(organizeMock).toHaveBeenCalledWith('daily', { favorite: true }))

    await w.get('[aria-label="整理 daily"]').trigger('click')
    await w.get('[aria-label="資料夾 daily"]').setValue('Reports')
    await w.get('[aria-label="標籤 daily"]').setValue('daily, audit, daily')
    await w.get('.organization-editor').trigger('submit')
    await vi.waitFor(() => expect(organizeMock).toHaveBeenLastCalledWith('daily', {
      folder: 'Reports', tags: ['daily', 'audit', 'daily'],
    }))
  })

  it('filters saved queries by favorite, folder and tag', async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: [
        savedDaily,
        {
          name: 'weekly rollup', sql: 'select 2;', favorite: true,
          folder: 'Reports', tags: ['weekly'], createdAt: 1, updatedAt: 1,
        },
      ],
    })
    const w = await mountWorkspace('ws-saved-filters', 'saved-filters')
    await w.get('[aria-label="已存查詢"]').trigger('click')
    await vi.waitFor(() => expect(w.text()).toContain('weekly rollup'))

    await w.get('[aria-label="只顯示收藏"]').trigger('click')
    expect(w.text()).toContain('weekly rollup')
    expect(w.text()).not.toContain('daily')
    await w.get('[aria-label="依資料夾篩選"]').setValue('Reports')
    await w.get('[aria-label="依標籤篩選"]').setValue('weekly')
    expect(w.text()).toContain('weekly rollup')
  })

  it('deletes a saved query only after a second confirming click', async () => {
    const w = await mountWorkspace('ws-saved-delete', 'saved-delete')
    await w.get('[aria-label="已存查詢"]').trigger('click')
    await vi.waitFor(() => expect(w.text()).toContain('daily'))
    await w.get('[aria-label="刪除 daily"]').trigger('click')
    expect(removeMock).not.toHaveBeenCalled()
    await w.get('[aria-label="確認刪除 daily"]').trigger('click')
    await vi.waitFor(() => expect(removeMock).toHaveBeenCalledWith('daily'))
  })
})
