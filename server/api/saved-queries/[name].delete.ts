import { loadSavedQueries, saveSavedQueries } from '../../utils/savedQueryStore'
import { ok, fail } from '../../utils/api'
import { toDatabaseError } from '../../utils/errors'

export default defineEventHandler(async (event) => {
  const name = decodeURIComponent(getRouterParam(event, 'name') as string)
  try {
    const remaining = (await loadSavedQueries()).filter((q) => q.name !== name)
    await saveSavedQueries(remaining)
    return ok({ deleted: true })
  } catch (err) {
    return fail(toDatabaseError(err))
  }
})
