import { readBody, setResponseHeader } from 'h3'
import type { BinaryCellReadInput } from '#shared/types'
import { fail } from '../../../../../../utils/api'
import { useConnectionManager } from '../../../../../../utils/connectionManager'
import { toDatabaseError } from '../../../../../../utils/errors'

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
  if (!body.identity || typeof body.identity !== 'object' || Array.isArray(body.identity)) {
    return invalid('identity is required')
  }
  const identity = body.identity as Record<string, unknown>
  if (!Object.keys(identity).length || Object.values(identity).some((value) => !isScalar(value))) {
    return invalid('identity must contain scalar primary or unique key values')
  }
  if (typeof body.version !== 'string' || !/^\d+$/u.test(body.version)) {
    return invalid('version must be a valid row version')
  }

  const session = useConnectionManager().get(id)
  if (!session) return fail({
    code: 'NO_CONN', message: `connection ${id} not found`, severity: 'error', retryable: false,
  })
  const input: BinaryCellReadInput = {
    schema, table, column: body.column, identity, version: body.version,
  }
  try {
    const result = await session.driver.readBinaryCell(input)
    if (result.data === null) {
      return fail({ code: 'BINARY_NULL', message: 'binary cell is NULL', severity: 'error', retryable: false })
    }
    const suggested = `${table}-${body.column}.bin`
    const fallback = suggested.replace(/[^a-zA-Z0-9_.-]+/gu, '_').slice(0, 180) || 'download.bin'
    setResponseHeader(event, 'content-type', 'application/octet-stream')
    setResponseHeader(event, 'content-length', result.data.byteLength)
    setResponseHeader(
      event,
      'content-disposition',
      `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(suggested)}`,
    )
    setResponseHeader(event, 'cache-control', 'no-store')
    return result.data
  } catch (cause) {
    return fail(toDatabaseError(cause))
  }
})
