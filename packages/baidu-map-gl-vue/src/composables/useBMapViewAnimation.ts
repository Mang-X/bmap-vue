/**
 * useBMapViewAnimation —— 视角关键帧动画
 *
 * 只封装官方公开面：`services.createViewAnimation()` 建实例、`map.startViewAnimation()` 播放、
 * `map.cancelViewAnimation(map, animation)` 取消（官方 `Map#cancelViewAnimation` 就是按实例的命令）。
 *
 * 没有 `pause` / `resume`：4.0 上实例级的暂停/继续只有私有成员（旧实现调 `_pause` / `_continue`），
 * 本仓库对 Map 级 `pauseViewAnimation` / `continueViewAnimation` 也没有真实运行时取证。按 #104
 * 的 official-first 与 evidence-first 两条约束，**不**用私有面伪造一个 Stable 能力。
 *
 * `status` 是**观察值**：由公开的 `animationstart` / `animationend` / `animationcancel` 写，
 * 命令本身不乐观改写它 —— 「发起了播放但 SDK 一次都没回调」会如实停在 `idle`。
 * 唯一的例外是本库**自己确认过的取消交付**：`cancelViewAnimation` 报告这一次已经打到 SDK
 * （`canceled` / `already-settled`）时状态收敛到 `idle`，不再等那条可能不来的 `animationcancel`
 * （#104 F-1 说的是那条事件的时序没有取证，不能拿它当所有权判据）。
 *
 * 取消**不等微任务**：`<BMap>` 在父组件的 `onUnmounted` 里销毁地图，而子树卸载发生在那之前——
 * 同步调用还能看到活的地图，跨一个微任务就已经跨过销毁线了（旧实现的 `void getReady().then(...)`
 * 因此每次卸载都抛一个没人接的 `BMAP_RESOURCE_DISPOSED`）。
 *
 * 取消命令按**实例**发（`driver.map.cancelViewAnimation(map, animation)`，官方
 * `Map#cancelViewAnimation(viewAnimation)` 本来就是这个形状）。这一点决定了三件事可以分开：
 * ① **观察对象**（`current`）：哪一段还被本 hooks 看着，`status` 只由它的公开事件与本库自己
 *    确认过的取消交付写；
 * ② **订阅**：本库自己的记账，不等 SDK 回调 —— 起播被拒、半途绑定失败、卸载这三种情形当场释放；
 * ③ **重试入口**：Driver 报告 `"deferred"`（还没进安全窗口，只登记了取消请求）时**保留**，
 *    下一次 `cancel()` 会真的再打一次；已交付（`"canceled"` / `"already-settled"`）时收尾且不重复发。
 * 之前用整张图的 `stopViewAnimation(map)` 时，② 与 ③ 会互相牺牲（重试必牵连别人的动画 / 不重试就
 * 失去入口），#105 第三轮与第六轮各打中过一次；换成按实例之后两者同时成立。
 */
import { onUnmounted, shallowRef, toRaw, type ShallowRef } from "vue";
import { resolveMapContext } from "./resolveMapContext";
import { BMapError } from "../core/errors/BMapError";
import { logger } from "../core/logger";
import type { MapReadyContext } from "../core/context/types";
import type { MapHandle, ServiceHandle } from "../driver/types/handles";
import type { ViewAnimationCancelOutcome } from "../driver/types/map";

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
 * 一段在飞动画的现场：按实例的取消命令 + 这一段自己的监听释放。
 *
 * 不按「当前那一段」共用一个释放槽位：`startViewAnimation` 会先同步取消上一段，
 * 上一段的 `animationcancel` 于是在新一段订阅完成之后才到达——共用槽位会被旧段摘掉新段的监听。
 * 同理，被取代那一段的订阅在 `start()` 里**当场**释放，而不是等那条 `animationcancel`：
 * 「Driver 起播前会同步取消上一段、SDK 会为此派发事件」目前只有 Fake 建模、没有真实运行时取证
 * （审计表 F-1），而这三条监听是本库自己的记账，不该由 SDK 是否回调来决定销账。
 *
 * 取消只碰**自己这个实例**，所以「重试自己那一次」天然不会停掉同一张图上别人的动画。
 * 返回值是 Driver 侧的交付状态（`canceled` / `deferred` / `already-settled`），本库据此决定
 * 是收尾还是保留重试入口 —— 不猜 SDK 有没有回调。
 */
