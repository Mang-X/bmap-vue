# useBMapViewAnimation <Badge type="tip" text="^0.0.30" />

该 hooks 用于展示地图的 3D 动画，您可以自定义从地图上某一地点切换到另一地点的 3D 过渡动画效果。

```ts
import { useBMapViewAnimation } from 'baidu-map-gl-vue'
```

:::warning 注意

- 由于在渲染动画时，数据资源是随着当前方位和坐标的改变而实时加载的，刚开始播放动画时画面可能会卡顿，属于正常现象；此外，为了减少加载数据资源的性能损耗，在播放动画时隐藏了地图上的 POI 点。
- 其次，在定义关键帧时相邻两个关键帧的坐标点不宜距离太远，否则会导致当前帧的资源还未加载完毕，就已经进入下一帧的播放，出现视野中看不到地图的现象。

:::

## 示例

:::demo class="p-bottom"
hooks/useBMapViewAnimation
:::

## 用法

```ts
const { start, cancel, status, ready } = useBMapViewAnimation(options, map)
```

:::tip
该 hooks 需要地图 ready（`BMapClient` 就绪）后才能创建动画实例；在 `<BMap>` 子树内调用时可省略 `map` 参数
:::

:::warning 只有公开面，没有暂停 / 继续
4.0 上视角动画实例的暂停与继续**只有私有成员**（`_pause` / `_continue`），本库不用私有面伪造能力，
所以不提供 `stop()` / `proceed()`；需要中止就用 [`cancel()`](#返回值)（公开命令）。
每一次 `start()` 都会新建一个动画实例，关键帧变了直接再调一次即可，不必重建 hooks。
:::

:::tip 接着播下一段该怎么写
先说清楚一件事：**`start()` 的 Promise 不是「播完」的 Promise**。它等的是地图 ready + 起播命令被
Driver 接受，命令发出去就 resolve；动画本身还要跑多久，只有公开事件知道。

```ts
// ① 立刻接管：上一段还在播也没关系，第二次 start() 会取代它
await start(segmentA);
await start(segmentB); // A 被接管（不是「等 A 播完」）

// ② 播完再接续：由观察值驱动队列，而不是自己数时间
watch(status, (value) => {
  if (value === "idle" && queue.value.length > 0) void start(queue.value.shift()!);
});
```

两点要知道：`loop: "INFINITE"` 时 SDK 不会派发 `animationend`，`status` 因此一直停在 `playing`，
只有 `cancel()` 之后回来的 `animationcancel` 会把它写回 `idle`；而**接管可能失败**——起播前 Driver 要先
取消上一段，取消失败时 `start()` 直接 reject、上一段继续播，所以 `await` / `.catch()` 要接住。
:::

### 参数

| 参数    | 描述                   | 类型                                            | 默认值 |
| ------- | ---------------------- | ----------------------------------------------- | ------ |
| options | 地图视角动画的配置     | [`ViewAnimationOptions`](#viewanimationoptions) | -      |
| map     | `Map`地图组件`ref`引用 | `Ref<Map>`                                      | -      |

#### ViewAnimationOptions

| 属性     | 描述                                                             | 类型                   | 默认值 |
| -------- | ---------------------------------------------------------------- | ---------------------- | ------ |
| duration | 动画持续时常，单位 ms                                            | `number`               | `1000` |
| delay    | 动画开始延迟                                                     | `number`               | `0`    |
| loop     | 循环次数，参数类型为数字时循环固定次数，参数为'INFINITE'无限循环 | `number \| 'INFINITE'` | `1`    |

### 返回值

| 返回值  | 描述                                                                             | 类型                                                                    |
| ------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| start   | 播放一段关键帧动画；每次调用新建实例并接管仍在播的那一段。Promise 表示**起播命令被接受**（等地图 ready + 命令发出），不代表动画播完。接管**可能失败**：起播前 Driver 要先取消上一段，取消失败时它拒绝替换并保留记录以便重试，本方法随之 reject（上一段仍在播、仍可被 `cancel()` 重试） | [`(keyFrames: ViewAnimationKeyFrames[]) => Promise<void>`](#viewanimationkeyframes) |
| cancel  | 取消本 hooks 当前那段播放（公开的 `cancelViewAnimation`）。没有在飞动画时什么都不做；**stop 请求一旦被 Driver 接受就不再重复发**（同一 hooks 再调 `cancel()` 是 no-op，否则停掉的会是这张图上任何人正在播的动画）。**取消是地图级命令**，守卫只看 hooks 自己记的「有没有在飞段」，因此**不保证一定不牵连同图其它动画**。取消失败时错误抛给调用方，这一段归属保留，可以直接重试；状态要等 SDK 的 `animationcancel` 到达才变回 `idle` | `() => void`                                                            |
| status  | 观察到的播放状态，只由公开事件写，命令不改动它                                   | [`Ref<ViewAnimationStatus>`](#viewanimationstatus)                       |
| ready   | 地图 ready 后 resolve 的 `MapReadyContext`                                       | `Promise<MapReadyContext>`                                              |

#### ViewAnimationKeyFrames

```ts
type Point = { lng: number; lat: number }
interface ViewAnimationKeyFrames {
  /**
   * 	地图中心点
   */
  center: Point
  /**
   * 	地图缩放级别，默认值为地图当前状态缩放级别
   */
  zoom?: number
  /**
   * 	地图倾斜角度，默认值为地图当前状态倾斜角度
   */
  tilt?: number
  /**
   * 	地图旋转角度，默认值为地图当前旋转角度
   */
  heading?: number
  /**
   * 	表示当前关键帧处于动画过程的百分比，取值范围0~1
   */
  percentage: number
}
```

#### ViewAnimationStatus

```ts
// playing 正在播放
// idle 没有在播放（未开始 / 已播完 / 已取消）
type ViewAnimationStatus = 'idle' | 'playing'
```

### 事件监听

hooks 内部已把 `animationstart` / `animationend` / `animationcancel` 同步到 `status`，无需手动绑定。
动画实例由 hooks 持有并在每次 `start()` 时替换，因此**不**对外暴露句柄；需要自己观察事件时，
请在 `ready` 之后用 `client.driver.services.createViewAnimation()` 自行建实例并绑定：

| 事件                | 参数 | 描述                                                                          |
| ------------------- | ---- | ----------------------------------------------------------------------------- |
| animationstart      | -    | 动画开始时触发，如果配置了 delay，则在 delay 后触发                           |
| animationiterations | -    | 当动画循环大于 1 次时，上一次结束既下一次开始时触发。最后一次循环结束时不触发 |
| animationend        | -    | 动画结束时触发，如果动画中途被终止，则不会触发                                |
| animationcancel     | -    | 动画中途被终止时触发                                                          |

:::warning
`animationiterations` 不在 hooks 的观察范围内：多轮循环的进度读数需要「按实例订阅 + 计数」，
而本库目前没有消费它的运行时取证（#104 的 evidence-first）。需要循环进度时走上面那条自建路径。
:::

## TS 类型定义参考

```ts
import { ShallowRef } from 'vue'
type Point = { lng: number; lat: number }
export interface ViewAnimationKeyFrames {
  /**
   * 	地图中心点，默认值为地图当前状态中心点
   */
  center: Point
  /**
   * 	地图缩放级别，默认值为地图当前状态缩放级别
   */
  zoom?: number
  /**
   * 	地图倾斜角度，默认值为地图当前状态倾斜角度
   */
  tilt?: number
  /**
   * 	地图旋转角度，默认值为地图当前旋转角度
   */
  heading?: number
  /**
   * 	表示当前关键帧处于动画过程的百分比，取值范围0~1
   */
  percentage: number
}
export interface UseBMapViewAnimationOptions {
  /**
   * 	动画开始延迟时间，单位ms，默认0
   */
  delay?: number
  /**
   * 	动画持续时间，单位ms，默认1000
   */
  duration?: number
  /**
   * 循环次数，参数类型为数字时循环固定次数，参数为'INFINITE'无限循环，默认为1
   */
  loop?: number | 'INFINITE'
}
export type ViewAnimationStatus = 'idle' | 'playing'
export declare function useBMapViewAnimation(
  options?: UseBMapViewAnimationOptions,
  map?: unknown
): {
  start: (keyFrames: ViewAnimationKeyFrames[]) => Promise<void>
  cancel: () => void
  status: Readonly<ShallowRef<ViewAnimationStatus>>
  ready: Promise<MapReadyContext>
}
```
