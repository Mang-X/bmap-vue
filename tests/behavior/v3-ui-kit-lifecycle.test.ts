/**
 * UI Kit 薄封装的生命周期与所有权（R25-D / issue #73）
 *
 * 对应 issue「测试与验收」里的三条：
 * - 「延迟 import 后卸载、换 Map、重建、多地图及路由重复进入的生命周期测试通过」；
 * - 「两组件…可销毁」；
 * - 「异步完成先检查 scope/generation」这条实施要求是否真的成立（用竞态用例证实）。
 *
 * 每一条断言都尽量落在**可观察的计数**上（上游 widget 的 on/off/destroy、宿主子节点数、
 * `whenReady()` 的等待数），而不是「看起来没抛错」。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { createSSRApp, h, provide } from "vue";
import { renderToString } from "vue/server-renderer";
import BPlaceAutocomplete from "../../packages/baidu-map-gl-vue/src/integrations/ui-kit/components/BPlaceAutocomplete.vue";
import BPlaceSearch from "../../packages/baidu-map-gl-vue/src/integrations/ui-kit/components/BPlaceSearch.vue";
import {
  createFakeMapHarness,
  createFakeUiKit,
  currentFakeUiKit,
  installFakeUiKit,
  mapContextKey,
  mountInMap,
  type FakeMapHarness,
  type FakeUiKit,
} from "./ui-kit-harness";

vi.mock("@baidumap/jsapi-ui-kit", async () => {
  const harness = await import("./ui-kit-harness");
  return harness.uiKitModuleMock();
});

/** 组件 `defineExpose` 出来的公开动作（与 SFC 里的签名一一对应）。 */
interface AutocompleteApi extends Record<string, unknown> {
  /**
   * `defineExpose` 会用 `proxyRefs` 包一层，因此运行时读到的是**解包后的字符串**
   * （`dist/ui-kit.d.ts` 里的类型是 `Ref<UiKitWidgetStatus>`，这是 Vue 的既有落差）。
   */
  status: string;
  search(keyword: string): Promise<void>;
  setInputValue(value: string): Promise<void>;
  getInputValue(): Promise<string>;
  setLocation(location: string): Promise<void>;
  setCitylimit(citylimit: boolean): Promise<void>;
  setTypes(types: "all" | "city"): Promise<void>;
  show(): Promise<void>;
  hide(): Promise<void>;
}

interface SearchApi extends Record<string, unknown> {
  /**
   * `defineExpose` 会用 `proxyRefs` 包一层，因此运行时读到的是**解包后的字符串**
   * （`dist/ui-kit.d.ts` 里的类型是 `Ref<UiKitWidgetStatus>`，这是 Vue 的既有落差）。
   */
  status: string;
  search(keyword: string, option?: { city?: string }): Promise<void>;
  searchNearby(keyword: string, center: { lng: number; lat: number }, radius?: number): Promise<void>;
  searchInBounds(
    keyword: string,
    bounds: { sw: { lng: number; lat: number }; ne: { lng: number; lat: number } },
  ): Promise<void>;
  prevPage(): Promise<void>;
  nextPage(): Promise<void>;
  goToPage(page: number): Promise<void>;
}

let fake: FakeUiKit;

beforeEach(() => {
  fake = createFakeUiKit();
  installFakeUiKit(fake);
});

/** 准备一个「地图已就绪」的 harness。 */
function readyHarness(label = "map-a"): { harness: FakeMapHarness; handle: unknown } {
  const harness = createFakeMapHarness();
  const handle = harness.makeMapHandle(label);
  harness.ready(handle);
  return { harness, handle };
}

