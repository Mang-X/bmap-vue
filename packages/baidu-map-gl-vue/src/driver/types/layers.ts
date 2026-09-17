/**
 * LayerDriver
 *
 * 图层构造器与 `map.addLayer / removeLayer` 收进 Driver。
 *
 * M7-LAYERS（issue #40）在 #22 的三种底图图层（district / tile / panorama-coverage）之上
 * 补齐 Stable 常用图层，并把「各图层的接口面并不一致」这件事**显式建模**出来：
 *
 * - `LayerKind`：领域种类（10 种），与官方构造器一一对应；
 * - `LayerCtorSlot` / `LayerOperation`：**统一槽位**（visible / opacity / minZoom / maxZoom /
 *   zIndex / data）在各 kind 上的两种落地方式——构造期选项与挂载后就地更新；
 * - `surface()`：把上面那张表作为**查询入口**暴露给上层（`core/layers` 的内核据此决定
 *   「就地更新」还是「重建」），因此「谁支持什么」只有一份事实源（`driver/jsapi-v4/layers.ts`）。
 *
 * 为什么不是「一个方法面硬套十个 kind」：非目标明确写了「不假定所有 Layer 都有相同事件和
 * 数据接口」。例如 `DistrictLayer` 只有构造选项、`GeoJSONLayer` 只有 `setData/setLevel`、
 * `TileLayer` 只有 `setZIndex`。把这些差异抹平会让「设置生效了」变成一句无法验证的假设。
 */
import type { LayerHandle } from "./handles";
import type { OverlayTarget } from "./overlays";

/**
 * 图层种类（issue #40 的「Stable 常用 Layer」清单）。
 *
 * 前三种是 #22 已落地的底图图层；其余七种由本 issue 补齐：
 * - `traffic` / `tile` / `xyz` / `wms` / `wmts` / `raster`：瓦片家族（`xyz` / `wms` / `wmts` /
 *   `raster` 是 4.0 的「第三方标准瓦片服务」基线，能力清单里标 `experimental`）；
 * - `geojson` / `dom`：数据驱动图层（`setData` 是一等公民）。
 *
 * `district` / `tile` / `traffic` / `geojson` 在 `@baidumap/jsapi-v4-types@4.0.4` 里**有**类声明；
 * `panorama-coverage` **没有**（只能按结构探测，见 Driver 的 `declared` 口径）。
 */
export type LayerKind =
  | "district"
  | "panorama-coverage"
  | "tile"
  | "traffic"
  | "geojson"
  | "dom"
  | "xyz"
  | "wms"
  | "wmts"
  | "raster";

/**
 * 统一槽位中**由构造选项承载**的那些。
 *
 * 刻意不含 `visible`：图层的显隐在本库统一表达为「挂上 / 摘掉」（v4 的图层大多数没有
 * `show/hide`，而 `addLayer/removeLayer` 对**所有** kind 都成立）。把它混进构造选项会得到
 * 两个互相打架的事实源（`visible: false` 的实例仍被挂在图上）。
 */
export type LayerCtorSlot = "opacity" | "minZoom" | "maxZoom" | "zIndex" | "data";

/** 统一槽位（含显隐）。 */
export type LayerSlot = LayerCtorSlot | "visible";

/**
 * `LayerCtorSlot` 的**运行时清单**（单一事实源）。
 *
 * 内核（`core/layers`）与 v4 Driver 都从这里 import：两边各抄一份数组时，将来给
 * `LayerCtorSlot` 加成员只改一处也能编译通过，会造成「Driver 丢弃该槽位、内核从不发送」这类
 * 静默分叉。这份常量与上面的类型**必须同时改**（文件末尾有类型层断言把二者绑住）。
 */
export const LAYER_CTOR_SLOTS = [
  "opacity",
  "minZoom",
  "maxZoom",
  "zIndex",
  "data",
] as const satisfies readonly LayerCtorSlot[];

/**
 * 挂载后**可就地更新**的归一化操作。
 *
 * 与 `LayerCtorSlot` 正交：同一个槽位在不同 kind 上可能只能构造期生效（`TileLayer` 的
 * `opacity` / `minZoom` / `maxZoom` 都没有 setter），也可能有字段级 setter（`setZIndex`）
 * 或整袋 setter（`DOMLayer` 的 `setStyleOptions({ zIndex })`）——后两种都由 Driver 的
 * `setOptions` 吸收，上层只写「更新这个槽位」。
 *
 * 这三个操作是**逐成员核对** `@baidumap/jsapi-v4-types@4.0.4` 的 8 个相关图层类之后剩下的
 * 全部：官方在这批图层上**没有**公开 `setOpacity` / `setMinZoom` / `setMaxZoom`
 * （`MVTLayer` 之外），因此统一槽位里的 `opacity` / `minZoom` / `maxZoom` 变更在本库一律走
 * **重建**，而不是发明一个「设置生效了」的假象。
 */
export type LayerOperation = "setZIndex" | "setData" | "clearData";

/**
 * 「清空」这一操作的作用域（`LayerDriver.clearScope` 的返回值）。
 *
 * 刻意是**三态**：把「官方明确要求」与「官方没有说明」分开，因为后者只能作为**策略**处理，
 * 不能被编码成一条公开的能力事实（否则「未知」会被下游读成「确定不需要」，见已知限制 13）。
 */
export type LayerClearScope =
  /** 官方明确要求图层仍在图上（`GeoJSONLayer.clearData`）。 */
  | "map-bound"
  /** 官方**没有**说明是否要求仍在图上（`DOMLayer.removeAllOverlays`）——未知，不是「不需要」。 */
  | "unknown"
  /** 该 kind 没有清空入口（与 `supports(kind, "clearData") === false` 必须一致）。 */
  | "none";

