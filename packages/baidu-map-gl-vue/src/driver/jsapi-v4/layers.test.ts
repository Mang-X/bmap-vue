/**
 * v4 LayerDriver（M3A2-CONTROLS-LAYERS / issue #22）
 *
 * 验收点（对应 issue #22 的「测试要求」与「验收标准」）：
 * - issue 目标与范围列出的图层（DistrictLayer / PanoramaCoverageLayer / 已公开能力）都有
 *   create / add / remove / options 测试；
 * - 4.0 的**统一**入口 `map.addLayer/removeLayer`（不是 deprecated 的 addDistrictLayer/addTileLayer）；
 * - `viewport` → `autoViewport` 的显式改名；
 * - option 分类：`TileLayer.zIndex` 就地更新，`DistrictLayer` 的构造期项告警且不动；
 * - 4.0.4 类型包没有类声明的 `PanoramaCoverageLayer` 按结构探测，缺成员显式失败；
 * - 能力守卫先于构造（不支持时不产生「创建好但没人用」的实例）；
 * - Target：Map 目标原子加/摘，非 Map 目标显式失败。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createFakeBMapV4, type FakeBMapV4 } from "../../../../test-utils";
import { createCapabilityRegistry } from "../capability/registry";
import { HANDLE_BRAND, type LayerHandle } from "../types/handles";
import { createJsapiV4LayerDriver } from "./layers";
import { createJsapiV4HandleRegistry } from "./registry";

const LAYER_KINDS = ["district", "panorama-coverage", "tile"] as const;

function setup(
  options: {
    rawSdk?: unknown;
    unsupported?: "throw" | "warn" | "silent";
    capabilityOverrides?: Partial<Record<string, boolean>>;
  } = {},
) {
  const fake: FakeBMapV4 = createFakeBMapV4();
  const registry = createJsapiV4HandleRegistry();
  const capabilities = createCapabilityRegistry({
    engine: "jsapi-v4",
    version: fake.namespace.VERSION,
    rawSdk: options.rawSdk ?? fake.namespace,
    unsupported: options.unsupported ?? "throw",
    overrides: options.capabilityOverrides as never,
  });
  const layers = createJsapiV4LayerDriver({
    rawSdk: options.rawSdk ?? fake.namespace,
    capabilities,
    registry,
  });
  const container = document.createElement("div");
  container.style.width = "400px";
  container.style.height = "300px";
  document.body.appendChild(container);
  const rawMap = new fake.namespace.Map(container);
  const map = registry.adopt("map", rawMap);

  const rawOf = (handle: LayerHandle) => handle.raw as Record<string, unknown>;
  const mapTarget = () => ({ kind: "map" as const, handle: map });

  return { fake, registry, capabilities, layers, container, rawMap, map, rawOf, mapTarget };
}

let ctx: ReturnType<typeof setup>;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  ctx = setup();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

/* -------------------------------------------------------------------------- */
/* 1. create 与构造选项映射                                                     */
/* -------------------------------------------------------------------------- */

