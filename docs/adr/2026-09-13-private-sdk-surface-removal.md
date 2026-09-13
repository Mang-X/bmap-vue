# ADR 2026-09-13：删除 SDK 私有面嗅探，并把气泡 / Autocomplete 收回到公开可用面

- 状态：已接受（Accepted）
- 日期：2026-09-13
- 计划键：`R25-C`（issue #72，追踪 #12，收口目标 #25）
- 取代：ADR [2026-09-12 v4 Service / Panorama / Native Layer Facet](./2026-09-12-jsapi-v4-service-panorama-native-layers.md) 的**决策 3**（「空结果 vs 失败」靠 `normalize/jsonpProbe.ts` 的 `_rd` 嗅探，两引擎共用）与该 ADR 里作为复审结论落地的「`locateCity` 接 JSONP 探针、有错误码 ⇒ `failed`」这条口径。该 ADR 的其余决策（Facet 划分、创建面 / 调用面分层、运行时注入探测、装配收口）继续有效。
- 相关：`packages/baidu-map-gl-vue/src/driver/normalize/**`、`driver/jsapi-v4/services.ts`、`driver/webgl-v1/services.ts`、`components/overlays/BInfoWindow.vue`、`components/autocomplete/BAutoComplete.vue`、`packages/test-utils/fake-bmap-v4/**`、`tests/behavior/v3-private-sdk-surface.test.ts`、`tests/behavior/v4-components-lifecycle.test.ts`

## 背景

`R25` 阶段的纠偏不只是换依赖。已有实现里有三处**依赖私有面或把已知失败当验收**的形态，必须在默认切换（#25）之前拆掉——否则切换一上线，`<BInfoWindow>` 会直接报错，而服务层的错误归因会继续绑在官方随时能改的内部实现上。

1. **服务错误归因靠扫私有回调表。** `normalize/jsonpProbe.ts` 扫描 `rawSdk._rd`，把注册进去的回调换成包装器，从参数里的 `{ result: { error, error_msg } }` 还原服务端错误码；`geocode` / `reverseGeocode` / `queryBoundary` / `locateCity` 和两个 composable（`useBMapGeocoder` / `useBMapGeocodeDetail`）都靠它区分「空结果」与「失败」。这是 **monkey-patch 别人的内部表**：官方没有承诺 `_rd` 的存在、形状或生命周期，而 ADR [Official-first](./2026-09-13-official-first-loader-and-ui-kit.md) 的决策 9 已经明确禁止本库访问 `_rd` / `qt=` / `getSeckeyAndSign` 这类私有面。
2. **气泡被当成普通覆盖物挂载。** `<BInfoWindow>` 在 `onMounted` 里调 `overlays.add({ kind: "map" }, infoWindow)`，而 JSAPI 4.0 的 OverlayDriver 明确拒绝这条路（气泡是**地图级** API：`map.openInfoWindow(infoWnd, point)` / `map.closeInfoWindow()`）并抛 `BMAP_INVALID_ARGUMENT`。双跑矩阵当时把这条现状**钉成断言**（`mountedOnDriver: false`），也就是「已知失败也算验收通过」。
3. **Autocomplete 的清理与 raw 访问散在组件里。** `BAutoComplete` 的两个 `watch()` 注册在 `await whenReady()` 之后、**没有**进 `ResourceScope`；卸载时没有调用 Driver 的公开释放入口（输入框上的输入活动监听不会随 SDK 实例被回收）；`location` / `types` 的同步直接写 `instance.raw.setLocation(...)`，把 raw SDK 成员访问摊在组件代码里，绕过了 raw SDK 边界。

## 决策

### 1. 服务结论只来自公开面；缺证据时报「没有可用结果」，不编造精确错误码

删除 `normalize/jsonpProbe.ts` 与全部调用点。归一化服务调用的结果收敛成：

| 情形 | 结论 | 依据 |
| --- | --- | --- |
| 回包有内容 | `success` | 公开回调参数 |
| 回包是 `null` / 空容器 | `empty` | 公开回调参数（「查无结果」与「服务当前不可用」在公开面上**不可区分**） |
| `Geolocation#getStatus()` | `failed` + `BMAP_STATUS_*` | 官方公开的状态入口 |
| `Convertor#translate` 回包 `status ≠ 0` | `failed` + `status` | 官方公开的回包字段 |
| 回调不来（超时）/ 主动取消 | `timeout` / `canceled` | 适配器既有语义 |

