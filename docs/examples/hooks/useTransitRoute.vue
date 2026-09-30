<template>
  <div>
    <div class="bmap-example-toolbar">
      <button class="bmap-example-button" :disabled="isLoading" @click="run">规划公交路线</button>
      <button class="bmap-example-button is-secondary" :disabled="isEmpty" @click="clear">
        清空
      </button>
      <span v-if="isLoading">规划中…</span>
      <span v-else-if="status === 'empty'">没有可用方案或服务当前不可用</span>
      <span v-else-if="status === 'failed'">规划失败（状态码 {{ sdkStatus ?? "-" }}）</span>
    </div>

    <p v-if="transitType !== null" class="muted">
      {{ transitType === 1 ? "跨城方案" : "市内方案" }}
    </p>

    <ol class="plans">
      <li v-for="plan in plans" :key="plan.index">
        <strong>{{ plan.distanceText }} · {{ plan.durationText }}</strong>
        <span class="muted">（{{ plan.linesTitle }}，步行 {{ plan.walkDistance }}）</span>
        <p v-for="(segment, index) in plan.segments" :key="index" class="segment">
          <template v-if="segment.kind === 'line'">
            🚌 {{ segment.title }}（{{ segment.onStop?.title }} → {{ segment.offStop?.title }}，
            {{ segment.viaStops }} 站）
          </template>
          <template v-else>🚶 步行 {{ segment.leg.distanceText }}</template>
        </p>
      </li>
    </ol>

    <Map v-bind="$attrs" :zoom="11" :center="{ lng: 116.404, lat: 39.915 }" />

    <p class="muted">状态：{{ status }}（SDK 状态码：{{ sdkStatus ?? "-" }}）</p>
  </div>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import { Map, TransitPolicy, useTransitRoute } from "bmap-vue";

// 公交支持关键字起终点（与驾车不同），并且是四个服务里配置面最宽的一个。
const { data, status, sdkStatus, isLoading, isEmpty, search, clear } = useTransitRoute({
  location: "北京市",
  policy: TransitPolicy.LEAST_TRANSFER,
  pageCapacity: 3,
});

const plans = computed(() => data.value?.plans ?? []);
const transitType = computed(() => data.value?.transitType ?? null);

function run() {
  void search("天安门", "北京西站");
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
.segment {
  margin: 2px 0 0;
  color: var(--vp-c-text-2);
  font-size: 13px;
}
</style>
