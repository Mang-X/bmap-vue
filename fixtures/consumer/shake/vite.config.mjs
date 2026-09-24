/**
 * tree-shaking 对照的最小打包配置（issue #43）
 *
 * 刻意用**普通对象**而不是 `defineConfig`：本文件在消费方 fixture 里被 vite 加载，而 fixture 的
 * `node_modules` 里没有 vite（它由仓库根的 vite 执行）——`import { defineConfig } from 'vite'`
 * 在这种位置会解析失败。vite 接受纯对象配置。
 *
 * `SHAKE_ENTRY` / `SHAKE_OUT` 由 `scripts/verify-package.mts` 逐个对照入口传入，
 * 于是同一份配置对「只用 ./advanced」和「只用根入口」各打一次，产物互不干扰。
 */
const entry = process.env.SHAKE_ENTRY
const outDir = process.env.SHAKE_OUT

if (!entry || !outDir) {
  throw new Error('[shake] SHAKE_ENTRY / SHAKE_OUT 必须由调用方显式给出')
}

export default {
  logLevel: 'silent',
  build: {
    outDir,
    emptyOutDir: true,
    minify: false,
    // 只关心「我们自己的模块有没有被打进来」，第三方运行时依赖保持 external
    rollupOptions: {
      input: entry,
      external: ['vue', '@vueuse/core', '@baidumap/jsapi-loader'],
      output: { entryFileNames: 'entry.mjs', chunkFileNames: 'chunks/[name].mjs' },
    },
  },
}
