import postgres from 'postgres'
import { startPgContainer } from '../helpers/pg-container'

// starts one PG container for the whole e2e run, seeds a table and exposes
// the connection details to tests via E2E_PG_* env vars
export default async function globalSetup(): Promise<() => Promise<void>> {
  const handle = await startPgContainer()
  const sql = postgres({
    host: handle.config.host, port: handle.config.port, database: handle.config.database,
    username: handle.config.username, password: handle.config.password,
  })
  await sql.unsafe(`create table items (id serial primary key, label text not null)`).simple()
  await sql.unsafe(`insert into items (label) values ('x'), ('y')`).simple()
  await sql.end()

  process.env.E2E_PG_HOST = handle.config.host
  process.env.E2E_PG_PORT = String(handle.config.port)
  process.env.E2E_PG_DB = handle.config.database
  process.env.E2E_PG_USER = handle.config.username
  process.env.E2E_PG_PASS = handle.config.password

  return async () => { await handle.container.stop() }
}
