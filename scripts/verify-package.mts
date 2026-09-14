#!/usr/bin/env node
/**
 * M0-05: verify-package
 *
 * 步骤:
 * 1. 在 .artifacts 内找到 v3 .tgz。
 * 2. 复制到 fixtures/v3-consumer 临时目录安装。
 * 3. 跑 vue-tsc 类型检查 + ESM 导入 smoke(v3 发布硬前提)。
 *
 * 用法:
 *   pnpm --filter baidu-map-gl-vue pack --pack-destination .artifacts
 *   node scripts/verify-package.mts
 */
import { execSync } from 'node:child_process'
import { readdirSync, existsSync, readFileSync, rmSync, copyFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifactsDir = resolve(root, '.artifacts')
const fixturesDir = resolve(root, 'fixtures')

function findTarball(): string {
  if (!existsSync(artifactsDir)) throw new Error('.artifacts not found; run: pnpm pack --pack-destination .artifacts')
  const tarballs = readdirSync(artifactsDir)
    .filter((f) => f.endsWith('.tgz'))
    .sort()
  if (tarballs.length === 0) throw new Error('No .tgz found in .artifacts')
  return resolve(artifactsDir, tarballs[tarballs.length - 1])
}

function run(cmd: string, cwd: string, label: string) {
  console.log(`\n[verify-package] ${label}: ${cmd}`)
  execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, CI: '1' } })
}

function copyTree(src: string, dest: string) {
  for (const entry of readdirSync(src, { withFileTypes: true })) {
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

function main() {
  const tarball = findTarball()
  console.log(`[verify-package] tarball: ${tarball}`)


  // 5) v3-consumer:从 v3 tarball 安装,类型检查 + ESM 导入(发布 v3 的硬前提)
  //    `./ui-kit` 子路径单独再 import 一次：它必须在**无 DOM 的 Node** 里可加载
  //    （上游 UI Kit 的 import 会崩，本库入口不得把它拉进静态图）。见 #73。
  const v3Consumer = setupFixture('v3-consumer')
  run(
    `npm install --no-audit --no-fund && npx vue-tsc --noEmit && node -e "import('baidu-map-gl-vue').then(m=>{if(!m.BMap||!m.createBMapPlugin)throw new Error('missing exports');console.log('v3-consumer ESM import OK')})" && node -e "import('baidu-map-gl-vue/ui-kit').then(m=>{for(const k of ['BPlaceAutocomplete','BPlaceSearch','BPlaceDetail','BRoutePlan','RoutePlanDrivingPolicy','loadUiKit','UI_KIT_STYLE_PATH'])if(!m[k])throw new Error('missing '+k);console.log('ui-kit subpath ESM import OK (no DOM, four components)')})"`,
    v3Consumer,
    'v3-consumer typecheck + ESM import (v3 tarball)',
  )

  // 6) 运行时依赖契约：默认在线路径委托官方 Loader（#71），因此发布包必须把它作为
  //    **精确锁定的运行时依赖**声明，并且真的能被消费者解析。
  //    只断言「能 import」不够：依赖漏声明时 tarball 里的 import 仍然会通过（产物内联），
  //    于是「普通消费者不额外手动配置」这条契约会静默失效。
  const installedPkgPath = resolve(v3Consumer, 'node_modules/baidu-map-gl-vue/package.json')
  const installedPkg = JSON.parse(readFileSync(installedPkgPath, 'utf8')) as {
    dependencies?: Record<string, string>
  }
  const declared = installedPkg.dependencies?.['@baidumap/jsapi-loader']
  if (declared !== '1.0.0') {
    throw new Error(
      `[verify-package] 发布包必须以 dependencies 精确锁定 @baidumap/jsapi-loader@1.0.0，实际为 ${String(declared)}`,
    )
  }
  const loaderPkgPath = resolve(v3Consumer, 'node_modules/@baidumap/jsapi-loader/package.json')
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

  // 7) 负向消费测试:消费者未安装官方类型包时,全局 `BMap.*` 必须不可用
  //    (公共声明不得泄漏官方命名空间;泄漏会让下面的类型检查意外通过)
  const negativeFile = resolve(v3Consumer, 'src/global-namespace-negative.ts')
  writeFileSync(negativeFile, 'export declare const leaked: BMap.Point\n')
  let leaked = false
  try {
    execSync('npx vue-tsc --noEmit', { cwd: v3Consumer, stdio: 'pipe', env: { ...process.env, CI: '1' } })
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
  const installedDist = resolve(v3Consumer, 'node_modules/baidu-map-gl-vue/dist')
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

  // ② IIFE 档（`<script>` 直引）必须已经折叠掉：浏览器里没有 `process`
  const globalBundle = resolve(installedDist, 'index.global.js')
  if (/[^.\w]process\.env/.test(readFileSync(globalBundle, 'utf8'))) {
    throw new Error(
      '[verify-package] IIFE 产物残留裸 `process.env`：浏览器里会抛 ReferenceError（见 vite.config.global.ts 的 define）',
    )
  }

  const devProbe = resolve(v3Consumer, 'dev-warn-probe.mjs')
  writeFileSync(
    devProbe,
    [
      "import { effectScope, ref } from 'vue'",
      "import { useControllableState } from 'baidu-map-gl-vue/composables'",
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
      cwd: v3Consumer,
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
