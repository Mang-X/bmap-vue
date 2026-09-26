<template>
  显示区域:
  <select class="mySelect" name="" id="" v-model="showRegion">
    <option value="outside">局部隐藏</option>
    <option value="inside">局部显示</option>
  </select>
  <Map
    v-bind="$attrs"
    :center="center"
    :zoom="18"
    @ready="handleInitd"
    enable-scroll-wheel-zoom
    :style="{ background: 'rgb(192, 214, 213)' }"
  >
    <Marker :position="center"></Marker>
    <MapMask :path="path" :show-region="showRegion" isPoiMask isBuildingMask isMapMask></MapMask>
  </Map>
</template>

<script setup lang="ts">
import { ref, shallowRef, triggerRef } from "vue";
import { Map, Marker, MapMask, PointLike, type MapMaskShowRegion } from "bmap-vue";
const path = shallowRef<PointLike[]>([]);
const center = ref<PointLike>({ lng: 0, lat: 0 });
const showRegion = ref<MapMaskShowRegion>("outside");
function handleInitd() {
  center.value = { lng: 116.31951444701689, lat: 40.03514188328609 };
  path.value = [
    { lng: 116.31951444701689, lat: 40.03514188328609 },
    { lng: 116.31914525270483, lat: 40.03627653457813 },
    { lng: 116.31887119442595, lat: 40.03712933826661 },
    { lng: 116.31862381043088, lat: 40.037753816069426 },
    { lng: 116.31846085080458, lat: 40.03827800880047 },
    { lng: 116.31800011574751, lat: 40.03960034324275 },
    { lng: 116.3176890313816, lat: 40.0403207681881 },
    { lng: 116.31747304954207, lat: 40.04023658043798 },
    { lng: 116.31689403073578, lat: 40.040120567399384 },
    { lng: 116.31419172285828, lat: 40.03965310472413 },
    { lng: 116.31437612880998, lat: 40.03919415930771 },
    { lng: 116.31462581129936, lat: 40.03876546296739 },
    { lng: 116.31525321239126, lat: 40.037930670509574 },
    { lng: 116.315488510584, lat: 40.0377117230615 },
    { lng: 116.31601289759325, lat: 40.037228304952336 },
    { lng: 116.31692309046987, lat: 40.03662665953143 },
    { lng: 116.31817328272946, lat: 40.03584288930924 },
    { lng: 116.31924096994166, lat: 40.03521921152976 },
  ];
  triggerRef(path);
}
</script>
