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
import { KeepAlive, defineComponent, h, nextTick, onMounted, ref, type VNodeChild } from "vue";
import {
  browserShims,
  createFakeV4Harness,
  createManualFrames,
  type FakeV4Harness,
} from "../../packages/test-utils";
import BMap from "../../packages/baidu-map-gl-vue/src/components/map/BMap.vue";
import BMarker from "../../packages/baidu-map-gl-vue/src/components/overlays/BMarker.vue";
import BInfoWindow from "../../packages/baidu-map-gl-vue/src/components/overlays/BInfoWindow.vue";
import BControl from "../../packages/baidu-map-gl-vue/src/components/controls/BControl.vue";
import BDistrictLayer from "../../packages/baidu-map-gl-vue/src/components/layers/BDistrictLayer.vue";
import { useBMapGeocoder } from "../../packages/baidu-map-gl-vue/src/composables/useBMapGeocoder";
import { useMapEvent } from "../../packages/baidu-map-gl-vue/src/composables/useMapEvent";
import { useMapStatus } from "../../packages/baidu-map-gl-vue/src/composables/useMapStatus";
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
  options: {
    children?: () => VNodeChild;
    onError?: (error: unknown) => void;
    /** 挂载宿主（默认 `harness.container()`）；容器门禁用例需要自己控制宿主。 */
    attachTo?: HTMLElement;
  } = {},
) {
  const Root = defineComponent({ setup: () => () => h(BMap, getProps(), options.children) });
  const wrapper = mount(Root, {
    attachTo: options.attachTo ?? harness.container(),
    global: options.onError ? { config: { errorHandler: options.onError } } : undefined,
  });
  await flushPromises();
  await nextTick();
  return { wrapper, bmap: wrapper.findComponent(BMap) };
}

