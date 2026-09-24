/**
 * OverlayDriver
 *
 * 覆盖物构造器与字段级 setter 全部收进 Driver；组件只传领域值对象。
 * 具体 SDK 不支持的能力由 Capability 控制，Driver 不静默吞错。
 *
 * 本文件同时是**覆盖物属性元的单一事实源**（M3A2-OVERLAYS / issue #21）：
 * `OVERLAY_DESCRIPTORS` 逐键声明每个覆盖物的构造键、字段级 setter / 成对开关，以及
 * `mutable` / `recreate` / `unsupported` 的更新策略。组件因此不必再自己探测 raw SDK
 * 成员形状（例如「有没有 setIcon」），只要问 `OverlayDriver.updatePolicy()`。
 *
 * 分类口径（依据官方 4.0 API 参考 + `@baidumap/jsapi-v4-types@4.0.4`）：
 * - `mutable`：实例上有可用的**值型 setter** 或**成对 enable/disable 开关**，就地更新即可；
 * - `recreate`：只有构造选项，或实例上的 setter 不可安全使用（例：`Marker#setAnchor` 要等异步
 *   标注模块加载后才挂在实例上），必须重建实例才生效；
 * - `unsupported`：本引擎连构造选项都没有（或语义不在覆盖物上），必须换用别的 API。
 */
import type { Capability } from "../capability/catalog";
import type { Bounds, Pixel, Point, Size } from "./geometry";
import { HANDLE_BRAND } from "./handles";
import type {
  CircleHandle,
  InfoWindowHandle,
  LabelHandle,
  MapHandle,
  MarkerHandle,
  OverlayHandle,
  PolygonHandle,
  PolylineHandle,
  SdkHandle,
} from "./handles";

export type OverlayKind =
  | "marker"
  | "polyline"
  | "polygon"
  | "rectangle"
  | "circle"
  | "info-window"
  | "label"
  | "prism"
  | "marker3d"
  | "bezier-curve"
  | "custom-overlay"
  | "map-mask"
  | "ground-overlay"
  | "context-menu";

/** Marker 图标：内置名称或自定义图标描述 */
export type MarkerIconInput =
  | string
  | {
      imageUrl: string;
      size: Size;
      anchor?: Pixel;
      imageOffset?: Pixel;
      imageSize?: Size;
      printImageUrl?: string;
    };

export interface MarkerOptions {
  offset?: Pixel;
  title?: string;
  icon?: MarkerIconInput;
  zIndex?: number;
  rotation?: number;
  enableClicking?: boolean;
  enableDragging?: boolean;
  [key: string]: unknown;
}

export interface PathOptions {
  strokeColor?: string;
  strokeWeight?: number;
  strokeOpacity?: number;
  strokeStyle?: "solid" | "dashed" | "dotted";
  fillColor?: string;
  fillOpacity?: number;
  enableMassClear?: boolean;
  enableEditing?: boolean;
  enableClicking?: boolean;
  zIndex?: number;
  [key: string]: unknown;
}

export interface InfoWindowOptions {
  width?: number;
  height?: number;
  title?: string;
  offset?: Pixel;
  enableMaximize?: boolean;
  enableAutoPan?: boolean;
  enableCloseOnClick?: boolean;
  [key: string]: unknown;
}

export interface LabelOptions {
  position?: Point;
  offset?: Pixel;
  zIndex?: number;
  style?: Record<string, unknown>;
  enableMassClear?: boolean;
  [key: string]: unknown;
}

/**
 * 自定义 DOM 覆盖物（`CustomOverlay`）的领域选项。
 *
 * 刻意把**位置提为必填位置参数**（见 `OverlayDriver.createCustomOverlay`）：4.0 在
 * options 里读取 `point` 且缺 point 直接拒绝，把位置放进 options 只会把这个错误留到运行时。
 */
export interface CustomOverlayOptions {
  /** 相对锚点的像素偏移（v4 `offsetX` / `offsetY`） */
  offset?: Pixel;
  /** 锚点，取值 0–1（v4 `anchors: [x, y]`） */
  anchor?: Pixel;
  rotation?: number;
  minZoom?: number;
  maxZoom?: number;
  properties?: Record<string, unknown>;
  visible?: boolean;
  zIndex?: number;
  enableMassClear?: boolean;
  [key: string]: unknown;
}

export interface OverlayTarget {
  kind: "map" | "marker" | "clusterer" | "overlay";
  handle: SdkHandle<string>;
}

/* -------------------------------------------------------------------------- */
/* 属性分类（mutable / recreate / unsupported）                                 */
/* -------------------------------------------------------------------------- */

/** 属性的更新策略：就地更新、必须重建、本引擎不支持。 */
export type OverlayPropertyPolicy = "mutable" | "recreate" | "unsupported";

/**
 * 领域值 → v4 构造参数 / setter 入参的归一化方式。
 *
 * `raw` 表示原样透传（数字、字符串、布尔、样式对象）；`path` 与 `points` 的区别是前者允许
 * SDK 原生字符串路径（行政区边界名）。
 */
export type OverlayPropertyValueKind =
  | "raw"
  | "point"
  | "points"
  | "path"
  | "point-groups"
  | "bounds"
  | "size"
  | "icon";

/**
 * 「撤回」（有值 → 未表态）后回到 SDK 自身默认的**落点**（issue #138）。
 *
 * 这是**正交**于 `policy` 的一维：`policy` 回答「值变化时怎么办」，`revert` 回答
 * 「**这个值消失**了怎么办」。两者不能合并——把 `mutable` 降级成 `recreate` 会让
 * `zIndex: 5 → 7` 这种纯值变化也重建（每次变值一次重建的性能回退），而实际上
 * 5→7 完全可就地写。
 *
 * 唯一可选值是 `rebuild`（重建 ⇒ 构造期不传该键 ⇒ SDK 用自己的默认值）。这是**取证**后的
 * 结论，不是省事：逐字段核对 `@baidumap/jsapi-v4-types@4.0.4` 后，**没有**任何一种更省的落点：
 *
 * | 候选落点 | 为什么不可用 |
 * | --- | --- |
 * | 「可靠 getter 读回旧值再写回」 | getter 返回的是**当前值**，不是 SDK 默认值——没有 baseline 可恢复 |
 * | 「创建时快照一个 baseline」 | `create*` 总是把有值的 prop 传进构造器，快照到的就是 prop 自己的值，不是默认值 |
 * | `setter(undefined)` | 语义不是「恢复默认」而是「传一个 undefined 进去」，官方没有为它定义行为 |
 * | 猜一个 SDK 默认值 | 违反 Official-first 与 Evidence-before-abstraction：默认值会随版本变 |
 *
 * `zIndex` 是最能说明问题的一例：它在 8 个覆盖物类上有 `setZIndex`，在 **0** 个覆盖物类上有
 * `getZIndex`（只有 `layer/*` 有）。所有 `enable*` / `disable*` 成对开关也**一律没有**公开读回。
 * 见 ADR `2026-09-24-overlay-infowindow-vue-native-convergence` §5。
 */
