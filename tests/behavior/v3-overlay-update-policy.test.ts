/**
 * 覆盖物属性更新策略的组件级验证（M3A2-OVERLAYS / issue #21）
 *
 * issue #21 的测试要求里有三条只能在**组件/组合式层**观察：
 * - mutable 属性不重建、recreate 属性只重建一次；
 * - 旧实例的 child scope 在重建后资源归零；
 * - Target 切换先从旧目标移除再挂新目标。
 *
 * 这三条经 `useOverlayResource.applyOptions`（分类来自 Driver 的 `updatePolicy`）落地，
 * 组件侧因此不再自行探测 raw SDK 成员形状（BMarker 原先会读 `raw.setIcon`）。
 *
 * #26 之后组件默认路径直接走 v4 Driver，读法随之调整（都以 `packages/test-utils/fake-bmap-v4/`
 * 为准）：
 * - `fake.stats.*` 不存在了 → 「挂载数」读 `fake.createdOverlays` / `harness.attached('overlay')`，
 *   「监听数」读 `fake.diagnostics.snapshot().leaks.listeners`；
 * - `map.overlays` 是**数组**（BMapGL fake 里是 `Set`）；
 * - v4 的 `ContextMenu` 只能挂 Map（`attachContextMenu` 拒绝 `kind: "overlay"` 的目标），
 *   因此第三条不再能靠 marker 的 `addContextMenu/removeContextMenu` 调用日志观察，改为直接
 *   观察 Driver 的公开入口调用序列（target 切换是否「先摘旧、再挂新」）——这恰好是该条验收
 *   标准的原文，而且不再依赖 BMapGL 特有的 Marker 级挂载入口。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import BMap from "../../packages/baidu-map-gl-vue/src/components/map/BMap.vue";
import BMarker from "../../packages/baidu-map-gl-vue/src/components/overlays/BMarker.vue";
import BContextMenu from "../../packages/baidu-map-gl-vue/src/components/overlays/BContextMenu.vue";
import { createFakeV4Harness } from "../../packages/test-utils";

const { harness, fake } = createFakeV4Harness();
const provider = () => harness.provider();
const host = () => harness.container();

type FakeOverlay = {
  callLog: string[];
  getListenerCount(): number;
  position?: { lng: number; lat: number };
};

/** 当前（最后一张）地图的覆盖物数组（Fake v4 里是数组，BMapGL fake 里是 Set）。 */
function currentOverlays(): FakeOverlay[] {
  return fake.createdMaps[fake.createdMaps.length - 1]!.overlays as unknown as FakeOverlay[];
}

/** 当前地图上挂着的覆盖物（BMarker 重建后是新实例）。 */
function currentMarker(): FakeOverlay {
  return currentOverlays()[0]!;
}

beforeEach(() => harness.reset());

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("mutable 属性就地更新（不重建）", () => {
  it("icon 变化走 setIcon，marker 实例与挂载次数都不变", async () => {
    const el = host();
    const icon = ref<unknown>({
      imageUrl: "https://example.com/a.png",
      size: { width: 10, height: 10 },
    });
    const wrapper = mount(
      defineComponent({
        components: { BMap, BMarker },
        setup() {
          return () =>
            h(BMap, { provider: provider() }, () => [
              h(BMarker, { position: { lng: 116.4, lat: 39.9 }, icon: icon.value }),
            ]);
        },
      }),
      { attachTo: el },
    );
    await flushPromises();

    const before = currentMarker();
    // 「没有再次 addOverlay / 没有再次构造」的可观察替代：构造计数与挂载数都不动
    const constructed = fake.createdOverlays.length;
    const attached = harness.attached("overlay");
    expect(attached).toBe(1);

    icon.value = { imageUrl: "https://example.com/b.png", size: { width: 12, height: 12 } };
    await nextTick();
    await flushPromises();

    // 实例没换、也没有再次 addOverlay，但 SDK 侧的 setIcon 被调用过
    expect(currentMarker()).toBe(before);
    expect(before.callLog).toContain("setIcon");
    expect(fake.createdOverlays.length).toBe(constructed);
    expect(harness.attached("overlay")).toBe(attached);

    wrapper.unmount();
    await nextTick();
  });
});

describe("recreate 属性只重建一次", () => {
  it("enableClicking 变化触发一次重建，且旧实例的 child scope 资源归零", async () => {
    const el = host();
    const enableClicking = ref(true);
    const wrapper = mount(
      defineComponent({
        components: { BMap, BMarker },
        setup() {
          return () =>
            h(BMap, { provider: provider() }, () => [
              h(BMarker, {
                position: { lng: 116.4, lat: 39.9 },
                enableClicking: enableClicking.value,
              }),
            ]);
        },
      }),
      { attachTo: el },
    );
    await flushPromises();

    const oldMarker = currentMarker();
    const listenersBaseline = fake.diagnostics.snapshot().leaks.listeners;
    const constructed = fake.createdOverlays.length;
    expect(oldMarker.getListenerCount()).toBeGreaterThan(0);

    enableClicking.value = false;
    await nextTick();
    await flushPromises();

    const newMarker = currentMarker();
    // 只重建一次：一个新实例替换旧实例（挂载 +1、摘除 +1，没有多余的来回）
    expect(newMarker).not.toBe(oldMarker);
    expect(fake.createdOverlays.length).toBe(constructed + 1);
    expect(currentOverlays()).toHaveLength(1);

    // 旧实例的监听全部释放（child scope 归零），当前监听数回到单实例基线
    expect(oldMarker.getListenerCount()).toBe(0);
    expect(fake.diagnostics.snapshot().leaks.listeners).toBe(listenersBaseline);

    wrapper.unmount();
    await nextTick();
    expect(fake.diagnostics.snapshot().leaks.listeners).toBe(0);
    harness.assertIdle("BMarker enableClicking 重建");
  });
});

