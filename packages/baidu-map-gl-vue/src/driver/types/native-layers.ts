/**
 * NativeLayerDriver —— v4 原生批量数据图层
 *
 * 与 `LayerDriver`（行政区 / 瓦片 / 全景覆盖这类**底图图层**）分开，因为二者的语义确实不同：
 *
 * - `LayerDriver` 的 kind 是「底图家族」，option 多为构造期项，可见性就是挂上/摘掉；
 * - 原生数据图层是**数据驱动**的：`setData` / 要素状态（feature state）/ 拾取事件是一等公民，
 *   显隐、透明度、层级、缩放范围都有字段级 setter。
 *
 * 八个 kind 的 SDK 方法面**并不一致**（官方专页的四类图层共享同一套方法；`PointLayer` /
 * `ClusterLayer` / `Heatmap` / `TrackLine` 属扩展 API，各只公开自己那几个方法），因此这里
 * 不做「一个方法一套参数硬套八个 kind」：
 *
 * - 归一化操作集合 `NativeLayerOperation` 是**领域面**；
 * - 每个 kind 实际支持哪些操作由 `supports()` 回答（元数据在 Driver 侧的
 *   `NATIVE_LAYER_DESCRIPTORS`）；
 * - 调用一个该 kind 没有入口的操作**显式失败**（`BMAP_CAPABILITY_UNSUPPORTED`），
 *   不静默 no-op——「看起来调成功了但什么都没发生」是数据图层最难排查的一类问题。
 */
import type { Pixel } from "./geometry";
import type { SdkHandle } from "./handles";
import type { OverlayTarget } from "./overlays";

/**
 * 原生数据图层种类（issue #23 的「Native Layer Facet」清单）。
 *
 * `point` / `cluster` / `heatmap` / `track-line` 只能按结构探测：它们在 4.0 运行时公开，
 * 但 `@baidumap/jsapi-v4-types@4.0.4` 没有类声明，且**可视化实现是异步注入的**——因此
 * 存在性必须在调用时刻判断（见 Driver 的 `create`）。
 */
export type NativeLayerKind =
  | "point"
  | "cluster"
  | "point-icon"
  | "point-shape"
  | "line"
  | "fill"
  | "heatmap"
  | "track-line";

/**
 * 归一化操作。
 *
 * 与 `NativeLayerKind` 正交：同一个操作在不同 kind 上可能没有入口（`supports()` 回答）。
 */
export type NativeLayerOperation =
  | "setData"
  | "clearData"
  | "setStyle"
  | "setVisible"
  | "setOpacity"
  | "setZIndex"
  | "setZoomRange"
  | "updateState"
  | "removeState"
  | "clearState"
  | "replaceState"
  | "getState"
  | "setEnablePicked"
  | "hitTest"
  // TrackLine 播放命令面（#110）：七条方法名均经 live 探针取证（`scripts/probe-track-line.mts`，
  // 2026-09-23，exit 0），不是从类型包猜的。`setSpeed` / `setProcess` 带参数，其余无参。
  | "start"
  | "pause"
  | "resume"
  | "stop"
  | "setSpeed"
  | "setProcess";

/**
 * 原生图层句柄。
 *
 * 刻意**不复用** `LayerHandle`（品牌 `layer:<kind>`）：`LayerDriver` 会按品牌前缀解析 kind，
 * 两个 Facet 的句柄混用会得到「解析出未知种类」这种难以定位的失败。品牌 `native-layer:<kind>`
 * 让 `registry.resolve` 的所有权校验与 `LayerDriver` 的种类解析互不干扰。
 */
export type NativeLayerHandle = SdkHandle<"native-layer" | `native-layer:${string}`>;

/**
 * 传入 `setData` 的数据。
 *
 * GeoJSON `FeatureCollection`（点线面批量图层的标准输入）或单条 `Feature`（`TrackLine`）。
 * 结构交给 SDK 解析：本库**不做** GeoJSON 校验或坐标预处理——那属于 M6 的数据适配层。
 */
export type NativeLayerData = Record<string, unknown>;

/** 要素状态：`updateState` 的 `params`（如 `{ selected: true }`）。 */
export type NativeLayerFeatureState = Record<string, unknown>;

/**
 * 「业务 id → 要素状态」的映射（官方 `replaceAllState(inputs)` 的入参、`getAllState()` 的回包）。
 *
 * 键是业务 id（`idKey` 字段的值）的**字符串形式**：官方回包是普通对象，而 JS 的对象键只能是
 * 字符串 / Symbol——数字 id `1` 与字符串 id `"1"` 在 SDK 侧本来就是同一个槽位。
 */
export type NativeLayerFeatureStateMap = Record<string, NativeLayerFeatureState>;

/** 要素标识：业务 `idKey` 对应的值（单个或一批）。 */
export type NativeLayerFeatureKeys = string | number | ReadonlyArray<string | number>;

