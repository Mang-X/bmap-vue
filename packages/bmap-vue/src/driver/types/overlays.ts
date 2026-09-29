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
 * 分类口径（依据官方 4.0 API 参考 + `@baidumap/jsapi-v4-types@4.0.5`）：
 * - `mutable`：实例上有可用的**值型 setter** 或**成对 enable/disable 开关**，就地更新即可；
 * - `recreate`：只有构造选项，或实例上的 setter 不可安全使用（例：`Marker#setAnchor` ——
 *   声明里有、settle **之后**实测也在**实例**上且调得动，但 `getAnchor()` 返回的是**当前值**、
 *   撤回没有落点，见下方 `anchor` 条目的完整依据），必须重建实例才生效；
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
  | "ground-point"
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
  /* --- issue #165 第三批：官方 `MarkerOptions` 16 个键里最后三个（此前没有出口）---
   *
   * `label` 收的是**本库领域形状**而不是 raw `BMap.Label`：组件面**不构造 SDK 对象**
   * （AGENTS.md 的 raw SDK 边界），Driver 在边界内把它变成 `BMap.Label` 再交给构造器 /
   * `setLabel`。三个键的分类逐条依据见 `OVERLAY_DESCRIPTORS.marker`。
   */
  /** 标注自带的文本标注（**领域形状**；Driver 负责造 `BMap.Label`）。可**就地更新**。 */
  label?: MarkerLabelInput;
  /** 是否自动跟随地图旋转角度联动（`@default false`）。**构造期**。 */
  autoFollowHeadingChanged?: boolean;
  /** 图标的入场动画名称（官方未声明候选值，收普通 `string`）。**构造期**。 */
  startAnimation?: string;
  [key: string]: unknown;
}

/**
 * `<Marker label>` 在 Driver 边界上的**领域形状**（issue #165 第三批）。
 *
 * 与 `types/components.ts` 的 `MarkerLabelSpec` 同形，两处分开放是因为这里要额外声明
 * `value` 归一化所需的几何类型（`Point` / `Pixel`）——组件层用 `{ lng, lat }` / `{ x, y }`。
 *
 * ⚠️ 它**不是** `LabelHandle` 也不是 raw `BMap.Label`：Driver 会为它建一个**从属**的
 * SDK `BMap.Label`，随 Marker 一起被 `removeOverlay` 释放（`BMap.Label` 挂在 Marker 上时
 * 不需要独立 `addOverlay`）——因此本库**不**为它建 Registry 记账，那会造出一个
 * 「谁负责摘它」的第四种答案。
 */
export interface MarkerLabelInput {
  content: string;
  position?: Point;
  offset?: Pixel;
  style?: Record<string, unknown>;
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
  /* --- issue #165 图形族补齐：官方在 4.0.5 的 `*Options` 里已声明、此前没有出口的构造期选项。
   *
   * 逐条依据与「哪些类有该项」的对照见本文件 `PATH_CTOR_*` 四张表的注释。
   *
   * ⚠️ 它们全部**没有**实例 setter（逐个核对 `overlay/<Class>.d.ts` 的成员表），
   * 因此分类一律是 `recreate`——改 prop 会**重建实例**。这不是本库的取舍，是上游的形状。
   *
   * 保留索引签名（`[key: string]: unknown`）不变：它是项目 option 接口的官方逃生口，
   * 去掉它会让「描述符里没有的构造选项」无法透传（`GroundOverlay.type` / `Prism.autoCenter` 走的就是它）。
   */
  /** 描边线端头（官方 `@default 'round'`）。构造期。 */
  strokeLineCap?: "round" | "butt" | "square";
  /** 描边线连接处（官方 `@default 'round'`）。构造期。 */
  strokeLineJoin?: "round" | "miter" | "bevel";
  /** 输入坐标的坐标类型（未设置时用全局 `BMap.coordType`）。构造期。 */
  coordType?: "BMAP_COORD_BD09" | "BMAP_COORD_GCJ02" | "BMAP_COORD_WGS84";
  /** 跨 180 度经线时是否按最短路径绘制（官方 `@default false`）。构造期。 */
  linkRight?: boolean;
  /** 虚线样式，如 `[8, 4]`（实线 8px、间隙 4px）。构造期。 */
  dashArray?: number[];
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
  /* --- issue #165 Class 3 / TASK 3：InfoWindow 缺的 8 个官方构造选项 ---
   *
   * 逐条来自 `@baidumap/jsapi-v4-types@4.0.5` 的 `overlay/InfoWindowOptions.d.ts`：
   * 本接口此前只收了 7 个键中的 6 个（`offset` 之外），
   * 而 `InfoWindowOptions` 官方一共 15 个键 ⇒ 8 个没有出口。
   *
   * 分类依据（`mutable` / `recreate` / `unsupported`）逐条写在
   * `OVERLAY_DESCRIPTORS["info-window"]` 的对应条目上。
   */
  /** 最大宽度（像素）。**可就地更新**（官方 `InfoWindow#setMaxWidth(width: number): void`）。 */
  maxWidth?: number;
  /**
   * 最大化时显示的内容（官方 `InfoWindowOptions.maxContent?: string`）。
   *
   * **不就地更新**：官方声明了 `InfoWindow#setMaxContent(content: string): void`
   * （见下一键），但**读回** `getContent()` 返回的是**普通内容**而不是最大化内容，
   * 因此「最大化时显示什么」没有公开读回 ⇒ 撤回只能重建（`OverlayPropertyRevert` 的
   * 判据之一）。更新本身走 `setMaxContent`（`mutable`）。
   */
  maxContent?: string;
  /**
   * 气泡与地图四边的最小间距（像素数组，官方 `margin?: number[]`，按 `[上, 右, 下, 左]`）。
   *
   * **构造期**：官方 `InfoWindow` 上**没有** `setMargin`，也没有读回。
   */
  margin?: number[];
  /**
   * 碰撞检测的边距（像素数组，官方 `collisions?: number[]`，同样按 `[上, 右, 下, 左]`）。
   *
   * **构造期**：官方 `InfoWindow` 上没有 `setCollisions`，也没有读回。
   */
  collisions?: number[];
  /**
   * 关闭前的回调（官方 `onClosing?: () => void`）。
   *
   * **构造期**：官方没有 `setOnClosing`。且它是**回调**——组件侧要跟随最新闭包就必须
   * 重建（与 `ControlSpec.options` 的同款理由，见 `core/controls/spec.ts` 的注释）。
   */
  onClosing?: () => void;
  /**
   * 是否显示搜索工具（官方 `enableSearchTool?: boolean`）。
   *
   * **构造期**：官方 `InfoWindow` 上没有对应的 setter。它是**渲染通道**（多一个工具条），
   * 与 `enableMaximize` 不同——后者有 `enableMaximize()` / `disableMaximize()` 成对开关。
   */
  enableSearchTool?: boolean;
  /**
   * 自定义标题栏内容（官方 `headerContent?: string`，支持 HTML）。
   *
   * **构造期**：官方没有 `setHeaderContent`，也没有读回。⚠️ 官方没有说明它与 `title`
   * 同时给时谁优先，因此本库**不表态**（两个都原样传下去，由 SDK 决定）。
   */
  headerContent?: string;
  /**
   * 内容超出时是否可滚动（官方 `enableContentScroll?: boolean`）。
   *
   * **构造期**：官方 `InfoWindow` 上没有 `setEnableContentScroll`，也没有读回。
   */
  enableContentScroll?: boolean;
  [key: string]: unknown;
}

export interface LabelOptions {
  position?: Point;
  offset?: Pixel;
  zIndex?: number;
  style?: Record<string, unknown>;
  enableMassClear?: boolean;
  /* --- issue #165 第三批：官方 `LabelOptions` 7 个键里最后两个（此前没有出口）---
   *
   * ⚠️ `anchor` 此前**已经在** `OVERLAY_DESCRIPTORS.label` 里登记为
   * `mutateBy("setAnchor", …)`，但 `LabelOptions` 没有对应字段、组件面也没有 prop ⇒
   * 那条更新路径**一次都没被触发过**。这里补的是**类型**与**组件出口**，不是新能力。
   * live 读数（2026-09-27，settle 之后）判 `setAnchor` **可观察地生效**（DOM 角点随锚点移动）
   * ⇒ `mutable` 成立。
   */
  /** 锚点，**官方常量名**（`BMAP_ANCHOR_*` 九选一；Driver 内换成官方数值）。可**就地更新**。 */
  anchor?: OverlayAnchorName;
  /** 文本宽度（像素，`@default 0` = 按内容自适应）。**构造期**（官方无 `setWidth`）。 */
  width?: number;
  [key: string]: unknown;
}

/**
 * 锚点的**官方常量名**（`const/Anchor.d.ts` 的九个 `BMAP_ANCHOR_*`）。
 *
 * 收**名字**而不是数值：九个数里 `0`（`TOP_LEFT`）/ `6`（`CENTER`）/ `8`（`BOTTOM_CENTER`）
 * 在业务上完全不同，而官方 `ControlAnchor` 就是那九个 `declare const` 的字面量联合。
 * 换算复用控件那一族的**同一张** `ANCHOR_VALUES` 表（`driver/jsapi-v4/controls.ts` 导出它、
 * `driver/jsapi-v4/overlays.ts` 的 `anchorFor` 消费它）——两张表一旦漂移，同一个锚点名在
 * `<ZoomControl>` 与 `<Label>` 上会落到不同的角，那是肉眼几乎发现不了的 bug。
 *
 * live 读数（2026-09-27）确认九个数在 `window` 与 `BMap` 命名空间上同值。
 */
