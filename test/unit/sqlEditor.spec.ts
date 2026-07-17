// @vitest-environment nuxt
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import SqlEditor from '../../app/components/SqlEditor.vue'

const { executeMock, executeScriptMock, cancelMock, formatSqlMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  executeScriptMock: vi.fn(),
  cancelMock: vi.fn(),
  formatSqlMock: vi.fn(),
}))

mockNuxtImport('useQuery', () => () => ({
  execute: executeMock,
  executeScript: executeScriptMock,
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
  executeScriptMock.mockReset().mockResolvedValue({
    ok: true as const,
    data: { kind: 'script', status: 'success', totalStatements: 0, statements: [], executionMs: 0 },
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
    expect(executeMock.mock.calls[0]![1]).toEqual([])
    expect(executeMock.mock.calls[0]![2]).toEqual(expect.any(String))
    expect(w.emitted('update:result')?.at(-1)?.[0]).toMatchObject({ rows: [{ one: 1 }] })
    await vi.waitFor(() => expect(w.find('table').exists()).toBe(true)) // result rendered inline
    expect(w.find('tbody td').text()).toBe('1')
  })

  it('keeps the prior result available after the next successful execution', async () => {
    const previous = {
      columns: [{ name: 'value', nativeType: 'text', type: 'string' as const, nullable: true }],
      rows: [{ value: 'before' }], rowCount: 1, executionMs: 2,
    }
    executeMock.mockResolvedValueOnce({
      ok: true,
      data: {
        columns: [{ name: 'value', nativeType: 'text', type: 'string', nullable: true }],
        rows: [{ value: 'after' }], rowCount: 1, executionMs: 3,
      },
    })
    const w = await mountSuspended(SqlEditor, {
      ...mountOpts,
      props: { ...mountOpts.props, result: previous },
    })

    await w.get('button.primary').trigger('click')
    await vi.waitFor(() => expect(w.get('tbody td').text()).toBe('after'))
    expect(w.get('[aria-label="顯示目前結果"]').attributes('aria-selected')).toBe('true')
    expect(w.get('[aria-label="顯示前次結果"]').text()).toContain('1 列')

    await w.get('[aria-label="顯示前次結果"]').trigger('click')
    expect(w.get('tbody td').text()).toBe('before')
    await w.get('[aria-label="顯示目前結果"]').trigger('click')
    expect(w.get('tbody td').text()).toBe('after')
  })

  it('shows PostgreSQL notices, warnings and message details', async () => {
    executeMock.mockResolvedValueOnce({
      ok: true,
      data: {
        columns: [], rows: [], executionMs: 2,
        messages: [
          { severity: 'notice', code: '00000', message: 'refresh complete', detail: '12 rows checked' },
          { severity: 'warning', code: '01000', message: 'using fallback', hint: 'check the index' },
        ],
      },
    })
    const w = await mountSuspended(SqlEditor, mountOpts)
    await w.get('button.primary').trigger('click')

    await vi.waitFor(() => expect(w.get('[data-testid="query-messages"]').text()).toContain('訊息・2'))
    expect(w.get('[data-testid="query-messages"]').text()).toContain('NOTICE')
    expect(w.get('[data-testid="query-messages"]').text()).toContain('refresh complete')
    expect(w.get('[data-testid="query-messages"]').text()).toContain('詳細：12 rows checked')
    expect(w.get('[data-testid="query-messages"]').text()).toContain('WARNING')
    expect(w.get('[data-testid="query-messages"]').text()).toContain('提示：check the index')
  })

  it('collects positional parameters before executing the current statement', async () => {
    const w = await mountSuspended(SqlEditor, mountOpts)
    await w.get('textarea').setValue('select $1::text as label, $3::int as amount, $4::text as optional')
    await w.get('button.primary').trigger('click')

    expect(executeMock).not.toHaveBeenCalled()
    expect(w.get('[role="dialog"]').text()).toContain('查詢參數')
    expect(w.find('[aria-label="參數 $2"]').exists()).toBe(false)
    await w.get('[aria-label="參數 $1"]').setValue('bound value')
    await w.get('[aria-label="參數 $3"]').setValue('42')
    await w.get('[aria-label="參數 $4 使用 NULL"]').setValue(true)
    await w.get('button[type="submit"]').trigger('submit')

    await vi.waitFor(() => expect(executeMock).toHaveBeenCalled())
    expect(executeMock.mock.calls[0]![0]).toContain('$1::text')
    expect(executeMock.mock.calls[0]![1]).toEqual(['bound value', null, '42', null])
    expect(executeMock.mock.calls[0]![2]).toEqual(expect.any(String))
  })

  it('cancels parameter entry without executing and rejects parameters in a complete script', async () => {
    const w = await mountSuspended(SqlEditor, mountOpts)
    await w.get('textarea').setValue('select $1; select 2;')
    await w.get('button.primary').trigger('click')
    await w.get('[aria-label="關閉查詢參數"]').trigger('click')
    expect(executeMock).not.toHaveBeenCalled()

    await w.get('[aria-label="執行完整 Script"]').trigger('click')
    expect(w.get('[role="alert"]').text()).toContain('完整 Script 暫不支援參數')
    expect(executeScriptMock).not.toHaveBeenCalled()
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

  it('runs the complete script and switches between result sets and command messages', async () => {
    executeScriptMock.mockResolvedValueOnce({
      ok: true,
      data: {
        kind: 'script', status: 'success', totalStatements: 3, executionMs: 9,
        statements: [
          {
            index: 0, sql: "select 'first' as step;", status: 'success', executionMs: 2,
            result: {
              command: 'SELECT', columns: [{ name: 'step', nativeType: 'text', type: 'string', nullable: true }],
              rows: [{ step: 'first' }], rowCount: 1, executionMs: 2,
              messages: [{ severity: 'notice', message: 'first message' }],
            },
          },
          {
            index: 1, sql: 'update items set label = label;', status: 'success', executionMs: 3,
            result: {
              command: 'UPDATE', columns: [], rows: [], affectedRows: 2, executionMs: 3,
              messages: [{ severity: 'warning', message: 'update warning' }],
            },
          },
          {
            index: 2, sql: "select 'last' as step;", status: 'success', executionMs: 4,
            result: {
              command: 'SELECT', columns: [{ name: 'step', nativeType: 'text', type: 'string', nullable: true }],
              rows: [{ step: 'last' }], rowCount: 1, executionMs: 4,
            },
          },
        ],
      },
    })
    const script = "select 'first' as step;\nupdate items set label = label;\nselect 'last' as step;"
    const w = await mountSuspended(SqlEditor, mountOpts)
    await w.get('textarea').setValue(script)
    await w.get('[aria-label="執行完整 Script"]').trigger('click')

    await vi.waitFor(() => expect(w.findAll('[aria-label^="結果 "]')).toHaveLength(3))
    expect(executeScriptMock).toHaveBeenCalledWith(script, expect.any(String))
    expect(w.get('[data-testid="execution-summary"]').text()).toContain('3 個 statement')
    expect(w.get('tbody td').text()).toBe('first')
    expect(w.get('[data-testid="query-messages"]').text()).toContain('first message')

    await w.get('[aria-label="結果 2 UPDATE"]').trigger('click')
    expect(w.get('[data-testid="script-statement-message"]').text()).toContain('UPDATE・2 列受影響')
    expect(w.get('[data-testid="query-messages"]').text()).toContain('update warning')
    await w.get('[aria-label="結果 3 SELECT"]').trigger('click')
    expect(w.get('tbody td').text()).toBe('last')
  })

  it('selects the failed statement while keeping completed script results available', async () => {
    executeScriptMock.mockResolvedValueOnce({
      ok: true,
      data: {
        kind: 'script', status: 'error', totalStatements: 3, executionMs: 5,
        statements: [
          {
            index: 0, sql: 'select 1;', status: 'success', executionMs: 2,
            result: { command: 'SELECT', columns: [], rows: [], rowCount: 1, executionMs: 2 },
          },
          {
            index: 1, sql: 'select * from missing;', status: 'error', executionMs: 3,
            error: {
              code: '42P01', message: 'missing relation', severity: 'error', retryable: false,
              messages: [{ severity: 'notice', message: 'before script failure' }],
            },
          },
        ],
      },
    })
    const w = await mountSuspended(SqlEditor, mountOpts)
    await w.get('textarea').setValue('select 1; select * from missing; select 3;')
    await w.get('[aria-label="執行完整 Script"]').trigger('click')

    await vi.waitFor(() => expect(w.get('[data-testid="execution-summary"]').text()).toContain('第 2 / 3 個失敗'))
    expect(w.get('[aria-label="結果 2 SELECT"]').attributes('aria-selected')).toBe('true')
    expect(w.get('[data-testid="script-statement-message"]').text()).toContain('missing relation')
    expect(w.get('[data-testid="query-messages"]').text()).toContain('before script failure')
    expect(w.find('[aria-label="結果 3 SELECT"]').exists()).toBe(false)
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
    const queryId = executeMock.mock.calls[0]![2] as string
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

  it('shows an error while keeping the last result as the previous version', async () => {
    executeMock.mockResolvedValueOnce({
      ok: false,
      error: {
        code: '42P01', message: 'no such table', severity: 'error', retryable: false,
        messages: [{ severity: 'notice', message: 'before editor failure' }],
      },
    } as never)
    const w = await mountSuspended(SqlEditor, {
      ...mountOpts,
      props: {
        ...mountOpts.props,
        result: {
          columns: [{ name: 'stale', nativeType: 'bool', type: 'boolean', nullable: true }],
          rows: [{ stale: true }], rowCount: 1, executionMs: 1,
        },
      },
    })
    await w.find('button').trigger('click')
    await vi.waitFor(() => expect(w.find('[role="alert"]').exists()).toBe(true))
    expect(w.find('[role="alert"]').text()).toContain('no such table')
    expect(w.get('[data-testid="query-messages"]').text()).toContain('before editor failure')
    expect(w.emitted('execution-started')).toHaveLength(1)
    expect(w.find('table').exists()).toBe(false)

    await w.get('[aria-label="顯示前次結果"]').trigger('click')
    expect(w.find('table').exists()).toBe(true)
    expect(w.find('[role="alert"]').exists()).toBe(false)
  })
})
