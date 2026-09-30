<template>
  <div>
    <Map v-bind="$attrs">
      <CityListControl
        ref="control"
        @change-success="onChangeSuccess"
        @open="open = true"
        @close="open = false"
      />
    </Map>
    <p class="bmap-example-status">
      当前城市：<b>{{ currentCity || "（读不到）" }}</b
      >，面板{{ open ? "已展开" : "已收起" }}
    </p>
    <button class="myButton no-m-b" @click="toggle">切换面板</button>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { CityListControl } from "bmap-vue";
import type { ControlCommandTypes } from "bmap-vue";

/**
 * 命令面只有两个动作 / 读回（`toggle` / `getCityName`）。
 *
 * 组件还 expose 了一个 `status`（`idle` / `creating` / `ready` / `error` / `disposing` / `disposed`），
 * 未就绪或已释放时命令会抛错而不是静默失败；这里用 try/catch 兜住「点得太早」那一次。
 */
type CityListCommands = ControlCommandTypes["CityListControl"] & {
  status?: string;
};

const control = ref<CityListCommands | null>(null);
const currentCity = ref("");
const open = ref(false);

function toggle() {
  if (!control.value) return;
  try {
    control.value.toggle();
  } catch {
    // 控件还没就绪（命令会抛错）——忽略这一次点击即可。
  }
}

function onChangeSuccess(result: { city: string } | null) {
  // 官方的 onChangeSuccess 在控件初始化完成后也会触发一次，可用来取初始城市名。
  currentCity.value = result?.city ?? control.value?.getCityName() ?? "";
}
</script>
