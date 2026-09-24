<script setup lang="ts">
import { onMounted, onUnmounted, provide, ref, watch } from "vue";
import {
  createPanoramaContext,
  jsapiV4PanoramaOf,
  panoramaContextKey,
} from "../../core/panorama";
import { resolveMapContext } from "../../composables/resolveMapContext";
import type { Point } from "../../driver/types/geometry";
import type {
  PanoramaHandle,
  PanoramaOptions,
  PanoramaPoiType,
  PanoramaPov,
  PanoramaSceneType,
  PanoramaViewerDriver,
} from "../../driver/types/panorama";

export interface PanoramaProps {
  /** 展示某个坐标处的全景（与 `id` 二选一；两者都给时以 `id` 为准） */
  point?: Point;
  /** 按全景 id 展示 */
  id?: string;
  /** 视角（`heading` 必填，`pitch` 省略表示不改俯角） */
  pov?: PanoramaPov;
  /** 缩放级别 */
  zoom?: number;
  /** 显隐：`true` → `show()`、`false` → `hide()` */
  visible?: boolean;
  /** 鼠标滚轮缩放开关（仅 PC 端有效） */
  scrollWheelZoom?: boolean;
  /** 外景场景点内可见的 POI 类型（默认隐藏全部） */
  poiType?: PanoramaPoiType;
  /** 查看器配置：构造期给一次，之后的变化经 `setOptions()` 整体写回 */
  options?: PanoramaOptions;
}

/**
 * Panorama —— 全景查看器（官方 `BMap.Panorama`）
 *
 * M7-CONTROL-PANORAMA / issue #41。与 `<Map>` 的关系是**并列**而不是嵌套依赖：查看器创建在
 * 自己的容器里（`new BMap.Panorama(container)`），既不挂在 Map 上，也不受地图的暂停/重试策略
 * 管辖；它只需要一个 Client，因此放在 `<Map>` 或 `<BMapProvider>` 子树里都可以。
 *
 * 命令面与 `<Map>` 的受控写入同源：`point` / `id` / `pov` / `zoom` / `visible` 都是**写命令**
 * （变化即下发）；`options` 构造期给一次，之后的变化经 `setOptions()` 写回。状态变化经
 * `positionChange` / `povChange` / `zoomChange` / `idChange` / `sceneTypeChange` /
 * `linksChange` 回报——官方的 `*_changed` 事件**不带载荷**，载荷是组件回读 getter 补齐的。
 *
 * ⚠️ 销毁：官方 4.0 的 `Panorama#destroy()` 在**未加载任何场景**的实例上会抛错（ADR 2026-09-12
 * 的真实 AK smoke 记录），因此组件路径的正确姿势是「先 `point` / `id`、再销毁」。真的没场景时
 * 销毁失败只告警、不抛错（卸载流程里抛异常没有任何人能接），本库自己的资源照常释放。
 */
const props = withDefaults(defineProps<PanoramaProps>(), {
  visible: true,
});

const emit = defineEmits<{
  /** 全景数据加载完成（官方 `dataload`） */
  load: [event: unknown];
  /** 全景数据加载失败（官方 `pano_error`） */
  error: [event: unknown];
  positionChange: [position: Point | null];
  povChange: [pov: PanoramaPov | null];
  zoomChange: [zoom: number | null];
  idChange: [id: string | null];
  sceneTypeChange: [sceneType: PanoramaSceneType | null];
  linksChange: [];
}>();

const containerRef = ref<HTMLElement | null>(null);
// 全景只需要 Client：`resolveMapContext()` 在 `<Map>` 子树里给地图 context、在 `<BMapProvider>`
// 子树里给 client-only 适配器；两者都能满足 `whenReady()`（后者 `map` 为 null）。
const context = createPanoramaContext({ mapContext: resolveMapContext() });
provide(panoramaContextKey, context);

