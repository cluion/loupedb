import { createEventStream, getQuery } from 'h3'
import { useConnectionManager } from '../../../utils/connectionManager'
import { toDatabaseError } from '../../../utils/api'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id') as string
  const q = getQuery(event)
  const schema = q.schema as string
  const table = q.table as string
  // queryId registers the stream in the driver's activeQueries so cancel works
  const queryId = (q.queryId as string) || undefined
  const batchSize = Number(q.batchSize ?? 100)

  const stream = createEventStream(event)
  const session = useConnectionManager().get(id)

  void (async () => {
    if (!session) {
      await stream.push(JSON.stringify({ error: `connection ${id} not found` }))
      await stream.close()
      return
    }
    try {
      for await (const batch of session.driver.stream(schema, table, { limit: 100_000, offset: 0 }, batchSize, queryId)) {
        await stream.push(JSON.stringify(batch))
      }
    } catch (err) {
      await stream.push(JSON.stringify({ error: toDatabaseError(err).message }))
    } finally {
      await stream.close()
    }
  })()

  return stream.send()
})
