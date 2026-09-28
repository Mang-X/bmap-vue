/**
 * `<PolygonLayer>` / `<PolylineLayer>` 的组件级验收（issue #166）
 *
 * 官方 4.0.5 在 `visualization/` 新增这两个类，作为**同版本弃用**的
 * `FillLayer` / `LineLayer` 的**官方指定替代**。本文件回答的验收问题：
 *
 * | #166 的验收条目 | 落点 |
 * | --- | --- |
 * | 每个落地的类有**成员级**核对结果（不是「名称清单一致」） | `docs/zh-CN/contributing/166-visualization-alignment-audit.md`（逐条带声明行号 + live 读数）；本文件锁住**可观察的**那一半 |
 * | 每个公开成员都有官方声明出处 | `driver/jsapi-v4/native-layers.test.ts` 的「操作面 ↔ 官方声明」门禁（已把两个 kind 加进 `DECLARED_CTORS`） |
 * | 资源归属与卸载路径有行为用例，泄漏门禁归零 | §4（每节末尾的 `harness.assertIdle()`） |
 * | 不为新组件回改已冻结的旧组件公共面 | §5（源码级反向门禁：`<FillLayer>` / `<LineLayer>` 的文件没被本票碰过） |
 *
 * ## 用例只写领域读数
 *
 * 与 `native-data-layers.test.ts` 同一手法：默认读 `harness.nativeLayerCalls()` /
 * `harness.nativeLayerData()` / `harness.nativeLayerOptions()` / `harness.attached('layer')`，
 * 只有「必须确认 SDK 侧真正收到哪个成员」的那几条才落到替身实例上，并显式说明理由。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineComponent, h, nextTick, ref, type VNodeChild } from "vue";
import { createFakeV4Harness, stripComments } from "../../packages/test-utils";
import Map from "../../packages/bmap-vue/src/components/map/Map.vue";
import PolygonLayer from "../../packages/bmap-vue/src/components/layers/PolygonLayer.vue";
import PolylineLayer from "../../packages/bmap-vue/src/components/layers/PolylineLayer.vue";

const { harness, fake } = createFakeV4Harness();

/* ------------------------------------------------------------------ 夹具 */

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

const POLYLINES = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[116.3, 39.9], [116.4, 39.95]] },
      properties: { id: "road-1" },
    },
  ],
};

const CASES = [
  { name: "PolygonLayer", component: PolygonLayer, data: POLYGONS, style: { strokeWeight: 2 } },
  { name: "PolylineLayer", component: PolylineLayer, data: POLYLINES, style: { strokeWeight: 2 } },
] as const;

