<script setup lang="ts" generic="Item">
/**
 * BPointShapeLayer —— 批量点（**单个** SDK 资源，M6-POINT-CLUSTER / issue #35）
 *
 * 落在官方 `BMap.PointShapeLayer`（**两处都声明**的批量点能力）：`setData(FeatureCollection)`
 * 一次性交付，渲染在 SDK 内部完成。逐项建 Marker 的成本随数据量线性增长（每个 marker 都是
 * DOM/WebGL 对象 + 监听器），这正是本组件存在的理由——验收标准「资源数量证明不是逐点 Marker」
 * 由用例断言（`harness.attached('overlay') === 0` 且原生图层恰好 1 个）。
 *
 * ## 名字的来历（issue #35 更名）
 *
 * #34 把它叫 `BPointCollection`。改名是因为 #35 补齐了同一族的另外两个组件
 * （`BPointIconLayer` / `BPointLayer`），三个名字必须能一眼看出**各自落在哪个 SDK 类**上，
 * 而官方的类名就是 `PointShapeLayer` / `PointIconLayer` / `PointLayer`（官方 React 参考实现
 * `huiyan-fe/react-bmap` 也只暴露前两个、且同名）。「Collection」既不是 SDK 的名字，也没有
 * 表达出「这是形状点」这个唯一重要的差异。改名不发生破坏性影响：`3.0.0-beta.0` 里**没有**
 * `BPointCollection`（它是未发布 changeset 里的新增），因此**不留弃用别名**——留一个零消费者的
 * 别名等于把「同一件事两个名字」固定进公开面。
 *
 * ## 数据面（与另外两个点图层组件完全一致）
 *
 * `data` + `itemKey` + `getPosition` + `dataVersion` + `properties` / `visible`；生命周期
 * （创建 / 挂载 / 逐字段写入 / 数据交付 / 拾取投影 / 释放）实现在 `useNativePointLayer` 里，
 * 与 `BPointIconLayer` / `BPointLayer` **共用同一份**（见 `core/data/pointLayerSpec.ts` 的差异表）。
 *
 * ## 更新语义（四条路径，逐条对应官方入口）
 *
 * | 变化 | 路径 | 依据（官方 4.0.4 声明） |
 * | --- | --- | --- |
 * | `data` / `dataVersion` / `properties` | `setData()`，**不重建** | `PointShapeLayer#setData` |
 * | `shape` / `size` / `color` / `strokeColor` / `strokeWeight` | `setStyleOptions + doOnceDraw`（Driver 的 `setStyle`），**不重建** | 官方明确「修改后需 `doOnceDraw()` 才可见」 |
 * | `visible` / `opacity` / `zIndex` / `minZoom` / `maxZoom` | 字段级 setter，**不重建** | `setVisible` / `setOpacity` / `setZIndex` / `setMinZoom` / `setMaxZoom` |
 * | `itemKey`（⇒ `idKey`）/ `enablePicked` / `pickWidth` / `pickHeight` | **重建实例** | 它们是构造选项；官方只有 `setBaseOptions`（整袋、且需 `doOnceDraw`）。「改了就换实例」比「写进去但画面不变」诚实 |
 *
 * 两处刻意的取舍：
 *
 * - **`visible` 走 `setVisible(false)`，不是「摘掉图层」**：官方在原生数据图层上**有**这个 setter，
 *   而且 #98 的 live 实测显示 `removeLayer` 之后的实例**再也渲染不了**（只能换新实例）。
 * - **重建必须「先摘成功、再建新的」**：`removeLayer` 失败时保留旧实例并交出 `resource:error`，
 *   否则新旧两份会同时挂在图上（同一实例 `addLayer` 不去重）。
 */
import { useNativePointLayer } from "../../core/composables/useNativePointLayer";
import { pointShapeLayerProfile } from "../../core/data/pointLayerSpec";
import type { BMapPointPick, BPointShapeLayerProps } from "../../types/components";

const props = withDefaults(defineProps<BPointShapeLayerProps<Item>>(), {
  // 布尔 prop 必须给显式默认值：Vue 对 `Boolean` 有「缺省即 false」的转换。
  visible: true,
  // 与官方默认值（false）**不同**，刻意如此：本组件的核心交互是 `item-click`，
  // 默认关掉拾取等于「给了事件但点不出来」。要省开销时显式传 `false`。
  enablePicked: true,
});

const emit = defineEmits<{
  /** 命中某个要素：载荷是**最新**的业务 item。 */
  "item-click": [item: Item];
  /** 图层级拾取（含未命中）：`hit` / 坐标 / 像素 / 解析到的业务项。 */
  click: [pick: BMapPointPick<Item>];
}>();

useNativePointLayer<Item, BPointShapeLayerProps<Item>>({
  profile: pointShapeLayerProfile<Item>(),
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
    props.shape,
    props.size,
    props.color,
    props.strokeColor,
    props.strokeWeight,
    props.enablePicked,
    props.pickWidth,
    props.pickHeight,
  ],
});

defineOptions({ name: "BPointShapeLayer" });
</script>

<template>
  <slot />
</template>
