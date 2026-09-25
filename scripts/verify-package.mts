#!/usr/bin/env node
/**
 * M0-05: verify-package
 *
 * 步骤:
 * 1. 在 .artifacts 内找到 package .tgz。
 * 2. 复制到 fixtures/consumer 临时目录安装。
 * 3. 跑 vue-tsc 类型检查 + ESM 导入 smoke(package 发布硬前提)。
 *
 * 用法:
 *   pnpm --filter bmap-vue pack --pack-destination .artifacts
 *   node scripts/verify-package.mts
 */
import { execSync } from 'node:child_process'
import { readdirSync, existsSync, readFileSync, rmSync, copyFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectImportClosure, componentMarkersIn } from './advanced-bundle-shake.mts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifactsDir = resolve(root, '.artifacts')
const fixturesDir = resolve(root, 'fixtures')

/** 空转守卫：切出来的集合为空时，后面的「没有命中」不能作为证据。 */
function expectNonEmpty(values: readonly unknown[], message: string): void {
  if (values.length === 0) throw new Error(message)
}

function findTarball(): string {
  if (!existsSync(artifactsDir)) throw new Error('.artifacts not found; run: pnpm pack:package')
  const tarballs = readdirSync(artifactsDir)
    .filter((f) => /^bmap-vue-\d+\.\d+\.\d+(?:-.+)?\.tgz$/.test(f))
    .sort()
  if (tarballs.length === 0) throw new Error('No .tgz found in .artifacts')
  return resolve(artifactsDir, tarballs[tarballs.length - 1])
}

function readTarballManifest(tarball: string): Record<string, unknown> {
  const output = execSync(`tar -xOzf ${JSON.stringify(tarball)} package/package.json`, {
    cwd: root,
    encoding: 'utf8',
  })
  return JSON.parse(output) as Record<string, unknown>
}

function assertReleaseIdentity(tarball: string): void {
  const manifest = readTarballManifest(tarball)
  if (manifest.name !== 'bmap-vue') {
    throw new Error(`[verify-package] tarball package.name must be bmap-vue: ${String(manifest.name)}`)
  }
  if (typeof manifest.version !== 'string' || !/^1\.0\.0(?:-rc\.\d+)?$/.test(manifest.version)) {
    throw new Error(`[verify-package] tarball version must use the 1.0 release line: ${String(manifest.version)}`)
  }
  if (!manifest.exports || typeof manifest.exports !== 'object') {
    throw new Error('[verify-package] tarball package.json must contain exports')
  }
  const exportsMap = manifest.exports as Record<string, unknown>
  for (const subpath of [
    '.',
    './components',
    './composables',
    './plugins',
    './resolver',
    './advanced',
    './ui-kit',
  ]) {
    const target = exportsMap[subpath]
    if (!target || typeof target !== 'object') {
      throw new Error(`[verify-package] tarball exports must contain ${subpath}`)
    }
    const conditions = target as Record<string, unknown>
    for (const condition of ['types', 'import']) {
      if (typeof conditions[condition] !== 'string' || !conditions[condition].startsWith('./dist/')) {
        throw new Error(`[verify-package] tarball exports ${subpath}.${condition} must target dist`)
      }
    }
  }
  if (exportsMap['./package.json'] !== './package.json') {
    throw new Error('[verify-package] tarball must expose package.json')
  }
  if (manifest.license !== 'MIT') {
    throw new Error(`[verify-package] tarball license must be MIT: ${String(manifest.license)}`)
  }
  if (!manifest.repository || typeof manifest.repository !== 'object') {
    throw new Error('[verify-package] tarball package.json must contain repository metadata')
  }
  if (typeof manifest.author !== 'string' || manifest.author.length === 0) {
    throw new Error('[verify-package] tarball package.json must contain author metadata')
  }
  const metadata = JSON.stringify(manifest)
  for (const legacy of ['baidu-map-gl-vue', '3.0.0']) {
    if (metadata.includes(legacy)) {
      throw new Error(`[verify-package] tarball metadata contains legacy release identity: ${legacy}`)
    }
  }
}

