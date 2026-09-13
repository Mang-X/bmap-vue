/**
 * UI Kit 组件的测试夹具（R25-D / issue #73）
 *
 * 这一组用例要覆盖的是**异步窗口与所有权**，而不是 widget 内部行为（那是上游的事，
 * 由 #70 的真实探针 + 上游自己的测试负责）。因此夹具刻意做三件事：
 *
 * 1. **可控的 Map ready**：`whenReady()` 在真实实现里会跨越一次 SDK 加载，本夹具把它做成
 *    显式兑现的等待队列（并支持 abort，与 `MapRuntime.whenReady` 的语义一致），
 *    用于构造「ready 之前卸载」「换 Map 时重建」这类竞态。
 * 2. **会记账的假 widget**：按 `on` / `off` / `destroy` 与宿主 DOM 逐条记账，让
 *    「先解绑再销毁」「卸载后不构造」「宿主 DOM 被撤走」这些断言有可观察的落点。
 *    记账同时带**正证守卫**：用例先断言 `onCount > 0`（构造期确实绑过事件），
 *    再断言 `offCount === onCount`，否则一条根本没接上事件的用例会静默通过。
 * 3. **client / driver 的属性访问记账**：验收要求「单次交互不重复发出 UI / headless 两套请求」。
 *    headless 检索的唯一入口是 `client.driver.services`，因此把它做成会记账的 Proxy，
 *    用例即可断言「整条链路只碰过 `driver.geometry`，从未读过 `services`」——
 *    这比「读源码没看到关键字」有落点得多（raw SDK 也可能绕过去）。
 *
 * widget 的成员签名必须与 `src/integrations/ui-kit/types.ts` 的结构化接口一致——
 * 若不一致，`tests/behavior/v3-ui-kit-widget-contract.test.ts` 会对着官方 `.d.ts` 报出来。
 */
import { h, provide, ref, shallowRef, type Component, type Ref, type ShallowRef } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import {
  mapContextKey,
  type MapContext,
  type MapReadyContext,
} from "../../packages/baidu-map-gl-vue/src/core/context/types";
import { createMapEventBus } from "../../packages/baidu-map-gl-vue/src/core/events/MapEventBus";
import { ResourceScope } from "../../packages/baidu-map-gl-vue/src/core/lifecycle/ResourceScope";
import { createHandle, type MapHandle } from "../../packages/baidu-map-gl-vue/src/driver/types/handles";

export { mapContextKey };

/* -------------------------------------------------------------------------- */
/* 假 widget                                                                   */
/* -------------------------------------------------------------------------- */

type Handler = (...args: unknown[]) => void;

export interface FakeWidgetStats {
  created: number;
  destroyed: number;
  onCount: number;
  offCount: number;
  /** 每次 `destroy()` 时宿主容器内的子节点数（假 widget 自己那一个）。 */
  hostChildrenAtDestroy: number[];
  /** 生命周期顺序：`construct:*` / `on:*` / `off:*` / `destroy:*`，用于断言释放顺序。 */
  timeline: string[];
}

export interface FakeWidgetCall {
  method: string;
  args: unknown[];
}

/** 假 widget 的公共形态：与 `types.ts` 的结构化接口保持同名同签名。 */
export class FakeUiKitWidget {
  readonly kind: string;
  readonly host: HTMLElement | null;
  readonly options: Record<string, unknown>;
  readonly listeners = new Map<string, Set<Handler>>();
  readonly calls: FakeWidgetCall[] = [];
  readonly ownNode: HTMLElement;
  destroyed = false;

  constructor(
    kind: string,
    private readonly stats: FakeWidgetStats,
    host: HTMLElement | string,
    options: Record<string, unknown>,
  ) {
    this.kind = kind;
    this.host = typeof host === "string" ? (document.querySelector(host) as HTMLElement) : host;
    this.options = options;
    // 模拟上游：构造即往宿主里塞自己的 DOM，`destroy()` 撤走。
    this.ownNode = document.createElement("div");
    this.ownNode.className = `fake-ui-kit-widget fake-ui-kit-${kind}`;
    this.host?.appendChild(this.ownNode);
    stats.created += 1;
    stats.timeline.push(`construct:${kind}`);
  }

  on(event: string, handler: Handler): this {
    const set = this.listeners.get(event) ?? new Set<Handler>();
    set.add(handler);
    this.listeners.set(event, set);
    this.stats.onCount += 1;
    this.stats.timeline.push(`on:${event}`);
    return this;
  }

  off(event: string, handler?: Handler): this {
    const set = this.listeners.get(event);
    if (set) {
      if (handler) set.delete(handler);
      else set.clear();
    }
    this.stats.offCount += 1;
    this.stats.timeline.push(`off:${event}`);
    return this;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stats.destroyed += 1;
    this.stats.hostChildrenAtDestroy.push(this.host ? this.host.children.length : -1);
    this.stats.timeline.push(`destroy:${this.kind}`);
    this.ownNode.remove();
  }

