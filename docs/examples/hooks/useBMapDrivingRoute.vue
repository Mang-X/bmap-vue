<template>
  <div>
    <div class="toolbar">
      <button :disabled="isLoading" @click="run">规划驾车路线</button>
      <button :disabled="isEmpty" @click="clear">清空</button>
      <span v-if="isLoading">规划中…</span>
      <span v-else-if="status === 'empty'">没有可用路线或服务当前不可用</span>
      <span v-else-if="status === 'failed'">规划失败（状态码 {{ sdkStatus ?? "-" }}）</span>
      <span v-else-if="status === 'unsupported'">当前引擎不支持驾车路线规划</span>
    </div>

    <ol class="plans">
      <li v-for="plan in plans" :key="plan.index">
        <strong>{{ plan.distanceText }} · {{ plan.durationText }}</strong>
        <span class="muted">
          （{{ plan.legs.length }} 条线路、{{ steps(plan) }} 个关键点，收费
          {{ plan.toll ?? 0 }} 元）
        </span>
        <p v-for="step in firstSteps(plan)" :key="step.index" class="step">
          {{ step.index + 1 }}. {{ step.description }}（{{ step.distanceText }}）
        </p>
      </li>
    </ol>

    <p class="muted">状态：{{ status }}（SDK 状态码：{{ sdkStatus ?? "-" }}）</p>

    <BMap v-bind="$attrs" :zoom="12" :center="from">
      <BMarker :position="from" />
      <BMarker :position="to" />
    </BMap>
  </div>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import { BMap, BMarker, useBMapDrivingRoute } from "bmap-vue";
import type { RoutePlan } from "bmap-vue";

const from = { lng: 116.391, lat: 39.91 };
const to = { lng: 116.431, lat: 39.931 };

// 纯 headless：不传 `renderOptions.map` 就只在数据层拿结果，画什么由自己决定。
// 想要官方绘制（路线折线 / 起终点标注 / 自动视野）就传 `renderOptions.map`。
const { data, status, sdkStatus, isLoading, isEmpty, search, clear } = useBMapDrivingRoute({
  location: "北京市",
});

const plans = computed(() => data.value?.plans ?? []);
const steps = (plan: RoutePlan) => plan.legs.reduce((total, leg) => total + leg.steps.length, 0);
const firstSteps = (plan: RoutePlan) => plan.legs[0]?.steps.slice(0, 3) ?? [];

// 驾车端点必须是坐标或 POI 引用（官方签名里没有字符串）。
// 要按地址出发，先用 `useBMapGeocoder().get('天安门')` 取到坐标再传进来。
function run() {
  void search(from, to);
}
</script>

<style>
.toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
.plans {
  margin: 8px 0;
  padding-left: 18px;
}
.plans strong {
  color: #d4380d;
}
.muted {
  color: #888;
  font-size: 12px;
}
.step {
  margin: 2px 0 0;
  color: #555;
  font-size: 12px;
}
</style>