export type OverlayAnchorName =
  | "BMAP_ANCHOR_TOP_LEFT"
  | "BMAP_ANCHOR_TOP_RIGHT"
  | "BMAP_ANCHOR_BOTTOM_LEFT"
  | "BMAP_ANCHOR_BOTTOM_RIGHT"
  | "BMAP_ANCHOR_TOP_CENTER"
  | "BMAP_ANCHOR_MIDDLE_LEFT"
  | "BMAP_ANCHOR_CENTER"
  | "BMAP_ANCHOR_MIDDLE_RIGHT"
  | "BMAP_ANCHOR_BOTTOM_CENTER";

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

/* ------------------------------------------------------------ 读回 / 命令面（#165 Class 3）
 *
 * `setOptions` 只能**写**。官方在图形族与 Marker 上声明了一整族**无参读回**
 * （`getBounds` / `getCenter` / `getRadius` / `getStrokeColor` / `getRank` / …）以及几个
 * 「没有对应 prop 的动作」（`setPositionAt` / `setRotationOrigin` / `setRank` /
 * `InfoWindow#maximize` / `ContextMenu#removeItem`）。#165 之前它们**没有任何调用路径**：
 * 组件面 27 个 `defineExpose` 一个都没有，而「改 prop」并不等于「调同名方法」（读回类
 * 方法组件永远不会替你调，动作类方法根本没有对应 prop）。
 *
 * 归一化到 Driver 而不是让组件直接摸 raw：官方读回返回的是 raw `BMap.Point` / `BMap.Bounds` /
 * `BMap.Size` / `BMap.MenuItem`，按 AGENTS.md 组件面**不得**直接接触 raw SDK 对象。
 * 下面的返回值全部是项目领域值（`Point` / `Bounds` / `Pixel` / 标量）。
 */

/** `InfoWindow` 的读回与动作面（官方 `overlay/InfoWindow.d.ts`）。 */
export interface InfoWindowReadBackApi {
  getTitle(): string;
  getContent(): string | HTMLElement;
  isOpen(): boolean;
  getOffset(): Pixel;
  maximize(): void;
  restore(): void;
}

/** 图形族（`Circle` / `Polygon` / `Rectangle` / `Polyline`）的读回面。 */
export interface PathReadBackApi {
  getBounds(): Bounds;
  getStrokeColor(): string;
  getStrokeOpacity(): number;
  getStrokeWeight(): number;
  getStrokeStyle(): "solid" | "dashed" | "dotted";
}

/** `Circle` 独有：圆心 / 半径 / 填充（官方 `Circle.d.ts`）。 */
export interface CircleReadBackApi extends PathReadBackApi {
  getCenter(): Point;
  getRadius(): number;
  getFillColor(): string;
  getFillOpacity(): number;
}

/** `Polygon` 独有：填充两件套（`Rectangle` 也有，合并进 `PathReadBackApi` 之外单列）。 */
export interface PolygonReadBackApi extends PathReadBackApi {
  getFillColor(): string;
  getFillOpacity(): number;
}

/** `Marker` 的读回与动作面（官方 `overlay/Marker.d.ts`）。 */
export interface MarkerReadBackApi {
  getRank(): number;
  setRank(rank: number): void;
  setRotationOrigin(angle: number): void;
  getTitle(): string;
  getOffset(): Pixel;
  getRotation(): number;
  getPosition(): Point;
  /**
   * 打开地点详情窗（官方 `Marker#openPlaceDetail(placeDetail: PlaceDetail): void`）。
   *
   * ## 为什么这一条**不**在 expose 面里
   *
   * 官方的入参是 raw `BMap.PlaceDetail` 实例，而**本库没有 `PlaceDetail` 这个 Driver 资源**：
   * 它只出现在 `./ui-kit` 子入口（`UiKitPlaceDetailWidget`，#70），而那一族受 ADR
   * `2026-09-13-ui-kit-subpath-and-type-boundary` 约束（「`./ui-kit` 与其 Vue 封装只能
   * 动态 import，不得进入根入口或任何 SSR 可达的模块图」）。要让 `<Marker>` 能接收
   * `PlaceDetail`，根入口就必须知道它的类型——那会**把 ui-kit 拖进根模块图**。
   *
   * 因此本库不提供 `openPlaceDetail` 的命令面：**要打开地点详情窗，走 `./ui-kit` 的
   * `<UiKitPlaceDetailWidget>`**（它自己管理 DOM 宿主与渲染），或者经 `./advanced` 的
   * `unwrapRaw()` 拿 raw Marker 自己调——后者是明确的逃生口，不是组件面。
   * 「给 `openPlaceDetail` 留一个 `any` 形参」被明确拒绝：那正是 AGENTS.md 说的
   * **收下但没人读的假支持**。
   *
   * 它的兄弟 `closePlaceDetail(): void` **没有**这个障碍（无参、不需要任何 SDK 对象），
   * 因此它**在**命令面里。
   */
  closePlaceDetail(): void;
}



/**
 * `ContextMenu` 的命令面（issue #165 Class 3 / TASK 2d/2e）。
 *
 * ## **不**沿用官方的 raw `MenuItem` 出入参（逐条依据）
 *
 * 官方 `context-menu/ContextMenu.d.ts` 声明：
 * `getItem(index: number): MenuItem` / `removeItem(item: MenuItem): void`。
 * 那两个 `MenuItem` 是 **raw SDK 对象**——AGENTS.md 的 raw SDK 边界只覆盖
 * `driver/**` / `client/**` / `core/loader/**` / `plugins/**`，`components` 与 `core`
 * 都在**禁区**。因此本库的公共命令面：
 *
 * | 官方 | 本库 | 为什么 |
 * | --- | --- | --- |
 * | `getItem(index): MenuItem` | `getItem(index): MenuItemView` | 返回**本库条目模型**（序号 / 文字 / 禁用态 / 宽度 / id），不是 raw 实例 |
 * | `removeItem(item: MenuItem)` | `removeItem(index: number)` | 收**序号**而不是 raw 实例 |
 *
 * 改按序号还有一个独立理由：**官方 `MenuItem` 上没有任何 getter**
 * （`context-menu/MenuItem.d.ts` 只有 `setText` / `enable` / `disable`）——把 raw 实例
 * 交出去，调用方拿到的就是一个「什么也读不到」的对象。「读回」只可能来自本库模型。
 */
export interface MenuItemView {
  /** 当前序号（`-1` = 不在菜单里）。 */
  readonly index: number;
  readonly text: string;
  readonly disabled: boolean;
  readonly width?: number;
  readonly id?: string;
}

