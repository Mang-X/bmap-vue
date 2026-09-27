# #165 运行时取证（2026-09-26，live AK）

几处**光靠类型声明定不了**的结论，本轮用真实 SDK 取证。探针：
`scripts/probe-runtime-members.mts`（`BAIDU_MAP_AK=<ak> node --experimental-strip-types scripts/probe-runtime-members.mts`）。

读数来源：真实 `https://api.map.baidu.com/api?v=4.0`（HTTP 200，SDK `version: "gl"`）。
**该 AK 来自 `docs/.vitepress/theme/index.ts:38`**（文档站本来就需要它），
未写入任何新文件，符合 `performance-baseline.md:91` 的「AK 不进仓库新文件」策略。

## 结论一：`hybrid` 的候选名**证伪** ⇒ Class 1 的显式失败是正确结果

`BMap.MapTypeId` 运行时**只有三个**成员，且值与 4.0.5 声明的 `BMAP_*` 名字**完全不同**：

```
{ NORMAL: "B_NORMAL_MAP", EARTH: "B_EARTH_MAP", SATELLITE: "B_STREAT_MAP" }
```

- **没有 `HYBRID`** ⇒ Class 1 登记的 `hybrid: ["HYBRID", "BMAP_HYBRID_MAP"]` 两个候选都取不到，
  `resolveMapTypeConstant` 会抛 `BMAP_SDK_CALL_FAILED`。
- 官方 `MapTypeId` 声明的 `BMAP_HYBRID_MAP` / `BMAP_NONE_MAP` 在**运行时不存在** ⇒
  `BMAP_NONE_MAP` 的显式抛错也是对的。
- **这正是「显式失败」优于「静默降级」的价值**：旧实现会静默把混合图画成普通图（用户看不出错），
  现在直接抛错并说明原因。**候选名需按实测改写**（`SATELLITE` 实际值是 `B_STREET_MAP`，
  这类「声明名 ≠ 运行时常量名」的映射是 `MAP_TYPE_CONSTANT_CANDIDATES` 存在的原因，
  但 `hybrid` 的两个候选都猜错了）。

## 结论二：`Marker#setAnchor` 构造后**确实调不了** ⇒ 仓库的 `recreate` 判断**有据**

`setAnchor` 在 4.0.5 声明里有（`onProto` 读的是 `B.Marker.prototype`，
而真实 4.0 里**根本不在原型上**）；直接调用抛 `B.ControlAnchor is not a constructor`
（`ControlAnchor` 本身没构造出来）。

⇒ 仓库把 `Marker.anchor` 按 `recreate` 处理是**正确的**，不是保守。
但代理指出的那点成立：注释写「官方说明」措辞不准——依据是**运行时观察**，
不是类型声明。**建议把注释改成引用实测来源**（本文件 + 探针），
否则后来者读声明会以为 `setAnchor` 可用、从而误改回 `mutateBy`。

## 结论三：`visualization/` 四类的显示成员**运行时确实在位**（声明与运行时一致）

`PointLayer` / `ClusterLayer` / `Heatmap` / `TrackLine` 四个构造器都存在，且 Class 3 登记的
`setVisible` / `setOpacity` / `setZIndex` / `setRenderStage` / `setRefCenter` /
`setSpeed` / `setProcess` / 播放命令**全部为真**。Class 3 的登记有实测支撑。

**同时实测确认了「声明 ≠ 方法名」**：`setStyle` 在**四个类上运行时全部不存在**
（`PointLayer`/`ClusterLayer`/`Heatmap`/`TrackLine` 缺 `setStyle`），
而 4.0.5 声明的是 `setOptions` ⇒ Class 1/3 把 `styleMember` 逐 kind 分开、
不硬编码 `setStyleOptions` 的判断**是对的**（`layer/` 家族才有 `setStyleOptions`）。
`Heatmap` 的 `setGradient` / `setRadius` 实测**不在运行时** ⇒ 代理把它们留在
`supports()` 外面是对的（声明有、运行时没有，放开就是假支持）。

## 结论四：#167 里几个「MapDriver 没实现」的能力，**运行时是有的**

