import { loadConnections, saveConnections } from '../../../security/connectionStore'
import { ok, fail } from '../../../utils/api'
import { toDatabaseError } from '../../../utils/errors'

// removes a stored connection config - live sessions are separate and unaffected
export default defineEventHandler(async (event) => {
  const name = decodeURIComponent(getRouterParam(event, 'name') as string)
  try {
    const remaining = (await loadConnections()).filter((c) => c.name !== name)
    await saveConnections(remaining)
    return ok({ deleted: true })
  } catch (err) {
    return fail(toDatabaseError(err))
  }
})
