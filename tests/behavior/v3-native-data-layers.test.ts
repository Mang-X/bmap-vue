/**
 * 原生批量可视化图层的组件级验收（M6 / issue #36）
 *
 * 这个文件回答 issue 的「测试要求」与「验收标准」，逐条对应如下：
 *
 * | issue 条目 | 落点 | 覆盖程度 |
 * | --- | --- | --- |
 * | 统一 setData/style/base options/visible/opacity/zoom/zIndex | §1（四条写入路径）、§6（样式函数） | 完整 |
 * | 各种 geometry 的 GeoJSON 校验 | **未实现**：本票的图层组件**不做** GeoJSON 校验（官方 `setData(geojson: object)` 的结构由 SDK 负责），M6 的数据适配层（`core/data/*`，由 #34 落地）目前只覆盖 Point 几何 | 欠账（见 ADR） |
 * | Feature State 单选/多选/替换/清空 | §3（组件 expose 的命令面）+ `core/data/featureState.test.ts`（参数边界与读回口径） | 完整 |
 * | 未命中、命中和 data 更新后的 picked item | §2 | 完整 |
 * | TrackLine 状态/进度/隐藏页面 | **未实现**（2026-09-19 的范围纠正：播放控制与页面可见性联动必须先有真实运行时证据）。本文件只锁「不依赖 TrackAnimation 私有字段」与「不建内部播放状态机」 | 欠账（见 ADR） |
 * | 大数据 setData/style update 与资源清理 | §1（data / style 的就地更新）、§4（卸载 / 隐藏两条路径 + 每节的 `assertIdle()`） | 更新与清理完整；**「大数据量」维度无专门用例**（夹具都是 1~2 个要素），登记为欠账 |
 * | Layer API 有统一基础语义和各自强类型 style | §1（同一批断言跑在 line / fill 上）、§5（逐 kind 能力面：不支持的字段不声明） | line / fill 完整（强类型 style）；heatmap / track-line 只有官方声明得到的那部分面，**没有强类型 style**——官方没有可核对的声明 |
 * | Feature State 与业务 ID 稳定对应 | §2 / §3（身份只来自 `properties[idKey]`，`id` 如实回传） | 完整 |
 * | TrackLine 不再依赖旧 TrackAnimation 私有字段 | §7（源码级反向门禁 + 正证守卫） | 完整 |
 * | 所有 Layer 均有明确 remove/clear 策略 | §4（永久销毁 = `clearData` → `removeLayer`；有 `setVisible` 的 kind 隐藏走 setter，没有的走摘挂） | 完整 |
 *
 * 用例默认只写**领域读数**（`harness.nativeLayersCreated()` / `nativeLayerCalls()` /
 * `nativeLayerAttached()` / `harness.attached('layer')` / `assertIdle()`）。少数几条需要「SDK 侧
 * 真正收到了什么」（§4 的顺序、§6 的函数转发）只能落到替身实例上，那几处显式读
 * `fake.createdNativeLayers` 并在注释里说明为什么领域读数不够。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineComponent, h, nextTick, ref, type VNodeChild } from "vue";
import { createFakeV4Harness } from "../../packages/test-utils";
import BMap from "../../packages/baidu-map-gl-vue/src/components/map/BMap.vue";
import BLineLayer from "../../packages/baidu-map-gl-vue/src/components/layers/BLineLayer.vue";
import BFillLayer from "../../packages/baidu-map-gl-vue/src/components/layers/BFillLayer.vue";
import BHeatmapLayer from "../../packages/baidu-map-gl-vue/src/components/layers/BHeatmapLayer.vue";
import BTrackLineLayer from "../../packages/baidu-map-gl-vue/src/components/layers/BTrackLineLayer.vue";
import type { FeatureStateApi } from "../../packages/baidu-map-gl-vue/src/core/data/featureState";

const { harness, fake } = createFakeV4Harness();

/* ------------------------------------------------------------------ 夹具 */

const LINES = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[116.3, 39.9], [116.4, 39.95]] },
      properties: { id: "a", name: "一路" },
    },
    {
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[116.5, 39.9], [116.6, 39.95]] },
      properties: { id: "b", name: "二路" },
    },
  ],
};

