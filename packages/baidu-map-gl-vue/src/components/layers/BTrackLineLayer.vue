<script setup lang="ts">
/**
 * BTrackLineLayer —— 原生轨迹线图层（官方 4.0 扩展 API `TrackLine`）
 *
 * ## 能力面
 *
 * `TrackLine` 属官方**扩展 API**：`@baidumap/jsapi-v4-types@4.0.4` **没有**类声明，官方明确
 * 「首次加载时可视化实现是异步注入的」。驱动登记面（#110 之后）包含数据 + **六条播放命令**：
 *
 * - `data`：官方 `TrackLine` 只接收**单条 `LineString` Feature**（形状由调用方保证；本库不做
 *   GeoJSON 校验）。**`null` = 没有轨迹**（换一个没有轨迹的实例）、`undefined` = 不表态；
 * - `visible`：用**挂上 / 摘掉**表达（没有 `setVisible`），重新可见时会换实例；
 * - **播放命令面**（expose）：`playback.start / pause / resume / stop / setSpeed / setProcess`
 *   ——方法名均经 live 探针取证（`scripts/probe-track-line.mts`，2026-09-23，exit 0），不是从
 *   类型包猜的。`stop()` 停播放推进但**不**归零 `process`（夹具 `cmd.stop.observed`）。命令是
 *   **发出去**的：是否真的暂停由 SDK 的 `progress` / `statuschange` 事件回答，
 *   本组件**不建**内部播放状态机去镜像 SDK；
 * - **`observed`**（expose，只读 `shallowRef`）：事件派生的进度读数（`process` / `elapsed` /
 *   `distance` / `point` / `angle` + `status` / `statusName`）。只读事件，不做推断；
 * - **没有** style / opacity / zIndex / 缩放范围：驱动登记面里没有这些入口。
 *
 * ## 页面可见性策略（#110）
 *
 * live 探针实测：**SDK 不会**在页面 hidden 时自动暂停（`progress` 继续推进）。因此本组件的
 * **默认行为**是——页面 hidden 时只停掉**本库自己的观察**（不再更新 `observed`），**不**改写
 * 业务播放意图（SDK 继续播）。自动 pause/resume 是**显式 opt-in**（`pauseOnHidden` prop），
 * 不是基础默认：opt-in 打开时，hidden 触发 `pause()`、shown 恢复 `resume()`，且只在
 * 「本次是因 visibility 暂停的**且 handle 仍是那一代**」时才 resume（用户自己 pause 过的
 * 不被 visibility 抢走；hidden 期间换实例也不对新实例补 resume）。
 *
 * 不依赖旧的 `BMapGLLib.TrackAnimation` 插件，也不触碰它的任何私有字段。
 */
import { onMounted, onScopeDispose, shallowRef } from "vue";
import { useVisualLayer } from "./useVisualLayer";
import { createTrackLinePlaybackApi } from "../../core/layers/trackLinePlayback";
import type {
  BTrackLineLayerProps,
  BTrackLineLayerExpose,
  BTrackLineObserved,
} from "../../types/components";
import type { NativeLayerBindInput } from "../../core/composables/useNativeLayerResource";
import type { NativeLayerHandle } from "../../driver/types/native-layers";

const props = withDefaults(defineProps<BTrackLineLayerProps>(), {
  visible: true,
  pauseOnHidden: false,
});

const emit = defineEmits<{
  /** `progress` 事件：SDK 推进播放时派发（载荷见 `observed`）。 */
  progress: [observed: BTrackLineObserved];
  /** `statuschange` 事件：SDK 播放状态变化时派发（载荷见 `observed`）。 */
  statuschange: [observed: BTrackLineObserved];
}>();

/**
 * 事件派生的进度读数（只读；不镜像成「播放状态机」）。
 *
 * 字段名取自 live 探针的 `progress` / `statuschange` 载荷键（`probe-track-line.live.json`）。
 * 换实例时**不清空**（重建是异步的，立刻清会让「隐藏再显示」闪一下 null）；新实例的事件
 * 到达时按字段覆盖。
 */
const observed = shallowRef<BTrackLineObserved | null>(null);

/**
 * DriverEvent → raw 逃生口 → 载荷在 `value` 上（live 探针与 Fake 同口径）。
 * 返回 `null` = 载荷不是对象，本次事件丢弃。
 */
function readTrackLineEventValue(raw: unknown): Record<string, unknown> | null {
  const event = (raw as { raw?: unknown; value?: unknown } | null) ?? {};
  const escaped = (event.raw ?? event) as { value?: unknown } | null;
  const source = (escaped?.value ?? escaped ?? event) as Record<string, unknown> | null;
  if (!source || typeof source !== "object") return null;
  return source;
}

/** 可见性观察是否处于「暂停观察」（默认策略：hidden 只停观察，不改 SDK 播放意图）。 */
let observing = true;
/**
 * `pauseOnHidden` opt-in 下，visibility 发起 pause 时**被 pause 的那个 handle**（`null` = 没有）。
 *
 * 绑定到 handle 而不是布尔量：`visible` 翻转 / `data: null` 等路径会换实例，hidden 期间资源
 * 重建后 shown 时若仍按「有账就 resume」，会把 `resume()` 打到**从未被 visibility pause 的新
 * 实例**上（跨代误发）。shown 时只在「当前 session 的 handle 还是这一个」才 resume，否则直接清账。
 *
 * 与 `userPaused` 分开记账：用户自己 pause 过的不能被 visibility 的 resume 抢走
 * （用户意图优先，与 `useMapSuspension` 的同一条口径）。
 */
