# ADR 2026-09-14：`BMapExpose` 冻结面、容器门禁与可见性暂停策略

- 状态：已接受（Accepted）
- 日期：2026-09-14
- 计划键：`M4-HANDLE-UX`（issue #29，追踪 #12，前置 #28）
- 相关：`packages/baidu-map-gl-vue/src/types/mapExpose.ts`、
  `packages/baidu-map-gl-vue/src/core/runtime/mapCommands.ts`、
  `packages/baidu-map-gl-vue/src/core/runtime/elementSize.ts`、
  `packages/baidu-map-gl-vue/src/core/runtime/suspension.ts`、
  `packages/baidu-map-gl-vue/src/composables/useMapSuspension.ts`、
  `packages/baidu-map-gl-vue/src/components/map/BMap.vue`、
  `packages/baidu-map-gl-vue/src/core/runtime/MapRuntime.ts`、
  `packages/baidu-map-gl-vue/src/core/scheduler/FrameScheduler.ts`、
  `packages/test-utils/browser-shims.ts`、`docs/zh-CN/components/map.md`、
  `tests/behavior/v3-component-scenarios.test.ts`、`fixtures/v3-consumer/src/index.ts`
- 对照物：官方 React 封装 `huiyan-fe/react-bmap@2.0.1`
  （`src/components/Map/Map.tsx`、`src/components/Map/MapRef.ts`）
- 上游依据：`@baidumap/jsapi-v4-types@4.0.4` 的 `core/Map.d.ts`（`checkResize` / `panTo` /
  `panBy` / `fitBounds` / `getBounds` / `getSize` / `setHeading` 等原型方法）与
  `core/MapOptions.d.ts`（`minZoom` / `maxZoom` / `displayOptions`）

## 背景

`<BMap>` 在 #27（视野状态）与 #28（typed events）之后已经有完整的**声明式**契约，缺的是三件
「运行时」的事：

1. **命令面没定型**。`defineExpose()` 返回的是一个匿名对象：没有公共类型名，消费方拿不到
   「稳定在哪」的承诺；`resetCenter` 这个废弃别名（名字说重置中心、实现重置整个视野）仍在；
   常用业务（读视野 / 平移 / 适配 / 尺寸校正 / 能力查询）要么自己拼 `client.driver.*`，要么
   只能拿到 driver 层的 `MapHandle` 再往下探。
2. **容器零尺寸时会建出一张 0×0 的地图**。Tab / Drawer / 折叠面板在展开之前正是 0×0，而
   JSAPI 4.0 不会自己重算尺寸，用户看到的是「地图加载完了但一片空白」。文档此前只能让调用方
   「容器尺寸变化后手动调 `checkResize()`」。
3. **可见性 / 页面前后台没有任何策略**。`MapRuntime` 的 `suspend` / `resume` 是**一个布尔位**：
   任何一处 `suspend()` 都会暂停整张地图，任何一处 `resume()` 都会无条件恢复。于是
   「用户手动暂停 → 切走标签页 → 切回来」这条日常路径会把用户的手动暂停一起抹掉。

issue #29 要求一次给出这三样，并且 issue 评论指定了环境采集的落点（VueUse 的四个 composable）
与一条硬边界：**「VueUse 采集环境信息，项目自己的暂停原因集合负责决策」**。

## 决策

### 1. `BMapExpose` 是冻结的组件级命令面；`MapHandle` 保持 driver 层的**最小**句柄

票面把两者并列写了「MapHandle / BMapExpose」。本库的实际分工是：

| 名字 | 归属 | 形状 | 怎么拿到 | 用途 |
| --- | --- | --- | --- | --- |
| `MapHandle` | Driver 层（SDK 侧句柄） | `SdkHandle<"map">`：品牌 + `raw` | `ready` 载荷 / `useBMapContext().map` / `BMapExpose.getMapInstance()` | 交给 Facet Driver；raw SDK 对象经 `./advanced` 的 `unwrapRaw()` |
| `BMapExpose` | 组件层（用户侧命令面） | 常用命令 + 生命周期 + 暂停策略 | `<BMap ref>` | 业务在父组件里下命令、等就绪、重试加载 |

