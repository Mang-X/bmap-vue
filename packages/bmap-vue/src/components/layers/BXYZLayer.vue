<script setup lang="ts">
/**
 * BXYZLayer —— 第三方标准瓦片图层（官方 `BMap.XYZLayer`，4.0）
 *
 * 与 `BTileLayer` 的区别（官方原文）：`TileLayer` 用于**已是百度坐标系（BD09MC）**的自有
 * 瓦片；`XYZLayer` 面向第三方标准服务（XYZ / WMTS / WMS / TMS），内置
 * **EPSG:3857 → BD09MC** 坐标转换，并提供 `minZoom` / `maxZoom` / `extent` 范围控制。
 *
 * 行为依据（`XYZLayer` / `XYZLayerOptions`）：
 * - 只有 `zIndex` 有字段级 setter；`tileUrlTemplate` / `extent` / `tms` 等都是构造期选项，
 *   变化时重建图层；
 * - 官方有 `show` / `hide` / `isVisible`，但本库的**显隐统一表达为挂载状态**
 *   （所有 kind 一致，不会出现「两种显隐机制」）；
 * - 模板占位符是 `[z]` / `[x]` / `[y]`（方括号，**不是** `{z}`），并可用 `xTemplate` 一类
 *   回调计算；多请求地址用 `{0,1,2}` 标记。写错占位符的表现是「瓦片全 404 但图层挂得好好的」，
 *   排障见文档站「图层总览」。
 *
 * 第三方瓦片的可用性受 **CORS、坐标系与服务条款**约束：本库只负责接入，不保证源服务可用。
 */
import { useLayerResource } from "../../core/composables/useLayerResource";
import { forwardCallback, pickLayerOptions } from "../../core/layers/LayerSpec";

export interface BXYZLayerProps {
  visible?: boolean;
  opacity?: number;
  minZoom?: number;
  maxZoom?: number;
  zIndex?: number;
  /** 服务地址模板；`[z]` / `[x]` / `[y]` / `[b]` 为占位符，`{0,1,2}` 标记多请求地址。 */
  tileUrlTemplate?: string;
  /** 计算 `[x]` 的具体取值（入参是 Google web 墨卡托网格列号 / 行号 / 缩放级别）。 */
  xTemplate?: (x: number, y: number, z: number) => number | string;
  /** 计算 `[y]` 的具体取值。 */
  yTemplate?: (x: number, y: number, z: number) => number | string;
  /** 计算 `[z]` 的具体取值。 */
  zTemplate?: (x: number, y: number, z: number) => number | string;
  /** 计算 `[b]` 的具体取值，默认是四至坐标串 `'minX,minY,maxX,maxY'`。 */
  bTemplate?: (x: number, y: number, z: number) => string;
  /** 图层加载数据的四至范围（EPSG:3857 坐标 `[minX,minY,maxX,maxY]`）。 */
  extent?: number[];
  /** `extent` 是否为 EPSG:4326 坐标。 */
  extentCRSIsWGS84?: boolean;
  /** 掩膜（行政区坐标数据）。 */
  boundary?: string[];
  /** 缩放时是否用跨图层瓦片做平滑切换。 */
  useThumbData?: boolean;
  /** `tileUrlTemplate` 的 `[y]` 是否为 TMS 形式（y 轴翻转）。 */
  tms?: boolean;
}

const props = withDefaults(defineProps<BXYZLayerProps>(), {
  // 布尔 option 显式写 `undefined`：绕开 Vue「缺省即 false」的 props 转换，
  // 让「没传」= 「不表态」（理由与代价见 ADR 2026-09-17 决策 5）。
  visible: true,
  extentCRSIsWGS84: undefined,
  useThumbData: undefined,
  tms: undefined,
});

useLayerResource<BXYZLayerProps>(props, {
  component: "BXYZLayer",
  toSpec: (p) => ({
    kind: "xyz",
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
      bTemplate: forwardCallback(() => p.bTemplate),
      ...pickLayerOptions(p, [
        "tileUrlTemplate",
        "extent",
        "extentCRSIsWGS84",
        "boundary",
        "useThumbData",
        "tms",
      ]),
    },
  }),
});

defineOptions({ name: "BXYZLayer" });
</script>

<template>
  <slot />
</template>
