/**
 * v3 包 ESM 构建(Vite library mode + vite-plugin-dts)
 *
 * 主要产出:
 * - dist/*.mjs(ESM,external vue,单入口独立 chunk)
 * - dist/*.d.ts(vite-plugin-dts,基于 vue-tsc 2,rollupTypes 打包消除 .vue 引用)
 *
 * 声明与产物结构对齐(node16 ESM 可解析):
 * - dist/index.mjs      ↔ dist/index.d.ts
 * - dist/components.mjs ↔ dist/components.d.ts
 * - 子 chunk 的声明随源码结构输出(消费端用 resolvers 指向聚合入口)
 */
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import dts from 'vite-plugin-dts'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { versionDefine } from '../../scripts/vite-version-define.mjs'
import { resolve, join } from 'node:path'

const root = resolve(import.meta.dirname)

/**
 * 从类型边界文件源码中提取会被打包内联的 `declare global` 块。
 *
 * 上游 unplugin-dts 用 `s.slice(node.pos, node.end + 1)` 收集该块，只会额外带上
 * `}` 后的一个字符（LF 文件是 `\n`，CRLF 文件是 `\r`），所以这里必须 `trimEnd()`
 * 去掉末尾换行，才能同时匹配 LF 与 CRLF 源文件。
 *
 * 采用花括号配对而非 `lastIndexOf`，以支持边界目录下存在多个 augmentation 文件
 * 或单文件内多个 `declare global` 块（见 src/driver/jsapi-v4/augmentations/）。
 */
