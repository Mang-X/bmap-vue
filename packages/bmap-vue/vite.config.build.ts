/**
 * 包 ESM 构建(Vite library mode + vite-plugin-dts)
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
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { versionDefine } from '../../scripts/vite-version-define.mjs'
import { resolve, join, dirname, relative, sep } from 'node:path'

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

// ── 子入口的「引用自己」必须改写（issue #160） ───────────────────────────────────
//
// `unplugin-dts` 对「从入口 barrel 转出、且自身又不在本子目录内声明」的符号，会在
// per-module 声明里写成 `import('..').X`。从 `dist/composables/useMap.d.ts` 看，
// `..` 指向的正是 **`dist/composables.d.ts` 本身**——也就是本次 rollup 的入口文件。
// 于是同一个 `MapContext` / `MapHandle` / `BMapClient` / `ServiceResult` 同时以
// 「rollup 根」和「被引用的模块」两种身份进入 API Extractor，触发它的
// `_makeUniqueNames()` 判重，把整张类型图**复制一遍**并加 `_2` 后缀：
// `dist/composables.d.ts` 里 114 个类型各出现两次（逐字节相同），`../index.d.ts`
// 里连导出的别名都变成 `export { MapType_2 as MapType }`。
//
// 后果不只是产物臃肿：`check:api` 的 `ae-forgotten-export` 因此把 `MapHandle_2` /
// `BMapClient_2` / `MapContext_2` / `BMapServiceStatus_2` / `ServiceErrorInfo_2` /
// `MapStatus_2` / `DrivingPolicy_2` / `TransitPolicy_2` / `IntercityPolicy_2` 当成
// 「未导出的类型」——而它们在**源码里各只声明了一次**，误判的根因在这里，不在源码。
//
// 这里把每个 `import('..').X` 换成指向 X **真正声明处**的相对 specifier。改写后
// 入口不再被自己引用，判重消失（实测 114 → 0），且不改变任何类型语义。
export function rewriteEntrySelfReExports(
  content: string,
  filePath: string,
  declarationDir: string,
  nameToFile: ReadonlyMap<string, string>,
): string | undefined {
  if (!filePath.endsWith('.d.ts')) return undefined
  // 只处理 dist/<子目录> 下的 .d.ts：那里才是 `..` 会指回入口的位置。
  if (!isInsideSubdirectory(declarationDir, filePath)) return undefined
  // 注意：这里用**无 g 标志**的副本做前置判断。带 /g 的正则 `.test()` 会推进
  // `lastIndex`，先 `.test()` 再 `.replace()` 会漏掉交替出现的匹配（`replace` 会从
  // lastIndex 续跑），表现为「改写看起来跑了、但结果没变干净」。
  const hasSelfImport = /import\((['"])\.\.\1\)\.(\w+)/.test(content)
  const hasStaticSelfImport = /^import \{[^}]*\} from ['"]\.\.['"];?$/m.test(content)
  if (!hasSelfImport && !hasStaticSelfImport) return undefined
  const selfImportRE = /import\((['"])\.\.\1\)\.(\w+)/g
  const staticSelfImportRE = /^import \{([^}]*)\} from ['"]\.\.['"];?$/gm
  let changed = false
  // 形式一：`vue-tsc` emit 的内联 `import("..").X`（unplugin-dts 可能保留原样）。
  let output = content.replace(selfImportRE, (all, _quote: string, name: string) => {
    const spec = specifierFor(name, filePath, nameToFile)
    if (!spec) return all
    changed = true
    return `import('${spec}').${name}`
  })
  // 形式二：`unplugin-dts` 的 `transformCode` 把上面那种内联导入**提升成一条静态导入**，
  // 于是 `useMap.d.ts` 变成 `import { MapContext, MapStatus, ... } from '..';` —— `..` 就是
  // `dist/composables.d.ts`（本子入口自己）。这条自指让同一批符号同时以「rollup 根」和
  // 「被引用模块」两种身份进入 API Extractor，触发 `_makeUniqueNames()` 判重。
  output = output.replace(staticSelfImportRE, (all, names: string) => {
    const specifiers = names
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
    const resolved = specifiers.map((name) => [name, specifierFor(name, filePath, nameToFile)] as const)
    if (resolved.some(([, spec]) => !spec)) {
      return all
    }
    changed = true
    return resolved.map(([name, spec]) => `import type { ${name} } from '${spec}';`).join('\n')
  })
  return changed ? output : undefined
}

/**
/**
 * `filePath` 是否位于 `declarationDir` 的**子目录**里（入口自身不算）。
 *
 * **必须平台无关**（#160 评审 P2）。Node 在 Windows 上给出的 `filePath` 用反斜杠：
 * 先前那版 `filePath.slice(dir.length + 1).includes('/')` 在 Windows 下恒为 false ——
 * 整段自指改写静默不生效，而它正是消掉那 114 个重复声明的唯一手段。CI 是 Linux，
 * 全绿覆盖不到这一支。
 *
 * 做法：两边都归一成 `/` 再逐段比较，**不**用 `path.relative`（它是平台相关的，在 POSIX
 * 上处理不了反斜杠路径）。`file.length !== dir.length + 1` 一并挡掉「入口自身在 dist
 * 顶层」与「根本不在 dist 下」两种情况。
 */
