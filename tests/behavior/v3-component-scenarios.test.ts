/**
 * 组件级领域行为（M3A3-FAKE-DUAL / issue #24 的双跑矩阵在 #26 之后的单引擎残留）
 *
 * 原文（`v3-dual-driver-components.test.ts`）回答的是「同一份组件代码在 webgl-v1 与 jsapi-v4
 * 上是否给出同样的领域结果」。旧引擎删除后**跨引擎比较消失**，留下的是它顺带建立起来的、仍然
 * 有价值的组件级场景：每个场景挂一棵真实的组件树、卸载后过一遍泄漏门禁，并把读数固定下来。
 *
 * 每个场景结尾都调用 `harness.assertIdle()`：**诊断计数在这里当生命周期门禁用**——卸载之后
 * SDK 侧必须没有任何未释放资源。
 *
 * ## `<BInfoWindow>` 的缺口已由 R25-C（#72）关掉
 *
 * 组件曾经在 `onMounted` 里走 `overlays.add({ kind: "map" }, infoWindow)`，而 v4 的 OverlayDriver
 * 明确拒绝这条路（气泡是地图级 API，要用 `openInfoWindow` / `closeInfoWindow`）并抛
 * `BMAP_INVALID_ARGUMENT`。`#72` 把组件改成专用入口之后断言变回正向：打开 1 个、关闭后 0 个、
 * 卸载后无残留。完整状态机（Teleport / InfoWindowManager / 受控与不受控的边界）仍由 M5 **#32**
 * 收口——本文件只覆盖「最小成功路径」。
 */
import { beforeEach, describe, it, expect } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, nextTick, onMounted, ref, type VNodeChild } from "vue";
import { createFakeV4Harness, type FakeV4Harness } from "../../packages/test-utils";
import BMap from "../../packages/baidu-map-gl-vue/src/components/map/BMap.vue";
import BMarker from "../../packages/baidu-map-gl-vue/src/components/overlays/BMarker.vue";
import BInfoWindow from "../../packages/baidu-map-gl-vue/src/components/overlays/BInfoWindow.vue";
import BControl from "../../packages/baidu-map-gl-vue/src/components/controls/BControl.vue";
import BDistrictLayer from "../../packages/baidu-map-gl-vue/src/components/layers/BDistrictLayer.vue";
import { useBMapGeocoder } from "../../packages/baidu-map-gl-vue/src/composables/useBMapGeocoder";
import { useRequiredMapContext } from "../../packages/baidu-map-gl-vue/src/core/context/inject";

const { harness, fake } = createFakeV4Harness();

const POSITION = { lng: 116.4, lat: 39.9 };

beforeEach(() => {
  harness.reset();
});

/**
 * 挂一份 `<BMap>` + 子节点，就绪后返回 wrapper。
 *
 * `onError` 用于把「组件 mounted 钩子里抛出的错误」收成领域结果：Vue 会把它交给
 * `config.errorHandler`，不接住就是 unhandled rejection（噪声大且不可断言）。
 */
async function mountMapTree(
  children: () => VNodeChild,
  onError?: (error: unknown) => void,
) {
  const Root = defineComponent({
    setup: () => () => h(BMap, { provider: harness.provider() }, children),
  });
  const wrapper = mount(Root, {
    attachTo: harness.container(),
    global: onError ? { config: { errorHandler: onError } } : undefined,
  });
  await flushPromises();
  await nextTick();
  return wrapper;
}

/** 卸载并等待释放完成（诊断门禁必须在释放之后断言）。 */
async function unmountAndSettle(wrapper: { unmount(): void }) {
  wrapper.unmount();
  await flushPromises();
  await nextTick();
}

