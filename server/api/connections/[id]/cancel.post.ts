import { readBody } from 'h3'
import { withConnection } from '../../../utils/api'
import { cancelScript } from '../../../utils/scriptExecution'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') as string
  const body = await readBody<{ queryId: string }>(event)
  cancelScript(id, body.queryId)
  return withConnection(event, id, (driver) => driver.cancel(body.queryId))
})
