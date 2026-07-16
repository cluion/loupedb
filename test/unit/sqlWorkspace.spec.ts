// @vitest-environment nuxt
import { beforeEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import SqlWorkspace from '../../app/components/SqlWorkspace.vue'
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
    })
    const raw = serializeSqlWorkspace(state)
    expect(raw).not.toContain('do-not-persist')

    const restored = restoreSqlWorkspace(raw, root)
    expect(restored?.tabs[0]).toMatchObject({
      sql: 'select secret from users', connectionId: 'child-1', database: 'appdb', result: null,
    })
  })

  it('rejects malformed persisted state', () => {
    expect(restoreSqlWorkspace('{bad', root)).toBeNull()
    expect(restoreSqlWorkspace(JSON.stringify({ tabs: [] }), root)).toBeNull()
  })
})

const SqlEditorStub = {
  props: ['connectionId', 'modelValue', 'result'],
  emits: ['update:modelValue', 'update:result'],
  template: `<textarea aria-label="SQL draft" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
}

describe('SqlWorkspace', () => {
  it('creates, switches, renames and preserves drafts across tabs', async () => {
    const w = await mountSuspended(SqlWorkspace, {
      props: { workspaceId: 'workspace-tabs', suggestedConnectionId: 'root-1' },
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
      props: { workspaceId: 'workspace-context', suggestedConnectionId: 'root-1' },
      global: { stubs: { SqlEditor: SqlEditorStub } },
    })
    await w.get('[aria-label="新增 SQL 分頁"]').trigger('click')
    await w.setProps({ suggestedConnectionId: 'child-1', suggestedDatabase: 'appdb', suggestedSchema: 'public' })
    await nextTick()

    expect(w.get('[data-testid="sql-context"]').text()).toContain('appdb / public')
    expect(w.getComponent(SqlEditorStub).props('connectionId')).toBe('child-1')
    expect(w.findAll('[role="tab"]')[0]!.text()).toContain('root')
  })
})
