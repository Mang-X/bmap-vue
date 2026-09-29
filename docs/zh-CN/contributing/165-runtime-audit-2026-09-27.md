# #165 运行时审计（2026-09-27，三个模块从零重校对）

> ## 📌 怎么读这份文档
>
> 本文记录了**三轮**同一天的审计，结论**互相推翻**过。为了不把「被推翻的」当「已确认的」引用，
> 正文里的每一条发现都带一个状态标记：
>
> | 标记 | 含义 |
> | --- | --- |
> | ❌ **已推翻** | 当时的结论**错**。原文保留（推翻它的那次错误本身就是有用记录），但**不得**当结论引用 |
> | ⚠️ **前提推翻，结论待定** | 推理链的**前提**没了，原结论不成立；但那件事本轮**无法判定** |
> | ✅ **成立** | 经复核仍然成立，可以引用 |
>
> 一句话版：**第 1 节的四条 🔴 全部 ❌ 推翻**；真实缺陷在「🔴 真实缺陷」一节（已修）；
> 「✅ 经复核成立的既有结论」一节里的条目**可以**引用。
>
> **贯穿全文的错误有两类**，都是本文最有价值的部分：
>
> 1. **取样时机**（控件命令面分阶段就位，晚约 150ms–2.4s）→「还没到」被读成「永远没有」；
> 2. **「在位」被当「生效」**（`setOpacity` 一族）⇒ 见文末「第三轮」与
>    `driver/jsapi-v4/native-layers.ts` 的 kind 表注释。
>
> 第二类**至今仍有残留**：两个组件文件头（`components/layers/{PolygonLayer,PolylineLayer}.vue`）
> 仍写着按第一类得出的结论，本轮未改（超出当时那票的范围）。

> **教训（已落到 `packages/test-utils/fake-bmap-v4/runtime-member-shape.ts`）**：
> 对「成员是否存在」下结论前，**必须等成员面补齐**；Fake 原本只能表达
> 「永远有 / 永远没有」，这个窗口**结构上无法测试**，于是缺陷通过了全绿的测试。

按维护者要求「重新分派代理去重新校对审查各个模块」执行。三个代理各自**重新克隆**参考库、
声明所用分支/标签、并遵守硬证据规则：**取不到（404 / 空 grep / 网络失败）只能记「无法验证」，
永远不能当「不存在」的证据**。以下结论中带 🔴 的**由我独立复跑探针确认**。

## 🔴 三个运行时损坏（**四条结论全部 ❌ 已推翻**；原文保留，见下方复核表）

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
- `hitTest`（Polygon/PolyLine 声明有运行时无）✅ **仍然成立**；
  且新读数揭示：这两个类上 **`onProto` 对所有成员都是 false**，原型读法**零鉴别力**——
  这正是当初必须重做而不能继承的原因。
- ❌ ~~`setOpacity`（运行时有没有声明）两条都成立~~ → **这一条本身没错，但结论被本轮推翻**：
  「在位」不等于「生效」。两族的 `setOpacity` 都**在位且读得回**，可**只有折线族真的驱动渲染**。
  见文末「第三轮」。
- `BarLayer` / `FlyLineLayer` / `GeoJSONSource` 运行时缺席（三个时机 + 294 属性全扫）。
- `WebGCLustomLayer` **存在**；`ThreejsLayer` / `DeckglLayer` 不存在。
- 四个弃用类的提示语**都不是**陈旧的——它们已经写着「替代品已提供」。
- `./ui-kit` 隔离经三条路径独立复核。
- 四个 UI Kit wrapper 零杜撰选项/事件；`RoutePlanDrivingPolicy` 11 成员逐个同名同值同序。

## 本轮新发现（非运行时）

- ~~`<PointLayer>` 丢了官方声明的 `isFlat` 构造选项~~ → **已补齐**（见下节「本轮落地」第 1 条）。
- `GeoJSONLayer` 的 `setLevel` 官方声明里有、descriptor 里**没有条目**（无文档说明为何不做）。
- `Marker` 缺 4 个官方选项：`anchor` / `enableMassClear` / `autoFollowHeadingChanged` / `startAnimation`。
- `Polyline#getPointAt` / `getLength` 运行时**存在**但官方没声明，我们也没暴露。
- `FeatureLayer` 参考实现有、SDK 声明无、运行时 `NormalLayer` 在——三方不一致，处置待定。
- `preserveDrawingBuffer` 再次实测：**不带 4,918 字节（空画布）、带 171,042 字节（真实内容）**
  （与先前 3,830 / 119,074 方向一致、绝对值随环境变化——已加脚注提醒复现者）。