describe("Target 切换先从旧目标移除再挂新目标", () => {
  /**
   * 稳定的 menuItems 引用：父组件重渲染时若 key 变，`BContextMenu` 会按 `menuItems` 重建菜单
   * （那是另一条策略），会把「target 切换」的调用序列混进重建的摘挂。这里刻意固定引用，
   * 只观察 target 切换本身。
   */
  const MENU_ITEMS = [{ text: "a", callback: () => {} }];

  it("父 Marker 重建后，旧实例摘菜单、新实例挂菜单，且不留下双挂载", async () => {
    const el = host();
    const enableClicking = ref(true);
    const wrapper = mount(
      defineComponent({
        components: { BMap, BMarker, BContextMenu },
        setup() {
          return () =>
            h(BMap, { provider: provider() }, () => [
              h(BMarker, { position: { lng: 116.4, lat: 39.9 }, enableClicking: enableClicking.value }, () => [
                h(BContextMenu, { width: 120, items: MENU_ITEMS }),
              ]),
            ]);
        },
      }),
      { attachTo: el },
    );
    await flushPromises();
    await flushPromises();

    const oldMarker = currentMarker();
    // 探针：经 BMap 的公开 `whenReady()` 拿 Client，再观察 Driver 的挂载入口调用序列。
    // BMapGL 时代这条标准观察的是 marker 的 `addContextMenu/removeContextMenu`（组件当时把菜单
    // 挂到父 Marker）；v4 起**同一个 Driver 入口**也能挂到 marker（`Marker#addContextMenu` 是运行时
    // 扩展成员，见 ADR 2026-09-19），因此这里继续观察 Driver 公开入口的调用序列——
    // 「先摘旧、再挂新」正是该条标准的原文。
    const ready = await (wrapper.findComponent(BMap).vm as unknown as {
      whenReady(): Promise<{
        client: { driver: { overlays: Record<string, unknown> } };
        map: unknown;
      }>;
    }).whenReady();
    const overlays = ready.client.driver.overlays as {
      attachContextMenu(target: { kind: string; handle: unknown }, menu: unknown): void;
      detachContextMenu(target: { kind: string; handle: unknown }, menu: unknown): void;
    };

    const calls: Array<{ op: "attach" | "detach"; kind: string; handle: unknown; menu: unknown }> = [];
    const attach = overlays.attachContextMenu.bind(overlays);
    const detach = overlays.detachContextMenu.bind(overlays);
    vi.spyOn(overlays, "attachContextMenu").mockImplementation((target, menu) => {
      calls.push({ op: "attach", kind: target.kind, handle: target.handle, menu });
      attach(target, menu);
    });
    vi.spyOn(overlays, "detachContextMenu").mockImplementation((target, menu) => {
      calls.push({ op: "detach", kind: target.kind, handle: target.handle, menu });
      detach(target, menu);
    });

    enableClicking.value = false;
    await nextTick();
    await flushPromises();
    await flushPromises();

    const newMarker = currentMarker();
    expect(newMarker).not.toBe(oldMarker);

    // 「先摘旧、再挂新」：每一次挂载都紧跟在一次摘除之后，没有「先挂后摘」的重叠窗口。
    //
    // ⚠️ 这条期望在 M5-CUSTOM-MENU / #33 变过（**行为变更**，不是修测试）：此前 `BMarker` 重建期间
    // `TargetContext.target` 会短暂为 `null`，那时的实现会**回退挂到地图**，于是序列里多出一对
    // `attach(map) / detach(map)`（旧注释把它记成「时序产物」）。现在目标未就绪时**什么都不做**
    // （`planTarget` 的 `pending` 分支），不再产生指向地图的中间调用 —— 否则「挂在标注上」的菜单
    // 会在重建窗口里静默变成「挂在整张地图上」。
    expect(calls.map((call) => call.op)).toEqual(["detach", "attach"]);
    // 两次调用都落在**标注**目标上（全程没有碰过地图目标），且摘的与挂的不是同一个实例
    expect(calls.map((call) => call.kind)).toEqual(["marker", "marker"]);
    expect(calls[0]!.handle).not.toBe(calls[1]!.handle);
    // 同一个菜单实例被原子搬运：items 未变 ⇒ 不重建菜单，也没有对同一目标重复 attach
    expect(new Set(calls.map((call) => call.menu)).size).toBe(1);
    // 最终状态：菜单挂在新标注上、地图上没有任何菜单
    expect(newMarker.contextMenus).toHaveLength(1);
    expect(fake.createdMaps[fake.createdMaps.length - 1]!.contextMenus).toHaveLength(0);

    wrapper.unmount();
    await nextTick();
  });
});
