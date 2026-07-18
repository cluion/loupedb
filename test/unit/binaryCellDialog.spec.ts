// @vitest-environment nuxt
import { describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import BinaryCellDialog from '../../app/components/BinaryCellDialog.vue'

const column = {
  name: 'payload', nativeType: 'bytea', type: 'binary' as const, nullable: true,
}
const summary = {
  $loupedb: 'binary' as const,
  byteLength: 3,
  checksum: '900150983cd24fb0d6963f7d28e17f72',
}

describe('BinaryCellDialog', () => {
  it('shows a safe summary and emits download without exposing bytes', async () => {
    const w = await mountSuspended(BinaryCellDialog, {
      props: {
        column, rowNumber: 2, value: summary, nullable: true, editable: false,
        downloadable: true, downloading: false, downloadError: null,
      },
    })
    expect(w.get('[data-testid="binary-summary"]').text()).toContain('BINARY · 3 B')
    expect(w.text()).toContain('900150983cd24fb0d6963f7d28e17f72')
    expect(w.find('input[type="file"]').exists()).toBe(false)
    await w.findAll('button').find(button => button.text() === '下載原始內容')!.trigger('click')
    expect(w.emitted('download')).toHaveLength(1)
  })

  it('reads a selected file and emits a staged upload preview', async () => {
    const w = await mountSuspended(BinaryCellDialog, {
      props: {
        column, rowNumber: 1, value: summary, nullable: true, editable: true,
        downloadable: true, downloading: false, downloadError: null,
      },
    })
    const input = w.get('input[type="file"]')
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [new File([Uint8Array.from([1, 2, 3])], 'three.bin', { type: 'application/octet-stream' })],
    })
    await input.trigger('change')
    await vi.waitFor(() => expect(w.get('[data-testid="selected-binary-file"]').text()).toContain('three.bin'))
    await w.get('form').trigger('submit')
    expect(w.emitted('preview')?.[0]).toEqual([{
      $loupedb: 'binary-upload', base64: 'AQID', byteLength: 3,
      fileName: 'three.bin', mediaType: 'application/octet-stream',
    }])
  })
})
