import { registerDriver } from '../../core/registry'
import { createPostgresDriver } from './index'

let registered = false

export function ensurePostgresRegistered(): void {
  if (registered) return
  registerDriver('postgres', createPostgresDriver)
  registered = true
}
