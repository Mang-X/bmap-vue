/**
 * 图层套件的组件级验收（M7-LAYERS / issue #40）
 *
 * 这个文件回答 issue 的「测试要求」与「验收标准」，逐条对应如下：
 *
 * | issue 条目 | 落点 | 覆盖程度 |
 * | --- | --- | --- |
 * | add/remove/visible/options 和 map dispose | §1（十种 kind 表驱动）、§5（KeepAlive dispose） | 完整 |
 * | URL 变化重建与旧请求过期 | §2（构造期选项变化 → 原子替换：旧实例先摘、新实例后挂，两者不并存） | 「旧实例已摘除」有断言；「旧瓦片请求不再回来」需要真实网络，由 live smoke 覆盖（见下一行） |
 * | GeoJSON/DOM 响应式更新 | §4（`data` 就地 `setData`、同一份数据不重复写、清空） | 完整 |
 * | XYZ/WMS/WMTS 参数生成 | §3（SDK 侧真正收到的参数） | 完整 |
 * | 真实 v4 Tile/Traffic/GeoJSON smoke | 不在本文件：`tests/browser/jsapi-v4/**` 的 `layer-tile` / `layer-traffic` / `layer-geojson`（fixture 档进 PR 门禁，live 档 nightly） | 见 `v3-v4-smoke-workflow.test.ts` |
 * | Stable 常用 Layer 使用同一生命周期内核 | §1（十种 kind 跑同一批断言）+ `driver-contract` 的十种契约 | 完整 |
 * | 网络失败可诊断且不泄漏旧 Layer | **部分**：「不泄漏旧 Layer」由 §2 / §5 与每节的 `harness.assertIdle()` 锁住；「网络失败的 loading/error 回调」**未实现**（官方这批图层没有声明事件成员），登记在 ADR 的已知限制第 6 条 | 部分（欠账已登记） |
 * | Registry 与 Map dispose 一致 | §5（地图被销毁时账本里必须没有残留 + 图层已摘） | 完整 |
 * | 实验性 Layer 有稳定性标记 | §7（能力清单） | 完整 |
 *
 * 用例默认只写**领域读数**（`harness.attached('layer')` / `layersCreated()` / `layerCalls()` /
 * `layerAttached()` / `assertIdle()`）。少数几条需要「哪一个实例」（重建后旧实例上的监听是否
 * 真的解绑、事件载荷是否原样透传）只能落到实例本身，那几处显式用 `fake.createdLayers` 读账本，
 * 并在注释里说明为什么领域读数不够。
 *
 * 为什么是一个文件而不是十个：本 issue 的核心命题是「十种图层共用同一个生命周期内核」，
 * 把差异收进一张表（`LAYER_CASES`）之后，同一批断言必须在每个 kind 上各跑一遍——
 * 分散到十个文件反而让「覆盖是否对称」变得不可读。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { KeepAlive, defineComponent, h, nextTick, ref, type VNodeChild } from "vue";
import { createFakeV4Harness } from "../../packages/test-utils";
import BMap from "../../packages/baidu-map-gl-vue/src/components/map/BMap.vue";
import BDOMLayer from "../../packages/baidu-map-gl-vue/src/components/layers/BDOMLayer.vue";
import BDistrictLayer from "../../packages/baidu-map-gl-vue/src/components/layers/BDistrictLayer.vue";
import BGeoJSONLayer from "../../packages/baidu-map-gl-vue/src/components/layers/BGeoJSONLayer.vue";
import BPanoramaCoverageLayer from "../../packages/baidu-map-gl-vue/src/components/layers/BPanoramaCoverageLayer.vue";
import BRasterLayer from "../../packages/baidu-map-gl-vue/src/components/layers/BRasterLayer.vue";
import BTileLayer from "../../packages/baidu-map-gl-vue/src/components/layers/BTileLayer.vue";
import BTrafficLayer from "../../packages/baidu-map-gl-vue/src/components/layers/BTrafficLayer.vue";
import BWMSLayer from "../../packages/baidu-map-gl-vue/src/components/layers/BWMSLayer.vue";
import BWMTSLayer from "../../packages/baidu-map-gl-vue/src/components/layers/BWMTSLayer.vue";
import BXYZLayer from "../../packages/baidu-map-gl-vue/src/components/layers/BXYZLayer.vue";
import type { LayerKind } from "../../packages/baidu-map-gl-vue/src/driver/types/layers";
import { CAPABILITY_CATALOG } from "../../packages/baidu-map-gl-vue/src/driver/capability/catalog";

const { harness, fake } = createFakeV4Harness();

/** 一份合法的 GeoJSON `FeatureCollection`（SDK 与替身都只接受这个形状）。 */
const FEATURE_COLLECTION = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [116.404, 39.915] },
      properties: { name: "天安门" },
    },
  ],
};

