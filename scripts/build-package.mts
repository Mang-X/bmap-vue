#!/usr/bin/env node
/**
 * 包构建脚本
 *
 * 说明(方案 §5.5 fallback):
 * - tsdown/rolldown 的 dts 与 code splitting 不兼容(共享 chunk 无对应声明,
 *   导致组件 props 类型丢失),因此采用方案授权的「独立的 Vite library build」:
 *   1. vite lib build → dist/*.mjs(ESM,external vue)
 *   2. vite-plugin-dts bundleTypes → dist/*.d.ts(单文件聚合声明,props/emits 完整)
 *   3. vite iife → dist/index.global.js(CDN,external Vue + window.Vue)
 *
 * 用法: node --experimental-strip-types scripts/build-package.mts
 */
import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkgRoot = resolve(root, 'packages/bmap-vue')

function run(cmd: string, cwd: string) {
  console.log(`[build-package] ${cmd}`)
  execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, CI: '1' } })
}

console.log('[build-package] cleaning dist...')
rmSync(resolve(pkgRoot, 'dist'), { recursive: true, force: true })

console.log('[build-package] vite lib build (ESM + bundleTypes dts)...')
run(`./node_modules/.bin/vite build --config vite.config.build.ts`, pkgRoot)

console.log('[build-package] vite iife (CDN global, external Vue)...')
run(`./node_modules/.bin/vite build --config vite.config.global.ts`, pkgRoot)

console.log('[build-package] done.')
