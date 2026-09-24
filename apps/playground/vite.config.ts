import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'
import { versionDefine } from '../../scripts/vite-version-define.mjs'

export default defineConfig({
  plugins: [vue()],
  define: versionDefine,
  resolve: {
    alias: {
      // playground 直接引用库源码(clean checkout 免预构建)
      'bmap-vue': resolve(import.meta.dirname, '../../packages/bmap-vue/src/index.ts'),
      // mock provider 使用 fake SDK(test-utils 是私有包,这里别名到源码)
      '@test-utils': resolve(import.meta.dirname, '../../packages/test-utils/index.ts'),
    },
  },
})
