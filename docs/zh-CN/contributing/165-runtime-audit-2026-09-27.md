# #165 运行时审计（2026-09-27，三个模块从零重校对）

> ⚠️ **本文的三个 🔴 结论已被后续一轮实测推翻**（同日）。根因是**采样时机**：
> 官方控件的命令面是**分阶段**挂载的——`BMap.Map` 与各控件构造器先到，完整成员面约
> **2.4 秒后**才补到原型上（实测时间轴见下）。本文按当时读到的「不在」下结论，
> **读到的其实是「还没到」**。修正与真实的缺陷见文末「更正」一节。

> **教训（已落到 `packages/test-utils/fake-bmap-v4/runtime-member-shape.ts`）**：
> 对「成员是否存在」下结论前，**必须等成员面补齐**；Fake 原本只能表达
> 「永远有 / 永远没有」，这个窗口**结构上无法测试**，于是缺陷通过了全绿的测试。

按维护者要求「重新分派代理去重新校对审查各个模块」执行。三个代理各自**重新克隆**参考库、
声明所用分支/标签、并遵守硬证据规则：**取不到（404 / 空 grep / 网络失败）只能记「无法验证」，
永远不能当「不存在」的证据**。以下结论中带 🔴 的**由我独立复跑探针确认**。

## 🔴 三个运行时损坏（本票引入或暴露，测试全绿却真实存在）

> ## ⚠️ 2026-09-27 复核更正：本节 1 / 2 / 3 三条的**结论已被推翻**
>
> 三条读数**都取自同一个 bug：取样时机**。官方 4.0.5 的**控件成员面是分阶段就位的**——
> `BMap.Map` 与全部控件构造器先到位，控件的完整成员面**晚约 150ms 挂上原型**。
> 原审计在补齐之前取样，于是把「**还没到**」读成了「**永远没有**」。
>
> 复核工具：`scripts/probe-165c-surface.mts`（本节所有读数均由它产出，可重跑）。
>
> | 原结论 | 复核（稳定态，成员补齐之后） | 判定 |
> | --- | --- | --- |
> | 1. `CityListControl` 命令面**整个不存在** | `prototype` **26** 个成员；`toggle` / `getCityName` / `open` / `close` / `getTriggerDom` **全部 `inst: true` 且真调得动**（`getCityName()` → `"中国"`） | ❌ **推翻** |
> | 2. `expand` 因 `open`/`close` 不存在而**静默空操作** | 前提（成员不存在）不成立 ⇒ 推论一并失效；但「`open()` 是否真能展开面板」**本轮无法判定**，见下 | ⚠️ **前提推翻，结论待定** |
> | 3. `removeCopyright` **不存在** ⇒ 卸载抛错并泄漏 | 稳定态 `removeCopyright` **在位且调得动**（`add → remove → getCopyrightCollection` 归零）。**但**窗口内确实会抛——见「真实缺陷」一节 | ❌ **前提推翻，症状在窄窗口内为真** |
> | 4. Fake 是真实 SDK 的**严格超集** | Fake 的这四个成员与稳定态运行时**一致**，不是超集。真正的 Fake 缺陷是别的形状：见下 | ❌ **推翻** |
>
> ⚠️ **硬证据规则的自我适用**：原审计自己写了「取不到只能记『无法验证』，永远不能当『不存在』的证据」。
> 这三条恰好违反了自己立的规则——「读到了 `false`」不等于「不存在」。保留本节原文是为了让
> 这次错误可追溯，**不要**把它当结论引用。

### 1. ~~`<CityListControl>` 的命令面在运行时**整个不存在**~~ → 已推翻

<details><summary>原读数（取样于补齐之前）</summary>

    cityListControl: { open/close/toggle/getTriggerDom/getCityName → proto:false, inst:false }
    CityListControl.prototype 的全部成员 = [ _className, constructor, initialize ]   ← 只有 3 个
    对比 OverviewMapControl.prototype = 8 个成员

</details>

**复核**：`prototype` 实为 **26** 个成员，命令面**全部在位且调得动**。因此
`CityListCommandApi` 的 `toggle()` / `getCityName()` **不是**「必然失败的公开 API」，
**不得删除**（`toggle` 原型在位；`getCityName()` 实调返回 `"中国"`）。

⚠️ 真正的残留问题是：这两个成员属于**后补批次**，落在下面那个 ~150ms 窗口里
（此时 `toggle()` 会得到 `BMAP_SDK_CALL_FAILED`）。**组件就绪不蕴含成员面已就绪**。

### 2. ~~`<CityListControl>.expand` 是静默空操作~~ → 前提推翻，结论待定

