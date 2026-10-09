/**
 * useLocalSearch（M7-SERVICE-CORE / issue #38）
 *
 * 对应 issue 的「测试与验收」里属于 LocalSearch 的那几条：
 * - 翻页 / 周边 / 范围 / 空结果 / 失败；
 * - 并发、取消、迟到 callback、options 重建、卸载后不回写；
 * - 无 Map 的服务使用不伪造 MapContext（`<BMapProvider>` 子树可用，缺检索区域时**显式失败**）；
 * - 卸载后 SDK 实例被释放（走 Fake v4 的泄漏门禁，`localSearches` 必须归零）。
 *
 * 断言全部落在可观察事实上：Fake 的 `callLog`（真的调了哪个 SDK 入口）、`createdLocalSearches`
 * （实例创建次数）、归一化结果的 `status` / `sdkStatus`。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { defineComponent, h, nextTick, ref, shallowRef } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import Map from "../../packages/bmap-vue/src/components/map/Map.vue";
import BMapProvider from "../../packages/bmap-vue/src/components/provider/BMapProvider.vue";
import { useMap } from "../../packages/bmap-vue/src/composables/useMap";
import { useLocalSearch } from "../../packages/bmap-vue/src/composables/useLocalSearch";
import { createFakeV4Client, createFakeV4Harness } from "../../packages/test-utils";
import type { BMapClient } from "../../packages/bmap-vue/src/client/types";

/**
 * 每个用例一份 Fake（`harness.reset()` 只重置**诊断计数**，不清 `createdLocalSearches` 这类
 * 实例账本）。实例账本是本票用例的主要读数，跨用例复用会把「这一次创建了几个实例」读错。
 */
let harness: ReturnType<typeof createFakeV4Harness>["harness"];
let fake: ReturnType<typeof createFakeV4Harness>["fake"];
function provider() {
  return harness.provider();
}
function host() {
  return harness.container();
}

/**
 * 预热：先做一次不关心的检索把实例建出来，然后切成手动时序。
 *
 * LocalSearch 实例是**惰性创建**的（第一次 `search` 才建），因此「控制回包时序」的用例
 * 必须先有一次调用让实例存在，否则拿不到 `queue`。
 */
async function warmUp(hook: Hook, keyword = "预热") {
  const created = await hook.search(keyword);
  const raw = fake.createdLocalSearches[0];
  if (!raw) throw new Error("预热失败：没有创建 LocalSearch 实例");
  raw.queue.auto = false;
  return { raw, created };
}

type Hook = ReturnType<typeof useLocalSearch>;

/** 挂在 `<Map>` 子树里（有地图上下文）。 */
function mountInMap(run: (hook: Hook) => void | Promise<void>) {
  const el = host();
  const Child = defineComponent({
    setup() {
      const hook = useLocalSearch({ location: "北京市" });
      void Promise.resolve(run(hook));
      return () => h("div", "searcher");
    },
  });
  const wrapper = mount(
    defineComponent({
      components: { Map, Child },
      setup: () => () => h(Map, { provider: provider() }, () => [h(Child)]),
    }),
    { attachTo: el },
  );
  return wrapper;
}

/** 挂在 `<Map>` 子树里，并自定义构造选项。 */
function mountInMapWithOptions(
  options: Parameters<typeof useLocalSearch>[0],
  run: (hook: Hook) => void | Promise<void>,
) {
  const el = host();
  const Child = defineComponent({
    setup() {
      const hook = useLocalSearch(options);
      void Promise.resolve(run(hook));
      return () => h("div", "searcher");
    },
  });
  return mount(
    defineComponent({
      components: { Map, Child },
      setup: () => () => h(Map, { provider: provider() }, () => [h(Child)]),
    }),
    { attachTo: el },
  );
}

/** 只挂 `<BMapProvider>`（**没有地图实例**）：client-only 服务必须同样可用。 */
function mountInProvider(
  options: Parameters<typeof useLocalSearch>[0],
  customProvider?: ReturnType<typeof provider>,
) {
  const el = host();
  let hook: Hook | null = null;
  const Child = defineComponent({
    setup() {
      hook = useLocalSearch(options);
      return () => h("div", "searcher");
    },
  });
  const wrapper = mount(
    defineComponent({
      components: { BMapProvider, Child },
      setup: () => () =>
        h(
          BMapProvider,
          { definition: { provider: customProvider ?? provider(), loadOptions: { ak: "fake-ak" } } },
          () => [h(Child)],
        ),
    }),
    { attachTo: el },
  );
  return { wrapper, hook: () => hook };
}

type ProviderLike = ReturnType<typeof provider>;

/**
 * 把 harness 的 provider 包一层，让 `load()` 挂起直到 `release()`。
 *
 * 用来复现「Client/Map 还在加载」这个窗口：那时 `whenReady()` 未兑现，调用方**已经开始**一次
 * 检索，但还没有拿到 `ServiceCall`（PR #89 复审 P1 的真实触发场景）。
 */
function deferredProvider(): { provider: ProviderLike; release: () => void } {
  const base = provider();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  // 包装后的对象与 `base` 同形（只是 load 先等 gate），因此仍是同一份 provider 契约
  const wrapped = {
    ...(base.id !== undefined ? { id: base.id } : {}),
    ...(base.getCacheKey !== undefined
      ? { getCacheKey: (options: never) => base.getCacheKey?.(options) as string }
      : {}),
    load: async (...args: Parameters<NonNullable<ProviderLike["load"]>>) => {
      await gate;
      return base.load?.(...args);
    },
  } as unknown as ProviderLike;
  return { provider: wrapped, release: () => release() };
}