- `resetHeading` 是**实例成员**（`proto=false, own=true`）——任何未来实现都必须读实例，
  这正是 `Panorama` 探针踩过的坑。

## 本轮落地（2026-09-27 收口）

### 1. `<PointLayer>.isFlat` 补齐（家族内一致性）

`PointLayerProps` 补上 `isFlat` 并按**与两个兄弟逐字同形**的口径转发
（`...(p.isFlat === undefined ? {} : { isFlat: p.isFlat })`）：**没表态时整个键不存在**，
不是 `isFlat: undefined`——官方 `setOptions` 自己会忽略未声明的键并告警一次
（`PointLayer.d.ts:298`），发一个「键在、值 undefined」的成员既可能被那条告警扫到，
也可能被某个默认分支当成「显式 undefined」写进样式。省略整个键是唯一无歧义的表达。
契约由 `tests/type-contracts/point-layer-is-flat.type-test.ts` +
`component-scenarios.test.ts` 的「不表态不进选项袋、表态后换实例」两条钉住。

**顺带更正一条会误导人的注释**：`PointLayerProps.isFlat` 的官方默认值与两个兄弟**不同**。
重新克隆 `github.com/baidu-maps/jsapi-v4-types` @ `5ba67f4`（`update 4.0.5`）逐条读：

| 声明处 | `@default` |
| --- | --- |
| `visualization/PointLayer.d.ts:121` | **`false`** |
| `visualization/TextLayer.d.ts:117` | `false` |
| `layer/PointIconLayer.d.ts:15` / `layer/PointShapeLayer.d.ts:15` | `true` |

⇒ 本库**不给** `isFlat` 默认值、也**不**替官方选一个（三族都如此）：选了就是把注释变成
契约，而注释**可能**就是写错的那一个。「没传 = 不表态 = SDK 自己的默认」保持不变。

### 2. 「等成员面补齐再判成员存在」从注释变成判定层

本文开头那条教训此前只落在两处：审计文档的正文，和 Fake 的
`packages/test-utils/fake-bmap-v4/runtime-member-shape.ts`（**能表达**那个窗口）。
**探针本身**仍然可以在窗口里取样——`probe-165c-surface.mts` 原先就是一句
「成员数 > 10」的内联循环，它**不产出**任何「等到了没有」的信息，于是 §④ 的稳定态读数
与窗口内的读数在报告里**长得一样**。

新增 `scripts/official-probe/member-surface.mts`（共享判定层），并把 `probe-165c-surface.mts`
的等待改成走它。三条不变式：

1. `absent` **只在 settled 之后**可能出现；补齐之前一律 `unsettled`（未判定）。
2. 等待**可观测**：`settled` / `timedOut` / `settledAfterMs` / 逐次 `timeline` / 终态每类成员数
   单独成段，读者能分辨「稳定态读数」与「提前读数」。
3. 等待**超时**是正常结果（网络慢、窗口比预期宽），而超时后的 `absent` 正是要根除的那个
   假阴性 ⇒ 判定层收的是**报告**的 `settled` 标志，不让调用点自己判断「我等到没有」。

⚠️ **判定层写完第一版后，live 复跑立刻抓到第二个假阴性**（同一类错误，方向相反）：
页面侧只采 `settleWhenPresent` 里的成员，于是 `open` / `close` / `getTriggerDom`
**根本没被读过**，却在稳定态被判成 `absent`——§④ 明写 `open proto=true`，三态段印 `absent`。
修法是 spec 增加**独立**的 `observe` 集合（判就绪的成员 ≠ 要下结论的成员）。
这一条比窗口那条**更难发现**：它出现在 settled **之后**，报告看起来完全正常。
现在 live 复跑九个成员全 `present`，与 §④ 一致。

