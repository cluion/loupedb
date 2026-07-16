// @vitest-environment nuxt
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ResultExport from '../../app/components/ResultExport.vue'
import { toCsv, toMarkdown } from '../../app/utils/resultExport'
import type { QueryResult } from '#shared/types'

const sample: QueryResult = {
  columns: [{ name: 'id', nativeType: 'int4', type: 'integer', nullable: false }],
  rows: [{ id: 1 }, { id: 2 }],
  executionMs: 1,
}

const writeText = vi.fn(async () => {})
const createObjectURL = vi.fn(() => 'blob:stub')
const revokeObjectURL = vi.fn()

beforeEach(() => {
  writeText.mockClear()
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))
})

describe('ResultExport', () => {
  it('offers all four formats', async () => {
    const w = await mountSuspended(ResultExport, { props: { result: sample } })
    const labels = w.findAll('option').map((o) => o.text())
    expect(labels).toEqual(['CSV', 'TSV', 'JSON', 'Markdown'])
  })

  it('copies the current format to the clipboard and flashes a confirmation', async () => {
    const w = await mountSuspended(ResultExport, { props: { result: sample } })
    await w.get('[aria-label="複製結果"]').trigger('click')
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(toCsv(sample)))
    expect(w.text()).toContain('已複製')
  })

  it('copies markdown after switching the format', async () => {
    const w = await mountSuspended(ResultExport, { props: { result: sample } })
    await w.get('[aria-label="匯出格式"]').setValue('markdown')
    await w.get('[aria-label="複製結果"]').trigger('click')
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(toMarkdown(sample)))
  })

  it('downloads via a blob object url', async () => {
    const w = await mountSuspended(ResultExport, { props: { result: sample } })
    await w.get('[aria-label="下載結果"]').trigger('click')
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = createObjectURL.mock.calls[0]![0] as unknown as Blob
    expect(blob.type).toContain('text/csv')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:stub')
  })
})