**刻意不做的事**：没有把常用命令挂到 `MapHandle` 上，也没有把它改名。原因是它已经被 70 个
文件（Driver / Client / Fake / composable / 文档）消费，而且是 raw SDK 边界的唯一货币；
往它上面挂方法会让「句柄」同时变成「命令面」与「SDK 句柄」两种东西，边界立刻模糊。
因此本票的交付是：**新增** `BMapExpose`（用户侧），**冻结** `MapHandle`（不膨胀），
两者靠 `getMapInstance()` 衔接 —— 这一条写进 `src/types/mapExpose.ts` 的文件头，改名的人先读它。

**验收映射**：票面「MapHandle 足够完成常用业务且保持可演进」落在 `BMapExpose`（常用命令足够）
与 `MapHandle`（不添加成员、只保留品牌 + raw）两处；「raw escape hatch 只从 `./advanced` 类型
暴露」由 `tests/behavior/v3-entry.test.ts` 的一条成对断言锁住（根入口不得有
`unwrapRaw` / `createHandle` / `HANDLE_BRAND`，`./advanced` 必须有）。

### 2. 命令面只冻结 **14 条**：get / set / pan / fit / supports（`checkResize` 归组件面）

| 类别 | 成员 |
| --- | --- |
| 读（读不到 ⇒ `null`） | `getCenter` `getZoom` `getHeading` `getTilt` `getBounds` `getSize` |
| 写（未就绪 ⇒ 空操作） | `setCenter` `setZoom` `setHeading` `setTilt` |
| 平移 / 适配 | `panTo` `panBy` `fitBounds` |
| 能力查询 | `supports(capability)` |

`checkResize()` **不在命令面里**（它在 `BMapExpose` 上）：它必须与「容器门禁 + 暂停策略」同一
口径（暂停期间不得下发 SDK 命令），由 `MapRuntime` 统一实现；命令面自己再实现一份就会与暂停
策略漂移。

**为什么不做全透传**：issue 非目标第一条就是「不把完整 `BMap.Map` 方法全部透传」，理由是
**冻结 SDK 表面** —— 透传越多，公共 API 越难演进，而「哪些能力可用」的单一事实源是 Capability
Catalog。官方参考实现走的是另一个方向（见决策 10 的对照表）。

### 3. 未就绪时：读给 `null`、写是空操作，**不排队**

写命令在没有句柄时**什么都不做**，刻意不做「先排队、就绪后重放」：排队会让命令的生效时机
不可观察（调用方无法知道自己是「生效了」还是「还挂着」），而确定性路径本来就有
`await whenReady()`。读命令的容错口径复用 `core/utils/liveView.ts` 的 `readLiveView`：
只有「资源已销毁」「当前引擎没有该能力」算读不到，其余 `BMapError` 与编程错误一律上抛。

### 4. 容器门禁：测**根容器**的尺寸，零尺寸不建图，且只放行一次

| 维度 | 处置 | 依据 |
| --- | --- | --- |
| 测谁 | 组件**根容器**（`.bmap-container`），不是内层 `bmap-canvas-host` | 根容器才是作者声明的尺寸所在；内层是 `inset: 0` 的定位壳，真实浏览器上两者同盒，但「测量谁」必须是显式选择（`BMap.vue` 有注释） |
| 判据 | 宽与高**都** > 0（`isUsableSize`） | 展开动画的中间帧是「宽度已到位、高度还是 0」，拒绝它会让门禁永远等不到 |
| 读数 | `getBoundingClientRect()` → `offsetWidth/Height` → `clientWidth/Height` | rect 是唯一能反映 transform 与小数的读数；**只要 rect 可读就用它（哪怕是 0）**，否则「真的被折叠」会被降级读数掩盖 |
| 放行 | 只在「不可用 → 可用」那一次触发 `boot()`，且**不**额外请求 `checkResize` | 建图自己会应用首次视野，补一次 resize 是多余命令 |
| 建图之后容器又变成 0 | **不**销毁地图、也不取消门禁 | issue 非目标：不在离开视口 / 折叠时销毁 WebGL Map |
| 自动重设 | 容器尺寸变化经**既有 `FrameScheduler`** 合帧后调 `checkResize()`（一帧最多一次） | issue 评论的「复用内部适配入口，不在组件中散落独立 Observer/RAF」 |