被归类为 `mutable` → 映射到 `open`/`close`；原结论说这两个成员不存在 ⇒ 降级为「告警并忽略」。
成员既然存在，这个推论链**断了**。

**但「`open()` / `close()` 是否真的能展开/收起面板」本轮无法判定**：headless 环境下
`CityListControl` **始终不渲染面板 DOM**（`getTriggerDom()` 恒 `undefined`，构造期
`expand: true` 也不出面板，body 的 HTML 指纹在 `open`/`toggle`/`close` 前后完全一致）。
**面板压根不存在 ⇒ 「DOM 无变化」不是「调用是空操作」的证据。** 按硬证据规则记「无法验证」。

处置：`choice` 分类**暂按官方声明保留**（不改成 `recreate`）。参考实现把它归为
`ctorOnlyProps`，但本仓库 ADR `2026-09-18` 明确把参考实现那两张手抄数组列为
**不该照抄**的东西，且本轮读数既不支持也不否证——没有依据改分类。
**证伪或证实之前不要动它。**

### 3. ~~`<CopyrightControl>` 卸载时抛错并泄漏~~ → 前提推翻，窄窗口内为真（已修）

`removeCopyright` 在稳定态**存在且调得动**。但复核取到一条**更真实**的缺陷：
`removeCopyright` 属于**后补批次**，而 `addCopyright` / `getCopyright` /
`getCopyrightCollection` 属于**先到**批次。⇒ 窗口内**挂载成功、卸载抛错**，
且 `removeCopyrightControlIfEmpty` 排在抛错之后 ⇒ 共享控件不摘、缓存不淘汰。
**症状与原结论完全一致，成因不同。** 处置见下一节。

### 4. ~~Fake SDK 是真实 SDK 的严格超集~~ → 推翻（但根因方向是对的）

`FakeV4CityListControl` / `FakeV4CopyrightControl` 实现的四个成员，在**稳定态**与真实运行时
**一致**——Fake 没有撒谎，也没有多实现。372 条测试全绿是因为它们**本来就该绿**。

Fake 的真实缺陷是**另一个形状**，且已修：它**无法表达那 ~150ms 的窗口**。
成员要么永远在、要么永远不在，于是「窗口内卸载会失败」这条**根本进不去测试**。
新增 `packages/test-utils/fake-bmap-v4/runtime-member-shape.ts`：
`installDeferredRuntimeMembers()` 卸下后补批次、`resetRuntimeMemberShape()` 装回，
让窗口成为一条**可执行**的用例（`tests/behavior/control-runtime-member-window.test.ts`，
9 条）。

## 🔴 真实缺陷（本轮复核取到并已修）

### 官方 loader 的就绪信号**早于**控件成员面补齐约 150ms

live 读数（4 次独立复跑，窗口 126–167ms）：

| 观察点 | `CityListControl.prototype` | `CopyrightControl.prototype` |
| --- | --- | --- |
| 官方 `__bmapJSApiOnLoad_N` callback 触发（= `@baidumap/jsapi-loader@1.0.0` 判「已加载」的那一下） | **3**（无 `toggle` / `getCityName`） | **8**（无 `removeCopyright`） |
| `new BMap.Map()` 之后 | 3 | 8 |
| 再让出一个宏任务 | 3 | 8 |
| +~150ms | **26**（命令面全在，调得动） | **16**（`removeCopyright` 在，调得动） |

两条对处置有决定影响的读数：

1. **补齐不是被建图触发的**（不建图纯等也会补齐）⇒ 本库「loader 判就绪 → 建图 → 建控件」
   这条正常路径**恰好落进窗口**，窗口是**可达**的。
2. **补齐是追溯的**（被补的是**原型**，已存在的实例自动获得成员）⇒ live 实测
   「窗口里 add 的那条版权项，窗口之后能 remove 掉」。

窗口内实测（`probe-165c-surface.mts` §②）：

    addCopyright  = function   → 调用成功，getCopyrightCollection() = array(1)
    removeCopyright = undefined → 调用抛 "cc.removeCopyright is not a function"
    cl.toggle() / cl.getCityName() → 同样 "is not a function"

⇒ **第一个失败的是卸载，不是挂载**（原审计以为 `addCopyright` 也不可靠，方向反了）。

### 修法：延后摘除，不是「跳过」

`CopyrightControl.vue` 的 `deferCopyrightRemoval()` + `ControlDriver.canRemoveCopyright()`。

三条候选与各自代价：

| 处置 | 后果 |
| --- | --- |
| 静默跳过（`callControl` 的 warn-and-ignore） | 版权项**永久**留在 SDK 上——它已经 add 成功了，没人再摘 |
| 只做「摘控件 / 出缓存」 | 同上的尾巴，且没有补做 |
| **延后到成员补齐之后再摘**（采用） | SDK 上多留 ≤ 一个窗口（~150ms），之后被真的摘掉；期间组件已卸载、控件已摘下，用户不可见 |

