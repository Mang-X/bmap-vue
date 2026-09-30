#!/usr/bin/env node
/**
 * 由插件兼容 inventory 数据生成文档与 JSON
 *
 * 单一事实源：`packages/bmap-vue/src/plugins/compat-inventory.ts`
 *
 * 生成：
 * - docs/zh-CN/contributing/plugin-compat-inventory.md
 * - docs/.vitepress/plugin-inventory.json
 *
 * 生成文件顶部带 "Generated file. Do not edit directly."，且不写入时间戳（避免无意义 drift）。
 * CI（`.github/workflows/quality.yml` 的 `quality` job）用 `--check` 校验无漂移。
 *
 * 与 `generate-capability-matrix.mts` 同一套做法：数据模块里**不能**有运行时的无扩展名导入
 * （Node ESM 不解析），所以这里分别用文件 URL 载入数据模块与 URL 单一事实源，再在渲染时合并。
 *
 * 用法：
 *   node --experimental-strip-types scripts/generate-plugin-inventory.mts
 *   node --experimental-strip-types scripts/generate-plugin-inventory.mts --check
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freshModuleUrl } from './fresh-module-url.mts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(readFileSync(resolve(root, 'packages/bmap-vue/package.json'), 'utf8')) as { version: string }

const inventoryPath = resolve(
  root,
  'packages/bmap-vue/src/plugins/compat-inventory.ts',
)
const builtinsPath = resolve(root, 'packages/bmap-vue/src/plugins/builtins.ts')

interface Entry {
  id: string
  urlKey: string
  exposedGlobal: string
  required: boolean
  versionLock: { versioned: boolean; note: string }
  artifactDigest: { algo: string; value: string }
  sdkNamespaceMembers: readonly string[]
  manualInstanceChecks: readonly string[]
  hasPrivateSurface: boolean
  privateSurfaceNote: string
  selfInjectedMarkers: readonly string[]
  capability?: string
  verdict: string
  migrationPath: {
    kind: string
    target: string
    nativeComponent?: string
    note: string
  }
  basis: readonly string[]
  runtime?: {
    status: string
    detail: string
    covered: readonly string[]
    uncovered: readonly string[]
  }
  summary: string
  residualRisks: readonly string[]
}

const inventory = (await import(freshModuleUrl(inventoryPath))) as {
  PLUGIN_COMPAT_INVENTORY: readonly Entry[]
  PLUGIN_EVIDENCE_BASIS_MEANING: Record<string, string>
  PLUGIN_VERDICT_MEANING: Record<string, string>
}
const builtins = (await import(freshModuleUrl(builtinsPath))) as {
  BUILTIN_PLUGIN_URLS: Record<string, string>
}

const { PLUGIN_COMPAT_INVENTORY, PLUGIN_EVIDENCE_BASIS_MEANING, PLUGIN_VERDICT_MEANING } = inventory
const { BUILTIN_PLUGIN_URLS } = builtins

const codeList = (values: readonly string[]): string =>
  values.length === 0 ? '—' : values.map((v) => `\`${v}\``).join(', ')

/** 表格单元格里不能出现裸 `|`（会把列切开）——只转义竖线，其余 Markdown 原样保留。 */
const escapePipes = (text: string): string => text.replace(/\|/g, '\\|')