const createDOM = () => document.createElement("div");

/** 十种图层的一张表：kind → 组件 + 该 kind 的最低必需 props。 */
const LAYER_CASES: ReadonlyArray<{
  name: string;
  kind: LayerKind;
  component: unknown;
  props: Record<string, unknown>;
}> = [
  { name: "BDistrictLayer", kind: "district", component: BDistrictLayer, props: { name: "北京市" } },
  { name: "BPanoramaCoverageLayer", kind: "panorama-coverage", component: BPanoramaCoverageLayer, props: {} },
  { name: "BTileLayer", kind: "tile", component: BTileLayer, props: { tileUrlTemplate: "https://a.example.com/{X}/{Y}/{Z}.png" } },
  { name: "BTrafficLayer", kind: "traffic", component: BTrafficLayer, props: {} },
  { name: "BGeoJSONLayer", kind: "geojson", component: BGeoJSONLayer, props: { data: FEATURE_COLLECTION } },
  { name: "BDOMLayer", kind: "dom", component: BDOMLayer, props: { createDom: createDOM, data: FEATURE_COLLECTION } },
  { name: "BXYZLayer", kind: "xyz", component: BXYZLayer, props: { tileUrlTemplate: "https://b.example.com/[z]/[x]/[y].png" } },
  { name: "BWMSLayer", kind: "wms", component: BWMSLayer, props: { url: "https://c.example.com/wms", params: { LAYERS: "demo" } } },
  { name: "BWMTSLayer", kind: "wmts", component: BWMTSLayer, props: { url: "https://d.example.com/wmts", params: { Layer: "img" } } },
  { name: "BRasterLayer", kind: "raster", component: BRasterLayer, props: { url: "https://e.example.com/{z}/{x}/{y}.png" } },
];

/**
 * 实例账本（`createdLayers`）是**跨用例共享**的，而 `harness.reset()` 只重置诊断计数。
 * 因此「本用例创建了几个图层」必须减去用例开始时的基线——直接用累计值会让第二条用例
 * 读到前面用例留下的实例。
 */
let createdBase = 0;

/** 本用例内累计创建的图层数。 */
const createdSince = () => harness.layersCreated() - createdBase;

beforeEach(() => {
  harness.reset();
  createdBase = harness.layersCreated();
});

