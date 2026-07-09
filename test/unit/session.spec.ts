// @vitest-environment nuxt
import { describe, it, expect } from 'vitest'
import { useSession } from '../../app/stores/session'
import type { QueryResult } from '#shared/types'

describe('useSession', () => {
  it('setCurrentConnection updates id and display name together', () => {
    const s = useSession()
    expect(s.currentConnectionId.value).toBeNull()
    s.setCurrentConnection('abc', 'my-db')
    expect(s.currentConnectionId.value).toBe('abc')
    expect(s.currentConnectionName.value).toBe('my-db')
    s.setCurrentConnection(null)
    expect(s.currentConnectionId.value).toBeNull()
    expect(s.currentConnectionName.value).toBeNull()
  })

  it('setQueryResult updates queryResult', () => {
    const s = useSession()
    const result: QueryResult = { columns: [], rows: [], executionMs: 1 }
    s.setQueryResult(result)
    expect(s.queryResult.value).toEqual(result)
  })

  it('state is shared across useSession calls (useState)', () => {
    const a = useSession()
    a.setCurrentConnection('shared', 'label')
    const b = useSession()
    expect(b.currentConnectionId.value).toBe('shared')
    expect(b.currentConnectionName.value).toBe('label')
  })
})