describe("useLocalSearch：headless 检索", () => {
  beforeEach(() => {
    const created = createFakeV4Harness();
    harness = created.harness;
    fake = created.fake;
  });

  it("search 归一化结果并给出统一状态；卸载后 SDK 实例被释放", async () => {
    let hook: Hook | null = null;
    const wrapper = mountInMap((h) => {
      hook = h;
    });
    await flushPromises();

    const result = await hook!.search("天安门");
    await flushPromises();

    expect(result.status).toBe("success");
    expect(result.data?.[0]?.keyword).toBe("天安门");
    expect(result.data?.[0]?.pois.map((poi) => poi.title)).toEqual(["天安门", "故宫博物院"]);
    expect(result.data?.[0]?.pageCount).toBe(1);
    expect(hook!.status.value).toBe("success");
    expect(hook!.isLoading.value).toBe(false);
    expect(hook!.data.value?.[0]?.city).toBe("北京市");
    expect(hook!.sdkStatus.value).toBe(0);
    expect(hook!.supported.value).toBe(true);
    // 真的走了一次 SDK 入口（先有构造、再有 search）
    const raw = fake.createdLocalSearches[0]!;
    expect(raw.callLog.filter((entry) => entry.startsWith("search:天安门"))).toHaveLength(1);

    wrapper.unmount();
    await flushPromises();
    // 卸载 ⇒ disposeLocalSearch ⇒ Fake 的 dispose 销账（泄漏门禁）
    harness.assertIdle("LocalSearch 卸载");
  });

  it("翻页：gotoPage 拿到下一页，页码无效时用官方状态码结算", async () => {
    let hook: Hook | null = null;
    // pageCapacity: 1 ⇒ Fake 的两条结果正好两页
    const inner = mountInMapWithOptions({ location: "北京市", pageCapacity: 1 }, (h) => {
      hook = h;
    });
    await flushPromises();

    const first = await hook!.search("餐厅");
    expect(first.data?.[0]?.pageCount).toBe(2);
    expect(first.data?.[0]?.pageIndex).toBe(0);

    const second = await hook!.gotoPage(1);
    expect(second.status).toBe("success");
    expect(second.data?.[0]?.pageIndex).toBe(1);
    expect(second.data?.[0]?.pageSize).toBe(1);
    expect(second.data?.[0]?.pois.map((poi) => poi.title)).toEqual(["故宫博物院"]);

    const invalid = await hook!.gotoPage(9);
    expect(invalid.status).toBe("failed");
    // 官方公开状态码：INVALID_REQUEST(5)
    expect(invalid.error?.code).toBe(5);
    expect(hook!.sdkStatus.value).toBe(5);

    inner.unmount();
    await flushPromises();
    harness.assertIdle("翻页之后");
  });

  it("周边与范围检索：center / bounds 归一化后落到对应 SDK 入口", async () => {
    let hook: Hook | null = null;
    const wrapper = mountInMap((h) => {
      hook = h;
    });
    await flushPromises();

    const nearby = await hook!.searchNearby("银行", { lng: 116.404, lat: 39.915 }, 2000);
    expect(nearby.status).toBe("success");

    const inBounds = await hook!.searchInBounds("超市", {
      southwest: { lng: 116.2, lat: 39.8 },
      northeast: { lng: 116.6, lat: 40 },
    });
    expect(inBounds.status).toBe("success");
    expect(inBounds.data?.[0]?.bounds).toEqual({
      southwest: { lng: 116.2, lat: 39.8 },
      northeast: { lng: 116.6, lat: 40 },
    });

    // 正证：每个动作**恰好**发一次请求（headless 通道不会额外再发一遍）
    const callLog = fake.createdLocalSearches[0]!.callLog;
    expect(callLog.filter((entry) => entry.startsWith("search:银行"))).toHaveLength(0);
    expect(callLog.filter((entry) => entry.startsWith("searchNearby:银行"))).toHaveLength(1);
    expect(callLog.filter((entry) => entry.startsWith("searchInBounds:超市"))).toHaveLength(1);
    expect(fake.createdLocalSearches).toHaveLength(1);

    wrapper.unmount();
    await flushPromises();
  });

  it("空结果：拿到合法回包但 0 条 ⇒ success + 空 pois（不是 empty）", async () => {
    let hook: Hook | null = null;
    const wrapper = mountInMap((h) => {
      hook = h;
    });
    await flushPromises();
    // 让 SDK 侧「查无结果」：结果点为空数组（实例此刻已建好）
    await warmUp(hook!);
    fake.createdLocalSearches[0]!.queue.auto = true;
    fake.createdLocalSearches[0]!.pois = [];

    const result = await hook!.search("不存在的店");
    expect(result.status).toBe("success");
    expect(result.data?.[0]?.pois).toEqual([]);
    expect(result.data?.[0]?.total).toBe(0);
    // 注意 `isEmpty` 是 `data === null`：**拿到了合法回包但结果为空仍是 `success`**，
    // 因此这里 `isEmpty` 为 false——「0 条结果」由 `pois.length` / `total` 表达，比压成
    // `empty` 更有信息量（`empty` 留给「回包不可用」）。
    expect(hook!.isEmpty.value).toBe(false);
    expect(hook!.status.value).toBe("success");

    wrapper.unmount();
    await flushPromises();
  });

  it("服务失败：公开状态码 ⇒ failed + sdkStatus（不编造原因）", async () => {
    let hook: Hook | null = null;
    const wrapper = mountInMap((h) => {
      hook = h;
    });
    await flushPromises();
    const { raw } = await warmUp(hook!);
    raw.queue.auto = true;
    raw.overridePayload = null;
    raw.status = 7; // BMAP_STATUS_SERVICE_UNAVAILABLE

    const result = await hook!.search("餐厅");
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe(7);
    expect(hook!.isError.value).toBe(true);
    expect(hook!.sdkStatus.value).toBe(7);

    wrapper.unmount();
    await flushPromises();
  });

  it("取消：逻辑取消（canceled），data 保留上一次的结果", async () => {
    let hook: Hook | null = null;
    const wrapper = mountInMap((h) => {
      hook = h;
    });
    await flushPromises();
    const { raw } = await warmUp(hook!);

    const pending = hook!.search("餐厅");
    await flushPromises();
    hook!.cancel();
    const settled = await pending;

    expect(settled.status).toBe("canceled");
    expect(hook!.status.value).toBe("idle");
    expect(hook!.isLoading.value).toBe(false);
    // 迟到回包不得复活已取消的调用（data 仍是预热那次的结果，没被写坏）
    raw.queue.flush();
    await flushPromises();
    expect(hook!.data.value?.[0]?.keyword).toBe("预热");

    wrapper.unmount();
    await flushPromises();
  });

  it("旧请求不得覆盖新结果：取代会换新实例，旧实例的迟到回包不污染新结果", async () => {
    let hook: Hook | null = null;
    const wrapper = mountInMap((h) => {
      hook = h;
    });
    await flushPromises();
    const { raw: firstRaw } = await warmUp(hook!);

    const first = hook!.search("第一个");
    await flushPromises();
    // 正证：第一次检索**仍在飞**（回包还没到）——只有这时才谈得上「取代」
    expect(firstRaw.queue.pending).toBe(1);
    const second = hook!.search("第二个");
    await flushPromises();

    // 取代 = 换新实例（官方只承诺单次多关键字内部顺序，跨请求顺序无承诺）
    expect(fake.createdLocalSearches, "取代时必须新建实例").toHaveLength(2);
    // 旧实例的结果集被释放（含它画出的标注）——公开的 clearResults()
    expect(firstRaw.callLog, "旧实例必须走公开 clearResults 清理").toContain("clearResults");

    // 旧实例的迟到回包到达：它只能落到**已释放**的旧实例上，与新结果无关
    expect(firstRaw.queue.flush()).toBe(1);
    await flushPromises();

    expect((await first).status).toBe("canceled");
    const settled = await second;
    expect(settled.status).toBe("success");
    expect(settled.data?.[0]?.keyword).toBe("第二个");
    expect(hook!.data.value?.[0]?.keyword).toBe("第二个");

    wrapper.unmount();
    await flushPromises();
  });

  it("卸载后回包不回写（scope dispose 之后状态不再变化）", async () => {
    let hook: Hook | null = null;
    const wrapper = mountInMap((h) => {
      hook = h;
    });
    await flushPromises();
    const { raw } = await warmUp(hook!);

    void hook!.search("餐厅");
    await flushPromises();
    wrapper.unmount();
    raw.queue.flush();
    await flushPromises();

    // 卸载之后状态冻结在「在飞」，回包没有回写
    expect(hook!.data.value?.[0]?.keyword).toBe("预热");
    expect(hook!.status.value).toBe("loading");
    harness.assertIdle("卸载后迟到回包");
  });
});