export type OverlayPropertyRevert = "rebuild";

/** 该属性当前没有「撤回」元数据时的落点（与逐字段表的取值相同）。 */
export const DEFAULT_OVERLAY_PROPERTY_REVERT: OverlayPropertyRevert = "rebuild";

/**
 * 单个属性的元数据。
 *
 * 用**判别联合**约束「分类 → 必须携带哪些依据」：
 * - `mutable` 必须给出 `setter` 或成对 `toggle`（二选一，不能都没有），否则分类没有落点；
 * - `recreate` / `unsupported` 必须给出 `reason`，避免把一个「不知道为什么」的分类留进代码。
 *
 * `revert` 声明在**所有**变体上（理由与 `valueArgs` 相同：让 `spec.revert` 在判别联合上
 * 直接可读，调用点不必写类型断言）。
 */
export type OverlayPropertySpec =
  | {
      readonly name: string;
      readonly policy: "mutable";
      /** v4 构造 options 中的键；`null` / 省略表示构造期没有同名键 */
      readonly ctorKey?: string | null;
      readonly value?: OverlayPropertyValueKind;
      readonly setter: string;
    /**
     * 值型 setter 的常量尾随参数（例：`CustomOverlay#setPoint(point, true)` 的 `true`）。
     *
     * 声明在**所有**变体上（对成对开关 / recreate / unsupported 无意义）是为了让
     * `spec.valueArgs` 在判别联合上可读，而不必在每个调用点做类型断言。
     */
    readonly valueArgs?: readonly unknown[];
      readonly toggle?: never;
      /** 撤回（有值 → 未表态）后的落点，见 `OverlayPropertyRevert`。 */
      readonly revert?: OverlayPropertyRevert;
    }
  | {
      readonly name: string;
      readonly policy: "mutable";
      readonly ctorKey?: string | null;
      readonly value?: OverlayPropertyValueKind;
      readonly setter?: never;
      readonly valueArgs?: readonly unknown[];
      readonly toggle: readonly [enable: string, disable: string];
      /** 撤回（有值 → 未表态）后的落点，见 `OverlayPropertyRevert`。 */
      readonly revert?: OverlayPropertyRevert;
    }
  | {
      readonly name: string;
      readonly policy: "recreate";
      readonly ctorKey?: string | null;
      readonly reason: string;
      /** 构造期仍需要归一化的属性（例：`InfoWindowOptions.offset` 是 Size） */
      readonly value?: OverlayPropertyValueKind;
      readonly setter?: never;
      readonly toggle?: never;
      readonly valueArgs?: readonly unknown[];
      /** 撤回后的落点；与 `policy: "recreate"` 同义，写出来只为逐字段表的完整性。 */
      readonly revert?: OverlayPropertyRevert;
    }
  | {
      readonly name: string;
      readonly policy: "unsupported";
      readonly reason: string;
      readonly ctorKey?: null;
      readonly setter?: never;
      readonly toggle?: never;
      readonly value?: never;
      readonly valueArgs?: readonly unknown[];
      /** 撤回后的落点；`unsupported` 字段本来就不会被写入，因此这一格是空占位。 */
      readonly revert?: OverlayPropertyRevert;
    };

export interface OverlayDescriptor {
  readonly kind: OverlayKind;
  /**
   * 官方 SDK 构造器名（与 Capability Catalog 的 `rawMembers[0]` 同源）。
   *
   * 刻意**写成字面量**而不是从 catalog 派生：一是读起来一眼能看出构造入口，二是 `as const` 保留了
   * 字面量类型，`driver/jsapi-v4/overlays.ts` 才能用
   * `(typeof OVERLAY_DESCRIPTORS)[kind]["ctor"] extends keyof typeof BMap` 做官方类型一致性断言。
   * 两处漂移由 `src/driver/jsapi-v4/overlays.test.ts` 的同源断言守住。
   *
   * `marker3d` / `map-mask` 指向的构造器**不在** `@baidumap/jsapi-v4-types@4.0.4` 的类声明里
   * （`Marker3D` 只在 `const/Marker3DShapeType.d.ts` 的文档注释里出现过），属于运行时扩展；
   * 这类条目由 `driver/jsapi-v4/overlays.ts` 的类型断言显式排除，并且创建时走
   * 「结构性查找 + 缺失即显式失败」而不是静默降级。
   */
  readonly ctor: string;
  /** 语义能力 id；`map-mask` 在目录里没有对应能力，因此省略。 */
  readonly capability?: Capability;
  readonly properties: readonly OverlayPropertySpec[];
}

type CommonSpecInput = {
  readonly ctorKey?: string | null;
  readonly value?: OverlayPropertyValueKind;
  readonly valueArgs?: readonly unknown[];
};
type SpecInput = ReturnType<typeof mutateBy> | ReturnType<typeof toggleBy> | ReturnType<typeof recreate> | ReturnType<typeof unsupported>;

/** `mutable` + 值型 setter */
function mutateBy(setter: string, extra: CommonSpecInput = {}) {
  return { ...extra, policy: "mutable", setter } as const;
}

/** `mutable` + 成对 `enable*` / `disable*` 开关 */
function toggleBy(toggle: readonly [string, string], extra: CommonSpecInput = {}) {
  return { ...extra, policy: "mutable", toggle } as const;
}

/** `recreate`：只有构造选项、实例上没有 setter */
function recreate(reason: string, extra: CommonSpecInput = {}) {
  return { ...extra, policy: "recreate", reason } as const;
}

