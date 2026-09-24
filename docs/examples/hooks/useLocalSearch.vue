<template>
  <div>
    <div class="toolbar">
      <input v-model="keyword" placeholder="搜索地点，如“天安门”" @keyup.enter="doSearch" />
      <button :disabled="isLoading" @click="doSearch">搜索</button>
      <button :disabled="!data?.length" @click="clear">清空</button>
      <span v-if="isLoading">检索中…</span>
      <span v-else-if="status === 'empty'">没有结果或服务当前不可用</span>
      <span v-else-if="status === 'failed'">检索失败（状态码 {{ sdkStatus ?? "-" }}）</span>
      <span v-else-if="status === 'unsupported'">当前引擎不支持本地检索</span>
    </div>

    <ul class="results">
      <li v-for="(poi, index) in pois" :key="poi.uid || index" @click="focused = poi.point">
        {{ poi.title }}<small v-if="poi.address">（{{ poi.address }}）</small>
      </li>
    </ul>

    <div class="pager" v-if="pageCount > 1">
      <button :disabled="pageIndex <= 0" @click="gotoPage(pageIndex - 1)">上一页</button>
      <span>{{ pageIndex + 1 }} / {{ pageCount }}</span>
      <button :disabled="pageIndex >= pageCount - 1" @click="gotoPage(pageIndex + 1)">
        下一页
      </button>
    </div>

    <Map v-bind="$attrs" :zoom="12" :center="center">
      <Marker v-if="focused" :position="focused" />
    </Map>
  </div>
</template>

<script lang="ts" setup>
import { computed, ref } from "vue";
import { Map, Marker, useLocalSearch } from "bmap-vue";

const keyword = ref("天安门");
const focused = ref<{ lng: number; lat: number } | null>(null);

// 纯 headless：`location` 给检索区域（城市名 / 坐标 / MapHandle），不传就是当前地图。
// 要绘制官方结果（标注 / 结果面板）就传 `renderOptions.map`；这里选择自己画。
const { data, status, sdkStatus, isLoading, search, gotoPage, clear } = useLocalSearch({
  location: "北京市",
  pageCapacity: 10,
});

const pois = computed(() => data.value?.[0]?.pois ?? []);
const pageIndex = computed(() => data.value?.[0]?.pageIndex ?? 0);
const pageCount = computed(() => data.value?.[0]?.pageCount ?? 0);
const center = computed(() => focused.value ?? { lng: 116.404, lat: 39.915 });

async function doSearch() {
  const result = await search(keyword.value);
  if (result.status === "success") focused.value = result.data?.[0]?.pois[0]?.point ?? null;
}

// 另外还会拿到 `supported`（当前引擎是否支持本地检索）与 `cancel()`（逻辑取消在飞请求）；
// 卸载时 hook 会自动取消在飞请求并释放 SDK 实例。
</script>

<style>
.toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
.results {
  margin: 8px 0;
  padding-left: 18px;
  max-height: 160px;
  overflow: auto;
}
.results li {
  cursor: pointer;
}
.results small {
  color: #888;
}
.pager {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
</style>
