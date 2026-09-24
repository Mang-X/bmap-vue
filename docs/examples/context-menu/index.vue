<template>
  <BMap v-bind="$attrs" :center="center">
    <!-- 数据 API：`items` 是一份数组，`-` 表示分隔线 -->
    <BContextMenu :items="list" :width="160" @select="onSelect" />

    <BMarker :icon="'simple_red'" :position="{ lat: 39.915185, lng: 116.403901 }">
      <!--
        写在 <BMarker> 里的菜单会挂到**该标注**上：只有右键这个标注才弹出来。
        声明式写法与上面的数据 API 等价（顺序、disabled、select 载荷都一致）。
      -->
      <BContextMenu :width="200">
        <BMenuItem text="标记此处" @select="onMarkerSelect" />
        <BMenuSeparator />
        <BMenuItem text="删除（禁用）" disabled />
      </BContextMenu>
    </BMarker>
  </BMap>
</template>
<script lang="ts" setup>
import { ref } from "vue";
import {
  BContextMenu,
  BMenuItem,
  BMenuSeparator,
  type ContextMenuItem,
  type ContextMenuSeparator,
  type ContextMenuSelectPayload,
} from "bmap-vue";

const center = ref("北京市");

// 沿用 v2/v3 的文档示例：菜单里放两个缩放项（`map` 是 MapHandle，缩放走 raw 逃生口）
type ZoomableRaw = { zoomIn(): void; zoomOut(): void };

// 数组元素的类型是 `ContextMenuItem | ContextMenuSeparator`——`"-"` 就是一条分隔线
const list = ref<(ContextMenuItem | ContextMenuSeparator)[]>([
  {
    text: "放大一级",
    callback: ({ map }) => {
      (map.raw as ZoomableRaw).zoomIn();
    },
  },
  {
    text: "缩小一级",
    callback: ({ map }) => {
      (map.raw as ZoomableRaw).zoomOut();
    },
  },
  "-",
  {
    text: "去上海",
    callback: () => {
      center.value = center.value === "上海市" ? "北京市" : "上海市";
    },
  },
]);

function onSelect(payload: ContextMenuSelectPayload) {
  console.log("选中了", payload.item.text, payload.point);
}

function onMarkerSelect(payload: ContextMenuSelectPayload) {
  alert(`标注上的菜单：${payload.point?.lng}, ${payload.point?.lat}`);
}
</script>
