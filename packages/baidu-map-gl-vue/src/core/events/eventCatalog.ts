/**
 * 事件 Catalog（M4-EVENTS / issue #28）—— 单一事实源
 *
 * 三处消费同一份数据，避免「组件发的名字 / composable 收的名字 / 文档写的名字」三者漂移：
 *
 * 1. `<BMap>` 的 `defineEmits`（模板与 TS 提示）与 map 事件的转发；
 * 2. `useMapEvent` / `useMapStatus` 解析订阅名（含 SDK 拼写与 kebab 拼写的互认）；
 * 3. 文档表格与测试 fixture 的对照（`tests/behavior/v3-map-event-catalog.test.ts`）。
 *
 * ## 名字从哪来
 *
 * **上游权威清单**：`@baidumap/jsapi-v4-types@4.0.4` 的 `core/MapEvent.d.ts` 声明了
 * 「地图事件名称到事件对象类型的完整映射表」（41 个键），`core/Map.d.ts` 的
 * `addEventListener<K extends keyof MapEventMap>` 直接消费它。本表 `declared: true` 的条目
 * 与那份清单**逐键相等**，由 `v3-map-event-catalog.test.ts` 直接解析上游 `.d.ts` 文本比对
 * （双向取差集，任一方向非空即红）。
 *
 * **运行时可观察、上游类型未声明的两个**：`headingchange` / `tiltchange`。依据是它们
 * **已经在本库运行**：`<BMap>` 的视野回写订阅（M4-STATE / #27）就绑在它们上面，行为由
 * `v3-component-scenarios.test.ts` 的 `simulateUserView()` 与 ADR `2026-09-14-map-controlled-state`
 * 决策 5 冻结。这与 #74 发现的「`MapTypeId` 声明了 `BMAP_*_MAP` 而运行时只有
 * `NORMAL/EARTH/SATELLITE`」是同一类**声明与运行时不一致**，因此这里如实标 `declared: false`，
 * 不假装上游声明存在、也不把它们塞进「上游清单」。
 *
 * ## SDK → Vue 的名字映射
 *
 * `vue` 名 = SDK 名把分隔符 `_` 换成 `-`（其余保持原样）。**只做这一条**，因为它可推导、
 * 且与官方参考实现不冲突：
 *
 * - 上游 41 个事件名里**没有** camelCase，因此不存在「驼峰转 kebab」这一步；
 * - 只有 `style_willchange` / `style_loaded` / `style_loaded_error` / `style_loaded_timeout` /
 *   `language_change` 带 `_`，它们正是 kebab 化的对象；
 * - `maptypechange` / `tilesloaded` / `zoomexceeded` 这类**没有官方词边界**，不替上游拆词
 *   （拆出来的 `map-type-change` 只能靠猜，官方文档里查不到这个名字）。官方 React 封装
 *   `huiyan-fe/react-bmap@2.0.1` 的 `EVENT_MAP`（`src/components/Map/Map.tsx`）同样原样使用
 *   `maptypechange` / `tilesloaded` / `rightdblclick`。
 *
 * SDK 拼写永远仍可用：`resolveMapEventName()` 把 `-` / `_` / 大小写差异归一后再查索引，
 * 因此 `@style-loaded`、`@style_loaded`、`@styleLoaded` 都命中同一条目；`<BMap>` 对
 * `sdk !== vue` 的条目会**同时**发出规范名与 SDK 拼写（`MAP_EVENT_EMIT_ALIASES`），
 * 组件里没有第二份兼容代码。
 *
 * ## 高频事件的合帧标记
 *
 * `coalesce: true` 的条目在 `useMapEvent` 里按帧合帧（一帧最多提交一次、取最后一次载荷）。
 * 标记只影响**订阅路径**，不影响事件名：SDK 侧订阅名恒为 `sdk`。
 */
import type {
  DriverEvent,
  MapLoadEvent,
  MapMouseEvent,
  MapResizeEvent,
  MapTypeChangeEvent,
} from "../../driver/types/events";