回归守卫在 `tests/behavior/probe-member-surface.test.ts`（17 条）：假 SDK 编排那个窗口，
**页面侧那份源码也用 `new Function` 真跑一遍**（等待逻辑本身是被测到的，不只是「写了注释」）。
两次变异验证过它确实承重：把 `verdictsOf` 改成恒 `settled` ⇒ 4 条红；
把页面侧循环改成不等待 ⇒ 1 条红；把 `observe` 改回只用 `settleWhenPresent` ⇒ 1 条红。

## 留待维护者裁决的四处（**本轮只记录，不实现**）

四条都重新取过一手证据：重新克隆 `https://github.com/baidu-maps/jsapi-v4-types`，
checkout `5ba67f4dda11b0a4b54fc631278d3e39e11667c3`（commit `update 4.0.5`，2026-09-24），
**逐文件读完**（不是 grep 到一个名字就下结论）：

| 项 | 一手证据 | 定性 |
| --- | --- | --- |
| `<GeoJSONLayer>.setLevel` | `layer/GeoJSONLayer.d.ts:136` 声明 `setLevel(z: number): void`（`:133` 有 `geoJSONLayer.setLevel(-50)` 的用例注释）。本库 descriptor 里**没有条目**，也无写下的理由 | **范围选择**，不是缺陷：成员在官方声明上、只是本库没开面。但「没写理由」和第 1 条同病，建议一并补注释 |
| `Marker` 缺 4 个官方选项 | `overlay/MarkerOptions.d.ts` 四个都在：`:18 anchor?: ControlAnchor` / `:23 enableMassClear?: boolean` / `:74 autoFollowHeadingChanged?: boolean` / `:78 startAnimation?: string` | **范围选择**。⚠️ 注意 `anchor` 与 `startAnimation` 各带一条**语义前提**，不能照抄成 prop：`anchor` 按 `recreate` 处理的真正理由是 `getAnchor()` 返回当前值（未设时 `null` = SDK 内置默认锚点，无从构造出来再传回去）；`startAnimation` 的类型是 `string`（不是布尔），语义未取证 |
| `Polyline#getPointAt` / `getLength` | 重新克隆后**全仓**（`overlay/` + `layer/` + `core/` + `visualization/`）grep：两个名字**零命中** | **范围选择**，且是本库一贯口径：「不把未声明成员当契约」。运行时存在反而**不能**据此开面——那正是本文件开头被推翻的那类推理 |
| `FeatureLayer` 处置 | 官方类型仓**零命中**（`NormalLayer` 在 `layer/NormalLayer.d.ts`，是另一回事）。三方不一致 | **范围选择**：SDK 声明里没有的东西按声明走。⚠️ 若将来要接，**必须**先按本文开头的纪律取运行时读数 |

**判定摘要：四条都是范围选择，没有一条是缺陷。** 其中只有「`GeoJSONLayer.setLevel`
缺写下的理由」与本次修掉的 `isFlat` 属同一类（已有但缺失 / 无解释），
其余三条都需要维护者先给出「要不要开面」的决策，不是实现问题。

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

**loader 判就绪比命令面补齐早一段窗口**（实测两次落点不同：约 150ms 与约 2.4s，窗口宽度随环境变化），而本库的正常路径正好落在这个窗口里。
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


## 纪律已写成**类型**（`scripts/official-probe/member-surface.mts`）

后续一轮把这个教训固化成了可执行门禁，而不是留在文档里：

1. **`absent` 只在 `settled` 之后才可能出现**——用三态 `present | absent | unsettled` 把这条
   写成类型，**补齐之前判 `absent` 是写不出来的代码**；判定层与等待层**分离**，所以
   等待**超时**（正常结果）时 `verdict()` 仍然拒绝输出 `absent`——那正是要根除的假阴性。
2. **等待是可观测的**：`settled` / `timedOut` / `settledAfterMs` / 每类原型成员数 / 采样时间轴。
3. **settle 判据是具名成员**，不是「成员数 > N」这种阈值。

`probe-165c-surface.mts` 已重构为使用它（该 bug 的产地）。守卫测试 17 条，
页面侧代码用 `new Function` 对着假 `window` **真实执行**，所以等待循环本身被测到。
三处变异校验证明它有分量：恒 `settled` → 4 红；去掉等待循环 → 1 红；`observe` 集合还原 → 1 红。

