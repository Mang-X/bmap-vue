<script setup lang="ts">
/**
 * WMTSLayer —— WMTS 标准瓦片服务图层（官方 `BMap.WMTSLayer`，4.0）
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
import {
  createTileLoadFunction,
  type TileLoadObserver,
} from "./tileLoadObserver";

export interface WMTSLayerProps {
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

const props = withDefaults(defineProps<WMTSLayerProps>(), {
  // 布尔 option 显式写 `undefined`：绕开 Vue「缺省即 false」的 props 转换，
  // 让「没传」= 「不表态」（理由与代价见 ADR 2026-09-17 决策 5）。
  visible: true,
  extentCRSIsWGS84: undefined,
  useThumbData: undefined,
  reproject: undefined,
  png8: undefined,
  retry: undefined,
});

useLayerResource<WMTSLayerProps>(props, {
  component: "WMTSLayer",
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
      // 瓦片加载：官方 `tileLoadFunction` 是接管式的（实测），因此本库把「观察」与「加载」合成
      // 一个包装——给了观察者就由本库完成默认加载，给了 `tileLoadFunction` 就交给它接管。
      // 两者都没给时这个 option 是 `undefined`（本库不表态，SDK 走自己的默认路径）。
      tileLoadFunction: createTileLoadFunction(() => ({
        observer: p.tileLoadObserver,
        takeover: p.tileLoadFunction,
      })),
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
 * 可选签名（`default?`）保持插槽可省略 —— 消费方不传内容插槽是合法的。
 */
defineSlots<{
  default?(props: Record<string, never>): any;
}>();
defineOptions({ name: "WMTSLayer" });
</script>

<template>
  <slot />
</template>
