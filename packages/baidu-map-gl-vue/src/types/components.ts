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
 * BInfoWindow 的公开属性。
 *
 * 字段与逐字段语义的**单一声明点**在 `core/overlays/InfoWindowSpec.ts`（那里还带着
 * 「每个属性怎么落地」的策略表，由用例与 Driver 描述符交叉锁定）。这里只把公开类型名
 * 暴露给调用方，避免出现第二份字段清单。
 */
export interface BInfoWindowProps extends InfoWindowProps {}

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