`enableAutoResize` 由此**从「接收后忽略」变成真支持**（此前它只在 `BMapProps` 里有声明，
默认值也没进 `withDefaults`，文档却写着默认 `true`）。默认 `true`；传 `false` 时只更新读数，
由调用方自己在合适时机调 `checkResize()`。

### 5. 暂停是**原因集合**，`disposed` 是终态原因

原因取值表在 `core/runtime/suspension.ts`（值 + 同名类型，与 `DrivingPolicy` 同形）：

| 原因 | 谁加 | 谁移除 | 语义 |
| --- | --- | --- | --- |
| `user` | `BMapExpose.suspend()`（默认） | 调用方 `resume()` | 业务主动暂停；与其他原因**互相独立**（别的原因怎么变都不会把它摘掉） |
| `keep-alive` | `<BMap>` 的 `onDeactivated` | `onActivated` | KeepAlive 停用（不销毁地图） |
| `document` | 页面 `visibilitychange → hidden` | 页面重新可见 | 后台标签页 |
| `offscreen` | 容器离开视口（安全边 64px） | 回到视口附近 | **不销毁地图** |
| `disposed` | `MapRuntime.dispose()` | **不解除** | 终态：集合永不为空 ⇒ 卸载之后不再调用 SDK |

三条冻结语义：

1. **`resume(reason)` 只减一个原因**，只有集合变空才真正恢复；「页面恢复可见」因此不可能
   解除用户的手动暂停（验收里的「不发生误恢复」）。恢复时**补偿一次 `checkResize()`** ——
   后台 / 视口外发生的尺寸变化没有下发过 SDK 命令。
2. **暂停期间 `checkResize()` 是 no-op，且 `requestResize()` 连帧都不排**（`FrameScheduler`
   新增 `pause()` / `resume()`）。连帧都不排是可以被门禁证明的：`createManualFrames().pending()`
   归零。
3. **`disposed` 让「卸载后不再调 SDK」成为集合的性质**，而不是 `status` 守卫的巧合。

### 6. 环境采集委托 `@vueuse/core`，决策留在本库

按 issue 评论的指定，四个 composable 全部采用：`useResizeObserver`（尺寸）、
`useIntersectionObserver`（视口）、`useDocumentVisibility`（页面前后台）、
`usePreferredReducedMotion`（减少动画偏好）。边界刻意画在「采集 vs 决策」：

- **采集**（VueUse）：尺寸与三个布尔信号；
- **决策**（本库）：把信号翻译成暂停原因、门禁放行、合帧 `checkResize`。

三条配套动作（缺一条这个依赖就会变成隐患）：

1. **依赖精确锁定 `14.4.0`**（`dependencies`，与 `@baidumap/jsapi-loader` 同一口径）；
2. **ESM 产物保持 external**（`vite.config.build.ts`）——内联会让「依赖声明」与「产物内容」
   不一致（消费者装一份用不到的包，产物里还塞着另一份实现）；IIFE 档无法 external，仍内联
   （与官方 Loader 同样处理）；
3. **`scripts/verify-package.mts` 增加断言**：发布包必须以 `dependencies` 锁定 14.4.0、消费者
   能解析到它、且 ESM 产物里确实是 `from "@vueuse/core"`。

副作用一处，必须显式记录：`@vueuse/core` 的 `index.d.ts` 引用了 Web Bluetooth 的全局类型
（来自它的依赖 `@types/web-bluetooth`），而本包的 `tsconfig.build.json` 用**显式白名单**
`types` 且 `skipLibCheck: false`，于是 `typecheck:v3` 会报四个 `TS2304`。处置：把
`@types/web-bluetooth@0.0.21` 加进包 `devDependencies` 并登记进 `types` 数组
（不写本地 shim 复刻上游声明；不加宽 `skipLibCheck`）。

### 7. 释放归**地图实例**，不靠 Vue 组件作用域