- **为什么不给「不可用」造一个 `BMAP_SERVICE_UNAVAILABLE`**：那会让调用方以为拿到了可判定的失败原因（配额？Referer？网络？），而我们并不知道 —— `empty` 至少诚实，且与 `failed` 的既有含义（有可判定原因）不冲突。
- **删除而不是「默认关闭」**：私有嗅探一旦留在代码里，下一个人补服务时就会顺手复用；同时 `packages/test-utils/fake-bmap-v4` 的 `_rd` 注册表与 `jsonpError` 注入面一并删除 —— 注入面本身就是「诱导实现去嗅探私有表」的脚手架。
- **加一条源码门禁**：`tests/behavior/v3-private-sdk-surface.test.ts` 扫描 `packages/baidu-map-gl-vue/src/**`（去掉 `*.test.ts`），命中 `x._rd` / `x["_rd"]` / `{ "_rd": … }` / `getSeckeyAndSign` 即失败。匹配的是**访问形态**而不是裸露字符串，所以注释里写「不嗅探 `_rd`」是允许的；门禁自带正证守卫（植入样例必须被抓到）与文件数下界（防空转）。
  - 不接进 `check:raw-sdk` 的原因：那个门禁带目录白名单（`driver/**` 放行），而私有面规则恰恰必须**在 `driver/**` 里也成立** —— 同一份白名单表达不了「两条规则、两套作用域」。

### 2. 气泡只走地图级专用入口；内容容器的可见性由打开状态驱动

`<BInfoWindow>` 不再调用 `overlays.add` / `overlays.remove`（两个引擎都不再需要：legacy 的打开也走 `map.openInfoWindow`，关闭落 `InfoWindow#hide()`），改为：

- 打开：`overlays.openInfoWindow(map, infoWindow, position?)`；关闭：`overlays.closeInfoWindow(infoWindow)`；卸载：先关闭再释放 scope；
- **内容容器的可见性**：模板上不再写静态 `style="display:none"`。那个内联样式会一直留在节点上，SDK 把它挂进自己的容器之后**内容仍然是隐藏的** —— 现在由「是否打开」驱动（未打开时隐藏以避免内容在地图角落闪现，打开时把可见性交还给 SDK）；
- **异步就绪保护**：`openWindow()` / `closeWindow()` 前置校验句柄 + client + map（`onMounted` 里 `whenReady()` 之后才有值，而卸载路径之后挂在 scope 上的 watcher 仍可能被触发）；
- 完整状态机（Teleport、InfoWindowManager、受控 / 不受控的边界、多气泡竞争的产品级语义）仍由 M5 **#32** 收口，本决策只覆盖**最小成功路径**。

### 3. Autocomplete 的实例更新收进 Driver，卸载调用公开释放入口

- 新增 `ServiceDriver.setAutocompleteOptions(handle, { location?, types? })`，落到官方 4.0.4 已声明的 `Autocomplete#setLocation` / `#setTypes`；两个引擎各自实现（legacy 用同一套 `callOptional` 口径，成员缺失时静默 no-op 与既有行为一致）。
  - 它是**共享契约**而不是引擎独占面：`setLocation` / `setTypes` 在 legacy SDK 上同样存在，组件此前也正是这么用的 —— 收进 Driver 只是把 raw 成员访问搬到边界内，不改变能力边界。
  - 前置状态校验：已被 `disposeAutocomplete()` 释放的实例拒绝写入（写入一个已销毁的 SDK 对象没有意义）；**失去回调通道独占不拒绝**（纯配置写入，不发起请求、不影响回包归属）。
  - `location` 归一化：本 Client 的句柄 → raw（`AutocompleteOptions.location` 只接受 `string | Map | Point`，此前组件把 `MapHandle` 原样透传，SDK 拿到的是非法值）、`{lng, lat}` → raw `Point`、其余原样透传。
- `BAutoComplete`：两个 `watch()` 用 `scope.add()` 纳入作用域；卸载时 `scope.dispose()` → 业务订阅先下线 → 调用 Driver 的 `disposeAutocomplete()`（按**结构化能力**探测，legacy 没有这个面且没有 Driver 侧资源）；组件不再访问 `.raw`。

### 4. Autocomplete 的请求归属假设按「串行化 + 上界 + 标注」处理

`AutocompleteResult.keyword` 是否真等于本次检索的关键字、回包与请求是否一一对应，**官方没有承诺，本仓库也没有在真实 AK 上验证过**。处置：

- **串行化**：同一实例上同关键词最多一个在飞槽位（重叠请求直接显式失败）；
- **上界**：待回包记录上限 16，达到上限拒绝新调用（淘汰会让迟到回包被错误归属）；
- **标注**：Capability Catalog 把 `service.autocomplete` 标为 `experimental`（它不影响 `supports()`，只是让能力矩阵如实反映风险），代码注释里明确写出「这是未经真实运行时证明的假设」。
- **不**新增隐式请求调度框架；彻底的隔离（每请求一个独立实例 + 回调闭包）属 M7（#38 / #41）。

### 5. smoke 的判定语义（本次只冻结要求，实现在 #74）

`pass` / `fail` / `blocked` / `skipped` / `expected-failure` 必须是**五种不同结论**，且 required 场景只接受 `pass` —— `blocked` / `skipped` / `expected-failure` 单列并阻止发布，不得生成绿色验收结果；另**不得**「按跨域来源一律豁免异常」（必需官方链路出现未归因错误要失败或阻塞），可选插件单独页面验证，白名单必须带具体原因、版本、责任人与到期条件。

