/**
 * v3 包 CDN/global 构建(方案 §6.3 / M7-08)
 *
 * 独立单入口 iife 构建:
 * - dist/index.global.js(window.Vue3BaiduMapGl)
 * - Vue 完全 external,消费 window.Vue
 */
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname)

export default defineConfig({
  plugins: [vue()],
  define: {
    __DEV__: 'false',
    __VERSION__: JSON.stringify('3.0.0-beta.0'),
  },
  build: {
    lib: {
      entry: resolve(root, 'src/index.ts'),
      name: 'Vue3BaiduMapGl',
      formats: ['iife'],
      fileName: () => 'index.global.js',
    },
    outDir: resolve(root, 'dist'),
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      // 只 external `vue`：官方 `@baidumap/jsapi-loader` 没有 IIFE/global 产物，无法映射成
      // 一个全局变量，因此 CDN 产物把它**内联**进来（ESM 产物则保持 external，见
      // `vite.config.build.ts`）。CDN 场景下页面里只有本库一份副本，不存在两套加载状态机。
      external: ['vue'],
      output: {
        globals: {
          vue: 'Vue',
        },
      },
    },
  },
})
