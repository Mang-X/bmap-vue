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
 * 收敛到 `idle` 有两条途径：① 该段自己的 `animationend` / `animationcancel`；② 本库**自己确认过的
 * 取消交付**（`cancelViewAnimation` 返回 `canceled` / `already-settled`）——不能拿那条没取证的
 * 事件（#104 F-1）当唯一判据。**例外只在取消这一条路上**：让位给新段、取消仍未交付的旧段，
 * 仍然只能靠它自己的事件收尾，`cancel()` 不会替它乐观地改状态。
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
 * 接管时本库**自己先按实例取消上一段**，于是「交付没交付」是当场知道的事实：已交付就立刻释放它的
 * 订阅（不等那条 `animationcancel` —— F-1 说这条时序没有取证），未交付（`deferred`）就把订阅留着，
 * 由 `undelivered` 继续持有到终态。
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
   * 播放一段关键帧动画。每次调用都新建一个动画实例，并先按实例取消上一段，
   * 因此关键帧改了不必重建 composable。
   *
   * 接管**可能失败**：取消上一段的命令真的打到 SDK 却失败时（例如它的延迟取消刚刚失败过），
   * 本方法直接 reject —— 上一段仍是当前观察对象、继续被观察，稍后重试 {@link start} 或
   * {@link cancel} 即可；本次新建实例的订阅在失败路径里已经下线，不会留下第二次尝试的残留。
   * 上一段只是**还没进启动安全窗口**（Driver 报 `deferred`）不算失败：那次取消会被登记下来，
   * 新段照常起播，旧段仍留在本 hooks 的重试入口里直到交付终态。
   */
  start: (keyFrames: ViewAnimationKeyFrames[]) => Promise<void>;
  /**
   * 取消本 hooks 当前那一段播放（公开的 `cancelViewAnimation`）。没有在飞动画时什么都不做。
   *
   * 边界：① 命令按**实例**发，只停本 hooks 自己起播的那一段，同一张图上别人的动画不受影响；
   * ② 上一次取消还**没进安全窗口**（只登记了请求）时，再调一次会真的重试；已经交付过之后再调是
   * 幂等收尾，不会重复打到 SDK；③ 取消失败时错误原样抛给调用方，本 hooks 保留观察对象与重试入口
   * —— 一次调用里**每一段只拿一次重试机会**（当前段与未交付的旧段重合时也不重复尝试），
   * 所以「抛错」就等于「这一次确实没交付、还可以再试」；
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
  /**
   * 已经让位给新段、但取消**尚未交付**的旧段（Driver 报 `"deferred"`：还没进启动安全窗口，
   * 那次取消只是被登记）。它们仍然归本 hooks 所有：监听留着（到终态自己收），`cancel()` 与
   * 卸载也继续负责把它们推到终态 —— 否则「旧段到底停没停」就成了没人管的事（#105 第八轮 P1）。
   * 正常情形下这个集合要么空、要么一条，且下一刻就被 `animationcancel` 收掉。
   */
  const undelivered = new Set<AnimationRun>();

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
    if (outcome === "deferred") {
      undelivered.add(run); // 未交付：继续由本 hooks 持有并重试
      return;
    }
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
    undelivered.delete(run);
    run.release();
    if (current !== run) return;
    current = null;
    status.value = "idle";
  }

  /**
   * 本 hooks 名下的在飞段：当前观察对象 + 取消仍未交付的旧段。
   *
   * 必须去重：对**当前段**取消并得到 `"deferred"` 时，该段既是 `current` 又在 `undelivered` 里
   * （`stopRun` 不改 `current`）。不去重的话一次公开 `cancel()` 会把同一段放进快照两次，
   * 于是「第一次重试抛错、同一次调用里第二份又偷偷重试成功并收尾」——调用方收到「取消失败」，
   * 而动画其实已经结算完毕。一次公开调用给每段**恰好一次**重试机会，才让抛错可被据此判断。
   */
  function ownedRuns(): AnimationRun[] {
    return [...new Set(current ? [current, ...undelivered] : undelivered)];
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

    // **两阶段提交**：接管与起播都在同一个守卫里 —— 任一步失败，新段的订阅立刻下线、`current`
    // 保持原样（旧段仍在播就继续被观察、仍可被 `cancel()` 重试）。
    // 接管**先按实例**取消上一段：这样「交付没交付」是本库当场知道的事实，而不是等一条事件去猜；
    // 未交付（`deferred`）的那一段留在 `undelivered` 里继续归本 hooks 管（#105 第八轮 P1）。
    const previous = current;
    try {
      if (previous) stopRun(previous);
      driver.map.startViewAnimation(mapHandle, animation);
    } catch (error) {
      run.release();
      throw error;
    }
    current = run;
    // 已交付的旧段在 `stopRun` 里就收尾完了；未交付的那一段仍留在 `undelivered` 里被观察着。
    // 起播事件早于本次提交到达时（SDK 若同步派发）补记一次观察，否则这段会被看成从没播过
    if (startedObserved) status.value = "playing";
  }

  function cancel(): void {
    if (disposed) return;
    // 只碰本 hooks 自己起播过的段：当前段 + 取消仍未交付的旧段，逐条**按实例**取消。
    // 每一条都拿到自己的重试机会（失败的先攒着），最后把第一个失败抛给调用方。
    const runs = ownedRuns();
    // 当前段与未交付的旧段**一起**处理：调用方一次 `cancel()` 就是把本 hooks 名下的播放全停掉，
    // 于是 B 被取消的同时 A 也被推进一步，而两者互不牵连。
    const failures: unknown[] = [];
    for (const run of runs) {
      try {
        stopRun(run);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 0) return;
    if (failures.length > 1) {
      // 一次调用只能抛出一个错误，其余的不能悄悄丢掉：按同一条诊断通道报出来
      logger.warn(
        `useBMapViewAnimation: 一次 cancel() 里有 ${failures.length} 条取消失败，` +
          "只抛出第一个，其余经 resource:error 交出",
      );
      for (const error of failures.slice(1)) reportTeardownFailure(error);
    }
    throw failures[0];
  }

  onUnmounted(() => {
    disposed = true;
    // 地图销毁前**同步**取消（`<BMap>` 在父组件的 `onUnmounted` 里销毁地图，晚一步就跨过销毁线）：
    // 当前段与「取消尚未交付」的旧段都要试一把；失败时不打断卸载，但必须可观测——
    // `logger.warn` 在 production 构建里会被折叠掉，只靠它等于把失败咽回去（#105 评审第五轮）。
    const runs = ownedRuns();
    for (const run of runs) {
      try {
        stopRun(run);
      } catch (error) {
        logger.warn(
          "useBMapViewAnimation: 卸载时取消视角动画失败，已交由地图销毁重试: " +
            ((error as Error)?.message ?? String(error)),
        );
        reportTeardownFailure(error);
      }
      // 卸载之后不再观察任何事件：这一段的订阅无条件下线
      run.release();
    }
    undelivered.clear();
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