这条要求落在 `tests/browser/jsapi-v4/**`（#25 的 smoke harness，见「欠账」），本 PR 只把它写进 ADR 与 PR 正文，避免把 #72 反向依赖 #25（#74 依赖 #72，若 #72 依赖 #25 会形成环）。

## 后果

- 正面：服务层不再依赖官方随时能改的内部表；`<BInfoWindow>` 在默认引擎（v4）上真的能打开并显示内容；Autocomplete 的输入框监听与实例账有了明确释放路径；raw 成员访问回到 `driver/**` 边界内；能力矩阵如实标注了未证实的归属假设；双跑矩阵里那条「已知失败也算验收」的断言被正向断言取代。
- 代价：调用方**拿不到**服务端错误码了（`empty` 无法区分「查无结果」与「服务不可用」）。这是有意的取舍 —— 需要更细的服务健康度时，只能靠 `timeout` / 业务侧重试，或在官方补齐公开错误入口之后重做（届时按本文的决策 1 补一列，而不是回到嗅探）。
- 回滚：把 `jsonpProbe.ts` 与四处 `settleNull` 调用还原、把 `BInfoWindow` 改回 `overlays.add/remove`、把 Autocomplete 改回 `raw.setLocation` 即可回滚；本决策不删除任何 Facet / Client 契约，回滚**不**触及驱动的分层与句柄模型。

## 非目标

- 不做 #32 的产品级气泡状态机（Teleport、Manager、多气泡竞争、`maximize` / `restore` 事件）；
- 不重做 Autocomplete 的逐请求隔离，也不引入请求调度框架（#38）；
- 不接入官方 UI Kit 的自动补全 / 地点检索（#73）；
- 不改 `tests/browser/jsapi-v4/**` 的 smoke 判定实现（#74，理由见决策 5）；
- 不为「拿不到错误码」补任何私有替代入口（`qt=` / `getSeckeyAndSign` / 自建签名一律不做）。

## 已知限制（显式接受）

- **`empty` 是一个「合并结论」**：真实服务失败（配额 302 / Referer 限制）与真的查无结果都表现为 `empty`。API 文档与类型注释都如实写了这一点，不假装能区分。
- **气泡的完整状态机仍缺**：本决策只保证「打开 → 显示内容 → 关闭 → 卸载无残留」这条最小路径；`offset` 仍是构造期属性（4.0 没有 `setOffset`），`position` 变化在打开状态下会重新调用 `openInfoWindow`。
- **Autocomplete 的归属规则仍建立在未证实的假设上**（见决策 4）；`experimental` 状态不阻止使用，只是不承诺。
- **legacy 引擎的 `setAutocompleteOptions` 依赖 SDK 成员存在性**：成员缺失时是 no-op（与组件此前 `raw.setLocation?.()` 的行为一致），不额外告警。

## 欠账（交给 #74 / #25）

| 欠账 | 具体要求 | 为什么不在本 PR |
| --- | --- | --- |
| `tests/browser/jsapi-v4/**` 的 smoke 状态机 | 五态区分（`pass` / `fail` / `blocked` / `skipped` / `expected-failure`）+ required 只接受 `pass` | 该目录只存在于 #25 分支；#72 依赖它会与 #74 → #72 → #25 形成环 |
| 取消「按跨域来源一律豁免异常」 | 必需官方链路出现未归因错误要失败或阻塞；可选插件单独页面验证，白名单带原因 / 版本 / 责任人 / 到期条件 | 同上（要改的是那套 harness 的 `thirdPartyUnhandled` 口径） |
| 真实 AK 上的气泡与 Autocomplete 基线 | 用默认官方 Loader 路径跑 required smoke，`<BInfoWindow>` 显示内容、Autocomplete 回收干净 | 真实网络 + AK 的验收本来就属于 #74（同一候选提交上证明） |

## 参考

- issue #72 `[R25-C][P0] 移除私有 SDK 嗅探，修复 InfoWindow / Autocomplete 与真实可用性门禁`
- issue #25 `[M3A.3][Official-first] 通过官方 Loader 完成 v4 默认切换、UI Kit 最小集成与真实验收`（含 #71 / #72 / #73 / #74 拆分）
- issue #12 `[Roadmap] bmap-vue v3：Official-first 纠偏、JSAPI 4.0 与 Stable 实施总览`
- ADR [2026-09-13 Official-first：默认加载委托官方 Loader、标准 UI 委托官方 UI Kit](./2026-09-13-official-first-loader-and-ui-kit.md)（决策 9：私有面边界）
- ADR [2026-09-12 v4 Service / Panorama / Native Layer Facet](./2026-09-12-jsapi-v4-service-panorama-native-layers.md)（本 ADR 取代其决策 3）
- ADR [2026-09-11 v4 Overlay Facet](./2026-09-11-jsapi-v4-overlay-facet.md)（InfoWindow 与普通覆盖物的分工）
- `@baidumap/jsapi-v4-types@4.0.4`：`service/Autocomplete.d.ts`（`setLocation` / `setTypes` / `dispose` 的官方声明）
