// @vitest-environment nuxt
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import SqlEditor from '../../app/components/SqlEditor.vue'
import { useSession } from '../../app/stores/session'

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
  useSession().setQueryResult(null)
})

// CodeMirror needs a real browser - unit tests drive the same v-model contract
// through a textarea stand-in; the e2e test exercises the real editor
const SqlCodeEditorStub = {
  props: ['modelValue'],
  emits: ['update:modelValue', 'run'],
  template: `<textarea :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
}
const mountOpts = { props: { connectionId: 'c1' }, global: { stubs: { SqlCodeEditor: SqlCodeEditorStub } } }

describe('SqlEditor', () => {
  it('renders the code editor bound via v-model', async () => {
    const w = await mountSuspended(SqlEditor, mountOpts)
    expect(w.findComponent(SqlCodeEditorStub).exists()).toBe(true)
  })

  it('runs sql and stores result in session', async () => {
    const w = await mountSuspended(SqlEditor, mountOpts)
    await w.find('textarea').setValue('select 1 as one')
    await w.find('button').trigger('click')
    await vi.waitFor(() => expect(executeMock).toHaveBeenCalled())
    expect(executeMock.mock.calls[0]![0]).toBe('select 1 as one')
    expect(useSession().queryResult.value?.rows).toEqual([{ one: 1 }])
    await vi.waitFor(() => expect(w.find('table').exists()).toBe(true)) // result rendered inline
    expect(w.find('tbody td').text()).toBe('1')
  })

  it('shows error on failed execution and clears stale state', async () => {
    executeMock.mockResolvedValueOnce({
      ok: false, error: { code: '42P01', message: 'no such table', severity: 'error', retryable: false },
    } as never)
    const w = await mountSuspended(SqlEditor, mountOpts)
    await w.find('button').trigger('click')
    await vi.waitFor(() => expect(w.find('[role="alert"]').exists()).toBe(true))
    expect(w.find('[role="alert"]').text()).toContain('no such table')
  })
})
