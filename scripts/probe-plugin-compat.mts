#!/usr/bin/env node
/**
 * 插件兼容探针（M3A3-07 / issue #25）
 *
 * 这份探针是 `docs/zh-CN/contributing/plugin-compat-inventory.md` 那张表的**证据生成器**：
 * 它从 `BUILTIN_PLUGIN_URLS` 锁定的 URL 拉取**真实发布产物**，把「脚本引用了 SDK 的哪些成员 /
 * 有没有碰私有面 / 有没有自己注入外部脚本」抽出来，再与官方 `@baidumap/jsapi-v4-types`
 * 的声明索引逐成员核对，最后与仓库里 checked-in 的 inventory 比对。
 *
 * 为什么要有它：inventory 里几列（`sdkNamespaceMembers` / `privateSurface` /
 * `selfInjectedMarkers`）是**从产物里抽出来的观察值**。没有可复现的抽取过程，这些值就只是
 * 「某人曾经读过一遍 minified 源码」，下一个人无法判断它是不是过期了。
 *
 * 判定口径（与 `scripts/probe-official-packages.mts` 同一套，两档必须分开）：
 *
 * | 结论 | 触发 | 退出码影响 |
 * | --- | --- | --- |
 * | `pass` | 产物可取得，抽取结果与 inventory 完全一致 | 无 |
 * | `fail` | 产物可取得，但抽取结果与 inventory 不符（或锁定 URL 返回 4xx） | 1 |
 * | `blocked` | 网络 / CDN 不可用、超时、5xx —— 本轮无法判定 | 3 |
 *
 * 退出码：`0` 全 pass；`1` 有 fail；`3` 只有 blocked；`2` 脚手架失败（读不到数据模块 /
 * 类型包）。**blocked 不是通过**，所以只有 `0` 可以放行。
 *
 * 不进 PR 门禁：它需要网络。放 nightly / 手工执行更合适（`pnpm probe:plugin-compat`）。
 *
 * 用法：
 *   pnpm probe:plugin-compat
 *   pnpm probe:plugin-compat -- --json=/tmp/plugin-compat.json
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freshModuleUrl } from './fresh-module-url.mts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const jsonOut = args.find((a) => a.startsWith('--json='))?.slice('--json='.length)
const timeoutMs = Number(
  args.find((a) => a.startsWith('--timeout='))?.slice('--timeout='.length) ?? 20_000,
)

/** 脚手架失败：拿不到数据模块 / 类型包 —— 与「探针跑出结论」是两件事。 */
class ScaffoldError extends Error {}
/** 取不到产物（网络 / 超时 / 5xx）：本轮无法判定，不能算通过。 */
class BlockedError extends Error {}

interface Entry {
  id: string
  urlKey: string
  exposedGlobal: string
  required: boolean
  sdkNamespaceMembers: readonly string[]
  hasPrivateSurface: boolean
  privateSurfaceNote: string
  selfInjectedMarkers: readonly string[]
  capability?: string
  verdict: string
}

interface Observation {
  id: string
  url: string
  status: 'pass' | 'fail' | 'blocked'
  code?: string
  bytes?: number
  /** 抽取到的「最后一个点号段」赋值点（用于核对 exposedGlobal）。 */
  exposedOk?: boolean
  sdkNamespaceMembers?: string[]
  privateSurface?: string[]
  missingMarkers?: string[]
  missingDeclarations?: string[]
  diffs: string[]
  error?: string
  durationMs: number
}

function fail(message: string): never {
  throw new ScaffoldError(message)
}

/* -------------------------------------------------------------------------- */
/* 数据模块与官方声明索引                                                       */
/* -------------------------------------------------------------------------- */

const inventoryPath = resolve(root, 'packages/baidu-map-gl-vue/src/plugins/compat-inventory.ts')
const builtinsPath = resolve(root, 'packages/baidu-map-gl-vue/src/plugins/builtins.ts')