/** 当前实例（Driver 已按 `jsapiV4PanoramaOf` 收窄过一次，调用点不再写 `!`）。 */
interface ActiveViewer {
  readonly driver: PanoramaViewerDriver;
  readonly viewer: PanoramaHandle;
}
let active: ActiveViewer | null = null;
/**
 * **构造期实际生效的那一份 `options` 的变化键**（不是选项对象本身）。
 *
 * 用来在就绪收敛时判断「构造之后 options 变过没有」：`context.mount()` 可能还在等 Client，
 * 这段窗口里 watcher 会触发，但那时 `active === null`（查看器还不存在），改动会被跳过；
 * 若不在 ready 后补一次，它就永久停在构造期那份了（#95 评审 P2）。比对键而不是无条件重发，
 * 是为了不破坏「同一个值重设不产生多余下发」。
 *
 * 存**键**而不是对象引用，与控件侧的 `optionSnapshot` 是同一手法：基线一旦持有父级传进来的对象，
 * 父级原地改字段就会把基线一起改掉，「构造期到底生效了什么」这个事实随之丢失。此处这个变体在
 * 当前生命周线下不可观测（`context.mount()` 直到构造完成才 resolve，而构造读的是活对象，晚一点的
 * 改动本来就会被构造期看到），因此没有对应的回归用例——写死成键是为了不把正确性寄托在「那个窗口
 * 恰好是同一条同步续体」上。
 */
let createdOptionsKey: string | undefined;

/** `options` 的变化键（watcher 与就绪收敛共用一份判据）。 */
const optionsKeyOf = (options: PanoramaOptions | undefined): string =>
  JSON.stringify([
    options?.navigationControl,
    options?.linksControl,
    options?.indoorSceneSwitchControl,
    options?.albumsControl,
    options?.albumsControlOptions,
  ]);

/**
 * 在本轮创建出来的查看器上执行一次；返回**是否真的执行了**。
 *
 * 调用方靠这个返回值决定要不要推进「构造期基线」——只推进**真的下发过**的那些变化。
 * （未就绪时静默跳过是对的：那一份由 ready 收敛负责补发；但如果这里也把基线推了，
 * 收敛就会以为「已经生效」，改动反而永久丢失。）
 */
function onViewer(run: (target: ActiveViewer) => void): boolean {
  if (!active) return false;
  run(active);
  return true;
}

/** 构造期之后把全部受控 props 落到新实例上（创建与「重建」共用同一份判据）。 */
function applyControlled(target: ActiveViewer): void {
  const { driver, viewer } = target;
  if (props.id !== undefined) driver.setId(viewer, props.id);
  else if (props.point) driver.setPosition(viewer, props.point);
  if (props.pov) driver.setPov(viewer, props.pov);
  if (props.zoom !== undefined) driver.setZoom(viewer, props.zoom);
  if (props.visible === false) driver.hide(viewer);
  if (props.scrollWheelZoom !== undefined) {
    if (props.scrollWheelZoom) driver.enableScrollWheelZoom(viewer);
    else driver.disableScrollWheelZoom(viewer);
  }
  if (props.poiType !== undefined) driver.setPanoramaPoiType(viewer, props.poiType);
  // 收敛等待期间变过的 options（构造期生效的是 `createdOptionsKey` 那一份）
  if (optionsKeyOf(props.options) !== createdOptionsKey && props.options) {
    driver.setOptions(viewer, props.options);
    createdOptionsKey = optionsKeyOf(props.options);
  }
}

/**
 * 事件订阅：官方 `*_changed` 事件不带值，载荷由回读 getter 补上；
 * 订阅走 Facet 自己的**原样**通道（`driver.on`），不经过 Map 事件的归一化。
 */
function subscribe(target: ActiveViewer): void {
  const { driver, viewer } = target;
  const scope = context.resources;
  scope.add(driver.on(viewer, "position_changed", () => emit("positionChange", driver.getPosition(viewer))));
  scope.add(driver.on(viewer, "pov_changed", () => emit("povChange", driver.getPov(viewer))));
  scope.add(driver.on(viewer, "zoom_changed", () => emit("zoomChange", driver.getZoom(viewer))));
  scope.add(driver.on(viewer, "id_changed", () => emit("idChange", driver.getId(viewer))));
  scope.add(driver.on(viewer, "scene_type_changed", () => emit("sceneTypeChange", driver.getSceneType(viewer))));
  scope.add(driver.on(viewer, "links_changed", () => emit("linksChange")));
  scope.add(driver.on(viewer, "dataload", (event: unknown) => emit("load", event)));
  scope.add(driver.on(viewer, "pano_error", (event: unknown) => emit("error", event)));
}

