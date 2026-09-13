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
 * 3. **只声明我们要调用的成员**。多声明一个上游成员就多一处可能与发布产物漂移的断言——
 *    `PlaceDetail` / `RoutePlan` 本轮不做 Vue 封装，因此刻意不在类型里替它们背书。
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

/** 键盘/鼠标高亮项（`highlight` 事件载荷）。 */
export interface PlaceHighlightDTO {
  index: number;
  value: PlaceSuggestionDTO;
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
 * 只给两个我们做 Vue 封装的 widget 写了构造签名；`PlaceDetail` / `RoutePlan` 通过索引签名
 * 保持可达（进阶用法见文档「详情与路线」一节），但我们**不**替它们声明成员——
 * 「能原生用」与「已提供 Vue 组件」是两句话。
 */
export interface UiKitModule {
  PlaceAutocomplete: new (
    container: string | HTMLElement,
    options: UiKitWidgetOptions,
  ) => UiKitAutocompleteWidget;
  PlaceSearch: new (container: string | HTMLElement, options: UiKitWidgetOptions) => UiKitSearchWidget;
  [exportedName: string]: unknown;
}
