<template>
  <div>
    <div class="state" v-if="isLoading">解析中...</div>
    <div class="state" v-else-if="isError">
      解析失败：{{ errorMessage }}（请检查 AK 域名白名单与网络）
    </div>
    <div class="state" v-else-if="isEmpty">点击地图选择坐标点，或等待初始解析…</div>
    <!--
      解析结果放在地图上方的面板里，**不要**塞进 `<Label>`：
      Label 是地图上的气泡，宽高由内容撑开，长地址在窄气泡里会一行一个字竖着排。
    -->
    <div class="bmap-example-detail" v-if="!isLoading && !isEmpty && data">
      <p class="bmap-example-detail-row">
        <span class="bmap-example-detail-key">地址</span>
        <span>{{ data.address || "无" }}</span>
      </p>
      <p class="bmap-example-detail-row">
        <span class="bmap-example-detail-key">商圈</span>
        <span>{{ data.business || "无" }}</span>
      </p>
      <p class="bmap-example-detail-row">
        <span class="bmap-example-detail-key">最匹配地点</span>
        <span>{{ data.surroundingPois?.[0]?.title || "无" }}</span>
      </p>
    </div>
    <Map
      v-bind="$attrs"
      enableWheelZoom
      ref="map"
      :center="initialCenter"
      @ready="handleInitd"
      @click="handleClick"
    >
      <template v-if="!isLoading && !isEmpty">
        <Marker :position="point"></Marker>
      </template>
    </Map>
  </div>
</template>

<script lang="ts" setup>
import { computed, ref } from "vue";
import { useGeocodeDetail, type MapMouseEvent } from "@mangax/bmap-vue";
const map = ref();
const { getLocation, data, isLoading, isEmpty, isError, error } = useGeocodeDetail(map);
const errorMessage = computed(() => {
  const e = error.value as { code?: string; message?: string } | null;
  if (!e) return "未知错误";
  return e.code ? `${e.code}: ${e.message ?? ""}` : String(e);
});
const point = ref({ lng: 116.30793520652882, lat: 40.05861561613348 });
// 地图初始视角固定，不跟随点击点变化：点击只移动标注、不移动镜头
const initialCenter = { lng: 116.30793520652882, lat: 40.05861561613348 };
function handleInitd() {
  getLocation(point.value);
}
// Map click 载荷为 MapMouseEvent { point, pixel, ... }，无 latlng 字段
function handleClick(e: MapMouseEvent) {
  point.value = { ...e.point };
  getLocation(e.point);
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
