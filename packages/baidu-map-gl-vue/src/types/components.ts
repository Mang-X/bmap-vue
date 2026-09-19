/**
 * 组件公共 Props 类型(与各 SFC `export interface XxxProps` 对齐)
 *
 * 说明:
 * - SFC 内 `defineProps<XxxProps>()` 使用此处类型(单一来源)。
 * - 根入口从此文件导出,避免从 `*.vue` 导出类型(TS 无法在纯 tsc 下解析 .vue 具名命名导出)。
 * - 精确的组件实例类型仍由 Volar 从 SFC 解析。
 */
import type { InfoWindowProps } from "../core/overlays/InfoWindowSpec";
import type { Pixel, Point } from "../driver/types/geometry";
import type { MapHandle, SdkHandle } from "../driver/types/handles";

/** BMapMask 掩膜显示区域 */
export type MapMaskShowRegion = "inside" | "outside";

/**
 * 行政区类型(与 SDK DistrictLayer kind 对齐,运行时可用)
 * PROVINCE=0 / CITY=1 / AREA=2
 */
export const DistrictType = {
  PROVINCE: 0,
  CITY: 1,
  AREA: 2,
} as const;

export type DistrictTypeValue = (typeof DistrictType)[keyof typeof DistrictType];

export interface BMapProps {
  ak?: string;
  apiUrl?: string;
  /**
   * 显式 Provider（结构化：`load()` 返回 `LoadedSdk`，engine = `jsapi-v4`）。
   *
   * M3A3-REMOVE-LEGACY（#26）：不再接受裸全局对象形状，也不再有任何「已有全局自动回退」。
   * 宿主自己加载了 SDK 时显式传 `existingGlobalV4Provider()`。
   */
  provider?: import("../client/types").BMapProviderLike;
  /** 显式 Client(最高优先级,查找顺序首位) */
  client?: import("../client/types").BMapClient;
  /** 显式 Client Definition(覆盖 Provider/默认) */
  definition?: import("../client/types").CreateBMapClientOptions;
  /** KeepAlive 行为:suspend(默认,不销毁 WebGL Map) | dispose */
  keepAliveBehavior?: "suspend" | "dispose";

  /* ---------------------------------------------------------------- 视野（M4-STATE / #27）
   *
   * center / zoom / heading / tilt 是**受控/非受控双模**字段，优先级：受控值 > default* > 库默认值。
   *
   * | 传入 | 模式 | 行为 |
   * | --- | --- | --- |
   * | `center` | 受控 | 外部值变化时写 SDK；用户交互回写 model 并 emit `update:center` |
   * | `defaultCenter` | 非受控 | 只在**首次创建视野**时生效；此后 default 变化不覆盖当前状态 |
   * | 都不传 | 缺省 | 用库默认视野初始化（center 北京 / zoom 14 / heading 0 / tilt 0） |
   *
   * 完整状态表与「不做什么」（例如不做「用户交互后强制回退到受控值」）见
   * `docs/zh-CN/components/map.md`；决策与理由见 ADR `2026-09-14-map-controlled-state`。
   */
  /**
   * 受控中心点：点，或 v2 兼容的城市名 / 地址字符串。
   *
   * 与 `v-model:center` 配对。用户交互（拖拽 / 惯性移动结束）会 emit `update:center`，
   * 载荷为具体坐标点（字符串形态在用户交互后会被具体坐标取代）。
   */
  center?: { lng: number; lat: number } | string;
  /** 受控缩放级别（`v-model:zoom`）。 */
  zoom?: number;
  /** 受控旋转角（度，`v-model:heading`）。 */
  heading?: number;
  /** 受控倾斜角（度，`v-model:tilt`）。 */
  tilt?: number;
  /** 非受控中心点初值：只在首次创建视野时生效，之后的变化不覆盖当前状态（会告警一次）。 */
  defaultCenter?: { lng: number; lat: number } | string;
  /** 非受控缩放级别初值：只在首次创建视野时生效。 */
  defaultZoom?: number;
  /** 非受控旋转角初值：只在首次创建视野时生效。 */
  defaultHeading?: number;
  /** 非受控倾斜角初值：只在首次创建视野时生效。 */
  defaultTilt?: number;
  width?: string | number;
  height?: string | number;
  mapType?: string;
  mapStyleId?: string;
  mapStyleJson?: Record<string, unknown>;
  displayOptions?: Record<string, unknown>;
  restrictCenter?: boolean;
  minZoom?: number;
  maxZoom?: number;
  noAnimation?: boolean;
  enableDragging?: boolean;
  enableScrollWheelZoom?: boolean;
  enableInertialDragging?: boolean;
  enablePinchToZoom?: boolean;
  enableKeyboard?: boolean;
  enableDoubleClickZoom?: boolean;
  enableContinuousZoom?: boolean;
  /** 是否启用交通路况图层(v2 兼容) */
  enableTraffic?: boolean;
  /** 开启图区 resize 中心点不变(v2 兼容) */
  enableResizeOnCenter?: boolean;
  /** 容器尺寸变化时自动重设尺寸(v2 兼容) */
  enableAutoResize?: boolean;
  loadingBgColor?: string;
  /** 背景色(透明度数组,如 [r,g,b,a]) */
  backgroundColor?: number[];
  plugins?: string[];
}

