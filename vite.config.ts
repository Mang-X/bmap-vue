/**
 * Vite+ 配置（方案 §5.5）
 *
 * - pack: vp pack 的库构建配置（基于 tsdown）
 *   - 入口:index/components/composables/plugins/resolver/core
 *   - dts:vue(true) 生成组件声明
 *   - plugins: VueRolldown(unplugin-vue/rolldown) 处理 .vue
 */
import { resolve } from 'node:path'
import VueRolldown from 'unplugin-vue/rolldown'
import { defineConfig } from 'vite-plus'

const packageRoot = resolve(import.meta.dirname, 'packages/bmap-vue')

export default defineConfig({
  pack: {
    entry: {
      index: resolve(packageRoot, 'src/index.ts'),
      components: resolve(packageRoot, 'src/components/index.ts'),
      composables: resolve(packageRoot, 'src/composables/index.ts'),
      plugins: resolve(packageRoot, 'src/plugins/index.ts'),
      resolver: resolve(packageRoot, 'src/resolver/index.ts'),
      core: resolve(packageRoot, 'src/core/index.ts'),
    },
    root: resolve(packageRoot, 'src'),
    outDir: resolve(packageRoot, 'dist'),
    platform: 'neutral',
    target: 'es2020',
    format: ['esm'],
    sourcemap: true,
    clean: true,
    dts: {
      vue: true,
    },
    plugins: [
      VueRolldown({
        isProduction: true,
      }),
    ],
  },
})
