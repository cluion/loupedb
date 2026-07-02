import { PostgreSqlContainer } from '@testcontainers/postgresql'

export interface PgTestHandle {
  config: { host: string; port: number; database: string; username: string; password: string }
  container: { stop: () => Promise<void> }
}

export async function startPgContainer(image = 'postgres:16-alpine'): Promise<PgTestHandle> {
  const container = await new PostgreSqlContainer(image)
    .withDatabase('loupedb_test')
    .withUsername('root')
    .withPassword('testpass')
    .start()
  return {
    config: {
      host: container.getHost(),
      port: container.getPort(),
      database: container.getDatabase(),
      username: container.getUsername(),
      password: container.getPassword(),
    },
    container,
  }
}
