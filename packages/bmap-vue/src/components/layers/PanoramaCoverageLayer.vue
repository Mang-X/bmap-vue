<script setup lang="ts">
/**
 * PanoramaCoverageLayer —— 全景覆盖图层（官方 `BMap.PanoramaCoverageLayer`，4.0）
 *
 * 4.0.4 的类型包**没有** `PanoramaCoverageLayer` 的类声明（官方 Skill 明确它是 4.0 公开
 * 图层），因此 Driver 按结构探测构造器：运行时没有它时报 `BMAP_CAPABILITY_UNSUPPORTED`
 * 并告警一次，而不是静默降级成一个空图层。
 *
 * 行为依据：
 * - 该图层没有可核对的 `Options` 声明，因此本组件**不声明**构造选项 props（否则就是
 *   「传了被忽略」的假支持）；统一槽位里只有 `visible` 有确定语义（挂上 / 摘掉）；
 * - 单独使用它是看不到全景的，要用 `<PanoramaControl>` 打开全景入口。
 */
import { useLayerResource } from "../../core/composables/useLayerResource";

export interface PanoramaCoverageLayerProps {
  /** 是否挂在地图上（`false` = 摘掉）。 */
  visible?: boolean;
}

const props = withDefaults(defineProps<PanoramaCoverageLayerProps>(), { visible: true });

useLayerResource<PanoramaCoverageLayerProps>(props, {
  component: "PanoramaCoverageLayer",
  toSpec: (p) => ({ kind: "panorama-coverage", visible: p.visible }),
});

defineOptions({ name: "PanoramaCoverageLayer" });
</script>

<template>
  <slot />
</template>
