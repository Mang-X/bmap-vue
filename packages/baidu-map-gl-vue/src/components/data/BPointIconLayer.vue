<script setup lang="ts" generic="Item">
/**
 * BPointIconLayer —— 批量图标点（**单个** SDK 资源，M6-POINT-CLUSTER / issue #35）
 *
 * 落在官方 `BMap.PointIconLayer`（**两处都声明**：`@baidumap/jsapi-v4-types@4.0.4` 有完整类声明，
 * 官方 React 参考实现也有同名组件）。与 `BPointShapeLayer` 的区别只有「每个点画什么」：
 * 前者画几何图元（圆 / 方 / 五角星…），后者画一张图标。
 *
 * ## 与 `BPointShapeLayer` 的三处差异（其余全部共用 `useNativePointLayer`）
 *
 * 1. **样式字段不同**：这里是官方 `PointIconStyle` 的子集（`icon` / `width` / `height` /
 *    `anchors` / `offset` / `scale` / `rotation`），而不是 `shapeType` / `size` / `color` 那一组；
 * 2. **多两个构造期选项**：`isFlat`（是否贴地）与 `isFixed`（是否跟随缩放保持尺寸）——官方把它们
 *    写在 `PointIconLayerOptions` 上而不是 style 里，因为它们决定渲染通道 ⇒ 变化时**重建实例**；
 * 3. **图标是按 URL 异步加载的**：本库不接管它的加载状态（SDK 也没有公开「图标就绪」的事件）。
 *    因此「图标加载失败」在组件层不可观测——不要指望 `dataparsed` 代表图标已经可见。
 *
 * 其余（取数面、四条更新路径、释放顺序、拾取投影）与 `BPointShapeLayer` 逐条相同，差异表见
 * `core/data/pointLayerSpec.ts`。
 */
import { useNativePointLayer } from "../../core/composables/useNativePointLayer";
import { pointIconLayerProfile } from "../../core/data/pointLayerSpec";
import type { BMapPointPick, BPointIconLayerProps } from "../../types/components";

const props = withDefaults(defineProps<BPointIconLayerProps<Item>>(), {
  // 布尔 prop 必须给显式默认值（Vue 对 `Boolean` 有「缺省即 false」的转换）。
  visible: true,
  // 与 `BPointShapeLayer` 同一条口径：默认开拾取，否则「给了事件却点不出来」。
  enablePicked: true,
});

const emit = defineEmits<{
  /** 命中某个要素：载荷是**最新**的业务 item。 */
  "item-click": [item: Item];
  /** 图层级拾取（含未命中）：`hit` / 坐标 / 像素 / 解析到的业务项。 */
  click: [pick: BMapPointPick<Item>];
}>();

useNativePointLayer<Item, BPointIconLayerProps<Item>>({
  profile: pointIconLayerProfile<Item>(),
  props,
  emit: {
    itemClick: (item) => emit("item-click", item),
    click: (pick) => emit("click", pick),
  },
  watchSource: () => [
    props.data,
    props.dataVersion,
    props.properties,
    props.getPosition,
    props.itemKey,
    props.visible,
    props.opacity,
    props.zIndex,
    props.minZoom,
    props.maxZoom,
    props.icon,
    props.width,
    props.height,
    props.anchors,
    props.offset,
    props.scale,
    props.rotation,
    props.isFlat,
    props.isFixed,
    props.enablePicked,
    props.pickWidth,
    props.pickHeight,
  ],
});

defineOptions({ name: "BPointIconLayer" });
</script>

<template>
  <slot />
</template>
