# ADR 2026-09-17：声明式 OverlaySpec、Marker 状态模型与图标缓存

- 状态：已接受（Accepted）
- 日期：2026-09-17
- 计划键：`M5-SPEC-MARKER`（issue #30，追踪 #12，前置 #29）
- 取代（**只取代下列具体决策，不整份取代**）：
  - [ADR 2026-09-11 v4 Overlay Facet](./2026-09-11-jsapi-v4-overlay-facet.md)「覆盖物属性更新分类」
    里关于**组件侧如何消费分类**的部分：该 ADR 定的是 Driver 侧的 `OVERLAY_DESCRIPTORS`
    （仍然有效，是本 ADR 的分类事实源），而「组件各自声明 watcher + 自己决定要不要重建」的做法
    由本 ADR 的声明式 `fields` 取代。
  - [ADR 2026-09-11 v4 Overlay Facet](./2026-09-11-jsapi-v4-overlay-facet.md)「内置图标名的雪碧图映射」
    一节：图标表从 Driver 移到 `core/icons/markerIcon`，并**扩展为全部 27 个内置名**
    （原实现只有 7 个，其余 20 个静默回落 `simple_red`——见决策 5）。
- 相关：`packages/baidu-map-gl-vue/src/core/overlays/OverlaySpec.ts`、
  `packages/baidu-map-gl-vue/src/core/composables/useOverlaySpec.ts`、
  `packages/baidu-map-gl-vue/src/core/overlays/OverlayRegistry.ts`、
  `packages/baidu-map-gl-vue/src/core/icons/markerIcon.ts`、
  `packages/baidu-map-gl-vue/src/components/overlays/markerSpec.ts`、
  `packages/baidu-map-gl-vue/src/components/overlays/BMarker.vue`
- 对照物：官方 React 组件库 `huiyan-fe/react-bmap@2.0.2`
  （`src/utils/createComponent.tsx`、`src/components/Overlay/index.tsx`、`src/hooks/useIcon.ts`、
  `src/context/OverlayTargetContext.ts`）
- 官方依据：JSAPI 4.0 API 参考（`BMap.Icon` / `BMap.Marker`）、
  `@baidumap/jsapi-v4-types@4.0.4`（`overlay/Marker.d.ts`、`overlay/Icon.d.ts`、`overlay/OverlayEvent.d.ts`）、
  官方指南「设置点标记样式」

## 背景

`OverlaySpec` 这个名字在 issue #30 里指的是「所有覆盖物共用的、**声明式**的生命周期与字段更新
策略」。动手前先盘了现状，实际缺口有三层：

1. **更新层被复制了 10 份**。`useOverlayResource` 已经把 create / mount / unmount / rebuild / child scope
   收在一处，但**字段 watcher** 仍在每个组件里手写：11 个覆盖物组件里共 74 个 `watch`
   （BMarker 9 个、BCircle 11 个、BPolygon 10 个…），而且「哪个属性是构造期属性」这个判断也散在
   组件里——BMarker 迁移前甚至会去探测 raw SDK 有没有 `setIcon`（G4 的边界规则不允许）。
2. **`useSdkResource` 是死代码**。它是 #21 留下的「统一资源生命周期」，有完整测试、有公共导出，
   但**没有任何生产消费者**；同时 `useOverlayResource` 又把它该做的事做了一遍。
3. **两处基座是摆设**：
   - `OverlayRegistry` 由 `MapRuntime` 创建、挂在 `MapContext.overlays` 上，但**没有任何组件往里
     登记**（`register` 只有测试消费者），于是「按类型清点当前存活的覆盖物」这件事在库内根本不可用；
   - `CORE/icons/iconCache` 的 LRU 缓存同样没有生产消费者，`driver.buildIcon` 每次更新都
     `new Icon(...)`；而图标表还存在**两份**（Driver 7 个名字 / `useBMapMarkerIcons` 27 个名字），
     于是另外 20 个内置名走到 Driver 时静默回落 `simple_red` 的雪碧图位置。

## 决策

### 1. 组件只声明 `OverlaySpec`，生命周期与字段下发由 `useOverlaySpec` 驱动