/**
 * 所有 map 事件的公共载荷：Driver 归一化后的领域事件 + **恒有的 `type`**。
 *
 * `type` 在这里收成必填的依据：Driver 派发时总是知道自己是哪个订阅名
 * （`normalizeDriverEvent` 的第一个参数）。`DriverEvent.type` 声明为可选，是为了兼容另一个
 * 独立 helper（`normalizeMapMouseEvent` 可以在没有订阅上下文时被调用）；两条路径分别由
 * `v3-map-event-catalog.test.ts` 的 fixture 钉住。
 */
export type MapEventPayload = DriverEvent & { type: string };

/**
 * 指针 / 拖拽类事件的载荷：`point` 必有。
 *
 * 依据是 Driver 对指针类事件做兜底（raw 缺坐标时补 `{lng:0,lat:0}`，见
 * `driver/normalize/events.ts` 的 `POINTER_EVENT_NAMES`）——与 `<BMap @click>` 的既有契约
 * （`normalizeMapMouseEvent` 一直如此）一致。**两处必须一致**，由 Catalog 的 `pointer` 标记
 * 与 Driver 导出的那份名字清单在测试里逐项比对。
 */
export type MapPointerEvent = MapMouseEvent & { type: string };

/** 单条 map 事件定义。 */
export interface MapEventDefinition {
  /** SDK 事件名（订阅名）：`sdk !== vue` 时两个名字都会发出。 */
  readonly sdk: string;
  /** 上游 `MapEventMap` 是否声明了它（`false` = 仅运行时可观察）。 */
  readonly declared: boolean;
  /**
   * 载荷种类：决定该事件的公共载荷里哪些字段是必填（见 `MapEventPayloadKind`）。
   *
   * 与 Driver 侧两张表——指针兜底清单（`POINTER_EVENT_NAMES`）与读回补齐表
   * （`MAP_EVENT_READBACK_FIELDS`）——由门禁逐项比对：两处必须同时改。
   */
  readonly payload: MapEventPayloadKind;
  /** 高频事件：订阅路径按帧合帧，一帧最多提交一次。 */
  readonly coalesce: boolean;
  /** 一句话说明（进文档表格与测试 fixture）。 */
  readonly description: string;
}

/**
 * map 事件表。**键 = 规范 Vue 名（kebab）**。
 *
 * `as const satisfies`：既保留字面量键类型（模板提示与 `MapEventMap` 派生都依赖它），
 * 又在编写期校验每条定义的形状。
 */
