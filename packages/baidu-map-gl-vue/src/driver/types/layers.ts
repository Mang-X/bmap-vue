/**
 * LayerDriver
 *
 * 图层构造器与 `map.addLayer / removeLayer` 收进 Driver。
 *
 * M7-LAYERS（issue #40）在 #22 的三种底图图层（district / tile / panorama-coverage）之上
 * 补齐 Stable 常用图层，并把「各图层的接口面并不一致」这件事**显式建模**出来：
 *
 * - `LayerKind`：领域种类（11 种），与官方构造器一一对应；
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
import type {
  NativeLayerFeatureKeys,
  NativeLayerFeatureState,
  NativeLayerFeatureStateMap,
} from "./native-layers";

/**
 * 图层种类（issue #40 的「Stable 常用 Layer」清单 + #109 的 `mvt`）。
 *
 * 前三种是 #22 已落地的底图图层；#40 补齐其余七种；#109 再补 `mvt`：
 * - `traffic` / `tile` / `xyz` / `wms` / `wmts` / `raster`：瓦片家族（`xyz` / `wms` / `wmts` /
 *   `raster` 是 4.0 的「第三方标准瓦片服务」基线，能力清单里标 `experimental`）；
 * - `geojson` / `dom`：数据驱动图层（`setData` 是一等公民）；
 * - `mvt`：MVT 矢量瓦片（官方 `MVTLayer`，tile 家族 + 要素状态五操作，见 `LayerOperation`）。
 *
 * `district` / `tile` / `traffic` / `geojson` / `mvt` 在 `@baidumap/jsapi-v4-types@4.0.4`
 * 里**有**类声明；`panorama-coverage` **没有**（只能按结构探测，见 Driver 的 `declared` 口径）。
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
  | "raster"
  | "mvt";

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
 * 这些操作是**逐成员核对** `@baidumap/jsapi-v4-types@4.0.4` 的相关图层类之后剩下的
 * 大部分：官方在这批图层上**没有**公开 `setOpacity` / `setMinZoom` / `setMaxZoom`，
 * 因此统一槽位里的 `opacity` / `minZoom` / `maxZoom` 变更在本库一律走
 * **重建**，而不是发明一个「设置生效了」的假象。
 *
 * #109（`mvt`）追加五个**要素状态**操作：官方 `MVTLayer` 的 `updateState` / `clearState`
 * 在类声明里，`removeState` / `replaceAllState` / `getAllState` 由 live 探针在原型上证到
 * （与 #36 的 NativeLayer 同一组归一化名）。只有声明了它们的 kind 才会出现在 `operations`
 * 里——其余 kind 调用时仍走 `BMAP_CAPABILITY_UNSUPPORTED`。
 */
export type LayerOperation =
  | "setZIndex"
  | "setData"
  | "clearData"
  | "updateState"
  | "removeState"
  | "clearState"
  | "replaceState"
  | "getState";

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

  setZIndex(layer: LayerHandle, zIndex: number): void;
  setData(layer: LayerHandle, data: LayerData): void;
  clearData(layer: LayerHandle): void;

  /* ------------------------------------------------------ 要素状态（#109 / mvt） */

  /**
   * 要素状态五命令的归一化面（与 #36 `NativeLayerDriver` 同一组入口名与语义）。
   *
   * 只有 `surface().operations` 声明了对应操作的 kind（当前仅 `mvt`）才能调用；
   * 其余 kind 走 `supports()` / `open()` 的 `BMAP_CAPABILITY_UNSUPPORTED`。
   * 键域由 `createFeatureStateApi` 按 kind 收窄（MVT 只收 string 复合键 `layerName_id`）。
   */
  updateState(
    layer: LayerHandle,
    keys: NativeLayerFeatureKeys,
    state: NativeLayerFeatureState,
    append?: boolean,
  ): void;
  removeState(layer: LayerHandle, keys: NativeLayerFeatureKeys): void;
  clearState(layer: LayerHandle): void;
  replaceState(layer: LayerHandle, inputs: NativeLayerFeatureStateMap): void;
  getState(layer: LayerHandle): NativeLayerFeatureStateMap;
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
