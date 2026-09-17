<script setup lang="ts">
/**
 * BWMTSLayer —— WMTS 标准瓦片服务图层（官方 `BMap.WMTSLayer`，4.0）
 *
 * 官方在内部拼接 WMTS 标准请求参数（`Service` / `Request` / `Version` / `Format` /
 * `TileMatrixSet`…），调用方只需要 `url` + `params`（至少要给 `Layer` / `TileMatrixSet`）。
 *
 * 行为依据（`WMTSLayer` / `WMTSLayerOptions`）：
 * - 只有 `zIndex` 有字段级 setter，其余选项都是构造期 ⇒ 变化时重建图层；
 * - `params` 的大小写遵循 WMTS 标准（`Layer` / `Style` / `TileMatrixSet` / `Format`），
 *   与 WMS 的全大写（`LAYERS` / `STYLES`）**不同**——写错的表现通常是服务端 400 或空白瓦片；
 * - `transform` 与 `xTemplate` / `yTemplate` / `zTemplate` 用于自建瓦片矩阵映射；
 * - 显隐统一为挂载状态（官方没有 `show/hide`）。
 *
 * 第三方服务的可用性受 **CORS、坐标系与服务条款**约束：本库只负责接入，不保证源服务可用。
 */
import { useLayerResource } from "../../core/composables/useLayerResource";
import { forwardCallback, pickLayerOptions } from "../../core/layers/LayerSpec";

export interface BWMTSLayerProps {
  visible?: boolean;
  opacity?: number;
  minZoom?: number;
  maxZoom?: number;
  zIndex?: number;
  /** 服务地址（WMTS 端点）。 */
  url: string;
  /** WMTS 请求参数，例：`{ Layer: 'img', Style: 'default', TileMatrixSet: 'w', Format: 'tiles' }`。 */
  params?: Record<string, string>;
  /** 数据四至范围。 */
  extent?: number[];
  /** `extent` 是否为 EPSG:4326 坐标。 */
  extentCRSIsWGS84?: boolean;
  /** 源 / 目标坐标系映射。 */
  transform?: { source?: string; target?: string };
  /** 计算瓦片列号。 */
  xTemplate?: (x: number, y: number, z: number) => number | string;
  /** 计算瓦片行号。 */
  yTemplate?: (x: number, y: number, z: number) => number | string;
  /** 计算瓦片层级。 */
  zTemplate?: (x: number, y: number, z: number) => number | string;
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

const props = withDefaults(defineProps<BWMTSLayerProps>(), {
  // 布尔 option 显式写 `undefined`：绕开 Vue「缺省即 false」的 props 转换，
  // 让「没传」= 「不表态」（理由与代价见 ADR 2026-09-17 决策 5）。
  visible: true,
  extentCRSIsWGS84: undefined,
  useThumbData: undefined,
  reproject: undefined,
  png8: undefined,
  retry: undefined,
});

useLayerResource<BWMTSLayerProps>(props, {
  component: "BWMTSLayer",
  toSpec: (p) => ({
    kind: "wmts",
    visible: p.visible,
    opacity: p.opacity,
    minZoom: p.minZoom,
    maxZoom: p.maxZoom,
    zIndex: p.zIndex,
    options: {
      // 回调型 option 经 `forwardCallback` 包一层：SDK 手上的函数**转发到当前 prop**，
      // 因此「换一个回调」立即生效，而内联箭头函数也不会触发重建（见 `LayerSpec` 的说明）。
      xTemplate: forwardCallback(() => p.xTemplate),
      yTemplate: forwardCallback(() => p.yTemplate),
      zTemplate: forwardCallback(() => p.zTemplate),
      tileLoadFunction: forwardCallback(() => p.tileLoadFunction),
      ...pickLayerOptions(p, [
        "url",
        "params",
        "extent",
        "extentCRSIsWGS84",
        "transform",
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
      ]),
    },
  }),
});

defineOptions({ name: "BWMTSLayer" });
</script>

<template>
  <slot />
</template>