onMounted(async () => {
  const container = containerRef.value;
  if (!container) return;
  // 与传给 `mount()` 的**同一个值**：这段窗口里父级可能改 options，收敛时要用它做基线
  const initialOptions = props.options;
  createdOptionsKey = optionsKeyOf(initialOptions);
  try {
    const ready = await context.mount(container, initialOptions);
    active = { driver: jsapiV4PanoramaOf(ready.client), viewer: ready.viewer };
    applyControlled(active);
    subscribe(active);
  } catch {
    // 创建失败已写进 `context.error` / `context.status`（对 `ref` 可见），这里不再补事件：
    // 本组件的 `error` 事件对应的是官方 `pano_error`（**场景数据**加载失败），
    // 与「查看器没建起来」不是同一件事，混用会让调用方分不清该重试哪一个。
  }
});

// 卸载顺序：**父的 `onUnmounted` 在子树之后**，因此 `<PanoramaLabel>` 先把自己从查看器上摘掉，
// 再由这里销毁查看器（反过来会让子组件对已销毁的查看器调用 removeOverlay）。
onUnmounted(() => {
  active = null;
  context.dispose();
});

watch(
  // 键按字段展开：父级传内联字面量不应触发一次多余的下发。
  // `point` 与 `id` 同一份键：同时给出时以 `id` 为准（构造期与更新期必须同一判据）。
  () => JSON.stringify([props.point?.lng, props.point?.lat, props.id]),
  () => {
    onViewer((target) => {
      if (props.id !== undefined) target.driver.setId(target.viewer, props.id);
      else if (props.point) target.driver.setPosition(target.viewer, props.point);
    });
  },
);

watch(
  () => JSON.stringify([props.pov?.heading, props.pov?.pitch]),
  () => {
    const pov = props.pov;
    if (pov) onViewer((target) => target.driver.setPov(target.viewer, pov));
  },
);

watch(
  () => props.zoom,
  (zoom) => {
    if (zoom !== undefined) onViewer((target) => target.driver.setZoom(target.viewer, zoom));
  },
);

watch(
  () => props.visible,
  (visible) => {
    if (visible === undefined) return;
    onViewer((target) => {
      if (visible) target.driver.show(target.viewer);
      else target.driver.hide(target.viewer);
    });
  },
);

watch(
  () => props.scrollWheelZoom,
  (enabled) => {
    if (enabled === undefined) return;
    onViewer((target) => {
      if (enabled) target.driver.enableScrollWheelZoom(target.viewer);
      else target.driver.disableScrollWheelZoom(target.viewer);
    });
  },
);

watch(
  () => props.poiType,
  (poiType) => {
    if (poiType === undefined) return;
    onViewer((target) => target.driver.setPanoramaPoiType(target.viewer, poiType));
  },
);

watch(
  // 键按字段展开：父级传内联字面量不应触发一次多余的整体写回
  () => optionsKeyOf(props.options),
  () => {
    const options = props.options;
    if (!options) return;
    // 只有真的下发成功才推进基线；未就绪时留给 ready 收敛（见 `onViewer` 的注释）
    const applied = onViewer((target) => target.driver.setOptions(target.viewer, options));
    if (applied) createdOptionsKey = optionsKeyOf(options);
  },
);

defineOptions({ name: "Panorama" });

defineExpose({
  /** 查看器就绪（含 Client）；供业务做命令式操作或判定加载结果 */
  whenReady: (signal?: AbortSignal) => context.whenReady(signal),
  /** 当前查看器句柄（未就绪为 `null`） */
  viewer: context.viewer,
  /** 实例状态（`idle` / `waiting-client` / `creating` / `ready` / `error` / `disposing` / `disposed`） */
  status: context.status,
  /** 最近一次失败（`status === "error"` 时有值） */
  error: context.error,
});
</script>

<template>
  <!--
    全景容器由 SDK 在内部填充；本组件只给出这个宿主 div（尺寸由使用方经 class/style 提供）。
    **必须保留 `<slot />`**：`<PanoramaLabel>` 这类子组件要挂载才会创建标注——没有出口的话
    它们永远不会 mount（#41 实测踩到：标注用例全绿但一条标注都没建出来）。
  -->
  <div ref="containerRef">
    <slot />
  </div>
</template>
