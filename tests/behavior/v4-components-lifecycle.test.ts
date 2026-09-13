/**
 * v4 组件层生命周期：气泡隔离与 Autocomplete 清理（R25-C / issue #72）
 *
 * 这两条验收标准单靠双跑矩阵表达不了：
 *
 * - 「两张 Map 相互隔离，反复挂载和重建无本库资源残留」——矩阵每个引擎只挂**一张**地图，
 *   而隔离问题的形态恰恰是「同页两张图互相影响」（A 卸载把 B 的气泡关掉、A 的释放路径动了
 *   进程级/模块级状态）；
 * - 「Autocomplete watcher/listener/dispose 完整；取消与卸载后不再回写」——观察点必须选在
 *   **能真的改变结论**的地方：更新是否经 Driver 的公开入口（而不是组件内的 raw setter）、
 *   卸载时输入框上的输入活动监听是否真的解绑、SDK 的 `dispose()` 是否被调用。
 *   （注：组件卸载后 Vue 不再 patch 它的 props，所以「泄漏的 watcher 被 props 变化触发」
 *   在测试里复现不出来——把断言写在那儿只会得到一条恒真的用例。）
 *
 * 两份 Fake 的读法都走各自领域的口径，不比较 raw 调用序列。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import { createFakeBMapV4, type FakeBMapV4 } from "../../packages/test-utils";
import BMap from "../../packages/baidu-map-gl-vue/src/components/map/BMap.vue";
import BInfoWindow from "../../packages/baidu-map-gl-vue/src/components/overlays/BInfoWindow.vue";
import BAutoComplete from "../../packages/baidu-map-gl-vue/src/components/autocomplete/BAutoComplete.vue";
import { useRequiredMapContext } from "../../packages/baidu-map-gl-vue/src/core/context/inject";

const POSITION = { lng: 116.404, lat: 39.915 };

let fake: FakeBMapV4;

/** 与 `driver-matrix.ts` 的 v4 引擎同形：Provider 必须自述 engine。 */
function provider() {
  return {
    load: async () => ({
      engine: "jsapi-v4" as const,
      version: fake.namespace.VERSION,
      namespace: fake.namespace,
    }),
  };
}

function container(): HTMLElement {
  const el = document.createElement("div");
  el.style.width = "320px";
  el.style.height = "240px";
  document.body.appendChild(el);
  return el;
}

/** 挂一棵 `<BMap>` + 子节点，等就绪。 */
async function mountTree(children: () => unknown, host: HTMLElement) {
  const Root = defineComponent({
    setup: () => () => h(BMap, { provider: provider() }, children as never),
  });
  const wrapper = mount(Root, { attachTo: host });
  await flushPromises();
  await nextTick();
  return wrapper;
}

async function unmountAndSettle(wrapper: { unmount(): void }) {
  wrapper.unmount();
  await flushPromises();
  await nextTick();
}

