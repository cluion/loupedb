import type { SslMode } from '#shared/types'

function isPrivateIp(ip: string): boolean {
  return /^(10\.|192\.168\.|169\.254\.|127\.)/.test(ip)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
    || ip === '::1'
}

// smart default: local / private / container hosts skip ssl, public hosts require it
// the UI always offers an explicit override (spec 4.5.2)
export function resolveSslMode(host: string): SslMode {
  const h = host.toLowerCase()
  if (h === 'localhost') return 'disable'
  if (isPrivateIp(h)) return 'disable'
  if (h.endsWith('.local')) return 'disable' // mDNS / container domains
  if (!h.includes('.')) return 'disable' // dotless = container or single-label host
  return 'require' // public domain or public IP
}
