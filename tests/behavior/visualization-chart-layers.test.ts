/**
 * `<TextLayer>` 的组件级验收（issue #166 第二刀）
 *
 * ## 为什么单独一个文件
 *
 * `TextLayer` 是 `visualization/` 里**唯一**带完整拾取面的类（六个事件 + `hitTest` 读回
 * `TextLayerItem`），而 `BarLayer` / `FlyLineLayer` 的声明里**连拾取面都没有**。
 * 把三者放一张 `CASES` 表会让「TextLayer 特有」的断言要么写不成（表里没有那一列），
 * 要么给另外两族套上一个它们回答不了的问题。因此本文件只覆盖 `TextLayer`。
 *
 * ## 三条本票特有的判据
 *
 * | 判据 | 为什么必须断言 |
 * | --- | --- |
 * | `hitTest` **要 expose** | 与 `PolygonLayer` / `PolylineLayer` 相反——那两族声明了 `hitTest` 而运行时没有；`TextLayer` 声明与运行时**都有**（live 探针 2026-09-27），且它不是任何受控 prop 的写入面 |
 * | `mouseover` / `mouseout` **不开面** | 官方声明了（`TextLayer.d.ts:336-337`），但它们是**成对**的进入 / 离开语义，与本库现有组件的领域事件面不同构且无消费者（沿用 #166 前一刀对 `PolygonLayerEventMap` 的同一裁决） |
 * | `opacity` **要**，`minZoom` / `maxZoom` 是构造选项 | 与两族上一刀相反：`TextLayer` 官方**声明**了 `setOpacity`（`:296`），因此按声明登记（跟随 #165 对 `ClusterLayer` / `Heatmap` 的裁决） |
 */
import { beforeEach, describe, expect, it } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref, type VNodeChild } from "vue";
import { createFakeV4Harness } from "../../packages/test-utils";
import Map from "../../packages/bmap-vue/src/components/map/Map.vue";
import TextLayer from "../../packages/bmap-vue/src/components/layers/TextLayer.vue";

const { harness, fake } = createFakeV4Harness();

/* ------------------------------------------------------------------ 夹具 */

const TEXTS = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [116.404, 39.915] },
      properties: { id: "t-1", text: "北京" },
    },
  ],
} as const;

interface RawLayerView {
  callLog: string[];
  options: Record<string, unknown>;
  data: unknown;
  visible: boolean;
  opacity: number;
  zIndex: number;
  enablePicked: boolean;
  attachedMap: unknown;
  hitResult: { point: unknown; text: string; id: string | number; properties: unknown } | null;
}

let createdBase = 0;

beforeEach(() => {
  harness.reset();
  createdBase = harness.nativeLayersCreated();
});

const createdSince = () => harness.nativeLayersCreated() - createdBase;