/**
 * 该 kind 的能力面（`surface()` 的返回值）。
 *
 * 两个字段都是**白名单**：不在 `ctorSlots` 里的统一槽位不会进构造选项，不在 `operations`
 * 里的操作调用会显式失败。上层据此决定「就地更新 / 重建 / 明确拒绝」。
 */
export interface LayerSurface {
  /** 可以经构造选项承载的统一槽位。 */
  readonly ctorSlots: readonly LayerCtorSlot[];
  /** 挂载后可用的归一化操作。 */
  readonly operations: readonly LayerOperation[];
}

/**
 * `create()` 的入参。
 *
 * 索引签名是「4.0 自身构造选项」的逃生口（`transparentPng` / `boundary` / `params` / …）：
 * 本库不复刻一遍官方选项表（那是第二份事实源，升级必然漂移），只在下面两个**构造签名首参**
 * 上给出具名槽位——它们不是选项，塞进选项袋会被 SDK 忽略：
 *
 * - `layerName`：官方 `new GeoJSONLayer(layerName, options)` 的第一个参数；
 * - `createDOM`：官方 `new DOMLayer(createDOM, options)` 的第一个参数。
 *
 * 缺失必需首参时 Driver 抛 `BMAP_INVALID_ARGUMENT`（而不是让 SDK 内部抛出难以定位的错误，
 * 或造出一个永远画不出东西的图层）。
 */
export interface LayerCreateOptions extends Record<string, unknown> {
  /** `geojson` 的图层名（写入每个要素的 `properties`）。 */
  layerName?: string;
  /** `dom` 的 DOM 工厂（官方签名第一个参数）。 */
  createDOM?: (properties: object, point: { lng: number; lat: number }) => HTMLElement;
}

/**
 * 传给 `setData` 的数据（GeoJSON `FeatureCollection` 或单条 `Feature`）。
 *
 * 刻意用 `object` 而不是 `Record<string, unknown>`：官方的签名就是 `setData(geojson: object)`，
 * 而 SDK 的 GeoJSON 结构类型（以及调用方从别处拿到的 `FeatureCollection`）**没有隐式索引签名**
 * —— 收窄成 `Record` 会挡掉唯一现实的用法，却又挡不住传错对象。结构校验留给 SDK。
 */
export type LayerData = object;

export interface LayerDriver {
  create(kind: LayerKind, options?: LayerCreateOptions): LayerHandle;
  add(target: OverlayTarget, layer: LayerHandle): void;
  remove(target: OverlayTarget, layer: LayerHandle): void;

  /**
   * 就地写入 option。
   *
   * 三种键走三条路（分类在 Driver 的 `mutable` / `bagSetters` 表里，是**单一事实源**）：
   * 字段级 setter（`setZIndex(value)`）、整袋 setter（`setStyleOptions({ zIndex })`）、
   * 构造期选项（告警一次并忽略，由上层决定是否重建）。
   */
  setOptions(layer: LayerHandle, options: Record<string, unknown>): void;

  /** 该 kind 的能力面（构造期槽位 + 可用操作）。 */
  surface(kind: LayerKind): LayerSurface;

  /** 某个归一化操作在该 kind 上是否有运行时入口（调用前先问一句）。 */
  supports(kind: LayerKind, operation: LayerOperation): boolean;

  /**
   * 该 option 键能否**就地**更新。
   *
   * `false` 表示只有构造期生效（`DistrictLayer` 的所有选项、`TileLayer` 的 `opacity` …）——
   * 上层的重建判据据此计算「构造键」，而不是自己去猜哪些键需要重建。
   */
  isMutableOption(kind: LayerKind, key: string): boolean;

  /**
   * 归一化的「清空」（`clearData`）在该 kind 上的**作用域**。
   *
   * 为什么这是一条**能力面**而不是调用方的约定：官方对两种清空语义的描述不同，而本库禁止把
   * 「我们不知道」写成「我们确定」——所以它是**三态**，不是布尔：
   *
   * - `"map-bound"`：官方明确要求图层**仍在图上**。`GeoJSONLayer.clearData()`：「先从 Map 移除
   *   这些覆盖物并清空集合」，而 `map.removeLayer()` 会「清空图层持有的 Map 引用」，官方因此明说
   *   「要真正清空 `getData()` 集合，得在 `removeLayer` **之前**调用 `clearData()`」；
   * - `"unknown"`：官方**没有**说明它是否要求仍在图上。`DOMLayer.removeAllOverlays()` 就是这一档
   *   ——它的文档只说「移除图层渲染出来的 overlays」，既没说需要 attachment、也没说不需要。
   *   **未知不等于不需要**：调用方在这一档下只能选一个**策略**（本库选 best-effort 尝试，
   *   失败可观测），而不能声称「已证明与挂图无关」；
   * - `"none"`：该 kind 没有清空入口（与 `supports(kind, "clearData") === false` 必须一致）。
   */
  clearScope(kind: LayerKind): LayerClearScope;

  setZIndex(layer: LayerHandle, zIndex: number): void;
  setData(layer: LayerHandle, data: LayerData): void;
  clearData(layer: LayerHandle): void;
}

/* -------------------------------------------------------------------------- */
/* 类型层一致性：运行时清单与类型必须同集                                       */
/* -------------------------------------------------------------------------- */

type ExpectNever<T extends never> = T;
type _AssertCtorSlotsCoverType = ExpectNever<
  Exclude<LayerCtorSlot, (typeof LAYER_CTOR_SLOTS)[number]>
>;
type _AssertCtorSlotsWithinType = ExpectNever<
  Exclude<(typeof LAYER_CTOR_SLOTS)[number], LayerCtorSlot>
>;