let visibilityPausedHandle: NativeLayerHandle | null = null;
/** 用户**显式** pause 过、尚未 resume/stop——visibility 不得替用户 resume。 */
let userPaused = false;

const { resource } = useVisualLayer<BTrackLineLayerProps>(props, {
  kind: "track-line",
  component: "BTrackLineLayer",
  // TrackLine 没有拾取面 ⇒ 不绑 pickEvents；播放观察走 extraBind
  extraBind: bindPlaybackEvents,
});

/**
 * 播放观察：绑 `progress` / `statuschange`，把事件载荷推进 `observed`。
 *
 * 页面 hidden（默认策略）时**不**更新 `observed`——「停掉本库自己的观察」是 issue 指定的
 * 默认可见性策略；SDK 侧继续播（live 探针实测）。
 */
function bindPlaybackEvents({ handle, context, scope, isQuiescing }: NativeLayerBindInput): void {
  const events = context.client.driver.events;
  const apply = (
    type: "progress" | "statuschange",
    raw: unknown,
  ): void => {
    if (isQuiescing()) return;
    if (!observing) return;
    const source = readTrackLineEventValue(raw);
    if (!source) return;
    const prev = observed.value ?? {};
    const next = {
      ...prev,
      ...(typeof source.process === "number" ? { process: source.process } : {}),
      ...(typeof source.elapsed === "number" ? { elapsed: source.elapsed } : {}),
      ...(typeof source.distance === "number" ? { distance: source.distance } : {}),
      ...(source.point !== undefined ? { point: source.point } : {}),
      ...(typeof source.angle === "number" ? { angle: source.angle } : {}),
      ...(typeof source.status === "number" ? { status: source.status } : {}),
      ...(typeof source.statusName === "string" ? { statusName: source.statusName } : {}),
    };
    observed.value = next;
    // 逐名分派（与 `pickEmitterFor` 同源：`defineEmits` 的重载不吃联合事件名）
    if (type === "progress") emit("progress", next);
    else emit("statuschange", next);
  };

  scope.add(
    events.on(handle, "progress", (event) => {
      apply("progress", event);
    }),
  );
  scope.add(
    events.on(handle, "statuschange", (event) => {
      apply("statuschange", event);
    }),
  );
}

const playbackInternal = createTrackLinePlaybackApi({
  component: "BTrackLineLayer",
  session: () => resource.session(),
});

/**
 * 暴露给调用方的播放命令面：在内部命令面之上记账**用户意图**（`userPaused`）。
 *
 * visibility 的 pause/resume 走 `playbackInternal`，**不**经过这一层——否则「visibility 暂停」
 * 会被误记成「用户暂停」，或反过来（#110 的 opt-in 硬约束）。
 */
const playback = {
  start() {
    clearPlaybackIntent();
    playbackInternal.start();
  },
  pause() {
    userPaused = true;
    visibilityPausedHandle = null;
    playbackInternal.pause();
  },
  resume() {
    clearPlaybackIntent();
    playbackInternal.resume();
  },
  stop() {
    clearPlaybackIntent();
    playbackInternal.stop();
  },
  setSpeed(speed: number) {
    playbackInternal.setSpeed(speed);
  },
  setProcess(process: number) {
    playbackInternal.setProcess(process);
  },
} as const;

/** 用户命令（start/resume/stop）清掉两本可见性/用户意图账——pause 与 visibility 路径各自记账。 */
function clearPlaybackIntent(): void {
  userPaused = false;
  visibilityPausedHandle = null;
}

/** 页面可见性：默认只停/恢复**观察**；`pauseOnHidden` 才碰 SDK 播放。 */
function applyVisibility(hidden: boolean): void {
  if (hidden) {
    observing = false;
    if (props.pauseOnHidden && !userPaused) {
      // 用户已经 pause 过 ⇒ 不碰（他们的意图优先）；只有「还能拿到会话」才记 visibility 暂停
      const session = resource.session();
      if (session) {
        playbackInternal.pause();
        visibilityPausedHandle = session.handle;
      }
    }
    return;
  }
  observing = true;
  if (props.pauseOnHidden && visibilityPausedHandle) {
    // 只恢复**本次由 visibility 暂停的那一代**：hidden 期间重建 ⇒ handle 已换，清账不 resume
    const session = resource.session();
    const sameHandle = session != null && session.handle === visibilityPausedHandle;
    visibilityPausedHandle = null;
    if (sameHandle) {
      playbackInternal.resume();
    }
  }
}

let onVisibilityChange: (() => void) | null = null;

onMounted(() => {
  if (typeof document === "undefined") return;
  onVisibilityChange = () => applyVisibility(document.visibilityState === "hidden");
  document.addEventListener("visibilitychange", onVisibilityChange);
  // 挂载时可能已经是 hidden（例如从后台恢复的标签页）
  onVisibilityChange();
});

onScopeDispose(() => {
  if (onVisibilityChange && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", onVisibilityChange);
  }
  onVisibilityChange = null;
});

/**
 * 暴露面：`observed` 用取值 getter（不是直接塞 ref）——`defineExpose` 会经 `proxyRefs`
 * 解包，接口类型因此是**值**（`BTrackLineObserved | null`），与消费方实际读到的一致。
 */
function createExpose(): BTrackLineLayerExpose {
  return {
    playback,
    get observed() {
      return observed.value;
    },
  };
}

defineExpose(createExpose());

defineOptions({ name: "BTrackLineLayer" });
</script>

<template>
  <slot />
</template>
