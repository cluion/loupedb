import { withConnection } from '../../../../../utils/api'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id') as string
  const schema = getRouterParam(event, 'schema') as string
  const table = getRouterParam(event, 'table') as string
  return withConnection(event, id, (driver) => driver.describeTable(schema, table))
})
