import { loadSavedQueries } from '../../utils/savedQueryStore'
import { ok, fail } from '../../utils/api'
import { toDatabaseError } from '../../utils/errors'

export default defineEventHandler(async () => {
  try {
    return ok(await loadSavedQueries())
  } catch (err) {
    return fail(toDatabaseError(err))
  }
})