四个观察器 / 订阅都跑在一个 `effectScope(true)`（detached scope）里，释放只由
`useMapSuspension` 的 `dispose()` 触发，在 `<BMap>` 的 `onUnmounted` 里调用，
且注册顺序保证「先断源（观察器）再交给 Runtime 收尾」。`dispose()` 之后迟到的回调一律被
忽略（`disposed` 门闩），因此不会再触发 `checkResize` 或任何 SDK 调用。

不依赖组件作用域的原因不是洁癖：组件卸载**不等于**地图销毁（`retry()` 会创建第二张地图），
而「地图实例换了、观察器还指向旧容器」正是「多 Map 串状态」的来源。

### 8. `FrameScheduler` 增加 `pause()` / `resume()`

「暂停高频计算」需要一个可断言的落点，因此调度器本身支持暂停：暂停期间不排帧、也不执行已排的
帧，但**保留每个 key 的最后一次任务**，恢复时按 `flush()` 的口径一次提交（合帧本来就只保留
最后一次，所以暂停不丢数据）。三个刻意选择：

- `pause()` 先取消已排的帧（不占住 RAF 句柄）；
- `runFrame()` 再判一次 `paused`（同一帧内 `schedule → pause` 的时序也不会提交）——
  只靠 `cancelFrame` 会留下依赖时序的漏洞；
- `flush()` **不受暂停影响**：它是显式的「现在就要结果」（`DataLayerManager.flush()` 这类
  调用点依赖这个语义）。

### 9. 状态插槽：`#loading` / `#error` 收到**同一份**结构化载荷

```ts
interface MapSlotProps {
  status: MapRuntimeStatus;
  error: unknown;
  containerReady: boolean;      // 门禁是否放行 —— 区分「容器还没展开」与「SDK 在加载」
  retry: () => Promise<MapReadyContext>;
}
```

- `#loading` 在 `status !== "ready"` **且** `status !== "error"` 时渲染，默认文案按 `containerReady` 二选一
  （`waiting for container size...` / `map loading...`）；
- `#error` 在 `status === "error"` 时渲染，默认文案带一个「重试」按钮（覆盖插槽即完全接管）；
- **默认插槽的载荷不变**（`status` / `map` / `error` / `client`），有门禁用例钉住这一点；
- `retry()` 三种情形幂等：门禁没放行 ⇒ 只等（不建图）；已 ready ⇒ 直接返回当前上下文（不重跑
  装配、不重复广播 `ready`）；失败态 ⇒ 走完整路径（清错重入 + 重新装配 + 广播）。
  装配按**句柄身份**幂等，所以「重复 retry」不会把订阅叠两遍。

`resetCenter` 在本票删除（验收明写「`BMapExpose` 不包含错误的 `resetCenter()` 实现」）。

### 10. 与官方参考实现 `huiyan-fe/react-bmap@2.0.1` 的对照

