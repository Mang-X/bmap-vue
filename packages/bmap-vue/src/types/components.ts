/**
 * 组件公共 Props 类型(与各 SFC `export interface XxxProps` 对齐)
 *
 * 说明:
 * - SFC 内 `defineProps<XxxProps>()` 使用此处类型(单一来源)。
 * - 根入口从此文件导出,避免从 `*.vue` 导出类型(TS 无法在纯 tsc 下解析 .vue 具名命名导出)。
 * - 精确的组件实例类型仍由 Volar 从 SFC 解析。
 */
import type { InfoWindowProps as InfoWindowSpecProps } from "../core/overlays/InfoWindowSpec";
import type { Pixel, Point } from "../driver/types/geometry";
import type { MapHandle, SdkHandle } from "../driver/types/handles";

/** MapMask 掩膜显示区域 */
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

/**
 * 官方 `BMap.MapTypeId` 的内置地图类型常量名。
 *
 * **逐条来自 `@baidumap/jsapi-v4-types@4.0.5` 的 `map-type/MapTypeId.d.ts`**，该文件把这五个
 * 名字逐个声明为 `MapTypeId` 的静态成员：
 *
 * | 常量 | 官方 d.ts 的静态成员声明 | 本库归一化后的语义类型 |
 * | --- | --- | --- |
 * | `BMAP_NORMAL_MAP` | `static BMAP_NORMAL_MAP: string`（普通街道视图） | `"normal"` |
 * | `BMAP_SATELLITE_MAP` | `static BMAP_SATELLITE_MAP: string`（卫星地图） | `"satellite"` |
 * | `BMAP_HYBRID_MAP` | `static BMAP_HYBRID_MAP: string`（卫星与路网混合地图） | `"hybrid"` |
 * | `BMAP_EARTH_MAP` | `static BMAP_EARTH_MAP: string`（地球卫星视图） | `"earth"` |
 * | `BMAP_NONE_MAP` | `static BMAP_NONE_MAP: string`（无底图模式） | — |
 *
 * 之前 `mapType` 是裸 `string`，运行时 `toMapType()` 只映射三个名字、其余（含
 * `BMAP_HYBRID_MAP`）**静默回退**成 `normal`：用户要混合图拿到的是普通图，且没有任何错误。
 * 收成封闭联合之后，拼错的名字在类型层就被拒，混合图走上真映射，无底图显式失败。
 *
 * `BMAP_NONE_MAP` 官方 d.ts **声明**了，但真实 4.0 运行时的 `BMap.MapTypeId` 上没有对应成员
 * （与「`BMAP_*` 常量挂在全局而非 `MapTypeId`」是同一类上游出入，见
 * `driver/jsapi-v4/map.ts` 的 `MAP_TYPE_CONSTANT_CANDIDATES`）。因此它在**类型层合法**（官方
 * 确实声明了）、在**运行期显式失败**——本库不猜「无底图」该画成什么，也不静默替换。
 */
export type MapTypeIdName =
  | "BMAP_NORMAL_MAP"
  | "BMAP_SATELLITE_MAP"
  | "BMAP_HYBRID_MAP"
  | "BMAP_EARTH_MAP"
  | "BMAP_NONE_MAP";

export interface MapProps {
  ak?: string;
  apiUrl?: string;
  /**
   * 显式 Provider（结构化：`load()` 返回 `LoadedJsapiV4`，engine = `jsapi-v4`）。
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
  /**
   * 地图类型：官方 `BMap.MapTypeId` 的**五个**内置常量名（`@baidumap/jsapi-v4-types@4.0.5`
   * 的 `map-type/MapTypeId.d.ts` 逐个声明了静态成员）。
   *
   * 取值域是**封闭**的：拼错的名字在类型层就被拒，而不是运行时静默降级。四个取值能被直接
   * 归一化（`normal` / `satellite` / `earth` / `hybrid`）；`BMAP_NONE_MAP`（无底图）官方
   * 4.0 运行时的 `BMap.MapTypeId` 上**没有**对应成员，因此它**显式失败**（`BMAP_INVALID_ARGUMENT`）
   * 而不是悄悄画成普通图——「要混合图拿到普通图且无任何提示」曾经是一个静默错值 bug。
   */
  mapType?: MapTypeIdName;
  /**
   * 个性化样式 id（官方 `MapStyleConfig.styleId`，来自个性化编辑器）。
   *
   * 与 `mapStyleJson` **互斥**：官方 `setMapStyle` 的两个键都表示「一整套样式」，
   * 同时给没有可复现的语义（live 实测的结果取决于 SDK 内部的合并顺序），
   * 因此本库在组件层**显式失败**，不静默丢一个。
   */
  mapStyleId?: string;
  /**
   * 个性化样式 json（官方 `MapStyleConfig.styleJson?: object[]`）。
   *
   * ⚠️ 官方形状是**数组**（个性化编辑器的导出就是一组样式片段）。#165 Class 2 之前
   * 本库把它声明成 `Record<string, unknown>`（单数对象），且整份原样当作
   * `setMapStyle(config)` 的**整个 config** 下发——于是 `styleId` 那一支永远走不到，
   * 官方 `merge` 成员也没有任何通路。
   */
  mapStyleJson?: Record<string, unknown>[];
  displayOptions?: Record<string, unknown>;
  /**
   * 建图时保留绘图缓冲（官方 `getScreenshot` 的**前提**；该键不在官方 `MapOptions` 声明里，
   * 只出现在 `Map#getScreenshot` 的文档注释中，2026-09-26 live 实测确认运行时承认它）。
   *
   * **默认 `false`，刻意不替使用者开启**——官方 React 参考的惯例是「能力进目录 +
   * 显式 opt-in」，而常驻一块额外画布内存是库不该替用户做的取舍。参照实测：同一张图
   * 不带该选项时 `getScreenshot()` 返回 3,830 字节的**空画布**（即「黑屏」），带上则
   * 119,074 字节的真实内容。
   *
   * ⚠️ 它是**建图期**选项，事后无法补上：想用 `mapRef.getScreenshot()` 就必须**一开始**
   * 就开着。详见 `docs/zh-CN/contributing/165-runtime-verification.md`。
   */
  preserveDrawingBuffer?: boolean;
  /**
   * 地图允许展示的**最小**缩放级别。官方 `MapOptions.minZoom` 声明「取值范围 [3, 21]」。
   *
   * 库默认 `3`（合法下界）。传值越界**显式报错**（`BMAP_INVALID_ARGUMENT`）而不是把非法值
   * 原样交给 SDK：上游没有公开的归一化契约，静默接受等于把一个「文档说无效」的值当它有效。
   * 见 #165 Class 5。
   */
  minZoom?: number;
  maxZoom?: number;
  enableDragging?: boolean;
  /**
   * 是否允许鼠标滚轮 / 触摸板滑动缩放。
   *
   * 官方构造期键是 `enableWheelZoom`（`core/MapOptions.d.ts`）；官方**实例方法**才叫
   * `enableScrollWheelZoom()`。本 prop 表达的是构造期语义，因此取前者。
   *
   * ⚠️ **默认值刻意不同于官方**：官方 d.ts 标 `@default`（即默认开启），本库默认**关闭**
   *   （避免页面一滚就误缩放），并把 `enableWheelZoom: false` 写进构造 options 显式固定
   *   （见 `driver/jsapi-v4/map.ts` 的 `LIBRARY_MAP_DEFAULTS`）。**这是有意决策，不在本次改名范围**。
   */
  enableWheelZoom?: boolean;
  enableInertialDragging?: boolean;
  /**
   * 是否允许手势缩放。官方构造期键是 `enablePinchZoom`；官方**实例方法**才叫 `enablePinchToZoom()`。
   */
  enablePinchZoom?: boolean;
  enableKeyboard?: boolean;
  /**
   * 是否启用双击缩放（左键双击放大、右键双击缩小）。
   *
   * 官方构造期键是 `enableDblclickZoom`（注意官方拼 **`Dbl`**，只有一个 `c`）；
   * 官方**实例方法**才叫 `enableDoubleClickZoom()`。
   */
  enableDblclickZoom?: boolean;
  enableContinuousZoom?: boolean;
  /** 是否启用交通路况图层(v2 兼容) */
  enableTraffic?: boolean;
  /**
   * 容器尺寸变化时是否保持地图中心点不变。
   *
   * 官方构造期键是 `fixCenterWhenResize`（`core/MapOptions.d.ts`；官方 d.ts 标 `@default false`）。
   * `enableResizeOnCenter` 是 v2 时代的叫法——它其实是官方**实例方法**
   * `enableResizeOnCenter()` / `disableResizeOnCenter()` 的名字，本库此前误把方法名当成了
   * 构造期 prop 名。
   */
  fixCenterWhenResize?: boolean;
  /** 容器尺寸变化时自动重设尺寸(v2 兼容) */
  enableAutoResize?: boolean;
  loadingBgColor?: string;
  plugins?: string[];
}

/**
 * Marker 图标:内置名称或自定义图标描述
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

export interface MarkerProps {
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

  /* --- issue #168 item 2：官方 `MarkerOptions` 里此前未收的四个构造选项 ---
   *
   * 四个**全部是构造期**（`recreate`）：逐个核对 `overlay/Marker.d.ts` 的实例成员表，
   * 没有任何一个对应的 setter。逐条依据见 `driver/types/overlays.ts` 的
   * `OVERLAY_DESCRIPTORS.marker`。
   *
   * ⚠️ 三项的官方默认是 `false`（`raiseOnDrag` / `isTop` / `restrictDraggingArea`），
   * `draggingCursor` 无默认（`undefined`）——**四项都不在 `withDefaults` 里补值**，
   * 因为默认 `false` 与「未给」在 SDK 侧等价（`undefined` 就是不传该键）。
   */
  /**
   * 拖拽标注时，标注是否开启离开地图表面效果（官方 `raiseOnDrag`，`@default false`）。
   *
   * 官方原文：「拖拽标注时，标注是否开启离开地图表面效果」。无 setter ⇒ 改它会重建实例。
   */
  raiseOnDrag?: boolean;
  /**
   * 拖拽标注时的鼠标指针样式（官方 `draggingCursor`）。
   *
   * ⚠️ **收普通 `string`，不是枚举联合**。官方声明就是
   * `draggingCursor?: string`（原文：「需遵循 CSS cursor 属性规范」），
   * **没有任何候选值清单**。CSS cursor 的合法值是**开放集合**（`grabbing` / `move` /
   * `crosshair` / … 以及任意 `url(…)`），自造一个联合一定会漏掉合法值。
   *
   * 无 setter ⇒ 改它会重建实例。
   */
  draggingCursor?: string;
  /**
   * 是否将标注置于其他标注之上（官方 `isTop`，`@default false`）。
   *
   * 官方原文：「是否将标注置于其他标注之上。默认情况下纬度低的标注会盖住纬度高的标注」。
   * ⚠️ 与 `zIndex`（层叠顺序**值**，`mutable`）**不是同一件事**：这个是**布尔**的置顶开关。
   * 无 setter ⇒ 改它会重建实例。
   */
  isTop?: boolean;
  /** 是否限制拖拽区域（官方 `restrictDraggingArea`，`@default false`）。无 setter ⇒ 改它会重建实例。 */
  restrictDraggingArea?: boolean;
}

