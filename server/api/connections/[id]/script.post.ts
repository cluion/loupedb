import { randomUUID } from 'node:crypto'
import { readBody } from 'h3'
import { withConnection } from '../../../utils/api'
import { executeScript } from '../../../utils/scriptExecution'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') as string
  const body = await readBody<{ sql: string; queryId?: string }>(event)
  const queryId = body.queryId ?? randomUUID()
  return withConnection(event, id, (driver) => executeScript(driver, id, body.sql, queryId))
})
