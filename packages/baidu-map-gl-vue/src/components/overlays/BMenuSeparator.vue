<script setup lang="ts">
/**
 * BMenuSeparator —— 声明式菜单分隔线（M5-CUSTOM-MENU / issue #33）
 *
 * 与数据 API 里的 `"-"` 等价：都归一化成同一条 `separator` 条目，走同一条构建路径。
 * 组件本身不渲染菜单内容，只登记一个占位元素（见 `<BMenuItem>` 的说明）。
 */
import { onUnmounted } from "vue";
import { useOptionalContextMenuChildren } from "../../core/context/menu";
import { logger } from "../../core/logger";

const registry = useOptionalContextMenuChildren();

let handle: { key: string; dispose: () => void } | null = null;

if (registry) {
  handle = registry.declare(() => "-");
} else {
  logger.warn(
    "BMenuSeparator: 没有找到父级 <BContextMenu>；这条分隔线不会被加入任何菜单。" +
      "声明式菜单项必须放在 <BContextMenu> 的子节点里。",
  );
}

onUnmounted(() => handle?.dispose());
</script>

<template>
  <i v-if="handle" :data-bmap-menu-key="handle.key" hidden aria-hidden="true" />
</template>
