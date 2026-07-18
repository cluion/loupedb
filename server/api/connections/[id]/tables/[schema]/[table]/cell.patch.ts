import { readBody } from 'h3'
import type { CellUpdateInput } from '#shared/types'
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
  if (typeof body.column !== 'string' || !body.column) return invalid('column is required')
  if (!('value' in body) || !isScalar(body.value)) return invalid('value must be a scalar or null')
  if (!('originalValue' in body) || !isScalar(body.originalValue)) {
    return invalid('originalValue must be a scalar or null')
  }
  if (!body.identity || typeof body.identity !== 'object' || Array.isArray(body.identity)) {
    return invalid('identity is required')
  }
  const identity = body.identity as Record<string, unknown>
  if (!Object.keys(identity).length || Object.values(identity).some((value) => !isScalar(value))) {
    return invalid('identity must contain scalar primary key values')
  }
  const input: CellUpdateInput = {
    schema,
    table,
    column: body.column,
    value: body.value,
    originalValue: body.originalValue,
    identity,
  }
  return withConnection(event, id, (driver) => driver.updateCell(input))
})