export const MAP_EVENT_CATALOG = {
  load: {
    sdk: "load",
    declared: true,
    payload: "load",
    coalesce: false,
    description: "地图初始化完成（首次视野确定后派发一次；载荷另有 point / zoom）",
  },
  click: {
    sdk: "click",
    declared: true,
    payload: "pointer",
    coalesce: false,
    description: "左键单击地图",
  },
  dblclick: {
    sdk: "dblclick",
    declared: true,
    payload: "pointer",
    coalesce: false,
    description: "鼠标双击地图",
  },
  rightclick: {
    sdk: "rightclick",
    declared: true,
    payload: "pointer",
    coalesce: false,
    description: "右键单击地图",
  },
  rightdblclick: {
    sdk: "rightdblclick",
    declared: true,
    payload: "pointer",
    coalesce: false,
    description: "右键双击地图",
  },
  mousemove: {
    sdk: "mousemove",
    declared: true,
    payload: "pointer",
    coalesce: true,
    description: "鼠标在地图区域内移动（高频，按帧合帧）",
  },
  mousedown: {
    sdk: "mousedown",
    declared: true,
    payload: "pointer",
    coalesce: false,
    description: "鼠标按下",
  },
  mouseup: {
    sdk: "mouseup",
    declared: true,
    payload: "pointer",
    coalesce: false,
    description: "鼠标松开",
  },
  mouseover: {
    sdk: "mouseover",
    declared: true,
    payload: "pointer",
    coalesce: false,
    description: "鼠标移入地图区域",
  },
  mouseout: {
    sdk: "mouseout",
    declared: true,
    payload: "pointer",
    coalesce: false,
    description: "鼠标移出地图区域",
  },
  touchstart: {
    sdk: "touchstart",
    declared: true,
    payload: "pointer",
    coalesce: false,
    description: "触摸开始",
  },
  touchmove: {
    sdk: "touchmove",
    declared: true,
    payload: "pointer",
    coalesce: true,
    description: "触摸移动（高频，按帧合帧）",
  },
  touchend: {
    sdk: "touchend",
    declared: true,
    payload: "pointer",
    coalesce: false,
    description: "触摸结束",
  },
  mousewheel: {
    sdk: "mousewheel",
    declared: true,
    payload: "pointer",
    // 刻意**不**合帧：滚轮是离散输入，每次都有独立的 `trend`（放大 / 缩小），
    // 合帧会把「一帧内先放大再缩小」压成一次，丢掉调用方真正需要的那次。
    coalesce: false,
    description: "滚轮缩放（载荷另有 trend：true = 放大）",
  },
  zoomexceeded: {
    sdk: "zoomexceeded",
    declared: true,
    payload: "base",
    coalesce: false,
    description: "缩放试图超出允许范围（载荷另有 targetZoom）",
  },
  dragstart: {
    sdk: "dragstart",
    declared: true,
    payload: "pointer",
    coalesce: false,
    description: "开始拖拽地图",
  },
  dragging: {
    sdk: "dragging",
    declared: true,
    payload: "pointer",
    coalesce: true,
    description: "拖拽中（高频，按帧合帧）",
  },
  dragend: {
    sdk: "dragend",
    declared: true,
    payload: "pointer",
    coalesce: false,
    description: "结束拖拽",
  },
  movestart: {
    sdk: "movestart",
    declared: true,
    payload: "base",
    coalesce: false,
    description: "地图移动开始",
  },
  moving: {
    sdk: "moving",
    declared: true,
    payload: "base",
    coalesce: true,
    description: "地图移动中（高频，按帧合帧）",
  },
  moveend: {
    sdk: "moveend",
    declared: true,
    payload: "base",
    coalesce: false,
    description: "地图移动结束",
  },
  zoomstart: {
    sdk: "zoomstart",
    declared: true,
    payload: "base",
    coalesce: false,
    description: "开始改变缩放级别",
  },
  zooming: {
    sdk: "zooming",
    declared: true,
    payload: "base",
    coalesce: true,
    description: "缩放中（高频，按帧合帧）",
  },
  zoomend: {
    sdk: "zoomend",
    declared: true,
    payload: "base",
    coalesce: false,
    description: "缩放结束",
  },
  beforeaddoverlay: {
    sdk: "beforeaddoverlay",
    declared: true,
    payload: "base",
    coalesce: false,
    description: "覆盖物添加前",
  },
  addoverlay: {
    sdk: "addoverlay",
    declared: true,
    payload: "base",
    coalesce: false,
    description: "addOverlay() 之后",
  },
  removeoverlay: {
    sdk: "removeoverlay",
    declared: true,
    payload: "base",
    coalesce: false,
    description: "removeOverlay() 之后",
  },
  clearoverlays: {
    sdk: "clearoverlays",
    declared: true,
    payload: "base",
    coalesce: false,
    description: "clearOverlays() 之后",
  },
  addcontrol: {
    sdk: "addcontrol",
    declared: true,
    payload: "base",
    coalesce: false,
    description: "addControl() 之后",
  },
  removecontrol: {
    sdk: "removecontrol",
    declared: true,
    payload: "base",
    coalesce: false,
    description: "removeControl() 之后",
  },
  addcontextmenu: {
    sdk: "addcontextmenu",
    declared: true,
    payload: "base",
    coalesce: false,
    description: "addContextMenu() 之后",
  },
  removecontextmenu: {
    sdk: "removecontextmenu",
    declared: true,
    payload: "base",
    coalesce: false,
    description: "removeContextMenu() 之后",
  },
  maptypechange: {
    sdk: "maptypechange",
    declared: true,
    payload: "maptypechange",
    coalesce: false,
    description: "地图类型变化（载荷另有 mapType / exMapType）",
  },
  "style-willchange": {
    sdk: "style_willchange",
    declared: true,
    payload: "base",
    coalesce: false,
    description: "个性化样式即将切换",
  },
  "style-loaded": {
    sdk: "style_loaded",
    declared: true,
    payload: "base",
    coalesce: false,
    description: "个性化样式加载完成",
  },
  "style-loaded-error": {
    sdk: "style_loaded_error",
    declared: true,
    payload: "base",
    coalesce: false,
    description: "个性化样式加载失败",
  },
  "style-loaded-timeout": {
    sdk: "style_loaded_timeout",
    declared: true,
    payload: "base",
    coalesce: false,
    description: "个性化样式加载超时",
  },
  "language-change": {
    sdk: "language_change",
    declared: true,
    payload: "base",
    coalesce: false,
    description: "地图显示语言变化",
  },
  destroy: {
    sdk: "destroy",
    declared: true,
    payload: "base",
    coalesce: false,
    description: "地图实例销毁",
  },
  tilesloaded: {
    sdk: "tilesloaded",
    declared: true,
    payload: "base",
    coalesce: false,
    description: "瓦片加载完成",
  },
  resize: {
    sdk: "resize",
    declared: true,
    payload: "resize",
    coalesce: false,
    description: "容器可视区域大小变化（载荷另有 size）",
  },
  headingchange: {
    sdk: "headingchange",
    declared: false,
    payload: "base",
    coalesce: false,
    description: "旋转角变化（上游类型未声明，运行时可观察）",
  },
  tiltchange: {
    sdk: "tiltchange",
    declared: false,
    payload: "base",
    coalesce: false,
    description: "倾斜角变化（上游类型未声明，运行时可观察）",
  },
} as const satisfies Record<string, MapEventDefinition>;

