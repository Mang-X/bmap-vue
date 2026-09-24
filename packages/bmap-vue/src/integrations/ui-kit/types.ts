/**
 * `./ui-kit` 子路径的公共类型面（DTO + 结构化 widget 契约）
 *
 * 设计约束（R25-D / issue #73，依据 ADR 2026-09-13 决策 3、4）：
 *
 * 1. **公共类型必须是纯数据**。事件载荷里的坐标统一归一为 `{ lng, lat }`，不携带
 *    `BMapGL.Point`，否则 `check:public-dts` 会把 `BMap.* / BMapGL` 泄漏判成失败，
 *    消费者也必须额外安装官方类型包才能用我们的声明。
 * 2. **不引用 `@baidumap/jsapi-ui-kit` 的类型**。该包 `types` 入口带
 *    `/// <reference types="bmapgl-browser" />`，而 `@types/bmapgl-browser` 只是它自己的
 *    devDependency；实测把它拉进 `tsconfig.build.json` 的 Program 会直接报
 *    `TS2688 Cannot find type definition file for 'bmapgl-browser'` 与一串
 *    `TS2833 Cannot find namespace 'BMapGL'`。因此这里用**结构化最小接口**描述我们真正
 *    调用到的成员，真实模块在 `loadUiKit()` 里以 `as unknown as UiKitModule` 收口。
 * 3. **只声明我们要调用的成员**。多声明一个上游成员就多一处可能与发布产物漂移的断言。
 *    四个 widget（`PlaceAutocomplete` / `PlaceSearch` / `PlaceDetail` / `RoutePlan`）都有
 *    Vue 封装（#73 / #75），因此这里只声明**我们真正调到**的成员；上游声明了但没有入口的
 *    能力（例如 `PlaceDetailOptions.layout`，见下）刻意不进本文件。
 */

/** 归一化坐标：与库内 `Point` 同形，不含任何 SDK 命名空间类型。 */
export interface PlacePointDTO {
  lng: number;
  lat: number;
}

/** 自动补全建议（`suggest` 数组元素、`select` / `highlight` 事件载荷）。 */
export interface PlaceSuggestionDTO {
  /** POI 名称 */
  name: string;
  province: string;
  city: string;
  district: string;
  business: string;
  address: string;
  tag?: string;
  uid?: string;
  point?: PlacePointDTO;
}

/** 键盘/鼠标高亮项（`highlight` 载荷的端点）。 */
export interface PlaceHighlightDTO {
  index: number;
  value: PlaceSuggestionDTO;
}

/**
 * 高亮变更（`highlight` 事件载荷）。
 *
 * 上游 `PlaceAutocomplete` 的 `highlight` 载荷是**变更对**：高亮项从 `from` 移到 `to`，
 * 其中 `from` 在「此前没有高亮项」（首次按方向键）时为 `null`。这里刻意保留上游语义，
 * 不压平成单条 —— 「从哪来」不是本库能替调用方决定的信息。
 *
 * ⚠️ 载荷形状由 `tests/behavior/ui-kit-widget-contract.test.ts` 对着发布产物锁定；
 * 上游改形状时会先红，不要靠猜。
 */
export interface PlaceHighlightChangeDTO {
  from: PlaceHighlightDTO | null;
  to: PlaceHighlightDTO;
}

/** 检索结果单条 POI（`load` 数组元素、`select` 事件载荷）。 */
export interface PlacePoiDTO {
  title: string;
  address: string;
  uid?: string;
  tel?: string;
  point?: PlacePointDTO;
}

/** 自动补全下拉列表字段显隐（构造期选项）。 */
export interface PlaceAutocompleteDisplayDTO {
  address?: boolean;
  district?: boolean;
  tag?: boolean;
}

/** 检索结果列表字段显隐（构造期选项）。 */
export interface PlaceSearchDisplayDTO {
  image?: boolean;
  title?: boolean;
  address?: boolean;
  type?: boolean;
  phone?: boolean;
  rating?: boolean;
  openingHours?: boolean;
  comment?: boolean;
  price?: boolean;
  rank?: boolean;
  tag?: boolean;
}

/** 详情面板字段显隐（构造期选项）。上游按 `!== false` 判定，即**默认全部为 `true`**。 */
export interface PlaceDetailDisplayDTO {
  image?: boolean;
  title?: boolean;
  address?: boolean;
  type?: boolean;
  phone?: boolean;
  rating?: boolean;
  openingHours?: boolean;
  comment?: boolean;
  price?: boolean;
  rank?: boolean;
  tag?: boolean;
  /** 是否显示「打开地图」等外链 */
  openmap?: boolean;
}

