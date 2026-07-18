import { readBody } from 'h3'
import type { RowInsertInput } from '#shared/types'
import { fail, withConnection } from '../../../../../../utils/api'

function invalid(message: string) {
  return fail({ code: 'VALIDATION', message, severity: 'error', retryable: false })
}

function isScalar(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') as string
  const schema = getRouterParam(event, 'schema') as string
  const table = getRouterParam(event, 'table') as string
  const body = await readBody<Record<string, unknown>>(event)
  if (!body.values || typeof body.values !== 'object' || Array.isArray(body.values)) {
    return invalid('values must be an object')
  }
  const values = body.values as Record<string, unknown>
  if (Object.values(values).some((value) => !isScalar(value))) {
    return invalid('values must contain only scalars or null')
  }
  const input: RowInsertInput = { schema, table, values }
  return withConnection(event, id, (driver) => driver.insertRow(input))
})