/**
 * 规范 Vue 事件名（`@xxx`）：**直接从表派生**，因此「加了表项却忘了加名字」不可能发生。
 *
 * 注意这里**不能**把 `MapEventName` 直接当 `defineEmits` 里的 mapped type 约束：
 * `@vue/compiler-sfc` 解析不了 `keyof typeof <大对象>`（实测 `Failed to resolve index type
 * into finite keys`），所以 SFC 那边用的是显式键的 `MapEventEmits`（见下）。
 */
export type MapEventName = keyof typeof MAP_EVENT_CATALOG;

/** 全部 SDK 订阅名。 */
export type MapEventSdkName = (typeof MAP_EVENT_CATALOG)[MapEventName]["sdk"];

/**
 * 兼容别名（SDK 拼写）名集合：`sdk !== vue` 的那些 `sdk`。
 *
 * 它们和规范名一样可以绑在 `<BMap>` 上（`@style-loaded` 与 `@style_loaded` 都能用），
 * 载荷与该条目的规范名相同。
 */
export type MapEventEmitAliasName = {
  [K in MapEventName]: (typeof MAP_EVENT_CATALOG)[K]["sdk"] extends K
    ? never
    : (typeof MAP_EVENT_CATALOG)[K]["sdk"];
}[MapEventName];

/** `<BMap>` 上可绑的 map 事件名 = 规范名 ∪ 兼容别名。 */
export type MapEventEmitName = MapEventName | MapEventEmitAliasName;