`OverlaySpec<Props, Resource>`（`core/overlays/OverlaySpec.ts`）只有四组信息：`type` / `targetKind`、
`fields`（prop → 更新策略）、`descriptorKeys`（prop → 描述符键）、`create` 与 `events`。
**没有** `add` / `remove` / `bind` 这类扩展点——它们对当前唯一的消费者（Marker）全是死参数，
扩展点按需添加（需要自定义挂载方式的组件见已知限制 5）。
`useOverlaySpec`（`core/composables/useOverlaySpec.ts`）把它翻译成一个 `SdkResourceSpec`
交给 **`useSdkResource`** 执行——创建、挂载、实例 child scope、`replace()`（重建）、卸载与
幂等 dispose 都由后者提供（`useSdkResource` 因此获得了第一个生产消费者，缺口 2 消解）。

字段的策略取值与它们对描述符的要求：

| 策略 | 含义 | 对 Driver 描述符的要求 |
| --- | --- | --- |
| `position` | 经 `driver.overlays.setPosition` 写入，含双向同步与回环抑制 | 该键存在且为 `mutable`（`value: "point"`） |
| `options` | 进更新队列 → `driver.overlays.setOptions` | 该键必须是 `mutable` |
| `recreate` | 构造期属性：变化即重建实例 | 该键必须是 `recreate` |
| `visibility` | 显隐：`show`/`hide` 优先，不可用时退回 `add`/`remove` | 描述符里**没有**该键（显隐不是 SDK 属性） |

**声明与描述符由用例交叉锁定**（`tests/behavior/v3-overlay-spec.test.ts`）：`fields` 的键集必须恰好
等于 `BMarkerProps` 的键集（`OverlayFieldMap` 用 `-?` 映射类型在**编译期**保证），且逐项核对
`options` ↔ `mutable`、`recreate` ↔ `recreate`、`visibility` ↔ 不存在。于是「Marker 所有公开属性
均有明确更新策略」这条验收标准变成一条会红的检查，而不是文档承诺。

**分类的事实源仍然是描述符**：声明是**意图**，真正决定「就地更新还是重建」的是
`driver.overlays.updatePolicy()`（即 `OVERLAY_DESCRIPTORS`）。组件**不得**探测 raw SDK 成员形状。

### 2. 更新走「按键合并的待办队列」，语义与 `useOverlayResource` 完全一致

`useOverlayResource` 的队列语义（PR #61 三轮评审的收敛点）原样搬到本层：

- 同一轮里的更新**按键合并**成一批（同键后写覆盖先写）；
- 批里只要有 `recreate` 键就**先重建**，再把 `mutable` 落到**最终存活**的实例
  （否则会把值写进一个马上被移除的中间实例）；
- 排空过程中新到的更新并入同一轮，因此**后到的值总是最后生效**；
- 入队早于实例就绪时留在待办里，等挂载后排空。

watch 源用 `stableKeyOf`（`core/utils/stableKey.ts`）而不是引用比较：父级每次渲染传内联对象字面量
（`icon` / `offset`）时引用都会变，按引用比较会让「内容没变」也重新下发一次命令。

### 3. Registry registration 与**实例 child scope** 绑定；旧 API 删除

`OverlayRegistry` 的记账模型定型为「**所有者是实例 scope**」：

- `registerResource({ type, resource, scope, remove })` 返回一等 registration（自带 `dispose`），
  并把「从表里摘除」这条 detach 交给 scope；
- scope 释放（重建 / 卸载）时记录自动消失，调用方不必记得再调一次 `unregister`；
- `dispose()` 只清记录，**不**释放别人的 scope（此前 `register(type, instance, owner?)` 把 owner
  scope 的所有权反过来交给注册表，`dispose()` 会去释放其它组件的 scope）；
- 删除 `register` / `unregister` 与记录上的私有字段 `__detach`。旧实现把 detach 闭包挂在记录上
  供 `unregister` 取用，那正是「历史 disposer 闭包」的形态，而它没有任何生产消费者。

`useOverlaySpec` 在挂载时登记、在实例 scope 释放时摘除，于是「100 次重建后注册表仍只有 1 条」与
「反复注册/释放不在 scope 里堆积失效闭包」都成了可断言的事实。

### 4. Marker 位置：受控 prop ↔ SDK 的双向同步 + 值快照式回环抑制

`v-model:position` 的闭环由三条规则构成：

1. **props → SDK**：`position` 变化 → `driver.overlays.setPosition`；
2. **SDK → props**：`dragend` 回写模型，**只有真的变了**才 `emit("update:position")`
   （重复派发同一位置不产生第二条 update）；
3. **回环抑制**：与「最后一次已知与 SDK 一致的位置」相等 ⇒ 不下发命令。