/** 挂一棵 `<BMap>` + 子节点；返回 wrapper 与「重渲染用」的根组件。 */
function mountLayerTree(children: () => VNodeChild, mapProps: Record<string, unknown> = {}) {
  const Root = defineComponent({
    setup: () => () => h(BMap, { provider: harness.provider(), ...mapProps }, children),
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
async function mountOneLayer(index: number, overrides: Record<string, unknown> = {}) {
  const entry = LAYER_CASES[index]!;
  const props = ref<Record<string, unknown>>({ ...entry.props, ...overrides });
  const wrapper = mountLayerTree(() => h(entry.component as never, props.value));
  await settle();
  const setProp = async (patch: Record<string, unknown>) => {
    props.value = { ...props.value, ...patch };
    await settle();
  };
  return { wrapper, props, setProp, entry };
}

/* -------------------------------------------------------------------------- */
/* 1. 十种图层共用同一生命周期内核                                              */
/* -------------------------------------------------------------------------- */

describe("[#40] §1 统一生命周期内核：十种 kind 各跑同一批断言", () => {
  it.each(LAYER_CASES.map((entry, index) => [entry.name, index] as const))(
    "%s：挂上 → 摘掉 → 再挂上 → 卸载，且不重建、无残留",
    async (_name, index) => {
      const { wrapper, setProp } = await mountOneLayer(index);

      expect(createdSince(), "挂载只应创建一个实例").toBe(1);
      expect(harness.attached("layer")).toBe(1);
      expect(harness.layerAttached(-1)).toBe(true);

      // visible=false 是「摘掉」，不是 hide()：不重建
      await setProp({ visible: false });
      expect(harness.attached("layer")).toBe(0);
      expect(createdSince(), "显隐切换不该重建图层").toBe(1);

      await setProp({ visible: true });
      expect(harness.attached("layer")).toBe(1);
      expect(createdSince()).toBe(1);

      await unmountAndSettle(wrapper);
      expect(harness.attached("layer")).toBe(0);
      harness.assertIdle(`图层 ${_name} 卸载后`);
    },
  );

  it.each(LAYER_CASES.map((entry, index) => [entry.name, index] as const))(
    "%s：不传 visible 时默认可见（Vue 的 Boolean 缺省即 false 陷阱的回归）",
    async (_name, index) => {
      const entry = LAYER_CASES[index]!;
      const wrapper = mountLayerTree(() =>
        h(entry.component as never, { ...entry.props } as never),
      );
      await settle();
      expect(harness.attached("layer"), "缺省必须等价于可见").toBe(1);
      await unmountAndSettle(wrapper);
      harness.assertIdle(`${_name} 默认 visible`);
    },
  );
});

/* -------------------------------------------------------------------------- */
/* 2. URL / 构造期选项变化 ⇒ 原子替换                                            */
/* -------------------------------------------------------------------------- */

describe("[#40] §2 构造期选项变化：URL 变化重建与旧请求过期", () => {
  it("tile：tileUrlTemplate 变化 → 重建，旧实例先摘掉（不并存、不残留）", async () => {
    const { wrapper, setProp } = await mountOneLayer(2);
    expect(harness.layerOptions(-1).tileUrlTemplate).toBe("https://a.example.com/{X}/{Y}/{Z}.png");

    await setProp({ tileUrlTemplate: "https://a2.example.com/{X}/{Y}/{Z}.png" });

    expect(createdSince(), "URL 变化必须换一个实例").toBe(2);
    expect(harness.attached("layer"), "替换过程中不该同时挂着两个").toBe(1);
    expect(harness.layerAttached(-2), "旧实例必须已被摘除").toBe(false);
    expect(harness.layerOptions(-1).tileUrlTemplate).toBe("https://a2.example.com/{X}/{Y}/{Z}.png");

    await unmountAndSettle(wrapper);
    harness.assertIdle("URL 重建后");
  });

  it("tile：opacity 是构造期选项 ⇒ 变化时重建（官方没有 setOpacity）", async () => {
    const { wrapper, setProp } = await mountOneLayer(2, { opacity: 1 });
    await setProp({ opacity: 0.4 });
    expect(createdSince()).toBe(2);
    expect(harness.layerOptions(-1).opacity).toBe(0.4);
    await unmountAndSettle(wrapper);
    harness.assertIdle("opacity 重建");
  });

  it.each([6, 7, 8, 9])(
    "URL 型图层（index %s）：url / tileUrlTemplate 变化都走重建（同一内核）",
    async (index) => {
      const { wrapper, setProp, entry } = await mountOneLayer(index);
      const key = entry.kind === "xyz" ? "tileUrlTemplate" : "url";
      await setProp({ [key]: "https://changed.example.com/x" });

      expect(createdSince(), `${entry.name} 应重建`).toBe(2);
      expect(harness.attached("layer")).toBe(1);
      expect(harness.layerAttached(-2), `${entry.name} 的旧实例必须已被摘除`).toBe(false);
      expect(harness.layerOptions(-1)[key]).toBe("https://changed.example.com/x");

      await unmountAndSettle(wrapper);
      harness.assertIdle(`${entry.name} URL 重建`);
    },
  );

  it("district：fillColor 变化 → 重建（4.0 的 DistrictLayer 没有字段级 setter）", async () => {
    const { wrapper, setProp } = await mountOneLayer(0, { fillColor: "#fdfd27" });
    await setProp({ fillColor: "#9169db" });
    expect(createdSince()).toBe(2);
    expect(harness.layerOptions(-1).fillColor).toBe("#9169db");
    await unmountAndSettle(wrapper);
    harness.assertIdle("district 重建");
  });
});

/* -------------------------------------------------------------------------- */
/* 3. 参数生成（SDK 侧真正收到的参数）                                          */
/* -------------------------------------------------------------------------- */

describe("[#40] §3 XYZ / WMS / WMTS / Raster 的参数生成", () => {
  it("xyz：统一槽位与选项分别落到官方的键名上", async () => {
    const { wrapper } = await mountOneLayer(6, {
      minZoom: 3,
      maxZoom: 18,
      opacity: 0.8,
      zIndex: 5,
      tms: true,
      extent: [1, 2, 3, 4],
    });
    expect(harness.layerOptions(-1)).toMatchObject({
      tileUrlTemplate: "https://b.example.com/[z]/[x]/[y].png",
      minZoom: 3,
      maxZoom: 18,
      opacity: 0.8,
      tms: true,
      extent: [1, 2, 3, 4],
    });
    // `zIndex` 有字段级 setter ⇒ 走挂载后的 `setZIndex`，不进构造选项（一个值只有一条写入路径）
    expect(harness.layerOptions(-1).zIndex).toBeUndefined();
    expect(harness.layerCalls(-1)).toEqual(["setZIndex"]);
    await unmountAndSettle(wrapper);
    harness.assertIdle("xyz 参数");
  });

  it("wms：url / params / tileSize 原样透传（参数大小写不改写）", async () => {
    const { wrapper } = await mountOneLayer(7, {
      params: { LAYERS: "workspace:layer", VERSION: "1.1.1", TRANSPARENT: "true" },
      tileSize: 512,
      projection: "EPSG:3857",
    });
    expect(harness.layerOptions(-1)).toMatchObject({
      url: "https://c.example.com/wms",
      params: { LAYERS: "workspace:layer", VERSION: "1.1.1", TRANSPARENT: "true" },
      tileSize: 512,
      projection: "EPSG:3857",
    });
    await unmountAndSettle(wrapper);
    harness.assertIdle("wms 参数");
  });

  it("wmts：params 的大小写按 WMTS 标准保留（与 WMS 的全大写不同）", async () => {
    const { wrapper } = await mountOneLayer(8, {
      params: { Layer: "img", Style: "default", TileMatrixSet: "w", Format: "tiles" },
    });
    expect(harness.layerOptions(-1).params).toEqual({
      Layer: "img",
      Style: "default",
      TileMatrixSet: "w",
      Format: "tiles",
    });
    await unmountAndSettle(wrapper);
    harness.assertIdle("wmts 参数");
  });

  it("raster：url 模板 / 子域 / 四至都进构造选项", async () => {
    const { wrapper } = await mountOneLayer(9, {
      subdomains: ["a", "b"],
      bounds: [115.5, 39, 117.5, 41],
      boundsInWGS84: true,
    });
    expect(harness.layerOptions(-1)).toMatchObject({
      url: "https://e.example.com/{z}/{x}/{y}.png",
      subdomains: ["a", "b"],
      bounds: [115.5, 39, 117.5, 41],
      boundsInWGS84: true,
    });
    await unmountAndSettle(wrapper);
    harness.assertIdle("raster 参数");
  });

  it("dom：createDom prop 映射到官方构造首参 createDOM（不进选项袋，且是能转发到最新 prop 的稳定函数）", async () => {
    const { wrapper } = await mountOneLayer(5);
    expect(harness.layerOptions(-1).createDOM).toBeUndefined();

    // 传给 SDK 的是**包装函数**（引用稳定 ⇒ 不重建），它转发到当前的 `createDom` prop
    const stored = (
      fake.createdLayers[fake.createdLayers.length - 1] as {
        createDOM?: (properties: object, point: { lng: number; lat: number }) => HTMLElement;
      }
    ).createDOM;
    expect(typeof stored).toBe("function");
    expect(stored!({ name: "x" }, { lng: 1, lat: 2 })).toBeInstanceOf(HTMLElement);

    await unmountAndSettle(wrapper);
    harness.assertIdle("dom 构造首参");
  });
});

/* -------------------------------------------------------------------------- */
/* 4. GeoJSON / DOM 响应式更新                                                  */
/* -------------------------------------------------------------------------- */

describe("[#40] §4 GeoJSON / DOM 的响应式更新（就地 setData，不重建）", () => {
  it("geojson：data 变化 → setData，且图层实例不变", async () => {
    const { wrapper, setProp } = await mountOneLayer(4);
    const nextData = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [116.397, 39.908] },
          properties: { name: "前门" },
        },
      ],
    };
    await setProp({ data: nextData });

    expect(createdSince(), "data 变化不该重建图层").toBe(1);
    expect(harness.attached("layer")).toBe(1);
    // 挂载时写一次、这次变化再写一次；同一份数据不会重复写（见下一条用例）
    expect(harness.layerCalls(-1)).toEqual(["setData", "setData"]);

    await unmountAndSettle(wrapper);
    harness.assertIdle("geojson data 更新");
  });

  it("geojson：同一份数据重复渲染不重复 setData", async () => {
    const data = FEATURE_COLLECTION;
    const { wrapper, setProp } = await mountOneLayer(4, { data });
    expect(harness.layerCalls(-1)).toEqual(["setData"]);
    // 值不变的「重新赋值」（父级传的是同一个对象）不应产生第二次写入
    await setProp({ data });
    expect(harness.layerCalls(-1)).toEqual(["setData"]);
    await unmountAndSettle(wrapper);
    harness.assertIdle("geojson 去重");
  });

  it("geojson：data 置为 null → clearData", async () => {
    const { wrapper, setProp } = await mountOneLayer(4);
    await setProp({ data: null });
    expect(harness.layerCalls(-1)).toEqual(["setData", "clearData"]);
    expect(createdSince()).toBe(1);
    await unmountAndSettle(wrapper);
    harness.assertIdle("geojson 清空");
  });

  it("dom：data 变化 → setData；null → removeAllOverlays（权威入口），都不重建", async () => {
    const { wrapper, setProp } = await mountOneLayer(5);
    await setProp({ data: { type: "FeatureCollection", features: [] } });
    expect(createdSince()).toBe(1);
    expect(harness.layerCalls(-1)).toEqual(["setData", "setData"]);

    await setProp({ data: null });
    expect(harness.layerCalls(-1)).toEqual(["setData", "setData", "removeAllOverlays"]);
    expect(createdSince()).toBe(1);

    await unmountAndSettle(wrapper);
    harness.assertIdle("dom data 更新");
  });

  it("dom：minZoom / zIndex 走整袋 setStyleOptions（官方没有逐字段 setter）", async () => {
    const { wrapper, setProp } = await mountOneLayer(5, { minZoom: 3, zIndex: 1 });
    // `data` 走独立入口，两个层级槽位（minZoom / zIndex）攒成**一次**整袋写入。
    // 顺序固定为「槽位循环内写 data → 循环后统一提交 option 袋」。
    expect(harness.layerCalls(-1)).toEqual(["setData", "setStyleOptions"]);

    await setProp({ zIndex: 9 });
    expect(harness.layerCalls(-1)).toEqual(["setData", "setStyleOptions", "setStyleOptions"]);
    expect(createdSince()).toBe(1);

    await setProp({ minZoom: 6 });
    expect(harness.layerCalls(-1)).toEqual([
      "setData",
      "setStyleOptions",
      "setStyleOptions",
      "setStyleOptions",
    ]);
    expect(createdSince()).toBe(1);

    await unmountAndSettle(wrapper);
    harness.assertIdle("dom setStyleOptions");
  });

  it("traffic：布尔 option 不传时**不进构造选项**，显式传时才写（Vue 的 Boolean 缺省转换回归）", async () => {
    // 回归点：Vue 把「缺省」的 boolean prop 归一成 `false`（`isAbsent && !hasDefault`），
    // 如果组件不给显式 `undefined` 默认值，`edge` / `autoRefresh` 就会以 `false` 出现在构造选项里，
    // 覆盖 SDK 自己的默认值（`TrafficLayer.edge` 的默认是 **true**）。
    const silent = await mountOneLayer(3);
    const options = harness.layerOptions(-1);
    expect(options.edge).toBeUndefined();
    expect(options.autoRefresh).toBeUndefined();
    // 「没表态」⇒ SDK 侧连 setter 都不该被调用
    expect(harness.layerCalls(-1)).toEqual([]);
    await unmountAndSettle(silent.wrapper);
    harness.assertIdle("traffic 布尔缺省");

    harness.reset();
    const explicit = await mountOneLayer(3, { edge: false });
    // 显式 `false` 必须**真的传到 SDK**（`edge` 是可就地更新的 option ⇒ 走 setter，不进构造选项）
    expect(harness.layerCalls(-1)).toEqual(["setEdge"]);
    await unmountAndSettle(explicit.wrapper);
    harness.assertIdle("traffic 布尔显式");
  });

  it("traffic / dom：可就地更新的 option 在**挂载时**就生效（不是「改一次才生效」）", async () => {
    // 回归点：可就地更新的 option 不进构造选项（一个值只有一条写入路径），因此挂载后必须写一次。
    // 曾经漏了这一步：初始 `colors` / `offsetX` 被静默丢弃。
    const traffic = await mountOneLayer(3, { colors: ["#0f0", "#ff0"], edge: true });
    expect(harness.layerCalls(-1)).toEqual(["setColors", "setEdge"]);
    await unmountAndSettle(traffic.wrapper);
    harness.assertIdle("traffic 初始可变 option");

    harness.reset();
    const dom = await mountOneLayer(5, { offsetX: 4, enableDraggingMap: true });
    expect(harness.layerCalls(-1)).toEqual(["setData", "setStyleOptions"]);
    await unmountAndSettle(dom.wrapper);
    harness.assertIdle("dom 初始可变 option");
  });

  it("tile：zIndex 走字段级 setZIndex（不重建）", async () => {
    const { wrapper, setProp } = await mountOneLayer(2, { zIndex: 1 });
    await setProp({ zIndex: 6 });
    expect(harness.layerCalls(-1)).toContain("setZIndex");
    expect(createdSince()).toBe(1);
    await unmountAndSettle(wrapper);
    harness.assertIdle("tile zIndex");
  });

  it("traffic：colors / edge 就地更新，autoRefresh 变化才重建", async () => {
    const { wrapper, setProp } = await mountOneLayer(3, { colors: ["#0f0"], edge: true });
    await setProp({ colors: ["#f00"], edge: false });
    expect(harness.layerCalls(-1)).toEqual(expect.arrayContaining(["setColors", "setEdge"]));
    expect(createdSince()).toBe(1);

    await setProp({ autoRefresh: true });
    expect(createdSince(), "autoRefresh 是构造期选项 ⇒ 重建").toBe(2);
    await unmountAndSettle(wrapper);
    harness.assertIdle("traffic 更新");
  });
});

