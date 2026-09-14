<!-- Generated file. Do not edit directly. -->

# 插件兼容 inventory

> 由 `packages/baidu-map-gl-vue/src/plugins/compat-inventory.ts` 生成，请勿手工编辑。
> 更新数据后运行 `pnpm generate:plugin-inventory`，CI 用 `--check` 校验无漂移。

这份清单覆盖 `plugins: [...]` 能识别的四个内置插件脚本。它区分**三类依据**：对锁定 URL 的
真实发布产物的观察、与官方 `@baidumap/jsapi-v4-types` 声明的核对（**自动部分只到命名空间级成员**）、以及真实运行时观察。
没有跑过的档位不写进依据——把「声明面没缺口」说成「兼容」是把结论说得比证据强。

三档各有自己的复现命令：`pnpm probe:plugin-runtime`（真实 4.0 + 真实 AK + 真实浏览器）、`pnpm probe:plugin-compat`（真实发布产物 + 官方声明）、以及两者共用的生成物校验 `pnpm generate:plugin-inventory:check`。

## 依据档位

| 依据 | 含义 |
| --- | --- |
| `artifact` | 对锁定 URL 的真实发布产物做静态抽取（`pnpm probe:plugin-compat`，可复现） |
| `declaration` | 与官方 `@baidumap/jsapi-v4-types` 的声明核对——**自动部分只证明命名空间级成员存在**；实例成员（`Owner#member`）是人工核对的，见各条的 `manualInstanceChecks` |
| `runtime` | 真实 JSAPI 4.0 运行时观察（`pnpm probe:plugin-runtime`，需 AK + 浏览器；不进 PR 门禁） |

## 结论取值

| 结论 | 含义 |
| --- | --- |
| `incompatible` | 有决定性依据说明它在 4.0 上不可用 |
| `no-declaration-gap` | 引用的 SDK 成员在**官方类型声明**里没有缺口（≠ 运行时已验证） |
| `undetermined` | 引用面无决定性缺口，但存在**依据不足**的不确定项（构造期用法 / 自注入脚本等），结论留给 M8（#43） |

## 清单

| 插件 | 锁定 URL | 暴露全局 | required | 引用的 SDK 命名空间成员 | 私有面 | 副作用标记 | 关联能力 | 结论 | 运行时 | 依据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `TrackAnimation` | `mapopen.bj.bcebos.com/github/BMapGLLib/TrackAnimation/src/TrackAnimation.min.js` | `window.BMapGLLib.TrackAnimation` | false | `Point`, `ViewAnimation` | 无 | — | `service.track-animation` | `no-declaration-gap` | 已验证 | `artifact`, `declaration`, `runtime` |
| `DrawingManager` | `mapopen.bj.bcebos.com/github/BMapGLLib/DrawingManager/src/DrawingManager.min.js` | `window.BMapGLLib.DrawingManager` | false | `Circle`, `Control`, `Icon`, `Label`, `Marker`, `Overlay`, `Pixel`, `Point`, `Polygon`, `Polyline`, `Size` | 无 | `BMapGLLib/GeoUtils/src/GeoUtils.min.js`, `BMapGLLib/DrawingManager/src/gpc.js` | — | `undetermined` | 已验证 | `artifact`, `declaration`, `runtime` |
| `GeoUtils` | `mapopen.bj.bcebos.com/github/BMapGLLib/GeoUtils/src/GeoUtils.min.js` | `window.BMapGLLib.GeoUtils` | false | `Bounds`, `Circle`, `Polygon`, `Polyline` | 无 | — | — | `no-declaration-gap` | 已验证 | `artifact`, `declaration`, `runtime` |
| `Mapvgl` | `unpkg.com/mapvgl@1.0.0-beta.188/dist/mapvgl.min.js` | `window.mapvgl` | false | — | **有** | `_hmt` | `overlay.mapvgl` | `incompatible` | **抛错** | `artifact`, `declaration`, `runtime` |

## 逐条结论与残余风险

### `TrackAnimation`

