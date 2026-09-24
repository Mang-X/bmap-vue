<script setup lang="ts">
/**
 * RasterTileLayer —— 栅格瓦片图层（官方 `BMap.RasterTileLayer`，4.0）
 *
 * 面向 XYZ / TMS 类标准瓦片服务，比 `XYZLayer` 多了**子域轮询**（`{s}` + `subdomains`）、
 * **TMS 翻转**（`{-y}`）、**四至裁剪**（`bounds` + `boundsInWGS84`）与跨级别复用。
 *
 * 行为依据（`RasterTileLayer` / `RasterTileLayerOptions`）：
 * - `url` 可以是模板串，也可以是 `(x, y, z) => string` 回调；
 * - 只有 `zIndex` 有字段级 setter，其余选项都是构造期 ⇒ 变化时重建图层；
 * - 模板占位符是 `{z}` / `{x}` / `{y}`（花括号），与 `XYZLayer` 的 `[z]` / `[x]` / `[y]`
 *   不同；`{-y}` 表示 TMS 的 y 轴翻转；
 * - 显隐统一为挂载状态（官方没有 `show/hide`）。
 *
 * 第三方瓦片的可用性受 **CORS、坐标系与服务条款**约束：本库只负责接入，不保证源服务可用。
 */
import { useLayerResource } from "../../core/composables/useLayerResource";
import { forwardCallback, pickLayerOptions } from "../../core/layers/LayerSpec";
import {
  createTileLoadFunction,
  type TileLoadObserver,
} from "./tileLoadObserver";

export interface RasterTileLayerProps {
  visible?: boolean;
  opacity?: number;
  minZoom?: number;
  maxZoom?: number;
  zIndex?: number;
  /** 瓦片地址模板（`{z}` / `{x}` / `{y}` / `{s}` / `{-y}`）或 `(x, y, z) => string` 回调。 */
  url: string | ((x: number, y: number, z: number) => string);
  /** 子域轮询候选（与模板里的 `{s}` 配合）。 */
  subdomains?: string[];
  /** 请求使用的投影。 */
  projection?: string;
  /** 加载数据的四至范围 `[minX, minY, maxX, maxY]`。 */
  bounds?: number[];
  /** `bounds` 是否为 WGS84 坐标。 */
  boundsInWGS84?: boolean;
  /** 缩略图层级跨度。 */
  spanLevel?: number;
  /** 缩放时是否用跨图层瓦片做平滑切换。 */
  useThumbData?: boolean;
  /** 掩膜（行政区名或坐标串）。 */
  boundary?: string | string[];
  /** 瓦片显示区域模式：`'inside'` / `'outside'`。 */
  showRegion?: "inside" | "outside";
  /** 图层高度。 */
  height?: number;
  /** 瓦片加载失败时是否自动重试。 */
  retry?: boolean;
  /** 重试间隔（毫秒）。 */
  retryTime?: number;
  /** 瓦片缓存数量。 */
  cacheSize?: number;
  /**
   * 自定义瓦片加载函数（官方 `tileLoadFunction`）。
   *
   * ⚠️ 它是**接管式**的（真实 4.0 实测：设了它，SDK 就不再自己加载）——所以函数必须自己完成加载
   * （通常是 `tile.src = url`），否则**瓦片不会出现**。只想在旁边观察请用 `tileLoadObserver`。
   */
  tileLoadFunction?: (tile: HTMLImageElement, url: string) => void;
  /**
   * 瓦片加载**观察面**（issue #97）：给它就能知道「SDK 什么时候要求加载哪张瓦片」以及
   * 「它加载成功还是失败」，而**不需要自己接管加载**（本库在内部完成默认加载）。
   *
   * 依据：官方这批网络图层的类声明里没有任何事件成员，live 探针在真实 4.0 上确认十个候选事件名
   * 一个都不触发（在请求确实发生过的前提下），因此唯一可用的观察点就是 `tileLoadFunction`。
   *
   * 与 `tileLoadFunction` 同时给时：本库只在旁边观察，加载完全由你的函数负责。
   */
  tileLoadObserver?: TileLoadObserver;
}

const props = withDefaults(defineProps<RasterTileLayerProps>(), {
  // 布尔 option 显式写 `undefined`：绕开 Vue「缺省即 false」的 props 转换，
  // 让「没传」= 「不表态」（理由与代价见 ADR 2026-09-17 决策 5）。
  visible: true,
  boundsInWGS84: undefined,
  useThumbData: undefined,
  retry: undefined,
});

useLayerResource<RasterTileLayerProps>(props, {
  component: "RasterTileLayer",
  toSpec: (p) => ({
    kind: "raster",
    visible: p.visible,
    opacity: p.opacity,
    minZoom: p.minZoom,
    maxZoom: p.maxZoom,
    zIndex: p.zIndex,
    options: {
      // 回调型 option 经 `forwardCallback` 包一层：SDK 手上的函数**转发到当前 prop**，
      // 因此「换一个回调」立即生效，而内联箭头函数也不会触发重建（见 `LayerSpec` 的说明）。
      url: forwardCallback(() => p.url),
      // 瓦片加载：官方 `tileLoadFunction` 是接管式的（实测），因此本库把「观察」与「加载」合成
      // 一个包装——给了观察者就由本库完成默认加载，给了 `tileLoadFunction` 就交给它接管。
      // 两者都没给时这个 option 是 `undefined`（本库不表态，SDK 走自己的默认路径）。
      tileLoadFunction: createTileLoadFunction(() => ({
        observer: p.tileLoadObserver,
        takeover: p.tileLoadFunction,
      })),
      ...pickLayerOptions(p, [
        "subdomains",
        "projection",
        "bounds",
        "boundsInWGS84",
        "spanLevel",
        "useThumbData",
        "boundary",
        "showRegion",
        "height",
        "retry",
        "retryTime",
        "cacheSize",
      ]),
    },
  }),
});

defineOptions({ name: "RasterTileLayer" });
</script>

<template>
  <slot />
</template>