| 维度 | `react-bmap` | 本库 | 处置 |
| --- | --- | --- | --- |
| 句柄形状 | `MapRefImpl`：`useImperativeHandle` 逐个透传 **200+** 成员（含 `getSolarInfo` / `getTileId` / 室内与地球模式），签名对齐 JSAPI 方法表（`components/Map/MapRef.ts`） | `BMapExpose`：14 条常用命令 + 生命周期 + 暂停策略 | **本库刻意更小**：issue 非目标「不把完整 `BMap.Map` 方法全部透传」，透传越多越难演进（要哪个能力先 `supports()` 问，raw 走 `./advanced`） |
| 建图时机 | `useLayoutEffect` 里直接 `createMap`（`Map.tsx:180`），**不看容器尺寸** | 容器拿到非零尺寸才建图 | **本库更严**：真实浏览器上零尺寸建图会得到 0×0 画布，且不会自愈 |
| 首帧暴露 | 等 `tilesloaded` + 500ms fallback 再 `setMap`（规避 GL 顶点构建的 `'width'` 报错） | `ready` 由建图 + `initializeView` 决定；`whenMapCreated` 提供「初始化视野之前」的挂载点 | **本库不同**：上游那条是 v4 GL 的**渲染时序**规避（本库靠 `initialView` + 订阅时机解决），不做「延迟 500ms 暴露句柄」这种会改变 `ready` 语义的兜底 |
| 可见性 / 页面前后台 | 无（离开视口、后台标签页都不处理；`errorFallback` 只是错误兜底渲染） | 暂停原因集合（`document` / `offscreen`），**不销毁地图** | **本库新增**；语义比「不处理」严格：暂停期间不排帧、不下发尺寸命令，恢复时补偿一次 |
| 容器尺寸变化 | 无自动路径（官方 API 里靠 `enableAutoResize` 开关，但 React 封装没有把它接到容器上） | `enableAutoResize`（默认 `true`）→ 合帧后 `checkResize()` | **本库新增**；`false` 时与参考实现一样回到手动 |
| 减少动画偏好 | 无 | `prefersReducedMotion()` 只读信号；**不参与暂停** | 本库新增，且刻意不拿它停必要任务（issue 评论的硬要求） |
| 加载 / 错误插槽 | `errorFallback?: ReactNode`（只有渲染，没有重试） | `#loading` / `#error` + `retry()`（同一份结构化载荷） | **本库更完整**：错误是结构化对象 + 可重试，业务不需要监听内部 Runtime |
| 事件 | `onXxx` props（`Map.tsx:57-84`）+ 内部 `EVENT_MAP` | Catalog 驱动的 typed events（#28） | 已由 #28 收口，本票不动 |

## 后果

### 迁移影响（对调用方可见）

| 变更 | 影响 | 处置 |
| --- | --- | --- |
| 新增公共类型 `BMapExpose` / `MapCommands` 与常量 `MAP_SUSPEND_REASONS`、类型 `MapSuspendReason` | 纯新增（根入口） | 文档「组件方法」一节重写；changeset `minor` |
| **`resetCenter()` 从 expose 移除** | 破坏性（3.0.0-beta 内） | 迁移指引：用 `resetView()`；`docs/zh-CN/guide/migration-from-v2.md` 与 `map.md` 同步改写，`fixtures/v3-consumer` 用 `@ts-expect-error` 反证它真的没了 |
| `suspend()` / `resume()` 从「布尔位」变成「按原因记账」 | 语义收紧：`resume(reason)` 不再等于「恢复一切」 | 文档写明「默认原因 `user`」与「只有集合清空才恢复」 |
| `enableAutoResize` 从「接收后忽略」变成真支持（默认 `true`） | **行为变化**：容器尺寸变化现在会自动 `checkResize()` | 想要旧行为（手动重设）就传 `enableAutoResize: false`；文档表格同步 |
| 容器零尺寸时不再建图（`status` 停在 `idle`） | **行为变化**：`ready` 事件在容器展开后才会来 | 新增 `isContainerReady()` 与 `#loading` 插槽的 `containerReady` 供业务区分 |
| `<BMap>` 新增 `#error` 插槽，`#loading` 插槽载荷新增 `containerReady` / `retry` | 纯新增（既有插槽内容不受影响） | 文档「状态插槽」新增一节 |
| 运行时依赖新增 `@vueuse/core@14.4.0`（精确锁定） | 消费者多一个依赖；IIFE 档内联 | ADR 决策 6；`verify-package` 有断言 |

**破坏性变更清单**：`resetCenter` 移除（一处）；`suspend/resume` 语义收紧（一处）；
「零尺寸不建图」与「自动 checkResize」是行为变化（两处，均有开关或读数可区分）。

### 回滚

回滚 = 撤销本 PR：删除 `core/runtime/{mapCommands,elementSize,suspension}.ts` 与
`composables/useMapSuspension.ts`、`types/mapExpose.ts` 及对应测试，
`<BMap>` 恢复「挂载即 `boot()` + 匿名 `defineExpose`（含 `resetCenter`）」，`MapRuntime` 恢复
布尔暂停位，`FrameScheduler` 去掉 `pause/resume`，`package.json` / `pnpm-lock.yaml` /
`vite.config.build.ts` / `verify-package.mts` 去掉 `@vueuse/core` 相关改动，
`tests/setup.ts` 去掉浏览器替身。新增的公共类型与依赖一旦发布，回滚需按破坏性变更处理。

