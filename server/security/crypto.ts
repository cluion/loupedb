import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

function getKey(): Buffer {
  const hex = process.env.LOUPEDB_MASTER_KEY
  if (!hex) throw new Error('LOUPEDB_MASTER_KEY not set')
  const key = Buffer.from(hex, 'hex')
  if (key.length !== 32) throw new Error('LOUPEDB_MASTER_KEY must be 32 bytes (64 hex chars)')
  return key
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12) // 12 bytes recommended for GCM
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, tag, enc].map((b) => b.toString('base64')).join(':')
}

export function decrypt(payload: string): string {
  const [ivB64, tagB64, encB64] = payload.split(':')
  if (!ivB64 || !tagB64 || !encB64) throw new Error('invalid ciphertext')
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(encB64, 'base64')), decipher.final()]).toString('utf8')
}