import type { BMapExpose } from "../../packages/baidu-map-gl-vue/src/types/mapExpose";

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
    // `@click` 显式绑定：map 事件从 #28 起**按需订阅**（父级没绑就一个监听器都不建），
    // 因此这条「监听器复用」的门禁必须先把 click 绑上，否则断言的是「压根没订阅」。
    const props = ref<Record<string, unknown>>(
      controlledViewProps({ heading: 0, tilt: 0, onClick: () => {} }),
    );
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

  it("resetView() 同步状态：非受控下重置后再次回到同一值仍然会 emit（第三轮 P1）", async () => {
    const props = ref<Record<string, unknown>>({
      provider: harness.provider(),
      defaultCenter: { ...POSITION },
      defaultZoom: 12,
    });
    const { wrapper, bmap } = await mountControlledMap(() => props.value);
    expect(harness.view()).toMatchObject({ center: POSITION, zoom: 12 });

    // 非受控档：用户拖到 B，内部状态跟随并上报
    harness.simulateUserView({ center: { ...AMERICA }, zoom: 15 });
    await settleProps();
    expect(bmap.emitted("update:center")).toEqual([[{ ...AMERICA }]]);
    expect(bmap.emitted("update:zoom")).toEqual([[15]]);

    // resetView：地图回首次快照，**状态也要回**（否则下一次真实变化会被判成「没变化」）
    (bmap.vm as unknown as { resetView(): void }).resetView();
    await settleProps();
    expect(harness.view()).toMatchObject({ center: POSITION, zoom: 12 });

    // 再次真实地拖到同一个 B：必须仍然上报
    harness.simulateUserView({ center: { ...AMERICA }, zoom: 15 });
    await settleProps();
    expect(bmap.emitted("update:center"), "第二次真实变化不得被吃掉").toHaveLength(2);
    expect(bmap.emitted("update:center")?.[1]).toEqual([{ ...AMERICA }]);
    expect(bmap.emitted("update:zoom")).toHaveLength(2);

    await unmountAndSettle(wrapper);
    harness.assertIdle("视野：resetView 同步状态");
  });

  it("resetView() 之后「受控 → 非受控」接管的是重置值（冻结该语义）", async () => {
    const props = ref<Record<string, unknown>>(controlledViewProps());
    const { wrapper, bmap } = await mountControlledMap(() => props.value);

    // 父级把受控值改到 AMERICA：地图跟随（1 条 setCenter）
    props.value = { ...props.value, center: { ...AMERICA } };
    await settleProps();
    expect(harness.view().center).toEqual(AMERICA);
    expect(harness.viewWrites().setCenter).toBe(1);

    // resetView：地图与状态都回到首次快照
    (bmap.vm as unknown as { resetView(): void }).resetView();
    await settleProps();
    expect(harness.view().center).toEqual(POSITION);

    // 移除受控值（受控 → 非受控）：接管值 = 重置值 ⇒ 不产生任何写入
    props.value = { provider: props.value.provider, zoom: 12 };
    await settleProps();
    expect(harness.view().center, "地图不得被拉回重置前的位置").toEqual(POSITION);
    expect(harness.viewWrites().setCenter).toBe(1);

    // 状态也确实是重置值：用户「拖到快照值」不算变化 ⇒ 不 emit
    harness.simulateUserView({ center: { ...POSITION } });
    await settleProps();
    expect(bmap.emitted("update:center")).toBeUndefined();

    await unmountAndSettle(wrapper);
    harness.assertIdle("视野：resetView 后的模式切换");
  });

  it("受控字符串 center：ready 时每个字段至多写一条命令（加载期间没变过）", async () => {
    const props = ref<Record<string, unknown>>({
      provider: harness.deferredProvider(),
      center: "北京市",
      zoom: 12,
    });
    const { wrapper } = await mountControlledMap(() => props.value);
    expect(harness.mapsCreated()).toBe(0);

    harness.releaseProvider();
    await settleProps();
    await settleProps();

    // 字符串无法与读回的点判等 ⇒ 读回守卫失效；但「与首次快照相同」这条短路仍然成立
    expect(harness.viewWrites(), "字符串 center 未变过时不该有任何额外命令").toMatchObject({
      centerAndZoom: 1,
      setCenter: 0,
      setZoom: 0,
    });

    await unmountAndSettle(wrapper);
    harness.assertIdle("视野：字符串 center 未变");
  });

  it("受控字符串 center：加载期间变化时恰好写一条命令（不重复）", async () => {
    const props = ref<Record<string, unknown>>({
      provider: harness.deferredProvider(),
      center: "北京",
      zoom: 12,
    });
    const { wrapper } = await mountControlledMap(() => props.value);
    expect(harness.mapsCreated()).toBe(0);

    props.value = { ...props.value, center: "上海" };
    await settleProps();
    harness.releaseProvider();
    await settleProps();
    await settleProps();

    expect(harness.viewWrites(), "同一字段在 ready 时只能写一次").toMatchObject({
      centerAndZoom: 1,
      setCenter: 1,
      setZoom: 0,
    });

    await unmountAndSettle(wrapper);
    harness.assertIdle("视野：字符串 center 变化");
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

/* ------------------------------------------------------------------ map 事件（M4-EVENTS / #28）
 *
 * 组件级场景只写领域语言（`harness.dispatch()` / `bmap.emitted()` / `harness.assertIdle()`）：
 * - `<BMap>` 的 map 事件**按需订阅**（父级绑了才订）；
 * - 模板上绑 `@maxtypechange` / `@style_loaded`（别名拼写）都能收到；
 * - 内联 handler 随渲染更新不重绑；卸载后监听器归零；
 * - 高频事件一帧最多提交一次；
 * - 两张地图的订阅互不串线（`<BMap>` 的 @ 与 `useMapEvent` 两条路径都验证）。
 */
describe("map 事件与状态（M4-EVENTS / #28）", () => {
  it("map 事件无条件订阅（不依赖 prop 检测）：handler 从 undefined 变成函数也不会丢事件", async () => {
    // 为什么不做「按需订阅」：Vue 判子组件要不要重渲染时 **emit listener 不参与属性比较**
    // （`hasPropsChanged` 里 `!isEmitListener(...)`），于是「onClick 从 undefined 变成函数」这种
    // 变化不会让 <BMap> 重渲染 —— 依赖 onUpdated 的增量同步看不到它，事件会静默丢失。
    const props = ref<Record<string, unknown>>({ provider: harness.provider(), onClick: undefined });
    const { wrapper } = await mountControlledMap(() => props.value);

    const baseline = harness.listenActivity().pending;
    expect(harness.subscribedEvents(), "订阅在挂载时就建立，与 prop 检测无关").toContain("click");

    // 对照：另一个事件的 handler 不该被 click 唤醒
    const otherEvent = vi.fn();
    props.value = { ...props.value, onMoveend: otherEvent };
    await settleProps();
    harness.dispatch("click", { point: { lng: 1, lat: 2 } });
    expect(otherEvent, "没绑 click 的事件不该被唤醒").not.toHaveBeenCalled();

    // **关键回归**：同一个 key 从 undefined 变成函数。Vue 不会因此让 <BMap> 重渲染
    // （emit listener 不参与属性比较），父级也没改任何别的 prop —— 事件仍然必须到达
    const spy = vi.fn();
    props.value = { ...props.value, onClick: spy };
    await settleProps();
    harness.dispatch("click", { point: { lng: 3, lat: 4 } });
    expect(spy, "handler 变化后事件必须照常投递").toHaveBeenCalledTimes(1);
    expect(harness.listenActivity().pending, "订阅数不因 handler 变化而变").toBe(baseline);

    // 再变回 undefined：订阅还在（多一个没人听的 listener），但不会唤到 handler
    props.value = { ...props.value, onClick: undefined };
    await settleProps();
    harness.dispatch("click", { point: { lng: 5, lat: 6 } });
    expect(spy).toHaveBeenCalledTimes(1);

    await unmountAndSettle(wrapper);
    expect(harness.listenActivity().pending).toBe(0);
    harness.assertIdle("map 事件：无条件订阅");
  });

  it("订阅覆盖 Catalog 的全部事件（含 load / destroy 这类生命周期事件）", async () => {
    const { wrapper } = await mountControlledMap(() => ({ provider: harness.provider() }));
    const subscribed = harness.subscribedEvents();
    for (const sdkName of ["load", "destroy", "resize", "maptypechange", "moving", "click"]) {
      expect(subscribed, `${sdkName} 必须被订阅`).toContain(sdkName);
    }
    await unmountAndSettle(wrapper);
    harness.assertIdle("map 事件：全覆盖订阅");
  });

  it("事件真正转发到父级：@click 拿到归一化载荷，@style_loaded 兼容别名同样触发", async () => {
    const click = vi.fn();
    const alias = vi.fn();
    const { wrapper, bmap } = await mountControlledMap(() => ({
      provider: harness.provider(),
      onClick: click,
      onStyle_loaded: alias,
    }));

    harness.dispatch("click", { point: { lng: 116.5, lat: 40 }, pixel: { x: 10, y: 20 } });
    expect(click).toHaveBeenCalledTimes(1);
    expect(click.mock.calls[0]![0]).toMatchObject({
      type: "click",
      point: { lng: 116.5, lat: 40 },
      pixel: { x: 10, y: 20 },
    });
    expect(bmap.emitted("click")).toHaveLength(1);

    harness.dispatch("style_loaded");
    expect(alias, "SDK 拼写（兼容别名）也要触发").toHaveBeenCalledTimes(1);
    expect(bmap.emitted("style-loaded"), "规范名也发一次").toHaveLength(1);

    await unmountAndSettle(wrapper);
    harness.assertIdle("map 事件：转发");
  });

  it("内联 handler 随渲染更新不重绑；卸载后监听器归零", async () => {
    const counter = ref(0);
    const calls: number[] = [];
    const props = ref<Record<string, unknown>>({ provider: harness.provider() });
    const { wrapper } = await mountControlledMap(() => props.value);
    // 每一轮渲染都塞一个新的内联箭头函数（React 里正是这种写法需要 useLatest）
    const rerender = async () => {
      props.value = { ...props.value, provider: harness.provider(), onClick: () => calls.push(counter.value) };
      await settleProps();
    };
    await rerender();
    const listensAfterFirst = harness.listenActivity().calls;

    await rerender();
    await rerender();
    expect(harness.listenActivity().calls, "内联 handler 更新不得新增监听器").toBe(listensAfterFirst);

    counter.value = 7;
    harness.dispatch("click", { point: { lng: 1, lat: 2 } });
    expect(calls, "闭包读 ref：不换 handler 也能看到最新状态").toEqual([7]);

    await unmountAndSettle(wrapper);
    expect(harness.listenActivity().pending).toBe(0);
    harness.assertIdle("map 事件：不重绑");
  });

  it("高频事件一帧最多提交一次（moving 取最后一次载荷）", async () => {
    const frames = createManualFrames();
    frames.install();
    try {
      const moving = vi.fn();
      const { wrapper, bmap } = await mountControlledMap(() => ({
        provider: harness.provider(),
        onMoving: moving,
      }));

      harness.dispatch("moving", { point: { lng: 1, lat: 1 } });
      harness.dispatch("moving", { point: { lng: 2, lat: 2 } });
      harness.dispatch("moving", { point: { lng: 3, lat: 3 } });
      expect(bmap.emitted("moving"), "未到帧边界时一次都不提交").toBeUndefined();

      expect(frames.flush()).toBe(1);
      expect(moving).toHaveBeenCalledTimes(1);
      expect(bmap.emitted("moving")).toHaveLength(1);

      await unmountAndSettle(wrapper);
      harness.assertIdle("map 事件：高频合帧");
    } finally {
      frames.restore();
    }
  });

  it("两张地图互不串线：@ 绑定与 useMapEvent 各自只收到自己地图的事件", async () => {
    const clickA = vi.fn();
    const clickB = vi.fn();
    const composableA = vi.fn();

    // 子树里的 composable 走 Map Context（最近的一张地图）
    const EventProbe = defineComponent({
      setup() {
        useMapEvent("click", composableA);
        return () => h("span", "event-probe");
      },
    });

    // 索引用**负索引**：`harness.reset()` 只重置诊断计数、不清「已创建地图」的实例账本，
    // 所以 0/1 会指到别的用例留下的地图（-2 = A 刚建的、-1 = B 刚建的）
    const treeA = await mountControlledMap(() => ({ provider: harness.provider(), onClick: clickA }), {
      children: () => [h(EventProbe)],
    });
    const treeB = await mountControlledMap(() => ({ provider: harness.provider(), onClick: clickB }));

    expect(harness.mapsCreated(), "两张地图都建起来了").toBe(2);
    expect(harness.subscribedEventsOf(-2)).toContain("click");
    expect(harness.subscribedEventsOf(-1)).toContain("click");

    harness.dispatchTo(-2, "click", { point: { lng: 1, lat: 1 } });
    expect(clickA, "A 的父级收到").toHaveBeenCalledTimes(1);
    expect(clickB, "B 的父级不受影响").not.toHaveBeenCalled();
    expect(composableA, "A 子树里的 useMapEvent 收到").toHaveBeenCalledTimes(1);

    harness.dispatchTo(-1, "click", { point: { lng: 2, lat: 2 } });
    expect(clickB).toHaveBeenCalledTimes(1);
    expect(clickA).toHaveBeenCalledTimes(1);
    expect(composableA, "B 的事件不得串到 A 的订阅者").toHaveBeenCalledTimes(1);

    await unmountAndSettle(treeA.wrapper);
    await unmountAndSettle(treeB.wrapper);
    harness.assertIdle("map 事件：多地图不串线");
  });

  it("`@click.once` 也能订上（Vue 把 .once 编成 onClickOnce，旧判定会漏）", async () => {
    const once = vi.fn();
    const { wrapper, bmap } = await mountControlledMap(() => ({
      provider: harness.provider(),
      // 与 `@click.once` 的编译产物一致（实测 @vue/compiler-dom）
      onClickOnce: once,
    }));

    expect(harness.subscribedEvents()).toContain("click");
    harness.dispatch("click", { point: { lng: 1, lat: 2 } });
    expect(once).toHaveBeenCalledTimes(1);
    expect(bmap.emitted("click")).toHaveLength(1);

    // Vue 自己维护 once 语义：第二次派发不再调用 handler（也不再有 emit）
    harness.dispatch("click", { point: { lng: 1, lat: 2 } });
    expect(once).toHaveBeenCalledTimes(1);

    await unmountAndSettle(wrapper);
    harness.assertIdle("map 事件：@click.once");
  });

  it("handler 不是函数（undefined / null / 字符串）时不产生调用，也不报错", async () => {
    const props = ref<Record<string, unknown>>({ provider: harness.provider() });
    const { wrapper } = await mountControlledMap(() => props.value);

    // 值不是函数时：派发不抛错、也不唤任何 handler（订阅本身与「有没有人听」无关）。
    // 只测 `undefined` / `null`：更离谱的值（字符串等）由 Vue 自己的 `callWithAsyncErrorHandling`
    // 打 warning，那是 Vue 的判定面，不该由本库的用例背书。
    for (const value of [undefined, null] as const) {
      props.value = { ...props.value, onClick: value };
      await settleProps();
      expect(() => harness.dispatch("click", { point: { lng: 1, lat: 2 } }), `${String(value)} 不该抛错`).not.toThrow();
    }

    // 正证：换成函数后同一事件立刻可用（否则上面的断言只是「什么都没发生」）
    const spy = vi.fn();
    props.value = { ...props.value, onClick: spy };
    await settleProps();
    harness.dispatch("click", { point: { lng: 3, lat: 4 } });
    expect(spy).toHaveBeenCalledTimes(1);

    await unmountAndSettle(wrapper);
    harness.assertIdle("map 事件：非函数 handler");
  });

  it("kebab + camelCase + `.once` 三种拼写都能触发（`@styleLoaded.once` 与 `@style_loaded.once`）", async () => {
    const camelOnce = vi.fn();
    const snakeOnce = vi.fn();
    const { wrapper } = await mountControlledMap(() => ({
      provider: harness.provider(),
      // `@styleLoaded.once` → onStyleLoadedOnce；`@style_loaded.once` → onStyle_loadedOnce
      onStyleLoadedOnce: camelOnce,
      onStyle_loadedOnce: snakeOnce,
    }));

    // 两个键对应同一条目（canonical + SDK 别名），因此一次订阅覆盖两者
    expect(harness.subscribedEvents()).toContain("style_loaded");
    harness.dispatch("style_loaded");
    expect(camelOnce, "camelCase 拼写").toHaveBeenCalledTimes(1);
    expect(snakeOnce, "SDK 下划线拼写").toHaveBeenCalledTimes(1);

    await unmountAndSettle(wrapper);
    harness.assertIdle("map 事件：别名 + once");
  });

  it("`@load` 在正常生命周期下能收到（订阅发生在 initializeView 之前）", async () => {
    const load = vi.fn();
    const { wrapper } = await mountControlledMap(() => ({
      provider: harness.provider(),
      center: { ...POSITION },
      zoom: 12,
      onLoad: load,
    }));

    // 官方 `load` 在首次 centerAndZoom 之后派发，那时组件还没 ready ⇒ 只有把订阅前移才收得到
    expect(load, "load 必须真的到达父级").toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]![0]).toMatchObject({ type: "load", zoom: 12 });

    await unmountAndSettle(wrapper);
    harness.assertIdle("map 事件：load");
  });

  it("`@destroy` 在地图销毁时收到（Driver 在摘订阅之前合成派发）", async () => {
    const destroy = vi.fn();
    const { wrapper } = await mountControlledMap(() => ({
      provider: harness.provider(),
      onDestroy: destroy,
    }));
    expect(harness.subscribedEvents()).toContain("destroy");

    await unmountAndSettle(wrapper);

    expect(destroy, "组件卸载会销毁地图 ⇒ destroy 必须到达订阅者").toHaveBeenCalledTimes(1);
    expect(destroy.mock.calls[0]![0]).toMatchObject({ type: "destroy" });
    harness.assertIdle("map 事件：destroy");
  });

  it("卸载后 map 事件订阅全部释放，ResourceScope 账本归零（不留失效闭包）", async () => {
    let scopeSize = (): number => -1;
    const ScopeProbe = defineComponent({
      setup() {
        const ctx = useRequiredMapContext();
        scopeSize = () => ctx.resources.size;
        return () => h("span", "scope-probe");
      },
    });

    const { wrapper } = await mountControlledMap(() => ({ provider: harness.provider() }), {
      children: () => [h(ScopeProbe)],
    });
    const withSubscriptions = scopeSize();
    expect(withSubscriptions, "订阅已登记进 scope").toBeGreaterThan(0);
    expect(harness.subscribedEvents().length, "Catalog 里的事件都订上了").toBeGreaterThan(40);

    await unmountAndSettle(wrapper);
    expect(scopeSize(), "卸载后 scope 记账归零").toBe(0);
    harness.assertIdle("map 事件：scope 记账");
  });

  it("Map Context 下的 useMapEvent 也能收到 load / destroy（与 <BMap @...> 同一可观察集合）", async () => {
    const loadSpy = vi.fn();
    const destroySpy = vi.fn();
    const LifecycleProbe = defineComponent({
      setup() {
        useMapEvent("load", loadSpy);
        useMapEvent("destroy", destroySpy);
        return () => h("span", "lifecycle-probe");
      },
    });

    const { wrapper } = await mountControlledMap(() => controlledViewProps(), {
      children: () => [h(LifecycleProbe)],
    });

    expect(loadSpy, "load 在 initializeView 之后派发 —— 订阅必须在那之前建立").toHaveBeenCalledTimes(1);
    expect(loadSpy.mock.calls[0]![0]).toMatchObject({ type: "load" });
    expect(destroySpy).not.toHaveBeenCalled();

    await unmountAndSettle(wrapper);

    expect(
      destroySpy,
      "destroy 在 runtime.dispose() 里合成派发，而子组件的作用域先于它停止 —— 订阅必须活到那一刻",
    ).toHaveBeenCalledTimes(1);
    expect(destroySpy.mock.calls[0]![0]).toMatchObject({ type: "destroy" });
    harness.assertIdle("useMapEvent：生命周期事件");
  });

  it("destroy 订阅只在整图 teardown 时延长寿命：子组件自行卸载后回到基线、也不残留回调", async () => {
    const spies: Array<ReturnType<typeof vi.fn>> = [];
    let scopeSize = (): number => -1;
    const ScopeProbe = defineComponent({
      setup() {
        const ctx = useRequiredMapContext();
        scopeSize = () => ctx.resources.size;
        return () => h("span", "scope-probe");
      },
    });
    const DestroyProbe = defineComponent({
      setup() {
        const spy = vi.fn();
        spies.push(spy);
        useMapEvent("destroy", spy);
        return () => h("span", "destroy-probe");
      },
    });

    const props = ref<Record<string, unknown>>({ provider: harness.provider(), show: false });
    const { wrapper } = await mountControlledMap(() => props.value, {
      children: () => [h(ScopeProbe), props.value.show ? h(DestroyProbe) : null],
    });
    const baseline = scopeSize();

    // 条件渲染 / Tab 场景：图还活着，子组件反复挂载卸载
    for (let round = 0; round < 3; round += 1) {
      props.value = { ...props.value, show: true };
      await settleProps();
      props.value = { ...props.value, show: false };
      await settleProps();
      expect(scopeSize(), `第 ${round + 1} 轮卸载后资源计数回到基线`).toBe(baseline);
    }
    expect(spies).toHaveLength(3);

    // 最后再挂一个，然后卸载整棵树：只有**当前还活着**的那个收到 destroy
    props.value = { ...props.value, show: true };
    await settleProps();
    const liveSpy = spies[3]!;
    await unmountAndSettle(wrapper);

    expect(liveSpy, "整图 teardown 时仍活着的订阅必须收到 destroy").toHaveBeenCalledTimes(1);
    for (const [index, spy] of spies.slice(0, 3).entries()) {
      expect(spy, `第 ${index + 1} 个已卸载组件的 handler 不得被回调`).not.toHaveBeenCalled();
    }
    harness.assertIdle("useMapEvent：destroy 订阅寿命");
  });

  it("显式 source 的 useMapEvent 在组件提前卸载后不再收到 destroy（订阅归调用方）", async () => {
    const destroySpy = vi.fn();
    let stop: (() => void) | null = null;
    let childScopeStopped = false;
    const ExplicitProbe = defineComponent({
      setup() {
        const mapContext = useRequiredMapContext();
        stop = useMapEvent("destroy", destroySpy, {
          source: { map: mapContext.map, client: mapContext.client },
        });
        return () => h("span", "explicit-probe");
      },
    });
    // 父级在子组件卸载后单独把地图销毁（模拟「订阅归调用方」的语义）
    const props = ref<Record<string, unknown>>({ provider: harness.provider(), show: true });
    const Tree = defineComponent({
      setup: () => () =>
        h(BMap, props.value as never, {
          default: () => (props.value.show ? [h(ExplicitProbe)] : []),
        }),
    });
    const wrapper = mount(Tree, { attachTo: harness.container() });
    await flushPromises();
    await nextTick();

    props.value = { ...props.value, show: false };
    await settleProps();
    childScopeStopped = stop !== null;
    expect(childScopeStopped).toBe(true);
    // 子组件已卸载：显式 source 的订阅随作用域释放 ⇒ 不再收到 destroy
    await unmountAndSettle(wrapper);
    expect(destroySpy).not.toHaveBeenCalled();
    harness.assertIdle("useMapEvent：显式 source 的 destroy");
  });

  it("首次 initializeView 失败后 retry：第二张地图的 load 仍能收到", async () => {
    const loadSpy = vi.fn();
    const LoadProbe = defineComponent({
      setup() {
        useMapEvent("load", loadSpy);
        return () => h("span", "load-probe");
      },
    });

    // 故障注入：第一次初始化视野失败（句柄已创建 ⇒ whenMapCreated 已经放过一次）
    harness.failNextInitializeView();
    const { wrapper, bmap } = await mountControlledMap(() => controlledViewProps({ heading: 30 }), {
      children: () => [h(LoadProbe)],
    });
    // 建图成功但初始化失败：状态是 error、组件如实 emit error（`boot()` 的 rejection 被 onMounted 吞掉，
    // 因此这里断言的是状态与回执，而不是 errorHandler）
    expect((bmap.vm as unknown as { status: string }).status, "第一次初始化失败 ⇒ error").toBe("error");
    expect(bmap.emitted("error"), "失败要如实回执").toHaveLength(1);
    expect(loadSpy, "失败的那次没有 load").not.toHaveBeenCalled();
    expect(harness.mapsCreated(), "第一张地图确实创建过").toBeGreaterThan(0);

    // retry：第二张地图走同一条 create → initializeView 路径
    await (bmap.vm as unknown as { retry(): Promise<unknown> }).retry();
    await flushPromises();
    await nextTick();

    expect(loadSpy, "retry 之后 load 仍必须到达（whenMapCreated 不能在建图后就注销）").toHaveBeenCalledTimes(1);
    await unmountAndSettle(wrapper);
    harness.assertIdle("useMapEvent：retry 后的 load");
  });

  it("useMapStatus：Map Context 下的只读 refs 跟随用户交互，卸载后监听器归零", async () => {
    let seen: ReturnType<typeof useMapStatus> | null = null;
    const StatusProbe = defineComponent({
      setup() {
        seen = useMapStatus();
        return () => h("span", "status-probe");
      },
    });

    const { wrapper } = await mountControlledMap(() => controlledViewProps(), {
      children: () => [h(StatusProbe)],
    });
    const status = seen!;
    expect(status.center.value, "就绪即给值").toEqual({ lng: POSITION.lng, lat: POSITION.lat });

    const before = status.center.value;
    harness.simulateUserView({ center: { lng: 118, lat: 41 }, zoom: 15 });
    expect(status.center.value).toEqual({ lng: 118, lat: 41 });
    expect(status.zoom.value).toBe(15);

    // 同样的值再来一次：引用不变（不产生无意义更新）
    harness.simulateUserView({ center: { lng: 118, lat: 41 }, zoom: 15 });
    expect(status.center.value).not.toBe(before);
    const after = status.center.value;
    harness.simulateUserView({ center: { lng: 118, lat: 41 }, zoom: 15 });
    expect(status.center.value).toBe(after);

    await unmountAndSettle(wrapper);
    expect(harness.listenActivity().pending).toBe(0);
    harness.assertIdle("useMapStatus");
  });
});