/**
 * BMarker 图标:内置名称或自定义图标描述
 *
 * `MarkerIconName` **派生自内置图标表**（`core/icons/markerIcon` 的 `BUILTIN_MARKER_ICON_NAMES`），
 * 而不是手写第二份名单：手写的那份曾与 Driver 的解析表漂移，导致 20 个名字静默渲染成
 * `simple_red`（M5-SPEC-MARKER / #30）。派生之后「类型里有、实际渲染不出来」在结构上不可能。
 */
export type MarkerIconName = import("../core/icons/markerIcon").BuiltinMarkerIconName;

export interface MarkerCustomIcon {
  imageUrl: string;
  size: { width: number; height: number };
  anchor?: { x: number; y: number };
  imageOffset?: { x: number; y: number };
  imageSize?: { width: number; height: number };
  printImageUrl?: string;
}

export type MarkerIcon = MarkerIconName | MarkerCustomIcon

export interface BMarkerProps {
  position: { lng: number; lat: number };
  offset?: { x: number; y: number };
  zIndex?: number;
  visible?: boolean;
  title?: string;
  enableDragging?: boolean;
  enableClicking?: boolean;
  rotation?: number;
  /** 图标:内置名称或自定义 Icon 描述 */
  icon?: MarkerIcon;
}

/**
 * BInfoWindow 的公开属性。字段与逐字段语义的声明点在 `core/overlays/InfoWindowSpec.ts`
 * （含「每个属性怎么落地」的策略表），这里只暴露公开类型名。
 */
export interface BInfoWindowProps extends InfoWindowProps {
  // 字段全部来自 `InfoWindowProps`（单一事实源，见上面的注释）。
  //
  // ⚠️ 这里**必须**保持「多行花括号」的写法：`tests/behavior/v3-overlay-suite.test.ts` 的
  // `readPropsKeys()` 用 `([\s\S]*?)\n\}` 切接口正文（为的是不把行内对象类型 `{ lng, lat }`
  // 当成分隔符）。写成单行 `{}` 会让那个非贪婪匹配**继续往后吞**，把紧随其后的接口正文并进
  // 这一次匹配里 —— 结果是那几个接口在解析表里消失、声明面门禁误报（PR #101 合并 #31 后实测）。
}

/**
 * BCustomOverlay 的公开属性（M5-CUSTOM-MENU / issue #33）。
 *
 * 字段与「每个属性怎么落地」的声明点在 `components/overlays/customOverlaySpec.ts`，这里只暴露
 * 公开类型名（与 `BInfoWindowProps` 同一手法）。键集与 `OVERLAY_DESCRIPTORS["custom-overlay"]`
 * 的条目**一一对应**：能在构造期设置的写 `recreate`，有字段级 setter 的写 `options`。
 *
 * ⚠️ 与 `BInfoWindowProps` 相同的约束：**必须保持多行花括号**（同一条正则门禁）。
 */