describe("useLocalSearch：与地图 / 上下文的边界", () => {
  beforeEach(() => {
    const created = createFakeV4Harness();
    harness = created.harness;
    fake = created.fake;
  });

  it("只有 ClientContext（<BMapProvider> 子树）：显式 location 可用，不伪造 MapContext", async () => {
    const { wrapper, hook } = mountInProvider({ location: "上海市" });
    await flushPromises();

    const result = await hook()!.search("餐厅");
    expect(result.status).toBe("success");
    expect(fake.createdLocalSearches[0]!.location).toBe("上海市");
    // 没有地图 ⇒ 不会去绘制
    expect(fake.createdLocalSearches[0]!.options.renderOptions).toBeUndefined();

    wrapper.unmount();
    await flushPromises();
    harness.assertIdle("Provider 子树");
  });

  it("Client 还在加载时 gotoPage 必须被拒绝，且不得作废在飞的检索（PR #89 复审 P1）", async () => {
    const deferred = deferredProvider();
    const { wrapper, hook } = mountInProvider({ location: "上海市" }, deferred.provider);
    await flushPromises();

    // 检索已开始，但 Client/Map 还没 ready（`whenReady()` 未兑现）——此时还没有 ServiceCall
    const pending = hook()!.search("餐厅");
    await flushPromises();
    expect(hook()!.status.value).toBe("loading");

    const refused = hook()!.gotoPage(1);
    await flushPromises();

    // 放行加载：两条都会继续（被拒绝的那条不该发起请求）
    deferred.release();
    await flushPromises();
    const [refusedResult, settled] = [await refused, await pending];

    expect(refusedResult.status, "未结算时翻页必须被拒绝").toBe("failed");
    expect(refusedResult.error?.code).toBe("BMAP_SERVICE_FAILED");
    expect(refusedResult.error?.message).toContain("翻页");
    expect(settled.status, "第一条检索不得被这次翻页作废").toBe("success");
    expect(settled.data?.[0]?.keyword).toBe("餐厅");
    expect(fake.createdLocalSearches).toHaveLength(1);

    wrapper.unmount();
    await flushPromises();
  });

  it("没有地图又没有 location ⇒ failed(BMAP_INVALID_ARGUMENT)，一次都不落到 SDK", async () => {
    const { wrapper, hook } = mountInProvider({});
    await flushPromises();

    const result = await hook()!.search("餐厅");
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("BMAP_INVALID_ARGUMENT");
    expect(fake.createdLocalSearches).toHaveLength(0);

    wrapper.unmount();
    await flushPromises();
  });

  it("绘制必须显式传 MapHandle：传了才把 raw Map 交给 SDK", async () => {
    const el = host();
    let hook: Hook | null = null;
    const Child = defineComponent({
      setup() {
        const { map } = useMap();
        hook = useLocalSearch({ location: "北京市", renderOptions: { map, autoViewport: true } });
        return () => h("div");
      },
    });
    const wrapper = mount(
      defineComponent({
        components: { Map, Child },
        setup: () => () => h(Map, { provider: provider() }, () => [h(Child)]),
      }),
      { attachTo: el },
    );
    await flushPromises();

    const result = await hook!.search("餐厅");
    expect(result.status).toBe("success");
    const renderOptions = fake.createdLocalSearches[0]!.options.renderOptions as Record<
      string,
      unknown
    >;
    expect(renderOptions.autoViewport).toBe(true);
    // 传给 SDK 的是 raw Map（不是句柄对象）
    expect(renderOptions.map).toBe(fake.createdMaps[0]);

    wrapper.unmount();
    await flushPromises();
    harness.assertIdle("显式绘制");
  });

  it("绘制目标不是 MapHandle ⇒ failed（不把非法值透传给 SDK）", async () => {
    const { wrapper, hook } = mountInProvider({
      location: "北京市",
      renderOptions: { map: {} as never },
    });
    await flushPromises();

    const result = await hook()!.search("餐厅");
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("BMAP_INVALID_ARGUMENT");
    expect(fake.createdLocalSearches).toHaveLength(0);

    wrapper.unmount();
    await flushPromises();
  });

  it("viewportOptions 走官方四个成员：enableAnimation / margins / zoomFactor / callback", async () => {
    let fired = 0;
    const callback = (): void => {
      fired += 1;
    };
    const { wrapper, hook } = mountInProvider({
      location: "北京市",
      renderOptions: {
        autoViewport: true,
        viewportOptions: {
          enableAnimation: true,
          margins: [30, 20, 0, 20],
          zoomFactor: -1,
          callback,
        },
      },
    });
    await flushPromises();

    const result = await hook()!.search("餐厅");
    expect(result.status).toBe("success");
    const viewport = (fake.createdLocalSearches[0]!.options.renderOptions as {
      viewportOptions: Record<string, unknown>;
    }).viewportOptions;
    expect(viewport).toEqual({
      enableAnimation: true,
      margins: [30, 20, 0, 20],
      zoomFactor: -1,
      callback,
    });
    // 「视野调整结束后的回调」是真会触发的语义，不是收下就算的装饰
    expect(fired).toBe(1);

    wrapper.unmount();
    await flushPromises();
    harness.assertIdle("viewportOptions");
  });

  it("非官方成员 noAnimation 不再出现在公共面上（JS 调用方硬塞也不转发）", async () => {
    const { wrapper, hook } = mountInProvider({
      location: "北京市",
      renderOptions: {
        autoViewport: true,
        // 官方 `ViewportOptions` 没有 `noAnimation`：伪造一个成员塞进来，Driver 必须丢掉
        viewportOptions: { noAnimation: true, zoomFactor: 2 } as never,
      },
    });
    await flushPromises();

    const result = await hook()!.search("餐厅");
    expect(result.status).toBe("success");
    const viewport = (fake.createdLocalSearches[0]!.options.renderOptions as {
      viewportOptions: Record<string, unknown>;
    }).viewportOptions;
    expect(viewport).toEqual({ zoomFactor: 2 });

    wrapper.unmount();
    await flushPromises();
    harness.assertIdle("noAnimation 被丢弃");
  });
});

