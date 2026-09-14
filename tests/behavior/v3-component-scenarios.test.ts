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
import { beforeEach, describe, it, expect, vi } from "vitest";
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
import { BMapError } from "../../packages/baidu-map-gl-vue/src/core/errors/BMapError";

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

/**
 * 挂一份由 `props` 驱动的 `<BMap>`（视野用例需要从外部改变 props，见 M4-STATE / #27）。
 *
 * `emit` 从 `<BMap>` 自己的 wrapper 上读：`wrapper.emitted()` 只记录父级 emit 的事件。
 * `onError` 把「组件 mounted / watcher 回调里抛出的错误」收成可断言的结果
 * （与 `mountMapTree` 同一口径：Vue 会交给 `config.errorHandler`，不接住就是 unhandled）。
 */
async function mountControlledMap(
  getProps: () => Record<string, unknown>,
  options: { children?: () => VNodeChild; onError?: (error: unknown) => void } = {},
) {
  const Root = defineComponent({ setup: () => () => h(BMap, getProps(), options.children) });
  const wrapper = mount(Root, {
    attachTo: harness.container(),
    global: options.onError ? { config: { errorHandler: options.onError } } : undefined,
  });
  await flushPromises();
  await nextTick();
  return { wrapper, bmap: wrapper.findComponent(BMap) };
}

/** 一套受控视野 props（父级从 setup 起就传值 ⇒ 受控）。 */
function controlledViewProps(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { provider: harness.provider(), center: { ...POSITION }, zoom: 12, ...extra };
}

/** 等一轮「父级传了新 props」的副作用（watcher 是 `flush: "post"`）。 */
async function settleProps() {
  await flushPromises();
  await nextTick();
}

