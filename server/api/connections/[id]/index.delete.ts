import { useConnectionManager } from '../../../utils/connectionManager'
import { ok, fail } from '../../../utils/api'
import { toDatabaseError } from '../../../utils/errors'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') as string
  try {
    await useConnectionManager().close(id)
    return ok({ closed: true })
  } catch (err) {
    return fail(toDatabaseError(err))
  }
})