describe("useLocalSearch：构造字段变化才重建", () => {
  beforeEach(() => {
    const created = createFakeV4Harness();
    harness = created.harness;
    fake = created.fake;
  });

  it("重复调用不重建实例；构造字段变化才重建一次", async () => {
    const el = host();
    const pageCapacity = ref<number | undefined>(undefined);
    let hook: Hook | null = null;
    const Child = defineComponent({
      setup() {
        hook = useLocalSearch({ location: "北京市", pageCapacity });
        return () => h("div");
      },
    });
    const wrapper = mount(
      defineComponent({
        components: { Map, Child },
        setup: () => () => h(Map, { provider: provider() }, () => [h(Child)]),
      }),
      { attachTo: el },
    );
    await flushPromises();

    await hook!.search("餐厅");
    await hook!.search("超市");
    expect(fake.createdLocalSearches, "同一份构造选项只创建一个实例").toHaveLength(1);

    pageCapacity.value = 1;
    await nextTick();
    await flushPromises();
    await hook!.search("银行");
    expect(fake.createdLocalSearches, "构造字段变化后重建").toHaveLength(2);
    const rebuilt = fake.createdLocalSearches[1]!;
    expect(rebuilt.options.pageCapacity).toBe(1);
    // 旧实例被释放（泄漏门禁只在卸载时统一断言，这里先确认公开清理真的被调用）
    expect(fake.createdLocalSearches[0]!.callLog).toContain("clearResults");

    // 变化之后再重复调用仍然不重建
    await hook!.search("医院");
    expect(fake.createdLocalSearches).toHaveLength(2);

    wrapper.unmount();
    await flushPromises();
    harness.assertIdle("重建之后");
  });

  it("取消之后的下一次检索换新实例（旧实例不再复用）", async () => {
    let hook: Hook | null = null;
    const wrapper = mountInMap((h) => {
      hook = h;
    });
    await flushPromises();
    const { raw: firstRaw } = await warmUp(hook!);
    expect(fake.createdLocalSearches).toHaveLength(1);

    // 取消一次在飞检索：实例从此不是可靠的请求通道（SDK 侧回包可能仍在路上）
    const pending = hook!.search("第一个");
    await flushPromises();
    hook!.cancel();
    expect((await pending).status).toBe("canceled");
    // 取消**不**立刻清掉已经画出的结果（`data` 仍保留给调用方看），旧实例在下一次调用时才交还清理
    expect(firstRaw.callLog).not.toContain("clearResults");

    const retried = await hook!.search("第二个");
    expect(retried.status, "换新实例后检索照常可用").toBe("success");
    expect(fake.createdLocalSearches, "下一次 search 必须换新实例").toHaveLength(2);
    expect(firstRaw.callLog, "旧实例在下一次调用时才被释放（公开 clearResults）").toContain(
      "clearResults",
    );

    // 旧实例的迟到回包不影响新结果
    firstRaw.queue.flush();
    await flushPromises();
    expect(hook!.data.value?.[0]?.keyword).toBe("第二个");

    wrapper.unmount();
    await flushPromises();
  });

  it("gotoPage 在检索进行中被显式拒绝（不空转到超时）", async () => {
    let hook: Hook | null = null;
    const wrapper = mountInMap((h) => {
      hook = h;
    });
    await flushPromises();
    const { raw } = await warmUp(hook!);

    const pending = hook!.search("第一个");
    await flushPromises();
    expect(raw.queue.pending, "正证：检索确实在飞").toBe(1);

    const refused = await hook!.gotoPage(1);
    expect(refused.status).toBe("failed");
    expect(refused.error?.code).toBe("BMAP_SERVICE_FAILED");
    expect(refused.error?.message).toContain("翻页");
    expect(raw.callLog.filter((entry) => entry.startsWith("gotoPage")), "不得落到 SDK").toHaveLength(0);

    raw.queue.flush();
    expect((await pending).status).toBe("success");

    wrapper.unmount();
    await flushPromises();
  });

  it("clear() 调 SDK 的 clearResults 并清空本地状态", async () => {
    let hook: Hook | null = null;
    const wrapper = mountInMap((h) => {
      hook = h;
    });
    await flushPromises();

    await hook!.search("餐厅");
    expect(hook!.data.value).not.toBeNull();

    hook!.clear();
    await flushPromises();

    expect(fake.createdLocalSearches[0]!.callLog).toContain("clearResults");
    expect(hook!.data.value).toBeNull();
    expect(hook!.status.value).toBe("idle");

    // 结果集与绘制物都挂在实例上：清空 = 释放实例，下一次检索换新实例
    const again = await hook!.search("超市");
    expect(again.status).toBe("success");
    expect(fake.createdLocalSearches).toHaveLength(2);

    wrapper.unmount();
    await flushPromises();
  });
});