/**
 * 详情加载完成（`load` 事件载荷）。
 *
 * 两个来源共用同一形状：uid 模式走详情接口回包，POI 模式是本地渲染。
 * 上游投影里 `title` / `address` 会强制转成字符串，`uid` / `tel` / `point` 则原样透传，
 * 因此本库在投影时逐个校验类型（非字符串的 `uid` / `tel` 直接丢弃，坏坐标丢弃)。
 */
export interface PlaceDetailDTO {
  title: string;
  address: string;
  uid?: string;
  point?: PlacePointDTO;
  tel?: string;
}

/**
 * 上游能渲染的 POI 对象（POI 模式用）。
 *
 * 本库**不声明它的内部结构**：上游渲染时读的是 `ext.detail_info.*`（图片、榜单、评分、营业时间…），
 * 那是它的实现细节，抄进公共类型只会多一处在升级时会漂移的隐式依赖。
 *
 * 之所以是 `object` 而不是 `Record<string, unknown>`：调用方手上通常是 SDK 的
 * `LocalResultPoi` / `LocalResult` 里的条目，那是**interface**（TS 不会给 interface 隐式索引签名），
 * 收窄成 `Record<string, unknown>` 会挡掉唯一现实的用法 —— 那种「看起来更严格、实际更容易报错、
 * 又完全挡不住传错对象」的类型不算强类型。
 */
export type PlaceDetailPlaceObject = object;

/**
 * 详情面板可接受的地点输入（`setPlace()` / `uid` prop）。
 *
 * - `string`：POI uid。上游会去请求详情接口，结果经 `load` 事件回来；**找不到该 uid 时
 *   上游不抛错也不发事件**，界面回到空状态占位（本库如实转发，不合成假事件）。
 * - 对象：上游按**自己的 POI 形状**直接渲染（见 `PlaceDetailPlaceObject`）。
 *   本库**原样转发**，不做字段转换，也不为该内部结构背书 —— 传本库的 `PlacePoiDTO`
 *   不会得到完整详情，因为上游 `Rt()` 读的是 POI 对象的另一个形状。需要展示
 *   检索结果的详情时请用 uid（上游 `PlaceSearch` 的 `select` 载荷里带 `uid`）。
 */
export type PlaceDetailPlaceInput = string | PlaceDetailPlaceObject;

/**
 * UI Kit widget 的事件 / 释放面。
 *
 * 与上游 `BaseWidget` 的公开签名一致：`on` / `off` 是链式返回 `this`，`destroy()` 幂等。
 * 事件回调是**变参**的（`emit(event, ...args)`），载荷是第一个实参。
 */
export interface UiKitWidgetHandle {
  on(event: string, handler: (...args: unknown[]) => void): unknown;
  off(event: string, handler?: (...args: unknown[]) => void): unknown;
  destroy(): void;
}

/** `PlaceAutocomplete` 的公开面（只列已由 #70 探针验证的成员）。 */
export interface UiKitAutocompleteWidget extends UiKitWidgetHandle {
  /** 程序化检索 */
  search(keyword: string): void;
  /** 设置输入框的值（不触发检索） */
  setInputValue(value: string): void;
  /** 读取输入框当前值 */
  getInputValue(): string;
  /** 设置检索城市 */
  setLocation(location: string): void;
  /** 设置是否严格限定在 `location` 城市内 */
  setCitylimit(citylimit: boolean): void;
  /** 结果类型过滤（`all` / `city`） */
  setTypes(types: "all" | "city"): void;
  /** 展开建议列表 */
  show(): void;
  /** 收起建议列表 */
  hide(): void;
}

/** `PlaceSearch` 的公开面（只列已由 #70 探针验证的成员）。 */
export interface UiKitSearchWidget extends UiKitWidgetHandle {
  search(keyword: string, option?: { city?: string }): Promise<void>;
  searchNearby(keyword: string, center: unknown, radius?: number): Promise<void>;
  searchInBounds(keyword: string, bounds: { sw: unknown; ne: unknown }): Promise<void>;
  prevPage(): void;
  nextPage(): void;
  goToPage(page: number): void;
}

/** `PlaceDetail` 的公开面（只列已由 #70 探针验证的成员）。 */
export interface UiKitPlaceDetailWidget extends UiKitWidgetHandle {
  /** 设置当前展示的地点：uid（走详情接口）或上游 POI 对象（本地渲染） */
  setPlace(uidOrPoi: PlaceDetailPlaceInput): void;
  /** 清空详情区域，恢复空状态占位 */
  clear(): void;
}

/**
 * 路线规划类型。
 *
 * 这是**数据面**的取值集合（事件载荷 / `getCurrentType()`）。锁定版本 `1.1.2` 的
 * `enabledTypes` 硬编码为 `["driving"]`、`showTabs: false`，因此除 `driving` 之外的成员
 * **不可请求**（也没有公开入口可切换）；本库暴露完整联合类型是因为上游事件与结果的
 * `routeType` 声明就是这个联合，收窄成 `"driving"` 会在上游开放更多模式时变成谎言。
 */
