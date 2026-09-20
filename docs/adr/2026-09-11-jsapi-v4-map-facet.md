# ADR 2026-09-11：v4 Map Facet（构造选项映射 / 初次视野 / 交互开关 / 释放语义）

- 状态：已接受（Accepted）
- 日期：2026-09-11
- 计划键：`M3A2-MAP`（issue #20，追踪 #12）
- 取代：无
- 相关：[`2026-09-11-jsapi-v4-driver-foundation`](./2026-09-11-jsapi-v4-driver-foundation.md)、[`2026-09-11-loaded-sdk-client-boundary`](./2026-09-11-loaded-sdk-client-boundary.md)、[`2026-09-10-bmap-raw-sdk-boundary`](./2026-09-10-bmap-raw-sdk-boundary.md)

## 背景

#19 交付了 v4 Driver 的底座（namespace 校验 / Handle Registry / Geometry / Event），
`createJsapiV4Driver` 仍是「明确失败」的空壳。第一个业务 Facet 是 Map：`BMap.vue` 的
初始化、视野、交互开关、底图类型、样式、投影与销毁全部经 `MapDriver`。

在写实现之前必须冻结四件容易写歪的事：

1. 项目 `InitialMapOptions`（含 `backgroundColor` / `restrictCenter` 这类 v1 时代键）怎么
   映射成 v4 `MapOptions`；
2. 「初次视野」与「后续受控更新」的差异（v4 没有 `setView`）；
3. 交互开关用哪条路径（官方文档提到 `map.setOptions`，但 4.0 API 参考与类型包都没有它）；
4. `destroy` 要释放什么、`destroy` 之后怎么处理后续命令。

## 决策

### 1. 交付 Facet，不提前装配

- Map Facet 落在 `src/driver/jsapi-v4/map.ts`，导出 `createJsapiV4MapDriver(input)`
  （input：`rawSdk` / `geometry` / `capabilities` / `registry` / `events`）。
- **`createJsapiV4Driver` 继续抛 `BMAP_CAPABILITY_UNSUPPORTED`**：装配需要 Overlay /
  Control / Layer / Service / Panorama 五个 Facet（#21~#23），默认 cutover 是 M3A.3（#25）。
  这与 #18 / #19 的立场一致，也保证 `createBMapClient.test.ts` 里「默认路径只接受
  jsapi-v4、且在 M3A.2 完成前明确失败」的断言仍然成立。
- 行为验证因此分两层：`src/driver/jsapi-v4/map.test.ts`（单元）与
  `tests/behavior/v3-jsapi-v4-map.test.ts`（契约 + 生命周期），后者手工组合 Map Facet，
  不经过默认 Client 路径。

### 2. 项目 MapOptions → v4 构造 options 用显式映射表

| 项目键 | 处置 | 依据 |
| --- | --- | --- |
| `minZoom` / `maxZoom` / `displayOptions` | 与 v4 `MapOptions` **同名直通** | `core/MapOptions.d.ts` |
| `backgroundColor` | **丢弃 + warn（每个 Driver 一次）** | v4 `MapOptions` 无该项；背景由容器样式 / `DisplayOptions` 表达 |
| `restrictCenter` | **丢弃 + warn（每个 Driver 一次）** | v4 没有布尔项，范围限制是 `restrictBounds(bounds)` |
| 其余索引签名键 | 原样透传 | `InitialMapOptions` 的索引签名是「v4 自身构造选项」的显式逃生口 |

丢弃而不是透传的理由：v4 会静默忽略不认识的键，整体透传等于「依赖 SDK 隐式默认」——
同一个 `restrictCenter: true` 在 webgl-v1 生效、在 v4 无声失效，是最难排查的一类迁移问题。
丢弃 + 一次性 warn 让迁移影响在日志里可见（迁移处置见下表）。

**库固定默认显式写进构造 options**（`LIBRARY_MAP_DEFAULTS`）：`enableDragging: true`、
`enableWheelZoom: false`。只固定「库已声明默认值且与 v4 隐式默认不同」的键——v4 的
`enableWheelZoom` 隐式默认是 `true`，而组件 `<BMap>` 的默认是 `enableScrollWheelZoom: false`；
不显式固定就会「同一个组件换引擎后滚轮缩放行为反转」。其余交互项库没有声明默认值，沿用 v4
默认，迁移期不引入第二套默认。

