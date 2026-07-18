// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { MAX_BINARY_UPLOAD_BYTES, isBinaryCellSummary, isBinaryCellUpload } from '../../shared/binaryCell'
import { binaryCellLabel, fileToBinaryUpload, formatBinaryBytes } from '../../app/utils/binaryCell'

describe('binary cell values', () => {
  it('validates summaries and bounded base64 uploads', () => {
    expect(isBinaryCellSummary({
      $loupedb: 'binary', byteLength: 3, checksum: '900150983cd24fb0d6963f7d28e17f72',
    })).toBe(true)
    expect(isBinaryCellSummary({
      $loupedb: 'binary', byteLength: -1, checksum: '900150983cd24fb0d6963f7d28e17f72',
    })).toBe(false)
    expect(isBinaryCellUpload({
      $loupedb: 'binary-upload', base64: 'AQID', byteLength: 3,
      fileName: 'value.bin', mediaType: 'application/octet-stream',
    })).toBe(true)
    expect(isBinaryCellUpload({
      $loupedb: 'binary-upload', base64: 'AQID', byteLength: 4,
      fileName: 'value.bin', mediaType: 'application/octet-stream',
    })).toBe(false)
    expect(isBinaryCellUpload({
      $loupedb: 'binary-upload', base64: 'AAAA', byteLength: 1,
      fileName: 'value.bin', mediaType: 'application/octet-stream',
    })).toBe(false)
  })

  it('formats byte sizes and summary labels', () => {
    expect(formatBinaryBytes(7)).toBe('7 B')
    expect(formatBinaryBytes(1536)).toBe('1.5 KB')
    expect(formatBinaryBytes(2 * 1024 * 1024)).toBe('2.0 MB')
    expect(binaryCellLabel({
      $loupedb: 'binary', byteLength: 1536, checksum: '900150983cd24fb0d6963f7d28e17f72',
    })).toBe('BINARY · 1.5 KB')
  })

  it('reads a browser File into a validated upload value', async () => {
    const upload = await fileToBinaryUpload(new File(
      [Uint8Array.from([1, 2, 3])], 'three.bin', { type: 'application/octet-stream' },
    ))
    expect(upload).toEqual({
      $loupedb: 'binary-upload', base64: 'AQID', byteLength: 3,
      fileName: 'three.bin', mediaType: 'application/octet-stream',
    })
  })

  it('rejects oversized files before reading them', async () => {
    await expect(fileToBinaryUpload({ size: MAX_BINARY_UPLOAD_BYTES + 1 } as File))
      .rejects.toThrow('8.0 MB')
  })
})
