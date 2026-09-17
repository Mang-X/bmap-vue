<script setup lang="ts">
/**
 * BWMSLayer —— WMS 瓦片服务图层（官方 `BMap.WMSLayer`，4.0）
 *
 * 官方在内部拼接 WMS 标准请求参数（`SERVICE` / `REQUEST` / `VERSION` / `FORMAT` / `CRS`…），
 * 并用 `BBOX` / `WIDTH` / `HEIGHT` 驱动瓦片请求；调用方只需要 `url` + `params`（至少要给
 * `LAYERS`）。
 *
 * 行为依据（`WMSLayer` / `WMSLayerOptions`）：
 * - 只有 `zIndex` 有字段级 setter，其余选项（含 `url` / `params` / `projection` / `extent`）
 *   都是构造期选项 ⇒ 变化时重建图层（旧实例先摘掉，旧瓦片请求不会影响新实例）；
 * - `extentCRSIsWGS84` 决定 `extent` 的坐标系口径，`reproject` / `reprojectSourceCRS` 决定
 *   是否在客户端做投影变换——**不给 `reproject` 时服务返回的坐标系必须与地图一致**，
 *   否则表现为「瓦片偏移/错位」而不是报错；
 * - 显隐统一为挂载状态（官方没有 `show/hide`）。
 *
 * 第三方服务的可用性受 **CORS、坐标系与服务条款**约束：本库只负责接入，不保证源服务可用。
 */
import { useLayerResource } from "../../core/composables/useLayerResource";
import { pickLayerOptions } from "../../core/layers/LayerSpec";

export interface BWMSLayerProps {
  visible?: boolean;
  opacity?: number;
  minZoom?: number;
  maxZoom?: number;
  zIndex?: number;
  /** 服务地址（WMS 端点，例：`https://yourhost/geoserver/wms`）。 */
  url: string;
  /** WMS 请求参数，至少要有 `LAYERS`（例：`{ LAYERS: 'workspace:layer', VERSION: '1.1.1' }`）。 */
  params?: Record<string, string>;
  /** 请求使用的投影。 */
  projection?: string;
  /** 瓦片边长（像素），例：512。 */
  tileSize?: number;
  /** 数据四至范围。 */
  extent?: number[];
  /** `extent` 是否为 EPSG:4326 坐标。 */
  extentCRSIsWGS84?: boolean;
  /** 缩放时是否用跨图层瓦片做平滑切换。 */
  useThumbData?: boolean;
  /** 缩略图层级跨度。 */
  spanLevel?: number;
  /** 是否在客户端做投影变换。 */
  reproject?: boolean;
  /** `reproject` 时源数据的坐标系。 */
  reprojectSourceCRS?: string;
  /** 是否请求 8 位 PNG。 */
  png8?: boolean;
  /** 图层高度。 */
  height?: number;
  /** 瓦片加载失败时是否自动重试。 */
  retry?: boolean;
  /** 重试间隔（毫秒）。 */
  retryTime?: number;
  /** 返回数据格式。 */
  dataType?: string;
  /** 瓦片缓存数量。 */
  cacheSize?: number;
  /** 掩膜（行政区列表）。 */
  boundary?: string[];
  /** 父级缩略图深度。 */
  thumbParentDepth?: number;
  /** 子级缩略图深度。 */
  thumbChildDepth?: number;
  /** 自定义瓦片加载函数。 */
  tileLoadFunction?: (tile: HTMLImageElement, url: string) => void;
}

const props = withDefaults(defineProps<BWMSLayerProps>(), {
  // 布尔 option 显式写 `undefined`：绕开 Vue「缺省即 false」的 props 转换，
  // 让「没传」= 「不表态」（理由与代价见 ADR 2026-09-17 决策 5）。
  visible: true,
  extentCRSIsWGS84: undefined,
  useThumbData: undefined,
  reproject: undefined,
  png8: undefined,
  retry: undefined,
});

useLayerResource<BWMSLayerProps>(props, {
  component: "BWMSLayer",
  toSpec: (p) => ({
    kind: "wms",
    visible: p.visible,
    opacity: p.opacity,
    minZoom: p.minZoom,
    maxZoom: p.maxZoom,
    zIndex: p.zIndex,
    options: pickLayerOptions(p, [
      "url",
      "params",
      "projection",
      "tileSize",
      "extent",
      "extentCRSIsWGS84",
      "useThumbData",
      "spanLevel",
      "reproject",
      "reprojectSourceCRS",
      "png8",
      "height",
      "retry",
      "retryTime",
      "dataType",
      "cacheSize",
      "boundary",
      "thumbParentDepth",
      "thumbChildDepth",
      "tileLoadFunction",
    ]),
  }),
});

defineOptions({ name: "BWMSLayer" });
</script>

<template>
  <slot />
</template>
