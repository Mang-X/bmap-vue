/**
 * 离线 playground 的档位装配（M3A3-04 / issue #25；M3A3-REMOVE-LEGACY / issue #26 收敛为两档）
 *
 * 放在 `packages/test-utils` 而不是 `apps/playground/src` 里，是为了让**用例与应用共用同一份
 * 档位逻辑**：应用侧经 `@test-utils` 别名引用，用例侧直接相对路径引用，不需要给根 vitest 配置
 * 加应用专属 alias。test-utils 本来就是「组件与 SDK 之间」的替身边界，这里装出来的 Provider
 * 正是它生产的替身。
 *
 * 原先还有第三档 `legacy-fake`（Fake BMapGL + 宽松 Provider，走 webgl-v1 Driver）。它当时的价值
 * 是证明「离线也能踩到 v4 Driver」——现在**没有别的 Driver 可踩**，因此该档与 `VITE_BMAP_MODE`
 * 开关一并删除（旧引擎已在 #26 移除）。
 *
 * 现在分两档，各自的加载路径不同：
 *
 * | 档 | 触发 | Provider | 加载路径 |
 * | --- | --- | --- | --- |
 * | `real-v4` | 配了 `VITE_BMAP_AK` | 不传（默认家族） | 默认 `baiduJsapiV4Provider()` → 官方 `@baidumap/jsapi-loader` |
 * | `fake-v4` | 默认（无 AK） | `createFakeV4Provider().provider` | `existingGlobalV4Provider()` 复用装上去的 Fake v4 全局 |
 *
 * **默认档是 `fake-v4`**：本地/CI 无 AK 时的默认行为必须是最接近生产的那条离线路径。
 *
 * 两档都**不给 `<BMap>` 传 `provider`**：解析始终落在 `app.use` 的默认 definition 上，
 * 因此「默认 Provider 安装入口」本身也被 playground 覆盖到（与官方 React 封装
 * `<BMapProvider>` 负责加载、地图组件不携带密钥的分工一致）。
 */
import { createBMapPlugin } from '../bmap-vue/src/plugins/createBMapPlugin'
import { createFakeV4Provider } from './fake-providers.ts'

export type PlaygroundMode = 'real-v4' | 'fake-v4'

export interface PlaygroundEnvLike {
  readonly VITE_BMAP_AK?: string
}

/**
 * 环境变量 → 档位。
 *
 * 只按 AK 判定：`VITE_BMAP_MODE` 曾是 `legacy-fake` 对照档的开关，随该档删除——这里刻意
 * **不再读它**，于是「传了一个已被删除的档位名」会静默落到默认档，与 `MODE_LABELS` 的说法一致。
 */
export function resolvePlaygroundMode(env: PlaygroundEnvLike): PlaygroundMode {
  const ak = env.VITE_BMAP_AK?.trim()
  if (ak) return 'real-v4'
  return 'fake-v4'
}

const MODE_LABELS: Record<PlaygroundMode, string> = {
  'real-v4': '真实 v4（默认路径 / 官方 Loader）',
  'fake-v4': 'Fake v4（existingGlobalV4Provider / jsapi-v4 Driver）',
}

export function describeMode(mode: PlaygroundMode): string {
  return MODE_LABELS[mode]
}

export interface PlaygroundBoot {
  readonly mode: PlaygroundMode
  readonly label: string
  readonly plugin: ReturnType<typeof createBMapPlugin>
  /** 退出前还原注入的全局（真实档没有可还原的东西）。 */
  restore(): void
}

/**
 * 按档位装好插件。
 *
 * `ak` 只用于 `real-v4`；离线档把 Fake 自带的 `loadOptions` 透传进默认 definition，
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

  const handle = createFakeV4Provider()
  return {
    mode,
    label: describeMode(mode),
    plugin: createBMapPlugin({ provider: handle.provider, defaults: handle.loadOptions }),
    restore: handle.restore,
  }
}
