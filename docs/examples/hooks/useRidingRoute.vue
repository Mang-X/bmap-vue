<template>
  <div>
    <div class="bmap-example-toolbar">
      <button class="bmap-example-button" :disabled="isLoading" @click="run">规划骑行路线</button>
      <button class="bmap-example-button is-secondary" :disabled="isEmpty" @click="clear">
        清空
      </button>
      <span v-if="isLoading">规划中…</span>
      <span v-else-if="status === 'empty'">没有可用路线或服务当前不可用</span>
      <span v-else-if="status === 'failed'">规划失败（状态码 {{ sdkStatus ?? "-" }}）</span>
    </div>

    <ul v-if="data">
      <li v-for="plan in data.plans" :key="plan.index">
        <strong>{{ plan.distanceText }} · {{ plan.durationText }}</strong>
        <span class="muted">（{{ plan.legs.length }} 条线路）</span>
      </li>
    </ul>

    <Map v-bind="$attrs" :zoom="13" :center="{ lng: 116.31, lat: 39.99 }" />
  </div>
</template>

<script lang="ts" setup>
import { Map, useRidingRoute } from "bmap-vue";

// 与步行同形：支持关键字起终点、没有途经点与策略选项；结果的 routeType 是 6（骑行）。
const { data, status, sdkStatus, isLoading, isEmpty, search, clear } = useRidingRoute({
  location: "北京市",
});

function run() {
  void search("北京大学", "清华大学");
}
</script>

<style>
.plans {
  margin: 8px 0;
  padding-left: 18px;
}
.muted {
  color: var(--vp-c-text-2);
  font-size: 13px;
}
</style>