| 官方成员 | 4.0.5 声明 | 运行时 | 含义 |
| --- | --- | --- | --- |
| `Map#getScreenshot` | 有 | **有** | Class 5 把 `map.screenshot` 目录条目**整条删了**；实测运行时存在，**删除可能过头**，应回填实现而不是删条目 |
| `Map#flyTo` | 有 | **有** | 同上，`map.fly-to` 被删同理 |
| `Map#getViewport` | 有 | **有** | `map.viewport` 被收窄成只有 `setViewport`；实测 `getViewport` 在位，应回填 |
| `Map#restrictBounds` | 有 | **有** | #170 删掉假 prop `restrictCenter` 后，官方对应能力**确实可补**（但无撤销入口，文档须写明） |
| `Map#zoomIn` / `#zoomOut` / `#centerAndZoom` | 有 | **有** | #167 已登记为缺口，实测确认它们可用 |
| `BMap.Projection` | 只被引用未声明 | **运行时是 function** | 本地 augmentation 补的 `Projection` 有运行时对应物；`MapTypeOptions` 运行时 **undefined** |
| `Panorama#getLinks` / `#capture` / `#clearOverlays` | 声明有 | 探针读 `B.Panorama.prototype` 全为 **false** | ⚠️ **不能据此断定运行时没有**——`Panorama` 的成员挂在**实例**（需先有 viewer），原型读法对它无效。Class 3 的 `getLinks` 走 `callOptional` + 空数组兜底，探针无法证伪；**留待能创建 viewer 的探针再验** |

## 这些读数如何改变后续动作

1. **Class 1 的 `hybrid` 候选名要按实测改写**（`MapTypeId` 运行时只有 NORMAL/EARTH/SATELLITE
   三个真实值，且字面量与声明名不同）。
2. **`Marker.anchor` 的 `recreate` 注释改引本文件**，不要引「官方说明」。
3. **Class 5 删掉的三个目录条目要回填实现**（`map.screenshot` / `map.fly-to` / `map.viewport`）——
   实测运行时都有，删条目比补实现更糟（#165 §3.3「不得无理由裁剪能力」）。
   ⇒ #170 里 D 项需要改：不是「删条目」，是「补实现」或「条目如实标 unsupported」。
4. **`MapTypeOptions` 的本地 augmentation 仍需保留**（运行时 `undefined`，声明引用它 ⇒
   `skipLibCheck:false` 下会失败）；`Projection` 两者都有，可考虑并入。

## 结论五：`preserveDrawingBuffer` **确实被官方运行时承认**（截图黑屏的根因坐实）

`MapOptions` 声明里**没有** `preserveDrawingBuffer`（只出现在 `getScreenshot` 的散文注释里），
所以此前不敢把它做成类型面。**live 实测给出了明确答案**——同一张图、同一时刻，两种建图选项：

| 建图选项 | `getScreenshot()` 返回 | 判定 |
| --- | --- | --- |
| 不带 | `data:image/png;base64,…`，长度 **3,830** | **空画布**（就是「黑屏」） |
| `{ preserveDrawingBuffer: true }` | 同前缀，长度 **119,074** | **真实内容**（约 31 倍） |

⇒ ① 该键**被官方运行时承认**（不是声明笔误，也不是"上游根本没这个"）；
② 「不带就黑屏」的说法**实测成立**；③ 它是**建图期**选项，事后无法补上。

**由此确定处置**（维护者裁决「按照封装的惯例，参照官方行为」）：
本库给 `<Map>` 一个**显式 opt-in 的 prop**（默认**不开启**——默认开启会让每张地图
常驻一块额外画布内存，这是库不该替用户做的取舍），并在 `getScreenshot()` 的文档上
写明「不带这个 prop 就会拿到空画布」。

⚠️ **口径更正**：「能力进目录 + 显式 opt-in」这个惯例是**本库自己**定的，**不是**官方 React
参考的惯例——`huiyan-fe/react-bmap` 全仓库（含 `src/`、tests、examples、README）
**没有出现过** `preserveDrawingBuffer` 这个键：它既没有该 prop，也没有把它列为能力目录条目
（其 `capabilityMatrix.ts` 只把 `Map.getScreenshot` 列为能力，`v4Driver.ts:718` 直接调
`getScreenshot?.()`）。因此不能把默认关闭说成「沿用官方惯例」；它依据的是**本库的取舍**
（常驻画布内存的成本应由使用方决定）**加上上面那张实测读数**。

## 结论六：Vue 的 `Boolean` 缺省陷阱在 `preserveDrawingBuffer` 上**又中了一次**

