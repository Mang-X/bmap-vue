# ADR 2026-09-14：typed Map Events、`useMapEvent` 与 `useMapStatus`（事件 Catalog 与订阅口径）

- 状态：已接受（Accepted）
- 日期：2026-09-14
- 计划键：`M4-EVENTS`（issue #28，追踪 #12，前置 #27）
- 相关：`packages/baidu-map-gl-vue/src/core/events/eventCatalog.ts`、
  `packages/baidu-map-gl-vue/src/core/events/subscribeMapEvent.ts`、
  `packages/baidu-map-gl-vue/src/composables/{useMapEvent,useMapStatus,mapEventSource}.ts`、
  `packages/baidu-map-gl-vue/src/components/map/BMap.vue`、
  `packages/baidu-map-gl-vue/src/core/utils/liveView.ts`、
  `docs/zh-CN/guide/com-events.md`、`tests/behavior/v3-map-event-catalog.test.ts`
- 对照物：官方 React 封装 `huiyan-fe/react-bmap@2.0.1`
  （`src/hooks/useMapEvent.ts`、`src/hooks/useMapStatus.ts`、`src/utils/event.ts`、
  `src/components/Map/Map.tsx`、`src/types/index.ts`）
- 上游依据：`@baidumap/jsapi-v4-types@4.0.4` 的 `core/MapEvent.d.ts`（`BMap.MapEventMap`，41 键）与
  `core/Map.d.ts`（`addEventListener<K extends keyof MapEventMap>`）

## 背景

`<BMap>` 此前只对外广播一个 SDK 事件（`click`），事件名、载荷与「谁订阅了什么」散在三处：

1. **没有事件清单**：`defineEmits` 里只有 `click`，模板补全不出 `moveend` / `maptypechange`，
   TS 里也没有「这个名字的载荷是什么」的答案；
2. **没有订阅入口**：业务侧想在 setup 里按条件订阅（或订阅别处的地图）只能自己拿 `client` +
   `map` 拼 `driver.events.on(...)`，而「handler 更新要不要重绑」「解绑是否幂等」全靠自己写对；
3. **没有状态入口**：`center` / `zoom` / `bounds` / `size` / `heading` / `tilt` / `moving` / `zooming`
   只能自己去读 driver（每次 `moveend` 全量读 + 自己判等），读回的错误口径也要自己决定。

issue #28 要求一次给出这三样，并且**事件命名是公共契约**——它一旦发布就很难改，因此本 ADR 先冻结
清单与口径。

## 决策

### 1. 单一事实源：`core/events/eventCatalog.ts`

一张表服务三处消费，避免「组件发的名字 / composable 收的名字 / 文档写的名字」漂移：

| 消费点 | 用法 |
| --- | --- |
| `<BMap>` 的 `defineEmits` 与转发 | `MapEventEmits`（显式键接口，见决策 3）+ `MAP_EVENT_CATALOG` 的 `sdk` / `coalesce` |
| `useMapEvent` / `useMapStatus` | `resolveMapEventName()` 解析订阅名，`MAP_EVENT_CATALOG[name].coalesce` 决定合帧 |
| 文档与测试 | `docs/zh-CN/guide/com-events.md` 的表格被门禁**逐行**比对（名字 + SDK 名 + 说明） |

**上游权威清单**：`BMap.MapEventMap` 有 41 个键，本表 `declared: true` 的条目与它**逐键相等**
（`tests/behavior/v3-map-event-catalog.test.ts` 直接解析上游 `.d.ts` 文本做双向取差集）。

**两个运行时可观察、上游类型未声明的事件**：`headingchange` / `tiltchange`。依据是它们**已经在本库
运行**（#27 的视野回写订阅就绑在它们上面，由 `simulateUserView()` 与 ADR
`2026-09-14-map-controlled-state` 决策 5 冻结）。这与 #74 发现的「`MapTypeId` 声明了 `BMAP_*_MAP`
而运行时只有 `NORMAL/EARTH/SATELLITE`」是同一类**声明与运行时不一致**，因此如实标 `declared: false`，
不把它们塞进「上游清单」、也不假装上游声明存在。

公共类型**自持**：不 import `@baidumap/jsapi-v4-types`（`check:public-dts` 禁止发布声明引用它），
`MapEventPayload` / `MapPointerEvent` / `MapEventMap` 都是本库自己的结构。

### 2. SDK → Vue 的名字映射：只做 `_` → `-`，SDK 拼写永远可用

| 维度 | 处置 | 依据 |
| --- | --- | --- |
| 规范名 | SDK 名把 `_` 换成 `-` | 上游 41 个事件名**没有 camelCase** ⇒ 不存在「驼峰转 kebab」这一步 |
| 哪些名字真的变了 | 只有 5 个：`style_willchange` / `style_loaded` / `style_loaded_error` / `style_loaded_timeout` / `language_change` | 只有它们带官方分隔符 `_` |
| `maptypechange` / `tilesloaded` / `zoomexceeded` / `rightdblclick` | **不拆词**，原样保留 | 上游没有词边界，`map-type-change` 只能靠猜；官方 React 封装的 `EVENT_MAP`（`Map.tsx:401`）同样原样使用 `maptypechange` / `tilesloaded` |
| SDK 拼写 | 永远可用：`resolveMapEventName()` 抹掉 `-`/`_` 与大小写后查索引（`style-loaded` / `style_loaded` / `styleLoaded` 命中同一条目） | 「旧名称通过集中 deprecation 处理，禁止组件各自兼容」（issue 原文） |
| 模板上的兼容 | `<BMap>` 对 `sdk !== vue` 的条目**同时**发出规范名与 SDK 拼写，映射集中在 `MAP_EVENT_EMIT_ALIASES` 一处 | 同上；别名必须也在 `defineEmits` 里，否则 Vue 不会把事件交给 `emit`（未声明的事件名会落到 `attrs`，静默失败） |

