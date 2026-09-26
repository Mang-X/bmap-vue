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
官方 React 参考的惯例是 **能力进目录 + 显式 opt-in**，不是替使用者做默认值取舍
（见其 `capabilityMatrix.ts` 把 `Map.getScreenshot` 列为能力、`v4Driver.ts` 直接调）。
本库照此：给 `<Map>` 一个**显式 opt-in 的 prop**（默认**不开启**——默认开启会让每张地图
常驻一块额外画布内存，这是库不该替用户做的取舍），并在 `getScreenshot()` 的文档上
写明「不带这个 prop 就会拿到空画布」。

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

## 未覆盖

- `Panorama` 实例成员（需创建 viewer）——本次探针只读原型，对它无效。
- `MenuItem` / `ContextMenu` 的实例行为。
- 交互手势（`enableRotate` 等）在真实浏览器里的实际效果（需可见窗口）。
