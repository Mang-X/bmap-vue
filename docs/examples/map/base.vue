<template>
  <div>
    <label>
      <input type="checkbox" v-model="mapSetting.enableScrollWheelZoom" />
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
      <input type="checkbox" v-model="mapSetting.enablePinchToZoom" />
      双指缩放地图
    </label>
    <br />
    <label>
      <input type="checkbox" v-model="mapSetting.enableKeyboard" />
      键盘操作
    </label>
    <br />
    <label>
      <input type="checkbox" v-model="mapSetting.enableDoubleClickZoom" />
      双击缩放，左键双击放大、右键双击缩小
    </label>
    <br />
    <label>
      <input type="checkbox" v-model="mapSetting.enableContinuousZoom" />
      双击平滑缩放效果
    </label>
    <br />
    <label>
      <input type="checkbox" v-model="showTraffic" />
      显示交通路况（4.0 里路况是 <code>TrafficLayer</code>，不是 <code>&lt;Map&gt;</code> 的开关）
    </label>
    <br />
    <br />
    地图类型：
    <select class="mySelect" name="" id="" v-model="type">
      <option value="BMAP_NORMAL_MAP">常规地图 BMAP_NORMAL_MAP</option>
      <option value="BMAP_EARTH_MAP">地球模式 BMAP_EARTH_MAP</option>
      <option value="BMAP_SATELLITE_MAP">卫星图 BMAP_EARTH_MAP</option>
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
      :enableScrollWheelZoom="mapSetting.enableScrollWheelZoom"
      :enableContinuousZoom="mapSetting.enableContinuousZoom"
      :enableDoubleClickZoom="mapSetting.enableDoubleClickZoom"
      :enableKeyboard="mapSetting.enableKeyboard"
      :enablePinchToZoom="mapSetting.enablePinchToZoom"
    >
      <!--
        JSAPI 4.0 没有 `<Map enableTraffic>`：路况收敛成 TrafficLayer。
        所以这里按图层的方式挂，而不是给 Map 传一个不会生效的开关。
      -->
      <TrafficLayer v-if="showTraffic" :visible="true" />
    </Map>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { MapProps, TrafficLayer } from "bmap-vue";
const type = ref<string>("BMAP_NORMAL_MAP");
const showTraffic = ref(false);
const mapSetting = ref<MapProps>({
  enableDragging: true,
  enableInertialDragging: true,
  enableScrollWheelZoom: false,
  enableContinuousZoom: true,
  enableResizeOnCenter: true,
  enableDoubleClickZoom: false,
  enableKeyboard: true,
  enablePinchToZoom: true,
  enableAutoResize: true,
});
</script>