### 3. `MapEventEmits` 是**显式键接口** + 编译期断言（不是 mapped type）

`@vue/compiler-sfc` 必须把 `defineEmits` 的类型解析成「有限个键」。实测（`@vue/compiler-sfc@3.5.42`，
「这个位置能不能编过 SFC」）：

| 写法 | 结果 |
| --- | --- |
| `{ [K in keyof typeof MAP_EVENT_CATALOG]: [event: MapEventPayload] }`（约束 = `keyof` 大对象） | ❌ `Failed to resolve index type into finite keys` |
| 同上，但约束换成**字面量联合** | ✅ |
| `{ [K in MapEventEmitName]: [event: MapEventEmitPayload<K>] }`（值含**条件类型**） | ❌ 同上 |
| **显式键的接口**（本决策） | ✅ |

结论：约束必须是可枚举的字面量、值必须是可静态求值的类型。而 `MapEventName` 现在是
`keyof typeof MAP_EVENT_CATALOG`（**派生**，防漂移——手写联合会漏掉新加的表现），所以 SFC 这一侧
只能走显式键的 `MapEventEmits`。漂移由 `eventCatalog.ts` 末尾的编译期断言消除（`typecheck:v3` 会跑）：

- ① `MapEventEmits` 的键集合与 `MapEventName ∪ MapEventEmitAliasName` **双向**取差集必须是 `never`
  （表里加了事件、`MapEventEmits` 忘了加 ⇒ 编译失败）；
- ② 每个键的载荷与 `MAP_EVENT_CATALOG` 的 `pointer` 标记**双向**可赋值（不是单向放宽）。

用 `Exclude` + 参数类型必须是 `never` 的写法，而不是「联合整体可赋值」——后者在上游只补齐一半
声明时会静默通过（同类判据见 #75）。

### 4. `<BMap>` **无条件订阅** Catalog 的全部事件（评审 P1 后的结论）

第一版学官方 React 封装做了「按需订阅」（只在传了 handler 时才 `addEventListener`，`Map.tsx:413`），
**已被实测推翻**：

| 事实（`@vue/runtime-core@3.5.42`） | 后果 |
| --- | --- |
| `hasPropsChanged` 里 `hasPropValueChanged(...) && !isEmitListener(emitsOptions, key)` | **只改监听器不会让子组件重渲染** ⇒ 依赖 `onUpdated` 的增量同步看不到「监听器变了」 |
| `setFullProps` 明确跳过 `isEmitListener` 的键，listener 不进 `props` 也不进 `attrs` | 子组件**拿不到**任何「监听器变了」的响应式信号（`useAttrs()` 也看不到） |
| `emit` 只从 `instance.vnode.props` 读 handler；`.once` 的键是 `handlerName + 'Once'` | 「扫描 `onXxx` 前缀再归一」的判定会把 `@click.once`（`onClickOnce`）判成没绑定 |

实测现象：把 `onClick` 从 `undefined` 改成函数（键始终存在、父级没改别的 prop）时，`<BMap>` 不重渲染、
增量同步不跑、**事件直接丢失**。因此改为**地图就绪时一次订全部事件**：43 个 `addEventListener` 是每个
地图一次的固定成本，未绑定 handler 的事件由 Vue 的 `emit` 直接丢弃（一次属性查找）。

`retry()` 之类让**地图实例换新**的路径仍会重建订阅（按「事件名 + 地图身份」记账，旧句柄的订阅由
`ResourceScope` 的 remover 释放）。

- **判定键由 Vue 自己的规则生成**（`emitHandlerKeys`：`toHandlerKey` + `camelize` + `.once` 后缀，
  与 `@vue/runtime-core` 的 `emit()` 逐行对齐），而不是「扫 `onXxx` 前缀再模糊归一」——
  后者会把 `@click.once` 的键 `onClickOnce` 归一成 `clickonce` 而**漏掉订阅**（评审 P1，已修）；
- **值必须是函数或函数数组**（Vue 对 `v-on="[a, b]"` 会一次调多个）；`:onClick="undefined"`
  这种「键存在但没人听」不算绑定（评审 P1，已修）；
- 各拼写是否可达由 Vue 的 handler key 规则决定，不是本库的自由选择（实测 `@vue/compiler-dom@3.5.42`）：

  | 事件 | 能命中 handler 的写法 |
  | --- | --- |
  | `click` | `@click` / `@click.once` |
  | `style-loaded`（canonical） | `@style-loaded` / `@styleLoaded` / 两者的 `.once` |
  | `style_loaded`（别名） | `@style_loaded` / 两者的 `.once`（`camelize` 只认 `-`） |
  | `maptypechange` | `@maptypechange`（名字没有词边界，`@mapTypeChange` 的键 `onMapTypeChange` 不在 `emit("maptypechange")` 的查找链上） |