beforeEach(() => {
  fake = createFakeBMapV4();
  fake.diagnostics.reset();
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("两张地图的组件实例相互隔离（R25-C / #72）", () => {
  it("卸载其中一张地图不会关掉另一张的气泡", async () => {
    const hostA = container();
    const hostB = container();
    const wrapperA = await mountTree(
      () => [h(BInfoWindow, { position: POSITION, open: true, title: "A" })],
      hostA,
    );
    const wrapperB = await mountTree(
      () => [h(BInfoWindow, { position: POSITION, open: true, title: "B" })],
      hostB,
    );

    // 两张图各有一个 client → 各有一个 map 与一个打开的气泡
    const maps = fake.createdMaps;
    expect(maps).toHaveLength(2);
    expect(maps.map((map) => map.infoWindow?.isOpen() ?? false)).toEqual([true, true]);
    expect(fake.diagnostics.snapshot().leaks.infoWindows).toBe(2);

    // 卸掉 A：只允许影响 A 自己的 map
    await unmountAndSettle(wrapperA);
    expect(maps[0].infoWindow, "A 的气泡必须随 A 的卸载关闭").toBeNull();
    expect(maps[1].infoWindow?.isOpen(), "B 的气泡不得被 A 的卸载影响").toBe(true);
    expect(fake.diagnostics.snapshot().leaks.infoWindows).toBe(1);

    await unmountAndSettle(wrapperB);
    expect(fake.diagnostics.snapshot().leaks.infoWindows).toBe(0);
    fake.diagnostics.assertNoLeaks("两张地图的气泡隔离");
  });
});

describe("BAutoComplete 的 watcher / 监听 / dispose（R25-C / #72）", () => {
  it("props 变化经 Driver 的公开更新入口落到 SDK（不再是组件内的 raw setter）", async () => {
    const host = container();
    const location = ref<unknown>("北京市");
    const types = ref<string[]>(["city"]);
    // 探针：拿到组件树里的 client，用来观察 Driver 上的调用
    const seen: { services?: { setAutocompleteOptions: (...args: unknown[]) => void } } = {};

    const Probe = defineComponent({
      setup() {
        const ctx = useRequiredMapContext();
        return () => {
          const client = ctx.client.value as unknown as {
            driver: { services: { setAutocompleteOptions: (...args: unknown[]) => void } };
          } | null;
          if (client?.driver?.services) seen.services = client.driver.services;
          return h("i");
        };
      },
    });

    const wrapper = await mountTree(
      () => [h(BAutoComplete, { location: location.value, types: types.value }), h(Probe)],
      host,
    );
    await flushPromises();

    const raw = fake.createdAutocompletes[0]!;
    expect(seen.services, "探针必须拿到 client.driver.services").toBeTruthy();
    const spy = vi.spyOn(seen.services!, "setAutocompleteOptions");

    location.value = "上海市";
    types.value = ["city", "district"];
    await nextTick();
    await flushPromises();

    // 更新必须经 Driver（raw 成员访问的边界），并真的落到官方 setter 上
    expect(spy).toHaveBeenCalledWith(expect.anything(), { location: "上海市" });
    expect(spy).toHaveBeenCalledWith(expect.anything(), { types: ["city", "district"] });
    expect(raw.callLog).toContain("setLocation:上海市");
    expect(raw.callLog).toContain("setTypes:city,district");
    // MapHandle / 领域 Point 由 Driver 归一化：句柄不得原样透传给 SDK
    expect(raw.options.location).toBe("上海市");
  });

  it("卸载时解绑输入活动监听、调用 Driver 的 dispose，实例账归零", async () => {
    const host = container();
    const wrapper = await mountTree(() => [h(BAutoComplete, { location: "北京市" })], host);
    await flushPromises();

    const raw = fake.createdAutocompletes[0]!;
    const input = document.querySelector(".b-auto-complete-input") as HTMLInputElement;
    expect(input, "组件必须渲染出输入框").toBeTruthy();
    const removeSpy = vi.spyOn(input, "removeEventListener");
    expect(fake.diagnostics.snapshot().leaks.autocompletes).toBe(1);

    await unmountAndSettle(wrapper);

    expect(raw.callLog, "卸载必须调用 SDK 的 dispose（Driver 的公开释放入口）").toContain("dispose");
    expect(
      removeSpy,
      "Driver 挂在输入框上的输入活动监听必须随实例下线（输入框通常比实例活得久）",
    ).toHaveBeenCalledWith("input", expect.any(Function));
    expect(fake.diagnostics.snapshot().leaks.autocompletes).toBe(0);
    fake.diagnostics.assertNoLeaks("BAutoComplete 卸载");
  });

  it("反复挂载 / 卸载 20 轮：气泡与 Autocomplete 的账都对得上，异步窗口不残留", async () => {
    const host = container();
    for (let round = 0; round < 20; round += 1) {
      const wrapper = await mountTree(
        () => [
          h(BAutoComplete, { location: "北京市", types: ["city"] }),
          h(BInfoWindow, { position: POSITION, open: true, title: `round-${round}` }),
        ],
        host,
      );
      // 每一轮都必须真的建起来，否则「归零」可能是「从来没建过」
      expect(fake.diagnostics.snapshot().leaks.infoWindows).toBe(1);
      expect(fake.diagnostics.snapshot().leaks.autocompletes).toBe(1);
      await unmountAndSettle(wrapper);
    }

    fake.diagnostics.assertNoLeaks("20 轮组件挂载/卸载");
    const { activity, leaks } = fake.diagnostics.snapshot();
    expect(leaks.maps).toBe(0);
    expect(activity.autocompletesDisposed).toBe(activity.autocompletesCreated);
    expect(activity.infoWindowsReleased).toBe(activity.infoWindowsOpened);
    expect(activity.infoWindowsOpened).toBeGreaterThanOrEqual(20);
    expect(fake.diagnostics.pendingAsync()).toEqual({ timers: 0, callbacks: 0 });
  });
});
