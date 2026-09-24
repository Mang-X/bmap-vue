#!/usr/bin/env node
/**
 * 后处理 dist/*.d.ts:相对 import 补 .js 扩展名
 *
 * vite-plugin-dts 输出未加扩展名的相对引用,node16 ESM 解析要求显式扩展名。
 * 本脚本把 `from './xxx'` / `export * from './xxx'` 改为 `./xxx.js`
 * (TS 会把 './xxx.js' 解析到 './xxx.d.ts',bundler 与 node16 均通过)。
 *
 * 用法: node --experimental-strip-types scripts/fix-dts-extensions.mts
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distRoot = resolve(root, 'packages/bmap-vue/dist')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(p))
    else if (entry.name.endsWith('.d.ts')) out.push(p)
  }
  return out
}

let total = 0
for (const file of walk(distRoot)) {
  const src = readFileSync(file, 'utf8')
  const pat = /(from\s+['"])(\.\.?\/[^'"]+?)(['"])|(export\s+\*\s+from\s+['"])(\.\.?\/[^'"]+?)(['"])/g
  let changed = false
  const out = src.replace(pat, (m, g1, g2, g3, g4, g5, g6) => {
    const path = g2 ?? g5
    const pre = g1 ?? g4
    const suf = g3 ?? g6
    // 跳过已有扩展名与 .vue/.json
    if (/\.(vue|json|js|mjs|cjs|ts|mts|cts|css|d\.ts)$/.test(path)) return m
    changed = true
    return `${pre}${path}.js${suf}`
  })
  if (changed) {
    writeFileSync(file, out)
    total++
  }
}
console.log(`[fix-dts-extensions] updated ${total} d.ts files`)