export type RoutePlanMode = "driving" | "transit" | "riding" | "walking";

/** 路段类型。 */
export type RouteSegmentType = "drive" | "walk" | "transit" | "riding";

/** 公交路段子类型。 */
export type RouteTransitSubType = "bus" | "subway" | "ferry" | "train" | "airplane" | "coach";

/**
 * 驾车策略。
 *
 * 与上游 `DrivingPolicy` 枚举**逐值对齐**（本库自持，不 import 上游类型）：对齐关系由
 * `ui-kit-widget-contract.test.ts` 把上游 `.d.ts` 的枚举成员解析出来逐项断言。
 *
 * 它**既是类型也是值**（与 TS 枚举同形），这样调用方不必写魔法数字：
 *
 * ```ts
 * <RoutePlan :driving-options="{ policy: RoutePlanDrivingPolicy.AVOID_CONGESTION }" />
 * ```
 */
export const RoutePlanDrivingPolicy = {
  /** 默认（最短时间或距离） */
  DEFAULT: 0,
  /** 距离最短 */
  LEAST_DISTANCE: 2,
  /** 避开高速 */
  AVOID_HIGHWAYS: 3,
  /** 优先高速 */
  FIRST_HIGHWAYS: 4,
  /** 避开拥堵 */
  AVOID_CONGESTION: 5,
  /** 少收费 */
  AVOID_PAY: 6,
  /** 高速优先 + 躲避拥堵 */
  HIGHWAYS_AVOID_CONGESTION: 7,
  /** 不走高速 + 躲避拥堵 */
  AVOID_HIGHWAYS_CONGESTION: 8,
  /** 躲避拥堵 + 少收费 */
  AVOID_CONGESTION_PAY: 9,
  /** 不走高速 + 躲避拥堵 + 少收费 */
  AVOID_HIGHWAYS_CONGESTION_PAY: 10,
  /** 不走高速 + 少收费 */
  AVOID_HIGHWAYS_PAY: 11,
} as const;

/** 驾车策略的取值集合（由常量表派生，避免同一件事写两遍）。 */
export type RoutePlanDrivingPolicy =
  (typeof RoutePlanDrivingPolicy)[keyof typeof RoutePlanDrivingPolicy];

/** 驾车配置（构造期选项；上游没有对应 setter，变更即重建 widget）。 */
export interface RoutePlanDrivingOptionsDTO {
  /** 驾车策略，上游默认 `0`（DEFAULT） */
  policy?: RoutePlanDrivingPolicy;
  /** 备选方案数量，上游默认 `1` */
  alternatives?: number;
}

/**
 * 路线端点输入：纯数据坐标（本库经 Driver 转成引擎原生点），或地点名 / POI uid
 * （上游支持字符串模式）。
 */
export type RoutePlanEndpointInput = PlacePointDTO | string;

/** 路径规划搜索参数。 */
export interface RoutePlanSearchOptionsDTO {
  /** 起点 */
  start: RoutePlanEndpointInput;
  /** 终点 */
  end: RoutePlanEndpointInput;
  /** 起点名称（用于结果展示与外部导航） */
  startName?: string;
  /** 终点名称 */
  endName?: string;
  /** 起点 uid（上游优先级高于 `start`） */
  startUid?: string;
  /** 终点 uid（上游优先级高于 `end`） */
  endUid?: string;
  /** 途经点（仅驾车；上游上限 10 个） */
  waypoints?: PlacePointDTO[];
}

/** 路线端点（结果里的起点 / 终点）。 */
export interface RoutePointDTO {
  title: string;
  location: PlacePointDTO;
  city?: string;
  uid?: string;
}

/** 路段公共字段。 */
export interface RouteSegmentBaseDTO {
  type: RouteSegmentType;
  /** 距离（米） */
  distance: number;
  /** 距离文本 */
  distanceText: string;
  /** 路径坐标点 */
  path?: PlacePointDTO[];
  /** 路段描述 */
  description?: string;
  /** 行驶时长（秒） */
  duration?: number;
}

/** 驾车路段。 */
export interface RouteDriveSegmentDTO extends RouteSegmentBaseDTO {
  type: "drive";
  description: string;
  /** 路段起点 */
  location: PlacePointDTO;
  /** 道路名称 */
  roadName?: string;
}

/** 步行路段。 */
export interface RouteWalkSegmentDTO extends RouteSegmentBaseDTO {
  type: "walk";
}

/** 骑行路段。 */
export interface RouteRidingSegmentDTO extends RouteSegmentBaseDTO {
  type: "riding";
}

/** 公交路段。 */
export interface RouteTransitSegmentDTO extends RouteSegmentBaseDTO {
  type: "transit";
  subType: RouteTransitSubType;
  lineName: string;
  onStop: string;
  offStop: string;
  stopCount: number;
}

