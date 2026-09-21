<!-- Generated file. Do not edit directly. -->

# 插件兼容 inventory

> 由 `packages/baidu-map-gl-vue/src/plugins/compat-inventory.ts` 生成，请勿手工编辑。
> 更新数据后运行 `pnpm generate:plugin-inventory`，CI 用 `--check` 校验无漂移。

这份清单覆盖 `plugins: [...]` 能识别的四个内置插件脚本。它区分**三类依据**：对锁定 URL 的
真实发布产物的观察、与官方 `@baidumap/jsapi-v4-types` 声明的核对（**自动部分只到命名空间级成员**）、以及真实运行时观察。
没有跑过的档位不写进依据——把「声明面没缺口」说成「兼容」是把结论说得比证据强。

三档各有自己的复现命令：`pnpm probe:plugin-runtime`（真实 4.0 + 真实 AK + 真实浏览器，nightly 单独跑：它验的是**可选**插件，不进必需链路）、`pnpm probe:plugin-compat`（真实发布产物 + 官方声明）、以及两者共用的生成物校验 `pnpm generate:plugin-inventory:check`。

## 依据档位

| 依据 | 含义 |
| --- | --- |
| `artifact` | 对锁定 URL 的真实发布产物做静态抽取（`pnpm probe:plugin-compat`，可复现） |
| `declaration` | 与官方 `@baidumap/jsapi-v4-types` 的声明核对——**自动部分只证明命名空间级成员存在**；实例成员（`Owner#member`）是人工核对的，见各条的 `manualInstanceChecks` |
| `runtime` | 真实 JSAPI 4.0 运行时观察（`pnpm probe:plugin-runtime`，需 AK + 浏览器；nightly 单独跑） |

## 结论取值

| 结论 | 含义 |
| --- | --- |
| `native` | 上游 4.0 已有原生替代 ⇒ 迁移到原生能力，不再依赖该脚本（见「迁移路径」列） |
| `compatible` | 脚本在 4.0 上可直接使用，且最小功能链路有运行时证据。边界：本库只负责按需加载脚本，不承诺插件的内部实现与它自行注入的其它脚本 |
| `adapter` | 需要本库写适配层才能用（**当前无条目**：按 #43 口径，只有存在真实消费者时才写 adapter） |
| `incompatible` | 有决定性依据说明它在 4.0 上不可用 |
| `unverified` | 依据不足以支持更强的结论 —— **这本身可以是最终结论**：不为了「功能完整」把它强行实现成 adapter |

## 清单

| 插件 | 锁定 URL | 版本锁定 | 内容摘要（sha256 前 12 位） | 暴露全局 | required | 引用的 SDK 命名空间成员 | 私有面 | 副作用标记 | 关联能力 | 结论 | 迁移路径 | 运行时 | 依据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `TrackAnimation` | `mapopen.bj.bcebos.com/github/BMapGLLib/TrackAnimation/src/TrackAnimation.min.js` | 无（自托管镜像） | `059eafe7e57d…` | `window.BMapGLLib.TrackAnimation` | false | `Point`, `ViewAnimation` | 无 | — | `service.track-animation` | `native` | `native` → layer.track-line | 已验证 | `artifact`, `declaration`, `runtime` |
| `DrawingManager` | `mapopen.bj.bcebos.com/github/BMapGLLib/DrawingManager/src/DrawingManager.min.js` | 无（自托管镜像） | `fe59847f0689…` | `window.BMapGLLib.DrawingManager` | false | `Circle`, `Control`, `Icon`, `Label`, `Marker`, `Overlay`, `Pixel`, `Point`, `Polygon`, `Polyline`, `Size` | 无 | `BMapGLLib/GeoUtils/src/GeoUtils.min.js`, `BMapGLLib/DrawingManager/src/gpc.js` | — | `compatible` | `plugin` → （按官方文档直接使用；本库不封装组件） | 已验证 | `artifact`, `declaration`, `runtime` |
| `GeoUtils` | `mapopen.bj.bcebos.com/github/BMapGLLib/GeoUtils/src/GeoUtils.min.js` | 无（自托管镜像） | `3302aebe7d99…` | `window.BMapGLLib.GeoUtils` | false | `Bounds`, `Circle`, `Polygon`, `Polyline` | 无 | — | — | `compatible` | `plugin` → （按官方文档直接使用；本库不封装） | 已验证 | `artifact`, `declaration`, `runtime` |
| `Mapvgl` | `unpkg.com/mapvgl@1.0.0-beta.188/dist/mapvgl.min.js` | **有** | `20a9101a6419…` | `window.mapvgl` | false | — | **有** | `_hmt` | `overlay.mapvgl` | `incompatible` | `none` → （无） | **抛错** | `artifact`, `declaration`, `runtime` |

