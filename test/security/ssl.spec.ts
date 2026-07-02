import { describe, it, expect } from 'vitest'
import { resolveSslMode } from '../../server/security/ssl'

describe('resolveSslMode', () => {
  it.each([
    ['localhost', 'disable'],
    ['LOCALHOST', 'disable'],
    ['127.0.0.1', 'disable'],
    ['::1', 'disable'],
    ['postgres', 'disable'], // container name
    ['db.local', 'disable'],
    ['10.0.0.5', 'disable'],
    ['192.168.1.10', 'disable'],
    ['172.16.0.1', 'disable'],
    ['172.31.255.1', 'disable'],
    ['169.254.0.1', 'disable'],
    ['db.example.com', 'require'],
    ['8.8.8.8', 'require'],
    ['203.0.113.5', 'require'],
    ['172.32.0.1', 'require'], // outside 172.16-31 private range
  ])('%s -> %s', (host, expected) => {
    expect(resolveSslMode(host)).toBe(expected)
  })
})
