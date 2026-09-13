/**
 * 迁移期双 Driver 组件行为验证（M3A3-FAKE-DUAL / issue #24）
 *
 * 这一份回答的是 issue 里那句「核心组件同时跑旧 Driver 与 v4 Driver，验证抽象没有遗漏」：
 * **同一份组件代码**（不改 props、不加 engine 分支）在 webgl-v1 与 jsapi-v4 上各挂载一遍，
 * 断言**领域结果一致**——不是 raw SDK 调用序列一致（那本来就不可能一样）。
 *
 * 矩阵（`runDriverMatrix`）负责三件事：每个引擎一份全新 Provider / 容器、基线重置、
 * 以及跨引擎的领域结果比对；引擎差异（v4 的图层在 `map.layers`、BMapGL 的图层混在
 * `map.overlays` 等）全部收在 `driver-matrix.ts` 的引擎描述里。
 *
 * 每个场景结尾都调用 `ctx.assertIdle()`：**诊断计数在这里当生命周期门禁用**——卸载之后
 * SDK 侧必须没有任何未释放资源，两个引擎用各自 Fake 的诊断实现。
 *
 * 双跑只用于验证，不形成长期兼容承诺：`#26` 删除 webgl-v1 后，本文件退化为 v4 单引擎回归。
 *
 * ## `<BInfoWindow>` 的缺口已由 R25-C（#72）关掉
 *
 * 组件曾经在 `onMounted` 里走 `overlays.add({ kind: "map" }, infoWindow)`，而 v4 的 OverlayDriver
 * 明确拒绝这条路（气泡是地图级 API，要用 `openInfoWindow` / `closeInfoWindow`）并抛
 * `BMAP_INVALID_ARGUMENT`。`#72` 把组件改成专用入口之后，两个引擎的领域结果**一致**了，因此下面
 * 的 InfoWindow 用例从「把现状钉成断言」变回正向断言：打开 1 个、关闭后 0 个、卸载后无残留。
 * 完整状态机（Teleport / InfoWindowManager / 受控与不受控的边界）仍由 M5 **#32** 收口——本文件
 * 只覆盖「最小成功路径」。
 */
import { describe, it, expect } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, nextTick, onMounted, ref, type VNodeChild } from "vue";
import {
  createMigrationMatrixEngines,
  expectSameDomainResult,
  runDriverMatrix,
  type DriverMatrixContext,
} from "../../packages/test-utils";
import BMap from "../../packages/baidu-map-gl-vue/src/components/map/BMap.vue";
import BMarker from "../../packages/baidu-map-gl-vue/src/components/overlays/BMarker.vue";
import BInfoWindow from "../../packages/baidu-map-gl-vue/src/components/overlays/BInfoWindow.vue";
import BControl from "../../packages/baidu-map-gl-vue/src/components/controls/BControl.vue";
import BDistrictLayer from "../../packages/baidu-map-gl-vue/src/components/layers/BDistrictLayer.vue";
import { useBMapGeocoder } from "../../packages/baidu-map-gl-vue/src/composables/useBMapGeocoder";
import { useRequiredMapContext } from "../../packages/baidu-map-gl-vue/src/core/context/inject";

const { engines, fakeV4 } = createMigrationMatrixEngines();

const POSITION = { lng: 116.4, lat: 39.9 };

/**
 * 在每个引擎上挂一份 `<BMap>` + 子节点，就绪后返回 wrapper。
 *
 * `onError` 用于把「组件 mounted 钩子里抛出的错误」收成领域结果：Vue 会把它交给
 * `config.errorHandler`，不接住就是 unhandled rejection（噪声大且不可断言）。
 */