/** 替身实例上本文件读到的字段（显式列出，读起来就是「依赖替身的哪几项」）。 */
interface RawLayerView {
  callLog: string[];
  options: Record<string, unknown>;
  data: unknown;
  visible: boolean;
  zIndex: number;
  enablePicked: boolean;
  attachedMap: unknown;
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

async function mountOne(index: number, overrides: Record<string, unknown> = {}) {
  const entry = CASES[index]!;
  const props = ref<Record<string, unknown>>({
    data: entry.data,
    idKey: "id",
    ...overrides,
  });
  const wrapper = mountLayerTree(() => h(entry.component as never, props.value));
  await settle();
  const setProp = async (patch: Record<string, unknown>) => {
    props.value = { ...props.value, ...patch };
    await settle();
  };
  return { wrapper, props, setProp, entry };
}

async function unmountAndSettle(wrapper: { unmount(): void }) {
  wrapper.unmount();
  await settle();
}

function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

/* -------------------------------------------------------------------------- */

describe("visualization/PolygonLayer / PolylineLayer（issue #166）", () => {
  describe("§1 数据与样式", () => {
    it.each(CASES.map((entry, index) => [entry.name, index] as const))(
      "%s：挂载时只创建 1 个实例并把数据送下去",
      async (_name, index) => {
        const { wrapper } = await mountOne(index);
        expect(createdSince(), "无论多少要素都只有 1 个 SDK 资源").toBe(1);
        expect(harness.nativeLayerData()).toEqual(CASES[index]!.data);
        expect(harness.attached("layer")).toBe(1);

        await unmountAndSettle(wrapper);
        harness.assertIdle(`${CASES[index]!.name} 卸载`);
      },
    );

    it.each(CASES.map((entry, index) => [entry.name, index] as const))(
      "%s：data 变化走 setData，不换实例",
      async (_name, index) => {
        const { wrapper, setProp } = await mountOne(index);
        const created = createdSince();
        const next = CASES[index]!.data;

        await setProp({ data: { ...next } });
        expect(harness.nativeLayerData()).toEqual(next);
        expect(createdSince(), "data 变化不换实例").toBe(created);

        await unmountAndSettle(wrapper);
        harness.assertIdle();
      },
    );

    it.each(CASES.map((entry, index) => [entry.name, index] as const))(
      "%s：data: null 换一个没有数据的实例（不调 clearData）",
      async (_name, index) => {
        const { wrapper, setProp } = await mountOne(index);
        const created = createdSince();

        await setProp({ data: null });
        expect(createdSince(), "「没有数据」靠换实例表达").toBe(created + 1);
        // ⚠️ 官方**声明**了 clearData（`PolygonLayer.d.ts:174` / `PolylineLayer.d.ts:206`），
        // Driver 也登记了它，但组件**刻意不调用**——同一个 `data: null` 在不同 kind 上换
        // 语义（有的调 clearData、有的换实例）是使用者最难预期的一类差异。
        expect(harness.nativeLayerCalls(), "全程不得调用 clearData").not.toContain("clearData");

        await unmountAndSettle(wrapper);
        harness.assertIdle();
      },
    );

    it.each(CASES.map((entry, index) => [entry.name, index] as const))(
      "%s：data 不表态（undefined）不产生任何 SDK 调用",
      async (_name, index) => {
        const { wrapper, setProp } = await mountOne(index);
        const created = createdSince();
        const calls = harness.nativeLayerCalls().length;

        await setProp({ data: undefined });
        expect(createdSince()).toBe(created);
        expect(harness.nativeLayerCalls().length).toBe(calls);

        await unmountAndSettle(wrapper);
        harness.assertIdle();
      },
    );

    it("样式落到 setOptions（merge），**不是** setStyleOptions + doOnceDraw", async () => {
      // `layer/` 家族是 `setStyleOptions` + `doOnceDraw`；`visualization/` 两族是 `setOptions`
      // 且**没有** `doOnceDraw`（`PolygonLayer.d.ts:181` / `PolylineLayer.d.ts:213`）。
      // 跟着旧族写会调到上游没有的成员——本条把这条判据钉成可观察行为。
      for (const index of [0, 1]) {
        harness.reset();
        createdBase = harness.nativeLayersCreated();
        const { wrapper, setProp } = await mountOne(index, { style: { strokeWeight: 5 } });

        let calls = harness.nativeLayerCalls();
        expect(calls, "样式走 setOptions").toContain("setOptions");
        expect(calls, "这一族没有 setStyleOptions").not.toContain("setStyleOptions");
        expect(calls, "这一族没有 doOnceDraw").not.toContain("doOnceDraw");

        await setProp({ style: { strokeWeight: 8 } });
        calls = harness.nativeLayerCalls();
        expect(calls.filter((call) => call === "setOptions").length).toBeGreaterThan(1);

        await unmountAndSettle(wrapper);
        harness.assertIdle();
      }
    });
  });

  describe("§2 显隐 / 层级（走 setter，重新可见不换实例）", () => {
    it.each(CASES.map((entry, index) => [entry.name, index] as const))(
      "%s：visible 走 setVisible，隐藏后重新显示**不换实例**",
      async (_name, index) => {
        const { wrapper, setProp } = await mountOne(index);
        const created = createdSince();

        await setProp({ visible: false });
        expect(lastRawLayer().visible).toBe(false);
        expect(harness.nativeLayerCalls()).toContain("setVisible");
        // 显隐走 setter ⇒ 实例始终挂着（addLayer/removeLayer 表达的是「在不在图上」）
        expect(harness.attached("layer")).toBe(1);

        await setProp({ visible: true });
        expect(lastRawLayer().visible).toBe(true);
        expect(createdSince(), "重新可见不换实例").toBe(created);

        await unmountAndSettle(wrapper);
        harness.assertIdle();
      },
    );

    it.each(CASES.map((entry, index) => [entry.name, index] as const))(
      "%s：zIndex 走 setZIndex",
      async (_name, index) => {
        const { wrapper, setProp } = await mountOne(index);
        await setProp({ zIndex: 4 });
        expect(lastRawLayer().zIndex).toBe(4);
        expect(harness.nativeLayerCalls()).toContain("setZIndex");

        await unmountAndSettle(wrapper);
        harness.assertIdle();
      },
    );

    it.each(CASES.map((entry, index) => [entry.name, index] as const))(
      "%s：minZoom / maxZoom 是**构造选项**（官方无字段级 setter）⇒ 换实例",
      async (_name, index) => {
        const { wrapper, setProp } = await mountOne(index, { minZoom: 5, maxZoom: 18 });
        expect(harness.nativeLayerOptions()).toMatchObject({ minZoom: 5, maxZoom: 18 });
        const created = createdSince();

        await setProp({ minZoom: 6 });
        expect(createdSince(), "缩放范围没有 setter，只能换实例").toBe(created + 1);
        // ⚠️ 绝不能去调 setMinZoom / setMaxZoom：官方没声明，live 实测运行时也不存在。
        expect(harness.nativeLayerCalls()).not.toContain("setMinZoom");
        expect(harness.nativeLayerCalls()).not.toContain("setMaxZoom");

        await unmountAndSettle(wrapper);
        harness.assertIdle();
      },
    );
  });

  describe("§3 拾取", () => {
    it.each(CASES.map((entry, index) => [entry.name, index] as const))(
      "%s：默认开启拾取（与官方默认 false **不同**，刻意如此）",
      async (_name, index) => {
        const { wrapper } = await mountOne(index);
        expect(harness.nativeLayerOptions()).toMatchObject({ enablePicked: true });
        expect(lastRawLayer().enablePicked).toBe(true);

        await unmountAndSettle(wrapper);
        harness.assertIdle();
      },
    );

    it.each(CASES.map((entry, index) => [entry.name, index] as const))(
      "%s：mouseStyleChange 不传时**不下发**（官方默认 true，Vue 缺省会转成 false）",
      async (_name, index) => {
        // #165 结论六记录的同一个坑：官方默认 `true` 而 Vue 缺省给 `false`，
        // 不显式 `undefined` 就让每个不传它的用户静默偏离官方。
        const { wrapper } = await mountOne(index);
        expect(
          "mouseStyleChange" in harness.nativeLayerOptions(),
          "没传就不能进构造袋——否则等于替上游表态成 false",
        ).toBe(false);

        await unmountAndSettle(wrapper);
        harness.assertIdle();
      },
    );

    it.each(CASES.map((entry, index) => [entry.name, index] as const))(
      "%s：mouseStyleChange 传了才进构造袋",
      async (_name, index) => {
        const { wrapper } = await mountOne(index, { mouseStyleChange: true });
        expect(harness.nativeLayerOptions()).toMatchObject({ mouseStyleChange: true });

        await unmountAndSettle(wrapper);
        harness.assertIdle();
      },
    );

    it.each(CASES.map((entry, index) => [entry.name, index] as const))(
      "%s：构造袋**不含** layer/ 家族那几项（官方选项表里没有）",
      async (_name, index) => {
        // `crs` / `pickWidth` / `pickHeight` / `autoSelect` / `selectedColor` /
        // `selectedIndex` / `popEvent` 在 `visualization/` 下 `grep` 是 0 命中
        // （#165 的 H2 条已实测）。塞进构造袋会被**静默丢弃**（构造器没有官方那句告警），
        // 属 AGENTS.md 禁止的「接收后忽略属于假支持」。
        const { wrapper } = await mountOne(index, {
          enablePicked: true,
          pickTolerance: 6,
          pickThrough: true,
        });
        const options = harness.nativeLayerOptions();
        for (const key of [
          "crs",
          "pickWidth",
          "pickHeight",
          "autoSelect",
          "selectedColor",
          "selectedIndex",
          "popEvent",
        ]) {
          expect(options, `${key} 官方没声明，不得进构造袋`).not.toHaveProperty(key);
        }
        expect(options).toMatchObject({ pickTolerance: 6, pickThrough: true });

        await unmountAndSettle(wrapper);
        harness.assertIdle();
      },
    );
  });

  describe("§4 资源归属与卸载", () => {
    it.each(CASES.map((entry, index) => [entry.name, index] as const))(
      "%s：卸载后泄漏门禁归零",
      async (_name, index) => {
        const { wrapper, setProp } = await mountOne(index, { style: { strokeWeight: 2 } });
        await setProp({ visible: false });
        await setProp({ visible: true });

        await unmountAndSettle(wrapper);
        expect(harness.attached("layer"), "卸载后不得留在图上").toBe(0);
        harness.assertIdle();
      },
    );

    it("两个组件同时挂载：各自独立记账，卸载其一不影响另一个", async () => {
      const Root = defineComponent({
        setup: () => () =>
          h(Map, { provider: harness.provider() }, [
            h(PolygonLayer as never, { data: POLYGONS, idKey: "id" }),
            h(PolylineLayer as never, { data: POLYLINES, idKey: "id" }),
          ]),
      });
      const wrapper = mount(Root, { attachTo: harness.container() });
      await settle();

      expect(createdSince()).toBe(2);
      expect(harness.attached("layer")).toBe(2);

      await unmountAndSettle(wrapper);
      expect(harness.attached("layer")).toBe(0);
      harness.assertIdle();
    });
  });

  describe("§5 刻意不开的面（反向门禁）", () => {
    it("两个组件都**不** defineExpose", () => {
      // 规则见审计文档 §六：数据 / 样式 / 显隐 / 层级全是受控 prop；`clearData` / `hitTest` /
      // 七条 `getX` 不开面；要素状态五件套这两族官方没有。⇒ 没有任何一条落进「必须 expose」。
      // 留一个「每条命令都拒绝」的空壳面比不留更糟。
      //
      // ⚠️ 扫**去注释后**的文本：组件文件头把这条规则整段写了出来（含
      // `defineExpose` 这个词），扫原文会把「我们刻意不做」误判成「我们做了」。
      for (const file of ["PolygonLayer.vue", "PolylineLayer.vue"]) {
        const code = stripComments(readSource(`packages/bmap-vue/src/components/layers/${file}`));
        expect(code, `${file} 不得 defineExpose`).not.toContain("defineExpose");
      }
    });

    it("组件不声明 opacity：官方**声明**里没有 setOpacity（与 PointLayer 同一裁决）", () => {
      // live 实测运行时有 `setOpacity`，但官方没声明 ⇒ 不进门禁（见审计文档 §三）。
      // 因此也不投影成 prop——否则组件会走 `useNativeLayerResource` 的告警分支，
      // 每次都提示「该 kind 没有这个入口」。
      for (const file of ["PolygonLayer.vue", "PolylineLayer.vue"]) {
        const code = stripComments(readSource(`packages/bmap-vue/src/components/layers/${file}`));
        expect(code, `${file} 不得声明 opacity prop`).not.toMatch(/\bopacity\b/);
      }
    });

    it("不得为了这两个组件回改已冻结的旧组件公共面", () => {
      // <FillLayer> / <LineLayer> 继续可用、行为不变；弃用是上游的事，#165 §3.6 禁止
      // compat shim。本票只让「官方建议的替代品」真的存在。
      //
      // ⚠️ 判据是「**不 import** 新组件」，不是「文件里不出现这个名字」：两个旧组件的
      // 弃用告警**文案**里**应当**点名替代品（#165 留的「如实告知」，`deprecated-layers.test.ts`
      // 还断言了它），而文件头注释同样应当提到迁移口径。扫「整文件不含这个名字」会把
      // 该有的说明当成违规的耦合。
      for (const file of ["FillLayer.vue", "LineLayer.vue"]) {
        const code = stripComments(readSource(`packages/bmap-vue/src/components/layers/${file}`));
        expect(code, `${file} 不得 import 新组件（#165 §3.6 禁止 compat shim）`).not.toMatch(
          /(?:import|from|require\()\s*["'][^"']*(?:PolygonLayer|PolylineLayer)\.vue/,
        );
        // kind 仍是旧类：换 kind 就等于改掉了已冻结的公共面
        expect(code, `${file} 仍走自己的 kind`).toMatch(/kind:\s*"(?:fill|line)"/);
      }
    });

    it("旧组件的弃用告警改为「替代品已提供」并给出迁移口径", () => {
      // #166 落地后「替代组件尚未提供」这句话就是**假的**（两个组件都存在了）。
      // 留着它等于让使用者以为无路可走——这正是 AGENTS.md 禁止的「文档把无效成员记成可用」
      // 的镜像情形（「把不存在的写成存在」）。
      for (const file of ["FillLayer.vue", "LineLayer.vue"]) {
        const source = readSource(`packages/bmap-vue/src/components/layers/${file}`);
        expect(source, `${file} 仍应保留弃用告警`).toContain("warnDeprecatedLayerOnce");
        expect(source, `${file} 不得再说「替代组件尚未提供」`).not.toContain("尚未提供");
        expect(source, `${file} 不得再说「替代组件还不存在」`).not.toContain("还不存在");
      }
    });
  });

  describe("§6 告警不是静默的", () => {
    it("把整袋 setOptions 交出去时，样式里的 undefined 键不进袋", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        // 官方 `setOptions` 忽略未知键并**告警一次**；本库因此**不**白名单过滤
        // （替上游过滤会吞掉那条告警）。`undefined` 值由 `projectLayerStyle` 滤掉。
        const { wrapper } = await mountOne(0, { style: { strokeWeight: 3, fillColor: undefined } });
        const options = lastRawLayer().options as Record<string, unknown>;
        expect(options.strokeWeight).toBe(3);
        expect("fillColor" in options, "undefined 不得进袋").toBe(false);

        await unmountAndSettle(wrapper);
        harness.assertIdle();
      } finally {
        warn.mockRestore();
      }
    });
  });
});