第 3 条的判据是**值**（两条方向都会更新它），不是「来源标记」。这与
[ADR 2026-09-14 视野受控模型](./2026-09-14-map-controlled-state.md) 决策 3 的**理由**一致
（不依赖「事件与命令谁先到」），只是取值的来源不同：

| | `<BMap>` 视野 | `<BMarker>` 位置 |
| --- | --- | --- |
| 判据来源 | **读回** SDK 现值（`driver.map.getCenter()`） | 最后一次同步值（快照） |
| 为什么 | Map Facet 有读回入口，且要挡掉 SLD / 浮点抖动 | `OverlayDriver` **没有**位置读回入口 |

补一个位置读回 API（`getPosition` 在 `Marker` / `Label` / `Circle` 的原型上都存在，但不在本库的
归一化调用面里）需要同时动描述符元数据、Driver 接口、Fake 与能力目录，收益与 #31（Label / 矢量 /
Rectangle 与事件）重叠——**留给 #31**，本 ADR 记为已知限制。

`dragend` 的载荷读的是**归一化后**的 `point`：官方 `MarkerEventMap.dragend` 的类型是
`OverlayMouseEvent<Marker>`，`point` 与 `pixel` 都是必填，因此「dragend 一定带地理坐标」是上游
声明的契约（本库 `driver/normalize/events.ts` 就是按这份契约归一化的）。数值守卫留给 JS / `any`
调用方：拿不到合法点就不回写模型，不猜位置。

### 5. 图标：descriptor 单一事实源 + 有界 LRU 缓存；`BMap.Icons` 不使用

- **内置图标表移到 `core/icons/markerIcon.ts`**（单一事实源）。此前 Driver 一份（7 个名字 +
  `start`/`end` 的 data URL 覆盖）、`useBMapMarkerIcons` 一份（27 个名字），而 `BMarkerProps.icon`
  的类型认的是 **27 个**名字 ⇒ 另外 20 个名字（`red1`~`red10` / `blue1`~`blue10`）会静默渲染成
  `simple_red` 的格子。现在两侧读同一份数据，并补了一条「每个内置名都落在自己的格子上」的检查。
  `start` / `end` 的 data URL 覆盖**保留**（`<BMarker icon="start">` 的观感依赖它），与
  `useBMapMarkerIcons` 的雪碧图版本刻意不同——该差异早于本次改动，本 ADR 只收敛数据来源。
- **LRU 缓存接到 `buildIcon` 上**（每个 Driver 一份，即每张地图一份）：键是 descriptor 的全字段，
  上限 `DEFAULT_ICON_CACHE_SIZE = 200`。上限是必须的——只要用户在渲染里拼 `imageUrl`
  （带时间戳 / 宽度参数的 CDN 地址），键空间就是无界的。
- **缓存里的 Icon 只读、从不就地修改**。官方指南明确：「直接调用 `setImageUrl` / `setSize` 等改
  icon 之后 Marker 并不会同步刷新，必须重新 `setIcon(icon)`」。共享一个 Icon 实例因此是安全的
  （官方示例也共享）；一旦我们原地改它，所有共享它的 Marker 都会跟着变。
  **换图标 = 换 descriptor = 换缓存条目**，更新路径永远是 `setIcon(新的/缓存里的 Icon)`。
- **`BMap.Icons` 不使用**。issue 原文写的是「`BMap.Icons` adapter」，但该成员在本引擎没有声明的
  运行时入口：`@baidumap/jsapi-v4-types@4.0.4` 的 `overlay/` 里只有 `Icon.d.ts` / `IconOptions.d.ts`
  与 `IconSequence.d.ts`，`index.d.ts` 的三斜线引用里也没有 `Icons`；官方 JSAPI 4.0 API 参考里
  `BMap.Icon` 有独立页面、没有 `Icons`。按 official-first 规则（上游没有的能力不得靠就地
  augmentation 或结构性探测「补齐」），这里实现的是**官方声明的等价面** `BMap.Icon`，
  adapter 的职责收窄成「领域 descriptor → `BMap.Icon` 构造参数」。

### 6. 与官方参考实现 `huiyan-fe/react-bmap@2.0.2` 的对照

