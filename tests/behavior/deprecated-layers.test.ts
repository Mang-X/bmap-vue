/**
 * 官方 4.0.5 弃用的图层类，本库已封装的三个组件的**弃用告知**（#165「适配被弃用的图层类」）
 *
 * ## 背景（事实源在 `packages/bmap-vue/node_modules/@baidumap/jsapi-v4-types`）
 *
 * 4.0.5 给 `layer/FillLayer.d.ts` / `layer/LineLayer.d.ts` / `layer/PointIconLayer.d.ts` /
 * `layer/PointShapeLayer.d.ts` 四个类各加了一条 `@deprecated`，分别建议改用
 * `visualization/` 命名空间的 `PolygonLayer` / `PolylineLayer` / `PointLayer`（图标模式）/
 * `PointLayer`（形状模式）。本库**已封装**其中三个：`<FillLayer>` / `<LineLayer>` /
 * `<PointIconLayer>`（`PointShapeLayer` 只是 Driver 的一个 kind，本库没有对应组件）。
 *
 * ## 决策：保留组件 + 把弃用讲清楚，**不做**兼容垫片
 *
 * 本库是 1.0 清白面：既不改名也不留「别名指向新名」的垫片（#165 §3.6 禁止 compat shim）。
 * 唯一要保证的是「弃用是**诚实的、看得见的**」：
 *
 * | 层 | 落点 |
 * | --- | --- |
 * | SFC 文件头 | 讲清「官方弃用 / 替代类 / 替代组件还**没有**」 |
 * | 开发期运行时 | 创建时**告警一次**（按模块去重，不按实例） |
 * | 公开类型 | 三个 props 接口挂 `@deprecated`（编辑器里出现删除线） |
 * | 文档 | 明确写出替代项**尚未提供**（`PolylineLayer` / `PolygonLayer` 组件见 #166） |
 *
 * ## 这里断言什么
 *
 * 告警的三个可观察性质：① 每条消息点名官方弃用类**与**替代类；② **每个组件只出一次**
 * （挂 N 个实例也只出 1 条——弃用提示按模块去重，否则一个页面上五个 `<LineLayer>` 刷五条
 * 同样的话，等于没有提示）；③ **生产环境完全静默**（复用 `core/logger` 的 `isDev()` 判定，
 * 不另造机制）。
 *
 * ## 为什么每条用例都 `vi.resetModules()` + 动态 `import`
 *
 * 「按模块去重」这件事**要求**去重集合活过组件实例，因此它是**模块级状态**——
 * 而模块级状态也意味着**跨用例残留**：第一个用例消费掉键之后，后面的用例拿不到消息，
 * 断言会退化成「什么都没检查」的恒真。因此每条用例都在自己的一份**独立模块副本**里跑
 * （与 `core/loader/providers/providers.test.ts` 里「模拟同页两份独立打包的库副本」同一手法）。
 *
 * `<Map>` 与被测组件**必须**来自同一次 `resetModules()` 之后的导入：地图上下文经
 * `InjectionKey`（一个 `Symbol`）注入，两份副本各持一个 `Symbol`，跨副本 provide/inject 会失配。
 * harness 的 provider / 容器都是**纯数据**，不参与身份判定，可以留在原副本。
 */
import { describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, nextTick, type Component, type VNodeChild } from "vue";
import { createFakeV4Harness } from "../../packages/test-utils";

const { harness } = createFakeV4Harness();

/** 一次独立加载的组件对（`<Map>` + 被测组件来自**同一份**模块副本）。 */
interface FreshCopy {
  Map: Component;
  subject: Component;
}

async function loadFreshCopy(relativePath: string): Promise<FreshCopy> {
  vi.resetModules();
  const [{ default: MapComponent }, { default: subject }] = await Promise.all([
    import("../../packages/bmap-vue/src/components/map/Map.vue"),
    import(/* @vite-ignore */ relativePath),
  ]);
  return { Map: MapComponent as Component, subject: subject as Component };
}

async function mountMapTree(copy: FreshCopy, children: () => VNodeChild) {
  const Root = defineComponent({
    setup: () => () => h(copy.Map, { provider: harness.provider() }, children),
  });
  const wrapper = mount(Root, { attachTo: harness.container() });
  await flushPromises();
  await nextTick();
  return wrapper;
}

async function unmountAndSettle(wrapper: { unmount(): void }) {
  wrapper.unmount();
  await flushPromises();
  await nextTick();
}

/** 只看 `console.warn` 的首参（`logger.warn` 把 context 作为第二参附加）。 */
function warnLines(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((call) => String(call[0] ?? ""));
}

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

const LINES = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[116.3, 39.9], [116.4, 39.95]] },
      properties: { id: "a" },
    },
  ],
};

const STATIONS = [
  { id: "a", lng: 116.404, lat: 39.915 },
  { id: "b", lng: 116.41, lat: 39.92 },
] as const;

const stationPosition = (item: { lng: number; lat: number }) => ({ lng: item.lng, lat: item.lat });

/**
 * 三个组件的「官方弃用类 → 官方建议替代类」对照（逐条回 4.0.5 声明核对）。
 *
 * `replacementShipped` 是本文件最要紧的一条分界：**`PointLayer` 本库已提供**，
 * 而 `PolylineLayer` / `PolygonLayer` **还不存在**（#166）。告警必须如实区分这两种情况——
 * 对着不存在的东西说「改用 X」是本票明确禁止的（不许承诺没有的东西）。
 */