- 监听器集合变化（`v-if` 切换 handler、动态 `v-on`）由 `onUpdated` 补一次**差集**同步；
- **订阅记账是「事件名 + 地图身份」**，解绑走 `ResourceScope.add()` 返回的 remover（评审 P1：
  只执行原始 `off` 会把失效闭包永久留在 `scope.disposers` 里，反复绑定 / 解绑会持续堆积）；
- 因此「父级每轮渲染都传内联箭头函数」不会新增 `addEventListener`（门禁用
  `listenActivity().calls` 钉住）。

### 5. `useMapEvent`：handler 语义按 Vue 的语义写，不照搬 `useLatest`

官方 React 封装用 `useLatest(handler)` 把最新 handler 存进 ref（`useMapEvent.ts:16`），
因为 **React 每次渲染都会造一个新函数**，闭包里的值会陈旧。Vue 的闭包读的是响应式对象本身，
不存在这个问题，因此：

| 传法 | 语义 | 用途 |
| --- | --- | --- |
| `useMapEvent('click', (e) => ...)` | 捕获一次即可；状态变化由闭包读 ref 自然看到 | 绝大多数场景 |
| `useMapEvent('click', ref(handler))` | 每次派发读 `.value` | 按条件切换 handler 实现 |

两种传法都**不重绑**：SDK 侧只绑一个稳定 wrapper（`driver.events.on` 的实现按
`target + type` 聚合，同一事件只有一个 raw 监听器），派发时从 `shallowRef` 读当前 handler。

签名（名称任一种拼写；表内事件有逐事件的载荷类型）：

```ts
useMapEvent<K extends string>(
  name: MaybeRefOrGetter<K>,
  handler: MapEventHandler<K> | Ref<MapEventHandler<K>>,
  options?: { source?, coalesce? },
): () => void
```

**raw 逃生口**：Catalog 之外的名字**原样订阅**（上游以后新增的事件不必等本库发版），载荷类型退化为
公共底座 `MapEventPayload`（**不用 `any`**，也不污染表内事件的精确类型）。这正是 issue 的
「保留 raw event escape hatch，但不污染默认类型」。

### 6. 高频事件合帧：5 个持续型事件，`mousewheel` 刻意不合帧

`coalesce: true` = `mousemove` / `touchmove` / `dragging` / `moving` / `zooming`：一帧最多提交一次，
取该帧**最后一次**的载荷（`FrameScheduler` 的 `schedule(key, task)` 语义，key 是每次订阅自己的
symbol，因此共享同一个调度器的多份订阅互不覆盖）。

`mousewheel` **不合帧**：滚轮是离散输入，每次都有独立的 `trend`（放大 / 缩小），合帧会把
「一帧内先放大再缩小」压成一次。

**`useMapStatus` 的全部订阅都不合帧**——这一点不是口味问题而是正确性问题：同一个回调里既更新
「读到的值」也翻 `moving` / `zooming` 标志，若 `moving` 被推迟到下一帧而 `moveend` 同步处理，
标志会被后到的 `moving` 重新置为 `true`，出现「已结束却仍在移动」。用例
（「同一帧内 moving 之后紧接 moveend：标志必须是 false」）钉住这条。

### 7. `useMapStatus`：只读 refs、值判等、`null` = 未知

| 维度 | 处置 |
| --- | --- |
| 形态 | `Readonly<ShallowRef<...>>`（与 `useBMapServiceTask` 一致），不用 `reactive` |
| 订阅 | 12 份（读值 6 + 标志 6），去重后落在 **10 个事件类型**上（`moveend` / `zoomend` 两组共用）——`EventDriver` 按 `target + type` 聚合，因此 raw 监听器恰好 10 个，用例精确断言这个集合 |
| 就绪即给值 | 订阅时先读一次当前状态（地图创建后一直没动过也有值） |
| 更新判等 | 逐字段容差判等，**相等就保持原对象**（`watch(center)` 不会被同一视野的重复事件唤醒）；容差与受控视野同源：经纬度 `1e-7`、`zoom` `1e-6`、角度 `0.01` |
| 读不出 | 句柄为 `null`（未就绪 / 销毁）⇒ 字段回 `null`、标志回 `false`，语义是**未知**而不是「保持上一次的值」 |
| 换地图 | 句柄**身份变化**（map A → map B）时先 `reset()` 再重订：A 的 in-flight `moving` / `zooming` 不会被带到 B（评审建议，已修） |
| 失败路径 | `bind()` 是**事务**：`refresh()` 抛错就地 `unbind()` + `reset()` 再抛。否则「订阅了 12 份、`onScopeDispose` 还没注册」的批次**没有任何释放路径**（评审 P1，已修） |
| 读错误口径 | 复用 `core/utils/liveView.ts` 的 `readLiveView`（只忽略「资源已销毁 / 本引擎没有该能力」），`BMAP_SDK_CALL_FAILED` 一类照旧上抛 |

`useMapStatus` 与 `<BMap>` 共用同一份 `readLiveView`：这条口径此前是 `<BMap>` 里的一个局部函数，
本次抽到 `core/utils/liveView.ts`，让「哪些读回错误可以忽略」只有一处答案。

