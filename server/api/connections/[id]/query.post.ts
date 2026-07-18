import { randomUUID } from 'node:crypto'
import { readBody } from 'h3'
import { withConnection } from '../../../utils/api'
import { assertSqlAllowed } from '../../../security/connectionSafety'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') as string
  const body = await readBody<{
    sql: string
    params?: unknown[]
    queryId?: string
    confirmedDangerous?: boolean
  }>(event)
  return withConnection(event, id, (driver) => {
    assertSqlAllowed(driver.config, body.sql, body.confirmedDangerous === true)
    return driver.execute(body.sql, body.params ?? [], body.queryId ?? randomUUID())
  })
})
