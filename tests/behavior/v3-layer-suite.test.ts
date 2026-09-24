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
import BMap from "../../packages/bmap-vue/src/components/map/BMap.vue";
import BDOMLayer from "../../packages/bmap-vue/src/components/layers/BDOMLayer.vue";
import BDistrictLayer from "../../packages/bmap-vue/src/components/layers/BDistrictLayer.vue";
import BGeoJSONLayer from "../../packages/bmap-vue/src/components/layers/BGeoJSONLayer.vue";
import BPanoramaCoverageLayer from "../../packages/bmap-vue/src/components/layers/BPanoramaCoverageLayer.vue";
import BRasterLayer from "../../packages/bmap-vue/src/components/layers/BRasterLayer.vue";
import BMVTLayer from "../../packages/bmap-vue/src/components/layers/BMVTLayer.vue";
import BTileLayer from "../../packages/bmap-vue/src/components/layers/BTileLayer.vue";
import BTrafficLayer from "../../packages/bmap-vue/src/components/layers/BTrafficLayer.vue";
import BWMSLayer from "../../packages/bmap-vue/src/components/layers/BWMSLayer.vue";
import BWMTSLayer from "../../packages/bmap-vue/src/components/layers/BWMTSLayer.vue";
import BXYZLayer from "../../packages/bmap-vue/src/components/layers/BXYZLayer.vue";
import { useRequiredMapContext } from "../../packages/bmap-vue/src/core/context/inject";
import { createCapabilityRegistry } from "../../packages/bmap-vue/src/driver/capability/registry";
import { createJsapiV4EventDriver } from "../../packages/bmap-vue/src/driver/jsapi-v4/events";
import { createJsapiV4GeometryDriver } from "../../packages/bmap-vue/src/driver/jsapi-v4/geometry";
import { createJsapiV4LayerDriver } from "../../packages/bmap-vue/src/driver/jsapi-v4/layers";
import { createJsapiV4HandleRegistry } from "../../packages/bmap-vue/src/driver/jsapi-v4/registry";
import type { LayerKind } from "../../packages/bmap-vue/src/driver/types/layers";
import { CAPABILITY_CATALOG } from "../../packages/bmap-vue/src/driver/capability/catalog";

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
  { name: "BMVTLayer", kind: "mvt", component: BMVTLayer, props: { tileUrlTemplate: "https://f.example.com/[z]/[x]/[y].pbf" } },
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

/**
 * 挂一棵带 `resource:error` 探针的 `<BMap>`：把组件的创建 / 挂载失败收成可断言的结果。
 *
 * 与 `v3-component-scenarios.test.ts` 里的同名探针同源（那条路走 `useRequiredMapContext`
 * 读上下文的事件总线）。
 */
function mountTreeWithErrorProbe(errors: unknown[], children: () => VNodeChild) {
  const Probe = defineComponent({
    name: "SmokeErrorProbe",
    setup() {
      const ctx = useRequiredMapContext();
      ctx.events.on("resource:error", (payload) => errors.push(payload));
      return () => null;
    },
  });
  return mountLayerTree(() => [h(Probe), children()]);
}

/**
 * §10 用：绕过组件，直接在 Fake 命名空间上建一个图层。
 *
 * 第三轮的两条契约发现（替身成员与官方声明是否一致、EventDriver 对缺成员的拒绝）都在
 * **Driver / 替身**这一层，用组件路径反而看不到。
 */