  /** 触发一次上游事件（测试驱动）。 */
  emit(event: string, ...args: unknown[]): void {
    for (const handler of [...(this.listeners.get(event) ?? [])]) handler(...args);
  }

  protected record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args });
  }

  /** 某个方法被调用的次数 / 参数，用于断言「只发一次请求」。 */
  callsOf(method: string): FakeWidgetCall[] {
    return this.calls.filter((call) => call.method === method);
  }

  /* --- PlaceAutocomplete 公开面 --- */
  setInputValue(value: string): void {
    this.record("setInputValue", value);
  }
  getInputValue(): string {
    this.record("getInputValue");
    return `value-from-${this.kind}`;
  }
  setLocation(location: string): void {
    this.record("setLocation", location);
  }
  setCitylimit(citylimit: boolean): void {
    this.record("setCitylimit", citylimit);
  }
  setTypes(types: "all" | "city"): void {
    this.record("setTypes", types);
  }
  show(): void {
    this.record("show");
  }
  hide(): void {
    this.record("hide");
  }

  /* --- PlaceSearch 公开面 --- */
  searchNearby(keyword: string, center: unknown, radius?: number): Promise<void> {
    this.record("searchNearby", keyword, center, radius);
    return Promise.resolve();
  }
  searchInBounds(keyword: string, bounds: { sw: unknown; ne: unknown }): Promise<void> {
    this.record("searchInBounds", keyword, bounds);
    return Promise.resolve();
  }
  prevPage(): void {
    this.record("prevPage");
  }
  nextPage(): void {
    this.record("nextPage");
  }
  goToPage(page: number): void {
    this.record("goToPage", page);
  }
}

/** 自动补全：`search` 是同步的。 */
export class FakeUiKitAutocomplete extends FakeUiKitWidget {
  constructor(stats: FakeWidgetStats, host: HTMLElement | string, options: Record<string, unknown>) {
    super("autocomplete", stats, host, options);
  }
  search(keyword: string): void {
    this.record("search", keyword);
  }
}

/** 地点检索：`search` 是 async 的，且可带 `{ city }`。 */
export class FakeUiKitSearch extends FakeUiKitWidget {
  constructor(stats: FakeWidgetStats, host: HTMLElement | string, options: Record<string, unknown>) {
    super("search", stats, host, options);
  }
  search(keyword: string, option?: { city?: string }): Promise<void> {
    this.record("search", keyword, option);
    return Promise.resolve();
  }
}

export interface FakeUiKit {
  stats: FakeWidgetStats;
  /** 交给 `vi.mock("@baidumap/jsapi-ui-kit", ...)` 的工厂读取的模块对象。 */
  module: Record<string, unknown>;
  /** 按构造顺序记录的 widget 实例。 */
  instances: FakeUiKitWidget[];
  /**
   * 以「官方模块」的调用形态构造一个 widget。
   *
   * `vi.mock` 的工厂必须**在求值期**就交出固定的一组具名导出（vitest 会校验，
   * 动态 Proxy 会被判成「没有定义该导出」），所以工厂里包一层转发函数，
   * 转发到这里再由 `module[kind]` 现取——这样每个用例都能换掉实现而不用重建 mock。
   */
  spawn(
    kind: FakeUiKitKind,
    host: unknown,
    options: unknown,
  ): unknown;
  /** 清空记账（用例之间隔离；`stats` 对象保持同一引用）。 */
  reset(): void;
}

/** 造一个可控的假 UI Kit 模块。 */
export function createFakeUiKit(): FakeUiKit {
  const stats: FakeWidgetStats = {
    created: 0,
    destroyed: 0,
    onCount: 0,
    offCount: 0,
    hostChildrenAtDestroy: [],
    timeline: [],
  };
  const instances: FakeUiKitWidget[] = [];
  const track = <T extends FakeUiKitWidget>(widget: T): T => {
    instances.push(widget);
    return widget;
  };
  const module: Record<string, unknown> = {
    PlaceAutocomplete: function (host: HTMLElement | string, options: Record<string, unknown>) {
      return track(new FakeUiKitAutocomplete(stats, host, options));
    },
    PlaceSearch: function (host: HTMLElement | string, options: Record<string, unknown>) {
      return track(new FakeUiKitSearch(stats, host, options));
    },
    // 详情 / 路线：本轮不做 Vue 封装，但模块里必须存在（用于「进阶用户可原生构造」的用例）。
    PlaceDetail: function () {
      return { destroy() {}, on() {}, off() {} };
    },
    RoutePlan: function () {
      return { destroy() {}, on() {}, off() {} };
    },
  };
  return {
    stats,
    module,
    instances,
    spawn(kind, host, options) {
      const ctor = module[kind] as ((host: unknown, options: unknown) => unknown) | undefined;
      if (typeof ctor !== "function") throw new Error(`假模块缺少 ${kind}`);
      return ctor(host, options);
    },
    reset() {
      stats.created = 0;
      stats.destroyed = 0;
      stats.onCount = 0;
      stats.offCount = 0;
      stats.hostChildrenAtDestroy = [];
      stats.timeline = [];
      instances.length = 0;
    },
  };
}