export function isInsideSubdirectory(declarationDir: string, filePath: string): boolean {
  const toPosix = (input: string): string => input.replace(/\\/g, '/')
  const dir = toPosix(declarationDir).split('/').filter(Boolean)
  const file = toPosix(filePath).split('/').filter(Boolean)
  // 至少要比 dist 深**一层**，且 dir 是 file 的前缀。深度不限：
  // `integrations/ui-kit/index.d.ts` 与 `composables/useMap.d.ts` 都在范围内。
  if (file.length <= dir.length) return false
  if (!dir.every((segment, index) => file[index] === segment)) return false
  // dist **顶层**的 `.d.ts` 是七个入口自己（`composables.d.ts` / `index.d.ts` …），
  // 正是这次 rollup 的根 —— 它们不能被改写（自指就是它们引起的）。判据是「中间层
  // 不存在」：文件名的父目录段数与 dist 相同 ⇒ 它就直接躺在 dist 下。
  const segmentsBelow = file.length - dir.length - 1
  return segmentsBelow >= 1
}

/** 名字 → 指向其**真正声明处**的相对 specifier（无 `.d.ts` 后缀）；解析不到返回 `undefined`。
 *
 * 解析不到时调用方**原样保留**该引用：宁可留下一个能被 `check:api` 看见的重复，也不
 * 静默改错目标 —— 后者会变成一个指向不存在模块的悬空引用，错误现场离病因十万八千里。
 */
function specifierFor(
  name: string,
  filePath: string,
  nameToFile: ReadonlyMap<string, string>,
): string | undefined {
  const target = nameToFile.get(name)
  if (!target) return undefined
  const spec = relative(dirname(filePath), target)
    .replace(/\.d\.ts$/, '')
    .split(sep)
    .join('/')
  return spec.startsWith('.') ? spec : `./${spec}`
}

const DIST_DIR = resolve(root, 'dist')
const SRC_DIR = resolve(root, 'src')

/**
 * 声明名 → 声明所在文件的索引（供 `rewriteEntrySelfImports` 用）。
 *
 * 扫的是 **`src/` 源码**而不是 dist：改写发生在 per-module 声明写入**之前**，dist 里
 * 此刻只有已写出的那几个文件，扫它会得到半截索引（第一版就踩了这个坑，见下面的缓存键）。
 * 索引记的值是「该名字**将会**落到哪个 `dist/*.d.ts`」—— 源码与声明同构，一一对应。
 *
 * **先到先得**：同名符号取先扫到的那份。被自指的 `import('..')` 引用到的名字
 * （`MapContext` / `MapHandle` / `ServiceResult` …）在 `src/` 里都只有**一份**声明，
 * 因此先到先得足够；真有重名时改写也仍会指向一个真实存在的模块，不会产生悬空引用。
 */
let declIndex: Map<string, string> | undefined
let declIndexSize = -1
function declarationNameIndex(): ReadonlyMap<string, string> {
  // 缓存键用**文件数**：真值是「src 变了」，而文件数是它的廉价代理。
  // `beforeWriteFile` 会被调上千次、每次重建索引不现实，因此必须有缓存；一次构建里
  // `src/` 是静态的（watch 模式下才会变），所以正常构建永远命中缓存，只在 watch 增删
  // 文件时重建。代价：watch 中**只改内容、不增删文件**时不会重建索引 —— 那种情况下改写
  // 仍然正确（specifier 只依赖「哪个文件声明了它」，不依赖内容），只是用旧的映射。
  const current = collectSourceFiles(SRC_DIR).length
  if (declIndex && declIndexSize === current) return declIndex
  const index = new Map<string, string>()
  for (const file of collectSourceFiles(SRC_DIR)) {
    const content = readFileSync(file, 'utf8')
    // 顶层声明：`declare interface` / `export interface` / `export type` / `declare const` …
    // 名字后跟 `<`（泛型）、`(`、`=`、`;`、空格或换行。
    for (const match of content.matchAll(
      /^(?:export )?(?:declare )?(?:interface|type|const|class|function) (\w+)(?=[ <({=;\n])/gm,
    )) {
      const name = match[1]!
      if (index.has(name)) continue
      // 索引记的是**声明产物**的路径：dist/<相对 src 的路径>.d.ts（`.vue` 同名）。
      index.set(name, join(DIST_DIR, relative(SRC_DIR, file).replace(/\.ts$|\.vue$/, '.d.ts')))
    }
  }
  declIndex = index
  declIndexSize = current
  return index
}

/** src 下的源码文件（`.vue` 的声明会落到同名 `.d.ts`，故按 `.vue` 去掉扩展名处理）。 */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collectSourceFiles(full, out)
    else if (/\.(ts|vue)$/.test(full) && !full.endsWith('.test.ts')) out.push(full)
  }
  return out
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
      // `rewriteEntrySelfImports` 挂在这里是**唯一可行**的位置，值得记一笔：
      // `import("..")` 由 `vue-tsc` 的声明 emit 写出，经 `unplugin-dts` 的
      // `transformCode` 提升成静态导入后，**在本钩子被调用时就已经是那个形态**了
      // （`from '..'` 而非 `import("..")`）。`afterBuild` 跑在 `bundleTypes` 的
      // rollup **之后**（实测那时 dist 只剩 7 个打包好的入口文件），改写已经太晚。
      beforeWriteFile: (filePath, content) => {
        if (isJsapiV4BoundaryFile(filePath)) return false
        const stripped = stripDeclareGlobalBlocks(content, jsapiV4AugmentationBlocks)
        if (stripped !== undefined) return { content: stripped }
        const rewritten = rewriteEntrySelfReExports(
          stripped ?? content,
          filePath,
          DIST_DIR,
          declarationNameIndex(),
        )
        if (rewritten !== undefined) return { content: rewritten }
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
