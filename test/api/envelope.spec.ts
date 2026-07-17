import { describe, it, expect } from 'vitest'
import { ok, fail } from '../../server/utils/api'
import { toDatabaseError } from '../../server/utils/errors'

describe('api envelope', () => {
  it('ok wraps data', () => {
    expect(ok({ a: 1 })).toEqual({ ok: true, data: { a: 1 } })
  })

  it('fail wraps error', () => {
    const e = fail({ code: 'X', message: 'm', severity: 'error', retryable: false })
    expect(e.ok).toBe(false)
    if (!e.ok) expect(e.error.message).toBe('m')
  })

  it('toDatabaseError normalizes postgres errors', () => {
    const pgErr = { code: '23505', message: 'duplicate key', severity: 'ERROR' }
    const e = toDatabaseError(pgErr)
    expect(e.code).toBe('23505')
    expect(e.severity).toBe('error')
    expect(e.retryable).toBe(false)
  })

  it('preserves messages emitted before a database error', () => {
    const messages = [{ severity: 'notice' as const, message: 'before failure', code: '00000' }]
    const e = toDatabaseError({ code: 'P0001', message: 'boom', severity: 'ERROR', messages })
    expect(e.messages).toEqual(messages)
  })

  it('marks 08xxx connection errors retryable', () => {
    const e = toDatabaseError({ code: '08006', message: 'connection failure', severity: 'FATAL' })
    expect(e.retryable).toBe(true)
    expect(e.severity).toBe('fatal')
  })

  it('gives defaults for unknown errors', () => {
    const e = toDatabaseError(new Error('boom'))
    expect(e.code).toBe('UNKNOWN')
    expect(e.retryable).toBe(false)
  })

  it('redacts connection strings and passwords in messages', () => {
    const e = toDatabaseError(new Error('connect failed: postgresql://root:s3cret@db:5432/x password=abc'))
    expect(e.message).not.toContain('s3cret')
    expect(e.message).not.toContain('password=abc')
  })

  it('redacts messages of coded db errors too', () => {
    const e = toDatabaseError({ code: '28P01', message: 'auth failed for postgres://u:pw@h/d', severity: 'FATAL' })
    expect(e.message).not.toContain('pw@h')
  })
})
