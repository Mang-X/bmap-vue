# v4 浏览器 smoke（默认链路 / Vue 组件 / UI Kit）

本页是 **JSAPI 4.0 required smoke** 的使用说明与判定口径单一事实源。它解决的是
「类型/文档层面核对过、但没在真实运行时跑过」这一类假设——#74 用它第一次跑就抓到一个
`<BMap>` 在真实 SDK 上永远进不了 `ready` 的缺陷（见文末「实测收获」）。

决策依据：[ADR 2026-09-13：v4 required smoke 的判定口径](/adr/2026-09-13-v4-required-smoke)。
官方包自身的发布契约另见 [官方包发布契约（Loader / UI Kit）](/zh-CN/contributing/official-packages)。

> 分工：`probe:official` 探的是**官方两个包**；`smoke:v4` 探的是**本库**——默认入口是否真的
> 委托官方 Loader、基础组件在真实 SDK 上是否可用、UI Kit **四个**薄封装（自动补全 / 地点检索 /
> 详情 / 路线）是否检索·事件·样式·销毁成立、
> 卸载后本库资源是否清干净。

## 一条命令

```bash
# PR 门禁档：无 AK、无外网，注入 Fake v4 命名空间跑同一份组件树，结论确定
pnpm smoke:v4:fixture

# 真实档：官方 Loader + 真实 AK + 外网 + 外网 UI Kit（nightly / 发布前）
BAIDU_MAP_AK=<你的 ak> pnpm smoke:v4
```

- dev server **必须绑 `localhost`**：百度 AK 的 Referer 白名单按**主机名**匹配，
  `127.0.0.1` 不放行（harness 已固定）。
- AK 只经 URL 查询参数传给页面，页面与 orchestrator 两侧都会脱敏，**不落盘、不入库**。
- 排障旋钮：`-- --ready-ms=60000 --timeout=300000 --out=/tmp/v4-smoke.json --keep --verbose`。
- 浏览器解析顺序：`SMOKE_BROWSER` → Playwright 缓存 → 系统 Chrome/Chromium。

## 退出码与五态判定

**required 只接受 `pass`。** 这是 #74 承接 #72 欠账的核心一条：历史 characterization
（「已知失败也算验收」）从此不再计入通过。

| 结论 | 含义 | 可放行 |
| --- | --- | --- |
| `pass` | 断言成立，且是本轮真实观察到的 | 是 |
| `fail` | 断言不成立，或出现归属到本库的未处理异常 | 否 |
| `blocked` | 前置不满足（AK / 配额 / 网络 / 浏览器），本轮无法得出结论 | 否（**不是通过**） |
| `skipped` | 登记了但本轮没执行，必须给出理由 | 否 |
| `expected-failure` | 已知缺口，**必须**带追踪票与到期日 | 否（阻止发布） |

退出码：`0` 全 required pass 且没有任何不可放行结论；`1` 有 `fail`；
`3` 有 `blocked` / `skipped` / `expected-failure`（**不可放行**，与「通过」严格区分）；
`2` 脚手架失败（页面没写出报告、Vite 没就绪、CDP 超时等）。

三条防「门禁空转」的硬规则：

1. **required 的检查必须真的跑过。** 登记表里声明为 required、但报告里没有的检查，判
   `REQUIRED_CHECK_MISSING` → `fail`。只写「检查失败」不写「检查没跑」，门禁迟早会被
   「这次没执行」骗过去。
2. **`expected-failure` 缺 `tracking` / `expires`、或已过期 → 退化为 `fail`；`skipped` 缺
   `reason` → 退化为 `fail`。** 允许登记已知缺口，但不允许登记一个无法追踪的缺口。
3. **跨域未归因错误不再一律豁免。** 跨域脚本抛的错在浏览器里只有 `"Script error."`，
   确实无法归属；但「无法归属」不等于「可以忽略」：未归因错误必须被一条带齐
   `reason` / `version` / `owner` / `tracking` / `expires` 的**白名单**条目覆盖（且未过期），
   此时结论是 `blocked`——**仍然不可放行**，只是把「库回归」与「上游噪声」区分开。
   白名单缺省为空；可选插件的噪声靠**单独页面**隔离，而不是靠豁免规则兜底。

