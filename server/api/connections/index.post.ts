import { readBody } from 'h3'
import type { ConnectionConfig, SslMode } from '#shared/types'
import { resolveSslMode } from '../../security/ssl'
import { loadConnections, saveConnections } from '../../security/connectionStore'
import { useConnectionManager } from '../../utils/connectionManager'
import { ok, fail } from '../../utils/api'
import { toDatabaseError } from '../../utils/errors'

export default defineEventHandler(async (event) => {
  const body = await readBody<Omit<Partial<ConnectionConfig>, 'ssl'> & { ssl?: SslMode | 'auto' }>(event)
  const config: ConnectionConfig = {
    name: body.name ?? '', driver: 'postgres', host: body.host ?? '', port: body.port ?? 5432,
    database: body.database ?? '', username: body.username ?? '', password: body.password ?? '',
    // ui offers auto (resolve by host) plus explicit ssl modes (spec 4.5.2)
    ssl: !body.ssl || body.ssl === 'auto' ? resolveSslMode(body.host ?? '') : body.ssl,
  }
  try {
    const id = await useConnectionManager().open(config)
    // persist with encrypted password, upsert by name to avoid duplicates
    const others = (await loadConnections()).filter((c) => c.name !== config.name)
    await saveConnections([...others, config])
    return ok({ id })
  } catch (err) {
    return fail(toDatabaseError(err))
  }
})