/**
 * InfoWindow 的公开属性。字段与逐字段语义的声明点在 `core/overlays/InfoWindowSpec.ts`
 * （含「每个属性怎么落地」的策略表），这里只暴露公开类型名。
 */
export interface InfoWindowProps extends InfoWindowSpecProps {
  // 字段全部来自 `InfoWindowProps`（单一事实源，见上面的注释）。
  //
  // ⚠️ 这里**必须**保持「多行花括号」的写法：`tests/behavior/overlay-suite.test.ts` 的
  // `readPropsKeys()` 用 `([\s\S]*?)\n\}` 切接口正文（为的是不把行内对象类型 `{ lng, lat }`
  // 当成分隔符）。写成单行 `{}` 会让那个非贪婪匹配**继续往后吞**，把紧随其后的接口正文并进
  // 这一次匹配里 —— 结果是那几个接口在解析表里消失、声明面门禁误报（PR #101 合并 #31 后实测）。
}

/**
 * CustomOverlay 的公开属性（M5-CUSTOM-MENU / issue #33）。
 *
 * 字段与「每个属性怎么落地」的声明点在 `components/overlays/customOverlaySpec.ts`，这里只暴露
 * 公开类型名（与 `InfoWindowProps` 同一手法）。键集与 `OVERLAY_DESCRIPTORS["custom-overlay"]`
 * 的条目**一一对应**：能在构造期设置的写 `recreate`，有字段级 setter 的写 `options`。
 *
 * ⚠️ 与 `InfoWindowProps` 相同的约束：**必须保持多行花括号**（同一条正则门禁）。
 */
export interface CustomOverlayProps {
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
 * `ContextMenu` 的一条菜单项（数据 API）。
 *
 * 与 `<MenuItem>`（声明式 API）产出的条目**同形**：两种写法最终都归一化成这份结构，只是
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
 * ContextMenu 的公开属性（M5-CUSTOM-MENU / issue #33）。
 *
 * 声明点在 `core/overlays/ContextMenuSpec.ts`（含「每个属性怎么落地」的表）。
 *
 * ⚠️ 与 `InfoWindowProps` 相同的约束：**必须保持多行花括号**（同一条正则门禁）。
 */
export interface ContextMenuProps {
  /** 菜单项（数据 API）。写法与声明式 `<MenuItem>` / `<MenuSeparator>` 等价。 */
  items?: (ContextMenuItem | ContextMenuSeparator)[];
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
 * MenuItem 的公开属性（声明式 API）。
 *
 * 组件本身**不渲染任何 DOM**：它只把「这里有一条菜单项」注册给父级 `<ContextMenu>`，
 * 由父级按顺序交给 SDK 构建菜单。`select` 由本组件派发（载荷与数据 API 的 `callback` 相同）。
 *
 * ⚠️ 与 `InfoWindowProps` 相同的约束：**必须保持多行花括号**（同一条正则门禁）。
 */
export interface MenuItemProps {
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
 * 与 Driver 描述符的 `PATH_STYLE` 逐键对应，由 `overlay-suite.test.ts` 交叉锁定。
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

/**
 * 图形类覆盖物共有的层叠顺序、开关与显隐（**不含** `enableEditing`：Prism / BezierCurve
 * 上游没有编辑能力）。
 *
 * ## `zIndex` 为什么在这一层（issue #165 Class 3 / TASK 0）
 *
 * Driver 的 `PATH_STYLE` 早就把 `zIndex` 登记成 `mutateBy("setZIndex")`（官方 4.0.4 在
 * `Polyline` / `Polygon` / `Rectangle` / `Circle` / `BezierCurve` / `Prism` 六个类上都有
 * `setZIndex(zIndex: number): void` 声明），而**组件面没有出口**——分类层准备好了、字段没暴露，
 * 整族覆盖物的层级更新一次都没被走到过。
 *
 * 放在这一层而不是 `PathStrokeProps` / `PathFillProps`：层级**不是描边也不是填充**，它与
 * `enableMassClear` / `visible` 同属「覆盖物自身的一档属性」，而这六个图形类恰好全部
 * extends `PathShapeProps`（`PrismProps` / `GroundOverlayProps` 各自内联同名键，见下）。
 *
 * ⚠️ **没有**放进这一层的是 `CustomOverlay`：官方 `CustomOverlay.d.ts` 里**没有** `setZIndex`
 * （只有 `setPoint` / `setRotation` / `setRotationOrigin` / `setProperties` + 三个 getter），
 * 因此它的 `zIndex` 是**构造期**属性（描述符 `recreate`），`CustomOverlayProps` 单独声明并注明。
 * 「分类表里有这个键」与「实例上有这个 setter」是两件事——后者才是 `mutable` 的依据。
 */
export interface PathShapeProps {
  /**
   * 层叠顺序。**就地更新**（官方 `setZIndex`）。
   *
   * 撤回（`42 → undefined`）会**重建**实例：8 个官方覆盖物类上有 `setZIndex`、
   * **0 个**有 `getZIndex`（只有 `layer/*` 有），因此没有 baseline 可恢复。
   */
  zIndex?: number;
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
 * `points` 与 `pathVersion` 是一对：`points` 按**根引用**比较（大数组不做内容指纹，见
 * `OverlaySpec` 的 `watchSources`），原地修改数组时靠 `pathVersion` 递增触发更新。
 *
 * 坐标数组叫 `points`（不是 `path`）是**跟官方对齐**：官方
 * `@baidumap/jsapi-v4-types@4.0.5` 的 `overlay/Polyline.d.ts:26` 写的是
 * `constructor(points: Array<Point>, opts?)`。`pathVersion` 官方**没有**对应概念（它是本库为
 * 「大数组原地变更」设计的响应式失效令牌），因此**保留原名**——改的只是坐标数组那一个名字。
 */
export interface PolylineProps extends PathStrokeProps, PathShapeProps, PathEditableProps {
  points: { lng: number; lat: number }[];
  pathVersion?: string | number;
}

/**
 * 多边形（`isBoundary` 时允许 SDK 原生字符串路径）。
 *
 * 坐标数组叫 `points`：官方 `overlay/Polygon.d.ts:30` 是
 * `constructor(points: Array<Point> | Array<Array<Point>>, opts?)`。
 */
export interface PolygonProps extends PathStrokeProps, PathFillProps, PathShapeProps, PathEditableProps {
  points: ({ lng: number; lat: number } | string)[];
  pathVersion?: string | number;
  /** 构造期属性：路径按 SDK 原生边界名解析（如 `"北京市"`）。变化即重建。 */
  isBoundary?: boolean;
}

/** 矩形（v4 起提供；由对角两点构成的 `bounds` 定义）。 */
export interface RectangleProps extends PathStrokeProps, PathFillProps, PathShapeProps, PathEditableProps {
  bounds: { southwest: { lng: number; lat: number }; northeast: { lng: number; lat: number } };
  enableClicking?: boolean;
}

export interface CircleProps extends PathStrokeProps, PathFillProps, PathShapeProps, PathEditableProps {
  center: { lng: number; lat: number };
  radius: number;
  enableClicking?: boolean;
}

/**
 * 贝塞尔曲线：`points` 与 `controlPoints` 各有一个版本令牌。
 *
 * 坐标数组叫 `points`：官方 `overlay/BezierCurve.d.ts:21` 是
 * `constructor(points: Array<Point>, controlPoints: Array<Array<Point>>, opts?)`——两个形参
 * 官方都叫它该叫的名字，本库此前只有 `controlPoints` 是对的。
 */
export interface BezierCurveProps extends PathStrokeProps, PathShapeProps {
  points: { lng: number; lat: number }[];
  controlPoints: { lng: number; lat: number }[][];
  pathVersion?: string | number;
  controlPointsVersion?: string | number;
}

/** 文本标注的样式对象（驼峰 CSS 属性）。 */
export type LabelStyle = Record<string, unknown>;

export interface LabelProps {
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
 * 坐标数组叫 `points`：官方 `overlay/Prism.d.ts:25` 是
 * `constructor(points: Array<Point> | Array<Array<Point>>, altitude: number, opts?)`。
 *
 * `isBoundary` / `autoCenter` 是**构造期透传**：`@baidumap/jsapi-v4-types@4.0.5` 的
 * `PrismOptions` 里没有这两个键（4.0 运行时是否读取未取证），因此它们既不被当作字段级更新，
 * 也不被宣称支持——只在创建时原样交给 SDK（分类与理由见 `OVERLAY_DESCRIPTORS.prism`）。
 */
export interface PrismProps {
  points: ({ lng: number; lat: number } | string)[];
  altitude: number;
  topFillColor?: string;
  topFillOpacity?: number;
  sideFillColor?: string;
  sideFillOpacity?: number;
  /**
   * 层叠顺序。**就地更新**（官方 `Prism#setZIndex(zIndex: number): void`）。
   *
   * 与图形族的 `PathShapeProps.zIndex` 是同一条路径；`PrismProps` 不 extends 那一组
   * （它有独立的立体面样式），因此内联同一个键。撤回即重建（官方没有 `getZIndex`）。
   */
  zIndex?: number;
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
 * 显示区域只有 `bounds` 一种写法（`{ southwest, northeast }` 两个角点）。旧的两个角点 prop
 * 已随集中弃用层在 #136 删除——clean-slate 1.0 不兼容旧 API。
 */
export interface GroundOverlayProps {
  /** 显示区域（西南 / 东北角点）。**必填**——它是唯一的几何入口，缺失时构造期即抛错。 */
  bounds: { southwest: { lng: number; lat: number }; northeast: { lng: number; lat: number } };
  type: GroundOverlayType;
  url: GroundOverlayUrl;
  opacity?: number;
  /**
   * 层叠顺序。**就地更新**（官方 `GroundOverlay#setZIndex(zIndex: number): void`）。
   *
   * 与图形族的 `PathShapeProps.zIndex` 是同一条路径；`GroundOverlayProps` 不 extends 那一组，
   * 因此内联同一个键。撤回即重建（官方没有 `getZIndex`）。
   */
  zIndex?: number;
  /** 创建后按显示区域居中地图（组件侧行为，不是 SDK 选项）。 */
  autoCenter?: boolean;
  visible?: boolean;

