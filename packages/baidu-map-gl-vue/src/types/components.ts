/**
 * 组件公共 Props 类型(与各 SFC `export interface XxxProps` 对齐)
 *
 * 说明:
 * - SFC 内 `defineProps<XxxProps>()` 使用此处类型(单一来源)。
 * - 根入口从此文件导出,避免从 `*.vue` 导出类型(TS 无法在纯 tsc 下解析 .vue 具名命名导出)。
 * - 精确的组件实例类型仍由 Volar 从 SFC 解析。
 */
import type { InfoWindowProps } from "../core/overlays/InfoWindowSpec";

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
   * 业务身份（`feature.properties[idKey]` 的值）；**确认不到时为 `null`**。
   *
   * 「确认不到」有两种：组件没有 `idKey` 可依据，或者 `properties[idKey]` 不是有限数字 / 字符串。
   * 两种都如实返回 `null`——本库不按事件顺序 / 下标猜一个身份出来，也不猜官方的默认 `idKey`。
   */
  id: string | number | null;
  /**
   * 命中的业务项（**最新**的那个）；未命中时为 `null`。
   *
   * 与 `id` 是**两件事**：`item` 只要求「命中并且读到了属性」，因此 `id` 为 `null` 时 `item`
   * 往往仍然有值（例如没设置 `idKey` 时，线 / 面图层依然能给出命中要素的 `properties`）。
   * 逐项数据组件（`BPointCollection`）的业务对象与要素分离，它的 `item` 需要靠身份去索引，
   * 因此那一类组件在 `id` 为 `null` 时 `item` 也是 `null`。
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
   * 它是拾取与 Feature State 的**唯一身份口径**：不设置（或设为空字符串）时拾取会如实返回
   * `id: null`、Feature State 的五个命令会被拒绝并告警一次（本库不猜官方默认值）。
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
 * `BTrackLineLayer` 的 props（**基线**）。
 *
 * 与热力图同属扩展 API；驱动的登记面里它只有 `setData`，因此本组件只声明 `data` 与 `visible`。
 *
 * **播放控制（`start` / `pause` / `resume` / `stop`）与页面可见性联动刻意未实现**：官方类型包
 * 没有该类声明，方法名必须先经真实运行时探针取证（本机可跑的 live 探针），在没有证据之前
 * 不猜方法名、也不建一套镜像 SDK 播放状态的内部状态机。见 ADR
 * `2026-09-19-native-data-layer-components` 的欠账表。
 */
export interface BTrackLineLayerProps {
  /**
   * 轨迹数据：官方 `TrackLine` 只接收**单条 `LineString` Feature**。
   *
   * 形状由调用方保证（本库不做 GeoJSON 校验：那属于数据适配层，而该 kind 没有任何可核对的声明
   * 来支撑「什么算合法」）。
   *
   * `null` = **没有轨迹**（换一个空实例，因此不再显示上一条轨迹）、`undefined` = 不表态。这是
   * 「无数据」在这一族里的唯一可收敛表达：驱动登记面里 `track-line` 只有 `setData`，没有清空入口
   * （#106 评审的 P1-2）。
   */
  data?: object | null;
  /** 是否显示。默认 `true`；该 kind 没有 `setVisible` ⇒ 用挂上 / 摘掉表达。 */
  visible?: boolean;
}
