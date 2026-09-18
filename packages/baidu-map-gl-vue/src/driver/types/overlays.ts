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
 * 单个属性的元数据。
 *
 * 用**判别联合**约束「分类 → 必须携带哪些依据」：
 * - `mutable` 必须给出 `setter` 或成对 `toggle`（二选一，不能都没有），否则分类没有落点；
 * - `recreate` / `unsupported` 必须给出 `reason`，避免把一个「不知道为什么」的分类留进代码。
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
    }
  | {
      readonly name: string;
      readonly policy: "mutable";
      readonly ctorKey?: string | null;
      readonly value?: OverlayPropertyValueKind;
      readonly setter?: never;
      readonly valueArgs?: readonly unknown[];
      readonly toggle: readonly [enable: string, disable: string];
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
      // ② 集中弃用层的别名表要求「正典 prop 必须能在描述符里查到」（`v3-overlay-suite` 的门禁），
      //    而 `BInfoWindow` 的旧名 `show` 的正典就是 `open` —— 与 `position` 用同一套口径。
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
      // 旧 prop 名 `startPoint` / `endPoint` **刻意不在这张表里**：它们由集中弃用层
      // （`core/deprecations`）在组件侧的读取层解析成正典的 `bounds`，从不作为独立字段下发。
      // 给它们写分类会让「这个键能不能经 setOptions 下发」看起来有两种答案。
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
      visible: toggleBy(["show", "hide"], { ctorKey: null }),
      width: unsupported(
        "宽度是 MenuItem 的构造选项（MenuItemOptions.width），ContextMenu 实例上没有宽度 setter",
      ),
      menuItems: unsupported("菜单项经 addItem/removeItem 管理，项目侧走重建菜单路径"),
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
  // 本仓库 `<BMapMask>` 的 path 更新走 `rebuild()`，因此这里不映射任何键；
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
  addContextMenuItem(
    menu: OverlayHandle,
    item: { text: string; callback: (point: unknown, pixel: unknown) => void; disabled?: boolean } | "-",
    options?: { width?: number },
  ): void;

  add(target: OverlayTarget, overlay: OverlayHandle): void;
  remove(target: OverlayTarget, overlay: OverlayHandle): void;

  /** 优先 SDK show/hide；返回是否真正应用（无 show/hide 能力时返回 false） */
  show(overlay: OverlayHandle): boolean;
  hide(overlay: OverlayHandle): boolean;

  attachContextMenu(target: OverlayTarget, menu: OverlayHandle): void;
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

  /** 构建 Marker Icon（供 useBMapMarkerIcons 等业务复用） */
  buildIcon(icon: MarkerIconInput): unknown;
}

export type MapTarget = { kind: "map"; handle: MapHandle };