/**
 * 「事件专属载荷」的种类（M4-EVENTS / #28 评审：公共契约发布前把事件级必填字段收紧）。
 *
 * 判据是「这个字段能不能被兑现」：
 *
 * - `pointer`：指针 / 拖拽类的 `point` 由 Driver 兜底（`POINTER_EVENT_NAMES`）；
 * - `load` / `resize` / `maptypechange`：必填字段由 Driver **读回地图补齐**
 *   （`MAP_EVENT_READBACK_FIELDS`：`getCenter` / `getZoom` / `getSize`）；
 * - `base`：没有事件专属必填字段。
 *
 * raw-only 的字段（`mousewheel.trend`、`zoomexceeded.targetZoom`）**不在**这里：地图答不出它们，
 * 本库不做猜测，因此它们在公共底座上保持 optional（见 ADR 已知限制）。
 */
export type MapEventPayloadKind = "base" | "pointer" | "load" | "resize" | "maptypechange";

/** `load` 的公共载荷：`point` / `zoom` 必填。 */
export type MapLoadPayload = MapLoadEvent & { type: string };
/** `resize` 的公共载荷：`size` 必填。 */
export type MapResizePayload = MapResizeEvent & { type: string };
/** `maptypechange` 的公共载荷：`zoomLevel` 必填。 */
export type MapTypeChangePayload = MapTypeChangeEvent & { type: string };

/** 载荷种类 → 具体载荷类型。 */
export type MapEventPayloadOfKind<K extends MapEventPayloadKind> = K extends "pointer"
  ? MapPointerEvent
  : K extends "load"
    ? MapLoadPayload
    : K extends "resize"
      ? MapResizePayload
      : K extends "maptypechange"
        ? MapTypeChangePayload
        : MapEventPayload;

/**
 * `<BMap>` 的 map 事件 emits 声明（**显式键**，被 `defineEmits` 直接消费）。
 *
 * 为什么是手写接口而不是 mapped type：`@vue/compiler-sfc` 必须把 emits 类型解析成「有限个键」。
 * 实测（`@vue/compiler-sfc@3.5.42`，「这个位置能不能编过 SFC」）：
 *
 * | 写法 | 结果 |
 * | --- | --- |
 * | `{ [K in MapEventName]: [event: MapEventPayload] }`（约束 = `keyof typeof MAP_EVENT_CATALOG`） | ❌ `Failed to resolve index type into finite keys` |
 * | 同上，但把约束换成**字面量联合**（当时的 `MapEventName`） | ✅ |
 * | `{ [K in MapEventEmitName]: [event: MapEventEmitPayload<K>] }`（值含**条件类型**） | ❌ 同上 |
 * | 显式键的接口（本写法） | ✅ |
 *
 * 也就是说：约束必须是可枚举的字面量、值必须是可静态求值的类型；而 `MapEventName` 现在是
 * `keyof typeof MAP_EVENT_CATALOG`（派生，防漂移），所以 SFC 这一侧只能走显式键的接口。
 *
 * 它带来的漂移风险由本文件末尾的**编译期断言**消除（`typecheck:v3` 会跑）：
 * ① 键集合与 `MapEventName ∪ MapEventEmitAliasName` 双向相等（表里加了、这里没加就编译失败）；
 * ② 每个键的载荷与 `MAP_EVENT_CATALOG` 的 `pointer` 标记**逐键**一致。
 *
 * 别名（`style_loaded` 等 SDK 拼写）必须也在这里：Vue 只把**已声明**的事件名交给 `emit` 匹配，
 * 未声明的名字会落到 `attrs`，`emit()` 唤不醒它（静默失败）。
 */
