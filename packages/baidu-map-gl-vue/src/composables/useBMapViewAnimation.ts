/**
 * useBMapViewAnimation —— 视角关键帧动画
 *
 * 只封装官方公开面：`services.createViewAnimation()` 建实例、`map.startViewAnimation()` 播放、
 * `map.stopViewAnimation()`（落到 SDK 公开的 `cancelViewAnimation`）取消。
 *
 * 没有 `pause` / `resume`：4.0 上实例级的暂停/继续只有私有成员（旧实现调 `_pause` / `_continue`），
 * 本仓库对 Map 级 `pauseViewAnimation` / `continueViewAnimation` 也没有真实运行时取证。按 #104
 * 的 official-first 与 evidence-first 两条约束，**不**用私有面伪造一个 Stable 能力。
 *
 * `status` 是**观察值**：只由公开的 `animationstart` / `animationend` / `animationcancel` 写，
 * 命令本身不改动它。因此「发起了播放但 SDK 一次都没回调」会如实停在 `idle`，而不是被乐观地
 * 标成播放中。
 *
 * 取消**不等微任务**：`<BMap>` 在父组件的 `onUnmounted` 里销毁地图，而子树卸载发生在那之前——
 * 同步调用还能看到活的地图，跨一个微任务就已经跨过销毁线了（旧实现的 `void getReady().then(...)`
 * 因此每次卸载都抛一个没人接的 `BMAP_RESOURCE_DISPOSED`）。
 */
import { onUnmounted, shallowRef, toRaw, type ShallowRef } from "vue";
import { resolveMapContext } from "./resolveMapContext";
import { BMapError } from "../core/errors/BMapError";
import type { MapReadyContext } from "../core/context/types";
import type { MapHandle, ServiceHandle } from "../driver/types/handles";

/** 视角动画关键帧 */
export interface ViewAnimationKeyFrames {
  center: { lng: number; lat: number };
  zoom?: number;
  tilt?: number;
  heading?: number;
  /** 百分比 0~1 */
  percentage: number;
}

export interface UseBMapViewAnimationOptions {
  /** 延迟 ms,默认 0 */
  delay?: number;
  /** 持续 ms,默认 1000 */
  duration?: number;
  /** 循环次数,数字或 'INFINITE',默认 1 */
  loop?: number | "INFINITE";
}

/** 观察到的播放状态：`idle` = 没有在播放（未开始 / 已播完 / 已取消） */
export type ViewAnimationStatus = "idle" | "playing";

/**
 * 一段在飞动画的现场：取消命令 + **这一段自己的**监听释放。
 *
 * 不按「当前那一段」共用一个释放槽位：`startViewAnimation` 会先同步取消上一段，
 * 上一段的 `animationcancel` 于是在新一段订阅完成之后才到达——共用槽位会被旧段摘掉新段的监听。
 * 同理，被取代那一段的订阅在 `start()` 里**当场**释放，而不是等那条 `animationcancel`：
 * 「Driver 起播前会同步取消上一段、SDK 会为此派发事件」目前只有 Fake 建模、没有真实运行时取证
 * （审计表 F-1），而这三条监听是本库自己的记账，不该由 SDK 是否回调来决定销账。
 */
interface AnimationRun {
  readonly stop: () => void;
  readonly release: () => void;
}

/** 地图（或整个 Client）已经没了：此时「取消动画」这个动作不成立，而不是失败。 */
const RUN_WITHOUT_MAP_ERRORS: ReadonlySet<string> = new Set([
  "BMAP_RESOURCE_DISPOSED",
  "BMAP_RUNTIME_DISPOSED",
]);

export interface UseBMapViewAnimationReturn {
  /**
   * 播放一段关键帧动画。每次调用都新建一个动画实例（上一次还在播的由 SDK/Driver 取代），
   * 因此关键帧改了不必重建 composable。
   */
  start: (keyFrames: ViewAnimationKeyFrames[]) => Promise<void>;
  /** 取消当前播放（公开命令）；状态要等 SDK 的 `animationcancel` 到达才变回 `idle`。 */
  cancel: () => void;
  status: Readonly<ShallowRef<ViewAnimationStatus>>;
  ready: Promise<MapReadyContext>;
}

