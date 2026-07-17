// @vitest-environment nuxt
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import SqlEditor from '../../app/components/SqlEditor.vue'

const { executeMock, cancelMock, formatSqlMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  cancelMock: vi.fn(),
  formatSqlMock: vi.fn(),
}))

mockNuxtImport('useQuery', () => () => ({
  execute: executeMock,
  browse: vi.fn(), cancel: cancelMock, streamUrl: vi.fn(),
}))

const { ensureLoadedMock } = vi.hoisted(() => ({ ensureLoadedMock: vi.fn(async () => {}) }))
mockNuxtImport('useSqlCompletion', () => () => ({
  namespace: ref({ public: { items: ['id', 'label'] } }),
  ensureLoaded: ensureLoadedMock,
}))

beforeEach(() => {
  executeMock.mockReset().mockResolvedValue({
    ok: true as const,
    data: {
      columns: [{ name: 'one', nativeType: 'int4', type: 'integer' as const, nullable: true }],
      rows: [{ one: 1 }],
      executionMs: 3,
    },
  })
  cancelMock.mockReset().mockResolvedValue({ ok: true as const, data: undefined })
  formatSqlMock.mockReset().mockReturnValue(true)
})

// CodeMirror needs a real browser - unit tests drive the same v-model contract
// through a textarea stand-in; the e2e test exercises the real editor
const SqlCodeEditorStub = {
  props: ['modelValue', 'schema', 'defaultSchema'],
  emits: ['update:modelValue', 'update:runnable', 'run', 'formatted', 'format-error'],
  setup(_: unknown, { expose }: { expose: (value: { formatSql: typeof formatSqlMock }) => void }) {
    expose({ formatSql: formatSqlMock })
  },
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
    expect(executeMock.mock.calls[0]![1]).toEqual(expect.any(String))
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

  it('feeds completion metadata and default schema into the code editor', async () => {
    const w = await mountSuspended(SqlEditor, {
      ...mountOpts,
      props: { ...mountOpts.props, defaultSchema: 'app' },
    })
    expect(ensureLoadedMock).toHaveBeenCalled()
    const stub = w.findComponent(SqlCodeEditorStub)
    expect(stub.props('schema')).toEqual({ public: { items: ['id', 'label'] } })
    expect(stub.props('defaultSchema')).toBe('app')
  })

  it('falls back to the public schema when no context is given', async () => {
    const w = await mountSuspended(SqlEditor, mountOpts)
    expect(w.findComponent(SqlCodeEditorStub).props('defaultSchema')).toBe('public')
  })

  it('asks the code editor to format SQL from the toolbar', async () => {
    const w = await mountSuspended(SqlEditor, mountOpts)
    await w.get('[aria-label="格式化 SQL"]').trigger('click')
    expect(formatSqlMock).toHaveBeenCalledOnce()
  })

  it('shows formatter errors and clears stale errors after edits or a successful format', async () => {
    const w = await mountSuspended(SqlEditor, mountOpts)
    const editor = w.findComponent(SqlCodeEditorStub)

    editor.vm.$emit('format-error', 'Parse error')
    await nextTick()
    expect(w.get('[data-testid="format-error"]').text()).toBe('SQL 格式化失敗：Parse error')

    await w.get('textarea').setValue('select 1')
    expect(w.find('[data-testid="format-error"]').exists()).toBe(false)

    editor.vm.$emit('format-error', 'Parse error')
    await nextTick()
    editor.vm.$emit('formatted', 'document')
    await nextTick()
    expect(w.find('[data-testid="format-error"]').exists()).toBe(false)
  })

  it('reports a successful execution for history recording', async () => {
    const w = await mountSuspended(SqlEditor, mountOpts)
    await w.find('textarea').setValue('select 1 as one')
    await w.find('button').trigger('click')
    await vi.waitFor(() => expect(w.emitted('executed')).toBeTruthy())
    expect(w.emitted('executed')![0]![0]).toMatchObject({
      sql: 'select 1 as one', status: 'success', durationMs: 3, rowCount: 1, affectedRows: null,
    })
    expect((w.emitted('executed')![0]![0] as { startedAt: number }).startedAt).toBeTypeOf('number')
  })

  it('reports a failed execution with elapsed duration and no row counts', async () => {
    executeMock.mockResolvedValueOnce({
      ok: false, error: { code: '42P01', message: 'no such table', severity: 'error', retryable: false },
    } as never)
    const w = await mountSuspended(SqlEditor, mountOpts)
    await w.find('button').trigger('click')
    await vi.waitFor(() => expect(w.emitted('executed')).toBeTruthy())
    expect(w.emitted('executed')![0]![0]).toMatchObject({
      sql: 'SELECT * FROM ', status: 'error', rowCount: null, affectedRows: null,
    })
    expect((w.emitted('executed')![0]![0] as { durationMs: number }).durationMs).toBeTypeOf('number')
  })

  it('passes a client query id to execute and cancels that exact query', async () => {
    let resolveQuery!: (value: unknown) => void
    executeMock.mockImplementationOnce(() => new Promise((resolve) => { resolveQuery = resolve }))
    const w = await mountSuspended(SqlEditor, mountOpts)

    await w.find('button.primary').trigger('click')
    await vi.waitFor(() => expect(w.get('[aria-label="停止查詢"]').text()).toBe('停止'))
    const queryId = executeMock.mock.calls[0]![1] as string
    await w.get('[aria-label="停止查詢"]').trigger('click')
    expect(cancelMock).toHaveBeenCalledWith(queryId)
    await vi.waitFor(() => expect(w.get('[aria-label="停止查詢"]').text()).toBe('取消中…'))

    resolveQuery({
      ok: false,
      error: { code: '57014', message: 'canceling statement due to user request', severity: 'error', retryable: false },
    })
    await vi.waitFor(() => expect(w.get('[data-testid="execution-summary"]').text()).toContain('已取消'))
    expect(w.find('[role="alert"]').exists()).toBe(false)
    expect(w.emitted('executed')?.at(-1)?.[0]).toMatchObject({ status: 'cancelled' })
  })

  it('shows affected rows, start time and duration for statements without a result set', async () => {
    executeMock.mockResolvedValueOnce({
      ok: true,
      data: { columns: [], rows: [], rowCount: 0, affectedRows: 2, executionMs: 8 },
    })
    const w = await mountSuspended(SqlEditor, mountOpts)
    await w.find('button.primary').trigger('click')
    await vi.waitFor(() => expect(w.get('[data-testid="execution-summary"]').text()).toContain('2 列受影響'))
    const summary = w.get('[data-testid="execution-summary"]').text()
    expect(summary).toContain('開始')
    expect(summary).toContain('8 ms')
    expect(w.emitted('executed')?.at(-1)?.[0]).toMatchObject({
      status: 'success', rowCount: null, affectedRows: 2,
    })
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