export interface MapEventEmits {
  load: [event: MapLoadPayload];
  click: [event: MapPointerEvent];
  dblclick: [event: MapPointerEvent];
  rightclick: [event: MapPointerEvent];
  rightdblclick: [event: MapPointerEvent];
  mousemove: [event: MapPointerEvent];
  mousedown: [event: MapPointerEvent];
  mouseup: [event: MapPointerEvent];
  mouseover: [event: MapPointerEvent];
  mouseout: [event: MapPointerEvent];
  touchstart: [event: MapPointerEvent];
  touchmove: [event: MapPointerEvent];
  touchend: [event: MapPointerEvent];
  mousewheel: [event: MapPointerEvent];
  zoomexceeded: [event: MapEventPayload];
  dragstart: [event: MapPointerEvent];
  dragging: [event: MapPointerEvent];
  dragend: [event: MapPointerEvent];
  movestart: [event: MapEventPayload];
  moving: [event: MapEventPayload];
  moveend: [event: MapEventPayload];
  zoomstart: [event: MapEventPayload];
  zooming: [event: MapEventPayload];
  zoomend: [event: MapEventPayload];
  beforeaddoverlay: [event: MapEventPayload];
  addoverlay: [event: MapEventPayload];
  removeoverlay: [event: MapEventPayload];
  clearoverlays: [event: MapEventPayload];
  addcontrol: [event: MapEventPayload];
  removecontrol: [event: MapEventPayload];
  addcontextmenu: [event: MapEventPayload];
  removecontextmenu: [event: MapEventPayload];
  maptypechange: [event: MapTypeChangePayload];
  "style-willchange": [event: MapEventPayload];
  "style-loaded": [event: MapEventPayload];
  "style-loaded-error": [event: MapEventPayload];
  "style-loaded-timeout": [event: MapEventPayload];
  "language-change": [event: MapEventPayload];
  destroy: [event: MapEventPayload];
  tilesloaded: [event: MapEventPayload];
  resize: [event: MapResizePayload];
  headingchange: [event: MapEventPayload];
  tiltchange: [event: MapEventPayload];
  // 兼容别名（SDK 拼写）：载荷与其规范名相同
  style_willchange: [event: MapEventPayload];
  style_loaded: [event: MapEventPayload];
  style_loaded_error: [event: MapEventPayload];
  style_loaded_timeout: [event: MapEventPayload];
  language_change: [event: MapEventPayload];
}

/** 事件名 → 载荷类型（从 `MapEventEmits` 派生，只保留规范名；`useMapEvent` 的载荷口径）。 */
export type MapEventMap = { [K in MapEventName]: MapEventEmits[K][0] };

/** 某个规范名对应的载荷类型。 */
export type MapEventPayloadOf<K extends MapEventName> = MapEventMap[K];

/* ------------------------------------------------- 类型门禁（编译期，`typecheck:v3` 会跑）
 *
 * 声明在类型位置、不产生运行时代码。任一条不成立都会让 `vue-tsc` 报 TS2344 —— 也就是说
 * 「手写的 emits 接口」与「Catalog 表」不可能悄悄漂移。两处的对应关系反过来也保住了
 * 运行时的那两张表（指针兜底清单 / 读回补齐表，由 `v3-map-event-catalog.test.ts` 对齐）。
 */

/** 参数类型必须是 `never`（差集非空即编译失败）。 */
type AssertNever<T extends never> = T;

/** 断言 ①a：`MapEventEmits` 不能缺键。 */
type EmitKeysMissing = AssertNever<Exclude<MapEventEmitName, keyof MapEventEmits>>;

/** 断言 ①b：`MapEventEmits` 不能多键。 */
type EmitKeysExtra = AssertNever<Exclude<keyof MapEventEmits, MapEventEmitName>>;

/** 任一种 emit 名所属的 Catalog 条目（规范名）。 */
type OwningEntry<N extends string> = {
  [K in MapEventName]: N extends K
    ? K
    : N extends (typeof MAP_EVENT_CATALOG)[K]["sdk"]
      ? K
      : never;
}[MapEventName];

/** 由 Catalog 的 `payload` 种类推出的载荷类型（**不看** `MapEventEmits`，否则断言会自我印证）。 */
type ExpectedEmitPayload<N extends string> = OwningEntry<N> extends infer K extends MapEventName
  ? MapEventPayloadOfKind<(typeof MAP_EVENT_CATALOG)[K]["payload"]>
  : never;