/** `unsupported`：本引擎连构造选项都没有，或语义不在覆盖物上 */
function unsupported(reason: string) {
  return { policy: "unsupported", reason } as const;
}

function properties(specs: Record<string, SpecInput>): readonly OverlayPropertySpec[] {
  return Object.entries(specs).map(([name, spec]) => ({ name, ...spec }));
}

/** 标记图形类覆盖物（Polyline / Polygon / Rectangle / Circle）共享的样式与开关。 */
const PATH_STYLE: Record<string, SpecInput> = {
  strokeColor: mutateBy("setStrokeColor", { ctorKey: "strokeColor" }),
  strokeWeight: mutateBy("setStrokeWeight", { ctorKey: "strokeWeight" }),
  strokeOpacity: mutateBy("setStrokeOpacity", { ctorKey: "strokeOpacity" }),
  strokeStyle: mutateBy("setStrokeStyle", { ctorKey: "strokeStyle" }),
  zIndex: mutateBy("setZIndex", { ctorKey: "zIndex" }),
  enableMassClear: toggleBy(["enableMassClear", "disableMassClear"], { ctorKey: "enableMassClear" }),
  enableEditing: toggleBy(["enableEditing", "disableEditing"], { ctorKey: "enableEditing" }),
  enableClicking: recreate(
    "官方 4.0 的 Polyline/Polygon/Rectangle/Circle 都只有构造选项 enableClicking，实例上没有 setEnableClicking/disableClicking",
    { ctorKey: "enableClicking" },
  ),
};

const FILL_STYLE: Record<string, SpecInput> = {
  fillColor: mutateBy("setFillColor", { ctorKey: "fillColor" }),
  fillOpacity: mutateBy("setFillOpacity", { ctorKey: "fillOpacity" }),
};

/**
 * 覆盖物属性元数据（单一事实源）。
 *
 * 组件侧不再需要 `if (typeof raw.setIcon === "function")` 这类形状探测：问
 * `OverlayDriver.updatePolicy(overlay, key)` 即可拿到 `mutable` / `recreate` / `unsupported`。
 *
 * 声明成 `as const satisfies Record<OverlayKind, OverlayDescriptor>`：
 * - `satisfies` 保证**穷举**与形状（漏一个 kind、少一个 `reason` 都过不了类型检查）；
 * - `as const` 保留 `ctor` 的字符串字面量，`driver/jsapi-v4/overlays.ts` 才能用
 *   `(typeof OVERLAY_DESCRIPTORS)[kind]["ctor"] extends keyof typeof BMap` 做官方类型一致性断言。
 */
