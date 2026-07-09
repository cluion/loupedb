import { loadConnections } from '../../security/connectionStore'
import { ok } from '../../utils/api'

export default defineEventHandler(async () => {
  const list = await loadConnections()
  // passwords never leave the server
  return ok(list.map(({ password: _password, ...rest }) => rest))
})
