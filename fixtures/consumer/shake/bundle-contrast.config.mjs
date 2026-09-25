/**
 * 包体对照的打包配置（issue #140 · 指标 8「bundle/tarball 入口大小」）
 *
 * 与 `vite.config.mjs`（#43 的 tree-shaking 判据）**刻意不同**：
 *
 * | | `vite.config.mjs` | 本文件 |
 * | --- | --- | --- |
 * | external | `vue` + `@vueuse/core` + `@baidumap/jsapi-loader` | **只** `vue` |
 * | minify | `false`（要看清打进来了哪些符号） | `true`（要量真实发包字节） |
 * | 目的 | 「有没有被摇掉」这个**是非**判据 | 「有多大」这个**数值**读数 |
 * | alias | 无 | 本库侧指向 `packages/bmap-vue/dist/index.mjs`（见 `resolve.alias` 的注释） |
 *
 * ## 为什么 `@vueuse/core` 与 `@baidumap/jsapi-loader` 这次**不** external
 *
 * 外部化会把本库真正的**消费方成本**藏起来：`@vueuse/core` 是本库的运行时依赖、
 * `@baidumap/jsapi-loader` 是两库都在用的官方 loader。把它们当「反正都会有的东西」剔掉，
 * 量出来的差值就不是消费方要付的差值。所以这里只 external **`vue`**——它是
 * **peer 依赖**，由应用自己提供，量它只会把同一个 vue 在两边各算一次、把差值稀释掉。
 *
 * ## 刻意用普通对象而不是 `defineConfig`
 *
 * 与 `vite.config.mjs` 同一理由：fixture 自己的 `node_modules` 里没有 vite
 * （它由仓库根的 vite 执行），import 不到。
 */
const entry = process.env.BUNDLE_ENTRY
const outDir = process.env.BUNDLE_OUT
/** 可选：`name=path` 形式的 alias（分号分隔），只给本库侧用。 */
const aliasSpec = process.env.BUNDLE_ALIAS ?? ''

if (!entry || !outDir) {
  throw new Error('[bundle-contrast] BUNDLE_ENTRY / BUNDLE_OUT 必须由调用方显式给出')
}

const alias = Object.fromEntries(
  aliasSpec
    .split(';')
    .filter(Boolean)
    .map((pair) => {
      const at = pair.indexOf('=')
      if (at <= 0) throw new Error(`[bundle-contrast] BUNDLE_ALIAS 段格式应为 name=path：${pair}`)
      return [pair.slice(0, at), pair.slice(at + 1)]
    }),
)

export default {
  logLevel: 'silent',
  // 本库不在 fixture 的 node_modules 里（它不是被安装的依赖，而是待测对象），
  // 因此把 specifier 指到**真实 dist 入口**——与 `package.json` 的 `exports["."].import`
  // 指向同一个文件。官方侧不给 alias，走 node_modules 里的真实依赖解析。
  resolve: { alias },
  build: {
    outDir,
    emptyOutDir: true,
    // 量真实发包字节。上游源码的注释与标识符不是消费方要付的代价。
    // 刻意不写死 `'esbuild'`：本仓库用 vite 8（rolldown 内核），默认压缩器随 vite 走，
    // 写死一个未安装的压缩器会让这条读数**跑不出来**——量不到就没有基线。
    minify: true,
    target: 'es2020',
    rollupOptions: {
      input: entry,
      // 只留 vue：peer 依赖由应用提供；其余（@vueuse/core / jsapi-loader）都算进产物。
      external: ['vue'],
      output: {
        entryFileNames: 'entry.mjs',
        chunkFileNames: 'chunks/[name].mjs',
        assetFileNames: '[name][extname]',
      },
    },
  },
}