给它加 prop 时先写了 `...(props.preserveDrawingBuffer !== undefined ? {...} : {})`，
以为「不传就不表态」。测试直接把这个假设打掉——实况是建图选项里**带着
`preserveDrawingBuffer: false`**：Vue 对**缺省 `Boolean` prop 会转成 `false`**，
所以 `!== undefined` 永远成立，条件展开等于没写。

修法是仓库既有的那一条（`LineLayer.popEvent` / `FillLayer.border` /
`PointIconLayer.userSizes` 都用它）：在 `withDefaults` 里**显式写 `undefined`**。

⚠️ 这是本票**第三次**踩同一个坑（前两次：Class 3 补 `popEvent`/`userSizes`/`visibility`/
`mouseStyleChange`，Class 1 补 `showSuggestion`）。四次的共同形状都是
「官方默认 `true`，而 Vue 缺省给 `false`」——**只要新加的 prop 官方默认是 `true`，
就必须显式 `undefined`，否则每个不传它的用户都静默偏离官方**。
这条值得进仓库的贡献指南，而不是散落在各组件注释里。

## Class 2 的追加读数（2026-09-27）

`scripts/probe-runtime-members.mts` 扩了 7–13 号（Map 命令面 / 全景实例）。逐条裁决见
`165-audit-B-C-D-F.md` 的「Class 2 逐条裁决」。这里只记**读数本身**，含两个反直觉的。

### 7 `setCenter('北京')` 字符串中心（裁决 E）

起点**故意选上海**——第一轮用北京当地做起点，「没动」与「字符串被忽略」读数完全一样（混淆读数）。

| 输入 | 抛错 | 读回 | 真的动了吗 |
| --- | --- | --- | --- |
| `'北京'` | 否 | `116.413, 39.911` | 否（仍在上海） |
| `'NotACityName-zzz'` | 否 | `116.413, 39.911` | **是** |

⚠️ **反直觉**：官方对**无法识别**的地名**不报错**，也真的移动了；而对一个**能识别**的名字
在这一轮里没动。⇒ 结论只取声明 + Driver 既有收窄那一侧（两条独立证据同向），
**不**把上面这张表当成「字符串中心不可用」的证据——它测的是同一个已失败的往返（重试时
SDK 已把中心钉住），不构成反证。

### 8 / 13 `options.callback` 交付（裁决 F）

`noAnimation: true`（官方承诺「立即调用」）下五条**各交付恰好一次**，0–1ms：
`setCenter` 0ms · `setZoom` 1ms · `setHeading` 0ms · `setTilt` 0ms · `panTo` 0ms。

不传 `noAnimation`（走动画档）等 3s 仍**各交付恰好一次**：`setCenter` 4ms ·
`panTo` 32ms · `setZoom` 526ms。⇒ 「传下去就真的会来」有 live 取证，缺口是**类型面**而非运行时。

### 9 `panTo` 的动画默认（裁决 G）

`requestAnimationFrame` 逐帧采 1.5s：`distinctSampleCount = 1`、`midFlightSamples = 0`。
即无头 SwiftShader 下**直接跳变到位**（官方声明默认 `noAnimation: false` 即有动画）。
本库不传 options 即沿用上游默认，**没有**额外的 prop/命令不一致要修。

### 10 `setMapStyle` 的形状与互斥（裁决 H）

| 输入 | 抛错 | `getMapStyleId()` |
| --- | --- | --- |
| `{styleJson: [ … ]}`（官方数组） | 否 | `custom93` |
| `{styleJson: { … }}`（单数对象） | 否 | `custom95` |
| `{styleId: 'a1', styleJson: []}` | 否 | `custom97` |
| `{styleJson: [], styleId: 'a1'}` | 否 | `custom99` |

⚠️ 两种顺序的胜者都**不受调用方控制**（SDK 内部合并顺序）⇒ 不能在组件层猜赢家，只能显式失败。
`merge` 无从判断：官方未声明「与什么合并」的默认基线。

### 11 `Panorama` 的实例成员（裁决 I）—— 推翻上一轮「无法证伪」

判据换成**实例读法**（`own` / `onProto` / `callable`）：

| 成员 | own | onProto | callable |
| --- | --- | --- | --- |
| `capture` | false | false | **true** |
| `clearOverlays` | false | false | **true** |
| `getLinks` | false | false | **true** |
| `getId` / `getSceneType` | false | false | **true** |
| `getPov` / `getPosition` / `getVisible` / `setId` | **true** | false | true |