/**
 * 当前安装的假模块。
 *
 * `vi.mock` 的工厂会被提升到 import 之前，无法直接闭包测试里的变量；因此用一个「当前槽位」：
 * 工厂返回一个 Proxy，每次属性访问都转发到**当时**安装的假模块，用例在 `beforeEach` 里安装。
 */
let installed: FakeUiKit | null = null;

export function installFakeUiKit(fake: FakeUiKit): void {
  installed = fake;
}

export function currentFakeUiKit(): FakeUiKit {
  if (!installed) throw new Error("假 UI Kit 模块尚未安装：用例应先调用 installFakeUiKit()");
  return installed;
}

export type FakeUiKitKind = "PlaceAutocomplete" | "PlaceSearch" | "PlaceDetail" | "RoutePlan";

/**
 * `vi.mock("@baidumap/jsapi-ui-kit", async () => uiKitModuleMock())` 的工厂体。
 *
 * 三个约束缺一不可：
 * 1. 导出必须是**具名且静态存在**的（vitest 会校验 mock 的导出名，用 Proxy 转发会被判成
 *    「没有定义该导出」）；
 * 2. 每个导出必须是**可构造**的（本库按 `new module.PlaceAutocomplete(host, options)` 使用，
 *    箭头函数不可构造），且返回对象以覆盖 `this`；
 * 3. 实现要**延迟到调用时**再取（转发到 `currentFakeUiKit()`），否则 mock 结果被 vitest 缓存
 *    之后，用例就没法换实现 —— 这一点在「构造抛错」的用例里是必需的。
 */
export function uiKitModuleMock(): Record<string, unknown> {
  const forward = (kind: FakeUiKitKind) =>
    function (this: unknown, host: unknown, options: unknown) {
      return currentFakeUiKit().spawn(kind, host, options);
    };
  return {
    PlaceAutocomplete: forward("PlaceAutocomplete"),
    PlaceSearch: forward("PlaceSearch"),
    PlaceDetail: forward("PlaceDetail"),
    RoutePlan: forward("RoutePlan"),
  };
}

/* -------------------------------------------------------------------------- */
/* 假 MapContext                                                               */
/* -------------------------------------------------------------------------- */

export interface FakeMapHarness {
  context: MapContext;
  /** 当前 map handle（桥会 watch 它；换 Map = 换引用 + `ready()`）。 */
  mapRef: ShallowRef<MapHandle | null>;
  makeMapHandle(label: string): MapHandle;
  /** 兑现所有等待中的 `whenReady()`；不传 handle 时复用当前 handle。 */
  ready(handle?: MapHandle): void;
  /** 还有几个 `whenReady()` 在等。 */
  pendingReady(): number;
  /** 组件经 `resource:error` 报上来的载荷。 */
  resourceErrors: unknown[];
  /** 经 Driver 的 `toRawPoint()` 转换过的坐标（用于断言组件不自己造 raw point）。 */
  toRawPointCalls: unknown[];
  /** client / driver 上的属性访问路径（如 `driver.geometry`、`driver.services`）。 */
  propertyAccesses: string[];
  /** 模拟 `<BMap>` 卸载：后续 `whenReady()` 一律拒绝。 */
  dispose(): void;
}

