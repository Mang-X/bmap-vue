# useBMapTrackAnimation

通过该 hooks 可实现轨迹动画，在轨迹动态播放的同时，视角跟随移动。

```ts
import { useBMapTrackAnimation } from 'baidu-map-gl-vue'
```

::: danger 在 JSAPI 4.0 默认路径上尚未验证
`useBMapTrackAnimation` 走 `TrackAnimation`（BMapGLLib 插件），而能力清单里
`service.track-animation` 在 4.0 上是 `unsupported`：本库不装配它，调用会得到
`BMAP_CAPABILITY_UNSUPPORTED`。4.0 的对应能力是原生图层 `layer.track-line`
（`BPointLayer` 同族的 `driver.nativeLayers.create('track-line')`）。

脚本本身的兼容结论（声明面无缺口、运行时未验证）与复现方式见
[插件兼容 inventory](../contributing/plugin-compat-inventory)。
:::

::: warning 注意

1. 使用该 hooks 前，请确保 `TrackAnimation` 插件正确的[注册](../guide/config)了。
2. 由于在渲染动画时，数据资源是随着当前方位和坐标的改变而实时加载的，刚开始播放动画时画面可能会卡顿，属于正常现象。
3. 为了减少加载数据资源的性能损耗，在播放动画时隐藏了地图上的 POI 点。
:::

## 示例

:::demo class="p-bottom"
hooks/useBMapTrackAnimation
:::

## 用法

```ts
const { setPath, start, pause, resume, stop, cancel, proceed, status } = useBMapTrackAnimation(options, map)
```

:::tip
该 hooks 需要地图 ready 后才能创建动画实例；在 `<BMap>` 子树内调用时可省略 `map` 参数；`options` 与 `map` 位置可互换
:::

### 参数

| 参数    | 描述                   | 类型                                              | 默认值 |
| ------- | ---------------------- | ------------------------------------------------- | ------ |
| options | 地图视角动画的配置     | [`TrackAnimationOptions`](#trackanimationoptions) | -      |
| map     | `Map`地图组件`ref`引用 | `Ref<Map>`                                        | -      |

#### TrackAnimationOptions

| 属性        | 描述                                                                     | 类型      | 默认值  |
| ----------- | ------------------------------------------------------------------------ | --------- | ------- |
| duration    | 动画持续时常，单位 ms                                                    | `number`  | `10000` |
| delay       | 动画开始延迟                                                             | `number`  | `0`     |
| overallView | 是否在动画结束后总览视图缩放（调整地图到能看到整个轨迹的视野），默认开启 | `boolean` | `true`  |
| tilt        | 设置动画中的地图倾斜角度，默认 55 度                                     | `number`  | `55`    |
| zoom        | 设置动画中的缩放级别，默认会根据轨迹情况调整到一个合适的级别             | `boolean` | `auto`  |

### 返回值

| 返回值  | 描述                                                       | 类型                                                          |
| ------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| setPath | 设置路径动画路径（至少两个点），需要在`Map`组件`ready`后调用 | [`(path: PathPoint[]) => Promise<void>`](#pathpoint)          |
| start   | 开始动画，`setPath` 设置路径后调用                         | `() => Promise<void>`                                         |
| pause   | 暂停动画                                                   | `() => void`                                                  |
| resume  | 继续播放动画（`proceed` 别名）                             | `() => void`                                                  |
| stop    | 停止动画并回到初始状态                                     | `() => void`                                                  |
| cancel  | 取消动画并释放实例                                         | `() => void`                                                  |
| proceed | 继续播放动画函数                                           | `() => void`                                                  |
| status  | 动画状态（自有状态机，不读 SDK 私有状态）                  | [`Ref<TrackAnimationStatus>`](#trackanimationstatus)          |

#### PathPoint

```ts
type PathPoint = { lng: number; lat: number }
```

#### TrackAnimationStatus

```ts
// idle 空闲 / playing 播放中 / paused 已暂停 / stopped 已停止 / disposed 已释放
type TrackAnimationStatus = 'idle' | 'playing' | 'paused' | 'stopped' | 'disposed'
```

## TS 类型定义参考

```ts
import { Ref } from 'vue'
export declare type PathPoint = {
  lng: number
  lat: number
}
export declare type UseTrackAnimationOptions = {
  /**
   * 动画持续时常，单位ms
   * @default 10000
   */
  duration?: number
  /**
   * 动画开始延迟
   * @default 0
   */
  delay?: number
  /**
   * 是否在动画结束后总览视图缩放（调整地图到能看到整个轨迹的视野），默认开启
   * @default true
   */
  overallView?: boolean
  /**
   * 设置动画中的地图倾斜角度，默认55度
   * @default 55
   */
  tilt?: number
  /**
   * 设置动画中的缩放级别，默认会根据轨迹情况调整到一个合适的级别
   * @default auto
   */
  zoom?: number
}
export type TrackAnimationStatus = 'idle' | 'playing' | 'paused' | 'stopped' | 'disposed'
/**
 * 轨迹动画
 * @param optionsOrMap 轨迹动画配置，或地图组件实例（位置可互换）
 * @param mapOrOptions 地图组件实例，或轨迹动画配置
 */
export declare function useBMapTrackAnimation(
  optionsOrMap?: UseTrackAnimationOptions | unknown,
  mapOrOptions?: unknown
): {
  /**
   * 设置路径动画路径
   */
  setPath: (path: PathPoint[]) => Promise<void>
  /**
   * 开始动画
   */
  start: () => Promise<void>
  /**
   * 暂停动画
   */
  pause: () => void
  /**
   * 继续播放动画
   */
  resume: () => void
  /**
   * 停止动画
   */
  stop: () => void
  /**
   * 取消动画
   */
  cancel: () => void
  /**
   * 继续播放动画（resume 别名）
   */
  proceed: () => void
  /**
   * 动画状态
   */
  status: Ref<TrackAnimationStatus>
}
```
