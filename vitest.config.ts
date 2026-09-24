import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const packageJson = JSON.parse(readFileSync(resolve(import.meta.dirname, 'packages/bmap-vue/package.json'), 'utf8')) as { version: string }

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@v2': resolve(import.meta.dirname, 'packages'),
    },
  },
  define: {
    __DEV__: 'true',
     __VERSION__: JSON.stringify(packageJson.version),
  },
  test: {
    include: ['packages/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
})