async function mountMapTree(
  ctx: DriverMatrixContext,
  children: () => VNodeChild,
  onError?: (error: unknown) => void,
) {
  const Root = defineComponent({
    setup: () => () => h(BMap, { provider: ctx.provider }, children),
  });
  const wrapper = mount(Root, {
    attachTo: ctx.container,
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

describe("迁移期双 Driver：组件领域行为", () => {
  it("Map：两个引擎都 ready 且容器就绪，组件树里的 client.engine 与声明的引擎一致", async () => {
    const results = await runDriverMatrix(engines, async (ctx) => {
      // 探针子树：从组件树内部读 client.engine，证明「组件拿到的确实是该引擎的 client」
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

      const wrapper = await mountMapTree(ctx, () => [h(EngineProbe)]);
      const bmap = wrapper.findComponent(BMap);
      const domain = {
        containerRendered: wrapper.find(".bmap-canvas-host").exists(),
        status: (bmap.vm as unknown as { status: string }).status,
        hasMapHandle: Boolean(
          (bmap.vm as unknown as { getMapInstance(): unknown }).getMapInstance(),
        ),
      };
      expect(seenEngine, "组件树里的 client.engine 必须与矩阵引擎一致").toBe(ctx.engine);

      await unmountAndSettle(wrapper);
      ctx.assertIdle();
      return domain;
    });

    expectSameDomainResult(results, engines, "Map 组件的领域结果");
    for (const engine of engines) {
      expect(results[engine.engine]).toMatchObject({
        containerRendered: true,
        status: "ready",
        hasMapHandle: true,
      });
    }
  });

  it("Marker：position 变化只更新同一个覆盖物，卸载后无残留", async () => {
    const results = await runDriverMatrix(engines, async (ctx) => {
      const position = ref(POSITION);
      const wrapper = await mountMapTree(ctx, () => [
        h(BMarker, { position: position.value, title: "marker" }),
      ]);

      const initial = { positions: ctx.overlayPositions() };
      position.value = { lng: 121.5, lat: 31.2 };
      await nextTick();
      await flushPromises();
      const updated = { positions: ctx.overlayPositions() };

      await unmountAndSettle(wrapper);
      ctx.assertIdle();
      return { initial, updated };
    });

    expectSameDomainResult(results, engines, "Marker 组件的领域结果");
    for (const engine of engines) {
      const result = results[engine.engine] as {
        initial: { positions: Array<{ lng: number; lat: number } | null> };
        updated: { positions: Array<{ lng: number; lat: number } | null> };
      };
      // 领域事实：挂了一个覆盖物、位置更新后仍是同一个（不重建、不重复挂载）
      expect(result.initial.positions).toEqual([POSITION]);
      expect(result.updated.positions).toEqual([{ lng: 121.5, lat: 31.2 }]);
    }
  });

  it("InfoWindow：两个引擎都经专用入口打开/关闭，内容可见，卸载后无残留（#72）", async () => {
    // v4 侧的内容容器探针（只对 v4 有意义：legacy 的 Fake 不做 DOM 归属）——放在矩阵之外，
    // 否则会污染「两个引擎领域结果一致」的比较
    let v4Content: { text: string; display: string } | null = null;
    // 矩阵的 `reset()` 会清零活动计数，因此 v4 侧的增量必须在**回调内**取（reset 之后）
    let v4OverlayAttachDelta: number | null = null;
    const overlaysBefore = fakeV4.createdOverlays.length;

    const results = await runDriverMatrix(engines, async (ctx) => {
      const errors: Array<{ code?: string }> = [];
      const attachedBefore =
        ctx.engine === "jsapi-v4" ? fakeV4.diagnostics.snapshot().activity.overlaysAttached : 0;
      const open = ref(true);
      const wrapper = await mountMapTree(
        ctx,
        () => [
          h(BInfoWindow, { position: POSITION, open: open.value, title: "iw" }, () =>
            h("span", "气泡内容"),
          ),
        ],
        (error) => errors.push(error as { code?: string }),
      );

      const openedCount = ctx.openInfoWindows();
      if (ctx.engine === "jsapi-v4") {
        // 打开状态下读交给 SDK 的内容节点：必须是渲染出来的 slot 文本，且**不是**被内联
        // `display:none` 藏住的（#72 之前模板上写死了 display:none，打开后内容也不可见）
        const map = fakeV4.createdMaps.at(-1);
        const content = map?.infoWindow?.content as HTMLElement | undefined;
        v4Content = content
          ? { text: content.textContent ?? "", display: content.style.display }
          : null;
      }

      open.value = false;
      await nextTick();
      await flushPromises();
      const closedCount = ctx.openInfoWindows();

      await unmountAndSettle(wrapper);
      ctx.assertIdle();
      if (ctx.engine === "jsapi-v4") {
        v4OverlayAttachDelta =
          fakeV4.diagnostics.snapshot().activity.overlaysAttached - attachedBefore;
      }
      return {
        mountedWithoutError: errors.length === 0,
        errorCode: errors[0]?.code ?? null,
        openedCount,
        closedCount,
      };
    });

    expectSameDomainResult(results, engines, "InfoWindow 组件的领域结果");
    for (const engine of engines) {
      // 修复前的形态是 `mountedWithoutError: false, errorCode: "BMAP_INVALID_ARGUMENT", openedCount: 0`
      // （组件把气泡当普通覆盖物 `add(map, iw)`，v4 OverlayDriver 直接拒绝）
      expect(results[engine.engine]).toEqual({
        mountedWithoutError: true,
        errorCode: null,
        openedCount: 1,
        closedCount: 0,
      });
    }

    // v4 侧的「可见内容」证据（防空转：没有创建出气泡时 v4Content 会是 null，断言直接失败）
    expect(v4Content, "v4 上必须真的创建出 InfoWindow").not.toBeNull();
    expect(v4Content!.text).toContain("气泡内容");
    expect(v4Content!.display, "打开状态下的内容容器不得被内联隐藏").not.toBe("none");
    // 只经 `createInfoWindow` 创建，**不**额外 `addOverlay`：气泡不是普通覆盖物
    expect(
      fakeV4.createdOverlays
        .slice(overlaysBefore)
        .map((v) => (v as { constructor: { name: string } }).constructor.name),
    ).toEqual(["InfoWindowClass"]);
    expect(
      v4OverlayAttachDelta,
      "气泡不得被当成普通覆盖物挂载（v4 上 addOverlay 的次数增量必须为 0）",
    ).toBe(0);
  });

  it("Control：自定义控件挂载与可见性切换在两个引擎上一致", async () => {
    const results = await runDriverMatrix(engines, async (ctx) => {
      const visible = ref(true);
      const wrapper = await mountMapTree(ctx, () => [
        h(BControl, { visible: visible.value }, () => h("button", "自定义控件")),
      ]);
      const mountedCount = ctx.attached("control");

      visible.value = false;
      await nextTick();
      await flushPromises();
      const hiddenCount = ctx.attached("control");

      // 重新挂载：remove 之后可以再 add（两个引擎的 Driver 都自己记账）
      visible.value = true;
      await nextTick();
      await flushPromises();
      const remountedCount = ctx.attached("control");

      await unmountAndSettle(wrapper);
      ctx.assertIdle();
      return { mountedCount, hiddenCount, remountedCount };
    });

    expectSameDomainResult(results, engines, "Control 组件的领域结果");
    for (const engine of engines) {
      expect(results[engine.engine]).toEqual({
        mountedCount: 1,
        hiddenCount: 0,
        remountedCount: 1,
      });
    }
  });

  it("Layer：行政区图层挂载与可见性切换在两个引擎上一致", async () => {
    const results = await runDriverMatrix(engines, async (ctx) => {
      const visible = ref(true);
      const wrapper = await mountMapTree(ctx, () => [
        h(BDistrictLayer, { name: "北京市", visible: visible.value }),
      ]);
      const mountedCount = ctx.attached("layer");

      visible.value = false;
      await nextTick();
      await flushPromises();
      const hiddenCount = ctx.attached("layer");

      await unmountAndSettle(wrapper);
      ctx.assertIdle();
      return { mountedCount, hiddenCount };
    });

    expectSameDomainResult(results, engines, "Layer 组件的领域结果");
    for (const engine of engines) {
      expect(results[engine.engine]).toEqual({ mountedCount: 1, hiddenCount: 0 });
    }
  });

  it("Marker 与 Layer 混挂在同一张地图：两类读数与位置投影都按族划分（PR #66 复审 P2-2）", async () => {
    const results = await runDriverMatrix(engines, async (ctx) => {
      const wrapper = await mountMapTree(ctx, () => [
        h(BMarker, { position: POSITION }),
        h(BDistrictLayer, { name: "北京市" }),
      ]);
      const domain = {
        overlays: ctx.attached("overlay"),
        layers: ctx.attached("layer"),
        positions: ctx.overlayPositions(),
      };

      await unmountAndSettle(wrapper);
      ctx.assertIdle();
      return domain;
    });

    expectSameDomainResult(results, engines, "Marker + Layer 混挂的领域结果");
    for (const engine of engines) {
      // 实际挂载行为相同 → 两类读数与位置投影必须相同（legacy 的假账本把三者混在一个容器里，
      // 归一化由引擎描述负责，不能把 raw 容器当成领域结果）
      expect(results[engine.engine]).toEqual({
        overlays: 1,
        layers: 1,
        positions: [POSITION],
      });
    }
  });

  it("基础服务：useBMapGeocoder 在两个引擎上都把 SDK 回包归一成 Point", async () => {
    const results = await runDriverMatrix(engines, async (ctx) => {
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

      const wrapper = await mountMapTree(ctx, () => [h(GeocodeProbe)]);
      await flushPromises();
      await nextTick();
      const domain = { ...outcome };

      await unmountAndSettle(wrapper);
      ctx.assertIdle();
      return domain;
    });

    // 跨引擎只比「结算成功且是一个 Point」：两个 Fake 的服务 fixture 取值不同（116.4 vs 116.404），
    // 比较具体数值等于在比 fixture 而不是比语义。fixture 的取值由各引擎自己的单测负责。
    expectSameDomainResult(results, engines, "地址解析的领域结果");
    for (const engine of engines) {
      expect(results[engine.engine]).toEqual({ status: "resolved", finite: true });
    }
  });
});

describe("迁移期双 Driver：生命周期门禁（组件层）", () => {
  it("100 次挂载 / 卸载整棵组件树之后诊断归零", async () => {
    const rounds = await runDriverMatrix(engines, async (ctx) => {
      for (let i = 0; i < 100; i++) {
        const wrapper = await mountMapTree(ctx, () => [
          h(BMarker, { position: POSITION }),
          h(BControl, {}, () => h("span", "c")),
          h(BDistrictLayer, { name: "北京市" }),
          // 气泡也进循环：它走的是**地图级**专用入口（不是 addOverlay），因此它的释放路径
          // 与其它三个族完全不同，混挂时最容易被漏掉（R25-C / #72）
          h(BInfoWindow, { position: POSITION, open: true }),
        ]);
        // 每一轮都必须真的挂上（否则「归零」可能是「从来没挂过」）。四个族都断言：
        // legacy 的假账本把覆盖物/图层/气泡混在 `map.overlays` 里，归一化由引擎描述按**构造器身份**
        // 完成（PR #66 复审 P2-2），因此这里可以逐族断言而不是只挑一个干净的桶。
        expect(ctx.attached("overlay")).toBe(1);
        expect(ctx.attached("control")).toBe(1);
        expect(ctx.attached("layer")).toBe(1);
        expect(ctx.openInfoWindows(), "气泡确实打开过（不是被门禁默默放过）").toBe(1);
        await unmountAndSettle(wrapper);
      }
      // 卸载之后 SDK 侧不能有任何未释放资源（各引擎用自己的诊断实现）
      ctx.assertIdle();
      return { rounds: 100 };
    });

    expectSameDomainResult(rounds, engines, "100 轮挂载/卸载");

    // v4 侧的**逐族**证据：四个 family 都真的挂过 100 次，而不是被门禁「默默放过」
    const activity = fakeV4.diagnostics.snapshot().activity;
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
    expect(fakeV4.diagnostics.pendingAsync()).toEqual({ timers: 0, callbacks: 0 });
  });
});