## 逐条结论与残余风险

### `TrackAnimation`

加载期只写 `window.BMapGLLib`，不碰 SDK；引用的 `BMapGL.Point` / `BMapGL.ViewAnimation` 与它调用的 `Map` 方法在官方类型声明里**全部存在**（命名空间成员由 `probe:plugin-compat` 自动核对，其中 10 个**实例成员**是人工对照声明核对的）。**结论是「迁到原生」**：4.0 有原生轨迹线图层，本库不该再为这个 legacy 插件提供封装 —— 迁移落点与播放命令面的归属见「迁移路径」与残余风险。

私有面：无命名空间级私有成员；实例级私有字段见残余风险。

成员核对：命名空间级成员由 `pnpm probe:plugin-compat` 自动核对；**实例成员**（Map#getViewport、Map#getDistance、Map#getMaxZoom、Map#startViewAnimation、Map#pauseViewAnimation、Map#continueViewAnimation、Map#cancelViewAnimation、Map#addOverlay、Map#removeOverlay、ViewAnimation#addEventListener）是**人工**对照 `@baidumap/jsapi-v4-types` 声明核对的，**不在自动门禁内**。

运行时（`pnpm probe:plugin-runtime`）：**已验证最小路径** —— 真实 4.0 上 `new BMapGLLib.TrackAnimation(map, polyline, { duration: 2000, overallView: false })` 构造成功；`start()` 后折线 path 由 2 点增长到 46 点、`map.getZoom()` 由 13 变为约 15.15（视角跟随）；`pause()` 后 400ms 内 path 冻结在 46 点，`continue()` 后恢复到 104 点；播放到结尾时 path 收敛到 201 点并触发构造选项 `onAnimateEnd`（连续 800ms 不再变化）。全程无抛错。

**这条读数覆盖到**：

- 构造
- start（path 增长 + 视角跟随）
- pause（path 冻结）
- continue（path 恢复增长）
- 播放到结尾（path 收敛 + `onAnimateEnd` 回调）

**没覆盖**（写出来，别当成验过了）：

- `setSpeed()` **不进门禁**：它调的是上游**未声明**的 `ViewAnimation` 私有成员（`animation` / `_options` / `_beginTime` 与 `setBeginTime` / `setDuration`）。本次实测在 4.0 上未抛错且 duration 被改短（path 继续增长到 145 点），但这依赖私有面，本库不承诺。
- 跨 180° 经线的路径（构造期读 `Polyline#_config.linkRight` 那条分支）。
- 重放（`start()` 二次调用）、`overallView: true`、`delay`、`setPolyline()` 等分支。

迁移路径：`native` → layer.track-line（原生组件 `BTrackLineLayer`）

改用原生轨迹线图层 `<BTrackLineLayer>`（官方 4.0 扩展 API `TrackLine`，见 M6 / #35、#36）。**播放命令面**（start / pause / resume / stop / setSpeed 一类）与页面可见性结论由 #110 收口，本票只给结论与去向：不要为 TrackAnimation 再写组件或 hook。

版本锁定：**未版本化** —— URL 指向百度自托管的 GitHub 镜像（路径里没有 tag / commit）⇒ 上游改内容而 URL 不变；本仓用 artifactDigest 锁内容，不做版本号承诺。

内容摘要（`sha256`，由 `pnpm probe:plugin-compat` 每次拉取后核对）：`059eafe7e57d48135fb2e547544d1e870a85392d90e6dbdccbbd2b98a156f673`

残余风险（每条都写明去处）：

