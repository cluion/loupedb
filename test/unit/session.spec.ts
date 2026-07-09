// @vitest-environment nuxt
import { describe, it, expect } from 'vitest'
import { useSession } from '../../app/stores/session'
import type { QueryResult } from '#shared/types'

describe('useSession', () => {
  it('setCurrentConnectionId updates currentConnectionId', () => {
    const s = useSession()
    expect(s.currentConnectionId.value).toBeNull()
    s.setCurrentConnectionId('abc')
    expect(s.currentConnectionId.value).toBe('abc')
    s.setCurrentConnectionId(null)
    expect(s.currentConnectionId.value).toBeNull()
  })

  it('setQueryResult updates queryResult', () => {
    const s = useSession()
    const result: QueryResult = { columns: [], rows: [], executionMs: 1 }
    s.setQueryResult(result)
    expect(s.queryResult.value).toEqual(result)
  })

  it('state is shared across useSession calls (useState)', () => {
    const a = useSession()
    a.setCurrentConnectionId('shared')
    const b = useSession()
    expect(b.currentConnectionId.value).toBe('shared')
  })
})