export interface ContextMenuCommandApi {
  /** 读回一条菜单项（本库模型，见 `MenuItemView` 的理由）。 */
  getItem(index: number): MenuItemView | null;
  /** 删掉一条菜单项（按序号）。`false` = 该序号不存在。 */
  removeItem(index: number): boolean;
  /** 删掉第 `index` 条**分隔线**；该位置不是分隔线时 `false`。 */
  removeSeparator(index: number): boolean;
  /**
   * 改第 `index` 条项的文字（官方 `MenuItem#setText(text: string): void`）。
   *
   * 官方 `ContextMenu` **没有**「拿到第 i 条 `MenuItem` 再改它」的整袋入口
   * （`getItem` 返回 raw 对象而组件面不得持有它），因此这一条经菜单 + 序号下发。
   * 同步更新本库条目表，因此之后的 `getItem(index).text` 读得到新值。
   */
  setItemText(index: number, text: string): void;
  /**
   * 启用 / 禁用第 `index` 条项（官方 `MenuItem#enable()` / `#disable()`）。
   *
   * ## 这条修的是「`enable()` 永久不可达」那个洞（#165 TASK 2e）
   *
   * 此前 `<MenuItem disabled>` 只能靠「整菜单重建」改，而重建是按 **props** 建的——
   * 于是没有任何路径能在**不重建**的前提下把一条项解禁。本方法提供了那条路。
   *
   * ⚠️ **不回写本库条目表的 `disabled`**：`disabled` 进菜单指纹
   * （`core/overlays/ContextMenuSpec.ts` 的注释说明了原因——官方 `disable()` 之后没有读回），
   * 而 props 才是主模型。因此「命令解禁」只改 SDK 当前态；调用方若要持久解禁，
   * 必须把 `disabled` prop 改成 `false`。这与「命令不镜像成组件状态」是同一条口径。
   */
  setItemEnabled(index: number, enabled: boolean): void;
  /** 菜单根 DOM（官方 `getDom()`；菜单 DOM 由 SDK 自己渲染，本库不产出菜单 DOM）。 */
  getDom(): HTMLElement;
  /** 在上一次右键的位置弹出（官方 `show()`）。 */
  show(): void;
  hide(): void;
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
  /**
   * 与 `"size"` **同一种归一化**（`{width, height}` → `BMap.Size`），但**组件侧的形状也是
   * `Size`**，而 `"size"` 那一档在组件侧是 `Pixel`（`{x, y}`，见 `MarkerProps.offset`）。
   *
   * 为什么必须分开（issue #178 `GroundPoint`）：`useOverlaySpec` 的 `fixedShapeKeyOf` 按
   * `value` 档挑 watch 键——`"size"` 走 `pixelKey`（读 `x` / `y`）。若把 GroundPoint 的
   * `size` / `anchor` / `offset` 登记成 `"size"`，`{width, height}` 在 `pixelKey` 下恒为
   * `undefined|0|0` ⇒ **内容变了也判成没变**，更新会被静默吞掉。`GroundPoint` 的这三个键在
   * 官方 `GroundPointOptions` 里就是 `Size`（`size?: Size` / `anchor?: Size` / `offset?: Size`），
   * 因此组件面也收 `{width, height}`，与档位保持一致。
   */
  | "size-shape"
  | "icon"
  /**
   * `Marker.label`：本库的**领域形状** → raw `BMap.Label`（issue #165 第三批）。
   *
   * 单独一种归一化而不是塞进 `raw`，是因为 `MarkerOptions.label` 的官方类型是
   * `BMap.Label`——一个 raw SDK 对象。组件面**不构造** SDK 对象（AGENTS.md 的边界规则），
   * 因此这个构造必须发生在 Driver 边界内，而 `raw` 会把领域对象原样递给 SDK ⇒ 官方读到
   * 的是一个普通 JS 对象而不是 Label ⇒ 标注不显示（且**不报错**）。
   */
  | "marker-label"
  /**
   * 锚点的**官方常量名** → 官方数值（issue #165 第三批）。
   *
   * 官方 `ControlAnchor` 是九个 `declare const` 的字面量联合，调用方在 JS 里写的只能是数值。
   * 收名字（`"BMAP_ANCHOR_BOTTOM_CENTER"`）是为了让「8」在源码里可读——与控件那一族
   * （`<ZoomControl>` 等）**同一张换算表**、同一口径。
   */
  | "anchor";

/**
 * 「撤回」（有值 → 未表态）后回到 SDK 自身默认的**落点**（issue #138）。
 *
 * 这是**正交**于 `policy` 的一维：`policy` 回答「值变化时怎么办」，`revert` 回答
 * 「**这个值消失**了怎么办」。两者不能合并——把 `mutable` 降级成 `recreate` 会让
 * `zIndex: 5 → 7` 这种纯值变化也重建（每次变值一次重建的性能回退），而实际上
 * 5→7 完全可就地写。
 *
 * 唯一可选值是 `rebuild`（重建 ⇒ 构造期不传该键 ⇒ SDK 用自己的默认值）。这是**取证**后的
 * 结论，不是省事：逐字段核对 `@baidumap/jsapi-v4-types@4.0.5` 后，**没有**任何一种更省的落点：
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
   * `marker3d` / `map-mask` 指向的构造器**不在** `@baidumap/jsapi-v4-types@4.0.5` 的类声明里
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

/* ------------------------------------------- issue #165 图形族补齐：构造期选项（21 个）
 *
 * 全部是 `recreate`。**判据不是「官方只在 options 里声明了它」**，而是**逐条核对
 * `overlay/<Class>.d.ts` 的实例成员表 + live 读数**之后确认「**没有可观察地生效的更新入口**」。
 *
 * | 键 | 官方 `@default` | 判据 |
 * | --- | --- | --- |
 * | `strokeLineCap` | `'round'` | ⚠️ **唯一一条「声明与运行时不一致」**：官方类型声明里没有，但**运行时原型链 layer 2 上有**、调得动不抛——**调完 `getStrokeStyle()` 不变**且官方无读回 ⇒ 可观察地**不生效** ⇒ 仍是构造期 |
 * | `strokeLineJoin` | `'round'` | 同上 |
 * | `dashArray` | 实线与间隙均为线宽 2 倍 | 无 `setDashArray`，也**无 `setDash`**（live 读数：整条原型链 layer = -1） |
 * | `coordType` | 未设置时用全局 `BMap.coordType` | 无 `setCoordType`（layer = -1）；它决定**输入点按哪种坐标系解读**，构造之后改它没有意义 |
 * | `geodesic` | `false` | 无 `setGeodesic`（layer = -1）；且它决定**两点之间怎么连**（路径本身），不是样式 |
 * | `linkRight` | `false` | 无 `setLinkRight`（layer = -1） |
 * | `clip` | `true` | 无 `setClip`（layer = -1）；官方原文「绘制跨经度 180 度的折线时可设置为 false 以优化效果」 |
 * | `icons` | 无 | 无 `setIcons`（layer = -1）；且官方 `IconSequence` **已 `@deprecated`**（4.0 起改用 `strokeTexture`）——见该键的独立注释 |
 * | `strokeTexture` | 无 | 无 `setStrokeTexture`（layer = -1）；官方注明「仅 WebGL 渲染模式支持」 |
 *
 * `enableClicking` 不在这里：它早已在 `PATH_STYLE` 里登记为 `recreate`，
 * 缺的是 `<Polyline>` / `<Polygon>` 的**组件面**出口（描述符有键、组件没暴露）。
 *
 * ## ⚠️ live 取证的三个方法论教训（都踩过）
 *
 * 1. **别只读 `getOwnPropertyNames(Ctor.prototype)`**：`Polyline` 的原型链有 **7 层**
 *    （自有成员数 8 / 9 / 38 / 27 / 11 / 12 / 12），样式 setter 全在 **layer 2**。
 *    只看 layer 0 会把「38 个成员的那层」整个漏掉，于是「存在」被误判成「不存在」。
 * 2. **`typeof` 在位 ≠ 有效**：`setStrokeLineCap` 在原型链上、调得动不抛，但**调完没有
 *    任何可观察的变化**。判据必须是「**可观察地生效**」，不是「成员在不在」——
 *    这与 `Marker#setAnchor` 是同一类问题的两个方向：那条是**未 settle 的取样**把
 *    「在位」读成了「不在」（settle 之后它在位且生效），本条是 settle 之后仍然
 *    **在位但不生效**。**取样时机**与**是否接到渲染上**是两条独立的坑。
 * 3. **「等补齐」不能只看静态成员**：`member-surface` 的读法 `Ctor[name]` 会命中**静态**
 *    成员，于是用图形类做 `settleWhenPresent` 判据时会 `attempts=1 / afterMs=0` **假 settled**。
 *
 * ⚠️ **不要把这些键顺手改成 `mutateBy("set<Key>")`**：认成 `mutable` 会让更新落到
 * 「按名字推导的逃生口」上，而那些方法要么不存在、要么**调了不生效**
 * ⇒ 静默变成「改了没反应」或「调用成功但画面不变」。
 * `tests/behavior/overlay-update-policy.test.ts` 与
 * `tests/behavior/vector-overlay-options.test.ts` 双向钉住这一条
 * （后者还带一条**对照守卫**：同在 layer 2 的 `setStrokeColor` 仍然走 `options`）。
 */

/** 四类图形（Polyline / Polygon / Circle / Rectangle / BezierCurve 中**有**该项的）共用。 */
const PATH_CTOR_DASH: Record<string, SpecInput> = {
  dashArray: recreate(
    "官方 4.0.5 的 Polyline/Polygon/Rectangle/Circle/BezierCurve 上**都没有** setDashArray，" +
      "也**没有** setDash（对照：同名有 setter 的是官方 `DashStyle` 那条线，不在这些类上）",
    { ctorKey: "dashArray", value: "raw" },
  ),
};

/** `coordType`：官方在 Polyline / Polygon / Rectangle / Circle 四类上声明（**BezierCurve 没有**）。 */
const PATH_CTOR_COORD: Record<string, SpecInput> = {
  coordType: recreate(
    "官方 4.0.5 的 Polyline/Polygon/Rectangle/Circle 上**没有** setCoordType；" +
      "它决定**输入点按哪种坐标系解读**（未设置时用全局 `BMap.coordType`），构造之后改它没有意义",
    { ctorKey: "coordType" },
  ),
};

/**
 * `strokeLineCap` / `strokeLineJoin`：官方在 Polyline / Polygon 两类上声明（Circle / Rectangle /
 * BezierCurve 没有）。
 *
 * ## ⚠️ **这两项的依据是运行时实测，而且结论与「声明里没有」不同**
 *
 * 官方 4.0.5 的 `overlay/Polyline.d.ts` / `Polygon.d.ts` 的**类型声明里没有**这两个方法——
 * 但**运行时原型链上确实有**，且**真调一次不抛**。live 读数（headless Chrome + live AK，
 * 2026-09-27，脚本 `/tmp/probe-mini.mts`，报告 `/tmp/mini.json`）：
 *
 * | 成员 | 原型链归属 | 真调一次 |
 * | --- | --- | --- |
 * | `setStrokeLineCap` | layer 2（**图形族共享**那层，与 `setStrokeColor` / `setStrokeWeight` / `setStrokeStyle` **同一层**） | 不抛，返回 `undefined` |
 * | `setStrokeLineJoin` | layer 2（同上） | 不抛，返回 `undefined` |
 * | `setLineCap` / `setLineJoin` | **-1（整条链都没有）** | — |
 * | `setStrokeColor` / `setStrokeWeight` / `setStrokeStyle` | layer 2（对照项） | — |
 * | `setZIndex` | layer 3 | — |
 * | `setPath` | layer 0（自有） | — |
 *
 * `Polyline.prototype` 整条链是 7 层（自有 8 / 9 / 38 / 27 / 11 / 12 / 12 个成员），
 * 样式 setter 挂在 layer 2 —— 这也解释了为什么**只读 `getOwnPropertyNames` 会误判**：
 * 它只看 layer 0，于是「38 个成员的那层」整个被漏掉。
 *
 * ## 那为什么仍然是 `recreate`，而不是 `mutateBy("setStrokeLineCap")`
 *
 * **因为「在位且调得动」不等于「有效」**：live 实测调完
 * `setStrokeLineCap("square")` + `setStrokeLineJoin("bevel")` 之后，
 * `getStrokeStyle()` 仍然读回 `"solid"`（调用前也是 `"solid"`）——**没有任何可观察的变化**。
 *
 * 认成 `mutable` 会怎样：更新会「成功」（不抛、进了 `callLog`）但**画面不变**，
 * 也就是**静默假支持**——比 `recreate` 的「改它就重建」糟糕得多。
 * 官方**既没有**在类型声明里承诺它，**也没有**任何 getter 能证明它生效了
 * ⇒ 与 AGENTS.md「官方已经提供的能力不自研 / 不把未取证的东西说成支持」同口径：
 * **只按构造选项透传，字段级更新一律重建**。
 *
 * ⚠️ **不要因为「live 读数说有」就改成 `mutateBy`**——那正是本条要防的误判。
 * 判据是「可观察地生效」，而 live 读数恰恰否定了这一点。
 */
const PATH_CTOR_LINE_JOINT: Record<string, SpecInput> = {
  strokeLineCap: recreate(
    "**依据是 live 读数（2026-09-27，/tmp/probe-mini.mts）**：运行时原型链 layer 2 上确实有 " +
      "setStrokeLineCap（与 setStrokeColor / setStrokeWeight / setStrokeStyle 同一层），真调一次**不抛**；" +
      "但**官方 4.0.5 的类型声明里没有**它，且调完之后 getStrokeStyle() 读回仍是 'solid'——" +
      "**没有任何可观察的变化** ⇒ 认成 mutable 会变成「调用成功但画面不变」的静默假支持，" +
      "比 recreate 糟得多 ⇒ 固定按构造期透传，改它就重建。" +
      "⚠️ 官方也**没有** getLineCap / getStrokeLineCap 之类的读回，无从验证生效",
    { ctorKey: "strokeLineCap" },
  ),
  strokeLineJoin: recreate(
    "同 strokeLineCap 的 live 读数与结论：原型链 layer 2 有 setStrokeLineJoin、调得动不抛、" +
      "但类型声明没有、且调完 getStrokeStyle() 不变 ⇒ 构造期，recreate",
    { ctorKey: "strokeLineJoin" },
  ),
};

/** `linkRight`：官方在 Polyline / Polygon / Rectangle 三类上声明。 */
const PATH_CTOR_LINK_RIGHT: Record<string, SpecInput> = {
  linkRight: recreate(
    "官方 4.0.5 的 Polyline/Polygon/Rectangle 上**没有** setLinkRight；它决定「跨 180 度经线时" +
      "是否按最短路径绘制」，是**绘制算法**的输入，构造后无从更改",
    { ctorKey: "linkRight" },
  ),
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
      // ---- issue #168 item 2：官方 MarkerOptions 里此前未收的四个构造选项 ----
      // 四个**全部**是 `recreate`：逐个核对 `overlay/Marker.d.ts` 的实例成员表
      // （`setIcon` / `setPosition` / `setOffset` / `setTitle` / `setLabel` /
      //  `enable|disableDragging` / `enable|disableMassClear` / `setZIndex` / `setAnchor` /
      //  `setRotation` / `setRotationOrigin` / `setRank` / `setOptions`），
      // **一个都没有**这四个的 setter ⇒ 认成 `mutable` 会让更新落到 `set<Key>` 逃生口上，
      // 静默变成「改了没反应」。
      raiseOnDrag: recreate(
        "官方 MarkerOptions 的 raiseOnDrag（@default false，「拖拽时标注是否离开地图表面」）；4.0 的 Marker 实例上没有 setRaiseOnDrag",
        { ctorKey: "raiseOnDrag" },
      ),
      // ⚠️ `draggingCursor` 的官方类型是**普通 `string`**（原文：「需遵循 CSS cursor 属性规范」），
      // 没有任何候选值清单 ⇒ 领域侧也按 `string` 建模，**不**自造枚举联合
      // （CSS cursor 的合法值是开放集合：关键词 + 任何 `url(…)`，联合一定会漏）。
      draggingCursor: recreate(
        "官方 MarkerOptions 的 draggingCursor（CSS cursor 字符串）；4.0 的 Marker 实例上没有 setDraggingCursor",
        { ctorKey: "draggingCursor" },
      ),
      isTop: recreate(
        "官方 MarkerOptions 的 isTop（@default false，「是否将标注置于其它标注之上」）；4.0 的 Marker 实例上没有 setIsTop",
        { ctorKey: "isTop" },
      ),
      restrictDraggingArea: recreate(
        "官方 MarkerOptions 的 restrictDraggingArea（@default false，「是否限制拖拽区域」）；4.0 的 Marker 实例上没有 setRestrictDraggingArea",
        { ctorKey: "restrictDraggingArea" },
      ),
      anchor: recreate(
        "**依据是运行时实测，不是类型声明**：`Marker#setAnchor` 在 4.0.5 的声明里**存在**，"
          + "settle **之后**实测也在**实例**上（`inst: true`）、`getAnchor()` 读回 `Point`、"
          + "构造后真调一次**不抛**（复核见 `docs/zh-CN/contributing/165-runtime-audit-2026-09-27.md`"
          + "「官方 4.0.5 声明里有、运行时没有的成员」一节，该节**明确推翻了**更早的否定读数）。"
          + "⚠️ 别照抄 `docs/zh-CN/contributing/165-runtime-verification.md` 结论二：它那条"
          + "「不在原型上 / 调用抛 `B.ControlAnchor is not a constructor`」是**未 settle** 的取样"
          + "（本轮复跑 `probe-runtime-members.mts` case 2 仍复现它——**它复现的是那条假象**，"
          + "不是 settle 之后的读数）。同样也别据声明改回 `mutateBy`。"
          + "锚点之所以固定为构造期选项，理由是**撤回没有落点**：`getAnchor()` 返回当前值"
          + "（未设时 `null` = SDK 内置默认锚点，那个值无从构造出来再传回去）"
          + "（值为 BMAP_ANCHOR_* 常量，不是 Size）。",
        { ctorKey: "anchor" },
      ),
      // ---- issue #165 第三批：官方 `MarkerOptions` 16 个键里最后三个 ----
      //
      // ⚠️ 三个**不是**同一个分类。`label` 是 `mutable`（官方 `Marker.d.ts:110` / `:115`
      // 声明了成对的 `setLabel` / `getLabel`），另两个是 `recreate`——判据逐条见下。
      //
      // live 读数（2026-09-27，settle 之后；`marker-label-cluster-options.test.ts` 有门禁）：
      //   `setLabel` / `getLabel` 都在 `BMap.Marker.prototype` 的 **layer 1**，真调不抛，
      //   且 `getLabel().getContent()` 从构造时的文案变成新文案 ⇒ **可观察地生效** ⇒ `mutable`。
      //
      // `value` 用默认的 `"raw"`：`label` 收的是**本库领域形状**（`MarkerLabelInput`），
      // Driver 在 `projectOptions` / `applyFieldUpdate` 的归一化层把它变成 raw `BMap.Label`
      // （见 `driver/jsapi-v4/overlays.ts` 的 `markerLabelFor`）——组件面不构造 SDK 对象。
      label: mutateBy("setLabel", { ctorKey: "label" }),
      autoFollowHeadingChanged: recreate(
        "官方 MarkerOptions 的 autoFollowHeadingChanged（@default false，"
          + "「是否自动跟随地图旋转角度联动」）；4.0.5 的 Marker.d.ts 成员表里**没有**它，"
          + "live 读数也确认 setAutoFollowHeadingChanged **不在 BMap.Marker.prototype 的任何一层**"
          + "（layer = -1、实例 typeof = undefined）⇒ 没有可观察地生效的更新入口，只能重建",
        { ctorKey: "autoFollowHeadingChanged" },
      ),
      startAnimation: recreate(
        "官方 MarkerOptions 的 startAnimation（「图标的入场动画名称」），官方**没有**声明任何"
          + "候选动画名、也**没有** setStartAnimation（live：整条原型链 layer = -1）"
          + "⇒ 收普通 string、构造期透传，改它就重建",
        { ctorKey: "startAnimation" },
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
      // ---- issue #165 第三批：`anchor` 此前登记了但**组件面从不暴露** ⇒ 更新路径一次都没被触发
      //
      // live 读数（2026-09-27，settle 之后）判它是 `mutable` 且**可观察地生效**：
      // `setAnchor` / `getAnchor` 都在 `BMap.Label.prototype` 的 **layer 1**、真调不抛；
      // 同一经纬度上默认 / `anchor:8` / `anchor:2` 三个 Label 的 DOM 位置分别是
      // `(top 90, left 263)` / `(69, 217)` / `(69, 263)`（锚点决定标注相对地理点的角点），
      // 对第二个调 `setAnchor(0)` 之后**移回 `(90, 263)`**。
      //
      // ⚠️ 与 `OVERLAY_DESCRIPTORS.marker.anchor` **判据相反**（那条是 `recreate`）：
      // Marker 那条的 `setAnchor` 在**未 settle** 的取样里是 layer = -1，据此判「不存在」——
      // 而 settle 之后它**也在** layer 1 且可调（`getAnchor()` 读回 8）。两条依据见各自注释。
      // 本条（Label）的依据是 settle 之后的可观察效果，不受那条的取样时机影响。
      anchor: mutateBy("setAnchor", { ctorKey: "anchor", value: "anchor" }),
      // ---- issue #165 第三批：`width` 此前完全没有登记（官方 `LabelOptions` 7 个键之一）----
      //
      // 官方 `overlay/Label.d.ts` 的成员表里**没有** `setWidth` / `getWidth`；live 读数
      // （settle 之后）确认 `setWidth` **不在 `BMap.Label.prototype` 的任何一层**（layer = -1），
      // 真调一次抛 `setWidth is not a function`。
      //
      // 构造期它**确实生效**（live：不给时 DOM `width: 14px` 按内容自适应，给 `77` 时 `77px`）
      // ⇒ 这是「构造期可用」，不是「不可实现」。改它会重建实例。
      width: recreate(
        "官方 LabelOptions 的 width（@default 0，「0 表示按内容自适应」）；4.0.5 的 Label.d.ts "
          + "成员表里没有 setWidth，live 读数也确认 setWidth **不在 BMap.Label.prototype 的任何一层**"
          + "（layer = -1、真调抛 setWidth is not a function）⇒ 只能构造期透传，改它就重建",
        { ctorKey: "width" },
      ),
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
      // ↓ 以下 6 条是 issue #165 Class 3 / TASK 3 补的（官方 InfoWindowOptions 的其余构造选项）。
      // 逐条依据见 `InfoWindowOptions` 的同款注释；**全部构造期**（官方 `InfoWindow`
      // 上没有对应的 setter，也没有读回）。
      margin: recreate(
        "InfoWindowOptions.margin 是四个边距（[上, 右, 下, 左]）；官方 4.0.5 的 InfoWindow 上既没有 setMargin 也没有读回，构造期给定",
        { ctorKey: "margin", value: "raw" },
      ),
      collisions: recreate(
        "InfoWindowOptions.collisions 是碰撞检测的四个边距；官方 4.0.5 的 InfoWindow 上既没有 setCollisions 也没有读回，构造期给定",
        { ctorKey: "collisions", value: "raw" },
      ),
      onClosing: recreate(
        "InfoWindowOptions.onClosing 是**回调**：官方没有 setOnClosing，而回调要跟随最新闭包就必须重建（与 ControlSpec.options 的同款理由）",
        { ctorKey: "onClosing", value: "raw" },
      ),
      enableSearchTool: recreate(
        "InfoWindowOptions.enableSearchTool 决定是否多渲染一个工具条（渲染通道）；官方 4.0.5 的 InfoWindow 上没有对应的成对开关，也无读回",
        { ctorKey: "enableSearchTool", value: "raw" },
      ),
      headerContent: recreate(
        "InfoWindowOptions.headerContent 是自定义标题栏 HTML；官方 4.0.5 的 InfoWindow 上没有 setHeaderContent，也无读回。⚠️ 官方没有说明它与 title 同时给时谁优先，本库**不表态**（两个都原样传下去）",
        { ctorKey: "headerContent", value: "raw" },
      ),
      enableContentScroll: recreate(
        "InfoWindowOptions.enableContentScroll 决定内容溢出时是否可滚；官方 4.0.5 的 InfoWindow 上没有 setEnableContentScroll，也无读回",
        { ctorKey: "enableContentScroll", value: "raw" },
      ),
      title: mutateBy("setTitle", { ctorKey: "title" }),
      redraw: mutateBy("redraw", { ctorKey: null }),
      enableMaximize: toggleBy(["enableMaximize", "disableMaximize"], { ctorKey: "enableMaximize" }),
      enableAutoPan: toggleBy(["enableAutoPan", "disableAutoPan"], { ctorKey: "enableAutoPan" }),
      enableCloseOnClick: toggleBy(
        ["enableCloseOnClick", "disableCloseOnClick"],
        { ctorKey: "enableCloseOnClick" },
      ),
      offset: recreate(
        "InfoWindow 只有 getOffset()：官方 4.0 参考与 4.0.5 类型包都没有 setOffset，像素偏移只能在构造期给定",
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
      // ↓ issue #165 图形族补齐：Polyline **独有**的四个构造期选项（其余四类没有）。
      ...PATH_CTOR_DASH,
      ...PATH_CTOR_COORD,
      ...PATH_CTOR_LINE_JOINT,
      ...PATH_CTOR_LINK_RIGHT,
      geodesic: recreate(
        "官方 4.0.5 的 Polyline 上**没有** setGeodesic；它决定**两点之间怎么连**（大地线还是直线段），" +
          "属于路径本身而非样式，构造之后改它就是换一条不同的线",
        { ctorKey: "geodesic" },
      ),
      clip: recreate(
        "官方 4.0.5 的 Polyline 上**没有** setClip；官方原文「是否进行跨经度 180 度裁剪，" +
          "绘制跨经度 180 度的折线时可设置为 false 以优化效果」——这是渲染期裁剪，不是几何",
        { ctorKey: "clip" },
      ),
      /**
       * ⚠️ **官方已 `@deprecated`**：`IconSequence` 在 4.0.5 的 `overlay/IconSequence.d.ts`
       * 上明确标了 `@deprecated 4.0 已废弃，请使用 {@link PolylineOptions#strokeTexture} 配置项代替`。
       *
       * 本库**仍然收**它，理由是两条：① 官方参考实现与既有代码可能仍在用，而「收下就静默忽略」
       * 比「不收」更难排查；② 描述符如实记下它只是构造期，调用方能自己判断该不该用新的那条路。
       * 但**不**把它写进 `PathStrokeProps`（它只属于 Polyline），也**不**在文档里推荐它。
       */
      icons: recreate(
        "官方 4.0.5 的 Polyline 上**没有** setIcons；且官方 `IconSequence` 类本身已 @deprecated" +
          "（4.0 起请用 `strokeTexture`）——保留本键只为如实透传，不推荐新代码使用",
        { ctorKey: "icons", value: "raw" },
      ),
      strokeTexture: recreate(
        "官方 4.0.5 的 Polyline 上**没有** setStrokeTexture；它是**线纹理**（沿折线重复绘制图片，" +
          "如方向箭头），官方注明**仅 WebGL 渲染模式支持**——渲染通道而非几何，构造期给定",
        { ctorKey: "strokeTexture", value: "raw" },
      ),
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
      // ↓ issue #165 图形族补齐。
      ...PATH_CTOR_DASH,
      ...PATH_CTOR_COORD,
      ...PATH_CTOR_LINE_JOINT,
      ...PATH_CTOR_LINK_RIGHT,
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
      // ⚠️ **官方 `Rectangle` 也有 `linkRight` / `coordType` / `dashArray`**，此前同样没有出口。
      // 本次一并补齐（`strokeLineCap` / `strokeLineJoin` **不在** `RectangleOptions` 里，别误加）。
      ...PATH_CTOR_DASH,
      ...PATH_CTOR_COORD,
      ...PATH_CTOR_LINK_RIGHT,
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
      // ↓ issue #165 图形族补齐。CircleOptions **没有** `strokeLineCap` / `strokeLineJoin` /
      // `linkRight` / `geodesic` / `clip` —— 加了就是自造官方没有的选项。
      ...PATH_CTOR_DASH,
      ...PATH_CTOR_COORD,
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
      // ---- issue #168 item 2：`top`（官方 @default false，「是否在普通覆盖物之上绘制」）----
      // 逐条核对 `overlay/GroundOverlay.d.ts` 的实例成员表（`setBounds` / `getBounds` /
      // `setOpacity` / `getOpacity` / `setImage` / `setImageURL` / `getImageURL` /
      // `setDisplayOnMinLevel` / `getDisplayOnMinLevel` / `setDisplayOnMaxLevel` /
      // `getDisplayOnMaxLevel` / `setZIndex` / `getMap`）——**没有 `setTop`** ⇒ 只能构造期生效。
      //
      // ⚠️ 与 `zIndex`（同为层叠语义）落地方式**不同**：后者有 `setZIndex` 所以是 `mutable`。
      // 两者都在描述符里，别把 `top` 顺手改成 `mutateBy("setZIndex")`——那会让它
      // 静默落到一个语义不同的 setter 上。
      top: recreate(
        "官方 GroundOverlayOptions 的 top（@default false，「是否在普通覆盖物之上绘制」）；4.0 的 GroundOverlay **没有 setTop**（它有 setZIndex，但那是层叠顺序值，语义不同）",
        { ctorKey: "top" },
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

  // ---- issue #178：GroundPoint（贴地点覆盖物，继承 GroundOverlay）----
  //
  // 逐条核对 `@baidumap/jsapi-v4-types@4.0.5` 的两份声明（**类型包在 pnpm store 里有两份**，
  // 这里读的是 `package.json` version 为 4.0.5 的 git 依赖那份；4.0.4_patch 那份的同三个文件
  // 与它逐字相同，结论不随版本漂移）：
  //
  // - `overlay/GroundPoint.d.ts`——实例成员表共 6 个 setter：
  //   `setPoint` / `setScale` / `setSize` / `setRotation` / `setAnchor` / `setOffset`；
  // - `overlay/GroundOverlay.d.ts`——继承来的 8 个成员：
  //   `setBounds` / `getBounds` / `setOpacity` / `getOpacity` / `setImage` / `setImageURL` /
  //   `getImageURL` / `setDisplayOnMinLevel` / `getDisplayOnMinLevel` / `setDisplayOnMaxLevel` /
  //   `getDisplayOnMaxLevel` / `setZIndex` / `enableMassClear` / `disableMassClear` / `getMap`。
  //
  // 分类判据因此是**逐条比对 `GroundPointOptions` 的 7 个键在这张成员表里有没有对应 setter**。
  "ground-point": {
    kind: "ground-point",
    ctor: "GroundPoint",
    capability: "overlay.ground-point",
    properties: properties({
      // `GroundPointOptions` 的 7 个键里，**这 6 个有对应 setter** ⇒ `mutable`。
      // 位置入口是 `setPoint`（**不是** `setPosition`）：`GroundPoint.d.ts:29`
      // 声明的是 `setPoint(point: Point, update?: boolean): this`。
      // 对比 `Marker`（`setPosition`）与 `marker3d`（同样走 `setPoint`，见**下方**条目）——
      // 方法名不能照抄同类，必须按各自声明取。
      point: mutateBy("setPoint", { ctorKey: null, value: "point" }),
      // `GroundPoint.d.ts:39`：`setScale(scale: number, update?: boolean): this`
      scale: mutateBy("setScale", { ctorKey: "scale" }),
      // `GroundPoint.d.ts:49`：`setSize(size: Size, update?: boolean): this`
      // ⚠️ 上游是 `BMap.Size`（`{width, height}`），**不是**图形族偏移那套 `Pixel`（`{x, y}`）。
      // 因此用 `size-shape` 档而不是 `size`：后者在 `useOverlaySpec` 的 `fixedShapeKeyOf`
      // 里走 `pixelKey`（读 `x` / `y`），`{width, height}` 会被判成「永远是同一值」⇒ 更新静默丢失。
      size: mutateBy("setSize", { ctorKey: "size", value: "size-shape" }),
      // `GroundPoint.d.ts:59`：`setRotation(angle: number, update?: boolean): this`
      rotation: mutateBy("setRotation", { ctorKey: "rotation" }),
      // `GroundPoint.d.ts:69`：`setAnchor(anchor: Size, update?: boolean): this`
      anchor: mutateBy("setAnchor", { ctorKey: "anchor", value: "size-shape" }),
      // `GroundPoint.d.ts:79`：`setOffset(offset: Size, update?: boolean): this`
      offset: mutateBy("setOffset", { ctorKey: "offset", value: "size-shape" }),
      // ---- 以下是 `GroundOverlayOptions` 继承来的键（`GroundPointOptions` 文档写明
      // 「继承 GroundOverlayOptions」），分类依据同上表 ----
      // `GroundOverlay.d.ts:62`：`setImage(url: string, bounds?: Bounds): void`
      url: mutateBy("setImage", { ctorKey: "url" }),
      // `GroundOverlay.d.ts:48`：`setOpacity(opacity: number): void`
      opacity: mutateBy("setOpacity", { ctorKey: "opacity" }),
      // `GroundOverlay.d.ts:82` / `:95`：`setDisplayOnMinLevel` / `setDisplayOnMaxLevel`
      displayOnMinLevel: mutateBy("setDisplayOnMinLevel", { ctorKey: "displayOnMinLevel" }),
      displayOnMaxLevel: mutateBy("setDisplayOnMaxLevel", { ctorKey: "displayOnMaxLevel" }),
      // `GroundOverlay.d.ts:104`：`setZIndex(zIndex: number): void`
      zIndex: mutateBy("setZIndex", { ctorKey: "zIndex" }),
      // `GroundOverlay.d.ts:108` / `:112`：`enableMassClear()` / `disableMassClear()` 成对开关
      enableMassClear: toggleBy(["enableMassClear", "disableMassClear"], { ctorKey: "enableMassClear" }),
      // ---- `recreate` 的三键：官方实例成员表上**没有**对应 setter ----
      // `GroundOverlayOptions.enableClicking`：4.0 的 GroundOverlay **没有**
      // `setEnableClicking`，也没有成对开关（对照 `enableMassClear` 就有）⇒ 只能构造期生效。
      enableClicking: recreate(
        "4.0 的 GroundOverlay / GroundPoint 上只有构造选项 enableClicking，实例上没有对应的成对开关（对照 enableMassClear 有）",
        { ctorKey: "enableClicking" },
      ),
      // `GroundOverlayOptions.top`（`@default false`）：`GroundOverlay` 有 `setZIndex` 但
      // **没有 `setTop`**——`setZIndex` 是层叠顺序**值**，语义不同，不能拿来顶替。
      top: recreate(
        "官方 GroundOverlayOptions 的 top（@default false，「是否在普通覆盖物之上绘制」）；4.0 的 GroundOverlay **没有 setTop**（它有 setZIndex，但那是层叠顺序值，语义不同）",
        { ctorKey: "top" },
      ),
      // `GroundPointOptions.level`（`@default 18`，尺寸参考的缩放级别）：
      // **成员表上既没有 `setLevel` 也没有任何同义入口**（6 个 setter 逐条比过）⇒ `recreate`。
      // 这是 GroundPoint 相对 GroundOverlay **新增**的键，落在 `displayOnMinLevel` /
      // `displayOnMaxLevel`（有 setter）之外，分类与之不同。
      level: recreate(
        "`GroundPointOptions.level`（@default 18，尺寸参考的缩放级别）：GroundPoint 的 6 个实例 setter（setPoint / setScale / setSize / setRotation / setAnchor / setOffset）里**没有** setLevel，也没有同义入口；它与有 setDisplayOnMinLevel/MaxLevel 的那两个键语义不同，不能互相顶替",
        { ctorKey: "level" },
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
      // M5-VECTORS / #31：这两个键**不在** `@baidumap/jsapi-v4-types@4.0.5` 的 `PrismOptions` 里。
      // 组件的 v2 兼容 prop 仍然原样交给构造期（迁移前的行为），但分类必须是 `recreate` 而不是
      // `mutable`：既没有字段级 setter，也没有证据表明运行时读取它——因此这里如实记下「未取证」，
      // 而不是把它写成「支持」（不静默伪造能力）。
      isBoundary: recreate(
        "**未取证**：PrismOptions（4.0.5）里没有 isBoundary，4.0 运行时是否读取它没有证据；组件保留 v2 的构造期透传，但不声明字段级更新",
        { ctorKey: "isBoundary" },
      ),
      autoCenter: recreate(
        "**未取证**：PrismOptions（4.0.5）里没有 autoCenter；理由同 isBoundary（构造期透传）",
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
      // ↓ issue #165 图形族补齐。BezierCurveOptions **只有** `dashArray` 是此前缺的
      // （**没有** `coordType` / `strokeLineCap` / `strokeLineJoin` / `linkRight` —— 别误加）。
      ...PATH_CTOR_DASH,
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
      // 下面四条 `recreate` 的理由（实例上**没有**对应 setter）经 live 复核**成立**：
      // `scripts/probe-165c-surface.mts` §④ customOverlay 读到
      // `setZIndex` / `setMinZoom` / `setMaxZoom` / `setOptions` 四者
      // `proto:false, inst:false`（`CustomOverlay.prototype` 共 18 个成员，其中确实没有它们），
      // 而 `setPoint` / `setRotation` / `setProperties` / `show` / `hide` 在位且调得动。
      // 官方 `CustomOverlay.d.ts` 也没声明这四个（`Overlay` 基类只有 initialize/isVisible/
      // draw/show/hide/getMap/dispose），所以这里是「声明与运行时一致地没有」，
      // 与 `Marker#setAnchor` 那种「声明有、运行时也有」的情况不同。
      minZoom: recreate(
        "minZoom 是构造选项（CustomOverlayOptions.minZoom），实例上没有 setMinZoom（live 复核：proto/inst 均 false）",
        { ctorKey: "minZoom" },
      ),
      maxZoom: recreate(
        "maxZoom 是构造选项（CustomOverlayOptions.maxZoom），实例上没有 setMaxZoom（live 复核：proto/inst 均 false）",
        { ctorKey: "maxZoom" },
      ),
      zIndex: recreate(
        "4.0 的 CustomOverlayOptions 有 zIndex，但实例上没有 setZIndex（live 复核：proto/inst 均 false），层级只能在构造期确定",
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
    "4.0.5 的 8 个覆盖物类上都有 setZIndex，但**没有一个**有 getZIndex（只有 layer/* 有）" +
    "⇒ 无从读回，也没有 baseline 可恢复 ⇒ 重建",
  enableDragging: "enableDragging / disableDragging 成对开关，4.0.5 **没有**公开读回 ⇒ 重建",
  enableMassClear: "enableMassClear / disableMassClear 成对开关，4.0.5 **没有**公开读回 ⇒ 重建",
  enableEditing: "enableEditing / disableEditing 成对开关，4.0.5 **没有**公开读回 ⇒ 重建",
  enableClicking:
    "只有构造选项 enableClicking（4.0.5 在 Marker 与图形族上都没有 setEnableClicking/disableClicking）" +
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
  opacity: "Label#setOpacity 在 4.0.5 **没有**公开读回 ⇒ 重建",
  // ——— issue #178：`GroundPoint` 的位置与三个尺寸字段 ———
  // 逐条依据都是「官方 4.0.5 声明里**没有**对应的 getter」——不是「有 getter 但读回当前值」，
  // 因为 `GroundPoint.d.ts` 的 6 个 setter（setPoint / setScale / setSize / setRotation /
  // setAnchor / setOffset）**一个配对 getter 都没有**。
  point:
    "`GroundPoint#setPoint`（`GroundPoint.d.ts:29`）在 4.0.5 **没有**公开读回（`getPoint` 查无此成员）" +
    "⇒ 无 baseline 可取 ⇒ 重建",
  scale:
    "`GroundPoint#setScale`（`GroundPoint.d.ts:39`）在 4.0.5 **没有**公开读回 ⇒ 重建" +
    "（官方默认是 1，但「默认 1」对本库不是可恢复的 baseline：它由 SDK 内部决定，撤回即重建）",
  size:
    "`GroundPoint#setSize`（`GroundPoint.d.ts:49`）在 4.0.5 **没有**公开读回（无 `getSize`）⇒ 重建；" +
    "且 `GroundPointOptions.size` 官方**没有**标注 @default（未声明默认值）",
  level:
    "`GroundPointOptions.level`（@default 18，尺寸参考的缩放级别）是**构造期**项" +
    "（实例成员表上既无 setLevel 也无 getter）⇒ policy 已是 recreate，撤回落点与之一致",
  // ⚠️ 依据是 **live 读数**，不是「官方说明」——`setAnchor` **在** 4.0.5 的 `Marker` 实例上
  // （`inst: true`，`getAnchor()` 读回 `Point`，构造后真调一次也不抛），
  // 因此「等异步标注模块加载才挂上」那个说法是**错的**，不要照抄。
  // 真正让 `anchor` 只能走 `recreate` 的是**撤回落点**：`getAnchor()` 返回的是**当前值**
  // （`null` = 用的是 SDK 内置默认锚点，那个值无从构造出来再传回去），
  // 与上面 `rotation` / `icon` / `title` / `offset` 那一族「返回当前值而非默认值 ⇒ 重建」同源。
  // live 读数见 `scripts/probe-165c-surface.mts`（§④ marker）与本文件顶部的 probe 清单。
  anchor:
    "Marker#anchor 只能重建：getAnchor() 返回的是**当前值**（未设时是 null，即 SDK 内置默认锚点，" +
    "那个值无从构造出来再传回去），因此「值变回 undefined」没有落点 ⇒ 重建" +
    "（⚠️ **不是**因为 setAnchor 不存在——live 实测它在实例上且调得动）",
  // ——— issue #168 item 2 补的构造选项：全部「无 setter 也无读回」⇒ 重建 ———
  raiseOnDrag:
    "官方 MarkerOptions 的 raiseOnDrag（@default false）；4.0 的 Marker 实例上" +
    "**既没有 setRaiseOnDrag 也没有任何读回** ⇒ 连「值变回 undefined」都没有落点，只能重建",
  draggingCursor:
    "官方 MarkerOptions 的 draggingCursor（CSS cursor 字符串）；4.0 的 Marker 实例上" +
    "**既没有 setDraggingCursor 也没有任何读回** ⇒ 重建",
  isTop:
    "官方 MarkerOptions 的 isTop（@default false）；4.0 的 Marker 实例上" +
    "**既没有 setIsTop 也没有任何读回**（注意：与它语义相近的 setZIndex 是**另一个**成员，" +
    "不能借用——那会让「布尔置顶」被当成「层叠顺序值」撤回）⇒ 重建",
  restrictDraggingArea:
    "官方 MarkerOptions 的 restrictDraggingArea（@default false）；4.0 的 Marker 实例上" +
    "**既没有 setRestrictDraggingArea 也没有任何读回** ⇒ 重建",
  // ——— issue #165 第三批：Marker 的 `label` / `autoFollowHeadingChanged` / `startAnimation` ———
  //
  // `label` 与上面 `rotation` / `icon` / `title` / `offset` 那一族**判据相同**（有 getter，
  // 但返回的是**当前值**而不是 SDK 默认的「没有 label」），因此分开写在这里而不是并进那一族。
  label:
    "Marker#label 有 setLabel（policy 是 mutable），但 getLabel() 返回的是**当前值**；" +
    "而「没有 label」这个 baseline **无从构造**（官方默认的 Marker 不带 Label 实例，" +
    "本库也没有一个「空 Label」可以造出来写回去）⇒ 「值变回 undefined」没有落点，只能重建" +
    "（⚠️ **不是**因为 setLabel 不存在——官方 Marker.d.ts:110 声明了它，live 实测也在位且生效）",
  autoFollowHeadingChanged:
    "官方 MarkerOptions 的 autoFollowHeadingChanged（@default false）；4.0.5 的 Marker.d.ts 成员表里" +
    "没有 setAutoFollowHeadingChanged，live 读数也确认它**不在 BMap.Marker.prototype 的任何一层**" +
    "（layer = -1）⇒ 既无写入口也无读回，连「值变回 undefined」都不成立，只能重建",
  startAnimation:
    "官方 MarkerOptions 的 startAnimation（官方未声明任何候选动画名）；4.0.5 的 Marker.d.ts " +
    "成员表里没有 setStartAnimation，live 读数确认整条原型链 layer = -1 ⇒ 只能重建",
  // ⚠️ `width` **不是**单 kind 的：InfoWindow 与 Label（本票新增）各有构造项 `width`，
  // 而两者的官方成员表里都没有 `setWidth` / `getWidth` ⇒ 依据合并写在下面那条。
  top:
    "官方 GroundOverlayOptions 的 top（@default false，「是否在普通覆盖物之上绘制」）；" +
    "4.0 的 GroundOverlay **没有 setTop**（它有 setZIndex，但那是层叠顺序值、语义不同，" +
    "借用它撤回会写错语义）也没有读回 ⇒ 重建",
  strokeColor: "图形族有 getStrokeColor，但返回当前值而非 SDK 默认色 ⇒ 重建",
  strokeWeight: "图形族有 getStrokeWeight，但返回当前值而非 SDK 默认线宽 ⇒ 重建",
  strokeOpacity: "图形族有 getStrokeOpacity，但返回当前值而非 SDK 默认透明度 ⇒ 重建",
  strokeStyle: "图形族有 getStrokeStyle，但返回当前值而非 SDK 默认线型 ⇒ 重建",
  fillColor: "图形族有 getFillColor，但返回当前值而非 SDK 默认填充色 ⇒ 重建",
  fillOpacity: "图形族有 getFillOpacity，但返回当前值而非 SDK 默认填充透明度 ⇒ 重建",
  // ——— issue #165 图形族补齐的九个构造期选项：全部「无 setter 也无读回」⇒ 重建 ——
  //
  // 这一组与上面 `strokeColor` 那一族**判据不同**，因此分开写：
  // 上面是「**有** getter，但返回当前值」；这里是「**连 getter 都没有**」——
  // 官方 4.0.5 的 `overlay/<Class>.d.ts` 实例成员表里**一个都没有**这些名字，
  // 因此「值变回 undefined」连落点都不存在。
  strokeLineCap:
    "官方 4.0.5 的类型声明里**既没有** setStrokeLineCap 也没有 getStrokeLineCap。" +
    "⚠️ live 读数（2026-09-27）显示运行时原型链 layer 2 上**有** setStrokeLineCap、调得动不抛，" +
    "但调完 getStrokeStyle() 不变（无可观察效果）且官方没有任何读回能验证它生效 ⇒ 无法确认写入" +
    "是否落到了真实的渲染状态，因此撤回只能重建（重建至少保证「回到官方默认」）",
  strokeLineJoin:
    "同 strokeLineCap：官方类型声明里没有 getStrokeLineJoin；live 读数里原型链 layer 2 的 " +
      "setStrokeLineJoin 调得动但无可观察效果 ⇒ 无从验证生效 ⇒ 重建",
  geodesic:
    "官方 4.0.5 的 Polyline 上**既没有** setGeodesic 也无读回；且它决定**路径本身**（两点怎么连），" +
    "不是样式 ⇒ 撤回只能重建出一条不同的线 ⇒ 重建",
  linkRight:
    "官方 4.0.5 的 Polyline/Polygon/Rectangle 上**既没有** setLinkRight 也无读回；" +
    "它是绘制算法的输入（同一条线的形状会不同）⇒ 重建",
  clip:
    "官方 4.0.5 的 Polyline 上**既没有** setClip 也无读回；官方原文「是否进行跨经度 180 度裁剪」" +
    "——渲染期裁剪而非几何，官方没有任何读回能告诉我们当前裁没裁 ⇒ 重建",
  coordType:
    "官方 4.0.5 的 Polyline/Polygon/Rectangle/Circle 上**既没有** setCoordType 也无读回；" +
    "它决定**输入点按哪种坐标系解读**，而坐标一旦被解读就不可逆（「改回去」需要重新解读原始点，" +
    "而那些原始点组件侧不保留）⇒ 重建",
  dashArray:
    "官方 4.0.5 的五个图形类上**既没有** setDashArray 也**没有** setDash，更无读回；" +
    "官方默认值是「按线宽推导的 2 倍」，而线宽可被 setStrokeWeight 单独改 ⇒ 没有可恢复的 baseline ⇒ 重建",
  icons:
    "官方 4.0.5 的 Polyline 上**既没有** setIcons 也无读回；且官方 `IconSequence` 类本身已 @deprecated" +
    "（4.0 起改用 strokeTexture）⇒ 重建",
  strokeTexture:
    "官方 4.0.5 的 Polyline 上**既没有** setStrokeTexture 也无读回；它是**线纹理**（沿折线重复绘制图片）" +
    "且官方注明仅 WebGL 渲染模式支持 ⇒ 重建",
  height:
    "InfoWindow 的 height 就地更新（官方 `InfoWindow#setHeight(height: number): void`，`overlay/InfoWindow.d.ts:38`，" +
    "@example 就是 `infoWindow.setHeight(200)`）。4.0.5 **无** `getHeight` ⇒ 撤回只能重建",
  maxWidth: "InfoWindow 的 maxWidth 有 setMaxWidth（policy 是 mutable），但 4.0.5 **无** getMaxWidth ⇒ 撤回只能重建",
  width:
    "本表的键是**属性名**（跨 kind 共享同一份依据），因此这一条要同时覆盖两个 `width`：" +
    "(a) **InfoWindow 的** `width` 就地更新（官方 `InfoWindow#setWidth(width: number): void`，" +
    "`overlay/InfoWindow.d.ts:29`——**4.0.4 与 4.0.5 都有**，早先「4.0.4 无 `setWidth`」" +
    "那句是照抄错的一侧，**从未复核**）；" +
    "(b) **Label 的** `width`（issue #165 第三批补上，`@default 0` = 按内容自适应）" +
    "**有**构造项但同样**没有**字段级入口——4.0.5 的 `Label.d.ts` 成员表里既没有 `setWidth` " +
    "也没有 `getWidth`，live 读数确认 `setWidth` 不在 `BMap.Label.prototype` 的任何一层" +
    "（layer = -1、真调抛 `setWidth is not a function`）" +
    "⇒ 两者都是「无写入口也无 baseline」⇒ 重建",
  maxContent:
    "InfoWindow 的 maxContent 有 setMaxContent（policy 是 mutable），但 4.0.5 **无**读回" +
    "（getContent() 返回的是普通内容，不是最大化内容）⇒ 撤回只能重建",
  margin: "InfoWindow 的 margin（[上,右,下,左]）只有构造选项；4.0.5 无 setMargin 也无读回 ⇒ 重建",
  collisions: "InfoWindow 的 collisions 只有构造选项；4.0.5 无 setCollisions 也无读回 ⇒ 重建",
  onClosing:
    "InfoWindow 的 onClosing 是**回调**且只有构造选项；4.0.5 无 setOnClosing。回调要跟随" +
    "最新闭包必须重建（与 ControlSpec.options 的同款理由）⇒ 重建",
  enableSearchTool:
    "InfoWindow 的 enableSearchTool 决定是否渲染一个工具条；4.0.5 无对应的成对开关也无读回" +
    "（与 enableMaximize 不同——后者有 enable/disableMaximize）⇒ 重建",
  headerContent:
    "InfoWindow 的 headerContent 只有构造选项；4.0.5 无 setHeaderContent 也无读回。" +
    "⚠️ 官方没有说明它与 title 同时给时谁优先，因此**不**把 title 的撤回借给它 ⇒ 重建",
  enableContentScroll:
    "InfoWindow 的 enableContentScroll 只有构造选项；4.0.5 无 setEnableContentScroll 也无读回 ⇒ 重建",
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
    "GroundOverlay 的 displayOnMinLevel 只有构造选项（4.0.5 无对应 setter / getter）⇒ 重建",
  displayOnMaxLevel:
    "GroundOverlay 的 displayOnMaxLevel 只有构造选项（4.0.5 无对应 setter / getter）⇒ 重建",
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
    "实例上无 getter（4.0.5 只在 CustomOverlay 上声明了带 point/pixel 的事件，没有读回）⇒ 重建",
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
  /**
   * 贴地点覆盖物（`GroundPoint extends GroundOverlay`）。
   *
   * ⚠️ 位置入口是 **`setPoint`** 而非 `setPosition`（`GroundPoint.d.ts:29`），
   * 因此 `setPosition(groundPointHandle, p)` 也能用——它经 `applyFieldUpdate` 按描述符键
   * `point` 解析到 `setPoint`。
   */
  createGroundPoint(position: Point, options?: Record<string, unknown>): OverlayHandle;
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
   * `options` 对应官方 `MenuItemOptions`（`@baidumap/jsapi-v4-types@4.0.5` 的
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
   * - `map` ⇒ `map.addContextMenu(menu)`：官方 4.0.5 的 `core/Map.d.ts` 有声明（签名只有一个
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

  /**
   * 菜单的**逐条**命令面（#165 Class 3 / TASK 2d）。
   *
   * 官方 `ContextMenu` 提供了 `getItem` / `removeItem` / `removeSeparator` / `getDom` /
   * `show` / `hide` 六个成员，而组件侧此前只做「整菜单重建」，因此它们**没有调用路径**。
   *
   * `show()` / `hide()` 在这里的语义是官方的：「在上一次右键的位置弹出 / 收回弹层」——
   * **不是**组件的 `visible`（后者是「菜单是否挂到目标上」，走 attach/detach，
   * 理由见 `CONTEXT_MENU_FIELDS` 的注释）。
   */
  contextMenuCommands(menu: OverlayHandle): ContextMenuCommandApi;

  /**
   * 一条 `MenuItem` 的逐条命令面（#165 Class 3 / TASK 2e）。
   *
   * 官方 `MenuItem#setText(text)` / `#enable()` / `#disable()` 三个成员。
   *
   * ## `enable()` 此前**永久不可达**，本方法是那条路的修复
   *
   * `<MenuItem disabled>` 走的是「`disabled: false` ⇒ **整菜单重建**」
   * （`CONTEXT_MENU_FIELDS.items = "rebuild"` + `ContextMenuSpec` 的指纹含 `disabled`）。
   * 于是：一个 `MenuItem` 实例从生到死只会处于「启用」或「永久禁用」两种状态——
   * **没有任何路径**能在不重建菜单的前提下把一条项解禁。
   *
   * 这条命令把那个洞补上，且**不动**「props 是主模型」的口径：命令改的是 SDK 当前态，
   * 它**不**回写 `props.disabled`，因此下一次条目重建仍然会按 props 重来
   * （调用方若想要持久生效，应当改 `disabled` prop——命令面刻意不做「命令回写 props」
   * 那种状态同步，那会让 props 与 SDK 当前值变成两个都能改的主模型）。
   */
  menuItemCommands(
    item: OverlayHandle,
  ): { setText(text: string): void; enable(): void; disable(): void };

  setPosition(overlay: OverlayHandle, position: Point): void;
  setPath(overlay: OverlayHandle, path: readonly (Point | string)[]): void;
  setOptions(overlay: OverlayHandle, options: Record<string, unknown>): void;

  /* ------------------------------------------------ 读回 / 命令面（#165 Class 3）
   *
   * 与 `setOptions` 分开而不是混进去：读回**没有入参**、不产生命令日志、`setOptions` 的
   * `value === undefined` 跳过语义对它毫无意义，而命令（`maximize` / `setPositionAt`）
   * 的入参形状与「一个 options 键」不同。收在同一处会让 `setOptions` 的契约开始泄漏。
   *
   * 全部**返回领域值**：raw `BMap.Point` / `BMap.Bounds` / `BMap.Size` 一律在 Driver 内
   * 投影掉——组件面不得接触 raw SDK 对象（`AGENTS.md` 的边界规则）。释放 / 未就绪的
   * 处置**不在这里**：句柄的归属由组件的实例 scope 管，Driver 只负责「拿这个句柄调 SDK」。
   */
  /** `InfoWindow` 的六个官方读回 / 动作（见 `InfoWindowReadBackApi`）。 */
  infoWindowCommands(overlay: InfoWindowHandle): InfoWindowReadBackApi;
  /** 图形族的描边 / 范围读回（`Circle` / `Polygon` / `Rectangle` / `Polyline` 共用部分）。 */
  pathReadBacks(overlay: OverlayHandle): PathReadBackApi;
  /** `Circle` 的圆心 / 半径 / 填充读回。 */
  circleReadBacks(overlay: OverlayHandle): CircleReadBackApi;
  /** `Polygon` / `Rectangle` 的填充读回。 */
  pathFillReadBacks(overlay: OverlayHandle): { getFillColor(): string; getFillOpacity(): number };
  /** `Marker` 的读回与动作（见 `MarkerReadBackApi`）。 */
  markerCommands(overlay: MarkerHandle): MarkerReadBackApi;
  /**
   * 逐点移动路径顶点（官方 `Polyline#setPositionAt(index, point)` /
   * `Polygon#setPositionAt(index, point, deep?)`）。
   *
   * `deep` **只对 `polygon` 有效**（多环路径的层数）：其它 kind 传了它**显式失败**
   * （`BMAP_INVALID_ARGUMENT`），而不是让官方把它当第三个参数默默吞掉。
   */
  setPositionAt(
    overlay: OverlayHandle,
    index: number,
    point: Point,
    options?: { deep?: number },
  ): void;

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