export interface BCustomOverlayProps {
  /** 覆盖物的地理坐标点。 */
  position: { lng: number; lat: number };
  /** 相对锚点的像素偏移。**构造期属性**：官方没有 `setOffset`。 */
  offset?: { x: number; y: number };
  /** 锚点，左上角为 `(0, 0)`、右下角为 `(1, 1)`。**构造期属性**：官方没有 `setAnchor`。 */
  anchor?: { x: number; y: number };
  /** 旋转角度（度）。有字段级 `setRotation`。 */
  rotation?: number;
  /** 层叠顺序。**构造期属性**：官方没有 `setZIndex`。 */
  zIndex?: number;
  /** 显示的最小缩放级别。**构造期属性**：官方没有 `setMinZoom`。 */
  minZoom?: number;
  /** 显示的最大缩放级别。**构造期属性**：官方没有 `setMaxZoom`。 */
  maxZoom?: number;
  /** 自定义业务属性。有字段级 `setProperties`。 */
  properties?: Record<string, unknown>;
  /** 是否显示（`show` / `hide`）。 */
  visible?: boolean;
  /** 是否参与 `map.clearOverlays()`。**构造期属性**：官方说明该开关当前不生效，因此不做就地开关。 */
  enableMassClear?: boolean;
}

/**
 * `BContextMenu` 的一条菜单项（数据 API）。
 *
 * 与 `<BMenuItem>`（声明式 API）产出的条目**同形**：两种写法最终都归一化成这份结构，只是
 * 「谁来解析」不同。`"-"`（`ContextMenuSeparator`）表示一条分隔线。
 */
export interface ContextMenuItem {
  /** 菜单项文字。 */
  text: string;
  /** 点击菜单项时触发；载荷与 `@select` 事件相同（见 `ContextMenuSelectPayload`）。 */
  callback?: (payload: ContextMenuSelectPayload) => void;
  /** 是否禁用该菜单项（官方 `MenuItem#disable`）。 */
  disabled?: boolean;
  /** 该项的宽度（官方 `MenuItemOptions.width`）；不传时用菜单级 `width`。 */
  width?: number;
  /** 该项 DOM 的 id（官方 `MenuItemOptions.id`）。 */
  id?: string;
}

/** 分隔线：数据 API 里写 `"-"`（v2 沿用的写法，保持兼容）。 */
export type ContextMenuSeparator = "-";

/**
 * 菜单项被选中时的载荷。
 *
 * **不是 SDK 事件**：官方把「选中」经 `MenuItem` 的构造回调给出（回调参数是菜单弹出位置的地理
 * 坐标点），因此本库在这条回调里派发 `select`。`point` / `pixel` 可能缺失（归一化把 SDK 的 `null`
 * 也收成 `undefined`）。
 */
export interface ContextMenuSelectPayload {
  /** 被选中的菜单项（归一化后的结构；数据 API 与声明式 API 同形）。 */
  item: ContextMenuItem;
  /** 该菜单项在最终菜单里的序号（含分隔线）。 */
  index: number;
  /** 菜单弹出位置的地理坐标；SDK 没给时为 `undefined`（上游给 `null` 也收成缺失）。 */
  point?: Point;
  /** 菜单弹出位置的画面像素坐标；SDK 没给时为 `undefined`。 */
  pixel?: Pixel;
  /** 当前地图句柄（`MapHandle`）。 */
  map: MapHandle;
  /**
   * 菜单挂载的目标句柄（地图或标注）；调用时尚未挂上时为 `null`。
   *
   * 类型是句柄基类，因为目标可能是 `MapHandle` 也可能是 `MarkerHandle`——两者都是
   * `SdkHandle<string>`，而本库的右键菜单恰好支持这两种目标（见
   * `driver/types/overlays.ts` 的 `attachContextMenu`）。
   */
  target: SdkHandle<string> | null;
}

/**
 * BContextMenu 的公开属性（M5-CUSTOM-MENU / issue #33）。
 *
 * 声明点在 `core/overlays/ContextMenuSpec.ts`（含「每个属性怎么落地」的表）。
 *
 * ⚠️ 与 `BInfoWindowProps` 相同的约束：**必须保持多行花括号**（同一条正则门禁）。
 */
export interface BContextMenuProps {
  /** 菜单项（数据 API）。写法与声明式 `<BMenuItem>` / `<BMenuSeparator>` 等价。 */
  items?: (ContextMenuItem | ContextMenuSeparator)[];
  /**
   * @deprecated `items` 的兼容别名（v3 起的名字）。
   *
   * 只在 `items` **缺失**时生效（与集中弃用层同一条「新 API 优先」规则），使用时会打印一次告警。
   */
  menuItems?: (ContextMenuItem | ContextMenuSeparator)[];
  /** 菜单宽度（像素）。官方上是 `MenuItemOptions.width`，因此变化即重建菜单。 */
  width?: number;
  /**
   * 菜单是否挂到当前目标上。
   *
   * 语义是**资源所有权**（挂 / 不挂），不是「弹层是否展开」：菜单的展开由用户右键驱动，
   * 本库不把 SDK 的 `open` / `close` 升级成第二写入口（见 ADR 的 ownership-first 一节）。
   */
  visible?: boolean;
}