describe("UI Kit 组件的构造与释放", () => {
  it("Map ready 后构造：宿主拿到 widget、构造选项带上 raw map、事件按契约绑定", async () => {
    const { harness } = readyHarness();
    const mounted = mountInMap(BPlaceAutocomplete, harness, {});
    await flushPromises();

    expect(fake.stats.created).toBe(1);
    const widget = fake.instances[0]!;
    // `options.map` 必须来自 MapHandle 的 raw（而不是 handle 本身或 undefined）。
    expect(widget.options.map).toEqual({ __fakeMap: "map-a" });
    // 上游在构造期就把自己的 DOM 挂进 host。
    expect(mounted.host.querySelector(".fake-ui-kit-widget")).not.toBeNull();
    // 正证守卫：三个公开事件在构造期确实绑上了（否则下面的「归还」断言是空转）。
    expect(fake.stats.onCount).toBe(3);
    expect([...widget.listeners.keys()].sort()).toEqual(["highlight", "select", "suggest"]);
    expect((mounted.exposed.value as unknown as AutocompleteApi).status).toBe("ready");

    mounted.unmount();
  });

  it("卸载：先逐条解绑事件、再 destroy，宿主 DOM 被撤走", async () => {
    const { harness } = readyHarness();
    const mounted = mountInMap(BPlaceAutocomplete, harness, {});
    await flushPromises();

    const widget = fake.instances[0]!;
    expect(fake.stats.onCount).toBeGreaterThan(0);
    expect(widget.listeners.size).toBe(3);

    mounted.unmount();
    await flushPromises();

    expect(fake.stats.offCount).toBe(fake.stats.onCount);
    expect(fake.stats.destroyed).toBe(1);
    expect(fake.stats.hostChildrenAtDestroy).toEqual([1]);
    expect(mounted.host.querySelector(".fake-ui-kit-widget")).toBeNull();
    // 只对「次数」断言是不够的：`off(错的 event/handler)` 一样会让计数 +1，
    // 而监听器其实还挂在 widget 上。必须直接检查监听集合真的被摘空。
    expect([...widget.listeners.values()].map((set) => set.size)).toEqual([0, 0, 0]);
    // 释放顺序：所有 off 都必须排在 destroy 之前（issue 实施步骤 4）。
    const destroyAt = fake.stats.timeline.indexOf("destroy:autocomplete");
    const lastOffAt = fake.stats.timeline.map((entry) => entry.startsWith("off:")).lastIndexOf(true);
    expect(destroyAt).toBeGreaterThan(lastOffAt);
  });

  it("Map ready 之前卸载：不构造、不报错", async () => {
    const harness = createFakeMapHarness();
    const mounted = mountInMap(BPlaceAutocomplete, harness, {});
    await flushPromises();

    // 先确认流程真的停在 whenReady（否则本用例什么都证明不了）。
    expect(harness.pendingReady()).toBe(1);
    expect(fake.stats.created).toBe(0);

    mounted.unmount();
    await flushPromises();
    // 卸载后把地图补上：这一次 ready 不得触发构造。
    harness.ready(harness.makeMapHandle("late"));
    await flushPromises();

    expect(fake.stats.created).toBe(0);
    expect(fake.stats.destroyed).toBe(0);
    expect(harness.resourceErrors).toEqual([]);
  });

  it("动态 import 结算前卸载：不构造（同条件下不卸载则会构造）", async () => {
    // 控制组：同样的准备，只是不卸载 —— 证明「构造确实会发生」，被测组才不是空转。
    {
      const { harness } = readyHarness("control");
      const control = mountInMap(BPlaceAutocomplete, harness, {});
      await flushPromises();
      expect(fake.stats.created).toBe(1);
      control.unmount();
      await flushPromises();
    }
    fake.reset();

    // 被测组：mount 之后立刻卸载；此时流程正停在 `await loadUiKit()`。
    const { harness } = readyHarness("late-unmount");
    const mounted = mountInMap(BPlaceAutocomplete, harness, {});
    mounted.unmount();
    await flushPromises();

    expect(fake.stats.created).toBe(0);
    expect(fake.stats.destroyed).toBe(0);
    expect(harness.resourceErrors).toEqual([]);
  });

  it("换 Map：旧 widget 先释放，新 widget 拿到新的 raw map", async () => {
    const { harness } = readyHarness("map-a");
    const mounted = mountInMap(BPlaceSearch, harness, {});
    await flushPromises();

    expect(fake.stats.created).toBe(1);
    expect(fake.instances[0]!.options.map).toEqual({ __fakeMap: "map-a" });

    harness.ready(harness.makeMapHandle("map-b"));
    await flushPromises();

    expect(fake.stats.created).toBe(2);
    expect(fake.stats.destroyed).toBe(1);
    expect(fake.instances[1]!.options.map).toEqual({ __fakeMap: "map-b" });
    // 重建是「先释放旧的、再构造新的」，不是并存。
    const firstDestroy = fake.stats.timeline.indexOf("destroy:search");
    const secondConstruct = fake.stats.timeline.indexOf("construct:search", firstDestroy + 1);
    expect(secondConstruct).toBeGreaterThan(firstDestroy);
    expect(fake.instances[0]!.destroyed).toBe(true);
    expect(fake.instances[1]!.destroyed).toBe(false);

    mounted.unmount();
    await flushPromises();
    expect(fake.stats.destroyed).toBe(2);
    expect(fake.stats.offCount).toBe(fake.stats.onCount);
  });

  it("路由重复进入（连续挂载 / 卸载 5 轮）：计数守恒，不留残骸", async () => {
    const { harness } = readyHarness();
    for (let round = 0; round < 5; round += 1) {
      const mounted = mountInMap(BPlaceAutocomplete, harness, {});
      await flushPromises();
      expect(mounted.host.querySelector(".fake-ui-kit-widget")).not.toBeNull();
      mounted.unmount();
      await flushPromises();
      expect(mounted.host.querySelector(".fake-ui-kit-widget")).toBeNull();
    }

    expect(fake.stats.created).toBe(5);
    expect(fake.stats.destroyed).toBe(5);
    expect(fake.stats.onCount).toBeGreaterThan(0);
    expect(fake.stats.offCount).toBe(fake.stats.onCount);
    expect(fake.instances.every((widget) => widget.destroyed)).toBe(true);
    expect(
      fake.instances.every((widget) =>
        [...widget.listeners.values()].every((set) => set.size === 0),
      ),
    ).toBe(true);
  });

  it("多地图：各自一个 widget，卸载其中一个不牵连另一个", async () => {
    const first = readyHarness("map-1");
    const second = readyHarness("map-2");
    const one = mountInMap(BPlaceAutocomplete, first.harness, {});
    const two = mountInMap(BPlaceAutocomplete, second.harness, {});
    await flushPromises();

    expect(fake.stats.created).toBe(2);
    expect(fake.instances[0]!.options.map).toEqual({ __fakeMap: "map-1" });
    expect(fake.instances[1]!.options.map).toEqual({ __fakeMap: "map-2" });
    // 两个宿主互不共享容器。
    expect(one.host).not.toBe(two.host);
    expect(one.host.querySelectorAll(".fake-ui-kit-widget").length).toBe(1);
    expect(two.host.querySelectorAll(".fake-ui-kit-widget").length).toBe(1);

    one.unmount();
    await flushPromises();
    expect(fake.stats.destroyed).toBe(1);
    expect(fake.instances[0]!.destroyed).toBe(true);
    expect(fake.instances[1]!.destroyed).toBe(false);
    expect(two.host.querySelector(".fake-ui-kit-widget")).not.toBeNull();

    two.unmount();
    await flushPromises();
    expect(fake.stats.destroyed).toBe(2);
    expect(fake.stats.offCount).toBe(fake.stats.onCount);
  });

  it("事件绑定中途失败：走同一条释放路径，不留「半绑定且可用」的实例", async () => {
    // 让第 2 次 on 抛错：第 1 条已绑上，若实现只把状态置 error 而不释放，
    // 就会留下一个「监听挂了一半、却仍能被 whenWidgetReady 交出去」的实例。
    let onCalls = 0;
    const { harness } = readyHarness();
    const original = fake.module.PlaceAutocomplete as new (
      host: HTMLElement,
      options: Record<string, unknown>,
    ) => { on(event: string, handler: (...args: unknown[]) => void): unknown; destroy(): void };
    fake.module.PlaceAutocomplete = function (host: HTMLElement, options: Record<string, unknown>) {
      const widget = new original(host, options);
      const bound = widget.on.bind(widget);
      widget.on = (event, handler) => {
        onCalls += 1;
        if (onCalls > 1) throw new Error("bind failed");
        return bound(event, handler);
      };
      return widget;
    } as unknown as typeof fake.module.PlaceAutocomplete;

    const mounted = mountInMap(BPlaceAutocomplete, harness, {});
    await flushPromises();

    const instance = fake.instances[0]!;
    expect(fake.stats.created).toBe(1);
    expect(onCalls).toBe(2);
    // 已绑的第 1 条被摘掉、widget 被销毁（第 2 条 on 抛错，所以只用 1 条真的绑上过）。
    expect([...instance.listeners.keys()]).toEqual(["suggest"]);
    expect([...instance.listeners.values()].map((set) => set.size)).toEqual([0]);
    expect(fake.stats.destroyed).toBe(1);
    expect(fake.stats.offCount).toBe(1);
    expect(mounted.host.querySelector(".fake-ui-kit-widget")).toBeNull();
    // 失败口径照旧：状态 error + 同一条错误经 resource:error 上报。
    const api = mounted.exposed.value as unknown as AutocompleteApi;
    expect(api.status).toBe("error");
    expect(harness.resourceErrors).toHaveLength(1);
    const payload = harness.resourceErrors[0] as { error: { message: string } };
    expect(payload.error.message).toContain("bind failed");
    await expect(api.search("x")).rejects.toBe(payload.error);

    mounted.unmount();
  });

  it("构造失败：经 resource:error 上报，status 转 error，动作拿到同一条错误", async () => {
    fake.module.PlaceSearch = function () {
      throw new Error("widget ctor boom");
    };
    const { harness } = readyHarness();
    const mounted = mountInMap(BPlaceSearch, harness, {});
    await flushPromises();

    expect(fake.stats.created).toBe(0);
    const api = mounted.exposed.value as unknown as SearchApi;
    expect(api.status).toBe("error");
    expect(harness.resourceErrors).toHaveLength(1);
    const payload = harness.resourceErrors[0] as { component: string; error: { code: string; message: string } };
    expect(payload.component).toBe("BPlaceSearch");
    expect(payload.error.code).toBe("BMAP_RESOURCE_CREATE_FAILED");
    expect(payload.error.message).toContain("widget ctor boom");
    // `resource:error` 的载荷与动作 reject 的必须是同一条错误（否则排查要重新拼线索）。
    await expect(api.search("x")).rejects.toBe(payload.error);

    mounted.unmount();
  });

  it("服务端只渲染空 host；客户端 hydration 接管后只构造一个 widget", async () => {
    const { harness } = readyHarness();
    const makeApp = () =>
      createSSRApp({
        setup() {
          provide(mapContextKey, harness.context);
          return () => h(BPlaceAutocomplete, {});
        },
      });

    // 1) 服务端：输出里只有宿主容器，没有任何 UI Kit 的东西，也没有构造 widget。
    const html = await renderToString(makeApp());
    expect(fake.stats.created).toBe(0);
    expect(html).toContain("b-place-autocomplete");
    expect(html).not.toContain("fake-ui-kit-widget");

    // 2) 客户端 hydration：在服务端产出的 HTML 上挂载（`createSSRApp` + `mount` 即 hydration）。
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const app = makeApp();
    app.mount(container);
    await flushPromises();

    expect(fake.stats.created).toBe(1);
    expect(container.querySelectorAll(".b-place-autocomplete").length).toBe(1);
    expect(container.querySelectorAll(".fake-ui-kit-widget").length).toBe(1);

    app.unmount();
    container.remove();
    await flushPromises();
    expect(fake.stats.destroyed).toBe(1);
    expect(fake.stats.offCount).toBe(fake.stats.onCount);
  });

  it("未就绪时动作等待就绪；已卸载时动作明确拒绝", async () => {
    const harness = createFakeMapHarness();
    const mounted = mountInMap(BPlaceSearch, harness, {});
    await flushPromises();
    const api = mounted.exposed.value as unknown as SearchApi;

    expect(fake.stats.created).toBe(0);
    const pending = api.search("百度大厦");
    await flushPromises();
    // 还没就绪：动作在等，没有落到 widget 上，也没有报错。
    expect(fake.stats.created).toBe(0);
    expect(harness.resourceErrors).toEqual([]);

    harness.ready(harness.makeMapHandle("m"));
    await pending;

    expect(fake.stats.created).toBe(1);
    expect(fake.instances[0]!.callsOf("search")).toEqual([
      { method: "search", args: ["百度大厦", undefined] },
    ]);

    mounted.unmount();
    await flushPromises();
    // 卸载后组件 ref 会被置空，因此状态要在卸载前取到的那个 api 上读。
    expect(api.status).toBe("disposed");
    await expect(api.search("another")).rejects.toMatchObject({ code: "BMAP_RESOURCE_DISPOSED" });
  });
});
