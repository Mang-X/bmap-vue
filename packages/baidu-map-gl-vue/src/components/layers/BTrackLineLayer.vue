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
 * 不是基础默认：opt-in 打开时，hidden 仅对「**命令意图落在当前 handle 且仍要求在播**」的实例
 * `pause()`、shown 恢复 `resume()`，且只在「本次是因 visibility 暂停的**且 handle 仍是那一代**」
 * 时才 resume——用户 pause/stop、从未 start、not-ready start、跨代意图都不被 visibility 反向启动
 * （意图只在命令**确实送达**后记到该 handle；`pauseOnHidden` 变化会按当前 `visibilityState` 收敛）。
 *
 * 不依赖旧的 `BMapGLLib.TrackAnimation` 插件，也不触碰它的任何私有字段。
 */
import { onMounted, onScopeDispose, shallowRef, watch } from "vue";
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
 * 与 `playingIntent` 分开记账：用户 pause/stop 后 visibility 不得替用户 resume。
 */
let visibilityPausedHandle: NativeLayerHandle | null = null;
/**
 * **命令意图**：最后一条**确实送达** `start`/`resume` 的 handle（`null` = 没有在播意图）。
 *
 * 绑 handle 而不是全局布尔：not-ready / 抛错的命令不记账（不排队、不补发——visibility 不能
 * 把迟到的 start 以 pause→resume 的方式补发）；跨代重建后意图仍指向旧 handle，新实例不会
 * 被误 resume。`pause`/`stop` 送达后清空。不读 SDK 事件、不镜像状态机（#110）。
 */
let playingIntentHandle: NativeLayerHandle | null = null;

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
 * 暴露给调用方的播放命令面：在内部命令面之上记账**已送达**的命令意图。
 *
 * 意图只在 `session()` 非空且内部调用**没有抛错**后写入——not-ready（告警跳过）与抛错都不留
 * 意图，避免 visibility 把未送达的 start 当成「已在播」补发。visibility 的 pause/resume 走
 * `playbackInternal`，不经过这一层（#110 opt-in 硬约束）。
 */
const playback = {
  start() {
    dispatchIntent(() => playbackInternal.start(), "play");
  },
  pause() {
    dispatchIntent(() => playbackInternal.pause(), "stop");
  },
  resume() {
    dispatchIntent(() => playbackInternal.resume(), "play");
  },
  stop() {
    dispatchIntent(() => playbackInternal.stop(), "stop");
  },
  setSpeed(speed: number) {
    playbackInternal.setSpeed(speed);
  },
  setProcess(process: number) {
    playbackInternal.setProcess(process);
  },
} as const;

/**
 * 执行用户播放命令并（仅在送达后）更新意图账。
 *
 * - 无 session：内部 `notReady` 告警并跳过——**不**改意图（不排队、不补发）；
 * - 调用抛错：意图不改（命令没落地）；
 * - 送达：`play` 记当前 handle；`stop` 清空意图。两种成功路径都清 visibility 暂停账
 *   （新命令之后，旧 handle 上的 visibility pause 不再授权 resume）。
 */
function dispatchIntent(
  deliver: () => void,
  next: "play" | "stop",
): void {
  const session = resource.session();
  if (!session) {
    deliver();
    return;
  }
  deliver();
  playingIntentHandle = next === "play" ? session.handle : null;
  visibilityPausedHandle = null;
}

/** 页面可见性：默认只停/恢复**观察**；`pauseOnHidden` 才碰 SDK 播放。 */
function applyVisibility(hidden: boolean): void {
  if (hidden) {
    observing = false;
    // 只暂停**意图落在当前 handle** 的实例：stop/idle/not-ready/跨代意图都不碰
    if (props.pauseOnHidden) {
      const session = resource.session();
      if (session && playingIntentHandle === session.handle) {
        playbackInternal.pause();
        visibilityPausedHandle = session.handle;
      }
    }
    return;
  }
  observing = true;
  if (props.pauseOnHidden && visibilityPausedHandle) {
    // 只恢复**本次由 visibility 暂停的那一代**，且意图仍指向它：
    // hidden 期间重建 ⇒ handle 已换；hidden 期间 stop/pause ⇒ 意图已清——都只清账不 resume
    const session = resource.session();
    const sameHandle = session != null && session.handle === visibilityPausedHandle;
    const intentSame = playingIntentHandle === visibilityPausedHandle;
    visibilityPausedHandle = null;
    if (sameHandle && intentSame) {
      playbackInternal.resume();
    }
  }
}

/**
 * `pauseOnHidden` 是响应式 prop：变化时按当前 `document.visibilityState` **显式收敛**，
 * 不能只等下一次 `visibilitychange`（否则 hidden 中 opt-out 会把本库造成的 pause 永远留下）。
 */
watch(
  () => props.pauseOnHidden,
  (enabled) => {
    if (typeof document === "undefined") return;
    const hidden = document.visibilityState === "hidden";
    if (!enabled) {
      // opt-out：若本库对同一 handle 记过账，立刻 resume 并清账
      if (visibilityPausedHandle) {
        const session = resource.session();
        const sameHandle = session != null && session.handle === visibilityPausedHandle;
        visibilityPausedHandle = null;
        if (sameHandle) {
          playbackInternal.resume();
        }
      }
      return;
    }
    // opt-in：按当前可见性跑一遍策略（hidden 中打开 ⇒ 立即 pause 有意图的实例）
    applyVisibility(hidden);
  },
);

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
