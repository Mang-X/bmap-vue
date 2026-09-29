# 待定：API 对齐走查发现（issue #141 文档走查）

> 这些是走查中发现的**需要产品决策**的项，不是文档问题。
> 文档侧已经按「现状」改写（不改运行时），但下面第 1 条的两种处理方式需要你选一个。

## 1.【高】`invalidateService` 没有对外暴露，「独占档多一个入口」这个契约不可观察

- `packages/bmap-vue/src/composables/serviceTask.ts:118` 定义了「独占服务任务的公开面：多一个
  `invalidateService`」，`useExclusiveServiceTask`（`:219`）也确实返回它；
- 但 `useLocalSearch`（`useLocalSearch.ts:273`）与四个路线 composable
  （`routeServices.ts:312`）**各自手写返回对象，都没有把它透出去**；
- `packages/bmap-vue/dist/composables.d.ts` 里 `invalidateService` 出现 **0 次**。

结果：文档里「简单档不暴露 / 独占档暴露」的两档划分，**对使用者不可观察**。
`clear()` 事实上就是那个入口（它内部 `task.reset()` + `invalidateService()`）。

两种处置：

| 方案 | 改动 | 代价 |
| --- | --- | --- |
| A. 补进公开面 | 5 个 composable 的返回加 `invalidateService` | 公共 API 增加（要过 `check:api` 基线）；语义上与 `clear()` 高度重叠 |
| B. 承认只有 `clear()` | 改 `serviceTask.ts:118` 的注释与 `guide/services.md` 的两档表述为「内部两档、对外统一是 `clear()`」 | 内部注释即契约说明，改动小；但「独占档」的设计意图在文档上消失 |

**当前按 B 处理**（只改文档与注释，没动运行时）。若选 A，`clear()` 与 `invalidateService`
的关系需要重新写清楚，否则会出现两个含义相近的入口。

## 2.【中】`result` / `location` / `data` 别名只保留了一半

`#165` 的对齐删掉了 `useGeocoder` / `useGeocodeDetail` 的 `result` 别名，但
`useConvertor`（`result`）与 `useIpLocation`（`location` + `data` + `result` 三个同值 ref）
仍然保留。同一个「结果别名」约定，一半 hook 有、一半没有。

建议：明确「只保留 `data`」这一条，其余别名按弃用处理（与 #165 已有的做法一致）。

## 3.【中】`useGeolocation` 的 `data.status` 是硬编码常量

`project` 里 `status: "BMAP_STATUS_SUCCESS"` 是写死的，真实的官方状态码在同对象的
`sdkStatus` 上。也就是说调用方读 `data.status` **永远拿到成功**，无法用于失败分支。
官方 `GeolocationResult` 并没有 `status` 字段，是本库加的。

文档已明确写出「判断成败请看 `status` 而不是 `data.status`」，但这是个易踩的 API 形状。

## 4.【中】`useGeocoder` / `useGeocodeDetail` 共用能力 id 但各建实例

两者都用 `service.geocoder` 这个能力，却各自 `createGeocoder()`。功能无碍
（`Geocoder` 无状态），但与「同能力共享实例」的直觉相反。

## 5.【低】同一层级的两个字段用两套「缺省」语义

`GeocodeDetailResult.point` 在回包无坐标时**回退到请求坐标**，
`addressComponents` 缺项**回填空串**。一个编造值、一个清空，文档已分别说明。

---

## 走查中已直接修掉的文档错误（无需决策）

- `services.md` 示例写 `useGeocoder().search(...)` —— 该 composable 没有 `search`，
  实际是 `getPoint` / `getBatch`（`useGeocoder.ts:81-96`）。示例必然运行时报错。
- `useGeolocation.md` 返回值表列了不存在的 `location`。
- `useGeocodeDetail.md` 的 `getBatch` 逐项形状写成 `{ point, detail, error? }`，
  实际是 `{ point, detail, status, error }`（`useGeocodeDetail.ts:43-48`）。
- 7 个页面的「对**六个** service hooks 完全一致」—— 实际有 12 个服务 composable。
- `sdkStatus`「成功为 0，拿不到为 null」对多数服务**不成立**：
  `useGeocoder` / `useGeocodeDetail` / `useAreaBoundary` / `useIpLocation` /
  `usePanoramaService` 的 `sdkStatus` **恒为 `null`**（官方无状态码入口，
  `services.ts:20-27`）。
