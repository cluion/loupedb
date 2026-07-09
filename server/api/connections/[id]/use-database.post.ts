import { readBody } from 'h3'
import { useConnectionManager } from '../../../utils/connectionManager'
import { ok, fail } from '../../../utils/api'
import { toDatabaseError } from '../../../utils/errors'

// pg connections are bound to one database - browsing another database means
// opening a sibling session with the same credentials, transparently to the ui
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') as string
  const { database } = await readBody<{ database: string }>(event)
  const manager = useConnectionManager()
  const session = manager.get(id)
  if (!session) {
    return fail({ code: 'NO_CONN', message: `connection ${id} not found`, severity: 'error', retryable: false })
  }
  if (session.driver.config.database === database) return ok({ id })
  try {
    // parented: closing the root connection cascades to this sibling
    const newId = await manager.open({ ...session.driver.config, database }, id)
    return ok({ id: newId })
  } catch (err) {
    return fail(toDatabaseError(err))
  }
})
