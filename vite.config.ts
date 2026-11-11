import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    // Three offline datasets ship statically: the 100 passages (~500 KiB),
    // the ECDICT-derived word list (~1.3 MiB) and 3,605 Chinese reference
    // readings (~0.6 MiB). Dynamic import() from file:// is blocked by
    // Chromium's module CORS rules in the packaged app; nothing is fetched.
    chunkSizeWarningLimit: 3000,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: true,
    // Single-process execution avoids concurrent writes to Vite's SSR dep
    // cache, which is blocked by the desktop sandbox on Windows.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
})
