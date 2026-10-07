/**
 * 样式消费的最小 Vite **生产**构建配置（issue #158 工作包 D）
 *
 * 刻意用普通对象而不是 `defineConfig`：本文件在消费 fixture 里被 vite 加载，而 fixture 的
 * `node_modules` 里没有 vite（由仓库根的 vite 执行）——`import { defineConfig } from 'vite'`
 * 会解析失败。`STYLES_ENTRY` / `STYLES_OUT` 由 `scripts/consumer-styles.mts` 逐入口传入。
 */
const entry = process.env.STYLES_ENTRY
const outDir = process.env.STYLES_OUT

if (!entry || !outDir) {
  throw new Error('[styles] STYLES_ENTRY / STYLES_OUT 必须由调用方显式给出')
}

export default {
  logLevel: 'silent',
  build: {
    outDir,
    emptyOutDir: true,
    minify: false,
    // 样式合成一个文件，方便断言「这一份 CSS 里到底有没有 Autocomplete 的规则」
    cssCodeSplit: false,
    rollupOptions: {
      input: entry,
      // 第三方运行时保持 external：这里只关心本库自己的产物与样式
      external: ['vue', '@vueuse/core', '@baidumap/jsapi-loader'],
      output: {
        entryFileNames: 'entry.mjs',
        chunkFileNames: 'chunks/[name].mjs',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
}