/** `hitTest()` 的主动命中结果。 */
export interface NativeLayerPick {
  /** 要素索引；**未命中是 -1**（官方口径：未命中也派发事件，值本身是真值） */
  dataIndex: number;
  dataItem: unknown;
}

/** `setZoomRange` 的入参（两端都可选，只改给到的那一端）。 */
export interface NativeLayerZoomRange {
  min?: number;
  max?: number;
}

export interface NativeLayerDriver {
  create(kind: NativeLayerKind, options?: Record<string, unknown>): NativeLayerHandle;

  /** 原生数据图层只能挂到 Map（与 `LayerDriver` 同源）。 */
  add(target: OverlayTarget, layer: NativeLayerHandle): void;
  remove(target: OverlayTarget, layer: NativeLayerHandle): void;

  /**
   * 该 kind 是否有这个操作的运行时入口。
   *
   * 元数据来自 Driver 的 `NATIVE_LAYER_DESCRIPTORS`，是「调用前先问一句」的唯一入口；
   * 直接调用不支持的操作会抛 `BMAP_CAPABILITY_UNSUPPORTED`。
   */
  supports(kind: NativeLayerKind, operation: NativeLayerOperation): boolean;

  setData(layer: NativeLayerHandle, data: NativeLayerData): void;
  clearData(layer: NativeLayerHandle): void;
  /** 合并样式（官方语义是 merge，不是替换） */
  setStyle(layer: NativeLayerHandle, style: Record<string, unknown>): void;

  setVisible(layer: NativeLayerHandle, visible: boolean): void;
  setOpacity(layer: NativeLayerHandle, opacity: number): void;
  /** 官方要求先 `map.addLayer` 再调层级方法（实现要访问已关联的 Map） */
  setZIndex(layer: NativeLayerHandle, zIndex: number): void;
  setZoomRange(layer: NativeLayerHandle, range: NativeLayerZoomRange): void;

  /**
   * 写入要素状态。
   *
   * `append` 为 false（默认）时**替换**这些 key 的既有状态，为 true 时合并（官方
   * `updateState(keys, params, ifAppend)` 的第三参数）。
   */
  updateState(
    layer: NativeLayerHandle,
    keys: NativeLayerFeatureKeys,
    state: NativeLayerFeatureState,
    append?: boolean,
  ): void;
  removeState(layer: NativeLayerHandle, keys: NativeLayerFeatureKeys): void;
  clearState(layer: NativeLayerHandle): void;

  /**
   * **全量替换**所有要素状态（官方 `replaceAllState(inputs)`）。
   *
   * 官方把「整批替换」单独开了一个入口，而不是让调用方先 `clearState()` 再逐批 `updateState()`：
   * 后者中间会出现「没有任何状态」的一帧，样式表达式会按空状态重算一次。语义上它是
   * `clearState + 一次性写入`，因此这里**不做**任何本地记账——状态的真值在 SDK 侧。
   */
  replaceState(layer: NativeLayerHandle, inputs: NativeLayerFeatureStateMap): void;

  /**
   * 读回**当前**要素状态（官方 `getAllState()`）。
   *
   * 刻意走 SDK 的公开读回而不是本库自己记账：状态会因为 `setData` 重新解析数据、
   * `replaceState`、以及 SDK 内部的默认值而变化，本地账本一定会与 SDK 分叉。返回的是
   * **键为业务 id 字符串**的普通对象（官方返回的就是 id → 状态的映射）。
   */
  getState(layer: NativeLayerHandle): NativeLayerFeatureStateMap;

  /** 开关鼠标拾取；官方要求构造时 `enablePicked` 才有拾取事件 */
  setEnablePicked(layer: NativeLayerHandle, enabled: boolean): void;
  /** 主动命中测试（像素 → 要素）；只有声明该入口的 kind 有实现 */
  hitTest(layer: NativeLayerHandle, pixel: Pixel): NativeLayerPick | null;

  /**
   * TrackLine 播放命令（#110；方法名均经 live 探针取证，不是从类型包猜的）。
   *
   * 只有 `track-line` kind 支持这六条；其它 kind 调用会显式抛 `BMAP_CAPABILITY_UNSUPPORTED`
   * （与其它操作同一口径，不静默 no-op）。参数校验（`setProcess` 必须在 0–1、`setSpeed` 必须 > 0）
   * 在 Driver 里前置于 SDK 调用：`BMAP_INVALID_ARGUMENT` 在打到 SDK 之前抛。
   */
  start(layer: NativeLayerHandle): void;
  pause(layer: NativeLayerHandle): void;
  resume(layer: NativeLayerHandle): void;
  stop(layer: NativeLayerHandle): void;
  /** 播放倍速：必须是有限正数（官方口径：正数，`setSpeed(0)` 语义未声明）。 */
  setSpeed(layer: NativeLayerHandle, speed: number): void;
  /** 进度 0–1（含端点）；越界抛 `BMAP_INVALID_ARGUMENT`，不静默 clamp。 */
  setProcess(layer: NativeLayerHandle, process: number): void;
}
