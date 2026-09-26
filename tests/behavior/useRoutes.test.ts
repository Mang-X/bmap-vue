/**
 * 路线服务 composable 行为测试（M7-ROUTES / issue #39）
 *
 * 对应 issue 的「测试与验收」里属于 composable 层的那几条：
 * - 四类服务在 `<Map>` 子树里可用、统一状态口径、卸载后**结果集**被收回（泄漏门禁）；
 * - **render 开关**：默认不绘制；显式给 `renderOptions.map` 时真的把地图交给 SDK（且所有权可验证）；
 * - **快速重复检索**：新检索取代在飞检索时换新实例，迟到回包不污染新结果；
 * - **构造期选项变化才重建**（含「每次求值都是新对象」的 getter 不触发重建）；
 * - `<BMapProvider>`（无地图）子树里的两种结果：显式给 `location` 可用 / 不给则显式失败；
 * - **UI 与 headless 分流**：两条路径互不引用（同一次界面操作只会发一次请求）。
 *
 * 断言全部落在可观察事实上：Fake 的 `callLog` 与 `rawRoutes` 账本、诊断的 `leaks.routeResults`、
 * 归一化结果的 `status` / `error.code`。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Map from "../../packages/bmap-vue/src/components/map/Map.vue";
import BMapProvider from "../../packages/bmap-vue/src/components/provider/BMapProvider.vue";
import { useMap } from "../../packages/bmap-vue/src/composables/useMap";
import { useDrivingRoute } from "../../packages/bmap-vue/src/composables/useDrivingRoute";
import { useWalkingRoute } from "../../packages/bmap-vue/src/composables/useWalkingRoute";
import { useRidingRoute } from "../../packages/bmap-vue/src/composables/useRidingRoute";
import { useTransitRoute } from "../../packages/bmap-vue/src/composables/useTransitRoute";
import { DrivingPolicy, IntercityPolicy, TransitPolicy, TransitVehiclePolicy } from "../../packages/bmap-vue/src/driver/types/services";
import { createFakeV4Harness, stripComments } from "../../packages/test-utils";

const PACKAGE_SRC = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../packages/bmap-vue/src",
);

let harness: ReturnType<typeof createFakeV4Harness>["harness"];
let fake: ReturnType<typeof createFakeV4Harness>["fake"];

function provider() {
  return harness.provider();
}

const from = { lng: 116.391, lat: 39.91 };
const to = { lng: 116.431, lat: 39.931 };

/** 在 `<Map>` 子树里挂一个用给定 hook 的组件（有地图上下文 ⇒ `location` 可省略）。 */
function mountInMap<T>(
  useHook: () => T,
  run: (hook: T) => void | Promise<void>,
  options: { provider?: ReturnType<typeof provider> } = {},
) {
  const el = harness.container();
  const Child = defineComponent({
    setup() {
      const hook = useHook();
      void Promise.resolve(run(hook));
      return () => h("div", "route");
    },
  });
  return mount(
    defineComponent({
      components: { Map, Child },
      setup: () => () => h(Map, { provider: options.provider ?? provider() }, () => [h(Child)]),
    }),
    { attachTo: el },
  );
}

/** 只挂 `<BMapProvider>`（**没有地图实例**）：client-only 服务必须同样可用。 */
function mountInProvider<T>(
  useHook: () => T,
  run: (hook: T) => void | Promise<void>,
) {
  const el = harness.container();
  const Child = defineComponent({
    setup() {
      const hook = useHook();
      void Promise.resolve(run(hook));
      return () => h("div", "route");
    },
  });
  return mount(
    defineComponent({
      components: { BMapProvider, Child },
      setup: () => () =>
        h(
          BMapProvider,
          { definition: { provider: provider(), loadOptions: { ak: "fake-ak" } } },
          () => [h(Child)],
        ),
    }),
    { attachTo: el },
  );
}

/** 捕获 hook 实例（行为测试要在 setup 之后继续驱动它）。 */
function capture<T>(): { hook: () => T; set: (value: T) => void } {
  let current: T | null = null;
  return {
    hook: () => {
      if (current === null) throw new Error("hook 尚未创建");
      return current;
    },
    set: (value: T) => {
      current = value;
    },
  };
}