加载期只写 `window.BMapGLLib`，不碰 SDK；引用的 `BMapGL.Point` / `BMapGL.ViewAnimation` 与它调用的 `Map` 方法（`getViewport` / `getDistance` / `getMaxZoom` / `startViewAnimation` / `pauseViewAnimation` / `continueViewAnimation` / `cancelViewAnimation` / `addOverlay` / `removeOverlay`）在官方类型声明里**全部存在**——命名空间成员由 `probe:plugin-compat` 自动核对，其中 10 个**实例成员**是人工对照声明核对的（见 `manualInstanceChecks`，自动化的 owner/member 级校验属 #43）。真实 4.0 上已跑通「构造 → `start()` → 折线展开 + 视角跟随」。

私有面：无命名空间级私有成员；实例级私有字段见残余风险。

成员核对：命名空间级成员由 `pnpm probe:plugin-compat` 自动核对；**实例成员**（Map#getViewport、Map#getDistance、Map#getMaxZoom、Map#startViewAnimation、Map#pauseViewAnimation、Map#continueViewAnimation、Map#cancelViewAnimation、Map#addOverlay、Map#removeOverlay、ViewAnimation#addEventListener）是**人工**对照 `@baidumap/jsapi-v4-types` 声明核对的，**不在自动门禁内**。

运行时（`pnpm probe:plugin-runtime`）：**已验证最小路径** —— 真实 4.0 页面上 `new BMapGLLib.TrackAnimation(map, polyline, { duration: 1500, overallView: false })` 构造成功；`start()` 后折线 path 由 2 个点增长到约 40 个点（随动画帧数略有浮动）、`map.getZoom()` 由 13 变为约 15.15（视角跟随生效），无抛错。

残余风险（每条都写明去处）：

- `setSpeed()` 依赖上游**未声明**的 `ViewAnimation` 私有成员（`animation` / `_options` / `_beginTime` / `_pauseTime` 与 `setBeginTime` / `setDuration`）⇒ 该方法按「依据不足」处理，本库不承诺它；构造函数 / `start` / `pause` / `continue` 路径不碰私有面。
- `Polyline#_config.linkRight` 是实例私有字段，用于判断折线是否跨 180° 经线。
- 只跑通最小路径：`pause` / `continue` / `setSpeed` / 播放到结尾这些分支未覆盖；把它们搬进 CI / nightly 属 #43。

### `DrawingManager`

引用的命名空间成员全部在官方类型声明内；`lang.Class` 是脚本**自带**的实现（`r.lang = r.lang || {}`），不依赖 SDK 内部模块。但它用 `prototype = new BMapGL.Overlay` 继承覆盖物基类，而官方声明明写「此类不可实例化」；且 `enableCalculate()` / `enableGpc()` 会**由脚本自己**动态注入 GeoUtils 与 GPC 两个外部脚本，不受本库管控（已在真实 4.0 上观察到）。

私有面：无。

成员核对：命名空间级成员由 `pnpm probe:plugin-compat` 自动核对；**实例成员**（Map#addOverlay、Map#removeOverlay、Map#addControl、Map#getPanes、Map#getContainer、Map#pointToPixel、Map#pointToOverlayPixel、Map#getDistance、Map#getBounds、Map#getCenter、Map#setCenter、Map#getSize、Map#getViewport、Map#setViewport、Map#enableDragging、Overlay#initialize、Overlay#draw、Overlay#dispose）是**人工**对照 `@baidumap/jsapi-v4-types` 声明核对的，**不在自动门禁内**。

运行时（`pnpm probe:plugin-runtime`）：**已验证最小路径** —— 真实 4.0 页面上 `new BMapGLLib.DrawingManager(map, { isOpen: false, enableCalculate: true, enableGpc: true })` 构造成功，`getDrawingMode()` 返回 `marker`；**证实了「脚本自行注入外部脚本」**——页面上多出 `GeoUtils/src/GeoUtils.min.js` 与 `DrawingManager/src/gpc.js` 两个 `<script>`（各出现两次：构造选项与显式 `enable*()` 各触发一次）。

残余风险（每条都写明去处）：

- `new BMapGL.Overlay` 与官方「不可实例化」的表述冲突；**真实 4.0 上构造成功、未抛错**，但「能继承基类」≠「绘制交互可用」——实际画一个圆/多边形的路径未覆盖，归 #43。
- 运行时自行注入的两个外部脚本会绕过本库的加载与清理路径（不写进 `BUILTIN_PLUGIN_URLS`、不参与取消）⇒ 文档必须写明这一点（已由运行时观察证实，不再是推断）。