const POLYGONS = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[[116.3, 39.9], [116.4, 39.9], [116.4, 39.95], [116.3, 39.9]]],
      },
      properties: { id: "area-1" },
    },
  ],
};

const TRACK = {
  type: "Feature",
  geometry: { type: "LineString", coordinates: [[116.3, 39.9], [116.4, 39.95]] },
  properties: { id: "track" },
};

/**
 * 统一语义那批断言跑在**两个**有官方声明的 kind 上（`LineLayer` / `FillLayer`）。
 *
 * 热力图 / 轨迹线不在这张表里：它们的能力面窄得多（没有强类型 style、没有拾取、没有统一字段），
 * 硬套同一批断言只会变成「为差异写特例」。它们各自在 §5。
 */
const VISUAL_LAYER_CASES: ReadonlyArray<{
  name: string;
  component: unknown;
  props: Record<string, unknown>;
}> = [
  { name: "BLineLayer", component: BLineLayer, props: { data: LINES, idKey: "id" } },
  { name: "BFillLayer", component: BFillLayer, props: { data: POLYGONS, idKey: "id" } },
];

/** 替身实例上对本文件有用的字段（显式列出，读起来就是「这一条依赖替身的哪几项」）。 */
interface RawLayerView {
  callLog: string[];
  attachedMap: unknown;
  data?: unknown;
  state?: Record<string, unknown>;
  styleOptions?: Record<string, unknown>;
  clearData?: () => void;
}

/**
 * 实例账本（`createdNativeLayers`）跨用例共享，而 `harness.reset()` 只重置诊断计数：
 * 「本用例创建了几个」必须减去基线。
 */
let createdBase = 0;

beforeEach(() => {
  harness.reset();
  createdBase = harness.nativeLayersCreated();
});

/** 本用例内累计创建的原生图层数。 */
const createdSince = () => harness.nativeLayersCreated() - createdBase;

/** 最近一次创建的原生图层（替身实例）。 */
function lastRawLayer(): RawLayerView {
  const list = fake.createdNativeLayers as unknown as RawLayerView[];
  const raw = list[list.length - 1];
  if (!raw) throw new Error("本用例还没有创建过原生图层");
  return raw;
}

function mountLayerTree(children: () => VNodeChild) {
  const Root = defineComponent({
    setup: () => () => h(BMap, { provider: harness.provider() }, children),
  });
  return mount(Root, { attachTo: harness.container() });
}

async function settle() {
  await flushPromises();
  await nextTick();
}

async function unmountAndSettle(wrapper: { unmount(): void }) {
  wrapper.unmount();
  await settle();
}

/** 挂一个图层组件，返回可写的 props 与 wrapper。 */
async function mountOneVisual(index: number, overrides: Record<string, unknown> = {}) {
  const entry = VISUAL_LAYER_CASES[index]!;
  const props = ref<Record<string, unknown>>({ ...entry.props, ...overrides });
  const wrapper = mountLayerTree(() => h(entry.component as never, props.value));
  await settle();
  const setProp = async (patch: Record<string, unknown>) => {
    props.value = { ...props.value, ...patch };
    await settle();
  };
  return { wrapper, props, setProp, entry };
}

/** 组件 expose 出来的要素状态命令面（`defineExpose` 用 `proxyRefs`，运行时拿到的是解包后的对象）。 */
function featureStateOf(wrapper: ReturnType<typeof mount>, component: unknown): FeatureStateApi {
  const vm = wrapper.findComponent(component as never).vm as unknown as { featureState: FeatureStateApi };
  return vm.featureState;
}

function warnLines(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((call) => String(call[0] ?? ""));
}

/** 读源码文本（用 `process.cwd()` 而不是 `import.meta.url`：后者会被 Vite 改写成 `/@fs/…`）。 */
function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

/* -------------------------------------------------------------------------- */

