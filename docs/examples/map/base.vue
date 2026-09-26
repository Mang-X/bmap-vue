<template>
  <div>
    <label>
      <input type="checkbox" v-model="mapSetting.enableWheelZoom" />
      鼠标缩放
    </label>
    <br />
    <label>
      <input type="checkbox" v-model="mapSetting.enableDragging" />
      拖拽
    </label>
    <br />
    <label>
      <input type="checkbox" v-model="mapSetting.enableInertialDragging" />
      惯性拖拽
    </label>
    <br />
    <label>
      <input type="checkbox" v-model="mapSetting.enablePinchZoom" />
      双指缩放地图
    </label>
    <br />
    <label>
      <input type="checkbox" v-model="mapSetting.enableKeyboard" />
      键盘操作
    </label>
    <br />
    <label>
      <input type="checkbox" v-model="mapSetting.enableDblclickZoom" />
      双击缩放，左键双击放大、右键双击缩小
    </label>
    <br />
    <label>
      <input type="checkbox" v-model="mapSetting.enableContinuousZoom" />
      双击平滑缩放效果
    </label>
    <br />
    <label>
      <input type="checkbox" v-model="mapSetting.enableTraffic" />
      显示交通路况
    </label>
    <br />
    <br />
    地图类型：
    <select class="mySelect" name="" id="" v-model="type">
      <option value="BMAP_NORMAL_MAP">常规地图 BMAP_NORMAL_MAP</option>
      <option value="BMAP_EARTH_MAP">地球模式 BMAP_EARTH_MAP</option>
      <option value="BMAP_SATELLITE_MAP">卫星图 BMAP_SATELLITE_MAP</option>
      <!-- #165 Class 1：混合图此前被静默降级成普通图，现在走上真映射 -->
      <option value="BMAP_HYBRID_MAP">混合图（卫星 + 路网）BMAP_HYBRID_MAP</option>
    </select>
    <br />
    <br />
    <Map
      v-bind="$attrs"
      :heading="64.5"
      :tilt="73"
      :center="{
        lng: 116.28019,
        lat: 40.049191,
      }"
      :zoom="19"
      :minZoom="3"
      :mapType="type"
      :enableDragging="mapSetting.enableDragging"
      :enableInertialDragging="mapSetting.enableInertialDragging"
      :enableWheelZoom="mapSetting.enableWheelZoom"
      :enableContinuousZoom="mapSetting.enableContinuousZoom"
      :enableDblclickZoom="mapSetting.enableDblclickZoom"
      :enableKeyboard="mapSetting.enableKeyboard"
      :enablePinchZoom="mapSetting.enablePinchZoom"
      :enableTraffic="mapSetting.enableTraffic"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { MapProps } from "bmap-vue";
const type = ref<string>("BMAP_NORMAL_MAP");
const mapSetting = ref<MapProps>({
  enableDragging: true,
  enableInertialDragging: true,
  enableWheelZoom: false,
  enableContinuousZoom: true,
  fixCenterWhenResize: true,
  enableDblclickZoom: false,
  enableKeyboard: true,
  enablePinchZoom: true,
  enableAutoResize: true,
  enableTraffic: false,
});
</script>
