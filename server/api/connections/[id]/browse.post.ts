import { readBody } from 'h3'
import type { BrowseOpts } from '#shared/types'
import { withConnection } from '../../../utils/api'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') as string
  const body = await readBody<{ schema: string; table: string; opts: BrowseOpts; queryId?: string }>(event)
  return withConnection(event, id, (driver) =>
    driver.browse(body.schema, body.table, body.opts, body.queryId))
})