## 已知限制（显式接受）

1. **未就绪时的写命令是空操作，不排队**：调用方要确定性就得 `await whenReady()`（或 `retry()`）。
   代价写在决策 3；**没有**做「排队后重放」，因为那会让命令的生效时机不可观察。
2. **`prefersReducedMotion()` 目前没有库内消费者**：`<BMap>` 自身没有可选动画（首次视野一直是
   `noAnimation`），所以它是**暴露给调用方**的只读信号，不是组件内部用来停任务的开关。
   顺带登记的欠账：`noAnimation` prop 贯通到视图命令仍属后续（ADR
   `2026-09-11-jsapi-v4-map-facet` 的「已知限制」里那条「属 Vue 层后续议题」）。
3. **容器从非零回到 0 不销毁地图**：SDK 侧此时是 0×0 画布，恢复尺寸后由 `checkResize()` 纠正。
   这是 issue 非目标的直接结果。
4. **零尺寸 + 无 `ResizeObserver` 的环境不会自动建图**：门禁的放行依赖尺寸观察；这类环境需要
   调用方在挂载时给出非零尺寸（真实浏览器都已支持 `ResizeObserver`，因此没有做轮询兜底）。
5. **视口判定有 64px 安全边、且初值乐观**：不支持 `IntersectionObserver` 的环境退化为
   「从不因离屏暂停」；这正是「未知不当作不可见」的选择，避免一上来就暂停。
6. **`offscreen` 在本机 headless smoke 里会真的生效**（`display:none → block` 的宿主在视口之外），
   因此真实档的 `suspendReasons` 会出现 `["offscreen"]` —— 这是**正确行为**，检查体也只断言
   「`user` 被精确摘掉」，不断言「集合为空」。
7. **暂停不阻断 `FrameScheduler.flush()`**（显式 flush 优先于暂停）：`DataLayerManager.flush()`
   这类调用点不受暂停影响，因此「暂停期间一个任务都不提交」这句话的准确范围是
   **经 `schedule()` 排入的帧任务**。
8. **`getMapInstance()` 仍返回 driver 句柄**（不是 raw SDK 对象）：名字里没有 `raw` 就是没有，
   raw 走 `./advanced` 的 `unwrapRaw()`。这条与 v2 迁移文档一致。
9. **`prefers-reduced-motion` 的媒体查询字符串是 `(prefers-reduced-motion: reduce)`**（VueUse
   的默认实现），本库不解析自定义查询。
10. **能力探测在「实例自有成员」上有假阴性（本票登记为欠账，刻意不修）**：
   `CapabilityRegistry` 的 `rawMembers` 探测只查「命名空间顶层 + `Map.prototype`」，而真实
   JSAPI 4.0 有一部分成员是**实例自有**的（实测：`raw.getZoom` / `raw.setZoom` 都是函数，但
   `Map.prototype.setZoom` 是 `undefined`、`getZoom` 在原型上）。后果是 `supports("map.zoom")`
   在真实引擎上**假阴性**；Fake 把两者都放在原型上，所以单测一路绿。本票第一次把它钉在浏览器档里
   （`map-container-gate` 的**现状断言**，两档方向相反：`map.zoom` live=`false` / fixture=`true`，
   `map.bounds` live=`true` / fixture=`false`），属于「夹具与真实引擎不一致」的另一面。
   修它要换探测策略（原型链遍历，或基于**已建实例**探测），是一个独立决策，因此**不在本票范围**；
   当前影响面只有新增的公开 `supports()` —— Driver 内部只为 `map.heading` / `map.tilt` /
   `map.pixel-conversion` / `map.viewport` / `map.style` / `map.animate` 调 `require()`，它们都
   没有这个形态，因此运行时行为不受影响。

## 非目标

- 不把完整 `BMap.Map` 方法表透传（issue 非目标第一条；见决策 2 与对照表）；
- 不在离开视口 / 折叠 / 后台时销毁 WebGL Map（issue 非目标第二条）；
- 不在基础入口公开 raw driver（issue 非目标第三条）；
- 不把 `useMapSuspension` 做成公开 composable：它是 `<BMap>` 的接线细节（需要
  `MapSuspensionTarget` 这种内部形状），暴露出去只会冻结一层不该冻结的 API；