export const OVERLAY_DESCRIPTORS = {
  marker: {
    kind: "marker",
    ctor: "Marker",
    capability: "overlay.marker",
    properties: properties({
      // position 是构造期第一个位置参数（`new Marker(point, opts)`），不是 options 键
      position: mutateBy("setPosition", { ctorKey: null, value: "point" }),
      offset: mutateBy("setOffset", { ctorKey: "offset", value: "size" }),
      title: mutateBy("setTitle", { ctorKey: "title" }),
      icon: mutateBy("setIcon", { ctorKey: "icon", value: "icon" }),
      zIndex: mutateBy("setZIndex", { ctorKey: "zIndex" }),
      rotation: mutateBy("setRotation", { ctorKey: "rotation" }),
      enableDragging: toggleBy(["enableDragging", "disableDragging"], { ctorKey: "enableDragging" }),
      enableMassClear: toggleBy(["enableMassClear", "disableMassClear"], { ctorKey: "enableMassClear" }),
      enableClicking: recreate(
        "4.0 的 Marker 只有构造选项 enableClicking，没有 setEnableClicking；运行时另有 clickable 字段，但它只影响指针样式、不影响点击事件派发",
        { ctorKey: "enableClicking" },
      ),
      anchor: recreate(
        "官方说明：setAnchor 只在异步标注模块加载之后才挂到实例上，构造后立刻调用可能抛 TypeError，因此锚点固定为构造期选项（值为 BMAP_ANCHOR_* 常量，不是 Size）",
        { ctorKey: "anchor" },
      ),
    }),
  },

  label: {
    kind: "label",
    ctor: "Label",
    capability: "overlay.label",
    properties: properties({
      // content 是构造期第一个位置参数
      content: mutateBy("setContent", { ctorKey: null }),
      position: mutateBy("setPosition", { ctorKey: "position", value: "point" }),
      offset: mutateBy("setOffset", { ctorKey: "offset", value: "size" }),
      // v4 的 Label 用复数 setStyles（webgl-v1 的 BMapGL 用单数 setStyle），构造键是 styles
      style: mutateBy("setStyles", { ctorKey: "styles" }),
      opacity: mutateBy("setOpacity", { ctorKey: null }),
      zIndex: mutateBy("setZIndex", { ctorKey: null }),
      title: mutateBy("setTitle", { ctorKey: "title" }),
      anchor: mutateBy("setAnchor", { ctorKey: "anchor" }),
      enableMassClear: toggleBy(["enableMassClear", "disableMassClear"], { ctorKey: "enableMassClear" }),
      enableClicking: recreate(
        "4.0 的 Label 只有构造选项 enableClicking，实例上没有对应的成对开关",
        { ctorKey: "enableClicking" },
      ),
    }),
  },

  "info-window": {
    kind: "info-window",
    ctor: "InfoWindow",
    capability: "overlay.info-window",
    properties: properties({
      // content 是构造期第一个位置参数
      content: mutateBy("setContent", { ctorKey: null }),
      width: mutateBy("setWidth", { ctorKey: "width" }),
      height: mutateBy("setHeight", { ctorKey: "height" }),
      maxWidth: mutateBy("setMaxWidth", { ctorKey: "maxWidth" }),
      maxContent: mutateBy("setMaxContent", { ctorKey: "maxContent" }),
      title: mutateBy("setTitle", { ctorKey: "title" }),
      redraw: mutateBy("redraw", { ctorKey: null }),
      enableMaximize: toggleBy(["enableMaximize", "disableMaximize"], { ctorKey: "enableMaximize" }),
      enableAutoPan: toggleBy(["enableAutoPan", "disableAutoPan"], { ctorKey: "enableAutoPan" }),
      enableCloseOnClick: toggleBy(
        ["enableCloseOnClick", "disableCloseOnClick"],
        { ctorKey: "enableCloseOnClick" },
      ),
      offset: recreate(
        "InfoWindow 只有 getOffset()：官方 4.0 参考与 4.0.4 类型包都没有 setOffset，像素偏移只能在构造期给定",
        { ctorKey: "offset", value: "size" },
      ),
      position: unsupported(
        "气泡的打开位置由 openInfoWindow(map, infoWindow, position) 提供；InfoWindow 构造期与实例上都没有 setPosition",
      ),
      // `open` 与 `position` 是同一类：**不是 SDK 属性**，而是本库状态机持有的语义。
      // 登记在这里（而不是「干脆不写」）有两个理由：① 「为什么不走实例属性」只有这一处事实源；
      // ② 正典 prop 必须能在描述符里查到（`overlay-suite` 的门禁），
      //    而 `InfoWindow` 的旧名 `show` 的正典就是 `open` —— 与 `position` 用同一套口径。
      open: unsupported(
        "气泡的打开状态由地图级 openInfoWindow(map, infoWindow, position) 与 closeInfoWindow() 表达；InfoWindow 实例上没有 open 属性或 setter",
      ),
    }),
  },

  polyline: {
    kind: "polyline",
    ctor: "Polyline",
    capability: "overlay.polyline",
    properties: properties({
      path: mutateBy("setPath", { ctorKey: null, value: "path" }),
      ...PATH_STYLE,
      fillColor: unsupported("Polyline 没有填充：4.0 的 Polyline 只有描边 setter，没有 setFillColor"),
      fillOpacity: unsupported("Polyline 没有填充：4.0 的 Polyline 只有描边 setter，没有 setFillOpacity"),
    }),
  },

  polygon: {
    kind: "polygon",
    ctor: "Polygon",
    capability: "overlay.polygon",
    properties: properties({
      path: mutateBy("setPath", { ctorKey: null, value: "path" }),
      // isBoundary 允许 SDK 原生字符串路径（如行政区边界名），构造期生效
      isBoundary: recreate("isBoundary 只在构造期生效；路径本身用 setPath 更新", { ctorKey: "isBoundary" }),
      ...PATH_STYLE,
      ...FILL_STYLE,
    }),
  },

  rectangle: {
    kind: "rectangle",
    ctor: "Rectangle",
    capability: "overlay.rectangle",
    properties: properties({
      bounds: mutateBy("setBounds", { ctorKey: null, value: "bounds" }),
      ...PATH_STYLE,
      ...FILL_STYLE,
    }),
  },

  circle: {
    kind: "circle",
    ctor: "Circle",
    capability: "overlay.circle",
    properties: properties({
      center: mutateBy("setCenter", { ctorKey: null, value: "point" }),
      radius: mutateBy("setRadius", { ctorKey: null }),
      ...PATH_STYLE,
      ...FILL_STYLE,
    }),
  },

  "ground-overlay": {
    kind: "ground-overlay",
    ctor: "GroundOverlay",
    capability: "overlay.ground",
    properties: properties({
      bounds: mutateBy("setBounds", { ctorKey: null, value: "bounds" }),
      opacity: mutateBy("setOpacity", { ctorKey: "opacity" }),
      url: mutateBy("setImage", { ctorKey: "url" }),
      displayOnMinLevel: mutateBy("setDisplayOnMinLevel", { ctorKey: "displayOnMinLevel" }),
      displayOnMaxLevel: mutateBy("setDisplayOnMaxLevel", { ctorKey: "displayOnMaxLevel" }),
      zIndex: mutateBy("setZIndex", { ctorKey: "zIndex" }),
      enableMassClear: toggleBy(["enableMassClear", "disableMassClear"], { ctorKey: "enableMassClear" }),
      enableClicking: recreate(
        "4.0 的 GroundOverlay 只有构造选项 enableClicking，实例上没有对应的成对开关",
        { ctorKey: "enableClicking" },
      ),
      // M5-VECTORS / #31：组件的两个组件侧行为/构造期选项显式分类（此前落在「未知键」分支）
      type: recreate(
        "`GroundOverlayOptions.type`（image / video / canvas）只在构造期读取：实例上没有 setType，换类型必须重建（不同 type 的 url 语义也不同）",
        { ctorKey: "type" },
      ),
      autoCenter: recreate(
        "组件侧行为（创建后按显示区域居中地图，走 `Map#setViewport`，**不是** SDK 选项）：它描述的是「创建完成时做什么」，因此只在创建时生效，变化即重建以复现一次",
        { ctorKey: null },
      ),
    }),
  },

  prism: {
    kind: "prism",
    ctor: "Prism",
    capability: "overlay.prism",
    properties: properties({
      path: mutateBy("setPath", { ctorKey: null, value: "path" }),
      altitude: mutateBy("setAltitude", { ctorKey: null }),
      topFillColor: mutateBy("setTopFillColor", { ctorKey: "topFillColor" }),
      topFillOpacity: mutateBy("setTopFillOpacity", { ctorKey: "topFillOpacity" }),
      sideFillColor: mutateBy("setSideFillColor", { ctorKey: "sideFillColor" }),
      sideFillOpacity: mutateBy("setSideFillOpacity", { ctorKey: "sideFillOpacity" }),
      zIndex: mutateBy("setZIndex", { ctorKey: "zIndex" }),
      enableMassClear: toggleBy(["enableMassClear", "disableMassClear"], { ctorKey: "enableMassClear" }),
      enableClicking: recreate(
        "4.0 的 Prism 只有构造选项 enableClicking；官方参考同时说明 Prism 不实现编辑能力",
        { ctorKey: "enableClicking" },
      ),
      // M5-VECTORS / #31：这两个键**不在** `@baidumap/jsapi-v4-types@4.0.4` 的 `PrismOptions` 里。
      // 组件的 v2 兼容 prop 仍然原样交给构造期（迁移前的行为），但分类必须是 `recreate` 而不是
      // `mutable`：既没有字段级 setter，也没有证据表明运行时读取它——因此这里如实记下「未取证」，
      // 而不是把它写成「支持」（不静默伪造能力）。
      isBoundary: recreate(
        "**未取证**：PrismOptions（4.0.4）里没有 isBoundary，4.0 运行时是否读取它没有证据；组件保留 v2 的构造期透传，但不声明字段级更新",
        { ctorKey: "isBoundary" },
      ),
      autoCenter: recreate(
        "**未取证**：PrismOptions（4.0.4）里没有 autoCenter；理由同 isBoundary（构造期透传）",
        { ctorKey: "autoCenter" },
      ),
    }),
  },

  "bezier-curve": {
    kind: "bezier-curve",
    ctor: "BezierCurve",
    capability: "overlay.bezier-curve",
    properties: properties({
      path: mutateBy("setPath", { ctorKey: null, value: "path" }),
      controlPoints: mutateBy("setControlPoints", { ctorKey: null, value: "point-groups" }),
      strokeColor: mutateBy("setStrokeColor", { ctorKey: "strokeColor" }),
      strokeWeight: mutateBy("setStrokeWeight", { ctorKey: "strokeWeight" }),
      strokeOpacity: mutateBy("setStrokeOpacity", { ctorKey: "strokeOpacity" }),
      strokeStyle: mutateBy("setStrokeStyle", { ctorKey: "strokeStyle" }),
      zIndex: mutateBy("setZIndex", { ctorKey: "zIndex" }),
      enableMassClear: toggleBy(["enableMassClear", "disableMassClear"], { ctorKey: "enableMassClear" }),
      enableClicking: recreate(
        "4.0 的 BezierCurve 只有构造选项 enableClicking，实例上没有对应的成对开关",
        { ctorKey: "enableClicking" },
      ),
    }),
  },

  "custom-overlay": {
    kind: "custom-overlay",
    ctor: "CustomOverlay",
    capability: "overlay.custom-dom",
    properties: properties({
      // 第二参数 `true` = 只位移、不重建 DOM（官方默认 false 会重建）。专用入口与通用入口
      // 必须走同一份 `valueArgs`，否则 `setOptions({ position })` 会悄悄换掉业务 DOM。
      position: mutateBy("setPoint", { ctorKey: null, value: "point", valueArgs: [true] }),
      rotation: mutateBy("setRotation", { ctorKey: "rotationInit" }),
      properties: mutateBy("setProperties", { ctorKey: "properties" }),
      visible: toggleBy(["show", "hide"], { ctorKey: "visible" }),
      // 公共 `CustomOverlayOptions` 已声明、构造期生效、实例上没有 setter 的键
      // （PR #61 评审 P2-4：此前没有分类，更新会落到未知 setter 推导并只告警）
      anchor: recreate(
        "anchors 是构造选项（`CustomOverlayOptions.anchors`），实例上没有 setAnchor",
        { ctorKey: null },
      ),
      offset: recreate(
        "offsetX / offsetY 是构造选项，实例上没有 setOffset",
        { ctorKey: null },
      ),
      minZoom: recreate("minZoom 是构造选项，实例上没有 setMinZoom", { ctorKey: "minZoom" }),
      maxZoom: recreate("maxZoom 是构造选项，实例上没有 setMaxZoom", { ctorKey: "maxZoom" }),
      zIndex: recreate(
        "4.0 的 CustomOverlayOptions 有 zIndex，但实例上没有 setZIndex，层级只能在构造期确定",
        { ctorKey: "zIndex" },
      ),
      enableMassClear: recreate(
        "官方参考明确：CustomOverlay 的 enableMassClear: false 当前不生效，实例仍会参与 map.clearOverlays()，因此不做就地开关",
        { ctorKey: "enableMassClear" },
      ),
    }),
  },

  "context-menu": {
    kind: "context-menu",
    ctor: "ContextMenu",
    capability: "overlay.context-menu",
    properties: properties({
      // ⚠️ 组件侧的 `visible` **不是**这里这条 `show`/`hide`：组件的语义是「菜单是否挂到目标上」
      // （走 `attachContextMenu` / `detachContextMenu`），而实例的 `show()` 只是「在上一次右键的
      // 位置把弹层显示出来」。两者都叫 visible 但指的不是同一件事，偏离记在 ADR
      // `2026-09-19-custom-overlay-and-context-menu` 的已知限制里。
      visible: toggleBy(["show", "hide"], { ctorKey: null }),
      width: unsupported(
        "宽度是 MenuItem 的构造选项（MenuItemOptions.width），ContextMenu 实例上没有宽度 setter；组件侧因此走「重建菜单」路径",
      ),
      items: unsupported(
        "菜单项经 addItem/removeItem 管理（没有整袋替换入口），且 MenuItem 的 disable 之后无法再 enable、也没有读回；" +
          "组件侧因此走「原子重建菜单」路径——数据 API 的 items 与声明式 <MenuItem> 都归一化到同一份条目",
      ),
    }),
  },

  // 以下两类的构造器**不在**官方类型包里，但真实 4.0 运行时提供。描述符按**运行时实测**填写：
  // 只有核对过的方法才写进来，未映射的键仍可经 `setOptions` 的 `set<Key>` 逃生口使用。
  marker3d: {
    kind: "marker3d",
    ctor: "Marker3D",
    capability: "overlay.marker-3d",
    properties: properties({
      // AK smoke 实测 `Marker3D.prototype`：setPoint/getPoint/setPosition/getPosition/setZIndex/
      // setIcon/setHeight/setFillColor/setFillOpacity 都存在。
      // **但位置入口是 `setPoint`，不是 `setPosition`**：实测 `setPoint(new Point(116.42, 39.93))`
      // 之后 `getPosition()` 回读 116.42/39.93；而 `setPosition(point)`（以及 `setPosition(lng, lat)`、
      // 传 MC 点）都会把经纬度写坏成 `-43.87, 84.65`（`setPosition(lng, lat)` 还会抛 TypeError）。
      // 因此这里映射到 setPoint —— 按 PR #61 评审 P2-3 的建议补入口，但不能照抄方法名。
      position: mutateBy("setPoint", { ctorKey: null, value: "point" }),
    }),
  },

  // `MapMask` 在真实运行时提供 setOptions / setZIndex / setPoints / setPathIn（**没有** setPath）。
  // 本仓库 `<MapMask>` 的 path 更新走 `rebuild()`，因此这里不映射任何键；
  // 若将来要从 Facet 侧更新掩膜，应先核对 `setPoints` / `setOptions` 的语义再补。
  "map-mask": {
    kind: "map-mask",
    ctor: "MapMask",
    properties: properties({}),
  },
} as const satisfies Record<OverlayKind, OverlayDescriptor>;