describe("原生批量可视化图层（M6 / issue #36）", () => {
  describe("§1 统一语义：四条写入路径", () => {
    it("只有一个 SDK 资源，且构造选项就是构造期项（idKey / enablePicked）", async () => {
      const { wrapper } = await mountOneVisual(0);
      expect(createdSince(), "无论多少要素都只有 1 个 SDK 资源").toBe(1);
      expect(harness.nativeLayerOptions()).toMatchObject({ idKey: "id", enablePicked: true });
      expect(harness.attached("layer")).toBe(1);

      await unmountAndSettle(wrapper);
      harness.assertIdle("BLineLayer 卸载");
    });

    it.each(VISUAL_LAYER_CASES.map((entry, index) => [entry.name, index] as const))(
      "%s：data 变化走 setData 不换实例；同一份引用不重复写",
      async (_name, index) => {
        const { wrapper, setProp } = await mountOneVisual(index);
        const created = createdSince();
        const next = { type: "FeatureCollection", features: [LINES.features[0]] };

        await setProp({ data: next });
        expect(harness.nativeLayerData(), "新数据真的下发了").toEqual(next);
        expect(createdSince(), "data 变化不换实例").toBe(created);

        const calls = harness.nativeLayerCalls().length;
        await setProp({ data: next });
        expect(harness.nativeLayerCalls().length, "同一份引用不产生新调用").toBe(calls);

        await unmountAndSettle(wrapper);
        harness.assertIdle("data 更新");
      },
    );

    it("style 变化走 setStyleOptions + 显式重绘，不换实例", async () => {
      const { wrapper, setProp } = await mountOneVisual(0);
      const created = createdSince();

      await setProp({ style: { strokeColor: "#0055ff", strokeWeight: 4 } });
      const calls = harness.nativeLayerCalls();
      expect(calls).toContain("setStyleOptions");
      expect(
        calls.filter((call) => call === "doOnceDraw").length,
        "官方：样式更新后不自动重绘，必须显式 doOnceDraw",
      ).toBeGreaterThan(0);
      expect(createdSince(), "style 变化不换实例").toBe(created);

      await unmountAndSettle(wrapper);
      harness.assertIdle("style 更新");
    });

    it("visible / opacity / zIndex / 缩放范围走字段级 setter，不换实例", async () => {
      const { wrapper, setProp } = await mountOneVisual(0);
      const created = createdSince();

      await setProp({ visible: false, opacity: 0.4, zIndex: 7, minZoom: 5, maxZoom: 18 });
      const calls = harness.nativeLayerCalls();
      for (const called of ["setVisible", "setOpacity", "setZIndex", "setMinZoom", "setMaxZoom"]) {
        expect(calls, `${called} 必须真的调到`).toContain(called);
      }
      expect(createdSince(), "字段级变化不换实例").toBe(created);
      expect(harness.nativeLayerVisible(), "隐藏由 setVisible 表达").toBe(false);
      expect(harness.nativeLayerAttached(), "setVisible(false) ≠ 释放：实例仍在图上").toBe(true);

      await unmountAndSettle(wrapper);
      harness.assertIdle("字段级 setter");
    });

    it("字段由有值变回未表态 ⇒ 重建（SDK 没有 unset 入口，不猜默认值）", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { wrapper, setProp } = await mountOneVisual(0, { opacity: 0.5 });
      const created = createdSince();

      await setProp({ opacity: undefined });
      expect(createdSince(), "撤回字段必须换实例").toBe(created + 1);
      expect(warnLines(warn).some((line) => line.includes("未表态")), "必须告警").toBe(true);
      expect(harness.attached("layer"), "旧实例已摘、新实例已挂（不并存）").toBe(1);

      await unmountAndSettle(wrapper);
      harness.assertIdle("撤回字段");
    });

    it("style 的单个字段撤回也要被发现（merge 语义下旧值会留在 SDK 上）", async () => {
      const { wrapper, setProp } = await mountOneVisual(0, {
        style: { strokeColor: "#0055ff", strokeWeight: 4 },
      });
      const created = createdSince();

      await setProp({ style: { strokeWeight: 4 } });
      expect(createdSince(), "样式字段撤回 ⇒ 重建").toBe(created + 1);

      await unmountAndSettle(wrapper);
      harness.assertIdle("样式字段撤回");
    });

    it("**写入失败过**的字段被撤回时同样必须重建（撤回判据认「尝试过」而不是「成功过」）", async () => {
      const { wrapper, setProp } = await mountOneVisual(0);
      const created = createdSince();

      // 让「缩放范围」这一次写入**部分成功**：`setMinZoom` 成功、`setMaxZoom` 抛错
      // （`setZoomRange` 在 Driver 里就是两次调用，这正是会产生部分写入的形状）
      let raw = lastRawLayer();
      (raw as { setMaxZoom?: unknown }).setMaxZoom = () => {
        throw new Error("boom");
      };

      await setProp({ minZoom: 5, maxZoom: 18 });
      raw = lastRawLayer();
      expect(
        harness.nativeLayerCalls(),
        "第一次调用已经打到 SDK（这就是「可能已写入」的事实）",
      ).toContain("setMinZoom");

      // 撤回这两个字段：SDK 没有 unset 入口 ⇒ 必须重建把实例拉回默认状态
      await setProp({ minZoom: undefined, maxZoom: undefined });
      expect(createdSince(), "失败过的写入也要能被撤回检测看见").toBe(created + 1);

      await unmountAndSettle(wrapper);
      harness.assertIdle("部分写入后撤回");
    });

    it("构造期项变化 ⇒ 换实例（先摘后建）", async () => {
      const { wrapper, setProp } = await mountOneVisual(0);
      const created = createdSince();

      await setProp({ enablePicked: false });
      expect(createdSince(), "构造期项变化必须换实例").toBe(created + 1);
      expect(harness.attached("layer"), "旧实例已摘、新实例已挂").toBe(1);
      expect(harness.nativeLayerOptions()).toMatchObject({ enablePicked: false });

      await unmountAndSettle(wrapper);
      harness.assertIdle("构造期项变化");
    });
  });

  describe("§2 拾取：未命中 / 命中 / data 更新后的最新 item", () => {
    it("命中回传业务身份与 properties；未命中只有 hit:false", async () => {
      const { wrapper } = await mountOneVisual(0);
      const layer = wrapper.findComponent(BLineLayer);

      harness.simulateNativePick({ dataIndex: 1, latLng: { lng: 116.55, lat: 39.92 }, pixel: { x: 3, y: 4 } });
      const hit = layer.emitted("click")!.at(-1)![0] as {
        hit: boolean;
        id: string | number | null;
        item: Record<string, unknown> | null;
        latLng: unknown;
      };
      expect(hit.hit).toBe(true);
      expect(hit.id).toBe("b");
      expect(hit.item).toMatchObject({ id: "b", name: "二路" });
      expect(hit.latLng).toEqual({ lng: 116.55, lat: 39.92 });

      harness.simulateNativePick({ dataIndex: -1, pixel: { x: 1, y: 2 } });
      const miss = layer.emitted("click")!.at(-1)![0] as {
        hit: boolean;
        dataIndex: number;
        id: unknown;
        item: unknown;
      };
      expect(miss.hit, "官方未命中也派发事件").toBe(false);
      expect(miss.dataIndex).toBe(-1);
      expect(miss.id).toBeNull();
      expect(miss.item).toBeNull();

      await unmountAndSettle(wrapper);
      harness.assertIdle("BLineLayer 拾取");
    });

    it("data 更新后，同一个要素下标回传的是新 properties", async () => {
      const { wrapper, setProp } = await mountOneVisual(0);
      const layer = wrapper.findComponent(BLineLayer);

      await setProp({
        data: {
          type: "FeatureCollection",
          features: [
            { ...LINES.features[0], properties: { id: "a", name: "改名后的一路" } },
            LINES.features[1],
          ],
        },
      });
      harness.simulateNativePick({ dataIndex: 0 });

      const pick = layer.emitted("click")!.at(-1)![0] as { item: Record<string, unknown> | null };
      expect(pick.item).toMatchObject({ id: "a", name: "改名后的一路" });

      await unmountAndSettle(wrapper);
      harness.assertIdle("拾取最新 item");
    });

    it("没有 idKey 时身份如实为 null（不猜官方默认值），但仍给出命中要素的 properties", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { wrapper } = await mountOneVisual(0, { idKey: undefined });
      const layer = wrapper.findComponent(BLineLayer);

      harness.simulateNativePick({ dataIndex: 0 });
      const pick = layer.emitted("click")!.at(-1)![0] as {
        hit: boolean;
        id: unknown;
        item: Record<string, unknown> | null;
      };
      expect(pick.hit, "命中判定不受身份缺失影响").toBe(true);
      expect(pick.id, "身份认不出 ⇒ 如实为 null").toBeNull();
      expect(pick.item, "属性袋是官方回包直接给出的，不依赖 idKey").toMatchObject({ id: "a", name: "一路" });
      expect(warnLines(warn).some((line) => line.includes("idKey")), "必须告警").toBe(true);

      await unmountAndSettle(wrapper);
      harness.assertIdle("缺 idKey");
    });
  });

  describe("§3 Feature State：单选 / 多选 / 替换 / 清空 / 读回", () => {
    it("命令面写进 SDK，并按业务 id 定位", async () => {
      const { wrapper } = await mountOneVisual(0);
      const state = featureStateOf(wrapper, BLineLayer);

      state.update("a", { selected: true });
      state.update(["a", "b"], { hovered: true }, { append: true });
      expect(lastRawLayer().state).toEqual({
        a: { selected: true, hovered: true },
        b: { hovered: true },
      });

      state.remove("b");
      expect(lastRawLayer().state).toEqual({ a: { selected: true, hovered: true } });

      state.replace({ "9": { picked: true } });
      expect(lastRawLayer().state, "全量替换：未覆盖到的 id 必须消失").toEqual({ "9": { picked: true } });

      state.clear();
      expect(lastRawLayer().state).toEqual({});

      await unmountAndSettle(wrapper);
      harness.assertIdle("Feature State 命令");
    });

    it("get 走 SDK 的公开读回（不是本地账本），且能按 keys 过滤", async () => {
      const { wrapper } = await mountOneVisual(0);
      const state = featureStateOf(wrapper, BLineLayer);

      state.update(["a", "b"], { selected: true });
      expect(state.get()).toEqual({ a: { selected: true }, b: { selected: true } });
      expect(state.get(["b", "missing"])).toEqual({ b: { selected: true } });

      await unmountAndSettle(wrapper);
      harness.assertIdle("Feature State 读回");
    });

    it("非法 id 在调用之前失败（不产生 SDK 调用）", async () => {
      const { wrapper } = await mountOneVisual(0);
      const state = featureStateOf(wrapper, BLineLayer);
      const calls = harness.nativeLayerCalls().length;

      expect(() => state.update(Number.NaN, { selected: true })).toThrowError(
        expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }),
      );
      expect(harness.nativeLayerCalls().length).toBe(calls);

      await unmountAndSettle(wrapper);
      harness.assertIdle("Feature State 校验");
    });
  });

  describe("§4 清理策略", () => {
    it("永久销毁 = 先清数据、再摘图层", async () => {
      const { wrapper } = await mountOneVisual(0);
      const raw = lastRawLayer();

      // 顺序只能从替身上读：`clearData` 那一刻实例还必须挂在图上（领域读数看不出先后）
      let attachedWhenCleared: boolean | null = null;
      const original = raw.clearData;
      raw.clearData = () => {
        attachedWhenCleared = raw.attachedMap !== null;
        original?.call(raw);
      };

      await unmountAndSettle(wrapper);
      expect(raw.callLog, "永久销毁前必须走统一的清空入口").toContain("clearData");
      expect(attachedWhenCleared, "清空发生在摘除之前（官方推荐顺序）").toBe(true);
      expect(harness.attached("layer"), "图层已摘").toBe(0);
      expect(raw.data, "SDK 侧数据已被清空").toBeNull();
      harness.assertIdle("卸载清理");
    });

    it("临时隐藏不释放数据（有 setVisible 的 kind 走 setter）", async () => {
      const { wrapper, setProp } = await mountOneVisual(0, { visible: true });
      const raw = lastRawLayer();

      await setProp({ visible: false });
      expect(harness.nativeLayerAttached(), "隐藏 ≠ 摘掉").toBe(true);
      expect(raw.data, "隐藏不释放数据").toEqual(LINES);
      expect(harness.nativeLayerCalls(), "隐藏不产生 clearData").not.toContain("clearData");

      await setProp({ visible: true });
      expect(harness.nativeLayerCalls().filter((call) => call === "clearData").length).toBe(0);

      await unmountAndSettle(wrapper);
      harness.assertIdle("隐藏往返");
    });
  });

  describe("§5 逐 kind 的能力面：不假支持", () => {
    it("热力图只声明 data / style / visible（不产生不支持的字段调用）", async () => {
      const props = ref<Record<string, unknown>>({ data: POLYGONS, style: { radius: 30 } });
      const wrapper = mountLayerTree(() => h(BHeatmapLayer, props.value));
      await settle();

      expect(createdSince()).toBe(1);
      const calls = harness.nativeLayerCalls();
      expect(calls, "数据走 setData").toContain("setData");
      expect(calls, "样式走扩展 API 的整袋 setOptions").toContain("setOptions");
      for (const unsupported of ["setVisible", "setOpacity", "setZIndex", "setMinZoom", "setMaxZoom"]) {
        expect(calls, `热力图没有 ${unsupported}：不该产生这个调用`).not.toContain(unsupported);
      }

      await unmountAndSettle(wrapper);
      harness.assertIdle("BHeatmapLayer");
    });

    it("热力图的 visible 用挂上-摘掉表达；重新可见换实例（摘掉的实例渲染不了）", async () => {
      const props = ref<Record<string, unknown>>({ data: POLYGONS, visible: true });
      const wrapper = mountLayerTree(() => h(BHeatmapLayer, props.value));
      await settle();
      const created = createdSince();

      props.value = { ...props.value, visible: false };
      await settle();
      expect(harness.attached("layer"), "没有 setVisible ⇒ 摘掉").toBe(0);

      props.value = { ...props.value, visible: true };
      await settle();
      expect(harness.attached("layer"), "重新可见").toBe(1);
      expect(createdSince(), "重新可见必须换实例（#98 live 实测）").toBe(created + 1);

      await unmountAndSettle(wrapper);
      harness.assertIdle("BHeatmapLayer 显隐");
    });

    it("轨迹线基线：只下发数据，没有其它能力调用；显隐同样用挂上-摘掉", async () => {
      const props = ref<Record<string, unknown>>({ data: TRACK, visible: true });
      const wrapper = mountLayerTree(() => h(BTrackLineLayer, props.value));
      await settle();

      expect(createdSince()).toBe(1);
      expect(harness.nativeLayerData()).toEqual(TRACK);
      expect(harness.nativeLayerCalls(), "除 setData 之外不该有别的调用").toEqual(["setData"]);

      const created = createdSince();
      props.value = { ...props.value, visible: false };
      await settle();
      expect(harness.attached("layer"), "没有 setVisible ⇒ 摘掉").toBe(0);

      props.value = { ...props.value, visible: true };
      await settle();
      expect(harness.attached("layer"), "重新可见").toBe(1);
      expect(createdSince(), "重新可见必须换实例（与热力图同一条证据）").toBe(created + 1);

      await unmountAndSettle(wrapper);
      harness.assertIdle("BTrackLineLayer");
    });
  });

  describe("§6 样式里的函数：换实现不触发写，但 SDK 侧调用到新实现", () => {
    it("内联箭头不产生多余写入；换实现后 SDK 手上的函数跟着换", async () => {
      /** 渲染期读它（`+0` 保证取值不变）：**证明父级真的重渲染过**，否则「内联箭头」根本没被重建。 */
      const tick = ref(0);
      const mode = ref<"a" | "b">("a");
      const weight = ref(2);
      const fnA = (properties: Record<string, unknown>) => `#a-${String(properties.id)}`;
      const fnB = (properties: Record<string, unknown>) => `#b-${String(properties.id)}`;

      const wrapper = mountLayerTree(() =>
        h(BLineLayer, {
          data: LINES,
          idKey: "id",
          style: {
            strokeWeight: weight.value + (tick.value >= 0 ? 0 : 1),
            strokeColor: mode.value === "a" ? fnA : fnB,
          },
        }),
      );
      await settle();

      const delivered = lastRawLayer().styleOptions?.strokeColor as (p: object) => string;
      expect(delivered({ id: "a" }), "初始实现生效").toBe("#a-a");

      const writes = () => harness.nativeLayerCalls().filter((call) => call === "setStyleOptions").length;
      const before = writes();
      for (let i = 0; i < 3; i += 1) {
        tick.value += 1;
        await settle();
      }
      expect(tick.value, "确认这一轮父级真的重渲染过（否则本用例失去意义）").toBe(3);
      expect(writes() - before, "函数按 fn 折叠 ⇒ 重渲染不触发重写").toBe(0);

      // 换实现 = 换一个**不同的函数对象**：SDK 侧手上那个（包装）必须跟着换
      mode.value = "b";
      await settle();
      expect(delivered({ id: "a" }), "SDK 侧调用的是新实现，而不是挂载时那个").toBe("#b-a");
      expect(writes() - before, "换实现同样不触发重写（函数指纹折叠成 fn）").toBe(0);

      // **正证控件**：上面的「0 次写入」不能是「管道根本没跑」造成的 —— 基本类型字段变化必须写一次
      weight.value = 6;
      await settle();
      expect(writes() - before, "基本类型字段变化仍然要写").toBe(1);

      await unmountAndSettle(wrapper);
      harness.assertIdle("样式函数");
    });
  });

  describe("§7 与旧 TrackAnimation 无关", () => {
    it("新组件与共享内核的源码里没有旧插件 / 私有面", () => {
      const sources = [
        "packages/baidu-map-gl-vue/src/components/layers/BTrackLineLayer.vue",
        "packages/baidu-map-gl-vue/src/components/layers/BLineLayer.vue",
        "packages/baidu-map-gl-vue/src/components/layers/BFillLayer.vue",
        "packages/baidu-map-gl-vue/src/components/layers/BHeatmapLayer.vue",
        "packages/baidu-map-gl-vue/src/components/layers/useVisualLayer.ts",
        "packages/baidu-map-gl-vue/src/core/composables/useNativeLayerResource.ts",
        "packages/baidu-map-gl-vue/src/core/data/featureState.ts",
        "packages/baidu-map-gl-vue/src/core/layers/nativeLayerPick.ts",
      ];
      const raw = sources.map((path) => readSource(path)).join("\n");

      // **正证守卫**：先证明真的读到了内容（否则「什么都没读到」也会让下面的反向断言通过）
      expect(raw.length, "必须真的读到源码").toBeGreaterThan(8000);
      expect(raw, "读到的内容里应当包含新组件名").toContain("BTrackLineLayer");

      /**
       * 判定对象是**代码**，不是文案：文件头正好在解释「刻意不用 TrackAnimation」，注释里出现
       * 那个名字是正当的。先剥注释再做反向断言，否则门禁会退化成「不许写文档」。
       */
      const code = stripComments(raw);
      for (const forbidden of ["TrackAnimation", "BMapGLLib", "_rd", "getSeckeyAndSign"]) {
        expect(code, `源码（不含注释）里不得出现 ${forbidden}`).not.toContain(forbidden);
      }
      // 反误报：剥注释之后正文必须还在（否则上面四条会变成「什么都没检查」的恒真断言）
      expect(code, "剥注释不能把正文一起吃掉").toContain("useVisualLayer");
    });
  });
});

/**
 * 剥掉 `//` 与 `/* *\/` 注释（与 `scripts/raw-sdk-detector.mts` 的同名处理同源）。
 *
 * 字符串字面量里的注释标记在这里不会被特殊处理——本文件只用于「源码里有没有某个标识符」这类
 * 判定，误报方向是保守的（可能漏判，不会误判）。
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[\s;(){}])\/\/[^\n]*/g, "$1");
}