export function extractDeclareGlobalBlocks(source: string): string[] {
  const blocks: string[] = []
  const marker = 'declare global'
  let from = 0
  for (;;) {
    const start = source.indexOf(marker, from)
    if (start === -1) break
    const braceStart = source.indexOf('{', start)
    if (braceStart === -1) break
    let depth = 0
    let end = -1
    for (let i = braceStart; i < source.length; i++) {
      const ch = source[i]
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    if (end === -1) break
    blocks.push(source.slice(start, end + 1).trimEnd())
    from = end + 1
  }
  return blocks
}

/** 从声明产物中剔除 augmentation 块；返回 `undefined` 表示无需修改。 */
export function stripDeclareGlobalBlocks(
  content: string,
  blocks: readonly string[],
): string | undefined {
  let output = content
  let changed = false
  for (const block of blocks) {
    if (block && output.includes(block)) {
      output = output.replace(block, '')
      changed = true
    }
  }
  return changed ? `${output.trimEnd()}\n` : undefined
}

// 类型边界补丁只服务类型检查与 TS 声明 emit，必须保留在声明构建的 Program 中；
// 但声明打包器会把 Program 内的全局 augmentation 内联进每个公共 dist/*.d.ts，
// 因此在写入阶段剔除这些 augmentation 块，避免向消费者泄漏 BMap.*。
// 治理规则与元数据模板见 src/driver/jsapi-v4/augmentations/README.md。
const jsapiV4BoundaryDir = resolve(root, 'src/driver/jsapi-v4')
const jsapiV4AugmentationsDir = join(jsapiV4BoundaryDir, 'augmentations')

const jsapiV4BoundaryFiles = [
  join(jsapiV4BoundaryDir, 'types-reference.d.ts'),
  ...(existsSync(jsapiV4AugmentationsDir)
    ? readdirSync(jsapiV4AugmentationsDir)
        .filter((name) => name.endsWith('.d.ts'))
        .map((name) => join(jsapiV4AugmentationsDir, name))
    : []),
]

const jsapiV4AugmentationBlocks = jsapiV4BoundaryFiles.flatMap((file) =>
  extractDeclareGlobalBlocks(readFileSync(file, 'utf8')),
)

/** 类型边界文件一律不写入发布产物（由 check-public-dts 兜底断言）。 */
function isJsapiV4BoundaryFile(filePath: string): boolean {
  return filePath.replace(/\\/g, '/').includes('/driver/jsapi-v4/')
}

export default defineConfig({
  plugins: [
    vue(),
    dts({
      // vue-tsc 引擎(2.x,专用 devDep)
      tsconfigPath: resolve(root, 'tsconfig.build.json'),
      // 声明输出到 dist 顶层(与 *.mjs 对齐)
      outDir: resolve(root, 'dist'),
      entryRoot: resolve(root, 'src'),
      // bundleTypes:打包声明为单文件,消除跨文件相对引用(node16 可解析)
      bundleTypes: {
        bundledPackages: ['mitt'],
      },
      // 不生成多余 .test.d.ts。类型边界 augmentation 保留在编译输入中，
      // 仅在写入阶段移除：跳过其独立声明，并从被打包内联的公共声明里剔除。
      exclude: ['src/**/*.test.ts', 'src/**/__tests__/**'],
      beforeWriteFile: (filePath, content) => {
        if (isJsapiV4BoundaryFile(filePath)) return false
        const stripped = stripDeclareGlobalBlocks(content, jsapiV4AugmentationBlocks)
        if (stripped !== undefined) return { content: stripped }
      },
      // 保留声明与源码结构对应,便于调试
      copyDtsFiles: true,
      insertTypesEntry: true,
      cleanVueFileName: true,
      afterBuild: () => {
        // no-op
      },
    }),
  ],
  define: {
    ...versionDefine,
    __DEV__: 'false',
    // ⚠️ **不要**在这里 define `process.env.NODE_ENV`（global 档可以，见 vite.config.global.ts）。
    // 这一档是发布给 npm 消费方的 ESM 产物：`core/logger.ts` 的 `devWarn` 靠这个标记让**消费方的**
    // 打包器 / 运行时决定开发还是生产。在 publish build 阶段定死成 `production`，消费方即使在自己
    // 的 dev server 里 import 也永远看不到告警（#27 评审第二轮 P2 就是这个坑）。
    // `scripts/verify-package.mts` 有断言锁住这条不变量。
  },
  build: {
    lib: {
      entry: {
        index: resolve(root, 'src/index.ts'),
        components: resolve(root, 'src/components/index.ts'),
        composables: resolve(root, 'src/composables/index.ts'),
        plugins: resolve(root, 'src/plugins/index.ts'),
        resolver: resolve(root, 'src/resolver/index.ts'),
        core: resolve(root, 'src/core/index.ts'),
        advanced: resolve(root, 'src/advanced.ts'),
        'ui-kit': resolve(root, 'src/integrations/ui-kit/index.ts'),
      },
      formats: ['es'],
    },
    outDir: resolve(root, 'dist'),
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      // `@baidumap/jsapi-ui-kit` 必须 external（issue #73 / ADR 2026-09-13 决策 3、4）：
      // 它是 **optional peer**。若把它打进 dist，所有消费者都会被塞进一份 UI Kit 运行时
      // （含 js-md5 与 DOM 求值期副作用），「不装也能用根入口」立刻失效；保持 external 后
      // 由 `./ui-kit` 的 `import('@baidumap/jsapi-ui-kit')` 在运行时按需解析，
      // 消费方的打包器才能把它当作可选依赖处理。
      //
      // `@baidumap/jsapi-loader` 是本包的**运行时依赖**（精确锁定 1.0.0），同样保持 external：
      // 它是模块级单例（script 单例 + 状态机），内联会让「同一页面出现两份加载状态机」
      // ——这正是 ADR 2026-09-13 要消除的情况。
      // `@vueuse/core` 同理是**运行时依赖**（精确锁定 14.4.0，见 #29）：它采集环境信息
      // （ResizeObserver / IntersectionObserver / document 可见性 / 减少动画偏好）。
      // 它没有单例语义，但作为声明过的依赖仍应 external —— 内联会让同一份实现出现在
      // 消费方与产物里两处，并让「依赖声明」与「产物内容」不一致。
      // CDN/IIFE 产物无法 external（两个官方包都没有 IIFE/global 产物），那份构建仍内联，见
      // `vite.config.global.ts`。
      external: ['vue', '@baidumap/jsapi-ui-kit', '@baidumap/jsapi-loader', '@vueuse/core'],
      output: {
        entryFileNames: '[name].mjs',
        chunkFileNames: 'chunks/[name]-[hash].mjs',
      },
    },
  },
})
