<template>
  <div>
    <div class="state" v-if="!isLoading && !isError">
      <h5>定位:</h5>
      <span>
        城市 - {{ data?.address?.province }}-{{ data?.address?.city }}-{{
          data?.address?.district
        }}-{{ data?.address?.street }}
      </span>
      <span>纬度 - {{ data?.point?.lat }}</span>
      <span>经度 - {{ data?.point?.lng }}</span>
      <br />
      <span>定位精度 - {{ data?.accuracy }}m</span>
    </div>
    <div class="state" v-else-if="isError">出错了，{{ status }}</div>
    <div class="state" v-else>定位中...</div>
    <button v-if="!isLoading" class="myButton" @click="getCurrentPosition()">重新获取</button>
    <Map
      v-bind="$attrs"
      enableWheelZoom
      ref="map"
      @ready="getCurrentPosition()"
      :center="data?.point || defaultCenter"
    >
      <template v-if="data?.point && data?.accuracy != null">
        <Marker :position="data.point"></Marker>
        <Circle
          strokeStyle="solid"
          strokeColor="#0099ff"
          :strokeOpacity="0.8"
          fillColor="#0099ff"
          :fillOpacity="0.5"
          :center="data.point"
          :radius="data.accuracy"
        />
      </template>
    </Map>
  </div>
</template>

<script lang="ts" setup>
import { ref } from "vue";
import { useGeolocation } from "bmap-vue";
const map = ref();
const defaultCenter = { lng: 116.404, lat: 39.915 };
const { getCurrentPosition, data, isLoading, isError, status } = useGeolocation({}, map);
</script>

<style>
.state {
  margin-top: 15px;
}
.state span {
  margin-right: 25px;
}
</style>
