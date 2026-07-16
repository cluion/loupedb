// @vitest-environment nuxt
import { beforeEach, describe, it, expect } from 'vitest'
import { SESSION_STORAGE_KEY, useSession } from '../../app/stores/session'

beforeEach(() => {
  localStorage.clear()
  const s = useSession()
  s.currentConnectionId.value = null
  s.currentConnectionName.value = null
})

describe('useSession', () => {
  it('setCurrentConnection updates id and display name together', () => {
    const s = useSession()
    expect(s.currentConnectionId.value).toBeNull()
    s.setCurrentConnection('abc', 'my-db')
    expect(s.currentConnectionId.value).toBe('abc')
    expect(s.currentConnectionName.value).toBe('my-db')
    expect(JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY)!)).toEqual({ id: 'abc', name: 'my-db' })
    s.setCurrentConnection(null)
    expect(s.currentConnectionId.value).toBeNull()
    expect(s.currentConnectionName.value).toBeNull()
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull()
  })

  it('restores a live root session after a full page refresh', () => {
    const s = useSession()
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ id: 'persisted', name: 'production' }))
    expect(s.restoreSession()).toBe('persisted')
    expect(s.currentConnectionId.value).toBe('persisted')
    expect(s.currentConnectionName.value).toBe('production')
  })

  it('ignores malformed persisted sessions', () => {
    const s = useSession()
    localStorage.setItem(SESSION_STORAGE_KEY, '{broken')
    expect(s.restoreSession()).toBeNull()
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull()
  })

  it('state is shared across useSession calls (useState)', () => {
    const a = useSession()
    a.setCurrentConnection('shared', 'label')
    const b = useSession()
    expect(b.currentConnectionId.value).toBe('shared')
    expect(b.currentConnectionName.value).toBe('label')
  })
})
