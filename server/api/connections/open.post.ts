import { readBody } from 'h3'
import { loadConnections } from '../../security/connectionStore'
import { useConnectionManager } from '../../utils/connectionManager'
import { ok, fail, toDatabaseError } from '../../utils/api'

// reconnect a saved connection - password is decrypted server-side only
export default defineEventHandler(async (event) => {
  const { name } = await readBody<{ name: string }>(event)
  const saved = (await loadConnections()).find((c) => c.name === name)
  if (!saved) {
    return fail({ code: 'NOT_FOUND', message: `saved connection not found: ${name}`, severity: 'error', retryable: false })
  }
  try {
    const id = await useConnectionManager().open(saved)
    return ok({ id })
  } catch (err) {
    return fail(toDatabaseError(err))
  }
})
