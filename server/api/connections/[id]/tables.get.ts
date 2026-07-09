import { getQuery } from 'h3'
import { withConnection } from '../../../utils/api'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id') as string
  const schema = (getQuery(event).schema as string) ?? 'public'
  return withConnection(event, id, (driver) => driver.listTables(schema))
})
