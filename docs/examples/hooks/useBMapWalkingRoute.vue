<template>
  <div>
    <div class="toolbar">
      <input v-model="start" placeholder="起点，如“天安门”" @keyup.enter="run" />
      <input v-model="end" placeholder="终点，如“王府井”" @keyup.enter="run" />
      <button :disabled="isLoading" @click="run">规划步行路线</button>
      <button :disabled="isEmpty" @click="clear">清空</button>
    </div>

    <p v-if="isLoading">规划中…</p>
    <p v-else-if="status === 'empty'">没有可用路线或服务当前不可用</p>
    <p v-else-if="status === 'failed'">规划失败（状态码 {{ sdkStatus ?? "-" }}）</p>
    <ul v-else-if="data">
      <li v-for="plan in data.plans" :key="plan.index">
        <strong>{{ plan.distanceText }} · {{ plan.durationText }}</strong>
      </li>
    </ul>

    <BMap v-bind="$attrs" :zoom="14" :center="{ lng: 116.404, lat: 39.915 }" />
  </div>
</template>

<script lang="ts" setup>
import { ref } from "vue";
import { BMap, useBMapWalkingRoute } from "bmap-vue";

const start = ref("天安门");
const end = ref("王府井");

// 步行支持关键字起终点（与驾车不同），也没有途经点与策略选项。
const { data, status, sdkStatus, isLoading, isEmpty, search, clear } = useBMapWalkingRoute({
  location: "北京市",
});

function run() {
  void search(start.value, end.value);
}
</script>

<style>
.toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
</style>
