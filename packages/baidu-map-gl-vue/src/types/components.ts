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
   * 是否**贴地渲染**（官方 `PointShapeLayerOptions.isFlat`，官方默认 `true`）。
   *
   * 本库**不覆盖**官方默认值：不表态就**不进**构造选项袋（`undefined` 一律不发），
   * 要改成贴图外那种「始终面向屏幕」的渲染再显式传 `false`。
   *
   * 它是**构造期**选项（决定渲染通道）⇒ 变化时重建图层实例。
   */
  isFlat?: boolean;
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

/**
 * 图层级拾取事件（原生批量数据图层的 `click` / `mousemove` / `dblclick` / `rightclick`）。
 *
 * 五个原生数据图层共用这一个载荷形状（`BPointCollection` 与 #36 的 `BLineLayer` / `BFillLayer`）：
 * 「未命中」「身份确认不到」这两种情况必须能被**区分**出来，所以 `hit` / `id` / `item` 三个字段
 * 各自表达一件事。
 */
export interface BMapPointPick<Item> {
  /** 是否命中要素（未命中时官方**也**派发事件，用 `dataIndex === -1` 区分）。 */
  hit: boolean;
  /** 命中的要素在本次 `setData` 里的下标；未命中为 `-1`。 */
  dataIndex: number;
  /**
   * **可以公开 / 交给 Feature State 的业务身份**（`feature.properties[idKey]`）；确认不到时为 `null`。
   *
   * 取值域是 `string | number`（官方 `updateState(keys: string | number | …)` 的签名）：`idKey` 没声明、
   * 或者 `properties[idKey]` 不在这个域（`NaN` / symbol）时如实返回 `null`——本库不按事件顺序 / 下标猜
   * 身份，也不猜官方的默认 `idKey`，更不会把 symbol 转成字符串冒充身份。
   */
  id: string | number | null;
  /**
   * 命中的业务项（**最新**的那个）；未命中时为 `null`。
   *
   * 与 `id` 是**两件事**（`id` 的取值域更窄，见上）：`item` 只要求「命中并且能按**业务键**找回」，
   * 因此 `id` 为 `null` 时 `item` 往往仍然有值——没设置 `idKey` 时线 / 面图层仍会给出命中要素的
   * `properties`；函数式 `itemKey` 返回 symbol 时逐项数据组件（`BPointCollection`）也照样回传最新业务项。
   */
  item: Item | null;
  /** 地理坐标（未命中时也有）。 */
  latLng: { lng: number; lat: number } | null;
  /** 画面像素坐标。 */
  pixel: { x: number; y: number } | null;
}

/**
 * 线 / 面图层的拾取载荷：**业务项就是要素的 `properties`**。
 *
 * 与 `BPointCollection` 的差别只在 `Item` 的形状：逐项数据组件的业务对象是调用方给的 `Item[]`，
 * 而线 / 面图层的数据本身就是 GeoJSON，因此「命中的业务项」只能是那条要素的属性袋——身份
 * （`properties[idKey]`）也就在里面。不再包一层 `{ properties }` 是为了让 `pick.item[字段名]`
 * 直接可用（包一层之后每次取值都要多写一次 `.properties`）。
 */
export type BMapFeaturePick = BMapPointPick<Record<string, unknown>>;

/**
 * 官方 `StyleExpress`（数据驱动样式表达式）：`string | object | ((properties) => any)`。
 *
 * 本库**如实透传**而不是猜它的结构：`object` 那一支是 SDK 自己的表达式语法（`['match', …]` 一
 * 类），复刻一份必然会与上游漂移。函数那一支的参数是要素的 `properties`。
 */
export type BMapStyleExpression =
  | string
  | Record<string, unknown>
  | ((properties: Record<string, unknown>) => unknown);

/* ------------------------------------------------------------------ 原生批量线 / 面图层（#36） */

