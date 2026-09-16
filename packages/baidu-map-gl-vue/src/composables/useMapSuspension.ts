/**
 * 容器门禁与可见性暂停策略（M4-HANDLE-UX / issue #29）
 *
 * 这一个 composable 同时承担两件事，**刻意不拆成两个**：
 *
 * 1. **容器门禁**：容器拿到非零尺寸之前不建图；「不可用 → 可用」**每次**都会放行回调一次
 *    （不只首次 —— 折叠后重新展开要能接续挂起的 retry，且已就绪的地图要靠这次转换补一次
 *    `checkResize`，#29 复审 P1）；
 * 2. **可见性策略**：把「页面前后台 / 元素是否在视口附近 / 减少动画偏好」翻译成暂停原因。
 *
 * 拆开的代价是同一容器上会出现两套尺寸观察器（issue #29 的评论明确禁止：「只需要宽高状态时
 * 可评估 `useElementSize`，**不要对同一容器重复建立两套尺寸观察器**」），而且「门禁放行」与
 * 「暂停 / 补偿 `checkResize`」都挂在同一条尺寸变化路径上，拆开就必须在两处各自去重。
 *
 * ## 环境信息与决策分离（issue 评论的边界）
 *
 * | 层 | 谁负责 | 产物 |
 * | --- | --- | --- |
 * | 环境采集 | VueUse（`useResizeObserver` / `useIntersectionObserver` / `useDocumentVisibility` / `usePreferredReducedMotion`） | 尺寸与三个布尔信号 |
 * | 决策 | 本项目（`MapRuntime` 的暂停原因集合） | `document` / `offscreen` 两个原因的增删 |
 *
 * 采集与决策不混在一起，是因为「谁的暂停生效」是发布契约（见 ADR
 * `2026-09-14-map-handle-container-and-visibility`），而观察器实现可以换。
 *
 * ## 生命周期：detached scope + 显式 `dispose()`（释放点唯一、顺序确定）
 *
 * 四个观察器 / 订阅与一个只读 computed 都跑在一个 `effectScope(true)`（detached scope）里，
 * 释放只由 `dispose()` 触发。如此选择的两个实际收益：
 *
 * 1. **释放点唯一**：不依赖「Vue 顺手帮我在组件作用域停止时收尾」，因此没有第二条释放路径
 *    可以漂移（对照：`#27` / `#28` 冻结的「收敛 / 同步路径只能有一条」）；
 * 2. **顺序确定**：`<BMap>` 的 `onUnmounted` 注册顺序保证「先 `suspension.dispose()`（断源），
 *    再 `runtime.dispose()`」—— 反过来会让观察器在 Runtime 已经 disposed 之后仍尝试请求
 *    `checkResize`（虽然那时会被短路，但「先断源再收尾」是能自证的一步）。
 *
 * 代价要说清：**组件卸载即释放**，而「地图实例」在 `retry()` 之后会换新的（旧的被销毁）。
 * 对本控制器没有影响 —— 它观察的是**容器元素**，而容器在整个组件生命周期里是同一个
 * （`<BMap>` 的根 div），与地图实例的换新无关。
 *
 * 释放之后（`dispose()`）迟到的观察器回调一律被忽略（`disposed` 门闩），因此不会再触发
 * `checkResize` 或 SDK 调用 —— 这条对应验收「disposed 后不再调 SDK」。
 */
import {
  computed,
  effectScope,
  shallowRef,
  watch,
  type ComputedRef,
  type ShallowRef,
} from "vue";
import {
  useDocumentVisibility,
  useIntersectionObserver,
  usePreferredReducedMotion,
  useResizeObserver,
} from "@vueuse/core";
import {
  isUsableSize,
  readElementSize,
  sizeEquals,
  type ElementSize,
} from "../core/runtime/elementSize";
import { MAP_SUSPEND_REASONS, type MapSuspendReason } from "../core/runtime/suspension";

/**
 * 视口判定向外扩的安全边。
 *
 * 「接近视口」也算可见：展开动画的中间帧会让元素短暂地只露出一部分，不留边会让暂停 / 恢复
 * 在动画期间反复抖动。也正因为有这条边，「离开视口」只会在真的滚远之后成立 —— 与 issue
 * 的非目标「不默认在离开视口时销毁 WebGL Map」方向一致（我们连暂停都是保守的）。
 */
const VIEWPORT_MARGIN = "64px";

