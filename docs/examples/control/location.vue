<template>
  <div>
    <Map v-bind="$attrs">
      <LocationControl
        :show-address-bar="showAddressBar"
        :auto-viewport="true"
        :watch-position="watchPosition"
        @location-success="onSuccess"
        @location-error="onError"
      />
    </Map>
    <p class="bmap-example-status">
      <template v-if="point">
        定位到 {{ point.lng.toFixed(3) }}, {{ point.lat.toFixed(3) }}
        <template v-if="address">
          （{{ address.province ?? "" }}{{ address.city ?? "" }}{{ address.district ?? ""
          }}{{ address.street ?? "" }}）
        </template>
      </template>
      <template v-else>点地图上的定位按钮试试。</template>
    </p>
    <p v-if="errorCode !== null" class="bmap-example-status">
      定位失败，官方错误码：{{ errorCode }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { LocationControl } from "bmap-vue";
import type { LocationAddressComponents } from "bmap-vue";

const showAddressBar = ref(true);
/** 持续跟踪：官方 `watchPosition`，开启后控件实时跟踪当前位置。 */
const watchPosition = ref(false);

const point = ref<{ lng: number; lat: number } | null>(null);
/** 官方 `AddressComponent` 的领域投影：五个成员全部可选，取不到就留在 undefined。 */
const address = ref<LocationAddressComponents | null>(null);
/** 官方只声明 `code: number`，没有可对照的枚举，因此这里只如实显示它。 */
const errorCode = ref<number | null>(null);

function onSuccess(e: { point: { lng: number; lat: number }; addressComponent: unknown } | null) {
  errorCode.value = null;
  if (!e) return; // 官方事件形状取不到时载荷为 null
  point.value = e.point;
  address.value = e.addressComponent as LocationAddressComponents | null;
}

function onError(e: { code: number } | null) {
  if (!e) return;
  errorCode.value = e.code;
}
</script>
