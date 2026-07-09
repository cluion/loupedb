import type { H3Event } from 'h3'
import type { DatabaseError, Envelope } from '#shared/types'
import type { DatabaseDriver } from '../database/core/driver'
import { toDatabaseError } from './errors'
import { useConnectionManager } from './connectionManager'

// Envelope<T> lives in shared/types.ts - frontend composables consume it too
// toDatabaseError is imported from ./errors directly - re-exporting it here
// duplicates the symbol in nitro auto-import scanning

export function ok<T>(data: T): Envelope<T> {
  return { ok: true, data }
}

export function fail(error: DatabaseError): Envelope<never> {
  return { ok: false, error }
}

export async function withConnection<T>(
  _event: H3Event, id: string, fn: (driver: DatabaseDriver) => Promise<T>,
): Promise<Envelope<T>> {
  const session = useConnectionManager().get(id)
  if (!session) {
    return fail({ code: 'NO_CONN', message: `connection ${id} not found`, severity: 'error', retryable: false })
  }
  try {
    return ok(await fn(session.driver))
  } catch (err) {
    return fail(toDatabaseError(err))
  }
}
