<template>
  <BMap v-bind="$attrs" :center="center" :zoom="14">
    <BCustomOverlay
      :position="position"
      :offset="{ x: 0, y: -12 }"
      :rotation="rotation"
      :visible="visible"
      @click="onClick"
    >
      <div class="demo-card">
        <strong>自定义 DOM 覆盖物</strong>
        <p>点击了 {{ clicked }} 次</p>
      </div>
    </BCustomOverlay>
  </BMap>

  <div class="demo-toolbar">
    <button type="button" @click="move">换个位置</button>
    <button type="button" @click="rotation += 15">旋转 +15°</button>
    <button type="button" @click="visible = !visible">{{ visible ? "隐藏" : "显示" }}</button>
  </div>
</template>

<script lang="ts" setup>
import { ref } from "vue";
import { BCustomOverlay } from "baidu-map-gl-vue";

const center = ref("北京市");
const position = ref({ lng: 116.403901, lat: 39.915185 });
const rotation = ref(0);
const visible = ref(true);
const clicked = ref(0);

const spots = [
  { lng: 116.403901, lat: 39.915185 },
  { lng: 116.413901, lat: 39.925185 },
  { lng: 116.393901, lat: 39.905185 },
];
let spot = 0;

function move() {
  spot = (spot + 1) % spots.length;
  position.value = spots[spot]!;
}

function onClick() {
  clicked.value += 1;
}
</script>

<style scoped>
.demo-card {
  padding: 6px 10px;
  border-radius: 4px;
  background: #fff;
  box-shadow: 0 2px 8px rgb(0 0 0 / 20%);
  font-size: 12px;
  white-space: nowrap;
}
.demo-toolbar {
  margin-top: 8px;
}
</style>
