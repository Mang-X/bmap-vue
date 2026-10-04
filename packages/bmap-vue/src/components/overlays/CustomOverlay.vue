<script setup lang="ts">
/**
 * CustomOverlay —— 自定义 DOM 覆盖物（M5-CUSTOM-MENU / issue #33）
 *
 * 组件只做三件事：**声明 spec**（`./customOverlaySpec.ts`）+ **渲染 slot 到 detached 宿主** +
 * 拥有宿主。实例生命周期、字段更新、事件绑定全在 `useCustomOverlay` / `useOverlaySpec` 里。
 *
 * ```vue
 * <CustomOverlay :position="{ lng: 116.404, lat: 39.915 }" :offset="{ x: 0, y: -12 }" @click="onClick">
 *   <div class="my-card">自定义内容</div>
 * </CustomOverlay>
 * ```
 *
 * ## 宿主与 slot 的所有权
 *
 * SDK 拿到的是一个**我们创建的 detached `<div>`**，并把整块元素搬进自己的容器；slot 里的节点由
 * Vue 通过 `<Teleport>` 渲染进宿主内部。因此「SDK 移动 Vue 原始管理节点」不可能发生（非目标 1），
 * 组件卸载时宿主要么随实例摘除、要么作为 detached 元素被丢弃，**不会在地图容器里留下我们的空节点**
 * （风险章的「Teleport host 残留」）。
 *
 * ## 事件
 *
 * `click` / `mouseover` / `mouseout` 来自上游 `CustomOverlayEventMap`（声明在
 * `overlay/CustomOverlay.d.ts`），由事件矩阵派生并原样转发——业务**不需要**自己在 slot 内容上
 * 再绑一遍 DOM 监听。三个事件的载荷都是 `OverlayMouseEvent<CustomOverlay>`（`point` 必填）。
 */
import { dynamicEmit } from "../../core/composables/dynamicEmit";
import { useCustomOverlay } from "../../core/composables/useCustomOverlay";
// #138：事件面的类型声明是生成物（见 `scripts/generate-overlay-emits.mts`）。
import type { CustomOverlayEmits } from "../../core/overlays/overlayEventEmits.generated";
import type { CustomOverlayProps } from "../../types/components";

export type { CustomOverlayProps };

const props = withDefaults(defineProps<CustomOverlayProps>(), {
  // 与官方 `CustomOverlayOptions` 的默认值一致（`anchors` 默认 `[0.5, 1]`、偏移 0、层级 0）
  anchor: () => ({ x: 0.5, y: 1 }),
  offset: () => ({ x: 0, y: 0 }),
  rotation: 0,
  zIndex: 0,
  visible: true,
  enableMassClear: true,
  // `minZoom` / `maxZoom` / `properties` 刻意**不给默认值**：SDK 没有声明默认语义，
  // 「没传」= 「不表态」，构造选项里不会出现这几个键（假支持的反面）。
});

const emit = defineEmits<CustomOverlayEmits>();

const emitDynamic = dynamicEmit(emit);

/**
 * `$attrs` 落在宿主内部的包装节点上（与 `<InfoWindow>` 同一条约定）。
 *
 * 不能让它落到根节点：根是 `<Teleport>`（**不是**元素），Vue 无法把 `class` / `style` 绑上去，
 * 只会在开发期告警并静默丢弃——那就是「收下但没人读」。也不能绑到宿主元素上：宿主由本库创建、
 * 由 SDK 搬运，把调用方的属性写到它上面等于让 SDK 的容器承担业务样式。
 */
defineOptions({ name: "CustomOverlay", inheritAttrs: false });

const { host } = useCustomOverlay(props, { emit: emitDynamic });
</script>

<template>
  <Teleport v-if="host" :to="host">
    <div class="b-custom-overlay-content" v-bind="$attrs">
      <slot />
    </div>
  </Teleport>
</template>