### 8. 订阅原语只有一份：`core/events/subscribeMapEvent.ts`

「取句柄 → 订阅 → 合帧 → 释放」四步被 `<BMap>`、`useMapEvent`、`useMapStatus` 三处共用：

- 句柄未就绪 ⇒ 返回空 disposer（由调用方的 `watch` 负责在就绪后再调一次）；
- disposer **幂等**：解绑订阅 + 取消挂起任务；自建合帧器一并释放，**共享的合帧器不释放**
  （它属于地图运行时）。

三处不再各写一套 Promise / 定时器 / 解绑逻辑（#38 已为此立过规矩）。

### 9. 与官方参考实现 `huiyan-fe/react-bmap@2.0.1` 的对照

| 维度 | `react-bmap` | 本库 | 处置 |
| --- | --- | --- | --- |
| 加载器 | `@baidumap/jsapi-loader ^1.0.0` | 同（精确锁 `1.0.0`） | 同源（互相印证） |
| 事件清单 | 无契约级清单；`MapProps` 上逐个 `onXxx`（`Map.tsx:57-84`），hook 只收 `type: string` | 上游 `BMap.MapEventMap` 的 41 键 + 2 个运行时事件，逐键进门禁 | **本库更严**：事件名与载荷都有清单，且清单有门禁 |
| `useMapEvent` 的载荷 | `(raw: unknown) => void`，`wrapEvent()` 给出 `{ type, target, point, pixel, overlay, raw }`（`utils/event.ts`） | 逐事件载荷类型（表内事件精确、表外退化）+ 归一化底座 `DriverEvent` | **本库更严**；上游真正的清单在类型包里，React 封装没消费它 |
| handler 更新 | `useLatest(handler)` + 订阅一次（`hooks/useMapEvent.ts:16`） | `shallowRef` 槽位；传函数=捕获一次、传 ref=每次读 `.value` | 同源（都不重绑）；差异来自框架语义 |
| 是否重订阅 | deps `[map, driver, type, handlerRef]`（`hooks/useMapEvent.ts:21`），`type` 变化即重订 | 同（`name` 变化重订），并把「handler 不在 deps 里」写成用例 | 同源 |
| 按需订阅 | `if (!current) continue`（`Map.tsx:413`）+ `eventKey` 只编码「handler 有没有」 | **无条件订阅**全部事件 | **本库刻意不同**：React 每次渲染都会重跑 hook，能看到 handler 变化；Vue 既不重渲染、也不把 emit listener 放进 `props`/`attrs`，按需订阅会静默丢事件（见决策 4） |
| 状态 hook | `useMapStatus()` 返回**一个快照对象**（`MapSnapshot`，无 `moving` / `zooming`），内部 `useSyncExternalStore` + 值键缓存（`hooks/useMapStatus.ts:54`） | 返回**一组只读 refs**，新增 `moving` / `zooming` | 框架语义差异（Vue 用 refs）；`moving`/`zooming` 是 issue 要求的增量 |
| 状态订阅的事件 | `['moveend','zoomend','resize','headingchange','tiltchange','moving','tilesloaded']` | 12 个（读值 6 + 标志 6），且标志类**不合帧** | 本库覆盖更全；`moving` 在参考实现里只是「顺便刷新快照」，本库用它驱动一个布尔标志，因此必须保证不倒置 |
| 读错误的容错 | 每个字段 `safeNum` / `safePoint` 包一层 `try/catch { return null }` | 只忽略白名单错误码，其余上抛 | **本库更严**：`catch { return null }` 会把「读错」伪装成「读不到」 |
| 未归一化字段 | `wrapEvent` 给出 `overlay`（SDK 覆盖物实例） | **不给** `overlay`，需要时走 `raw` | **本库更保守**：把 SDK 实例投影成句柄需要身份映射，本库没有可验证的等价表示，不做假投影 |
| 指针事件的 `point` | `r?.point ?? r?.latlng ?? r?.latLng`，可能 `undefined` | 指针类事件兜底 `{lng:0,lat:0}`（沿用既有 `click` 契约） | 同源的历史行为，本库把它写成「哪些事件必有 `point`」的清单并用 fixture 钉住 |

### 10. 生命周期事件与「事件专属载荷」的可得性（评审后新增）

三处「声明了却收不到 / 声明了却补不上」的问题，都在**边界**上解决，而不是把类型放宽：

| 问题 | 根因（实测） | 处置 |
| --- | --- | --- |
| `load` 永远收不到 | 官方 `load` 在**首次 `centerAndZoom()` 之后**派发，而 `MapRuntime` 是先 `initializeView()` 再暴露 `map` 句柄；订阅者要等 `mount()` resolve 才拿得到句柄 | `MapRuntimeOptions.onMapCreated`：建图成功、初始化视野**之前**的挂载点；`<BMap>` 在那里就把订阅挂上（`load` 于是真的到达） |
| `destroy` 永远收不到 | `MapDriver.destroy` 的收尾顺序是「`events.release()` → 销毁 SDK 对象」，而官方 `destroy` 事件在销毁那一刻才派发 ⇒ 订阅已被摘掉 | Driver 在 `release` 之前**合成派发**一次同语义 `destroy`（走同一条归一化路径，`raw` 是被销毁的实例）；用户 handler 抛错不阻断销毁 |
| `load.point/zoom`、`resize.size`、`maptypechange.zoomLevel` 只能是 optional | 引擎在部分触发路径给的 raw 不完整 | **读回补齐**（`MAP_EVENT_READBACK_FIELDS`：`getCenter` / `getZoom` / `getSize`），让上游声明的**事件级必填字段**在公共类型里成为事实（`MapLoadPayload` / `MapResizePayload` / `MapTypeChangePayload`） |

