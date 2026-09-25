/**
 * 官方对照基准的**两侧装配与读数口**（issue #140）
 *
 * 把「怎么挂两边」「怎么数重渲染」「怎么读 Fake 账」收在一处，让 `official-contrast.perf.test.ts`
 * 只剩「哪个场景做什么动作」。理由与三条硬约束写在下面。
 *
 * ## 1. 为什么两侧能在**同一进程**跑
 *
 * 票面要「同一 Vue 版本、浏览器、JSAPI 4.0、AK/网络环境」的可复现对照。跨进程各跑一次满足不了
 * 「同环境」：两次的机器负载、JIT 状态、GC 时机都不同，差多少都无法归因。因此两侧在同一个
 * vitest 进程里跑，共享同一份 Vue 与同一份数据集。
 *
 * ## 2. 为什么官方库能跑在 **Fake v4** 上（无 AK、无网络）
 *
 * 官方库经 `@baidumap/jsapi-loader@1.0.0` 的 `load()` 取 SDK，而 `load()` 检测到已存在的
 * `window.BMap` 时**直接复用**（不插 script）。把 Fake v4 挂到 `globalThis.BMap` 即可。
 * 这是「同 SDK 替身」的实现方式，也是本档**能在 CI 里当门禁**的前提（票面要求可复现）。
 *
 * ⚠️ 但**两侧不能共用一份 Fake 账本**：本库经 Facet Driver、官方经自己的 driver，写入的记账
 * 字段与生命周期不同，混在一个账本上会让「谁创建了什么」无法归因。所以**本库侧用
 * `createFakeV4Harness()`，官方侧另起一个 `createFakeBMapV4()`**，各读各的账
 * （`window.BMap` 只给官方；本库走 provider 注入，不读全局）。
 *
 * ## 3. 重渲染次数怎么数（Vue 3 **没有** `app:renderTriggered`）
 *
 * Vue 3 去掉了 Vue 2 的 `app.on("app:renderTriggered")`。Vue 3 唯一可用的公开观测口是
 * **devtools 全局钩子**，而本档取的是 `perf:start`（`type === "render"`）——它在
 * `runtime-core` 的 `startMeasure` 里，**首次挂载与每次更新都发**。选它而不选
 * `component:updated` 是因为后者只在**更新**路径上 emit，票面一半场景量的正是挂载，
 * 那样会恒读 0（选型依据与源码下标见 `vueRenderCounter.ts` 文件头）。
 *
 * 它按**根实例**归属：一个 app 内所有组件（含 Map / Marker / Polyline）的渲染都记到它自己的
 * 根上。两侧用**同一段代码**计数，因此「本库渲染 N 次 / 官方渲染 M 次」可比——可比的关键是
 * **同一把尺子**，不是尺子有多细。
 *
 * ⚠️ 它数的是「组件渲染次数」，**不是**票面写的「watcher 回调次数」，也**不是**「SDK 调用
 * 次数」。一次渲染里可能有 0 次、也可能有多个 watcher、0 次或多次 SDK 写入。票面把 watcher
 * 回调次数列为指标，但 Vue 3 没有公开的 watcher 计数面（`app.on("app:renderTriggered")` 在
 * Vue 2 就被删了），因此本档记**组件渲染**、在报告里带名字，并把它与票面原口径的差距写进
 * `notMeasured`（第 1 轮评审第 8 条：宁可改名字，不可让列名冒充它量的东西）。
 *
 * ⚠️ devtools 钩子是**进程级单例**：后装的覆盖先装的。因此这里装**一次**全局钩子、内部按根
 * 实例分流，而不是两侧各装一个（那会互相把对方顶掉）。
 */
// ⚠️ 必须排在 `vue` 之前：devtools 钩子只有在**渲染器创建之前**装上才收得到事件，
// 理由与实测见 `vueRenderCounter.ts` 文件头。
import { bucketForInstance, type RenderBucket } from "./vueRenderCounter.ts";

import {
  createApp,
  defineComponent,
  getCurrentInstance,
  h,
  KeepAlive,
  nextTick,
  ref,
  type App,
  type VNodeChild,
} from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { createFakeV4Harness, type FakeV4Harness } from "../../packages/test-utils";
import {
  createFakeBMapV4,
  type FakeBMapV4,
  type FakeV4DiagnosticsSnapshot,
} from "../../packages/test-utils/fake-bmap-v4/index.ts";
import MapComponent from "../../packages/bmap-vue/src/components/map/Map.vue";

/* ------------------------------------------------------------------ 官方库 */

/**
 * 官方库的类型是它自己的（`.d.ts` 引用 `@baidumap/jsapi-v4-types` 的全局 `BMap`），与本库的
 * 领域类型没有公共父类型。在这里做**一次**结构化收窄，之后调用点都拿 `OfficialLib` 这个稳定
 * 形状用，`as never` 不散落在每个 `h()` 上。
 */
