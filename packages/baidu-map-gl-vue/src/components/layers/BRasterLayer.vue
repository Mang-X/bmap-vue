<script setup lang="ts">
/**
 * BRasterLayer —— 栅格瓦片图层（官方 `BMap.RasterTileLayer`，4.0）
 *
 * 面向 XYZ / TMS 类标准瓦片服务，比 `BXYZLayer` 多了**子域轮询**（`{s}` + `subdomains`）、
 * **TMS 翻转**（`{-y}`）、**四至裁剪**（`bounds` + `boundsInWGS84`）与跨级别复用。
 *
 * 行为依据（`RasterTileLayer` / `RasterTileLayerOptions`）：
 * - `url` 可以是模板串，也可以是 `(x, y, z) => string` 回调；
 * - 只有 `zIndex` 有字段级 setter，其余选项都是构造期 ⇒ 变化时重建图层；
 * - 模板占位符是 `{z}` / `{x}` / `{y}`（花括号），与 `BXYZLayer` 的 `[z]` / `[x]` / `[y]`
 *   不同；`{-y}` 表示 TMS 的 y 轴翻转；
 * - 显隐统一为挂载状态（官方没有 `show/hide`）。
 *
 * 第三方瓦片的可用性受 **CORS、坐标系与服务条款**约束：本库只负责接入，不保证源服务可用。
 */
import { useLayerResource } from "../../core/composables/useLayerResource";
import { pickLayerOptions } from "../../core/layers/LayerSpec";

export interface BRasterLayerProps {
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
  /** 自定义瓦片加载函数。 */
  tileLoadFunction?: (tile: HTMLImageElement, url: string) => void;
}

const props = withDefaults(defineProps<BRasterLayerProps>(), {
  // 布尔 option 显式写 `undefined`：绕开 Vue「缺省即 false」的 props 转换，
  // 让「没传」= 「不表态」（理由与代价见 ADR 2026-09-17 决策 5）。
  visible: true,
  boundsInWGS84: undefined,
  useThumbData: undefined,
  retry: undefined,
});

useLayerResource<BRasterLayerProps>(props, {
  component: "BRasterLayer",
  toSpec: (p) => ({
    kind: "raster",
    visible: p.visible,
    opacity: p.opacity,
    minZoom: p.minZoom,
    maxZoom: p.maxZoom,
    zIndex: p.zIndex,
    options: pickLayerOptions(p, [
      "url",
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
      "tileLoadFunction",
    ]),
  }),
});

defineOptions({ name: "BRasterLayer" });
</script>

<template>
  <slot />
</template>