export function overlayDescriptor(kind: OverlayKind): OverlayDescriptor {
  return OVERLAY_DESCRIPTORS[kind];
}

export function overlayPropertySpec(
  kind: OverlayKind,
  key: string,
): OverlayPropertySpec | undefined {
  return OVERLAY_DESCRIPTORS[kind].properties.find((spec) => spec.name === key);
}

/** 属性更新策略查询；未知键返回 `undefined`（表示走 Driver 的逃生口）。 */
export function overlayPropertyPolicy(
  kind: OverlayKind,
  key: string,
): OverlayPropertyPolicy | undefined {
  return overlayPropertySpec(kind, key)?.policy;
}

/**
 * `mutable` 属性的**值型 setter** 名（判别联合的收窄集中在这里，调用点不必写类型断言）。
 * 不是 `mutable`、或该属性走成对开关时返回 `undefined`。
 */
export function mutableSetter(spec: OverlayPropertySpec): string | undefined {
  return spec.policy === "mutable" ? spec.setter : undefined;
}

/**
 * `mutable` 属性的**成对开关**方法名 `[enable, disable]`。
 * 不是 `mutable`、或该属性走值型 setter 时返回 `undefined`。
 */
export function mutableToggle(
  spec: OverlayPropertySpec,
): readonly [string, string] | undefined {
  return spec.policy === "mutable" ? spec.toggle : undefined;
}

