/**
 * Fake Provider 工厂（M3A3-04 / issue #25）
 *
 * 两个**可离线**的 Provider，供 playground 与用例共用：
 *
 * - `createFakeV4Provider()`：把 Fake v4 命名空间装成**真实的 v4 全局**（`globalThis.BMap`），
 *   再交给 `existingGlobalV4Provider()`。也就是说它走的是**生产同一条路径**——默认 Provider 家族
 *   的「复用既有全局」分支，而不是「宽松 `{ load }` Provider 被迁移期归一成 legacy」那条。
 *   这是 M3A3-04 要的「Fake v4 模式」：无外网、无 AK，但组件仍然跑在 v4 Driver 上。
 * - `createLegacyFakeProvider()`：旧的 `Fake BMapGL` + 宽松 Provider（走 `webgl-v1` Driver）。
 *   保留它是为了**对照**：两种模式跑同一份场景时，domain 结果应当一致，而 engine 不同。
 *
 * 两条硬约束（都踩过）：
 *
 * 1. **全局要按真实形状同时提供 `BMap` 与 `BMapGL`**。真实 4.0 入口把 `BMapGL` 作为同一对象的
 *    别名挂上，UI Kit 也从它取 AK 配置；只挂 `BMap` 会让「离线也能跑 UI Kit」这条路在 playground
 *    里假失败。
 * 2. **每次构造都要让指纹不同**（默认 `ak` 带序号）。v4 的加载走进程级 `BMap` 冲突域，缓存键是
 *    `fingerprintConfig(options)`——两次构造出的两个 Fake 命名空间如果共用指纹，第二次会直接拿到
 *    第一次缓存的 `LoadedJsapiV4`，用例上表现为「换了一个 Fake 却没换命名空间」。
 */
import { createFakeBMapGl } from './fake-bmapgl/index.ts'
import { createFakeBMapV4, type FakeBMapV4 } from './fake-bmap-v4/index.ts'
// `existingGlobalV4Provider` 是组件库的公开 Provider 家族成员。test-utils 是「组件与 SDK 之间」
// 的替身边界，直接 import 组件库源码，与 `driver-matrix.ts` 的做法一致。
import { existingGlobalV4Provider } from '../baidu-map-gl-vue/src/core/loader/providers'

/** Fake v4 Provider 的句柄：`restore()` 负责把注入的全局还原。 */
export interface FakeV4ProviderHandle {
  readonly fake: FakeBMapV4
  /** 交给 `<BMapProvider provider>` / `createBMapPlugin({ provider })` 的 Provider。 */
  readonly provider: ReturnType<typeof existingGlobalV4Provider>
  /** 注入时使用的加载选项（`ak` 参与指纹，见文件头约束 2）。 */
  readonly loadOptions: { ak: string; version: string }
  /** 还原注入前的全局（含「原本不存在」的情况）。 */
  restore(): void
}

let fakeV4Sequence = 0

/**
 * 进程全局的「字符串键」视图。
 *
 * 刻意**不**写成 `typeof globalThis & { BMap?: unknown }`：组件库的源码里声明了全局
 * `namespace BMap`（v4 命名空间边界），一旦那个声明进入 Program，`globalThis.BMap` 就被解析成
 * 那个命名空间类型，于是赋值会报「缺少 30 多个成员」、`delete` 会报「操作数必须可选」。
 * 这里只做字面键读写，用 `Record<string, unknown>` 表达。
 */
type GlobalScope = Record<string, unknown>

function globalScope(): GlobalScope {
  return globalThis as unknown as GlobalScope
}

function removeGlobal(scope: GlobalScope, key: string): void {
  // 用 Reflect 而不是 `delete scope[key]`：后者在严格模式下对不可配置属性会抛，
  // 而且 TS 对索引签名成员的 delete 需要额外说明。
  Reflect.deleteProperty(scope, key)
}

/**
 * 装一个 Fake v4 全局并返回走「复用既有全局」路径的 Provider。
 *
 * ```ts
 * const { provider, fake, restore } = createFakeV4Provider()
 * app.use(createBMapPlugin({ provider, defaults: { ak: 'fake' } }))
 * // ... 断言 fake.createdMaps / fake.diagnostics ...
 * restore()
 * ```
 */
export function createFakeV4Provider(options: { version?: string; ak?: string } = {}): FakeV4ProviderHandle {
  const version = options.version ?? '4.0'
  const ak = options.ak ?? `fake-v4-${(fakeV4Sequence += 1)}`
  const fake = createFakeBMapV4(version)

  const scope = globalScope()
  const hadBMap = Object.prototype.hasOwnProperty.call(scope, 'BMap')
  const hadBMapGL = Object.prototype.hasOwnProperty.call(scope, 'BMapGL')
  const previousBMap = scope.BMap
  const previousBMapGL = scope.BMapGL

  scope.BMap = fake.namespace
  // 真实 4.0 入口的 `BMapGL` 就是同一个对象的别名（见核心约定：4.0 下 `BMap === BMapGL`）
  scope.BMapGL = fake.namespace

  return {
    fake,
    provider: existingGlobalV4Provider(),
    loadOptions: { ak, version },
    restore() {
      if (hadBMap) scope.BMap = previousBMap
      else removeGlobal(scope, 'BMap')
      if (hadBMapGL) scope.BMapGL = previousBMapGL
      else removeGlobal(scope, 'BMapGL')
    },
  }
}

/** Fake legacy（`webgl-v1`）Provider 的句柄。 */
export interface LegacyFakeProviderHandle {
  readonly fake: ReturnType<typeof createFakeBMapGl>
  /**
   * 宽松 Provider：返回裸全局对象，由组件侧的迁移期归一按 engine 分派到 `webgl-v1`。
   *
   * 刻意**不**自述 `engine`：这正是 legacy 路径的形状，也是它与 `createFakeV4Provider()`
   * 的差别所在（v4 Provider 必须自述 engine，裸命名空间无法与 legacy 区分）。
   */
  readonly provider: { id: string; load: () => Promise<unknown> }
  restore(): void
}

/**
 * 旧的 playground `mockProvider()`：`window.BMapGL` 上挂 Fake，返回宽松 Provider。
 *
 * 它只在 `VITE_BMAP_MODE=legacy-fake`（对照档）使用。
 */
export function createLegacyFakeProvider(): LegacyFakeProviderHandle {
  const fake = createFakeBMapGl()
  const scope = globalScope()
  const had = Object.prototype.hasOwnProperty.call(scope, 'BMapGL')
  const previous = scope.BMapGL
  scope.BMapGL = fake

  return {
    fake,
    provider: {
      id: 'mock-legacy',
      load: async () => {
        scope.BMapGL = fake
        return fake
      },
    },
    restore() {
      if (had) scope.BMapGL = previous
      else removeGlobal(scope, 'BMapGL')
    },
  }
}