| 维度 | 参考实现 | 本库 | 结论 |
| --- | --- | --- | --- |
| 声明面 | `createOverlayComponent` 的 `optionProps` / `ctorOnlyProps` **两张手抄数组** | `fields` 一张表，分类来自 Driver 描述符并有交叉校验 | 本库更严 |
| 键名映射 | 直接透传 prop 名 | `descriptorKeys` 显式声明（`position` → `setPosition`） | 本库更显式 |
| 位置更新 | `positionProp` + `setOverlayPosition`，无 v-model | `"position"` 策略：双向同步 + 回环抑制 + `update:position` | 本库更完整 |
| 显隐 | 单独 `useEffect` 调 `hideOverlay` / `showOverlay` | `"visibility"` 策略，且区分「在图上但隐藏」与「未挂载」 | 本库更严（`visible:false` 的初值不会被先 add 再 hide） |
| 构造期属性 | 变化时 `stableStringify(ctorOnlyProps)` 进 effect deps ⇒ 重建 | 同一份意图，但分类不手抄 | 同源 |
| 图标 | `useIcon` hook：`url` 变化重建 Icon，其余选项走 icon 自己的 setter | descriptor → 有界缓存 → 每次 `setIcon` | **本库更严**：参考实现对 Icon 调 setter 而不重新 `setIcon`，按官方指南「Marker 不会同步刷新」 |
| 目标注入 | `OverlayTargetContext` + `useSyncExternalStore`（React 需要显式 store 才能在 commit 内通知） | `TargetContext` 的 `shallowRef`，由 `useOverlaySpec` 自动 provide | 同源（Vue 的响应式天然提供「同一次 commit 内可见」） |
| 资源归属 | React effect cleanup | `ResourceScope` + 一等 registration | 本库更显式 |

## 后果

### 迁移影响（对调用方可见）

| 变更 | 影响 | 处置 |
| --- | --- | --- |
| `OverlayRegistry.register` / `unregister` 删除 | 公开 API 收窄（此前无生产消费者，只有测试） | changeset 记录；`registerResource` 是一等入口 |
| `MapContext.overlays` 类型 `unknown` → `OverlayRegistry` | 类型更严（此前调用方拿不到任何成员） | 无运行时影响 |
| `BMarker` 的 `visible: false` 初值行为 | 此前实例先是「未挂载」，切到 `true` 时调 `show()`（作用在未挂载实例上 ⇒ 永远不显示）；现在 `true` 时才真正 `add` | 修 bug，用例锁定 |
| `red1`~`red10` / `blue1`~`blue10` 的渲染位置 | 此前静默回落 `simple_red` 的格子，现在落在自己的格子上 | 修 bug，用例锁定 |
| 相同图标配置的 Marker 共享同一个 `BMap.Icon` 实例 | 只读共享（我们从不改它），命令次数下降 | 用例锁定 |
| `useOverlaySpec` / `OverlaySpec` 新增公开导出 | 自定义覆盖物有了受支持的入口 | changeset（minor） |
| 重复渲染传「内容相同的内联对象」不再触发 SDK 命令 | 命令次数下降，行为不变 | 用例锁定（`stableKeyOf`） |

**无破坏性变更**：`BMarkerProps` 的字段、默认值与 emits 列表未变；其余 10 个覆盖物组件仍走
`useOverlayResource`，本次**不动**（见非目标）。

### 回滚

按 issue #30 的「风险与回滚」：`OverlaySpec` 是后续组件的基础，因此**先用 Marker 验证完整生命周期**。
回滚时只需：

1. 把 `BMarker.vue` 切回 `useOverlayResource`（`markerSpec.ts` 是纯声明，删除即可）；
2. `useOverlaySpec` / `OverlaySpec` 一并删除（没有别的消费者）。

Driver 侧的图标改动（表格收敛 + 缓存）与 `OverlayRegistry` 的记账模型是独立的两块，可以单独保留
或单独回滚——它们不依赖 `OverlaySpec`。

## 已知限制（显式接受，带归属）

1. **覆盖物位置没有读回入口**（决策 4 的取舍）。回环抑制因此基于「最后一次同步值」而不是
   「读回现值」：若 SDK 在某次 `setPosition` 之后**自行**改变了位置且没有派发事件，快照会与实际
   分叉，直到底层派发一次事件或外部再次赋值。补 `OverlayDriver` 的位置读回 API 属 **#31**。
2. **其余 10 个覆盖物仍是命令式 watcher**（`useOverlayResource`），`OverlaySpec` 目前只有
   Marker 一个消费者。批量迁移按 issue #30 的「风险与回滚」留给 **#31 / #33**；
   在迁移完成前 **`useOverlayResource` 与 `useOverlaySpec` 会并存**——这是有意的过渡态，
   不是遗漏（两层的队列语义一致，迁移是机械替换）。