function renderMarkdown(): string {
  const lines: string[] = []

  lines.push('<!-- Generated file. Do not edit directly. -->')
  lines.push('')
  lines.push('# 插件兼容 inventory')
  lines.push('')
  lines.push(
    '> 由 `packages/bmap-vue/src/plugins/compat-inventory.ts` 生成，请勿手工编辑。',
  )
  lines.push('> 更新数据后运行 `pnpm generate:plugin-inventory`，CI 用 `--check` 校验无漂移。')
  lines.push('')
  lines.push(
    '这份清单覆盖 `plugins: [...]` 能识别的四个内置插件脚本。它区分**三类依据**：对锁定 URL 的',
  )
  lines.push(
    '真实发布产物的观察、与官方 `@baidumap/jsapi-v4-types` 声明的核对（**自动部分只到命名空间级成员**）、'
      + '以及真实运行时观察。',
  )
  lines.push('没有跑过的档位不写进依据——把「声明面没缺口」说成「兼容」是把结论说得比证据强。')
  lines.push('')
  lines.push(
    '三档各有自己的复现命令：`pnpm probe:plugin-runtime`（真实 4.0 + 真实 AK + 真实浏览器，' +
      'nightly 单独跑：它验的是**可选**插件，不进必需链路）、' +
      '`pnpm probe:plugin-compat`（真实发布产物 + 官方声明）、以及两者共用的生成物校验 ' +
      '`pnpm generate:plugin-inventory:check`。',
  )
  lines.push('')
  lines.push(
    '插件**脚本加载通道**自身的行为（超时 / 取消）由另一个探针覆盖：`pnpm probe:plugin-load-channel`' +
      '（真实浏览器 + 永不响应的地址；同样只在 nightly 跑）。',
  )
  lines.push('')

  lines.push('## 依据档位')
  lines.push('')
  lines.push('| 依据 | 含义 |')
  lines.push('| --- | --- |')
  for (const [basis, meaning] of Object.entries(PLUGIN_EVIDENCE_BASIS_MEANING)) {
    lines.push(`| \`${basis}\` | ${meaning} |`)
  }
  lines.push('')

  lines.push('## 结论取值')
  lines.push('')
  lines.push('| 结论 | 含义 |')
  lines.push('| --- | --- |')
  for (const [verdict, meaning] of Object.entries(PLUGIN_VERDICT_MEANING)) {
    lines.push(`| \`${verdict}\` | ${meaning} |`)
  }
  lines.push('')

  lines.push('## 清单')
  lines.push('')
  lines.push(
    '| 插件 | 锁定 URL | 版本锁定 | 内容摘要（sha256 前 12 位） | 暴露全局 | required | 引用的 SDK 命名空间成员 | 私有面 | 副作用标记 | 关联能力 | 结论 | 迁移路径 | 运行时 | 依据 |',
  )
  lines.push(
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  )
  for (const entry of PLUGIN_COMPAT_INVENTORY) {
    const url = BUILTIN_PLUGIN_URLS[entry.urlKey]
    lines.push(
      [
        `\`${entry.id}\``,
        url ? `\`${url.replace(/^https:\/\//, '')}\`` : `\`${entry.urlKey}\``,
        entry.versionLock.versioned ? '**有**' : '无（自托管镜像）',
        `\`${entry.artifactDigest.value.slice(0, 12)}…\``,
        `\`${entry.exposedGlobal}\``,
        entry.required ? '**true**' : 'false',
        codeList(entry.sdkNamespaceMembers),
        entry.hasPrivateSurface ? '**有**' : '无',
        entry.selfInjectedMarkers.length === 0
          ? '—'
          : codeList(entry.selfInjectedMarkers),
        entry.capability ? `\`${entry.capability}\`` : '—',
        `\`${entry.verdict}\``,
        `\`${entry.migrationPath.kind}\` → ${escapePipes(entry.migrationPath.target)}`,
        entry.runtime
          ? entry.runtime.status === 'threw'
            ? '**抛错**'
            : '已验证'
          : '—',
        entry.basis.map((b) => `\`${b}\``).join(', '),
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'),
    )
  }
  lines.push('')

  lines.push('## 逐条结论与残余风险')
  lines.push('')
  for (const entry of PLUGIN_COMPAT_INVENTORY) {
    lines.push(`### \`${entry.id}\``)
    lines.push('')
    lines.push(entry.summary)
    lines.push('')
    lines.push(`私有面：${entry.privateSurfaceNote}`)
    lines.push('')
    lines.push(
      entry.manualInstanceChecks.length === 0
        ? '成员核对：命名空间级成员由 `pnpm probe:plugin-compat` 自动核对；本条目的执行路径没有用到实例成员。'
        : '成员核对：命名空间级成员由 `pnpm probe:plugin-compat` 自动核对；**实例成员**（' +
            entry.manualInstanceChecks.join('、') +
            '）是**人工**对照 `@baidumap/jsapi-v4-types` 声明核对的，**不在自动门禁内**。',
    )
    lines.push('')
    lines.push(
      entry.runtime
        ? `运行时（\`pnpm probe:plugin-runtime\`）：${
            entry.runtime.status === 'threw' ? '**抛错**' : '**已验证最小路径**'
          } —— ${entry.runtime.detail}`
        : '运行时：未跑（依据里不含 `runtime`）。',
    )
    lines.push('')
    if (entry.runtime) {
      // 「已验证」不是一个布尔值：范围写出来，没覆盖的也写出来。留白会被读成「也验过了」。
      lines.push('**这条读数覆盖到**：')
      lines.push('')
      for (const step of entry.runtime.covered) lines.push(`- ${step}`)
      lines.push('')
      lines.push('**没覆盖**（写出来，别当成验过了）：')
      lines.push('')
      for (const step of entry.runtime.uncovered) lines.push(`- ${step}`)
      lines.push('')
    }
    lines.push(
      `迁移路径：\`${entry.migrationPath.kind}\` → ${entry.migrationPath.target}` +
        (entry.migrationPath.nativeComponent
          ? `（原生组件 \`${entry.migrationPath.nativeComponent}\`）`
          : ''),
    )
    lines.push('')
    lines.push(entry.migrationPath.note)
    lines.push('')
    lines.push(
      `版本锁定：${entry.versionLock.versioned ? '**自带版本号**' : '**未版本化**'} —— ${entry.versionLock.note}`,
    )
    lines.push('')
    lines.push(
      `内容摘要（\`${entry.artifactDigest.algo}\`，由 \`pnpm probe:plugin-compat\` 每次拉取后核对）：\`${entry.artifactDigest.value}\``,
    )
    lines.push('')
    if (entry.residualRisks.length > 0) {
      lines.push('残余风险（每条都写明去处）：')
      lines.push('')
      for (const risk of entry.residualRisks) lines.push(`- ${risk}`)
      lines.push('')
    }
  }

  lines.push('## 复现')
  lines.push('')
  lines.push('```bash')
  lines.push('# 从锁定 URL 拉取真实发布产物，重新抽取「引用的 SDK 成员 / 私有面 / 自注入脚本」，')
  lines.push('# 并与官方类型声明核对命名空间级成员（需要网络；不进 PR 门禁）。')
  lines.push('pnpm probe:plugin-compat')
  lines.push('')
  lines.push('# 只做本地无网络校验：数据模块、生成文档与 BUILTIN_PLUGIN_URLS 是否一致。')
  lines.push('pnpm generate:plugin-inventory:check')
  lines.push('```')
  lines.push('')

  return lines.join('\n')
}

function renderJson(): string {
  const payload = {
     version: packageJson.version,
    source: 'packages/bmap-vue/src/plugins/compat-inventory.ts',
    basisMeaning: PLUGIN_EVIDENCE_BASIS_MEANING,
    verdictMeaning: PLUGIN_VERDICT_MEANING,
    plugins: PLUGIN_COMPAT_INVENTORY.map((entry) => ({
      id: entry.id,
      urlKey: entry.urlKey,
      url: BUILTIN_PLUGIN_URLS[entry.urlKey] ?? null,
      exposedGlobal: entry.exposedGlobal,
      required: entry.required,
      versionLock: entry.versionLock,
      artifactDigest: entry.artifactDigest,
      sdkNamespaceMembers: entry.sdkNamespaceMembers,
      manualInstanceChecks: entry.manualInstanceChecks,
      hasPrivateSurface: entry.hasPrivateSurface,
      privateSurfaceNote: entry.privateSurfaceNote,
      selfInjectedMarkers: entry.selfInjectedMarkers,
      ...(entry.capability ? { capability: entry.capability } : {}),
      verdict: entry.verdict,
      migrationPath: entry.migrationPath,
      basis: entry.basis,
      ...(entry.runtime ? { runtime: entry.runtime } : {}),
      summary: entry.summary,
      residualRisks: entry.residualRisks,
    })),
  }
  return JSON.stringify(payload, null, 2) + '\n'
}

const markdownPath = resolve(root, 'docs/zh-CN/contributing/plugin-compat-inventory.md')
const jsonPath = resolve(root, 'docs/.vitepress/plugin-inventory.json')

const markdown = renderMarkdown()
const json = renderJson()

const check = process.argv.includes('--check')

if (!check) {
  writeFileSync(markdownPath, markdown)
  writeFileSync(jsonPath, json)
  console.log(`[plugin-inventory] ${PLUGIN_COMPAT_INVENTORY.length} plugins`)
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
    console.error('[plugin-inventory] DRIFT detected in:')
    for (const file of drift) console.error(`  ${file}`)
    console.error('  run: pnpm generate:plugin-inventory')
    // 用 exitCode 而不是 process.exit()：后者会跳过 finally（与本仓库其它脚本同一约定）
    process.exitCode = 1
  }
  if (drift.length === 0) {
    console.log(
      `[plugin-inventory] OK, no drift (${PLUGIN_COMPAT_INVENTORY.length} plugins, URL keys: ${Object.keys(BUILTIN_PLUGIN_URLS).join(', ')}).`,
    )
  }
}