### `GeoUtils`

纯几何谓词集合（`isPointInRect` / `isPointInPolygon` / `isPointInCircle` / `isPointOnPolyline` / `isPolylineIntersectArea` / `getDistance` / `getPolylineDistance` / `getPolygonArea` / `degreeToRad` / `radToDegree`），只读 `Bounds` / `Circle` / `Polygon` / `Polyline` 的公开读数方法，无私有面、无副作用。

私有面：无。

成员核对：命名空间级成员由 `pnpm probe:plugin-compat` 自动核对；**实例成员**（Bounds#getSouthWest、Bounds#getNorthEast、Bounds#getCenter、Circle#getCenter、Circle#getRadius、Polyline#getPath、Polygon#getPath、Point#equals）是**人工**对照 `@baidumap/jsapi-v4-types` 声明核对的，**不在自动门禁内**。

运行时（`pnpm probe:plugin-runtime`）：**已验证最小路径** —— 真实 4.0 页面上暴露 10 个静态成员；`getDistance(new Point(0, 0), new Point(0, 1))` 返回 111194.87（≈1° 纬度，符合预期）。注：三参形态的 `isPointInRect(point, sw, ne)` 返回 `false` 且不抛错——该形态的语义未确认，本库不据此下结论。

残余风险（每条都写明去处）：

- **本仓库自持的 legacy 声明曾经与真实脚本不一致**：那份声明把 `BMapGLLib.GeoUtils` 写成 `new GeoUtils(map, options)` 的类，而真实脚本暴露的是**静态谓词命名空间**（没有可用的实例 API）。记录这条是因为它解释了「为什么不能拿 legacy 类型当依据」——该声明目录已在 `#26` 删除，现在类型面只剩官方 `@baidumap/jsapi-v4-types` 与最小 augmentation。
- `DrawingManager` 会自行注入它，属于插件之间的隐式依赖（运行时已观察到）。各静态谓词的**签名语义**未逐个核对（只证了不抛错 + `getDistance` 数值正确）。

### `Mapvgl`

**硬不兼容**：它的 JSONP 传输层直接拿 SDK 的私有回调表（成员名 `_rd`）当注册处——把自己的回调函数塞进去，再把 `callback=` 参数指向表里的那条。这正是 #72 明令本库（ADR `2026-09-13-private-sdk-surface-removal`）不得访问的私有面，它也不在官方声明里；脚本另外读 `window.BMapGL || window.BMap` 并尝试继承 `Overlay`。

私有面：私有 JSONP 回调表（成员名 `_rd`）：脚本把函数注册进这张表，并把 `callback=` 指过去。

成员核对：命名空间级成员由 `pnpm probe:plugin-compat` 自动核对；本条目的执行路径没有用到实例成员。

运行时（`pnpm probe:plugin-runtime`）：**抛错** —— 真实 4.0 页面上 `window.mapvgl` 与 `View` 都在，但 `new mapvgl.View({ map, mapType: "bmap" })` 抛 `Cannot read properties of undefined (reading 'appendChild')` —— 它的视图容器挂载路径在 4.0 上不成立。这与「依赖私有回调表」是**两条相互独立**的依据。

残余风险（每条都写明去处）：

- 加载期会注入百度统计脚本（`window._hmt`）——`builtins.ts` 的 `mapvgl` 分支因此用「fetch + 去掉统计片段 + 内联」的方式加载，这条特例只对 MapVGL 成立，不要推广到别的插件。
- 即使去掉统计脚本，`_rd` 这一条也不会因为本库的改动而消失：它是脚本自己的传输实现，要修只能改上游（M8 / #43）。
- `View` 构造失败的根因未继续排查（不知道是缺 pane、还是期望 legacy 容器 API）；本库不修它，只把结论写清楚。

## 复现

```bash
# 从锁定 URL 拉取真实发布产物，重新抽取「引用的 SDK 成员 / 私有面 / 自注入脚本」，
# 并与官方类型声明核对命名空间级成员（需要网络；不进 PR 门禁）。
pnpm probe:plugin-compat

# 只做本地无网络校验：数据模块、生成文档与 BUILTIN_PLUGIN_URLS 是否一致。
pnpm generate:plugin-inventory:check
```
