<script setup lang="ts" generic="Item">
/**
 * BPointLayer —— 批量点（扩展 API `BMap.PointLayer`，M6-POINT-CLUSTER / issue #35）
 *
 * ⚠️ 它是三个点图层组件里唯一**两端不对等**的那个：`BMap.PointLayer` 在 4.0 **运行时存在**，
 * 但 `@baidumap/jsapi-v4-types@4.0.4` **没有类声明**（同族还有 `ClusterLayer` / `Heatmap` /
 * `TrackLine`），而且官方明确「可视化实现是**异步注入**的」。三条后果都落在使用方式上：
 *
 * 1. **能力守卫在「调用时刻」求值**：注入完成之前创建会显式失败
 *    （`BMAP_CAPABILITY_UNSUPPORTED`）；注入完成之后**同一个组件**再重试即可成功
 *    （Driver 不在构造期冻结这个结论）。失败经 `resource:error` 交出，不静默。
 * 2. **不自动改用别的类**：`PointShapeLayer` / `PointIconLayer` 是另外两个 SDK 能力，
 *    偷偷换掉等于把调用方的意图改掉（那正是本库用 `unsupported` 而不是「智能降级」的原因）。
 * 3. **选项是扁平的**（官方专页的例子：`new BMap.PointLayer({ shape, size, fillColor })`），
 *    与 `BPointShapeLayer` 的 `style` 袋不同。本组件如实照抄这个形状。
 *
 * ## 它和另外两个组件的取舍：什么时候选它
 *
 * | 想要 | 用 |
 * | --- | --- |
 * | 只要形状点 / 只要图标点 | `BPointShapeLayer` / `BPointIconLayer`（**两端都有声明**，最稳） |
 * | 同一个图层里「有图标就用图标、没有就画几何图形」 | 本组件（`icon` 未配置时按 `shape` 绘制） |
 *
 * 换句话说：它的增量是**一个组件覆盖两种模式**，代价是它依赖一个未声明的扩展 API。
 * 官方 React 参考实现（`huiyan-fe/react-bmap`）**没有**暴露这个类，只暴露了前两个 ——
 * 本库保留它是因为官方扩展专页把它列为公开能力且本库取过证（见 ADR），不是因为「多一个更好」。
 *
 * ## 拾取载荷与另外两个**不同**（实测）
 *
 * `PointLayer` 的命中载荷是 `{ lng, lat, size, scale, offset, id, index, properties, feature }`——
 * **没有** `dataIndex` / `dataItem`，业务键在 `value.properties[idKey]` 上；因此
 * `click.dataIndex` 多数情况下是 `-1`（拿不到下标就如实给 `-1`，不编一个）。未命中载荷的形状
 * **尚未取证**，所以「命中」的判据是「能不能解析出业务身份」，这条限制登记在 ADR 的已知限制里。
 *
 * 其余（四条更新路径、释放顺序、失败不推进记账）与 `BPointShapeLayer` 逐条相同。
 */
import { useNativePointLayer } from "../../core/composables/useNativePointLayer";
import { pointLayerProfile } from "../../core/data/pointLayerSpec";
import type { BMapPointPick, BPointLayerProps } from "../../types/components";

const props = withDefaults(defineProps<BPointLayerProps<Item>>(), {
  // 布尔 prop 必须给显式默认值（Vue 对 `Boolean` 有「缺省即 false」的转换）。
  visible: true,
  // 与另外两个点图层组件同一条口径：默认开拾取。
  enablePicked: true,
});

const emit = defineEmits<{
  /** 命中某个要素：载荷是**最新**的业务 item。 */
  "item-click": [item: Item];
  /** 图层级拾取：`hit` / 坐标 / 像素 / 解析到的业务项（`dataIndex` 见文件头）。 */
  click: [pick: BMapPointPick<Item>];
}>();

useNativePointLayer<Item, BPointLayerProps<Item>>({
  profile: pointLayerProfile<Item>(),
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
    props.shape,
    props.icon,
    props.size,
    props.fillColor,
    props.fillOpacity,
    props.strokeColor,
    props.strokeWeight,
    props.scale,
    props.rotation,
    props.offset,
    props.anchor,
    props.enablePicked,
    props.pickWidth,
    props.pickHeight,
  ],
});

defineOptions({ name: "BPointLayer" });
</script>

<template>
  <slot />
</template>
