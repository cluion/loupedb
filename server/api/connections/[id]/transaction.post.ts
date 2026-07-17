import { readBody } from 'h3'
import { withConnection } from '../../../utils/api'

type TransactionAction = 'begin' | 'commit' | 'rollback'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') as string
  const body = await readBody<{ action?: TransactionAction }>(event)
  return withConnection(event, id, async (driver) => {
    if (body.action === 'begin') return driver.beginTransaction()
    if (body.action === 'commit') return driver.commitTransaction()
    if (body.action === 'rollback') return driver.rollbackTransaction()
    throw Object.assign(new Error('invalid transaction action'), { code: 'TX_ACTION', severity: 'ERROR' })
  })
})
