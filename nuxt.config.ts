export default defineNuxtConfig({
  compatibilityDate: '2026-06-21',
  devtools: { enabled: true },
  ssr: true,
  typescript: { strict: true, typeCheck: false },
  nitro: {
    experimental: { tasks: false },
  },
})