/* -------------------------------------------------------------------------- */
/* 5. Registry 与 Map dispose 一致                                              */
/* -------------------------------------------------------------------------- */

describe("[#40] §5 Registry 与 Map dispose 一致", () => {
  it("普通卸载：图层被摘掉、账本无残留、诊断归零", async () => {
    const wrapper = mountLayerTree(() => [
      h(BTileLayer, { tileUrlTemplate: "https://a.example.com/{X}/{Y}/{Z}.png" }),
      h(BTrafficLayer),
      h(BDistrictLayer, { name: "北京市" }),
    ]);
    await settle();
    expect(harness.attached("layer")).toBe(3);

    await unmountAndSettle(wrapper);
    expect(harness.attached("layer")).toBe(0);
    // 「账本里没有残留」要按实例点名，而不是一句 `every(...)`：失败时要能看出是哪一代漏摘
    const stillAttached = fake.createdLayers
      .map((layer, index) => ({ index, name: layer.constructor.name, attached: layer.attachedMap !== null }))
      .filter((entry) => entry.attached);
    expect(stillAttached, "所有创建过的图层都必须已从地图摘除").toEqual([]);
    harness.assertIdle("整图卸载");
  });

  it("地图被销毁（KeepAlive dispose）时，仍然挂着的图层由账本摘掉", async () => {
    const show = ref(true);
    const Root = defineComponent({
      setup: () => () =>
        h(KeepAlive, null, {
          default: () =>
            show.value
              ? h(
                  BMap,
                  // `dispose` 档下 `onDeactivated` 直接销毁 Runtime，而组件树仍在 KeepAlive 的
                  // cache 里 —— 这正是「Registry 与 Map dispose 一致」唯一能走到的路径：
                  // 子组件的 `onUnmounted` 不会发生，图层只能由账本的 `disposeAll()` 摘掉。
                  { provider: harness.provider(), keepAliveBehavior: "dispose" },
                  () => [h(BTileLayer, { tileUrlTemplate: "https://a.example.com/{X}/{Y}/{Z}.png" })],
                )
              : null,
        }),
    });
    const wrapper = mount(Root, { attachTo: harness.container() });
    await settle();
    expect(harness.attached("layer")).toBe(1);

    show.value = false;
    await settle();

    // 图层被 Runtime 的账本摘掉，且没有泄漏（旧实例的 attachedMap 必须清空）
    expect(harness.attached("layer")).toBe(0);
    expect(harness.layerAttached(-1)).toBe(false);
    harness.assertIdle("KeepAlive dispose");

    wrapper.unmount();
    await settle();
    harness.assertIdle("KeepAlive dispose 之后卸载");
  });
});

