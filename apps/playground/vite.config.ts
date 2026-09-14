import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      // playground 直接引用 v3 源码(clean checkout 免预构建)
      'baidu-map-gl-vue': resolve(import.meta.dirname, '../../packages/baidu-map-gl-vue/src/index.ts'),
      // mock provider 使用 fake SDK(test-utils 是私有包,这里别名到源码)
      '@test-utils': resolve(import.meta.dirname, '../../packages/test-utils/index.ts'),
    },
  },
})