/**
 * BMenuItem 的公开属性（声明式 API）。
 *
 * 组件本身**不渲染任何 DOM**：它只把「这里有一条菜单项」注册给父级 `<BContextMenu>`，
 * 由父级按顺序交给 SDK 构建菜单。`select` 由本组件派发（载荷与数据 API 的 `callback` 相同）。
 *
 * ⚠️ 与 `BInfoWindowProps` 相同的约束：**必须保持多行花括号**（同一条正则门禁）。
 */
export interface BMenuItemProps {
  /** 菜单项文字。 */
  text: string;
  /** 是否禁用该菜单项。 */
  disabled?: boolean;
  /** 该项的宽度（官方 `MenuItemOptions.width`）；不传时用菜单级 `width`。 */
  width?: number;
  /** 该项 DOM 的 id（官方 `MenuItemOptions.id`）。 */
  id?: string;
}

/**
 * 描边样式：Polyline / Polygon / Rectangle / Circle 共享（M5-VECTORS / #31）。
 *
 * 与 Driver 描述符的 `PATH_STYLE` 逐键对应，由 `v3-overlay-suite.test.ts` 交叉锁定。
 */
export interface PathStrokeProps {
  strokeColor?: string;
  strokeWeight?: number;
  strokeOpacity?: number;
  strokeStyle?: "solid" | "dashed" | "dotted";
}

/** 填充样式：Polygon / Rectangle / Circle 共享（**Polyline 没有填充**，上游只有描边 setter）。 */
export interface PathFillProps {
  fillColor?: string;
  fillOpacity?: number;
}

/** 图形类覆盖物共有的开关与显隐（**不含** `enableEditing`：Prism / BezierCurve 上游没有编辑能力）。 */
export interface PathShapeProps {
  enableMassClear?: boolean;
  visible?: boolean;
}

/**
 * 可编辑的图形类覆盖物（Polyline / Polygon / Rectangle / Circle 四个）。
 *
 * 单独一层接口而不是并进 `PathShapeProps`：上游把 `enableEditing` 只给了这四个
 * （`GraphEventMap` 的编辑六件套也只在这四个 kind 的事件表里），因此
 * 「谁能开编辑」这件事在**类型层**就说清了，而不是靠组件记得不暴露它。
 */
export interface PathEditableProps {
  enableEditing?: boolean;
}

/**
 * 折线。
 *
 * `path` 与 `pathVersion` 是一对：`path` 按**根引用**比较（大数组不做内容指纹，见
 * `OverlaySpec` 的 `watchSources`），原地修改数组时靠 `pathVersion` 递增触发更新。
 */
export interface BPolylineProps extends PathStrokeProps, PathShapeProps, PathEditableProps {
  path: { lng: number; lat: number }[];
  pathVersion?: string | number;
}

/** 多边形（`isBoundary` 时允许 SDK 原生字符串路径）。 */
export interface BPolygonProps extends PathStrokeProps, PathFillProps, PathShapeProps, PathEditableProps {
  path: ({ lng: number; lat: number } | string)[];
  pathVersion?: string | number;
  /** 构造期属性：路径按 SDK 原生边界名解析（如 `"北京市"`）。变化即重建。 */
  isBoundary?: boolean;
}

/** 矩形（v4 起提供；由对角两点构成的 `bounds` 定义）。 */
export interface BRectangleProps extends PathStrokeProps, PathFillProps, PathShapeProps, PathEditableProps {
  bounds: { southwest: { lng: number; lat: number }; northeast: { lng: number; lat: number } };
  enableClicking?: boolean;
}

export interface BCircleProps extends PathStrokeProps, PathFillProps, PathShapeProps, PathEditableProps {
  center: { lng: number; lat: number };
  radius: number;
  enableClicking?: boolean;
}

/** 贝塞尔曲线：`path` 与 `controlPoints` 各有一个版本令牌。 */
export interface BBezierCurveProps extends PathStrokeProps, PathShapeProps {
  path: { lng: number; lat: number }[];
  controlPoints: { lng: number; lat: number }[][];
  pathVersion?: string | number;
  controlPointsVersion?: string | number;
}