const DEPRECATION_CASES = [
  {
    name: "FillLayer",
    module: "../../packages/bmap-vue/src/components/layers/FillLayer.vue",
    /** 官方 `layer/FillLayer.d.ts` 的类上 `@deprecated`：建议 PolygonLayer。 */
    upstreamClass: "BMap.FillLayer",
    replacement: "BMap.PolygonLayer",
    /** 官方建议的替代组件本库**尚未**提供。 */
    replacementShipped: false,
    props: { data: POLYGONS, idKey: "id" },
  },
  {
    name: "LineLayer",
    module: "../../packages/bmap-vue/src/components/layers/LineLayer.vue",
    upstreamClass: "BMap.LineLayer",
    replacement: "BMap.PolylineLayer",
    replacementShipped: false,
    props: { data: LINES, idKey: "id" },
  },
  {
    name: "PointIconLayer",
    module: "../../packages/bmap-vue/src/components/data/PointIconLayer.vue",
    upstreamClass: "BMap.PointIconLayer",
    replacement: "BMap.PointLayer",
    /** 唯一「官方推荐的替代品已经存在」的情形（`<PointLayer>` 本库已提供）。 */
    replacementShipped: true,
    props: { data: STATIONS, itemKey: "id", getPosition: stationPosition, icon: "pin.png" },
  },
  {
    /**
     * 第四个被弃用的类没有同名组件：`BMap.PointShapeLayer` 落在 `<PointCollection>` 上
     * （`LAYER_KIND = "point-shape"`）。组件名与 SDK 类名不同，正是它容易被漏掉的原因——
     * 照着「被弃用的类名」去找组件是找不到它的。
     */
    name: "PointCollection",
    module: "../../packages/bmap-vue/src/components/data/PointCollection.vue",
    /** 官方 `layer/PointShapeLayer.d.ts:152` 的类上 `@deprecated`：建议 PointLayer（形状模式）。 */
    upstreamClass: "BMap.PointShapeLayer",
    replacement: "BMap.PointLayer",
    replacementShipped: true,
    props: { data: STATIONS, itemKey: "id", getPosition: stationPosition },
  },
] as const;

describe("官方已弃用的图层类：组件级弃用告知（#165）", () => {
  for (const entry of DEPRECATION_CASES) {
    it(`${entry.name}：开发期创建时报一次，多个实例也只出这一条`, async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";
      try {
        const copy = await loadFreshCopy(entry.module);
        harness.reset();
        // 同图挂三个实例：弃用提示按**模块**去重，不按实例——否则五张图就刷五条同样的话。
        const wrapper = await mountMapTree(copy, () => [
          h(copy.subject, entry.props),
          h(copy.subject, entry.props),
          h(copy.subject, entry.props),
        ]);
        expect(harness.attached("layer"), "三个实例都真的建了资源").toBe(3);

        const lines = warnLines(warn).filter((line) => line.includes(`[${entry.name}]`));
        expect(lines, `${entry.name} 的弃用告警按模块去重（3 个实例仍只 1 条）`).toHaveLength(1);
        const line = lines[0]!;
        expect(line, "必须点名官方弃用的类").toContain(entry.upstreamClass);
        expect(line, "必须点名官方建议的替代类").toContain(entry.replacement);
        expect(line, "必须指向文档").toContain("docs/zh-CN/components");
        // 不许承诺没有的东西：替代组件没到位就必须说「尚未提供」，不能只丢一个类名让人去找。
        expect(
          line.includes("#166"),
          `${entry.name}：替代组件未提供时必须说明它还不存在（#166）`,
        ).toBe(!entry.replacementShipped);

        await unmountAndSettle(wrapper);
        expect(harness.attached("layer"), "卸载后不留残留").toBe(0);
        harness.assertIdle(`弃用告警：${entry.name}`);
      } finally {
        process.env.NODE_ENV = original;
      }
    });

    it(`${entry.name}：生产环境（NODE_ENV=production）完全不输出`, async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        const copy = await loadFreshCopy(entry.module);
        harness.reset();
        const wrapper = await mountMapTree(copy, () => [h(copy.subject, entry.props)]);
        // 正证守卫：组件**确实创建了**（否则「一条都没有」可能只是没挂上）。
        expect(harness.attached("layer"), "组件确实建了资源").toBe(1);
        expect(
          warnLines(warn).filter((line) => line.includes(`[${entry.name}]`)),
          "生产环境不得有任何弃用告警",
        ).toEqual([]);

        await unmountAndSettle(wrapper);
        harness.assertIdle(`弃用告警：${entry.name} 生产静默`);
      } finally {
        process.env.NODE_ENV = original;
      }
    });
  }

  it("弃用只是提示：不改变任何一个组件的运行时行为", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      // 三个组件各要一份**独立**副本（各自模块级的去重键），且**顺序**加载：
      // `vi.resetModules()` 清的是全局模块注册表，并发调用会互相拆台。
      for (const entry of DEPRECATION_CASES) {
        const copy = await loadFreshCopy(entry.module);
        harness.reset();
        const created = harness.nativeLayersCreated();
        const wrapper = await mountMapTree(copy, () => [h(copy.subject, entry.props)]);

        expect(harness.nativeLayersCreated() - created, `${entry.name} 仍各建一个 SDK 资源`).toBe(1);
        expect(
          harness.attached("overlay"),
          `${entry.name} 仍是整批一个资源，不退化成逐项 Marker`,
        ).toBe(0);
        expect(
          warnLines(warn).filter((line) => line.includes(`[${entry.name}]`)).length,
          `${entry.name} 的开发期告警确实走过（不是碰巧没输出）`,
        ).toBe(1);

        await unmountAndSettle(wrapper);
        expect(harness.attached("layer"), `${entry.name} 卸载后不留残留`).toBe(0);
        harness.assertIdle(`弃用告警：${entry.name} 行为不变`);
      }
    } finally {
      process.env.NODE_ENV = original;
    }
  });
});