  /* --- issue #168 item 2：官方 `GroundOverlayOptions` 里此前未收的三个选项 ---
   *
   * 逐条依据见 `driver/types/overlays.ts` 的 `OVERLAY_DESCRIPTORS["ground-overlay"]`。
   *
   * ⚠️ **前两项的官方默认是 `true`**（`enableMassClear` / `enableClicking`），而 Vue 的
   * `Boolean` 类型 prop 有「absent 即转 `false`」的陷阱——**在 `withDefaults` 里给它们写
   * `undefined`**（而不是 `true`），否则「用户没给」会变成「显式关闭」。这一条在 #168 里
   * 已经踩过三次（`GroundOverlay` / `CustomOverlay` / `Panorama` 各一次），因此在这里显式留痕。
   */
  /**
   * 是否允许在调用 `map.clearOverlays()` 时清除此覆盖物（官方 `enableMassClear`，
   * `@default true`）。**就地更新**（官方有 `enableMassClear` / `disableMassClear` 一对开关）。
   */
  enableMassClear?: boolean;
  /** 是否响应鼠标事件（官方 `enableClicking`，`@default true`）。无成对开关 ⇒ 改它会重建实例。 */
  enableClicking?: boolean;
  /**
   * 是否在普通覆盖物之上绘制（官方 `top`，`@default false`）。
   *
   * ⚠️ **与 `zIndex` 不是同一件事**：`zIndex` 是层叠顺序**值**（有 `setZIndex`，`options`），
   * `top` 是**布尔**的「压在普通覆盖物之上」开关。官方 `GroundOverlay` **没有 `setTop`**
   * （它有 `setZIndex`，但语义不同）⇒ `top` 只能构造期生效，改它会重建实例。
   */
  top?: boolean;
}

/* ------------------------------------------------------------------ 数据组件（M6 / #34）
 *
 * 三个数据组件的公开 props 都在这里声明（与各 SFC 的 `defineProps` 单一来源对齐）：
 *
 * - `MarkerList`：**每一项一个 SDK Marker**，适合中小规模、需要逐点交互的数据；
 * - `MarkerCluster`：网格聚合，簇也是 Marker；
 * - `PointCollection`：**单个批量 SDK 资源**（v4 原生 `PointShapeLayer`），适合大规模散点。
 *
 * 三者的取数面刻意一致（`data` + `itemKey` + `getPosition` + `dataVersion`），因此业务数据可以在
 * 它们之间平移；差别只在「落地成什么资源」——这正是「边界清晰」的含义。
 *
 * 泛型 `Item` 会**原样保留**到事件载荷（`item-click` 的参数就是 `Item`），不退化成
 * `any` / `unknown`；证据在消费方 fixture `fixtures/consumer/src/index.ts`（CI 用 tarball 跑
 * `vue-tsc`）。
 */

/** 三个数据组件共用的取数面。 */
export interface DataComponentProps<Item> {
  /**
   * 数据数组（只按**引用**比较；原地修改请配合 `dataVersion`）。
   *
   * **大数据量请把未深响应化的原始数据源交给 `shallowRef` / `markRaw`**：组件会逐项处理这批数据，
   * 深响应数组（`ref([...])`）的每次字段读取都要穿过 Proxy 并做依赖收集，代价随规模上升。
   * 注意 `markRaw` / `shallowRef` **不会把已存在的 Proxy 还原成 raw**（对 reactive 数组元素无效）。
   * 代价与既有契约一致：原地改内容仍需递增 `dataVersion`（组件不 watch 大数组的深层变化）。具体
   * 取证读数（只覆盖 `adaptPoints` 那条路径）与适用范围见 `docs/zh-CN/components/data.md`「大数据量」
   * 与 ADR `2026-09-24-deep-reactive-array-update-path`。
   */
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
  /** 是否显示；`false` = 隐藏（`MarkerList` 用 `show/hide`，`PointCollection` 用原生 `setVisible`）。 */
  visible?: boolean;
}

export interface MarkerListProps<Item> extends DataComponentProps<Item> {}

export interface MarkerClusterProps<Item> extends DataComponentProps<Item> {
  /** 像素网格边长（聚合桶的边长），默认 `128`。 */
  gridSize?: number;
  /** 达到该数量才聚合；不足的点展开为独立 item，不会丢点。默认 `3`。 */
  minClusterSize?: number;
  /** 聚合使用的 zoom；缺省时读取地图当前 zoom（读不到时用 `8`）。 */
  zoom?: number;
}

/**
 * `PointCollection` 的 props。
 *
 * 取数面与 `MarkerList` 一致；样式面只暴露 v4 原生点图层**真的支持**的那几个字段
 * （`PointShapeStyle` 的子集，逐条核对 `@baidumap/jsapi-v4-types@4.0.5`）。
 *
 * @deprecated 官方 `@baidumap/jsapi-v4-types@4.0.5` 已把底层 `BMap.PointShapeLayer` 标为
 *   `@deprecated`（建议改用 `BMap.PointLayer` 的形状模式），而本组件正落在该类上
 *   （`LAYER_KIND = "point-shape"`）。**组件本身不删也不改名**——弃用是上游的决定，
 *   且 #165 §3.6 禁止为此加兼容别名；此处只如实登记，让编辑器在类型面上把弃用显示出来。
 *   可迁移的替代品是 `<PointLayer>` 的形状模式（本库已提供），但它的样式字段是**扁平**的
 *   （不是 `style` 袋），迁移不是改个名字。线 / 面两类的替代品（`<PolylineLayer>` /
 *   `<PolygonLayer>`）已由 #166 提供，迁移同样**不是改个名字**（样式字段不同族）。
 */
export interface PointCollectionProps<Item> extends DataComponentProps<Item> {
  /**
   * 属性映射：写进每个要素的 `properties`。
   *
   * 入库时会**额外**写入要素身份字段（`itemKey` 是字符串时就是该字段名，是函数时用保留字段
   * `__id`），它与 SDK 的 `idKey` 指的是同一个字段：少了它，拾取回来的要素认不出业务项。
   * 同名字段被本库覆盖时会给出开发期告警。
   */
  properties?: (item: Item) => Record<string, unknown> | null | undefined;
  /**
   * 图形类型，取值见官方 `PointShapeLayer.ShapeType`（如 `0` 圆形 / `7` 五角星）。
   *
   * 官方 `PointShapeStyle.shapeType`（`@baidumap/jsapi-v4-types@4.0.5`
   * `layer/PointShapeLayer.d.ts:102`，`@default 2`）。#165 Class 1 之前本库的 prop 叫 `shape`，
   * 组件里做一次改名才落到官方键上——那是已知的命名缺口，现已直接叫官方名，旧名**删除**
   * （#165 §3.6 不留兼容别名）。
   *
   * ⚠️ 与 `<PointLayer>` 的 `shape` **不是同一个 prop**：那是 `BMap.PointLayer` 的
   * `visualization/PointLayer.d.ts:73`，官方就写 `shape`，两个组件各按各自的官方类走。
   */
  shapeType?: number;
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
 * 五个原生数据图层共用这一个载荷形状（`PointCollection` 与 #36 的 `LineLayer` / `FillLayer`）：
 * 「未命中」「身份确认不到」这两种情况必须能被**区分**出来，所以 `hit` / `id` / `item` 三个字段
 * 各自表达一件事。
 */
export interface PointPick<Item> {
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
   * `properties`；函数式 `itemKey` 返回 symbol 时逐项数据组件（`PointCollection`）也照样回传最新业务项。
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
 * 与 `PointCollection` 的差别只在 `Item` 的形状：逐项数据组件的业务对象是调用方给的 `Item[]`，
 * 而线 / 面图层的数据本身就是 GeoJSON，因此「命中的业务项」只能是那条要素的属性袋——身份
 * （`properties[idKey]`）也就在里面。不再包一层 `{ properties }` 是为了让 `pick.item[字段名]`
 * 直接可用（包一层之后每次取值都要多写一次 `.properties`）。
 */
export type FeaturePick = PointPick<Record<string, unknown>>;

/**
 * 官方 `StyleExpress`（数据驱动样式表达式）：`string | object | ((properties) => any)`。
 *
 * 本库**如实透传**而不是猜它的结构：`object` 那一支是 SDK 自己的表达式语法（`['match', …]` 一
 * 类），复刻一份必然会与上游漂移。函数那一支的参数是要素的 `properties`。
 */
export type StyleExpression =
  | string
  | Record<string, unknown>
  | ((properties: Record<string, unknown>) => unknown);

/* ------------------------------------------------------------------ 原生批量线 / 面图层（#36） */

/**
 * `LineLayer` 的样式（官方 `LineStyle` 的**逐字段**投影）。
 *
 * 字段名与默认值以 `@baidumap/jsapi-v4-types@4.0.4` 的 `LineStyle` 为准；这里只做类型搬运，
 * 不重新解释语义（默认值写在文档里，实现不补默认值——`undefined` = 不表态，由 SDK 决定）。
 *
 * ⚠️ 样式是**逐字段 merge**（官方 `setStyleOptions`）：把某个字段改成 `undefined` 时，SDK 侧仍
 * 留着上一次的值，因此本库会**重建图层**让它回到 SDK 自己的默认（并告警一次）。
 */
export interface LineLayerStyle {
  /** 是否采用间隔填充纹理。默认 `false`。 */
  sequence?: boolean;
  /** 间隔距离（像素）。默认 `16`。 */
  marginLength?: number;
  /** 是否描边覆盖填充。默认 `true`。 */
  borderCovered?: boolean;
  /** 是否受内部填充区域掩膜。默认 `true`。 */
  borderMask?: boolean;
  /** 描边宽度（像素）。默认 `0`。 */
  borderWeight?: number | StyleExpression;
  /** 描边颜色。默认 `'rgba(27, 142, 236, 1)'`。 */
  borderColor?: string | StyleExpression;
  /** 填充纹理图片地址（竖向表达，自动横向处理）。 */
  strokeTextureUrl?: string | StyleExpression;
  /** 填充纹理图片宽度（2 的 n 次方）。 */
  strokeTextureWidth?: number | StyleExpression;
  /** 填充纹理图片高度（2 的 n 次方）。 */
  strokeTextureHeight?: number | StyleExpression;
  /** 线连接处类型：`'miter'` / `'round'` / `'bevel'`。默认 `'round'`。 */
  strokeLineJoin?: string | StyleExpression;
  /** 线端头类型：`'round'` / `'butt'` / `'square'`。默认 `'square'`。 */
  strokeLineCap?: string | StyleExpression;
  /** 线颜色。默认 `'rgba(25, 25, 250, 1)'`。 */
  strokeColor?: string | StyleExpression;
  /** 线宽度（像素）。默认 `2`。 */
  strokeWeight?: number | StyleExpression;
  /** 线透明度（0-1）。默认 `1`。 */
  strokeOpacity?: number | StyleExpression;
  /** 线类型：`'solid'` / `'dashed'` / `'dotted'`。默认 `'solid'`。 */
  strokeStyle?: string | StyleExpression;
  /** 虚线设置（实线部分与间隙部分长度的数组）。默认 `[8, 4]`。 */
  dashArray?: number[] | StyleExpression;
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
  height?: number | StyleExpression;
}

/**
 * `FillLayer` 的样式（官方 `FillLayerStyle` 的逐字段投影）。
 *
 * 含「纯色 / 描边 / 纹理（掩膜或贴图）」三套；纹理模式下 `patternMask` 决定 `fillColor` 是否生效
 * （详见各字段文档，取自官方声明）。
 */
export interface FillLayerStyle {
  /** 填充颜色。`patternMask=true`（掩膜模式）下纹理不透明区域显示该颜色。默认 `'#142655'`。 */
  fillColor?: string | StyleExpression;
  /** 填充透明度（直接参与最终 alpha）。默认 `1`。 */
  fillOpacity?: number | StyleExpression;
  /** 是否采用纹理填充（需同时给 `patternUrl`）。默认 `false`。 */
  pattern?: boolean;
  /** 纹理渲染模式：`true` 掩膜（裁剪 `fillColor`）/ `false` 贴图（显示纹理颜色）。默认 `true`。 */
  patternMask?: boolean;
  /** 纹理雪碧图地址（需支持跨域）。默认 `''`。 */
  patternUrl?: string;
  /** 雪碧图中的纹理区域：`'x, y, width, height'`（像素）。默认 `'0, 0, 32, 32'`。 */
  patternMapping?: string | StyleExpression;
  /** 纹理缩放比例（以 zoom=18 为基准）。默认 `1`。 */
  patternScale?: number | StyleExpression;
  /** 纹理 UV 偏移量：`'u, v'`（0-1）。默认 `'0, 0'`。 */
  patternOffset?: string | StyleExpression;
  /** 是否采用间隔填充纹理。默认 `false`。 */
  sequence?: boolean;
  /** 间隔距离（像素）。默认 `16`。 */
  marginLength?: number;
  /** 是否描边覆盖填充。默认 `true`。 */
  borderCovered?: boolean;
  /** 是否受内部填充区域掩膜。默认 `true`。 */
  borderMask?: boolean;
  /** 描边宽度（像素）。默认 `0`。 */
  borderWeight?: number | StyleExpression;
  /** 描边颜色。默认 `'rgba(27, 142, 236, 1)'`。 */
  borderColor?: string | StyleExpression;
  /** 填充纹理图片地址。 */
  strokeTextureUrl?: string | StyleExpression;
  /** 填充纹理图片宽度（2 的 n 次方）。 */
  strokeTextureWidth?: number | StyleExpression;
  /** 填充纹理图片高度（2 的 n 次方）。 */
  strokeTextureHeight?: number | StyleExpression;
  /** 线连接处类型：`'miter'` / `'round'` / `'bevel'`。默认 `'round'`。 */
  strokeLineJoin?: string | StyleExpression;
  /** 线端头类型：`'round'` / `'butt'` / `'square'`。默认 `'square'`。 */
  strokeLineCap?: string | StyleExpression;
  /** 描边线颜色。默认 `'rgba(25, 25, 250, 1)'`。 */
  strokeColor?: string | StyleExpression;
  /** 描边线宽度（像素）。默认 `2`。 */
  strokeWeight?: number | StyleExpression;
  /** 描边线透明度（0-1）。默认 `1`。 */
  strokeOpacity?: number | StyleExpression;
  /** 描边线类型：`'solid'` / `'dashed'` / `'dotted'`。默认 `'solid'`。 */
  strokeStyle?: string | StyleExpression;
  /** 虚线设置。默认 `[8, 4]`。 */
  dashArray?: number[] | StyleExpression;
  /** 面图层高度。默认 `0`。 */
  height?: number | StyleExpression;
}

/**
 * 原生批量可视化图层共用的**统一槽位**（issue #36 的「统一 setData/style/base options/
 * visible/opacity/zoom/zIndex」）。
 *
 * 四个槽位各自有没有落地方式**取决于该 kind 的官方方法面**（由 Driver 的 `supports()` 回答）：
 * 缩放范围（`minZoom` / `maxZoom`）对全部八类都是**构造选项**而非字段级 setter，因此没有任何
 * 组件在这里声明它们（声明了却忽略 = 假支持）。
 *
 * `visible` 例外：4.0.5 之后八个 kind **都**有 `setVisible`，因此它一律走 setter、
 * **不**用「挂上 / 摘掉」表达显隐——重新可见不换实例。
 */
export interface NativeLayerCommonProps {
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
export interface NativeLayerPickOptions {
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
  /**
   * 选中数据的**索引**（官方 `selectedIndex`，`layer/LineLayer.d.ts:25` / `FillLayer.d.ts:30`，
   * 官方默认 `-1` 即不选中）。
   *
   * 与 `selectedColor` 是一对：`selectedColor` 定「选中长什么样」，本项定「哪一条被选中」——
   * 此前只暴露了前者（半接线）。**索引指的是数据顺序的序号，不是业务 id**；要按业务 id 选，
   * 用 Feature State 命令面（组件 expose 的 `featureState`），那才是按 id 定位的口径。
   */
  selectedIndex?: number;
  /**
   * 拾取事件是否向上层冒泡（官方 `popEvent`，`layer/LineLayer.d.ts:70` / `FillLayer.d.ts:75`，
   * 官方默认 `true`）。
   *
   * `false` = 本层命中后**不再**往更上层的图层/覆盖物派发。多个可拾取图层上下叠放时用它控制
   * 「谁先吃掉这次点击」。
   */
  popEvent?: boolean;
}

/**
 * `LineLayer` 的 props。
 *
 * `data` 的三个取值承担三件事（与 `LayerSpec` 的口径一致，别用一个值兼表两件事）：
 *
 * - **有对象** ⇒ `setData()`，**不重建**；
 * - **`null`** ⇒ 明确「没有数据」。官方专页这四类**没有公开的清空入口**（上游声明里只有
 *   `setData`/`getData`），因此本库换一个**没有数据的实例**来表达它（代价是一次重建，见 ADR 的
 *   已知限制）；
 * - **`undefined`** ⇒ 不表态：不产生任何 SDK 调用，已画出来的数据保持不变。
 *
 * @deprecated 官方 `BMap.LineLayer` 已在 `@baidumap/jsapi-v4-types@4.0.5` 标记 `@deprecated`
 *   （建议改用 `visualization.PolylineLayer`）。`<LineLayer>` 组件**继续可用、行为不变**，
 *   而官方建议的替代品 `<PolylineLayer>` 本库**已提供**（#166）。
 *   ⚠️ 迁移**不是改个名字**：两者的 `style` 不是同一套字段（这里是 `LineLayerStyle`，
 *   替代品是 `PolylineLayerStyle`），样式要重写；数据模型也不同（官方那条走
 *   `setOptions` 整袋替换）。本标记是如实告知官方弃用，不是「请立即改用别的东西」。
 *   详见 `docs/zh-CN/components/layer/native-visual-layers.md`。
 */
export interface LineLayerProps extends NativeLayerCommonProps, NativeLayerPickOptions {
  /** GeoJSON 数据（`FeatureCollection` / 单条 `Feature`）；`null` = 没有数据，`undefined` = 不表态。 */
  data?: object | null;
  /** 线样式（见 `LineLayerStyle`）。变化时 `setStyleOptions` + `doOnceDraw`，不重建。 */
  style?: LineLayerStyle;
}

/**
 * `FillLayer` 的 props。
 *
 * @deprecated 官方 `BMap.FillLayer` 已在 `@baidumap/jsapi-v4-types@4.0.5` 标记 `@deprecated`
 *   （建议改用 `visualization.PolygonLayer`）。`<FillLayer>` 组件**继续可用、行为不变**，
 *   而官方建议的替代品 `<PolygonLayer>` 本库**已提供**（#166）。
 *   ⚠️ 迁移**不是改个名字**：两者的 `style` 不是同一套字段（这里是 `FillLayerStyle`，
 *   替代品是 `PolygonLayerStyle`），样式要重写；官方 `PolygonLayer` 的描边默认
 *   `strokeWeight: 0`（即**不描边**），而 `FillLayer` 默认 `border: true`。
 *   本标记是如实告知官方弃用，不是「请立即改用别的东西」。
 *   详见 `docs/zh-CN/components/layer/native-visual-layers.md`。
 */
export interface FillLayerProps extends NativeLayerCommonProps, NativeLayerPickOptions {
  /**
   * GeoJSON 数据；有值时走 `setData()`（不重建），`null` = 没有数据（换一个空实例）、
   * `undefined` = 不表态。详见 `LineLayerProps.data` 的三条口径。
   */
  data?: object | null;
  /** 面样式（见 `FillLayerStyle`）。变化时 `setStyleOptions` + `doOnceDraw`，不重建。 */
  style?: FillLayerStyle;
  /**
   * 是否显示描边（官方构造选项 `border`，**官方默认 `true`**）。
   *
   * 刻意不给默认值（`withDefaults` 里显式写 `undefined`）：Vue 对 `Boolean` 有「缺省即 `false`」
   * 的转换，不给默认值会让每个不传 `border` 的用户都隐式地关掉描边。
   */
  border?: boolean;
}

/**
 * `visualization/` 的**数据驱动样式表达式**（官方 `StyleValue<T>`，
 * `visualization/common.d.ts:10`）。
 *
 * 官方原文：`T | ((properties: any, feature: any, index: number) => T)`。
 *
 * ⚠️ **刻意不复用 `StyleExpression`**（#166）。`StyleExpression` 的第一支是 `string`
 * （`layer/` 家族的 `LineStyle` / `FillLayerStyle` 那些字段在官方口径下是宽字符串），
 * 而 `visualization/` 的 `strokeLineCap` / `strokeLineJoin` / `strokeStyle` 是**字面量联合**
 * （`'butt' | 'round' | 'square'` 等）。套上 `string` 那一支会把字面量联合**放宽成任意字符串**
 * ——`strokeCap: "arrow"` 就会被类型接受，而官方运行时只认三个值。
 *
 * 回调经 `forwardCallback` 转发成**身份恒定**的包装（见 `core/layers/nativeLayerStyle.ts`）：
 * 换实现后对**后续**求值生效，已经产生的画面不回溯。
 */
export type VisualizationStyleValue<T> =
  | T
  | ((properties: Record<string, unknown>, feature: unknown, index: number) => T);

/**
 * `PolygonLayer` 的样式（官方 `PolygonLayerOptions` 里属于样式的那几项，逐字段投影）。
 *
 * ⚠️ **与 `<FillLayer>` 的 `style` 不是同一套字段**：本类型逐条对应
 * `visualization/PolygonLayer.d.ts:29-63`，官方类声明里**没有** `patternUrl` / `borderWeight` /
 * `borderCovered` 那一族（那是 `layer/FillLayer` 的 `FillLayerStyle`）。
 * 两者的关系是**弃用替代**（官方把 `FillLayer` 标了 `@deprecated`、建议改用本类），
 * **不是**字段改名——迁移时样式要按本类型重写。
 *
 * 这些字段经 `setOptions`（`:181`）**整袋替换**下发（不是 `layer/` 家族的 merge +
 * `doOnceDraw`）：只写你要改的键，**没写的键会回到官方默认值**。
 */
export interface PolygonLayerStyle {
  /** 填充色，css 字符串。默认 `'rgba(25, 25, 250, 0.6)'`。 */
  fillColor?: VisualizationStyleValue<string>;
  /** 填充透明度 [0,1]。默认 `1`。 */
  fillOpacity?: VisualizationStyleValue<number>;
  /** 描边色，css 字符串。默认 `'rgba(250, 250, 25, 1)'`。 */
  strokeColor?: VisualizationStyleValue<string>;
  /** 描边宽度（px），`0` 表示不描边。默认 `0`。⚠️ 官方默认是**不描边**。 */
  strokeWeight?: VisualizationStyleValue<number>;
  /** 描边透明度 [0,1]。默认 `1`。 */
  strokeOpacity?: number;
  /** 纹理图片地址，**非空即启用平铺填充**。默认 `''`（即纯色填充）。 */
  fillTextureUrl?: string;
  /** 平铺时单张图在屏幕上的宽度（px）；不传取图片真实宽度。 */
  fillTextureSize?: number;
  /**
   * `true` 只用纹理 alpha 做镂空、颜色取 `fillColor`；`false` 用纹理自身颜色。默认 `false`。
   *
   * 官方默认 `false`，而 Vue 对可选 `Boolean` prop 会转成 `false` ——**恰好一致**，
   * 因此这里可以安全地让 Vue 的缺省转换生效（对比 `FillLayerProps.border` 那条注释）。
   */
  fillTextureAlphaOnly?: boolean;
}

/**
 * `PolylineLayer` 的样式（官方 `PolylineLayerOptions` 里属于样式的那几项，逐字段投影）。
 *
 * ⚠️ **与 `<LineLayer>` 的 `style` 不是同一套字段**：本类型逐条对应
 * `visualization/PolylineLayer.d.ts:27-92`。迁移口径同 `PolygonLayerStyle` 的说明。
 *
 * 同样经 `setOptions`（`:213`）**整袋替换**下发。
 */
export interface PolylineLayerStyle {
  /**
   * 线颜色，css 字符串。默认 `'rgba(25, 25, 250, 1)'`。
   *
   * ⚠️ 官方注明：**虚线模式**（`strokeStyle` 为 `'dashed'` / `'dotted'`）下走 uniform 染色，
   * **回调不生效**。
   */
  strokeColor?: VisualizationStyleValue<string>;
  /**
   * 线宽（屏幕 px，全宽）。默认 `4`。
   *
   * ⚠️ 官方注明：传回调时，**沿线长度换算**（虚线圆间距、纹理图案尺寸）仍按默认值 `4` 计算。
   */
  strokeWeight?: VisualizationStyleValue<number>;
  /** 线透明度 [0,1]，与线色 alpha、图层级 `opacity` **相乘**。默认 `1`。 */
  strokeOpacity?: number;
  /** 拐角连接样式。默认 `'round'`。⚠️ 官方注明：纹理 / 虚线**不建议**用 `'miter'`。 */
  strokeLineJoin?: VisualizationStyleValue<"miter" | "bevel" | "round">;
  /** 线端点样式。默认 `'round'`。 */
  strokeLineCap?: VisualizationStyleValue<"butt" | "round" | "square">;
  /** 线型：`'solid'` / `'dashed'` / `'dotted'`。默认 `'solid'`。 */
  strokeStyle?: "solid" | "dashed" | "dotted";
  /** 实线段 / 间隙的屏幕像素长度（同 SVG `stroke-dasharray`；奇数个自动翻倍）。默认 `[8, 4]`。 */
  dashArray?: number[];
  /** 纹理图片地址，**必须是竖图**（x 跨线宽、y 沿线方向）。非空时优先级高于 `strokeStyle`。默认 `''`。 */
  strokeTextureUrl?: string;
  /** 原图宽（px），只参与沿线长度换算；不传取图片真实尺寸。 */
  strokeTextureWidth?: number;
  /** 原图高（px），同上。 */
  strokeTextureHeight?: number;
  /** `true` 按 `strokeTextureGap` 间隔平铺（箭头串）；`false` 沿线连续拉伸。默认 `false`。 */
  strokeTextureSpaced?: boolean;
  /** 相邻纹理间隔（px），仅 `strokeTextureSpaced` 为 `true` 时生效。默认 `16`。 */
  strokeTextureGap?: number;
  /** 纹理叠加色（rgb 相乘），仅配了 `strokeTextureUrl` 时生效。默认 `'rgba(255, 255, 255, 1)'`。 */
  strokeTextureColor?: string;
}

/**
 * `PolygonLayer` / `PolylineLayer` 共用的**构造期**拾取选项（#166）。
 *
 * 与 `NativeLayerPickOptions`（`layer/` 家族的 `idKey` / `crs` / `enablePicked` /
 * `pickWidth` / `pickHeight` / `autoSelect` / `selectedColor` / `selectedIndex` / `popEvent`）
 * **刻意不共用一个接口**：这两族的官方选项表里只有 `idKey` / `enablePicked` /
 * `mouseStyleChange` / `pickTolerance` / `pickThrough` 五项（`PolygonLayer.d.ts:70-91`）。
 * `pickWidth` / `pickHeight` / `crs` / `popEvent` / `selectedIndex` 官方**没有声明**
 * （#165 的 H2 条已实测 `visualization/` 下 0 命中），共用一个接口等于把它们投影成
 * 「接收后忽略」——AGENTS.md 明确禁止的假支持。
 */
export interface VisualizationPickOptions {
  /**
   * 数据项属性 key（= 业务身份字段）。官方构造选项 `idKey`，默认 `'id'`。
   *
   * 它是拾取的**唯一身份口径**（本库不替官方猜默认值）：不设置时拾取会如实返回
   * `id: null`。空字符串是合法字段名。
   */
  idKey?: string;
  /**
   * 是否开启鼠标交互（命中光标 + 事件派发）。官方默认 `false`，本组件默认 **`true`**。
   *
   * 与官方默认值**不同**，刻意如此：不给事件就别怪用户拿不到 `pick`。
   */
  enablePicked?: boolean;
  /**
   * 命中后是否更换鼠标光标。官方 `mouseStyleChange`，默认 `true`。
   *
   * ⚠️ 官方默认 `true` 而 Vue 缺省给 `false` ⇒ 在 `withDefaults` 里**必须**显式写
   * `undefined`，否则每个不传它的用户都静默偏离官方（#165 结论六记录的同一类坑，
   * 这是本票第四次踩到它）。
   */
  mouseStyleChange?: boolean;
  /** 命中容差（css px）。官方默认 `4`。 */
  pickTolerance?: number;
  /**
   * 命中后是否继续向下层派发。官方 `pickThrough`，默认 `false`。
   *
   * 官方默认 `false`，与 Vue 缺省一致，因此可以让 Vue 的转换生效。
   */
  pickThrough?: boolean;
}

/**
 * `PolygonLayer` / `PolylineLayer` 共用的**显隐 / 层级**槽位（#166）。
 *
 * ⚠️ **刻意不 extends `NativeLayerCommonProps`**：那一支还带 `opacity` / `minZoom` /
 * `maxZoom`，而这两族的官方声明里**没有** `setOpacity`、**没有** `setMinZoom` / `setMaxZoom`
 * （live 实测运行时的这四个方法也都不在）。沿用那一支会让 `useNativeLayerResource`
 * 在运行时打出「该 kind 没有这个入口」的告警——**声明了却永远不生效 = 假支持**
 * （AGENTS.md 明确禁止）。
 *
 * `minZoom` / `maxZoom` 因此**不进**这个接口，而是走下面的 `VisualizationZoomCtorOptions`
 * （官方把它们声明成了**构造选项**，所以能投影成 prop，只是「改了要换实例」）。
 */
export interface VisualizationLayerCommonProps {
  /** 是否显示。默认 `true`；走 `setVisible`（4.0.5 声明），重新可见**不**换实例。 */
  visible?: boolean;
  /** 图层层级（挂载后写入；官方层级方法要求先挂到地图上）。默认 `1`。 */
  zIndex?: number;
}

/**
 * `PolygonLayer` / `PolylineLayer` 的**缩放范围构造选项**。
 *
 * 官方把 `minZoom` / `maxZoom` 声明在选项表里（`PolygonLayer.d.ts:108` / `:112`，
 * `PolylineLayer.d.ts:136` / `:145`，默认 `3` / `21`），但**没有**对应的字段级 setter
 * ——live 探针读到两个类的 `setMinZoom` / `setMaxZoom` 在运行时也**不存在**。
 *
 * 因此它们进**构造期选项袋**：变化 ⇒ **换实例**（官方唯一能改的路径就是重建），
 * 并且自动参与重建指纹。
 */
export interface VisualizationZoomCtorOptions {
  /** 最小显示缩放等级（**构造选项**，官方默认 `3`）。变化会换实例。 */
  minZoom?: number;
  /** 最大显示缩放等级（**构造选项**，官方默认 `21`）。变化会换实例。 */
  maxZoom?: number;
}

/**
 * `PolygonLayer` 的 props（官方 `visualization.PolygonLayer`，4.0.5 新增）。
 *
 * 几何支持 `Polygon` / `MultiPolygon`（含洞）；`strokeWeight > 0` 时内部用官方
 * `PolylineLayer` 实现描边（`PolygonLayer.d.ts:123`）。
 */
export interface PolygonLayerProps
  extends VisualizationLayerCommonProps,
    VisualizationZoomCtorOptions,
    VisualizationPickOptions {
  /**
   * GeoJSON 面数据（`FeatureCollection` / `Feature` / `Feature[]` / 裸 Geometry，
   * 官方 `setData` 的入参形状，`PolygonLayer.d.ts:160`）。
   *
   * `null` = 明确「没有数据」⇒ **换一个没有数据的实例**（与全部十种 kind 同一条口径，
   * 理由见 `LineLayerProps.data`）；`undefined` = **不表态**（不产生任何 SDK 调用）。
   */
  data?: object | null;
  /**
   * 面样式（见 `PolygonLayerStyle`）。变化时经 `setOptions` **整袋替换**下发，不重建。
   *
   * ⚠️ 官方 `setOptions` 的注释写明「仅更新已声明的样式键」，而**未知键忽略并告警一次**
   * ——因此只写你要改的键，**没写的键会回到官方默认值**（与 `layer/` 家族的 merge 语义相反）。
   */
  style?: PolygonLayerStyle;
}

/**
 * `PolylineLayer` 的 props（官方 `visualization.PolylineLayer`，4.0.5 新增）。
 *
 * 几何支持 `LineString` / `MultiLineString`；支持实线 / 虚线 / 纹理贴图三种渲染模式
 * （`PolylineLayer.d.ts:159-160`）。
 */
export interface PolylineLayerProps
  extends VisualizationLayerCommonProps,
    VisualizationZoomCtorOptions,
    VisualizationPickOptions {
  /**
   * GeoJSON 线数据（入参形状同 `PolygonLayerProps.data`）。
   *
   * `null` / `undefined` 的口径与 `PolygonLayerProps.data` **完全一致**。
   */
  data?: object | null;
  /** 线样式（见 `PolylineLayerStyle`）。同样经 `setOptions` 整袋替换。 */
  style?: PolylineLayerStyle;
}

/**
 * 官方 `TextLayer` 的锚点位置（`visualization/TextLayer.d.ts:5-14`）。
 *
 * 官方把它表达成 `StyleValue<TextAnchor>`（可按要素逐个求值），并另有一个**静态**枚举
 * `TextLayer.Anchor` 用 `[-1, 1]` 区间向量表达同一组取值（`:232-242`；live 探针
 * 2026-09-27 读到 `staticAnchor` 九项全在，值与声明逐条一致）。
 *
 * 本库**只**投影字符串那一支：官方静态枚举是给「自己算向量」的场景用的，而本库的
 * `style` 袋原样透传给官方 `setOptions`，使用者写 `topLeft` 就够了——投影成向量反而
 * 丢掉官方在 `setOptions` 里接受的字符串形式。
 */
export type TextLayerAnchor =
  | "center"
  | "topLeft"
  | "topCenter"
  | "topRight"
  | "rightCenter"
  | "bottomRight"
  | "bottomCenter"
  | "bottomLeft"
  | "leftCenter";

/**
 * `TextLayer` 的样式（官方 `TextLayerOptions` 里属于样式的那几项，逐字段投影）。
 *
 * 逐条对应 `visualization/TextLayer.d.ts:43-140`（不含 `:142` 之后的 `data` / `idKey` /
 * 拾取与显示那些——它们是各自的 prop）。经 `setOptions`（`:269`）**整袋替换**下发。
 *
 * ⚠️ 官方 `setOptions` 的注释写明「仅更新已声明的样式键，未知键忽略并告警一次」⇒
 * **没写的键回到官方默认值**（与 `layer/` 家族的 merge 语义相反）。
 */
export interface TextLayerStyle {
  /** 文案，不设则读要素的 `properties.text`（`:43`）。 */
  text?: VisualizationStyleValue<string>;
  /** 字号（px）。默认 `14`。 */
  fontSize?: VisualizationStyleValue<number>;
  /** 字体。默认 `'微软雅黑'`。 */
  fontFamily?: VisualizationStyleValue<string>;
  /** 字重。默认 `'normal'`。 */
  fontWeight?: VisualizationStyleValue<string | number>;
  /** 文字颜色，css 字符串。默认 `'#333'`。 */
  color?: VisualizationStyleValue<string>;
  /** 描边色，css 字符串。默认 `'rgba(255, 255, 255, 1)'`。 */
  strokeColor?: VisualizationStyleValue<string>;
  /** 描边宽度（px），`0` 表示不描边。默认 `0`。 */
  strokeWeight?: VisualizationStyleValue<number>;
  /** 超过该宽度（px）换行，`0` 表示不换行。默认 `0`。 */
  textMaxWidth?: number;
  /** 行高（px）。默认 `20`。 */
  lineHeight?: number;
  /** 多行时的对齐方式。默认 `'center'`。 */
  textAlign?: "center" | "left" | "right";
  /** 像素偏移 `[x, y]`。默认 `[0, 0]`。 */
  offset?: VisualizationStyleValue<[number, number]>;
  /** 锚点，决定坐标点落在文字的哪个位置。默认 `'center'`。 */
  anchor?: VisualizationStyleValue<TextLayerAnchor>;
  /** 旋转角度（度）。默认 `0`。 */
  rotation?: VisualizationStyleValue<number>;
  /** 缩放比例。默认 `1`。 */
  scale?: VisualizationStyleValue<number>;
  /** **逐条**透明度 `[0,1]`，与图层级 `opacity` **相乘**。默认 `1`。 */
  fillOpacity?: VisualizationStyleValue<number>;
  /** `true` 贴地（大小随缩放变化）；`false` 屏幕固定像素大小。默认 `false`。 */
  isFlat?: boolean;
  /** 是否开启碰撞剔除（密集时自动隐藏互相压盖的文字）。默认 `true`。 */
  collides?: boolean;
  /** 碰撞剔除的节流间隔（ms）。默认 `200`。 */
  waitTime?: number;
  /** 图集槽位内边距 `[x, y]`。默认 `[2, 2]`。 */
  padding?: [number, number];
  /** 碰撞盒外扩 `[x, y]`，控制文字之间的最小间距。默认 `[0, 0]`。 */
  margin?: [number, number];
  /**
   * 图层级透明度 `[0,1]`（官方 `TextLayerOptions.opacity`，`:179`），与逐条 `fillOpacity` 相乘。
   *
   * ⚠️ **刻意不作为独立 prop**，而是留在样式袋里：官方为它声明了字段级 setter
   * `setOpacity`（`:296`，live 实测运行时也有），本库**两个入口都给**——`opacity` prop
   * 走 setter（无需重建、可单独更新），`style.opacity` 走整袋。两者都合法：官方
   * `setOptions` 的注释自己就说 `opacity` 会被「转发到对应 setter」。
   */
  opacity?: number;
  /** 绘制阶段，`null` / `'building'` / `'poi'`（官方 `renderStage`，`:198`）。 */
  renderStage?: "building" | "poi" | null;
}

/**
 * `TextLayer` 的 `hitTest` 命中项（官方 `TextLayerItem`，`TextLayer.d.ts:19-32`）。
 *
 * 与 `FeaturePick`（拾取**事件**的载荷）是**两件事**：事件走官方统一的事件调度，回包形状是
 * `VisualPickEvent`；而 `hitTest` 是**主动**调用，回包就是这段文字本身。两者因此不共用一个类型。
 *
 * 逐字段如实投影官方声明的六项：
 *
 * - **没有 `dataIndex`** —— 官方回包里没有它，本库也不从 `id` 反推下标（`id` 缺省时是要素
 *   序号，但那是 SDK 内部口径，不是有依据的公开身份）；
 * - 四个 `null` 槽位表示「回包里读不到这个值」，与 `FeaturePick.id` 的 `null` 同一条口径
 *   （认不出就如实说认不出，不拿 `0` / `""` 冒充——`0` 宽度与「没给宽度」在业务上不是一回事）。
 */
export interface TextLayerPick {
  /** 命中点经纬度（bd09ll），本库用纯数据 `{ lng, lat }` 表达（组件层不构造 SDK 构造器）。 */
  point: { lng: number; lat: number } | null;
  /** 文案。 */
  text: string | null;
  /** 文字显示宽度（px）。 */
  width: number | null;
  /** 文字显示高度（px）。 */
  height: number | null;
  /** 要素 id（取自 `idKey` 字段，缺省用序号）。 */
  id: string | number | null;
  /** 要素的 properties。 */
  properties: unknown;
}

/**
 * `TextLayer` 的 props（官方 `visualization.TextLayer`，4.0.5 新增）。
 *
 * 几何支持 `Point` / `MultiPoint`（`TextLayer.d.ts:203`）。文字量较大时官方建议用它
 * 而不是逐个 `Label` 覆盖物。
 *
 * 与 `PolygonLayerProps` / `PolylineLayerProps` 的**唯一结构差别**是本接口多带
 * `opacity`（官方**声明**了 `setOpacity`）——那两族没有，因此刻意不共用一个 props 基类
 * （沿用前两族那条「不把未声明成员投影成 prop = 假支持」的裁决）。
 */
export interface TextLayerProps
  extends VisualizationLayerCommonProps,
    VisualizationZoomCtorOptions,
    VisualizationPickOptions {
  /**
   * GeoJSON 点数据（入参形状同 `PolygonLayerProps.data`）。
   *
   * `null` = 明确「没有数据」⇒ **换一个没有数据的实例**（与全部 kind 同一条口径）；
   * `undefined` = **不表态**（不产生任何 SDK 调用）。
   */
  data?: object | null;
  /** 文字样式（见 `TextLayerStyle`）。变化时经 `setOptions` **整袋替换**下发，不重建。 */
  style?: TextLayerStyle;
  /**
   * 图层级透明度 `[0,1]`，与逐条 `fillOpacity` 相乘。默认 `1`。
   *
   * 走官方**声明**的字段级 setter `setOpacity`（`:296`）⇒ 单独改它**不换实例**。
   * （`PolygonLayer` / `PolylineLayer` 没有这个 prop：官方未声明 `setOpacity`。）
   */
  opacity?: number;
}

/**
 * `HeatmapLayer` 的 props。
 *
 * 官方 `Heatmap` 属**扩展 API**：`@baidumap/jsapi-v4-types@4.0.5` 才补上类声明，可视化实现是
 * 「首次加载时异步注入」的。本库只暴露驱动已登记的入口（`setData` / `setStyle`；驱动也登记了
 * `clearData`，但本组件不调用它——见下），因此**没有** `opacity` / `zIndex` / `minZoom` /
 * `maxZoom`：前两个虽然 4.0.5 声明了（`visualization/Heatmap.d.ts:157`/`:161`）但本组件刻意
 * 不开面（`style` 已是官方的整袋透传口），后两个官方**没有**字段级 setter。
 */
export interface HeatmapLayerProps {
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
  /** 是否显示。默认 `true`；走 `setVisible`（4.0.5 声明），重新可见**不**换实例。 */
  visible?: boolean;
}

/**
 * `TrackLineLayer` 的 props。
 *
 * 与热力图同属扩展 API；驱动的登记面（#110 之后）包含 `setData` + 六条播放命令，因此本组件
 * 声明 `data` / `visible`，并 expose 播放命令面（见 `TrackLineLayerExpose`）。
 *
 * 播放命令的方法名均经 live 探针取证（`scripts/probe-track-line.mts`，2026-09-23，exit 0），
 * 不是从类型包猜的——在拿到读数之前不猜方法名是 #110 的硬门（已过）。
 */
export interface TrackLineLayerProps {
  /**
   * 轨迹数据：官方 `TrackLine` 只接收**单条 `LineString` Feature**。
   *
   * 形状由调用方保证（本库不做 GeoJSON 校验：那属于数据适配层，而该 kind 没有任何可核对的声明
   * 来支撑「什么算合法」）。
   *
   * `null` = **没有轨迹**（换一个空实例，因此不再显示上一条轨迹）、`undefined` = 不表态。
   */
  data?: object | null;
  /**
   * 是否显示。默认 `true`；走 `setVisible`（4.0.5 声明，`visualization/TrackLine.d.ts:457`）。
   *
   * ⚠️ 因此**重新可见不换实例**——这一点对本组件是行为保证：换实例会把播放进度与播放状态
   * 一起丢掉（播放到一半隐藏再显示会从头播）。此前该 kind 没有登记 `setVisible`、
   * 显隐走挂上 / 摘掉，正是那时的行为。
   */
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
export interface TrackLineObserved {
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

/** `TrackLineLayer` expose 的命令面与只读观察（#110）。 */
export interface TrackLineLayerExpose {
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
   * 与 `MapExpose` 同一口径）。需要追踪变化时用 `watch(() => vm.observed, …)`
   * （getter 内部读 `shallowRef.value`，依赖仍会挂上）。
   */
  observed: TrackLineObserved | null;
}

/* ------------------------------------------------ 点图层的另两个 kind（#35 新增） */

/**
 * `PointIconLayer` 的 props（原生 `PointIconLayer`）。
 *
 * 样式字段是官方 `PointIconStyle` 的子集；`isFlat` / `isFixed` 是**构造期**选项
 * （它们决定渲染通道，官方写在 `PointIconLayerOptions` 上而不是 style 里）。
 *
 * @deprecated 官方 `BMap.PointIconLayer` 已在 `@baidumap/jsapi-v4-types@4.0.5` 标记
 *   `@deprecated`（建议改用 `visualization.PointLayer` 的图标模式）。与线 / 面两个不同，
 *   官方建议的替代品本库**已经提供**：迁移目标是 `PointLayerProps`（组件 `<PointLayer>`）。
 *   但那不是改个名字的事——`<PointLayer>` 属扩展 API、标 `experimental`（可视化实现按需
 *   异步注入），且样式字段是**扁平**的（`icon` / `width` / `height` 直接是 prop，没有 `style` 袋）。
 *   `<PointIconLayer>` 本身继续可用、行为不变。
 *   详见 `docs/zh-CN/components/data.md`。
 */
export interface PointIconLayerProps<Item> extends DataComponentProps<Item> {
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
  /**
   * **逐要素**透明度 `0`-`1`（官方 `PointIconStyle.opacity`，`layer/PointIconLayer.d.ts:127`）。
   *
   * ⚠️ 与下面的图层级 `opacity` 是**两个不同的官方字段**：本项进样式袋（逐要素，官方允许
   * `number | StyleExpress` 逐点取值），图层级那个走 `setOpacity` 写入图层级。两者相乘。
   * 本组件只收**静态**数值——逐要素差异化请走 Feature State（expose 的 `featureState`）。
   */
  featureOpacity?: number;
  /**
   * 逐要素是否显示（官方 `PointIconStyle.visibility`，`:105`，官方默认 `true`）。
   *
   * 与图层级 `visible` 不同：这是**样式袋字段**⇒ 就地更新（不换实例）。
   */
  visibility?: boolean;
  /**
   * 点尺寸 `[宽, 高]`（官方 `PointIconStyle.sizes`，`:108`）；只在 `userSizes` 为 `true` 时生效。
   */
  sizes?: [number, number];
  /**
   * 是否使用 `sizes` 的宽高而非 `width` / `height`（官方 `userSizes`，`:117`，官方默认 `true`）。
   *
   * ⚠️ 不给默认值（同 `FillLayerProps.border` 的理由）：Vue 对 `Boolean` 有「缺省即 `false`」
   * 的转换，写 `false` 会让每个不传它的用户都隐式切到 `width` / `height` 通道、覆盖掉 `sizes`。
   * 「没传」= 不表态 = 官方默认 `true`。
   */
  userSizes?: boolean;
  /**
   * 逐要素图标源：`(style, properties) => { id?, canvas }`（官方 `PointIconStyle.iconObj`，`:101`）。
   *
   * 按要素算出图标（典型是用 canvas 画文字 / 数字 / 业务徽标）。`id` 用于图集去重。
   * 与静态 `icon`（URL）是二选一。
   */
  iconObj?: (style: object, properties: object) => { id?: number; canvas: HTMLCanvasElement };
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
 * `PointLayer` 的 props（原生 `BMap.PointLayer`，**扩展 API**）。
 *
 * ⚠️ 它是三者里唯一「运行时存在、类型包没有类声明」的：可视化实现由 SDK **按需异步注入**，
 * 因此在注入完成之前创建会显式失败（`BMAP_CAPABILITY_UNSUPPORTED`）。它**不会**自动改用
 * `PointShapeLayer` / `PointIconLayer` —— 那是另一个 SDK 能力，偷偷换掉等于改掉调用方的意图。
 *
 * 选项是**扁平**的（官方专页的例子是 `new BMap.PointLayer({ shape, size, fillColor })`），
 * 与 `BPointShapeLayer` 的 `style` 袋不同。
 */
export interface PointLayerProps<Item> extends DataComponentProps<Item> {
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
   * 图标显示尺寸 `[宽, 高]` 或 number（px）；不设则用图片 / canvas 自身尺寸
   * （官方 `PointLayerOptions.iconSize`，`visualization/PointLayer.d.ts:135`）。
   *
   * 只在**图标模式**（配了 `icon`）下有效，与 `shape` 互斥——这是官方分形状模式 / 图标模式的
   * 那条互斥关系，本库不另造第三个模式。
   */
  iconSize?: [number, number] | number;
  /**
   * 命中后是否更换鼠标光标（官方 `mouseStyleChange`，`:153`，默认 `true`）。
   *
   * 只在开启拾取（`enablePicked`）时才有意义：关掉拾取就没有「命中」这回事。
   */
  mouseStyleChange?: boolean;
  /**
   * 命中容差（css px，官方 `pickTolerance`，`:158`，默认 `4`）。
   *
   * 这是**本组件真正的拾取调优入口**：`PointLayer` 官方声明里没有 `pickWidth` / `pickHeight`
   * （那是 `layer/` 下那四类专页图层的构造选项），它给的是「命中点周围多大范围算命中」的容差。
   */
  pickTolerance?: number;
  /**
   * 命中后是否继续向下层派发（官方 `pickThrough`，`:163`，默认 `false`）。
   *
   * `true` = 本层命中**不**吞掉事件，下面的图层仍能收到；重���点、上下叠放的图层常用。
   */
  pickThrough?: boolean;
  /**
   * 图层参考中心点（官方 `referCenter`，`:191`），规避大坐标浮点抖动。
   *
   * 官方类型是 `BMap.Point`；本组件收**纯数据** `{ lng, lat }`（与全库 Geometry 口径一致），
   * 由 Driver 侧负责换算——组件层不直接构造 SDK 构造器。
   */
  referCenter?: { lng: number; lat: number };
  /**
   * 绘制阶段（官方 `renderStage`，`:196`）：`'building'` / `'poi'` / `null`。
   *
   * 图层绘制在该阶段之后（叠在其上）；`null` = 官方默认落点（覆盖物之后、3D 楼块之前）。
   */
  renderStage?: "building" | "poi" | null;
  /**
   * 是否开启鼠标拾取，默认 `true`。构造期选项（官方另有 `setEnablePicked`，本库统一走构造期，
   * 三个点图层组件的这条语义因此一致）。
   *
   * ⚠️ 图层级的 `opacity` **没有**暴露：4.0.5 的 `PointLayer` 声明里**没有** `setOpacity`
   * （`ClusterLayer` / `Heatmap` / `TrackLine` 都有）——按本库「不把未声明成员当契约」的口径，
   * Driver 对它回答 `unsupported`。收下一个用不了的 prop 属于假支持。
   * `zIndex` 相反：4.0.5 声明了 `setZIndex`（`:328`），但它当前没有组件消费者（组件未声明该
   * prop），因此也不在这里开面。
   */
  enablePicked?: boolean;
  /**
   * ⚠️ 这里**刻意不**有 `pickWidth` / `pickHeight`（#165 Class 5 已删）：官方只在
   * `layer/LineLayer.d.ts` / `layer/PointIconLayer.d.ts` / `layer/FillLayer.d.ts` /
   * `layer/PointShapeLayer.d.ts` 上声明这两个成员；`PointLayer` 的拾取面是 `pickTolerance`
   * （默认 4）/ `pickThrough` / `mouseStyleChange`。同名成员在 layer 家族上**仍然合法**
   * （见 `PointIconLayerProps` / `NativeLayerPickOptions`），删除是 **kind 特定**的。
   * 正确的拾取成员由 #169 补进来。
   */
}

/**
 * MVT 矢量瓦片图层的样式（`MVTLayer` / #109）。
 *
 * ## 运行时形状（live 探针 2026-09-23，**与 d.ts 的扁平 `MVTLayerStyle` 不同**）
 *
 * 真实 4.0 读的是**以源图层名为键**的映射：
 *
 * ```ts
 * { lines: { type: "polyline", painter: { strokeColor: "#0f0", strokeWeight: 2 } },
 *   pts:   { type: "point",     painter: { color: "#f00", size: 6 } } }
 * ```
 *
 * 没有给 `layers` 时才会退回 `point` / `line` / `fill` 的扁平路径（探针同一轮对照）。
 * 本库**不复刻** `painter` 的字段表（上游没有可逐字段核对的声明面）：按源图层名的键值袋
 * 原样透传，`type` 是官方专页给出的三档之一。
 *
 * 更新路径：`style` 有字段级 `setStyle(styleMap)`（`descriptor.mutable.style`）⇒ 变化时
 * **就地写入，不重建**（刻意不用 `bagSetters`：那会再包一层 `{ style: … }`，与官方签名不符）。
 */
export interface MVTLayerStyleEntry {
  /** 几何类型：`point` / `line` / `polyline` / `polygon` / `fill`（官方示例用过的取值）。 */
  type?: string;
  /** 绘制参数（字段随上游走，本库不臆造字段表）。 */
  painter?: Record<string, unknown>;
  /** 其余官方可能读取的键（透传）。 */
  [key: string]: unknown;
}

/** 源图层名 → 样式条目（探针确认的运行时键形）。 */
export type MVTLayerStyle = Record<string, MVTLayerStyleEntry>;

/**
 * `MVTLayer` 的官方事件载荷（`MVTLayerEventMap` 的项目侧投影，**不含** `BMap.*`）。
 *
 * 事件名与官方一一对应（live 探针确认六个名字全部可绑）：`click` / `dblclick` / `mousemove` /
 * `mouseout` / `tilesloadstart` / `tilesloadend`。拾取走事件的 `value`（`Entity[]`），
 * **不用** `pickFeatures(x,y)`（探针实测返回空）。
 */
export interface MVTLayerEntity {
  /** 要素身份：`idProperty` 有值时是该字段的值；没有时是 SDK 给的 feature number 的字符串形式。 */
  id: string;
  /** 源图层名（MVT 数据里的 source-layer；复合状态键 `layerName_id` 的前半段）。 */
  layerName: string;
  /** 业务属性袋。 */
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * 鼠标命中载荷的公共底座（官方 `MVTLayerMouseEvent` 的字段子集：`pixel` / `latLng` 必有语义，
 * 本库按官方结构收窄；**不含** `value`——那是 Pick / MouseMove 各自加的）。
 *
 * 官方三个鼠标事件都继承它：`MVTLayerPickEvent` / `MVTLayerMouseMoveEvent` / `mouseout`。
 */
export interface MVTLayerMouseEvent {
  type?: string;
  pixel?: { x: number; y: number };
  latLng?: { lng: number; lat: number };
  [key: string]: unknown;
}

/**
 * 点击 / 双击载荷（官方 `MVTLayerPickEvent`：继承 `MVTLayerMouseEvent`，`value` **可选**——
 * 未命中时 SDK 可能不带）。
 */
export interface MVTLayerPickEvent extends MVTLayerMouseEvent {
  /** 命中的要素（可能为空数组 / 缺失——SDK 未命中时的形状由上游决定，本库不编造）。 */
  value?: MVTLayerEntity[];
}

/**
 * `mousemove` 载荷（官方 `MVTLayerMouseMoveEvent`：继承 `MVTLayerMouseEvent`，
 * `value` **必有** `Entity[]`——官方签名与 Pick 的可选相反，不能 alias 到 PickEvent）。
 */
export interface MVTLayerMouseMoveEvent extends MVTLayerMouseEvent {
  value: MVTLayerEntity[];
}

/** `tilesloadstart` / `tilesloadend` 的最小载荷（官方结构松散，不编造字段）。 */
export interface MVTLayerBaseEvent {
  type?: string;
  [key: string]: unknown;
}

/**
 * `MVTLayer` 的公开属性（issue #109 基线）。
 *
 * 覆盖 `MVTLayerOptions` 中本库收下的字段（`@baidumap/jsapi-v4-types@4.0.4` + live 探针）；
 * 未列出的字段经下方逃生口字段透传。**不声明** `opacity` / `setVisible` / `setData` 等
 * 官方没有的入口（探针与 d.ts 双向确认）：
 *
 * | prop | 更新口径 |
 * | --- | --- |
 * | `visible` | 挂上 / 摘掉（图层没有 `show/hide`） |
 * | `zIndex` | **就地** `setZIndex()`（字段级 setter） |
 * | `minZoom` / `maxZoom` | **重建**（官方没有 setter） |
 * | `style` | **就地** `setStyle()`（字段级，不重建） |
 * | `tileUrlTemplate` / `layers` / `idProperty` / 其余构造项 | **重建**（没有对应 setter） |
 *
 * Feature State 经 `defineExpose({ featureState })` 给出；键必须是**复合** `layerName_id`
 * 字符串（`mvtFeatureStateKey()`），且 `idProperty` 已声明——否则五个命令一律拒绝（告警一次）。
 * 样式里必须先含 `feature-state` 表达式，写入才有可见效果（探针前置条件）。
 */
export interface MVTLayerProps {
  /** 是否挂在地图上（`false` = 摘掉，不是 `hide()`）。默认 `true`。 */
  visible?: boolean;
  /** 图层层叠顺序（挂载后 `setZIndex`）。 */
  zIndex?: number;
  /** 最小显示缩放级别（**构造期**：官方没有 setter）。 */
  minZoom?: number;
  /** 最大显示缩放级别（**构造期**）。 */
  maxZoom?: number;
  /**
   * MVT 瓦片 URL 模板；占位符是 **`[z]` / `[x]` / `[y]`**（live 探针：`{z}` 不解析）。
   * **构造期**：变化即重建。
   */
  tileUrlTemplate?: string;
  /**
   * 参与渲染的**源图层名字符串数组**（如 `["lines", "pts"]`）。
   *
   * ⚠️ 运行时 worker 用 `layers.indexOf(name)` 过滤，传对象数组会整层失效——探针实测。
   * 官方 d.ts 的 `MVTLayerConfig[]` 与运行时不符，本库按运行时收窄。**构造期**。
   */
  layers?: string[];
  /**
   * 要素身份字段（官方 `idProperty`）：拾取 `Entity.id` 与 Feature State 的唯一口径。
   * **构造期**（换身份字段必须换实例，否则同一图层上会出现两套 id 语义）。
   * 同时是 Feature State 的身份前置——未声明时 `featureState.*` 五个命令一律拒绝。
   */
  idProperty?: string;
  /**
   * 源图层样式映射（见 `MVTLayerStyle`）。变化时 `setStyle()` **就地写入，不重建**。
   *
   * 要让 `feature-state` 表达式生效，样式里必须先含 `feature-state` 污染（探针前置条件）。
   */
  style?: MVTLayerStyle;
  /**
   * 其余 `MVTLayerOptions` 逃生口（`transform` / `gridModel` / `spanLevel` / `encrypt` /
   * 四个 `on*` 构造回调 / …）。
   *
   * ⚠️ Vue 的 `defineProps` 不能带索引签名（与 `withDefaults` 冲突），因此逃生口收成
   * 显式可选字段；Driver 侧 `LayerCreateOptions` 仍保留索引签名供进阶用法透传。
   */
  transform?: unknown;
  gridModel?: unknown;
  spanLevel?: number;
  noCollision?: boolean;
  useThumb?: boolean;
  encrypt?: boolean;
  /** 官方构造回调（与 `addEventListener` 并存的逃生口）。 */
  onclick?: (e: MVTLayerPickEvent) => void;
  ondblclick?: (e: MVTLayerPickEvent) => void;
  onmousemove?: (e: MVTLayerMouseMoveEvent) => void;
  onmouseout?: (e: MVTLayerMouseEvent) => void;
}

/* ------------------------------------------------ 原生聚合（#35） */

/**
 * `MarkerCluster` 的聚合引擎。
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
export type MarkerClusterEngine = "native" | "markers";

export interface MarkerClusterProps<Item> extends DataComponentProps<Item> {
  /**
   * 聚合引擎，默认 `"native"`。
   *
   * 换引擎 = 换资源形态（一个原生图层 ⇄ 一堆 Marker），因此它是**构造期**选项：变化时整层重建。
   */
  engine?: MarkerClusterEngine;
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
 * 簇点击载荷（`MarkerCluster` 的 `cluster-click`）。
 *
 * 两种引擎的**公共最小契约**由前四个字段构成（它们在任何引擎上都成立）；差异收在 `items` 上，
 * 而不是把两种形态塞进同一个字段名（issue #35 的范围纠正：「不为了 native/fallback API 看起来
 * 一样去恢复 SDK 没有公开的内部状态或事件身份」）。
 */
export interface ClusterPick<Item> {
  /** 哪个引擎产出的这一簇。 */
  engine: MarkerClusterEngine;
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
 * 聚合结果读数（`MarkerCluster` 的 `cluster-change`）。
 *
 * 两个引擎给出同一份面：`native` 转发官方 `ClusterLayer` 的 `change` 事件（官方口径：
 * 载荷是 `{ singles, clusters, zoom }`），`markers` 在本层重算之后给出同样的读数。
 * 它只是**读数转发** —— 本库不把它存成组件状态，也不据此推导业务行为（组件拥有的只有 props）。
 */
export interface ClusterChange {
  /** 哪个引擎产出的读数。 */
  engine: MarkerClusterEngine;
  /** 当前聚合出的簇数量。 */
  clusters: number;
  /** 未参与聚合（被展开成独立点）的数量。 */
  singles: number;
  /** 本次聚合使用的 zoom；引擎没给读数时为 `null`（不编一个数字）。 */
  zoom: number | null;
}
