// @vitest-environment nuxt
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import SqlEditor from '../../app/components/SqlEditor.vue'

const { executeMock } = vi.hoisted(() => ({
  executeMock: vi.fn(async () => ({
    ok: true as const,
    data: {
      columns: [{ name: 'one', nativeType: 'int4', type: 'integer' as const, nullable: true }],
      rows: [{ one: 1 }],
      executionMs: 3,
    },
  })),
}))

mockNuxtImport('useQuery', () => () => ({
  execute: executeMock,
  browse: vi.fn(), cancel: vi.fn(), streamUrl: vi.fn(),
}))

beforeEach(() => {
  executeMock.mockClear()
})

// CodeMirror needs a real browser - unit tests drive the same v-model contract
// through a textarea stand-in; the e2e test exercises the real editor
const SqlCodeEditorStub = {
  props: ['modelValue'],
  emits: ['update:modelValue', 'update:runnable', 'run'],
  template: `<textarea :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
}
const mountOpts = {
  props: { connectionId: 'c1', modelValue: 'SELECT * FROM ', result: null },
  global: { stubs: { SqlCodeEditor: SqlCodeEditorStub } },
}

describe('SqlEditor', () => {
  it('renders the code editor bound via v-model', async () => {
    const w = await mountSuspended(SqlEditor, mountOpts)
    expect(w.findComponent(SqlCodeEditorStub).exists()).toBe(true)
  })

  it('emits SQL edits and keeps the rendered result local to its tab', async () => {
    const w = await mountSuspended(SqlEditor, mountOpts)
    await w.find('textarea').setValue('select 1 as one')
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['select 1 as one'])
    await w.find('button').trigger('click')
    await vi.waitFor(() => expect(executeMock).toHaveBeenCalled())
    expect(executeMock.mock.calls[0]![0]).toBe('select 1 as one')
    expect(w.emitted('update:result')?.at(-1)?.[0]).toMatchObject({ rows: [{ one: 1 }] })
    await vi.waitFor(() => expect(w.find('table').exists()).toBe(true)) // result rendered inline
    expect(w.find('tbody td').text()).toBe('1')
  })

  it('executes only the statement the editor reports under the cursor', async () => {
    const w = await mountSuspended(SqlEditor, mountOpts)
    await w.find('textarea').setValue('select 1 as first;\nselect 2 as second;')
    w.findComponent(SqlCodeEditorStub).vm.$emit('update:runnable', {
      sql: 'select 2 as second;', from: 19, to: 38, source: 'statement',
    })
    await nextTick()
    expect(w.find('button.primary').text()).toBe('執行')
    await w.find('button.primary').trigger('click')
    await vi.waitFor(() => expect(executeMock).toHaveBeenCalled())
    expect(executeMock.mock.calls[0]![0]).toBe('select 2 as second;')
  })

  it('runs the active selection and labels the button accordingly', async () => {
    const w = await mountSuspended(SqlEditor, mountOpts)
    await w.find('textarea').setValue('select 1 as first;\nselect 2 as second;')
    w.findComponent(SqlCodeEditorStub).vm.$emit('update:runnable', {
      sql: 'select 1 as first;', from: 0, to: 18, source: 'selection',
    })
    await nextTick()
    expect(w.find('button.primary').text()).toBe('執行選取')
    await w.find('button.primary').trigger('click')
    await vi.waitFor(() => expect(executeMock).toHaveBeenCalled())
    expect(executeMock.mock.calls[0]![0]).toBe('select 1 as first;')
  })

  it('executes the payload carried by the editor run event (Mod-Enter path)', async () => {
    const w = await mountSuspended(SqlEditor, mountOpts)
    w.findComponent(SqlCodeEditorStub).vm.$emit('run', {
      sql: 'select 42 as answer;', from: 0, to: 20, source: 'statement',
    })
    await vi.waitFor(() => expect(executeMock).toHaveBeenCalled())
    expect(executeMock.mock.calls[0]![0]).toBe('select 42 as answer;')
  })

  it('shows error on failed execution and clears stale state', async () => {
    executeMock.mockResolvedValueOnce({
      ok: false, error: { code: '42P01', message: 'no such table', severity: 'error', retryable: false },
    } as never)
    const w = await mountSuspended(SqlEditor, {
      ...mountOpts,
      props: {
        ...mountOpts.props,
        result: { columns: [], rows: [{ stale: true }], executionMs: 1 },
      },
    })
    await w.find('button').trigger('click')
    await vi.waitFor(() => expect(w.find('[role="alert"]').exists()).toBe(true))
    expect(w.find('[role="alert"]').text()).toContain('no such table')
    expect(w.emitted('update:result')?.[0]).toEqual([null])
  })
})
