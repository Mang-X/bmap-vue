<script setup lang="ts">
import { onMounted, onScopeDispose, shallowRef, watch } from "vue";
import { jsapiV4PanoramaOf, useRequiredPanoramaContext } from "../../core/panorama";
import { ResourceScope } from "../../core/lifecycle/ResourceScope";
import type { Point } from "../../driver/types/geometry";
import type { PanoramaLabelHandle, PanoramaViewerDriver } from "../../driver/types/panorama";

export interface BPanoramaLabelProps {
  /** 标签文本（官方 `PanoramaLabel` 的构造参数，也是 `setContent()` 的值） */
  content?: string;
  /** 标签在全景场景中的地理位置 */
  position?: Point;
  /** 距地面高度（米，官方默认 `2`） */
  altitude?: number;
  /** 是否显示标签到当前场景点的距离（官方默认 `true`） */
  displayDistance?: boolean;
}

/**
 * BPanoramaLabel —— 全景标注（官方 `BMap.PanoramaLabel`）
 *
 * M7-CONTROL-PANORAMA / issue #41。必须作为 `<BPanorama>` 的子组件：标注只存在于某个查看器
 * 内部（官方经 `Panorama#addOverlay` / `removeOverlay` 挂载），不属于 Overlay / Control 家族，
 * 因此**不复用** `OverlayTarget` 那套注册表——所有权由「谁创建谁摘除」表达：本组件在自己的
 * 作用域里摘除，父组件随后才销毁查看器（父的 `onUnmounted` 晚于子树）。
 *
 * 选项的落地方式按官方 4.0.4 的成员表分两档：
 * - `content` → `setContent()`、`position` → `setPosition()`、`altitude` → `setAltitude()`：
 *   有 setter，就地更新；
 * - `displayDistance` → **只有构造期**（官方没有 `setDisplayDistance`）：变化时重建标注。
 */
const props = withDefaults(defineProps<BPanoramaLabelProps>(), {
  content: "",
  // 官方声明的默认值（`PanoramaLabelOptions.displayDistance` 的 `@default true`）。
  // 显式写出：Vue 对布尔 prop 有「缺省即 false」的转换，不写默认值会让「用户传 false」与
  // 「用户没传」变成同一个值——而这个 prop 是构造期项，两者都走重建，于是**用户永远关不掉**
  // 距离显示（M7-CONTROL-PANORAMA 实测踩到）。
  displayDistance: true,
});

const emit = defineEmits<{
  /** 单击标签（官方 `PanoramaLabelEventMap.click`） */
  click: [event: unknown];
}>();

const context = useRequiredPanoramaContext();
const label = shallowRef<PanoramaLabelHandle | null>(null);

let labelScope: ResourceScope | null = null;
let driver: PanoramaViewerDriver | null = null;
/** 换代号：异步创建期间被打断（重建 / 卸载）时丢弃这一轮的结果。 */
let generation = 0;

const createOptions = () => ({
  position: props.position,
  altitude: props.altitude,
  displayDistance: props.displayDistance,
});

async function createLabel(): Promise<void> {
  const myGeneration = ++generation;
  try {
    const ready = await context.whenReady();
    if (myGeneration !== generation) return;
    const viewerDriver = jsapiV4PanoramaOf(ready.client);
    const created = viewerDriver.createLabel(props.content, createOptions());
    viewerDriver.addLabel(ready.viewer, created);
    // 每个标注实例一个作用域：重建时整块换掉，不去复用已经被释放的作用域
    // （`ResourceScope.dispose()` 是终态，复用会让新注册的 disposer 立即执行）
    const localScope = new ResourceScope({ label: "panorama-label" });
    labelScope = localScope;
    localScope.add(() => viewerDriver.removeLabel(ready.viewer, created));
    localScope.add(viewerDriver.on(created, "click", (event: unknown) => emit("click", event)));
    driver = viewerDriver;
    label.value = created;
  } catch {
    // 父查看器没建起来（或已卸载）：标注不创建，也不向调用方抛错——失败原因与状态在
    // `<BPanorama ref>` 上可见，子组件各抛一份只会重复。
  }
}

function destroyLabel(): void {
  generation += 1;
  try {
    labelScope?.dispose("panorama-label-removed");
  } catch {
    /* 摘除失败不阻断后续（SDK 侧 removeOverlay 对未挂载的标注是 no-op） */
  }
  labelScope = null;
  driver = null;
  label.value = null;
}

onMounted(() => {
  void createLabel();
});

onScopeDispose(() => destroyLabel());

watch(
  () => props.content,
  (content) => {
    if (label.value && content !== undefined) driver?.setLabelContent(label.value, content);
  },
);

watch(
  () => JSON.stringify([props.position?.lng, props.position?.lat]),
  () => {
    if (label.value && props.position) driver?.setLabelPosition(label.value, props.position);
  },
);

watch(
  () => props.altitude,
  (altitude) => {
    if (label.value && altitude !== undefined) driver?.setLabelAltitude(label.value, altitude);
  },
);

watch(
  () => props.displayDistance,
  () => {
    destroyLabel();
    void createLabel();
  },
);

defineOptions({ name: "BPanoramaLabel" });

defineExpose({ label });
</script>

<template>
  <!-- 标签不渲染任何 DOM：内容由 SDK 在全景画面里绘制 -->
  <span style="display: none" />
</template>
