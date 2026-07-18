import { readBody } from 'h3'
import { loadConnections } from '../../security/connectionStore'
import { useConnectionManager } from '../../utils/connectionManager'
import { ok, fail } from '../../utils/api'
import { toDatabaseError } from '../../utils/errors'

// reconnect a saved connection - password is decrypted server-side only
export default defineEventHandler(async (event) => {
  const { name } = await readBody<{ name: string }>(event)
  const saved = (await loadConnections()).find((c) => c.name === name)
  if (!saved) {
    return fail({ code: 'NOT_FOUND', message: `saved connection not found: ${name}`, severity: 'error', retryable: false })
  }
  try {
    const id = await useConnectionManager().open(saved)
    return ok({
      id,
      name: saved.name,
      environment: saved.environment,
      safetyMode: saved.safetyMode,
    })
  } catch (err) {
    return fail(toDatabaseError(err))
  }
})
