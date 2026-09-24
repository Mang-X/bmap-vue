/**
 * BPlaceDetail 的构造 / 释放 / 事件 / 动作（UIKIT-02 / issue #75）
 *
 * 桥层的通性行为（异步窗口、generation 守卫、构造失败、SSR hydration）已在
 * `v3-ui-kit-lifecycle.test.ts` 里覆盖，这里只测 `PlaceDetail` **自己的**那几件事：
 *
 * 1. **uid 不是构造期选项**：上游构造器只吃 `map` / `display`，所以「挂载时就带 uid」
 *    必须由构造完成后的镜像补上 —— 这是最容易漏掉的一条（只 watch `uid` 会完全漏掉它）；
 * 2. **`uid` 变回未设置 → `clear()`**：上游 `clear()` 是有明确定义的公开方法，
 *    与 `PlaceAutocomplete` 的 `setLocation("")` 不同，不需要靠重建来「猜」语义；
 * 3. **`load` 载荷投影**：`title` / `address` 上游已转成字符串，`uid` / `tel` / `point`
 *    是原样透传的 —— 本库逐个校验类型，坏值丢弃而不是塞进公共契约；
 * 4. **不暴露 `layout`**：锁定版本产物里没有读取点（形状锁在
 *    `v3-ui-kit-widget-contract.test.ts`），这里从类型面与 runtime 面各证一次。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import BPlaceDetail from "../../packages/bmap-vue/src/integrations/ui-kit/components/BPlaceDetail.vue";
import {
  createFakeMapHarness,
  createFakeUiKit,
  installFakeUiKit,
  mountInMap,
  type FakeMapHarness,
  type FakeUiKit,
} from "./ui-kit-harness";

vi.mock("@baidumap/jsapi-ui-kit", async () => {
  const harness = await import("./ui-kit-harness");
  return harness.uiKitModuleMock();
});

interface DetailApi extends Record<string, unknown> {
  status: string;
  setPlace(uidOrPoi: string | object): Promise<void>;
  clear(): Promise<void>;
}

let fake: FakeUiKit;

beforeEach(() => {
  fake = createFakeUiKit();
  installFakeUiKit(fake);
});

function readyHarness(label = "map-a"): FakeMapHarness {
  const harness = createFakeMapHarness();
  harness.ready(harness.makeMapHandle(label));
  return harness;
}

function emittedOf(mounted: { child: { emitted(): unknown } }): Record<string, unknown[][] | undefined> {
  return mounted.child.emitted() as Record<string, unknown[][] | undefined>;
}

/** 上游 `PlaceDetail.load` 的真实形状（`title` / `address` 已由上游转成字符串）。 */
function upstreamDetail(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "百度大厦",
    address: "上地十街 10 号",
    uid: "detail-uid",
    tel: "010-00000000",
    // 详情接口回包给的是纯数据点；POI 模式可能是引擎原生点实例（带额外字段）。
    point: { lng: 116.307, lat: 40.056, extra: "ignored" },
    ...overrides,
  };
}

describe("BPlaceDetail：构造与选项", () => {
  it("Map ready 后构造：宿主拿到 widget、构造选项带 raw map 与 display、load 已绑定", async () => {
    const harness = readyHarness();
    const mounted = mountInMap(BPlaceDetail, harness, {
      display: { comment: false, rank: true },
    });
    await flushPromises();

    expect(fake.stats.created).toBe(1);
    const widget = fake.instances[0]!;
    expect(widget.kind).toBe("detail");
    expect(widget.options.map).toEqual({ __fakeMap: "map-a" });
    // 构造期选项原样透传（`display` 是对象，按内容比对）。
    expect(widget.options.display).toEqual({ comment: false, rank: true });
    expect(mounted.host.querySelector(".fake-ui-kit-widget")).not.toBeNull();
    // 正证守卫：`load` 确实绑上了（否则下面的「归还」断言是空转）。
    expect(fake.stats.onCount).toBe(1);
    expect([...widget.listeners.keys()]).toEqual(["load"]);
    expect((mounted.exposed.value as unknown as DetailApi).status).toBe("ready");

    mounted.unmount();
  });

  it("没给 display 时不往构造选项里塞一个 undefined", async () => {
    const harness = readyHarness();
    const mounted = mountInMap(BPlaceDetail, harness, {});
    await flushPromises();

    const widget = fake.instances[0]!;
    // 传 `undefined` 下去会覆盖上游自己的默认值（详情字段默认全显示）。
    expect("display" in widget.options).toBe(false);
    // `layout` 是上游声明了但产物里没有入口的选项，本库不暴露也不透传。
    expect("layout" in widget.options).toBe(false);

    mounted.unmount();
  });

  it("display 变更 → 重建 widget（上游没有 setter，不静默保留旧值）", async () => {
    const harness = readyHarness();
    const mounted = mountInMap<{ display?: Record<string, boolean> }>(BPlaceDetail, harness, {
      display: { image: false },
    });
    await flushPromises();
    const first = fake.instances[0]!;
    expect(first.options.display).toEqual({ image: false });

    mounted.props.value = { display: { image: true } };
    await flushPromises();

    expect(fake.stats.created).toBe(2);
    expect(first.destroyed).toBe(true);
    expect(fake.instances[1]!.options.display).toEqual({ image: true });
    // 重建是「先释放旧的」：旧实例的监听被摘空。
    expect([...first.listeners.values()].map((set) => set.size)).toEqual([0]);
    expect(fake.stats.offCount).toBe(1);

    mounted.unmount();
    await flushPromises();
    expect(fake.stats.offCount).toBe(fake.stats.onCount);
  });
});