/**
 * `BLineLayer` 的样式（官方 `LineStyle` 的**逐字段**投影）。
 *
 * 字段名与默认值以 `@baidumap/jsapi-v4-types@4.0.4` 的 `LineStyle` 为准；这里只做类型搬运，
 * 不重新解释语义（默认值写在文档里，实现不补默认值——`undefined` = 不表态，由 SDK 决定）。
 *
 * ⚠️ 样式是**逐字段 merge**（官方 `setStyleOptions`）：把某个字段改成 `undefined` 时，SDK 侧仍
 * 留着上一次的值，因此本库会**重建图层**让它回到 SDK 自己的默认（并告警一次）。
 */
export interface BLineLayerStyle {
  /** 是否采用间隔填充纹理。默认 `false`。 */
  sequence?: boolean;
  /** 间隔距离（像素）。默认 `16`。 */
  marginLength?: number;
  /** 是否描边覆盖填充。默认 `true`。 */
  borderCovered?: boolean;
  /** 是否受内部填充区域掩膜。默认 `true`。 */
  borderMask?: boolean;
  /** 描边宽度（像素）。默认 `0`。 */
  borderWeight?: number | BMapStyleExpression;
  /** 描边颜色。默认 `'rgba(27, 142, 236, 1)'`。 */
  borderColor?: string | BMapStyleExpression;
  /** 填充纹理图片地址（竖向表达，自动横向处理）。 */
  strokeTextureUrl?: string | BMapStyleExpression;
  /** 填充纹理图片宽度（2 的 n 次方）。 */
  strokeTextureWidth?: number | BMapStyleExpression;
  /** 填充纹理图片高度（2 的 n 次方）。 */
  strokeTextureHeight?: number | BMapStyleExpression;
  /** 线连接处类型：`'miter'` / `'round'` / `'bevel'`。默认 `'round'`。 */
  strokeLineJoin?: string | BMapStyleExpression;
  /** 线端头类型：`'round'` / `'butt'` / `'square'`。默认 `'square'`。 */
  strokeLineCap?: string | BMapStyleExpression;
  /** 线颜色。默认 `'rgba(25, 25, 250, 1)'`。 */
  strokeColor?: string | BMapStyleExpression;
  /** 线宽度（像素）。默认 `2`。 */
  strokeWeight?: number | BMapStyleExpression;
  /** 线透明度（0-1）。默认 `1`。 */
  strokeOpacity?: number | BMapStyleExpression;
  /** 线类型：`'solid'` / `'dashed'` / `'dotted'`。默认 `'solid'`。 */
  strokeStyle?: string | BMapStyleExpression;
  /** 虚线设置（实线部分与间隙部分长度的数组）。默认 `[8, 4]`。 */
  dashArray?: number[] | BMapStyleExpression;
  /** `MultiLineString` 是否以多段线组成一条线（配合 `strokeColorControl` 逐段上色）。默认 `false`。 */
  linksLine?: boolean;
  /** 输入「第几条路线、第几段」，输出颜色字符串。 */
  strokeColorControl?: (line: number, segment: number) => string;
  /** 痕迹是否使用消失模式（`false` 表示由 `traceControl` 决定颜色）。默认 `false`。 */
  traceDisappear?: boolean;
  /** 痕迹是否从起点开始处理（否则从终点）。默认 `true`。 */
  traceStart?: boolean;
  /** 输入路线数组，输出「距起点的痕迹长度数组」（米）。 */
  traceControl?: (line: number[]) => number[];
  /** 痕迹颜色（RGB，0-255）。 */
  traceColor?: [number, number, number];
  /** 线图层高度。默认 `0`。 */
  height?: number | BMapStyleExpression;
}

/**
 * `BFillLayer` 的样式（官方 `FillLayerStyle` 的逐字段投影）。
 *
 * 含「纯色 / 描边 / 纹理（掩膜或贴图）」三套；纹理模式下 `patternMask` 决定 `fillColor` 是否生效
 * （详见各字段文档，取自官方声明）。
 */