/** 路段（判别联合，判别键是 `type`）。 */
export type RouteSegmentDTO =
  | RouteDriveSegmentDTO
  | RouteWalkSegmentDTO
  | RouteTransitSegmentDTO
  | RouteRidingSegmentDTO;

/** 一条路线方案。 */
export interface RoutePlanDTO {
  /** 总距离（米） */
  distance: number;
  /** 距离文本 */
  distanceText: string;
  /** 总时长（秒） */
  duration: number;
  /** 时长文本 */
  durationText: string;
  /** 路段数组 */
  segments: RouteSegmentDTO[];
  /** 过路费（元） */
  toll?: number;
  /** 收费路段距离（米） */
  tollDistance?: number;
  /** 红绿灯个数（驾车） */
  trafficLights?: number;
  /** 路况 / 方案特点摘要文案，如「一路畅通|时间少」 */
  tag?: string;
  /** 途经点数组 */
  waypoints?: string[];
  /** 出行类型（0=同城, 1=跨城） */
  transitType?: number;
  /** 步行距离文本 */
  walkDistance?: string;
  /** 完整路径坐标点 */
  path?: PlacePointDTO[];
}

/**
 * 路线规划结果：`result` 事件载荷与 `search()` 的返回值**同一形状**。
 *
 * 归一化说明：上游 `search()` 的返回值字段名是 `routeType`，而 `result` 事件载荷用的是
 * `type`（同一实现里两者相等）。本库统一成 `type`，避免同一个东西两个名字 —— 这也是
 * 本库对上游形状做过的**唯一**一处改名，所以单独写在这里。
 */
export interface RoutePlanResultDTO {
  type: RoutePlanMode;
  start: RoutePointDTO;
  end: RoutePointDTO;
  plans: RoutePlanDTO[];
}

/** `typechange` 事件载荷。 */
export interface RoutePlanTypeChangeDTO {
  type: RoutePlanMode;
}

/** `planselect` 事件载荷。 */
export interface RoutePlanPlanSelectDTO {
  type: RoutePlanMode;
  planIndex: number;
  plan: RoutePlanDTO;
}

/** `navclick` 事件载荷。`result` / `plan` 在上游没有对应数据时为 `null` / `undefined`。 */
export interface RoutePlanNavClickDTO {
  type: RoutePlanMode;
  result: RoutePlanResultDTO | null;
  planIndex: number;
  plan?: RoutePlanDTO;
}

/** `RoutePlan` 的公开面（只列已由 #70 探针验证的成员）。 */
export interface UiKitRoutePlanWidget extends UiKitWidgetHandle {
  /** 搜索路径。入参形状由上游定义，本库在调用前把纯数据坐标换成引擎原生点。 */
  search(options: object): Promise<unknown>;
  /** 清空结果 */
  clear(): void;
  /** 当前规划类型（锁定版本恒为 `driving`） */
  getCurrentType(): RoutePlanMode;
  /** 上次搜索结果（未搜索过为 `null`）；形状未知，由调用方投影 */
  getLastResult(): unknown;
}

/**
 * 传给 widget 构造器的选项。
 *
 * `map` 必须存在（上游四个 widget 都在构造期 `if (!options.map) throw`），
 * 值由 `MapHandle` 经 `unwrapRaw()` 取出。
 */
export type UiKitWidgetOptions = Record<string, unknown> & { map: unknown };

/**
 * 动态 import 得到的 UI Kit 模块面。
 *
 * 四个 widget 都有**构造签名**：它们是我们真正 `new` 出来的东西。
 *
 * **索引签名必须保留**：`loadUiKit()` 从 #73 起就是公开的进阶逃生口（「用上游还没被本库封装的
 * 成员时自己构造」），删掉它会让 `uiKit[someWidgetName]` 这类已有写法直接类型报错
 * （PR #82 评审 P1）。它带来的「差集查不出来」问题不靠收窄公共 API 解决 ——
 * 由 `ui-kit-widget-contract.test.ts` 对着上游 `.d.ts` **逐成员**校验我们依赖的这四个具名成员。
 */
export interface UiKitModule {
  PlaceAutocomplete: new (
    container: string | HTMLElement,
    options: UiKitWidgetOptions,
  ) => UiKitAutocompleteWidget;
  PlaceSearch: new (container: string | HTMLElement, options: UiKitWidgetOptions) => UiKitSearchWidget;
  PlaceDetail: new (container: string | HTMLElement, options: UiKitWidgetOptions) => UiKitPlaceDetailWidget;
  RoutePlan: new (container: string | HTMLElement, options: UiKitWidgetOptions) => UiKitRoutePlanWidget;
  /** 上游的其余导出（主题等）经这里保持可达。 */
  [exportedName: string]: unknown;
}
