import { withConnection } from '../../../utils/api'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id') as string
  return withConnection(event, id, (driver) => driver.listSchemas())
})
