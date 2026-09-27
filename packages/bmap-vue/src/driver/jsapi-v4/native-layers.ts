/**
 * v4 NativeLayerDriver（M3A2-SERVICES-NATIVE / issue #23）
 *
 * 十个原生数据图层的**底层接口**：数据（`setData` / `clearData`）、样式、要素状态、
 * 显隐与层级、拾取，以及挂载记账。Vue 组件与数据适配层由 M6（#35 / #36）在它之上实现。
 *
 * 行为依据（官方 4.0 专页 + `@baidumap/jsapi-v4-types@4.0.5`，git `5ba67f4`）：
 *
 * - **四类「专页」批量图层**（`PointIconLayer` / `PointShapeLayer` / `LineLayer` / `FillLayer`）
 *   在 4.0.5 有类声明，且共享同一套方法面：`setData`/`getData`、`updateState`/`removeState`/
 *   `clearState`/`replaceAllState`/`getAllState`、`setStyleOptions`（改完要 `doOnceDraw()`）、
 *   `setVisible`、`setOpacity`、`setZIndex`（及 `setMinZoom`/`setMaxZoom`）、`setBaseOptions`
 *   （`enablePicked` 在这里合并）、`getPickedItem`。它们的构造选项里 `enablePicked` 默认 false，
 *   因此**拾取是显式开关**。
 *   ⚠️ **这一族没有 `clearData`**（#106 评审修正，依据见 `DECLARED_LAYER_OPERATIONS` 的注释）：
 *   「清空数据」由实例生命周期表达，不靠一个不存在的入口。
 * - **四个扩展 API**（`PointLayer` / `ClusterLayer` / `Heatmap` / `TrackLine`）4.0.5 起**有了
 *   类声明**（4.0.4 时没有），但官方明确「首次加载时可视化实现是异步注入的」——类型包里有
 *   形状不代表运行时已加载。因此：
 *   构造器按结构探测，且**在 `create()` 调用时刻判断**——不在 Driver 构造期冻结结论，
 *   注入完成后重新 `create()` 就能成功（issue 风险条目「加载后就绪」）。它们的**成员面按声明**
 *   登记（#165 Class 3：显隐 / 透明度 / 层级这一组在 4.0.5 的 `visualization/*.d.ts` 里逐条
 *   声明，因此本库不再凭「运行时继承到、但专页没列」来猜），而状态 API / 缩放范围 /
 *   `setRenderStage` / `setRefCenter` 这类「声明里没有或当前没有消费者」的仍然关闭。
 *   逐条依据见下面 kind 表的注释，逐条核对见 `native-layers.test.ts` 的
 *   「操作面与官方声明一致」。
 * - **`visualization/` 的新两族**（`PolygonLayer` / `PolylineLayer`，#166）：4.0.5 新增，
 *   是同时弃用的 `FillLayer` / `LineLayer` 的官方指定替代。样式走 `setOptions`（**不是**
 *   `setStyleOptions`）、**没有** `doOnceDraw`、**随主包注入**（不进扩展 API 那份名单）。
 *   「声明与运行时不一致」在这两族上撞了**三次**，而**处置各不相同**——
 *   逐条依据见 kind 表注释与 `docs/zh-CN/contributing/166-visualization-alignment-audit.md`：
 *   `hitTest` 声明有而运行时**无**（不登记）；`setOpacity` 声明无而运行时**有**，但
 *   **判据不是「在位」而是「可观测地生效」**，两族读数**相反**——
 *   折线**生效** ⇒ 登记（走运行时豁免表）；面**不生效** ⇒ 不登记。
 *   ⚠️ 声明侧的不对称在 `PolylineLayer.d.ts`：`:131` 有 `opacity?`、且 `:209` 的
 *   `setOptions` 文档明写 `opacity` 转发给对应 setter ⇒ 那是**契约成员**；
 *   `PolygonLayer` 对 `opacity` **零命中**。同族**不等于**同面。
 * - **不支持的操作显式失败**：`BMAP_CAPABILITY_UNSUPPORTED`，不静默 no-op。
 * - **层级方法要求先挂载**：官方明确「层级调整实现会访问已关联的 Map 与图层管理器」，
 *   所以调用顺序是 `create → add → setZIndex`；错误经 `sdkCall` 归一，不吞错。
 * - **`setStyle` 是 merge**（官方 `setStyleOptions` 合并到现有样式），因此这里不做「替换语义」。
 *   四类专页图层在更新样式后**不**自动重绘（官方：需 `doOnceDraw()`），本 Driver 因此
 *   显式调用 `doOnceDraw()`——「样式改了但画面没变」是最容易被当成 SDK bug 的坑。
 */
import { BMapError } from "../../core/errors/BMapError";
import {
  isValidTrackLineProcess,
  isValidTrackLineSpeed,
} from "../../core/layers/trackLinePlayback";
import type { Capability } from "../capability/catalog";
import type { CapabilityRegistry } from "../capability/registry";
import type { Pixel } from "../types/geometry";
import { HANDLE_BRAND } from "../types/handles";
import type {
  NativeLayerData,
  NativeLayerDriver,
  NativeLayerFeatureState,
  NativeLayerFeatureStateMap,
  NativeLayerHandle,
  NativeLayerKind,
  NativeLayerOperation,
  NativeLayerPick,
  NativeLayerTextPick,
  NativeLayerZoomRange,
} from "../types/native-layers";
import {
  assertJsapiV4Namespace,
  callRequired,
  createMapTargetResolver,
  createMountTracker,
  createWarnOnce,
  namespaceCtor,
  readNamespaceMember,
  requireRuntimeCtor,
  sdkCall,
  type JsapiV4Ctor,
  type JsapiV4Namespace,
} from "./internal";
import type { JsapiV4HandleRegistry } from "./registry";