- `setSpeed()` 依赖上游**未声明**的 `ViewAnimation` 私有成员（`animation` / `_options` / `_beginTime` 与 `setBeginTime` / `setDuration`）：4.0 上实测可用，但私有面随时可能消失 ⇒ 本库不提供它，也不承诺它。
- `Polyline#_config.linkRight` 是实例私有字段，用于判断折线是否跨 180° 经线。
- 播放命令面（start / pause / resume / stop / setSpeed）的原生对应物已排期在 **#110**：本票只给「迁到 `BTrackLineLayer`」的结论，播放控制由那张票收口。

### `DrawingManager`

引用的命名空间成员全部在官方类型声明内；`lang.Class` 是脚本**自带**的实现（`r.lang = r.lang || {}`），不依赖 SDK 内部模块。它用 `prototype = new BMapGL.Overlay` 继承覆盖物基类（官方声明明写「此类不可实例化」），但**真实 4.0 上用（合成的）指针事件序列画出了一个多边形、收到 `overlaycomplete`、覆盖物真的落在图上**。它还会**由脚本自己**动态注入 GeoUtils 与 GPC 两个外部脚本，绕过本库的加载与取消路径。

私有面：无。

成员核对：命名空间级成员由 `pnpm probe:plugin-compat` 自动核对；**实例成员**（Map#addOverlay、Map#removeOverlay、Map#addControl、Map#getPanes、Map#getContainer、Map#pointToPixel、Map#pointToOverlayPixel、Map#getDistance、Map#getBounds、Map#getCenter、Map#setCenter、Map#getSize、Map#getViewport、Map#setViewport、Map#enableDragging、Overlay#initialize、Overlay#draw、Overlay#dispose）是**人工**对照 `@baidumap/jsapi-v4-types` 声明核对的，**不在自动门禁内**。

运行时（`pnpm probe:plugin-runtime`）：**已验证最小路径** —— 真实 4.0 上沿**公开 DOM 事件链路**发**合成指针事件序列**（`dispatchEvent`，`isTrusted === false`）走通一条完整绘制链路：`new BMapGLLib.DrawingManager(map, { isOpen: false, confirmVisible: false, enableCalculate: true, enableGpc: true })` 构造成功、`getDrawingMode()` 为 `marker`；`open()` + `setDrawingMode('polygon')` 读回 `polygon`；在掩膜上按下并拖动 3 次后双击收尾，收到 `overlaycomplete`（载荷 `drawingMode: "polygon"`），`map.getOverlays()` 里能找到同一个实例、`dm.getOverlays()` 记到 1 个。全程无抛错。另外证实它**自行注入** `GeoUtils.min.js` 与 `gpc.js` 两个脚本（各两次：构造选项与显式 `enable*()`）。

**这条读数覆盖到**：

- 构造 + `getDrawingMode()`
- `enableCalculate()` / `enableGpc()` 并观察到自行注入两个脚本
- `open()` + `setDrawingMode('polygon')`（读回一致）
- 合成指针事件序列画出多边形：按下 → 3 次拖动 → 双击收尾 → `overlaycomplete`（载荷 drawingMode 为 polygon）
- 画出的覆盖物真的在图上、并被记进 `dm.getOverlays()`

**没覆盖**（写出来，别当成验过了）：

- 确认面板分支（`confirmVisible` 缺省为 `true`，画完要先点「确定」才 complete）——探针显式关掉了它。
- 其余绘制模式（marker / polyline / rectangle / circle）与编辑、裁切、合并、复制、移动等能力。
- 顶点吸附（sorption）与 `limit` 面积 / 距离校验。
- **浏览器真实用户输入**：事件是 `dispatchEvent` 造出来的（`isTrusted === false`），本探针验的是「库自己的公开 DOM 事件处理链路 + SDK 的坐标归一化」，不含浏览器输入层的差异（指针捕获 / 合成 click / 双击判定那一段）。
- 脚本自行注入的 GeoUtils / GPC 的加载、失败与清理**不受本库管控**（只在真实运行时观察到）。

迁移路径：`plugin` → （按官方文档直接使用；本库不封装组件）