## 检查清单

登记表是单一事实源：`tests/browser/jsapi-v4/registry.mts`。**档内不适用的检查不登记**
（而不是登记成 `skipped`），否则「档内不适用」会与「该跑没跑」混成一件事。

| 检查 | live | fixture | 断言的可观察量 |
| --- | :---: | :---: | --- |
| `provider-default-delegation` | ✅ | — | 入口 script 恰好 1 个、URL 含 `v=4.0`、`callback` 是官方 Loader 的 `__bmapJSApiOnLoad_<n>`（自研 transport 不会产生这个形状） |
| `fixture-namespace-reused` | — | ✅ | 复用注入的命名空间、且**零**官方入口 script |
| `map-ready` | ✅ | ✅ | `MapHandle` + 容器有 SDK DOM（live）/ 账本可读（fixture） |
| `map-view-round-trip` | ✅ | ✅ | `getCenter` / `getZoom` 与传入的 `center` / `zoom` 一致 |
| `overlay-marker` | ✅ | ✅ | 覆盖物计数增长（live 用 `getOverlays()`，fixture 用账本） |
| `overlay-polyline` | ✅ | ✅ | 同上 |
| `overlay-rectangle` | ✅ | ✅ | v4 新增的 `<BRectangle>`：计数增长 + `getBounds()` 回读几何（#31） |
| `control-zoom` | ✅ | ✅ | **拦截真实 `Map.addControl` 的调用**（live）/ 账本计数增长（fixture），另附容器 DOM 增量作为 detail |
| `controls-stable-set` | ✅ | ✅ | #41 新增的三个 Stable 控件（`<BNavigation>` / `<BMapType>` / `<BOverview>`）各发生一次 `Map.addControl`；随后把三者的 `anchor` 一起改成一个新值，**从拦截到的实例上回读 `getAnchor()`** 必须全部变成 `BOTTOM_LEFT`（这是「anchor 真的动态下发」在真实 SDK 上的证据）；挂载期间无 `console.error` |
| `panorama-viewer` | — | ✅ | `<BPanorama>` 挂载后查看器计数增长（fixture 的实例账本）。**live 档不登记**：真实查看器需要真实全景场景与网络，`descriptor.panoramas()` 在 live 档恒为 `-1`，登记进来只会得到一条假失败（真实图块加载属 nightly 的观察项） |
| `layer-district` | ✅ | ✅ | **拦截真实 `Map.addLayer` 的调用**（live）/ 账本计数增长（fixture），另附能力表声明与无 `console.error` 作为辅助 |
| `layer-tile` | ✅ | ✅ | 同 `layer-district`（拦截真实 `Map.addLayer`），瓦片模板指向**百度自己的瓦片主机**（与 SDK 内部同源）以便 live 档不产生无关的网络错误；**瓦片是否画出来不由本库保证** |
| `layer-traffic` | ✅ | ✅ | 同 `layer-district`；`BTrafficLayer` 走官方路况服务，无需外部瓦片源 |
| `layer-geojson` | ✅ | ✅ | 同 `layer-district`，另加「`setData` 写入的 `FeatureCollection` 被 SDK 接受」（线要素） |
| `infowindow-visible` | ✅ | ✅ | 地图**活状态**非空（轮询）+ 内容节点 `display`/`visibility` 可见 + 文本非空 |
| `service-geocode` | ✅ | — | headless 地理编码真实回包非空；**回包为空或超时都记 `blocked`**（AK 权限 / 配额 / 网络不成立，不是库回归） |
| `ui-kit-autocomplete-search` | ✅ | — | widget `ready`、检索写入输入框、宿主里出现官方 UI Kit 渲染的输入框、**卸载后宿主子树从文档撤走**（回收路径，见下） |
| `ui-kit-placesearch-load` | ✅ | — | widget `ready`、检索结算、**`load` 事件带回 POI**（并从中取一个真实 uid 给下一条检查）、宿主里由 UI Kit 渲染出结果 DOM |
| `ui-kit-placedetail-load` | ✅ | — | widget `ready`、**用上一步真实检索到的 uid 打开**、`load` 事件带回详情、宿主渲染出面板、卸载后宿主子树撤走 |
| `ui-kit-routeplan-search` | ✅ | — | 驾车检索返回方案（`plans.length > 0`）、**`result` 事件与返回值同源**、面板渲染、卸载后宿主子树撤走；服务类失败（`BMAP_SERVICE_FAILED`）记 `blocked` |
| `second-provider-reuses-sdk` | ✅ | — | 第二个入口不重复注入 SDK script（fixture 档从不注入 script，这条在该档恒真，故不登记） |
| `unmount-release` | ✅ | ✅ | 容器里 SDK DOM 已撤、句柄作废（`BMAP_RESOURCE_DISPOSED`）、**官方全局不得被改写** |
| `remount-after-unmount` | ✅ | ✅ | 重挂载后仍可用（没有复用脏状态） |
| `map-container-gate` | ✅ | ✅ | 宿主 `display:none`（真实零尺寸）时**不建图**（`getMapInstance()` 为 `null`、状态未 ready、无错误），`display:block` 后门禁放行并建图一次；随后 `getCenter`/`setZoom`/`supports`/`suspend`·`resume` 在真实 SDK 上逐条生效，且期间无 `console.error`。其中 `supports()` 三条读数（`overlay.marker` / `map.zoom` / `map.bounds`）**两档都必须是 `true`** —— live 档那一条正是「能力探测要认实例自有成员」的回归门禁（真实 4.0 的 `setZoom` 不在 `Map.prototype` 上，见 ADR 已知限制第 13 条） |

