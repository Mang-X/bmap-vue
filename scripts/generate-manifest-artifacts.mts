#!/usr/bin/env node
/**
 * M7-01: 从 manifest 生成公开人工产物
 *
 * 生成:
 * - packages/bmap-vue/src/components/index.ts(确保与 manifest 一致)
 * - packages/bmap-vue/volar.d.ts(Volar GlobalComponents)
 * - docs/.vitepress/component-index.json(文档组件索引)
 *
 * 生成文件顶部带 "Generated file. Do not edit directly."
 *
 * `--check` 对**受版本控制的**生成文件（`src/components/index.ts`、
 * `docs/.vitepress/component-index.json`）做只读比对，发现漂移即失败。
 * （此前的 `--check` 先写盘再比对刚写出的内容，恒等于无漂移，是一道失效门禁。）
 *
 * `volar.d.ts` 被 `.gitignore` 忽略，属于「只生成、不提交」的发布产物，没有可比对的
 * 版本控制基线，因此两种模式下都直接生成而不是当作漂移目标。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freshModuleUrl } from './fresh-module-url.mts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(readFileSync(resolve(root, 'packages/bmap-vue/package.json'), 'utf8')) as { version: string }
const manifestSrc = resolve(root, 'packages/bmap-vue/src/manifest.ts')
const check = process.argv.includes('--check')

// 动态加载 manifest(纯数据 .ts,node --experimental-strip-types 可解析;
// 避免正则对 oxfmt 格式化后的多行/双引号格式敏感)。
// 必须走 file: URL,直接拼 `path + '?t='` 在 Windows 上会被 ESM 加载器拒绝。
const { componentManifest } = (await import(freshModuleUrl(manifestSrc))) as {
  componentManifest: { name: string; exportName: string; source: string }[]
}
const names = componentManifest.map((c) => ({
  name: c.name,
  exportName: c.exportName,
  source: c.source,
}))

const componentsIndexPath = resolve(root, 'packages/bmap-vue/src/components/index.ts')
const volarDtsPath = resolve(root, 'packages/bmap-vue/volar.d.ts')
const componentIndexJsonPath = resolve(root, 'docs/.vitepress/component-index.json')

// 1) components/index.ts
const componentsIndex = [
  '// Generated file. Do not edit directly.',
  ...names.map((c) => `export { default as ${c.exportName} } from './${toPath(c.source)}'`),
  '',
].join('\n')

// 2) volar.d.ts(精确类型:Volar 通过 typeof import 解析组件真实 props/emits)
//    vue-tsc 2(新 Volar)读 module 'vue';v2 时代读 '@vue/runtime-core';双声明兼容
const componentsLines = names.map((c) => `    ${c.name}: typeof import('bmap-vue')['${c.name}']`)
const volarDts = [
  '// Generated file. Do not edit directly.',
  'declare module \'vue\' {',
  '  export interface GlobalComponents {',
  ...componentsLines,
  '  }',
  '}',
  'declare module \'@vue/runtime-core\' {',
  '  export interface GlobalComponents {',
  ...componentsLines,
  '  }',
  '}',
  'export {}',
  '',
].join('\n')

// 3) component index json(generatedAt 为生成时刻,比对时忽略)
const json = {
   version: packageJson.version,
  generatedAt: new Date().toISOString(),
  components: names.map((c) => c.name),
}
const componentIndexJson = JSON.stringify(json, null, 2) + '\n'

// volar.d.ts 不在版本控制内(见 .gitignore)，是纯发布产物：两种模式都生成。
// 保留这一行为也确保 `pnpm pack` 之前该文件存在，发布产物内容不变。
writeFileSync(volarDtsPath, volarDts)

if (!check) {
  writeFileSync(componentsIndexPath, componentsIndex)
  writeFileSync(componentIndexJsonPath, componentIndexJson)
}

console.log(`[generate-manifest] ${names.length} components`)
console.log(`  ${check ? 'checked' : 'wrote'} src/components/index.ts`)
console.log(`  wrote volar.d.ts (generated artifact, not tracked)`)
console.log(`  ${check ? 'checked' : 'wrote'} docs/.vitepress/component-index.json`)

if (!check) {
  console.log('  CHECK MODE: run with --check to verify no drift')
}

// --check 模式:只读比对受版本控制的文件,不写盘
if (check) {
  const drift: string[] = []

  const currentIndex = existsSync(componentsIndexPath) ? readFileSync(componentsIndexPath, 'utf-8') : ''
  if (currentIndex !== componentsIndex) drift.push('src/components/index.ts')

  // generatedAt 每次生成都不同,只比对稳定字段
  const currentJson = existsSync(componentIndexJsonPath)
    ? readFileSync(componentIndexJsonPath, 'utf-8')
    : ''
  if (!jsonMatches(currentJson, json)) drift.push('docs/.vitepress/component-index.json')

  if (drift.length > 0) {
    console.error('[generate-manifest] DRIFT detected in:')
    for (const file of drift) console.error(`  ${file}`)
    console.error('  run: pnpm generate:manifest')
    process.exit(1)
  }
  console.log('[generate-manifest] OK, no drift.')
}

/** 忽略易变字段(generatedAt)后比较 JSON 内容。 */
function jsonMatches(current: string, expected: Record<string, unknown>): boolean {
  if (!current) return false
  try {
    const parsed = JSON.parse(current) as Record<string, unknown>
    const strip = (value: Record<string, unknown>): string =>
      JSON.stringify(value, (key, val) => (key === 'generatedAt' ? undefined : val))
    return strip(parsed) === strip(expected)
  } catch {
    return false
  }
}

/**
 * manifest 的 `source`（`./components/<相对路径>`）→ `components/index.ts` 里的相对说明符。
 *
 * 曾经这里是一张**手写的 exportName → 路径**表，与 manifest 的 `source` 各自漂移：新增一个
 * 组件只改 manifest 时，生成出来的 import 会退化成 `./NavigationControl` 这种不存在的路径
 * （M7-CONTROL-PANORAMA / #41 实测），而且失败发生在**测试运行时**而不是生成时。
 * 现在路径只有一个事实源（manifest 的 `source`），本函数只做前缀剥离。
 *
 * 合并说明（M7-LAYERS / #40 × #41）：本 PR 早先是在那张手写表上补了 8 个图层，
 * 这里取 #41 的派生版——**图层那 8 个入口不需要在表里再登记一次**，
 * 只要 manifest 的 `source` 正确就自动生成。
 */
function toPath(source: string): string {
  const relative = source.startsWith('./components/') ? source.slice('./components/'.length) : source
  return relative.replace(/^\.\//, '')
}