/**
 * 四类专页图层共享的操作面。
 *
 * ⚠️ **没有 `clearData`**（#106 评审修正）。两条一手来源都指向「这一族没有公开的清空入口」：
 *
 * - 上游声明 `@baidumap/jsapi-v4-types@4.0.5` 的 `PointIconLayer` / `PointShapeLayer` /
 *   `LineLayer` / `FillLayer` **只有** `setData(data)` 与 `getData()`（只有 `GeoJSONLayer` 有
 *   `clearData()`、`DOMLayer` 有 `removeAllOverlays()`）；
 * - 仓库内的官方参考 `.agents/skills/bmap-jsapi-v4/references/visualization-layers.md` 把这一族的
 *   数据面写成 `setData/getData`，资源清理写的是「解绑事件 → `map.removeLayer(layer)`」。
 *
 * 它原先出现在这里是因为 `2026-09-12` 的 ADR 决策 3 把「共享同一套方法面」写宽了（该表已被同一份
 * 证据更正）。「清空数据」在这一族里因此由**实例生命周期**表达（换一个没有数据的实例）——见 ADR
 * `2026-09-19-native-data-layer-components.md` 决策 8。
 *
 * 这张表与官方声明的逐条对应由 `native-layers.test.ts` 的「操作面 ↔ 官方声明」用例**机器核对**，
 * 不允许凭印象增减。
 */
const DECLARED_LAYER_OPERATIONS = [
  "setData",
  "setStyle",
  "setVisible",
  "setOpacity",
  "setZIndex",
  "setZoomRange",
  "updateState",
  "removeState",
  "clearState",
  "replaceState",
  "getState",
  "setEnablePicked",
] as const satisfies readonly NativeLayerOperation[];

/**
 * 走 `invoke()` 通用分流的操作。
 *
 * `updateState`（参数固定为 keys/state/append）、`getState`（**有返回值**）与 `hitTest`
 * （有返回值）各自单独实现——把它们塞进同一个 `switch` 会让「payload 是数组还是对象」
 * 这类细节散在调用点，也会让 `never` 完备性检查失去意义。
 */
type DispatchedOperation = Exclude<
  NativeLayerOperation,
  "updateState" | "getState" | "hitTest" | "hitTestText"
>;

interface NativeLayerDescriptor {
  /** 4.0 构造器名（文件末尾的断言把 `declared: true` 的那些钉在官方 `BMap` 命名空间上）。 */
  ctor: string;
  /**
   * `@baidumap/jsapi-v4-types` 是否声明了该类（决定「用哪个构造入口」与「缺成员」时的错误码）。
   *
   * 4.0.5（`5ba67f4`）给 `PointLayer` / `ClusterLayer` / `Heatmap` / `TrackLine` 补上了类声明，
   * 因此这四类从「运行时扩展 API」升为 `true`——**只有 `setStyleOptions` 那几个仍为 `false`**，
   * 因为 4.0.5 声明的样式入口是 `setOptions`。「类被声明」与「用哪个成员改样式」因此是两个
   * 独立判断，把它们绑在一起会让一次单纯的上游声明升级把已在跑的调用打偏。
   */
  declared: boolean;
  /**
   * `setStyle` 落到哪个成员：`setStyleOptions`（merge + 需显式 `doOnceDraw()`）还是 `setOptions`
   * （整袋替换）。**逐 kind 记录**，因为 4.0.5 里两类并存：老专页图层
   * （`LineLayer` / `FillLayer` / `PointIconLayer` / `PointShapeLayer`）声明 `setStyleOptions`，
   * 新 `visualization/` 图层声明 `setOptions`。
   */
  styleMember: "setStyleOptions" | "setOptions";
  /** 该 kind 真正有的归一化操作。 */
  operations: readonly NativeLayerOperation[];
}

/**
 * 每种图层一条记录。
 *
 * `declared` 同时决定三件事，写在一起才不会互相漂移：能否 `namespaceCtor`、能否用
 * 字段级 setter 族（`setVisible` / `setOpacity` / 状态 API 都是声明成员）、以及
 * 「缺成员」时的错误码（`BMAP_SDK_CALL_FAILED` vs `BMAP_CAPABILITY_UNSUPPORTED`）。
 */

/**
 * 运行时注入的图层构造器名单。
 *
 * 与 `declared` **正交**：4.0.5 给 `PointLayer` / `ClusterLayer` / `Heatmap` / `TrackLine`
 * 补上了类声明（`declared: true`），但它们在真实运行时仍要等扩展 API 注入才能用。名字对
 * 声明、但「没注入就当普通成员缺失」会报出 `BMAP_SDK_CALL_FAILED`，而正确结论是
 * `BMAP_CAPABILITY_UNSUPPORTED`（能力不可用，注入后可创建）——两者对调用方的处置完全不同。
 */
const RUNTIME_INJECTED_LAYER_CTORS: ReadonlySet<string> = new Set([
  "PointLayer",
  "ClusterLayer",
  "Heatmap",
  "TrackLine",
  // ⚠️ `PolygonLayer` / `PolylineLayer` **刻意不在这里**（#166）。它们虽同属
  // `visualization/` 命名空间，但 live 探针（`scripts/probe-runtime-members.mts` case 3b 的
  // `injectionTiming`，2026-09-27）读到二者在 `BMap.Map` 刚就绪时就已是 `function`
  // ⇒ 随主包注入，不进「运行时异步注入」这一份名单。把它们加进来会让缺构造器时报成
  // `BMAP_CAPABILITY_UNSUPPORTED`（可重试）而实际是 `BMAP_SDK_CALL_FAILED`（不会变好）。
]);