export interface BFillLayerStyle {
  /** 填充颜色。`patternMask=true`（掩膜模式）下纹理不透明区域显示该颜色。默认 `'#142655'`。 */
  fillColor?: string | BMapStyleExpression;
  /** 填充透明度（直接参与最终 alpha）。默认 `1`。 */
  fillOpacity?: number | BMapStyleExpression;
  /** 是否采用纹理填充（需同时给 `patternUrl`）。默认 `false`。 */
  pattern?: boolean;
  /** 纹理渲染模式：`true` 掩膜（裁剪 `fillColor`）/ `false` 贴图（显示纹理颜色）。默认 `true`。 */
  patternMask?: boolean;
  /** 纹理雪碧图地址（需支持跨域）。默认 `''`。 */
  patternUrl?: string;
  /** 雪碧图中的纹理区域：`'x, y, width, height'`（像素）。默认 `'0, 0, 32, 32'`。 */
  patternMapping?: string | BMapStyleExpression;
  /** 纹理缩放比例（以 zoom=18 为基准）。默认 `1`。 */
  patternScale?: number | BMapStyleExpression;
  /** 纹理 UV 偏移量：`'u, v'`（0-1）。默认 `'0, 0'`。 */
  patternOffset?: string | BMapStyleExpression;
  /** 是否采用间隔填充纹理。默认 `false`。 */
  sequence?: boolean;
  /** 间隔距离（像素）。默认 `16`。 */
  marginLength?: number;
  /** 是否描边覆盖填充。默认 `true`。 */
  borderCovered?: boolean;
  /** 是否受内部填充区域掩膜。默认 `true`。 */
  borderMask?: boolean;
  /** 描边宽度（像素）。默认 `0`。 */
  borderWeight?: number | BMapStyleExpression;
  /** 描边颜色。默认 `'rgba(27, 142, 236, 1)'`。 */
  borderColor?: string | BMapStyleExpression;
  /** 填充纹理图片地址。 */
  strokeTextureUrl?: string | BMapStyleExpression;
  /** 填充纹理图片宽度（2 的 n 次方）。 */
  strokeTextureWidth?: number | BMapStyleExpression;
  /** 填充纹理图片高度（2 的 n 次方）。 */
  strokeTextureHeight?: number | BMapStyleExpression;
  /** 线连接处类型：`'miter'` / `'round'` / `'bevel'`。默认 `'round'`。 */
  strokeLineJoin?: string | BMapStyleExpression;
  /** 线端头类型：`'round'` / `'butt'` / `'square'`。默认 `'square'`。 */
  strokeLineCap?: string | BMapStyleExpression;
  /** 描边线颜色。默认 `'rgba(25, 25, 250, 1)'`。 */
  strokeColor?: string | BMapStyleExpression;
  /** 描边线宽度（像素）。默认 `2`。 */
  strokeWeight?: number | BMapStyleExpression;
  /** 描边线透明度（0-1）。默认 `1`。 */
  strokeOpacity?: number | BMapStyleExpression;
  /** 描边线类型：`'solid'` / `'dashed'` / `'dotted'`。默认 `'solid'`。 */
  strokeStyle?: string | BMapStyleExpression;
  /** 虚线设置。默认 `[8, 4]`。 */
  dashArray?: number[] | BMapStyleExpression;
  /** 面图层高度。默认 `0`。 */
  height?: number | BMapStyleExpression;
}

/**
 * 原生批量可视化图层共用的**统一槽位**（issue #36 的「统一 setData/style/base options/
 * visible/opacity/zoom/zIndex」）。
 *
 * 四个槽位各自有没有落地方式**取决于该 kind 的官方方法面**（由 Driver 的 `supports()` 回答）：
 * 例如 `Heatmap` / `TrackLine` 没有 `setVisible` / `setOpacity` / 缩放范围 setter，因此对应组件
 * **不声明**这些 prop（声明了却忽略 = 假支持）。`visible` 在那种 kind 上表达为「挂上 / 摘掉」。
 */
export interface BMapNativeLayerCommonProps {
  /** 是否显示。默认 `true`。 */
  visible?: boolean;
  /** 图层透明度（0-1）。 */
  opacity?: number;
  /** 图层层级（挂载后写入；官方层级方法要求先挂到地图上）。 */
  zIndex?: number;
  /** 最小显示缩放等级。 */
  minZoom?: number;
  /** 最大显示缩放等级。 */
  maxZoom?: number;
}