export interface OfficialLib {
  readonly BMapProvider: unknown;
  readonly Map: unknown;
  readonly Marker: unknown;
  readonly Polyline: unknown;
  readonly InfoWindow: unknown;
}

/** 官方侧 Fake 上没有 `tilesloaded`，官方 `Map` 走它自己的 `setTimeout(…, 500)` 兜底。 */
export const OFFICIAL_READY_TIMEOUT_MS = 8_000;

/** 官方侧专属的 Fake（**不与本库共用账本**，见文件头第 2 条）。 */
export const officialFake: FakeBMapV4 = createFakeBMapV4();

/**
 * 装载官方库并把 Fake 挂上全局。
 *
 * 必须在**任何**官方组件挂载之前调用：`BMapProvider` 挂载时就会调 `load()`，那时若全局还没有
 * `BMap`，官方会真的去插 script（本档会退化成「等真实网络」）。
 */
export async function installOfficialLib(): Promise<OfficialLib> {
  const lib = (await import("@baidumap/vue-bmap")) as unknown as OfficialLib;
  // 对齐 ready 口径：官方 `Map` 以 `tilesloaded` 为 ready 信号，Fake 默认不发 ⇒ 官方只能等
  // 它自己的 500ms 兜底定时器，而本库立即 ready。**那 500ms 是夹具差异，不是两库的性能差**，
  // 必须先消掉，否则后面每个场景的读数都被它污染（实测开启后官方 ready 从 ~500ms 降到 ~8ms）。
  // 开关语义与「为什么延一个 macrotask 派发」见 `FakeMap.centerAndZoom` 的注释。
  officialFake.diagnostics.emitTilesLoadedOnFirstView = true;
  (globalThis as Record<string, unknown>).BMap = officialFake.namespace;
  (window as unknown as Record<string, unknown>).BMap = officialFake.namespace;
  return lib;
}

/* ------------------------------------------------------------------ 读数 */

export type FakeSnapshot = FakeV4DiagnosticsSnapshot;

/** 一侧在某个动作窗口内的增量读数（报告里的一行）。 */
export interface SideDelta {
  /**
   * 窗口内**某一个** SDK 调用面的调用次数。
   *
   * ⚠️ **刻意不叫「SDK 调用总数」**：真实 SDK 与 Fake v4 都没有这样一个单一计数器——把它
   * 笼统叫成 `sdkCalls` 会让报告读起来像量了全部 SDK 交互，而它其实只是下述某一个面。
   * `callKind` 与这个数字**成对读**，缺了名字的计数在这套读数里是不诚实的（第 1 轮评审
   * 第 8 条）。
   *
   * 默认口径是 `listenCalls` 的增量（Fake 里唯一一个「所有 SDK 侧订阅都过」的计数器）。
   * 按 SDK 语义更精确的计数（如「换位置发了 N 次 `setPosition`」「重发 path 恰好 N 次
   * `setPath`」）由调用方按场景从 `countOverlayCalls()` 取，并**同时**覆盖 `callKind`。
   */
  sdkCalls: number;
  /** `sdkCalls` 量的**是哪个调用面**：`listen` / `setPosition` / `setPath`。 */
  callKind: string;
  /** 窗口内**新建**的 SDK 实例数（地图 / 覆盖物 / 图层，按实例计）。 */
  recreates: number;
  /** 窗口内触发的组件渲染次数（不是 watcher 回调次数，见文件头第 3 条）。 */
  renderCallbacks: number;
  /** 窗口结束后**仍未释放**的 SDK 资源数（0 = 干净）。 */
  retainedResources: number;
  /** 窗口结束后仍未释放的监听器数。 */
  retainedListeners: number;
}

/** 残留资源求和（`listeners` 单独一列，不混进「资源」）。 */
function sumResources(leaks: object): number {
  let total = 0;
  for (const [key, value] of Object.entries(leaks) as Array<[string, number]>) {
    if (key === "listeners") continue;
    total += value;
  }
  return total;
}

/** 两个快照之间的**活动增量** + 结束时的残留。 */
export function deltaBetween(before: FakeSnapshot, after: FakeSnapshot, renders: number): SideDelta {
  return {
    sdkCalls: after.activity.listenCalls - before.activity.listenCalls,
    callKind: "listen",
    recreates:
      after.activity.mapsCreated -
      before.activity.mapsCreated +
      (after.activity.overlaysAttached - before.activity.overlaysAttached) +
      (after.activity.layersAttached - before.activity.layersAttached),
    renderCallbacks: renders,
    retainedResources: sumResources(after.leaks),
    retainedListeners: after.leaks.listeners,
  };
}

