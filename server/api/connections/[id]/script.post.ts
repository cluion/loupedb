import { randomUUID } from 'node:crypto'
import { readBody } from 'h3'
import { withConnection } from '../../../utils/api'
import { executeScript } from '../../../utils/scriptExecution'
import { assertSqlAllowed } from '../../../security/connectionSafety'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') as string
  const body = await readBody<{ sql: string; queryId?: string; confirmedDangerous?: boolean }>(event)
  const queryId = body.queryId ?? randomUUID()
  return withConnection(event, id, (driver) => {
    assertSqlAllowed(driver.config, body.sql, body.confirmedDangerous === true)
    return executeScript(driver, id, body.sql, queryId)
  })
})
