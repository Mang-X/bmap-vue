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
 *
 * 两段归属规则（#105 评审 P1）：Driver 对取消失败的处理是「**保留动画记录、可再次 stop/destroy
 * 重试**」，因此本 hooks 一侧——
 * ① 一段动画的**归属**只在取消被 SDK 接受之后交回（失败时保留 `current`，调用方可直接重试）；
 * ② 一段动画的**订阅**是本库自己的记账，不等 SDK 回调：起播被拒的那一段、以及卸载时的当前段，
 * 都当场释放。二者不冲突：归属问的是「谁还在播」，释放问的是「谁还该被观察」。
 */
import { onUnmounted, shallowRef, toRaw, type ShallowRef } from "vue";
import { resolveMapContext } from "./resolveMapContext";
import { BMapError } from "../core/errors/BMapError";
import { logger } from "../core/logger";
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
 * 一段在飞动画的现场：取消命令 + **这一段自己的**监听释放 + 「这条取消命令是否已经被接受」。
 *
 * 不按「当前那一段」共用一个释放槽位：`startViewAnimation` 会先同步取消上一段，
 * 上一段的 `animationcancel` 于是在新一段订阅完成之后才到达——共用槽位会被旧段摘掉新段的监听。
 * 同理，被取代那一段的订阅在 `start()` 里**当场**释放，而不是等那条 `animationcancel`：
 * 「Driver 起播前会同步取消上一段、SDK 会为此派发事件」目前只有 Fake 建模、没有真实运行时取证
 * （审计表 F-1），而这三条监听是本库自己的记账，不该由 SDK 是否回调来决定销账。
 *
 * `cancelCommitted` 把另外两件事分开：**「还在观察事件」**不等于**「还有资格再发一次地图级 stop」**。
 * 取消命令一旦被 SDK 接受，Driver 那边这笔账就结清了（记录已 settled 并移除），后续重试与销毁归它
 * 自己推进；本 hooks 若再发一次 `stopViewAnimation`，那是一张图上的**所有**动画都会停——包括别人的。
 */
interface AnimationRun {
  readonly stop: () => void;
  readonly release: () => void;
  /** `stop()` 是否正常返回过（= 取消命令已被接受，不再重复发地图级 stop）。 */
  cancelCommitted: boolean;
}

/** 地图（或整个 Client）已经没了：此时「取消动画」这个动作不成立，而不是失败。 */
const RUN_WITHOUT_MAP_ERRORS: ReadonlySet<string> = new Set([
  "BMAP_RESOURCE_DISPOSED",
  "BMAP_RUNTIME_DISPOSED",
]);

function isWithoutMapError(error: unknown): boolean {
  return error instanceof BMapError && RUN_WITHOUT_MAP_ERRORS.has(error.code);
}

