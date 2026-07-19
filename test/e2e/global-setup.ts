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
  await sql.unsafe(`create table contacts (email text not null unique, label text not null)`).simple()
  await sql.unsafe(`insert into contacts values ('unique@example.com', 'unique row')`).simple()
  await sql.unsafe(`create table content_items (
    id serial primary key,
    document jsonb not null,
    tags text[] not null,
    notes text not null
  )`).simple()
  await sql.unsafe(`insert into content_items (document, tags, notes) values (
    '{"status":"draft","count":1}',
    array['alpha','beta'],
    repeat('This is a long text value. ', 8)
  )`).simple()
  await sql.unsafe(`create table binary_items (
    id serial primary key,
    payload bytea
  )`).simple()
  await sql.unsafe(`insert into binary_items (payload)
    values (decode('004c6f757065ff', 'hex'))`).simple()
  await sql.unsafe(`create table customers (
    tenant_id integer not null,
    id integer not null,
    name text not null,
    primary key (tenant_id, id)
  )`).simple()
  await sql.unsafe(`insert into customers values
    (7, 42, 'Acme customer'),
    (8, 42, 'Other tenant customer')`).simple()
  await sql.unsafe(`create table orders (
    id serial primary key,
    tenant_id integer not null,
    customer_id integer,
    label text not null,
    constraint orders_customer_fk foreign key (tenant_id, customer_id)
      references customers (tenant_id, id)
  )`).simple()
  await sql.unsafe(`insert into orders (tenant_id, customer_id, label) values
    (7, 42, 'linked order'),
    (7, null, 'unlinked order')`).simple()
  await sql.unsafe(`create function double_value(value integer)
    returns integer language sql immutable as $$ select value * 2 $$`).simple()
  await sql.end()

  process.env.E2E_PG_HOST = handle.config.host
  process.env.E2E_PG_PORT = String(handle.config.port)
  process.env.E2E_PG_DB = handle.config.database
  process.env.E2E_PG_USER = handle.config.username
  process.env.E2E_PG_PASS = handle.config.password

  return async () => { await handle.container.stop() }
}