async function loadData(): Promise<{
  entries: readonly Entry[]
  urls: Record<string, string>
  typesVersion: string
  declarationNames: Set<string>
}> {
  let entries: readonly Entry[]
  let urls: Record<string, string>
  try {
    const inventory = (await import(freshModuleUrl(inventoryPath))) as {
      PLUGIN_COMPAT_INVENTORY: readonly Entry[]
    }
    const builtins = (await import(freshModuleUrl(builtinsPath))) as {
      BUILTIN_PLUGIN_URLS: Record<string, string>
    }
    entries = inventory.PLUGIN_COMPAT_INVENTORY
    urls = builtins.BUILTIN_PLUGIN_URLS
  } catch (error) {
    fail(`读不到 inventory / builtins 数据模块：${(error as Error).message}`)
  }
  if (entries.length === 0) fail('inventory 为空，探针没有可核对的对象')

  // 官方类型包：用**包自身**的 package.json 解析，避免依赖调用方的 cwd。
  const pkgJson = resolve(root, 'packages/baidu-map-gl-vue/package.json')
  let typesDir: string
  let typesVersion: string
  try {
    const require = createRequire(pkgJson)
    const typesPkgJsonPath = require.resolve('@baidumap/jsapi-v4-types/package.json')
    const typesPkgJson = JSON.parse(readFileSync(typesPkgJsonPath, 'utf8')) as {
      types?: string
      version?: string
    }
    typesVersion = typesPkgJson.version ?? 'unknown'
    typesDir = dirname(typesPkgJsonPath)
  } catch (error) {
    fail(`解析 @baidumap/jsapi-v4-types 失败：${(error as Error).message}`)
  }

  const files: string[] = []
  const walk = (dir: string): void => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      if (item.name === 'node_modules') continue
      const full = join(dir, item.name)
      if (item.isDirectory()) walk(full)
      else if (item.name.endsWith('.d.ts')) files.push(full)
    }
  }
  walk(typesDir)
  if (files.length === 0) fail(`类型包 ${typesDir} 下没有 .d.ts`)

  // 声明索引：只取「名字被声明过」这一层事实。
  // 有意做得**保守**（不区分 BMap / MapVGL 命名空间，也把类成员一并收进来）：它只用于回答
  // 「这个名字在官方声明里存在吗」，宽松方向是「少报缺口」，不会制造假缺口。
  const declarationNames = new Set<string>()
  const namePattern =
    /^\s*(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:class|interface|enum|type|const|let|var|function)\s+([A-Za-z_$][\w$]*)/gm
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(namePattern)) declarationNames.add(match[1]!)
  }
  if (declarationNames.size === 0) fail('声明索引为空 —— 判定式可能写歪了')

  return { entries, urls, typesVersion, declarationNames }
}

/* -------------------------------------------------------------------------- */
/* 产物抽取                                                                     */
/* -------------------------------------------------------------------------- */

function extractSdkNamespaceMembers(source: string): string[] {
  const found = new Set<string>()
  for (const match of source.matchAll(/\bBMapGL\.([A-Za-z_$][\w$]*)/g)) {
    if (!match[1]!.startsWith('_')) found.add(match[1]!)
  }
  return [...found].sort()
}

function extractPrivateSurface(source: string): string[] {
  const found = new Set<string>()
  for (const match of source.matchAll(/\bBMapGL\.(_[A-Za-z_$][\w$]*)/g)) {
    found.add(`BMapGL.${match[1]!}`)
  }
  return [...found].sort()
}

/**
 * `exposedGlobal`（如 `window.BMapGLLib.TrackAnimation` / `window.mapvgl`）是否真的被脚本创建。
 *
 * 只核对**最后一段**被赋过值（`BMapGLLib.TrackAnimation=` / `z.mapvgl={}`）——它证的是
 * 「脚本确实会创建这个全局」，不证「它挂在 window 上」。这条口径刻意保守：UMD 包装器
 * （MapVGL 的 `(z=z||self, ja(z.mapvgl={}))`）不会出现 `window.mapvgl=` 这种字面量。
 */
function checkExposedGlobal(source: string, exposedGlobal: string): boolean {
  const last = exposedGlobal.split('.').pop() ?? exposedGlobal
  return new RegExp(String.raw`\.${last}\s*=`).test(source)
}

function fetchArtifact(url: string): Promise<{ source: string; bytes: number }> {
  return fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  })
    .then(async (response) => {
      if (response.status >= 500) {
        throw new BlockedError(`HTTP ${response.status}（CDN 侧故障，本轮无法判定）`)
      }
      if (!response.ok) {
        // 4xx：锁定 URL 失效是**事实**，不是环境问题。
        throw new Error(`HTTP ${response.status}（锁定 URL 已失效）`)
      }
      const source = await response.text()
      return { source, bytes: Buffer.byteLength(source, 'utf8') }
    })
    .catch((error: unknown) => {
      if (error instanceof BlockedError) throw error
      if (error instanceof Error && /^HTTP 4\d\d/.test(error.message)) throw error
      throw new BlockedError(`取不到产物：${(error as Error).message}`)
    })
}

