import { createConnectionManager } from '../database/core/connectionManager'
import { ensurePostgresRegistered } from '../database/drivers/postgres/register'
import { setConnectionManager } from '../utils/connectionManager'

export default defineNitroPlugin((nitroApp) => {
  ensurePostgresRegistered()
  const manager = createConnectionManager({
    maxSessions: Number(process.env.LOUPEDB_MAX_SESSIONS ?? 20),
    idleTimeoutMs: Number(process.env.LOUPEDB_IDLE_TIMEOUT_MS ?? 1_800_000), // 30 min
  })
  setConnectionManager(manager)

  const timer = setInterval(() => { void manager.sweepIdle() }, 60_000)

  // release every live db connection on server shutdown
  nitroApp.hooks.hook('close', async () => {
    clearInterval(timer)
    await manager.closeAll()
  })
})