/* -------------------------------------------------------------------------- */
/* 6. 事件：监听归属「当前这一代」实例                                            */
/* -------------------------------------------------------------------------- */

describe("[#40] §6 事件与重建后的监听归属", () => {
  it("geoJSON：事件按官方声明绑定；重建后旧实例上的监听随之释放、新实例照常派发", async () => {
    const onEvent = vi.fn();
    const layerName = ref("pois");
    const wrapper = mountLayerTree(() =>
      h(BGeoJSONLayer, {
        data: FEATURE_COLLECTION,
        layerName: layerName.value,
        onClick: onEvent,
      } as never),
    );
    await settle();

    const first = fake.createdLayers[fake.createdLayers.length - 1]!;
    first.emit("click", { point: { lng: 116.4, lat: 39.9 } });
    expect(onEvent).toHaveBeenCalledTimes(1);

    // `layerName` 是构造期选项 ⇒ 触发一次重建
    layerName.value = "pois-v2";
    await settle();
    expect(createdSince()).toBe(2);

    const second = fake.createdLayers[fake.createdLayers.length - 1]!;
    expect(second).not.toBe(first);

    // 旧实例上的监听必须已随旧代的 child scope 释放（否则会出现「一个事件两次回调」）
    first.emit("click", {});
    expect(onEvent, "旧实例的监听必须已解绑").toHaveBeenCalledTimes(1);

    // 新实例上的监听照常工作
    second.emit("click", {});
    expect(onEvent).toHaveBeenCalledTimes(2);

    await unmountAndSettle(wrapper);
    harness.assertIdle("geoJSON 事件");
  });

  it("payload 原样透传（geoJSON 的 click 载荷带 features）", async () => {
    const received: unknown[] = [];
    const wrapper = mountLayerTree(() =>
      h(BGeoJSONLayer, {
        data: FEATURE_COLLECTION,
        onClick: (e: unknown) => received.push(e),
      } as never),
    );
    await settle();

    const layer = fake.createdLayers[fake.createdLayers.length - 1]!;
    layer.emit("click", { features: [{ id: 1 }] });
    // 回调参数是**归一化事件**（`DriverEvent`）；`features` 不是它的第一类字段，
    // 从文档化的 `raw` 逃生口读（见 ADR「已知限制」）。
    expect(received).toEqual([
      expect.objectContaining({ raw: expect.objectContaining({ features: [{ id: 1 }] }) }),
    ]);

    await unmountAndSettle(wrapper);
    harness.assertIdle("geoJSON 载荷");
  });
});

