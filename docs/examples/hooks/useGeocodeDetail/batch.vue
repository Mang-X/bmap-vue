<template>
  <div>
    <Map
      v-bind="$attrs"
      enableScrollWheelZoom
      :zoom="13"
      :center="{ lng: 116.328749, lat: 40.026922 }"
      ref="map"
      @ready="handleInitd"
    >
      <CustomControl class="point-list" :offset="{ x: 10, y: 10 }">
        <ul>
          <li v-for="(item, index) in points" :key="index">
            <div>
              <span>{{ index + 1 }}.</span>
              <span>纬度 - {{ item.lat }}</span>
              <span>经度 - {{ item.lng }}</span>
            </div>
            <!-- 长地址放列表里，不塞进 <Label>：Label 是地图气泡，会一行一个字竖着排。 -->
            <div class="addr" v-if="result?.[index]?.detail">
              {{ result[index]!.detail.address || "无地址" }}
            </div>
          </li>
        </ul>
      </CustomControl>
      <template v-if="!isLoading">
        <template v-for="(item, index) in result" :key="index">
          <template v-if="item.detail">
            <Marker :position="item.detail.point"></Marker>
          </template>
        </template>
      </template>
    </Map>
  </div>
</template>

<script lang="ts" setup>
import { useGeocodeDetail, GeocodeDetailResult } from "bmap-vue";
const points = [
  { lng: 116.307852, lat: 40.057031 },
  { lng: 116.313082, lat: 40.047674 },
  { lng: 116.328749, lat: 40.026922 },
  { lng: 116.347571, lat: 39.988698 },
  { lng: 116.316163, lat: 39.997753 },
  { lng: 116.345867, lat: 39.998333 },
  { lng: 116.403472, lat: 39.999411 },
  { lng: 116.307901, lat: 40.05901 },
];
import { ref } from "vue";
const map = ref();
const { getBatch, isLoading } = useGeocodeDetail(map);
type BatchItem = {
  point: { lng: number; lat: number };
  detail: GeocodeDetailResult | null;
  error?: unknown;
};
const result = ref<BatchItem[]>([]);
function handleInitd() {
  getBatch(points).then((r) => {
    result.value = r;
  });
}
</script>

<style>
.point-list {
  color: #333;
  background-color: #fff;
  font-size: 10px;
  padding: 10px;
  border-radius: 8px;
  box-shadow: rgb(0 0 0 / 15%) 1px 2px 1px;
}
.point-list ul {
  margin: 0;
  padding: 0;
}
.point-list li {
  list-style: none;
  border-bottom: 1px solid #f1f1f1;
}
.point-list span {
  margin-right: 15px;
}
.point-list .addr {
  margin: 2px 0 6px;
  max-width: 220px;
  /* 关键：不换行会被容器压成竖排；给出宽度上限 + 正常换行。 */
  white-space: normal;
  word-break: break-word;
  line-height: 1.4;
  color: #666;
}
</style>
