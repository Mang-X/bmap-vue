<template>
  <Map v-bind="$attrs" :center="center">
    <!-- 数据 API：`items` 是一份数组，`-` 表示分隔线 -->
    <ContextMenu :items="list" :width="160" @select="onSelect" />

    <Marker :icon="'simple_red'" :position="{ lat: 39.915185, lng: 116.403901 }">
      <!--
        写在 <Marker> 里的菜单会挂到**该标注**上：只有右键这个标注才弹出来。
        声明式写法与上面的数据 API 等价（顺序、disabled、select 载荷都一致）。
      -->
      <ContextMenu :width="200">
        <MenuItem text="标记此处" @select="onMarkerSelect" />
        <MenuSeparator />
        <MenuItem text="删除（禁用）" disabled />
      </ContextMenu>
    </Marker>
  </Map>
</template>
<script lang="ts" setup>
import { ref } from "vue";
import {
  ContextMenu,
  MenuItem,
  MenuSeparator,
  type ContextMenuItem,
  type ContextMenuSeparator,
  type ContextMenuSelectPayload,
} from "bmap-vue";

const center = ref("北京市");

// 文档示例：菜单里放两个缩放项（`map` 是 MapHandle，缩放走 raw 逃生口）
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
