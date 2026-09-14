/**
 * 离线 playground 的档位装配（M3A3-04 / issue #25）
 *
 * 放在 `packages/test-utils` 而不是 `apps/playground/src` 里，是为了让**用例与应用共用同一份
 * 档位逻辑**：应用侧经 `@test-utils` 别名引用，用例侧直接相对路径引用，不需要给根 vitest 配置
 * 加应用专属 alias。test-utils 本来就是「组件与 SDK 之间」的替身边界，这里装出来的两个 Provider
 * 正是它生产的替身。
 *
 * 原来只有两档，而且「无 AK」那一档是 **legacy** 假路径：`createFakeBMapGl()` 挂到
 * `window.BMapGL`，再交给一个宽松 `{ load }` Provider，由组件侧的迁移期归一按 engine 分派到
 * `webgl-v1` Driver。结果是「离线跑 playground」时**根本踩不到 v4 Driver**——一个只在新 Driver
 * 上出现的缺陷，本地能全绿地演示。
 *
 * 现在分三档，各自的 engine 与加载路径都不同，切档方式是环境变量：
 *
 * | 档 | 触发 | Provider | engine / 加载路径 |
 * | --- | --- | --- | --- |
 * | `real-v4` | 配了 `VITE_BMAP_AK` | 不传（默认家庭） | `jsapi-v4`，默认 `baiduJsapiV4Provider()` → 官方 `@baidumap/jsapi-loader` |
 * | `fake-v4` | 默认（无 AK、未指定档） | `createFakeV4Provider().provider` | `jsapi-v4`，`existingGlobalV4Provider()` 复用装上去的 Fake v4 全局 |
 * | `legacy-fake` | `VITE_BMAP_MODE=legacy-fake` | `createLegacyFakeProvider().provider` | `webgl-v1`（迁移期对照，只用于确认「同一份场景两个 Driver 结果一致」） |
 *
 * **默认档是 `fake-v4`**：本地/CI 无 AK 时的默认行为必须是最接近生产的那条离线路径，而不是
 * 最容易跑通的那条。
 *
 * 三档都**不给 `<BMap>` 传 `provider`**：解析始终落在 `app.use` 的默认 definition 上，
 * 因此「默认 Provider 安装入口」本身也被 playground 覆盖到（与官方 React 封装
 * `<BMapProvider>` 负责加载、地图组件不携带密钥的分工一致）。
 */
import { createBMapPlugin } from '../baidu-map-gl-vue/src/plugins/createBMapPlugin'
import { createFakeV4Provider, createLegacyFakeProvider } from './fake-providers.ts'

export type PlaygroundMode = 'real-v4' | 'fake-v4' | 'legacy-fake'

export interface PlaygroundEnvLike {
  readonly VITE_BMAP_AK?: string
  readonly VITE_BMAP_MODE?: string
}

/** 环境变量 → 档位。非法取值按默认档处理，并把原因说清楚（见 `describeMode`）。 */
export function resolvePlaygroundMode(env: PlaygroundEnvLike): PlaygroundMode {
  const ak = env.VITE_BMAP_AK?.trim()
  if (ak) return 'real-v4'
  const requested = env.VITE_BMAP_MODE?.trim()
  if (requested === 'legacy-fake') return 'legacy-fake'
  return 'fake-v4'
}

const MODE_LABELS: Record<PlaygroundMode, string> = {
  'real-v4': '真实 v4（默认路径 / 官方 Loader）',
  'fake-v4': 'Fake v4（existingGlobalV4Provider / jsapi-v4 Driver）',
  'legacy-fake': 'Fake BMapGL（legacy 对照 / webgl-v1 Driver）',
}

export function describeMode(mode: PlaygroundMode): string {
  return MODE_LABELS[mode]
}

export interface PlaygroundBoot {
  readonly mode: PlaygroundMode
  readonly label: string
  readonly plugin: ReturnType<typeof createBMapPlugin>
  /** 退出/切档前还原注入的全局（真实档没有可还原的东西）。 */
  restore(): void
}

/**
 * 按档位装好插件。
 *
 * `ak` 只用于 `real-v4`；另外两档把 Fake 自带的 `loadOptions` 透传进默认 definition，
 * 这样「插件默认 definition → Client → Provider」整条链在离线档也是真的走了一遍。
 */
export function bootPlayground(env: PlaygroundEnvLike): PlaygroundBoot {
  const mode = resolvePlaygroundMode(env)

  if (mode === 'real-v4') {
    const ak = env.VITE_BMAP_AK!.trim()
    return {
      mode,
      label: describeMode(mode),
      // 不传 provider：走默认（`baiduJsapiV4Provider()` → 官方 loader）
      plugin: createBMapPlugin({ ak }),
      restore: () => {},
    }
  }

  if (mode === 'legacy-fake') {
    const handle = createLegacyFakeProvider()
    return {
      mode,
      label: describeMode(mode),
      plugin: createBMapPlugin({ provider: handle.provider as never }),
      restore: handle.restore,
    }
  }

  const handle = createFakeV4Provider()
  return {
    mode,
    label: describeMode(mode),
    plugin: createBMapPlugin({ provider: handle.provider, defaults: handle.loadOptions }),
    restore: handle.restore,
  }
}