/** 四个可视化图层共用的**构造期**拾取 / 选中选项（变化 ⇒ 换实例，官方只有整袋 `setBaseOptions`）。 */
export interface BMapNativeLayerPickOptions {
  /**
   * 数据项属性 key（= 业务身份字段）。官方构造选项 `idKey`。
   *
   * 它是拾取与 Feature State 的**唯一身份口径**：不设置时拾取会如实返回 `id: null`、
   * Feature State 的五个命令会被拒绝并告警一次（本库不猜官方默认值）。
   * 空字符串是**合法字段名**（`PropertyKey` 口径），不会被视为「未声明」。
   */
  idKey?: string;
  /** 来源坐标系：`BD09LL`（默认）/ `BD09MC` / `GCJ02`。 */
  crs?: string;
  /**
   * 是否开启鼠标拾取，默认 **`true`**。
   *
   * 与官方默认值（`false`）**不同**，刻意如此：不给事件就别怪用户拿不到 `pick`。
   * 关掉它可以省掉拾取开销。
   */
  enablePicked?: boolean;
  /** 拾取矩形宽（像素，官方默认 30）。 */
  pickWidth?: number;
  /** 拾取矩形高（像素，官方默认 30）。 */
  pickHeight?: number;
  /** 是否允许鼠标悬浮事件（官方 `autoSelect`，默认 `false`）。 */
  autoSelect?: boolean;
  /** 选中数据颜色（官方 `selectedColor`，默认 `'rgba(20, 20, 200, 1.0)'`）。 */
  selectedColor?: string;
}

/**
 * `BLineLayer` 的 props。
 *
 * `data` 的三个取值承担三件事（与 `LayerSpec` 的口径一致，别用一个值兼表两件事）：
 *
 * - **有对象** ⇒ `setData()`，**不重建**；
 * - **`null`** ⇒ 明确「没有数据」。官方专页这四类**没有公开的清空入口**（上游声明里只有
 *   `setData`/`getData`），因此本库换一个**没有数据的实例**来表达它（代价是一次重建，见 ADR 的
 *   已知限制）；
 * - **`undefined`** ⇒ 不表态：不产生任何 SDK 调用，已画出来的数据保持不变。
 */
export interface BLineLayerProps extends BMapNativeLayerCommonProps, BMapNativeLayerPickOptions {
  /** GeoJSON 数据（`FeatureCollection` / 单条 `Feature`）；`null` = 没有数据，`undefined` = 不表态。 */
  data?: object | null;
  /** 线样式（见 `BLineLayerStyle`）。变化时 `setStyleOptions` + `doOnceDraw`，不重建。 */
  style?: BLineLayerStyle;
}

/** `BFillLayer` 的 props。 */
export interface BFillLayerProps extends BMapNativeLayerCommonProps, BMapNativeLayerPickOptions {
  /**
   * GeoJSON 数据；有值时走 `setData()`（不重建），`null` = 没有数据（换一个空实例）、
   * `undefined` = 不表态。详见 `BLineLayerProps.data` 的三条口径。
   */
  data?: object | null;
  /** 面样式（见 `BFillLayerStyle`）。变化时 `setStyleOptions` + `doOnceDraw`，不重建。 */
  style?: BFillLayerStyle;
  /**
   * 是否显示描边（官方构造选项 `border`，**官方默认 `true`**）。
   *
   * 刻意不给默认值（`withDefaults` 里显式写 `undefined`）：Vue 对 `Boolean` 有「缺省即 `false`」
   * 的转换，不给默认值会让每个不传 `border` 的用户都隐式地关掉描边。
   */
  border?: boolean;
}