/* -------------------------------------------------------------------------- */
/* 7. 能力清单：实验性图层的稳定性标记                                            */
/* -------------------------------------------------------------------------- */

describe("[#40] §7 能力清单里的稳定性标记", () => {
  it("四条瓦片基线 + DOM 标为 experimental，traffic / geojson / district / tile 为 native", () => {
    // issue 的验收标准：「实验性 Layer 有稳定性标记」——标记本身就是这七条
    expect(CAPABILITY_CATALOG["layer.xyz"].status).toBe("experimental");
    expect(CAPABILITY_CATALOG["layer.wms"].status).toBe("experimental");
    expect(CAPABILITY_CATALOG["layer.wmts"].status).toBe("experimental");
    expect(CAPABILITY_CATALOG["layer.raster"].status).toBe("experimental");
    expect(CAPABILITY_CATALOG["layer.dom"].status).toBe("experimental");

    expect(CAPABILITY_CATALOG["layer.tile"].status).toBe("native");
    expect(CAPABILITY_CATALOG["layer.traffic"].status).toBe("native");
    expect(CAPABILITY_CATALOG["layer.geojson"].status).toBe("native");
    expect(CAPABILITY_CATALOG["layer.district"].status).toBe("native");
  });

  it("四条实验性基线的 rawMembers 与替身一致（能力声明不是空话）", () => {
    for (const id of ["layer.xyz", "layer.wms", "layer.wmts", "layer.raster"] as const) {
      const member = CAPABILITY_CATALOG[id].rawMembers?.[0] ?? "";
      expect(typeof (fake.namespace as unknown as Record<string, unknown>)[member]).toBe("function");
    }
  });
});
