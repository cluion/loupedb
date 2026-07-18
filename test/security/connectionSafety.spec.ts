import { describe, expect, it } from 'vitest'
import type { ConnectionConfig } from '#shared/types'
import { assertMutationAllowed, assertSqlAllowed } from '../../server/security/connectionSafety'

function config(safetyMode: ConnectionConfig['safetyMode']): ConnectionConfig {
  return {
    name: 'test', driver: 'postgres', host: 'localhost', port: 5432,
    database: 'db', username: 'user', password: 'secret', ssl: 'disable',
    environment: 'development', safetyMode,
  }
}

describe('connection safety policy', () => {
  it('requires an explicit confirmation for dangerous SQL in safe mode', () => {
    expect(() => assertSqlAllowed(config('safe'), 'update items set label = label'))
      .toThrow(/requires confirmation/)
    expect(() => assertSqlAllowed(config('safe'), 'update items set label = label', true)).not.toThrow()
    expect(() => assertMutationAllowed(config('safe'), 'DELETE')).toThrow(/requires confirmation/)
  })

  it('allows reads but rejects every direct mutation in read-only mode', () => {
    expect(() => assertSqlAllowed(config('read-only'), 'select 1')).not.toThrow()
    expect(() => assertSqlAllowed(config('read-only'), 'create table blocked(id int)')).toThrow(/read-only/)
    expect(() => assertMutationAllowed(config('read-only'), 'INSERT')).toThrow(/read-only/)
  })
})