/**
 * `BHeatmapLayer` 的 props。
 *
 * 官方 `Heatmap` 属**扩展 API**：`@baidumap/jsapi-v4-types@4.0.4` 没有类声明，可视化实现是
 * 「首次加载时异步注入」的。本库只暴露驱动已登记的入口（`setData` / `setStyle`；驱动也登记了
 * `clearData`，但本组件不调用它——见下），因此**没有** `opacity` / `zIndex` / `minZoom` /
 * `maxZoom`：官方这些图层不公开对应 setter，声明了也只是静默忽略。
 */
export interface BHeatmapLayerProps {
  /**
   * GeoJSON 点数据；`null` = 没有数据，`undefined` = 不表态。
   *
   * `null` 在**所有** kind 上走同一条路（换一个没有数据的实例），而不是「有 `clearData` 入口就
   * 用它」：同一个 prop 在不同 kind 上换语义，是使用者最难预期的一类差异。
   */
  data?: object | null;
  /**
   * 样式（官方扩展 API 只公开整袋 `setOptions`，且没有可核对的声明）。
   *
   * 因此这里是**原样透传**的键值袋而不是逐个字段的强类型：本库不复刻一份没有依据的字段表。
   */
  style?: Record<string, unknown>;
  /** 是否显示。默认 `true`；该 kind 没有 `setVisible` ⇒ 用挂上 / 摘掉表达（重新可见时换实例）。 */
  visible?: boolean;
}

/**
 * `BTrackLineLayer` 的 props。
 *
 * 与热力图同属扩展 API；驱动的登记面（#110 之后）包含 `setData` + 六条播放命令，因此本组件
 * 声明 `data` / `visible`，并 expose 播放命令面（见 `BTrackLineLayerExpose`）。
 *
 * 播放命令的方法名均经 live 探针取证（`scripts/probe-track-line.mts`，2026-09-23，exit 0），
 * 不是从类型包猜的——在拿到读数之前不猜方法名是 #110 的硬门（已过）。
 */
export interface BTrackLineLayerProps {
  /**
   * 轨迹数据：官方 `TrackLine` 只接收**单条 `LineString` Feature**。
   *
   * 形状由调用方保证（本库不做 GeoJSON 校验：那属于数据适配层，而该 kind 没有任何可核对的声明
   * 来支撑「什么算合法」）。
   *
   * `null` = **没有轨迹**（换一个空实例，因此不再显示上一条轨迹）、`undefined` = 不表态。
   */
  data?: object | null;
  /** 是否显示。默认 `true`；该 kind 没有 `setVisible` ⇒ 用挂上 / 摘掉表达。 */
  visible?: boolean;
  /**
   * 页面 hidden 时是否**自动 pause**（shown 恢复 resume）。默认 `false`。
   *
   * live 探针实测：**SDK 不会**在页面 hidden 时自动暂停（`progress` 继续推进）。因此默认策略是
   * 只停掉本库自己的观察（`observed` 不再更新），**不**改写业务播放意图。自动 pause/resume
   * 必须是显式 opt-in（issue #110 的硬约束），且只在「本次 pause 是 visibility 发起的」时才
   * resume——用户自己 pause 过的不被 visibility 抢走。
   */
  pauseOnHidden?: boolean;
}

/** 事件派生的进度读数（只读；不镜像成「播放状态机」）。 */
export interface BTrackLineObserved {
  /** 播放进度 0–1（`progress` 载荷的 `process`）。 */
  process?: number;
  /** 已播放时长（`progress` 载荷的 `elapsed`）。 */
  elapsed?: number;
  /** 已播放距离（`progress` 载荷的 `distance`）。 */
  distance?: number;
  /** 当前位置（`progress` 载荷的 `point`）。 */
  point?: unknown;
  /** 当前朝向角（`progress` 载荷的 `angle`）。 */
  angle?: number;
  /** 播放状态码（`statuschange` 载荷的 `status`）。 */
  status?: number;
  /** 播放状态名（`statuschange` 载荷的 `statusName`）。 */
  statusName?: string;
}