/**
 * 属性**撤回**（有值 → 未表态）后的落点；未声明时取 `DEFAULT_OVERLAY_PROPERTY_REVERT`。
 *
 * 未知键（`undefined` 的 spec）返回 `undefined`：**不猜**。逃生口键没有逐字段依据，
 * 它是否需要重建由调用方自己决定——这与 `overlayPropertyPolicy` 对未知键的处理是同一条口径。
 */
export function overlayPropertyRevert(
  kind: OverlayKind,
  key: string,
): OverlayPropertyRevert | undefined {
  const spec = overlayPropertySpec(kind, key);
  // 未知键返回 `undefined` 而不是默认值：**不猜**。逃生口键（不在描述符里）没有逐字段依据，
  // 它是否需要撤回由调用方自己决定——与 `overlayPropertyPolicy` 对未知键的处理同一条口径。
  if (!spec) return undefined;
  return spec.revert ?? DEFAULT_OVERLAY_PROPERTY_REVERT;
}

/* ------------------------------------------------- 逐字段「撤回」依据表（issue #138）
 *
 * 「值消失 ⇒ 重建」是唯一落点（依据见 `OverlayPropertyRevert`），但**每个字段为什么**只能
 * 这样，值得逐条写下来：这张表就是 issue 要求的「baseline restore 策略有逐字段测试」的载体。
 *
 * 判据只有两条，逐字段都落到其中一条：
 * - **有可靠 getter 且 baseline 可得** ⇒ 经 getter 恢复（本表为空，见下）；
 * - 其余（无 getter / 有 getter 但 baseline 无从取得）⇒ 重建。
 *
 * 「有 getter 但 baseline 无从取得」是本表最重要的一类：`Marker#offset` / `Marker#rotation` /
 * `Marker#title` 都有公开读回，但读回的是**当前值**（此刻正等于我们刚写进去的那个值），
 * 而不是 SDK 的默认值。`create*` 又总是把有值的 prop 传进构造器，所以「创建时快照」拿到的
 * 也是 prop 自己的值。因此**没有任何一条能便宜地撤回**。
 */