`mousewheel.trend` 与 `zoomexceeded.targetZoom` **保持 optional**：地图答不出它们（`getZoom()` 给的是当前级别，
不是「试图到达的级别」；滚轮方向只在 raw 里），本库不做猜测。

### 11. 生命周期两端的可观察集合：`load` 早订、`destroy` 归上下文（评审第二轮）

`<BMap @load>` / `@destroy` 已经可用，但**子组件里的 `useMapEvent('load' | 'destroy')` 收不到**
（评审 P1）—— 两个方向的根因不同，都源自同一件事实：**组件卸载先于地图销毁**。

Vue 的卸载顺序（`unmountComponent`）：父 `beforeUnmount` → 父作用域 stop → 卸载子树（**子作用域 stop**）
→ 父 `unmounted`（`<BMap>` 在这里 `runtime.dispose()` → `driver.map.destroy()` → 合成 `destroy`）。

| 事件 | 为什么收不到 | 处置 |
| --- | --- | --- |
| `load` | 官方在**首次 `centerAndZoom()` 之后**派发，而该调用发生在 `initializeView()` 里、句柄对外可见之前；`useMapEvent` 要等 `map` ref 变化才订阅 | 提供上下文级挂载点 `whenMapCreated`（`MapRuntime` → `MapContext`），`useMapEvent` 在**那之前**就把订阅建好（订阅仍归调用方作用域：那时组件还在） |
| `destroy` | 子作用域在**地图销毁之前**就 stop 了，挂在调用方作用域上的订阅必然先被摘掉 | `MAP_CONTEXT_OWNED_EVENTS`（当前只有 `destroy`）：Map Context 路径下把订阅登记在**上下文的 `ResourceScope`** 上，随地图一起释放；组件卸载不摘（要提前停止用返回的 disposer） |

**显式 `MapEventSource` 保持 SDK 订阅语义**（不提供这两个上下文能力）：`load` 在「订阅时地图已初始化」
时可能收不到、`destroy` 只在订阅仍然存活时收得到。这条写进 `useMapEvent` 文档与 JSDoc，并有反向用例
（显式 source 的订阅随组件卸载释放 ⇒ 不再收到 `destroy`）。

**副效应**：`<BMap>` 自己的 map 事件订阅同样改用 `runtime.whenMapCreated(...)`（原来的构造选项
`MapRuntimeOptions.onMapCreated` 被这个可订阅入口取代，一个机制服务两处）。

## 后果

### 迁移影响（对调用方可见）

| 变更 | 影响 | 处置 |
| --- | --- | --- |
| `<BMap>` 新增 43 个 map 事件规范名 + 5 个 SDK 拼写兼容名（共 48 个可绑名） | 纯新增（`click` 语义不变） | 文档表格由门禁校验 |
| `<BMap>` 无条件订阅全部 map 事件 | **无行为变化**（未绑定 handler 的事件不产生任何回调），代价是每个地图 43 个 SDK listener | 由「订阅覆盖 Catalog 全部事件」「handler 从 undefined 变函数仍能收到」两条用例钉住 |
| 新增公开 composable `useMapEvent` / `useMapStatus` | 纯新增（根入口） | 文档：`docs/zh-CN/hooks/useMapEvent.md`、`useMapStatus.md`、侧边栏；changeset `minor` |
| 新增公开类型 `MapEventMap` / `MapEventPayload` / `MapEventPayloadOf` / `MapPointerEvent` / `MapEventName` 等 | 纯新增（根入口） | 同上 |
| `DriverEvent` 新增 `trend` / `mapType` / `exMapType` 三个字段 | 纯新增（可选字段） | `mousewheel` / `maptypechange` 的载荷因此不再需要 `raw` |
| 指针类事件的载荷恒有 `point` | 与既有 `click` 行为一致（此前就是 `normalizeMapMouseEvent` 的契约） | `pointer` 清单与 Driver 的兜底清单逐项比对 |
| `@click` 的载荷类型从 `unknown` 变成 `MapPointerEvent` | 更严；运行时形状不变 | 类型变化属修正 |

**无破坏性变更**：既有事件名、载荷形态与 props 语义保持不变。

### 回滚

回滚 = 撤销本 PR：删除 `core/events/{eventCatalog,subscribeMapEvent}.ts`、
`composables/{useMapEvent,useMapStatus,mapEventSource}.ts` 与两个文档页/侧边栏条目，
`<BMap>` 恢复只 `emit('click')`，`core/utils/liveView.ts` 的 `readLiveView` 收回 `<BMap>` 本地。
新增的公共 composable / 类型 / 事件一旦发布，回滚需要按破坏性变更处理（这也是它需要 ADR 的原因）。

## 已知限制（显式接受）