/** `BTrackLineLayer` expose 的命令面与只读观察（#110）。 */
export interface BTrackLineLayerExpose {
  /**
   * 播放命令面：`start / pause / resume / stop / setSpeed / setProcess`。
   *
   * 命令是**发出去**的：是否真的暂停由 SDK 的 `progress` / `statuschange` 事件回答
   * （见 `observed`）。未就绪时命令告警一次并跳过（不排队）。
   */
  playback: import("../core/layers/trackLinePlayback").TrackLinePlaybackApi;
  /**
   * 事件派生的进度读数（只读；换实例时由新实例的事件重建）。
   *
   * **不**是内部播放状态机——它只是把 SDK 事件里我们认识的字段搬过来。
   *
   * 消费方经 `vm.observed` 读到的就是**值**（`defineExpose` 的 expose 面用取值 getter，
   * 与 `BMapExpose` 同一口径）。需要追踪变化时用 `watch(() => vm.observed, …)`
   * （getter 内部读 `shallowRef.value`，依赖仍会挂上）。
   */
  observed: BTrackLineObserved | null;
}

/* ------------------------------------------------ 点图层的另两个 kind（#35 新增） */

/**
 * `BPointIconLayer` 的 props（原生 `PointIconLayer`）。
 *
 * 样式字段是官方 `PointIconStyle` 的子集；`isFlat` / `isFixed` 是**构造期**选项
 * （它们决定渲染通道，官方写在 `PointIconLayerOptions` 上而不是 style 里）。
 */
export interface BPointIconLayerProps<Item> extends BMapDataProps<Item> {
  /** 属性映射：写进每个要素的 `properties`（口径同 `BPointShapeLayerProps.properties`）。 */
  properties?: (item: Item) => Record<string, unknown> | null | undefined;
  /** 图标 URL。 */
  icon?: string;
  /** 图标宽度（像素）。 */
  width?: number;
  /** 图标高度（像素）。 */
  height?: number;
  /** 图标锚点，中间点为 `[0, 0]`，取值 `[-1, 1]`。 */
  anchors?: [number, number];
  /** 图标偏移 `[x, y]`（像素）。 */
  offset?: [number, number];
  /** 缩放比例。 */
  scale?: number;
  /** 旋转角度（度）。 */
  rotation?: number;
  /** 是否贴地（构造期，官方默认 `true`）。 */
  isFlat?: boolean;
  /** 是否跟随缩放保持尺寸（构造期，官方默认 `true`）。 */
  isFixed?: boolean;
  /** 图层透明度 `0`-`1`。 */
  opacity?: number;
  /** 图层层级（挂载后写入）。 */
  zIndex?: number;
  /** 最小显示缩放等级。 */
  minZoom?: number;
  /** 最大显示缩放等级。 */
  maxZoom?: number;
  /** 是否开启鼠标拾取，默认 `true`（口径同 `BPointShapeLayerProps.enablePicked`）。构造期选项。 */
  enablePicked?: boolean;
  /** 点击拾取矩形宽（像素）。构造期选项。 */
  pickWidth?: number;
  /** 点击拾取矩形高（像素）。构造期选项。 */
  pickHeight?: number;
}

/**
 * `BPointLayer` 的 props（原生 `BMap.PointLayer`，**扩展 API**）。
 *
 * ⚠️ 它是三者里唯一「运行时存在、类型包没有类声明」的：可视化实现由 SDK **按需异步注入**，
 * 因此在注入完成之前创建会显式失败（`BMAP_CAPABILITY_UNSUPPORTED`）。它**不会**自动改用
 * `PointShapeLayer` / `PointIconLayer` —— 那是另一个 SDK 能力，偷偷换掉等于改掉调用方的意图。
 *
 * 选项是**扁平**的（官方专页的例子是 `new BMap.PointLayer({ shape, size, fillColor })`），
 * 与 `BPointShapeLayer` 的 `style` 袋不同。
 */