export const OVERLAY_REVERT_RATIONALE = {
  // ——— 没有公开读回 ———
  zIndex:
    "4.0.4 的 8 个覆盖物类上都有 setZIndex，但**没有一个**有 getZIndex（只有 layer/* 有）" +
    "⇒ 无从读回，也没有 baseline 可恢复 ⇒ 重建",
  enableDragging: "enableDragging / disableDragging 成对开关，4.0.4 **没有**公开读回 ⇒ 重建",
  enableMassClear: "enableMassClear / disableMassClear 成对开关，4.0.4 **没有**公开读回 ⇒ 重建",
  enableEditing: "enableEditing / disableEditing 成对开关，4.0.4 **没有**公开读回 ⇒ 重建",
  enableClicking:
    "只有构造选项 enableClicking（4.0.4 在 Marker 与图形族上都没有 setEnableClicking/disableClicking）" +
    "⇒ policy 已是 recreate，撤回同样是重建",
  enableMaximize: "InfoWindow 的 enableMaximize 只有构造选项，实例上无 setter 也无读回 ⇒ 重建",
  enableAutoPan: "InfoWindow 的 enableAutoPan 只有构造选项，实例上无 setter 也无读回 ⇒ 重建",
  enableCloseOnClick:
    "InfoWindow 的 enableCloseOnClick 只有构造选项，实例上无 setter 也无读回 ⇒ 重建",
  // ——— 有读回，但 baseline 无从取得（getter 给的是当前值）———
  position:
    "InfoWindow 的 position 根本不是 SDK 属性（打开位置由 map.openInfoWindow 的 point 参数提供）；" +
    "其余覆盖物的位置由组件侧 position 模型保证，撤回时重建由「构造期第一个位置参数」本身决定" +
    "⇒ 落点仍是重建",
  content:
    "Label 的 content 是**必填**构造参数（`new Label(content, opts)`），不是可撤的 option；" +
    "InfoWindow 的 content 同理（`new InfoWindow(el, opts)`，`setContent` 只在部分运行时有）；" +
    "policy 已是 recreate，撤回落点与之一致",
  redraw:
    "**不是属性**：`redraw()` 没有参数、没有对应构造选项，是「重画一遍」这个动作。" +
    "登记它只是为了让 InfoWindow 的 `setOptions` 有一条显式的落点（大小变化后重绘）" +
    "⇒ 不存在「值消失」这件事，落点无意义",
  points:
    "图形族的顶点列表是**必填**构造参数（createPolyline(path)），不是可撤的 option；" +
    "路径变更本来就由 `versioned` 源强制重建（policy 为 recreate）",
  path: "同上：路径是必填构造参数，policy 已是 recreate，撤回落点与之一致",
  offset:
    "Marker#offset / Label#offset 有 getOffset，但它返回**当前值**（此刻正等于我们写进去的），" +
    "不是 SDK 默认值；构造期又总把有值 prop 传进去，创建快照也是 prop 自己的值 ⇒ 重建",
  rotation:
    "Marker#getRotation 返回**当前值**而非默认值；无 baseline 可取 ⇒ 重建",
  title: "Marker#getTitle / Label#getTitle 返回**当前值**而非默认值；无 baseline 可取 ⇒ 重建",
  icon:
    "Marker#getIcon 返回**当前值**而非默认图标（默认图标是 SDK 内置的 unnamed icon，无从构造）" +
    "⇒ 重建",
  style: "Label#setStyles 有 getter 但返回当前值；默认样式由 SDK 内部决定、无从构造 ⇒ 重建",
  opacity: "Label#setOpacity 在 4.0.4 **没有**公开读回 ⇒ 重建",
  anchor: "Marker#anchor 只有构造选项（上游要等异步标注模块加载才挂 setter，不安全）⇒ 重建",
  strokeColor: "图形族有 getStrokeColor，但返回当前值而非 SDK 默认色 ⇒ 重建",
  strokeWeight: "图形族有 getStrokeWeight，但返回当前值而非 SDK 默认线宽 ⇒ 重建",
  strokeOpacity: "图形族有 getStrokeOpacity，但返回当前值而非 SDK 默认透明度 ⇒ 重建",
  strokeStyle: "图形族有 getStrokeStyle，但返回当前值而非 SDK 默认线型 ⇒ 重建",
  fillColor: "图形族有 getFillColor，但返回当前值而非 SDK 默认填充色 ⇒ 重建",
  fillOpacity: "图形族有 getFillOpacity，但返回当前值而非 SDK 默认填充透明度 ⇒ 重建",
  width: "InfoWindow 的 width 只有构造选项；4.0.4 无 setWidth 也无 getWidth ⇒ 重建",
  height: "InfoWindow 的 height 只有构造选项；4.0.4 无 setHeight 也无 getHeight ⇒ 重建",
  maxWidth: "InfoWindow 的 maxWidth 只有构造选项；4.0.4 无对应读回 ⇒ 重建",
  maxContent: "InfoWindow 的 maxContent 只有构造选项；4.0.4 无对应读回 ⇒ 重建",
  // ——— 必填构造参数（与 position / content 同理）———
  bounds:
    "Rectangle 的 bounds 是**必填**构造参数（`new Rectangle(bounds, opts)`）；" +
    "有 getBounds，但返回当前值而非默认范围 ⇒ 落点仍是重建",
  center: "Circle 的 center 是**必填**构造参数（`new Circle(center, radius, opts)`）⇒ 重建",
  radius: "Circle 的 radius 是**必填**构造参数（`new Circle(center, radius, opts)`）⇒ 重建",
  altitude: "Prism 的 altitude 是**必填**构造参数（`new Prism(path, altitude, opts)`）⇒ 重建",
  controlPoints:
    "BezierCurve 的 controlPoints 是必填构造参数，policy 已是 recreate ⇒ 落点与之一致",
  // ——— 只有构造选项的视图类属性（policy 多为 recreate）———
  isBoundary:
    "Polygon 的 isBoundary 决定路径是真实坐标还是行政区边界名，实例上无 setter 也无读回" +
    "（切过去会画错东西）⇒ 重建",
  minZoom: "CustomOverlay 的 minZoom 只有构造选项；实例上无 setter，也无稳定的公开读回 ⇒ 重建",
  maxZoom: "CustomOverlay 的 maxZoom 只有构造选项；实例上无 setter，也无稳定的公开读回 ⇒ 重建",
  type:
    "GroundOverlay 的 type（图片 / 视频 / canvas 渲染类型）只有构造选项，决定内容如何被解释，" +
    "实例上无 setter ⇒ 重建",
  displayOnMinLevel:
    "GroundOverlay 的 displayOnMinLevel 只有构造选项（4.0.4 无对应 setter / getter）⇒ 重建",
  displayOnMaxLevel:
    "GroundOverlay 的 displayOnMaxLevel 只有构造选项（4.0.4 无对应 setter / getter）⇒ 重建",
  autoCenter:
    "**不是 SDK 属性**：GroundOverlay.autoCenter 是本库的组件侧语义（按显示区域居中地图），" +
    "走 afterMount 里的 map.setViewport ⇒ 不存在「值消失」，落点无意义",
  visible:
    "**不是 SDK 属性**：可见性由继承来的 show/hide 表达（没有构造选项、也没有 setter），" +
    "policy 是组件侧的 `visibility` 策略 ⇒ 不存在「值消失」，落点无意义",
  // ——— 开放形状（字段随 SDK 版本增减）———
  url:
    "GroundOverlay 的 url 接受 string / HTMLCanvasElement / 惰性工厂；setImage 接受真实来源。" +
    "SDK 默认是「空内容」，无从构造一个「默认 url」⇒ 重建",
  properties:
    "CustomOverlay 的 properties 是传给业务渲染的开放字典；默认是「空字典」，" +
    "实例上无 getter（4.0.4 只在 CustomOverlay 上声明了带 point/pixel 的事件，没有读回）⇒ 重建",
  topFillColor:
    "Prism 的 topFillColor 有 getTopFillColor，但返回当前值而非 SDK 默认色 ⇒ 重建",
  topFillOpacity:
    "Prism 的 topFillOpacity 有 getTopFillOpacity，但返回当前值而非默认透明度 ⇒ 重建",
  sideFillColor:
    "Prism 的 sideFillColor 有 getSideFillColor，但返回当前值而非默认色 ⇒ 重建",
  sideFillOpacity:
    "Prism 的 sideFillOpacity 有 getSideFillOpacity，但返回当前值而非默认透明度 ⇒ 重建",
} as const satisfies Partial<Record<string, string>>;

const OVERLAY_KINDS = Object.keys(OVERLAY_DESCRIPTORS) as OverlayKind[];
const KIND_BY_BRAND = new Map<string, OverlayKind>(
  OVERLAY_KINDS.map((kind) => [`overlay:${kind}`, kind]),
);

/** 从 Handle 品牌解析覆盖物种类；不是覆盖物句柄（或种类未知）返回 `undefined`。 */
export function overlayKindOf(handle: SdkHandle<string>): OverlayKind | undefined {
  const brand = handle?.[HANDLE_BRAND];
  return typeof brand === "string" ? KIND_BY_BRAND.get(brand) : undefined;
}

