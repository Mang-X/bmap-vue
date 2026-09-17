<script setup lang="ts">
/**
 * BTileLayer —— 自定义瓦片图层（官方 `BMap.TileLayer`，4.0）
 *
 * 加载**百度坐标系（BD09MC）**的自有瓦片：数据已经是 BD09MC 时用它；第三方标准瓦片服务
 * （XYZ / WMTS / WMS / TMS）请用 `BXYZLayer`（内置 EPSG:3857 → BD09MC 转换）。
 *
 * 行为依据（`@baidumap/jsapi-v4-types@4.0.4` 的 `TileLayer` / `TileLayerOptions`）：
 * - 构造选项里只有 `zIndex` 有字段级 setter（`setZIndex`），其余（`tileUrlTemplate` /
 *   `opacity` / `boundary` / …）**只有构造期生效**——改变它们会重建图层（旧实例先摘掉，
 *   因此不会有旧瓦片请求的影响残留）；
 * - `visible` 走挂载状态（`addLayer` / `removeLayer`）：官方 `TileLayer` 没有 `show/hide`。
 *
 * 第三方瓦片的可用性受 **CORS、坐标系与服务条款**约束：本库只负责接入，不保证源服务可用
 * （排障见文档站「图层总览」的 CORS 一节）。
 */
import { useLayerResource } from "../../core/composables/useLayerResource";
import { forwardCallback, pickLayerOptions } from "../../core/layers/LayerSpec";

export interface BTileLayerProps {
  /** 是否挂在地图上（`false` = 摘掉，不是 `hide()`）。 */
  visible?: boolean;
  /** 图层透明度，0 - 1。 */
  opacity?: number;
  /** 图层层叠顺序。 */
  zIndex?: number;
  /** 图块 URL 模板，支持 `{X}` / `{Y}` / `{Z}`。不给则需要 `getTilesUrl`（本库不暴露）。 */
  tileUrlTemplate?: string;
  /** 图块是否为含透明信息的 PNG。 */
  transparentPng?: boolean;
  /** 图层掩膜边界（行政区名或坐标串）。 */
  boundary?: string | string[];
  /** 掩膜显示区域模式：`'inside'` / `'outside'`。 */
  showRegion?: string;
  /** 瓦片加载失败时是否自动重试。 */
  retry?: boolean;
  /** 重试间隔（毫秒）。 */
  retryTime?: number;
  /** 瓦片缓存数量。 */
  cacheSize?: number;
  /** 自定义瓦片加载函数。 */
  tileLoadFunction?: (tile: HTMLImageElement, url: string) => void;
}

const props = withDefaults(defineProps<BTileLayerProps>(), {
  // 布尔 option 显式写 `undefined`：绕开 Vue「缺省即 false」的 props 转换，
  // 让「没传」= 「不表态」（理由与代价见 ADR 2026-09-17 决策 5）。
  visible: true,
  transparentPng: undefined,
  retry: undefined,
});

useLayerResource<BTileLayerProps>(props, {
  component: "BTileLayer",
  toSpec: (p) => ({
    kind: "tile",
    visible: p.visible,
    opacity: p.opacity,
    zIndex: p.zIndex,
    options: {
      // 回调型 option 经 `forwardCallback` 包一层：SDK 手上的函数**转发到当前 prop**，
      // 因此「换一个回调」立即生效，而内联箭头函数也不会触发重建（见 `LayerSpec` 的说明）。
      tileLoadFunction: forwardCallback(() => p.tileLoadFunction),
      ...pickLayerOptions(p, [
        "tileUrlTemplate",
        "transparentPng",
        "boundary",
        "showRegion",
        "retry",
        "retryTime",
        "cacheSize",
      ]),
    },
  }),
});

defineOptions({ name: "BTileLayer" });
</script>

<template>
  <slot />
</template>