describe("BPlaceDetail：uid ↔ setPlace / clear 镜像", () => {
  it("挂载时就带 uid：构造完成后恰好补一次 setPlace（构造期选项里没有 uid）", async () => {
    const harness = readyHarness();
    const mounted = mountInMap<{ uid?: string }>(BPlaceDetail, harness, { uid: "poi-uid" });
    await flushPromises();

    const widget = fake.instances[0]!;
    // `uid` 不是构造选项：它只能通过 setPlace 补上。
    expect("uid" in widget.options).toBe(false);
    expect(widget.callsOf("setPlace").map((call) => call.args)).toEqual([["poi-uid"]]);
    // 不重复调用：watch 的是 [widget, uid] 组合，构造完成与 props 变化各触发一次不应变成两次。
    expect(widget.callsOf("setPlace")).toHaveLength(1);

    mounted.unmount();
  });

  it("没给 uid 时既不 setPlace 也不 clear（构造出来就是空状态占位）", async () => {
    const harness = readyHarness();
    const mounted = mountInMap(BPlaceDetail, harness, {});
    await flushPromises();

    const widget = fake.instances[0]!;
    expect(widget.callsOf("setPlace")).toEqual([]);
    expect(widget.callsOf("clear")).toEqual([]);

    mounted.unmount();
  });

  it("uid 变化：未设置 → 有值走 setPlace、有值 → 有值走 setPlace，都不重建", async () => {
    const harness = readyHarness();
    const mounted = mountInMap<{ uid?: string }>(BPlaceDetail, harness, {});
    await flushPromises();
    const widget = fake.instances[0]!;

    mounted.props.value = { uid: "a" };
    await flushPromises();
    mounted.props.value = { uid: "b" };
    await flushPromises();

    expect(widget.callsOf("setPlace").map((call) => call.args)).toEqual([["a"], ["b"]]);
    expect(fake.stats.created).toBe(1);
    expect(fake.stats.destroyed).toBe(0);

    mounted.unmount();
  });

  it("uid 变回未设置 → clear（上游有明确定义的公开方法，不需要重建来猜语义）", async () => {
    const harness = readyHarness();
    const mounted = mountInMap<{ uid?: string }>(BPlaceDetail, harness, { uid: "a" });
    await flushPromises();
    const widget = fake.instances[0]!;

    mounted.props.value = {};
    await flushPromises();

    expect(widget.callsOf("clear")).toHaveLength(1);
    // 反向也成立：`clear()` 之后 widget 没被重建（面板的滚动位置等状态不该被吃掉）。
    expect(fake.stats.created).toBe(1);
    expect(fake.stats.destroyed).toBe(0);

    // 再设回来仍然可用。
    mounted.props.value = { uid: "c" };
    await flushPromises();
    expect(widget.callsOf("setPlace").map((call) => call.args)).toEqual([["a"], ["c"]]);

    mounted.unmount();
  });

  it("重建后新实例要重新应用当前 uid（新 widget 是空的）", async () => {
    const harness = readyHarness();
    const mounted = mountInMap<{ uid?: string; display?: Record<string, boolean> }>(
      BPlaceDetail,
      harness,
      { uid: "a", display: { image: true } },
    );
    await flushPromises();
    const first = fake.instances[0]!;
    expect(first.callsOf("setPlace").map((call) => call.args)).toEqual([["a"]]);

    mounted.props.value = { uid: "a", display: { image: false } };
    await flushPromises();

    const second = fake.instances[1]!;
    expect(fake.stats.created).toBe(2);
    // 正证守卫：旧实例只被设置过一次，新实例必须**重新**设置（否则面板会是空的）。
    expect(first.callsOf("setPlace")).toHaveLength(1);
    expect(second.callsOf("setPlace").map((call) => call.args)).toEqual([["a"]]);

    mounted.unmount();
  });
});