- `<BMapProvider :ak>` / `:plugins` 用法错误：`ak` 与 `plugins` 都在 `<Map>` 上，
  `BMapProvider` 只接受 `client` / `definition` / `provider` / `loadOptions` / `autoLoad`。
- `enable-scroll-wheel-zoom`（9 处）—— #165 已改名为 `enable-wheel-zoom`，
  写错的 prop 落进 `$attrs`，**不报错也不生效**。

---

## 6.【严重·运行时缺陷】未传的交互 prop 被 Vue 强制转换成 `false`，等于把官方的「默认开」关掉

`Map.vue:592` 的 `syncEnableProps`：

```ts
for (const [prop, interaction] of INTERACTION_PROPS) {
  const value = props[prop];
  if (value === undefined) continue;          // ← 永不成立
  ctx.client.driver.map.setInteraction(ctx.map, interaction, Boolean(value));
}
```

`INTERACTION_PROPS` 有 8 项，但 `withDefaults` 只显式声明了 `enableDragging: true`、
`enableWheelZoom: false`、`enableAutoResize: true` 三项。其余五项
（`enableInertialDragging` / `enableContinuousZoom` / `fixCenterWhenResize` /
`enableDblclickZoom` / `enableKeyboard` / `enablePinchZoom`）是**缺省 `Boolean` prop**，
Vue 会把「没传」转成 `false`——于是 `value === undefined` 的守卫**永不命中**，
逐个把官方实例方法调成 `disable*()`。

而官方 `core/MapOptions.d.ts` 里：

| 键 | 官方 `@default` | 本库实际（不传时） |
| --- | --- | --- |
| `enableDblclickZoom` | **true** | `false`（→ `disableDoubleClickZoom()`） |
| `enablePinchZoom` | **true** | `false`（→ `disablePinchToZoom()`） |
| `enableKeyboard` | 未标注 | `false` |

**后果**：用户什么都不写，**双指缩放与双击缩放就被静默关掉了**——而这正是
官方默认打开的行为。文档原来写「默认 true」描述的是本应有的行为；
现在表里改成了实测值并加了告警框，但**运行时的错值没有修**。

修法（改 `src/**`，需你授权）：给这 6 个 prop 在 `withDefaults` 里显式钉上
`undefined`，让「没传」真的是「没传」，`syncEnableProps` 的守卫才会短路——
与 `OverviewMapControl` 现有的 `isOpen: false` 注释里写的正是同一个理由。

## 7.【中】`BMAP_HYBRID_MAP` 声明存在但运行期必失败

`driver/jsapi-v4/map.ts:130-140` 附近的注释写着「4.0.5 声明里的 hybrid 在真实运行时
不存在」，`resolveMapTypeConstant` 因此会显式抛错（`BMAP_SDK_CALL_FAILED`）。
文档原先把它标成 ✅ 可用，会让人以为传了就能出混合图。
已改为明确标注「不可用，要混合底图请用 `mapStyleId` / `mapStyleJson`」。

## 8.【中】`MapTypeId` 候选表的自相矛盾注释

`MAP_TYPE_CONSTANT_CANDIDATES` 写 `normal: ["NORMAL", "BMAP_NORMAL_MAP"]`，
注释说运行时三个成员字面量是 `{NORMAL, EARTH, SATELLITE}`，却又说 `BMAP_*` 那组
在运行时不存在。两条注释对同一事实给出相反表述，建议实机复核一次。

## 9.【低】`enableTraffic` 留在 `MapProps` 上但零效果

不在 `INTERACTION_PROPS` 里，因此既不报错也不生效；`Map.vue` 还在 watch 它。
要么删（与 #165「删掉静默丢弃的 prop」的做法一致），要么接上 `TrafficLayer`。

---

## 10.【严重】控件 `type` 传字符串，官方要数字 —— 三方对不上

上游 `const/NavigationControlType.d.ts`：

```ts
declare const BMAP_NAVIGATION_CONTROL_LARGE: 0;   // 数字
type NavigationControlType = 0 | 1 | 2 | 3;
```

`const/MapTypeControlType.d.ts` 同理（`0 | 1 | 2`）。

