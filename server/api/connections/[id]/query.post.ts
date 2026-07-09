import { randomUUID } from 'node:crypto'
import { readBody } from 'h3'
import { withConnection } from '../../../utils/api'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') as string
  const body = await readBody<{ sql: string; params?: unknown[]; queryId?: string }>(event)
  return withConnection(event, id, (driver) =>
    driver.execute(body.sql, body.params ?? [], body.queryId ?? randomUUID()))
})