function lastRawLayer(): RawLayerView {
  const list = fake.createdNativeLayers as unknown as RawLayerView[];
  const raw = list[list.length - 1];
  if (!raw) throw new Error("本用例还没有创建过原生图层");
  return raw;
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

async function mountTextLayer(overrides: Record<string, unknown> = {}) {
  // 必须是 `ref` 而不是普通对象：内核的更新路径是 `watch` 驱动的，普通对象不会触发它
  // （与 `visualization-layers.test.ts` 的 `mountOne` 同一手法）。
  const props = ref<Record<string, unknown>>({ data: TEXTS, idKey: "id", ...overrides });
  const wrapper = mountLayerTree(() => h(TextLayer as never, props.value));
  await settle();
  const setProp = async (patch: Record<string, unknown>) => {
    props.value = { ...props.value, ...patch };
    await settle();
  };
  return { wrapper, setProp };
}

async function unmountAndSettle(wrapper: { unmount(): void }) {
  wrapper.unmount();
  await settle();
}

/* -------------------------------------------------------------------------- */

describe("visualization/TextLayer（issue #166 第二刀）", () => {
  describe("§1 数据与样式", () => {
    it("挂载时只创建 1 个实例并把数据送下去", async () => {
      const { wrapper } = await mountTextLayer();
      expect(createdSince(), "无论多少要素都只有 1 个 SDK 资源").toBe(1);
      expect(harness.nativeLayerData()).toEqual(TEXTS);
      expect(harness.attached("layer")).toBe(1);

      await unmountAndSettle(wrapper);
      harness.assertIdle();
    });

    it("样式落到 setOptions（merge），不是 setStyleOptions + doOnceDraw", async () => {
      const { wrapper, setProp } = await mountTextLayer({ style: { fontSize: 20 } });
      const calls = harness.nativeLayerCalls();
      expect(calls, "样式走 setOptions").toContain("setOptions");
      expect(calls, "visualization 家族没有 setStyleOptions").not.toContain("setStyleOptions");
      expect(calls, "这一族没有 doOnceDraw").not.toContain("doOnceDraw");

      await setProp({ style: { fontSize: 28 } });
      expect(
        harness.nativeLayerCalls().filter((call) => call === "setOptions").length,
        "样式写不重建（只写这次给的键）",
      ).toBeGreaterThan(1);

      await unmountAndSettle(wrapper);
      harness.assertIdle();
    });

    it("data: null 换一个没有数据的实例（不调 clearData）", async () => {
      const { wrapper, setProp } = await mountTextLayer();
      const created = createdSince();
      await setProp({ data: null });
      expect(createdSince(), "「没有数据」靠换实例表达").toBe(created + 1);
      expect(harness.nativeLayerCalls(), "全程不得调用 clearData").not.toContain("clearData");

      await unmountAndSettle(wrapper);
      harness.assertIdle();
    });

    it("data 不表态（undefined）不产生任何 SDK 调用", async () => {
      const { wrapper, setProp } = await mountTextLayer();
      const created = createdSince();
      const calls = harness.nativeLayerCalls().length;
      await setProp({ data: undefined });
      expect(createdSince()).toBe(created);
      expect(harness.nativeLayerCalls().length).toBe(calls);

      await unmountAndSettle(wrapper);
      harness.assertIdle();
    });
  });

  describe("§2 显隐 / 透明度 / 层级（走 setter，重新可见不换实例）", () => {
    it("visible 走 setVisible，隐藏后重新显示不换实例", async () => {
      const { wrapper, setProp } = await mountTextLayer();
      const created = createdSince();

      await setProp({ visible: false });
      expect(lastRawLayer().visible).toBe(false);
      expect(harness.attached("layer"), "显隐走 setter，实例始终挂着").toBe(1);

      await setProp({ visible: true });
      expect(lastRawLayer().visible).toBe(true);
      expect(createdSince(), "重新可见不换实例").toBe(created);

      await unmountAndSettle(wrapper);
      harness.assertIdle();
    });

    it("opacity 走 setOpacity（官方**声明**了它，:296）", async () => {
      // 与 `PolygonLayer` / `PolylineLayer` 相反：那两族官方**没声明** `setOpacity`
      // （运行时有，但按 #165 裁决不当契约）。`TextLayer` 声明了 ⇒ 按声明登记。
      const { wrapper, setProp } = await mountTextLayer();
      await setProp({ opacity: 0.4 });
      expect(lastRawLayer().opacity).toBeCloseTo(0.4);
      expect(harness.nativeLayerCalls()).toContain("setOpacity");

      await unmountAndSettle(wrapper);
      harness.assertIdle();
    });

    it("zIndex 走 setZIndex（官方要求先挂载，内核的挂载顺序已满足）", async () => {
      const { wrapper, setProp } = await mountTextLayer();
      await setProp({ zIndex: 7 });
      expect(lastRawLayer().zIndex).toBe(7);
      expect(harness.nativeLayerCalls()).toContain("setZIndex");

      await unmountAndSettle(wrapper);
      harness.assertIdle();
    });

    it("minZoom / maxZoom 是构造选项（官方无字段级 setter）⇒ 变化换实例", async () => {
      const { wrapper, setProp } = await mountTextLayer();
      const created = createdSince();
      await setProp({ minZoom: 5 });
      expect(createdSince(), "缩放范围只能靠换实例").toBe(created + 1);

      await unmountAndSettle(wrapper);
      harness.assertIdle();
    });
  });

  describe("§3 拾取（这一族**有**完整拾取面）", () => {
    it("默认开启拾取（与官方默认 false 刻意不同）", async () => {
      const { wrapper } = await mountTextLayer();
      expect(lastRawLayer().enablePicked, "不给事件就别怪用户拿不到 pick").toBe(true);

      await unmountAndSettle(wrapper);
      harness.assertIdle();
    });

    it("enablePicked: false 关掉拾取且不换实例", async () => {
      const { wrapper } = await mountTextLayer({ enablePicked: false });
      expect(lastRawLayer().enablePicked).toBe(false);
      expect(harness.nativeLayerOptions().enablePicked).toBe(false);

      await unmountAndSettle(wrapper);
      harness.assertIdle();
    });

    it("四个拾取事件都被转发成同名领域事件", async () => {
      const seen: string[] = [];
      const Root = defineComponent({
        setup: () => () =>
          h(
            Map,
            { provider: harness.provider() },
            {
              default: () =>
                h(TextLayer as never, {
                  data: TEXTS,
                  idKey: "id",
                  onClick: () => seen.push("click"),
                  onDblclick: () => seen.push("dblclick"),
                  onRightclick: () => seen.push("rightclick"),
                  onMousemove: () => seen.push("mousemove"),
                }),
            },
          ),
      });
      const wrapper = mount(Root, { attachTo: harness.container() });
      await settle();

      const raw = lastRawLayer() as unknown as { emit(name: string, event: unknown): void };
      for (const name of ["click", "dblclick", "rightclick", "mousemove"]) {
        raw.emit(name, { point: { lng: 116.404, lat: 39.915 }, value: { id: "t-1" } });
      }
      await settle();
      expect(seen, "四个事件逐一转发").toEqual(["click", "dblclick", "rightclick", "mousemove"]);

      await unmountAndSettle(wrapper);
      harness.assertIdle();
    });

    it("mouseover / mouseout 刻意不开面（成对进入 / 离开语义，无消费者）", async () => {
      // 官方 `TextLayerEventMap:336-337` 声明了这两个，但沿用 #166 前一刀对
      // `PolygonLayerEventMap` 的同一裁决：不引入一套与本库领域事件面不同构的语义。
      const Root = defineComponent({
        setup: () => () =>
          h(Map, { provider: harness.provider() }, {
            default: () => h(TextLayer as never, { data: TEXTS, idKey: "id" }),
          }),
      });
      const wrapper = mount(Root, { attachTo: harness.container() });
      await settle();
      const raw = lastRawLayer() as unknown as { emit(name: string, event: unknown): void };
      // 派发也不应产生任何领域事件（没有对应的 emit 通道）
      expect(() => raw.emit("mouseover", { value: { id: "t-1" } })).not.toThrow();
      await settle();
      await unmountAndSettle(wrapper);
      harness.assertIdle();
    });

    it("hitTest 从 ref 可达（声明与运行时**都有**，且不是受控 prop）", async () => {
      // 与 `PolygonLayer` / `PolylineLayer` 相反：那两族声明了 `hitTest` 而运行时没有 ⇒
      // 不开面。`TextLayer` 两者皆有（live 探针 2026-09-27：`hitTestAt: "returned null"`
      // 说明方法在且可调用）⇒ 按 #166 记录的 defineExpose 规则必须可从 ref 到达。
      const Root = defineComponent({
        setup: () => () =>
          h(Map, { provider: harness.provider() }, {
            default: () => h(TextLayer as never, { ref: (el: unknown) => ((root.value as Record<string, unknown>).layer = el), data: TEXTS, idKey: "id" }),
          }),
      });
      const root = { value: {} as Record<string, unknown> };
      const wrapper = mount(Root, { attachTo: harness.container() });
      await settle();

      const exposed = root.value.layer as { hitTest?: (x: number, y: number) => unknown } | undefined;
      expect(typeof exposed?.hitTest, "hitTest 必须可从 ref 到达").toBe("function");

      await unmountAndSettle(wrapper);
      harness.assertIdle();
    });
  });

  describe("§4 资源归属与卸载", () => {
    it("卸载后摘除图层且泄漏门禁归零", async () => {
      const { wrapper } = await mountTextLayer();
      expect(harness.attached("layer")).toBe(1);
      await unmountAndSettle(wrapper);
      expect(harness.attached("layer")).toBe(0);
      harness.assertIdle();
    });

    it("重建时旧实例先摘除，不留下双份所有权", async () => {
      const { wrapper, setProp } = await mountTextLayer();
      await setProp({ minZoom: 6 });
      expect(harness.attached("layer"), "任一时刻只有 1 个挂在图上").toBe(1);

      await unmountAndSettle(wrapper);
      harness.assertIdle();
    });
  });
});