### 3. 初次视野用 `centerAndZoom`，后续用 `setCenter` / `setZoom`

- v4 **没有** `setView`（webgl-v1 有）；一次设定中心与级别的入口是 `centerAndZoom(center, zoom, options)`，
  且支持城市名重载（`centerAndZoom(city, zoom?)`）。
- `initializeView` 固定 `{ noAnimation: true }`：v4 文档里 `centerAndZoom` 的 `noAnimation`
  默认就是 `true`，显式写出是为了「不依赖隐式默认」，同时避免 `resetView()` 产生一次视野跳变。
- 后续受控更新走两个独立调用（`setCenter` / `setZoom`），与组件「center、zoom 分别 watch」
  的语义一致：更新一个轴不影响另一个轴。`initializeView` 与这两者的差异在契约里被断言
  （见 `runMapFacetContract`）。

### 4. 交互开关用官方成对 `enable*` / `disable*` 方法，**不用** `setOptions`

- 官方 4.0 API 参考的 `BMap.Map` 方法表与 `@baidumap/jsapi-v4-types@4.0.4` 都**没有** `Map#setOptions`
  （`setOptions` 只出现在 Panorama / Marker / Control 上）；仓库内的官方参考（Skill
  `map-core.md`）虽然提到「运行期间统一用 `setOptions()` 修改」，但它是文档描述，不是可核对的声明。
- augmentation 治理规则只允许补「有运行时依据」的缺口（`@runtimeBasis` 必须可核对），因此**不新增**
  `Map#setOptions` 声明；改用官方参考与类型包**都**公开列出的成对方法。
- 这条判断是刻意的「不做某个转换」：如果真实 runtime 确认存在 `Map#setOptions`，应作为**新的上游缺口
  或新 ADR** 处理（连同 4.0 参考未列出的原因），而不是在这里就地补一条无法验证的声明。
- **成员存在性有分歧时用「结构性判断」而不是预判或异常**：`enableTiltGestures` / `disableTiltGestures`
  在官方 4.0 `BMap.Map` 方法表与 `@baidumap/jsapi-v4-types@4.0.4` 的 `core/Map.d.ts` 中都不存在
  （只有构造选项 `MapOptions.enableTiltGestures`；对比 `enableRotateGestures()` 是存在的），
  但公开的 React 参考实现 `huiyan-fe/react-bmap` 直接调用它们并用 `try/catch` 吞掉失败
  （见文末「跨 Facet 交接风险」里的交叉验证小节）。
  本 Facet 的处置是：**`setInteraction` 先做存在判断，有就调用、没有就按方法名告警一次**——
  既不臆造类型声明、不靠异常做控制流，也不会因为某一处来源缺失就让一个可能可用的开关静默失效。
  这条规则对全部 12 个语义项一视同仁，不再是 `tilt-gestures` 的特例。

### 5. 能力守卫：只守卫「引擎/渲染能力相关」的成员

- 走 `capabilities.require(...)` 的：`map.heading`、`map.tilt`、`map.animate`、`map.style`、
  `map.viewport`、`map.pixel-conversion`。
- 不加守卫的：`getCenter` / `setCenter` / `getZoom` / `setZoom` / `getBounds` / `getSize` /
  `checkResize` / `panTo` / `panBy` / `destroy`——这些是所有引擎都有的核心视野能力，加守卫只会
  增加噪音。
- 读取类调用的失败语义：`callRequired`（成员缺失 → `BMAP_SDK_CALL_FAILED`），避免把「SDK 缺成员」
  伪装成「读到了空值」；`capabilities.require` 先按 `unsupported` 策略给出可解释的
  `BMAP_CAPABILITY_UNSUPPORTED`/warn。

### 5b. 句柄识别一律看品牌，不用 `owns()`

动画入参的解析（PR #60 评审 P2）：**凡带 `HANDLE_BRAND` 的对象一律交给 `registry.resolve()`**，
由 Registry 做所有权校验。用 `registry.owns()` 做前置判断是错的——它把「别的 Client 的 Handle」
和「原生 SDK 对象」都归到 `false`，于是外来句柄会被当成原生对象**原样透传**给 SDK，
既绕过了 `BMAP_HANDLE_FOREIGN`，又把一个包装对象塞进了 SDK 的异步启动流程。