export interface BPointLayerProps<Item> extends BMapDataProps<Item> {
  /** 属性映射：写进每个要素的 `properties`（口径同 `BPointShapeLayerProps.properties`）。 */
  properties?: (item: Item) => Record<string, unknown> | null | undefined;
  /** 几何图形（官方 `shape`，如 `"circle"`）。未配置 `icon` 时按它绘制几何图元。 */
  shape?: string;
  /** 图标 URL。配置它之后进入图标模式（与 `shape` 二选一，图标优先）。 */
  icon?: string;
  /** 点尺寸（像素）。 */
  size?: number;
  /** 填充颜色。 */
  fillColor?: string;
  /** 填充透明度 `0`-`1`。 */
  fillOpacity?: number;
  /** 描边颜色。 */
  strokeColor?: string;
  /** 描边宽度（像素）。 */
  strokeWeight?: number;
  /** 缩放比例。 */
  scale?: number;
  /** 旋转角度（度）。 */
  rotation?: number;
  /** 偏移 `[x, y]`（像素）。 */
  offset?: [number, number];
  /** 锚点。 */
  anchor?: string;
  /**
   * 是否开启鼠标拾取，默认 `true`。构造期选项（官方另有 `setEnablePicked`，本库统一走构造期，
   * 三个点图层组件的这条语义因此一致）。
   *
   * ⚠️ 图层级的 `opacity` / `zIndex` / `minZoom` / `maxZoom` **没有**暴露：它们走的是
   * `setOpacity` / `setZIndex` / `setMinZoom` / `setMaxZoom`，而官方扩展专页没有把这一族列为
   * `PointLayer` 的方法面 —— 按本库「不把未声明的继承成员当契约」的口径，Driver 对它们回答
   * `unsupported`（`setVisible` 是唯一的例外，它取过证）。收下一个用不了的 prop 属于假支持。
   */
  enablePicked?: boolean;
  /** 点击拾取矩形宽（像素）。构造期选项。 */
  pickWidth?: number;
  /** 点击拾取矩形高（像素）。构造期选项。 */
  pickHeight?: number;
}

/* ------------------------------------------------ 原生聚合（#35） */

/**
 * `BMarkerCluster` 的聚合引擎。
 *
 * | 值 | 落地成什么 | 依据 |
 * | --- | --- | --- |
 * | `"native"`（默认） | 一个 v4 原生 `ClusterLayer`（WebGL 渲染） | issue #35：原生层是默认路径 |
 * | `"markers"` | 网格聚合 + 每簇 / 每单点一个 SDK Marker | 见下 |
 *
 * `"markers"` 是**显式选择**，不是自动兜底：原生 Cluster 在本库的实测里是可用的
 * （`scripts/probe-native-point-cluster.mts`），所以「原生缺了就用自研」这条自动降级不成立
 * （issue #35 的范围纠正：fallback 只由真实缺口触发）。它保留下来是因为它**多给一样东西**：
 * 簇的业务项（`cluster-click` 的 `items`）—— 原生引擎拿不到（官方没有公开入口）。
 */
export type BMarkerClusterEngine = "native" | "markers";

