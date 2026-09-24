#!/usr/bin/env node
/**
 * M3A0-06: 由 Capability Catalog 数据生成能力矩阵
 *
 * 生成（单一事实源：packages/bmap-vue/src/driver/capability/catalog.ts）：
 * - docs/zh-CN/contributing/capability-matrix.md
 * - docs/.vitepress/capability-catalog.json
 *
 * 生成文件顶部带 "Generated file. Do not edit directly."，
 * 且不写入时间戳（避免无意义的 drift）。
 *
 * 用法：
 *   node --experimental-strip-types scripts/generate-capability-matrix.mts
 *   node --experimental-strip-types scripts/generate-capability-matrix.mts --check
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freshModuleUrl } from './fresh-module-url.mts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(readFileSync(resolve(root, 'packages/bmap-vue/package.json'), 'utf8')) as { version: string }
const catalogPath = resolve(
  root,
  'packages/bmap-vue/src/driver/capability/catalog.ts',
)

interface Descriptor {
  id: string
  family: string
  description: string
  rawMembers?: readonly string[]
  status: string
  runtimeOnly: boolean
}

// 用 file: URL 而非 `catalogPath + '?t='`，否则 Windows 上会因
// `C:\...` 被判为非法 scheme（ERR_UNSUPPORTED_ESM_URL_SCHEME）。
const catalog = (await import(freshModuleUrl(catalogPath))) as {
  CAPABILITY_CATALOG: Record<string, Descriptor>
  CAPABILITY_IDS: readonly string[]
  CAPABILITY_FAMILIES: readonly string[]
  CAPABILITY_STATUSES: readonly string[]
}

const { CAPABILITY_CATALOG, CAPABILITY_IDS, CAPABILITY_FAMILIES, CAPABILITY_STATUSES } = catalog

const STATUS_MEANING: Record<string, string> = {
  native: 'SDK 原生能力，直接映射官方 API',
  extended: '项目在 SDK 之上的扩展能力（需要额外实现或组合）',
  experimental: '实验性能力，API 可能变更或移除',
  unsupported: '明确不支持；`supports()` 恒为 false（用户 override 除外）',
}

const mark = (value: boolean): string => (value ? '✓' : '—')

function renderMarkdown(): string {
  const lines: string[] = []

  lines.push('<!-- Generated file. Do not edit directly. -->')
  lines.push('')
  lines.push('# Capability Catalog 能力矩阵')
  lines.push('')
  lines.push(
    '> 由 `packages/bmap-vue/src/driver/capability/catalog.ts` 生成，请勿手工编辑。',
  )
  lines.push('> 更新 Catalog 后运行 `pnpm generate:capability-matrix`，CI 用 `--check` 校验无漂移。')
  lines.push('')
  lines.push(`能力总数：**${CAPABILITY_IDS.length}**`)
  lines.push('')

  lines.push('## 状态说明')
  lines.push('')
  lines.push('| 状态 | 含义 | 数量 |')
  lines.push('| --- | --- | --- |')
  for (const status of CAPABILITY_STATUSES) {
    const count = CAPABILITY_IDS.filter((id) => CAPABILITY_CATALOG[id].status === status).length
    lines.push(`| \`${status}\` | ${STATUS_MEANING[status] ?? ''} | ${count} |`)
  }
  lines.push('')

  lines.push('## 家族分布')
  lines.push('')
  lines.push('| 家族 | 能力数 |')
  lines.push('| --- | --- |')
  for (const family of CAPABILITY_FAMILIES) {
    const count = CAPABILITY_IDS.filter((id) => CAPABILITY_CATALOG[id].family === family).length
    lines.push(`| \`${family}\` | ${count} |`)
  }
  lines.push('')

  lines.push('## 能力矩阵')
  lines.push('')
  lines.push(
    '「运行时探测」表示该能力只能通过实例/原型成员在运行时探测（官方类型包无对应静态声明）。',
  )
  lines.push('')
  lines.push(
    '单引擎基线（#26 删除 `webgl-v1` / `jsapi-v3`，#126 结算退化维度）：能力目录**不再**按引擎区分，' +
      '因此没有引擎列——所有条目都面向当前唯一引擎 `jsapi-v4`。',
  )
  lines.push('')

  const headerCells = ['家族', '能力', '状态', '运行时探测', 'raw members', '说明']
  lines.push(`| ${headerCells.join(' | ')} |`)
  lines.push(`| ${headerCells.map(() => '---').join(' | ')} |`)

  for (const family of CAPABILITY_FAMILIES) {
    for (const id of CAPABILITY_IDS) {
      const d = CAPABILITY_CATALOG[id]
      if (d.family !== family) continue
      const members = (d.rawMembers ?? []).join(', ') || '—'
      const cells = [
        family,
        `\`${id}\``,
        d.status,
        mark(d.runtimeOnly),
        members,
        d.description,
      ]
      lines.push(`| ${cells.join(' | ')} |`)
    }
  }
  lines.push('')

  return lines.join('\n')
}

function renderJson(): string {
  const payload = {
     version: packageJson.version,
    source: 'packages/bmap-vue/src/driver/capability/catalog.ts',
    families: CAPABILITY_FAMILIES,
    statuses: CAPABILITY_STATUSES,
    // #126：单引擎收口后不再输出 engines（原先的 `engines` / 每条 `engines` 字段已删）。
    capabilities: CAPABILITY_IDS.map((id) => {
      const d = CAPABILITY_CATALOG[id]
      return {
        id: d.id,
        family: d.family,
        status: d.status,
        runtimeOnly: d.runtimeOnly,
        rawMembers: d.rawMembers ?? [],
        description: d.description,
      }
    }),
  }
  return JSON.stringify(payload, null, 2) + '\n'
}

const markdownPath = resolve(root, 'docs/zh-CN/contributing/capability-matrix.md')
const jsonPath = resolve(root, 'docs/.vitepress/capability-catalog.json')

const markdown = renderMarkdown()
const json = renderJson()

const check = process.argv.includes('--check')

if (!check) {
  writeFileSync(markdownPath, markdown)
  writeFileSync(jsonPath, json)
  console.log(`[capability-matrix] ${CAPABILITY_IDS.length} capabilities`)
  console.log(`  wrote ${relative(root, markdownPath)}`)
  console.log(`  wrote ${relative(root, jsonPath)}`)
} else {
  const drift: string[] = []
  for (const [path, expected] of [
    [markdownPath, markdown],
    [jsonPath, json],
  ] as const) {
    const current = existsSync(path) ? readFileSync(path, 'utf-8') : ''
    if (current !== expected) drift.push(relative(root, path))
  }
  if (drift.length > 0) {
    console.error('[capability-matrix] DRIFT detected in:')
    for (const file of drift) console.error(`  ${file}`)
    console.error('  run: pnpm generate:capability-matrix')
    process.exit(1)
  }
  console.log(`[capability-matrix] OK, no drift (${CAPABILITY_IDS.length} capabilities).`)
}