1. **`overlay` 字段不暴露**：指针事件的 `raw.overlay` 是 SDK 的覆盖物实例，本库没有「raw 实例 →
   `OverlayHandle`」的可验证映射（句柄由 Driver 的 registry 反向持有），因此不做投影；
   需要时走 `payload.raw`。参考实现给了 `overlay`，但它给的也是 SDK 实例。
2. **`maptypechange` 的 `mapType` / `exMapType` 原样透传**：它们是 SDK 自己造的 `MapType` 实例，
   本库不做归一（`driver.map.setMapType()` 收的语义枚举是另一回事）。类型为 `unknown`，取用时需自证形状。
3. **`trend` 只在 raw 带布尔 `trend` 时才有值**：非布尔一律按缺失处理，不猜。
4. **指针类事件在 raw 缺坐标时补 `{lng:0,lat:0}`**：与既有 `click` 契约一致（`normalizeMapMouseEvent`
   一直如此）。这条兜底让 `MapEventMap['click'].point` 是必填，代价是「raw 真的没有坐标」时读不到 `0/0`
   与「真的在 0/0」的差别——raw 里有原始数据，需要区分时走 `raw`。
5. **`<BMap>` 的 map 事件订阅在 `onUpdated` 后才同步**：同一 tick 内「先绑监听器、再同步派发事件」
   的极端时序下，第一次派发可能赶不上订阅。真实 SDK 的事件来自用户交互 / 瓦片加载，不在此列。
6. **`useMapStatus` 需要一张**已经建立有效视野**的地图**：`<BMap>` 的句柄在 `initializeView`
   之后才对外可见，因此正常用法不会遇到；但显式 source 传一张「刚 `create()` 还没初始化」的地图时，
   driver 的 getter 会如实抛 `BMAP_INVALID_POINT` / `BMAP_SDK_CALL_FAILED`——本库**不当成「未知」**
   而按「SDK 调用失败」上报（用例钉住）。
7. **`bounds` 不做「空范围」的额外识别**：引擎给出有效范围就读，给不出就按上面的错误码如实上报；
   本库不替引擎判断「这个范围有没有意义」。
8. **`<BMap>` 无条件订阅全部事件**：每个地图 43 个 SDK listener（换来「父级怎么改绑定都不会丢事件」，
   见决策 4）。订阅按「事件名 + 地图身份」重建，但 `retry()` 之后仍然**不会**重跑 `applyMapType` /
   `syncEnableProps` / 视野收敛——那属于「重试 = 重新装配」这个更大的问题（见 ADR
   `2026-09-14-map-controlled-state` 已知限制 7）。当前 `MapRuntime` 在 ready 之后不会重建地图实例，
   因此「按身份重建」这条分支目前是**防御性**的。
9. **`useMapEvent('destroy')` 的订阅归地图所有**（决策 11）：Map Context 路径下它不随调用方组件卸载释放、
   而是活到地图销毁那一刻（那时才回调 + 释放）。因此「组件提前卸载」不会提前停掉它 —— 需要提前停请用
   返回的 disposer。显式 source 不受此规则影响（订阅归调用方）。
10. **宽松拼写只有规范名保证精确类型**（评审 P2，选择「文档说明」而非「给兼容拼写建类型映射」）：
    运行时任意拼写都归一，但只有 `MapEventName` 的载荷推导是精确的。
11. **`mousewheel.trend` / `zoomexceeded.targetZoom` 是 optional**：raw-only 字段（地图答不出「试图到达的
   缩放级别」，滚轮方向也只在 raw 里），本库不猜。其余事件级必填字段（`load.point/zoom`、`resize.size`、
   `maptypechange.zoomLevel`）由 Driver 读回补齐，因此**在类型上是必填**（见决策 10）。
12. **`destroy` 是 Driver 合成派发**（不是直接转发的 SDK 事件）：官方在我们摘掉订阅之后才派发它，
    转发的路子拿不到（见决策 10）。载荷形状与其它事件一致，`raw` 是被销毁的实例。
9. **组件事件的别名目前只有 `ready` → `initd` 一处**，它由 `emitReady()` 从 Catalog 的
   `BMAP_COMPONENT_EVENT_EMIT_ALIASES` 读；表里新增别名时需要同样接一个「唯一出口」。
   门禁只保证「组件里没有第二份手写兼容」（文本扫描），不保证「新别名已接线」。
10. **不建全局事件总线、不跨地图共享订阅**：每个 `useMapStatus()` 调用是一份独立订阅
   （issue 的非目标明确排除「每个事件一个全局 EventBus」）。
11. **map 事件与视野回写是两条订阅**：`moveend` / `zoomend` / `headingchange` / `tiltchange`
   被 #27 的视野回写与 #28 的 map 事件转发各自订阅一次。`EventDriver` 按 `target + type` 聚合，
   因此 SDK 侧仍只有一个 raw 监听器；两份订阅各自释放、互不影响（`listenActivity()` 的计数把这一点
   写成了断言）。

## 验证

- `tests/behavior/v3-map-event-catalog.test.ts`（28 条）：上游 `MapEventMap` 双向取差集、
  名字推导与反例（不拆 `maptypechange`）、归一化无撞车、`resolveMapEventName` 四种拼写、
  合帧集合、`pointer` 标记 ↔ Driver 兜底清单、**两个归一化入口的坐标优先级一致**、
  `trend`/`mapType` 归一化、组件事件别名「只有一处」（含注释不误报的反证）、
  **文档表格逐行比对**。
