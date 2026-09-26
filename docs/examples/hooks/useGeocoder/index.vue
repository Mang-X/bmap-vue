<template>
  <div>
    选择地址解析:
    <select class="mySelect" v-model="currentAddress">
      <option v-for="(item, index) in addressList" :key="index" :value="item">
        {{ item.address }}
      </option>
    </select>
    <div class="state" v-if="!isLoading && !isEmpty">
      <h5>解析结果:</h5>
      <span>纬度 - {{ point?.lat }}</span>
      <span>经度 - {{ point?.lng }}</span>
    </div>
    <div class="state" v-else-if="isEmpty">没有解析到结果 ！</div>
    <div class="state" v-else>解析中...</div>
    <br />
    <Map v-bind="$attrs" ref="map" :center="point || defaultCenter" @ready="handleInitd">
      <template v-if="!isLoading && !isEmpty">
        <Marker :position="point"></Marker>
      </template>
    </Map>
  </div>
</template>

<script lang="ts" setup>
import { ref, watch } from "vue";
import { useGeocoder } from "bmap-vue";
const map = ref();
const defaultCenter = { lng: 116.404, lat: 39.915 };
const addressList = ref([
  {
    address: "北京市海淀区上地10街",
    city: "北京市",
  },
  {
    address: "北京市海淀区海淀三山五园绿道",
    city: "北京市",
  },
  {
    address: "北京市东城区天安门东通道",
    city: "北京市",
  },
]);
const currentAddress = ref(addressList.value[0]);

watch(
  currentAddress,
  (n) => {
    get(n.address, n.city);
  },
  {
    deep: true,
  },
);
const { get, point, isLoading, isEmpty } = useGeocoder(map);

function handleInitd() {
  get(currentAddress.value.address, currentAddress.value.city);
}
</script>

<style>
.state {
  margin-top: 15px;
}
.state span {
  margin-right: 25px;
}
</style>
