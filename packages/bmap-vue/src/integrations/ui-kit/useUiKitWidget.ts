/**
 * UI Kit widget 的宿主 / 生命周期桥（R25-D / issue #73）
 *
 * 职责边界（刻意压到很小，见 AGENTS.md「不再建立 UI Driver/Runtime/EventBus 总体系」）：
 *
 * - **Vue 侧只做 host**：组件渲染一个容器 div，本模块负责「容器 + 已就绪的 Map + 释放路径」
 *   三件事，widget 的 DOM、建议列表、键盘导航、翻页与主题全部由官方 UI Kit 负责。
 * - **构造前提是硬前提**：四个 widget 都强制要求 `options.map`，而 `PlaceSearch` 在调用期
 *   真的会读 `map.getZoom()` / `map.getProjection()`，所以必须等 Map ready 后再构造，
 *   并且**跟随 map handle 换代重建**（换 Map 后旧 widget 拿着旧地图实例就是坏的）。
 * - **异步窗口处处设检查**：`whenReady()` 与 `loadUiKit()` 之间可能跨越组件卸载，
 *   每次 `await` 之后都要重新确认「本次创建仍是当前有效的那一次」（generation + scope），
 *   否则会出现「已经卸载了还在往宿主里塞 DOM」的泄漏。
 * - **解绑公开事件后 destroy**：释放顺序是 `off(每个已绑定事件)` → `destroy()`。
 *   上游 `destroy()` 会撤除自身 DOM 与它自己挂的 document 监听，但不会替我们摘掉
 *   我们注册的 handler；先 off 再 destroy 才不会留下指向已卸载组件的闭包。
 * - **坐标转换走 Driver**：`searchNearby` / `searchInBounds` 需要 raw Point（上游把它直接
 *   塞进请求），裸 `{ lng, lat }` 会被 SDK 的 `instanceof` 校验挡掉——因此由桥暴露
 *   `toRawPoint()`，内部经 `client.driver.geometry` 转换，组件不碰 raw SDK。
 */
import { onMounted, onUnmounted, ref, shallowRef, watch, type Ref, type ShallowRef } from "vue";
import { BMapError } from "../../core/errors/BMapError";
import { useRequiredMapContext } from "../../core/context/inject";
import { ResourceScope } from "../../core/lifecycle/ResourceScope";
import { unwrapRaw } from "../../driver/types/handles";
import { loadUiKit } from "./loadUiKit";
import { canonicalKey } from "./points";
import type {
  PlacePointDTO,
  UiKitModule,
  UiKitWidgetHandle,
  UiKitWidgetOptions,
  UiKitWidgetStatus,
} from "./types";

// 状态口径的**声明**在 types.ts（`./ui-kit` 的公共类型自持，见该文件文件头）；
// 这里转出去是为了让既有的 `useUiKitWidget` 导入点不必改。
export type { UiKitWidgetStatus };


/** 一条已登记的事件订阅，释放时按登记顺序 `off`。 */
export interface UiKitSubscription {
  event: string;
  handler: (...args: unknown[]) => void;
}

export interface UseUiKitWidgetOptions<TWidget extends UiKitWidgetHandle> {
  /** 组件名：用于错误上下文（`resource:error`）与 scope label。 */
  component: string;
  /** widget 的挂载容器（Vue 渲染出的 host）。 */
  host: Ref<HTMLElement | null>;
  /** 构造选项，不含 `map`（`map` 由桥注入且优先级最高）。 */
  buildOptions: () => Record<string, unknown>;
  /**
   * **构造期**选项（上游没有对应 setter 的那部分）；缺省表示「本组件没有构造期输入」。
   *
   * 给了它时：内容变化 → 重建 widget（口径与官方 react-bmap 的 `ctorKey` 一致：构造期参数进 key、
   * 其余走 setter），比较用的是稳定串，所以「每次渲染传新的对象字面量、内容相同」不会触发重建。
   *
   * **可选**（不是必填）：`useUiKitWidget` 从 #73 起就是公开导出，给一个必填字段等于让已有调用方
   * 升级后直接类型报错（PR #82 评审 P1）。缺省时桥不安装重建 watch，**也不回退去用 `buildOptions()`** ——
   * 因为 `buildOptions()` 里还包含**有 setter 的运行期选项**（例如 `PlaceAutocomplete` 的 `location`），
   * 拿它当重建依据会让「改城市」也重建，从而吃掉输入值 / 焦点 / 下拉展开状态。
   *
   * 为什么把这件事放在桥里：这是四个组件**共有**的一条语义（上游的构造期参数都没有 setter），
   * 各写一份的话，改重建口径要同时改四个 SFC，且很容易新写的组件漏掉。
   */
  constructorOptions?: () => Record<string, unknown>;
  /** 用已加载的模块与最终选项构造 widget。 */
  create: (module: UiKitModule, host: HTMLElement, options: UiKitWidgetOptions) => TWidget;
  /** 绑定公开事件；返回的订阅会在释放时逐条 `off`。 */
  bind?: (widget: TWidget) => readonly UiKitSubscription[];
}