/** 断言 ②：每个键的载荷与 `payload` 种类**双向**可赋值（等价，不是单向放宽）。 */
type EmitPayloadMismatches = {
  [N in keyof MapEventEmits]: [MapEventEmits[N][0]] extends [ExpectedEmitPayload<N>]
    ? [ExpectedEmitPayload<N>] extends [MapEventEmits[N][0]]
      ? never
      : N
    : N;
}[keyof MapEventEmits];

/** 导出的「断言结果」类型别名：全部成立时它恒为 `never`。 */
export type MapEventCatalogTypeGates = [
  EmitKeysMissing,
  EmitKeysExtra,
  AssertNever<EmitPayloadMismatches>,
];

/** 规范 Vue 名 → SDK 名（只做分隔符替换，见文件头）。 */
export function toSdkEventName(vueName: string): string {
  return vueName.replace(/-/g, "_");
}

/** SDK 名 → 规范 Vue 名。 */
export function toVueEventName(sdkName: string): string {
  return sdkName.replace(/_/g, "-");
}

/**
 * 名字归一化：抹掉分隔符与大小写差异，用于「任一种拼写都命中同一条目」。
 *
 * 例：`style_loaded` / `style-loaded` / `styleLoaded` → `styleloaded`。
 */
export function normalizeEventKey(name: string): string {
  return name.replace(/[-_\s]/g, "").toLowerCase();
}

export interface ResolvedMapEvent {
  /** 规范 Vue 名（`<BMap>` emit 的名字，也是 `MapEventName`）。 */
  readonly vue: MapEventName;
  /** SDK 订阅名。 */
  readonly sdk: MapEventSdkName;
  /** 是否高频（订阅路径按帧合帧）。 */
  readonly coalesce: boolean;
  /** 上游类型是否声明了它。 */
  readonly declared: boolean;
}

/** 规范 Vue 名清单。 */
export const MAP_EVENT_NAMES: readonly MapEventName[] = Object.freeze(
  Object.keys(MAP_EVENT_CATALOG) as MapEventName[],
);

/** 归一化索引：规范名与 SDK 名全部指向同一条目（同一事件两种拼写 → 同一条）。 */
const EVENT_INDEX: ReadonlyMap<string, MapEventName> = (() => {
  const index = new Map<string, MapEventName>();
  for (const vue of MAP_EVENT_NAMES) {
    index.set(normalizeEventKey(vue), vue);
    index.set(normalizeEventKey(MAP_EVENT_CATALOG[vue].sdk), vue);
  }
  return index;
})();

/**
 * 解析事件名（任一种拼写）。
 *
 * **返回 `undefined` 表示「Catalog 里没有这个名字」**——调用方据此走 raw 逃生口
 * （`useMapEvent("上游未来新增的事件")` 原样订阅），而不是静默丢弃。
 */
export function resolveMapEventName(name: string): ResolvedMapEvent | undefined {
  const vue = EVENT_INDEX.get(normalizeEventKey(name));
  if (!vue) return undefined;
  const entry = MAP_EVENT_CATALOG[vue];
  return { vue, sdk: entry.sdk, coalesce: entry.coalesce, declared: entry.declared };
}

/**
 * `sdk !== vue` 的条目：`<BMap>` 在发出规范名之外**同时**发出这些 SDK 拼写。
 *
 * 集中在这一张表里，组件不写第二份兼容代码（issue #28「旧名称通过集中 deprecation 处理，
 * 禁止组件各自兼容」）。
 */
export const MAP_EVENT_EMIT_ALIASES: Readonly<Record<string, readonly string[]>> = Object.freeze(
  Object.fromEntries(
    MAP_EVENT_NAMES.filter((vue) => MAP_EVENT_CATALOG[vue].sdk !== vue).map((vue) => [
      vue,
      [MAP_EVENT_CATALOG[vue].sdk],
    ]),
  ),
);