### 6. 投影转换进公共 `MapDriver`

- 新增 `pointToPixel(map, point): Pixel` / `pixelToPoint(map, pixel): Point`，对应 catalog 的
  `map.pixel-conversion`；`webgl-v1` 同步实现（BMapGL 参考里同名同形），共享契约因此在两个引擎上
  跑同一套断言。
- **catalog 的 `map.pixel-conversion.engines` 从 `V4_ONLY` 放宽为 `WEBGL_V4`** 并重新生成能力矩阵：
  该成员被提升为公共 `MapDriver` 成员后 webgl-v1 也必须实现，而 BMapGL 本就提供它，
  继续标 `V4_ONLY` 会让「能力清单的单一事实源」与实际支持漂移（AGENTS.md 的 catalog 约束）。
- 不加 `lnglatToMercator` / `mercatorToLnglat` / `getDistance` 等：属「把官方 Map 方法一比一公开」
  的非目标，等业务出现真实需求再按 Facet 补。
- v4 特有映射：`panBy(pixel)` → `panBy(x, y)`（v4 收两个数字，不是 `Pixel`）；`fitBounds(bounds)`
  → `setViewport([southwest, northeast])`（v4 没有 `fitBounds`，用两点取景保证包含该范围）。

### 7. 释放语义：disposed 与 released 分离 + 动画在安全窗口取消 + 逐项尽力清理

```
destroy(map):
  1. registry.resolve(map)              // 所有权校验（跨 Client 抛 BMAP_HANDLE_FOREIGN）
  2. released / disposing → return       // 幂等（全部完成）+ 防重入（清理在飞）
  3. disposed=true；【先登记取消请求】    // 待启动动画在这一刻无法取消，请求先挂上
  4. 仍有待启动动画？
     是 → 推迟清理：等 animationstart 之后的微任务「先取消，再 release + SDK destroy」，
          并挂 0ms 兜底定时器（动画始终不启动时也要能推进销毁）
     否 → 立即 finish()
  5. finish(): 取消所有未结束动画 → release + SDK destroy（只执行一次）→ 收尾
  6. 无失败 && 无未 settled 的动画记录 → released；否则汇总抛出（destroy 可重试）
     重试会跳过已完成的步骤（tornDown），不会二次销毁 SDK 对象
```

- **四个状态各管一件事**（首轮评审 P2 + 复审 P1/P2 + 第三轮 P1）：`disposed`（命令闸门）/
  `disposing`（清理在飞，防同步重入）/ `tornDown`（订阅与 SDK 对象已释放，重试不重复执行）/
  `released`（**全部**完成 → 幂等短路）。用其中一个兼做另一个，就会出现「请求已发出 = 清理完成」、
  「重入导致二次销毁」或者「失败后重试入口消失」这类死角。
- **「完成」的判据是可观察不变式**：`无失败 && 没有未 settled 的动画记录`。
  未启动的动画同样算**未完成资源**——它的取消只是被请求了、还没确认（第三轮 P1）；
  只有记录被释放（取消成功或正常结束）才算结清。**0ms 兜底定时器可以推进销毁步骤，
  但不置 `released`**：这正是「请求取消 ≠ 完成清理」在实现上的落点。
- `destroy` 的每一步都可能失败，因此**逐项隔离**：动画取消失败不阻断订阅释放，订阅释放失败
  不阻断 SDK 销毁；最后把失败汇总成一条 `BMAP_SDK_CALL_FAILED` 抛出。
  `MapRuntime.dispose()` 原来把 destroy 错误整段忽略，现在至少 `logger.warn`，否则汇总信息到不了任何人。
- `EventDriver.release(target)` 的语义随之收紧：**逐项尽力**解绑，任一项失败不跳过其余项，
  最后汇总抛出；`removeGroup` 先移除记账条目再解绑，所以即使解绑失败也不会留下强引用
  （消息里明说「记账条目已移除，但 SDK 侧监听器可能仍在」）。