/* ------------------------------------------------------------------ 官方同步成员（#165） */

/**
 * 官方的 `getPageCapacity` / `setPageCapacity` / `getPageNum` / `setPageNum` / `clearSelected` /
 * `setLocation` 都是**同步**成员。它们走 `withHandle` 通道（活实例上的原地读/写），
 * **不**发请求、**不**改 `status`，也**不**为了设一个值而顺手创建 SDK 实例。
 */
describe("useLocalSearch：官方同步成员走活实例通道", () => {
  beforeEach(() => {
    const created = createFakeV4Harness();
    harness = created.harness;
    fake = created.fake;
  });

  it("没有活实例时抛错，且不会为了 setPageCapacity 创建实例", () => {
    let hasInstanceAtStart: boolean | null = null;
    let thrown: unknown = null;
    mountInMap((hook) => {
      hasInstanceAtStart = hook.hasInstance();
      try {
        hook.setPageCapacity(20);
      } catch (error) {
        thrown = error;
      }
    });

    expect(hasInstanceAtStart).toBe(false);
    expect((thrown as Error)?.message).toContain("还没有可用的服务实例");
    // 关键：没有实例就**不建**——否则「设个分页容量」会静默产生一个 SDK 对象
    expect(fake.createdLocalSearches).toHaveLength(0);
  });

  it("search 之后同步成员可用，且调用的是官方的同步入口", async () => {
    let readBack: { capacity: number; page: number } | null = null;
    let hadInstance: boolean | null = null;
    const wrapper = mountInMap(async (hook) => {
      await hook.search("天安门");
      hadInstance = hook.hasInstance();
      hook.setPageCapacity(20);
      hook.setPageNum(2);
      readBack = { capacity: hook.getPageCapacity(), page: hook.getPageNum() };
    });
    await flushPromises();
    await nextTick();

    expect(hadInstance).toBe(true);
    expect(readBack!.capacity).toBe(20);
    expect(readBack!.page).toBe(2);
    const log = fake.createdLocalSearches[0]!.callLog;
    expect(log).toContain("setPageCapacity:20");
    expect(log).toContain("setPageNum:2");
    wrapper.unmount();
  });

  it("同步成员不改 status（设置一个值不该把状态打成 loading）", async () => {
    let statusAfterSync: string | null = null;
    const wrapper = mountInMap(async (hook) => {
      await hook.search("天安门");
      const before = hook.status.value;
      hook.setPageCapacity(15);
      hook.clearSelected();
      statusAfterSync = hook.status.value === before ? before : `changed:${hook.status.value}`;
    });
    await flushPromises();
    await nextTick();

    expect(statusAfterSync).toBe("success");
    wrapper.unmount();
  });

  it("setLocation 走官方入口，且不改实例身份（仍是同一个实例）", async () => {
    let countBefore = 0;
    const wrapper = mountInMap(async (hook) => {
      await hook.search("天安门");
      countBefore = fake.createdLocalSearches.length;
      hook.setLocation("上海市");
    });
    await flushPromises();
    await nextTick();

    const raw = fake.createdLocalSearches[0]!;
    expect(raw.callLog).toContain("setLocation:上海市");
    // 原地改：不重建实例（重建会让已画出的结果与在飞调用一起失效）
    expect(fake.createdLocalSearches).toHaveLength(countBefore);
    wrapper.unmount();
  });

  it("clear() 之后实例没了，同步成员重新变为不可用", async () => {
    let afterClear: boolean | null = null;
    const wrapper = mountInMap(async (hook) => {
      await hook.search("天安门");
      hook.clear();
      afterClear = hook.hasInstance();
    });
    await flushPromises();
    await nextTick();

    expect(afterClear).toBe(false);
    wrapper.unmount();
  });
});

