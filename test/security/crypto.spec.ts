import { describe, it, expect, beforeEach } from 'vitest'
import { encrypt, decrypt } from '../../server/security/crypto'

const KEY = 'a'.repeat(64) // 32-byte hex

describe('crypto', () => {
  beforeEach(() => { process.env.LOUPEDB_MASTER_KEY = KEY })

  it('decrypt restores encrypted plaintext', () => {
    const ct = encrypt('s3cret')
    expect(decrypt(ct)).toBe('s3cret')
  })
  it('same plaintext yields different ciphertext (random IV)', () => {
    expect(encrypt('s3cret')).not.toBe(encrypt('s3cret'))
  })
  it('ciphertext differs from plaintext', () => {
    expect(encrypt('s3cret')).not.toBe('s3cret')
  })
  it('throws when master key is missing', () => {
    delete process.env.LOUPEDB_MASTER_KEY
    expect(() => encrypt('x')).toThrow(/MASTER_KEY/)
  })
  it('throws when master key has wrong length', () => {
    process.env.LOUPEDB_MASTER_KEY = 'abcd'
    expect(() => encrypt('x')).toThrow(/32 bytes/)
  })
  it('throws on tampered ciphertext (GCM auth)', () => {
    const ct = encrypt('s3cret')
    const parts = ct.split(':')
    const tampered = [parts[0], parts[1], Buffer.from('xxxxxx').toString('base64')].join(':')
    expect(() => decrypt(tampered)).toThrow()
  })
})