本库这边：`NavigationControlProps` / `MapTypeControlProps` 的 `type` 声明为
`type?: string`（`types/components.ts:2135 / 2169 / 2194`），Driver 走
`projectOptions` 的**原样透传**分支（`driver/jsapi-v4/controls.ts:137-138`
把它归为 `mutable` + `setType`），于是把 `"BMAP_NAVIGATION_CONTROL_LARGE"` 这个
**字符串**塞进官方构造器。`anchor` 有名字→数字映射（`controls.ts:91-101`），
`type` **没有**。

三方对不上：文档按常量名写、库按字符串透传、官方只认数字。
`tests/behavior/controls.test.ts:246` 断言的正是「字符串原样进去」——
也就是说现有测试把这个行为**固化**了。

两种处置，需要你选：

| 方案 | 说明 |
| --- | --- |
| A. 库加映射 | 与 `anchor` 同一套做法，加 `TYPE_VALUES` 名字→数字表；改动 `src/**`，公共 API 形状不变 |
| B. 文档收窄 | 文档改成字面量联合 `"0" | "1" | "2" | "3"`，明确「这是本库约定，与官方数字常量不同名」 |

**已按 A 修（#175）**：`driver/jsapi-v4/controls.ts` 新增 `NAVIGATION_TYPE_VALUES` /
`MAPTYPE_TYPE_VALUES` **两张按族分开的表**（不是一张平表——两族的数值撞：
`BMAP_NAVIGATION_CONTROL_PAN` 与 `BMAP_MAPTYPE_CONTROL_MAP` 都是 `2`，合成一张会让跨族传值
静默生效、渲染出别的控件的样式）。`ControlOptionSpec` 的 `value` 标记相应分成
`"navigation-type"` / `"map-type-style"`，`normalizeValue` 按标记各查本族、`resolveType`
统一告警口径。取值被**逐名**等值断言钉在官方 `const` 声明上（并集 `extends` 是恒真重言式，
只能挡「上游新增成员」、挡不住「改值」——改值才是这张表最需要防的回归）。公共 prop 仍是
`string`（不改调用方）。B 被否的原因是：文档与示例一直用常量名，收窄成字面量联合是纯破坏面。

`tests/behavior/controls.test.ts` 那条固化「字符串原样进去」的断言同时改为断言换算后的数值。

## 11.【中】`defineExpose` 与公开命令面类型不一致

`<CityListControl>` 在 `defineExpose` 里暴露了 `status`，但
`ControlCommandTypes["CityListControl"]`（`driver/types/controls.ts`）只有
`toggle` / `getCityName`——消费方按公开类型拿 ref 时看不到 `status`。
`<LocationControl>` 同构问题。文档已改成「读 expose 的 `status`」+ 兜底措辞，
**类型面**确实漏了。

## 12.【中】`TileLoadObserver` / `CityListChangeResult` 等公开 prop 类型没从根入口导出

它们出现在 `dist/index.d.ts` 的 declare 区（是 `TileLayer` / `RasterTileLayer` /
`WMSLayer` / `WMTSLayer` / `CityListControl` 的**公开 prop / 事件载荷类型**），
但 `src/index.ts` 没有 `export`。消费方 `import type { TileLoadObserver } from 'bmap-vue'`
会拿到 TS2459。文档只能在示例里写内联结构绕开。

## 13.【中】`<Prism>` `enableClicking`、`<GroundOverlay>` `displayOnMin/MaxLevel` 描述符有、公共出口没有

`OVERLAY_DESCRIPTORS.prism`（`driver/types/overlays.ts:1104`）注册了 `enableClicking`，
`PrismProps` 里却没有——文档原本宣传了这个 prop。
`GroundOverlayProps` 同样缺 `displayOnMinLevel` / `displayOnMaxLevel`，而描述符
（`overlays.ts:1064-1065`）为它们声明了 `mutateBy(...)`：
**这条更新路径永远不会被触发**，且分类与同文件 `:1495-1498` 的
「只有构造选项 ⇒ 重建」自相矛盾。

## 14.【中】`<InfoWindow>` `enableCloseOnClick` 默认与官方相反

官方 `@default true`，`InfoWindow.vue:20-27` 给 `false`。可能是有意的产品决策，
但**文档从未说明**，用户无从得知自己偏离了官方。已在文档加 tip 标注
（不改运行时）。