export function useBMapViewAnimation(
  options: UseBMapViewAnimationOptions = {},
  map?: unknown,
): UseBMapViewAnimationReturn {
  const ctx = resolveMapContext(map);
  const status = shallowRef<ViewAnimationStatus>("idle");
  let readyPromise: Promise<MapReadyContext> | null = null;
  const getReady = () => (readyPromise ??= ctx.whenReady());

  let disposed = false;
  let current: AnimationRun | null = null;

  /** 传入 <BMap> 组件实例 ref 时解包出真正的 MapHandle */
  function resolveMapHandle(readyCtx: MapReadyContext): MapHandle {
    const component = (
      map as { value?: { getMapInstance?: () => unknown } } | undefined
    )?.value;
    const unwrapped = toRaw(component?.getMapInstance?.() ?? readyCtx.map);
    return (unwrapped ?? readyCtx.map) as MapHandle;
  }

  /**
   * 取消一段动画。正常路径下 `stopViewAnimation` 会同步派发 `animationcancel`，
   * 监听与状态由那一段的 `settle` 收尾；地图已经不在了时只放行「地图没了」这一个原因，
   * 就地自己收尾（否则真故障会被静默成「已取消」）。
   */
  function stopRun(run: AnimationRun): void {
    if (current === run) current = null;
    try {
      run.stop();
    } catch (error) {
      if (error instanceof BMapError && RUN_WITHOUT_MAP_ERRORS.has(error.code)) {
        run.release();
        status.value = "idle";
        return;
      }
      throw error;
    }
  }

  async function start(keyFrames: ViewAnimationKeyFrames[]): Promise<void> {
    if (disposed) return;
    const readyCtx = await getReady();
    if (disposed) return;
    const { driver } = readyCtx.client;
    const mapHandle = resolveMapHandle(readyCtx);

    const animation: ServiceHandle<"service:view-animation"> =
      driver.services.createViewAnimation(keyFrames as never, {
        duration: options.duration ?? 1000,
        delay: options.delay ?? 0,
        // `interation` 是官方 4.0 的拼写，不是本库的字段名
        interation: options.loop ?? 1,
      });

    const settle = () => {
      run.release();
      if (current === run) current = null;
      // 已被下一段取代时不动状态：旧段的结算不能抹掉新段的「播放中」
      if (current === null) status.value = "idle";
    };
    const offStart = driver.events.on(animation, "animationstart", () => {
      if (current === run) status.value = "playing";
    });
    const offEnd = driver.events.on(animation, "animationend", settle);
    const offCancel = driver.events.on(animation, "animationcancel", settle);
    const run: AnimationRun = {
      stop: () => driver.map.stopViewAnimation(mapHandle),
      release: () => {
        offStart();
        offEnd();
        offCancel();
      },
    };
    // 接管：旧段的订阅当场下线（见 `AnimationRun` 的注释），新段的观察从这一刻起独占。
    current?.release();
    current = run;
    driver.map.startViewAnimation(mapHandle, animation);
  }

  function cancel(): void {
    if (disposed) return;
    const run = current;
    // 没有在飞的动画就没有可取消的东西：`stopViewAnimation` 会连带取消**这张图上**别人的动画
    if (run) stopRun(run);
  }

  onUnmounted(() => {
    disposed = true;
    const run = current;
    if (run) {
      // 地图销毁前**同步**取消；卸载之后不再观察，所以监听无条件归零
      stopRun(run);
      run.release();
    }
    current = null;
    status.value = "idle";
  });

  return {
    start,
    cancel,
    status: status as Readonly<ShallowRef<ViewAnimationStatus>>,
    get ready() {
      return getReady();
    },
  };
}
