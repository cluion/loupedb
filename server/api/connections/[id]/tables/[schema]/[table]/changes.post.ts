import { readBody } from 'h3'
import type { TableChange, TableChangesInput } from '#shared/types'
import { fail, withConnection } from '../../../../../../utils/api'
import { assertMutationAllowed } from '../../../../../../security/connectionSafety'

const MAX_STAGED_CHANGES = 500

function invalid(message: string) {
  return fail({ code: 'VALIDATION', message, severity: 'error', retryable: false })
}

function isScalar(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isIdentity(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && Object.keys(value).length > 0
    && Object.values(value).every(isScalar)
}

function isVersion(value: unknown): value is string {
  return typeof value === 'string' && /^\d+$/u.test(value)
}

function parseChange(value: unknown): TableChange | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null
  if (value.kind === 'insert') {
    if (!isRecord(value.values) || !Object.values(value.values).every(isScalar)) return null
    return { kind: 'insert', values: value.values }
  }
  if (value.kind === 'update') {
    if (
      typeof value.column !== 'string' || !value.column
      || !('value' in value) || !isScalar(value.value)
      || !('originalValue' in value) || !isScalar(value.originalValue)
      || !isIdentity(value.identity) || !isVersion(value.version)
    ) return null
    return {
      kind: 'update',
      column: value.column,
      value: value.value,
      originalValue: value.originalValue,
      identity: value.identity,
      version: value.version,
    }
  }
  if (value.kind === 'delete' && isIdentity(value.identity) && isVersion(value.version)) {
    return { kind: 'delete', identity: value.identity, version: value.version }
  }
  return null
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') as string
  const schema = getRouterParam(event, 'schema') as string
  const table = getRouterParam(event, 'table') as string
  const body = await readBody<Record<string, unknown>>(event)
  if (!Array.isArray(body.changes) || !body.changes.length) {
    return invalid('changes must be a non-empty array')
  }
  if (body.changes.length > MAX_STAGED_CHANGES) {
    return invalid(`changes cannot exceed ${MAX_STAGED_CHANGES} items`)
  }
  const changes = body.changes.map(parseChange)
  if (changes.some((change) => change === null)) {
    return invalid('every staged change must contain valid scalar values, identity and row version')
  }
  const input: TableChangesInput = { schema, table, changes: changes as TableChange[] }
  return withConnection(event, id, (driver) => {
    for (const change of input.changes) {
      const command = change.kind === 'insert' ? 'INSERT' : change.kind === 'update' ? 'UPDATE' : 'DELETE'
      assertMutationAllowed(driver.config, command, body.confirmedDangerous === true)
    }
    return driver.applyTableChanges(input)
  })
})