## 15.【中】`<Marker>` `anchor` 不可达

`MarkerOptions.anchor`（官方默认 `BMAP_ANCHOR_CENTER`）有描述符条目却无 prop；
而官方同时把图标级 `IconOptions.anchor` 标为 `@deprecated 4.0 起请改用
MarkerOptions#anchor` —— 官方推荐的替代路径在本库**不可用**，用户被夹在
「用被弃用的路径」与「没有路径」之间。已在文档写明这一矛盾。

---

## 16. 官方 React 文档站的组件目录 vs 本库覆盖面

官方目录 `https://lbs.baidu.com/jsapi/react/docs/`（hash 路由，`#/component/<slug>`）列出
**48 个**组件/入口。本库导出 **55 个**——多出来的是 4.0.5 新增的 `PolygonLayer` /
`PolylineLayer` / `TextLayer` 与数据组件 `MarkerList` / `PointLayer` / `MarkerCluster` / `LineLayer` 等。

官方有、**本库没有**的 10 个，逐个核过上游 4.0.5 类型声明：

| 官方组件 | 上游 4.0.5 有声明？ | 本库为什么不提供 |
| --- | --- | --- |
| `GroundPoint`（地面点 3D） | ✅ `overlay/GroundPoint.d.ts` | **已实现**（issue #178）——`<GroundPoint>` 已进组件面 |
| `Symbol`（符号） | ✅ `overlay/Symbol.d.ts` | ⚠️ 原判「真缺口」有误：`class Symbol`（`Symbol.d.ts:13`）**不继承 `BMap.Overlay`**，是矢量图标**值对象**（官方注明可用作 Marker 的 icon 参数），没有 `addOverlay` 入口 ⇒ **做不成组件**；其 9 个成员在本库**尚无落地路径** |
| `IconSequence`（图标序列） | ✅ `overlay/IconSequence.d.ts` | ⚠️ 原判「真缺口」有误：类声明已标 `@deprecated 4.0 已废弃，请使用 PolylineOptions#strokeTexture 代替`，且**只有构造函数、无实例方法**。本库已在 `<Polyline :icons>` 上如实透传 |
| `Icon` | ✅ `overlay/Icon.d.ts` | 官方把它当**独立组件**列出；本库走 `Marker.icon` 传字符串或图标对象，功能等价，只是形态不同 |
| `PlaceDetail` | ✅ `service/PlaceDetailRenderOptions.d.ts` | 本库的 `PlaceDetail` 在**官方 UI Kit**（`bmap-vue/ui-kit`），不在组件面 |
| `SimpleInfoWindow` | ❌ 上游类型包无 | 官方 React 库自有封装，非 SDK 能力 |
| `RawOverlay` / `RawControl` | ❌ 上游类型包无 | 官方 React 库的「逃生舱」，本库用 `./advanced` 的 `unwrapRaw()` + `createHandle` 覆盖同类需求 |
| `ThreeLayer` | ❌ 上游类型包无 | three.js 宿主集成，且本库已有原生 `TextLayer` / `PolygonLayer` / `PolylineLayer` 覆盖多数场景 |
| `React-BMap` | — | 根包本身，不是组件 |

**结论（已按 issue #178 更正）**：原判「真缺口 3 个」**不成立**——判据只看了「上游有类声明」，
没看**它是不是 `Overlay` 子类**、**官方有没有标 `@deprecated`**。逐条复核后：`GroundPoint`
已实现；`Symbol` 是非覆盖物的值对象（做不成组件）；`IconSequence` 官方已废弃。真正待排期的
只有 `PlaceDetail`（要在组件面暴露需另开接口面）。其余 7 个是**形态差异**而非能力缺失
（组件 vs prop、官方 UI Kit、逃生舱、three.js 宿主集成）。

---

## 17.【严重】`<LocationControl>.onLocationStart` 声明了但从未接线

`LocationControl.vue:82` 声明了这个 prop，`:189` 的注释写着
「`onLocationStart` 走 `create` 覆盖（见下），它每次（重）创建时现读，因此闭包总是最新的」——
**但这个 `create` 钩子不存在**（全文 grep `create(` 零命中），而 `options()`
（`:190-201`）也没带上这个键。