describe("useLocalSearch：同步设置必须活过实例重建（评审 P1）", () => {
  beforeEach(() => {
    const created = createFakeV4Harness();
    harness = created.harness;
    fake = created.fake;
  });

  it("search A（未结算）→ setLocation → search B：B 用的是新区域，不是旧构造参数", async () => {
    let secondKeywordLocation: unknown = null;
    const wrapper = mountInMapWithOptions({ location: "北京市" }, async (hook) => {
      // 先预热把实例建出来（`auto=false` 必须**在**那次「未结算检索」之前设好，
      // 否则回包已经排进队列了）。
      await hook.search("预热");
      const raw = fake.createdLocalSearches[0]!;
      raw.queue.auto = false;

      const first = hook.search("A"); // 挂着不结算
      await nextTick();
      hook.setLocation("上海市");
      expect(raw.callLog).toContain("setLocation:上海市");

      const second = hook.search("B"); // 取代在飞检索 ⇒ supersede("recreate") 重建
      await nextTick();
      // 重建出的新实例：location 必须是 setter 设过的那个，而不是构造期的「北京市」
      const newest = fake.createdLocalSearches.at(-1)!;
      secondKeywordLocation = newest.location;

      raw.queue.flush();
      await first;
      await second;
    });
    await flushPromises();
    await nextTick();

    expect(fake.createdLocalSearches.length).toBeGreaterThan(1); // 确实重建了
    expect(String(secondKeywordLocation)).toBe("上海市");
    wrapper.unmount();
  });

  it("setPageCapacity 活过重建（新实例按新容量构造）", async () => {
    let newestCapacity: unknown = null;
    const wrapper = mountInMap(async (hook) => {
      await hook.search("预热");
      const raw = fake.createdLocalSearches[0]!;
      raw.queue.auto = false;

      const first = hook.search("A");
      await nextTick();
      hook.setPageCapacity(20);
      const second = hook.search("B");
      await nextTick();
      newestCapacity = (fake.createdLocalSearches.at(-1)!.options as any).pageCapacity;

      raw.queue.flush();
      await first;
      await second;
    });
    await flushPromises();
    await nextTick();

    expect(newestCapacity).toBe(20);
    wrapper.unmount();
  });

  it("声明式选项变化会作废运行期覆盖（改了 ref 必须生效）", async () => {
    const locationRef = ref<"北京市" | "广州市">("北京市");
    const el = host();
    let hook: Hook | null = null;
    const Child = defineComponent({
      setup() {
        hook = useLocalSearch(() => ({ location: locationRef.value }));
        return () => h("div", "searcher");
      },
    });
    const wrapper = mount(
      defineComponent({
        components: { Map, Child },
        setup: () => () => h(Map, { provider: provider() }, () => [h(Child)]),
      }),
      { attachTo: el },
    );

    const h1 = hook!;
    await h1.search("A");
    h1.setLocation("上海市");
    locationRef.value = "广州市"; // 声明式变化 ⇒ 覆盖作废
    await nextTick();
    await h1.search("B");
    await flushPromises();

    expect(String(fake.createdLocalSearches.at(-1)!.location)).toBe("广州市");
    wrapper.unmount();
  });
});

describe("useLocalSearch：假 SDK 与官方边界语义一致（评审 P2）", () => {
  beforeEach(() => {
    const created = createFakeV4Harness();
    harness = created.harness;
    fake = created.fake;
  });

  it("构造期 pageNum 生效（getPageNum 不是恒 0）", async () => {
    let page: number | null = null;
    const wrapper = mountInMapWithOptions({ location: "北京市", pageNum: 2 }, async (hook) => {
      await hook.search("天安门");
      page = hook.getPageNum();
    });
    await flushPromises();
    await nextTick();

    expect(page).toBe(2);
    wrapper.unmount();
  });

  it("setPageCapacity 超范围按官方重置为 10（假 SDK 不宽松放行）", async () => {
    let over: number | null = null;
    let ok: number | null = null;
    const wrapper = mountInMap(async (hook) => {
      await hook.search("天安门");
      hook.setPageCapacity(200);
      over = hook.getPageCapacity();
      hook.setPageCapacity(50);
      ok = hook.getPageCapacity();
    });
    await flushPromises();
    await nextTick();

    expect(over).toBe(10);
    expect(ok).toBe(50);
    wrapper.unmount();
  });

  it("setPageNum 无效值按官方重置为 0", async () => {
    let afterInvalid: number | null = null;
    const wrapper = mountInMap(async (hook) => {
      await hook.search("天安门");
      hook.setPageNum(-3);
      afterInvalid = hook.getPageNum();
    });
    await flushPromises();
    await nextTick();

    expect(afterInvalid).toBe(0);
    wrapper.unmount();
  });
});