未处理异常单独汇总：**能归属到本库的一律 `fail`**；未归因的按上面第 3 条处理。

### live 档的读数边界（如实登记，不是放宽）

真实 `v=4.0` 的 `Map` **没有** `getControls()` / `getLayers()` 读数接口（逐个成员核对过官方
类型包 `map/core/Map.d.ts`），矢量图层也不落 DOM。因此控件与图层的主要证据是**临时拦截真实
`Map.addControl` / `Map.addLayer`**，记录调用参数后再转调原实现：

- 它证明的是「组件 → Driver → **真实 SDK 的那次调用**」确实发生过——比「没抛错所以大概挂上了」
  或「容器 DOM 变了」强得多（第 1 轮评审：只断言能力表 + 无 `console.error` 时，图层静默 no-op
  仍会 PASS；实测把 `<BDistrictLayer>` 的挂载改成 no-op 后，该断言现在会红）；
- **它的边界同样要说清**：拦截只能证明调用发生了，**不能证明 SDK 采纳了它**。要证明采纳需要 SDK
  提供读数接口，上游 4.0.4 没有。拦截器必须在 `finally` 里还原，否则会影响后续检查。
- 能力表断言只在 Catalog 里**真有**该 id 时才做（`layer.district` 有，控件没有对应 id，因此控件
  不做能力断言——拿一个不存在的 id 去 `supports()` 会得到 `false` 而假红）。

### bootstrap 失败归谁：外部前置 ⇒ `blocked`（退出 3）

`<BMap>` 在预算内没有 ready 时，**不能**让所有 required 以「缺席」收场——那会被门禁判成
`REQUIRED_CHECK_MISSING` ⇒ `fail`（退出 1），于是网络 / CDN / AK 这类前置问题被写成「库回归」，
恰恰在最关键的初始化场景把两类问题混在一起。处置：

| bootstrap 阶段的观察 | 归属 | 结果 |
| --- | --- | --- |
| 只有 `BMAP_SDK_LOAD_FAILED` / `BMAP_SDK_LOAD_TIMEOUT` | 外部前置 | 本档 required **逐条登记为 `blocked`** ⇒ 退出码 3（不可放行） |
| 出现任何**其它**错误码（如 `BMAP_SDK_CALL_FAILED`） | 实现 / 上游契约 | 登记一条 `fail`，required 保持缺席 ⇒ `REQUIRED_CHECK_MISSING` ⇒ 退出码 1 |
| 一条错误都没有、ready 又没来 | 无法归属 | 按外部处理（`BMAP_READY_TIMEOUT`）⇒ 退出码 3：不冒充库回归，但也**不是通过** |