/** 只看 `console.warn` 的首参（`logger.warn` 把 context 作为第二参附加）。 */
function warnLines(warn: { mock: { calls: unknown[][] } }): string[] {
  return warn.mock.calls.map((call) => String(call[0]));
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
            const point = await geocoder.get("北京", "北京市");
            outcome.status = "resolved";
            outcome.finite =
              point !== null && Number.isFinite(point.lng) && Number.isFinite(point.lat);
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

/**
 * M4-STATE / issue #27：Map 视野的受控 / 非受控三态。
 *
 * 用例只写领域语言（`harness.view()` / `harness.viewWrites()` / `harness.simulateUserView()` /
 * `harness.assertIdle()`），不碰 Fake 的字段名——同 AGENTS.md 的「组件级场景」约定。
 * 规范（三态语义、回环抑制、已知限制）见 ADR `2026-09-14-map-controlled-state` 与
 * `docs/zh-CN/components/map.md` 的状态表。
 */
describe("BMap 视野的受控 / 非受控（M4-STATE / #27）", () => {
  const AMERICA = { lng: -74.006, lat: 40.7128 };

  it("初次视野只设定一次；后续 center 变化走字段级写入且不重置 zoom", async () => {
    const props = ref<Record<string, unknown>>(controlledViewProps());
    const { wrapper } = await mountControlledMap(() => props.value);

    expect(harness.viewWrites().centerAndZoom).toBe(1);
    expect(harness.view()).toMatchObject({ center: POSITION, zoom: 12 });

    props.value = { ...props.value, center: { ...AMERICA } };
    await settleProps();

    expect(harness.viewWrites().centerAndZoom, "后续 center 变化不得重跑初始化视野").toBe(1);
    expect(harness.viewWrites().setCenter).toBe(1);
    expect(harness.view().center).toEqual(AMERICA);
    expect(harness.viewWrites().setZoom, "center 变化不得重置 zoom").toBe(0);
    expect(harness.view().zoom).toBe(12);

    await unmountAndSettle(wrapper);
    harness.assertIdle("视野：初始化只执行一次");
  });

  it("center 0/0 与边界 zoom 是合法值（不被当成缺省丢弃）", async () => {
    const props = ref<Record<string, unknown>>(
      controlledViewProps({ center: { lng: 0, lat: 0 }, zoom: 0, maxZoom: 21 }),
    );
    const { wrapper } = await mountControlledMap(() => props.value);

    expect(harness.view()).toMatchObject({ center: { lng: 0, lat: 0 }, zoom: 0 });

    props.value = { ...props.value, center: { ...POSITION }, zoom: 21 };
    await settleProps();
    expect(harness.viewWrites()).toMatchObject({ setCenter: 1, setZoom: 1 });
    expect(harness.view()).toMatchObject({ center: POSITION, zoom: 21 });

    props.value = { ...props.value, center: { lng: 0, lat: 0 }, zoom: 0 };
    await settleProps();
    expect(harness.viewWrites()).toMatchObject({ setCenter: 2, setZoom: 2 });
    expect(harness.view()).toMatchObject({ center: { lng: 0, lat: 0 }, zoom: 0 });

    await unmountAndSettle(wrapper);
    harness.assertIdle("视野：0/0 与边界 zoom");
  });

  it("相同值不同引用、以及容差内的浮点抖动都不写 SDK", async () => {
    const props = ref<Record<string, unknown>>(controlledViewProps());
    const { wrapper } = await mountControlledMap(() => props.value);

    // 新引用、同值（父级每次渲染传内联字面量的常见形态）
    props.value = { ...props.value, center: { ...POSITION } };
    await settleProps();
    expect(harness.viewWrites().setCenter).toBe(0);

    // 容差内抖动（真实 SDK 读回常带 ±1e-9 级别的差）
    props.value = { ...props.value, center: { lng: POSITION.lng + 1e-9, lat: POSITION.lat }, zoom: 12 + 1e-9 };
    await settleProps();
    expect(harness.viewWrites()).toMatchObject({ setCenter: 0, setZoom: 0 });

    // 正证守卫：真的变了就必须写（否则上面的「没写」可能只是没接线）
    props.value = { ...props.value, center: { lng: POSITION.lng + 0.01, lat: POSITION.lat } };
    await settleProps();
    expect(harness.viewWrites().setCenter).toBe(1);

    await unmountAndSettle(wrapper);
    harness.assertIdle("视野：相同值不写 SDK");
  });

  it("用户交互回写 model 并通知父级；父级按 v-model 回写不再写 SDK", async () => {
    const props = ref<Record<string, unknown>>(controlledViewProps());
    // `v-model:center` 编译出来就是 `center` + `onUpdate:center` 这一对；
    // 这里按编译产物接上，父级 state 会真的被更新——链路与模板里的 v-model 一致。
    props.value["onUpdate:center"] = (next: unknown) => {
      props.value = { ...props.value, center: next };
    };
    const { wrapper, bmap } = await mountControlledMap(() => props.value);

    harness.simulateUserView({ center: { lng: 116.5, lat: 40 } });
    await settleProps();

    expect(bmap.emitted("update:center")).toEqual([[{ lng: 116.5, lat: 40 }]]);
    expect(harness.viewWrites().setCenter, "回写自身不得触发新的写入").toBe(0);
    expect(props.value.center, "父级 state 已被 v-model 更新").toEqual({ lng: 116.5, lat: 40 });
    expect(harness.view().center).toEqual({ lng: 116.5, lat: 40 });

    // 父级显式再写一遍同一个值（新引用）：读回判定「已一致」→ 不重复命令、不重复通知
    props.value = { ...props.value, center: { lng: 116.5, lat: 40 } };
    await settleProps();
    expect(harness.viewWrites().setCenter).toBe(0);
    expect(bmap.emitted("update:center")).toHaveLength(1);

    await unmountAndSettle(wrapper);
    harness.assertIdle("视野：用户交互回写");
  });

  it("zoom / heading / tilt 三个字段各自回写，回写闭环后不再写 SDK", async () => {
    const props = ref<Record<string, unknown>>(controlledViewProps({ heading: 0, tilt: 0 }));
    const { wrapper, bmap } = await mountControlledMap(() => props.value);

    // 初次视野经 initializeView 写入角度（center/zoom 走 centerAndZoom）
    expect(harness.viewWrites()).toMatchObject({ setCenter: 0, setZoom: 0, setHeading: 1, setTilt: 1 });

    harness.simulateUserView({ zoom: 14, heading: 30, tilt: 45 });
    await settleProps();

    expect(bmap.emitted("update:zoom")).toEqual([[14]]);
    expect(bmap.emitted("update:heading")).toEqual([[30]]);
    expect(bmap.emitted("update:tilt")).toEqual([[45]]);
    expect(harness.view()).toMatchObject({ zoom: 14, heading: 30, tilt: 45 });

    props.value = { ...props.value, zoom: 14, heading: 30, tilt: 45 };
    await settleProps();
    expect(harness.viewWrites(), "三个字段都已一致 ⇒ 不再下发命令").toMatchObject({
      setZoom: 0,
      setHeading: 1,
      setTilt: 1,
    });

    await unmountAndSettle(wrapper);
    harness.assertIdle("视野：三字段回写");
  });

  it("heading 的 -90 与 270 是同一朝向（v4 getHeading 带符号），不产生假回写", async () => {
    const props = ref<Record<string, unknown>>(controlledViewProps({ heading: 270 }));
    const { wrapper, bmap } = await mountControlledMap(() => props.value);

    expect(harness.view().heading).toBe(270);
    const writesAfterInit = harness.viewWrites().setHeading;
    expect(writesAfterInit).toBe(1);

    // 真实 v4：`setHeading(270)` 之后 `getHeading()` 返回 -90。Fake 不复刻归一化，
    // 因此这里显式模拟那次读回（角度值变了，朝向没变）。
    harness.simulateUserView({ heading: -90 });
    await settleProps();
    expect(bmap.emitted("update:heading"), "同一朝向不得通知父级").toBeUndefined();
    expect(harness.viewWrites().setHeading).toBe(writesAfterInit);

    // 正证守卫：真的转到别的朝向就必须通知（否则上面「没通知」可能只是事件没接上）
    harness.simulateUserView({ heading: 90 });
    await settleProps();
    expect(bmap.emitted("update:heading")).toEqual([[90]]);

    // 外部值改成 90（地图已经在 90）：读回判定一致 ⇒ 不重复命令
    props.value = { ...props.value, heading: 90 };
    await settleProps();
    expect(harness.viewWrites().setHeading).toBe(writesAfterInit);

    // 真变化（90 → 270）则必须写回
    props.value = { ...props.value, heading: 270 };
    await settleProps();
    expect(harness.viewWrites().setHeading).toBe(writesAfterInit + 1);

    await unmountAndSettle(wrapper);
    harness.assertIdle("视野：heading 环绕");
  });

  it("default* 只在首次解析生效：四个字段的后续变化都不覆盖当前视野，并告警一次", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const props = ref<Record<string, unknown>>({
      provider: harness.provider(),
      defaultCenter: { ...POSITION },
      defaultZoom: 12,
      defaultHeading: 30,
      defaultTilt: 45,
    });
    const { wrapper } = await mountControlledMap(() => props.value);

    // 正证守卫：四个 default 真的进了首次视野
    expect(harness.view()).toEqual({ center: POSITION, zoom: 12, heading: 30, tilt: 45 });
    expect(harness.viewWrites()).toMatchObject({ centerAndZoom: 1, setHeading: 1, setTilt: 1 });

    props.value = {
      ...props.value,
      defaultCenter: { ...AMERICA },
      defaultZoom: 15,
      defaultHeading: 60,
      defaultTilt: 10,
    };
    await settleProps();

    expect(harness.view(), "default 变化不得覆盖当前视野").toEqual({
      center: POSITION,
      zoom: 12,
      heading: 30,
      tilt: 45,
    });
    expect(harness.viewWrites(), "default 变化不得下发任何命令").toMatchObject({
      centerAndZoom: 1,
      setCenter: 0,
      setZoom: 0,
      setHeading: 1,
      setTilt: 1,
    });
    expect(warnLines(warn).some((line) => line.includes("只在首次解析时生效"))).toBe(true);

    await unmountAndSettle(wrapper);
    harness.assertIdle("视野：default 只生效一次");
  });

  it("缺省档用库默认视野，且用户交互同样回写（不依赖受控 prop）", async () => {
    const props = ref<Record<string, unknown>>({ provider: harness.provider() });
    const { wrapper, bmap } = await mountControlledMap(() => props.value);

    // 与 v2/v3 的 props 默认值一致（docs/zh-CN/components/map.md 的库默认视野）
    expect(harness.view()).toEqual({
      center: { lng: 116.403901, lat: 39.915185 },
      zoom: 14,
      heading: 0,
      tilt: 0,
    });
    expect(harness.viewWrites().centerAndZoom, "缺省档也只初始化一次").toBe(1);

    harness.simulateUserView({ center: { lng: 116.5, lat: 40 }, zoom: 15 });
    await settleProps();

    expect(bmap.emitted("update:center")).toEqual([[{ lng: 116.5, lat: 40 }]]);
    expect(bmap.emitted("update:zoom")).toEqual([[15]]);
    expect(harness.viewWrites()).toMatchObject({ setCenter: 0, setZoom: 0 });

    await unmountAndSettle(wrapper);
    harness.assertIdle("视野：缺省档");
  });

  it("受控与非受控模式切换给出明确告警（两个方向），且不拒绝生效", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const props = ref<Record<string, unknown>>({ provider: harness.provider() });
    const { wrapper } = await mountControlledMap(() => props.value);

    // 非受控 → 受控，且外部值与内部状态冲突
    props.value = { ...props.value, center: { ...AMERICA } };
    await settleProps();
    expect(harness.viewWrites().setCenter, "切换后外部值仍然生效（告警不等于拒绝）").toBe(1);
    expect(
      warnLines(warn).filter((line) => line.includes("由非受控切换为受控")),
    ).toHaveLength(1);

    // 受控 → 非受控：内部状态接管并保留最后一次外部值
    props.value = { provider: props.value.provider };
    await settleProps();
    expect(warnLines(warn).filter((line) => line.includes("由受控切换为非受控"))).toHaveLength(1);
    expect(harness.view().center, "移除受控值不会把视野退回库默认").toEqual(AMERICA);
    expect(harness.viewWrites().setCenter).toBe(1);

    await unmountAndSettle(wrapper);
    harness.assertIdle("视野：模式切换");
  });

  it("受控值与 default 同时传入时以受控值为准（首次视野也听受控值）", async () => {
    const props = ref<Record<string, unknown>>({
      provider: harness.provider(),
      center: { ...POSITION },
      defaultCenter: { ...AMERICA },
      zoom: 5,
      defaultZoom: 15,
    });
    const { wrapper } = await mountControlledMap(() => props.value);

    expect(harness.view()).toMatchObject({ center: POSITION, zoom: 5 });
    expect(harness.viewWrites()).toMatchObject({ centerAndZoom: 1, setCenter: 0, setZoom: 0 });

    await unmountAndSettle(wrapper);
    harness.assertIdle("视野：受控值优先");
  });

  it("视野写入与事件回写都不重绑监听器；卸载后监听器归零", async () => {
    const props = ref<Record<string, unknown>>(controlledViewProps({ heading: 0, tilt: 0 }));
    const { wrapper } = await mountControlledMap(() => props.value);

    expect(harness.subscribedEvents()).toEqual(
      expect.arrayContaining(["click", "moveend", "zoomend", "headingchange", "tiltchange"]),
    );

    const listens = harness.listenActivity().calls;
    props.value = { ...props.value, center: { ...AMERICA }, zoom: 13 };
    await settleProps();
    harness.simulateUserView({ center: { lng: 118, lat: 41 }, zoom: 14, heading: 10, tilt: 20 });
    await settleProps();
    expect(harness.listenActivity().calls, "受控更新与事件回写都必须复用同一个 raw 订阅").toBe(
      listens,
    );

    await unmountAndSettle(wrapper);
    expect(harness.listenActivity().pending).toBe(0);
    harness.assertIdle("视野：不重绑与卸载归零");
  });

  /* ------------------------------------------------- 评审补测（2026-09-14 回合同步补） */

  it("SDK 就绪前发生的受控值变化，会在 ready 时收敛（延迟加载 Provider）", async () => {
    const props = ref<Record<string, unknown>>({
      provider: harness.deferredProvider(),
      center: { ...POSITION },
      zoom: 12,
      heading: 0,
      tilt: 0,
    });
    const { wrapper } = await mountControlledMap(() => props.value);
    // 正证守卫：SDK 真的还没放行（否则下面的「收敛」可能只是因为压根没走延迟路径）
    expect(harness.mapsCreated(), "SDK 尚未放行 ⇒ 还没有地图").toBe(0);

    // 加载窗口内改四个受控值：那时没有 map 可写，watcher 只能跳过
    const later = { lng: 121.5, lat: 31.2 };
    props.value = { ...props.value, center: { ...later }, zoom: 16, heading: 45, tilt: 30 };
    await settleProps();
    expect(harness.mapsCreated(), "仅改 props 不会提前建图").toBe(0);

    harness.releaseProvider();
    await settleProps();
    await settleProps();

    // 最终视野必须是**最新 props**（不修的话这里会停在 POSITION / 12 / 0 / 0）
    expect(harness.view()).toEqual({ center: later, zoom: 16, heading: 45, tilt: 30 });
    // 而且收敛是**字段级写入**，不是重跑初始化视野
    expect(harness.viewWrites()).toMatchObject({
      centerAndZoom: 1,
      setCenter: 1,
      setZoom: 1,
      setHeading: 2,
      setTilt: 2,
    });

    await unmountAndSettle(wrapper);
    harness.assertIdle("视野：加载窗口内的受控更新");
  });

  it("加载期间「受控 → 非受控」时内部状态接管，地图在 ready 后与内部状态一致（四个字段）", async () => {
    const props = ref<Record<string, unknown>>({ provider: harness.deferredProvider() });
    const { wrapper, bmap } = await mountControlledMap(() => props.value);
    expect(harness.mapsCreated(), "SDK 尚未放行 ⇒ 还没有地图").toBe(0);

    // 加载窗口内：先变成受控（A），再切回非受控（undefined）⇒ 按规则由内部状态接管并保留 A
    props.value = {
      provider: props.value.provider,
      center: { ...AMERICA },
      zoom: 9,
      heading: 30,
      tilt: 20,
    };
    await settleProps();
    props.value = { provider: props.value.provider };
    await settleProps();

    harness.releaseProvider();
    await settleProps();
    await settleProps();

    // 首次视野用的是缺省档（库默认），ready 时的收敛必须把**内部状态**写进地图
    expect(harness.view()).toEqual({ center: AMERICA, zoom: 9, heading: 30, tilt: 20 });
    expect(harness.viewWrites(), "初始化只发生一次，之后是四个字段的收敛写入").toEqual({
      centerAndZoom: 1,
      setCenter: 1,
      setZoom: 1,
      setHeading: 2, // initializeView 写了缺省的 0，收敛再写 30
      setTilt: 2,
    });

    // 正证守卫：状态与地图一致 ⇒ 用户「回到 A」不算变化，不应 emit
    harness.simulateUserView({ center: { ...AMERICA }, zoom: 9, heading: 30, tilt: 20 });
    await settleProps();
    expect(bmap.emitted("update:center")).toBeUndefined();
    expect(bmap.emitted("update:zoom")).toBeUndefined();
    expect(bmap.emitted("update:heading")).toBeUndefined();
    expect(bmap.emitted("update:tilt")).toBeUndefined();

    await unmountAndSettle(wrapper);
    harness.assertIdle("视野：加载窗口内的受控 → 非受控");
  });

  it("加载期间才出现的受控值（`loaded ? spot : undefined` 形态）在 ready 后生效", async () => {
    const props = ref<Record<string, unknown>>({ provider: harness.deferredProvider() });
    const { wrapper } = await mountControlledMap(() => props.value);
    expect(harness.mapsCreated()).toBe(0);

    // 文档明确支持的用法：起点是「缺省档」，异步数据到达后才开始受控
    props.value = { provider: props.value.provider, center: { ...POSITION }, zoom: 9 };
    await settleProps();
    harness.releaseProvider();
    await settleProps();
    await settleProps();

    expect(harness.view()).toEqual({ center: POSITION, zoom: 9, heading: 0, tilt: 0 });
    expect(harness.viewWrites()).toMatchObject({ centerAndZoom: 1, setCenter: 1, setZoom: 1 });

    await unmountAndSettle(wrapper);
    harness.assertIdle("视野：加载期间开始受控");
  });

  it("受控 center 的原地 mutation 不改动状态与首次快照", async () => {
    const spot = { lng: POSITION.lng, lat: POSITION.lat };
    const props = ref<Record<string, unknown>>({
      provider: harness.provider(),
      center: spot,
      zoom: 12,
    });
    const { wrapper, bmap } = await mountControlledMap(() => props.value);
    expect(harness.view().center).toEqual(POSITION);

    // 用户交互把地图挪走（父级按 v-model 收到了回写）
    props.value["onUpdate:center"] = (next: unknown) => {
      props.value = { ...props.value, center: next };
    };
    harness.simulateUserView({ center: { lng: 118, lat: 41 } });
    await settleProps();
    expect(harness.view().center).toEqual({ lng: 118, lat: 41 });

    // 父级原地改「自己那个对象」：既没有新引用、也没有新的 props 变化
    spot.lng = 125;
    await settleProps();
    expect(harness.view().center, "mutation 不是 prop 变化，地图不动").toEqual({
      lng: 118,
      lat: 41,
    });

    // 关键断言：resetView() 回到**首次解析**的值，而不是被 mutation 改过的 125
    (bmap.vm as unknown as { resetView(): void }).resetView();
    await settleProps();
    expect(harness.view().center).toEqual(POSITION);

    await unmountAndSettle(wrapper);
    harness.assertIdle("视野：受控 center 原地 mutation");
  });

  it("defaultCenter 的原地 mutation 不改内部初值，也不吃掉后续 update:center", async () => {
    const initial = { lng: POSITION.lng, lat: POSITION.lat };
    const props = ref<Record<string, unknown>>({
      provider: harness.provider(),
      defaultCenter: initial,
      defaultZoom: 12,
    });
    const { wrapper, bmap } = await mountControlledMap(() => props.value);
    expect(harness.view()).toMatchObject({ center: POSITION, zoom: 12 });

    initial.lng = 125;
    await settleProps();
    expect(harness.view().center, "mutation 不得静默改到内部初值").toEqual(POSITION);
    expect(harness.viewWrites().setCenter).toBe(0);

    // 用户交互到「与 mutation 后的值相同」的位置：内部状态没被改写 ⇒ 必须照常上报
    harness.simulateUserView({ center: { lng: 125, lat: 39.9 } });
    await settleProps();
    expect(bmap.emitted("update:center")).toEqual([[{ lng: 125, lat: 39.9 }]]);

    await unmountAndSettle(wrapper);
    harness.assertIdle("视野：defaultCenter 原地 mutation");
  });

  it("读回失败：白名单错误码跳过命令，其余错误码上抛", async () => {
    const errors: unknown[] = [];
    const seen: { driver: Record<string, unknown> | null } = { driver: null };
    const DriverProbe = defineComponent({
      setup() {
        const mapContext = useRequiredMapContext();
        return () => {
          // 首帧渲染时 client 还没就绪（探针挂在 `<BMap>` 的默认插槽里，先于 mount 完成渲染），
          // 因此这里要能容忍 undefined，等 client 就绪后的那次重渲染再捕获。
          const driver = mapContext.client.value?.driver as unknown as
            | { map: Record<string, unknown> }
            | undefined;
          if (driver) seen.driver = driver.map;
          return h("span", "driver-probe");
        };
      },
    });

    const props = ref<Record<string, unknown>>(controlledViewProps());
    const { wrapper } = await mountControlledMap(() => props.value, {
      children: () => h(DriverProbe),
      onError: (error) => errors.push(error),
    });
    const driverMap = seen.driver;
    expect(driverMap, "探针必须拿到 driver.map").not.toBeNull();

    // ① 已销毁（白名单）：读不到 ⇒ 不下发命令，也不上抛
    driverMap!.getCenter = () => {
      throw new BMapError("BMAP_RESOURCE_DISPOSED", "地图已销毁");
    };
    props.value = { ...props.value, center: { lng: 118, lat: 41 } };
    await settleProps();
    expect(harness.viewWrites().setCenter, "读不到就不写下一条命令").toBe(0);
    expect(errors, "白名单错误码不上抛").toHaveLength(0);
    expect(harness.view().center, "地图仍停在原处").toEqual(POSITION);

    // ② 真实故障（不在白名单）：必须冒出来，而不是被静默跳过
    driverMap!.getCenter = () => {
      throw new BMapError("BMAP_SDK_CALL_FAILED", "读回失败");
    };
    props.value = { ...props.value, center: { lng: 119, lat: 42 } };
    await settleProps();
    expect(errors, "非白名单错误码必须上抛（Vue 交给 errorHandler）").toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(BMapError);
    expect(harness.viewWrites().setCenter).toBe(0);

    await unmountAndSettle(wrapper);
    harness.assertIdle("视野：读回错误白名单");
  });
});
