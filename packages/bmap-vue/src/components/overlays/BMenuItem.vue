<script setup lang="ts">
/**
 * BMenuItem —— 声明式菜单项（M5-CUSTOM-MENU / issue #33）
 *
 * ```vue
 * <BContextMenu>
 *   <BMenuItem text="标记此处" @select="onSelect" />
 *   <BMenuSeparator />
 *   <BMenuItem text="删除" disabled />
 * </BContextMenu>
 * ```
 *
 * ## 它不渲染菜单
 *
 * 菜单由 SDK 自己渲染（`.BMap_cmItem`），Vue 这边只需要知道「有一条这样的项、在第几个位置」。
 * 因此本组件渲染的是一个**占位元素**（带登记键、不可见），挂在父级提供的一个 detached 宿主里，
 * 永不进入地图容器的 DOM；父级按占位元素的先后还原出菜单顺序。
 *
 * ## 与数据 API 的关系
 *
 * `<BMenuItem text="A" />` 与 `items: [{ text: "A" }]` 产出的条目**完全同形**（顺序、`disabled`、
 * `width`、`id`、选中载荷都不因写法而异）；两者可以混用，最终顺序是「`items` 在前、声明式 children
 * 在后」。归一化在 `useContextMenu` 里只有一处实现。
 */
import { onUnmounted, watch } from "vue";
import {
  useOptionalContextMenuChildren,
  type ContextMenuDeclarationHandle,
} from "../../core/context/menu";
import { logger } from "../../core/logger";
import type { BMenuItemProps, ContextMenuSelectPayload } from "../../types/components";

export type { BMenuItemProps };

const props = defineProps<BMenuItemProps>();

const emit = defineEmits<{
  select: [payload: ContextMenuSelectPayload];
}>();

const registry = useOptionalContextMenuChildren();

let handle: ContextMenuDeclarationHandle | null = null;

if (registry) {
  handle = registry.declare(() => ({
    text: props.text,
    disabled: props.disabled,
    width: props.width,
    id: props.id,
    onSelect: (payload) => emit("select", payload),
  }));
} else {
  // 放错位置（不在 <BContextMenu> 子树里）：**明确告警**，而不是静默变成一个永不出现的菜单项
  logger.warn(
    "BMenuItem: 没有找到父级 <BContextMenu>；这一项不会被加入任何菜单。" +
      "声明式菜单项必须放在 <BContextMenu> 的子节点里。",
  );
}

/**
 * props 变化要让父级重新解析（注册表存的是**读取器**，因此这里只需通知）。
 *
 * `flush: "sync"` 不必要——父级是在 `nextTick` 后统一解析的，watch 本身在 pre 队列里跑也来得及；
 * 但显式列出依赖字段，避免 `deep` 遍历一个含函数的对象。
 */
if (handle) {
  const invalidate = handle.invalidate;
  watch(
    () => [props.text, props.disabled, props.width, props.id],
    () => invalidate(),
  );
}

onUnmounted(() => handle?.dispose());
</script>

<template>
  <!--
    占位元素：只承载登记键。它挂在父级的 detached 宿主里，因此对使用者不可见，
    也不进地图容器的 DOM（`hidden` 是双保险：宿主一旦被误接进文档，它也不会显示）。
  -->
  <i v-if="handle" :data-bmap-menu-key="handle.key" hidden aria-hidden="true" />
</template>
