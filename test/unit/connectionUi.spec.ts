// @vitest-environment nuxt
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import ConnectionForm from '../../app/components/ConnectionForm.vue'
import ConnectionList from '../../app/components/ConnectionList.vue'
import AppPasswordGate from '../../app/components/AppPasswordGate.vue'

const { createMock, openSavedMock, listMock, removeSavedMock } = vi.hoisted(() => ({
  createMock: vi.fn(async () => ({
    ok: true as const,
    data: { id: 'new-id', name: 'n', environment: 'development' as const, safetyMode: 'normal' as const },
  })),
  openSavedMock: vi.fn(async () => ({
    ok: true as const,
    data: { id: 'reopened-id', name: 'saved-conn', environment: 'production' as const, safetyMode: 'safe' as const },
  })),
  listMock: vi.fn(async () => ({
    ok: true as const,
    data: [{ name: 'saved-conn', environment: 'production' as const, safetyMode: 'safe' as const }],
  })),
  removeSavedMock: vi.fn(async () => ({ ok: true as const, data: { deleted: true } })),
}))

mockNuxtImport('useConnections', () => () => ({
  create: createMock,
  openSaved: openSavedMock,
  list: listMock,
  remove: vi.fn(),
  removeSaved: removeSavedMock,
}))

beforeEach(() => {
  createMock.mockClear()
  openSavedMock.mockClear()
  listMock.mockClear()
  removeSavedMock.mockClear()
})

describe('ConnectionForm', () => {
  it('submits all fields including ssl and emits created id', async () => {
    const w = await mountSuspended(ConnectionForm)
    await w.find('input[placeholder="連線名稱"]').setValue('n')
    await w.find('input[placeholder="host"]').setValue('h')
    await w.find('input[placeholder="port"]').setValue('5433')
    await w.find('input[placeholder="database（選填，預設 postgres）"]').setValue('d')
    await w.find('input[placeholder="username"]').setValue('u')
    await w.find('input[placeholder="password"]').setValue('p')
    await w.find('select[aria-label="SSL mode"]').setValue('require')
    await w.find('form').trigger('submit')
    await w.vm.$nextTick()

    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      name: 'n', host: 'h', port: 5433, database: 'd', username: 'u', password: 'p', ssl: 'require',
      environment: 'development', safetyMode: 'normal',
    }))
    expect(w.emitted('created')).toEqual([[
      { id: 'new-id', name: 'n', environment: 'development', safetyMode: 'normal' },
    ]])
  })

  it('ssl defaults to auto and password input is type password', async () => {
    const w = await mountSuspended(ConnectionForm)
    expect((w.find('select[aria-label="SSL mode"]').element as HTMLSelectElement).value).toBe('auto')
    expect(w.find('input[placeholder="password"]').attributes('type')).toBe('password')
  })

  it('defaults production connections to safe mode while allowing read-only', async () => {
    const w = await mountSuspended(ConnectionForm)
    await w.get('[aria-label="連線環境"]').setValue('production')
    expect((w.get('[aria-label="安全模式"]').element as HTMLSelectElement).value).toBe('safe')
    expect(w.text()).toContain('Production 預設使用 Safe mode')

    await w.get('[aria-label="安全模式"]').setValue('read-only')
    await w.find('form').trigger('submit')
    expect(createMock).toHaveBeenLastCalledWith(expect.objectContaining({
      environment: 'production', safetyMode: 'read-only',
    }))
  })

  it('shows error message when create fails', async () => {
    createMock.mockResolvedValueOnce({ ok: false, error: { code: 'X', message: 'nope', severity: 'error', retryable: false } } as never)
    const w = await mountSuspended(ConnectionForm)
    await w.find('form').trigger('submit')
    await w.vm.$nextTick()
    expect(w.find('[role="alert"]').text()).toContain('nope')
    expect(w.emitted('created')).toBeUndefined()
  })
})

describe('ConnectionList', () => {
  it('renders saved connections and reconnects via openSaved', async () => {
    const w = await mountSuspended(ConnectionList)
    expect(w.text()).toContain('saved-conn')
    expect(w.text()).toContain('PROD')
    expect(w.text()).toContain('SAFE')
    await w.find('li button').trigger('click')
    await w.vm.$nextTick()
    expect(openSavedMock).toHaveBeenCalledWith('saved-conn')
    expect(w.emitted('connect')).toEqual([[
      { id: 'reopened-id', name: 'saved-conn', environment: 'production', safetyMode: 'safe' },
    ]])
  })

  it('deleting a saved connection calls removeSaved and refreshes the list', async () => {
    const w = await mountSuspended(ConnectionList)
    const callsBefore = listMock.mock.calls.length
    await w.find('button[aria-label="刪除已存連線 saved-conn"]').trigger('click')
    await vi.waitFor(() => expect(removeSavedMock).toHaveBeenCalledWith('saved-conn'))
    await vi.waitFor(() => expect(listMock.mock.calls.length).toBeGreaterThan(callsBefore)) // refreshed after delete
    expect(w.emitted('connect')).toBeUndefined() // deleting must not connect
  })

  it('shows error when reconnect fails', async () => {
    openSavedMock.mockResolvedValueOnce({ ok: false, error: { code: 'X', message: 'db down', severity: 'error', retryable: false } } as never)
    const w = await mountSuspended(ConnectionList)
    await w.find('li button').trigger('click')
    await w.vm.$nextTick()
    expect(w.find('[role="alert"]').text()).toContain('db down')
    expect(w.emitted('connect')).toBeUndefined()
  })
})

describe('AppPasswordGate', () => {
  it('stores password in cookie and emits unlocked', async () => {
    const w = await mountSuspended(AppPasswordGate)
    await w.find('input[type="password"]').setValue('hunter2')
    await w.find('form').trigger('submit')
    expect(w.emitted('unlocked')).toHaveLength(1)
    const cookie = useCookie('loupedb_app_pw')
    expect(cookie.value).toBe('hunter2')
  })
})