/** 文本标注的样式对象（驼峰 CSS 属性）。 */
export type LabelStyle = Record<string, unknown>;

export interface BLabelProps {
  content: string;
  position: { lng: number; lat: number };
  offset?: { x: number; y: number };
  zIndex?: number;
  style?: LabelStyle;
  enableMassClear?: boolean;
  visible?: boolean;
}

/**
 * 3D 棱柱。
 *
 * `isBoundary` / `autoCenter` 是**构造期透传**：`@baidumap/jsapi-v4-types@4.0.4` 的
 * `PrismOptions` 里没有这两个键（4.0 运行时是否读取未取证），因此它们既不被当作字段级更新，
 * 也不被宣称支持——只在创建时原样交给 SDK（分类与理由见 `OVERLAY_DESCRIPTORS.prism`）。
 */
export interface BPrismProps {
  path: ({ lng: number; lat: number } | string)[];
  altitude: number;
  topFillColor?: string;
  topFillOpacity?: number;
  sideFillColor?: string;
  sideFillOpacity?: number;
  isBoundary?: boolean;
  autoCenter?: boolean;
  enableMassClear?: boolean;
  visible?: boolean;
}

/** 地面叠加层的内容类型（对应上游 `GroundOverlayOptions.type`）。 */
export type GroundOverlayType = "image" | "video" | "canvas";

/**
 * 地面叠加层的内容来源。
 *
 * 允许**惰性工厂**：`type: "canvas"` 时通常需要现场创建 canvas，工厂只在创建 / 显式替换时调用一次
 * （求值发生在本库的 props 视图里，绝不把函数交给 SDK）。
 */
export type GroundOverlayUrl =
  | string
  | HTMLCanvasElement
  | (() => string | HTMLCanvasElement);

/**
 * 地面叠加层。
 *
 * `bounds` 是正典 prop；`startPoint` / `endPoint` 是 v2/v3-beta 的旧名，由集中弃用层
 * （`core/deprecations`）在读取层解析——**新 API 优先**：`bounds` 一旦有值，旧名完全不参与。
 */
export interface BGroundOverlayProps {
  /** 显示区域（西南 / 东北角点）。与旧的 `startPoint` + `endPoint` 二选一。 */
  bounds?: { southwest: { lng: number; lat: number }; northeast: { lng: number; lat: number } };
  /** @deprecated 旧名（西南角）；改用 `bounds.southwest`。 */
  startPoint?: { lng: number; lat: number };
  /** @deprecated 旧名（东北角）；改用 `bounds.northeast`。 */
  endPoint?: { lng: number; lat: number };
  type: GroundOverlayType;
  url: GroundOverlayUrl;
  opacity?: number;
  /** 创建后按显示区域居中地图（组件侧行为，不是 SDK 选项）。 */
  autoCenter?: boolean;
  visible?: boolean;
}

/* ------------------------------------------------------------------ 数据组件（M6 / #34）
 *
 * 三个数据组件的公开 props 都在这里声明（与各 SFC 的 `defineProps` 单一来源对齐）：
 *
 * - `BMarkerList`：**每一项一个 SDK Marker**，适合中小规模、需要逐点交互的数据；
 * - `BMarkerCluster`：网格聚合，簇也是 Marker；
 * - `BPointCollection`：**单个批量 SDK 资源**（v4 原生 `PointShapeLayer`），适合大规模散点。
 *
 * 三者的取数面刻意一致（`data` + `itemKey` + `getPosition` + `dataVersion`），因此业务数据可以在
 * 它们之间平移；差别只在「落地成什么资源」——这正是「边界清晰」的含义。
 *
 * 泛型 `Item` 会**原样保留**到事件载荷（`item-click` 的参数就是 `Item`），不退化成
 * `any` / `unknown`；证据在消费方 fixture `fixtures/v3-consumer/src/index.ts`（CI 用 tarball 跑
 * `vue-tsc`）。
 */

