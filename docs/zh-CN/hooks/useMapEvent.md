---
title: useMapEvent
lang: zh-CN
---

# useMapEvent

订阅地图事件。事件名、SDK 拼写与载荷类型都来自
[组件事件](../guide/com-events) 页的「BMap：map 事件」一节（`<BMap>` 的 `@` 与它共用同一份数据）。

```ts
import { useMapEvent } from 'baidu-map-gl-vue'

// 在 <BMap> 子树里：自动取最近的地图
useMapEvent('click', (e) => console.log(e.point, e.pixel))
useMapEvent('moving', (e) => console.log('moving', e.raw)) // 高频：一帧最多一次
```

## 参数

```ts
useMapEvent(name, handler, options?): () => void
```

| 参数      | 类型                                          | 说明                                                                 |
| --------- | --------------------------------------------- | -------------------------------------------------------------------- |
| `name`    | `MapEventName \| MaybeRefOrGetter<string>`    | 事件名（见下）。传 ref / getter 时换名字会自动换订阅                 |
| `handler` | `(event) => void \| Ref<(event) => void>`     | 回调；载荷类型随事件名走                                             |
| `options` | `{ source?, coalesce? }`                      | `source` 显式指定订阅源；`coalesce` 覆盖是否按帧合帧                 |

返回一个**幂等**的 disposer；在组件 / `effectScope` 里调用时也会随作用域自动释放。

### 事件名

- **规范名**：Catalog 里的 kebab 名（`style-loaded`）；
- **SDK 拼写**：`style_loaded` 也能命中同一条目（`@style-loaded` 与 `@style_loaded` 都能用）；
- **Catalog 之外的名字原样订阅**——上游以后新增的事件不必等本库发版，代价是载荷类型只能是公共底座
  `MapEventPayload`（表内事件有逐事件的精确类型，官方清单见
  [组件事件](../guide/com-events) 页的「BMap：map 事件」一节）。

```ts
import type { MapEventPayloadOf } from 'baidu-map-gl-vue'

useMapEvent('click', (e: MapEventPayloadOf<'click'>) => {
  e.point // 指针事件恒有 point
})
useMapEvent('some-future-event', (e) => {
  e.raw // 表外事件：用公共底座 + raw 逃生口
})
```

## 显式订阅源（多地图）

默认从最近的 `<BMap>` 子树取地图；要订阅「别处的地图」时显式给一个 source
（只需「地图句柄 + 提供 EventDriver 的 Client」）：

```ts
const { map, client } = await whenReady()
useMapEvent('click', handler, { source: { map, client } })
```

source 语义与地图生命周期解耦：句柄为 `null` 时不订阅、变成句柄后自动订阅、再变回 `null` 时解绑。

## 高频事件按帧合帧

`mousemove` / `touchmove` / `dragging` / `moving` / `zooming` 这五个事件一帧最多提交一次，
**取该帧最后一次的载荷**（滚动、拖拽时不会每帧都唤一次你的回调）。用 `coalesce: false` 可以关掉：

```ts
useMapEvent('moving', handler, { coalesce: false }) // 每次派发都提交
```

`mousewheel` **刻意不合帧**：滚轮是离散输入，每次都有自己的 `trend`（放大 / 缩小），
合帧会把「一帧内先放大再缩小」压成一次。

## handler 更新不重绑

SDK 侧只绑一个稳定的 wrapper，因此下面两种写法都不会新增监听器：

```ts
// ① 传函数：捕获一次即可。Vue 的闭包读的是 ref 对象，本来就是最新值
const count = ref(0)
useMapEvent('click', () => count.value++)

// ② 传 ref(handler)：每次派发读 .value，适合「按条件切换实现」
const handler = shallowRef<() => void>(implA)
useMapEvent('click', handler)
handler.value = implB // 不重绑，下一次派发就走 B
```

> 这也是本库与 React 封装的差别：React 每次渲染都会造一个新函数，因此必须用 ref 存最新值；
> Vue 的闭包读的就是响应式对象，不需要每轮换 handler。

## 与 `<BMap>` 的 `@` 的关系

`<BMap>` 在地图就绪时**一次订全部 map 事件**（含 43 个规范名的 SDK 事件；未绑定 handler 的由
Vue 丢弃）。这里不按 prop 做「按需订阅」是有意的：Vue 判子组件要不要重渲染时**不比较 emit
listener**，所以「监听器从 `undefined` 变成函数」不会让 `<BMap>` 重渲染，靠重渲染做增量的方案会
静默丢事件。

`useMapEvent` 是「在 setup 里按条件订阅 / 订阅别处地图 / 只要订某几个事件」时需要的那条路；
两者共用同一份 Catalog 与同一个订阅原语，事件名与载荷完全一致。

## 释放

```ts
const stop = useMapEvent('click', handler)
stop() // 手动释放（幂等）

// 或者交给作用域：组件卸载 / effectScope.stop() 时自动释放
```