function run(cmd: string, cwd: string, label: string) {
  console.log(`\n[verify-package] ${label}: ${cmd}`)
  execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, CI: '1' } })
}

function copyTree(src: string, dest: string) {
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    // 源 fixture 里可能残留**本地产物** `node_modules`（已 gitignore）。copyFileSync 会把
    // 符号链接**解引用**成普通文件：`.bin/vue-tsc` 从 `-> ../vue-tsc/bin/vue-tsc.js` 变成
    // 一份内容相同的拷贝，而 `require('../index.js')` 相对的是 `.bin/` 而不是包目录 ⇒
    // `npx vue-tsc` 报 MODULE_NOT_FOUND。npm 看到依赖已就位只更新 tarball，不会重建 bin。
    // fixture 源目录只放需要被复制的**输入**，依赖一律交给 npm 重新装。
    if (entry.name === 'node_modules') continue
    const s = resolve(src, entry.name)
    const d = resolve(dest, entry.name)
    if (entry.isDirectory()) {
      mkdirSync(d, { recursive: true })
      copyTree(s, d)
    } else {
      copyFileSync(s, d)
    }
  }
}

function setupFixture(name: string): string {
  const src = resolve(fixturesDir, name)
  const tmp = resolve(root, '.artifacts', `fixture-${name}`)
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  copyTree(src, tmp)
  return tmp
}

/**
 * 把文档站的示例组件复制进消费方 fixture，让它们**对着 tarball** 做类型检查。
 *
 * 文档示例的日常门禁是 `docs:typecheck`（`docs/tsconfig.json` 把 `bmap-vue` 映到
 * `../packages/bmap-vue/dist/index.d.ts`）——那已经是发布声明面，但仍然是**仓库内**的
 * dist。这条把它再收紧一格：装进 `node_modules` 的**正式 tarball**，因此
 * 「示例能用某个导出」与「那个导出真的跟着包发出去」不会各说各话。
 *
 * 复制的目录要跟着示例的子目录一起搬（`expand/bmap-draw/*` 依赖 `bmap-draw`，
 * 它在 fixture 的 devDependencies 里），因此保持相对路径而不是拍平。
 */
function copyDocsExamples(dest: string): number {
  const src = resolve(root, 'docs/examples')
  const target = resolve(dest, 'docs-examples')
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  const walk = (from: string, to: string): void => {
    for (const entry of readdirSync(from)) {
      const s = resolve(from, entry)
      const d = resolve(to, entry)
      if (statSync(s).isDirectory()) {
        mkdirSync(d, { recursive: true })
        walk(s, d)
      } else if (entry.endsWith('.vue')) {
        copyFileSync(s, d)
      }
    }
  }
  walk(src, target)
  return readdirSync(target).length
}