- `packages/baidu-map-gl-vue/src/composables/useMapEvent.test.ts`（13 条）：
  真实 v4 Driver + Fake v4，覆盖显式 MapSource、SDK 拼写、raw 逃生口、缺 source 的明确报错、
  句柄/名字变化的换订阅、`ref(handler)` 换实现不重绑、按帧合帧与关帧、释放后不投递、幂等释放。
- `packages/baidu-map-gl-vue/src/composables/useMapStatus.test.ts`（14 条）：
  就绪即给值、未就绪=未知、引用不变（含 `watch` 不被唤醒 + **真实变化会唤醒**的正证）、容差、
  八个字段都是 ref、四个字段各自更新、标志起止与「同帧不倒置」、`moving` 只在真变化时唤醒、
  订阅 12 份落在 10 个事件类型（精确集合）、释放后不更新、未初始化视野如实上报。
- `tests/behavior/v3-component-scenarios.test.ts`：M4-EVENTS 一组 **15 条**组件级场景（含「Map Context 下的
  `useMapEvent` 也能收到 `load` / `destroy`」与「显式 source 的订阅随组件卸载释放」两条生命周期门禁）；
  无条件订阅与
  handler 变更不丢事件、订阅覆盖全 Catalog、非函数 handler 不产生调用、事件转发与别名、`@click.once`、
  `@load`、`@destroy`、内联 handler 不重绑、高频合帧、**两张地图不串线**（`@` 与 `useMapEvent` 两条路径）、
  `useMapStatus` 跟随用户交互、卸载后 scope 账本归零）；既有的「不重绑与卸载归零」用例的 fixture 补了
  `@click`（订阅语义变化后仍然要断言得到订阅）。
- 门禁：`typecheck:v3` → `build:v3` → `check:public-dts` → `check:no-bmapgl` → `check:raw-sdk:tree`
  → `test:unit` → `smoke:v4:fixture` → docs 四件套 → `playground:build` → `pack:v3` + `verify:package`。

## 评审修正（2026-09-14 第一轮）

维护者给出 4 条 blocking + 4 条建议。**全部复现属实**，逐条处置（证据见 PR #92 的回复）：

| 评审意见 | 事实核对 | 处置 |
| --- | --- | --- |
| **[P1]** `@click.once` 失效：判定扫 `onXxx` 前缀，而 Vue 把 `.once` 编成 `onClickOnce` ⇒ 归一成 `clickonce`，永远不订阅；且 `onClick: undefined` 被当成「已绑定」 | **成立**。实编译：`@click.once` → `onClickOnce`、`@style-loaded.once` → `onStyleLoadedOnce`；`emit()` 的查找链只有 `toHandlerKey(event)` / `toHandlerKey(camelize(event))` + `handlerName + 'Once'` | 先按 Vue 的键规则重写判定（`emitHandlerKeys`），补 `@click.once` / 别名 + `.once` / 非函数值用例；**随后在写「undefined → 函数」用例时发现更严重的问题**（见下一条），最终改为无条件订阅，判定与 `.once` 处理一并删除（由 Vue 自己负责） |
| **[P1]** 订阅不依赖 prop 检测（原「按需订阅」的真实缺陷） | **成立且比评审描述的更严重**：`hasPropsChanged` 把 emit listener 排除在属性比较之外 ⇒ 「`onClick: undefined` → 函数」不会让 `<BMap>` 重渲染 ⇒ `onUpdated` 增量同步不跑 ⇒ **事件静默丢失**；listener 也不进 `props`/`attrs`，子组件没有任何响应式信号 | 决策 4 重写为**无条件订阅全部事件**；用例「handler 从 undefined 变成函数也不会丢事件」钉住（反证：改回按需订阅即红） |
| **[P1]** `useMapStatus()` 初次 `refresh()` 抛错会遗留已建立的 listener | **成立**：`bind()` 先订 12 份再 `refresh()`，异常把控制流带出 `useMapStatus()`，`onScopeDispose` 都还没注册 ⇒ 这批订阅**没有任何释放路径** | `bind()` 改成事务：抛错就地 `unbind()` + `reset()` 再抛；用例断言抛错后该地图 `listenerCount() === 0` |
| **[P1]** `load` / `destroy` 在正常生命周期下收不到 | **成立**。`load`：`MapRuntime` 先 `initializeView()`（内部首次 `centerAndZoom`）再暴露句柄，而官方 `load` 正是在那之后派发 ⇒ 永远漏；`destroy`：`MapDriver` 先 `events.release()` 再销毁 SDK 对象，官方 `destroy` 那一刻订阅已摘 | 决策 10：新增 `MapRuntimeOptions.onMapCreated`（初始化视野之前的挂载点，`load` 由此订上）；`destroy` 由 Driver 在 `release` 之前**合成派发**（不影响销毁推进）；两条用例 + Fake 照实建模 `centerAndZoom` 首次派发 `load` |
| **[P1]** 动态增删 listener 让 `ResourceScope` 堆积失效 disposer | **成立**：`runtime.resources.add(off)` 的返回值被丢掉，提前解绑只调原始 `off`，失效闭包留在 `scope.disposers` | 订阅记录改存 `add()` 返回的 **remover**；用例断言卸载后 `scope.size === 0` |
| **[建议]** 事件级必填字段（`load.point/zoom`、`resize.size`、`maptypechange.zoomLevel`、`mousewheel.trend`、`zoomexceeded.targetZoom`）在公共类型里都是 optional | **成立**（「typed」但只有 pointer / non-pointer 两档），且 `maptypechange.zoomLevel` 根本没归一 | 决策 10：`payload` 种类（`base`/`pointer`/`load`/`resize`/`maptypechange`）+ Driver **读回补齐**后，前三个成为必填类型；`trend`/`targetZoom` 保持 optional 并写明理由（raw-only，地图答不出） |
| **[建议]** PR 声明导出了 `MapEventHandler`，barrel 里没有 | **成立** | `composables/index.ts` 补导出 |
| **[建议]** `useMapStatus` 从 map A 切到 map B 没复位 `moving`/`zooming` | **成立** | `bind()` 先 `reset()` 再重订；用例断言切图后标志归零、B 的视野被读到 |
| **[建议]** 合帧路径的 handler 抛错被 `FrameScheduler` 静默吞掉（与不合帧路径不一致） | **成立**（`FrameScheduler` 按设计 `catch {}`） | `subscribeMapEvent` 在合帧任务的投递里接住异常并 `queueMicrotask` 重抛（同样的「未捕获错误」可见性，不动调度器语义）；用例钉住 |