于是它**类型检查通过、Vue 正常接收、然后被静默丢弃**。注释还反过来暗示它是刻意设计的
「闭包最新」行为——读代码的人会以为它能用。文档已改成「不要用它」，但这仍是**运行时缺陷**：
要么接上（需要 `create` 覆盖能力），要么把这个 prop 删掉。

## 18.【中】`<MapTypeControl>.mapTypes` 类型与官方相反

`MapTypeControl.vue:10` 声明 `mapTypes?: readonly number[]`，而上游
`const/MapType.d.ts` 是 `declare const BMAP_NORMAL_MAP: string` —— **官方是字符串**。
类型在这里主动误导使用者。文档已改成字符串并列出取值表，但**类型本身是错的**。

**已修（#175）**：prop 改成 `readonly string[]`。这一项**没有**运行时换算——4.0 的 `MapType`
本身就是这些字符串，数字不会对应到任何一张图（与第 10 条的 `type` 相反，见下）。

## 19.【中】控件页上的 React `children` 不是缺口

对照器把 `CustomControl.children` / `CopyrightControl.children` 报成真缺口。
实际上官方用 `children` 表达「挂任意 React 内容」，本库对应**默认插槽**。
已在对照器口径里归入「React 渲染面」一类（见 official-catalog-audit.md §2.1）。

---

## 20.【中】`<Marker>` / `<Label>` / `<Prism>` 三个 `enableXxx` 有描述符无 prop

`OVERLAY_DESCRIPTORS` 注册了它们，`*Props` 里却没有：

| 组件 | 键 | 上游有 | 实例上有 | 描述符有 | `*Props` 有 |
| --- | --- | --- | --- | --- | --- |
| `Marker` | `enableMassClear` | ✅ `MarkerOptions` | ✅ `enableMassClear()` / `disableMassClear()` | ✅ | ❌ |
| `Label` | `enableClicking` | ✅ `LabelOptions` | — | ✅ | ❌ |
| `Prism` | `enableClicking` | ✅ `PrismOptions` | — | ✅ | ❌ |

**用户可见后果**：`<Marker>` 永远参与 `map.clearOverlays()`，而所有兄弟覆盖物都能选择退出——
只有 Marker 不行。`enableClicking` 同理：官方的「标注是否响应点击」在本库覆盖物上开不了。

`tests/behavior/overlay-suite.test.ts` 的键交叉核对只覆盖「声明的键」，
所以抓不到「描述符有、组件面无」这个方向——和 Prism/GroundOverlay 已有的盲区同型。

修法机械：把键加进对应 `*Props` 即可，描述符与实例侧的方法都已经在。**未改，待授权。**

## 21.【中】`Marker3D` 的 `icon.printImageUrl` 是类型面上的死字段

声明在 `Marker3D.vue:18` 与 `types/components.ts:221`，但 Driver 每次都**丢弃并告警**
（`driver/jsapi-v4/overlays.ts:212-218`）——上游 `IconOptions`（4.0.5）只有
`anchor` / `imageOffset` / `imageSize` 三个键。文档原先把它当可用字段，已改。

## 22.【工具自身】对照器读的是**类**文件而不是 `*Options.d.ts`

`upstreamFile()` 原本拼出 `overlay/Marker.d.ts`（类本身），而构造项在
`overlay/MarkerOptions.d.ts`（17 个成员）。于是那 17 个一个都没被读到，全部落进
`docOnly`——对照结论直接反了：Marker 报「没有缺口」，而真实缺口是
`anchor` 与 `enableMassClear`。

修好后 `docOnly` 从 364 降到 224，真缺口从 67 变成 46（其中 18 是 React 渲染面、
4 是样式类 `style`、真缺口 24）。**报告误导人比没有报告更糟**——这条已写进
`official-catalog-audit.md` 的「比对器自身踩过的坑」。

同源的两个坑（修好后由三路交叉验证得出同一份结论）：
- `oursMembers` 只读 `types/components.ts`，漏掉内联声明在 `.vue` 里的
  `GeoJSONLayerProps` / `DistrictLayerProps` / `DOMLayerProps`（20 个假缺口）。
- `extends` 基础接口不都以 `Props` 结尾（`NativeLayerCommonProps` / `NativeLayerPickOptions`）。