function main() {
  const tarball = findTarball()
  console.log(`[verify-package] tarball: ${tarball}`)
  assertReleaseIdentity(tarball)
  copyFileSync(tarball, resolve(artifactsDir, 'bmap-vue.tgz'))


  // 5) consumer:从 package tarball 安装,类型检查 + ESM 导入(发布包的硬前提)
  //    `./ui-kit` 子路径单独再 import 一次：它必须在**无 DOM 的 Node** 里可加载
  //    （上游 UI Kit 的 import 会崩，本库入口不得把它拉进静态图）。见 #73。
  const consumerFixture = setupFixture('consumer')
  // 文档示例对着**正式 tarball** 类型检查（issue #141 的「示例代码从正式 tarball 运行」）。
  // 排在 `npm install` 之前：文件必须在依赖装好之前就位。
  const copiedExampleGroups = copyDocsExamples(consumerFixture)
  run(
    `npm install --no-audit --no-fund && npx vue-tsc --noEmit && node -e "import('bmap-vue').then(m=>{if(!m.Map||!m.createBMapPlugin)throw new Error('missing exports');console.log('consumer ESM import OK')})" && node -e "import('bmap-vue/ui-kit').then(m=>{for(const k of ['PlaceAutocomplete','PlaceSearch','PlaceDetail','RoutePlan','RoutePlanDrivingPolicy','loadUiKit','UI_KIT_STYLE_PATH'])if(!m[k])throw new Error('missing '+k);console.log('ui-kit subpath ESM import OK (no DOM, four components)')})"`,
    consumerFixture,
    'consumer typecheck + ESM import (package tarball)',
  )
  if (copiedExampleGroups > 0) {
    console.log(
      `\n[verify-package] docs examples OK: ${copiedExampleGroups} 组示例已对着 tarball 完成 vue-tsc。`,
    )
  }

  // 5b) 第三方扩展 fixture（M8-ADAPTERS-ADVANCED / #43）
  //
  //     `./advanced` 是**承诺维护**的扩展契约（第三方 Provider / Driver / Handle / Plugin 适配点），
  //     所以它必须在真实消费方（tarball 装进 node_modules）里被**真正调用一次**，而不是只断言
  //     「import 得动」。类型面由 `fixtures/consumer/src/advanced-adapter.ts` 通过上面的
  //     `vue-tsc` 覆盖；这里补运行面的可观察行为。
  const advancedProbe = resolve(consumerFixture, 'advanced-probe.mjs')
  writeFileSync(
    advancedProbe,
    [
      "import {",
      "  CAPABILITY_CATALOG,",
      "  UnsupportedCapabilityError,",
      "  assertLoadedSdk,",
      "  createCapabilityRegistry,",
      "  createHandle,",
      "  normalizeProvider,",
      "  unwrapRaw,",
      "} from 'bmap-vue/advanced'",
      "import {",
      "  BUILTIN_PLUGIN_NAMES,",
      "  resolvePluginDefinition,",
      "  urlPluginDefinition,",
      "} from 'bmap-vue/plugins'",
      "",
      "const fail = (message) => {",
      "  throw new Error('[advanced-probe] ' + message)",
      "}",
      "",
      "// ① raw 逃生口：handle -> raw",
      "const handle = createHandle('map', { probe: true })",
      "if (unwrapRaw(handle)?.probe !== true) fail('unwrapRaw 取不回 raw')",
      "",
      "// ② 能力表：不支持的条目必须抛出**同一个错误类型**（而不是裸字符串），",
      "//    且策略为 throw 时不再「warn 一下继续跑」—— 这正是「不静默」的落点。",
      "const registry = createCapabilityRegistry({",
      "  engine: 'jsapi-v4',",
      "  version: '4.0',",
      "  rawSdk: {},",
      "  unsupported: 'throw',",
      "})",
      "if (typeof registry.supports !== 'function' || typeof registry.require !== 'function') {",
      "  fail('createCapabilityRegistry 的形状不对')",
      "}",
      "if (registry.supports('overlay.mapvgl') !== false) {",
      "  fail('overlay.mapvgl 应当是不支持（它的结论是 incompatible）')",
      "}",
      "let unsupported = 0",
      "let capabilityMismatch = 0",
      "for (const id of Object.keys(CAPABILITY_CATALOG)) {",
      "  if (registry.supports(id)) continue",
      "  try {",
      "    registry.require(id)",
      "    fail('不支持的能力 require 没有抛错：' + id)",
      "  } catch (error) {",
      "    if (error instanceof UnsupportedCapabilityError) {",
      "      unsupported += 1",
      "      if (error.capability !== id) capabilityMismatch += 1",
      "    } else {",
      "      throw error",
      "    }",
      "  }",
      "}",
      "if (unsupported === 0) fail('没有一条 unsupported —— 能力表可能没装起来')",
      "if (capabilityMismatch > 0) fail('UnsupportedCapabilityError 带的 capability 与查询的 id 不符')",
      "",
      "// ③ Provider 收口校验：不是 jsapi-v4 的结构化结果必须被拒",
      "let rejectedLegacy = false",
      "try {",
      "  assertLoadedSdk({ engine: 'webgl-v1', version: 'x', namespace: {} })",
      "} catch {",
      "  rejectedLegacy = true",
      "}",
      "if (!rejectedLegacy) fail('assertLoadedSdk 没有拒绝旧引擎的加载结果')",
      "",
      "// ④ 插件入口：名字表 / 未知名字显式失败 / 第三方 definition 工厂",
      "if (!BUILTIN_PLUGIN_NAMES.includes('TrackAnimation')) fail('内置插件名字表少了 TrackAnimation')",
      "let unknownRejected = false",
      "try {",
      "  resolvePluginDefinition('TrackAnimatino')",
      "} catch (error) {",
      "  unknownRejected = error?.code === 'BMAP_PLUGIN_UNKNOWN'",
      "}",
      "if (!unknownRejected) fail('未知插件名没有以 BMAP_PLUGIN_UNKNOWN 失败')",
      "const thirdParty = urlPluginDefinition('ThirdParty', 'https://example.com/x.js', () => undefined, {",
      "  scope: 'global',",
      "  required: false,",
      "})",
      "if (thirdParty.scope !== 'global' || thirdParty.required !== false || typeof thirdParty.load !== 'function') {",
      "  fail('urlPluginDefinition 的选项没有生效')",
      "}",
      "",
      "// ⑤ normalizeProvider 必须保住 class 型 Provider 的 this 绑定",
      "class ClassProvider {",
      "  constructor() { this.marker = 'bound' }",
      "  getCacheKey() { return 'class-provider' }",
      "  async load() { return this.marker }",
      "}",
      "const normalized = normalizeProvider(new ClassProvider())",
      "if ((await normalized.load({}, undefined)) !== 'bound') fail('normalizeProvider 丢了 this')",
      "if (normalized.getCacheKey({}) !== 'class-provider') fail('normalizeProvider 没转发 getCacheKey')",
      "",
      "process.stdout.write(JSON.stringify({",
      "  capabilityCount: Object.keys(CAPABILITY_CATALOG).length,",
      "  unsupported,",
      "  pluginNames: BUILTIN_PLUGIN_NAMES.length,",
      "}))",
      "",
    ].join('\n'),
  )
  const advancedProbeOut = execSync(`node ${JSON.stringify(advancedProbe)}`, {
    cwd: consumerFixture,
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
  })
  console.log(`\n[verify-package] advanced contract probe OK: ${advancedProbeOut.trim()}`)
  rmSync(advancedProbe, { force: true })

  // 5c) tree-shaking：**只用 `./advanced`** 的打包产物不得把组件带进来（#43）。
  //
  //     这条必须在 tarball 消费方里做：仓库内那份闭包检查（tests/behavior/advanced-contract.test.ts）
  //     看的是我们自己的 dist，而这里看的是**真实打包器在真实依赖解析下**的产物。
  //     两个对照入口（只用 ./advanced / 只用根入口）共用同一份配置与同一份判据，后者是正证。
  const shakeDir = resolve(consumerFixture, 'shake')
  const viteBin = resolve(root, 'node_modules/.bin/vite')
  if (!existsSync(viteBin)) {
    throw new Error('[verify-package] 找不到 vite（tree-shaking 对照需要真实打包器）')
  }
  const buildShake = (entryFile: string, outName: string): string => {
    const outDir = resolve(consumerFixture, 'shake-out', outName)
    execSync(`${JSON.stringify(viteBin)} build --config ${JSON.stringify(resolve(shakeDir, 'vite.config.mjs'))}`, {
      cwd: consumerFixture,
      stdio: 'inherit',
      env: { ...process.env, CI: '1', SHAKE_ENTRY: resolve(shakeDir, entryFile), SHAKE_OUT: outDir },
    })
    return outDir
  }
  const closureOf = (outDir: string): { files: string[]; external: string[] } => {
    const entry = resolve(outDir, 'entry.mjs')
    if (!existsSync(entry)) {
      throw new Error(`[verify-package] tree-shaking 对照没有产出 ${entry}`)
    }
    return collectImportClosure({
      root: outDir,
      entry,
      resolve: (from, specifier) => resolve(dirname(from), specifier),
      relative: (from, to) => relative(from, to),
      exists: existsSync,
      readFile: (file) => readFileSync(file, 'utf8'),
    })
  }
  const markersIn = (closure: { files: string[] }, outDir: string): string[] =>
    componentMarkersIn(
      closure,
      (file) => resolve(outDir, file),
      (file) => readFileSync(file, 'utf8'),
    )

  const advancedOnlyOut = buildShake('advanced-only.ts', 'advanced-only')
  const advancedOnlyClosure = closureOf(advancedOnlyOut)
  // 空转守卫：闭包确实读到了文件（否则下面的「没有组件」可能只是没扫到）
  expectNonEmpty(advancedOnlyClosure.files, '[verify-package] advanced-only 的产物闭包为空')
  const advancedMarkers = markersIn(advancedOnlyClosure, advancedOnlyOut)
  if (advancedMarkers.length > 0) {
    throw new Error(
      `[verify-package] 只用 ./advanced 的产物里出现了组件标记：${advancedMarkers.join(', ')}（tree-shaking 承诺不成立）`,
    )
  }

  const rootEntryOut = buildShake('root-entry.ts', 'root-entry')
  const rootEntryClosure = closureOf(rootEntryOut)
  const rootMarkers = markersIn(rootEntryClosure, rootEntryOut)
  if (rootMarkers.length === 0) {
    throw new Error(
      '[verify-package] 对照入口（只用根入口）的产物里没有组件标记 —— 说明这条判据没有区分力，' +
        '上面「advanced-only 里没有组件」不能作为证据',
    )
  }
  console.log(
    `\n[verify-package] tree-shaking OK: advanced-only 闭包 ${advancedOnlyClosure.files.length} 个文件、0 个组件标记；` +
      `对照（根入口）${rootEntryClosure.files.length} 个文件、命中 ${rootMarkers.join(' / ')}`,
  )

  // 6) 运行时依赖契约：默认在线路径委托官方 Loader（#71），因此发布包必须把它作为
  //    **精确锁定的运行时依赖**声明，并且真的能被消费者解析。
  //    只断言「能 import」不够：依赖漏声明时 tarball 里的 import 仍然会通过（产物内联），
  //    于是「普通消费者不额外手动配置」这条契约会静默失效。
  const installedPkgPath = resolve(consumerFixture, 'node_modules/bmap-vue/package.json')
  const installedPkg = JSON.parse(readFileSync(installedPkgPath, 'utf8')) as {
    dependencies?: Record<string, string>
  }
  const declared = installedPkg.dependencies?.['@baidumap/jsapi-loader']
  if (declared !== '1.0.0') {
    throw new Error(
      `[verify-package] 发布包必须以 dependencies 精确锁定 @baidumap/jsapi-loader@1.0.0，实际为 ${String(declared)}`,
    )
  }
  const loaderPkgPath = resolve(consumerFixture, 'node_modules/@baidumap/jsapi-loader/package.json')
  if (!existsSync(loaderPkgPath)) {
    throw new Error(
      '[verify-package] 消费者的 node_modules 里没有 @baidumap/jsapi-loader：运行时依赖没有被解析',
    )
  }
  const loaderPkg = JSON.parse(readFileSync(loaderPkgPath, 'utf8')) as { version?: string }
  if (loaderPkg.version !== '1.0.0') {
    throw new Error(`[verify-package] 装到的 loader 版本不是 1.0.0：${String(loaderPkg.version)}`)
  }
  console.log('\n[verify-package] runtime dependency OK: @baidumap/jsapi-loader@1.0.0 已精确锁定并被消费者解析')

  // 6b) M4-HANDLE-UX（#29）：环境采集能力（ResizeObserver / IntersectionObserver / 页面前后台 /
  //     减少动画偏好）委托 `@vueuse/core`。它同样是**精确锁定**的运行时依赖，理由与上面那条相同：
  //     只断言「能 import」不够 —— 产物里内联时漏声明照样能跑，于是「消费者不需要手动装」这条
  //     契约会静默失效。另外钉住产物形态：ESM 档必须把它保持 **external**（不能内联），
  //     否则「依赖声明」与「产物内容」不一致（消费者会装一份用不到的包）。
  const vueuseDeclared = installedPkg.dependencies?.['@vueuse/core']
  if (vueuseDeclared !== '14.4.0') {
    throw new Error(
      `[verify-package] 发布包必须以 dependencies 精确锁定 @vueuse/core@14.4.0，实际为 ${String(vueuseDeclared)}`,
    )
  }
  const vueusePkgPath = resolve(consumerFixture, 'node_modules/@vueuse/core/package.json')
  if (!existsSync(vueusePkgPath)) {
    throw new Error(
      '[verify-package] 消费者的 node_modules 里没有 @vueuse/core：运行时依赖没有被解析',
    )
  }
  const vueusePkg = JSON.parse(readFileSync(vueusePkgPath, 'utf8')) as { version?: string }
  if (vueusePkg.version !== '14.4.0') {
    throw new Error(`[verify-package] 装到的 @vueuse/core 版本不是 14.4.0：${String(vueusePkg.version)}`)
  }
  console.log('\n[verify-package] runtime dependency OK: @vueuse/core@14.4.0 已精确锁定并被消费者解析')

  // 7) 负向消费测试:消费者未安装官方类型包时,全局 `BMap.*` 必须不可用
  //    (公共声明不得泄漏官方命名空间;泄漏会让下面的类型检查意外通过)
  const negativeFile = resolve(consumerFixture, 'src/global-namespace-negative.ts')
  writeFileSync(negativeFile, 'export declare const leaked: BMap.Point\n')
  let leaked = false
  try {
    execSync('npx vue-tsc --noEmit', { cwd: consumerFixture, stdio: 'pipe', env: { ...process.env, CI: '1' } })
    leaked = true
  } catch {
    leaked = false
  } finally {
    rmSync(negativeFile, { force: true })
  }
  if (leaked) {
    throw new Error(
      '[verify-package] public declarations leak the global `BMap` namespace: consumer type-checked `BMap.Point` without @baidumap/jsapi-v4-types',
    )
  }
  console.log('\n[verify-package] negative check OK: global BMap namespace is not visible to consumers')

  // 8) dev 告警的**消费方可见性**（#27 评审第二轮 P2）
  //
  //    `core/logger.ts` 的 `devWarn` 把开发 / 生产的判定**留给消费方**（打包器折叠
  //    `process.env.NODE_ENV`，Node / SSR 读真实环境变量）。因此发布产物里必须保留这个标记：
  //    一旦在 publish build 阶段定死成 `production`，npm 消费方即使在自己的 dev server 里
  //    import 本包，拿到的也是已经 DCE 掉的产物，告警永远不会出现。
  //
  //    三步都验：① ESM 产物层面「标记还在」；② IIFE 档「没有裸 `process`」（那一档自己折叠）；
  //    ③ 行为层面「同一个产物在 development 下告警、在 production 下静默」——正是消费方
  //    打包器折叠后的两种终态。
  const installedDist = resolve(consumerFixture, 'node_modules/bmap-vue/dist')
  const distFiles: string[] = []
  const collect = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name)
      if (entry.isDirectory()) collect(full)
      else if (/\.(mjs|js)$/.test(entry.name)) distFiles.push(full)
    }
  }
  collect(installedDist)

  // ① ESM 档保留可折叠标记（`useControllableState` 会被拆进共享 chunk，因此要扫整棵 dist）
  const esmFiles = distFiles.filter((file) => file.endsWith('.mjs'))
  const keepsDevMarker = esmFiles.some((file) =>
    readFileSync(file, 'utf8').includes('process.env.NODE_ENV'),
  )
  if (!keepsDevMarker) {
    throw new Error(
      '[verify-package] ESM 产物必须保留 `process.env.NODE_ENV` 这个可折叠标记：' +
        '在库构建阶段定死开发 / 生产会让消费方的 dev server 永远看不到 dev 告警',
    )
  }

  // ①b M4-HANDLE-UX（#29）：`@vueuse/core` 是声明过的运行时依赖，必须在 ESM 产物里保持
  //     **external**（见 `vite.config.build.ts`）。内联会让「依赖声明」与「产物内容」不一致：
  //     消费者装了一份用不到的包，而产物里还塞着另一份实现。
  const keepsVueuseExternal = esmFiles.some((file) =>
    /from\s*["']@vueuse\/core["']/.test(readFileSync(file, "utf8")),
  )
  if (!keepsVueuseExternal) {
    throw new Error(
      '[verify-package] ESM 产物必须把 @vueuse/core 保持 external（vite.config.build.ts 的 external 列表）',
    )
  }

  // ② IIFE 档（`<script>` 直引）必须已经折叠掉：浏览器里没有 `process`
  const globalBundle = resolve(installedDist, 'index.global.js')
  if (/[^.\w]process\.env/.test(readFileSync(globalBundle, 'utf8'))) {
    throw new Error(
      '[verify-package] IIFE 产物残留裸 `process.env`：浏览器里会抛 ReferenceError（见 vite.config.global.ts 的 define）',
    )
  }

  const devProbe = resolve(consumerFixture, 'dev-warn-probe.mjs')
  writeFileSync(
    devProbe,
    [
      "import { effectScope, ref } from 'vue'",
      "import { useControllableState } from 'bmap-vue/composables'",
      '',
      'const lines = []',
      'const original = console.warn',
      'console.warn = (...args) => { lines.push(String(args[0])) }',
      'try {',
      '  const external = ref(undefined)',
      '  const scope = effectScope()',
      '  scope.run(() => {',
      '    const state = useControllableState({',
      "      name: 'center',",
      '      value: () => external.value,',
      '      fallback: { lng: 0, lat: 0 },',
      '      equals: (a, b) => a.lng === b.lng && a.lat === b.lat,',
      '      copy: (p) => ({ lng: p.lng, lat: p.lat }),',
      '    })',
      '    external.value = { lng: 1, lat: 2 }',
      '    state.syncExternal(external.value)',
      '  })',
      '  scope.stop()',
      '} finally {',
      '  console.warn = original',
      '}',
      "process.stdout.write(JSON.stringify({ warns: lines.length, modeSwitch: lines.some((l) => l.includes('由非受控切换为受控')) }))",
      '',
    ].join('\n'),
  )
  const runDevProbe = (nodeEnv: string) => {
    const out = execSync(`node ${JSON.stringify(devProbe)}`, {
      cwd: consumerFixture,
      env: { ...process.env, NODE_ENV: nodeEnv, CI: '1' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return JSON.parse(out.trim()) as { warns: number; modeSwitch: boolean }
  }
  const devRun = runDevProbe('development')
  if (!devRun.modeSwitch) {
    throw new Error(
      `[verify-package] NODE_ENV=development 下发布包必须输出「模式切换」告警，实际没有（warns=${devRun.warns}）`,
    )
  }
  const prodRun = runDevProbe('production')
  if (prodRun.warns !== 0) {
    throw new Error(
      `[verify-package] NODE_ENV=production 下发布包不得输出任何 dev 告警，实际 ${prodRun.warns} 条`,
    )
  }
  rmSync(devProbe, { force: true })
  console.log(
    '\n[verify-package] dev warning gate OK: 产物保留可折叠标记；development 告警 / production 静默',
  )

  console.log('\n[verify-package] ALL PASSED')
}

main()
