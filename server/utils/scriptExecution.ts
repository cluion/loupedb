import type { DatabaseError, ScriptExecutionResult, ScriptStatementResult } from '#shared/types'
import { listSqlStatements } from '#shared/sqlStatements'
import type { DatabaseDriver } from '../database/core/driver'
import { toDatabaseError } from './errors'

interface ScriptControl {
  cancelled: boolean
}

const activeScripts = new Map<string, ScriptControl>()

function controlKey(connectionId: string, queryId: string): string {
  return `${connectionId}:${queryId}`
}

export function cancelScript(connectionId: string, queryId: string): void {
  const control = activeScripts.get(controlKey(connectionId, queryId))
  if (control) control.cancelled = true
}

function cancelledError(): DatabaseError {
  return {
    code: '57014',
    message: 'query cancelled by user',
    severity: 'error',
    retryable: false,
  }
}

export async function executeScript(
  driver: DatabaseDriver,
  connectionId: string,
  source: string,
  queryId: string,
): Promise<ScriptExecutionResult> {
  const startedAt = performance.now()
  const ranges = listSqlStatements(source)
  const sqlStatements = ranges.map((range) => source.slice(range.from, range.to).trim())
  const statements: ScriptStatementResult[] = []
  const key = controlKey(connectionId, queryId)
  const control: ScriptControl = { cancelled: false }
  activeScripts.set(key, control)
  const iterator = driver.executeScript(sqlStatements, queryId)[Symbol.asyncIterator]()

  const output = (status: ScriptExecutionResult['status']): ScriptExecutionResult => ({
    kind: 'script',
    status,
    totalStatements: ranges.length,
    statements,
    executionMs: performance.now() - startedAt,
  })

  try {
    for (let index = 0; index < ranges.length; index++) {
      const sql = sqlStatements[index]!
      if (control.cancelled) {
        statements.push({
          index, sql, status: 'cancelled', error: cancelledError(), executionMs: 0,
        })
        return output('cancelled')
      }

      const statementStartedAt = performance.now()
      try {
        const next = await iterator.next()
        if (next.done) break
        const result = next.value
        statements.push({ index, sql, status: 'success', result, executionMs: result.executionMs })
      } catch (cause) {
        const error = toDatabaseError(cause)
        const status = control.cancelled && error.code === '57014' ? 'cancelled' : 'error'
        statements.push({
          index, sql, status, error, executionMs: performance.now() - statementStartedAt,
        })
        return output(status)
      }
    }
    return output('success')
  } finally {
    await iterator.return?.()
    if (activeScripts.get(key) === control) activeScripts.delete(key)
  }
}
