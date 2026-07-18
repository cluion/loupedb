import { readBody } from 'h3'
import type { RowDeleteInput } from '#shared/types'
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
  if (!body.identity || typeof body.identity !== 'object' || Array.isArray(body.identity)) {
    return invalid('identity is required')
  }
  const identity = body.identity as Record<string, unknown>
  if (!Object.keys(identity).length || Object.values(identity).some((value) => !isScalar(value))) {
    return invalid('identity must contain scalar primary key values')
  }
  if (typeof body.version !== 'string' || !/^\d+$/u.test(body.version)) {
    return invalid('version is required')
  }
  const input: RowDeleteInput = { schema, table, identity, version: body.version }
  return withConnection(event, id, (driver) => driver.deleteRow(input))
})