const NATIVE_LAYER_DESCRIPTORS = {
  "point-icon": {
    ctor: "PointIconLayer",
    declared: true,
    styleMember: "setStyleOptions",
    operations: DECLARED_LAYER_OPERATIONS,
  },
  "point-shape": {
    ctor: "PointShapeLayer",
    declared: true,
    styleMember: "setStyleOptions",
    operations: DECLARED_LAYER_OPERATIONS,
  },
  line: {
    ctor: "LineLayer",
    declared: true,
    styleMember: "setStyleOptions",
    operations: DECLARED_LAYER_OPERATIONS,
  },
  fill: {
    ctor: "FillLayer",
    declared: true,
    styleMember: "setStyleOptions",
    operations: DECLARED_LAYER_OPERATIONS,
  },
  // 扩展 API 的四个类：`@baidumap/jsapi-v4-types@4.0.5`（git `5ba67f4`）给
  // `visualization/` 补上了类声明，**逐条**声明了显示属性那一组。4.0.4 时没有声明，本仓库据
  // 「不把未声明成员当契约」的口径只凭 #35 的 live 取证放开了 `setVisible`（`setOpacity` /
  // `setZIndex` / `setRenderStage` / `setRefCenter` 当时全部关闭）。那个前提已失效，下面
  // 按**声明**登记，不再按「运行时继承到、但没列进方法面」推测。
  //
  // 声明行（`visualization/*.d.ts`，`@group 显示属性` 那一组）：
  //
  // | kind | setVisible | setOpacity | setZIndex | setRenderStage | setRefCenter |
  // | --- | --- | --- | --- | --- | --- |
  // | point | :324 | **无** | :328 | :332 | :336 |
  // | cluster | :260 | :264 | :268 | :272 | :276 |
  // | heatmap | :153 | :157 | :161 | :165 | :169 |
  // | track-line | :457 | :461 | :465 | :469 | :473 |
  //
  // `PointLayer` **没有** `setOpacity`（三个兄弟都有）——因此它不登记，登记了就是拿未声明的
  // 成员当契约。它同样没有 `setEnablePicked` 之外的拾取面以外的成员。
  //
  // 状态 API（`updateState` 一族）、`setZoomRange`（`setMinZoom` / `setMaxZoom`）、
  // `setRenderStage` / `setRefCenter` 仍然**不登记**：前两者官方声明里确实没有（`minZoom` /
  // `maxZoom` 是**构造选项**，不是字段级 setter），后两者本库当前没有组件消费者——
  // 放开门面而没有消费者等于凭空扩面（#104 的「没有消费者的扩展面一律不加」）。
  point: {
    ctor: "PointLayer",
    declared: true,
    styleMember: "setOptions",
    operations: [
      "setData",
      "clearData",
      "setStyle",
      "setVisible",
      "setZIndex",
      "setEnablePicked",
      "hitTest",
    ],
  },
  cluster: {
    ctor: "ClusterLayer",
    declared: true,
    styleMember: "setOptions",
    operations: [
      "setData",
      "clearData",
      "setStyle",
      "setVisible",
      "setOpacity",
      "setZIndex",
    ],
  },
  heatmap: {
    ctor: "Heatmap",
    declared: true,
    styleMember: "setOptions",
    operations: [
      "setData",
      "clearData",
      "setStyle",
      "setVisible",
      "setOpacity",
      "setZIndex",
    ],
  },
  // #166：官方 4.0.5（git `5ba67f4`）新增 `visualization/PolygonLayer` / `PolylineLayer`，
  // 作为 4.0.5 **同时弃用**的 `FillLayer` / `LineLayer` 的**官方指定替代**。
  //
  // 三个判断各自独立，逐条依据如下（另见 `docs/zh-CN/contributing/166-visualization-alignment-audit.md`）：
  //
  // - `declared: true` —— 两族在 4.0.5 有完整类声明（`visualization/PolygonLayer.d.ts:125`、
  //   `visualization/PolylineLayer.d.ts:162`）。
  // - `styleMember: "setOptions"` —— 官方声明的样式入口是 `setOptions`
  //   （`PolygonLayer.d.ts:181` / `PolylineLayer.d.ts:213`），**不是** `setStyleOptions`；
  //   且这一族**没有** `doOnceDraw`（live 探针实测 `protoHas` 全为 `false`）。
  // - **不进 `RUNTIME_INJECTED_LAYER_CTORS`** —— live 探针
  //   （`scripts/probe-runtime-members.mts` case 3b，`injectionTiming`，2026-09-27）读到
  //   `B.PolygonLayer` / `B.PolylineLayer` 在 `BMap.Map` 刚就绪时**已经是 `function`**
  //   ⇒ 随主包注入，不像扩展 API 那四类要等异步注入。因此它们缺构造器时报
  //   `BMAP_SDK_CALL_FAILED`（官方声明过这个类）而不是 `BMAP_CAPABILITY_UNSUPPORTED`。
  //
  // 登记面里**刻意没有**的三条（逐条依据见上面那份审计）：
  //
  // - `hitTest`：官方**声明**有（`:201` / `:233`），live 探针读到运行时**没有** ⇒ 假支持。
  // - `setZoomRange`：官方**没有** `setMinZoom` / `setMaxZoom`（`minZoom` / `maxZoom` 是
  //   **构造选项**，`:108` / `:112`），live 探针实测两个方法在运行时也都是 `undefined`。
  //
  // 状态 API（`updateState` 一族）同样不登记：两族的声明里没有。
  //
  // ⚠️ **`setOpacity` 两族的处置不同，因此它们各有自己的 operations 数组**——见下面各自
  // 那段注释。原先这里是**一份共用数组**，注释写着「两族都运行时有、声明都没有 ⇒ 同处置」，
  // 那个前提经 2026-09-27 的 live 复跑**部分被推翻**：运行时有是对的，但「可观测地生效」
  // 只在折线族上成立（面族不成立）。判据是**可观测地生效**，不是「成员在不在」。
  polygon: {
    ctor: "PolygonLayer",
    declared: true,
    styleMember: "setOptions",
    // ⚠️ **不**含 `setOpacity`——理由与折线族**不同**，别照抄那条。
    //
    // 三种形状必须分开（#165 收口时的教训）：
    //
    // | 形状 | 例子 | 处置 |
    // | --- | --- | --- |
    // | 声明有、运行时**无** | `PolygonLayer#hitTest` | 不登记（放开门面 = 假支持） |
    // | **运行时**有、声明无 | `PolygonLayer#setOpacity`（本条） | 判「可观测地生效」 |
    // | 运行时在、但**不生效** | `setStrokeLineCap` | 不登记（见上） |
    //
    // live 复跑（`/tmp/probe-opacity`，2026-09-27，AK 见 `docs/.vitepress/theme/index.ts`，
    // 两次独立运行读数一致）逐条：
    //
    // - **在位**：`setOpacity` / `getOpacity` 两个的 `proto` 与 `inst` 都是 `true`
    //   （原型链 5 层，`own` 全为 `false` ⇒ 继承来的，不是实例自有）。
    // - **读回是活的**：`setOpacity(0.25)` → `getOpacity() === 0.25`；越界 `5` 被夹到 `1`。
    //   ⚠️ 但 `getOpacity` 读的是**自己那份状态**——「写得进去、读得回来」**不等于**驱动渲染。
    // - **像素判决（关键）**：铺一个盖满可视范围的纯蓝面（`rgb(0,0,255)`，`strokeWeight: 0`），
    //   `preserveDrawingBuffer: true` + `readPixels` 数哨兵色像素。`setOpacity` 走
    //   `1 → 0 → 1`、`setOptions({opacity})` 走 `1 → 0 → 1`、构造期 `opacity: 0`，
    //   **五态全部 148243**（= 画布非空像素的 86%，一遍不多一遍不少）。
    // - **测量通道是活的**（否则同值读数作废）：同一条面上
    //   `setVisible(false)` → **0**、`setOptions({fillOpacity: 0})` → **0**、
    //   `setOptions({fillOpacity: 1})` → **148243**；换色到画布上不可能存在的品红 → **0**。
    //   换一个小面（7942 像素）重复 `1 → 0 → 1` 仍然全同值。
    // - ⇒ **判定：`PolygonLayer#setOpacity` 是「present-but-ineffective」**。
    //   `getOpacity()` 会把值读回来，但那只是 setter 与 getter 共用的那份状态，
    //   **没有任何一条路径把它接到渲染上**。登记它等于开一个「调用成功但画面不变」的面。
    //
    // 另外 `PolygonLayerOptions` **根本没有** `opacity` 这一项（逐条读过选项表：
    // fillColor / fillOpacity / strokeColor / strokeWeight / strokeOpacity / fillTextureUrl /
    // fillTextureSize / fillTextureAlphaOnly / data / idKey / enablePicked / mouseStyleChange /
    // pickTolerance / pickThrough / visible / zIndex / minZoom / maxZoom / referCenter /
    // renderStage）——所以面族连「声明的入口」都没有，与折线族不同。
    operations: ["setData", "clearData", "setStyle", "setVisible", "setZIndex", "setEnablePicked"],
  },
  polyline: {
    ctor: "PolylineLayer",
    declared: true,
    styleMember: "setOptions",
    // ✅ **含** `setOpacity`——它是本族唯一一条「运行时依据」的登记项，但这一次
    // 「可观测地生效」这条**独立判据也成立**，不是靠声明兜底。
    //
    // 同一份 live 复跑（两次运行读数一致）读到的：
    //
    // - 在位性同面族：`setOpacity` / `getOpacity` 的 `proto` 与 `inst` 都是 `true`。
    // - 读回同面族：`setOpacity(0.25)` → `0.25`（越界夹到 `1`）。
    // - **像素判决（与面族相反）**：一条 `strokeWeight: 20` 的纯蓝折线，哨兵像素计数
    //   `setOpacity` 走 `1 → 0 → 1 → 0 → 1` = **4229 → 0 → 4229 → 0 → 4229**，
    //   `setOptions({opacity})` 走 `0 → 1` = **0 → 4229**。可逆、重复一致。
    // - 测量通道活性由**同一次运行里的面族**提供（`fillOpacity: 0` → 0 /
    //   `setVisible(false)` → 0 / 换色 → 0 / 复原 → 148243）——不是另开一次探针。
    // - ⇒ **判定：`PolylineLayer#setOpacity` 是「可观测地生效」**，因此登记。
    //
    // 为什么面族不登记、这一族登记：**同族不等于同面**。两者的「在位性」读数完全一样
    // （`proto`/`inst` 都 true），差别只在「有没有接到渲染上」，而那一条**只能靠像素读**——
    // 任何只看成员表的门禁（包括本文件的 `supports()`）都给不出这个区别。
    //
    // ⚠️ 代价因此也要改：原先写的「`PolylineLayerOptions.opacity`（`:131`）只能经 `setOptions`
    // 整袋下发」**是错的**——两条路都实测生效（像素各 0 与 4229）。代价换成：
    // **`PolygonLayer` 那一族没有图层级 `opacity`**（选项表里根本没有这一项，
    // 唯一可用的透明度是逐要素的 `fillOpacity`），所以 `<PolygonLayer>` 仍不提供图层级入口。
    operations: [
      "setData",
      "clearData",
      "setStyle",
      "setVisible",
      "setOpacity",
      "setZIndex",
      "setEnablePicked",
    ],
  },
  // #166 第二刀：官方 4.0.5 `visualization/TextLayer`（批量文字标注）。
  //
  // 四个判断各自独立，逐条依据如下（live 读数见 `scripts/probe-runtime-members.mts`
  // case 3e / 3f / 15 / 16，2026-09-27，`lateVisualizationV3.TextLayer`）：
  //
  // - `declared: true` —— 4.0.5 有完整类声明（`visualization/TextLayer.d.ts:205`）。
  // - `styleMember: "setOptions"` —— 官方声明的样式入口是 `setOptions`（`:269`），
  //   **不是** `setStyleOptions`；这一族**没有** `doOnceDraw`（探针 `protoHas` 全 false）。
  // - **不进 `RUNTIME_INJECTED_LAYER_CTORS`** —— 探针 `injectionTiming.TextLayerAtMapReady`
  //   读到 `"function"`（在 `BMap.Map` 刚就绪时）⇒ 随主包注入，与 `PolygonLayer` /
  //   `PolylineLayer` 同族，不是扩展 API 那四类。
  // - 登记面比前两族**宽两条**（`setOpacity` 与 `hitTest`），因为这一族的声明与运行时
  //   在这两条上**一致**，而前两族恰好各缺一个（详见下面两条注释）。
  //
  // 逐条成员依据：
  //
  // | 操作 | 声明 | 运行时 | 登记 | 说明 |
  // | --- | --- | --- | --- | --- |
  // | `setData` / `clearData` | `:252` / `:262` | 有 | **登记** | 与前两族同 |
  // | `setStyle` → `setOptions` | `:269` | 有 | **登记** | 整袋替换 |
  // | `setVisible` | `:292` | 有 | **登记** | 显隐不换实例 |
  // | `setOpacity` | `:296` | **有** | **登记** | ⚠️ 与前两族相反：前两族官方**没声明** |
  // | `setZIndex` | `:300` | 有 | **登记** | |
  // | `setEnablePicked` | `:280` | 有 | **登记** | 声明成员（不是 `setBaseOptions`） |
  // | `hitTest` | `:289` | **有** | **登记** | ⚠️ 与前两族相反：前两族声明有而运行时**无** |
  //
  // 仍然**不登记**的三条（逐条理由）：
  //
  // - `setZoomRange`：官方**没有** `setMinZoom` / `setMaxZoom`（`minZoom` / `maxZoom` 是
  //   **构造选项**，`:190` / `:195`），探针 `protoHas` 读到的两个方法均为 `false`。
  // - `setRenderStage` / `setRefCenter`：声明（`:304` / `:308`）与运行时都有，但**无组件
  //   消费者**（同 `PolygonLayer` / `PolylineLayer` 的裁决，见 #104「没有消费者的扩展面
  //   一律不加」）。它们经 `setOptions` 的整袋也能下发，不另开字段级入口。
  // - 状态 API（`updateState` 一族）：声明里没有。
  text: {
    ctor: "TextLayer",
    declared: true,
    styleMember: "setOptions",
    operations: [
      "setData",
      "clearData",
      "setStyle",
      "setVisible",
      "setOpacity",
      "setZIndex",
      "setEnablePicked",
      // ⚠️ 登记的是 `hitTestText` 而**不是** `hitTest`——官方两族的回包形状不同，
      // 归一化成同一份会让 `TextLayer` 拿到一个本库编出来的 `dataIndex`。见
      // `NativeLayerOperation` 里那一条注释。
      "hitTestText",
    ],
  },
  // TrackLine 播放命令面（#110）。方法名经 live 探针（`scripts/probe-track-line.mts`，
  // 2026-09-23，exit 0）取证：`typeof layer.start === "function"` 等七条全部为真。
  // 4.0.5 补上了 TrackLine 类声明，且七个操作**逐一**都在声明里（`declared: true`）。
  //
  // `clearData`（`TrackLine.d.ts:358`）此前漏登记：它同属声明的数据面，被
  // 「这一族没有清空入口」的旧结论连坐了。`TrackLineLayer` 组件仍**不调用**它
  // （`data: null` 走换实例，见组件注释），但 Driver 面的声明一致性要求登记。
  "track-line": {
    ctor: "TrackLine",
    declared: true,
    styleMember: "setOptions",
    operations: [
      "setData",
      "clearData",
      "setStyle",
      "setVisible",
      "setOpacity",
      "setZIndex",
      "start",
      "pause",
      "resume",
      "stop",
      "setSpeed",
      "setProcess",
    ],
  },
} as const satisfies Record<NativeLayerKind, NativeLayerDescriptor>;