且 `capture()` 真返回 **1,639 字节**字符串、`clearOverlays()` 不抛。

⇒ 上一轮「`B.Panorama.prototype` 全 false」是**原型读法对这类成员无效**，不是「成员不存在」。
`setTheme` 的 `callable: false`（`Panorama` 上确实没有）。

## 结论七：`panTo` 的 `noAnimation` 默认值，**声明与运行时不一致**（再次实测复现）

官方 `core/Map.d.ts` 的 `panTo(options)` 对 `noAnimation` 标 **`@default false`**（按字面即
「默认**带**动画」），而本轮 rAF 逐帧采样 1.5s 的读数是：

    { distinctSampleCount: 1, midFlightSamples: 0, animatedByDefault: false, finalIsTarget: true }

即**直接跳到目标、中间没有中间帧**。两次独立实测一致。

这不是本库的 bug——我们**不传任何 options**，因此继承的是上游实际行为。
因此**不改默认值**（没有可改的：默认在我们的控制之外），但：

- 官方声明与实际行为**不一致**这件事必须留在类型注释 / 命令面注释 / 文档 / changeset 里，
  否则使用者会以为「不传 options 就有动画」而看不到中间过程；
- 想拿到确定时长的调用方可以显式传 `duration`（`panTo` 的官方 options 里确有该成员）。

⚠️ 同类提醒：`animatedByDefault: false` 说的是**本环境读数**，不同渲染模式/性能下
可能不同；因此文档里按「实测」而非「官方保证」措辞。

## ~~更正三~~（已再次撤回，见下）：`Panorama` 事件名的「改名」结论

> ⚠️ **本节原结论（「官方事件名是 snake_case ⇒ 应按官方 snake_case 对齐（改名）」）已撤回。**
> 撤回理由见紧随其后的「更正三·重定」。保留标题与痕迹，是为了让下一次审计知道这条结论
> **曾经存在过、并且被证据推翻过**，不要按字面把它捡回来。

## 更正三·重定：`Panorama` 事件名的正确处置是 **camelCase + snake_case 别名**，不是改名

被撤回的那条结论推理时**只看了两个来源中的一个**，把「JSAPI 声明」当成了「官方封装」。实际有**两个**
来源，二者命名不同，必须分别代表：

| 来源 | 命名 | 证据 |
| --- | --- | --- |
| JSAPI **声明**（`panorama/PanoramaEvent.d.ts` 的 `PanoramaEventMap` 键，23 条） | **snake_case** | `position_changed` / `links_changed` / `links_visible_changed` / `pov_changed_end` / `scene_change_end` / `scene_type_changed` / `size_changed` / `visible_poi_type_changed` / `overlay_add` / `overlay_remove` / `overlays_clear` / `link_click` / `clickonroad` / `id_changed` / `zoom_changed` / `pov_changed` / `dataload` / `pano_error` / `destroy` / `touchstart` / `touchend` / `click` / `dblclick` |
| 官方 **React 参考实现**（`@baidumap/react-bmap@2.0.6`，`master` 分支，`src/components/Panorama/index.tsx`）的**公共事件面** | **camelCase `on*` props** | `onClick` / `onDblClick` / `onLinkClick` / `onLinksChange` / `onIdChange` / `onSceneTypeChange` / `onPositionChange` / `onPovChange` / `onZoomChange` / `onError` / `onDataLoad`（`index.tsx:46-66` 声明，`:86-117` 绑定；文件头 `:7` 的清单同此） |

**#165 的对齐规则是「同一能力优先同名，参照官方封装」。** 本条讲的是**事件面**，而参考实现的
公共面是 camelCase —— 因此把本库改成 snake_case 是**朝参考封装的反方向走**，恰好违反规则本身。
上一节的推理把规则里的「同名」当成了「与 JSAPI 声明同名」，这一步没有依据。

**正确处置（不是改名）**：camelCase 保持为**对外事件名**，把 SDK 的 snake_case 键加成
**一一对应的别名**同时发出——这正是本库对 map 事件已有的机制：`core/events/eventCatalog.ts`
的 `MAP_EVENT_EMIT_ALIASES`（规范名与 SDK 拼写**并存**，`<Map>` 的 `forwardMapEvent()`
先发规范名再发别名，组件里没有第二份兼容代码；见该文件文件头「SDK → Vue 的名字映射」）。
Panorama 事件按同一形状复用该机制即可。