/* -------------------------------------------------------------------------- */
/* 主流程                                                                       */
/* -------------------------------------------------------------------------- */

async function main(): Promise<number> {
  const { entries, urls, typesVersion, declarationNames } = await loadData()

  /**
 * 核对范围声明（评审 #85 P2-1）。本探针**只**做命名空间级存在性核对：抽取产物里的
 * `BMapGL.<Member>`，再与官方声明索引比对。`Map#getViewport` 这类**实例成员不在其中** ——
 * minified 产物里被调用的方法名无法可靠归到 owner 类型上。这条边界必须印在输出里，
 * 否则读者会以为「实例成员也被自动校验了」（owner/member 级校验属 #43）。
 */
const CHECK_SCOPE =
  "namespace-level members only（BMapGL.<Member> 的存在性核对）；" +
  "实例成员（Owner#member）不在自动门禁内 —— 见 inventory 的 manualInstanceChecks"

console.log(`[plugin-compat] official types: @baidumap/jsapi-v4-types@${typesVersion}`)
console.log(`[plugin-compat] check scope: ${CHECK_SCOPE}`)
  console.log(`[plugin-compat] inventory: ${entries.length} plugins, timeout ${timeoutMs}ms`)
  console.log('')

  const observations: Observation[] = []

  for (const entry of entries) {
    const started = Date.now()
    const url = urls[entry.urlKey]
    const diffMessages: string[] = []
    let observation: Observation = {
      id: entry.id,
      url: url ?? `(missing urlKey: ${entry.urlKey})`,
      status: 'blocked',
      diffs: diffMessages,
      durationMs: 0,
    }

    try {
      if (!url) throw new ScaffoldError(`BUILTIN_PLUGIN_URLS 里没有键 ${entry.urlKey}`)
      const { source, bytes } = await fetchArtifact(url)

      const sdkNamespaceMembers = extractSdkNamespaceMembers(source)
      const privateSurface = extractPrivateSurface(source)
      const exposedOk = checkExposedGlobal(source, entry.exposedGlobal)

      const expectedMembers = [...entry.sdkNamespaceMembers].sort()
      const missingMembers = expectedMembers.filter((name) => !sdkNamespaceMembers.includes(name))
      const extraMembers = sdkNamespaceMembers.filter((name) => !expectedMembers.includes(name))
      if (missingMembers.length > 0) {
        diffMessages.push(`inventory 声明但产物里找不到的 SDK 成员：${missingMembers.join(', ')}`)
      }
      if (extraMembers.length > 0) {
        diffMessages.push(`产物引用了但 inventory 没记的 SDK 成员：${extraMembers.join(', ')}`)
      }

      // 私有面：inventory 只声明「有没有」（见 compat-inventory.ts 的口径说明），这里比对
      // 「抽到的集合是否为空」——既不会因为上游换了成员名而假绿，也不需要在生产源码里写出
      // 完整访问形态（那会撞上私有面门禁）。
      const actualHasPrivate = privateSurface.length > 0
      if (actualHasPrivate !== entry.hasPrivateSurface) {
        diffMessages.push(
          `私有面结论不符：inventory 声明 ${entry.hasPrivateSurface ? '有' : '无'}，` +
            `产物里抽到 ${actualHasPrivate ? privateSurface.join(', ') : '（无）'}`,
        )
      }

      const missingMarkers = entry.selfInjectedMarkers.filter((marker) => !source.includes(marker))
      if (missingMarkers.length > 0) {
        diffMessages.push(`副作用标记在产物里找不到：${missingMarkers.join(', ')}`)
      }

      if (!exposedOk) {
        diffMessages.push(`暴露全局 \`${entry.exposedGlobal}\` 在产物里没有对应的赋值点`)
      }

      // 声明面核对：inventory 声称「引用的成员在 4.0.4 声明里没有缺口」。
      // 出现缺口说明上游把成员删了 / 脚本改了 —— 这时 inventory 必须更新，探针变红是正确行为。
      const missingDeclarations = sdkNamespaceMembers.filter((name) => !declarationNames.has(name))
      if (missingDeclarations.length > 0) {
        diffMessages.push(`官方声明里找不到这些成员（需更新 inventory）：${missingDeclarations.join(', ')}`)
      }

      observation = {
        ...observation,
        status: diffMessages.length === 0 ? 'pass' : 'fail',
        code: diffMessages.length === 0 ? undefined : 'INVENTORY_DRIFT',
        bytes,
        exposedOk,
        sdkNamespaceMembers,
        privateSurface,
        missingMarkers,
        missingDeclarations,
        durationMs: Date.now() - started,
      }
    } catch (error) {
      observation = {
        ...observation,
        status: error instanceof BlockedError ? 'blocked' : 'fail',
        code:
          error instanceof BlockedError
            ? 'ARTIFACT_UNAVAILABLE'
            : error instanceof ScaffoldError
              ? 'SCAFFOLD'
              : 'ARTIFACT_HTTP_ERROR',
        error: (error as Error).message,
        durationMs: Date.now() - started,
      }
    }

    observations.push(observation)
  }

  /* -------------------------------------------------------------------------- */
  /* 报告                                                                         */
  /* -------------------------------------------------------------------------- */

  const pad = (value: string, width: number): string =>
    [...value].length >= width ? value : value + ' '.repeat(width - [...value].length)

  console.log('| 插件 | 结论 | 产物大小 | 引用的 SDK 成员 | 私有面 | 备注 |')
  console.log('| --- | --- | --- | --- | --- | --- |')
  for (const o of observations) {
    const note =
      o.status === 'pass'
        ? '—'
        : o.error
          ? o.error
          : o.diffs.length > 0
            ? o.diffs.join('；')
            : '—'
    console.log(
      `| ${o.id} | ${o.status}${o.code ? ` (${o.code})` : ''} | ${o.bytes ?? '—'} | ${
        o.sdkNamespaceMembers?.join(', ') || '—'
      } | ${o.privateSurface?.join(', ') || '—'} | ${note} |`,
    )
  }
  console.log('')

  for (const o of observations) {
    console.log(`${pad(o.id, 18)} ${pad(o.status, 8)} ${pad(`${o.durationMs}ms`, 8)} ${o.url}`)
  }

  if (jsonOut) {
    const payload = {
      officialTypesVersion: typesVersion,
      checkScope: CHECK_SCOPE,
      // 人工核对的实例成员也带上：机读报告里同样能看出「哪些是自动结论、哪些是人工结论」
      manualInstanceChecks: Object.fromEntries(
        entries.map((entry) => [entry.id, entry.manualInstanceChecks]),
      ),
      timeoutMs,
      observations,
    }
    const target = resolve(process.cwd(), jsonOut)
    writeFileSync(target, JSON.stringify(payload, null, 2) + '\n')
    console.log(`\n[plugin-compat] wrote ${target.startsWith(root) ? relative(root, target) : target}`)
  }

  const failed = observations.filter((o) => o.status === 'fail')
  const blocked = observations.filter((o) => o.status === 'blocked')

  console.log(
    `\n[plugin-compat] pass=${observations.length - failed.length - blocked.length} ` +
      `fail=${failed.length} blocked=${blocked.length}`,
  )

  if (failed.length > 0) {
    console.error('[plugin-compat] 有 fail：产物与 inventory 不一致，见上表')
    return 1
  }
  if (blocked.length > 0) {
    console.error('[plugin-compat] 有 blocked：本轮无法判定（blocked 不是通过）')
    return 3
  }
  return 0
  }

/**
 * 顶层只做一件事：把 main 的返回码变成 `process.exitCode`，并在这里兜住**脚手架失败**。
 *
 * 为什么不能省：`loadData()` 抛的是 `ScaffoldError`（读不到数据模块 / 类型包）。没有这层兜底，
 * 它就是一个未捕获的 top-level rejection —— Node 退 **1**，与「inventory 真的漂移了」混在一起，
 * CI 无法分流。判定表里写着的退出码 `2` 必须真的可达。
 *
 * 刻意不用 `process.exit()`：它会跳过 finally，把清理留成半边。
 */
main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    console.error(`[plugin-compat] 脚手架失败：${(error as Error).message}`)
    process.exitCode = 2
  })
