import { withConnection } from '../../../utils/api'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') as string
  return withConnection(event, id, async (driver) => driver.transactionStatus())
})