/** 只把「动作窗口」的重渲染次数读出来，落到 `SideDelta` 上。 */
export function withRenders(delta: SideDelta, renders: number): SideDelta {
  return { ...delta, renderCallbacks: renders };
}

/**
 * 数某个 SDK 侧调用在**全部已创建覆盖物**上被调用了多少次（跨 Fake 实例，官方/本库同用）。
 *
 * 为什么需要它而不是直接读 `harness.overlayCalls()`：那个读数是**一条**覆盖物的累计
 * callLog，而基准要跑 `WARMUP + SAMPLES` 轮、每轮新建一条折线——累计值会跨轮累加，
 * 最后一轮读到的就不是「这一轮发了几次」。
 *
 * 正确用法是**在 `setup()` 末尾取一次基线、在 `act()` 之后取差值**（`measureBoth` 已经把
 * `act` 夹在这两步之间）。基线取在 `setup` 末尾而不是开头：装配本身会建覆盖物，
 * 那些不是动作造成的。
 */
export function countOverlayCalls(fake: FakeBMapV4, call: string): number {
  let total = 0;
  for (const overlay of fake.createdOverlays) {
    const log = (overlay as { callLog?: readonly string[] }).callLog ?? [];
    for (const entry of log) if (entry === call) total += 1;
  }
  return total;
}

/**
 * 「残留」读数单独取一次快照。
 *
 * 与 `deltaBetween` 分开是因为**时间点不同**：增量读数取的是「动作窗口结束时」（窗口里挂着的
 * 资源当然还在，那是动作本身造成的），而残留是**卸载之后**的问题。混在一个快照里读，
 * 挂载型场景（本档 §1/§2）必然读出「有 N 个资源」，而那是挂载还没拆——不是泄漏。
 */
export function retainedAfter(before: FakeSnapshot, afterTeardown: FakeSnapshot): {
  retainedResources: number;
  retainedListeners: number;
} {
  return {
    retainedResources: sumResources(afterTeardown.leaks),
    retainedListeners: afterTeardown.leaks.listeners,
  };
}

/* ------------------------------------------------------------------ 计时 */

export const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** 与 `component-path.perf.test.ts` 同型的 settle：跨 macrotask + nextTick。 */
export async function settle(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  await nextTick();
}

/* ------------------------------------------------------------------ 本库侧 */

export const { harness, fake: ourFake } = createFakeV4Harness();

/**
 * 一侧的一次**测量**：装配 → 动作 → 拆卸。
 *
 * 三个阶段都在同一个 `Side` 上，因为「装配在计时窗之外、拆卸也是」这条约束只有把三段串在
 * 一起才表达得出来（否则每个场景各写一遍 `try/finally`，漏一处就变成「忘了卸」的假绿）。
 */
export interface ContrastSide {
  /** `false` = 装配失败（官方侧没 ready 等），调用方记 blocked 而不是记 0。 */
  readonly ready: boolean;
  /** 装配并等到「可以开始动作」。**不计时**。 */
  setup(): Promise<void>;
  /** 被计时的动作（只含动作本身）。 */
  act(): Promise<void>;
  /** 拆卸并等待释放完成。**不计时**。 */
  teardown(): Promise<void>;
  /** 窗口内本侧的组件渲染次数。 */
  renders(): number;
  /** 动作开始前把组件渲染计数归零。 */
  resetRenders(): void;
  /**
   * 「窗口内某一个 SDK 调用面的次数」的**按语义覆盖口径**（缺省 = `listenCalls` 增量，
   * 见 `SideDelta.sdkCalls`）。返回值与 `sdkCallKind` **成对**给出。
   *
   * 场景 3/4/5 用它把 `listenCalls`（订阅面）换成「`setPosition` / `setPath` 被调用了
   * 几次」——票面关心的是「换位置发了多少写入」「父级无关更新会不会重发 path」，而
   * `listenCalls` 分辨不出这两件事。
   */
  sdkCallCount?(): number;
  /** `sdkCallCount` 量的调用面名（`setPosition` / `setPath`）；缺省即 `listen`。 */
  sdkCallKind?: string;
  /**
   * 动作**之后**才判定的「这一侧是不是没跑成」（返回 `null` = 跑成了）。
   *
   * 为什么不能只用 `ready`：官方 `BMapProvider` 的子树要等 SDK promise 兑现才渲染，所以官方侧
   * 的「建图」必然**落在动作窗口内**（挂载那一刻才发生），没法像本库侧那样把装配挪到窗口外。
   * 于是两侧的 `ready` 都恒为 true，真正的「没 ready」只能在 `act` 跑完后由这里报。
   * 没有这一条，官方侧没 ready 就会被记成「0ms、0 次调用」的假好成绩。
   */
  blockedReason?(): string | null;
}