**它在第一次 live 跑就抓到第二个假阴性**（同类、方向相反）：页面侧只采样
`settleWhenPresent`，于是 `open`/`close`/`getTriggerDom` 从未被读却被印成 `absent`，
而同一份报告的 §④ 明明写着 `open proto=true`。**这一条比窗口那个更难发现**——它出现在
settle **之后**，报告看起来完全正常。修法是给「用于判定的成员」和「被观察的成员」两套独立集合。

---

## 第三轮（2026-09-27 收口）：`setOpacity` 的裁决，以及「在位 ≠ 生效」

前两轮的错误都是**取样时机**。第三轮换了一类错误，而且**这一类至今仍可能复发**。

### 起因：两份记录互相矛盾

`driver/jsapi-v4/native-layers.ts` 与 `driver/capability/catalog.ts` 记的是：

> 「`setOpacity`：live 探针读到运行时**有**，但官方**声明**里没有 ⇒ 跟随 #165 对 `PointLayer`
> 的同一裁决，「不把未声明成员当契约」。」

而另一轮 live 探针读到的**恰好相反**——三个类上 `typeof === "function"`。两边都是 live 读数，
至少一个错，而**记录断言的是错的那一半**。

**声明侧**先独立复核（重新克隆 `github.com/baidu-maps/jsapi-v4-types`，
checkout `5ba67f4dda11b0a4b54fc631278d3e39e11667c3`，commit `update 4.0.5`，2026-09-24；
**逐文件读完**，不是 grep 到一个名字就下结论）：

| 文件 | `grep -c setOpacity` | `grep -c getOpacity` |
| --- | --- | --- |
| `visualization/PolygonLayer.d.ts` | **0** | **0** |
| `visualization/PolylineLayer.d.ts` | **0** | **0** |
| `visualization/TextLayer.d.ts` | **1**（`:296`） | **1**（`:298`） |

⇒ 未声明这件事是**真的**。另外逐条读 `PolygonLayerOptions` 的选项表（19 个字段），
**根本没有 `opacity` 这一项**（`PolylineLayer.d.ts:131` / `TextLayer.d.ts:179` 有）。

### 运行时侧：`getOpacity` 存在，所以「存在」与「有效」可分

`getOpacity` 与 `setOpacity` **同时**在位 ⇒ 「调用成功」和「画面变了」是**两件可分的事**。
这就是本文要记的第三条纪律：

> **判据是「可观测地生效」，不是「成员在不在」，也不是「声明有没有写」。**

三种形状必须分开处置（把它们混成一条，正是前两轮都栽过的地方）：

| 形状 | 例子 | 处置 |
| --- | --- | --- |
| 声明有、运行时**无** | `PolygonLayer#hitTest` | 不登记（放开门面 = 假支持） |
| 运行时在、但**不生效** | `PolygonLayer#setOpacity` | 不登记（调用成功但画面不变 ⇒ 比假支持更难排查） |
| 运行时有、**且生效** | `PolylineLayer#setOpacity` | **登记**（走显式豁免表） |

**`getOpacity` 读得回来，零信息量**：setter 与 getter 共用同一份状态，
所以「写得进、读得出」是**必然**的，与「驱动渲染」无关。要判「生效」只能看画布。

### 像素判决（两次独立 live 运行，读数一致）

`preserveDrawingBuffer: true` + `readPixels` 数**哨兵色精确匹配**的像素
（哨兵色 = 底图不可能有的纯色，容差 12/255 给抗锯齿与色彩空间转换）。

`PolygonLayer`（纯蓝面，`fillOpacity: 1`，`strokeWeight: 0`，盖满可视范围）：

| 状态 | 哨兵像素 |
| --- | --- |
| `setOpacity(1)` → `(0)` → `(1)` | 148242 → **148242** → 148242 |
| `setOptions({opacity})` 1 → 0 → 1 | 148242 → **148242** → 148242 |
| 构造期 `opacity: 0` | **148243** |
| 换一个小面（7942 像素）重复 1 → 0 → 1 | 7942 → **7942** → 7942 |