describe("组件领域行为（jsapi-v4 / Fake v4）", () => {
  it("Map：ready 且容器就绪，组件树里的 client.engine 是 jsapi-v4", async () => {
    // 探针子树：从组件树内部读 client.engine，证明「组件拿到的确实是 v4 client」
    let seenEngine: string | undefined;
    const EngineProbe = defineComponent({
      setup() {
        const mapContext = useRequiredMapContext();
        return () => {
          seenEngine = mapContext.client.value?.engine;
          return h("span", "probe");
        };
      },
    });

    const wrapper = await mountMapTree(() => [h(EngineProbe)]);
    const bmap = wrapper.findComponent(BMap);
    expect(seenEngine, "组件树里的 client.engine 必须是 jsapi-v4").toBe("jsapi-v4");
    expect(wrapper.find(".bmap-canvas-host").exists()).toBe(true);
    expect((bmap.vm as unknown as { status: string }).status).toBe("ready");
    expect(Boolean((bmap.vm as unknown as { getMapInstance(): unknown }).getMapInstance())).toBe(
      true,
    );

    await unmountAndSettle(wrapper);
    harness.assertIdle("Map 组件");
  });

  it("Marker：position 变化只更新同一个覆盖物，卸载后无残留", async () => {
    const position = ref(POSITION);
    const wrapper = await mountMapTree(() => [
      h(BMarker, { position: position.value, title: "marker" }),
    ]);

    expect(harness.overlayPositions()).toEqual([POSITION]);
    position.value = { lng: 121.5, lat: 31.2 };
    await nextTick();
    await flushPromises();
    // 领域事实：位置更新后仍是同一个覆盖物（不重建、不重复挂载）
    expect(harness.overlayPositions()).toEqual([{ lng: 121.5, lat: 31.2 }]);
    expect(harness.attached("overlay")).toBe(1);

    await unmountAndSettle(wrapper);
    harness.assertIdle("Marker 组件");
  });

  it("InfoWindow：经专用入口打开/关闭，内容可见，卸载后无残留（#72）", async () => {
    const overlaysBefore = fake.createdOverlays.length;
    const attachedBefore = fake.diagnostics.snapshot().activity.overlaysAttached;

    const errors: Array<{ code?: string }> = [];
    const open = ref(true);
    const wrapper = await mountMapTree(
      () => [h(BInfoWindow, { position: POSITION, open: open.value, title: "iw" }, () => h("span", "气泡内容"))],
      (error) => errors.push(error as { code?: string }),
    );

    expect(errors, "组件不应在挂载期抛错").toEqual([]);
    expect(harness.openInfoWindows()).toBe(1);

    // 打开状态下读交给 SDK 的内容节点：必须是渲染出来的 slot 文本，且**不是**被内联
    // `display:none` 藏住的（#72 之前模板上写死了 display:none，打开后内容也不可见）
    const map = fake.createdMaps.at(-1);
    const content = map?.infoWindow?.content as HTMLElement | undefined;
    expect(content, "v4 上必须真的创建出 InfoWindow").toBeTruthy();
    expect(content!.textContent).toContain("气泡内容");
    expect(content!.style.display, "打开状态下的内容容器不得被内联隐藏").not.toBe("none");

    open.value = false;
    await nextTick();
    await flushPromises();
    expect(harness.openInfoWindows()).toBe(0);

    await unmountAndSettle(wrapper);
    harness.assertIdle("InfoWindow 组件");

    // 只经 `createInfoWindow` 创建，**不**额外 `addOverlay`：气泡不是普通覆盖物
    expect(
      fake.createdOverlays
        .slice(overlaysBefore)
        .map((v) => (v as { constructor: { name: string } }).constructor.name),
    ).toEqual(["InfoWindowClass"]);
    expect(
      fake.diagnostics.snapshot().activity.overlaysAttached - attachedBefore,
      "气泡不得被当成普通覆盖物挂载（v4 上 addOverlay 的次数增量必须为 0）",
    ).toBe(0);
  });

  it("Control：自定义控件挂载与可见性切换", async () => {
    const visible = ref(true);
    const wrapper = await mountMapTree(() => [
      h(BControl, { visible: visible.value }, () => h("button", "自定义控件")),
    ]);
    expect(harness.attached("control")).toBe(1);

    visible.value = false;
    await nextTick();
    await flushPromises();
    expect(harness.attached("control")).toBe(0);

    // 重新挂载：remove 之后可以再 add（Driver 自己记账）
    visible.value = true;
    await nextTick();
    await flushPromises();
    expect(harness.attached("control")).toBe(1);

    await unmountAndSettle(wrapper);
    harness.assertIdle("Control 组件");
  });

  it("Layer：行政区图层挂载与可见性切换", async () => {
    const visible = ref(true);
    const wrapper = await mountMapTree(() => [
      h(BDistrictLayer, { name: "北京市", visible: visible.value }),
    ]);
    expect(harness.attached("layer")).toBe(1);

    visible.value = false;
    await nextTick();
    await flushPromises();
    expect(harness.attached("layer")).toBe(0);

    await unmountAndSettle(wrapper);
    harness.assertIdle("Layer 组件");
  });

  it("Marker 与 Layer 混挂在同一张地图：两类读数与位置投影都按族划分", async () => {
    const wrapper = await mountMapTree(() => [
      h(BMarker, { position: POSITION }),
      h(BDistrictLayer, { name: "北京市" }),
    ]);
    expect({
      overlays: harness.attached("overlay"),
      layers: harness.attached("layer"),
      positions: harness.overlayPositions(),
    }).toEqual({ overlays: 1, layers: 1, positions: [POSITION] });

    await unmountAndSettle(wrapper);
    harness.assertIdle("Marker + Layer 混挂");
  });

  it("基础服务：useBMapGeocoder 把 SDK 回包归一成 Point", async () => {
    const outcome: { status: "resolved" | "failed"; finite: boolean } = {
      status: "failed",
      finite: false,
    };
    const GeocodeProbe = defineComponent({
      setup() {
        const geocoder = useBMapGeocoder();
        onMounted(async () => {
          try {
            // #38 起动作恒 resolve 成 ServiceResult：不 reject，「有没有结果」看 status/data
            const result = await geocoder.get("北京", "北京市");
            outcome.status = "resolved";
            outcome.finite =
              result.status === "success" &&
              result.data !== null &&
              Number.isFinite(result.data.lng) &&
              Number.isFinite(result.data.lat);
          } catch {
            outcome.status = "failed";
          }
        });
        return () => h("span", "geo");
      },
    });

    const wrapper = await mountMapTree(() => [h(GeocodeProbe)]);
    await flushPromises();
    await nextTick();
    expect({ ...outcome }).toEqual({ status: "resolved", finite: true });

    await unmountAndSettle(wrapper);
    harness.assertIdle("地址解析");
  });
});