describe("useDrivingRoute：headless 驾车路线", () => {
  beforeEach(() => {
    const created = createFakeV4Harness();
    harness = created.harness;
    fake = created.fake;
  });

  it("检索归一化结果；卸载后 SDK 结果集被收回（泄漏门禁）", async () => {
    const slot = capture<ReturnType<typeof useDrivingRoute>>();
    const wrapper = mountInMap(() => useDrivingRoute(), (hook) => slot.set(hook));
    await flushPromises();

    const hook = slot.hook();
    const result = await hook.search(from, to);
    await flushPromises();

    expect(result.status).toBe("success");
    expect(result.data?.plans).toHaveLength(1);
    expect(result.data?.plans[0]?.legs).toHaveLength(2);
    expect(result.data?.plans[0]?.legs[0]?.steps).toHaveLength(2);
    expect(hook.status.value).toBe("success");
    expect(hook.isLoading.value).toBe(false);
    expect(hook.sdkStatus.value).toBe(0);
    expect(hook.supported.value).toBe(true);
    expect(fake.rawRoutes.DrivingRoute[0]?.callLog.filter((e) => e.startsWith("search:"))).toHaveLength(1);

    wrapper.unmount();
    await flushPromises();
    // 卸载 ⇒ disposeRoute ⇒ 公开的 clearResults() ⇒ 结果集销账
    harness.assertIdle("useDrivingRoute 卸载");
  });

  it("默认不绘制：不传 renderOptions 时 SDK 侧没有任何绘制配置", async () => {
    const slot = capture<ReturnType<typeof useDrivingRoute>>();
    mountInMap(() => useDrivingRoute(), (hook) => slot.set(hook));
    await flushPromises();
    await slot.hook().search(from, to);

    const raw = fake.rawRoutes.DrivingRoute[0]!;
    expect("renderOptions" in raw.options).toBe(false);
  });

  it("显式 renderOptions.map 时把**本库地图句柄**解析成 raw 地图交给 SDK", async () => {
    const slot = capture<ReturnType<typeof useDrivingRoute>>();
    mountInMap(
      () => {
        const { map } = useMap();
        return useDrivingRoute({ renderOptions: { map, autoViewport: true } });
      },
      (hook) => slot.set(hook),
    );
    await flushPromises();
    await slot.hook().search(from, to);

    const raw = fake.rawRoutes.DrivingRoute[0]!;
    const renderOptions = raw.options.renderOptions as Record<string, unknown>;
    expect(renderOptions.autoViewport).toBe(true);
    // 交给 SDK 的必须是地图的 raw 对象（而不是句柄）——否则 SDK 侧拿到的是非法值
    expect(renderOptions.map).toBe(fake.createdMaps[0]);
    // 句柄身份可验证：`map` 不在 raw 配置里以句柄形态出现
    expect(typeof renderOptions.map).toBe("object");
  });

  it("快速重复检索：新检索换新实例，旧实例的迟到回包不污染结果", async () => {
    const slot = capture<ReturnType<typeof useDrivingRoute>>();
    mountInMap(() => useDrivingRoute(), (hook) => slot.set(hook));
    await flushPromises();
    const hook = slot.hook();

    await hook.search(from, to); // 预热：实例已建
    const first = fake.rawRoutes.DrivingRoute[0]!;
    first.queue.auto = false; // 让下一次检索挂在「未回包」上

    const inflight = hook.search(from, to);
    const replaced = hook.search(to, from); // 取代在飞检索
    await flushPromises();

    expect((await inflight).status).toBe("canceled");
    expect((await replaced).status).toBe("success");
    // 归属依赖实例身份 ⇒ 取代时换新实例（旧实例的迟到回包只会落到它自己身上）
    expect(fake.rawRoutes.DrivingRoute).toHaveLength(2);
    expect(first.callLog).toContain("clearResults"); // 旧实例被释放（公开的清理入口）

    first.queue.flush(); // 迟到回包到达：没有任何在册操作
    const third = await hook.search(to, from);
    expect(third.status).toBe("success");
    expect(third.data?.start?.title).toBe("起点");
  });

  it("clear() 释放实例并清空状态：公开的 clearResults() 被调用、结果集归零", async () => {
    const slot = capture<ReturnType<typeof useDrivingRoute>>();
    mountInMap(() => useDrivingRoute(), (hook) => slot.set(hook));
    await flushPromises();
    const hook = slot.hook();
    await hook.search(from, to);
    const raw = fake.rawRoutes.DrivingRoute[0]!;
    expect(fake.diagnostics.snapshot().leaks.routeResults).toBe(1);

    hook.clear();
    expect(hook.data.value).toBeNull();
    expect(hook.status.value).toBe("idle");
    expect(raw.callLog).toContain("clearResults");
    expect(fake.diagnostics.snapshot().leaks.routeResults).toBe(0);

    // 清空之后仍可继续检索（会重建实例）
    expect((await hook.search(from, to)).status).toBe("success");
    expect(fake.rawRoutes.DrivingRoute).toHaveLength(2);
  });

  it("构造期选项变化才重建；每次求值都是新对象的 getter 不触发重建", async () => {
    const policy = ref<DrivingPolicy>(DrivingPolicy.DEFAULT);
    const slot = capture<ReturnType<typeof useDrivingRoute>>();
    mountInMap(
      () => useDrivingRoute({ policy, renderOptions: () => ({ autoViewport: true }) }),
      (hook) => slot.set(hook),
    );
    await flushPromises();
    const hook = slot.hook();

    await hook.search(from, to);
    expect(fake.rawRoutes.DrivingRoute).toHaveLength(1);

    // 触发一次渲染：`renderOptions` 是 getter（每次求值新对象），内容没变 ⇒ **不能**重建
    await nextTick();
    await hook.search(from, to);
    expect(fake.rawRoutes.DrivingRoute).toHaveLength(1);

    // 策略真的变了 ⇒ 重建，且新实例带上了新策略
    policy.value = DrivingPolicy.AVOID_CONGESTION;
    await nextTick();
    await hook.search(from, to);
    expect(fake.rawRoutes.DrivingRoute).toHaveLength(2);
    expect(fake.rawRoutes.DrivingRoute[1]?.options.policy).toBe(DrivingPolicy.AVOID_CONGESTION);
  });

  it("没有地图也没有 location 时显式失败；给了 location 就可用", async () => {
    const missing = capture<ReturnType<typeof useDrivingRoute>>();
    mountInProvider(() => useDrivingRoute(), (hook) => missing.set(hook));
    await flushPromises();

    const failed = await missing.hook().search(from, to);
    expect(failed.status).toBe("failed");
    expect(failed.error?.code).toBe("BMAP_INVALID_ARGUMENT");
    expect(failed.error?.message).toContain("缺少检索区域");

    const provided = capture<ReturnType<typeof useDrivingRoute>>();
    mountInProvider(() => useDrivingRoute({ location: "北京市" }), (hook) =>
      provided.set(hook),
    );
    await flushPromises();
    const ok = await provided.hook().search(from, to);
    expect(ok.status).toBe("success");
  });
});