interface AnimationRun {
  readonly stop: () => ViewAnimationCancelOutcome;
  readonly release: () => void;
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
   * 边界：① 命令按**实例**发，只停本 hooks 自己起播的那一段，同一张图上别人的动画不受影响；
   * ② 上一次取消还**没进安全窗口**（只登记了请求）时，再调一次会真的重试；已经交付过之后再调是
   * 幂等收尾，不会重复打到 SDK；③ 取消失败时错误原样抛给调用方，本 hooks 保留观察对象与重试入口。
   * `status` 由公开事件写；取消交付被本库确认后（`canceled` / `already-settled`）也会收敛到 `idle`，
   * 不等那条可能不来的事件。
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
   * 取消一段动画（按实例的 `cancelViewAnimation`）。三种交付各走各的：
   *
   * - 抛错（SDK 取消失败）：错误原样给调用方，观察对象与重试入口都留着 —— Driver 保留了记录，
   *   下一次 `cancel()` 就是真重试；
   * - `"deferred"`（还没进安全窗口，只登记了取消请求）：**不是「已停止」**，所以同样留着入口，
   *   本方法不做任何收尾；
   * - `"canceled"` / `"already-settled"`：本库这一侧已经把它交付完了 ⇒ 就地收尾（释放监听 + 清观察对象
   *   + `idle`）。正常路径下 `animationcancel` 已经在这之前把这三件事做过一遍，这里是幂等重放；
   *   而那条事件没来时（F-1 说这无法取证）也不再需要靠它才能交回所有权。
   *
   * 地图已经不在了时只放行「地图没了」这一个原因，就地收尾（否则真故障会被静默成「已取消」）。
   */
  function stopRun(run: AnimationRun): void {
    let outcome: ViewAnimationCancelOutcome;
    try {
      outcome = run.stop();
    } catch (error) {
      if (isWithoutMapError(error)) {
        finishRun(run);
        return;
      }
      throw error;
    }
    if (outcome === "deferred") return;
    finishRun(run);
  }

  /**
   * 一段动画在本库这一侧结束：先释放它**自己的**订阅；只有它仍是本 hooks 的观察对象时，才清
   * `current` 并把状态收敛到 `idle`。
   *
   * 这个身份守卫是必须的：`status` 与 `current` 是**本 hooks 一份**的共享量，而被接管、已收尾的旧段
   * 也可能走到这里（交付确认、地图已销毁这两条路径）。不加守卫，旧段的收尾就会把后一段刚观察到的
   * `playing` 抹成 `idle` —— 与 `settle` 里那句「旧段的结算不能抹掉新段的播放中」是同一条不变量，
   * 现在两处共用一个收口。幂等：重复调用不再改动已经推进过的状态。
   */
  function finishRun(run: AnimationRun): void {
    run.release();
    if (current !== run) return;
    current = null;
    status.value = "idle";
  }

  /**
   * 卸载期取消失败的诊断出口：与本库其它释放路径同一条通道（`resource:error`），
   * 便于宿主在 `onUnmounted` 之外仍然看到「这段动画没被我们停掉」。
   * 总线自己已经停用时不再追究——不能为了报错再抛一次错。
   */
  function reportTeardownFailure(error: unknown): void {
    try {
      ctx.events.emit("resource:error", {
        error:
          error instanceof BMapError
            ? error
            : new BMapError("BMAP_SDK_CALL_FAILED", String(error), { cause: error }),
        component: "useBMapViewAnimation",
      });
    } catch {
      /* 事件总线已停用时不再追究 */
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

    // **先建现场、再逐条绑定**：三条 `events.on` 里任何一条抛错时，已经绑上的那几条要有东西能释放。
    // （`run` 若声明在绑定之后，半途失败就没有任何人能下线已登记的订阅——回调也就不会在 `run`
    // 还是未初始化状态时被触发，这里靠声明顺序而不是 TDZ 来保证。）
    const offs: Array<() => void> = [];
    let startedObserved = false;
    const run: AnimationRun = {
      // 按实例取消：只碰这一段自己的记录，同一张图上别人的动画不受影响
      stop: () => driver.map.cancelViewAnimation(mapHandle, animation),
      release: () => {
        for (const off of offs) off();
      },
    };
    // 事件到 = 这一段的播放在公开面上结束了：与「取消交付确认」共用同一个收口
    const settle = () => finishRun(run);
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
    // 取消按**实例**发：只碰本 hooks 自己起播的那一段，同一张图上别人的动画不受影响。
    // `stopRun` 按 Driver 报回的交付状态决定收尾还是保留重试入口（失败时错误给调用方）。
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
        // 能接住这个错误，所以既要**不**打断卸载，又要让它**可观测**——`logger.warn` 在
        // production 构建里会被折叠掉，只靠它等于把失败咽回去（#105 评审第五轮）。
        logger.warn(
          "useBMapViewAnimation: 卸载时取消视角动画失败，已交由地图销毁重试: " +
            ((error as Error)?.message ?? String(error)),
        );
        reportTeardownFailure(error);
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
