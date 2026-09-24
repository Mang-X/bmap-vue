/**
 * CDN/global 构建
 *
 * 独立单入口 iife 构建:
 * - dist/index.global.js(window.BMapVue)
 * - Vue 完全 external,消费 window.Vue
 */
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname)
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string }

export default defineConfig({
  plugins: [vue()],
  define: {
    __DEV__: 'false',
    __VERSION__: JSON.stringify(packageJson.version),
    // 这一档是 `<script>` 直引的生产产物，浏览器里没有 `process`：必须在这里把
    // `core/logger.ts`（`devWarn`）的环境判定折叠掉，否则会留下裸 `process` 引用。
    // **只在这一档折叠**：ESM 档（vite.config.build.ts）必须原样保留这个标记，
    // 由消费方的打包器决定开发 / 生产（否则 npm 消费方永远看不到 dev 告警，见 #27 评审第二轮）。
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    lib: {
      entry: resolve(root, 'src/index.ts'),
      name: 'BMapVue',
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