3. **图标缓存按 Driver 实例**（每张地图一份）。同一个页面上的两张地图不会共享 Icon 实例：
   `BMap.Icon` 是纯值对象、跨地图共享本来是安全的，但那样会把缓存变成模块级可变状态
   （本库一贯避免），收益也有限（同款图标的 Marker 通常在同一张地图上）。
4. **`dragend` 缺坐标时按归一化契约补 `{lng:0,lat:0}`**（`normalize/events.ts` 的既有口径，
   `POINTER_EVENT_NAMES` 包含 `dragend`）。组件侧读的是归一化后的 `point`，因此**不会**跳过，
   而是把 Marker 放到 (0,0)。上游声明 `point` 必填，该分支在真实 SDK 上不可达；真出现时应当
   在归一化层而不是组件层处置（沿用 #28 的口径）。
5. **`OverlaySpec` 只覆盖「加到地图上的覆盖物」这一形态**：挂载/摘除固定走
   `driver.overlays.add/remove({ kind: "map" })`，`visible:false` 的初始态由 `visibility` 策略
   负责（不是让组件自己判断要不要挂）。像 `BContextMenu` 那样「挂到 target 上而不是加进地图」的
   组件暂时用不了本层——它们需要 `add` / `remove` 级别的扩展点，按需在 #33 添加，
   而不是现在造一个没有消费者的参数。

## 验证

| 检查 | 命令 / 落点 |
| --- | --- |
| 声明面覆盖与描述符一致 | `tests/behavior/v3-overlay-spec.test.ts`（3 条） |
| 初始状态 / mutable / recreate / drag-end / Target+Registry / 100 次重建 | 同上（12 条） |
| 图标缓存命中与上限、内置名解析 | `tests/behavior/v3-marker-icon-cache.test.ts`（5 条） |
| 内置名清单与 `MarkerIconName` 双向一致 | `packages/baidu-map-gl-vue/src/core/icons/markerIcon.test.ts` |
| 注册表的显式释放 / scope 释放 / 不堆积 | `packages/baidu-map-gl-vue/src/core/overlays/OverlayRegistry.test.ts` |
| `stableKeyOf` 的稳定性与循环引用 | `packages/baidu-map-gl-vue/src/core/utils/stableKey.test.ts` |
| 既有覆盖物行为不回归 | `v3-bmarker-update` / `v3-overlay-update-policy` / `v3-bcontextmenu` / `v4-components-lifecycle` |
| 边界与发布产物 | `check:raw-sdk`（两条）/ `check:public-dts` / `check:no-bmapgl` / `typecheck:v3` / `build:v3` / `test:unit` / `verify:package` |

## 非目标

- **不重构 `BInfoWindow`**（issue #30 明文）。
- **不批量迁移其余覆盖物**（issue #30 的「风险与回滚」：先用 Marker 验证完整生命周期）。
- **不为大型点集使用逐项 BMarker**（issue #30 明文）。
- **不在组件内手工注册 Registry**：登记只发生在 `useOverlaySpec` 的挂载路径上。
- 不新增覆盖物 position 的读回 API（见已知限制 1）。

## 参考

- issue #30（`M5-SPEC-MARKER`）、追踪 issue #12「M5 / Overlay」泳道
- [ADR 2026-09-11 v4 Overlay Facet](./2026-09-11-jsapi-v4-overlay-facet.md)（`OVERLAY_DESCRIPTORS` 与属性分类）
- [ADR 2026-09-14 视野受控模型](./2026-09-14-map-controlled-state.md)（回环抑制的口径）
- [ADR 2026-09-14 服务生命周期](./2026-09-14-service-lifecycle-and-local-search.md)（状态口径与资源释放）
- 官方：JSAPI 4.0 API 参考 `BMap.Icon` / `BMap.Marker`；官方指南「设置点标记样式」；
  `@baidumap/jsapi-v4-types@4.0.4` 的 `overlay/Marker.d.ts`、`overlay/Icon.d.ts`、
  `overlay/OverlayEvent.d.ts`（`MarkerEventMap.dragend: OverlayMouseEvent<Marker>`，`point` 必填）
- 对照：`huiyan-fe/react-bmap@2.0.2`（`createComponent.tsx` / `useIcon.ts` / `OverlayTargetContext.ts`）
