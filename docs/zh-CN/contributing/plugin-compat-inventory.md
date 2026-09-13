<!-- Generated file. Do not edit directly. -->

# 插件兼容 inventory

> 由 `packages/baidu-map-gl-vue/src/plugins/compat-inventory.ts` 生成，请勿手工编辑。
> 更新数据后运行 `pnpm generate:plugin-inventory`，CI 用 `--check` 校验无漂移。

这份清单覆盖 `plugins: [...]` 能识别的四个内置插件脚本。它区分**三类依据**：对锁定 URL 的
真实发布产物的观察、与官方 `@baidumap/jsapi-v4-types@4.0.4` 的逐成员核对、以及真实运行时观察。
没有跑过的档位不写进依据——把「声明面没缺口」说成「兼容」是把结论说得比证据强。

## 依据档位

| 依据 | 含义 |
| --- | --- |
| `artifact` | 对锁定 URL 的真实发布产物做静态抽取（`pnpm probe:plugin-compat`，可复现） |
| `declaration` | 与官方 `@baidumap/jsapi-v4-types@4.0.4` 的逐成员核对（同一条命令） |
| `runtime` | 真实 JSAPI 4.0 运行时观察（需 AK + WebGL，仅 nightly / 手动） |

## 结论取值

| 结论 | 含义 |
| --- | --- |
| `incompatible` | 有决定性依据说明它在 4.0 上不可用 |
| `no-declaration-gap` | 引用的 SDK 成员在 4.0.4 声明里没有缺口（≠ 运行时已验证） |
| `undetermined` | 引用面无决定性缺口，但存在**依据不足**的不确定项（构造期用法 / 自注入脚本等），结论留给 M8（#43） |

## 清单

| 插件 | 锁定 URL | 暴露全局 | required | 引用的 SDK 命名空间成员 | 私有面 | 副作用标记 | 关联能力 | 结论 | 依据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `TrackAnimation` | `mapopen.bj.bcebos.com/github/BMapGLLib/TrackAnimation/src/TrackAnimation.min.js` | `window.BMapGLLib.TrackAnimation` | false | `Point`, `ViewAnimation` | 无 | — | `service.track-animation` | `no-declaration-gap` | `artifact`, `declaration` |
| `DrawingManager` | `mapopen.bj.bcebos.com/github/BMapGLLib/DrawingManager/src/DrawingManager.min.js` | `window.BMapGLLib.DrawingManager` | false | `Circle`, `Control`, `Icon`, `Label`, `Marker`, `Overlay`, `Pixel`, `Point`, `Polygon`, `Polyline`, `Size` | 无 | `BMapGLLib/GeoUtils/src/GeoUtils.min.js`, `BMapGLLib/DrawingManager/src/gpc.js` | — | `undetermined` | `artifact`, `declaration` |
| `GeoUtils` | `mapopen.bj.bcebos.com/github/BMapGLLib/GeoUtils/src/GeoUtils.min.js` | `window.BMapGLLib.GeoUtils` | false | `Bounds`, `Circle`, `Polygon`, `Polyline` | 无 | — | — | `no-declaration-gap` | `artifact`, `declaration` |
| `Mapvgl` | `unpkg.com/mapvgl@1.0.0-beta.188/dist/mapvgl.min.js` | `window.mapvgl` | false | — | **有** | `_hmt` | `overlay.mapvgl` | `incompatible` | `artifact`, `declaration` |

## 逐条结论与残余风险

### `TrackAnimation`

加载期只写 `window.BMapGLLib`，不碰 SDK；引用的 `BMapGL.Point` / `BMapGL.ViewAnimation` 与它调用的 `Map` 方法（`getViewport` / `getDistance` / `getMaxZoom` / `startViewAnimation` / `pauseViewAnimation` / `continueViewAnimation` / `cancelViewAnimation` / `addOverlay` / `removeOverlay`）在 4.0.4 声明里**全部存在**。

私有面：无命名空间级私有成员；实例级私有字段见残余风险。

