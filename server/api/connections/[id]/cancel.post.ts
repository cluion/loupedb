import { readBody } from 'h3'
import { withConnection } from '../../../utils/api'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') as string
  const body = await readBody<{ queryId: string }>(event)
  return withConnection(event, id, (driver) => driver.cancel(body.queryId))
})
