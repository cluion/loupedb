export default defineNuxtConfig({
  compatibilityDate: '2026-06-21',
  devtools: { enabled: true },
  ssr: true,
  css: ['~/assets/css/main.css'],
  typescript: { strict: true, typeCheck: false },
  imports: {
    dirs: ['stores'], // auto-import useSession etc from app/stores
  },
  nitro: {
    preset: 'node-server',
    experimental: { tasks: false },
  },
})
