<template>
  <div>
    <Map v-bind="$attrs" ref="map" :zoom="13" center="合肥市" @ready="handleInitd">
      <CustomControl class="address-list" :offset="{ x: 10, y: 10 }">
        <ul>
          <li v-for="item in addressList" :key="item">{{ item }}</li>
        </ul>
      </CustomControl>
      <template v-if="points.length">
        <template v-for="(item, index) in points">
          <Marker :position="item"></Marker>
          <Label
            :style="{ color: '#333', fontSize: '9px' }"
            :position="item"
            :content="addressList[index]"
          ></Label>
        </template>
      </template>
    </Map>
  </div>
</template>
<script lang="ts" setup>
import { ref } from "vue";
import { useGeocoder } from "bmap-vue";
const map = ref();
const addressList = [
  "包河区金寨路1号（金寨路与望江西路交叉口）",
  "庐阳区凤台路209号（凤台路与蒙城北路交叉口）",
  "蜀山区金寨路217号(近安医附院公交车站)",
  "蜀山区梅山路10号(近安徽饭店) ",
  "蜀山区 长丰南路159号铜锣湾广场312室",
  "合肥市寿春路93号钱柜星乐町KTV（逍遥津公园对面）",
  "庐阳区长江中路177号",
];
const { getBatch, isLoading } = useGeocoder(map);
const points = ref<Array<{ lng: number; lat: number }>>([]);

function handleInitd() {
  getBatch(addressList, "合肥市").then((r) => {
    points.value = r
      .filter((x) => x.point !== null)
      .map((x) => x.point as { lng: number; lat: number });
  });
}
</script>
<style>
.address-list {
  color: #333;
  background-color: #fff;
  font-size: 10px;
  padding: 10px;
  border-radius: 8px;
  box-shadow: rgb(0 0 0 / 15%) 1px 2px 1px;
}
.address-list ul {
  margin: 0;
  padding: 0;
}
.address-list li {
  list-style: none;
  border-bottom: 1px solid #f1f1f1;
}
</style>
