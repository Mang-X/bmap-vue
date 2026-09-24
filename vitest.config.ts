import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { versionDefine } from './scripts/vite-version-define.mjs'

export default defineConfig({
  plugins: [vue()],
  define: {
    ...versionDefine,
    __DEV__: 'true',
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