export interface BMarkerClusterProps<Item> extends BMapDataProps<Item> {
  /**
   * 聚合引擎，默认 `"native"`。
   *
   * 换引擎 = 换资源形态（一个原生图层 ⇄ 一堆 Marker），因此它是**构造期**选项：变化时整层重建。
   */
  engine?: BMarkerClusterEngine;
  /* ----------------------------------------------- engine: "markers" 的选项 */
  /** 像素网格边长（聚合桶的边长），默认 `128`。只在 `engine: "markers"` 下生效。 */
  gridSize?: number;
  /** 达到该数量才聚合；不足的点展开为独立 item，不会丢点。默认 `3`。只在 `engine: "markers"` 下生效。 */
  minClusterSize?: number;
  /** 聚合使用的 zoom；缺省时读取地图当前 zoom（读不到时用 `8`）。只在 `engine: "markers"` 下生效。 */
  zoom?: number;
  /* ------------------------------------------------ engine: "native" 的选项 */
  /**
   * 聚合半径（像素，官方 `clusterRadius`）。只在 `engine: "native"` 下生效。
   *
   * **未提供时不写这个选项**：官方默认值由 SDK 自己决定，本库不认识它（同 #34「不猜默认值」）。
   */
  clusterRadius?: number;
  /** 达到该数量才聚合（官方 `clusterMinPoints`）。未提供时由 SDK 决定。只在 `engine: "native"` 下生效。 */
  clusterMinPoints?: number;
  /** 聚合生效的**最小** zoom（官方 `clusterMinZoom`）。未提供时由 SDK 决定。只在 `engine: "native"` 下生效。 */
  clusterMinZoom?: number;
  /** 聚合生效的**最大** zoom（官方 `clusterMaxZoom`）。未提供时由 SDK 决定。只在 `engine: "native"` 下生效。 */
  clusterMaxZoom?: number;
  /** 点击簇时自动缩放到该簇（官方 `fitViewOnClick`）。未提供时由 SDK 决定。只在 `engine: "native"` 下生效。 */
  fitViewOnClick?: boolean;
  /**
   * 未参与聚合的单点样式（官方 `singleStyle`）。只在 `engine: "native"` 下生效。
   *
   * 键名与取值跟官方 `PointLayer` 的**扁平**选项一致（`shape` / `size` / `fillColor` /
   * `fillOpacity` / `strokeColor` / `strokeWeight` …）—— 官方没有为它发布类型声明，
   * 因此这里如实收成开放记录，而不是本库臆造一套字段名。
   */
  singleStyle?: Record<string, unknown>;
}

/**
 * 簇点击载荷（`BMarkerCluster` 的 `cluster-click`）。
 *
 * 两种引擎的**公共最小契约**由前四个字段构成（它们在任何引擎上都成立）；差异收在 `items` 上，
 * 而不是把两种形态塞进同一个字段名（issue #35 的范围纠正：「不为了 native/fallback API 看起来
 * 一样去恢复 SDK 没有公开的内部状态或事件身份」）。
 */
export interface BMapClusterPick<Item> {
  /** 哪个引擎产出的这一簇。 */
  engine: BMarkerClusterEngine;
  /**
   * 稳定标识：`native` 用官方 `clusterId`；`markers` 用网格 id（`c-<cellX>:<cellY>`）。
   *
   * 它不是业务键（一个簇本来就是一组业务项）；要业务身份请看 `items` 或 `item-click`。
   */
  id: string;
  /** 簇内点数。 */
  size: number;
  /** 簇位置（聚合后的锚点）。 */
  position: { lng: number; lat: number };
  /**
   * 簇内的业务项。
   *
   * - `engine: "markers"` ⇒ 总是业务项数组（聚合在 JS 侧做，手上就有它们）；
   * - `engine: "native"` ⇒ **`null`**：官方在命中载荷里只给簇的元数据
   *   （`isCluster` / `clusterId` / `pointCount` / `bbox`），`getClusterLayer().getItems()`
   *   也只有簇级条目 —— 「这个簇里有哪几个业务项」**没有公开读回入口**（实测见 ADR
   *   `2026-09-19-native-point-layers-and-cluster`）。用 `null` 而不是空数组，是为了让
   *   「这一层拿不到」与「这一簇确实是空的」在类型上就分得开。
   */
  items: Item[] | null;
}

/**
 * 聚合结果读数（`BMarkerCluster` 的 `cluster-change`）。
 *
 * 两个引擎给出同一份面：`native` 转发官方 `ClusterLayer` 的 `change` 事件（官方口径：
 * 载荷是 `{ singles, clusters, zoom }`），`markers` 在本层重算之后给出同样的读数。
 * 它只是**读数转发** —— 本库不把它存成组件状态，也不据此推导业务行为（组件拥有的只有 props）。
 */
export interface BMapClusterChange {
  /** 哪个引擎产出的读数。 */
  engine: BMarkerClusterEngine;
  /** 当前聚合出的簇数量。 */
  clusters: number;
  /** 未参与聚合（被展开成独立点）的数量。 */
  singles: number;
  /** 本次聚合使用的 zoom；引擎没给读数时为 `null`（不编一个数字）。 */
  zoom: number | null;
}
