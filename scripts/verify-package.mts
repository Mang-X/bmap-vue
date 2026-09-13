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
import { readdirSync, existsSync, rmSync, copyFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
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
    `npm install --no-audit --no-fund && npx vue-tsc --noEmit && node -e "import('baidu-map-gl-vue').then(m=>{if(!m.BMap||!m.createBMapPlugin)throw new Error('missing exports');console.log('v3-consumer ESM import OK')})" && node -e "import('baidu-map-gl-vue/ui-kit').then(m=>{for(const k of ['BPlaceAutocomplete','BPlaceSearch','loadUiKit','UI_KIT_STYLE_PATH'])if(!m[k])throw new Error('missing '+k);console.log('ui-kit subpath ESM import OK (no DOM)')})"`,
    v3Consumer,
    'v3-consumer typecheck + ESM import (v3 tarball)',
  )

  // 6) 负向消费测试:消费者未安装官方类型包时,全局 `BMap.*` 必须不可用
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

  console.log('\n[verify-package] ALL PASSED')
}

main()