/** 三个数据组件共用的取数面。 */
export interface BMapDataProps<Item> {
  /** 数据数组（只按**引用**比较；原地修改请配合 `dataVersion`）。 */
  data: readonly Item[];
  /** item 的唯一键：属性名或取值函数（`PropertyKey`）。 */
  itemKey: keyof Item | ((item: Item) => PropertyKey);
  /**
   * 取坐标。返回 `null` / `undefined` 表示「这一项没有位置」——该项被跳过并给出开发期告警
   * （缺 key、非法坐标同理；判定口径见 `core/data/itemScan.ts`）。
   */
  getPosition: (item: Item) => { lng: number; lat: number } | null | undefined;
  /**
   * 数据版本：**根引用不变、内容却变了**时递增它（例如 `list[0].lng = 1`）。
   *
   * 相同引用 + 相同版本 ⇒ 不产生任何 SDK 调用；版本变化 ⇒ 逐项重新读取并**重发一遍**。
   * 根引用变化本身也会触发重新读取（只下发坐标真的变了的项），因此这个 prop 只在
   * 「引用没换、内容变了」时需要；它也是「宿主侧自行改过位置、需要对回来」时的显式逃生口。
   */
  dataVersion?: PropertyKey;
  /** 是否显示；`false` = 隐藏（`BMarkerList` 用 `show/hide`，`BPointCollection` 用原生 `setVisible`）。 */
  visible?: boolean;
}

export interface BMarkerListProps<Item> extends BMapDataProps<Item> {}

export interface BMarkerClusterProps<Item> extends BMapDataProps<Item> {
  /** 像素网格边长（聚合桶的边长），默认 `128`。 */
  gridSize?: number;
  /** 达到该数量才聚合；不足的点展开为独立 item，不会丢点。默认 `3`。 */
  minClusterSize?: number;
  /** 聚合使用的 zoom；缺省时读取地图当前 zoom（读不到时用 `8`）。 */
  zoom?: number;
}

/**
 * `BPointCollection` 的 props。
 *
 * 取数面与 `BMarkerList` 一致；样式面只暴露 v4 原生点图层**真的支持**的那几个字段
 * （`PointShapeStyle` 的子集，逐条核对 `@baidumap/jsapi-v4-types@4.0.4`）。
 */
export interface BPointCollectionProps<Item> extends BMapDataProps<Item> {
  /**
   * 属性映射：写进每个要素的 `properties`。
   *
   * 入库时会**额外**写入要素身份字段（`itemKey` 是字符串时就是该字段名，是函数时用保留字段
   * `__id`），它与 SDK 的 `idKey` 指的是同一个字段：少了它，拾取回来的要素认不出业务项。
   * 同名字段被本库覆盖时会给出开发期告警。
   */
  properties?: (item: Item) => Record<string, unknown> | null | undefined;
  /** 形状类型，取值见官方 `PointShapeLayer.ShapeType`（如 `0` 圆形 / `7` 五角星）。 */
  shape?: number;
  /** 点的尺寸（像素）。 */
  size?: number;
  /** 填充颜色。 */
  color?: string;
  /** 描边颜色。 */
  strokeColor?: string;
  /** 描边宽度（像素）。 */
  strokeWeight?: number;
  /** 图层透明度 `0`-`1`。 */
  opacity?: number;
  /** 图层层级（挂载后写入）。 */
  zIndex?: number;
  /** 最小显示缩放等级。 */
  minZoom?: number;
  /** 最大显示缩放等级。 */
  maxZoom?: number;
  /**
   * 是否开启鼠标拾取，默认 **`true`**。
   *
   * 与官方 `PointShapeLayerOptions.enablePicked` 的默认值（`false`）**不同**，这是刻意的：
   * 不给事件就别怪用户拿不到 `item-click`。关掉它可以省掉拾取开销。
   *
   * 它是**构造期**选项（官方只提供 `setBaseOptions`，且不会自动重绘）⇒ 变化时重建图层实例。
   */
  enablePicked?: boolean;
  /** 点击拾取矩形宽（像素，官方默认 30）。构造期选项。 */
  pickWidth?: number;
  /** 点击拾取矩形高（像素，官方默认 30）。构造期选项。 */
  pickHeight?: number;
}

/** 图层级拾取事件（`BPointCollection` 的 `click`）。 */
export interface BMapPointPick<Item> {
  /** 是否命中要素（未命中时官方**也**派发事件，用 `dataIndex === -1` 区分）。 */
  hit: boolean;
  /** 命中的要素在本次 `setData` 里的下标；未命中为 `-1`。 */
  dataIndex: number;
  /** 命中的业务项（**最新**的那个）；未命中或对不上业务数据时为 `null`。 */
  item: Item | null;
  /** 地理坐标（未命中时也有）。 */
  latLng: { lng: number; lat: number } | null;
  /** 画面像素坐标。 */
  pixel: { x: number; y: number } | null;
}