- **视角动画按官方时序取消**（首轮评审 P1 + 复审 P1/P2）：官方 `startViewAnimation` 内部按
  `delay` 用 setTimeout 异步启动，且 `animationstart` 在内部 Animation 构造**之前**同步派发，
  所以「动画启动前」调用 `cancelViewAnimation` 一律抛 `TypeError`（不只是 cancel，pause/continue 同理）。
  因此 Driver 为每个动画维护 `started` / `settled` / `cancelRequested` + 生命周期监听器：
  - **`started` 只在 `animationstart` 那次派发结束后的微任务里置位**：派发期间内部 Animation 还不存在，
    此时若认为「可取消」，同一轮里后注册的业务监听器立刻去取消就会拿到 `TypeError`。
    这样「业务监听器先注册」和「后注册」两种顺序都走同一个延迟取消分支（复审 P2）。
  - 每个地图维护一个**未结束动画记录的集合**（不是「最近一个」）：替换动画时取消失败，
    单槽位会把旧记录覆盖掉，那份动画就再也清理不到（复审 P2）。
  - `stopViewAnimation` 取消该地图上所有未结束的动画：未启动的登记取消请求，启动后由微任务取消；
    已启动的立即取消，**成功后才释放记录**；失败保留记录并抛出，可重试。
  - `startViewAnimation` 先取消未结束的动画再登记新记录；**取消失败就拒绝替换**（旧记录保留可重试），
    取消返回后**重新检查地图是否仍存活**——取消会同步触发业务的 `animationcancel` 回调，
    业务可能在里面销毁地图（复审 P2）。
  - `destroy` 分三条路径（复审 P1 的核心，第三轮 P1 补齐了兜底那条）：进入待销毁状态时**先登记
    取消请求**；有待启动动画时，按官方参考把「取消 + 销毁 Map」一起推迟到安全窗口
    （`animationstart` 之后的微任务），做到**先取消再销毁**；同时挂一个 0ms 兜底定时器，
    动画始终不启动时也能推进销毁（迟到启动由记录自己的安全点兜住）——**兜底不置 `released`**。
  - **清理完成的判据不是「同步函数没抛错」**：只有「没有失败 && 没有未 settled 的动画记录」
    才置 `released`。SDK 销毁仍然尽力执行（WebGL 资源不能被一个停不掉的动画扣住），
    但失败时保留 `destroy` 重试入口；`disposing` 阻止重入（业务在 `animationcancel` 里再次
    `destroy` 不会二次销毁 SDK 对象）；`tornDown` 保证重试**不会**重复销毁 SDK 对象，
    只补没做完的部分。
  - 安全窗口里第一次取消失败时，延迟清理会在同一次推进里再试一次；仍然失败则记录保留，
    `released` 不置位，`destroy` 是一个真正可用的重试入口（第三轮 P1 的用例断言这一点）。
  - 记录按身份从集合移除（不影响同地图的其它动画记录）。
  - **[复核于 #104 / 2026-09-19：KEEP]** 这套 `started` / `settled` / `cancelRequested` + 三态销毁
    **保留**：它记账的是**我们自己**发起的启动/取消/销毁次序（本库拥有的异步写入），不是「这条 SDK
    回包属于哪次命令」的因果身份——因此不在 #104 的删除面里。同时把它的**证据口径**写清楚：
    「`animationstart` 在内部 Animation 构造之前同步派发、启动前 `cancelViewAnimation` 抛
    `TypeError`」这两条目前**只有 Fake 建模**（`FakeV4ViewAnimation`），仓库里没有对应的 probe 脚本
    或 live 读数，所以它是**防御模型**而不是可对外承诺的时序契约（已登记为审计表 F-1 的待取证项）。
    `useBMapViewAnimation` 也据此不再镜像暂停/继续（见 #104）；Map 级
    `pauseViewAnimation` / `continueViewAnimation` 至今没有任何生产者调用，也没有 live 证据。
- destroy 之后的命令抛 `BMAP_RESOURCE_DISPOSED`（不可重试，`retryable === false`）。
- **配套的 runtime 加固**：`MapRuntime` 在 `initializeView` 抛错时销毁那个「已创建但还没写进
  `this.map.value`」的 Map。原先只有 `this.map.value` 有值的路径会被清理，而 `initializeView`
  永远发生在赋值之前——本 Facet 的能力守卫在 `unsupported: 'throw'` 下正好会走到这里，
  不修就会稳定泄漏一个 WebGL Map。这属于 issue 要求的「destroy 释放地图资源」同一类问题，
  因此一并修掉而不是只记欠账。

### 8. 路况：显式告警，不静默降级

v4 把路况收敛成 `TrafficLayer`（`map.addLayer`），`Map` 自身没有开关。`setTraffic` 在 v4 facet 里
**warn 一次 + no-op**，并点名由 Layer Facet（#22 / M3A2-CONTROLS-LAYERS）承接；不假装生效，
也不因为「组件传了 `enableTraffic`」就抛错打断整张地图的初始化。

### 9. 地图类型常量从命名空间读取

`BMap.MapTypeId.BMAP_*_MAP`（官方类型包已声明为静态成员）→ 语义 `MapType`。不读全局
`BMAP_*_MAP`：Driver 边界只认 `rawSdk` 传入的命名空间，避免访问未经 Provider 校验的全局值。
常量缺失时报 `BMAP_SDK_CALL_FAILED`，不猜测常量值。

> **本决策的成员名部分已被取代**：真实运行时的 `BMap.MapTypeId` 只有 `{ NORMAL, EARTH, SATELLITE }`，
> 上游声明里的 `BMAP_*_MAP` 在运行时并不存在。修正见 ADR
> [2026-09-13 v4 required smoke](./2026-09-13-v4-required-smoke.md) 决策 5
> （「不读全局、不猜值」这两条约束仍然有效，只换候选名与优先级）。

### 10. 契约拆成两层

- `runMapFacetContract`（新）：只需要 `map` / `geometry` / `events` / `capabilities`，
  所以 v4（其余 Facet 未实现）与 webgl-v1 都能跑，覆盖创建/销毁、视野 round-trip、
  bounds/size、投影 round-trip、全部交互项、零尺寸容器。
- `runMapDriverContract`：webgl-v1 时代的全量契约（覆盖物 / 能力策略），内部复用上面那层。
  这样 #21~#23 扩展 Facet 契约时不必复制 Map 部分。

## 后果

- 正面：Map Facet 有可直接组装、行为可断言的实现；构造选项、初次视野、交互、释放四条口径被冻结；
  v4 与 webgl-v1 跑同一套 Map 契约，迁移期差异有据可查；Fake v4 的 Map 从「占位」变成
  「可观测的 v4 替身」（选项、交互状态、投影、动画、尺寸都可断言）。
- 负面 / 成本：公共 `MapDriver` 新增两个成员（外部自定义实现需要补齐，beta 内允许直接变更）；
  `driver/jsapi-v4/{internal,events}.ts` 各新增一个小能力（`callRequired` / `release`），
  属底座文件的增量而非改写；catalog 一行（`map.pixel-conversion.engines`）与生成的能力矩阵随之更新；
  `MapRuntime` 增加「initializeView 失败即销毁部分创建的地图」与「destroy 未完全成功时 warn」两处；
  `FakeV4ViewAnimation` 显式建模官方异步启动窗口（含启动前 cancel 抛 `TypeError`），
  这是复现/回归评审 P1/P2 的唯一手段；
  `fake-bmapgl` 为跑通共享契约新增两个投影方法 + 四对交互方法（随 #26 一起删除）。
- 回滚：删除 `map.ts` / `FakeMap.ts` 与两处公共成员即可——Facet 未挂进 `createJsapiV4Driver`，
  回滚不影响默认 Client / 组件 / 发布产物（`dist` 不含 `driver/jsapi-v4/**`，由 `check:public-dts` 断言）。

## 迁移影响

| 变更 | 影响 | 处置 |
| --- | --- | --- |
| `MapDriver` 新增 `pointToPixel` / `pixelToPoint` | 公共接口新增成员，自定义实现需补齐 | 直接实现；两个内置引擎已实现 |
| `restrictCenter` 在 v4 无效果 | `<BMap restrict-center>` 在 v4 下不生效（warn 一次） | 需要范围限制时改用 `restrictBounds`（后续 Facet 议题） |
| `backgroundColor` 在 v4 无效果 | 同上 | 用容器样式 / `DisplayOptions` 表达 |
| `enableTraffic` 在 v4 无效果 | 路况属 `TrafficLayer`（#22） | 等 Layer Facet 落地，facet 会承接该 prop |
| `destroy` 之后调用命令 | v4 抛 `BMAP_RESOURCE_DISPOSED`（webgl-v1 只保证幂等） | 组件/业务按既有 ResourceScope 顺序释放即可 |
| `destroy` 的失败语义 | 逐项尽力清理 + 汇总抛 `BMAP_SDK_CALL_FAILED`；`disposed ≠ 清理完成`，失败可重试；重试**不会**二次销毁 SDK 对象（`tornDown`） | 调用方可重试 `destroy`；`MapRuntime.dispose()` 会 `logger.warn` |
| **有待启动动画时 `destroy` 会推迟到安全窗口** | 这种情形下 `destroy()` 返回时 SDK 对象还没销毁，销毁发生在 `animationstart` 之后的微任务（或 0ms 兜底，后者**不**置 `released`） | 不要在 `destroy()` 返回后假定「底层已释放」；需要确定性时序时避免在未启动状态下销毁 |
| 视角动画的停止/取消时机 | 未启动的动画改为「启动后微任务取消」，`stopViewAnimation` 不再同步立即生效；`stopViewAnimation` 会停止该地图上所有未结束的动画 | 判断状态请依赖 `animationend` / `animationcancel` |
| 动画取消失败时替换新动画 | `startViewAnimation` 会抛错且不替换（旧动画仍可停） | 先解决取消失败，或销毁地图重建 |
| `getHeading()` 返回带符号角度 | v4 的 `setHeading(270)` → `getHeading()` 为 `-90` | 不要用 heading 做**线性** round-trip 判断；类型化事件与状态属 #28。视野状态由 [ADR 2026-09-14](./2026-09-14-map-controlled-state.md) 的环绕判等（`-90 ≡ 270`）取代本条 |
| `setInteraction(map, "tilt-gestures", …)` | 成员存在性在官方来源之间有分歧：有就生效，没有则告警一次并跳过 | #25 的真实 smoke 里确认该成员是否存在；存在即已自动生效，不存在时用构造 options 传 `enableTiltGestures: false` |
| `noAnimation` prop 未贯通到 `MapView` | 初次视野固定 `noAnimation: true`（既有行为在两个引擎上都是「不读该 prop」） | 属 Vue 层（组件 props → `MapView`）的后续议题，本 issue 不改组件契约 |
| `map.pixel-conversion` 能力在 webgl-v1 变为可用 | catalog `engines` 由 `V4_ONLY` 放宽为 `WEBGL_V4` | 能力矩阵已随之重生成（`generate:capability-matrix`） |

## 非目标

- 不装配 Driver、不改默认 Client / Provider / 组件默认路径（#23/#25）。
- 不实现 Overlay / Control / Layer / Service / Panorama Facet（#21~#23）。
- 不把官方 Map 方法一比一公开（截图、主题、`setTheme`、`getDistance`、墨卡托换算、控件与覆盖物
  增删等留给各自 Facet 或按需补）。
- 不新增 augmentation；不改 `driver/jsapi-v4/**` 的声明边界规则（仍整体不进发布产物）。

## 已知限制（显式接受）

- **未做真实 AK smoke（2026-09-13 已部分兑现）**：`setHeading` 的 360 归一化、真实投影精度、
  动画的安全取消窗口仍只在官方文档/类型层面核对过。其中 **`MapTypeId` 的成员名已被真实实测
  推翻并修正**（见 [2026-09-13 v4 required smoke](./2026-09-13-v4-required-smoke.md) 决策 5）；
  真实浏览器门禁已落地为 `pnpm smoke:v4`，上面这几项仍未逐条复核。
- **动画的迟到启动窗口无法彻底关闭**：官方 `startViewAnimation` 内部 setTimeout 没有公开句柄，
  `delay > 0` 时「启动前取消」做不到。本 Facet 的处理是：有问题动画时把 `destroy` 的清理推迟到
  安全窗口（先取消再销毁），并用 0ms 兜底保证动画始终不启动时也能推进销毁；因此 **`delay > 0`
  时 SDK 销毁仍可能先于取消发生**（兜底先到期），但那时**不会**置 `released`——取消失败后
  `destroy` 仍可重试（第三轮 P1 修正的正是这一点）。兜底之后才启动的动画由记录自己的安全点取消。
  若 SDK 既不派发 `animationstart` 也不再启动，只会留下一条 Driver 侧记录（随 raw map 一起被 GC）。
  官方参考本身建议固定 `delay: 0`；该推荐路径下顺序是「先取消、再销毁」。
- **`released` 可能暂时不置位**：兜底推进销毁后，若仍有未 settled 的动画记录，`released` 保持
  false（资源已释放、但账没结清）。后续 `destroy` 会补上取消并置位；不调也不会漏释放——
  它只是幂等短路用的标记。破坏性为 0，故显式接受而不是再加一层状态。
- **取消失败时 `destroy` 仍会尽力销毁 SDK 对象**：失败只体现在「不置 `released` 且抛出汇总错误」上，
  避免把 WebGL 资源扣在一个停不掉的动画上；动画记录保留，重试 `destroy` 会再次尝试取消。
  待启动路径的错误发生在微任务里，无法抛回调用方，因此以 `logger.warn` 报告（已记录在案）。
- **不可观察生命周期的动画对象**（没有 `addEventListener` / `removeEventListener`）按「已启动」
  立即尽力取消：无法等待安全窗口，失败时同样保留记录以便重试。这是对非 SDK 形状入参的显式降级。
- **`stopViewAnimation` 会取消该地图上所有未结束的动画**：v4 的取消入口需要动画实例，
  而 `MapDriver.stopViewAnimation` 没有入参，因此语义取「停掉这张地图上的视角动画」（与 webgl-v1 的
  `map.stopViewAnimation()` 一致）。需要精确终态时按官方建议在 `animationend` 回调里显式设置末帧视角。
- **Fake 不负责任值归一化**：`fake-bmap-v4` 记录「传进去什么」，不复刻 SDK 的 heading 归一与
  tilt 截断，因此共享契约只断言不依赖归一化的取值。
- **webgl-v1 不追平新策略**：它是 #26 待删除实现，只补齐公共接口新增的成员（投影转换），
  不补「destroy 后拒绝命令」与「未知交互项报错」。契约断言按引擎分层（见 `driver-contract.ts` 头部）：
  共享部分只断言「不抛错」，交互映射是否真正落地由各引擎自己的测试用可观察状态断言
  （v4 看 `fake-bmap-v4` 的交互状态；webgl-v1 看 `fake-bmapgl` 的 `callLog`）。
- **`noAnimation` prop 仍然没有贯通**：`BMap.vue` 声明了 `noAnimation`（默认 `false`），但
  `MapRuntime`/`MapView` 都不携带它，两个引擎的 `initializeView` 都不读——这是既有缺口，
  本 Facet 只把「初次视野不做动画」显式固定下来（v4 文档默认值），没有顺手改组件契约。
- **`setInteraction` 未知项行为不统一**：v4 抛 `BMAP_INVALID_ARGUMENT`，webgl-v1 静默返回。
- **两个引擎交互表的重复是刻意保留的**：`jsapi-v4/map.ts` 与 `webgl-v1/map.ts` 各持一份
  `MapInteraction` → 官方方法名映射表；跨引擎抽取会让 #26 待删除的实现阻塞 v4 底座
  （同 ADR 2026-09-11-jsapi-v4-driver-foundation 的「负面 / 成本」）。
- **`restrictCenter` / `backgroundColor` / `enableTraffic` 的迁移处置是占位**：分别需要
  `restrictBounds`、容器样式/`DisplayOptions`、`TrafficLayer` 的真实承接，当前只做到「可见 + 不误导」。

## 跨 Facet 交接风险（供 #21~#23 / #25 参考）

对照参考实现 `huiyan-fe/react-bmap` v2.x（同样以 JSAPI 4.0 为目标，`src/drivers/v4Driver.ts` 的
`destroyMap` 与 `src/components/Map/Map.tsx` 的 cleanup），有三件本 Facet **没有**覆盖、
但会在后续 Facet 落地时变成问题的事，先记在这里：

1. **销毁前必须先摘掉覆盖物与图层。** 参考实现在 `map.destroy()` 之前 `clearOverlays()` 并逐个
   `removeLayer()`，注释写明「先移除所有图层，防止 SDK 异步瓦片加载在 destroy 后崩溃」。
   本仓库 `MapRuntime.dispose()` 的顺序（plugins → controls → layers → overlays → map.destroy）
   与之一致，但**直接使用 Map Facet 的调用方**没有这层保护：#21（Overlay）/ #22（Layer）落地时
   必须保证「先 detach 子资源、再销毁 map」。
2. **destroy 之后 SDK 仍可能回调一次。** 参考实现把 window error 监听器「多留一拍」
   （`setTimeout(..., 0)` 才移除），注释是「SDK 在 destroy 之后还可能回调一次瓦片/raf」。
   本 Facet 只覆盖动画（`animationstart` 钩子保持 armed，迟到启动会被取消）。瓦片/raf 属 SDK 内部，
   但 **#21/#22 的资源释放路径要能容忍「destroy 后仍被回调」**：本 Facet 的 `disposed` 闸门会让
   这类调用抛 `BMAP_RESOURCE_DISPOSED`（业务命令必须失败，这是刻意的），因此组件卸载时的
   **内部**清理路径需要一条安静通道——参考实现用 `destroyedMaps` WeakSet 判断后直接 return，
   本仓库可复用 `disposed` 状态，或由 `useSdkResource` 统一吞掉 `BMAP_RESOURCE_DISPOSED`。
3. **`new BMap.Map(container)` 与 `new BMap.Map(container, {})` 不是同一条初始化路径。**
   参考实现注释：「SDK 可能检查 `arguments.length` 走不同初始化路径，影响 pane 结构和 marker DOM」，
   因此它在没有 options 时**不传**第二个参数。本 Facet 为了固定库默认（`enableDragging` /
   `enableWheelZoom`）**总是**传一个非空 options 对象——这是想要的路径，但需要在 #25 的真实
   smoke 里确认「总是传 options」不会改变 pane / marker DOM 结构。

同一份参考也**印证**了本文的几处判断（可作为外部交叉验证）：

- 交互开关用成对 `enable*` / `disable*`（`v4Driver.ts` 的交互段全是成对方法），
  `setOptions` 只作为 ref 上的原始透出 → 印证 §4「不用 setOptions 做语义交互」。
- 初始视野用 `centerAndZoom`、后续受控更新用 `setCenter`，并注明
  「`centerAndZoom` 在已初始化的地图上行为更接近「重置视野」，副作用大」→ 印证 §3。
- 「cancel / pause / continue 在没有进行中的动画时会抛 `TypeError`，这是 SDK 正常行为」
  （`v4Driver.ts` 视角动画段注释）→ 印证 #19 的 Fake 建模与本 Facet 的安全窗口处理确实对应真实行为；
  参考实现只是 `try/catch` 静默吞掉，不做安全窗口编排，也不在 destroy 时取消动画。
- 卸载顺序「先解绑订阅（`unsubs.forEach`）再 `destroyMap`」→ 印证 §7 的「先停业务资源、再销毁」。

## 参考

- issue #20 `[M3A.2] 实现 JSAPI 4.0 MapDriver`
- issue #12 `[Roadmap] baidu-map-gl-vue v3：JSAPI 4.0 前置迁移与 Stable 发布`
- PR #60 评审（P1 动画未停止 / P2 取消失败丢记录与外来句柄透传 / P2 解绑失败阻断销毁）:
  四项均在仓库内先复现再修，复现用例已并入 `driver/jsapi-v4/{map,events}.test.ts`
- 官方 4.0 API 参考：`BMap.Map` 方法表、`BMap.MapOptions`、`BMap.ViewportOptions`
- 官方类型包 `@baidumap/jsapi-v4-types@4.0.4`：`core/Map.d.ts`、`core/MapOptions.d.ts`、`map-type/MapTypeId.d.ts`、
  `view-animation/ViewAnimation.d.ts`
- 官方 Skill `bmap-jsapi-v4`：`references/map-core.md`、`references/view-animation.md`
- 参考实现 `huiyan-fe/react-bmap` v2.x（同以 JSAPI 4.0 为目标）：
  `src/drivers/v4Driver.ts`（`destroyMap`、交互段、视角动画段）、`src/components/Map/Map.tsx`
  （初始视野、受控同步、cleanup）—— 用于交叉验证 §3/§4/§7 与登记上文的跨 Facet 风险
- 代码：`src/driver/jsapi-v4/map.ts`、`src/driver/jsapi-v4/{internal,events}.ts`、
  `src/driver/types/map.ts`、`src/driver/webgl-v1/map.ts`、`src/core/runtime/MapRuntime.ts`
- Fake 与契约：`packages/test-utils/fake-bmap-v4/FakeMap.ts`、`packages/test-utils/driver-contract.ts`
