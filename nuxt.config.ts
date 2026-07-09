export default defineNuxtConfig({
  compatibilityDate: '2026-06-21',
  devtools: { enabled: true },
  ssr: true,
  typescript: { strict: true, typeCheck: false },
  imports: {
    dirs: ['stores'], // auto-import useSession etc from app/stores
  },
  nitro: {
    experimental: { tasks: false },
  },
})