export interface OurSideFactory {
  readonly harness: FakeV4Harness;
  readonly renders: () => number;
  readonly resetRenders: () => void;
  /**
   * 挂本库场景（自带 Map 外壳与 provider）。
   *
   * **惰性**：构造 factory 不挂载，真正建树发生在 `mount()`。这样「装配（不计时）」与
   * 「动作（计时）」才能分开——`measureBoth` 的契约要求 setup 在计时窗之外。
   */
  mount(): void;
  unmount(): void;
}

/**
 * 造一个可反复挂载/卸载的本库侧装配器（自带 Map 外壳与 provider）。
 *
 * `wrap` 让场景决定**Map 之上**再套什么。默认是「Map 就是根」；场景 10 用它套 `<KeepAlive>`。
 *
 * `global.plugins` 是给需要「装到 app 上」的插件用的（场景 9 的 `vue-router`：`<RouterView>`
 * 从**注入**里读 router 实例，不 `use(router)` 就会在 render 时抛 `undefined.value`）。
 *
 * ⚠️ `wrap` 必须把 `mapVNode` 原样放进它返回的树里，而且要放在**同一个位置**上跨多次渲染
 * 保持稳定——否则 Vue 看到的是「换了位置的新组件」，KeepAlive 的缓存条目就废了，退化成
 * 卸载+重建，场景 10 测的就不再是「挂起」而是「重建」（这正是本档要区分的那两件事）。
 */
export function createOurSideFactory(
  children: () => VNodeChild,
  options: {
    wrap?: (mapVNode: VNodeChild) => VNodeChild;
    global?: { plugins?: unknown[] };
  } = {},
): OurSideFactory {
  const wrap = options.wrap ?? ((mapVNode: VNodeChild) => mapVNode);
  let wrapper: VueWrapper | null = null;
  // 计数桶挂在 Root 组件实例上；`mount()` 每次建一棵新树，桶也跟着换。
  let bucket: RenderBucket = { count: 0 };
  const Root = defineComponent({
    setup() {
      // 桶**必须在 setup 里**建（原因见 `bucketFor` 的注释）：挂载型场景整棵树是在 `mount()`
      // 内部建立的，mount 返回后再建桶就永远读到 0。
      bucket = bucketForInstance(getCurrentInstance());
      return () => wrap(h(MapComponent, { provider: harness.provider() }, children));
    },
  });
  return {
    harness,
    renders: () => bucket.count,
    resetRenders: () => {
      bucket.count = 0;
    },
    mount: () => {
      wrapper = mount(Root, {
        attachTo: harness.container(),
        global: options.global as never,
      });
    },
    unmount: () => {
      wrapper?.unmount();
      wrapper = null;
    },
  };
}

/* ------------------------------------------------------------------ 官方侧 */

export interface OfficialSideFactory {
  readonly app: App;
  readonly container: HTMLElement;
  readonly fake: FakeBMapV4;
  /** `true` = 官方 `Map` 报了 `onReady`。 */
  readonly ready: boolean;
  readonly renders: () => number;
  readonly resetRenders: () => void;
  unmount(): void;
}

/**
 * 挂官方场景。
 *
 * **ready 等待不计入任何计时窗**——Fake 上没有 `tilesloaded`，官方 `Map` 会走它自己的
 * `setTimeout(…, 500)` 兜底；若把装配与测量放同一段计时，500ms 会直接主导对照。
 * 所以这里先装配到 ready，把读数窗口留给「动作本身」。
 */
export async function mountOfficial(
  lib: OfficialLib,
  slots: () => VNodeChild,
): Promise<OfficialSideFactory> {
  const container = document.createElement("div");
  container.style.width = "400px";
  container.style.height = "300px";
  document.body.appendChild(container);
  const ready = ref(false);
  // 与本库侧**同一条**注册路径（根组件 `setup()` 里建桶，见 `bucketFor` 注释）。
  let bucket: RenderBucket = { count: 0 };
  const Root = defineComponent({
    setup() {
      bucket = bucketForInstance(getCurrentInstance());
      return () =>
        h(lib.BMapProvider as never, { ak: "fake", version: "4.0" }, {
          default: () => [
            h(
              lib.Map as never,
              {
                center: { lng: 116.404, lat: 39.915 },
                zoom: 11,
                style: "width:100%;height:100%",
                onReady: () => {
                  ready.value = true;
                },
              },
              { default: () => [slots() as VNodeChild] },
            ),
          ],
        });
    },
  });
  const app = createApp(Root);
  app.mount(container);
  const started = Date.now();
  while (!ready.value && Date.now() - started < OFFICIAL_READY_TIMEOUT_MS) {
    await sleep(20);
    await nextTick();
  }
  return {
    app,
    container,
    fake: officialFake,
    ready: ready.value,
    renders: () => bucket.count,
    resetRenders: () => {
      bucket.count = 0;
    },
    unmount: () => {
      app.unmount();
      container.remove();
    },
  };
}