判定方向刻意保守：**只要有任何一个非外部码，整轮就按实现回归处理**（宁可红不可绿）。
实跑验证：`--ready-ms=1` 时全部 required 以 `BLOCKED`（`BMAP_READY_TIMEOUT`）结算、退出码 `3`。

### orchestrator 的信封自检

Node 侧不信任页面的自报：`mode` / `runId` / `akUsed` 三者必须与**本轮 CLI 请求**一致，否则按
脚手架失败（退出 2）退出；required 集合也取**本轮 CLI 的档**而不是报告自报的档。否则页面若意外
按 fixture 档跑，Node 会跟着换成一个**更小**的 required 集合——门禁看着绿、其实少跑了一片。


## 进 CI 的两条通道

| 通道 | 跑什么 | 位置 |
| --- | --- | --- |
| PR 门禁（每次 PR） | `pnpm smoke:v4:fixture`（无 AK、无外网、结论确定） | `.github/workflows/quality.yml` 的 `smoke-v4-fixture` job |
| nightly / 手动 | `pnpm smoke:v4`（真实 AK、真实外网） | `.github/workflows/nightly-v4-smoke.yml` |
| 单测（每次 PR） | 判定逻辑与登记表的纯逻辑用例，**不依赖浏览器** | `tests/behavior/v3-v4-smoke-gate.test.ts` |

nightly 的 job 守卫写的是完整 `owner/repo`（`github.repository == 'Mang-X/bmap-vue'`）：
仓库迁到组织后 `github.repository_owner` 已不是个人账号，用 owner 判断会让 job 被**永久跳过**
——「CI 是绿的」与「CI 根本没跑」必须可区分。同一类守卫（含「fixture 档真的被 PR 门禁跑起来」）
由 `tests/behavior/v3-v4-smoke-workflow.test.ts` 静态锁定，并配合成负例自测。

## 回收路径的证据分层

「Autocomplete 回收干净」（#72 欠账 3）被拆成两层，两层都不能省：

- **浏览器档**（`ui-kit-autocomplete-search`）：真实链路下卸载后整棵宿主子树从文档撤走、
  期间无 `console.error`、地图组件无报错——证明**可观察结果**；
- **行为测试**（`tests/behavior/v3-ui-kit-lifecycle.test.ts`）：假 widget 逐条记
  `on` / `off` / `destroy` 与宿主 DOM，证明**销毁确实被调用、监听确实解绑**。

浏览器里没有字节级的 widget 账本，所以「只写一层」必然留一个缺口：只写行为测试证明不了真实链路，
只写浏览器档证明不了 destroy/解绑真的发生。

## 实测收获（2026-09-13，#74）

第一次真实档运行（修复前）就抓到一条只在真实运行时暴露的缺陷：

```
BLOCKED harness-bootstrap — <BMap> ready 在 25000ms 内没有结算
loadErrors=["BMapError: BMap.MapTypeId.BMAP_NORMAL_MAP is not available"]
diagnostics: {"mapTypeId":{"keys":["NORMAL","EARTH","SATELLITE"]}}
```

- 上游 `@baidumap/jsapi-v4-types@4.0.4` 声明的是 `MapTypeId.BMAP_*_MAP`，
  真实运行时只有 `{ NORMAL, EARTH, SATELLITE }`（带前缀的那组挂在全局）；
- 按声明名实现 ⇒ `applyMapType` 抛错 ⇒ `boot()` 落到 `catch` ⇒ **`ready` 永不触发**，
  整张地图不可用；
- Fake 因为**按声明造夹具**而一路绿——夹具比真实 SDK 宽容时，这类缺陷只能靠真实 smoke 抓。

修复（本目录同批提交）：候选顺序改为**运行时名优先、声明名后备**，Fake 改为只提供运行时那三个
成员，并按运行时名更新单测。修复后真实档 14 项 required 全 `pass`、`gate.exit=0`。
