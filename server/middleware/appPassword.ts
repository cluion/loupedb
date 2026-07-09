import { getCookie, getHeader, createError } from 'h3'

// optional app-wide password gate (spec 4.5.4) - enabled only when the env var is set
// cookie is accepted alongside the header because EventSource cannot send custom headers
export default defineEventHandler((event) => {
  const required = process.env.LOUPEDB_APP_PASSWORD
  if (!required) return
  if (!event.path.startsWith('/api/')) return
  const provided = getCookie(event, 'loupedb_app_pw') ?? getHeader(event, 'x-loupedb-password')
  if (provided !== required) {
    throw createError({ statusCode: 401, statusMessage: 'app password required' })
  }
})
