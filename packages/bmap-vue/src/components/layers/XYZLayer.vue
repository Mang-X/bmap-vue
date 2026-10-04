<script setup lang="ts">
/**
 * XYZLayer —— 第三方标准瓦片图层（官方 `BMap.XYZLayer`，4.0）
 *
 * 与 `TileLayer` 的区别（官方原文）：`TileLayer` 用于**已是百度坐标系（BD09MC）**的自有
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

export interface XYZLayerProps {
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

const props = withDefaults(defineProps<XYZLayerProps>(), {
  // 布尔 option 显式写 `undefined`：绕开 Vue「缺省即 false」的 props 转换，
  // 让「没传」= 「不表态」（理由与代价见 ADR 2026-09-17 决策 5）。
  visible: true,
  extentCRSIsWGS84: undefined,
  useThumbData: undefined,
  tms: undefined,
});

useLayerResource<XYZLayerProps>(props, {
  component: "XYZLayer",
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

/**
 * 插槽契约（#188）。
 *
 * `defineSlots` 在这里不是可选的文档，而是**发布声明能否成立的前提**：不写它时
 * `vue-tsc` 会把插槽载荷 emit 成模块局部的 `declare var __VLS_1: {}`，
 * 而声明打包阶段（API Extractor rollup）只保留导出面可达的符号，那条 `var`
 * 会连同它的声明一起消失，留下一个对 `__VLS_1` 的 `typeof` **悬空引用** ——
 * 消费方开 `skipLibCheck: false` 立刻报 `TS2304`。
 * 写了它之后 Volar 把载荷**内联**进 `__VLS_Slots`，全程没有中间 `var`。
 * 详见 `components/map/Map.vue` 里同段注释（根因与实验记录都在那里）。
 *
 * 载荷是**空对象类型**而不是 `any`：本组件的内容插槽不传任何东西，
 * 写成 `any` 等于把插槽类型面放宽成「无推导」。
 *
 * 刻意用 `Record<never, never>` 而不是更常见的 `Record<string, never>`（#188 评审 P1）：
 * 后者带**字符串索引签名**，于是消费方写错插槽 prop 时 `const { typo } = props`
 * **不报错**（`typo` 只是 `never`，而 `never` 又可赋给任何目标），错误成员静默通过 ——
 * 与 #188 要恢复的「错误成员有预期诊断」正好相反。实测见
 * `fixtures/consumer/strict/probe.ts` 里的 `HasStringIndex` 判据。`Record<never, never>` 与 `{}`
 * 同样没有索引签名，`typo` 会真的报 `TS2339`；两者都是合法的 `defineSlots` 载荷。
 * 可选签名（`default?`）保持插槽可省略 —— 消费方不传内容插槽是合法的。
 */
defineSlots<{
  default?(props: Record<never, never>): any;
}>();
defineOptions({ name: "XYZLayer" });
</script>

<template>
  <slot />
</template>