describe("useLocalSearch：运行期覆盖的重建语义（第二轮评审 P1/P2）", () => {
  beforeEach(() => {
    const created = createFakeV4Harness();
    harness = created.harness;
    fake = created.fake;
  });

  it("P2：重建重放的是 **SDK 生效值**，不是 setter 原始入参", async () => {
    const capacityAfterRebuild: number[] = [];
    const pageAfterRebuild: number[] = [];
    const wrapper = mountInMap(async (hook) => {
      await hook.search("天安门");
      // 官方把越界值归一到 10；覆盖里必须记 10 而不是 200
      hook.setPageCapacity(200);
      expect(hook.getPageCapacity()).toBe(10);
      hook.setPageNum(-3);
      expect(hook.getPageNum()).toBe(0);

      // 触发重建：clear() 丢弃实例，下一次 search() 用覆盖里的值重建
      hook.clear();
      await hook.search("天安门");
      capacityAfterRebuild.push(hook.getPageCapacity());
      pageAfterRebuild.push(hook.getPageNum());
    });
    await flushPromises();
    await nextTick();

    // 重建前后必须一致（原实现会把 200 / -3 当构造参数传下去，得到 200 / -3）
    expect(capacityAfterRebuild).toEqual([10]);
    expect(pageAfterRebuild).toEqual([0]);
    wrapper.unmount();
  });

  it("P2：Fake 成功翻页后 getPageNum() 与 data[0].pageIndex 一致（失败翻页不动）", async () => {
    let afterOk: { index: number | undefined; page: number } | null = null;
    let afterBad: number | null = null;
    const wrapper = mountInMapWithOptions({ location: "北京市", pageCapacity: 1 }, async (hook) => {
      await hook.search("天安门");
      const ok = await hook.gotoPage(1);
      afterOk = { index: ok.data?.[0]?.pageIndex, page: hook.getPageNum() };
      // 越界页码：官方状态码 5，页码不变
      await hook.gotoPage(99);
      afterBad = hook.getPageNum();
    });
    await flushPromises();
    await nextTick();

    expect(afterOk!.index).toBe(1);
    expect(afterOk!.page).toBe(1); // 同一实例上两者不矛盾
    expect(afterBad).toBe(1); // 失败翻页不更新
    wrapper.unmount();
  });

});

describe("useLocalSearch：假 SDK 的页码 / 容量一致性（第三轮评审 P2/P3）", () => {
  beforeEach(() => {
    const created = createFakeV4Harness();
    harness = created.harness;
    fake = created.fake;
  });

  it("构造期 pageNum 让**结果集**也从该页开始（getter 与 data[0].pageIndex 不矛盾）", async () => {
    let outcome: { page: number; index: number | undefined } | null = null;
    const wrapper = mountInMapWithOptions(
      { location: "北京市", pageCapacity: 1, pageNum: 1 },
      async (hook) => {
        await hook.search("天安门");
        outcome = { page: hook.getPageNum(), index: hook.data.value?.[0]?.pageIndex };
      },
    );
    await flushPromises();
    await nextTick();

    expect(outcome!.page).toBe(1);
    expect(outcome!.index).toBe(1); // 原实现恒为 0
    wrapper.unmount();
  });

  it("gotoPage 后再 search：新结果集与该实例的页码仍然一致", async () => {
    let outcome: { page: number; index: number | undefined } | null = null;
    const wrapper = mountInMapWithOptions({ location: "北京市", pageCapacity: 1 }, async (hook) => {
      await hook.search("A");
      await hook.gotoPage(1);
      await hook.search("B");
      outcome = { page: hook.getPageNum(), index: hook.data.value?.[0]?.pageIndex };
    });
    await flushPromises();
    await nextTick();

    expect(outcome!.page).toBe(outcome!.index);
    wrapper.unmount();
  });

  it("构造期与 setter 的容量规则一致：非整数一律归一为 10", async () => {
    let fromCtor: number | null = null;
    let fromSetter: number | null = null;
    const wrapper = mountInMapWithOptions(
      { location: "北京市", pageCapacity: 1.5 },
      async (hook) => {
        await hook.search("天安门"); // 先要有活实例
        fromCtor = hook.getPageCapacity();
        hook.setPageCapacity(1.5);
        fromSetter = hook.getPageCapacity();
      },
    );
    await flushPromises();
    await nextTick();

    // 同一输入不得出现两套规则（构造期收 1.5、setter 归 10）
    expect(fromCtor).toBe(10);
    expect(fromSetter).toBe(10);
    wrapper.unmount();
  });
});