describe("生命周期门禁（组件层）", () => {
  it("100 次挂载 / 卸载整棵组件树之后诊断归零", async () => {
    for (let i = 0; i < 100; i++) {
      const wrapper = await mountMapTree(() => [
        h(BMarker, { position: POSITION }),
        h(BControl, {}, () => h("span", "c")),
        h(BDistrictLayer, { name: "北京市" }),
        // 气泡也进循环：它走的是**地图级**专用入口（不是 addOverlay），因此它的释放路径
        // 与其它三个族完全不同，混挂时最容易被漏掉（R25-C / #72）
        h(BInfoWindow, { position: POSITION, open: true }),
      ]);
      // 每一轮都必须真的挂上（否则「归零」可能是「从来没挂过」）。四个族都断言。
      expect(harness.attached("overlay")).toBe(1);
      expect(harness.attached("control")).toBe(1);
      expect(harness.attached("layer")).toBe(1);
      expect(harness.openInfoWindows(), "气泡确实打开过（不是被门禁默默放过）").toBe(1);
      await unmountAndSettle(wrapper);
    }
    // 卸载之后 SDK 侧不能有任何未释放资源
    harness.assertIdle("100 轮挂载/卸载");

    // **逐族**证据：四个 family 都真的挂过 100 次，而不是被门禁「默默放过」
    const activity = fake.diagnostics.snapshot().activity;
    expect(activity.overlaysAttached, "覆盖物确实挂载过 100 次").toBeGreaterThanOrEqual(100);
    expect(activity.controlsAttached, "控件确实挂载过 100 次").toBeGreaterThanOrEqual(100);
    expect(activity.layersAttached, "图层确实挂载过 100 次").toBeGreaterThanOrEqual(100);
    expect(activity.infoWindowsOpened, "气泡确实打开过 100 次").toBeGreaterThanOrEqual(100);
    expect(activity.overlaysDetached).toBe(activity.overlaysAttached);
    expect(activity.controlsDetached).toBe(activity.controlsAttached);
    expect(activity.layersDetached).toBe(activity.layersAttached);
    expect(activity.infoWindowsReleased, "100 轮之后气泡的销账次数必须与打开次数一致").toBe(
      activity.infoWindowsOpened,
    );
    // 「诊断全归零」的另一半：资源账归零之外，异步窗口也必须结算干净
    // （定时器 / 回调不进泄漏门禁，见 ADR 决策 1，因此这里显式断言）
    expect(fake.diagnostics.pendingAsync()).toEqual({ timers: 0, callbacks: 0 });
  });
});
