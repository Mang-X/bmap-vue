/**
 * 第三方扩展 fixture（M8-ADAPTERS-ADVANCED / issue #43）
 *
 * 这份文件以**消费者**身份使用 `bmap-vue` 的扩展契约（`./advanced` + `./plugins`），
 * 目的是让「高级入口够不够第三方写 adapter」这件事有一个**可编译**的落点，而不是一句文档承诺：
 * `verify:package` 会用 `vue-tsc` 对着 tarball 里的 `dist/*.d.ts` 编译本目录。
 *
 * 运行面另有一份：`verify-package.mts` 用 ESM 在 Node 里真正调用这些契约一次
 * （见那里的 `advanced subpath` 检查）。这里刻意**不**用 `@ts-expect-error` 之类
 * 「只对不该编译的代码有用」的断言 —— 判据是「这些东西在发布产物里都能按类型用起来」。
 */
import {
  CAPABILITY_CATALOG,
  UnsupportedCapabilityError,
  assertLoadedSdk,
  createBMapClient,
  createBMapClientDefinition,
  createCapabilityRegistry,
  createHandle,
  createJsapiV4Driver,
  normalizeProvider,
  unwrapRaw,
  type BMapClient,
  type BMapDriverFactory,
  type BMapProviderLike,
  type Capability,
  type CapabilityRegistry,
  type CreateBMapClientOptions,
  type LoadedSdk,
  type MapHandle,
} from 'bmap-vue/advanced'
import {
  BUILTIN_PLUGIN_NAMES,
  resolvePluginDefinition,
  urlPluginDefinition,
  type BMapPluginDefinition,
} from 'bmap-vue/plugins'

/** 第三方脚本插件的 definition：与内置四个同形状（`global` 文档级脚本 + 读一个全局导出）。 */
export function createThirdPartyPlugin(
  name: string,
  src: string,
  readExport: () => unknown,
): BMapPluginDefinition<unknown> {
  return urlPluginDefinition(name, src, readExport, { scope: 'global', required: false })
}

/** 第三方 adapter 的装配：注入自定义 Provider / Driver 工厂，拿回 Driver 与能力表。 */
export function createAdapter(input: {
  provider: BMapProviderLike
  ak: string
  rawSdk: unknown
  version: string
  driver?: BMapDriverFactory
  unsupported?: 'warn' | 'throw' | 'silent'
}): {
  definition: CreateBMapClientOptions
  createClient: () => Promise<BMapClient>
  driver: ReturnType<typeof createJsapiV4Driver>
  capabilities: CapabilityRegistry
} {
  const definition = createBMapClientDefinition({
    provider: input.provider,
    loadOptions: { ak: input.ak },
    ...(input.driver ? { driver: input.driver } : {}),
    ...(input.unsupported ? { unsupported: input.unsupported } : {}),
  })
  return {
    definition,
    createClient: () => createBMapClient(definition),
    driver: createJsapiV4Driver({
      rawSdk: input.rawSdk,
      version: input.version,
      unsupported: input.unsupported ?? 'warn',
    }),
    capabilities: createCapabilityRegistry({
      engine: 'jsapi-v4',
      version: input.version,
      rawSdk: input.rawSdk,
      unsupported: input.unsupported ?? 'warn',
    }),
  }
}

/** Provider 的返回值必须能过公开的收口校验（第三方自研 Provider 的核对点）。 */
export function assertProviderResult(value: unknown): LoadedSdk {
  return assertLoadedSdk(value)
}

/** Provider → 归一化形状（`load` 的 `this` 绑定在这里被保住）。 */
export function normalizedLoad(provider: BMapProviderLike): ReturnType<typeof normalizeProvider> {
  return normalizeProvider(provider)
}

/** raw 逃生口：本库只承诺「handle → raw」，不承诺 raw 的形状。 */
export function readRawMap(handle: MapHandle): unknown {
  return unwrapRaw(handle)
}

/** 手工造一个 handle（第三方自研 Facet 的返回形状）。 */
export function makeProbeHandle(): MapHandle {
  return createHandle('map', { probe: true })
}

/** 能力查询的收窄点：不支持时给出可读原因，而不是抛一个裸字符串。 */
export function requireCapability(capabilities: CapabilityRegistry, id: Capability): string {
  try {
    capabilities.require(id)
    return 'ok'
  } catch (error) {
    if (error instanceof UnsupportedCapabilityError) return `unsupported:${error.capability}`
    throw error
  }
}

/** 内置插件的名字表：第三方若想「按名字加载内置插件」，这份清单就是它的输入。 */
export const BUILTIN_NAMES: readonly string[] = BUILTIN_PLUGIN_NAMES

/** 按名字取内置 definition（名字不认识时抛 `BMAP_PLUGIN_UNKNOWN`，不再静默变成空实现）。 */
export function builtinDefinition(name: string): BMapPluginDefinition<unknown> {
  return resolvePluginDefinition(name)
}

/** 能力目录里被标为 `unsupported` 的条目（第三方据此决定「不实现」而不是「假装实现」）。 */
export const UNSUPPORTED_CAPABILITIES: readonly string[] = Object.values(CAPABILITY_CATALOG)
  .filter((descriptor) => descriptor.status === 'unsupported')
  .map((descriptor) => descriptor.id)