describe("useLocalSearch：BMapProvider 下的外部同 Client 句柄（第四轮评审 P2）", () => {
  beforeEach(() => {
    const created = createFakeV4Harness();
    harness = created.harness;
    fake = created.fake;
  });

  it("setLocation(兄弟 <Map> 的句柄) 活过 rebuild：不因 ctx.map 为 null 被丢弃", async () => {
    let hook: Hook | null = null;
    let mapRef: { value: unknown } | null = null;
    const Searcher = defineComponent({
      setup() {
        // 只挂 <BMapProvider>：本 composable 的 ctx.map 恒为 null（client-only 服务）
        hook = useLocalSearch({ location: "北京市" });
        return () => h("div", "searcher");
      },
    });
    const Capture = defineComponent({
      setup() {
        mapRef = useMap().map as unknown as { value: unknown };
        return () => h("div", "capture");
      },
    });
    const wrapper = mount(
      defineComponent({
        components: { BMapProvider, Map, Searcher, Capture },
        setup: () =>
          () =>
            h(BMapProvider, { provider: provider() }, () => [
              // 兄弟 <Map>：**不传 provider** 才会继承父 Provider 的 Client
              // （传了 provider 它会自建一个 Client，句柄就成了跨 Client 的）
              h(Map, () => [h(Capture)]),
              h(Searcher),
            ]),
      }),
      { attachTo: host() },
    );

    const h1 = hook!;
    await h1.search("天安门");
    await flushPromises();
    expect(mapRef!.value, "兄弟 <Map> 应已就绪并交出句柄").toBeTruthy();
    h1.setLocation(mapRef!.value as never);

    // 触发重建：clear() 丢弃实例，下一次 search() 重新构造
    h1.clear();
    await h1.search("故宫");
    await flushPromises();

    const newest = fake.createdLocalSearches.at(-1)!;
    // Driver 的 `normalizeSearchLocation` 把 MapHandle 解析成 raw Map 再交给 SDK，
    // 因此这里断言的是**那张 raw 地图**（而不是句柄对象，也不是声明式的「北京市」）。
    expect(newest.location).not.toBe("北京市");
    expect(newest.location).toBe(fake.createdMaps[0]);
    wrapper.unmount();
  });


  it("同 Client 但地图已销毁 ⇒ 覆盖被丢弃并回退声明式（第三轮 P2 的端到端）", async () => {
    let hook: Hook | null = null;
    let mapRef: { value: unknown } | null = null;
    const showMap = ref(true);
    const Searcher = defineComponent({
      setup() {
        hook = useLocalSearch({ location: "北京市" });
        return () => h("div", "searcher");
      },
    });
    const Capture = defineComponent({
      setup() {
        mapRef = useMap().map as unknown as { value: unknown };
        return () => h("div", "capture");
      },
    });
    const wrapper = mount(
      defineComponent({
        components: { BMapProvider, Map, Searcher, Capture },
        setup: () =>
          () =>
            h(BMapProvider, { provider: provider() }, () => [
              showMap.value ? h(Map, () => [h(Capture)]) : null,
              h(Searcher),
            ]),
      }),
      { attachTo: host() },
    );

    const h1 = hook!;
    await h1.search("天安门");
    await flushPromises();
    const liveHandle = mapRef!.value;
    expect(liveHandle).toBeTruthy();
    h1.setLocation(liveHandle as never);

    // 卸载地图：`MapRuntime.dispose()` → `driver.map.destroy()` → registry 标记句柄已销毁
    showMap.value = false;
    await nextTick();
    await flushPromises();

    h1.clear();
    await h1.search("故宫");
    await flushPromises();

    const newest = fake.createdLocalSearches.at(-1)!;
    // 已销毁的句柄不得被重放：必须回退到声明式 location（否则会把死地图交给新实例）
    expect(newest.location).toBe("北京市");
    wrapper.unmount();
  });
});

describe("useLocalSearch：MapHandle 覆盖的显式契约（第五轮评审 P1/P2）", () => {
  beforeEach(() => {
    const created = createFakeV4Harness();
    harness = created.harness;
    fake = created.fake;
  });

  it("已失效的 MapHandle：setLocation 当场拒绝，而不是先接受再静默丢弃", async () => {
    let hook: Hook | null = null;
    let mapRef: { value: unknown } | null = null;
    const showMap = ref(true);
    const Searcher = defineComponent({
      setup() {
        hook = useLocalSearch({ location: "北京市" });
        return () => h("div", "searcher");
      },
    });
    const Capture = defineComponent({
      setup() {
        mapRef = useMap().map as unknown as { value: unknown };
        return () => h("div", "capture");
      },
    });
    const wrapper = mount(
      defineComponent({
        components: { BMapProvider, Map, Searcher, Capture },
        setup: () =>
          () =>
            h(BMapProvider, { provider: provider() }, () => [
              showMap.value ? h(Map, () => [h(Capture)]) : null,
              h(Searcher),
            ]),
      }),
      { attachTo: host() },
    );

    const h1 = hook!;
    await h1.search("天安门");
    await flushPromises();
    const deadHandle = mapRef!.value;
    expect(deadHandle).toBeTruthy();

    showMap.value = false; // 地图进入销毁
    await nextTick();
    await flushPromises();

    expect(() => h1.setLocation(deadHandle as never)).toThrowError(
      expect.objectContaining({ code: "BMAP_RESOURCE_DISPOSED" }),
    );
    wrapper.unmount();
  });

  it("自定义 Driver 未实现 isMapHandleLive ⇒ setLocation(MapHandle) 显式拒绝（不静默丢弃）", async () => {
    // 公开注入点：老形状的自定义 Driver 只有可选成员缺失，类型上完全合法
    const { client } = await createFakeV4Client();
    const legacyClient: BMapClient = {
      ...client,
      driver: { ...client.driver, isMapHandleLive: undefined },
    };
    const container = document.createElement("div");
    const mapHandle = legacyClient.driver.map.create(container);

    let hook: Hook | null = null;
    const Searcher = defineComponent({
      setup() {
        hook = useLocalSearch({ location: "北京市" });
        return () => h("div", "searcher");
      },
    });
    const wrapper = mount(
      defineComponent({
        components: { BMapProvider, Searcher },
        setup: () => () => h(BMapProvider, { client: legacyClient }, () => [h(Searcher)]),
      }),
      { attachTo: host() },
    );

    const h1 = hook!;
    await h1.search("天安门");
    await flushPromises();

    expect(() => h1.setLocation(mapHandle as never)).toThrowError(
      expect.objectContaining({ code: "BMAP_CAPABILITY_UNSUPPORTED" }),
    );
    wrapper.unmount();
  });
});