export interface OverlayDriver {
  createMarker(position: Point, options?: MarkerOptions): MarkerHandle;
  createPolyline(path: readonly Point[], options?: PathOptions): PolylineHandle;
  /** isBoundary 时允许 SDK 原生字符串路径（如边界名称） */
  createPolygon(path: readonly (Point | string)[], options?: PathOptions & { isBoundary?: boolean }): PolygonHandle;
  createRectangle(bounds: Bounds, options?: PathOptions): OverlayHandle;
  createCircle(center: Point, radius: number, options?: PathOptions): CircleHandle;
  createInfoWindow(content: HTMLElement, options?: InfoWindowOptions): InfoWindowHandle;
  createLabel(content: string, options?: LabelOptions): LabelHandle;
  /** isBoundary 时允许 SDK 原生字符串路径 */
  createPrism(path: readonly (Point | string)[], altitude: number, options?: Record<string, unknown>): OverlayHandle;
  createMarker3D(position: Point, height: number, options?: Record<string, unknown>): OverlayHandle;
  createBezierCurve(
    path: readonly Point[],
    controlPoints: readonly (readonly Point[])[],
    options?: Record<string, unknown>,
  ): OverlayHandle;
  createMapMask(path: readonly Point[], options?: Record<string, unknown>): OverlayHandle;
  createGroundOverlay(bounds: Bounds, options?: Record<string, unknown>): OverlayHandle;
  /** 自定义 DOM 覆盖物：位置为必填参数（4.0 缺 point 会直接拒绝创建） */
  createCustomOverlay(
    position: Point,
    render: () => HTMLElement,
    options?: CustomOverlayOptions,
  ): OverlayHandle;
  createContextMenu(options?: { width?: number }): OverlayHandle;
  /**
   * 追加一条菜单项（`"-"` = 分隔线）。
   *
   * `options` 对应官方 `MenuItemOptions`（`@baidumap/jsapi-v4-types@4.0.4` 的
   * `context-menu/MenuItemOptions.d.ts`）：只有 `width` 与 `id` 两个键，两者都**只在构造期**生效
   * （`MenuItem` 实例上没有 `setWidth` / `setId`）。因此调用方要么在构造时给全，要么重建菜单。
   */
  addContextMenuItem(
    menu: OverlayHandle,
    item: { text: string; callback: (point: unknown, pixel: unknown) => void; disabled?: boolean } | "-",
    options?: { width?: number; id?: string },
  ): void;

  add(target: OverlayTarget, overlay: OverlayHandle): void;
  remove(target: OverlayTarget, overlay: OverlayHandle): void;

  /** 优先 SDK show/hide；返回是否真正应用（无 show/hide 能力时返回 false） */
  show(overlay: OverlayHandle): boolean;
  hide(overlay: OverlayHandle): boolean;

  /**
   * 把右键菜单挂到目标上。
   *
   * **目标只支持 `map` 与 `marker`**（M5-CUSTOM-MENU / issue #33）：
   * - `map` ⇒ `map.addContextMenu(menu)`：官方 4.0.4 的 `core/Map.d.ts` 有声明（签名只有一个
   *   参数，**没有**目标参数），右键地图时打开；
   * - `marker` ⇒ `marker.addContextMenu(menu)`：**运行时扩展**（类型包只在 `Map` 上声明，
   *   真实 4.0 的 `Marker` 上有且可用，实测读数见 ADR `2026-09-19-custom-overlay-and-context-menu`），
   *   只有右键**该标注**时才打开。
   *
   * 其余 kind 显式抛 `BMAP_CAPABILITY_UNSUPPORTED`（**不**回退到 map：那会变成「菜单在整张地图上
   * 冒出来」的另一种语义）。同一目标重复挂同一个菜单由 SDK 去重（真实 4.0 实测：挂三次、一次右键
   * 仍只派发一条 `open`），因此「无重复菜单」的判据落在**组件侧不重复下发命令**上。
   */
  attachContextMenu(target: OverlayTarget, menu: OverlayHandle): void;
  /** 摘除右键菜单。目标约束与 `attachContextMenu` 相同；摘除后 SDK 不再派发该菜单的 `open`。 */
  detachContextMenu(target: OverlayTarget, menu: OverlayHandle): void;

  setPosition(overlay: OverlayHandle, position: Point): void;
  setPath(overlay: OverlayHandle, path: readonly (Point | string)[]): void;
  setOptions(overlay: OverlayHandle, options: Record<string, unknown>): void;

  /**
   * 属性更新策略查询：`mutable` 就地更新、`recreate` 必须重建实例、`unsupported` 换 API。
   *
   * 这是组件判断「setOptions 还是 rebuild」的**唯一入口**（元数据见 `OVERLAY_DESCRIPTORS`），
   * 组件不再自行探测 raw SDK 的成员形状。未知键返回 `undefined`。
   */
  updatePolicy(overlay: OverlayHandle, key: string): OverlayPropertyPolicy | undefined;

  /**
   * 打开气泡。`position` 是**必需**参数。
   *
   * 官方 4.0 的打开入口是 `Map#openInfoWindow(infoWnd, point)`，`point` 没有默认值，`InfoWindow`
   * 实例也没有公开的 `openInfoWindow()`——因此「没有位置就打开」没有可解释的语义，本契约不允许它
   * 发生（实现里缺位置即抛 `BMAP_INVALID_ARGUMENT`）。「气泡挂到 Marker 的目标级打开」（位置来自
   * 标注）是另一条路径，属 M5 #31/#32。
   */
  openInfoWindow(map: MapHandle, overlay: InfoWindowHandle, position: Point): void;
  closeInfoWindow(overlay: InfoWindowHandle): void;
  redrawInfoWindow(overlay: InfoWindowHandle): void;
  /** 读当前气泡是不是这一个（`Map#getInfoWindow()` + handle 身份比对）。 */
  isCurrentInfoWindow(map: MapHandle, overlay: InfoWindowHandle): boolean;

  /** 构建 Marker Icon（供 useMarkerIcons 等业务复用） */
  buildIcon(icon: MarkerIconInput): unknown;
}

export type MapTarget = { kind: "map"; handle: MapHandle };
