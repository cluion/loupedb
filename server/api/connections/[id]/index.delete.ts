import { useConnectionManager } from '../../../utils/connectionManager'
import { ok, fail, toDatabaseError } from '../../../utils/api'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') as string
  try {
    await useConnectionManager().close(id)
    return ok({ closed: true })
  } catch (err) {
    return fail(toDatabaseError(err))
  }
})