export interface UseUiKitWidgetResult<TWidget extends UiKitWidgetHandle> {
  /** 当前存活的 widget；未就绪 / 已释放时为 `null`。 */
  readonly widget: ShallowRef<TWidget | null>;
  readonly status: Ref<UiKitWidgetStatus>;
  /**
   * 取当前 widget 并执行一段逻辑。
   *
   * 组件公开动作走这里：构造是异步的，所以动作**等待就绪**（而不是静默 no-op），
   * 并且在已释放时明确拒绝——「调了但什么都没发生」是最难排查的那类 bug。
   */
  withWidget<R>(run: (widget: TWidget) => R): Promise<Awaited<R>>;
  /**
   * 同步地在「当前已有 widget」时执行；未就绪时返回 `undefined`。
   *
   * 用于 prop → setter 的镜像：构造选项已经带上了当前值，未就绪时不需要补一次调用。
   */
  applyIfReady(run: (widget: TWidget) => void): void;
  /**
   * 按**当前**的 `buildOptions()` 重建 widget（先释放旧的、再构造新的）。
   *
   * 用于「构造期输入变了」的场景：上游构造期参数（placeholder / debounce / display…）没有
   * setter，改它们只能重建 —— 与官方 react-bmap 的 `ctorKey` 口径一致。已卸载后调用是 no-op。
   *
   * 语义说明：重建会**立即**释放旧 widget，因此已经在飞的公开动作可能落到已被销毁的实例上
   * （上游 `destroy()` 后调用哪些方法仍安全并未被验证）。需要严格串行的场景请在调用方自己排队，
   * 本库不承诺「重建期间动作继续可用」。
   */
  rebuild(): void;
  /** 纯数据坐标 → 当前地图引擎的 raw Point（经 Driver 转换，组件不接触 raw SDK）。 */
  toRawPoint(point: PlacePointDTO): Promise<unknown>;
}

interface Waiting<R> {
  resolve: (value: R) => void;
  reject: (error: unknown) => void;
}