- 不改 `<BMap>` 既有 props / 事件语义（`resetCenter` 的删除是票面点名的唯一一处）。

## 验证

- `tests/behavior/v3-component-scenarios.test.ts`：M4-HANDLE-UX 一组 **16 条**组件级场景
  （命令面读写 / 未就绪空操作 / `resetCenter` 已移除 / `width=0` 门禁 / 祖先 `display:none` 门禁 /
  `enableAutoResize=false` / 页面前后台不误恢复 / 暂停期间不排帧 / offscreen / reduced motion /
  卸载后不再调 SDK / 两张地图不串状态 / `#error` 重试幂等 / `#loading` 的 `containerReady` /
  默认状态文案与重试按钮 / 默认插槽载荷不变）。
- `packages/baidu-map-gl-vue/src/composables/useMapSuspension.test.ts`（12 条）：策略层与
  最小 target 的行为（放行一次、放行前不请求、合帧请求、`autoResize=false`、原因增减、
  乐观初值、reduced motion 不参与、容器引用替换后旧观察器被断开、`dispose` 后忽略迟到信号、
  幂等 dispose、不占 RAF）。
- `packages/baidu-map-gl-vue/src/core/runtime/{elementSize,mapCommands}.test.ts`（14 + 7 条）：
  读数优先级与「读不到 ≠ 零尺寸」；命令面的透传 / 空路径 / 错误口径。
- `packages/baidu-map-gl-vue/src/core/runtime/MapRuntime.test.ts`（新增 7 条）：
  原因集合语义（幂等、不误恢复、暂停期 no-op、未就绪也记账、`disposed` 终态）。
- `packages/baidu-map-gl-vue/src/core/scheduler/FrameScheduler.test.ts`（新增 6 条）：
  `pause` / `resume`。
- `tests/behavior/v3-entry.test.ts`：根入口 ↔ `./advanced` 的 raw 边界成对断言 + 暂停原因常量。
- `tests/browser/jsapi-v4`：新增 required 检查 `map-container-gate`（两档都跑），
  覆盖「真实布局下零尺寸不建图 → 展开后建图一次 → 命令面在真实 SDK 上生效」。
- `fixtures/v3-consumer/src/index.ts`：消费方编译 smoke（实例类型 ↔ `BMapExpose` 互相可赋值、
  `resetCenter` 用 `@ts-expect-error` 反证、读命令不退化为 `any`、写命令参数不被放宽）。
- 门禁：`typecheck:v3` → `build:v3` → `check:public-dts` → `check:no-bmapgl` →
  `check:raw-sdk(:tree)` → `generate:*:check` → `test:unit` → `smoke:v4:fixture` →
  `pack:v3` + `verify:package`。

## 参考

- issue #29（`M4-HANDLE-UX`，追踪 #12）与其「VueUse 引入建议」评论
- 官方 React 封装 `huiyan-fe/react-bmap@2.0.1`：`src/components/Map/Map.tsx`、
  `src/components/Map/MapRef.ts`
- 上游 `@baidumap/jsapi-v4-types@4.0.4`：`core/Map.d.ts`、`core/MapOptions.d.ts`
- [ADR 2026-09-14 Map 视野的受控 / 非受控模型](./2026-09-14-map-controlled-state.md)
  （`readLiveView`、容差判等、`resetView` 的快照语义）
- [ADR 2026-09-14 typed Map Events 与 `useMapStatus`](./2026-09-14-map-events-and-status.md)
  （`whenMapCreated` / `destroy` 订阅寿命、`scheduler` 的合帧口径）
- [ADR 2026-09-13 Official-first：默认加载与 UI Kit](./2026-09-13-official-first-loader-and-ui-kit.md)
  （「运行时依赖精确锁定 + 官方包优先」的既有口径）
- [ADR 2026-09-13 v4 required smoke 的判定口径](./2026-09-13-v4-required-smoke.md)
  （新检查为什么必须进两档、`blocked` 与 `fail` 的分工）