export interface UseBMapViewAnimationReturn {
  /**
   * 播放一段关键帧动画。每次调用都新建一个动画实例，并接管仍在播的那一段，
   * 因此关键帧改了不必重建 composable。
   *
   * 接管**可能失败**：起播前 Driver 要先取消上一段，取消失败时它拒绝替换并保留记录以便重试，
   * 本方法随之 reject（上一段仍在播、仍可被 {@link cancel} 重试）。
   */
  start: (keyFrames: ViewAnimationKeyFrames[]) => Promise<void>;
  /**
   * 取消本 hooks 当前那一段播放（公开的 `cancelViewAnimation`）。没有在飞动画时什么都不做。
   *
   * 三点边界：① 取消是**地图级**命令，守卫只看 hooks 自己记的在飞段，因此不保证一定不牵连同图
   * 其它动画；② 取消命令**一旦被接受就不重复发**——同一 hooks 再调 `cancel()` 是 no-op，
   * 否则会把这张图上别人正在播的动画停掉；③ 取消失败时错误原样抛给调用方，本 hooks 保留
   * 这一段的归属，可以直接重试。`status` 要等 SDK 的 `animationcancel` 到达才变回 `idle`。
   */
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
   * 取消一段动画（公开的 `cancelViewAnimation`）。
   *
   * **归属只在取消被 SDK 接受之后才交回**：`MapDriver` 的契约是「取消失败时动画记录保留，下一次
   * `stopViewAnimation` / `destroy` 可重试」，因此失败时 `current` 必须仍指向这一段——否则 SDK 那边
   * 还在播，hook 却先丢掉了自己的重试入口（错误照原样抛给调用方，由他决定重试）。
   *
   * 成功时**不**在这里收尾：正常路径 `stopViewAnimation` 会同步派发 `animationcancel`，监听与状态
   * 由这一段自己的 `settle` 处理——提前释放监听就等于把 `status` 永远留在 `playing`。
   * 但会置 `cancelCommitted`：**「还在观察事件」与「还有资格再发一次地图级 stop」是两件事**；
   * 命令已被接受之后重复发 stop，停掉的会是这张图上任何一段动画（包括别的 hooks 刚起的）。
   * 地图已经不在了时只放行「地图没了」这一个原因，就地收尾（否则真故障会被静默成「已取消」）。
   */
  function stopRun(run: AnimationRun): void {
    if (run.cancelCommitted) return; // 这条取消已经打到 SDK 并被接受：不重复发地图级 stop
    try {
      run.stop();
    } catch (error) {
      if (isWithoutMapError(error)) {
        run.cancelCommitted = true;
        if (current === run) current = null;
        run.release();
        status.value = "idle";
        return;
      }
      throw error;
    }
    run.cancelCommitted = true;
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

    // **先建现场、再逐条绑定**：三条 `events.on` 里任何一条抛错时，已经绑上的那几条要有东西能释放。
    // （`run` 若声明在绑定之后，半途失败就没有任何人能下线已登记的订阅——回调也就不会在 `run`
    // 还是未初始化状态时被触发，这里靠声明顺序而不是 TDZ 来保证。）
    const offs: Array<() => void> = [];
    let startedObserved = false;
    const run: AnimationRun = {
      stop: () => driver.map.stopViewAnimation(mapHandle),
      release: () => {
        for (const off of offs) off();
      },
      cancelCommitted: false,
    };
    const settle = () => {
      run.release();
      if (current === run) current = null;
      // 已被下一段取代时不动状态：旧段的结算不能抹掉新段的「播放中」
      if (current === null) status.value = "idle";
    };
    try {
      offs.push(
        driver.events.on(animation, "animationstart", () => {
          startedObserved = true;
          if (current === run) status.value = "playing";
        }),
      );
      offs.push(driver.events.on(animation, "animationend", settle));
      offs.push(driver.events.on(animation, "animationcancel", settle));
    } catch (error) {
      run.release(); // 半途失败：已绑上的部分立刻下线
      throw error;
    }

    // **两阶段提交**：`startViewAnimation` 的第一步就是取消上一段，而它的契约是「取消失败 ⇒
    // 拒绝替换、旧记录保留可重试」。所以在新段真的被接受起播之前，既不能把 `current` 换成新段，
    // 也不能让旧段停止被观察——否则会出现「旧段还在播却没人看、新段从未起播却占着归属」。
    const previous = current;
    try {
      driver.map.startViewAnimation(mapHandle, animation);
    } catch (error) {
      // 新段从未起播：它的订阅立刻下线（本库自己的记账不等 SDK 回调）。`current` 保持原样——
      // 旧段仍在播就继续被观察、仍可被 `cancel()` 重试；它若已在刚才那次取消里结算完，
      // 是它自己的 `settle` 把 `current` 清成 null 的，不是这里。
      run.release();
      throw error;
    }
    current = run;
    // 起播已被接受：旧段的订阅当场下线（见 `AnimationRun` 的注释），不必等它的事件。
    previous?.release();
    // 起播事件早于本次提交到达时（SDK 若同步派发）补记一次观察，否则这段会被看成从没播过
    if (startedObserved) status.value = "playing";
  }

  function cancel(): void {
    if (disposed) return;
    const run = current;
    // 守卫只看本 hooks 有没有在飞段。取消本身是**地图级**命令（`cancelViewAnimation`），
    // 因此不保证一定不牵连同图其它动画；失败时 `stopRun` 保留归属，调用方可直接重试。
    if (run) stopRun(run);
  }

  onUnmounted(() => {
    disposed = true;
    const run = current;
    if (run) {
      try {
        // 地图销毁前**同步**取消（`<BMap>` 在父组件的 `onUnmounted` 里销毁地图，晚一步就跨过销毁线）
        stopRun(run);
      } catch (error) {
        // 取消失败：Driver 保留了动画记录，地图自己的销毁路径会重试。卸载钩子里没有调用方
        // 能接住这个错误，按现有诊断口径上报，而不是让它打断整个卸载。
        logger.warn(
          "useBMapViewAnimation: 卸载时取消视角动画失败，已交由地图销毁重试: " +
            ((error as Error)?.message ?? String(error)),
        );
      }
      // 卸载之后不再观察任何事件：本段订阅无条件下线
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