选第三条的依据是读数 2（补齐是追溯的）——延后**确定**会生效，不是「赌一次重试」。
另有一处**顺序修正**：`removeCopyrightControlIfEmpty` 判定空时**必须排除本组件自己那条**
（它此刻还在 SDK 上），否则「稍后会被摘掉的一条」会把共享控件永久留在图上——
那恰好是原审计描述的泄漏形状。判据因此回到「**还有没有别人的版权项**」。


## ⚠️ 官方 4.0.5 声明里有、运行时没有的成员

- ~~`Marker#setAnchor` / `getAnchor`：声明存在，**实例上不存在** ⇒ 官方声明本身是死的。~~
  ❌ **已推翻**（同节 1 的取样错位）。复核：`setAnchor` / `getAnchor` **在** `Marker` 实例上
  （`inst: true`），`getAnchor()` 读回 `Point`，构造后真调一次**不抛**。
  `Marker.anchor` 按 `recreate` 处理**仍然正确**，但**理由要换**：真正的理由不是
  「等异步标注模块加载才挂 setter」（那句是错的），而是 `getAnchor()` 返回**当前值**
  （未设时 `null` = SDK 内置默认锚点，那个值无从构造出来再传回去）⇒
  「值变回 `undefined`」没有落点，与 `rotation` / `icon` / `title` / `offset` 那一族同源。
  已在 `driver/types/overlays.ts` 的 `anchor` 条目更正。
- `CustomOverlay` 的 `setZIndex` / `setMinZoom` / `setMaxZoom` / `setOptions`：
  ❌ **原表述「声明有、运行时无」错了一半**——官方 `CustomOverlay.d.ts` **也没有**声明这四个
  （`Overlay` 基类只有 `initialize` / `isVisible` / `draw` / `show` / `hide` / `getMap` / `dispose`）。
  复核（`probe-165c-surface.mts` §④）：这四个 `proto:false, inst:false`
  （`CustomOverlay.prototype` 共 18 个成员，确实没有它们），而
  `setPoint` / `setRotation` / `setProperties` / `show` / `hide` 在位且调得动。
  ⇒ 这里是「**声明与运行时一致地没有**」，与 `Marker#setAnchor` 那种「声明有、运行时也有」
  不同。描述符的 `recreate` 分类**本来就正确**，已补上 live 复核依据。

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


---

## 更正（2026-09-27，同日第二轮实测）

`scripts/probe-165c-surface.mts` 加入了「等补齐」阶段（每 25ms 采样）后重测：

| 时刻 | `CityListControl` 原型成员数 | `removeCopyright` |
| --- | --- | --- |
| A 官方 callback（**loader 判就绪**） | 3（`toggle=false`） | 不存在 |
| B `new B.Map` 之后 | 3 | 不存在 |
| C 让出一个宏任务之后 | 3 | 不存在 |
| D **命令面补齐**（+约 2.4s） | **26（`toggle=true`、`getCityName=true`）** | **存在** |

⇒ 上面三个 🔴 结论**全部推翻**：`CityListControl` 的命令面、`expand`、
`removeCopyright` 在**稳态下都存在**。`getCityName()` 实测返回 `"中国"`；
`add → remove → collection 归零` 也实测通过。**Fake 那四个成员与稳态运行时一致，
并非「严格超集」**——本文那一节的根因判断也错了。

### 但换出了一个**真实的**缺陷

**loader 判就绪比命令面补齐早约 2.4 秒**，而本库的正常路径正好落在这个窗口里。
窗口内 `addCopyright`（先到的一批）已可用、`removeCopyright`（后补的一批）还没有
⇒ **挂载成功、卸载抛错**，`removeCopyrightControlIfEmpty` 永不执行 ⇒ 共享控件永不摘除、
位置缓存条目永不淘汰。

**泄漏形态与本文描述的一致，但成因不同**——不是「成员不存在」，是「读得太早」。
这正是本文开头那条教训本身。

修法：新增 `ControlDriver.canRemoveCopyright()`（**读实例**而非原型——补齐是追溯的，
已存在的实例自动获得成员，所以「这个实例现在能不能调」才是有决策价值的问题），
组件层在摘除前先问一次；窗口内则**延后摘**（补齐是追溯的，live 验证窗口内加的条目
之后可摘），而不是静默跳过（那会让条目**永久**留在 SDK 上）。
顺带修掉一个真实顺序 bug：`removeCopyrightControlIfEmpty` 判断空时必须
**排除调用方自己那条**「即将被摘」的条目，否则它会把控件永久钉在地图上。