残余风险（每条都写明去处）：

- `setSpeed()` 依赖上游**未声明**的 `ViewAnimation` 私有成员（`animation` / `_options` / `_beginTime` / `_pauseTime` 与 `setBeginTime` / `setDuration`）⇒ 该方法按「依据不足」处理，本库不承诺它；构造函数 / `start` / `pause` / `continue` 路径不碰私有面。
- `Polyline#_config.linkRight` 是实例私有字段，用于判断折线是否跨 180° 经线。
- 运行时未验证（无 AK / WebGL）；`pnpm smoke:v4` 的插件页属 #43。

### `DrawingManager`

引用的命名空间成员全部在 4.0.4 声明内；`lang.Class` 是脚本**自带**的实现（`r.lang = r.lang || {}`），不依赖 SDK 内部模块。但它用 `prototype = new BMapGL.Overlay` 继承覆盖物基类，而官方声明明写「此类不可实例化」；且 `enableCalculate()` / `enableGpc()` 会**由脚本自己**动态注入 GeoUtils 与 GPC 两个外部脚本，不受本库管控。

私有面：无。

残余风险（每条都写明去处）：

- `new BMapGL.Overlay` 与官方「不可实例化」的表述冲突，4.0 运行时行为未知 ⇒ 归 #43 用真实运行时确认。
- 运行时自行注入的两个外部脚本会绕过本库的加载与清理路径（不写进 `BUILTIN_PLUGIN_URLS`、不参与取消）⇒ 文档必须写明这一点。

### `GeoUtils`

纯几何谓词集合（`isPointInRect` / `isPointInPolygon` / `isPointInCircle` / `isPointOnPolyline` / `isPolylineIntersectArea` / `getDistance` / `getPolylineDistance` / `getPolygonArea` / `degreeToRad` / `radToDegree`），只读 `Bounds` / `Circle` / `Polygon` / `Polyline` 的公开读数方法，无私有面、无副作用。

私有面：无。

残余风险（每条都写明去处）：

- **本仓库自持的 legacy 声明与真实脚本不一致**：`types/BMapGL/lib.d.ts` 把 `BMapGLLib.GeoUtils` 声明成 `new GeoUtils(map, options)` 的类，而真实脚本暴露的是**静态谓词命名空间**（没有可用的实例 API）。在 `#26` 删除 legacy 声明面之前，别照着那份声明写调用。
- 运行时未验证（无 AK / WebGL）；`DrawingManager` 会自行注入它，属于插件之间的隐式依赖。

### `Mapvgl`

**硬不兼容**：它的 JSONP 传输层直接拿 SDK 的私有回调表（成员名 `_rd`）当注册处——把自己的回调函数塞进去，再把 `callback=` 参数指向表里的那条。这正是 #72 明令本库（ADR `2026-09-13-private-sdk-surface-removal`）不得访问的私有面，它也不在官方声明里；脚本另外读 `window.BMapGL || window.BMap` 并尝试继承 `Overlay`。

私有面：私有 JSONP 回调表（成员名 `_rd`）：脚本把函数注册进这张表，并把 `callback=` 指过去。

残余风险（每条都写明去处）：

- 加载期会注入百度统计脚本（`window._hmt`）——`builtins.ts` 的 `mapvgl` 分支因此用「fetch + 去掉统计片段 + 内联」的方式加载，这条特例只对 MapVGL 成立，不要推广到别的插件。
- 即使去掉统计脚本，`_rd` 这一条也不会因为本库的改动而消失：它是脚本自己的传输实现，要修只能改上游（M8 / #43）。

## 复现

```bash
# 从锁定 URL 拉取真实发布产物，重新抽取「引用的 SDK 成员 / 私有面 / 自注入脚本」，
# 并与官方 4.0.4 声明逐成员核对（需要网络；不进 PR 门禁）。
pnpm probe:plugin-compat

# 只做本地无网络校验：数据模块、生成文档与 BUILTIN_PLUGIN_URLS 是否一致。
pnpm generate:plugin-inventory:check
```
