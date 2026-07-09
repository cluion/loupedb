// @vitest-environment nuxt
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import StreamResult from '../../app/components/StreamResult.vue'

class MockEventSource {
  static instances: MockEventSource[] = []
  url: string
  closed = false
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  close() { this.closed = true }
  emit(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }) }
}

const { streamUrlMock, cancelMock } = vi.hoisted(() => ({
  streamUrlMock: vi.fn((s: string, t: string, qid: string, b = 100) =>
    `/api/connections/c1/stream?schema=${s}&table=${t}&queryId=${qid}&batchSize=${b}`),
  cancelMock: vi.fn(async () => ({ ok: true as const, data: undefined })),
}))

mockNuxtImport('useQuery', () => () => ({
  streamUrl: streamUrlMock,
  cancel: cancelMock,
  execute: vi.fn(), browse: vi.fn(),
}))

const props = { connectionId: 'c1', schema: 'public', table: 'logs' }

beforeEach(() => {
  MockEventSource.instances = []
  streamUrlMock.mockClear()
  cancelMock.mockClear()
  vi.stubGlobal('EventSource', MockEventSource)
})

describe('StreamResult', () => {
  it('start opens an EventSource with queryId in the url and accumulates rows', async () => {
    const w = await mountSuspended(StreamResult, { props })
    await w.findAll('button').find(b => b.text() === '串流載入')!.trigger('click')

    expect(streamUrlMock).toHaveBeenCalled()
    const qid = streamUrlMock.mock.calls[0]![2]
    expect(qid).toBeTruthy()
    const es = MockEventSource.instances[0]!
    expect(es.url).toContain(`queryId=${qid}`)

    es.emit([{ id: 1 }, { id: 2 }])
    es.emit([{ id: 3 }])
    await w.vm.$nextTick()
    expect(w.text()).toContain('已載入 3 列')
  })

  it('stop closes the stream and cancels the same queryId server-side', async () => {
    const w = await mountSuspended(StreamResult, { props })
    await w.findAll('button').find(b => b.text() === '串流載入')!.trigger('click')
    const qid = streamUrlMock.mock.calls[0]![2]

    await w.findAll('button').find(b => b.text() === '取消')!.trigger('click')
    expect(MockEventSource.instances[0]!.closed).toBe(true)
    expect(cancelMock).toHaveBeenCalledWith(qid)
  })

  it('error events surface as alert and close the stream', async () => {
    const w = await mountSuspended(StreamResult, { props })
    await w.findAll('button').find(b => b.text() === '串流載入')!.trigger('click')
    const es = MockEventSource.instances[0]!
    es.emit({ error: 'boom' })
    await w.vm.$nextTick()
    expect(w.find('[role="alert"]').text()).toContain('boom')
    expect(es.closed).toBe(true)
  })

  it('restart resets rows and uses a fresh queryId', async () => {
    const w = await mountSuspended(StreamResult, { props })
    const startBtn = () => w.findAll('button').find(b => b.text() === '串流載入')!
    await startBtn().trigger('click')
    MockEventSource.instances[0]!.emit([{ id: 1 }])
    await w.vm.$nextTick()
    await startBtn().trigger('click')
    await w.vm.$nextTick()
    expect(w.text()).toContain('已載入 0 列')
    const [first, second] = [streamUrlMock.mock.calls[0]![2], streamUrlMock.mock.calls[1]![2]]
    expect(first).not.toBe(second)
    expect(MockEventSource.instances[0]!.closed).toBe(true) // old stream closed
  })
})