function createFakeDriverPair() {
  // layer driver 与 events driver **必须共用同一个 registry**：句柄的所有权绑定在创建它的
  // registry 上，跨 registry 会得到 `BMAP_HANDLE_FOREIGN`（这正是「跨 Client 混用被拒绝」）。
  const registry = createJsapiV4HandleRegistry();
  const capabilities = createCapabilityRegistry({
    engine: "jsapi-v4",
    version: fake.namespace.VERSION,
    rawSdk: fake.namespace,
    unsupported: "throw",
  });
  return {
    layers: createJsapiV4LayerDriver({ rawSdk: fake.namespace, capabilities, registry }),
    events: createJsapiV4EventDriver({
      registry,
      geometry: createJsapiV4GeometryDriver(fake.namespace),
    }),
  };
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
    "%s：挂上 → 摘掉 → 再挂上（**重建**）→ 卸载，无残留",
    async (_name, index) => {
      const { wrapper, setProp } = await mountOneLayer(index);

      expect(createdSince(), "挂载只应创建一个实例").toBe(1);
      expect(harness.attached("layer")).toBe(1);
      expect(harness.layerAttached(-1)).toBe(true);

      // visible=false 是「摘掉」，不是 hide()；这一步本身不重建
      await setProp({ visible: false });
      expect(harness.attached("layer")).toBe(0);
      expect(createdSince(), "「摘掉」这一步不该换实例").toBe(1);

      // ⚠️ 「再挂上」**会重建**：真实 4.0 的 removeLayer 会清空图层持有的 Map 引用，那个实例再也
      // 渲染不了（DOMLayer 实测：重挂载后节点仍为 0，补 setData 还抛 `reading 'coordinate'`），
      // 所以重新可见只能换实例（`needsRemountRebuild`，见 #98 的 live 读数）。
      await setProp({ visible: true });
      expect(harness.attached("layer")).toBe(1);
      expect(createdSince(), "重新可见要换新实例（摘掉过的实例不可复用）").toBe(2);
      expect(harness.layerAttached(-1), "新实例挂在图上").toBe(true);

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
/* 8. 评审修正（PR #96 第一轮）：状态转换与错误补偿                               */
/* -------------------------------------------------------------------------- */

/**
 * 这一节对应 PR #96 第一轮评审的四条代码发现（1、2、3、4）。每条都是「某条状态转换没人守」，
 * 而不是「某处写错」——因此每条都先写成会红的用例，再修实现。
 */
describe("[#40] §8 评审修正：可见性切换、回调替换、键移除与挂载失败补偿", () => {
  it("[评审 1] visible=false 期间设置的可变 option，切回可见时必须真的写入 SDK", async () => {
    const { wrapper, setProp } = await mountOneLayer(3, {
      visible: false,
      edge: false,
      colors: ["#0f0", "#ff0"],
    });

    // 未挂载 ⇒ 一次都不该写（公开语义：不在地图上就不写），但也**不能**记成「已应用」
    expect(harness.attached("layer")).toBe(0);
    expect(harness.layerCalls(-1)).toEqual([]);

    await setProp({ visible: true });

    expect(harness.attached("layer")).toBe(1);
    expect(
      harness.layerCalls(-1),
      "切回可见时补写挂载期间设为「不表态前」的那些值（修复前这里是 []：状态被记成已应用）",
    ).toEqual(["setColors", "setEdge"]);

    await unmountAndSettle(wrapper);
    harness.assertIdle("visible=false 期间的可变 option");
  });

  it("[评审 2] 回调型构造 option 换成另一个函数后，SDK 手上的回调必须转发到最新的那个", async () => {
    // `BRasterLayer.url` 是 `string | ((x,y,z) => string)`：函数 → 函数 的切换在指纹里被折叠成 `fn`，
    // 因此不会重建（这是刻意的，否则内联箭头会让父级每次渲染都重建图层）——
    // 但 SDK 手上的那份必须**转发到当前 prop**，否则就是「换了回调但永远用旧的」。
    const urlA = (x: number) => `A:${x}`;
    const urlB = (x: number) => `B:${x}`;
    const { wrapper, setProp } = await mountOneLayer(9, { url: urlA });

    const firstUrl = harness.layerOptions(-1).url as (x: number, y: number, z: number) => string;
    expect(firstUrl(1, 2, 3)).toBe("A:1");

    await setProp({ url: urlB });
    expect(createdSince(), "回调身份变化不重建（指纹折叠函数）").toBe(1);
    const secondUrl = harness.layerOptions(-1).url as (x: number, y: number, z: number) => string;
    expect(secondUrl(1, 2, 3), "SDK 手上的回调必须已经是新的").toBe("B:1");

    await unmountAndSettle(wrapper);
    harness.assertIdle("raster url 回调替换");
  });

  it("[评审 2] 转发型回调（tileLoadFunction / XYZ 模板回调）转发到最新实现；GeoJSON style 走「重建」那条路", async () => {
    // ⚠️ 标题曾写成「同类回调（… / GeoJSON style）同样转发」，但自第二轮起**函数型 GeoJSON style
    // 已改为身份敏感 ⇒ 重建**（见 §9）。这条用例的 GeoJSON 段测的是**对象型** style 的内容变化
    // ⇒ 重建，不是转发；两者是同一条判据（「SDK 什么时候调用它」）下的两个分支，不要混读。
    const loadA = vi.fn();
    const loadB = vi.fn();
    const tile = await mountOneLayer(2, { tileLoadFunction: loadA });
    const firstLoad = harness.layerOptions(-1).tileLoadFunction as (t: unknown, u: string) => void;
    firstLoad({}, "https://x/1.png");
    expect(loadA).toHaveBeenCalledTimes(1);

    await tile.setProp({ tileLoadFunction: loadB });
    const secondLoad = harness.layerOptions(-1).tileLoadFunction as (t: unknown, u: string) => void;
    expect(secondLoad, "SDK 手上的函数身份稳定（同一个包装），换的是它转发到的目标").toBe(firstLoad);
    secondLoad({}, "https://x/2.png");
    expect(loadB, "SDK 侧调用必须落到新的实现").toHaveBeenCalledTimes(1);
    expect(loadA, "旧实现不该再被调用").toHaveBeenCalledTimes(1);
    await unmountAndSettle(tile.wrapper);
    harness.assertIdle("tileLoadFunction 替换");

    // XYZ 的模板回调与 TileLayer 的 `tileLoadFunction` 走同一条路径（同一个 helper，逐个组件覆盖）；
    // 下面 GeoJSON 那一段刻意**不是**转发：它验证的是「会转发的那一类」与「要重建的那一类」的边界。
    const xyz = await mountOneLayer(6, { xTemplate: (x: number) => x });
    const firstX = harness.layerOptions(-1).xTemplate as (x: number, y: number, z: number) => number;
    expect(firstX(7, 1, 1)).toBe(7);
    await xyz.setProp({ xTemplate: (x: number) => x * 2 });
    const secondX = harness.layerOptions(-1).xTemplate as (x: number, y: number, z: number) => number;
    expect(secondX(7, 1, 1)).toBe(14);
    await unmountAndSettle(xyz.wrapper);
    harness.assertIdle("xyz xTemplate 替换");

    const styleA = { title: "A" };
    const styleB = { title: "B" };
    const geo = await mountOneLayer(4, { markerStyle: styleA });
    const firstStyle = harness.layerOptions(-1).markerStyle as { title: string };
    expect(firstStyle.title).toBe("A");
    await geo.setProp({ markerStyle: styleB });
    expect((harness.layerOptions(-1).markerStyle as { title: string }).title, "对象型 style 变化会重建").toBe(
      "B",
    );
    await unmountAndSettle(geo.wrapper);
    harness.assertIdle("geojson markerStyle 替换");
  });

  it("[评审 3] 可变 option 从有值变回 undefined：重建图层，让 SDK 回到自身默认状态", async () => {
    const { wrapper, setProp } = await mountOneLayer(3, { edge: false });
    expect(harness.layerCalls(-1)).toEqual(["setEdge"]);
    expect(createdSince()).toBe(1);

    await setProp({ edge: undefined });

    expect(createdSince(), "SDK 没有 unset 入口 ⇒ 只能重建以回到默认").toBe(2);
    expect(harness.attached("layer")).toBe(1);
    expect(harness.layerCalls(-1), "新实例不再写 edge（用 SDK 自己的默认）").toEqual([]);
    expect(harness.layerAttached(-2), "旧实例已摘除").toBe(false);

    await unmountAndSettle(wrapper);
    harness.assertIdle("可变 option 移除");
  });

  it("[评审 4] addLayer 已经挂上之后再抛错：mount 的错误补偿必须把它摘掉", async () => {
    const show = ref(false);
    const wrapper = mountLayerTree(() => (show.value ? h(BTrafficLayer, {}) : null));
    await settle();
    expect(createdSince()).toBe(0);

    const map = fake.createdMaps[fake.createdMaps.length - 1]!;
    map.failNextAddLayerAfterAttach = new Error("addLayer failed after attach");
    show.value = true;
    await settle();

    expect(
      map.layers.length,
      "「副作用已产生但调用抛错」时，错误补偿必须 best-effort 摘除（修复前这里会留 1 个）",
    ).toBe(0);
    expect(harness.layerAttached(-1)).toBe(false);

    await unmountAndSettle(wrapper);
    harness.assertIdle("挂载失败补偿");
  });

  it("[评审 4] 挂载之后切可见时的失败同样不留下孤儿，且经 resource:error 可诊断", async () => {
    const errors: unknown[] = [];
    const visible = ref(false);
    const wrapper = mountTreeWithErrorProbe(errors, () => h(BTrafficLayer, { visible: visible.value }));
    await settle();
    expect(createdSince()).toBe(1);

    const map = fake.createdMaps[fake.createdMaps.length - 1]!;
    map.failNextAddLayerAfterAttach = new Error("addLayer failed after attach");
    visible.value = true;
    await settle();

    expect(map.layers.length, "失败后不能留下孤儿").toBe(0);
    expect(errors, "失败必须经 resource:error 可诊断").toHaveLength(1);

    // 失败之后仍然可以重试（记账没有被永久污染）
    visible.value = false;
    await settle();
    visible.value = true;
    await settle();
    expect(map.layers.length, "重试必须能成功挂上").toBe(1);

    await unmountAndSettle(wrapper);
    harness.assertIdle("切可见失败补偿");
  });
});

/* -------------------------------------------------------------------------- */
/* 9. 评审修正（PR #96 第二轮）：函数型 style、槽位移除与整袋记账                 */
/* -------------------------------------------------------------------------- */

/**
 * 第二轮的三条代码发现。共同点是**「声明变了但 SDK 侧什么都不会发生」**——
 * 与第一轮的家族相邻，但落在不同的机制上：指纹、slot 记账、整袋调用时序。
 */
describe("[#40] §9 评审修正：函数型 style 重建、槽位移除与整袋记账时序", () => {
  it("[二轮 1] 函数型 style 换成另一个函数 ⇒ 重建（既有要素才会用新实现重解析）", async () => {
    // GeoJSON 的 style 是「解析数据时求一次」的回调：光让 wrapper 读到新 prop 不会让
    // **已经在图上的要素**换样式，必须重新解析数据（= 重建本库的语义）。
    const { wrapper, setProp } = await mountOneLayer(4, { markerStyle: () => ({ title: "A" }) });
    expect(createdSince()).toBe(1);
    expect(harness.layerCalls(-1)).toEqual(["setData"]);

    await setProp({ markerStyle: () => ({ title: "B" }) });

    expect(createdSince(), "函数型 style 换实现必须重建").toBe(2);
    expect(harness.attached("layer")).toBe(1);
    expect(harness.layerAttached(-2), "旧实例已摘除").toBe(false);
    expect(harness.layerCalls(-1), "新实例重新应用数据 ⇒ 既有要素用新样式").toEqual(["setData"]);

    await unmountAndSettle(wrapper);
    harness.assertIdle("函数型 style 替换");
  });

  it("[二轮 1] 非函数（对象）style 变化同样重建；同内容对象不重建", async () => {
    const { wrapper, setProp } = await mountOneLayer(4, { markerStyle: { title: "A" } });
    await setProp({ markerStyle: { title: "B" } });
    expect(createdSince(), "对象 style 内容变化 ⇒ 重建").toBe(2);

    await setProp({ markerStyle: { title: "B" } });
    expect(createdSince(), "同内容的新对象不重建（按值比较）").toBe(2);

    await unmountAndSettle(wrapper);
    harness.assertIdle("对象 style 替换");
  });

  it("[二轮 2] 字段 setter 的槽位（tile.zIndex）由有值变回 undefined ⇒ 重建", async () => {
    const tile = await mountOneLayer(2, { zIndex: 5 });
    expect(harness.layerCalls(-1)).toEqual(["setZIndex"]);

    await tile.setProp({ zIndex: undefined });
    expect(createdSince(), "zIndex 由 5 变回未表态 ⇒ 重建以回到 SDK 默认").toBe(2);
    expect(harness.layerCalls(-1), "新实例不再写 zIndex").toEqual([]);
    await unmountAndSettle(tile.wrapper);
    harness.assertIdle("zIndex 移除");
  });

  it("[二轮 2] 整袋 setter 的槽位（DOM.minZoom）由有值变回 undefined ⇒ 重建", async () => {
    const dom = await mountOneLayer(5, { minZoom: 3 });
    expect(harness.layerCalls(-1)).toEqual(["setData", "setStyleOptions"]);

    await dom.setProp({ minZoom: undefined });
    expect(createdSince(), "DOM 的 minZoom 走整袋 setter，同样要能回到默认").toBe(2);
    expect(harness.layerCalls(-1), "新实例只重新应用数据，不再写 minZoom").toEqual(["setData"]);
    await unmountAndSettle(dom.wrapper);
    harness.assertIdle("dom minZoom 移除");
  });

  it("[二轮 2] data 例外：null 是显式清空，不触发重建", async () => {
    const { wrapper, setProp } = await mountOneLayer(5);
    await setProp({ data: null });
    expect(createdSince(), "data: null 是 clear 语义，不是「未表态」").toBe(1);
    expect(harness.layerCalls(-1)).toEqual(["setData", "removeAllOverlays"]);
    await unmountAndSettle(wrapper);
    harness.assertIdle("data 清空");
  });

  it("[二轮 3] 整袋 setOptions 失败时不能被记成已应用（下一次更新要重试）", async () => {
    const { wrapper, setProp } = await mountOneLayer(5, { minZoom: 3, zIndex: 4 });
    expect(harness.layerCalls(-1)).toEqual(["setData", "setStyleOptions"]);

    const layer = fake.createdLayers[fake.createdLayers.length - 1] as unknown as {
      failNextSetStyleOptions: Error | null;
      appliedStyleBags: Record<string, unknown>[];
    };
    layer.failNextSetStyleOptions = new Error("setStyleOptions failed");
    await setProp({ minZoom: 6 });
    expect(harness.layerCalls(-1), "失败的那次调用确实发生了").toEqual([
      "setData",
      "setStyleOptions",
      "setStyleOptions",
    ]);
    expect(layer.appliedStyleBags, "失败的那一袋不该被记成已应用").toHaveLength(1);

    // 失败 ⇒ 记账不该提交 ⇒ 下一次任何变化都要把 minZoom 一起重试
    await setProp({ zIndex: 9 });
    const bags = layer.appliedStyleBags;
    expect(bags[bags.length - 1], "失败的 minZoom 必须与新值一起重试").toMatchObject({
      minZoom: 6,
      zIndex: 9,
    });

    await unmountAndSettle(wrapper);
    harness.assertIdle("整袋失败重试");
  });
});

/* -------------------------------------------------------------------------- */
/* 10. 评审修正（PR #96 第三轮）：DOM 事件契约、数据覆盖物清理与重建优先级        */
/* -------------------------------------------------------------------------- */

/**
 * 第三轮的三条代码发现。第一条是**契约层**（公开了真实订阅不到的事件），
 * 后两条是**清理与优先级**（该清的没清、该重建的会被异常挡住）。
 */
describe("[#40] §10 评审修正：DOM 事件契约、覆盖物清理与重建优先级", () => {
  it("[三轮 1 附属] createDom 变化不重建，但下一次数据解析用新实现（参考实现的 useLatest 语义）", async () => {
    // 这条钉住一处**有意保留**的差异：GeoJSON 的 style 换引用会重建（见 §9），而 DOMLayer 的
    // `createDom` 走转发（官方参考实现 huiyan-fe/react-bmap 就是 useLatest 包装）。
    // 两种语义都必须有正证，否则「为什么一个重建一个不重建」只能靠注释解释。
    const callA = vi.fn(() => document.createElement("div"));
    const callB = vi.fn(() => document.createElement("span"));
    const { wrapper, setProp } = await mountOneLayer(5, { createDom: callA });

    await setProp({ createDom: callB });
    expect(createdSince(), "createDom 换实现不重建图层").toBe(1);

    // `createDOM` 是**构造首参**（不在选项袋里），因此从替身实例上读那一份
    const stored = (
      fake.createdLayers[fake.createdLayers.length - 1] as unknown as {
        createDOM: (properties: object, point: { lng: number; lat: number }) => HTMLElement;
      }
    ).createDOM;
    expect(stored({}, { lng: 1, lat: 2 }).tagName, "SDK 手上的工厂已转发到新实现").toBe("SPAN");

    // 再重新赋值 data（数据驱动的一次解析）时，用的也是新工厂
    await setProp({ data: { type: "FeatureCollection", features: [] } });
    expect(createdSince()).toBe(1);
    expect(callB).toHaveBeenCalled();

    await unmountAndSettle(wrapper);
    harness.assertIdle("createDom 转发语义");
  });

  it("[三轮 1] 替身与官方声明一致：DOMLayer 有 addEventListener、没有 removeEventListener", () => {
    const { layers } = createFakeDriverPair();
    const dom = layers.create("dom", { createDOM }).raw as Record<string, unknown>;
    expect(typeof (dom as Record<string, unknown>).addEventListener).toBe("function");
    expect(
      typeof (dom as Record<string, unknown>).removeEventListener,
      "官方 4.0.4 的 DOMLayer 没有声明 removeEventListener；替身从基类继承来的那一半会让「订阅不到」被掩盖",
    ).toBe("undefined");
  });

  it("[三轮 1] 官方契约下 DOMLayer 的事件订阅会被 EventDriver 拒绝（warn + no-op）", () => {
    // 这条是「为什么 BDOMLayer 不公开事件」的机制正证：不是我们不想绑，是契约上**绑了就解不掉**。
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { layers, events } = createFakeDriverPair();
    const dom = layers.create("dom", { createDOM });
    const handler = vi.fn();
    const off = events.on(dom, "click", handler);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("addEventListener/removeEventListener"),
      expect.anything(),
    );
    (dom.raw as { emit?: (type: string, payload?: unknown) => void }).emit?.("click", {});
    expect(handler, "拒绝的订阅不该收到任何事件").not.toHaveBeenCalled();
    expect(() => off()).not.toThrow();
    warn.mockRestore();
  });

  it("[三轮 2 / 八轮 1] DOM 的节点在**摘挂时就被 SDK 摘掉**；重新可见靠**换新实例**把内容带回来", async () => {
    // ⚠️ 这条的期望在 issue #98 的 live 探针之后**反了过来**：实测真实 4.0 的
    // `map.removeLayer(domLayer)` 会把节点从文档摘掉（`isConnected` 2 → 0，`getCustomOverlays()`
    // 2 → 0）。替身原先没有建模这一条，于是「隐藏之后覆盖物仍在」在与真实相反的方向上成立。
    // 现在断言的是实测行为，分两半：①**摘挂改的是渲染、不是数据**（`data` 保持不变）；
    // ②「重新可见」**不是把旧实例挂回去**——真实 4.0 的实例被 removeLayer 之后再也渲染不了，
    // 内核因此换新实例（`needsRemountRebuild`），新实例按保留的数据重新渲染出来。
    const { wrapper, setProp } = await mountOneLayer(5);
    const layerOf = () =>
      fake.createdLayers[fake.createdLayers.length - 1] as unknown as {
        customOverlays: unknown[];
        detachedRenderCount: number;
        data: unknown;
      };

    expect(layerOf().customOverlays.length, "挂载时数据已渲染出覆盖物").toBeGreaterThan(0);
    const dataBeforeHide = layerOf().data;

    await setProp({ visible: false });
    expect(layerOf().customOverlays.length, "摘挂由 SDK 摘掉节点（实测）").toBe(0);
    expect(layerOf().detachedRenderCount, "摘挂走了一次渲染生命周期").toBe(1);
    expect(layerOf().data, "但**数据**保持不变：切回可见要按它重渲染").toBe(dataBeforeHide);

    await setProp({ visible: true });
    expect(createdSince(), "重新可见换了新实例").toBe(2);
    expect(
      layerOf().customOverlays.length,
      "新实例按保留的数据重新渲染出来（内容回来了）",
    ).toBeGreaterThan(0);

    await unmountAndSettle(wrapper);
    expect(layerOf().customOverlays.length, "永久销毁后不残留").toBe(0);
    harness.assertIdle("DOM 覆盖物清理");
  });

  it("[三轮 2] Map 被销毁（KeepAlive dispose）时，DOM 的覆盖物同样先被清掉", async () => {
    // 组件卸载那条路（上一条用例）走的是组件自己的 dispose；这条走**账本**驱动的 disposeAll，
    // 是「Registry 与 Map dispose 一致」在数据覆盖物上的对照。
    const show = ref(true);
    const Root = defineComponent({
      setup: () => () =>
        h(KeepAlive, null, {
          default: () =>
            show.value
              ? h(BMap, { provider: harness.provider(), keepAliveBehavior: "dispose" }, () => [
                  h(BDOMLayer, { createDom: createDOM, data: FEATURE_COLLECTION } as never),
                ])
              : null,
        }),
    });
    const wrapper = mount(Root, { attachTo: harness.container() });
    await settle();

    const layer = fake.createdLayers[fake.createdLayers.length - 1] as unknown as {
      customOverlays: unknown[];
    };
    expect(layer.customOverlays.length).toBeGreaterThan(0);

    show.value = false;
    await settle();

    expect(harness.attached("layer")).toBe(0);
    expect(layer.customOverlays.length, "Map 销毁时也要先清掉数据覆盖物").toBe(0);
    harness.assertIdle("KeepAlive dispose 清理覆盖物");

    await unmountAndSettle(wrapper);
    harness.assertIdle("KeepAlive dispose 之后卸载");
  });

  it("[三轮 3] 已判定「必须重建」时，不能被同一次更新里另一步的异常挡住（槽位移除方向）", async () => {
    // DOM 的 minZoom 走整袋 setter：摘掉它必须重建；同一次更新里 offsetX 变化要就地写。
    const { wrapper, setProp } = await mountOneLayer(5, { minZoom: 3, offsetX: 2 });
    const map = fake.createdMaps[fake.createdMaps.length - 1]!;
    const layer = fake.createdLayers[fake.createdLayers.length - 1] as unknown as {
      failNextSetStyleOptions: Error | null;
    };
    layer.failNextSetStyleOptions = new Error("setStyleOptions failed");

    await setProp({ minZoom: undefined, offsetX: 9 });

    expect(
      createdSince(),
      "zIndex/minZoom 这类槽位没有 unset 入口 ⇒ 必须重建；不能被 setStyleOptions 的异常挡掉",
    ).toBe(2);
    expect(harness.attached("layer")).toBe(1);
    expect(harness.layerAttached(-2)).toBe(false);
    void map;

    await unmountAndSettle(wrapper);
    harness.assertIdle("槽位移除优先于就地写入");
  });

  it("[三轮 3] 反方向：mutable option 已判定「键消失必须重建」时，也不能被槽位写入异常挡住", async () => {
    const { wrapper, setProp } = await mountOneLayer(3, { zIndex: 5, edge: true });
    const layer = fake.createdLayers[fake.createdLayers.length - 1] as unknown as {
      failNextSetZIndex: Error | null;
    };
    layer.failNextSetZIndex = new Error("setZIndex failed");

    await setProp({ zIndex: 6, edge: undefined });

    expect(createdSince(), "edge 由 true 变回未表态 ⇒ 必须重建").toBe(2);
    expect(harness.attached("layer")).toBe(1);
    expect(harness.layerAttached(-2)).toBe(false);

    await unmountAndSettle(wrapper);
    harness.assertIdle("option 移除优先于就地写入");
  });
});

/* -------------------------------------------------------------------------- */
/* 11. 第四轮评审修正：摘除失败后的重试、就地写入的「部分成功」与注释口径            */
/* -------------------------------------------------------------------------- */

describe("[#40] §11 评审修正：摘除失败的重试、部分成功的记账与注释口径", () => {
  it("[四轮 1] visible=false 时 removeLayer 抛错：永久销毁必须**再试一次**摘除（不留孤儿）", async () => {
    const errors: unknown[] = [];
    const props = ref<Record<string, unknown>>({ ...LAYER_CASES[2]!.props });
    const wrapper = mountTreeWithErrorProbe(errors, () => h(BTileLayer as never, props.value));
    await settle();
    expect(harness.attached("layer")).toBe(1);

    const map = fake.createdMaps[fake.createdMaps.length - 1]!;
    map.failNextRemoveLayer = new Error("removeLayer failed");

    props.value = { ...props.value, visible: false };
    await settle();
    expect(harness.attached("layer"), "「尚未完成移除就抛错」⇒ 图层仍在图上").toBe(1);
    expect(errors.length, "摘除失败必须经 resource:error 交出").toBeGreaterThan(0);

    await unmountAndSettle(wrapper);
    expect(
      harness.attached("layer"),
      "摘除失败不能把「调用过 addLayer」的记账一起复位：否则永久销毁不会再试，SDK 上留下孤儿",
    ).toBe(0);
    harness.assertIdle("removeLayer 失败后重试摘除");
  });

  it("[四轮 1 / 五轮 2 / #98] 摘除失败之后切回可见：**换新实例**恢复（不再依赖「重复摘除」）", async () => {
    // ⚠️ 这条跑的是**乐观契约分支**：默认替身对「不在图上的 layer」是 no-op，也就是**前提 P
    // （对已经摘掉的图层重复 `removeLayer` 是安全的）成立**。只有在这一分支下才保证收敛到
    // 「恰好挂一份」；前提不成立时的退化由 §13 的悲观契约用例成对钉住（收敛不保证发生、
    // 但可观测且不重复挂载）。见已知限制 14。
    const errors: unknown[] = [];
    const props = ref<Record<string, unknown>>({ ...LAYER_CASES[2]!.props });
    const wrapper = mountTreeWithErrorProbe(errors, () => h(BTileLayer as never, props.value));
    await settle();

    const map = fake.createdMaps[fake.createdMaps.length - 1]!;
    map.failNextRemoveLayer = new Error("removeLayer failed");
    props.value = { ...props.value, visible: false };
    await settle();
    expect(harness.attached("layer"), "「还没摘掉就抛错」⇒ 图层仍在图上").toBe(1);

    props.value = { ...props.value, visible: true };
    await settle();

    // 动作是「先 best-effort 摘一次、再挂」，不是猜。猜「还挂着」会让**真实已 detached** 的实例
    // 永远挂不回来（`failNextRemoveLayerAfterDetach` 那条形状，见 §12）；猜「已经下去了」会让仍在
    // 图上的实例被挂第二份（`addLayer` 不去重）。两条都错 ⇒ 只能做一次同步动作，而这次同步的成败
    // 取决于前提 P。
    expect(harness.attached("layer")).toBe(1);
    expect(createdSince(), "切回可见换新实例（摘掉过的实例不可复用）").toBe(2);
    expect(
      map.callLog.filter((call) => call === "removeLayer" || call === "addLayer"),
      "旧实例先被 best-effort 摘掉（重试那一次），再挂上新实例",
    ).toEqual(["addLayer", "removeLayer", "removeLayer", "addLayer"]);

    await unmountAndSettle(wrapper);
    expect(harness.attached("layer")).toBe(0);
    harness.assertIdle("摘除失败后切回可见");
  });

  it("[四轮 1] 窄角：**永久销毁那一次**摘除也失败时，只剩可观测性（登记为已知限制，不假装无残留）", async () => {
    // 这条钉住上一次修复的边界：重试的机会来自「还有后续的 dispose 路径」。如果**最后一次**
    // 摘除本身失败，组件已经卸载、账本记录也已一次性作废，没有任何一侧还能再试 —— 真实 SDK 里
    // 收口的是 `map.destroy()` 自己。此时唯一正确的承诺是「可观测」，不是「无残留」。
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrapper = mountLayerTree(() =>
      h(BTileLayer as never, { ...LAYER_CASES[2]!.props } as never),
    );
    await settle();

    const map = fake.createdMaps[fake.createdMaps.length - 1]!;
    map.failNextRemoveLayer = new Error("removeLayer failed");
    await unmountAndSettle(wrapper);

    expect(
      warn.mock.calls.some((call) => String(call[0]).includes("SDK 资源可能仍在图上")),
      "最后一次摘除失败必须留下日志（否则它是静默失败）",
    ).toBe(true);
    // 刻意**不**断言 attached 归零，也刻意不调 `assertIdle()`：这条路径下确实留着孤儿，
    // 假装它消失比留一个可观测的告警更糟。
    warn.mockRestore();
  });

  it("[四轮 2] 逐 setter 的部分成功：colors 已写进 SDK、edge 抛错 ⇒ colors 变回未表态必须重建", async () => {
    // 这条钉住「就地写入不是事务」：官方对 `TrafficLayer` 只给了两个字段级 setter，传一个袋子时
    // Driver 只能**逐 setter** 调用，于是「第一个键生效、第二个键抛错」是真实可达的部分成功。
    const errors: unknown[] = [];
    const props = ref<Record<string, unknown>>({});
    const wrapper = mountTreeWithErrorProbe(errors, () => h(BTrafficLayer as never, props.value));
    await settle();

    const layerOf = () =>
      fake.createdLayers[fake.createdLayers.length - 1] as unknown as {
        colors: string[] | null;
        failNextSetEdge: Error | null;
      };
    layerOf().failNextSetEdge = new Error("setEdge failed");

    // 这一次更新把两个键一起交出去：`setColors` 生效、`setEdge` 抛错
    props.value = { colors: ["#00ff00"], edge: true };
    await settle();

    expect(layerOf().colors, "同批第一个键**真的**写进了 SDK").toEqual(["#00ff00"]);
    expect(errors.length, "同批第二个键的失败经 resource:error 交出").toBeGreaterThan(0);
    expect(createdSince(), "只是就地写入失败，这一步不该重建").toBe(1);

    // 关键一步：colors 从「有值」变回「未表态」。它**可能**已经写进过 SDK（这里的事实是确实写了），
    // 所以只有重建能让它回到 SDK 自己的默认 colors —— 只看「成功写入过」的账本会漏掉它。
    props.value = { edge: true };
    await settle();

    expect(createdSince(), "「可能已写入」的键消失 ⇒ 必须重建").toBe(2);
    expect(harness.attached("layer")).toBe(1);
    expect(
      fake.createdLayers[fake.createdLayers.length - 1] as unknown as { colors: string[] | null },
    ).toMatchObject({ colors: null });
    expect(harness.layerAttached(-2), "旧实例已经摘掉（原子替换）").toBe(false);

    await unmountAndSettle(wrapper);
    harness.assertIdle("部分成功后的重建");
  });

  it("[四轮 2] 统一槽位的写入失败同样记「尝试过」：槽位消失时保守重建", async () => {
    const errors: unknown[] = [];
    const props = ref<Record<string, unknown>>({ ...LAYER_CASES[2]!.props });
    const wrapper = mountTreeWithErrorProbe(errors, () => h(BTileLayer as never, props.value));
    await settle();

    const layerOf = () =>
      fake.createdLayers[fake.createdLayers.length - 1] as unknown as {
        zIndex: number | null;
        failNextSetZIndex: Error | null;
      };
    layerOf().failNextSetZIndex = new Error("setZIndex failed");

    props.value = { ...props.value, zIndex: 5 };
    await settle();
    expect(errors.length).toBeGreaterThan(0);
    expect(createdSince(), "就地写入失败（而不是「必须重建」）不换实例").toBe(1);

    props.value = { ...props.value, zIndex: undefined };
    await settle();

    // 替身是「改之前」抛错，SDK 其实没变——但内核**无法区分**「抛在改之前」与「抛在改之后」
    // （与 `mountAttempted` 同一条理由）。这里刻意选保守侧：多重建一次（代价是一次重挂），
    // 而不是让声明与 SDK 的状态永久分叉。这一条是在钉「判据用的是尝试账本，不是成功账本」。
    expect(createdSince(), "「可能已写入」的槽位消失 ⇒ 保守重建").toBe(2);
    expect(harness.attached("layer")).toBe(1);

    await unmountAndSettle(wrapper);
    harness.assertIdle("槽位写入失败后的保守重建");
  });

  it("[四轮 2] 整袋 setter「已生效再抛错」：槽位消失时必须重建，否则 SDK 永久保留旧值", async () => {
    // 上一条用的是「改之前抛」，所以那个重建是**保守侧**。这一条把真正危险的那一半建出来：
    // `setStyleOptions` 先写进 SDK 再抛错，于是 `minZoom` 在 SDK 上**确实**是 3，而账本上
    // 没有任何成功记录。此时若不重建，声明（未表态）与 SDK（3）就永久分叉。
    const errors: unknown[] = [];
    const props = ref<Record<string, unknown>>({ ...LAYER_CASES[5]!.props });
    const wrapper = mountTreeWithErrorProbe(errors, () => h(BDOMLayer as never, props.value));
    await settle();

    const layerOf = () =>
      fake.createdLayers[fake.createdLayers.length - 1] as unknown as {
        failNextSetStyleOptionsAfterApply: Error | null;
      };
    layerOf().failNextSetStyleOptionsAfterApply = new Error("setStyleOptions failed");

    props.value = { ...props.value, minZoom: 3 };
    await settle();
    expect(errors.length).toBeGreaterThan(0);
    expect(
      (layerOf() as unknown as { options: Record<string, unknown> }).options.minZoom,
      "故障注入在写入之后 ⇒ SDK 侧**已经**生效，而账本上没有任何成功记录",
    ).toBe(3);
    expect(createdSince(), "抛错的这一步本身不重建").toBe(1);

    props.value = { ...props.value, minZoom: undefined };
    await settle();

    expect(createdSince(), "已经生效过的槽位消失 ⇒ 必须重建").toBe(2);
    expect(
      harness.layerOptions(-1).minZoom,
      "新实例的构造选项里不该出现它（回到 SDK 默认）",
    ).toBeUndefined();
    expect(harness.attached("layer")).toBe(1);

    await unmountAndSettle(wrapper);
    harness.assertIdle("整袋「已生效再抛错」后的重建");
  });

  it("[四轮补测 / 五轮 3 / 八轮 1] DOM：先 visible=false 再卸载——只清空、不再摘除；清空对 detached 实例是安全 no-op", async () => {
    // 第五轮评审指出的措辞问题：`visible=false` 那一次摘除**成功**之后 `mountAttempted` 已复位，
    // 卸载时 `unmount(permanent=true)` 先 `tearDownData()`、随后在 `if (!mountAttempted) return`
    // 处结束 —— **没有第二次 `removeLayer()`**。所以这条描述的是「对已经 detached 的实例做清空」，
    // 不是「清空之后再摘一次」；原来的标题/注释说的是后者，等于在证明一个实现里不存在的动作。
    //
    // 为什么不让永久销毁无条件再摘一次：官方**没有**承诺「对已经摘掉的图层重复 `removeLayer`
    // 是安全的」，本库不猜（与「不做假支持」同一口径）。这条用例把真实调用次数钉住。
    //
    // 第八轮之后这条又多了两个**由 #98 的 live 探针给出**的读数：
    // ① `removeLayer` 本身已经把节点摘掉（所以 detached 时 `customOverlays` 本来就是 0）；
    // ② 对 detached 实例再调 `removeAllOverlays()` 是安全的 no-op（实测未抛错）⇒ 我们照常调它，
    //    并把「这次调用发生在未挂载状态下」记成 `attachedAtClear === false`。
    const { wrapper, setProp } = await mountOneLayer(5);
    const layerOf = () =>
      fake.createdLayers[fake.createdLayers.length - 1] as unknown as {
        customOverlays: unknown[];
        attachedAtClear: boolean | null;
      };
    const map = fake.createdMaps[fake.createdMaps.length - 1]!;
    const removeCalls = () => map.callLog.filter((call) => call === "removeLayer").length;

    expect(layerOf().customOverlays.length).toBeGreaterThan(0);

    await setProp({ visible: false });
    expect(harness.attached("layer"), "隐藏本身就摘了一次").toBe(0);
    expect(removeCalls(), "隐藏那一次摘除成功").toBe(1);
    expect(layerOf().customOverlays.length, "摘挂时 SDK 就把节点摘掉了（实测）").toBe(0);

    await unmountAndSettle(wrapper);
    expect(
      layerOf().attachedAtClear,
      "永久销毁仍然走清空入口（对 detached 实例是安全 no-op，实测未抛错）",
    ).toBe(false);
    expect(layerOf().customOverlays.length, "不残留").toBe(0);
    expect(
      removeCalls(),
      "已经摘掉的实例不再重复 removeLayer（官方没有承诺那是安全的）",
    ).toBe(1);
    expect(harness.attached("layer")).toBe(0);
    harness.assertIdle("隐藏之后再卸载");
  });
});

/* -------------------------------------------------------------------------- */
/* 12. 第五轮评审修正：成功态指纹的失效与 mount 状态收敛                          */
/* -------------------------------------------------------------------------- */

describe("[#40] §12 评审修正：成功态指纹的失效与 mount 状态收敛", () => {
  it("[五轮 1] Traffic 部分成功之后改回上一次成功值，必须真的重写 SDK", async () => {
    // `possiblyApplied*` 解决的是「之后把键删掉要不要重建」；这条钉的是**另一半**：
    // 一次「可能已经产生副作用」的失败之后，成功态去重指纹不再代表 SDK 的当前值。
    const { wrapper, setProp } = await mountOneLayer(3, { colors: ["#ff0000"], edge: false });
    const layerOf = () =>
      fake.createdLayers[fake.createdLayers.length - 1] as unknown as {
        colors: string[] | null;
        failNextSetEdge: Error | null;
      };
    expect(layerOf().colors, "挂载时写进了 SDK").toEqual(["#ff0000"]);

    layerOf().failNextSetEdge = new Error("setEdge failed");
    await setProp({ colors: ["#00ff00"], edge: true });
    expect(layerOf().colors, "同批第一个键**真的**生效了，而整袋调用失败了").toEqual(["#00ff00"]);

    // 改回**上一次成功值**：指纹与 `appliedMutableKey` 相同，但 SDK 已经被改成 00ff00。
    await setProp({ colors: ["#ff0000"], edge: false });
    expect(
      layerOf().colors,
      "DP 回到 A ⇒ SDK 必须也被写回 A（去重指纹在失败之后必须先失效）",
    ).toEqual(["#ff0000"]);

    await unmountAndSettle(wrapper);
    harness.assertIdle("部分成功之后回滚到旧值");
  });

  it("[五轮 1] DOM 整袋「已生效再抛错」之后改回上一次成功值，必须重写（槽位同样不能陈旧）", async () => {
    const { wrapper, setProp } = await mountOneLayer(5, { minZoom: 3 });
    const layerOf = () =>
      fake.createdLayers[fake.createdLayers.length - 1] as unknown as {
        options: Record<string, unknown>;
        appliedStyleBags: Record<string, unknown>[];
        failNextSetStyleOptionsAfterApply: Error | null;
      };
    expect(layerOf().options.minZoom, "挂载时写进了 SDK").toBe(3);
    const bagsAfterMount = layerOf().appliedStyleBags.length;

    layerOf().failNextSetStyleOptionsAfterApply = new Error("setStyleOptions failed");
    await setProp({ minZoom: 6 });
    expect(layerOf().options.minZoom, "整袋**已经生效**之后才抛错").toBe(6);
    expect(createdSince(), "抛错本身不重建").toBe(1);

    await setProp({ minZoom: 3 });
    expect(layerOf().options.minZoom, "改回上一次成功值也必须真的重写").toBe(3);
    expect(
      layerOf().appliedStyleBags.length,
      "必须有新的一次 setStyleOptions 调用（不能被槽位指纹去重跳过）",
    ).toBe(bagsAfterMount + 2);

    await unmountAndSettle(wrapper);
    harness.assertIdle("整袋部分成功之后回滚到旧值");
  });

  it("[五轮 1] data「换了再抛错」之后换回上一次成功那份引用，必须真的重写", async () => {
    // `data` 的去重是**按引用**的，因此它有和指纹完全一样的缺陷形状：失败那一次已经把 SDK 的
    // 数据换掉了，而账本还停在旧引用上；用户换回旧引用时会被误判成「已经写过了」。
    const dataA = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "Point", coordinates: [116.404, 39.915] }, properties: { id: "A" } },
      ],
    };
    const dataB = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "Point", coordinates: [121.47, 31.23] }, properties: { id: "B" } },
      ],
    };
    const { wrapper, setProp } = await mountOneLayer(4, { data: dataA });
    const layerOf = () =>
      fake.createdLayers[fake.createdLayers.length - 1] as unknown as {
        data: object | null;
        failNextSetDataAfterApply: Error | null;
      };
    const idOf = (value: object | null) =>
      (value as { features: Array<{ properties: { id: string } }> } | null)?.features[0]?.properties.id;
    // 注意：props 里的对象会被 Vue 包成 reactive 代理，因此**不能**直接与 `dataA` 比引用。
    // 这里记下「挂载那一刻 SDK 拿到的那个引用」，后面用它做「换回上一次成功值」的对照。
    const mountedData = layerOf().data;
    expect(idOf(mountedData), "挂载时写进去的是 A").toBe("A");

    layerOf().failNextSetDataAfterApply = new Error("setData failed");
    await setProp({ data: dataB });
    expect(idOf(layerOf().data), "SDK 已经换成 B，而调用方收到的是异常").toBe("B");

    await setProp({ data: dataA });
    expect(
      layerOf().data,
      "换回 A 必须真的重写（按引用的去重指纹同样要先失效），而不是被误判成「已经写过了」",
    ).toBe(mountedData);

    await unmountAndSettle(wrapper);
    harness.assertIdle("data 换了再抛错之后回滚");
  });

  it("[五轮 2 / #98] removeLayer「先摘掉、再抛错」：切回可见要能重新挂上（走重建）", async () => {
    // 与 §11 的「摘之前抛」是两条不同的状态机路径。这条的关键是：**调用方唯一能观测的
    // 「挂没挂上」证据就是调用有没有成功返回**，所以失败之后不能把「还挂着」当结论。
    const { wrapper, setProp } = await mountOneLayer(2);
    expect(harness.attached("layer")).toBe(1);

    const map = fake.createdMaps[fake.createdMaps.length - 1]!;
    map.failNextRemoveLayerAfterDetach = new Error("removeLayer failed after detach");

    await setProp({ visible: false });
    expect(harness.attached("layer"), "SDK 先摘掉再抛错 ⇒ 图上确实已经没有它").toBe(0);

    await setProp({ visible: true });
    expect(
      harness.attached("layer"),
      "不能因为「两层记账都说还挂着」就永远挂不回来",
    ).toBe(1);
    // #98 之后这里改走**重建**：真实 4.0 的实例一旦被 removeLayer 就再也渲染不了，
    // 所以「重新可见」不是把旧实例挂回去，而是换一个新实例（`needsRemountRebuild`）。
    expect(createdSince(), "重新可见换新实例").toBe(2);

    await unmountAndSettle(wrapper);
    expect(harness.attached("layer")).toBe(0);
    harness.assertIdle("detach 之后抛错的收敛");
  });
});