交互式绘制在 4.0 **没有**原生替代（原生只有非交互的数据图层），继续经 `plugins: ['DrawingManager']` 加载脚本、按官方文档使用。注意本库只负责加载脚本：绘制 UI、以及脚本自行注入的 GeoUtils / GPC 不在本库的加载与取消路径内。

版本锁定：**未版本化** —— 同 TrackAnimation：自托管镜像、URL 无 tag / commit ⇒ 用 artifactDigest 锁内容。

内容摘要（`sha256`，由 `pnpm probe:plugin-compat` 每次拉取后核对）：`fe59847f0689c3dacc80440d0efbf6aa7f4ca00bcdc1ce2764ef9f39a5425850`

残余风险（每条都写明去处）：

- `new BMapGL.Overlay` 与官方「不可实例化」的表述冲突；真实 4.0 上绘制链路已跑通，但「今天能跑」不等于「上游保证」——这类 legacy 继承写法随时可能随 SDK 版本变化失效。
- 运行时自行注入的两个外部脚本会绕过本库的加载与清理路径（不写进 `BUILTIN_PLUGIN_URLS`、不参与取消）⇒ 文档必须写明这一点（已由运行时观察证实，不再是推断）。
- 只覆盖了 polygon 的「画一个」链路；`confirmVisible` 缺省分支与其它模式未验证（见 `runtime.uncovered`）。

### `GeoUtils`

纯几何谓词集合（`isPointInRect` / `isPointInPolygon` / `isPointInCircle` / `isPointOnPolyline` / `isPolylineIntersectArea` / `getDistance` / `getPolylineDistance` / `getPolygonArea` / `degreeToRad` / `radToDegree`），只读 `Bounds` / `Circle` / `Polygon` / `Polyline` 的公开读数方法，无私有面、无副作用。**结论是 `compatible`**：没有原生替代，但脚本本身可直接使用。

私有面：无。

成员核对：命名空间级成员由 `pnpm probe:plugin-compat` 自动核对；**实例成员**（Bounds#getSouthWest、Bounds#getNorthEast、Bounds#getCenter、Circle#getCenter、Circle#getRadius、Polyline#getPath、Polygon#getPath、Point#equals）是**人工**对照 `@baidumap/jsapi-v4-types` 声明核对的，**不在自动门禁内**。

运行时（`pnpm probe:plugin-runtime`）：**已验证最小路径** —— 真实 4.0 页面上暴露 10 个静态成员；`getDistance(new Point(0, 0), new Point(0, 1))` 返回 111194.87（≈1° 纬度，符合预期）；`isPointInRect` 返回布尔。注：三参形态的 `isPointInRect(point, sw, ne)` 返回 `false` 且不抛错——该形态的语义未确认，本库不据此下结论。

**这条读数覆盖到**：

- 静态成员枚举（10 个）
- `getDistance` 数值正确性
- `isPointInRect` 返回类型

**没覆盖**（写出来，别当成验过了）：

- 各静态谓词的**签名语义**（只证了「不抛错」+ `getDistance` 数值正确）。
- `isPointInRect` 三参形态的语义（返回 `false`，不抛错）。
- `DrawingManager` 自行注入它的那条隐式依赖（运行时已观察到，但不受本库管控）。

迁移路径：`plugin` → （按官方文档直接使用；本库不封装）

官方 4.0 **没有**等价的几何谓词集合，也没有原生替代 ⇒ 继续经 `plugins: ['GeoUtils']` 加载脚本、按官方文档调用静态谓词。它是纯函数集合（无实例 API、无副作用），本库不为其写适配层。

版本锁定：**未版本化** —— 同 TrackAnimation：自托管镜像、URL 无 tag / commit ⇒ 用 artifactDigest 锁内容。

内容摘要（`sha256`，由 `pnpm probe:plugin-compat` 每次拉取后核对）：`3302aebe7d999b6c2676b5d34886eeaddff11cf27d62ff2ea3c03eccaca90576`

残余风险（每条都写明去处）：