describe("图层创建与构造选项映射", () => {
  it("district → BMap.DistrictLayer；viewport 显式改名为 4.0 的 autoViewport", () => {
    const handle = ctx.layers.create("district", {
      name: "(北京市)",
      kind: 2,
      viewport: true,
      fillColor: "#5e8bff",
    });
    const raw = ctx.rawOf(handle);

    expect(handle.raw).toBeInstanceOf(ctx.fake.namespace.DistrictLayer);
    expect(raw.options).toMatchObject({
      name: "(北京市)",
      kind: 2,
      autoViewport: true,
      fillColor: "#5e8bff",
    });
    // 历史名字不再透传：官方声明里只有 `autoViewport`，别名不是契约
    // （真实 4.0 运行时目前也接受 `viewport`，但那是未声明的行为，见 ADR 的 smoke 记录）
    expect(raw.options.viewport).toBeUndefined();
  });

  it("同时写下 v4 键与历史键时以 v4 键为准", () => {
    const handle = ctx.layers.create("district", { viewport: true, autoViewport: false });
    expect(ctx.rawOf(handle).options.autoViewport).toBe(false);
  });

  it("tile → BMap.TileLayer，选项原样透传（索引签名是 4.0 构造选项的逃生口）", () => {
    const handle = ctx.layers.create("tile", {
      tileUrlTemplate: "https://example.com/{X}/{Y}/{Z}.png",
      transparentPng: true,
    });
    const raw = ctx.rawOf(handle);

    expect(handle.raw).toBeInstanceOf(ctx.fake.namespace.TileLayer);
    expect(raw.options).toMatchObject({
      tileUrlTemplate: "https://example.com/{X}/{Y}/{Z}.png",
      transparentPng: true,
    });
  });

  it.each(LAYER_KINDS)("%s 的句柄品牌是 layer:<kind>", (kind) => {
    const handle = ctx.layers.create(kind);
    expect(handle[HANDLE_BRAND]).toBe(`layer:${kind}`);
  });

  it("panorama-coverage：4.0 运行时提供该构造器时按结构创建", () => {
    const handle = ctx.layers.create("panorama-coverage");
    expect(handle.raw).toBeInstanceOf(ctx.fake.namespace.PanoramaCoverageLayer);
  });

  it("panorama-coverage：能力守卫先于构造（缺 raw member 时按能力语义失败，不产生孤儿实例）", () => {
    const namespace = { ...ctx.fake.namespace } as Record<string, unknown>;
    delete namespace.PanoramaCoverageLayer;
    const isolated = setup({ rawSdk: namespace });
    expect(() => isolated.layers.create("panorama-coverage")).toThrowError(
      expect.objectContaining({ code: "BMAP_CAPABILITY_UNSUPPORTED" }),
    );
    expect(isolated.fake.createdLayers).toHaveLength(0);
  });

  it("panorama-coverage：能力被显式 override 后仍按结构探测，缺构造器时告警并显式失败", () => {
    const namespace = { ...ctx.fake.namespace } as Record<string, unknown>;
    delete namespace.PanoramaCoverageLayer;
    const isolated = setup({
      rawSdk: namespace,
      capabilityOverrides: { "layer.panorama-coverage": true },
    });
    expect(() => isolated.layers.create("panorama-coverage")).toThrowError(
      expect.objectContaining({ code: "BMAP_CAPABILITY_UNSUPPORTED" }),
    );
    expect(String(warn.mock.calls[0][0])).toContain("PanoramaCoverageLayer");
  });

  it("能力守卫先于构造：catalog 说该能力不可用时不产生孤儿实例", () => {
    // M3A3-REMOVE-LEGACY（#26）：engine 只剩 jsapi-v4，无法再用「引擎不在白名单」制造
    // 「不可用」。这里改用显式 override 把 `layer.district` 标成不可用——它走的是同一条
    // 能力守卫路径（先查能力、再构造），因此本用例要守的仍然是「守卫先于构造」。
    const registry = createJsapiV4HandleRegistry();
    const fake = createFakeBMapV4();
    const capabilities = createCapabilityRegistry({
      engine: "jsapi-v4",
      version: "4.0",
      rawSdk: fake.namespace,
      unsupported: "throw",
      overrides: { "layer.district": false },
    });
    const layers = createJsapiV4LayerDriver({
      rawSdk: fake.namespace,
      capabilities,
      registry,
    });
    expect(() => layers.create("district")).toThrowError(
      expect.objectContaining({ code: "BMAP_CAPABILITY_UNSUPPORTED" }),
    );
    expect(fake.createdLayers).toHaveLength(0);
  });

  /* ------------------------------------------------------------------------- */
  /* 不支持能力的 warn / throw / silent 行为（issue #22 目标与范围第 4 条）      */
  /* ------------------------------------------------------------------------- */

  it("不支持策略 throw：缺成员直接抛错", () => {
    const namespace = { ...ctx.fake.namespace } as Record<string, unknown>;
    delete namespace.DistrictLayer;
    const isolated = setup({ rawSdk: namespace, unsupported: "throw" });
    expect(() => isolated.layers.create("district")).toThrowError(
      expect.objectContaining({ code: "BMAP_CAPABILITY_UNSUPPORTED" }),
    );
    expect(isolated.fake.createdLayers).toHaveLength(0);
  });

  it("不支持策略 warn：告警一次后照常构造（策略由调用方选，不是静默吞错）", () => {
    const namespace = { ...ctx.fake.namespace } as Record<string, unknown>;
    delete namespace.DistrictLayer;
    const isolated = setup({ rawSdk: namespace, unsupported: "warn" });
    // 能力守卫告警一次；构造器仍在 → 构造阶段按结构失败（BMAP_SDK_CALL_FAILED）
    expect(() => isolated.layers.create("district")).toThrowError(
      expect.objectContaining({ code: "BMAP_SDK_CALL_FAILED" }),
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("layer.district");
  });

  it("不支持策略 silent：不告警、不抛能力错误", () => {
    const namespace = { ...ctx.fake.namespace } as Record<string, unknown>;
    delete namespace.DistrictLayer;
    const isolated = setup({ rawSdk: namespace, unsupported: "silent" });
    expect(() => isolated.layers.create("district")).toThrowError(
      expect.objectContaining({ code: "BMAP_SDK_CALL_FAILED" }),
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("能力可用时三种策略都不产生额外告警", () => {
    for (const unsupported of ["throw", "warn", "silent"] as const) {
      const isolated = setup({ unsupported });
      warn.mockClear();
      expect(isolated.layers.create("district").raw).toBeTruthy();
      expect(warn).not.toHaveBeenCalled();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 2. add / remove（统一入口）                                                  */
/* -------------------------------------------------------------------------- */

describe("图层挂载与卸载走 4.0 的统一入口", () => {
  it("add / remove 用 map.addLayer / removeLayer，而不是 deprecated 的 addDistrictLayer", () => {
    const target = ctx.mapTarget();
    const district = ctx.layers.create("district", { name: "北京市" });

    ctx.layers.add(target, district);
    expect(ctx.rawMap.layers).toHaveLength(1);
    expect(ctx.rawMap.callLog).toContain("addLayer");
    expect(ctx.rawMap.callLog).not.toContain("addDistrictLayer");

    ctx.layers.remove(target, district);
    expect(ctx.rawMap.layers).toHaveLength(0);
    expect(ctx.rawMap.callLog).toContain("removeLayer");
    expect(ctx.rawOf(district).attachedMap).toBeNull();
  });

  it("重复 add 只挂一次；remove 之后可以重新挂载", () => {
    const target = ctx.mapTarget();
    const layer = ctx.layers.create("tile");

    ctx.layers.add(target, layer);
    ctx.layers.add(target, layer);
    expect(ctx.rawMap.layers).toHaveLength(1);
    expect(ctx.rawMap.callLog.filter((call) => call === "addLayer")).toHaveLength(1);

    ctx.layers.remove(target, layer);
    ctx.layers.add(target, layer);
    expect(ctx.rawMap.layers).toHaveLength(1);
  });

  it("cover 三种 kind 的加/摘往返", () => {
    const target = ctx.mapTarget();
    const handles = LAYER_KINDS.map((kind) => ctx.layers.create(kind));
    for (const handle of handles) ctx.layers.add(target, handle);
    expect(ctx.rawMap.layers).toHaveLength(handles.length);

    for (const handle of handles) ctx.layers.remove(target, handle);
    expect(ctx.rawMap.layers).toHaveLength(0);
  });

  it("非 Map 目标显式失败，且不产生半挂载", () => {
    const layer = ctx.layers.create("tile");
    expect(() => ctx.layers.add({ kind: "overlay", handle: layer }, layer)).toThrowError(
      expect.objectContaining({ code: "BMAP_CAPABILITY_UNSUPPORTED" }),
    );
    expect(ctx.rawMap.layers).toHaveLength(0);
  });

  it("拒绝跨 Client 的句柄（BMAP_HANDLE_FOREIGN）", () => {
    const other = setup();
    const foreign = other.layers.create("tile");
    expect(() => ctx.layers.add(ctx.mapTarget(), foreign)).toThrowError(
      expect.objectContaining({ code: "BMAP_HANDLE_FOREIGN" }),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* 3. options 更新分类                                                          */
/* -------------------------------------------------------------------------- */

describe("setOptions 的动态 / 构造期分类", () => {
  it("tile.zIndex 是动态项（setZIndex）", () => {
    const layer = ctx.layers.create("tile");
    ctx.layers.setOptions(layer, { zIndex: 5 });
    expect(ctx.rawOf(layer).zIndex).toBe(5);
    expect(ctx.rawOf(layer).callLog).toContain("setZIndex");
  });

  it("district 的样式项只有构造期生效：告警一次且不动实例", () => {
    const layer = ctx.layers.create("district", { name: "北京市" });
    ctx.layers.setOptions(layer, { fillColor: "#9169db" });
    expect(ctx.rawOf(layer).callLog).toEqual([]);
    expect(String(warn.mock.calls[0][0])).toContain("只有构造期生效");
  });

  it("tile 的构造期项（tileUrlTemplate）同样告警而不是静默忽略", () => {
    const layer = ctx.layers.create("tile");
    ctx.layers.setOptions(layer, { tileUrlTemplate: "https://example.com/{Z}" });
    expect(ctx.rawOf(layer).callLog).toEqual([]);
    expect(String(warn.mock.calls[0][0])).toContain("只有构造期生效");
  });

  it("panorama-coverage（类型包无声明）走 set<Key> 逃生口，没有该方法时告警一次", () => {
    const layer = ctx.layers.create("panorama-coverage");
    ctx.layers.setOptions(layer, { noSuchOption: 1 });
    expect(String(warn.mock.calls[0][0])).toContain("没有 \"noSuchOption\" 的字段级 setter");

    // 运行时真的提供 setter 时就调用它（结构探测，不预判）
    const raw = ctx.rawOf(layer) as Record<string, unknown>;
    const calls: unknown[] = [];
    raw.setOpacity = (value: unknown) => calls.push(value);
    ctx.layers.setOptions(layer, { opacity: 0.5 });
    expect(calls).toEqual([0.5]);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. 释放顺序（跨 Facet 不变式）                                                */
/* -------------------------------------------------------------------------- */

describe("图层释放顺序", () => {
  it("先摘图层再销毁地图：destroyedWithLayers 为 0", () => {
    const target = ctx.mapTarget();
    const handles = LAYER_KINDS.map((kind) => ctx.layers.create(kind));
    for (const handle of handles) ctx.layers.add(target, handle);
    for (const handle of handles) ctx.layers.remove(target, handle);
    ctx.rawMap.destroy();
    expect(ctx.rawMap.destroyedWithLayers).toBe(0);
  });

  it("遗漏摘除时该不变式会失败（证明这条检查不是空转）", () => {
    ctx.layers.add(ctx.mapTarget(), ctx.layers.create("tile"));
    ctx.rawMap.destroy();
    expect(ctx.rawMap.destroyedWithLayers).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. 外部评审 P2：挂载失败回滚 / 别名与 undefined 的交互                        */
/* -------------------------------------------------------------------------- */

describe("[P2] 挂载失败后记账必须回滚，否则重试会被静默跳过", () => {
  it("SDK 首次拒绝 addLayer → 第二次 add 能成功", () => {
    const target = ctx.mapTarget();
    const layer = ctx.layers.create("tile");
    ctx.rawMap.failNextAddLayer = new Error("SDK 拒绝挂载");

    expect(() => ctx.layers.add(target, layer)).toThrowError(
      expect.objectContaining({ code: "BMAP_SDK_CALL_FAILED" }),
    );
    expect(ctx.rawMap.layers).toHaveLength(0);

    ctx.layers.add(target, layer);
    expect(ctx.rawMap.layers).toHaveLength(1);
  });

  it("挂载失败之后 remove 仍然到达 SDK（清理入口不依赖记账）", () => {
    const target = ctx.mapTarget();
    const layer = ctx.layers.create("tile");
    ctx.rawMap.failNextAddLayer = new Error("boom");

    expect(() => ctx.layers.add(target, layer)).toThrowError();
    expect(() => ctx.layers.remove(target, layer)).not.toThrow();
    expect(ctx.rawMap.callLog.filter((call) => call === "removeLayer")).toHaveLength(1);
  });
});

describe("[P2] viewport → autoViewport 的别名优先级要按「有效取值」判断", () => {
  it("autoViewport: undefined 不遮蔽 viewport: true（两种书写顺序）", () => {
    // 这类对象会来自可选配置字段或对象展开合并：键在、值为 undefined
    const orders = [
      { viewport: true, autoViewport: undefined },
      { autoViewport: undefined, viewport: true },
    ];
    for (const options of orders) {
      const handle = ctx.layers.create("district", options as Record<string, unknown>);
      expect(ctx.rawOf(handle).options.autoViewport).toBe(true);
      expect(ctx.rawOf(handle).options.viewport).toBeUndefined();
    }
  });

  it("显式 false / true 仍然优先于历史名字（只有 undefined 让位）", () => {
    const explicitFalse = ctx.layers.create("district", {
      viewport: true,
      autoViewport: false,
    });
    expect(ctx.rawOf(explicitFalse).options.autoViewport).toBe(false);

    const explicitTrue = ctx.layers.create("district", {
      viewport: false,
      autoViewport: true,
    });
    expect(ctx.rawOf(explicitTrue).options.autoViewport).toBe(true);
  });
});
