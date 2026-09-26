<template>
  <div>
    <div class="bmap-example-toolbar">
      <span>地面叠加层类型：</span>
      <select class="bmap-example-select" v-model="activeKey">
        <option value="image">image 图片叠加层</option>
        <option value="video">video 视频叠加层</option>
        <option value="canvas">canvas 画布叠加层</option>
      </select>
    </div>
    <Map
      v-bind="$attrs"
      enableScrollWheelZoom
      noAnimation
      :displayOptions="{
        poiText: false, // 隐藏poi标注
        poiIcon: false, // 隐藏poi图标
        building: false, // 隐藏楼块
      }"
      :tilt="current.tilt"
      :zoom="current.zoom"
    >
      <Marker :position="current.bounds.southwest" icon="start" :offset="{ x: 0, y: -16 }" />
      <Marker :position="current.bounds.northeast" icon="end" :offset="{ x: 0, y: -16 }" />
      <GroundOverlay
        autoCenter
        :type="activeKey"
        :bounds="current.bounds"
        :url="current.url"
        :opacity="current.opacity"
      />
      <Label
        v-if="activeKey === 'canvas'"
        content="日坛公园"
        :position="{ lng: 116.449921, lat: 39.921324 }"
        :style="{
          color: '#fff',
          borderWidth: '1px',
          borderRadius: '5px',
          borderColor: '#fff',
          backgroundColor: '#79a913',
          fontSize: '16px',
          height: '30px',
          lineHeight: '30px',
        }"
      />
    </Map>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed } from "vue";
import type { GroundOverlayType, Point } from "bmap-vue";

const activeKey = ref<GroundOverlayType>("canvas");

/**
 * `<GroundOverlay>` 的几何入口**只有** `bounds`（西南 / 东北两个角点）。
 *
 * 早期这个示例传的是 `startPoint` / `endPoint`——那两个不是本组件的 prop，
 * 传了不报错也不生效，叠加层会按上一次的值留在原处，切换类型时看起来像「组件坏了」。
 * 见 `GroundOverlayProps`：缺失 `bounds` 在构造期即抛错，所以它是必填的。
 */
const groundOverlays: Record<
  GroundOverlayType,
  {
    tilt: number;
    zoom: number;
    opacity: number;
    bounds: { southwest: Point; northeast: Point };
    url: unknown;
  }
> = {
  canvas: {
    tilt: 0,
    zoom: 17,
    opacity: 1,
    bounds: {
      southwest: { lng: 116.447717, lat: 39.919173 },
      northeast: { lng: 116.453125, lat: 39.923475 },
    },
    url: () => {
      const textureCanvas = document.createElement("canvas");
      textureCanvas.width = textureCanvas.height = 200;
      const ctx = textureCanvas.getContext("2d")!;
      ctx.fillStyle = "#79a913";
      ctx.strokeStyle = "white";
      ctx.lineWidth = 6;
      ctx.lineCap = "square";
      ctx.fillRect(0, 0, 200, 200);
      ctx.moveTo(50, 50);
      ctx.lineTo(150, 50);
      ctx.lineTo(150, 150);
      ctx.lineTo(50, 150);
      ctx.lineTo(50, 50);
      ctx.stroke();
      return textureCanvas;
    },
  },
  image: {
    tilt: 45,
    zoom: 18,
    opacity: 1,
    bounds: {
      southwest: { lng: 117.19635, lat: 36.24093 },
      northeast: { lng: 117.2035, lat: 36.24764 },
    },
    url: "/bmap-vue/shouhuimap.png",
  },
  video: {
    tilt: 0,
    zoom: 4,
    opacity: 0.5,
    bounds: {
      southwest: { lng: 94.582033, lat: -7.989754 },
      northeast: { lng: 145.358572, lat: 30.813867 },
    },
    url: "/bmap-vue/cloud.mov",
  },
};

const current = computed(() => groundOverlays[activeKey.value]);
</script>