describe("BPlaceDetail：事件与动作", () => {
  it("load 投影成纯数据：坏坐标与非字符串 uid/tel 被丢弃", async () => {
    const harness = readyHarness();
    const mounted = mountInMap(BPlaceDetail, harness, {});
    await flushPromises();

    fake.instances[0]!.emit("load", upstreamDetail());
    await nextTick();

    expect(emittedOf(mounted).load?.[0]?.[0]).toEqual({
      title: "百度大厦",
      address: "上地十街 10 号",
      uid: "detail-uid",
      tel: "010-00000000",
      point: { lng: 116.307, lat: 40.056 },
    });

    // 上游原样透传的字段可能不是我们声明的类型 —— 只保留合法的。
    fake.instances[0]!.emit(
      "load",
      upstreamDetail({ uid: 123, tel: { value: "x" }, point: { lng: Number.NaN, lat: 1 } }),
    );
    await nextTick();
    expect(emittedOf(mounted).load?.[1]?.[0]).toEqual({
      title: "百度大厦",
      address: "上地十街 10 号",
    });

    mounted.unmount();
  });

  it("load 载荷不是对象时不发事件（不制造「看起来加载好了」的假信号）", async () => {
    const harness = readyHarness();
    const mounted = mountInMap(BPlaceDetail, harness, {});
    await flushPromises();

    fake.instances[0]!.emit("load", null);
    fake.instances[0]!.emit("load", "not-an-object");
    await nextTick();

    expect(emittedOf(mounted).load).toBeUndefined();
    mounted.unmount();
  });

  it("公开动作落到已验证的方法上；未就绪时等待、卸载后明确拒绝", async () => {
    const harness = createFakeMapHarness();
    const mounted = mountInMap(BPlaceDetail, harness, {});
    await flushPromises();
    const api = mounted.exposed.value as unknown as DetailApi;

    expect(fake.stats.created).toBe(0);
    const pending = api.setPlace("late-uid");
    await flushPromises();
    expect(fake.stats.created).toBe(0);

    harness.ready(harness.makeMapHandle("m"));
    await pending;
    expect(fake.instances[0]!.callsOf("setPlace").map((call) => call.args)).toEqual([["late-uid"]]);

    mounted.unmount();
    await flushPromises();
    expect(api.status).toBe("disposed");
    await expect(api.setPlace("x")).rejects.toMatchObject({ code: "BMAP_RESOURCE_DISPOSED" });
    await expect(api.clear()).rejects.toMatchObject({ code: "BMAP_RESOURCE_DISPOSED" });
  });

  it("公开面只有 status / setPlace / clear（`layout` 与其它上游成员不冒充）", async () => {
    const harness = readyHarness();
    const mounted = mountInMap(BPlaceDetail, harness, {});
    await flushPromises();

    expect(Object.keys(mounted.exposed.value ?? {}).sort()).toEqual(["clear", "setPlace", "status"]);
    mounted.unmount();
  });

  it("单次交互只走 UI Kit：headless 服务面一次都没被读到", async () => {
    const harness = readyHarness();
    const mounted = mountInMap(BPlaceDetail, harness, { uid: "a" });
    await flushPromises();
    fake.instances[0]!.emit("load", upstreamDetail());
    await nextTick();

    expect(harness.propertyAccesses.filter((path) => path === "driver.services")).toEqual([]);
    // 正证守卫：这条链路确实读过 Driver（否则「没读 services」可能只是因为压根没碰 Driver）。
    expect(harness.propertyAccesses).toContain("driver.geometry");

    mounted.unmount();
  });

  it("卸载：先解绑再销毁，宿主 DOM 撤走，计数归零", async () => {
    const harness = readyHarness();
    const mounted = mountInMap(BPlaceDetail, harness, { uid: "a" });
    await flushPromises();
    const widget = fake.instances[0]!;

    mounted.unmount();
    await flushPromises();

    expect(fake.stats.offCount).toBe(fake.stats.onCount);
    expect(fake.stats.destroyed).toBe(1);
    expect(fake.stats.hostChildrenAtDestroy).toEqual([1]);
    expect(mounted.host.querySelector(".fake-ui-kit-widget")).toBeNull();
    expect([...widget.listeners.values()].map((set) => set.size)).toEqual([0]);
    const destroyAt = fake.stats.timeline.indexOf("destroy:detail");
    const lastOffAt = fake.stats.timeline.map((entry) => entry.startsWith("off:")).lastIndexOf(true);
    expect(destroyAt).toBeGreaterThan(lastOffAt);
  });

  // issue #75 验收：「路线/详情所创建资源随 clear/destroy 正确释放，多地图不相互影响」。
  it("换 Map：旧 widget 先释放，新 widget 拿到新 raw map 并重新应用当前 uid", async () => {
    const harness = readyHarness("map-a");
    const mounted = mountInMap<{ uid?: string }>(BPlaceDetail, harness, { uid: "a" });
    await flushPromises();
    const first = fake.instances[0]!;
    expect(first.options.map).toEqual({ __fakeMap: "map-a" });
    expect(first.callsOf("setPlace").map((call) => call.args)).toEqual([["a"]]);

    harness.ready(harness.makeMapHandle("map-b"));
    await flushPromises();

    const second = fake.instances[1]!;
    expect(fake.stats.created).toBe(2);
    expect(fake.stats.destroyed).toBe(1);
    expect(second.options.map).toEqual({ __fakeMap: "map-b" });
    // 重建是「先释放旧的、再构造新的」：新 widget 是空的，必须重新设置 uid。
    expect(fake.stats.timeline.indexOf("destroy:detail")).toBeLessThan(
      fake.stats.timeline.indexOf("construct:detail", 1),
    );
    expect(first.destroyed).toBe(true);
    expect(second.callsOf("setPlace").map((call) => call.args)).toEqual([["a"]]);

    mounted.unmount();
    await flushPromises();
    expect(fake.stats.destroyed).toBe(2);
    expect(fake.stats.offCount).toBe(fake.stats.onCount);
  });

  it("多地图：各自一个 widget，卸载其中一个不牵连另一个", async () => {
    const harnessA = readyHarness("map-a");
    const harnessB = readyHarness("map-b");
    const mountedA = mountInMap<{ uid?: string }>(BPlaceDetail, harnessA, { uid: "a" });
    const mountedB = mountInMap<{ uid?: string }>(BPlaceDetail, harnessB, { uid: "b" });
    await flushPromises();

    expect(fake.stats.created).toBe(2);
    const [widgetA, widgetB] = [fake.instances[0]!, fake.instances[1]!];
    expect(widgetA.options.map).toEqual({ __fakeMap: "map-a" });
    expect(widgetB.options.map).toEqual({ __fakeMap: "map-b" });

    mountedA.unmount();
    await flushPromises();

    expect(widgetA.destroyed).toBe(true);
    // 另一个地图上的实例不受影响：既没被销毁，监听也还在。
    expect(widgetB.destroyed).toBe(false);
    expect([...widgetB.listeners.values()].map((set) => set.size)).toEqual([1]);
    expect(fake.stats.destroyed).toBe(1);

    mountedB.unmount();
    await flushPromises();
    expect(widgetB.destroyed).toBe(true);
    expect(fake.stats.offCount).toBe(fake.stats.onCount);
  });

  /**
   * 快速重复调用：**钉住现状**，而不是假装有请求去重。
   *
   * 上游 `setPlace(uid)` 没有请求标识（`load` 载荷里没有「这是第几次请求」），
   * 而且它自己会把迟到的回包渲染进面板 —— 所以本库**不能**只丢事件：
   * 那会造成「面板显示 B、事件却说 A」或反过来的错配，比不丢更难排查。
   * 因此这里断言的是「每次调用都落到上游 + 事件原样转发 + 载荷带 uid 供调用方自行对账」。
   */
  it("快速切换 uid：每次调用都落到上游，load 事件照常转发并带 uid 供对账", async () => {
    const harness = readyHarness();
    const mounted = mountInMap<{ uid?: string }>(BPlaceDetail, harness, {});
    await flushPromises();
    const widget = fake.instances[0]!;

    mounted.props.value = { uid: "a" };
    await flushPromises();
    mounted.props.value = { uid: "b" };
    await flushPromises();

    expect(widget.callsOf("setPlace").map((call) => call.args)).toEqual([["a"], ["b"]]);

    // a 的迟到回包：本库照常转发（不做请求去重），但载荷里的 uid 让调用方能识别它已经过期。
    widget.emit("load", upstreamDetail({ uid: "a", title: "迟到的 A" }));
    await nextTick();
    expect(emittedOf(mounted).load?.[0]?.[0]).toMatchObject({ uid: "a", title: "迟到的 A" });

    mounted.unmount();
  });
});
