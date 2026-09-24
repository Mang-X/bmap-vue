---
"bmap-vue": minor
---

新增 `<Map>` 的完整 map 事件与两个公开 hook：`useMapEvent`（事件订阅）与 `useMapStatus`（地图状态）。

**`<Map>` 的 map 事件**（43 个，含 5 个 SDK 拼写别名）：事件名来自单一事实源
（`core/events/eventCatalog.ts`），`@` 在模板与 TS 里都有完整提示。

- 事件名 = SDK 名把分隔符 `_` 换成 `-`（只有 `style_willchange` / `style_loaded` /
  `style_loaded_error` / `style_loaded_timeout` / `language_change` 这 5 个会变），**SDK 拼写永远可用**：
  `@style-loaded` 与 `@style_loaded` 都能绑，映射集中在一处，组件里没有第二份兼容代码。
- `maptypechange` / `tilesloaded` 这类**没有官方词边界**的名字不拆词，原样保留。
- **订阅固定集合**：地图就绪时一次订全部事件（不随改绑监听器变化）。原因：Vue 判子组件要不要
  重渲染时**不比较 emit listener**（`hasPropsChanged` 显式跳过），因此「监听器从 `undefined` 变成
  函数」不会让 `<Map>` 重渲染 —— 按需订阅的实现会静默丢事件。未绑定 handler 的事件由 Vue 丢弃。
- **`.once` 可用**：`@click.once` / `@styleLoaded.once` 按 Vue 语义只触发一次。
- **生命周期两端可用**：`<Map @load>` / `@destroy` 与 `useMapEvent('load' | 'destroy')` 都收得到。
  `load` 用上下文的「地图已创建」挂载点提前订阅；`destroy` 的订阅在**整张地图正在卸载**时延伸寿命到
  销毁那一刻，而子组件单独卸载（条件渲染 / Tab / 路由）时照常释放。显式 `MapEventSource` 仍是 SDK 订阅语义。
- 高频事件（`mousemove` / `touchmove` / `dragging` / `moving` / `zooming`）**一帧最多提交一次**，
  取该帧最后一次的载荷；`mousewheel` 刻意不合帧（每次都有独立的 `trend`）。
- 载荷新增 `trend`（`mousewheel`）、`mapType` / `exMapType`（`maptypechange`）三个归一化字段；
  指针 / 拖拽类事件恒有 `point`。

**`useMapEvent`**：订阅地图事件。

```ts
useMapEvent('click', (e) => console.log(e.point, e.pixel))
useMapEvent('moving', handler, { coalesce: false }) // 覆盖合帧
useMapEvent('click', handler, { source: { map, client } }) // 订阅别处的地图
```

- **handler 更新不重绑**：传函数只捕获一次（Vue 的闭包读的就是最新值）；
  也可以传 `ref(handler)` 表示「每次派发读 `.value`」——两种都不新增 SDK 订阅。
- 事件名运行时任一种拼写都认（`style-loaded` / `style_loaded` / `styleLoaded`），但**只有规范名
  `MapEventName` 保证精确的载荷推导**（宽松拼写退回公共底座）；
  **清单之外的名字原样订阅**（上游新增事件不必等本库发版），载荷类型退化为公共底座、不用 `any`。
- 返回幂等的 disposer；在组件 / `effectScope` 内调用时随作用域自动释放。

**`useMapStatus`**：把地图外部状态读成一组只读 refs。

```ts
const { center, zoom, bounds, size, heading, tilt, moving, zooming } = useMapStatus()
```

- **值没变就不更新**：逐字段容差判等（经纬度 `1e-7`、`zoom` `1e-6`、角度 `0.01`，与受控视野同一口径），
  相等时保持原对象，因此 `watch(center)` 不会被同一视野的重复事件唤醒。
- **订阅即给值**：地图就绪时立即读一次当前状态，不必等第一个事件；句柄为 `null`（销毁）时字段回到
  `null`、标志回到 `false`（语义是「未知」，不是「保持上一次的值」）。
- `moving` / `zooming` 由 start / 中 / end 事件驱动，且**不走合帧**（否则同帧内 `moveend` 会被后到的
  `moving` 覆盖，出现「已结束却仍在移动」）。

**无破坏性变更**：既有事件名与 props 语义不变；`@click` 的载荷类型从 `unknown` 收窄为
`MapPointerEvent`（运行时形状不变）。