/* -------------------------------------------------------------------------- */
/* 13. 清空入口的调用时机与「重复摘除」前提（第六轮发现 + #98 live 取证）        */
/* -------------------------------------------------------------------------- */

describe("[#40] §13 评审修正：清空入口的调用时机与「重复摘除」前提（#98 取证后）", () => {
  it("[#98] 替身与实测一致：removeLayer 之后重新 addLayer **不会**重新渲染", async () => {
    // 这条钉的是**替身本身**的建模，不是内核行为。理由：真实 4.0 的实例被 removeLayer 之后
    // 再也渲染不了（live 读数：重挂载后节点仍为 0，补 setData 还抛 reading coordinate），
    // 内核因此改成「重新可见一律重建」。如果替身哪天被改回「重挂载会按保留数据重渲染」，
    // 那条内核缺陷就会被**测试全绿**地掩盖过去（这正是 #96 期间发生过的形态）。
    // 探针：`scripts/probe-layer-detached.mts` 的第三组读数。
    const wrapper = mountLayerTree(() => null);
    await settle();
    const map = fake.createdMaps[fake.createdMaps.length - 1]!;
    const { layers } = createFakeDriverPair();
    const handle = layers.create("dom", { createDOM });
    const raw = handle.raw as unknown as { customOverlays: object[]; setData(value: object): void };

    map.addLayer(handle.raw as never);
    raw.setData(FEATURE_COLLECTION);
    expect(raw.customOverlays.length, "首次挂载渲染出节点").toBe(1);

    map.removeLayer(handle.raw as never);
    expect(raw.customOverlays.length, "摘除时节点被摘掉（实测）").toBe(0);

    map.addLayer(handle.raw as never);
    expect(
      raw.customOverlays.length,
      "重新挂载**不会**重新渲染 —— 替身必须与实测一致，否则会掩盖内核缺陷",
    ).toBe(0);

    await unmountAndSettle(wrapper);
  });

  it("[六轮 1] GeoJSON：挂载中卸载 ⇒ 清空发生在图层**仍在图上**时（官方要求的顺序）", async () => {
    const { wrapper } = await mountOneLayer(4);
    const layerOf = () =>
      fake.createdLayers[fake.createdLayers.length - 1] as unknown as {
        attachedAtClear: boolean | null;
        data: unknown;
      };
    expect(layerOf().attachedAtClear, "挂载期间还没清过").toBeNull();

    await unmountAndSettle(wrapper);

    expect(layerOf().attachedAtClear, "clearData 之前图层仍在图上").toBe(true);
    expect(layerOf().data, "集合被真正清空").toBeNull();
    harness.assertIdle("attached 卸载");
  });

  it("[六轮 1 / 七轮 1 / 八轮 1] GeoJSON：先 visible=false 再卸载 ⇒ 清空**照常发生**（实测 detached 之后仍有效）", async () => {
    // ⚠️ 这条的期望在 #98 取证后**反了过来**。此前依据是 reference 那句「要真正清空 getData()
    // 集合，得在 removeLayer **之前**调用 clearData()（之后图层不再持有 Map 引用）」，于是内核在
    // detached 时跳过它。live 探针实测：`removeLayer` 之后 `getData()` 仍是 2 条，此时再调
    // `clearData()` **把它清成了 0 且未抛错** ⇒ 那句话与运行时不符，跳过没有依据。
    // 现在统一执行；`attachedAtClear === false` 记录「这次调用发生在未挂载状态下」。
    const { wrapper, setProp } = await mountOneLayer(4);
    const layerOf = () =>
      fake.createdLayers[fake.createdLayers.length - 1] as unknown as {
        attachedAtClear: boolean | null;
        data: unknown;
      };

    await setProp({ visible: false });
    expect(harness.attached("layer"), "隐藏已经摘过一次").toBe(0);

    await unmountAndSettle(wrapper);

    expect(
      layerOf().attachedAtClear,
      "清空在 detached 状态下执行（实测有效且未抛错）",
    ).toBe(false);
    expect(layerOf().data, "集合被清空").toBeNull();
    harness.assertIdle("detached 卸载（geojson）");
  });

  it("[六轮 1 / 七轮 1 / 八轮 1] DOM：先 visible=false 再卸载 ⇒ 清空照常执行（实测对 detached 实例是安全 no-op）", async () => {
    // #98 的 live 探针给了两个读数：① `removeLayer` 自己就把节点从文档摘掉（`isConnected` 2 → 0）；
    // ② 之后再调 `removeAllOverlays()` 未抛错、也没东西可清。因此「照常调用」既有依据、也没有代价。
    const { wrapper, setProp } = await mountOneLayer(5);
    const layerOf = () =>
      fake.createdLayers[fake.createdLayers.length - 1] as unknown as {
        attachedAtClear: boolean | null;
        customOverlays: unknown[];
      };

    await setProp({ visible: false });
    expect(layerOf().customOverlays.length, "摘挂时 SDK 已把节点摘掉（实测）").toBe(0);

    await unmountAndSettle(wrapper);

    expect(
      layerOf().attachedAtClear,
      "detached 时仍会调用 removeAllOverlays（实测：安全 no-op，未抛错）",
    ).toBe(false);
    expect(layerOf().customOverlays.length, "不残留").toBe(0);
    harness.assertIdle("detached 卸载（dom）");
  });

  it("[#98] 连续两次「摘除前」失败：旧实例仍在图上时，**绝不能**换实例挂出第二份", async () => {
    // 评审指出的分支：第一次 `visible=false` 的 removeLayer 在**摘除前**抛错 ⇒ 旧实例仍在图上、
    // `mountState === "unknown"`；随后 `visible=true` 时如果直接 `replace()`，`LayerRegistry.dispose()`
    // 会吞掉第二次失败并**永久删除记录**（旧实例此后没有任何一侧能重试清理），而新实例照常挂上
    // ⇒ 图上两份。这条钉住「换实例之前必须先确认旧实例真的下来了」。
    const errors: unknown[] = [];
    const props = ref<Record<string, unknown>>({ ...LAYER_CASES[2]!.props });
    const wrapper = mountTreeWithErrorProbe(errors, () => h(BTileLayer as never, props.value));
    await settle();

    const map = fake.createdMaps[fake.createdMaps.length - 1]!;
    map.failNextRemoveLayer = new Error("removeLayer failed before detach #1");
    props.value = { ...props.value, visible: false };
    await settle();
    expect(harness.attached("layer"), "第一次失败：图层仍在图上").toBe(1);

    // 第二次也让它失败（收敛那一次）：这才是「摘除前**持续**失败」的形状。
    map.failNextRemoveLayer = new Error("removeLayer failed before detach #2");
    props.value = { ...props.value, visible: true };
    await settle();

    expect(
      harness.attached("layer"),
      "收敛失败 ⇒ 不换实例：宁可暂时不回来，也绝不能出现两份",
    ).toBe(1);
    expect(createdSince(), "没有创建第二个实例").toBe(1);
    expect(errors.length, "两次失败都要可观测").toBeGreaterThanOrEqual(2);

    await unmountAndSettle(wrapper);
    harness.assertIdle("连续两次摘除失败之后");
  });

  it("[#98 四轮] **attached** 时构造期 option 变化 + 摘除前失败 ⇒ 不换实例（同一入口覆盖三条重建路径）", async () => {
    // 评审指出：上一轮的保护只接在 `needsRemountRebuild` 上，同一个 watch 里另外两条 `replace()`
    // （构造指纹变化 / 已写入值变回未表态）仍然绕过。这条**不需要先进入 `unknown`**：旧实例正常
    // `attached`，一次构造期 option 变化触发重建，同时让这次 `removeLayer` 在**摘除前**失败——
    // 若直接 `replace()`，`LayerRegistry.dispose()` 会吞掉失败并永久删除记录，随后新实例继续
    // `addLayer` ⇒ 图上两份（旧实例连账本都没了）。这条钉住「入口只有一个」。
    const errors: unknown[] = [];
    const props = ref<Record<string, unknown>>({ ...LAYER_CASES[2]!.props });
    const wrapper = mountTreeWithErrorProbe(errors, () => h(BTileLayer as never, props.value));
    await settle();
    expect(harness.attached("layer"), "前置：旧实例正常挂着（不是 unknown）").toBe(1);

    const map = fake.createdMaps[fake.createdMaps.length - 1]!;
    map.failNextRemoveLayer = new Error("removeLayer failed before detach");
    props.value = { ...props.value, tileUrlTemplate: "https://a2.example.com/{X}/{Y}/{Z}.png" };
    await settle();

    expect(
      harness.attached("layer"),
      "收敛失败 ⇒ 不换实例：宁可暂时用着旧实例，也绝不能出现两份",
    ).toBe(1);
    expect(createdSince(), "没有创建第二个实例").toBe(1);
    expect(harness.layerOptions(-1).tileUrlTemplate, "旧实例仍是旧 URL").toBe(
      "https://a.example.com/{X}/{Y}/{Z}.png",
    );
    expect(errors.length, "第一次失败必须可观测").toBeGreaterThan(0);

    await unmountAndSettle(wrapper);
    harness.assertIdle("构造期变化 + 摘除失败之后");
  });

  it("[#98 四轮] 「已写入的槽位变回未表态」那条重建路径同样受保护", async () => {
    // 第三条重建路径走的是**另一个判定**（`detectRemovedState` 的 `removed.length > 0`），
    // 但换实例这一步必须是同一个入口，否则同样能挂出两份。
    const errors: unknown[] = [];
    const props = ref<Record<string, unknown>>({ ...LAYER_CASES[2]!.props, zIndex: 5 });
    const wrapper = mountTreeWithErrorProbe(errors, () => h(BTileLayer as never, props.value));
    await settle();
    expect(harness.attached("layer")).toBe(1);

    const map = fake.createdMaps[fake.createdMaps.length - 1]!;
    map.failNextRemoveLayer = new Error("removeLayer failed before detach");
    props.value = { ...props.value, zIndex: undefined };
    await settle();

    expect(harness.attached("layer"), "不换实例：不出现两份").toBe(1);
    expect(createdSince(), "没有创建第二个实例").toBe(1);
    expect(errors.length, "失败必须可观测").toBeGreaterThan(0);

    await unmountAndSettle(wrapper);
    harness.assertIdle("槽位移除 + 摘除失败之后");
  });

  it("[#98 五轮] 收敛失败之后，**下一次 props 变化**仍能重试成功（「暂时不回来」不是永久降级）", async () => {
    // 「宁可暂时用着旧实例」这条承诺必须配一条「以后还能回来」，否则它就退化成永久降级。
    // 这条也顺带覆盖了收敛失败后的那个中间状态（该代业务监听已解绑、实例仍在图上）：
    // 重试成功之后新一代带着自己的 `bind` 监听，`attach` / 卸载都能正常收尾。
    const errors: unknown[] = [];
    const props = ref<Record<string, unknown>>({ ...LAYER_CASES[2]!.props });
    const wrapper = mountTreeWithErrorProbe(errors, () => h(BTileLayer as never, props.value));
    await settle();

    const map = fake.createdMaps[fake.createdMaps.length - 1]!;
    map.failNextRemoveLayer = new Error("removeLayer failed before detach");
    props.value = { ...props.value, tileUrlTemplate: "https://a2.example.com/{X}/{Y}/{Z}.png" };
    await settle();
    expect(harness.attached("layer"), "第一次失败：不换实例").toBe(1);
    expect(createdSince()).toBe(1);

    // 故障注入是一次性的 ⇒ 这一次收敛会成功。
    props.value = { ...props.value, tileUrlTemplate: "https://a3.example.com/{X}/{Y}/{Z}.png" };
    await settle();

    expect(harness.attached("layer")).toBe(1);
    expect(createdSince(), "重试成功 ⇒ 换了实例").toBe(2);
    expect(harness.layerOptions(-1).tileUrlTemplate).toBe("https://a3.example.com/{X}/{Y}/{Z}.png");

    await unmountAndSettle(wrapper);
    expect(harness.attached("layer")).toBe(0);
    harness.assertIdle("收敛失败后重试");
  });

  it("[六轮 2 / #98] 悲观契约下（detached 时 removeLayer 抛错）：无法确认旧实例已下来 ⇒ **不换实例**（绝不出现两份）", async () => {
    // 前提 P（「对已经摘掉的图层再调一次 removeLayer 是安全的」）在真实 4.0 上**已实测成立**
    // （issue #98 的 live 探针：GeoJSON / DOM / Tile 三个家族都未抛错），所以本库现在可以正当地
    // 依赖它。这条用例改用**悲观契约**（`failRemoveLayerWhenDetached`：目标不在图上时抛错）钉住
    // 一条**防御性不变量**：万一将来某个 kind 或某个 SDK 版本不成立，退化必须是**有界且可观测**的
    // —— 收敛不发生（图层保持 unknown、不在地图上），失败经 `resource:error` 交出，且**绝不会**
    // 因为「猜已经下去了」去 `add` 而出现两份。
    const errors: unknown[] = [];
    const props = ref<Record<string, unknown>>({ ...LAYER_CASES[2]!.props });
    const wrapper = mountTreeWithErrorProbe(errors, () => h(BTileLayer as never, props.value));
    await settle();

    const map = fake.createdMaps[fake.createdMaps.length - 1]!;
    map.failNextRemoveLayerAfterDetach = new Error("removeLayer failed after detach");
    map.failRemoveLayerWhenDetached = new Error("removeLayer on detached layer");

    props.value = { ...props.value, visible: false };
    await settle();
    expect(harness.attached("layer"), "第一次摘除已经把图层拿下去了").toBe(0);
    const errorsAfterHide = errors.length;
    expect(errorsAfterHide, "第一次失败可观测").toBeGreaterThan(0);

    props.value = { ...props.value, visible: true };
    await settle();

    // 悲观契约下「对已摘下的实例再摘一次会抛错」，于是**无法确认旧实例是否真的下来了**。
    // 这一版如实退化：**不做任何会再加一份的动作**（不换实例、也不重新挂载），失败经
    // `resource:error` 交出，留到下一次机会（永久销毁时还会再试）。
    // 这条正是「摘除失败时绝不重复挂载」这个不变量的悲观侧。
    expect(
      harness.attached("layer"),
      "状态无法确认 ⇒ 绝不重复挂载（宁可暂时不回来，也不能出现两份）",
    ).toBe(0);
    expect(createdSince(), "没有换实例").toBe(1);
    expect(errors.length, "退化必须可观测").toBeGreaterThan(errorsAfterHide);

    await unmountAndSettle(wrapper);
    expect(harness.attached("layer")).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 14. 网络图层的加载观察面（#97 的 live 取证之后）                              */
/* -------------------------------------------------------------------------- */

describe("[#97] §14 网络图层的加载观察面", () => {
  it("不给观察者 ⇒ 本库不表态：构造选项里根本没有 tileLoadFunction（默认加载路径不受影响）", async () => {
    const { wrapper } = await mountOneLayer(2);
    expect(
      harness.layerOptions(-1).tileLoadFunction,
      "没有观察需求时不得改变任何行为：这个 option 必须是缺席而不是「一个什么都不做的函数」",
    ).toBeUndefined();
    await unmountAndSettle(wrapper);
    harness.assertIdle("tile 无观察者");
  });

  it("给观察者 ⇒ 装上包装：SDK 手上的函数会回调观察者并**自己完成默认加载**", async () => {
    // 依据（真实 4.0 实测）：`tileLoadFunction` 是接管式的——设了它，SDK 就不再自己加载
    // （静默钩子下那块瓦片 `naturalWidth = 0`）；在钩子里自己赋 `tile.src = url` 才能恢复
    // （`naturalWidth = 256`）。所以包装必须替用户完成加载，否则用户会**静默失去瓦片**。
    const onRequest = vi.fn();
    const { wrapper } = await mountOneLayer(2, { tileLoadObserver: { onRequest } });

    const installed = harness.layerOptions(-1).tileLoadFunction as
      | ((tile: HTMLImageElement, url: string) => void)
      | undefined;
    expect(typeof installed, "观察者是回调型 option：交给 SDK 的是一个函数").toBe("function");

    const tile = document.createElement("img");
    installed!(tile, "https://tiles.example/1/2/3.png");
    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(tile.getAttribute("src"), "包装内部完成默认加载").toBe("https://tiles.example/1/2/3.png");

    await unmountAndSettle(wrapper);
    harness.assertIdle("tile 观察者");
  });

  it("同时给了官方 tileLoadFunction ⇒ 加载交给它接管，本库只在旁边观察", async () => {
    const onRequest = vi.fn();
    const takeover = vi.fn();
    const { wrapper } = await mountOneLayer(2, {
      tileLoadObserver: { onRequest },
      tileLoadFunction: takeover,
    });

    const installed = harness.layerOptions(-1).tileLoadFunction as (
      tile: HTMLImageElement,
      url: string,
    ) => void;
    const tile = document.createElement("img");
    installed(tile, "https://tiles.example/9.png");

    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(takeover).toHaveBeenCalledWith(tile, "https://tiles.example/9.png");
    expect(tile.getAttribute("src"), "接管时不得替调用方决定怎么加载").toBeNull();

    await unmountAndSettle(wrapper);
    harness.assertIdle("tile 观察者 + 接管");
  });

  it("WMS / WMTS / Raster 三个家族同样接上观察面（不是只改了 tile）", async () => {
    for (const [index, name] of [
      [7, "BWMSLayer"],
      [8, "BWMTSLayer"],
      [9, "BRasterLayer"],
    ] as const) {
      const onRequest = vi.fn();
      const { wrapper } = await mountOneLayer(index, { tileLoadObserver: { onRequest } });
      const installed = harness.layerOptions(-1).tileLoadFunction as
        | ((tile: HTMLImageElement, url: string) => void)
        | undefined;
      expect(typeof installed, `${name} 应当装上观察面包装`).toBe("function");
      const tile = document.createElement("img");
      installed!(tile, "https://tiles.example/w.png");
      expect(onRequest, `${name} 的观察者应当被回调`).toHaveBeenCalledTimes(1);
      expect(tile.getAttribute("src"), `${name} 的包装应当完成默认加载`).toBe(
        "https://tiles.example/w.png",
      );
      await unmountAndSettle(wrapper);
    }
    harness.assertIdle("三个其余家族");
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