export function createFakeMapHarness(): FakeMapHarness {
  const mapRef = shallowRef<MapHandle | null>(null);
  const events = createMapEventBus();
  const resourceErrors: unknown[] = [];
  const toRawPointCalls: unknown[] = [];
  const propertyAccesses: string[] = [];
  events.on("resource:error", (payload: unknown) => resourceErrors.push(payload));

  const geometry = {
    toRawPoint(point: { lng: number; lat: number }) {
      toRawPointCalls.push(point);
      return { __rawPoint: true, ...point };
    },
  };
  // 只有 `geometry` 是合法依赖面；`services` / `rawSdk` 一旦被读到就说明绕过了 UI Kit 通道。
  // 注意：记录用的 Proxy 只出现在 `whenReady()` 交出去的 client 上，`context.client` 这个 ref
  // 里放的是**原始对象**——否则 Vue 的 `isRef` 探测会先访问一次 `__v_isRef`，干扰记账。
  const driver = new Proxy(
    { geometry } as Record<string, unknown>,
    {
      get(target, property, receiver) {
        propertyAccesses.push(`driver.${String(property)}`);
        return Reflect.get(target, property, receiver);
      },
    },
  );
  const clientTarget = {
    id: Symbol("fake-client"),
    engine: "jsapi-v4",
    libraryVersion: "test",
    sdkVersion: "4.0",
    version: "4.0",
    capabilities: {},
    rawSdk: {},
    driver,
  };
  const client = new Proxy(clientTarget, {
    get(target, property, receiver) {
      propertyAccesses.push(`client.${String(property)}`);
      return Reflect.get(target, property, receiver);
    },
  });

  let disposed = false;
  let waiters: Array<{
    resolve: (value: MapReadyContext) => void;
    reject: (error: unknown) => void;
    signal?: AbortSignal;
    onAbort?: () => void;
  }> = [];

  const settle = (
    waiter: (typeof waiters)[number],
    outcome: { ok: true; handle: MapHandle } | { ok: false; error: unknown },
  ): void => {
    waiters = waiters.filter((item) => item !== waiter);
    waiter.signal?.removeEventListener("abort", waiter.onAbort!);
    if (outcome.ok) waiter.resolve({ client, map: outcome.handle } as unknown as MapReadyContext);
    else waiter.reject(outcome.error);
  };

  const harness: FakeMapHarness = {
    mapRef,
    resourceErrors,
    toRawPointCalls,
    propertyAccesses,
    makeMapHandle(label: string) {
      return createHandle("map", { __fakeMap: label });
    },
    ready(handle) {
      const target = handle ?? mapRef.value;
      if (!target) throw new Error("ready() 需要先给一个 map handle");
      mapRef.value = target;
      for (const waiter of [...waiters]) settle(waiter, { ok: true, handle: target });
    },
    pendingReady() {
      return waiters.length;
    },
    dispose() {
      disposed = true;
      for (const waiter of [...waiters]) settle(waiter, { ok: false, error: new Error("disposed") });
    },
    context: undefined as unknown as MapContext,
  };

  harness.context = {
    id: Symbol("fake-map-context"),
    status: shallowRef("idle"),
    client: shallowRef(clientTarget),
    map: mapRef,
    error: shallowRef(null),
    resources: new ResourceScope({ label: "fake-runtime" }),
    events,
    scheduler: {},
    overlays: {},
    plugins: {},
    whenReady(signal?: AbortSignal) {
      if (mapRef.value) {
        return Promise.resolve({ client, map: mapRef.value } as unknown as MapReadyContext);
      }
      if (disposed) return Promise.reject(new Error("disposed"));
      if (signal?.aborted) return Promise.reject(signal.reason);
      return new Promise<MapReadyContext>((resolve, reject) => {
        const waiter = { resolve, reject, signal } as (typeof waiters)[number];
        waiter.onAbort = () => settle(waiter, { ok: false, error: signal?.reason });
        waiters.push(waiter);
        signal?.addEventListener("abort", waiter.onAbort, { once: true });
      });
    },
    dispose() {
      harness.dispose();
    },
  } as unknown as MapContext;

  return harness;
}

/* -------------------------------------------------------------------------- */
/* 挂载助手                                                                    */
/* -------------------------------------------------------------------------- */

export interface MountedInMap<P extends Record<string, unknown>> {
  wrapper: VueWrapper;
  /** 子组件自身的 wrapper：`emitted()` 要在这里读（父 wrapper 只记录自己 emit 的事件）。 */
  child: VueWrapper;
  /** 子组件实例（即 `defineExpose` 出来的公开动作 / status）。 */
  exposed: Ref<Record<string, unknown> | null>;
  /** 每次 `mount()` 都会新建一个宿主容器，用例可直接断言其子节点。 */
  host: HTMLElement;
  props: Ref<P>;
  unmount(): void;
}

/**
 * 把一个 UI Kit 组件挂到一个假的 MapContext 下面。
 *
 * `props` 是 ref，因此用例可以在挂载后改 prop 来触发「运行期 setter 镜像」。
 */
export function mountInMap<P extends Record<string, unknown>>(
  component: Component,
  harness: FakeMapHarness,
  initialProps: P = {} as P,
): MountedInMap<P> {
  const props = ref(initialProps) as Ref<P>;
  const exposed = ref<Record<string, unknown> | null>(null);
  const host = document.createElement("div");
  document.body.appendChild(host);

  const wrapper = mount(
    {
      setup() {
        provide(mapContextKey, harness.context);
        return () => h(component, { ...props.value, ref: exposed });
      },
    },
    { attachTo: host },
  );

  return {
    wrapper,
    child: wrapper.findComponent(component as never) as VueWrapper,
    exposed,
    host,
    props,
    unmount() {
      wrapper.unmount();
      host.remove();
    },
  };
}
