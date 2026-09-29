<template>
  <div>
    <div class="bmap-example-toolbar">
      <button class="bmap-example-button" @click="rotation = (rotation + 45) % 360">
        旋转 45°
      </button>
      <button class="bmap-example-button" @click="scale = scale >= 3 ? 1 : scale + 1">
        缩放 ×{{ scale }}
      </button>
      <span class="bmap-example-hint">
        位置固定在地面（墨卡托坐标系下的实际大小），屏幕大小随地图缩放级别变化。
      </span>
    </div>
    <Map
      v-bind="$attrs"
      :zoom="18"
      :tilt="45"
      enableWheelZoom
      @ready="handleReady"
    >
      <GroundPoint
        :point="point"
        url="https://jsapi-demo.bj.bcebos.com/images/markers/car.png"
        :size="{ width: 30, height: 60 }"
        :rotation="rotation"
        :scale="scale"
        :opacity="0.9"
        @click="handleClick"
      />
      <Marker :position="point" icon="loc_red" />
    </Map>
    <p v-if="clicks" class="bmap-example-hint">已点击 {{ clicks }} 次</p>
  </div>
</template>

<script lang="ts" setup>
import { ref } from "vue";
import type { Point } from "bmap-vue";

const point = { lng: 116.418351, lat: 39.921984 } as Point;

/**
 * 演示两个「**就地更新**」的字段：`rotation` 与 `scale`。
 *
 * 官方 `GroundPoint` 的实例上有 `setRotation` / `setScale`
 * （`overlay/GroundPoint.d.ts:59` / `:39`），因此改这两个值走 setter，**不重建实例**。
 * 对照 `level`：它在官方成员表上**没有** `setLevel`，是构造期属性，改它会重建。
 */
const rotation = ref(0);
const scale = ref(1);
const clicks = ref(0);

function handleReady() {
  // 地图就绪后即可交互；本例不需要额外动作。
}

function handleClick() {
  clicks.value += 1;
}
</script>
