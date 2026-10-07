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
import { commitOf, describeTarball, sha256Of, selectTarball } from './tarball-identity.mts'
import {
  CONSUMER_TARBALL,
  PKG_DIR,
  isOwnTarball,
  releaseIdentityOf,
} from './release-identity.mts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifactsDir = resolve(root, '.artifacts')
const fixturesDir = resolve(root, 'fixtures')

/**
 * 发布身份**一律从 manifest 读**，不在本脚本里写死包名。
 *
 * 1.0 把包名从无 scope 的 `bmap-vue` 迁到 `@mangax/bmap-vue`（前者归他人所有）。
 * 写死的话，改名要同时改本文件的 tarball 正则、ESM 探针字符串、`node_modules` 路径
 * 等十几处，漏一处就是「门禁红」或「门禁静默不生效」——后者更糟。
 */
const identity = releaseIdentityOf(
  JSON.parse(readFileSync(resolve(root, PKG_DIR, 'package.json'), 'utf8')),
)

/** 空转守卫：切出来的集合为空时，后面的「没有命中」不能作为证据。 */
function expectNonEmpty(values: readonly unknown[], message: string): void {
  if (values.length === 0) throw new Error(message)
}

function findTarball(): string {
  if (!existsSync(artifactsDir)) throw new Error('.artifacts not found; run: pnpm pack:package')
  const candidates = readdirSync(artifactsDir)
    // 按身份筛，而不是按 `bmap-vue-<version>.tgz` 的正则：scoped 包打出来是
    // `mangax-bmap-vue-1.0.0-rc.0.tgz`（无前导 @），正则认不出。
    .filter((f) => isOwnTarball(f, identity))
  if (candidates.length === 0) {
    throw new Error(
      `No .tgz for ${identity.name} found in .artifacts; run: pnpm pack:package` +
        `（.artifacts 现有：${readdirSync(artifactsDir).filter((f) => f.endsWith('.tgz')).join(', ') || '空'}）`,
    )
  }
  // 唯一性由 boundary 判（多于一个候选时失败，而不是静默取排序最后一个）—— 见
  // `tarball-identity.mts` 的文件头：那正是 E 要堵的「意外选另一个包」。
  return resolve(artifactsDir, selectTarball(candidates, identity))
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
  // 与仓库内 manifest 比，而不是与某个写死的名字比：这样「改了包名忘了同步 tarball」
  // 会立刻红，而改名本身只需要改 manifest 一处。
  if (manifest.name !== identity.name) {
    throw new Error(
      `[verify-package] tarball package.name must be ${identity.name}: ${String(manifest.name)}`,
    )
  }
  // scoped 包默认按 restricted 处理，漏掉 access 会让首次 publish 失败。这条断言的是
  // 「声明了 public」，与一致。
  const publishConfig = manifest.publishConfig as { access?: unknown } | undefined
  if (identity.isScoped && publishConfig?.access !== 'public') {
    throw new Error(
      `[verify-package] scoped 包 ${identity.name} 必须声明 publishConfig.access="public"：` +
        `npm 对 scoped 包默认按 restricted 处理，漏掉它首次 publish 会直接失败`,
    )
  }
  // 版本必须**全等**于仓库 manifest，而不只是匹配 1.0 版本线的正则。
  // 正则 `^1\.0\.0(?:-rc\.\d+)?$` 会把 `1.0.0-rc.9` 一并放过——而 `isOwnTarball`
  // 按前缀认领时可能挑中它，于是「验证了一个旧包」却全程绿灯（PR 评审 P2）。
  if (manifest.version !== identity.version) {
    throw new Error(
      `[verify-package] tarball version must be exactly ${identity.version}: ${String(manifest.version)}` +
        `（只匹配 1.0 版本线的正则不够：旧的 rc 包同样满足那条正则）`,
    );
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
  // 样式子路径（#189）：它是**纯资源出口**，形状与上面七个 JS 出口不同 ——
  // 裸字符串目标、没有 types / import 条件，因此单独判，不能塞进上面那个循环
  // （那会要求它也有 `types`，进而逼出一份假 `.d.ts`）。
  const stylesTarget = exportsMap['./styles.css']
  if (stylesTarget !== './dist/bmap-vue.css') {
    throw new Error(
      `[verify-package] tarball exports 必须把 ./styles.css 指向 ./dist/bmap-vue.css，实际为 ${JSON.stringify(stylesTarget)}`,
    )
  }
  // `sideEffects` 必须只声明那一个 CSS：`true` 会让 JS 失去 tree-shaking，
  // 写成 `false` 则让样式副作用声明缺位（#189 之前就是这个形态）。
  const sideEffects = manifest.sideEffects
  if (
    !Array.isArray(sideEffects) ||
    sideEffects.length === 0 ||
    !sideEffects.includes('./dist/bmap-vue.css') ||
    sideEffects.some((entry) => typeof entry !== 'string' || !entry.endsWith('.css'))
  ) {
    throw new Error(
      `[verify-package] tarball sideEffects 必须是「只含 ./dist/bmap-vue.css 的非空数组」，实际为 ${JSON.stringify(sideEffects)}`,
    )
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
  // fixture 源码里写的是**可读的**旧包名 `bmap-vue`；拷贝出来之后按真实身份重写。
  // 这样 fixture 的 .ts/.vue 保持人可读，而「改包名」这件事仍然只需要改 manifest 一处。
  // 重写的是**拷贝出来的副本**，`fixtures/` 里的源文件不被改动。
  if (name === 'consumer') rewriteFixturePackageName(tmp, identity.name)
  return tmp
}

/**
 * 把消费 fixture 副本里的包名统一替换成真实发布身份。
 *
 * 三类位置：① `package.json#dependencies` 的**键**；② `from 'bmap-vue…'` 的说明符；
 * ③ `import('bmap-vue')` 之类的探针字符串。
 *
 * 只替换**裸包名**（带引号边界），不碰 `packages/bmap-vue/…` 这类仓库内路径 ——
 * fixture 的 `env.d.ts` 与注释里有它们，那是仓库路径不是 npm 包名。
 */
function rewriteFixturePackageName(dir: string, name: string): void {
  const LEGACY = 'bmap-vue'
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue
      const full = resolve(d, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (/\.(ts|vue|mjs|json)$/.test(entry.name)) rewriteFile(full, name, LEGACY)
    }
  }

  const rewriteFile = (file: string, name: string, legacy: string): void => {
    const before = readFileSync(file, 'utf8')
    // ① 说明符：'bmap-vue' / "bmap-vue" / 'bmap-vue/ui-kit' → '@scope/bmap-vue'
    const after = before
      .replace(/(['"])bmap-vue(?=[/'\"])/g, `$1${name}`)
      // ② 仓库路径必须还原：`packages/@scope/bmap-vue/…` 不是合法路径
      .replace(/packages\/@[^/]+\/bmap-vue\//g, 'packages/bmap-vue/')
    if (after !== before) writeFileSync(file, after)
  }

  // package.json 的依赖键单独处理：它是 JSON 的 key，不能靠上面的引号规则
  const pkgJsonPath = resolve(dir, 'package.json')
  if (existsSync(pkgJsonPath)) {
    const raw = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    for (const field of [raw.dependencies, raw.devDependencies]) {
      if (!field) continue
      if (field[LEGACY] !== undefined) {
        field[name] = field[LEGACY]
        delete field[LEGACY]
      }
    }
    writeFileSync(pkgJsonPath, `${JSON.stringify(raw, null, 2)}\n`)
  }

  walk(dir)
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
  assertReleaseIdentity(tarball)
  // 被验证产物的**身份记录**（#158 工作包 E）：版本 / commit / sha256 三者一起才够。
  // 版本号不足以标识产物（同版本重打包内容会变），commit 回答「这次验证对应哪次提交」。
  // 记录在**所有档位跑之前**打印，失败时也能从日志里看出验的是哪一个包。
  const record = {
    file: tarball.slice(artifactsDir.length + 1),
    name: identity.name,
    version: identity.version,
    commit: commitOf(root),
    sha256: sha256Of(tarball),
  }
  console.log(`\n[verify-package] 被验证产物：${describeTarball(record)}`)
  console.log(`[verify-package] （全部档位都跑在这一个 tgz 上）`)
  copyFileSync(tarball, resolve(artifactsDir, CONSUMER_TARBALL))


  // 5) consumer:从 package tarball 安装,类型检查 + ESM 导入(发布包的硬前提)
  //    `./ui-kit` 子路径单独再 import 一次：它必须在**无 DOM 的 Node** 里可加载
  //    （上游 UI Kit 的 import 会崩，本库入口不得把它拉进静态图）。见 #73。
  const consumerFixture = setupFixture('consumer')
  // 文档示例对着**正式 tarball** 类型检查（issue #141 的「示例代码从正式 tarball 运行」）。
  // 排在 `npm install` 之前：文件必须在依赖装好之前就位。
  const copiedExampleGroups = copyDocsExamples(consumerFixture)
  // 文档示例是在 `setupFixture()` **之后**才拷进来的，所以要单独再重写一次包名。
  // 漏掉这一步的后果很具体：`vue-tsc` 会报几十条
  // `TS2307: Cannot find module 'bmap-vue'` —— 文档示例是对着 tarball 编译的，
  // 包名对不上立刻现形（这正是这道门禁的价值所在）。
  rewriteFixturePackageName(resolve(consumerFixture, 'docs-examples'), identity.name)
  run(
    `npm install --no-audit --no-fund && npx vue-tsc --noEmit && node -e "import('${identity.name}').then(m=>{if(!m.Map||!m.createBMapPlugin)throw new Error('missing exports');console.log('consumer ESM import OK')})" && node -e "import('${identity.name}/ui-kit').then(m=>{for(const k of ['PlaceAutocomplete','PlaceSearch','PlaceDetail','RoutePlan','RoutePlanDrivingPolicy','loadUiKit','UI_KIT_STYLE_PATH'])if(!m[k])throw new Error('missing '+k);console.log('ui-kit subpath ESM import OK (no DOM, four components)')})"`,
    consumerFixture,
    'consumer typecheck + ESM import (package tarball)',
  )

  // 5a) 样式子路径解析（#189）：**从装出来的 tarball** 证明它可解析、且真的是那份
  //     `<Autocomplete>` 样式。
  //
  //     只断言「manifest 里有这个键」不够——那测的是我们写下的声明，不是消费方拿到的东西。
  //     这里用 `import.meta.resolve`（Node 真实解析路径）+ 读文件内容，两条一起判：
  //     ① 解析成功（缺出口时是 `ERR_PACKAGE_PATH_NOT_EXPORTED`）；
  //     ② 内容里**确实**有 `<Autocomplete>` 那两条规则（`position: absolute` / `z-index`），
  //        否则「指向了一个 CSS」与「指向了正确的 CSS」无法区分。
  const stylesProbe = resolve(consumerFixture, 'styles-probe.mjs')
  writeFileSync(
    stylesProbe,
    [
      "import { readFileSync } from 'node:fs'",
      "import { fileURLToPath } from 'node:url'",
      `const resolved = import.meta.resolve('${identity.name}/styles.css')`,
      'if (!resolved.startsWith("file:")) throw new Error("styles.css 没有解析到文件: " + resolved)',
      'const file = fileURLToPath(resolved)',
      'const css = readFileSync(file, "utf8")',
      'if (!css.includes("b-auto-complete-input"))',
      '  throw new Error("styles.css 里没有 Autocomplete 的规则类名: " + file)',
      'if (!/position:\\s*absolute/.test(css)) throw new Error("styles.css 缺 position: absolute（定位规则不在）")',
      'if (!/z-index:\\s*10/.test(css)) throw new Error("styles.css 缺 z-index: 10（层级规则不在）")',
      'process.stdout.write(JSON.stringify({ file: file.split("node_modules/").pop(), bytes: css.length }))',
      '',
    ].join('\n'),
  )
  const stylesOut = execSync(`node ${JSON.stringify(stylesProbe)}`, {
    cwd: consumerFixture,
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
  })
  console.log(
    `\n[verify-package] 样式子路径 OK：${identity.name}/styles.css 可解析且含 Autocomplete 规则 ${stylesOut.trim()}`,
  )
  rmSync(stylesProbe, { force: true })

  // 反向：**旧路径**必须仍然解析不到。否则「开了 ./styles.css」这件事没有约束力——
  // 深路径若也能用，消费者会继续按 `pkg/dist/bmap-vue.css` 写，而那条路径没有承诺。
  const deepCssProbe = resolve(consumerFixture, 'deep-css-probe.mjs')
  writeFileSync(
    deepCssProbe,
    [
      'let code = null',
      `try { import.meta.resolve('${identity.name}/dist/bmap-vue.css') } catch (error) { code = error.code }`,
      'if (code !== "ERR_PACKAGE_PATH_NOT_EXPORTED")',
      '  throw new Error("深路径 pkg/dist/bmap-vue.css 不该可解析，实际: " + code)',
      'process.stdout.write("deep path still rejected (" + code + ")")',
      '',
    ].join('\n'),
  )
  const deepOut = execSync(`node ${JSON.stringify(deepCssProbe)}`, {
    cwd: consumerFixture,
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
  })
  console.log(`[verify-package] 反向 OK：${deepOut.trim()}`)
  rmSync(deepCssProbe, { force: true })
  if (copiedExampleGroups > 0) {
    console.log(
      `\n[verify-package] docs examples OK: ${copiedExampleGroups} 组示例已对着 tarball 完成 vue-tsc。`,
    )
  }

  // 5b) 样式子路径在**真实消费方生产构建**下真的生效（#158 工作包 D）。
  //
  //     上面那条只证明「解析得到 + 内容里有那两条规则」；证明不了消费方把它 import 后
  //     打包器真的会产出一份**含这些规则**的 CSS，也证明不了「不 import 就没有它」。
  //     这里用装出来的 tarball 跑两次 Vite 生产构建（带 / 不带 `styles.css`），判据在
  //     `consumer-styles-boundary.mts`。
  //
  //     basic 与 UI 消费方的边界（根入口不静态拉进可选 UI Kit）由
  //     `tests/behavior/ui-kit-entry.test.ts` 的真实 basic / UI 两次生产构建判，这里不重复。
  run(
    `node --experimental-strip-types ${JSON.stringify(resolve(root, 'scripts/consumer-styles.mts'))} ${JSON.stringify(consumerFixture)}`,
    root,
    'styles consumer (tarball + Vite production build)',
  )

  // 5c) 仓库外隔离项目里的**严格类型消费**（#158 工作包 A）。
  //
  //     上面那条 `vue-tsc` 跑在 `fixtures/consumer` 里，而那是 pnpm 工作区的成员：
  //     依赖提升 + 向工作区根的 `node_modules` 查找，都可能把本库**漏发**的类型从
  //     源码侧补回来，于是「包缺件」在门禁里看起来是绿的。这条把同一份严格探针搬进
  //     操作系统临时目录里的裸项目（手写 package.json + npm install tarball），
  //     并按 `bundler` / `node16` 两档各编译一次。
  //
  //     接线口径与工作包 E 的要求一致：**调同一个实现**，不在本文件里复刻一份安装 +
  //     tsc 的 shell。tarball 作为显式参数传下去——「验的是哪一个包」不能靠脚本自己去
  //     `.artifacts` 里猜。
  run(
    `node --experimental-strip-types ${JSON.stringify(resolve(root, 'scripts/consumer-isolated-strict.mts'))} ${JSON.stringify(tarball)}`,
    root,
    'isolated strict consumer (out-of-repo, bundler + node16)',
  )

  // 5d) 纯 Node 里的**真实 SFC SSR**（#158 工作包 B）。
  //
  //     上面那些 import / vue-tsc 证明不了「服务端能渲染含 <Map> 的组件」：它们不编译 SFC、
  //     也不调 renderToString。这条在**没有 happy-dom / jsdom**的 Node 里，用
  //     `@vue/compiler-sfc` 真实编译 fixture 的 `ssr/App.vue` 后 `renderToString`，
  //     并核对：容器 shell、`status=idle` 且服务端 `map === null`、官方 loader 仍是
  //     `notload`、全局无 `BMap`。
  //
  //     「环境是真实纯 Node」与「没有 DOM 访问」是两个结论、取证方式冲突，所以在**两个独立
  //     进程**里各跑一遍：`bare` 不注入任何全局（环境的 `typeof` / `in` / `hasOwn` 六条证据
  //     都指向「不存在」），`instrument` 才装记账 getter（`document` 读取必须 0、渲染阶段访问
  //     必须 0；import 阶段允许依赖的守卫式 `typeof window`）。细节见 runner 文件头。
  //
  //     `./ui-kit` 的无 DOM import 检查**保持不变**（上面 consumer 那条 ESM import 探针）：
  //     本库的安全包装入口必须在无 DOM 时可加载，而上游 `@baidumap/jsapi-ui-kit` 是浏览器实现
  //     （无 DOM 时求值即崩，见 `tests/behavior/ui-kit-ssr.test.ts`）。两者是不同结论，不能合并。
  //
  //     同样调同一个实现：判据在 `consumer-ssr-boundary.mts`，runner 与取证在 fixture 里。
  run(
    `node --experimental-strip-types ${JSON.stringify(resolve(root, 'scripts/consumer-ssr.mts'))} ${JSON.stringify(consumerFixture)}`,
    root,
    'SSR consumer (real SFC + renderToString, pure Node)',
  )

  // 5e) 第三方扩展 fixture（M8-ADAPTERS-ADVANCED / #43）
  //
  //     `./advanced` 是**承诺维护**的扩展契约（第三方 Provider / Driver / Handle / Plugin 适配点），
  //     所以它必须在真实消费方（tarball 装进 node_modules）里被**真正调用一次**，而不是只断言
  //     「import 得动」。类型面由 `fixtures/consumer/src/advanced-adapter.ts` 通过上面的
  //     `vue-tsc` 覆盖；这里补运行面的可观察行为。
  // 5f) Volar：**无本地 import 的真实 .vue 模板**经安装文档的 `compilerOptions.types`
  //     配置拿到 `GlobalComponents`（#158 工作包 C）。
  //
  //     这条曾真实失效：文档教用户写 `"types": ["<pkg>/volar"]`，而 `exports` 里没有
  //     `./volar`，于是 TypeScript 报 `TS2688`。`check:api` / `publint` / `attw` 都不解析
  //     `compilerOptions.types`，所以只有这里能拦。
  //
  //     旧版只放一个空 `volar-probe.ts` 让 `tsc` 解析一次 `types` 条目 —— 那只证明路径能解析，
  //     证明不了模板里的组件真的拿到了类型。现在用 `vue-tsc` 编译两份**只有 template 的 SFC**
  //     （结构上不可能有本地 import）：`positive.vue` 必须零诊断；`negative.vue` 必须命中
  //     TS2322（已有 prop 值类型写错）+ TS2339（slot 成员不存在）。判据落在反证上——组件若被
  //     当成未知元素或退化成 `any`，反证就不会报错。
  //
  //     判据在 `consumer-volar-boundary.mts`，探针与配置在 `fixtures/consumer/volar/`。
  run(
    `node --experimental-strip-types ${JSON.stringify(resolve(root, 'scripts/consumer-volar.mts'))} ${JSON.stringify(consumerFixture)}`,
    root,
    'Volar consumer (real .vue template, GlobalComponents)',
  )

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
      "} from '" + identity.name + "/advanced'",
      "import {",
      "  BUILTIN_PLUGIN_NAMES,",
      "  resolvePluginDefinition,",
      "  urlPluginDefinition,",
      "} from '" + identity.name + "/plugins'",
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

  // 5g) tree-shaking：**只用 `./advanced`** 的打包产物不得把组件带进来（#43）。
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
  const installedPkgPath = resolve(consumerFixture, 'node_modules', identity.installedDirName, 'package.json')
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
  const installedDist = resolve(consumerFixture, 'node_modules', identity.installedDirName, 'dist')
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
      "import { useControllableState } from '" + identity.name + "/composables'",
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