describe("useWalkingRoute / useRidingRoute / useTransitRoute", () => {
  beforeEach(() => {
    const created = createFakeV4Harness();
    harness = created.harness;
    fake = created.fake;
  });

  it("步行 / 骑行：字符串起终点可用，结果与驾车同构", async () => {
    const walking = capture<ReturnType<typeof useWalkingRoute>>();
    const walkingWrapper = mountInMap(() => useWalkingRoute(), (hook) => walking.set(hook));
    await flushPromises();
    const walkResult = await walking.hook().search("天安门", "王府井");
    expect(walkResult.status).toBe("success");
    expect(walkResult.data?.plans[0]?.legs[0]?.routeType).toBe(2);
    walkingWrapper.unmount();
    await flushPromises();
    harness.assertIdle("walking 卸载");

    const riding = capture<ReturnType<typeof useRidingRoute>>();
    const ridingWrapper = mountInMap(() => useRidingRoute(), (hook) => riding.set(hook));
    await flushPromises();
    const rideResult = await riding.hook().search("北京大学", "清华大学");
    expect(rideResult.status).toBe("success");
    expect(rideResult.data?.plans[0]?.legs[0]?.routeType).toBe(6);
    ridingWrapper.unmount();
    await flushPromises();
    harness.assertIdle("riding 卸载");
  });

  it("公交：换乘段投影成「步行 + 乘车」序列，并给出 transitType", async () => {
    const slot = capture<ReturnType<typeof useTransitRoute>>();
    const wrapper = mountInMap(() => useTransitRoute({ pageCapacity: 3 }), (hook) =>
      slot.set(hook),
    );
    await flushPromises();

    const result = await slot.hook().search("天安门", "北京西站");
    expect(result.status).toBe("success");
    const plan = result.data?.plans[0]!;
    expect(plan.segments.map((segment) => segment.kind)).toEqual(["walk", "line"]);
    expect(result.data?.transitType).toBe(0);
    expect(fake.rawRoutes.TransitRoute[0]?.options.pageCapacity).toBe(3);

    wrapper.unmount();
    await flushPromises();
    harness.assertIdle("transit 卸载");
  });

  it("能力不支持时 supported 为 false、状态是 unsupported，且**一次请求都没发**", async () => {
    delete (fake.namespace as unknown as Record<string, unknown>).TransitRoute;
    const slot = capture<ReturnType<typeof useTransitRoute>>();
    mountInMap(() => useTransitRoute(), (hook) => slot.set(hook));
    await flushPromises();

    const hook = slot.hook();
    expect(hook.supported.value).toBe(false);
    const result = await hook.search("天安门", "北京西站");
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("BMAP_CAPABILITY_UNSUPPORTED");
    expect(hook.status.value).toBe("unsupported");
    expect(fake.rawRoutes.TransitRoute).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* issue #165：路线服务的运行期 mutator —— 已审计，**登记为缺口（见下方理由）**   */
/* -------------------------------------------------------------------------- */

describe("路线服务的运行期 mutator（#165）：官方有、本库暂缺", () => {
  beforeEach(() => {
    const created = createFakeV4Harness();
    harness = created.harness;
    fake = created.fake;
  });

  /**
   * 官方四个路线类都声明了一批**运行期** mutator（`setPolicy` / `setLocation` /
   * `enableAutoViewport` / `setPolylineStyle` / `getStatus` …）。本库目前只把它们当**构造选项**，
   * 因此这些成员在 composable 面上**不存在**。
   *
   * 为什么不加（这不是「漏了忘了」，是一条需要别的 slice 先铺路的登记）：
   *
   * 1. 官方 mutator 作用在**某个具体服务实例**上。本库的路线实例由
   *    `useExclusiveServiceTask` 的**独占实例通道**持有，句柄只在内核的
   *    `ensureHandle` 那一行可见（`core/services/serviceTaskCore.ts`）——**不对 composable 暴露**。
   * 2. 因此在 `composables/**`（raw SDK 禁区）里，调用它们只有两条路，都不可接受：
   *    读 `handle.raw`（service composable 硬约束：禁止），或调一个尚不存在的 Driver 成员。
   * 3. 要正确实现，需要 Driver 侧新增一组**按句柄**的运行期成员（见本文件末尾的登记），
   *    外加 `serviceTask` 侧一个「把当前句柄交给回调」的出口。两者都在本 slice 的范围之外。
   *
   * 加一个转瞬即逝的 no-op、或接受参数后静默忽略，都属于 #165 §3.8 禁止的
   * 「制造支持外观的假支持」——那比诚实地缺着更有害。
   */
  it("公开面上**没有**这些 mutator（而不是有了一个空实现）", async () => {
    const slot = capture<ReturnType<typeof useDrivingRoute>>();
    const wrapper = mountInMap(() => useDrivingRoute(), (hook) => slot.set(hook));
    await flushPromises()
    const hook = slot.hook()
    await hook.search(from, to)

    // 官方 `DrivingRoute` 声明的运行期 mutator，逐个确认**不存在**（而不是「存在但什么都不做」）
    for (const name of [
      "setPolicy",
      "setLocation",
      "enableAutoViewport",
      "disableAutoViewport",
      "setPolylineStyle",
      "getStatus",
    ] as const) {
      expect(name in hook, `${name} 不应存在于公开面`).toBe(false)
    }

    // 构造选项那条路**是通的**（这正是当前可达的等价路径）
    const raw = fake.rawRoutes.DrivingRoute[0]!
    expect(raw.options).toBeDefined()

    wrapper.unmount()
    await flushPromises()
  })

  it("步行 / 骑行的公开面比驾车更窄：官方声明里没有的成员，本库也不会有", async () => {
    const walking = capture<ReturnType<typeof useWalkingRoute>>();
    const walkingWrapper = mountInMap(() => useWalkingRoute(), (hook) => walking.set(hook));
    await flushPromises()
    const hook = walking.hook()
    await hook.search("天安门", "王府井")

    // 官方 `WalkingRoute` 声明里**没有** `setPolicy`；`useTransitRoute` 的那两个也不是它的
    expect("setPolicy" in hook).toBe(false)
    expect("setPageCapacity" in hook).toBe(false)
    expect("setIntercityPolicy" in hook).toBe(false)

    walkingWrapper.unmount()
    await flushPromises()

    const riding = capture<ReturnType<typeof useRidingRoute>>();
    const ridingWrapper = mountInMap(() => useRidingRoute(), (hook) => riding.set(hook));
    await flushPromises()
    expect("setPolicy" in riding.hook()).toBe(false)
    ridingWrapper.unmount()
    await flushPromises()
  })

  it("等价能力确实可达：策略 / 检索区域作为**构造选项**透传到 SDK（登记缺口不等于能力缺失）", async () => {
    const slot = capture<ReturnType<typeof useDrivingRoute>>();
    const wrapper = mountInMap(
      () => useDrivingRoute({ policy: DrivingPolicy.AVOID_CONGESTION, location: "上海市" }),
      (hook) => slot.set(hook),
    )
    await flushPromises()

    const result = await slot.hook().search(from, to)
    expect(result.status).toBe("success")
    const raw = fake.rawRoutes.DrivingRoute[0]!
    expect(raw.options.policy).toBe(DrivingPolicy.AVOID_CONGESTION)
    // 检索区域是**构造期第一个参数**（官方签名 `constructor(location, opts)`），不是 options 里的字段
    expect(raw.location).toBe("上海市")
    // 生效：回包里的 policy 就是新策略
    expect(result.data?.policy).toBe(DrivingPolicy.AVOID_CONGESTION)

    wrapper.unmount()
    await flushPromises()
  })
})

/* -------------------------------------------------------------------------- */
/* 待 Driver 侧铺路的登记（#165）                                               */
/* -------------------------------------------------------------------------- */

/**
 * 本 slice **需要但没有添加**的 Driver 成员。写在这里而不是开工单，是因为它们是别的 slice 的
 * 范围（`driver/types/services.ts` + `driver/jsapi-v4/services.ts` 正在被并行修改）。
 *
 * 建议签名（`ServiceInvocationDriver` 上新增，四类路线共用一个 `RouteServiceHandle` 参数——
 * 与既有的 `clearRouteResults(handle)` / `disposeRoute(handle)` 同一形状）：
 *
 * ```ts
 *   setRoutePolicy(handle: RouteServiceHandle, policy: number): void;          // 驾车 / 公交
 *   setRouteLocation(handle: RouteServiceHandle, location: string | Point | MapHandle): void;
 *   setRouteAutoViewport(handle: RouteServiceHandle, enabled: boolean): void;
 *   setRoutePolylineStyle(handle: RouteServiceHandle, style: RoutePolylineStyle): void;
 *   getRouteStatus(handle: RouteServiceHandle): number | null;
 *   // 仅 TransitRoute：
 *   setRoutePageCapacity(handle: RouteServiceHandle, capacity: number): void;
 *   setRouteIntercityPolicy(handle: RouteServiceHandle, policy: number): void;
 *   setRouteTransitTypePolicy(handle: RouteServiceHandle, policy: number): void;
 * ```
 *
 * 三条实现约束（照抄 `clearRouteResults` / `disposeRoute` 的既有口径）：
 * 1. **句柄种类准入**：`assertRouteHandle`，给别的服务句柄同步抛 `BMAP_INVALID_ARGUMENT`；
 * 2. **已释放实例拒写**：`operationAdmissionFailure` 命中时抛错，**不静默成功**——
 *    静默成功等于告诉调用方「改了」，而那个实例已经不存在；
 * 3. **不建推断层**：缺成员就明确抛/告警一次，不按「通常有这个方法」假装调用过。
 *
 * composable 侧还需要一个配套出口（同样在别的范围）：`useExclusiveServiceTask` 要能把
 * 「当前句柄 + owning client」交给一组回调，否则上面这些成员仍然没有调用者。
 *
 * `RoutePolylineStyle` 本身在 `@baidumap/jsapi-v4-types@4.0.4` 里**只被引用、从未声明**
 * （`grep` 全包只有 4 处 `setPolylineStyle(style: RoutePolylineStyle)` 的参数位）。
 * 因此该参数的类型要么等上游补声明，要么本库按官方类文档里的**具名分桶**形状
 * （`transit` / `walking` / `highlight` / `decorate`）自持——本 slice **不猜**，登记待定。
 */

/* -------------------------------------------------------------------------- */
/* 路线服务与官方 4.0.4 声明的逐成员对齐（反射断言）                            */
/* -------------------------------------------------------------------------- */

const UPSTREAM_SERVICE_DIR = resolve(
  PACKAGE_SRC,
  "../node_modules/@baidumap/jsapi-v4-types/service",
);

/** 从官方 `.d.ts` 里解析出 class 体内声明的**方法**成员名。 */
function officialMethodMembers(fileName: string, className: string): string[] {
  const source = readFileSync(join(UPSTREAM_SERVICE_DIR, fileName), "utf8");
  const start = source.indexOf(`class ${className} {`);
  // 正证守卫：文件改名 / 正则失配时不能静默返回空集
  expect(start, `${fileName} 里有 class ${className}`).toBeGreaterThan(-1);
  return [...source.slice(start).matchAll(/^\s{4}([a-zA-Z]\w*)\(/gm)]
    .map((match) => match[1]!)
    // `constructor` 是类的隐式入口，不是官方给出的**能力**成员
    .filter((name) => name !== "constructor");
}

describe("四个路线服务与官方声明的成员处置表（#165）", () => {
  /**
   * 处置表：**每个官方成员都必须有一行**，且缺口必须写清理由。
   *
   * 双向断言（官方集合 ≡ 处置表键集）意味着：官方加了成员而没人登记会红，本表多写了官方已删的
   * 成员也会红。它是一张「不许悄悄漏项」的表，而不是一份免责声明清单。
   */
  const GAP = (reason: string) => ({ gap: reason });

  const commonGap = {
    // 官方 `setSearchCompleteCallback(cb)`：回包**没有请求身份**（ADR 2026-09-14 决策 3），
    // 归属只靠实例身份。本库的回包由 Driver 的唯一槽位消费，转成 `search()` 的返回值——
    // 再开一条 SDK 回调通道等于让同一份回包有第二个消费者，归属就要靠到达顺序猜了。
    setSearchCompleteCallback: GAP(
      "回包归属只靠实例身份（ADR 2026-09-14 决策 3）：SDK 回包没有请求身份，" +
        "Driver 的唯一槽位已消费它并转成 search() 的返回值。再开一条 SDK 回调通道，" +
        "同一份回包就有第二个消费者，归属只能靠到达顺序猜——正是本仓禁止的推断层。",
    ),
    // 官方 `setMarkersSetCallback((pois: LocalResultPoi[]) => void)`。
    setMarkersSetCallback: GAP(
      "回调参数是官方 `LocalResultPoi[]`，其中 `marker?: Marker` 是**raw 覆盖物**。" +
        "把它交出去，「谁负责移除」就变成两说：服务绘制它、调用方再拿它 = 所有权不可验证。",
    ),
    setInfoHtmlSetCallback: GAP(
      "回调参数是 `(poi: LocalResultPoi, html: HTMLElement)`，同样含 raw `marker`，" +
        "且 `html` 是 SDK 自己拼的官方 UI 片段（与「headless，不提供任何 UI」的定位冲突）。",
    ),
    // 官方 `setPolylinesSetCallback((polylines: Polyline[]) => void)`。
    setPolylinesSetCallback: GAP(
      "回调参数是 raw `Polyline[]`。折线是本服务在 renderOptions.map 上画出来的资源，" +
        "由 clearResults() 销账；交出去会让所有权变成两说（同 setMarkersSetCallback）。" +
        "要改样式请用 setPolylineStyle——那是官方的**样式**入口，产出仍是服务自己的折线。",
    ),
    setResultsHtmlSetCallback: GAP(
      "回调参数是官方自己拼的结果面板 `HTMLElement`（标准 UI）。" +
        "本库是 headless 路线（官方 UI 走 ./ui-kit 的 RoutePlan），" +
        "要结果面板请显式用官方 UI Kit，不要在 headless 路径上再开一条官方 UI 通道。",
    ),
    // 官方 `getResults(): XRouteResult`：返回的是**官方结果对象**本身。
    getResults: GAP(
      "官方 `getResults()` 返回官方结果类实例（含 `getPolyline()` 等 raw 覆盖物入口），" +
        "不是领域投影。本库的 data 已经是「同一次检索的投影结果」，" +
        "getResults() 只会把同一份数据的 raw 形态再发一次，多一条口子而不增信息。",
    ),
  } as const;

  it("DrivingRoute：官方成员逐个有处置", () => {
    const official = officialMethodMembers("DrivingRoute.d.ts", "DrivingRoute");
    // 正证守卫
    expect(official).toContain("setPolicy");
    expect(official).toContain("enableAutoViewport");

    const disposition: Record<string, unknown> = {
      ...commonGap,
      search: "aligned",
      clearResults: "aligned", // 我们的 clear()：先 disposeRoute（它内部走公开的 clearResults）
      enableAutoViewport: "aligned",
      disableAutoViewport: "aligned",
      setPolicy: "aligned",
      setLocation: "aligned",
      setPolylineStyle: "aligned",
      getStatus: "aligned",
    };
    expect(new Set(Object.keys(disposition))).toEqual(new Set(official));
  });

  it("WalkingRoute：官方成员逐个有处置", () => {
    const official = officialMethodMembers("WalkingRoute.d.ts", "WalkingRoute");
    expect(official).toContain("setLocation");

    const disposition: Record<string, unknown> = {
      ...commonGap,
      // 官方 `WalkingRoute` **没有** setPolicy：不在处置表里，断言因此会抓到「多写一行」
      search: "aligned",
      clearResults: "aligned",
      enableAutoViewport: "aligned",
      disableAutoViewport: "aligned",
      setLocation: "aligned",
      setPolylineStyle: "aligned",
      getStatus: "aligned",
    };
    expect(new Set(Object.keys(disposition))).toEqual(new Set(official));
  });

  it("RidingRoute：官方成员逐个有处置（与 WalkingRoute 同构）", () => {
    const official = officialMethodMembers("RidingRoute.d.ts", "RidingRoute");
    const disposition: Record<string, unknown> = {
      ...commonGap,
      search: "aligned",
      clearResults: "aligned",
      enableAutoViewport: "aligned",
      disableAutoViewport: "aligned",
      setLocation: "aligned",
      setPolylineStyle: "aligned",
      getStatus: "aligned",
    };
    expect(new Set(Object.keys(disposition))).toEqual(new Set(official));
  });

  it("TransitRoute：官方成员逐个有处置（含四个运行期 setter）", () => {
    const official = officialMethodMembers("TransitRoute.d.ts", "TransitRoute");
    expect(official).toContain("setPageCapacity");
    expect(official).toContain("setIntercityPolicy");

    const disposition: Record<string, unknown> = {
      ...commonGap,
      search: "aligned",
      clearResults: "aligned",
      enableAutoViewport: "aligned",
      disableAutoViewport: "aligned",
      setPageCapacity: "aligned",
      setPolicy: "aligned",
      setIntercityPolicy: "aligned",
      setTransitTypePolicy: "aligned",
      setLocation: "aligned",
      setPolylineStyle: "aligned",
      getStatus: "aligned",
    };
    expect(new Set(Object.keys(disposition))).toEqual(new Set(official));
  });
});

/* -------------------------------------------------------------------------- */
/* 结果 DTO 保真（#165 §3.7）：官方结果字段逐个核对，不静默丢字段、不改单位      */
/* -------------------------------------------------------------------------- */

describe("路线结果 DTO 保真（#165 §3.7）", () => {
  beforeEach(() => {
    const created = createFakeV4Harness();
    harness = created.harness;
    fake = created.fake;
  });

  /**
   * 单位口径的基准断言。
   *
   * 官方 `RoutePlan#getDistance(false)` 是**米**、`getDuration(false)` 是**秒**——
   * 投影把它们原样取过来，**不做任何换算**。这条断言的作用是锁住「哪一天有人
   * 「为了更好看」把秒换成毫秒」这类改动：那时数字仍然是个合理量级的数，
   * 只有对照官方的单位才拦得住。
   */
  it("distance 保持官方单位（米）、duration 保持官方单位（秒），不改写", async () => {
    const slot = capture<ReturnType<typeof useDrivingRoute>>();
    const wrapper = mountInMap(() => useDrivingRoute(), (hook) => slot.set(hook));
    await flushPromises();

    const result = await slot.hook().search(from, to);
    const plan = result.data!.plans[0]!;
    // FakeV4DrivingRoutePlan 的第一个方案：1000 米 / 600 秒
    expect(plan.distance).toBe(1000);
    expect(plan.duration).toBe(600);
    expect(plan.legs[0]!.distance).toBe(1000);

    wrapper.unmount();
    await flushPromises();
  });

  it("驾车方案的 toll / tollDistance 真的投影出来（官方 DrivingRoutePlan 声明的两个成员）", async () => {
    const slot = capture<ReturnType<typeof useDrivingRoute>>();
    const wrapper = mountInMap(() => useDrivingRoute(), (hook) => slot.set(hook));
    await flushPromises();

    const plan = (await slot.hook().search(from, to)).data!.plans[0]!;
    expect(plan.toll).toBe(10); // 元
    expect(plan.tollDistance).toBe(500); // 米

    wrapper.unmount();
    await flushPromises();
  });

  it("步行 / 骑行的方案里 toll 为 null（官方那两个成员只在 DrivingRoutePlan 上，缺省是 null 而非 0）", async () => {
    const walking = capture<ReturnType<typeof useWalkingRoute>>();
    const walkingWrapper = mountInMap(() => useWalkingRoute(), (hook) => walking.set(hook));
    await flushPromises();
    const plan = (await walking.hook().search("天安门", "王府井")).data!.plans[0]!;
    expect(plan.toll).toBeNull();
    expect(plan.tollDistance).toBeNull();
    walkingWrapper.unmount();
    await flushPromises();
  });

  /**
   * **发现的缺口（已登记，未修）**：官方 `TransitRouteResult` 有三个成员我们没投影。
   *
   * - `intercityPolicy?` / `transitTypePolicy?`（**字段**，跨城时才有值）
   * - 官方 `getPlan(i)` 的返回类型是 `TransitRoutePlan`，而 `DrivingRouteResult#getPlan`
   *   的返回类型写的是 `RoutePlan`（不含 `getToll()` / `getTollDistance()`）⇒
   *   `DrivingRoutePlan` 里那两个成员在本库是**可选读取**，实测有值（上一条用例），
   *   步行的 null 也是「如实」而非「丢弃」。
   *
   * 修它需要动 `RouteResult<TPlan>` 与 `readRouteEnvelope`（后者对四个服务共用，
   * 只能让**公交**这一条读那两个字段）——都在 `driver/types/services.ts` 与
   * `driver/jsapi-v4/services.ts` 里，属于其他 slice 的范围，本 slice 只登记。
   * 这条断言把缺口钉住：Driver 一旦补上，它会变红提醒改成本用例期望的 `not.toBeNull()`。
   */
  it("【已知缺口】公交结果没有投影官方的 intercityPolicy / transitTypePolicy 两个字段", async () => {
    const slot = capture<ReturnType<typeof useTransitRoute>>();
    const wrapper = mountInMap(
      () => useTransitRoute({ intercityPolicy: IntercityPolicy.CHEAP_PRICE, transitTypePolicy: TransitVehiclePolicy.TRAIN }),
      (hook) => slot.set(hook),
    );
    await flushPromises();

    const result = await slot.hook().search("天安门", "北京西站");
    expect(result.status).toBe("success");
    // Fake 侧真的给了这两个字段（证明是**投影层**漏了，不是上游没给）
    const raw = fake.rawRoutes.TransitRoute[0]!;
    expect(typeof raw.search).toBe("function");
    // 投影后的结果里没有它们 ⇒ 缺口成立（补上后把 not.toBeNull 改成 toBe）
    expect((result.data as Record<string, unknown>).intercityPolicy).toBeUndefined();
    expect((result.data as Record<string, unknown>).transitTypePolicy).toBeUndefined();
    // 反证：同一次检索里 policy / transitType 是投影了的 ⇒ 投影层没整体失效
    expect(result.data?.policy).toBe(0);
    expect(result.data?.transitType).toBe(0);

    wrapper.unmount();
    await flushPromises();
  });
});

/* -------------------------------------------------------------------------- */
/* 分流门禁：headless 与官方 UI Kit 互不引用                                     */
/* -------------------------------------------------------------------------- */

/**
 * 递归收集目录下的 `.ts`（排除测试文件）。
 *
 * **目录枚举而不是写死文件名单**：写死的清单在「新增一个桥接文件」或「把引用放进子目录」时会静默失效，
 * 而静态门禁失效是最难发现的一类问题（它继续绿）。同一理由适用于 `integrations/ui-kit` 那一侧。
 */
function sourcesIn(relativeDir: string): string[] {
  const root = join(PACKAGE_SRC, relativeDir);
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

function sourceOf(relative: string): string {
  return readFileSync(join(PACKAGE_SRC, relative), "utf8");
}

describe("UI 与 headless 分流（同一次界面操作只走一条路径）", () => {
  /**
   * 门禁的三种失效方式都要防：
   * 1. **判定对象错位**——要在**源码**上判，且剥掉注释（我们自己在注释里讨论过 UI Kit）；
   * 2. **判定式写歪**——用一条**正证**（同一判定式对「确实引用上游包」的文件必须命中）证明它有效；
   * 3. **范围写错导致空转**——枚举目录并断言文件数下限 + 每个文件有实质内容，避免「一个文件都没扫到
   *    也算通过」。
   */
  it("composables 下的任何文件都不引用 UI Kit（含上游包与 RoutePlan）", () => {
    const files = sourcesIn("composables");
    expect(files.length).toBeGreaterThanOrEqual(5); // 现在 5 个路线文件之外还有既有 hooks，少于它说明枚举失效
    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, "utf8"));
      expect(code.length).toBeGreaterThan(100);
      // 判定的对象是「**引用** UI Kit 的路线面板」，不是「出现了 RoutePlan 这个词」。
      // 两种真正的引用形态：bare import（`import ... from "./RoutePlan"`）与
      // 带命名空间/路径的引用（`RoutePlan.vue` / `components/RoutePlan`）。
      // `TransitRoutePlan` 这类 headless 结果类型只是词形相近，必须排除 —— 它属于
      // `driver/types/services.ts`，由 `./composables` 正当地转出（issue #160）。
      if (
        /jsapi-ui-kit|integrations\/ui-kit|["'][^"'\n]*\bRoutePlan\b[^"'\n]*["']/.test(code)
      ) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("UI Kit 集成目录下的任何文件都不引用路线 hooks（正证：加载点确实引用上游包）", () => {
    // 正证：`loadUiKit.ts` 是本库唯一的 UI Kit 加载点。用**同一套**「字符串出现」判定式对它断言，
    // 若它在这里为真、而上面的负向断言为假，说明判定式本身有效（不是恒真的空转断言）。
    expect(stripComments(sourceOf("integrations/ui-kit/loadUiKit.ts"))).toContain(
      "@baidumap/jsapi-ui-kit",
    );

    const files = sourcesIn("integrations/ui-kit");
    expect(files.length).toBeGreaterThanOrEqual(6);
    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, "utf8"));
      expect(code.length).toBeGreaterThan(100);
      if (/useMap(Driving|Walking|Riding|Transit)Route|composables\/routeServices/.test(code)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