**本轮新增单点反证 8 组**（改坏即红，全部还原）：`Once` 变体、值检查、`onMapCreated` 接线、
`destroy` 合成派发、scope remover、`bind()` 事务回滚、`bind()` 状态复位、合帧异常外抛。

## 评审修正（2026-09-14 第二轮）

评审给出 1 条主要 blocking + 2 条 P2（上一轮 8 项已逐条复核通过）。三条均成立：

| 评审意见 | 事实核对 | 处置 |
| --- | --- | --- |
| **[P1]** `useMapEvent('load' \| 'destroy')` 在真实 `<BMap>` 子树里收不到：`load` 因订阅晚于初始化边界；`destroy` 因组件作用域先于地图销毁 stop ⇒ 与「`<BMap>` 与 `useMapEvent` 同一可观察集合」的表述不符 | **成立**。按评审建议先写门禁用例（子树里同时订 `load` / `destroy`，mount→unmount 各一次），实测 `load` 0 次；`destroy` 的时序由 Vue 的卸载顺序决定（子作用域 stop 在 `unmounted` 之前） | 决策 11：上下文级挂载点 `whenMapCreated`（`MapRuntime` → `MapContext`）+ `MAP_CONTEXT_OWNED_EVENTS`（`destroy` 的订阅归上下文 scope）。**没有**采用「只保证 `<BMap @...>`」的替代方案 —— 两条都做成真的可用，且显式 source 的语义用反向用例钉住 |
| **[P2]** 运行时接受宽松拼写，但只有 canonical `MapEventName` 有精确 payload 推导 | **成立** | 采纳评审倾向的第二种：在 `useMapEvent` 文档写明「运行时宽松、类型只在规范名上精确」，并在 JSDoc 里点明 |
| **[P2]** 合成 `destroy` 时 `DriverEvent.raw` 是「即将销毁的 Map 实例」而字段注释写的是「SDK 原始事件对象」 | **成立** | `raw` 的 JSDoc 补上这个唯一例外（避免 raw 逃生口在合成事件上出现意外形状） |

**本轮新增单点反证 3 组**：`whenMapCreated` 接线、`whenMapCreated` 在 `MapContext` 上的暴露、上下文归属清单。

## 非目标

- 不为每个事件创建独立全局 EventBus（issue 非目标）；
- 不把 map 状态持久化到 storage，也不做跨地图共享的状态缓存（同上）；
- 不对 `moving` / `zooming` 逐次深拷贝载荷（同上：合帧只保留最后一次的**引用**）；
- 不暴露 raw `BMap.Map`，也不新增 `overlay` 之类的 SDK 实例投影；
- 不改 `<BMap>` 的 `initd` / `plugin-ready` 等既有组件事件的语义。

## 参考

- issue #28（`M4-EVENTS`，追踪 #12：稳定版阻塞项）
- 上游 `@baidumap/jsapi-v4-types@4.0.4`：`core/MapEvent.d.ts`（`MapEventMap` 41 键与各 payload）、
  `core/Map.d.ts:1263`（`addEventListener<K extends keyof MapEventMap>`）
- 官方 React 封装 `huiyan-fe/react-bmap@2.0.1`：`src/hooks/useMapEvent.ts`、
  `src/hooks/useMapStatus.ts`、`src/utils/event.ts`、`src/components/Map/Map.tsx`
- [ADR 2026-09-14 Map 视野的受控 / 非受控模型](./2026-09-14-map-controlled-state.md)
  （视野回写、容差判等、`readLiveView` 的来源）
- [ADR 2026-09-11 v4 Map Facet](./2026-09-11-jsapi-v4-map-facet.md)（`heading` 读回带符号）
- [ADR 2026-09-13 默认在线路径委托官方 Loader](./2026-09-13-default-online-loader-cutover.md)（加载器对照）
