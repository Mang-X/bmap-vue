# #165 运行时审计（2026-09-27，三个模块从零重校对）

按维护者要求「重新分派代理去重新校对审查各个模块」执行。三个代理各自**重新克隆**参考库、
声明所用分支/标签、并遵守硬证据规则：**取不到（404 / 空 grep / 网络失败）只能记「无法验证」，
永远不能当「不存在」的证据**。以下结论中带 🔴 的**由我独立复跑探针确认**。

## 🔴 三个运行时损坏（本票引入或暴露，测试全绿却真实存在）

### 1. `<CityListControl>` 的命令面在运行时**整个不存在**

`scripts/probe-165c-surface.mts` 实测（真实 AK，headless Chrome）：

    cityListControl: { open/close/toggle/getTriggerDom/getCityName → proto:false, inst:false }
    CityListControl.prototype 的全部成员 = [ _className, constructor, initialize ]   ← 只有 3 个
    对比 OverviewMapControl.prototype = 8 个成员

`c.toggle()` → **`is not a function`**；`getCityName()` 走 `callRequired` → 抛
`BMAP_SDK_CALL_FAILED`。**上一轮把 `toggle`/`getCityName` 作为「缺口补齐」加上去的，
结果是加了两个必然失败的公开 API。**

### 2. `<CityListControl>.expand` 是静默空操作

被归类为 `mutable` → 映射到 `open`/`close`，而这两个成员**运行时不存在** ⇒
`callControl` 降级为「告警并忽略」。该 prop **完全无效**。
参考实现把 `expand` 归为 `ctorOnlyProps`。

### 3. `<CopyrightControl>` 卸载时抛错并泄漏

    addCopyright 成功之后重读：removeCopyright → { proto:false, inst:false }
    getCopyrightCollection 仍在（说明 add 成功）

`removeCopyright` **运行时不存在**（官方声明里有），而我们的 `unmount()` 用
`callRequired` 调它 ⇒ **在 Vue 卸载期间抛错**，`removeCopyrightControlIfEmpty`
永不执行 ⇒ 共享控件**永远不从地图上摘除**、位置缓存条目永不淘汰。

### 4. 根因：Fake SDK 在这三个成员上是真实 SDK 的**严格超集**

`FakeV4CityListControl` 实现了 `open/close/toggle/getCityName`；
`FakeV4CopyrightControl` 实现了 `removeCopyright`。真实运行时**都没有**。
**这正是 372 条模块测试全绿的原因**——Fake 比真的多。这不是三个补丁，是一条通用规则。

## ⚠️ 官方 4.0.5 声明里有、运行时没有的成员

- `Marker#setAnchor` / `getAnchor`：声明存在，**实例上不存在** ⇒ 官方声明本身是死的。
  我们按 `recreate` 处理**结论偶然正确但理由错误**（注释说是「异步标注模块」，实际是成员不存在）。
- `CustomOverlay` 的 `setZIndex` / `setMinZoom` / `setMaxZoom` / `setOptions`：声明有、运行时无。

## ✅ 经复核**成立**的既有结论（此前被怀疑过的）

- `<Panorama>` 事件 23 个官方键全部有归属；16 组 snake_case 别名；参考实现的 11 个 camelCase
  `on*` 与我们的命名**逐个对应**。
- `Panorama` 实例 24 个声明成员**全部在**；`capture()` 真实返回 data URL。
- `Marker3D` / `MapMask` 真实可构造、参考实现两者都包。
- `ScaleControl` 那条「官方 `ScaleControlOptions` 里没有 `unit`」**完全正确**（`setUnit`/`getUnit` 在类上不在选项里）。
- `hitTest`（Polygon/PolyLine 声明有运行时无）与 `setOpacity`（运行时有没有声明）**两条都成立**，
  且新读数揭示：这两个类上 **`onProto` 对所有成员都是 false**，原型读法**零鉴别力**——
  这正是当初必须重做而不能继承的原因。
- `BarLayer` / `FlyLineLayer` / `GeoJSONSource` 运行时缺席（三个时机 + 294 属性全扫）。
- `WebGCLustomLayer` **存在**；`ThreejsLayer` / `DeckglLayer` 不存在。
- 四个弃用类的提示语**都不是**陈旧的——它们已经写着「替代品已提供」。
- `./ui-kit` 隔离经三条路径独立复核。
- 四个 UI Kit wrapper 零杜撰选项/事件；`RoutePlanDrivingPolicy` 11 成员逐个同名同值同序。

## 本轮新发现（非运行时）

- `<PointLayer>` 丢了官方声明的 `isFlat` 构造选项，而**它的两个兄弟组件都投影了它**
  （`PointCollection.vue:162`、`PointIconLayer.vue:134`）——family 内部不一致，文件里没解释。
- `GeoJSONLayer` 的 `setLevel` 官方声明里有、descriptor 里**没有条目**（无文档说明为何不做）。
- `Marker` 缺 4 个官方选项：`anchor` / `enableMassClear` / `autoFollowHeadingChanged` / `startAnimation`。
- `Polyline#getPointAt` / `getLength` 运行时**存在**但官方没声明，我们也没暴露。
- `FeatureLayer` 参考实现有、SDK 声明无、运行时 `NormalLayer` 在——三方不一致，处置待定。
- `preserveDrawingBuffer` 再次实测：**不带 4,918 字节（空画布）、带 171,042 字节（真实内容）**
  （与先前 3,830 / 119,074 方向一致、绝对值随环境变化——已加脚注提醒复现者）。
- `resetHeading` 是**实例成员**（`proto=false, own=true`）——任何未来实现都必须读实例，
  这正是 `Panorama` 探针踩过的坑。

## 复现

    git clone https://github.com/huiyan-fe/react-bmap.git   # master fde5bbd
    git clone https://github.com/huiyan-fe/vue-bmap.git      # master ffc6dad
    BAIDU_MAP_AK=<ak> node --experimental-strip-types scripts/probe-165c-surface.mts