/**
 * MapHandle / 容器门禁 / 可见性策略（M4-HANDLE-UX / issue #29）
 *
 * 用例只写**领域语言**：`expose` 的命令、`harness.mapsCreated()`（建了几张图）、
 * `harness.checkResizeCalls()`（下发了几次尺寸校正）、`harness.view()`（视野读数），
 * 以及替身层的环境信号（`shims.*`）。字段名、观察器实现与合帧细节都不在这层。
 *
 * 三个替身口径先说清：
 * - `shims.resize(el, size)`：布局把这元素算成这个尺寸**并**派发一次 resize 回调；
 * - `shims.notifyResize(el)`：只派发回调（尺寸由替身的盒模型自己算，用来测「真实 DOM 读数」）；
 * - `shims.setDocumentHidden()` / `setReducedMotion()` / `intersect()`：环境信号。
 */
describe("MapHandle / 容器门禁 / 可见性策略（M4-HANDLE-UX / #29）", () => {
  /**
   * expose 的读法：直接按**真实契约** `BMapExpose` 断言（不再手写一份子集 —— 手写的那份
   * 既会漂移，也挡不住「实现少了一个成员」；逐成员的类型契约由 `fixtures/v3-consumer` 锁）。
   */
  const shims = browserShims();
  let frames: ReturnType<typeof createManualFrames> | null = null;

  /** 装一个手动帧队列：`FrameScheduler` 在**创建时**读全局 RAF，因此必须在挂载之前装。 */
  function useManualFrames() {
    frames = createManualFrames();
    frames.install();
    return frames;
  }

  afterEach(() => {
    frames?.restore();
    frames = null;
  });

  const exposeOf = (bmap: { vm: unknown }): BMapExpose => bmap.vm as unknown as BMapExpose;
  const statusOf = (bmap: { vm: unknown }): string => (bmap.vm as { status: string }).status;

  it("expose 的常用命令真的读写 SDK（get / set / supports）", async () => {
    const { wrapper, bmap } = await mountControlledMap(controlledViewProps);
    const api = exposeOf(bmap);

    expect(api.isContainerReady(), "容器一开始就有尺寸 ⇒ 门禁已放行").toBe(true);
    expect(api.getCenter()).toEqual(POSITION);
    expect(api.getZoom()).toBe(12);
    expect(api.getBounds(), "读命令在就绪后给得出值").toBeTruthy();
    expect(api.getSize(), "读命令在就绪后给得出值").toBeTruthy();
    expect(api.supports("map.zoom"), "能力查询走 Capability Registry").toBe(true);
    expect(api.getMapInstance(), "raw 逃生口只拿到句柄，raw 对象要经 ./advanced").toBeTruthy();

    api.setCenter({ lng: 121.5, lat: 31.2 });
    api.setZoom(15);
    expect(harness.view()).toMatchObject({ center: { lng: 121.5, lat: 31.2 }, zoom: 15 });
    expect(harness.viewWrites(), "命令各自只下发一次").toMatchObject({ setCenter: 1, setZoom: 1 });

    await unmountAndSettle(wrapper);
    harness.assertIdle("expose 常用命令");
  });

  it("未就绪时读命令给 null、写命令是空操作（不排队、不猜）", async () => {
    const { wrapper, bmap } = await mountControlledMap(() => ({
      provider: harness.deferredProvider(),
      center: { ...POSITION },
      zoom: 12,
    }));
    expect(statusOf(bmap), "SDK 还在加载").not.toBe("ready");

    const api = exposeOf(bmap);
    expect(api.getCenter()).toBeNull();
    expect(api.getZoom()).toBeNull();
    expect(api.supports("map.zoom")).toBe(false);
    api.setCenter({ lng: 1, lat: 1 });
    api.setZoom(3);
    expect(harness.mapsCreated(), "没有句柄时写命令不下发、也不建图").toBe(0);

    harness.releaseProvider();
    await settleProps();
    expect(statusOf(bmap)).toBe("ready");
    expect(api.getCenter(), "就绪后读到的仍是受控值，没有被未就绪时的写入污染").toEqual(POSITION);

    await unmountAndSettle(wrapper);
    harness.assertIdle("expose 未就绪");
  });

  it("expose 不再有 resetCenter，resetView 仍在", async () => {
    const { wrapper, bmap } = await mountControlledMap(controlledViewProps);
    const vm = bmap.vm as unknown as Record<string, unknown>;
    // 验收：`BMapExpose` 不包含错误的 `resetCenter()` 实现（名字说重置中心、实现重置整个视野）
    expect(vm.resetCenter, "废弃别名必须被移除").toBeUndefined();
    expect(typeof vm.resetView).toBe("function");

    harness.simulateUserView({ center: { lng: 100, lat: 30 }, zoom: 8 });
    expect(harness.view()).toMatchObject({ center: { lng: 100, lat: 30 }, zoom: 8 });
    exposeOf(bmap).resetView();
    expect(harness.view(), "resetView 回到首次快照").toMatchObject({ center: POSITION, zoom: 12 });

    await unmountAndSettle(wrapper);
    harness.assertIdle("expose resetView");
  });

  it("容器零尺寸（width/height=0）不建图；拿到非零尺寸后只建一张，后续变化走 checkResize", async () => {
    useManualFrames();
    const { wrapper, bmap } = await mountControlledMap(() => ({
      ...controlledViewProps(),
      width: "0px",
      height: "0px",
    }));
    const api = exposeOf(bmap);
    const root = bmap.element as HTMLElement;

    expect(api.isContainerReady(), "零尺寸 ⇒ 门禁未放行").toBe(false);
    expect(statusOf(bmap), "刻意停在 idle（没有进入加载流程）").toBe("idle");
    expect(harness.mapsCreated(), "零尺寸下不得创建地图").toBe(0);

    // Tab / Drawer 展开：容器拿到非零尺寸
    shims.resize(root, { width: 320, height: 240 });
    await settleProps();
    expect(api.isContainerReady()).toBe(true);
    expect(statusOf(bmap)).toBe("ready");
    expect(harness.mapsCreated(), "放行后只建一张").toBe(1);

    // 同一帧内连续三次尺寸变化：合帧 ⇒ 一次 checkResize
    frames!.flush();
    shims.resize(root, { width: 400, height: 240 });
    shims.resize(root, { width: 420, height: 260 });
    shims.resize(root, { width: 440, height: 300 });
    expect(harness.checkResizeCalls(), "还没到帧边界时不下发").toBe(0);
    frames!.flush();
    expect(harness.checkResizeCalls(), "合帧：一帧最多一次").toBe(1);
    expect(harness.mapsCreated(), "尺寸变化不重建地图").toBe(1);

    await unmountAndSettle(wrapper);
    harness.assertIdle("容器门禁");
  });

  it("祖先 display:none（未展开）不建图；展开后按真实读数放行", async () => {
    const host = document.createElement("div");
    host.style.display = "none";
    document.body.appendChild(host);

    const { wrapper, bmap } = await mountControlledMap(controlledViewProps, { attachTo: host });
    expect(exposeOf(bmap).isContainerReady()).toBe(false);
    expect(harness.mapsCreated()).toBe(0);

    host.style.display = "block";
    // 只派发回调：尺寸由读数自己算（不写任何显式尺寸覆盖），因此这条用例证明的是
    // 「组件读的是标准 DOM 测量」而不是「夹具喂了一个数字」。
    shims.notifyResize(bmap.element as HTMLElement);
    await settleProps();
    expect(exposeOf(bmap).isContainerReady()).toBe(true);
    expect(harness.mapsCreated()).toBe(1);

    await unmountAndSettle(wrapper);
    harness.assertIdle("容器门禁（display:none）");
  });

  it("enableAutoResize=false 时不自动 checkResize，手动入口仍然有效", async () => {
    useManualFrames();
    const { wrapper, bmap } = await mountControlledMap(() => ({
      ...controlledViewProps(),
      enableAutoResize: false,
    }));
    const root = bmap.element as HTMLElement;
    frames!.flush();

    shims.resize(root, { width: 400, height: 300 });
    frames!.flush();
    expect(harness.checkResizeCalls(), "关闭自动重设 ⇒ 容器变化不下发").toBe(0);

    exposeOf(bmap).checkResize();
    expect(harness.checkResizeCalls(), "手动入口与自动路径同口径").toBe(1);

    await unmountAndSettle(wrapper);
    harness.assertIdle("enableAutoResize");
  });

  it("页面前后台暂停：恢复可见只移除 document，不误恢复用户手动暂停", async () => {
    const { wrapper, bmap } = await mountControlledMap(controlledViewProps);
    const api = exposeOf(bmap);

    shims.setDocumentHidden(true);
    expect(api.isSuspended()).toBe(true);
    expect(api.suspendReasons()).toEqual(["document"]);

    api.suspend();
    expect(api.suspendReasons().sort()).toEqual(["document", "user"]);

    shims.setDocumentHidden(false);
    expect(api.isSuspended(), "用户的手动暂停必须活着").toBe(true);
    expect(api.suspendReasons()).toEqual(["user"]);
    expect(harness.checkResizeCalls(), "还在暂停中 ⇒ 不补偿 resize").toBe(0);

    api.resume();
    expect(api.isSuspended()).toBe(false);
    expect(harness.checkResizeCalls(), "全部原因清空 ⇒ 补偿一次").toBe(1);

    await unmountAndSettle(wrapper);
    harness.assertIdle("页面前后台暂停");
  });

  it("暂停期间容器变化不下发 checkResize、也不排帧；恢复时补一次", async () => {
    useManualFrames();
    const { wrapper, bmap } = await mountControlledMap(controlledViewProps);
    const root = bmap.element as HTMLElement;
    frames!.flush();
    const before = harness.checkResizeCalls();

    shims.setDocumentHidden(true);
    shims.resize(root, { width: 400, height: 300 });
    frames!.flush();
    expect(harness.checkResizeCalls(), "后台期间不下发 SDk 命令").toBe(before);
    expect(frames!.pending(), "后台期间不占帧").toBe(0);

    shims.setDocumentHidden(false);
    expect(harness.checkResizeCalls(), "回到前台补一次").toBe(before + 1);

    await unmountAndSettle(wrapper);
    harness.assertIdle("暂停期间的容器变化");
  });

  it("离开视口暂停、回到视口恢复，且不销毁地图", async () => {
    const { wrapper, bmap } = await mountControlledMap(controlledViewProps);
    const api = exposeOf(bmap);
    const root = bmap.element as HTMLElement;

    shims.intersect(root, false);
    expect(api.suspendReasons()).toEqual(["offscreen"]);
    expect(harness.mapsCreated(), "离开视口不销毁 WebGL 地图（issue 非目标）").toBe(1);

    shims.intersect(root, true);
    expect(api.isSuspended()).toBe(false);
    expect(harness.checkResizeCalls(), "回到视口补一次").toBe(1);

    await unmountAndSettle(wrapper);
    harness.assertIdle("offscreen 暂停");
  });

  it("减少动画偏好变化不暂停地图、也不误停必要任务", async () => {
    useManualFrames();
    const { wrapper, bmap } = await mountControlledMap(controlledViewProps);
    const api = exposeOf(bmap);

    expect(api.prefersReducedMotion()).toBe(false);
    shims.setReducedMotion(true);
    expect(api.prefersReducedMotion(), "偏好如实透出（供可选动画读）").toBe(true);
    expect(api.isSuspended(), "它不是暂停原因").toBe(false);
    expect(api.suspendReasons()).toEqual([]);

    frames!.flush();
    shims.resize(bmap.element as HTMLElement, { width: 500, height: 320 });
    frames!.flush();
    expect(harness.checkResizeCalls(), "必要任务照常进行").toBe(1);

    await unmountAndSettle(wrapper);
    harness.assertIdle("reduced motion");
  });

  it("卸载后不再调 SDK：观察器被 disconnect，迟到的尺寸变化不产生任何调用", async () => {
    const { wrapper, bmap } = await mountControlledMap(controlledViewProps);
    const root = bmap.element as HTMLElement;
    const before = harness.checkResizeCalls();

    await unmountAndSettle(wrapper);
    const afterUnmount = shims.diagnostics();
    expect(afterUnmount.resizeObservers, "观察器必须被释放").toBe(0);
    expect(afterUnmount.intersectionObservers, "视口观察器必须被释放").toBe(0);
    expect(afterUnmount.resizeDisconnects, "释放路径真的调用了 disconnect").toBeGreaterThan(0);

    shims.resize(root, { width: 100, height: 100 });
    expect(harness.checkResizeCalls(), "disposed 之后不再调 SDK").toBe(before);
    harness.assertIdle("卸载后的容器变化");
  });

  it("两张地图不串状态：各自的容器变化只影响自己", async () => {
    useManualFrames();
    const hostA = harness.container();
    const hostB = harness.container();
    const wrapperA = mount(BMap, { attachTo: hostA, props: { provider: harness.provider() } });
    const wrapperB = mount(BMap, { attachTo: hostB, props: { provider: harness.provider() } });
    await settleProps();

    expect(harness.mapsCreated()).toBe(2);
    frames!.flush();

    shims.resize(wrapperA.element as HTMLElement, { width: 500, height: 400 });
    frames!.flush();
    expect(harness.checkResizeCalls(-2), "A 自己的变化只下发给自己").toBe(1);
    expect(harness.checkResizeCalls(-1), "B 不受影响").toBe(0);

    await unmountAndSettle(wrapperA);
    await unmountAndSettle(wrapperB);
    harness.assertIdle("多地图容器策略");
  });

  it("状态插槽：error 插槽拿到结构化错误与重试入口，retry 成功且幂等（成功后 error 归 null）", async () => {
    harness.failNextInitializeView();
    const seen: Array<Record<string, unknown>> = [];
    const defaultSeen: Array<Record<string, unknown>> = [];
    const Root = defineComponent({
      setup: () => () =>
        h(BMap, { provider: harness.provider(), center: { ...POSITION }, zoom: 12 }, {
          error: (props: Record<string, unknown>) => {
            seen.push(props);
            return h("button", { class: "retry-slot" }, "retry");
          },
          // 默认插槽也接一下载荷：它是「重试成功后 error 是否归 null」最直接的观察口
          default: (props: Record<string, unknown>) => {
            defaultSeen.push(props);
            return h("span", "slot-probe");
          },
        }),
    });
    const wrapper = mount(Root, { attachTo: harness.container() });
    await settleProps();
    const bmap = wrapper.findComponent(BMap);

    expect(statusOf(bmap)).toBe("error");
    expect(bmap.emitted("error"), "结构化错误经 `error` 事件上报").toHaveLength(1);
    const errorProps = seen.at(-1)!;
    expect(errorProps.status).toBe("error");
    expect(errorProps.error).toBeTruthy();
    expect(typeof errorProps.retry, "插槽直接给重试入口，不需要业务监听 Runtime").toBe("function");
    expect(wrapper.find(".retry-slot").exists()).toBe(true);

    // retry 成功：第二张地图建起来
    await (errorProps.retry as () => Promise<unknown>)();
    await settleProps();
    expect(statusOf(bmap)).toBe("ready");
    expect(harness.mapsCreated()).toBe(2);
    // 评审 blocking：重试成功之后 `error` 必须归 null。只断言「错误文案消失」锁不住它 ——
    // 默认文案的 `v-if` 只看 `status`，旧的 error 会一直挂到下一次失败、从别的出口漏出去
    // （默认插槽载荷 / `#loading` 与 `#error` 的 slotProps / `MapContext.error`）。
    expect(
      defaultSeen.at(-1)!.error,
      "retry 成功之后旧的 error 必须被清掉（否则四个出口都还在显示已经过去的那次失败）",
    ).toBeNull();

    // 已经 ready 时再 retry：不重复建图、也不重复广播 ready
    const readyCount = bmap.emitted("ready")?.length ?? 0;
    await exposeOf(bmap).retry();
    await settleProps();
    expect(harness.mapsCreated(), "多次 retry 幂等").toBe(2);
    expect(bmap.emitted("ready")?.length ?? 0).toBe(readyCount);

    await unmountAndSettle(wrapper);
    harness.assertIdle("状态插槽 retry");
  });

  it("状态插槽：容器零尺寸时 loading 插槽的 containerReady=false，且给的是同一份载荷", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const Root = defineComponent({
      setup: () => () =>
        h(BMap, { provider: harness.provider(), width: "0px", height: "0px" }, {
          loading: (props: Record<string, unknown>) => {
            seen.push(props);
            return h("span", { class: "loading-slot" }, "custom-loading");
          },
        }),
    });
    const wrapper = mount(Root, { attachTo: harness.container() });
    await settleProps();

    expect(wrapper.find(".loading-slot").exists()).toBe(true);
    const loadingProps = seen.at(-1)!;
    expect(loadingProps.containerReady, "业务据此区分「容器还没展开」与「SDK 在加载」").toBe(false);
    expect(loadingProps.status).toBe("idle");
    expect(typeof loadingProps.retry).toBe("function");
    expect(harness.mapsCreated()).toBe(0);

    await unmountAndSettle(wrapper);
    harness.assertIdle("loading 插槽");
  });

  it("不给插槽时的默认状态文案与重试按钮（容器零尺寸 / 错误两条路径）", async () => {
    // ① 容器零尺寸：默认文案必须是「等尺寸」而不是「加载中」，否则业务没法区分
    const zero = mount(
      defineComponent({
        setup: () => () =>
          h(BMap as never, { provider: harness.provider(), width: "0px", height: "0px" }),
      }),
      { attachTo: harness.container() },
    );
    await settleProps();
    expect(zero.text(), "零尺寸时给的是等尺寸的默认文案").toContain("waiting for container size");
    await unmountAndSettle(zero);

    // ② 错误态：默认文案 + 一个可点的重试按钮（覆盖 `#error` 插槽即可完全接管）
    harness.failNextInitializeView();
    const failed = mount(
      defineComponent({
        setup: () => () => h(BMap as never, { provider: harness.provider() }),
      }),
      { attachTo: harness.container() },
    );
    await settleProps();
    expect(failed.text()).toContain("map error");
    const button = failed.find("button");
    expect(button.exists(), "默认错误文案自带重试入口").toBe(true);
    // 点一下：默认按钮走的是 expose 的 retry（失败态下重新建图）
    const before = harness.mapsCreated();
    await button.trigger("click");
    await settleProps();
    expect(harness.mapsCreated(), "默认按钮真的重试了（不是装饰）").toBeGreaterThan(before);

    await unmountAndSettle(failed);
    harness.assertIdle("默认状态文案");
  });

  it("默认插槽的既有载荷不变（status / map / error / client）", async () => {
    let slotProps: Record<string, unknown> | null = null;
    const Root = defineComponent({
      setup: () => () =>
        h(BMap, { provider: harness.provider() }, {
          default: (props: Record<string, unknown>) => {
            slotProps = props;
            return h("span", "child");
          },
        }),
    });
    const wrapper = mount(Root, { attachTo: harness.container() });
    await settleProps();
    await nextTick();

    expect(Object.keys(slotProps!).sort()).toEqual(["client", "error", "map", "status"]);
    expect(slotProps!.status).toBe("ready");
    // 不只比键名：就绪时这三个字段得真的有值（否则「载荷不变」这条断言可能只是「键还在」）
    expect(slotProps!.map, "就绪时载荷里必须真的有句柄").toBeTruthy();
    expect(slotProps!.client, "就绪时载荷里必须真的有 client").toBeTruthy();
    expect(slotProps!.error, "就绪时不该有错误").toBeNull();

    await unmountAndSettle(wrapper);
    harness.assertIdle("默认插槽载荷");
  });

  /**
   * 挂一棵 `<KeepAlive>` + `<BMap>`，返回控制「是否挂载」的开关。
   *
   * KeepAlive 的语义正是评审 P1-2 那条路径：`show=false` 让 `<BMap>` **deactivate** 而组件
   * 仍在 cache 里（不发生 `onUnmounted`），此时只有 `runtime.dispose()` 会跑
   * （`keepAliveBehavior="dispose"` 下）。
   */
  async function mountKeepAliveTree(behavior: "suspend" | "dispose") {
    const show = ref(true);
    const Root = defineComponent({
      setup: () => () =>
        h(
          KeepAlive,
          null,
          {
            default: () =>
              show.value
                ? h(BMap, { provider: harness.provider(), keepAliveBehavior: behavior })
                : null,
          } as never,
        ),
    });
    const wrapper = mount(Root, { attachTo: harness.container() });
    await settleProps();
    await nextTick();
    return { wrapper, show, bmap: wrapper.findComponent(BMap) };
  }

  it("KeepAlive + keepAliveBehavior=dispose：停用即释放观察器（评审 P1）", async () => {
    const { wrapper, show } = await mountKeepAliveTree("dispose");
    expect(shims.diagnostics().resizeObservers, "挂载后观察器确实在观察").toBeGreaterThan(0);

    show.value = false; // onDeactivated → runtime.dispose()（组件仍在 KeepAlive cache 里）
    await settleProps();
    await nextTick();

    expect(
      shims.diagnostics().resizeObservers,
      "runtime dispose 必须一并释放尺寸观察器（不能只等 onUnmounted）",
    ).toBe(0);
    expect(shims.diagnostics().intersectionObservers, "视口观察器同样释放").toBe(0);

    await unmountAndSettle(wrapper);
    harness.assertIdle("KeepAlive dispose");
  });

  it("KeepAlive + 默认 suspend：停用**不**释放观察器（地图没销毁，回来还要用）", async () => {
    const { wrapper, show } = await mountKeepAliveTree("suspend");
    const before = shims.diagnostics().resizeObservers;
    expect(before).toBeGreaterThan(0);

    show.value = false; // 只 suspend：不销毁地图 ⇒ 资源照旧
    await settleProps();
    await nextTick();

    expect(
      shims.diagnostics().resizeObservers,
      "suspend 只暂停，不释放（与 dispose 的分工要在读数上分得开）",
    ).toBe(before);

    await unmountAndSettle(wrapper);
    harness.assertIdle("KeepAlive suspend");
  });

  it("KeepAlive 激活：补偿**恰好一次** checkResize（评审 P2）", async () => {
    useManualFrames();
    const { wrapper, show } = await mountKeepAliveTree("suspend");
    frames!.flush();
    const before = harness.checkResizeCalls();

    show.value = false;
    await settleProps();
    await nextTick();
    show.value = true; // onActivated → resume（Runtime 内部补偿一次）
    await settleProps();
    await nextTick();
    frames!.flush();

    expect(
      harness.checkResizeCalls(),
      "一次激活 = 一条 resize 命令（组件层不再自己调 checkResize）",
    ).toBe(before + 1);

    await unmountAndSettle(wrapper);
    harness.assertIdle("KeepAlive 激活");
  });

  // 注：「容器收起期间的 retry」原本是一条独立用例，但它用 `await retry().catch(() => {})`
  // 掩盖了「这个 Promise 其实立刻以旧 error 拒绝了」这件事（#29 复审 P1）。现在由下面那条
  // 「Promise 保持 pending → 容器恢复后同一 Promise resolve」覆盖同一个场景，且断言更强。

  it("ready 的地图在容器 0×0 → 非零恢复后必须重设尺寸（复审 P1）", async () => {
    useManualFrames();
    const { wrapper, bmap } = await mountControlledMap(controlledViewProps);
    const root = bmap.element as HTMLElement;
    frames!.flush();
    const before = harness.checkResizeCalls();

    // Tab / Drawer 收起再展开：地图不销毁（ADR 决策 4），但恢复尺寸后必须补一次 checkResize
    shims.resize(root, { width: 0, height: 0 });
    frames!.flush();
    shims.resize(root, { width: 320, height: 240 });
    frames!.flush();

    expect(
      harness.checkResizeCalls(),
      "0×0 → 非零恢复：已就绪的地图必须收到一次 checkResize（文档承诺的「恢复尺寸后纠正」）",
    ).toBe(before + 1);
    expect(harness.mapsCreated(), "恢复尺寸不重建地图").toBe(1);

    await unmountAndSettle(wrapper);
    harness.assertIdle("ready 恢复尺寸");
  });

  it("enableAutoResize=false 时容器 0×0 → 非零恢复不下发 checkResize（复审 P1）", async () => {
    useManualFrames();
    const { wrapper, bmap } = await mountControlledMap(() => ({
      ...controlledViewProps(),
      enableAutoResize: false,
    }));
    const root = bmap.element as HTMLElement;
    frames!.flush();
    const before = harness.checkResizeCalls();

    shims.resize(root, { width: 0, height: 0 });
    frames!.flush();
    shims.resize(root, { width: 320, height: 240 });
    frames!.flush();

    expect(harness.checkResizeCalls(), "关闭自动重设 ⇒ 恢复尺寸也不下发").toBe(before);

    await unmountAndSettle(wrapper);
    harness.assertIdle("enableAutoResize=false 恢复尺寸");
  });

  it("容器收起时 retry 的 Promise 保持 pending，容器恢复并真正就绪后才 resolve（复审 P1）", async () => {
    useManualFrames();
    harness.failNextInitializeView();
    const { wrapper, bmap } = await mountControlledMap(controlledViewProps);
    const api = exposeOf(bmap);
    const root = bmap.element as HTMLElement;
    expect(statusOf(bmap)).toBe("error");
    const created = harness.mapsCreated();

    // 收起 → retry：这次请求不能立刻以「旧的 error」拒绝（那会表达成「重试已经失败了」）
    shims.resize(root, { width: 0, height: 0 });
    frames!.flush();
    let settled: "pending" | "resolved" | "rejected" = "pending";
    const pending = api.retry();
    void pending.then(
      () => {
        settled = "resolved";
      },
      () => {
        settled = "rejected";
      },
    );
    await settleProps();
    await nextTick();
    expect(
      settled,
      "容器收起时 retry 应返回 pending 的 Promise（等这次延迟重试的结果），而不是立刻 reject",
    ).toBe("pending");
    expect(harness.mapsCreated(), "pending 期间不建图").toBe(created);

    // 展开 → 延迟的那次重试真正执行 → 同一个 Promise resolve
    shims.resize(root, { width: 320, height: 240 });
    frames!.flush();
    await expect(pending, "同一个 Promise 必须随延迟重试成功而 resolve").resolves.toBeTruthy();
    expect(statusOf(bmap)).toBe("ready");
    expect(harness.mapsCreated(), "延迟重试只建一张图").toBe(created + 1);

    await unmountAndSettle(wrapper);
    harness.assertIdle("延迟 retry 的 Promise");
  });

  it("并发 retry 共享同一次 boot：ready / initd 只广播一次（复审 P2）", async () => {
    harness.failNextInitializeView();
    const { wrapper, bmap } = await mountControlledMap(controlledViewProps);
    const api = exposeOf(bmap);
    expect(statusOf(bmap)).toBe("error");
    const created = harness.mapsCreated();
    const readyBefore = bmap.emitted("ready")?.length ?? 0;
    const initdBefore = bmap.emitted("initd")?.length ?? 0;

    await Promise.all([api.retry(), api.retry()]);
    await settleProps();
    await nextTick();

    expect(harness.mapsCreated(), "并发 retry 只建一张图").toBe(created + 1);
    expect(bmap.emitted("ready")?.length ?? 0, "并发 retry 只广播一次 ready").toBe(readyBefore + 1);
    expect(bmap.emitted("initd")?.length ?? 0, "并发 retry 只广播一次 initd").toBe(initdBefore + 1);

    await unmountAndSettle(wrapper);
    harness.assertIdle("并发 retry");
  });

  it("KeepAlive(dispose) 停用会终止挂起的 retry（复审 P1）", async () => {
    harness.failNextInitializeView();
    const { wrapper, show, bmap } = await mountKeepAliveTree("dispose");
    await settleProps();
    await nextTick();
    const api = exposeOf(bmap);
    expect(statusOf(bmap)).toBe("error");
    const created = harness.mapsCreated();

    // 容器收起 → retry 挂起（pending，不建图）
    shims.resize(bmap.element as HTMLElement, { width: 0, height: 0 });
    let settled: "pending" | "resolved" | "rejected" = "pending";
    let reason: unknown = null;
    const pending = api.retry();
    void pending.then(
      () => {
        settled = "resolved";
      },
      (error) => {
        settled = "rejected";
        reason = error;
      },
    );
    await settleProps();
    expect(settled, "容器不可用 ⇒ 挂起").toBe("pending");

    // KeepAlive 停用 + keepAliveBehavior="dispose" ⇒ runtime.dispose()（**不**触发 onUnmounted）
    show.value = false;
    await settleProps();
    await nextTick();

    expect(settled, "Runtime dispose 必须终止挂起的 retry（不能永久 pending）").toBe("rejected");
    expect((reason as { code?: string } | null)?.code).toBe("BMAP_RUNTIME_DISPOSED");
    expect(harness.mapsCreated(), "停用期间不建图").toBe(created);

    // 已经 disposed：再 retry 必须**立刻**以终态错误拒绝，而不是塞一个永远不会被唤醒的等待者
    await expect(api.retry()).rejects.toMatchObject({ code: "BMAP_RUNTIME_DISPOSED" });

    await unmountAndSettle(wrapper);
    harness.assertIdle("KeepAlive dispose 终止挂起 retry");
  });

  it("SDK 加载期间容器被收起：不在 0×0 上建图，容器可用后才建一张（复审 P1）", async () => {
    useManualFrames();
    const { wrapper, bmap } = await mountControlledMap(() => ({
      provider: harness.deferredProvider(),
      center: { ...POSITION },
      zoom: 12,
    }));
    const root = bmap.element as HTMLElement;
    expect(statusOf(bmap), "SDK 还在加载").toBe("waiting-client");
    expect(harness.mapsCreated()).toBe(0);

    // 加载期间把容器收起，然后放行 provider：此刻**不能**在 0×0 上 create
    shims.resize(root, { width: 0, height: 0 });
    frames!.flush();
    harness.releaseProvider();
    await settleProps();
    await nextTick();
    expect(
      harness.mapsCreated(),
      "SDK 加载完成时容器已收起 ⇒ 不得在 0×0 上建图（启动前判一次会有 TOCTOU）",
    ).toBe(0);

    // 容器恢复 → 才建图
    shims.resize(root, { width: 320, height: 240 });
    frames!.flush();
    await settleProps();
    expect(harness.mapsCreated(), "容器可用之后才建图").toBe(1);
    expect(statusOf(bmap)).toBe("ready");

    await unmountAndSettle(wrapper);
    harness.assertIdle("加载期间收起容器");
  });

  it("最终门禁读 fresh DOM：DOM 已变、Observer 尚未交付时也不在 0×0 上建图（复审 P1）", async () => {
    useManualFrames();
    const { wrapper, bmap } = await mountControlledMap(() => ({
      provider: harness.deferredProvider(),
      center: { ...POSITION },
      zoom: 12,
    }));
    const root = bmap.element as HTMLElement;
    expect(statusOf(bmap), "SDK 还在加载").toBe("waiting-client");

    // 「DOM 已变、观察器尚未交付」：`setElementSize` 只改替身的盒模型，**不派发** resize 回调，
    // 因此 `suspension.size` 仍是 320×240 —— 只有 fresh 读数能看见 0×0。
    shims.setElementSize(root, { width: 0, height: 0 });
    harness.releaseProvider();
    await settleProps();
    await nextTick();
    expect(
      harness.mapsCreated(),
      "最终门禁必须读 fresh DOM，而不是观察器缓存（缓存里还是 320×240）",
    ).toBe(0);

    // 观察器随后补上这个变化（真实浏览器里布局变化一定会交付），再恢复容器 → 才放行建图
    shims.resize(root, { width: 0, height: 0 });
    frames!.flush();
    shims.resize(root, { width: 320, height: 240 });
    frames!.flush();
    await settleProps();
    expect(harness.mapsCreated(), "容器真的可用之后才建图").toBe(1);
    expect(statusOf(bmap)).toBe("ready");

    await unmountAndSettle(wrapper);
    harness.assertIdle("fresh DOM 建图门禁");
  });

  it("缓存过期时 retry 不得启动 boot：状态保持 error，等容器真可用才继续（独立复核发现）", async () => {
    useManualFrames();
    harness.failNextInitializeView();
    const { wrapper, bmap } = await mountControlledMap(controlledViewProps);
    const api = exposeOf(bmap);
    const root = bmap.element as HTMLElement;
    expect(statusOf(bmap)).toBe("error");
    const created = harness.mapsCreated();

    // 「DOM 已变、观察器尚未交付」：缓存仍是 320×240（不 notify），fresh 已是 0×0
    shims.setElementSize(root, { width: 0, height: 0 });
    let settled: "pending" | "resolved" | "rejected" = "pending";
    const pending = api.retry().then(
      () => {
        settled = "resolved";
      },
      () => {
        settled = "rejected";
      },
    );
    await settleProps();
    await nextTick();

    expect(
      statusOf(bmap),
      "缓存过期时 retry 必须走 fresh 判据：不得启动 boot（状态应留在 error，而不是 creating）",
    ).toBe("error");
    expect(settled, "这次重试应当挂起等待容器").toBe("pending");
    expect(harness.mapsCreated(), "挂起期间不建图").toBe(created);

    // 观察器补上 0×0，再恢复容器 → 挂起的这次重试应当继续并成功
    shims.resize(root, { width: 0, height: 0 });
    frames!.flush();
    shims.resize(root, { width: 320, height: 240 });
    frames!.flush();
    await settleProps();
    await pending;
    await expect(pending).resolves.toBeUndefined();
    expect(statusOf(bmap)).toBe("ready");
    expect(harness.mapsCreated(), "延迟重试只建一张图").toBe(created + 1);

    await unmountAndSettle(wrapper);
    harness.assertIdle("缓存过期时的 retry 门禁");
  });

  it("fresh 门禁阻塞后：缓存层没有发生转换也必须被唤醒（复审 P1，活性兜底）", async () => {
    useManualFrames();
    const { wrapper, bmap } = await mountControlledMap(() => ({
      provider: harness.deferredProvider(),
      center: { ...POSITION },
      zoom: 12,
    }));
    const root = bmap.element as HTMLElement;
    expect(statusOf(bmap)).toBe("waiting-client");

    // ① DOM 变 0×0（不 notify：缓存仍是 320×240）② 放行 SDK ⇒ fresh 门禁拦住并挂起等待
    shims.setElementSize(root, { width: 0, height: 0 });
    harness.releaseProvider();
    await settleProps();
    await nextTick();
    expect(harness.mapsCreated(), "fresh 门禁必须拦住").toBe(0);

    // ③ 在观察器交付之前把 DOM 恢复成**原尺寸**：缓存层不会出现「不可用 → 可用」转换
    shims.setElementSize(root, { width: 320, height: 240 });
    shims.notifyResize(root); // 观察器“交付”，但 applySize 被 `sizeEquals` 去重吞掉
    frames!.flush(); // ⇒ 只能靠等待期间的每帧 fresh 复查唤醒

    await settleProps();
    expect(
      harness.mapsCreated(),
      "缓存没有转换时也必须被唤醒（否则 Runtime 永远停在 creating）",
    ).toBe(1);
    expect(statusOf(bmap)).toBe("ready");

    await unmountAndSettle(wrapper);
    harness.assertIdle("fresh 门禁的活性兜底");
  });

  it("error 事件回调里同步 retry：真的排下一次重试（复审 P2）", async () => {
    harness.failNextInitializeView();
    let api: BMapExpose | null = null;
    const retries: Array<Promise<unknown>> = [];
    const Root = defineComponent({
      setup: () => () =>
        h(
          BMap as never,
          {
            ref: (value: unknown) => {
              api = value as BMapExpose | null;
            },
            provider: harness.provider(),
            center: { ...POSITION },
            zoom: 12,
            // 业务最常见的写法：失败即自动重试（**同步**发生在 error 事件里）
            onError: () => {
              if (api) retries.push(api.retry());
            },
          } as never,
        ),
    });
    const wrapper = mount(Root, { attachTo: harness.container() });
    await settleProps();
    await nextTick();
    await nextTick();
    const bmap = wrapper.findComponent(BMap);

    expect(retries, "error 事件里确实发起了 retry").toHaveLength(1);
    expect(
      harness.mapsCreated(),
      "同步 retry 必须真的排下一次重试（复用那条即将 reject 的旧任务等于没重试）",
    ).toBe(2);
    expect(statusOf(bmap)).toBe("ready");
    await expect(Promise.all(retries), "拿到的是下一次重试的结果").resolves.toHaveLength(1);

    await unmountAndSettle(wrapper);
    harness.assertIdle("error 事件里同步 retry");
  });
});