export function useUiKitWidget<TWidget extends UiKitWidgetHandle>(
  options: UseUiKitWidgetOptions<TWidget>,
): UseUiKitWidgetResult<TWidget> {
  const ctx = useRequiredMapContext();
  const scope = new ResourceScope({ label: options.component });

  const widget: ShallowRef<TWidget | null> = shallowRef<TWidget | null>(null);
  const status = ref<UiKitWidgetStatus>("idle");

  /** 创建代数：每次 start 自增；await 之后必须仍是当前代数才允许落地。 */
  let generation = 0;
  /** 本次 start 的取消源：新的 start / 卸载会 abort 掉上一次仍在等 `whenReady()` 的等待。 */
  let startAbort: AbortController | null = null;
  /** 已登记的订阅，释放时逐条 off。 */
  let subscriptions: UiKitSubscription[] = [];
  /** 与当前 widget 同代的坐标转换函数（取自本次 ready 的 client）。 */
  let convertPoint: ((point: PlacePointDTO) => unknown) | null = null;
  /** 最近一次失败，用于把「等待中的动作」立刻拒掉。 */
  let failure: unknown = null;
  let waiters: Waiting<TWidget>[] = [];

  function settleWaiters(result: { widget: TWidget } | { error: unknown }): void {
    const pending = waiters;
    waiters = [];
    for (const waiter of pending) {
      if ("widget" in result) waiter.resolve(result.widget);
      else waiter.reject(result.error);
    }
  }

  const disposedError = (): BMapError =>
    new BMapError(
      "BMAP_RESOURCE_DISPOSED",
      `${options.component}: 组件已卸载，UI Kit 动作不再可用。`,
    );

  /** 释放顺序：先解绑我们注册的事件，再 destroy widget（上游负责撤 DOM 与自身监听）。 */
  function teardown(): void {
    const instance = widget.value;
    widget.value = null;
    convertPoint = null;
    const bound = subscriptions;
    subscriptions = [];
    if (!instance) return;
    for (const subscription of bound) {
      try {
        instance.off(subscription.event, subscription.handler);
      } catch {
        // 上游 off 抛错不应阻断销毁；销毁才是必须完成的那一步。
      }
    }
    instance.destroy();
  }

  function isCurrent(gen: number): boolean {
    return gen === generation && !scope.isDisposed;
  }

  function report(error: unknown, gen: number): void {
    if (!isCurrent(gen)) return;
    // 事件载荷与动作拒绝必须是**同一条**错误：否则「事件里看到的」与「await 拿到的」
    // 会不一样，排查时要重新拼线索。
    const wrapped =
      error instanceof BMapError
        ? error
        : new BMapError("BMAP_RESOURCE_CREATE_FAILED", `${options.component}: ${String(error)}`, {
            cause: error,
            component: options.component,
          });
    failure = wrapped;
    status.value = "error";
    ctx.events.emit("resource:error", { error: wrapped, component: options.component });
    settleWaiters({ error: wrapped });
  }

  /**
   * 构造（或重建）widget。
   *
   * 每次 map handle 换代、或组件调用 `rebuild()` 都会走一次：先 `teardown()` 掉旧 widget，
   * 再等新的 map 就绪后重建。
   *
   * 有两条守卫，缺一都会在「连续触发」下出问题：
   * - **generation**：`await` 之后必须仍是当前代数才允许落地，否则并发 start 会各自构造一份；
   * - **本轮的 AbortController**：新一次 start（或卸载）会取消上一次仍在等的 `whenReady()`，
   *   否则地图就绪前连续变更会累积一堆没人认领的等待者。
   */
  async function start(): Promise<void> {
    startAbort?.abort("restart");
    const controller = new AbortController();
    startAbort = controller;

    const gen = ++generation;
    // 重建期间不清空 waiters：它们等的是「widget 可用」，不是「这一次创建结束」。
    teardown();
    failure = null;
    status.value = "loading";

    try {
      const ready = await ctx.whenReady(controller.signal);
      if (!isCurrent(gen)) return;

      const module = await loadUiKit();
      if (!isCurrent(gen)) return;

      const host = options.host.value;
      if (!host) {
        throw new BMapError(
          "BMAP_INVALID_ARGUMENT",
          `${options.component}: 挂载容器不存在，无法构造 UI Kit widget。`,
        );
      }

      // 从这里到 widget 落地之间**没有 await**：进程内不可能插入卸载或 map 换代，
      // 因此「卸载后仍然构造」只可能发生在上面两个 await 之前/之间，已由 isCurrent() 拦住。
      // `map` 放在展开之后：即便 buildOptions 里带了 map，也不允许覆盖已就绪的 handle。
      const instance = options.create(module, host, {
        ...options.buildOptions(),
        map: unwrapRaw(ready.map),
      });

      // 逐条绑定并**逐条记账**：只有 `on` 成功之后才登记，失败时才能精确解绑「真的绑上过」的那些。
      const bound: UiKitSubscription[] = [];
      try {
        for (const candidate of options.bind ? options.bind(instance) : []) {
          instance.on(candidate.event, candidate.handler);
          bound.push(candidate);
        }
      } catch (error) {
        // 绑定中途失败必须走**同一条释放路径**（先 off 已绑的、再 destroy）：
        // 否则会留下一个「半绑定且看起来可用」的实例——`whenWidgetReady()` 会直接把它交出去。
        widget.value = instance;
        subscriptions = bound;
        teardown();
        throw error;
      }

      const geometry = ready.client.driver.geometry;
      convertPoint = (point) => geometry.toRawPoint(point);
      widget.value = instance;
      subscriptions = bound;
      status.value = "ready";
      settleWaiters({ widget: instance });
    } catch (error) {
      report(error, gen);
    }
  }

  onMounted(() => {
    void start();
  });

  // 构造期输入变化 → 重建（上游没有对应 setter，静默保留旧值等于骗调用方）。
  // 语义只有这一份：四个组件都靠它，不再各自 watch。缺省（老调用方）时不安装，语义与 #73 一致。
  if (options.constructorOptions) {
    const readConstructorOptions = options.constructorOptions;
    watch(
      () => canonicalKey(readConstructorOptions()),
      () => {
        rebuild();
      },
    );
  }

  // 换 Map：`<Map>` 的 runtime 被重建（retry / 重新初始化）时 map handle 会换代，
  // 旧 widget 仍握着旧地图实例 —— 必须重建，否则 PlaceSearch 会对着失效的地图取视野。
  watch(
    () => ctx.map.value,
    () => {
      if (scope.isDisposed) return;
      void start();
    },
  );

  scope.add(() => {
    teardown();
  });

  onUnmounted(() => {
    generation += 1;
    startAbort?.abort("disposed");
    startAbort = null;
    if (waiters.length > 0) settleWaiters({ error: disposedError() });
    scope.dispose();
    status.value = "disposed";
  });

  function whenWidgetReady(): Promise<TWidget> {
    if (widget.value) return Promise.resolve(widget.value);
    if (scope.isDisposed) return Promise.reject(disposedError());
    if (failure) return Promise.reject(failure);
    return new Promise<TWidget>((resolve, reject) => {
      waiters.push({ resolve, reject });
    });
  }

  async function withWidget<R>(run: (instance: TWidget) => R): Promise<Awaited<R>> {
    const instance = widget.value ?? (await whenWidgetReady());
    // 上游的 `search` / `searchNearby` / `searchInBounds` 自身返回 Promise，
    // 而 `getInputValue` 等是同步取值；统一按 `await` 的语义收口（这正是 async 函数的行为）。
    return (await run(instance)) as Awaited<R>;
  }

  function applyIfReady(run: (instance: TWidget) => void): void {
    const instance = widget.value;
    if (instance) run(instance);
  }

  async function toRawPoint(point: PlacePointDTO): Promise<unknown> {
    await whenWidgetReady();
    if (!convertPoint) throw disposedError();
    return convertPoint(point);
  }

  function rebuild(): void {
    if (scope.isDisposed) return;
    void start();
  }

  return { widget, status, withWidget, applyIfReady, rebuild, toRawPoint };
}
