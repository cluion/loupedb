import { describe, it, expect, beforeEach } from 'vitest'
import { registerDriver, getDriverFactory, createDriver, clearRegistry } from '../server/database/core/registry'
import type { DatabaseDriver } from '../server/database/core/driver'
import type { ConnectionConfig } from '#shared/types'

const fakeDriver = (config: ConnectionConfig): DatabaseDriver => ({
  config,
  async connect() {}, async disconnect() {}, status: 'closed',
  async listDatabases() { return [] },
  async listSchemas() { return [] }, async listTables() { return [] },
  async describeTable() { return { schema: '', table: '', columns: [], primaryKey: [], foreignKeys: [] } },
  async execute() { return { columns: [], rows: [], executionMs: 0 } },
  async browse() { return { columns: [], rows: [], executionMs: 0 } },
  async cancel() {},
  async* stream() {},
})

describe('driverRegistry', () => {
  beforeEach(() => clearRegistry())

  it('registers and returns a driver factory', () => {
    registerDriver('fake', fakeDriver)
    const factory = getDriverFactory('fake')
    expect(factory).toBe(fakeDriver)
  })

  it('createDriver builds driver from config.driver', () => {
    registerDriver('fake', fakeDriver)
    const config = {
      name: 't', driver: 'fake', host: 'h', port: 5432, database: 'd',
      username: 'u', password: 'p', ssl: 'disable',
    } as unknown as ConnectionConfig
    const driver = createDriver(config)
    expect(driver.config.host).toBe('h')
  })

  it('throws on unknown driver', () => {
    expect(() => getDriverFactory('nope')).toThrow(/nope/)
  })
})