⚠️ 两条不要混淆的**不同事件**：

- 参考实现的 `onLinksChange()` **不带任何值**，它对应 SDK 的 `links_changed`；
- `links_visible_changed` 是**另一条**事件，载荷 `{ value: boolean }` 自带值。
  本库**尚未**实现它（按上表规则应对外叫 `linksVisibleChanged`），正在补——补的时候
  **不要**把它当成 `linksChange` 的别名。

把两者当成一条，就会得出「`linksChange` 已经覆盖了道路链接显隐」的错误结论。见下节「更正四」。

## 更正四：`links_visible_changed` 的载荷是**自足**的，未加的理由不成立

官方声明：`links_visible_changed: { value: boolean }`（注释「道路链接显隐状态变化后触发」）。
它**自带 `value`**，不需要任何 getter 读回。先前「官方控件内部状态无读回路径」那条理由
只适用于 `getVisible` 那一类 **getter**，不适用于这个**事件**。

⇒ 应加：与已实现的 `getLinks()` / `linksChange` 同族，缺它是真实的不一致。

<<<<<<< ours
## 更正五：`huiyan-fe/vue-bmap` 的 `src/` 下**没有 `Panorama` 组件**（`react-bmap` **有**）

原判断的两条依据都不成立，逐条更正（2026-09-27 复核，两个仓库均**重新 clone**）：

1. **文档 URL 的 404 什么都不能证明。** 上一轮据此写「该锚点不存在」是错的——
   `mapopen.bj.bcebos.com` 是 **BOS 静态托管**，只有精确到文件名才命中：
   `.../vue-bmap/docs/` → 404（117 字节 `NoSuchKey` JSON），但
   `.../vue-bmap/docs/index.html` → **200**。而 `#/component/panorama` 是 **hash 路由**，
   fragment 根本不会发给服务器，**任何** hash 路径都会返回同一个 `index.html`。
   ⇒ 用纯 fetch 判「页面不存在」在此**结构上不可能**，必须渲染 SPA 或读源码。
2. **`react-bmap` 的 `src/components/Panorama/` 是存在的**（`index.tsx` + `PanoramaRef.ts`），
   上一轮说的「`react-bmap` 也不提供 `Panorama` 组件面」是错的。
   它的 `<Panorama>` 声明 11 个事件 prop（`onPositionChange` / `onPovChange` / `onLinksChange` /
   `onZoomChange` / `onClick` / `onDblClick` / `onLinkClick` / `onIdChange` / `onSceneTypeChange` /
   `onError` / `onDataLoad`）与 21 个 `PanoramaRef` 成员，是本票最好的对照物。

仍然成立的那一半（`vue-bmap` 侧，且这次是**读源码**、不是读 URL）：

- 仓库 `@baidumap/vue-bmap@1.0.1`（重新 clone，HEAD `ffc6dad`）的 `src/components/` 确实只有
  `Control` / `Layer` / `Map` / `Overlay` **四个目录**，四个目录里都没有全景组件文件；
  `src/index.ts` 也**不导出**任何 `Panorama` 组件。
- ⚠️ 但**不能**据此说「vue-bmap 没有全景能力」：它的 `examples/src/config/components.ts:88`
  有一条 `{ id: 'panorama', name: 'Panorama', category: 'Other', todo: true }`，
  `examples/src/config/apiData.ts:879-911` 还有**完整的 20 条 props + 11 条事件表**，
  `src/drivers/v4Driver.ts:1420-1433` 也有 `createPanorama` / `createPanoramaLabel` 的完整实现。
  即**组件层没导出、但 API 契约与 driver 面已就绪**（`todo: true` = 示例页显示「示例编写中」）。

⇒ 更正后的口径：全景组件的官方参照是 **`react-bmap`（`master` 与 `v2.0.6` 都有）**
+ JSAPI 声明本身；`vue-bmap` 只是**尚未实现**（有 API 表、无组件导出），不是「不提供」。
两边的对照价值都在，但**参照对象是 `react-bmap`**，不是 `vue-bmap`。
>>>>>>> theirs

## 未覆盖

- `MenuItem` / `ContextMenu` 的实例行为。
- 交互手势（`enableRotate` 等）在真实浏览器里的实际效果（需可见窗口）。
- `noAnimation: true` 与动画档**都开**的对照（当前只测了「有 options」与「无 options」两档）。