- **本仓库自持的 legacy 声明曾经与真实脚本不一致**：那份声明把 `BMapGLLib.GeoUtils` 写成 `new GeoUtils(map, options)` 的类，而真实脚本暴露的是**静态谓词命名空间**（没有可用的实例 API）。记录这条是因为它解释了「为什么不能拿 legacy 类型当依据」——该声明目录已在 `#26` 删除，现在类型面只剩官方 `@baidumap/jsapi-v4-types` 与最小 augmentation。
- 各静态谓词的签名语义未逐个核对（只证了不抛错 + `getDistance` 数值正确）；`isPointInRect` 的三参形态语义未确认。

### `Mapvgl`

**硬不兼容**，两条独立依据：①它的 JSONP 传输层直接拿 SDK 的私有回调表（成员名 `_rd`）当注册处——这正是 #72（ADR `2026-09-13-private-sdk-surface-removal`）明令本库不得访问的私有面，也不在官方声明里；②它的 bmap 适配层要往 `map.getPanes().mapPane` 上挂视图容器，而 4.0 的 panes 里没有 `mapPane`。**结论是「没有迁移路径」**：改用 4.0 的原生图层。

私有面：私有 JSONP 回调表（成员名 `_rd`）：脚本把函数注册进这张表，并把 `callback=` 指过去。

成员核对：命名空间级成员由 `pnpm probe:plugin-compat` 自动核对；本条目的执行路径没有用到实例成员。

运行时（`pnpm probe:plugin-runtime`）：**抛错** —— 真实 4.0 上 `window.mapvgl` 与 `View` 都在，但 `new mapvgl.View({ map, mapType: "bmap" })` 抛 `Cannot read properties of undefined (reading 'appendChild')`。**根因已定位**（本次新增的读数）：产物第 481 行是 `map.getPanes().mapPane.appendChild(div)`，而 4.0 的 `getPanes()` 返回的键是 floatPane / markerMouseTarget / floatShadow / labelPane / markerPane —— **没有 `mapPane`**。这与「依赖私有回调表」是**两条相互独立**的依据。

**这条读数覆盖到**：

- 脚本加载 + 全局暴露
- `new mapvgl.View({ map, mapType: "bmap" })` 的抛错现场
- 抛错时的容器面读数（`getPanes()` 的键、`mapPane` 是否存在）

**没覆盖**（写出来，别当成验过了）：

- 图层渲染 / 数据上屏：`View` 构造不成立，后续步骤无从谈起。
- `mapType: "blank"` 或其它适配模式是否有可用路径（未测）。

迁移路径：`none` → （无）

没有可用路径：它的适配层要求 legacy 容器面（`getPanes().mapPane`），4.0 上不存在。改用官方 4.0 原生图层（`BPointShapeLayer` / `BMarkerCluster` / `BHeatmapLayer` / `BLineLayer` / `BFillLayer` 等），或按你自行评估的其它可视化方案。

版本锁定：**自带版本号** —— URL 内含精确版本 `mapvgl@1.0.0-beta.188`（unpkg）⇒ 版本可追踪，仍同时用 artifactDigest 锁内容。

内容摘要（`sha256`，由 `pnpm probe:plugin-compat` 每次拉取后核对）：`20a9101a6419d57ec355c1155e94c6feaa5f788438ce9282566913d9743a0555`

残余风险（每条都写明去处）：

- 加载期会注入百度统计脚本（`window._hmt`）——`builtins.ts` 的 `mapvgl` 分支因此用「fetch + 去掉统计片段 + 内联」的方式加载，这条特例只对 MapVGL 成立，不要推广到别的插件。
- 即使去掉统计脚本，`_rd` 与 `getPanes().mapPane` 这两条也不会因为本库的改动而消失：它们是脚本自己的实现，要修只能改上游。本库**不修它**，只把结论写清楚。
- `getPanes().mapPane` 这条根因说明它面向的是 legacy 容器模型；上游若发布面向 4.0 的版本，本条目需要重跑两个探针再改结论。

## 复现

```bash
# 从锁定 URL 拉取真实发布产物，重新抽取「引用的 SDK 成员 / 私有面 / 自注入脚本」，
# 并与官方类型声明核对命名空间级成员（需要网络；不进 PR 门禁）。
pnpm probe:plugin-compat

# 只做本地无网络校验：数据模块、生成文档与 BUILTIN_PLUGIN_URLS 是否一致。
pnpm generate:plugin-inventory:check
```