/**
 * 策略要用的运行时能力（结构类型，不依赖 `MapRuntime` 这个类）。
 *
 * 只声明「策略真的会调用」的四项，`<BMap>` 传进来的就是 `MapRuntime`：
 * 这样策略的用例可以拿一个最小替身跑，不必搭出完整 Runtime。
 */
export interface MapSuspensionTarget {
  /** 合帧请求一次尺寸校正；暂停 / 未就绪时由实现自行短路。 */
  requestResize(): void;
  /** 加一个暂停原因（幂等）。 */
  suspend(reason: MapSuspendReason): void;
  /** 减一个暂停原因（只有集合变空才真正恢复）。 */
  resume(reason: MapSuspendReason): void;
  /** 当前生效的暂停原因（活读数，供 `suspendedReasons` 透出）。 */
  readonly suspension: ShallowRef<readonly MapSuspendReason[]>;
}

export interface UseMapSuspensionOptions {
  target: MapSuspensionTarget;
  /**
   * **被观察**的元素：决定可视尺寸的那一个（`<BMap>` 的根容器）。
   *
   * 它不一定等于建图用的容器：组件内部还有一个 `position: absolute; inset: 0` 的宿主节点，
   * 尺寸由根容器决定。把两者写成一个 getter 会掩盖「测量谁」这个选择，所以这里单独命名。
   *
   * 容器会替换（外层重新渲染）时，getter 必须读**响应式来源**（如 `() => ref.value`）：
   * 观察器跟着 getter 的依赖换元素并断开旧的。读一个普通变量不会被察觉 —— 旧观察器会
   * 留在旧元素上（用例 `容器引用替换：旧元素的信号不再进来，旧观察器被断开` 钉住这一点）。
   */
  measure: () => HTMLElement | null;
  /**
   * 容器**每次**从「不可用」变为「可用」时回调（放行建图）。
   *
   * 不是「只回调一次」：折叠（0×0）后重新展开也要回调，否则「收起期间调用 `retry()`」这类
   * 请求会永远等不到门禁（#29 评审 P2）。调用方负责幂等。
   */
  onContainerReady: () => void;
  /**
   * 容器尺寸变化时是否自动重设地图尺寸（对应 `enableAutoResize`，缺省视为 `true`）。
   *
   * 返回 `false` 时只更新读数、不请求 `checkResize`：调用方要自己调 `checkResize()`。
   */
  autoResize?: () => boolean;
}

export interface MapSuspensionController {
  /**
   * 容器门禁是否**曾经**放行（只增的 latch）。
   *
   * 「地图建好之后容器又变成 0」不算门禁被取消（ADR 决策 4：那种情况不销毁地图），
   * 因此它不会回退。需要「**当前**能不能建图」时读 `size` + `isUsableSize()` ——
   * `<BMap>` 的 `beginMount()` / `retry()` 就是这么做（#29 评审 P2）。
   */
  readonly containerReady: Readonly<ShallowRef<boolean>>;
  /** 最近一次测得的容器尺寸（`null` = 还没测量过 / 读不到）。 */
  readonly size: Readonly<ShallowRef<ElementSize | null>>;
  /** 页面是否可见（`document.visibilityState !== "hidden"`）。 */
  readonly documentVisible: Readonly<ShallowRef<boolean>>;
  /**
   * 容器是否在视口附近。
   *
   * 初值 `true`（乐观）：观察器给出明确结论之前不暂停。这条「未知不当作不可见」的选择让
   * 不支持 IntersectionObserver 的环境与首帧都退化成「什么都不暂停」。
   */
  readonly intersectVisible: Readonly<ShallowRef<boolean>>;
  /** 「减少动画」偏好（只读信号，**不**参与暂停）。 */
  readonly reducedMotion: Readonly<ShallowRef<boolean>>;
  /** 当前生效的暂停原因快照（与运行时的读数同源）。 */
  readonly suspendedReasons: ComputedRef<readonly MapSuspendReason[]>;
  /** 挂载后调用一次：同步测量、放行门禁（观察器要等一个 post-flush 才建立）。 */
  begin(): void;
  /** 释放全部观察器 / 订阅；之后迟到的回调一律忽略。 */
  dispose(): void;
}