/* ------------------------------------------------------------------ 组件级事件
 *
 * `<BMap>` 自身的事件（就绪、插件、生命周期、视野 v-model 回写）。与 map 事件分开两张表：
 * 它们的载荷不是 Driver 事件，也不参与 `useMapEvent` 订阅。
 */

/** 单条组件事件定义。 */
export interface BMapComponentEventDefinition {
  /** 一句话说明（进文档表格）。 */
  readonly description: string;
  /** 兼容别名（`<BMap>` 对规范名与别名各发一次；规范名恒为键名）。 */
  readonly aliases?: readonly string[];
}

export const BMAP_COMPONENT_EVENT_CATALOG = {
  ready: {
    description: "地图就绪（client + map 可用）",
    /**
     * 历史别名：v2 用 `initd` 表达同一件事，v3 起规范名是 `ready`。
     * `<BMap>` 对规范名与别名**各发一次**（同载荷），映射集中在这张表里。
     */
    aliases: ["initd"],
  },
  "plugin-ready": {
    description: "单个插件加载完成（载荷为插件名）",
  },
  "plugin-error": {
    description: "单个插件加载失败（载荷为 { name, error }）",
  },
  unload: {
    description: "地图组件卸载",
  },
  error: {
    description: "地图或 Client 加载失败（载荷为 BMapError）",
  },
  "update:center": {
    description: "用户交互后的中心点回写（v-model:center）",
  },
  "update:zoom": {
    description: "用户交互后的缩放级别回写（v-model:zoom）",
  },
  "update:heading": {
    description: "用户交互后的旋转角回写（v-model:heading）",
  },
  "update:tilt": {
    description: "用户交互后的倾斜角回写（v-model:tilt）",
  },
} as const satisfies Record<string, BMapComponentEventDefinition>;

/** 组件事件规范名。 */
export type BMapComponentEventName = keyof typeof BMAP_COMPONENT_EVENT_CATALOG;

/** 别名名（从表里的 `aliases` 派生；`initd` 是当前唯一一个）。 */
export type BMapComponentEventAliasName = {
  [K in BMapComponentEventName]: (typeof BMAP_COMPONENT_EVENT_CATALOG)[K] extends {
    aliases: readonly (infer A extends string)[];
  }
    ? A
    : never;
}[BMapComponentEventName];

/** `<BMap>` 的 emits 名集合 = 规范名 ∪ 别名。 */
export type BMapComponentEmitName = BMapComponentEventName | BMapComponentEventAliasName;

/**
 * 规范名 → 历史别名：`<BMap>` 对两者**各发一次**（同载荷）。
 *
 * 与 map 事件的 `MAP_EVENT_EMIT_ALIASES` 同形：组件读这张表来发别名，因此「旧名称的集中
 * deprecation」只有一处（issue #28 明令禁止组件各自兼容）。
 */
export const BMAP_COMPONENT_EVENT_EMIT_ALIASES: Readonly<Record<string, readonly string[]>> =
  Object.freeze(
    Object.fromEntries(
      (Object.keys(BMAP_COMPONENT_EVENT_CATALOG) as BMapComponentEventName[])
        .map((name) => {
          const entry = BMAP_COMPONENT_EVENT_CATALOG[name] as { aliases?: readonly string[] };
          return [name, entry.aliases ?? []] as const;
        })
        .filter(([, aliases]) => aliases.length > 0),
    ),
  );

/** 别名 → 规范名（文档表格与测试用；从上面那张表派生，不手写第二份）。 */
export const BMAP_COMPONENT_EVENT_ALIASES: Readonly<Record<string, BMapComponentEventName>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(BMAP_COMPONENT_EVENT_EMIT_ALIASES).flatMap(([name, aliases]) =>
        aliases.map((alias) => [alias, name as BMapComponentEventName]),
      ),
    ),
  );