`PolylineLayer`（纯蓝线，`strokeWeight: 20`）：

| 状态 | 哨兵像素 |
| --- | --- |
| `setOpacity` 1 → 0 → 1 → 0 → 1 | 4229 → **0** → 4229 → **0** → 4229 |
| `setOptions({opacity})` 0 → 1 | **0** → 4229 |

⇒ **`PolylineLayer#setOpacity` 可观测地生效**（可逆、重复一致）；
**`PolygonLayer#setOpacity` 不生效**。

### 阳性 / 阴性对照（同一次运行，否则同值读数作废）

面族同一次运行里：`setVisible(false)` → **0**、`setOptions({fillOpacity: 0})` → **0**、
`setOptions({fillOpacity: 1})` → **148243**、换色到画布上不可能存在的品红 → **0**、
复原 → **148243**。

⇒ 测量通道是**活的**（改样式会让画布变），所以面族那组「五态全同值」
**不是**「量不出来」，而是**真的不生效**。

### 处置与改了什么

| 位置 | 改动 |
| --- | --- |
| `driver/jsapi-v4/native-layers.ts` | 两族**拆成各自的 `operations` 数组**（原先共用一份）；折线族**加** `setOpacity`，面族**不加**，各自写明依据 |
| `driver/jsapi-v4/native-layers.test.ts` | 「两族都不得登记」改为**按族分别断言**；新增 `RUNTIME_ONLY_REGISTERED` 豁免表 + `enforcedMembersFor()`；豁免表**双向门禁**（入表必须真登记 **且** 真的没声明） |
| `driver/capability/catalog.ts` | 两条 description 改写：面族「不渲染」、折线族「生效 ⇒ 开面」 |
| `types/components.ts` / `manifest.ts` / `driver/types/native-layers.ts` | 撤掉「live 实测运行时的这四个方法也都不在」这句**已被推翻**的断言 |
| `packages/test-utils/fake-bmap-v4/native-layers.ts` | **仅注释**：替身形状不变（两族在位性运行时确实一致），把「替身照实提供 + Driver 不登记」改成按族分别说明 |

⚠️ **两处已知残留**（本轮**故意未改**，超出那票范围）：

- `components/layers/PolygonLayer.vue:23` 与 `PolylineLayer.vue:22` 的文件头仍写着
  「官方未声明 `setOpacity` ⇒ 本库不把未声明成员当契约」。**处置已经变了**（理由也不再是声明），
  但组件**行为**没变（两个组件都仍不提供 `opacity` prop），所以那只是过时注释，不是假支持。
- 折线族现在 Driver 登记了 `setOpacity` 却**没有组件消费者**——`#104` 的
  「没有消费者的扩展面一律不加」对它**暂时**不成立。这条留给维护者裁决
  （要不要给 `<PolylineLayer>` 开 `opacity` prop）：**范围选择，不是缺陷**。

### 这一轮踩到的坑

1. **模板串里的反引号**：`// 用一条 setVisible 做对照` 这类注释里若带 `` `setVisible` ``
   会**提前闭合**外层 TS 模板串，报错位置指向几行之外的 `catch`。本轮撞到过一次。
2. **「非透明像素」是零鉴别力的读数**：swiftshader 下底图铺满，恒等于 `w*h`。
3. **「哨兵色计数」被底图噪声淹没**：第一次设计比 `opacity=1` vs `0.05`，两态计数
   27161 → 22385（**标称相同**的两态却差一大截）⇒ 底图瓦片在取样期间自己进出。
   改成**判决式**（盖满全屏 + 纯色不透明 ⇒ 两种状态差一个数量级）才淹没不了。
4. **`window.onerror` 覆盖主流程的读数**：SDK 的跨域脚本错误会走到那里，
   覆盖写把已产出的读数抹掉。必须**合并**而不是覆盖。
5. **settle 判据不能用图类**：`member-surface.mts` 的 `sample()` 里 `hasFn(Ctor, n)`
   会读静态成员，拿图类当判据会读出 `settled at attempts=1` 的假阳性。
   本轮改为**读实例**，且 `settleWhenPresent` **不含**被测成员（否则是循环论证）。