export function useMapSuspension(options: UseMapSuspensionOptions): MapSuspensionController {
  const size = shallowRef<ElementSize | null>(null);
  const containerReady = shallowRef(false);
  const documentVisible = shallowRef(true);
  const intersectVisible = shallowRef(true);
  const reducedMotion = shallowRef(false);
  const scope = effectScope(true);
  let disposed = false;

  /** 统一的读数入口：观察器只当**触发器**，取值始终走 `readElementSize`。 */
  function measure(): ElementSize | null {
    return readElementSize(options.measure());
  }

  function applySize(next: ElementSize | null): void {
    if (disposed) return;
    if (sizeEquals(size.value, next)) return;
    const wasUsable = isUsableSize(size.value);
    size.value = next;
    const usable = isUsableSize(next);

    if (usable && !wasUsable) {
      // 「不可用 → 可用」：放行建图。**每次**这种转换都回调（不只是第一次）—— 评审 P2 指出
      // 「收起期间调用 retry()」不能被一次性 latch 挡住：容器重新展开时必须能接着放行。
      // 调用方负责幂等（`<BMap>` 用「当前尺寸 + 是否有人要求重试」判断，重复调用是 no-op）。
      //
      // 这里**不 return**：同一次转换对「已经就绪的地图」还意味着「容器尺寸回来了，去校正尺寸」
      // （#29 复审 P1：`ready(320) → 0×0 → 320` 若只放行不请求 resize，就违背了
      // 「恢复尺寸后由 checkResize() 纠正」这条承诺）。首次挂载那一次会走到下面的
      // `requestResize()`，而目标自己按「是否就绪」短路（`MapRuntime.requestResize` 要求 status
      // 为 `ready`），因此建图前是 no-op、不会多发命令。
      containerReady.value = true;
      options.onContainerReady();
    }
    if (!usable) {
      // 「可用 → 不可用」：什么都不做 —— 地图已存在时不销毁、也不请求 resize（ADR 决策 4），
      // 恢复到非零尺寸时由上面那条分支 + 下面的 `requestResize()` 补一次校正。
      return;
    }
    if (options.autoResize?.() === false) return;
    options.target.requestResize();
  }

  function applyIntersect(next: boolean): void {
    if (disposed || intersectVisible.value === next) return;
    intersectVisible.value = next;
    if (next) options.target.resume(MAP_SUSPEND_REASONS.offscreen);
    else options.target.suspend(MAP_SUSPEND_REASONS.offscreen);
  }

  function applyDocumentVisible(next: boolean): void {
    if (disposed || documentVisible.value === next) return;
    documentVisible.value = next;
    // 注意方向：恢复可见**只移除 document 原因**，不能碰 `user` / `keep-alive`（误恢复门禁）
    if (next) options.target.resume(MAP_SUSPEND_REASONS.document);
    else options.target.suspend(MAP_SUSPEND_REASONS.document);
  }

  /** 当前生效的暂停原因快照（与运行时的读数同源；在 scope 里建，随 `dispose()` 一起停）。 */
  let suspendedReasons!: ComputedRef<readonly MapSuspendReason[]>;

  scope.run(() => {
    suspendedReasons = computed(() => options.target.suspension.value);

    // 尺寸：观察器只负责「什么时候变化」，取值仍走同一份读数函数（含 border-box 语义）。
    useResizeObserver(options.measure, () => applySize(measure()), { box: "border-box" });

    useIntersectionObserver(
      options.measure,
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        applyIntersect(entry.isIntersecting);
      },
      { rootMargin: VIEWPORT_MARGIN, threshold: 0 },
    );

    // 页面前后台：初值同步一次（挂载时页面可能本来就是隐藏的）。
    const visibility = useDocumentVisibility();
    watch(visibility, (value) => applyDocumentVisible(value !== "hidden"), {
      immediate: true,
      // **同步**生效：这两个信号都是低频的（切换标签页 / 改系统偏好），而「信号到了但原因还没
      // 记上」会让同一 tick 内的容器变化仍然排一次帧 —— 那是要靠时序测试才能发现的偏差。
      // 同步之后契约是「信号到达即生效」，用例也就不需要靠 await 微任务来对齐。
      flush: "sync",
    });

    // 减少动画：只更新只读信号，**不**参与暂停（「不误停必要任务」）。
    const motion = usePreferredReducedMotion();
    watch(
      motion,
      (value) => {
        reducedMotion.value = value === "reduce";
      },
      { immediate: true, flush: "sync" },
    );
  });

  return {
    containerReady,
    size,
    documentVisible,
    intersectVisible,
    reducedMotion,
    suspendedReasons,
    begin: () => applySize(measure()),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      scope.stop();
    },
  };
}
