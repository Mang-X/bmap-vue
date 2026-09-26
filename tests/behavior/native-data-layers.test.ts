/**
 * 原生批量可视化图层的组件级验收（M6 / issue #36）
 *
 * 这个文件回答 issue 的「测试要求」与「验收标准」，逐条对应如下：
 *
 * | issue 条目 | 落点 | 覆盖程度 |
 * | --- | --- | --- |
 * | 统一 setData/style/base options/visible/opacity/zoom/zIndex | §1（四条写入路径 + `data` 三态）、§6（样式函数） | 完整 |
 * | 各种 geometry 的 GeoJSON 校验 | **未实现**：本票的图层组件**不做** GeoJSON 校验（官方 `setData(geojson: object)` 的结构由 SDK 负责），M6 的数据适配层（`core/data/*`，由 #34 落地）目前只覆盖 Point 几何 | 欠账（见 ADR） |
 * | Feature State 单选/多选/替换/清空 | §3（组件 expose 的命令面）+ `core/data/featureState.test.ts`（参数边界与读回口径） | 完整 |
 * | 未命中、命中和 data 更新后的 picked item | §2 | 完整（含「回包 properties 存在但缺业务键」的两阶段兜底） |
 * | TrackLine 状态/进度/隐藏页面 | **未实现**（2026-09-19 的范围纠正：播放控制与页面可见性联动必须先有真实运行时证据）。本文件只锁「不依赖 TrackAnimation 私有字段」与「不建内部播放状态机」 | 欠账（见 ADR） |
 * | 大数据 setData/style update 与资源清理 | §1（data / style 的就地更新）、§4（卸载 / 隐藏两条路径 + 每节的 `assertIdle()`） | 更新与清理完整；**「大数据量」维度无专门用例**（夹具都是 1~2 个要素），登记为欠账 |
 * | Layer API 有统一基础语义和各自强类型 style | §1（同一批断言跑在 line / fill 上）、§5（逐 kind 能力面：不支持的字段不声明） | line / fill 完整（强类型 style）；heatmap / track-line 只有官方声明得到的那部分面，**没有强类型 style**——官方没有可核对的声明 |
 * | Feature State 与业务 ID 稳定对应 | §2 / §3（身份只来自 `properties[idKey]`；`id` = 可公开/可用于状态的 `string \| number`，`item` 按完整业务键恢复，两者解耦） | 完整 |
 * | TrackLine 不再依赖旧 TrackAnimation 私有字段 | §7（源码级反向门禁 + 正证守卫） | 完整 |
 * | 所有 Layer 均有明确 remove/clear 策略 | §4（永久销毁 = 解绑监听 → `removeLayer`，全程不调 `clearData`；「清空」由 `data: null` ⇒ 换一个没有数据的实例表达）；§1 的 `data` 三态用例 | 完整 |
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
import { browserShims, createFakeV4Harness, stripComments } from "../../packages/test-utils";
import Map from "../../packages/bmap-vue/src/components/map/Map.vue";
import LineLayer from "../../packages/bmap-vue/src/components/layers/LineLayer.vue";
import FillLayer from "../../packages/bmap-vue/src/components/layers/FillLayer.vue";
import HeatmapLayer from "../../packages/bmap-vue/src/components/layers/HeatmapLayer.vue";
import TrackLineLayer from "../../packages/bmap-vue/src/components/layers/TrackLineLayer.vue";
import PointLayer from "../../packages/bmap-vue/src/components/data/PointLayer.vue";
import PointIconLayer from "../../packages/bmap-vue/src/components/data/PointIconLayer.vue";
import type { FeatureStateApi } from "../../packages/bmap-vue/src/core/data/featureState";

const { harness, fake } = createFakeV4Harness();
const shims = browserShims();

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
  { name: "LineLayer", component: LineLayer, props: { data: LINES, idKey: "id" } },
  { name: "FillLayer", component: FillLayer, props: { data: POLYGONS, idKey: "id" } },
];

/** 替身实例上对本文件有用的字段（显式列出，读起来就是「这一条依赖替身的哪几项」）。 */
interface RawLayerView {
  callLog: string[];
  attachedMap: unknown;
  data?: unknown;
  state?: Record<string, unknown>;
  styleOptions?: Record<string, unknown>;
  clearData?: () => void;
  /** 构造期选项袋（`new Ctor(options)` 收到的那一份）。 */
  options?: Record<string, unknown>;
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

/** TrackLine 播放字段的替身读数（FakeV4TrackLine）。 */
function lastRawTrackLine(): { process: number; speed: number; playing: boolean; callLog: string[] } {
  return lastRawLayer() as unknown as { process: number; speed: number; playing: boolean; callLog: string[] };
}

/** 切换页面可见性（`browserShims` 会覆盖 `visibilityState` 并派发 `visibilitychange`）。 */
function setVisibility(state: "hidden" | "visible"): void {
  shims.setDocumentHidden(state === "hidden");
}

function mountLayerTree(children: () => VNodeChild) {
  const Root = defineComponent({
    setup: () => () => h(Map, { provider: harness.provider() }, children),
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
      harness.assertIdle("LineLayer 卸载");
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

    it("data 置为 null ⇒ 换一个**没有数据**的实例；再给数据能重新画出来", async () => {
      const { wrapper, setProp } = await mountOneVisual(0);
      const created = createdSince();
      const stale = lastRawLayer();

      await setProp({ data: null });
      expect(createdSince(), "「没有数据」由换实例表达（这一族没有公开的清空入口）").toBe(created + 1);
      expect(harness.nativeLayerData(), "新实例没有被下发任何数据").toBeNull();
      expect(harness.nativeLayerCalls(), "全程不得调用 clearData").not.toContain("clearData");
      expect(harness.attached("layer"), "同一时刻只有一个实例挂在图上").toBe(1);
      expect(
        (stale as unknown as { attachedMap: unknown }).attachedMap,
        "旧实例连同它的数据一起被丢弃",
      ).toBeNull();

      // 再给数据：当前（空）实例直接 setData，不需要再换实例
      await setProp({ data: POLYGONS });
      expect(harness.nativeLayerData()).toEqual(POLYGONS);
      expect(createdSince(), "从空切回有值不需要再换实例").toBe(created + 1);

      await unmountAndSettle(wrapper);
      harness.assertIdle("data 置空往返");
    });

    it("data 置为 undefined 是**不表态**：不换实例、不产生 SDK 调用、旧数据留在图上", async () => {
      const { wrapper, setProp } = await mountOneVisual(0);
      const created = createdSince();
      const calls = harness.nativeLayerCalls().length;

      await setProp({ data: undefined });
      expect(createdSince(), "不表态不换实例").toBe(created);
      expect(harness.nativeLayerCalls().length, "不表态不产生 SDK 调用").toBe(calls);
      expect(harness.nativeLayerData(), "已画出来的数据保持不变").toEqual(LINES);

      await unmountAndSettle(wrapper);
      harness.assertIdle("data 不表态");
    });

    it("不表态期间换实例（改构造期项）⇒ 数据必须被继承，不能凭空消失", async () => {
      const { wrapper, setProp } = await mountOneVisual(0);
      const created = createdSince();

      await setProp({ data: undefined });
      expect(harness.nativeLayerData(), "前置：旧实例仍有数据").toEqual(LINES);

      // 与 data 无关的构造期项变化 —— 会换实例（#106 评审第二轮 P1 的触发路径）
      await setProp({ enablePicked: false });
      expect(createdSince(), "确认真的换了实例").toBe(created + 1);
      expect(
        harness.nativeLayerData(),
        "新实例必须继承上一代成功送出的数据（不表态 ≠ 清空）",
      ).toEqual(LINES);
      expect(harness.attached("layer"), "同一时刻只有一个实例挂在图上").toBe(1);

      // 账本与 SDK 一致：再给一份**新引用**的数据，仍然会下发（没有被错误地判成「已经写过」）
      const next = { type: "FeatureCollection", features: [LINES.features[1]] };
      await setProp({ data: next });
      expect(harness.nativeLayerData()).toEqual(next);

      await unmountAndSettle(wrapper);
      harness.assertIdle("不表态 + 换实例");
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
      const layer = wrapper.findComponent(LineLayer);

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
      harness.assertIdle("LineLayer 拾取");
    });

    it("data 更新后，同一个要素下标回传的是新 properties", async () => {
      const { wrapper, setProp } = await mountOneVisual(0);
      const layer = wrapper.findComponent(LineLayer);

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
      const layer = wrapper.findComponent(LineLayer);

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
      const state = featureStateOf(wrapper, LineLayer);

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
      const state = featureStateOf(wrapper, LineLayer);

      state.update(["a", "b"], { selected: true });
      expect(state.get()).toEqual({ a: { selected: true }, b: { selected: true } });
      expect(state.get(["b", "missing"])).toEqual({ b: { selected: true } });

      await unmountAndSettle(wrapper);
      harness.assertIdle("Feature State 读回");
    });

    it('idKey=""（空字符串字段名）按**已声明**处理：构造 / 命令 / 拾取三侧口径一致', async () => {
      // 空字符串是合法的 `PropertyKey`（`isUsableItemKey` 照收），上游也没有要求 `idKey` 非空。
      // 因此三处必须同样把它当「已声明」——构造选项照传、命令照执行、拾取按该字段读取。
      const blankKeyData = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "LineString", coordinates: [[116.3, 39.9], [116.4, 39.95]] },
            properties: { "": "line-1" },
          },
        ],
      };
      const props = ref<Record<string, unknown>>({ data: blankKeyData, idKey: "" });
      const wrapper = mountLayerTree(() => h(LineLayer, props.value));
      await settle();

      expect(harness.nativeLayerOptions(), "空字符串字段名照交给 SDK").toMatchObject({ idKey: "" });

      const state = featureStateOf(wrapper, LineLayer);
      const before = harness.nativeLayerCalls().length;
      state.update("line-1", { selected: true });
      expect(harness.nativeLayerCalls().length, "身份已声明 ⇒ 命令真的执行").toBeGreaterThan(before);
      expect(state.get("line-1")).toEqual({ "line-1": { selected: true } });

      const layer = wrapper.findComponent(LineLayer);
      harness.simulateNativePick({ dataIndex: 0 });
      const pick = layer.emitted("click")!.at(-1)![0] as { hit: boolean; id: unknown };
      expect(pick.hit).toBe(true);
      expect(pick.id, 'properties[""] 就是业务键').toBe("line-1");

      await unmountAndSettle(wrapper);
      harness.assertIdle("空字段名");
    });

    it("没有声明 idKey 时命令面**拒绝执行**（不让它悄悄落回 SDK 的默认身份）", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { wrapper } = await mountOneVisual(0, { idKey: undefined });
      const state = featureStateOf(wrapper, LineLayer);
      const before = harness.nativeLayerCalls().length;

      expect(() => state.update("a", { selected: true })).not.toThrow();
      expect(state.get(), "读回同样拒绝（返回空映射）").toEqual({});
      expect(harness.nativeLayerCalls().length, "被拒绝的命令不得碰到 SDK").toBe(before);
      expect(warnLines(warn).some((line) => line.includes("idKey")), "必须告警并点名 idKey").toBe(true);

      await unmountAndSettle(wrapper);
      harness.assertIdle("身份未声明");
    });

    it("非法 id 在调用之前失败（不产生 SDK 调用）", async () => {
      const { wrapper } = await mountOneVisual(0);
      const state = featureStateOf(wrapper, LineLayer);
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
    it("永久销毁 = 先解绑业务监听、再摘图层；全程**不**调用 clearData（这一族没有这个入口）", async () => {
      const { wrapper } = await mountOneVisual(0);
      const raw = lastRawLayer();

      // 顺序只能从替身上读：摘除那一刻业务监听必须已经解绑（领域读数看不出先后）。
      // 这条不变量与 `LayerRegistry.dispose()` 的顺序一致（ADR `2026-09-17` 决策 14）。
      const map = fake.createdMaps[fake.createdMaps.length - 1] as unknown as {
        removeLayer(layer: unknown): void;
      };
      let listenersWhenRemoved: number | null = null;
      const originalRemove = map.removeLayer.bind(map);
      map.removeLayer = (layer) => {
        listenersWhenRemoved = (
          (layer as { getListenerTypes?: () => string[] }).getListenerTypes?.() ?? []
        ).length;
        originalRemove(layer);
      };

      await unmountAndSettle(wrapper);
      expect(listenersWhenRemoved, "摘除那一刻业务监听必须已经解绑").toBe(0);
      expect(raw.callLog, "#106 评审 P1：这一族没有 clearData 入口").not.toContain("clearData");
      expect(harness.attached("layer"), "图层已摘").toBe(0);
      harness.assertIdle("卸载清理");
    });

    it("临时隐藏不释放数据（有 setVisible 的 kind 走 setter）", async () => {
      const { wrapper, setProp } = await mountOneVisual(0, { visible: true });
      const raw = lastRawLayer();

      await setProp({ visible: false });
      expect(harness.nativeLayerAttached(), "隐藏 ≠ 摘掉").toBe(true);
      expect(raw.data, "隐藏不释放数据").toEqual(LINES);
      expect(harness.nativeLayerCalls()).not.toContain("clearData");

      await setProp({ visible: true });
      expect(harness.nativeLayerCalls()).not.toContain("clearData");

      await unmountAndSettle(wrapper);
      harness.assertIdle("隐藏往返");
    });
  });

  describe("§5 逐 kind 的能力面：不假支持", () => {
    it("热力图只声明 data / style / visible（不产生未登记的字段调用）", async () => {
      const props = ref<Record<string, unknown>>({ data: POLYGONS, style: { radius: 30 } });
      const wrapper = mountLayerTree(() => h(HeatmapLayer, props.value));
      await settle();

      expect(createdSince()).toBe(1);
      const calls = harness.nativeLayerCalls();
      expect(calls, "数据走 setData").toContain("setData");
      expect(calls, "样式走扩展 API 的整袋 setOptions").toContain("setOptions");
      // `setVisible` 出现在这里是对的：`visible` 默认 true，内核在挂载后写一次。
      // 4.0.5 声明了它（`Heatmap.d.ts:153`），因此**不再是**「不该产生」的调用。
      // ⚠️ 组件**没有** `opacity` / `zIndex` / 缩放范围 prop（那是 #165 TASK 2 之外的独立决定），
      // 所以这三个调用仍然不该出现——组件没声明的 prop，内核不会去写。
      for (const notDeclared of ["setOpacity", "setZIndex", "setMinZoom", "setMaxZoom"]) {
        expect(calls, `热力图组件没有 ${notDeclared} 这个 prop：不该产生这个调用`).not.toContain(
          notDeclared,
        );
      }

      await unmountAndSettle(wrapper);
      harness.assertIdle("HeatmapLayer");
    });

    it("不表态期间「隐藏 → 显示」不丢数据（4.0.5 声明了 setVisible ⇒ 不换实例）", async () => {
      const props = ref<Record<string, unknown>>({ data: POLYGONS, visible: true });
      const wrapper = mountLayerTree(() => h(HeatmapLayer, props.value));
      await settle();
      const created = createdSince();

      props.value = { ...props.value, data: undefined };
      await settle();
      expect(harness.nativeLayerData(), "前置：旧实例仍有数据").toEqual(POLYGONS);

      // 有 setVisible 的 kind：隐藏是**同一个实例**的 setVisible(false)，
      // 重新显示是 setVisible(true) —— 两种情况都不该换实例，数据也就没有「继承」问题
      props.value = { ...props.value, visible: false };
      await settle();
      props.value = { ...props.value, visible: true };
      await settle();
      expect(createdSince(), "重新可见不换实例").toBe(created);
      expect(harness.nativeLayerData(), "同一实例的数据仍在").toEqual(POLYGONS);

      await unmountAndSettle(wrapper);
      harness.assertIdle("不表态 + 隐藏往返");
    });

    it("热力图：visible 走 setVisible，重新显示**不重建**（#165 TASK 1 的行为后果）", async () => {
      const props = ref<Record<string, unknown>>({ data: POLYGONS, visible: true });
      const wrapper = mountLayerTree(() => h(HeatmapLayer, props.value));
      await settle();
      const created = createdSince();

      props.value = { ...props.value, visible: false };
      await settle();
      // 判据是**实例身份**：仍在图上 + 同一代实例，而不是「调过 setVisible」
      expect(harness.attached("layer"), "有 setVisible ⇒ 实例始终挂在图上").toBe(1);
      expect(harness.nativeLayerVisible(), "setVisible(false) 真的写到了实例").toBe(false);
      expect(createdSince(), "隐藏不重建").toBe(created);

      props.value = { ...props.value, visible: true };
      await settle();
      expect(harness.nativeLayerVisible(), "setVisible(true) 恢复").toBe(true);
      expect(
        createdSince(),
        "**重新显示不重建**——4.0.5 的 Heatmap 声明了 setVisible（Heatmap.d.ts:153）",
      ).toBe(created);

      await unmountAndSettle(wrapper);
      harness.assertIdle("HeatmapLayer 显隐");
    });

    it("热力图：组件没有 opacity / zIndex prop，隐藏走 setVisible（不摘挂）", async () => {
      // 4.0.5 的 `Heatmap` 声明了 `setOpacity`（:157）/ `setZIndex`（:161），Driver 因此登记
      // （登记面本身由 `driver/jsapi-v4/native-layers.test.ts` 逐条对声明核对）。
      // ⚠️ **组件不因此新增 prop**：`<HeatmapLayer>` 的 props 面不在本票范围内。
      const props = ref<Record<string, unknown>>({ data: POLYGONS, visible: true });
      const wrapper = mountLayerTree(() => h(HeatmapLayer, props.value));
      await settle();

      const calls = harness.nativeLayerCalls();
      expect(calls, "组件没声明的 prop 不会被内核写入").not.toContain("setOpacity");
      expect(calls, "组件没声明的 prop 不会被内核写入").not.toContain("setZIndex");
      expect(calls, "visible 默认 true ⇒ 挂载后写一次 setVisible").toContain("setVisible");

      props.value = { ...props.value, visible: false };
      await settle();
      expect(harness.attached("layer"), "有 setVisible ⇒ 隐藏也是挂在图上的").toBe(1);

      await unmountAndSettle(wrapper);
      harness.assertIdle("HeatmapLayer 驱动面");
    });

    it("轨迹线：data → null 真的清掉旧轨迹（不再有「仍在画上一条轨迹」的状态）", async () => {
      const props = ref<Record<string, unknown>>({ data: TRACK });
      const wrapper = mountLayerTree(() => h(TrackLineLayer, props.value));
      await settle();
      expect(harness.nativeLayerData(), "初始轨迹已下发").toEqual(TRACK);
      const created = createdSince();

      // 这一族的登记面里没有清空入口（只有 setData）⇒「没有轨迹」只能由**实例生命周期**表达
      props.value = { ...props.value, data: null };
      await settle();
      expect(createdSince(), "轨道清空 = 换一个没有数据的实例").toBe(created + 1);
      expect(harness.nativeLayerData(), "新实例没有轨迹").toBeNull();
      expect(harness.attached("layer"), "同一时刻只有一条轨道挂在图上").toBe(1);

      // 再给一条轨道：当前实例直接 setData
      const nextTrack = {
        type: "Feature",
        geometry: { type: "LineString", coordinates: [[116.4, 39.9], [116.5, 39.95]] },
        properties: { id: "track-2" },
      };
      props.value = { ...props.value, data: nextTrack };
      await settle();
      expect(harness.nativeLayerData(), "新轨迹覆盖上一条").toEqual(nextTrack);
      expect(createdSince(), "从空切回有值不需要再换实例").toBe(created + 1);

      await unmountAndSettle(wrapper);
      harness.assertIdle("轨迹线 data 往返");
    });

    it("轨迹线基线：只下发数据，没有其它能力调用；显隐走 setVisible", async () => {
      const props = ref<Record<string, unknown>>({ data: TRACK, visible: true });
      const wrapper = mountLayerTree(() => h(TrackLineLayer, props.value));
      await settle();

      expect(createdSince()).toBe(1);
      expect(harness.nativeLayerData()).toEqual(TRACK);
      // `setVisible` 是内核在挂载后写的一次（`visible` 默认 true，4.0.5 声明了它），
      // 不是「多出来的能力调用」——它取代的正是原来的摘挂路径。
      expect(harness.nativeLayerCalls(), "除 setData / setVisible 之外不该有别的调用").toEqual([
        "setVisible",
        "setData",
      ]);

      const created = createdSince();
      props.value = { ...props.value, visible: false };
      await settle();
      expect(harness.attached("layer"), "有 setVisible ⇒ 实例仍在图上").toBe(1);
      expect(harness.nativeLayerVisible(), "setVisible(false) 写到了实例").toBe(false);

      props.value = { ...props.value, visible: true };
      await settle();
      expect(harness.nativeLayerVisible(), "setVisible(true) 恢复").toBe(true);
      expect(createdSince(), "重新显示不重建（TrackLine.d.ts:457）").toBe(created);

      await unmountAndSettle(wrapper);
      harness.assertIdle("TrackLineLayer");
    });

    it("轨迹线：隐藏再显示**不丢播放进度**（4.0.5 声明了 setVisible 之前的真实回归）", async () => {
      const props = ref<Record<string, unknown>>({ data: TRACK, visible: true });
      const wrapper = mountLayerTree(() => h(TrackLineLayer, props.value));
      await settle();
      const layerVm = wrapper.findComponent(TrackLineLayer);
      const created = createdSince();

      // 播到一半
      (layerVm.vm as unknown as { playback: { setProcess(p: number): void } }).playback.setProcess(0.4);
      await settle();
      const first = fake.createdNativeLayers[fake.createdNativeLayers.length - 1]!;
      expect((first as unknown as { process: number }).process).toBe(0.4);

      props.value = { ...props.value, visible: false };
      await settle();
      props.value = { ...props.value, visible: true };
      await settle();

      const last = fake.createdNativeLayers[fake.createdNativeLayers.length - 1]!;
      expect(last, "仍是**同一个**实例").toBe(first);
      expect(
        (last as unknown as { process: number }).process,
        "播放位置扛过了隐藏往返——重建会把进度与播放状态一起丢掉",
      ).toBe(0.4);
      expect(createdSince(), "整条路径不重建").toBe(created);

      await unmountAndSettle(wrapper);
      harness.assertIdle("轨迹线进度往返");
    });

    it("播放命令面：六条命令转发到实例；observed 由 progress / statuschange 事件派生", async () => {
      const wrapper = mountLayerTree(() => h(TrackLineLayer, { data: TRACK }));
      await settle();
      const layer = wrapper.findComponent(TrackLineLayer);
      // `defineExpose` 解包 ref：`vm.observed` 是**值**，每次访问都经 proxy 读 `.value`
      const exposed = layer.vm as unknown as {
        playback: {
          start(): void;
          pause(): void;
          resume(): void;
          stop(): void;
          setSpeed(n: number): void;
          setProcess(p: number): void;
        };
        observed: Record<string, unknown> | null;
      };

      // 命令面转发（Fake 的可观察读数直接读字段）
      exposed.playback.setProcess(0.5);
      exposed.playback.setSpeed(2);
      exposed.playback.start();
      const raw = lastRawTrackLine();
      expect(raw.process).toBe(0.5);
      expect(raw.speed).toBe(2);
      expect(raw.playing).toBe(true);
      expect(harness.nativeLayerCalls()).toEqual(
        expect.arrayContaining(["setData", "setProcess", "setSpeed", "start"]),
      );

      exposed.playback.pause();
      expect(raw.playing).toBe(false);
      exposed.playback.resume();
      expect(raw.playing).toBe(true);
      exposed.playback.stop();
      expect(raw.playing).toBe(false);
      // live 探针：stop 不归零 process（夹具 cmd.stop.observed.process 保持原值）
      expect(raw.process).toBe(0.5);

      // observed 只读事件，不镜像状态机
      expect(exposed.observed).toBeNull();
      harness.emitNativeLayerEvent(-1, "progress", {
        process: 0.25,
        elapsed: 1200,
        distance: 300,
        angle: 45,
      });
      expect(exposed.observed).toMatchObject({ process: 0.25, elapsed: 1200, distance: 300, angle: 45 });

      harness.emitNativeLayerEvent(-1, "statuschange", { status: 1, statusName: "playing" });
      expect(exposed.observed).toMatchObject({ status: 1, statusName: "playing", process: 0.25 });

      await unmountAndSettle(wrapper);
      harness.assertIdle("轨迹线播放命令面");
    });

    it("observed：换代后第一条事件从空快照重建（不混两代 status/progress）", async () => {
      const props = ref<Record<string, unknown>>({ data: TRACK, visible: true });
      const wrapper = mountLayerTree(() => h(TrackLineLayer, props.value));
      await settle();
      const layer = wrapper.findComponent(TrackLineLayer);
      const exposed = layer.vm as unknown as { observed: Record<string, unknown> | null };

      // 第一代：progress + statuschange 都写进同一快照
      harness.emitNativeLayerEvent(-1, "progress", { process: 0.3, elapsed: 500 });
      harness.emitNativeLayerEvent(-1, "statuschange", { status: 1, statusName: "playing" });
      expect(exposed.observed).toMatchObject({ process: 0.3, status: 1, statusName: "playing" });

      // 换代。⚠️ **不能再用 `visible` 触发**：4.0.5 声明了 `TrackLine.setVisible`（`:457`），
      // 重新可见因此走同一个实例的 setter、不换代（见上面「显隐不重建」那条）。仍然会换代的
      // 路径是 `data: null`（换一个没有轨迹的实例）。
      props.value = { ...props.value, data: null };
      await settle();
      // 重建期间不清空：立刻置 null 会让「隐藏再显示」闪一下（注释约定）
      expect(exposed.observed, "重建期间保留上一代读数（不闪 null）").toMatchObject({
        process: 0.3,
        statusName: "playing",
      });

      // 新一代第一条 progress **没有** status ⇒ 快照不得继承上一代 status/statusName
      harness.emitNativeLayerEvent(-1, "progress", { process: 0.8, elapsed: 900 });
      expect(exposed.observed, "新一代从空快照重建").toEqual({ process: 0.8, elapsed: 900 });
      expect(exposed.observed).not.toHaveProperty("status");
      expect(exposed.observed).not.toHaveProperty("statusName");

      await unmountAndSettle(wrapper);
      harness.assertIdle("轨迹线 observed 换代");
    });

    it("setProcess 越界在打到 SDK 之前抛 BMAP_INVALID_ARGUMENT（不静默 clamp）", async () => {
      const wrapper = mountLayerTree(() => h(TrackLineLayer, { data: TRACK }));
      await settle();
      const layer = wrapper.findComponent(TrackLineLayer);
      const exposed = layer.vm as unknown as {
        playback: { setProcess(p: number): void; setSpeed(n: number): void };
      };
      const before = harness.nativeLayerCalls().length;

      expect(() => exposed.playback.setProcess(1.5)).toThrowError(
        expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }),
      );
      expect(() => exposed.playback.setSpeed(0)).toThrowError(
        expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }),
      );
      expect(harness.nativeLayerCalls().length, "非法参数不得碰到 SDK").toBe(before);

      await unmountAndSettle(wrapper);
      harness.assertIdle("轨迹线播放参数校验");
    });

    it("默认可见性策略：hidden 只停观察，不改写 SDK 播放意图（不自动 pause）", async () => {
      const wrapper = mountLayerTree(() => h(TrackLineLayer, { data: TRACK }));
      await settle();
      const layer = wrapper.findComponent(TrackLineLayer);
      const exposed = layer.vm as unknown as {
        playback: { start(): void };
        observed: Record<string, unknown> | null;
      };
      const raw = lastRawTrackLine();

      exposed.playback.start();
      expect(raw.playing).toBe(true);

      // 进入 hidden（默认 pauseOnHidden=false ⇒ 不碰 SDK）
      setVisibility("hidden");
      harness.emitNativeLayerEvent(-1, "progress", { process: 0.3 });
      expect(raw.playing, "默认策略：SDK 继续播（live 探针实测）").toBe(true);
      expect(exposed.observed, "hidden 时停掉本库自己的观察").toBeNull();

      // 回到 shown：恢复观察，SDK 播放状态不受 visibility 影响
      setVisibility("visible");
      harness.emitNativeLayerEvent(-1, "progress", { process: 0.4 });
      expect(exposed.observed).toMatchObject({ process: 0.4 });
      expect(raw.playing).toBe(true);

      await unmountAndSettle(wrapper);
      harness.assertIdle("轨迹线默认可见性");
    });

    it("pauseOnHidden opt-in：hidden 才 pause；用户自己 pause 过的不被 visibility 抢走 resume", async () => {
      const props = ref<Record<string, unknown>>({ data: TRACK, pauseOnHidden: true });
      const wrapper = mountLayerTree(() => h(TrackLineLayer, props.value));
      await settle();
      const layer = wrapper.findComponent(TrackLineLayer);
      const exposed = layer.vm as unknown as {
        playback: { start(): void; pause(): void };
      };
      const raw = lastRawTrackLine();

      exposed.playback.start();
      expect(raw.playing).toBe(true);

      setVisibility("hidden");
      expect(raw.playing, "opt-in 下 hidden 触发 pause").toBe(false);
      setVisibility("visible");
      expect(raw.playing, "shown 且本次是 visibility 发起的 pause ⇒ resume").toBe(true);

      // 用户自己 pause：visibility 不该在 shown 时抢走 resume
      exposed.playback.pause();
      expect(raw.playing).toBe(false);
      setVisibility("hidden");
      setVisibility("visible");
      expect(raw.playing, "用户 pause 过的不被 visibility resume").toBe(false);

      await unmountAndSettle(wrapper);
      setVisibility("visible");
      harness.assertIdle("轨迹线 pauseOnHidden");
    });

    it("pauseOnHidden：hidden 期间重建后 shown 不对新实例发 resume（记账绑 handle）", async () => {
      const props = ref<Record<string, unknown>>({ data: TRACK, pauseOnHidden: true, visible: true });
      const wrapper = mountLayerTree(() => h(TrackLineLayer, props.value));
      await settle();
      const layer = wrapper.findComponent(TrackLineLayer);
      const exposed = layer.vm as unknown as {
        playback: { start(): void };
      };

      exposed.playback.start();
      expect(lastRawTrackLine().playing).toBe(true);

      // hidden：对实例 A 做 visibility pause，并记下 A 的 handle
      setVisibility("hidden");
      const rawA = lastRawTrackLine();
      expect(rawA.playing, "opt-in 下 hidden 触发 pause").toBe(false);
      const createdBeforeRebuild = createdSince();

      // 仍 hidden 时换实例。⚠️ 换代不再走 `visible`：4.0.5 声明了 `setVisible`（`TrackLine.d.ts:457`），
      // 隐藏只是同一个实例的 setter 翻转。仍会换代的路径是 `data: null`（换一个没有轨迹的实例）。
      props.value = { ...props.value, data: null };
      await settle();
      expect(createdSince(), "hidden 期间确实发生了重建").toBe(createdBeforeRebuild + 1);

      const rawB = lastRawTrackLine();
      expect(rawB, "rebuild 后拿到的是新一代实例").not.toBe(rawA);
      expect(rawB.playing, "新实例默认未在播").toBe(false);

      // shown：handle 已换 ⇒ 只清 visibility 账，不把 resume 打到 B 上
      setVisibility("visible");
      expect(rawB.playing, "新实例从未被 visibility pause，不得 resume").toBe(false);
      expect(rawB.callLog, "新实例 callLog 里不得出现 resume").not.toContain("resume");

      await unmountAndSettle(wrapper);
      setVisibility("visible");
      harness.assertIdle("轨迹线 hidden 重建");
    });

    it("pauseOnHidden：start → stop → hidden → visible 不得被反向启动（命令意图）", async () => {
      const wrapper = mountLayerTree(() =>
        h(TrackLineLayer, { data: TRACK, pauseOnHidden: true }),
      );
      await settle();
      const layer = wrapper.findComponent(TrackLineLayer);
      const exposed = layer.vm as unknown as {
        playback: { start(): void; stop(): void };
      };
      const raw = lastRawTrackLine();

      exposed.playback.start();
      exposed.playback.stop();
      expect(raw.playing, "显式 stop 后不播").toBe(false);

      // stop 后 playingIntent=false ⇒ visibility 不得 pause/resume
      setVisibility("hidden");
      expect(raw.callLog, "stop 后 hidden 不该再发 pause").not.toContain("pause");
      setVisibility("visible");
      expect(raw.playing, "start → stop → hidden → visible 不得重新播放").toBe(false);
      expect(raw.callLog, "shown 不得对已 stop 的实例发 resume").not.toContain("resume");

      await unmountAndSettle(wrapper);
      setVisibility("visible");
      harness.assertIdle("轨迹线 stop 后可见性");
    });

    it("pauseOnHidden：从未 start 的 idle 实例 hidden/visible 不碰播放命令", async () => {
      const wrapper = mountLayerTree(() =>
        h(TrackLineLayer, { data: TRACK, pauseOnHidden: true }),
      );
      await settle();
      const layer = wrapper.findComponent(TrackLineLayer);
      const exposed = layer.vm as unknown as Record<string, never>;
      void exposed;

      const raw = lastRawTrackLine();
      expect(raw.playing, "初始 idle").toBe(false);
      expect(raw.callLog, "挂载后无播放命令").not.toContain("start");

      setVisibility("hidden");
      expect(raw.callLog, "idle 不被 visibility pause").not.toContain("pause");
      setVisibility("visible");
      expect(raw.playing, "idle 不被 visibility resume 启动").toBe(false);
      expect(raw.callLog, "idle 的 callLog 里不得出现 resume").not.toContain("resume");

      await unmountAndSettle(wrapper);
      setVisibility("visible");
      harness.assertIdle("轨迹线 idle 可见性");
    });

    it("pauseOnHidden：not-ready start 不留意图，后续 ready 的 hidden→visible 不 pause/resume", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const props = ref<Record<string, unknown>>({ data: TRACK, pauseOnHidden: true });
      const wrapper = mountLayerTree(() => h(TrackLineLayer, props.value));
      // 不 settle：`onMounted` 尚未拿到 readyCtx ⇒ session 为 null（真 not-ready 窗口）
      const layer = wrapper.findComponent(TrackLineLayer);
      const exposed = layer.vm as unknown as { playback: { start(): void } };
      const createdBeforeStart = fake.createdNativeLayers.length;
      exposed.playback.start();
      expect(warn, "not-ready 告警").toHaveBeenCalled();
      warn.mockRestore();
      expect(
        fake.createdNativeLayers.length,
        "not-ready start 不得创建/启动实例",
      ).toBe(createdBeforeStart);

      await settle();
      const raw = lastRawTrackLine();
      expect(raw.playing, "not-ready start 不补发").toBe(false);
      expect(raw.callLog, "ready 后也没有迟到的 start").not.toContain("start");

      setVisibility("hidden");
      expect(raw.callLog, "无意图 ⇒ hidden 不 pause").not.toContain("pause");
      setVisibility("visible");
      expect(raw.playing).toBe(false);
      expect(raw.callLog, "无意图 ⇒ shown 不 resume").not.toContain("resume");

      await unmountAndSettle(wrapper);
      setVisibility("visible");
      harness.assertIdle("轨迹线 not-ready start");
    });

    it("pauseOnHidden：start 后 visible 状态重建，意图不跨代——hidden→visible 不 resume 新 handle", async () => {
      const props = ref<Record<string, unknown>>({ data: TRACK, pauseOnHidden: true });
      const wrapper = mountLayerTree(() => h(TrackLineLayer, props.value));
      await settle();
      const layer = wrapper.findComponent(TrackLineLayer);
      const exposed = layer.vm as unknown as {
        playback: { start(): void };
      };

      exposed.playback.start();
      const rawA = lastRawTrackLine();
      expect(rawA.playing).toBe(true);

      // 仍 visible 时换代。⚠️ 换代不再走 `visible`（4.0.5 声明了 `setVisible`，隐藏不换实例）；
      // 走 `data: null`（换一个没有轨迹的实例）这一条仍会换代的路径。
      props.value = { ...props.value, data: null };
      await settle();
      const rawB = lastRawTrackLine();
      expect(rawB, "重建到新一代").not.toBe(rawA);
      expect(rawB.playing, "新实例未收到 start").toBe(false);

      // 意图绑在 A 上 ⇒ 对 B 既不 pause 也不 resume
      setVisibility("hidden");
      expect(rawB.callLog, "跨代意图不 pause 新 handle").not.toContain("pause");
      setVisibility("visible");
      expect(rawB.playing).toBe(false);
      expect(rawB.callLog, "跨代意图不 resume 新 handle").not.toContain("resume");

      await unmountAndSettle(wrapper);
      setVisibility("visible");
      harness.assertIdle("轨迹线跨代意图");
    });

    it("pauseOnHidden：hidden 中 opt-out（true→false）撤销本库造成的 pause", async () => {
      const props = ref<Record<string, unknown>>({ data: TRACK, pauseOnHidden: true });
      const wrapper = mountLayerTree(() => h(TrackLineLayer, props.value));
      await settle();
      const layer = wrapper.findComponent(TrackLineLayer);
      const exposed = layer.vm as unknown as {
        playback: { start(): void };
      };
      const raw = lastRawTrackLine();

      exposed.playback.start();
      expect(raw.playing).toBe(true);

      setVisibility("hidden");
      expect(raw.playing, "opt-in 下 hidden 由本库 pause").toBe(false);

      // 仍 hidden 时父级关掉 opt-in：本库必须立刻 resume，不能等下一次 visibilitychange
      props.value = { ...props.value, pauseOnHidden: false };
      await settle();
      expect(raw.playing, "opt-out 撤销本库造成的 pause").toBe(true);
      expect(raw.callLog.filter((c) => c === "resume").length, "只 resume 一次").toBe(1);

      setVisibility("visible");
      expect(raw.playing, "shown 不再有 visibility 账可 resume").toBe(true);
      expect(raw.callLog.filter((c) => c === "resume").length, "shown 不重复 resume").toBe(1);

      await unmountAndSettle(wrapper);
      setVisibility("visible");
      harness.assertIdle("轨迹线 pauseOnHidden opt-out");
    });

    it("pauseOnHidden：页面已 hidden 时 opt-in（false→true）立即对有意图的实例 pause", async () => {
      const props = ref<Record<string, unknown>>({ data: TRACK, pauseOnHidden: false });
      const wrapper = mountLayerTree(() => h(TrackLineLayer, props.value));
      await settle();
      const layer = wrapper.findComponent(TrackLineLayer);
      const exposed = layer.vm as unknown as {
        playback: { start(): void };
      };
      const raw = lastRawTrackLine();

      exposed.playback.start();
      expect(raw.playing).toBe(true);

      setVisibility("hidden");
      expect(raw.playing, "未 opt-in：本库不碰 SDK").toBe(true);

      props.value = { ...props.value, pauseOnHidden: true };
      await settle();
      expect(raw.playing, "hidden 中 opt-in 立即 pause").toBe(false);

      setVisibility("visible");
      expect(raw.playing, "shown 恢复本库造成的 pause").toBe(true);

      await unmountAndSettle(wrapper);
      setVisibility("visible");
      harness.assertIdle("轨迹线 pauseOnHidden opt-in");
    });

    it("pauseOnHidden：已在 hidden 时 start/resume 立刻按策略 pause（不绕过 opt-in）", async () => {
      const wrapper = mountLayerTree(() =>
        h(TrackLineLayer, { data: TRACK, pauseOnHidden: true }),
      );
      await settle();
      const layer = wrapper.findComponent(TrackLineLayer);
      const exposed = layer.vm as unknown as {
        playback: { start(): void; resume(): void };
      };
      const raw = lastRawTrackLine();

      // 先进 hidden（尚无意图 ⇒ visibility 不碰 SDK）
      setVisibility("hidden");
      expect(raw.callLog, "无意图时 hidden 不 pause").not.toContain("pause");

      // hidden 中 start：送达后立刻按当前 visibilityState 再跑一遍策略
      exposed.playback.start();
      expect(raw.playing, "hidden 中 start 不得绕过 opt-in 留在播").toBe(false);
      expect(raw.callLog, "先 start 再由本库 pause").toEqual(
        expect.arrayContaining(["start", "pause"]),
      );

      // shown 恢复（本次是 visibility 发起的 pause，意图仍是同一 handle）
      setVisibility("visible");
      expect(raw.playing, "shown 恢复本库造成的 pause").toBe(true);

      // 再 hidden → visibility pause；hidden 中 resume 也必须立刻被再 pause
      setVisibility("hidden");
      expect(raw.playing).toBe(false);
      const resumesBefore = raw.callLog.filter((c) => c === "resume").length;
      exposed.playback.resume();
      expect(raw.playing, "hidden 中 resume 同样不绕过 opt-in").toBe(false);
      expect(raw.callLog.filter((c) => c === "resume").length, "resume 送达了").toBe(
        resumesBefore + 1,
      );
      expect(raw.callLog.at(-1), "紧随其后是本库的 pause").toBe("pause");

      setVisibility("visible");
      expect(raw.playing, "shown 恢复").toBe(true);

      await unmountAndSettle(wrapper);
      setVisibility("visible");
      harness.assertIdle("轨迹线 hidden 中 play 命令");
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
        h(LineLayer, {
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
        "packages/bmap-vue/src/components/layers/TrackLineLayer.vue",
        "packages/bmap-vue/src/components/layers/LineLayer.vue",
        "packages/bmap-vue/src/components/layers/FillLayer.vue",
        "packages/bmap-vue/src/components/layers/HeatmapLayer.vue",
        "packages/bmap-vue/src/components/layers/useVisualLayer.ts",
        "packages/bmap-vue/src/core/composables/useNativeLayerResource.ts",
        "packages/bmap-vue/src/core/data/featureState.ts",
        "packages/bmap-vue/src/core/layers/nativeLayerPick.ts",
        "packages/bmap-vue/src/core/layers/trackLinePlayback.ts",
      ];
      const raw = sources.map((path) => readSource(path)).join("\n");

      // **正证守卫**：先证明真的读到了内容（否则「什么都没读到」也会让下面的反向断言通过）
      expect(raw.length, "必须真的读到源码").toBeGreaterThan(8000);
      expect(raw, "读到的内容里应当包含新组件名").toContain("TrackLineLayer");

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
/* ------------------------------------------------------------------ §8 换实例的失败语义 */

/**
 * `#35 / PR #108` 四轮评审验证出来的失败语义，**迁入共享内核**（`useNativeLayerResource` +
 * `LayerRegistry`）之后在此落回归。三条不变式：
 *
 * 1. **严格替换**：摘除失败时**不解绑监听、不销账**（`scope.dispose()` 不可逆，先解绑会把失败变成
 *    「还在图上但点不动」）；调用方据此放弃这次替换并保留旧实例；
 * 2. **`unknown` 是持久状态**：`removeLayer` 抛错后无法判断资源在不在图上，之后禁止普通写入；
 * 3. **`unknown` 优先于构造指纹**：未知状态必须先收敛，不能让「指纹恰好相等」把它永久冻住
 *    （否则用户把构造项改回旧值之后，组件可能永久空白且再无任何收敛动作）。
 */
describe("§8 换实例的失败语义（严格 detach / unknown）", () => {
  beforeEach(() => {
    harness.reset();
  });

  it("removeLayer「先摘掉再抛错」⇒ 不假装还在，下一次收敛完成换实例", async () => {
    const { wrapper, setProp } = await mountOneVisual(0);
    const created = fake.createdNativeLayers.length;
    expect(harness.attached("layer")).toBe(1);

    // 先真的摘掉、再抛错：调用方**无法判断**它在不在图上
    harness.failNextRemoveLayerAfterDetach();
    await setProp({ idKey: "code" }); // 构造期项变化 ⇒ 换实例

    expect(fake.createdNativeLayers.length, "未确认摘除 ⇒ 不建新实例").toBe(created);
    expect(harness.attached("layer"), "它其实已经不在图上了").toBe(0);
    expect(harness.nativeLayerAttached(created - 1), "旧实例确实已摘除").toBe(false);
    expect(
      harness.layerOps(),
      "每代实例恰好摘一次（不依赖「重复摘除安全」这个未取证的前提）",
    ).toEqual(["addLayer", "removeLayer"]);

    // 「保留旧实例」必须包含**行为**：摘除失败**没有**解绑业务监听 ⇒ 旧实例上的拾取仍然到得了组件。
    // （修前是「先 releaseListeners 再 detach」：监听已经被不可逆地释放掉，这里就一个事件都收不到。）
    const layer = wrapper.findComponent(LineLayer);
    harness.simulateNativePick({ dataIndex: 0 });
    expect(layer.emitted("click"), "旧实例仍然可交互（监听没被提前释放）").toBeTruthy();

    // 下一次收敛（任意 props 变化）把状态推回确定：换实例完成
    await setProp({ idKey: "code", opacity: 0.9 });
    expect(fake.createdNativeLayers.length, "收敛之后新实例建起来").toBe(created + 1);
    expect(harness.attached("layer")).toBe(1);

    await unmountAndSettle(wrapper);
    harness.assertIdle("after-detach 失败");
  });

  it("unknown 优先于构造指纹：把构造项改回旧值也会主动收敛（不静默冻结）", async () => {
    const { wrapper, setProp } = await mountOneVisual(0);
    const created = fake.createdNativeLayers.length;

    harness.failNextRemoveLayerAfterDetach();
    await setProp({ idKey: "code" });
    expect(harness.attached("layer"), "旧实例已不在图上").toBe(0);
    expect(fake.createdNativeLayers.length).toBe(created);

    // 改回旧值 ⇒ 构造指纹重新等于 `instanceKey`；若只看指纹，这里之后就再也不会收敛
    await setProp({ idKey: "id" });
    expect(harness.attached("layer"), "unknown 优先：改回旧值也必须收敛回确定状态").toBe(1);
    expect(fake.createdNativeLayers.length, "收敛 = 换一个确定挂上的新实例").toBe(created + 1);

    await unmountAndSettle(wrapper);
    harness.assertIdle("unknown 优先");
  });
});

/* -------------------------------------------------------------------------- */
/* #165 Class 3 / TASK 2：补齐缺失的构造期选项（每个成员对着官方 .d.ts 的声明行）      */
/* -------------------------------------------------------------------------- */

describe("#165 TASK 2：LineLayer / FillLayer 的 selectedIndex 与 popEvent", () => {
  for (const spec of VISUAL_LAYER_CASES) {
    describe(spec.name, () => {
      it("selectedIndex / popEvent 进构造期选项袋，变化时换实例（官方只有整袋 setBaseOptions）", async () => {
        const props = ref<Record<string, unknown>>({
          ...spec.props,
          selectedIndex: 2,
          popEvent: false,
        });
        const wrapper = mountLayerTree(() => h(spec.component, props.value));
        await settle();

        const created = createdSince();
        const bag = lastRawLayer().options ?? {};
        expect(bag.selectedIndex, "官方 layer/LineLayer.d.ts:25 / FillLayer.d.ts:30").toBe(2);
        expect(bag.popEvent, "官方 layer/LineLayer.d.ts:70 / FillLayer.d.ts:75").toBe(false);
        expect(createdSince()).toBe(1);

        // 构造选项 ⇒ 变化换实例（官方没有「就地改选中索引」的入口）
        props.value = { ...props.value, selectedIndex: 3 };
        await settle();
        expect(createdSince(), "构造期项变化 ⇒ 换实例").toBe(created + 1);
        expect(lastRawLayer().options?.selectedIndex).toBe(3);

        props.value = { ...props.value, popEvent: true };
        await settle();
        expect(createdSince(), "popEvent 也是构造期项").toBe(created + 2);
        expect(lastRawLayer().options?.popEvent).toBe(true);

        await unmountAndSettle(wrapper);
        harness.assertIdle(`${spec.name} TASK2`);
      });

      it("不传时两个键都不进选项袋（不替上游表态默认选中索引）", async () => {
        const props = ref<Record<string, unknown>>({ ...spec.props });
        const wrapper = mountLayerTree(() => h(spec.component, props.value));
        await settle();

        const bag = lastRawLayer().options ?? {};
        expect(bag, "没传 selectedIndex 就不该出现这个键（官方默认 -1）").not.toHaveProperty(
          "selectedIndex",
        );
        expect(bag, "没传 popEvent 就不该出现这个键（官方默认 true）").not.toHaveProperty("popEvent");

        await unmountAndSettle(wrapper);
        harness.assertIdle(`${spec.name} TASK2 缺省`);
      });
    });
  }
});

describe("#165 TASK 2：PointLayer 的拾取与绘制选项", () => {
  const POINTS = [
    { id: "p-1", position: [116.404, 39.915] },
    { id: "p-2", position: [116.42, 39.93] },
  ];
  const base = {
    data: POINTS,
    itemKey: "id",
    getPosition: (item: { position: [number, number] }) => item.position,
  };

  it("iconSize / mouseStyleChange / pickTolerance / pickThrough / renderStage 进样式袋且不换实例", async () => {
    const props = ref<Record<string, unknown>>({ ...base });
    const wrapper = mountLayerTree(() => h(PointLayer, props.value));
    await settle();
    const created = createdSince();

    props.value = {
      ...props.value,
      iconSize: [24, 32],
      mouseStyleChange: false,
      pickTolerance: 8,
      pickThrough: true,
      renderStage: "poi",
    };
    await settle();

    const bag = harness.nativeLayerOptions();
    expect(bag.iconSize, "官方 visualization/PointLayer.d.ts:135").toEqual([24, 32]);
    expect(bag.mouseStyleChange, "…:153").toBe(false);
    expect(bag.pickTolerance, "…:158 —— 官方没给 pickWidth/pickHeight，容差才是它的拾取入口").toBe(8);
    expect(bag.pickThrough, "…:163").toBe(true);
    expect(bag.renderStage, "…:196").toBe("poi");
    expect(createdSince(), "样式袋变化不换实例").toBe(created);

    await unmountAndSettle(wrapper);
    harness.assertIdle("PointLayer TASK2");
  });

  it("mouseStyleChange / pickThrough 不传时不会变成 Vue 的缺省 false（官方默认 true / false）", async () => {
    const wrapper = mountLayerTree(() => h(PointLayer, { ...base }));
    await settle();

    const bag = harness.nativeLayerOptions();
    expect(bag, "没传 mouseStyleChange 就不该有（缺省 false 会静默关掉「命中换光标」）").not.toHaveProperty(
      "mouseStyleChange",
    );
    expect(bag, "pickThrough 同理").not.toHaveProperty("pickThrough");

    await unmountAndSettle(wrapper);
    harness.assertIdle("PointLayer 布尔缺省");
  });

  it("referCenter：纯数据 {lng,lat} 由 Driver 换算成官方 BMap.Point", async () => {
    const wrapper = mountLayerTree(() => h(PointLayer, {
      ...base,
      referCenter: { lng: 116.404, lat: 39.915 },
    }));
    await settle();

    const raw = harness.nativeLayerOptions().referCenter as
      | { lng?: unknown; lat?: unknown }
      | undefined;
    expect(raw, "referCenter 必须真的送到 SDK（visualization/PointLayer.d.ts:191）").toBeTruthy();
    expect(raw.lng).toBeCloseTo(116.404);
    expect(raw.lat).toBeCloseTo(39.915);
    // 换算后不能还是纯对象 —— 那样只是「原样透传了组件层的数据」
    expect(
      Object.getPrototypeOf(raw),
      "换算后应当是官方 Point 实例而不是纯对象",
    ).not.toBe(Object.prototype);

    await unmountAndSettle(wrapper);
    harness.assertIdle("PointLayer referCenter");
  });
});

describe("#165 TASK 2：PointIconLayer 缺失的 PointIconStyle 字段", () => {
  const POINTS = [{ id: "p-1", position: [116.404, 39.915] }];
  const base = {
    data: POINTS,
    itemKey: "id",
    getPosition: (item: { position: [number, number] }) => item.position,
  };

  it("iconObj / visibility / sizes / userSizes / 逐要素 opacity 五个都进样式袋", async () => {
    const props = ref<Record<string, unknown>>({ ...base });
    const wrapper = mountLayerTree(() => h(PointIconLayer, props.value));
    await settle();
    const created = createdSince();

    const iconObj = (): { id: number; canvas: HTMLCanvasElement } => ({
      id: 7,
      canvas: document.createElement("canvas"),
    });
    props.value = {
      ...props.value,
      iconObj,
      visibility: true,
      sizes: [16, 16] as [number, number],
      userSizes: true,
      featureOpacity: 0.5,
    };
    await settle();

    const style = harness.nativeLayerStyle();
    // ⚠️ **不是** `toBe(iconObj)`：样式袋里的函数会被 `projectLayerStyle` 包成身份恒定的
    // `forwardCallback`（内联箭头每次渲染都是新函数，不包的话每次渲染都会重写样式）。
    // 因此这里断言「SDK 调得到、且调到的是**当前**实现」，而不是函数身份。
    expect(typeof style.iconObj, "官方 layer/PointIconLayer.d.ts:101 —— SDK 拿到的是函数").toBe(
      "function",
    );
    const handed = style.iconObj as () => { id: number; canvas: HTMLCanvasElement };
    expect(handed(), "包装函数转发到当前 prop").toEqual({ id: 7, canvas: expect.anything() });
    expect(style.visibility, "…:105").toBe(true);
    expect(style.sizes, "…:108").toEqual([16, 16]);
    expect(style.userSizes, "…:117").toBe(true);
    expect(style.opacity, "…:127 —— 逐要素 opacity 落在样式袋的 opacity 键").toBe(0.5);
    expect(createdSince(), "样式袋变化不换实例").toBe(created);

    await unmountAndSettle(wrapper);
    harness.assertIdle("PointIconLayer TASK2");
  });

  it("visibility / userSizes 不传时不会落到 Vue 的缺省 false（官方默认都是 true）", async () => {
    const wrapper = mountLayerTree(() => h(PointIconLayer, { ...base }));
    await settle();

    const style = harness.nativeLayerStyle();
    expect(style, "没传 visibility 就不该有（缺省 false 会把所有图标关掉）").not.toHaveProperty(
      "visibility",
    );
    expect(style, "没传 userSizes 就不该有（缺省 false 会覆盖掉 sizes）").not.toHaveProperty("userSizes");

    await unmountAndSettle(wrapper);
    harness.assertIdle("PointIconLayer 布尔缺省");
  });
});
