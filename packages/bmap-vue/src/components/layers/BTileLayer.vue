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
import { pickLayerOptions } from "../../core/layers/LayerSpec";
import {
  createTileLoadFunction,
  type TileLoadObserver,
} from "./tileLoadObserver";

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
      // 瓦片加载：官方 `tileLoadFunction` 是接管式的（实测），因此本库把「观察」与「加载」合成
      // 一个包装——给了观察者就由本库完成默认加载，给了 `tileLoadFunction` 就交给它接管。
      // 两者都没给时这个 option 是 `undefined`（本库不表态，SDK 走自己的默认路径）。
      tileLoadFunction: createTileLoadFunction(() => ({
        observer: p.tileLoadObserver,
        takeover: p.tileLoadFunction,
      })),
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