/** 每种原生图层对应的语义能力（能力清单是单一事实源：`driver/capability/catalog.ts`）。 */
const NATIVE_LAYER_CAPABILITIES: Readonly<Record<NativeLayerKind, Capability>> = {
  point: "layer.point",
  cluster: "layer.cluster",
  "point-icon": "layer.point-icon",
  "point-shape": "layer.point-shape",
  line: "layer.line",
  fill: "layer.fill",
  heatmap: "layer.heatmap",
  "track-line": "layer.track-line",
  polygon: "layer.polygon",
  polyline: "layer.polyline",
  text: "layer.text",
};

export interface CreateJsapiV4NativeLayerDriverInput {
  /** v4 全局命名空间（`globalThis.BMap`）；raw SDK 只允许在 Driver/Client 边界读取。 */
  rawSdk: unknown;
  capabilities: CapabilityRegistry;
  registry: JsapiV4HandleRegistry;
}

export function createJsapiV4NativeLayerDriver(
  input: CreateJsapiV4NativeLayerDriverInput,
): NativeLayerDriver {
  const { rawSdk, capabilities, registry } = input;
  const namespace: JsapiV4Namespace = assertJsapiV4Namespace(rawSdk);

  const warnOnce = createWarnOnce();
  const mounted = createMountTracker();
  /** 原生数据图层只能挂到 Map（与 `LayerDriver` 同源）。 */
  const requireMapTarget = createMapTargetResolver({
    facet: "NativeLayerDriver",
    entry: "map.addLayer / removeLayer",
    resolve: (handle) => registry.resolve<object>(handle),
    warn: warnOnce,
  });

  /** 句柄品牌即 `native-layer:<kind>`（纯元数据，所有权校验留给 `registry.resolve`）。 */
  const kindOf = (layer: NativeLayerHandle): NativeLayerKind | undefined => {
    const match = /^native-layer:(.+)$/.exec(String(layer[HANDLE_BRAND]));
    return match?.[1] as NativeLayerKind | undefined;
  };

  const descriptorOf = (layer: NativeLayerHandle): NativeLayerDescriptor | undefined => {
    const kind = kindOf(layer);
    return kind ? NATIVE_LAYER_DESCRIPTORS[kind] : undefined;
  };

  /**
   * `referCenter`：组件层的纯数据 `{ lng, lat }` → 官方 `BMap.Point`。
   *
   * 官方 `PointLayerOptions.referCenter`（`visualization/PointLayer.d.ts:191`）的类型是
   * `BMap.Point`，而组件层收的是全库统一的 Geometry 纯数据。**换算只发生在 Driver 边界**
   * （组件 / composable 不构造 SDK 构造器——仓库对 raw SDK 边界的一贯口径）。
   *
   * 已经是 `BMap.Point` 的（有人直接经 `advanced` 逃生口传了）原样放过：只认「带 `lng`/`lat`
   * 两个有限数字的纯对象」才换算，避免把真 `Point` 再包一层。
   */
  const toRawPoint = (value: unknown): unknown => {
    if (!value || typeof value !== "object") return value;
    const candidate = value as { lng?: unknown; lat?: unknown };
    // 官方 `Point` 实例也带 `lng` / `lat`，但它的原型是 SDK 的类而不是 `Object.prototype`。
    // 因此判据是「**是不是纯数据**」而不是「有没有 lng/lat」：只对原型是 `Object.prototype`
    // （或 `null`）的对象换算，别去动已经构造好的真实例。
    const proto = Object.getPrototypeOf(candidate);
    if (proto !== Object.prototype && proto !== null) return value;
    const lng = Number(candidate.lng);
    const lat = Number(candidate.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return value;
    return new (namespaceCtor(namespace, "Point"))(lng, lat);
  };

  /**
   * 扩展 API 的整袋 `setOptions` 入参归一化。
   *
   * 只做一件官方签名要求、而组件层给不出的事：把 `referCenter` 换算成 `BMap.Point`。
   * **不是白名单过滤**——袋里其余键原样透传（官方 `setOptions` 自己会忽略未声明的键并告警一次，
   * 见 `PointLayer.d.ts:298`；在这里替上游过滤会吞掉那条告警）。
   */
  const normalizeOptionsBag = (payload: unknown): unknown => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
    const bag = payload as Record<string, unknown>;
    if (!("referCenter" in bag)) return payload;
    return { ...bag, referCenter: toRawPoint(bag.referCenter) };
  };

  /**
   * 归一化操作 → SDK 调用。
   *
   * 只在 `assertSupported()` 之后调用；因此这里按 `descriptor.declared` 分流是安全的
   * （专页图层有字段级 setter 族，扩展 API 只有 `setOptions` / `setEnablePicked`）。
   */
  const invoke = (
    raw: Record<string, unknown>,
    descriptor: NativeLayerDescriptor,
    kind: NativeLayerKind,
    operation: DispatchedOperation,
    payload?: unknown,
  ): void => {
    switch (operation) {
      case "setData":
        callRequired(raw, "setData", payload);
        return;
      case "clearData":
        callRequired(raw, "clearData");
        return;
      case "setStyle":
        // 走哪个成员**逐 kind** 决定（`descriptor.styleMember`），不跟 `declared` 绑：4.0.5 里
        // 两类并存——老专页图层声明 `setStyleOptions`（merge + 需显式重绘），新 `visualization/`
        // 图层声明 `setOptions`（整袋替换），而后者在 4.0.5 里**没有** `doOnceDraw`。
        if (descriptor.styleMember === "setStyleOptions") {
          callRequired(raw, "setStyleOptions", payload);
          // 官方：专页图层更新样式后不会自动重绘，需要显式 doOnceDraw()
          const draw = readNamespaceMember(raw, "doOnceDraw");
          if (typeof draw === "function") callRequired(raw, "doOnceDraw");
          else {
            // 不静默：样式已写入但画面不会变，调用方必须知道要自己触发重绘
            warnOnce(
              `${kind}:no-doOnceDraw`,
              `NativeLayerDriver.setStyle: ${kind} 实例没有 doOnceDraw()，样式已更新但**不会重绘**；` +
                "需要调用方自行触发重绘",
            );
          }
          return;
        }
        // 扩展 API 只有整袋 setOptions（官方文档把它们列为 setOptions）
        callRequired(raw, "setOptions", normalizeOptionsBag(payload));
        return;
      case "setVisible":
        callRequired(raw, "setVisible", payload);
        return;
      case "setOpacity":
        callRequired(raw, "setOpacity", payload);
        return;
      case "setZIndex":
        callRequired(raw, "setZIndex", payload);
        return;
      case "setZoomRange": {
        const range = payload as NativeLayerZoomRange;
        // 两端可选：只改给到的那一端（把缺失的一端当成默认值会把调用方的设置悄悄改掉）
        if (typeof range?.min === "number") callRequired(raw, "setMinZoom", range.min);
        if (typeof range?.max === "number") callRequired(raw, "setMaxZoom", range.max);
        return;
      }
      case "removeState":
        callRequired(raw, "removeState", payload);
        return;
      case "clearState":
        callRequired(raw, "clearState");
        return;
      case "replaceState":
        callRequired(raw, "replaceAllState", payload);
        return;
      case "setEnablePicked":
        // 只有**老专页图层**（`setStyleOptions` 那一族）把拾取开关放在 `setBaseOptions` 里；
        // 4.0.5 的 `PointLayer` 直接声明了 `setEnablePicked`。因此这里同样按 kind 判，不跟
        // `declared` 绑——4.0.5 升级后 `PointLayer` 也变成 `declared`，跟着它走会调到
        // 上游没承诺的 `setBaseOptions`。
        if (descriptor.styleMember === "setStyleOptions") {
          callRequired(raw, "setBaseOptions", { enablePicked: payload });
          return;
        }
        callRequired(raw, "setEnablePicked", payload);
        return;
      // TrackLine 播放命令（#110；方法名均经 live 探针取证）
      case "start":
        callRequired(raw, "start");
        return;
      case "pause":
        callRequired(raw, "pause");
        return;
      case "resume":
        callRequired(raw, "resume");
        return;
      case "stop":
        callRequired(raw, "stop");
        return;
      case "setSpeed":
        callRequired(raw, "setSpeed", payload);
        return;
      case "setProcess":
        callRequired(raw, "setProcess", payload);
        return;
    }
    // 完备性检查：新增归一化操作却忘了在上面处理时，`operation` 不会收窄成 `never`，
    // 这一句会直接编译失败（而不是变成运行时静默 no-op）。
    operation satisfies never;
  };

  /** 该 kind 没有这个入口时显式失败（调用前可用 `supports()` 先问）。 */
  const assertSupported = (kind: NativeLayerKind, operation: NativeLayerOperation): void => {
    const operations: readonly NativeLayerOperation[] = NATIVE_LAYER_DESCRIPTORS[kind].operations;
    if (operations.includes(operation)) return;
    warnOnce(
      `${kind}:unsupported:${operation}`,
      `NativeLayerDriver: ${kind} 没有 "${operation}" 的运行时入口（官方 4.0 的该图层不公开这个方法），` +
        "本次调用被拒绝——不静默降级，否则调用方会以为设置生效了",
    );
    throw new BMapError(
      "BMAP_CAPABILITY_UNSUPPORTED",
      `NativeLayerDriver: ${kind}.${operation} 在 JSAPI 4.0 没有运行时入口`,
      { engine: "jsapi-v4", capability: NATIVE_LAYER_CAPABILITIES[kind] },
    );
  };

  /** 解析句柄并取回它自己的描述符（避免用调用方给的 kind 去解释别的实例）。 */
  const open = (
    layer: NativeLayerHandle,
    operation: NativeLayerOperation,
  ): { raw: Record<string, unknown>; descriptor: NativeLayerDescriptor; kind: NativeLayerKind } => {
    const kind = kindOf(layer);
    const descriptor = descriptorOf(layer);
    if (!kind || !descriptor) {
      throw new BMapError(
        "BMAP_INVALID_ARGUMENT",
        `NativeLayerDriver.${operation}: 句柄不是本 Driver 创建的原生图层句柄`,
        { engine: "jsapi-v4" },
      );
    }
    assertSupported(kind, operation);
    return { raw: registry.resolve<Record<string, unknown>>(layer), descriptor, kind };
  };

  const ctorFor = (kind: NativeLayerKind, descriptor: NativeLayerDescriptor): JsapiV4Ctor => {
    // 走哪条解析**看「是不是运行时注入」，不看「类型包有没有声明」**。
    // 4.0.5（`5ba67f4`）给这四个类补上了类声明，但它们在真实运行时仍然要等扩展 API 注入：
    // 类型包里有声明只说明形状已知，不说明已加载。按 `declared` 判会让 4.0.5 升级把
    // 「运行时还没注入」误报成普通成员缺失（`BMAP_SDK_CALL_FAILED`），而它其实是
    // 能力不可用（`BMAP_CAPABILITY_UNSUPPORTED`）——两者对调用方的处置完全不同。
    if (!RUNTIME_INJECTED_LAYER_CTORS.has(descriptor.ctor)) {
      return namespaceCtor(namespace, descriptor.ctor);
    }
    return requireRuntimeCtor(namespace, descriptor.ctor, (message) =>
      warnOnce(
        `${kind}:no-runtime-entry`,
        `NativeLayerDriver: ${message}；"${kind}" 依赖 4.0 运行时按需注入可视化实现——` +
          "注入完成后再次 create() 即可（本 Driver 不在构造期冻结这个结论）",
      ),
    );
  };

  return {
    create(kind, options = {}) {
      const descriptor: NativeLayerDescriptor | undefined = NATIVE_LAYER_DESCRIPTORS[kind];
      if (!descriptor) {
        throw new BMapError("BMAP_INVALID_ARGUMENT", `未知原生图层种类: ${String(kind)}`, {
          engine: "jsapi-v4",
        });
      }
      // 能力守卫 **在调用时刻**求值（`supports()` 每次重算 rawMembers），因此
      // 「实现异步注入完成后再建」这条路径成立；`throw` 策略下失败发生在构造之前，
      // 不会留下孤儿实例。
      capabilities.require(NATIVE_LAYER_CAPABILITIES[kind]);
      const Ctor = ctorFor(kind, descriptor);
      const raw = sdkCall(descriptor.ctor, () => new Ctor(options));
      return registry.adopt(`native-layer:${kind}`, raw);
    },

    add(target, layer) {
      const rawMap = requireMapTarget(target, "add");
      const raw = registry.resolve<object>(layer);
      if (!mounted.claim(rawMap, raw)) return;
      try {
        sdkCall("map.addLayer", () => callRequired(rawMap, "addLayer", raw));
      } catch (error) {
        // 失败回滚记账（同 Layer / Control Facet）：否则用同一个句柄重试会被记成已挂过而静默跳过
        mounted.release(rawMap, raw);
        throw error;
      }
    },

    remove(target, layer) {
      const rawMap = requireMapTarget(target, "remove");
      const raw = registry.resolve<object>(layer);
      sdkCall("map.removeLayer", () => callRequired(rawMap, "removeLayer", raw));
      mounted.release(rawMap, raw);
    },

    supports(kind, operation) {
      const descriptor: NativeLayerDescriptor | undefined = NATIVE_LAYER_DESCRIPTORS[kind];
      return descriptor ? descriptor.operations.includes(operation) : false;
    },

    setData(layer, data: NativeLayerData) {
      const { raw, descriptor, kind } = open(layer, "setData");
      invoke(raw, descriptor, kind, "setData", data);
    },

    clearData(layer) {
      const { raw, descriptor, kind } = open(layer, "clearData");
      invoke(raw, descriptor, kind, "clearData");
    },

    setStyle(layer, style) {
      const { raw, descriptor, kind } = open(layer, "setStyle");
      invoke(raw, descriptor, kind, "setStyle", style);
    },

    setVisible(layer, visible) {
      const { raw, descriptor, kind } = open(layer, "setVisible");
      invoke(raw, descriptor, kind, "setVisible", visible);
    },

    setOpacity(layer, opacity) {
      const { raw, descriptor, kind } = open(layer, "setOpacity");
      invoke(raw, descriptor, kind, "setOpacity", opacity);
    },

    setZIndex(layer, zIndex) {
      const { raw, descriptor, kind } = open(layer, "setZIndex");
      invoke(raw, descriptor, kind, "setZIndex", zIndex);
    },

    setZoomRange(layer, range) {
      const { raw, descriptor, kind } = open(layer, "setZoomRange");
      invoke(raw, descriptor, kind, "setZoomRange", range);
    },

    updateState(layer, keys, state, append = false) {
      // 官方签名固定（keys / params / ifAppend），因此不走 `invoke` 的通用分流
      const { raw } = open(layer, "updateState");
      callRequired(raw, "updateState", keys, state, append);
    },

    removeState(layer, keys) {
      const { raw, descriptor, kind } = open(layer, "removeState");
      invoke(raw, descriptor, kind, "removeState", keys);
    },

    clearState(layer) {
      const { raw, descriptor, kind } = open(layer, "clearState");
      invoke(raw, descriptor, kind, "clearState");
    },

    replaceState(layer, inputs) {
      const { raw, descriptor, kind } = open(layer, "replaceState");
      invoke(raw, descriptor, kind, "replaceState", inputs);
    },

    getState(layer) {
      // 与 `hitTest` 同类：有返回值，因此不走 `invoke` 的 void 分流
      const { raw } = open(layer, "getState");
      const result = sdkCall("NativeLayer.getAllState", () => callRequired(raw, "getAllState"));
      if (result === null || typeof result !== "object") {
        throw new BMapError(
          "BMAP_SDK_CALL_FAILED",
          `NativeLayerDriver.getState: getAllState() 应当返回 id → 状态的对象，实际是 ${typeof result}`,
          { engine: "jsapi-v4" },
        );
      }
      // 只保留**状态对象**条目：声明里回包类型是 `object`，没有逐项类型；值不是对象的条目
      // 无法当作要素状态使用（把它透传出去会让调用方拿到形状不一致的映射）。
      const normalized: NativeLayerFeatureStateMap = {};
      for (const [key, state] of Object.entries(result as Record<string, unknown>)) {
        if (state !== null && typeof state === "object") {
          normalized[key] = state as NativeLayerFeatureState;
        }
      }
      return normalized;
    },

    setEnablePicked(layer, enabled) {
      const { raw, descriptor, kind } = open(layer, "setEnablePicked");
      invoke(raw, descriptor, kind, "setEnablePicked", enabled);
    },

    hitTest(layer, pixel: Pixel): NativeLayerPick | null {
      const { raw } = open(layer, "hitTest");
      const result = sdkCall("NativeLayer.hitTest", () =>
        callRequired(raw, "hitTest", pixel.x, pixel.y),
      ) as { dataIndex?: unknown; dataItem?: unknown } | null | undefined;
      if (!result || typeof result !== "object") return null;
      const dataIndex = Number(result.dataIndex);
      return {
        dataIndex: Number.isFinite(dataIndex) ? dataIndex : -1,
        dataItem: result.dataItem,
      };
    },

    hitTestText(layer, pixel: Pixel): NativeLayerTextPick | null {
      // 官方回包是 `TextLayerItem | null`（`visualization/TextLayer.d.ts:289`），形状与
      // `hitTest` 那条的 `{ dataIndex, dataItem }` **不同**：没有 `dataIndex`，多了
      // `text` / `width` / `height` / 显式 `point`。逐字段如实投影，不补下标（见
      // `NativeLayerTextPick` 的注释）。
      const { raw } = open(layer, "hitTestText");
      const result = sdkCall("NativeLayer.hitTestText", () =>
        callRequired(raw, "hitTest", pixel.x, pixel.y),
      ) as Record<string, unknown> | null | undefined;
      if (!result || typeof result !== "object") return null;
      // `point` 是官方 `BMap.Point`；换算成纯数据只在**原型是 Object.prototype** 时做
      // （与 `toRawPoint` 同一判据的镜像：那边是纯数据 → 构造器，这边是构造器 → 纯数据）。
      const rawPoint = result.point as { lng?: unknown; lat?: unknown } | undefined;
      const lng = Number(rawPoint?.lng);
      const lat = Number(rawPoint?.lat);
      const point =
        rawPoint && Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null;
      const id = result.id;
      return {
        point,
        // 官方声明 `text: string` / `width: number` / `height: number`；回包里读不到时
        // 如实给 `null` 而不是 `""` / `0`——`0` 宽度与「没给宽度」在业务上不是一回事。
        text: typeof result.text === "string" ? result.text : null,
        width: typeof result.width === "number" ? result.width : null,
        height: typeof result.height === "number" ? result.height : null,
        id: typeof id === "string" || typeof id === "number" ? id : null,
        properties: result.properties,
      };
    },

    /* ------------------------------------------------------------ TrackLine 播放 */
    // 六条命令共用 `open()` → `assertSupported()` → `invoke()`：不支持的 kind 显式失败，
    // 与其它操作同一口径。参数校验前置于 `sdkCall`（`BMAP_INVALID_ARGUMENT` 不碰 SDK）。

    start(layer) {
      const { raw, descriptor, kind } = open(layer, "start");
      invoke(raw, descriptor, kind, "start");
    },

    pause(layer) {
      const { raw, descriptor, kind } = open(layer, "pause");
      invoke(raw, descriptor, kind, "pause");
    },

    resume(layer) {
      const { raw, descriptor, kind } = open(layer, "resume");
      invoke(raw, descriptor, kind, "resume");
    },

    stop(layer) {
      const { raw, descriptor, kind } = open(layer, "stop");
      invoke(raw, descriptor, kind, "stop");
    },

    setSpeed(layer, speed) {
      // 校验前置于 SDK 调用：非法参数不是 SDK 失败，不该走 `sdkCall` 的错误归一。
      // 谓词与命令面共用（`trackLinePlayback.ts`），避免两处条件分叉。
      if (!isValidTrackLineSpeed(speed)) {
        throw new BMapError(
          "BMAP_INVALID_ARGUMENT",
          `NativeLayerDriver.setSpeed: 速度必须是有限正数，实际是 ${String(speed)}`,
          { engine: "jsapi-v4" },
        );
      }
      const { raw, descriptor, kind } = open(layer, "setSpeed");
      invoke(raw, descriptor, kind, "setSpeed", speed);
    },

    setProcess(layer, process) {
      // 官方参考面口径 0–1（含端点）；越界不静默 clamp——把非法值悄悄改成边界值会让调用方以为设置生效了
      if (!isValidTrackLineProcess(process)) {
        throw new BMapError(
          "BMAP_INVALID_ARGUMENT",
          `NativeLayerDriver.setProcess: 进度必须在 [0, 1] 内，实际是 ${String(process)}`,
          { engine: "jsapi-v4" },
        );
      }
      const { raw, descriptor, kind } = open(layer, "setProcess");
      invoke(raw, descriptor, kind, "setProcess", process);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* 官方类型一致性（类型层断言，零运行时开销）                                     */
/* -------------------------------------------------------------------------- */

type ExpectTrue<T extends true> = T;

/**
 * `declared: true` 的 kind，其构造器名必须真的在官方 `BMap` 命名空间上。
 *
 * 断言写成**逐成员分配式**（先对单个 kind 求条件类型，再取联合），而不是对联合整体判断：
 * 后者在「上游只补齐其中一部分声明」时会静默通过——`A | B extends keyof typeof BMap` 为
 * false，落到 `never` 分支上看起来也「对」。这里要求 union 的结果是 `never`，也就是
 * **每一个**都必须在官方声明里。
 */
type DeclaredNativeLayerKind = {
  [K in NativeLayerKind]: (typeof NATIVE_LAYER_DESCRIPTORS)[K]["declared"] extends true ? K : never;
}[NativeLayerKind];
type MissingDeclaredCtors = {
  [K in DeclaredNativeLayerKind]: (typeof NATIVE_LAYER_DESCRIPTORS)[K]["ctor"] extends keyof typeof BMap
    ? never
    : K;
}[DeclaredNativeLayerKind];
type _AssertDeclaredCtors = ExpectTrue<MissingDeclaredCtors extends never ? true : false>;

/**
 * 扩展 API 的构造器名在官方声明里**必须缺席**（上游补齐了就该把 `declared` 改成 `true`）。
 *
 * 同样逐成员判断：只补一个也让断言失败，而不是等四个都补齐才报错。
 */
type RuntimeNativeLayerKind = {
  [K in NativeLayerKind]: (typeof NATIVE_LAYER_DESCRIPTORS)[K]["declared"] extends false
    ? K
    : never;
}[NativeLayerKind];
type DeclaredRuntimeCtors = {
  [K in RuntimeNativeLayerKind]: (typeof NATIVE_LAYER_DESCRIPTORS)[K]["ctor"] extends keyof typeof BMap
    ? K
    : never;
}[RuntimeNativeLayerKind];
type _AssertRuntimeCtorsUndeclared = ExpectTrue<DeclaredRuntimeCtors extends never ? true : false>;
