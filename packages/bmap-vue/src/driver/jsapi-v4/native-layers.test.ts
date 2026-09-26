/**
 * v4 Native Layer Facet 单测（M3A2-SERVICES-NATIVE / issue #23）
 *
 * 覆盖 issue「测试要求」的 Native Layer 部分：**数据、显隐、状态、拾取、remove**，
 * 外加 `supports()` 与实现的一致性（「不支持的操作必须显式失败」这条不变式不能只写在注释里）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createFakeBMapV4, type FakeBMapV4 } from "../../../../test-utils";
import type { FakeV4LineLayer, FakeV4PointLayer } from "../../../../test-utils";
import {
  callNativeLayerOperation,
  NATIVE_LAYER_FACET_KINDS as KINDS,
  NATIVE_LAYER_FACET_OPERATIONS as OPERATIONS,
} from "../../../../test-utils/driver-contract";
import { createCapabilityRegistry } from "../capability/registry";
import type { CapabilityRegistry } from "../capability/registry";
import type { UnsupportedBehavior } from "../capability/unsupported";
import type { LayerHandle } from "../types/handles";
import type { NativeLayerKind } from "../types/native-layers";
import { createJsapiV4HandleRegistry } from "./registry";
import type { JsapiV4HandleRegistry } from "./registry";
import { createJsapiV4NativeLayerDriver } from "./native-layers";
import type { NativeLayerDriver } from "../types/native-layers";

let fake: FakeBMapV4;
let registry: JsapiV4HandleRegistry;
let capabilities: CapabilityRegistry;
let layers: NativeLayerDriver;

function buildDriver(unsupported: UnsupportedBehavior = "throw"): NativeLayerDriver {
  capabilities = createCapabilityRegistry({
    engine: "jsapi-v4",
    version: fake.namespace.VERSION,
    rawSdk: fake.namespace,
    unsupported,
  });
  return createJsapiV4NativeLayerDriver({ rawSdk: fake.namespace, capabilities, registry });
}

function mapHandle() {
  return registry.adopt("map", new fake.namespace.Map(document.createElement("div")));
}

beforeEach(() => {
  fake = createFakeBMapV4();
  registry = createJsapiV4HandleRegistry();
  layers = buildDriver();
});

describe("v4 Native Layer Facet：八种图层", () => {
  it.each(KINDS)("%s 可创建，句柄品牌带种类", (kind) => {
    const layer = layers.create(kind);
    expect(layer.raw).toBeTruthy();
    expect(registry.resolve(layer)).toBeTruthy();
    expect(fake.createdNativeLayers).toHaveLength(1);
  });

  it("未知 kind 直接失败（不做「默认当成某个图层」的兜底）", () => {
    expect(() => layers.create("bogus" as NativeLayerKind)).toThrowError(
      expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }),
    );
  });

  it("runtime-only 图层按「加载后就绪」探测：注入前失败、注入后同一 Driver 可创建", () => {
    const namespace = fake.namespace as unknown as Record<string, unknown>;
    const original = namespace.PointLayer;
    delete namespace.PointLayer;
    try {
      expect(() => layers.create("point")).toThrowError(
        expect.objectContaining({ code: "BMAP_CAPABILITY_UNSUPPORTED" }),
      );
      // 官方：可视化实现是**异步注入**的——同一个 Driver 不应在构造期冻结结论
      namespace.PointLayer = original;
      expect(() => layers.create("point")).not.toThrow();
    } finally {
      namespace.PointLayer = original;
    }
  });

  it("声明的四类图层在命名空间缺构造器时抛 BMAP_SDK_CALL_FAILED（不是「不支持」）", () => {
    const namespace = fake.namespace as unknown as Record<string, unknown>;
    const original = namespace.LineLayer;
    delete namespace.LineLayer;
    try {
      const lenient = buildDriver("warn");
      expect(() => lenient.create("line")).toThrowError(
        expect.objectContaining({ code: "BMAP_SDK_CALL_FAILED" }),
      );
    } finally {
      namespace.LineLayer = original;
    }
  });

  it("能力标记为 unsupported 的 kind 在建实例之前失败", () => {
    const capabilitiesWithOverride = createCapabilityRegistry({
      engine: "jsapi-v4",
      version: fake.namespace.VERSION,
      rawSdk: fake.namespace,
      unsupported: "throw",
      overrides: { "layer.heatmap": false },
    });
    const guarded = createJsapiV4NativeLayerDriver({
      rawSdk: fake.namespace,
      capabilities: capabilitiesWithOverride,
      registry,
    });

    expect(() => guarded.create("heatmap")).toThrowError(
      expect.objectContaining({ code: "BMAP_CAPABILITY_UNSUPPORTED" }),
    );
    expect(fake.createdNativeLayers).toHaveLength(0);
  });
});

describe("v4 Native Layer Facet：挂载与释放", () => {
  it("add 记账：重复 add 只挂一次，remove 后计数归零并可重挂", () => {
    const target = { kind: "map" as const, handle: mapHandle() };
    const rawMap = fake.createdMaps[0];
    const layer = layers.create("line");

    expect(rawMap.layers).toHaveLength(0);
    layers.add(target, layer);
    expect(rawMap.layers).toHaveLength(1);
    layers.add(target, layer);
    expect(rawMap.layers).toHaveLength(1);

    layers.remove(target, layer);
    expect(rawMap.layers).toHaveLength(0);
    expect(() => layers.remove(target, layer)).not.toThrow();
    expect(rawMap.layers).toHaveLength(0);

    layers.add(target, layer);
    expect(rawMap.layers).toHaveLength(1);
  });

  it("非 Map 目标显式失败（不静默 no-op）", () => {
    const layer = layers.create("line");
    expect(() => layers.add({ kind: "overlay", handle: mapHandle() }, layer)).toThrowError(
      expect.objectContaining({ code: "BMAP_CAPABILITY_UNSUPPORTED" }),
    );
  });

  it("挂载失败回滚记账：用同一个句柄可以重试", () => {
    const target = { kind: "map" as const, handle: mapHandle() };
    const rawMap = fake.createdMaps[0];
    const layer = layers.create("line");

    rawMap.failNextAddLayer = new Error("addLayer boom");
    expect(() => layers.add(target, layer)).toThrowError(/boom/);
    expect(rawMap.layers).toHaveLength(0);

    layers.add(target, layer);
    expect(rawMap.layers).toHaveLength(1);
  });

  it("拒绝 LayerDriver 的句柄（品牌不同，不能跨 Facet 混用）", () => {
    const foreign = registry.adopt("layer:tile", {}) as unknown as LayerHandle;
    expect(() =>
      layers.setData(foreign as never, { type: "FeatureCollection", features: [] }),
    ).toThrowError(expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }));
  });
});

describe("v4 Native Layer Facet：数据 / 样式 / 显隐 / 层级 / 状态", () => {
  const collection = { type: "FeatureCollection", features: [{ type: "Feature" }] };

  it("setData 落到实例；clearData 在四类专页图层上**显式失败**（官方没有这个入口）", () => {
    const layer = layers.create("line");
    layers.setData(layer, collection);

    const raw = layer.raw as FakeV4LineLayer;
    expect(raw.callLog).toEqual(["setData"]);
    expect(raw.data).toBe(collection);

    // #106 评审 P1：这一族只有 setData/getData（上游 .d.ts + 仓库内官方参考都这么说），
    // 因此 `clearData` 必须**显式失败**，而不是靠替身宽容地接住。
    expect(layers.supports("line", "clearData")).toBe(false);
    expect(() => layers.clearData(layer)).toThrowError(
      expect.objectContaining({ code: "BMAP_CAPABILITY_UNSUPPORTED" }),
    );
    expect(raw.callLog, "被拒绝的调用不得碰到 SDK").toEqual(["setData"]);
  });

  it("扩展 API 的 clearData 保留（官方扩展参考明确列出它）", () => {
    const layer = layers.create("heatmap");
    layers.setData(layer, collection);
    layers.clearData(layer);

    const raw = layer.raw as unknown as { callLog: string[]; data: unknown };
    expect(raw.callLog).toEqual(["setData", "clearData"]);
    expect(raw.data).toBeNull();
  });

  it("声明的四类图层：setStyle 走 setStyleOptions 并显式重绘", () => {
    const layer = layers.create("point-icon");
    layers.setStyle(layer, { icon: "data:image/svg+xml,x", sizes: [24, 24] });

    const raw = layer.raw as unknown as { styleOptions: Record<string, unknown>; drawCount: number };
    expect(raw.styleOptions).toEqual({ icon: "data:image/svg+xml,x", sizes: [24, 24] });
    expect(raw.drawCount).toBe(1);
  });

  it("扩展 API 图层：setStyle 走整袋 setOptions（官方只给这一个入口）", () => {
    const layer = layers.create("heatmap");
    layers.setStyle(layer, { size: 28, max: 100 });

    expect((layer.raw as unknown as { options: Record<string, unknown> }).options).toMatchObject({
      size: 28,
      max: 100,
    });
  });

  it("显隐 / 透明度 / 层级 / 缩放范围（只改给到的一端）", () => {
    const layer = layers.create("fill");
    layers.setVisible(layer, false);
    layers.setOpacity(layer, 0.4);
    layers.setZIndex(layer, 7);
    layers.setZoomRange(layer, { min: 5 });

    const raw = layer.raw as unknown as {
      visible: boolean;
      opacity: number;
      zIndex: number;
      minZoom: number | null;
      maxZoom: number | null;
    };
    expect(raw.visible).toBe(false);
    expect(raw.opacity).toBeCloseTo(0.4);
    expect(raw.zIndex).toBe(7);
    expect(raw.minZoom).toBe(5);
    // 没给的一端必须保持不动（当成默认值会把调用方先前的设置悄悄改掉）
    expect(raw.maxZoom).toBeNull();
  });

  it("要素状态：updateState 的 append 语义、removeState、clearState", () => {
    const layer = layers.create("point-shape");
    const raw = layer.raw as unknown as {
      state: Record<string, Record<string, unknown>>;
      callLog: string[];
    };

    layers.updateState(layer, ["a", "b"], { selected: true });
    expect(raw.state).toEqual({ a: { selected: true }, b: { selected: true } });

    layers.updateState(layer, "a", { hovered: true }, true);
    expect(raw.state.a).toEqual({ selected: true, hovered: true });

    layers.updateState(layer, "a", { hovered: false });
    expect(raw.state.a).toEqual({ hovered: false });

    layers.removeState(layer, "a");
    expect(raw.state.a).toBeUndefined();

    layers.clearState(layer);
    expect(raw.state).toEqual({});
  });

  /* --- #165 Class 3 / TASK 1：4.0.5 给这四个类补了类声明，成员面随之可登记 --- */

  it("显隐 / 透明度 / 层级：三个扩展 API 图层都登记了（4.0.5 声明了 setVisible）", () => {
    // #165 的起点是「4.0.4 没有类声明 ⇒ 不把成员当契约」。4.0.5（`5ba67f4`）把
    // `visualization/PointLayer.d.ts:324` `setVisible`、`:328` `setZIndex`、`:332`
    // `setRenderStage`、`:336` `setRefCenter` 逐条声明了出来——那个前提已经失效。
    // 组件侧的可见性落地是按 `supports()` 选的（见 `useNativeLayerResource.hidesBySetter`），
    // 少登记一条 `setVisible` 的**可观察后果**就是「隐藏 = 摘实例，重新显示 = 换实例」。
    for (const kind of ["point", "cluster", "heatmap", "track-line"] as const) {
      expect(layers.supports(kind, "setVisible"), `${kind}.setVisible`).toBe(true);
    }
    // `setOpacity` 只有官方真的声明了的三个 kind 有：PointLayer 的声明里**没有**它
    // （`visualization/PointLayer.d.ts` 的「显示属性」一组只有 visible / zIndex /
    // renderStage / refCenter）。
    expect(layers.supports("cluster", "setOpacity")).toBe(true);
    expect(layers.supports("heatmap", "setOpacity")).toBe(true);
    expect(layers.supports("track-line", "setOpacity")).toBe(true);
    expect(
      layers.supports("point", "setOpacity"),
      "PointLayer 官方没有声明 setOpacity：不把未声明成员当契约",
    ).toBe(false);
  });

  it("setZIndex 在四个扩展 API 图层上都可用（4.0.5 逐条声明）", () => {
    for (const kind of ["point", "cluster", "heatmap", "track-line"] as const) {
      const layer = layers.create(kind);
      layers.setZIndex(layer, 7);
      expect(
        (layer.raw as unknown as { zIndex: number }).zIndex,
        `${kind}.setZIndex 应当真的落到实例上`,
      ).toBe(7);
    }
  });

  it("热力图：setVisible / setOpacity / setZIndex 都落到实例（4.0.5 声明面）", () => {
    const layer = layers.create("heatmap");
    layers.setVisible(layer, false);
    layers.setOpacity(layer, 0.25);
    layers.setZIndex(layer, 3);

    const raw = layer.raw as unknown as { visible: boolean; opacity: number; zIndex: number };
    expect(raw.visible).toBe(false);
    expect(raw.opacity).toBeCloseTo(0.25);
    expect(raw.zIndex).toBe(3);
    expect(raw.callLog).toContain("setVisible");
  });

  it("要素状态在扩展 API 图层上显式失败（它们没有状态入口）", () => {
    const layer = layers.create("cluster");
    expect(() => layers.clearState(layer)).toThrowError(
      expect.objectContaining({ code: "BMAP_CAPABILITY_UNSUPPORTED" }),
    );
  });

  /* --- #166：官方 4.0.5 新增的 PolygonLayer / PolylineLayer（弃用 FillLayer / LineLayer 的替代） --- */

  it("polygon / polyline：可创建，且样式落到 setOptions（不是 setStyleOptions）", () => {
    for (const kind of ["polygon", "polyline"] as const) {
      const layer = layers.create(kind);
      const raw = layer.raw as unknown as { options: Record<string, unknown>; callLog: string[] };
      layers.setStyle(layer, { strokeWeight: 3 });
      // ⚠️ `visualization/` 家族声明的是 `setOptions`（整袋替换），**没有** `setStyleOptions`
      // 与 `doOnceDraw`——跟着 `layer/` 家族的写法走会调到上游没有的成员。
      expect(raw.callLog, `${kind} 应当走 setOptions`).toContain("setOptions");
      expect(raw.callLog, `${kind} 不得调 setStyleOptions（这一族没有它）`).not.toContain(
        "setStyleOptions",
      );
      expect(raw.options.strokeWeight).toBe(3);
    }
  });

  it("polygon / polyline：hitTest **不登记**——官方声明里有，live 实测运行时没有", () => {
    // `visualization/PolygonLayer.d.ts:201` / `PolylineLayer.d.ts:233` 声明了 `hitTest(x, y)`，
    // 但 live 探针（`scripts/probe-runtime-members.mts` case 3b，2026-09-27）读
    // `B.PolygonLayer.prototype.hitTest` / `B.PolylineLayer.prototype.hitTest` 均为 **false**。
    // 与 `Heatmap` 的 `setGradient` / `setRadius` 同一处置：声明有、运行时没有 ⇒ 放开门面是假支持。
    for (const kind of ["polygon", "polyline"] as const) {
      expect(layers.supports(kind, "hitTest"), `${kind} 不得声称有 hitTest`).toBe(false);
      const layer = layers.create(kind);
      expect(() => layers.hitTest(layer, { x: 1, y: 2 })).toThrowError(
        expect.objectContaining({ code: "BMAP_CAPABILITY_UNSUPPORTED" }),
      );
    }
  });

  it("polygon / polyline：缩放范围不登记（官方**没有**字段级 setter，minZoom/maxZoom 是构造选项）", () => {
    for (const kind of ["polygon", "polyline"] as const) {
      expect(
        layers.supports(kind, "setZoomRange"),
        `${kind} 不得声称有 setZoomRange（live 实测 setMinZoom / setMaxZoom 均不在运行时）`,
      ).toBe(false);
      // 状态 API 同理：两族的声明里没有 updateState 一族
      expect(layers.supports(kind, "updateState")).toBe(false);
    }
  });

  it("polygon / polyline：setOpacity **不登记**（声明里没有；与 PointLayer 同一裁决）", () => {
    // live 实测（case 3b，2026-09-27）：两个类的 `setOpacity` 在运行时都是 `function`。
    // 但官方**声明**里没有它（`PolygonLayer.d.ts:203-218` / `PolylineLayer.d.ts:235-250`
    // 的「显示属性」一组只有 visible / zIndex / renderStage / refCenter）。
    //
    // 跟随 #165 对**形状完全相同**的 `PointLayer` 做过的裁决（它的 `setOpacity` 同样是
    // 「声明没有、运行时有」⇒ 不登记）：官方没承诺的成员不进门禁——否则一个版本的
    // 运行时行为变化就会让本库的契约跟着漂。
    //
    // ⚠️ 代价要说准：`PolylineLayerOptions.opacity`（`:131` @default 1）是**声明的**选项，
    // 但它只能经 `setOptions` 整袋下发（`style` prop），没有字段级 setter 的入口。
    for (const kind of ["polygon", "polyline"] as const) {
      expect(layers.supports(kind, "setOpacity"), `${kind} 不得登记 setOpacity`).toBe(false);
    }
  });

  it("polygon / polyline：拾取开关落到 setEnablePicked（不是 setBaseOptions）", () => {
    for (const kind of ["polygon", "polyline"] as const) {
      const layer = layers.create(kind);
      const raw = layer.raw as unknown as { enablePicked: boolean; callLog: string[] };
      layers.setEnablePicked(layer, true);
      expect(raw.enablePicked).toBe(true);
      expect(raw.callLog).toContain("setEnablePicked");
      expect(raw.callLog, "这一族没有 setBaseOptions").not.toContain("setBaseOptions");
    }
  });

  it("polygon / polyline：clearData 登记在 Driver 上（官方逐条声明了它）", () => {
    for (const kind of ["polygon", "polyline"] as const) {
      expect(layers.supports(kind, "clearData"), `${kind} 声明里有 clearData`).toBe(true);
      const layer = layers.create(kind);
      const raw = layer.raw as unknown as { data: unknown; callLog: string[] };
      layers.setData(layer, { type: "FeatureCollection", features: [] });
      layers.clearData(layer);
      expect(raw.callLog).toContain("clearData");
      expect(raw.data).toBeNull();
    }
  });

  it("polygon / polyline：不是 runtime-injected——命名空间缺构造器时按「已声明类」失败", () => {
    // ⚠️ 与扩展 API 那四类**正交**的判断。live 探针 case 3b 的 `injectionTiming` 读到
    // `B.PolygonLayer` / `B.PolylineLayer` 在 `BMap.Map` 刚就绪时就已经是 `function`
    // ⇒ 随主包注入，不进 `RUNTIME_INJECTED_LAYER_CTORS`。因此它们缺构造器时报的是
    // `BMAP_SDK_CALL_FAILED`（官方声明过这个类）而不是 `BMAP_CAPABILITY_UNSUPPORTED`。
    const namespace = fake.namespace as unknown as Record<string, unknown>;
    const original = namespace.PolygonLayer;
    delete namespace.PolygonLayer;
    try {
      const lenient = buildDriver("warn");
      expect(() => lenient.create("polygon")).toThrowError(
        expect.objectContaining({ code: "BMAP_SDK_CALL_FAILED" }),
      );
    } finally {
      namespace.PolygonLayer = original;
    }
  });

  it("全量替换走 replaceAllState：未覆盖到的 id 必须消失（不是合并）", () => {
    const layer = layers.create("fill");
    const raw = layer.raw as unknown as { state: Record<string, unknown>; callLog: string[] };

    layers.updateState(layer, ["a", "b"], { selected: true });
    layers.replaceState(layer, { b: { hovered: true } });

    expect(raw.state).toEqual({ b: { hovered: true } });
    expect(raw.callLog).toContain("replaceAllState");
  });

  it("读回走 getAllState：返回业务 id → 状态的映射，且不是内部引用", () => {
    const layer = layers.create("line");
    layers.updateState(layer, [1, "b"], { selected: true });

    const state = layers.getState(layer);
    // 数字 id 在 SDK 侧就是字符串键（官方回包是普通对象）
    expect(state).toEqual({ "1": { selected: true }, b: { selected: true } });

    state["1"]!.selected = false;
    expect(layers.getState(layer)["1"], "改回包不得污染 SDK 侧状态").toEqual({ selected: true });
  });

  it("读回的形状违规显式失败（回包不是对象时不当成空状态）", () => {
    const layer = layers.create("line");
    const raw = layer.raw as unknown as { getAllState: () => unknown };
    raw.getAllState = () => 42;
    expect(() => layers.getState(layer)).toThrowError(
      expect.objectContaining({ code: "BMAP_SDK_CALL_FAILED" }),
    );
  });

  it("状态读写在新操作上同样对扩展 API 显式失败", () => {
    const layer = layers.create("heatmap");
    expect(() => layers.replaceState(layer, {})).toThrowError(
      expect.objectContaining({ code: "BMAP_CAPABILITY_UNSUPPORTED" }),
    );
    expect(() => layers.getState(layer)).toThrowError(
      expect.objectContaining({ code: "BMAP_CAPABILITY_UNSUPPORTED" }),
    );
  });
});

describe("v4 Native Layer Facet：拾取", () => {
  it("声明图层的拾取开关走基础配置项（enablePicked）", () => {
    const layer = layers.create("line");
    layers.setEnablePicked(layer, true);
    expect((layer.raw as unknown as { baseOptions: Record<string, unknown> }).baseOptions).toEqual({
      enablePicked: true,
    });
  });

  it("PointLayer：setEnablePicked 与 hitTest 直接落到实例", () => {
    const layer = layers.create("point");
    layers.setEnablePicked(layer, true);
    const pick = layers.hitTest(layer, { x: 120, y: 80 });

    const raw = layer.raw as FakeV4PointLayer;
    expect(raw.enablePicked).toBe(true);
    expect(raw.callLog).toContain("hitTest:120,80");
    expect(pick).toEqual({ dataIndex: 0, dataItem: { properties: { id: "point-1" } } });
  });

  it("hitTest 未命中时回 null（不把 -1 当成「命中了第 0 个」）", () => {
    const layer = layers.create("point");
    (layer.raw as FakeV4PointLayer).hitResult = null;
    expect(layers.hitTest(layer, { x: 0, y: 0 })).toBeNull();
  });

  it("没有 hitTest 入口的 kind 显式失败", () => {
    const layer = layers.create("fill");
    expect(() => layers.hitTest(layer, { x: 1, y: 1 })).toThrowError(
      expect.objectContaining({ code: "BMAP_CAPABILITY_UNSUPPORTED" }),
    );
  });
});

describe("v4 Native Layer Facet：TrackLine 播放命令（#110）", () => {
  it("track-line 支持六条播放命令；其余 kind 全部显式失败", () => {
    const trackOps = ["start", "pause", "resume", "stop", "setSpeed", "setProcess"] as const;
    const track = layers.create("track-line");
    for (const op of trackOps) {
      expect(layers.supports("track-line", op), `track-line 应支持 ${op}`).toBe(true);
    }
    // 其余 kind 没有播放入口：显式失败，不静默 no-op
    const other = layers.create("line");
    for (const op of trackOps) {
      expect(layers.supports("line", op), `line 不该支持 ${op}`).toBe(false);
      expect(() => callNativeLayerOperation(layers, other, op)).toThrowError(
        expect.objectContaining({ code: "BMAP_CAPABILITY_UNSUPPORTED" }),
      );
    }
  });

  it("播放命令落到实例；setProcess / setSpeed 记下参数", () => {
    const layer = layers.create("track-line");
    layers.setData(layer, { type: "Feature", geometry: { type: "LineString", coordinates: [] } });
    layers.setProcess(layer, 0.5);
    layers.setSpeed(layer, 2);
    layers.start(layer);
    layers.pause(layer);
    layers.resume(layer);
    layers.stop(layer);

    const raw = layer.raw as {
      callLog: string[];
      process: number;
      speed: number;
      playing: boolean;
    };
    expect(raw.callLog).toEqual([
      "setData",
      "setProcess",
      "setSpeed",
      "start",
      "pause",
      "resume",
      "stop",
    ]);
    // live 探针：stop 不归零 process（夹具 cmd.stop.observed.process 保持原值）
    expect(raw.process).toBe(0.5);
    expect(raw.speed).toBe(2);
    expect(raw.playing).toBe(false);
  });

  it("setProcess 越界 / setSpeed 非法值在打到 SDK 之前抛 BMAP_INVALID_ARGUMENT", () => {
    const layer = layers.create("track-line");
    const raw = layer.raw as { callLog: string[] };
    const before = raw.callLog.length;

    for (const bad of [-0.1, 1.1, Number.NaN]) {
      expect(() => layers.setProcess(layer, bad)).toThrowError(
        expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }),
      );
    }
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => layers.setSpeed(layer, bad)).toThrowError(
        expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }),
      );
    }
    expect(raw.callLog.length, "非法参数不得碰到 SDK").toBe(before);

    // 合法边界：0 与 1 都是 setProcess 的合法值
    expect(() => layers.setProcess(layer, 0)).not.toThrow();
    expect(() => layers.setProcess(layer, 1)).not.toThrow();
  });
});

describe("v4 Native Layer Facet：supports() 与实现一致", () => {
  /** 每个操作在「支持时必须不报 unsupported」与「不支持时必须报」两边的真实调用。 */
  it.each(KINDS.flatMap((kind) => OPERATIONS.map((op) => [kind, op] as const)))(
    "%s × %s：supports() 的答案与调用结果一致",
    (kind, operation) => {
      const layer = layers.create(kind);
      // 「怎么调」与共享契约共存一份实现：契约里的调用序列就是这里断言的调用序列
      // （否则测试与契约会各自漂移）。
      const call = () => callNativeLayerOperation(layers, layer, operation);
      if (layers.supports(kind, operation)) {
        expect(call, `${kind}.${operation} 声明支持却调用失败`).not.toThrow();
        return;
      }
      expect(call, `${kind}.${operation} 声明不支持却静默成功`).toThrowError(
        expect.objectContaining({ code: "BMAP_CAPABILITY_UNSUPPORTED" }),
      );
    },
  );
});

/* -------------------------------------------------------------------------- */
/* 操作面 ↔ 官方声明（#106 评审 P1 的回归门禁）                                   */
/* -------------------------------------------------------------------------- */

/**
 * 归一化操作 → 它在**官方声明**里对应的成员（逐条取自 `invoke()` 与各方法实现）。
 *
 * 这张表是「操作面不许凭印象增减」的机器证据：#106 评审的 P1 正是 `clearData` 被登记进了四类
 * 专页图层的操作表，而官方声明里根本没有它——下面那条用例会把这种情况抓回来，而不是靠替身
 * 「宽容地接住」（替身比真实契约宽容 = 把不存在的 capability 测绿）。
 */
const OPERATION_MEMBERS: Readonly<Record<NativeLayerOperation, readonly string[]>> = {
  setData: ["setData"],
  clearData: ["clearData"],
  /**
   * `setStyle` 落到哪个成员**逐 kind** 决定（与 Driver 的 `descriptor.styleMember` 同一条依据）：
   *
   * - `layer/` 下那四类专页图层声明 `setStyleOptions` + `doOnceDraw`（改完样式要显式重绘）；
   * - `visualization/` 下那四类声明 `setOptions`，且**没有** `doOnceDraw`——4.0.5 的声明里
   *   找不到它，因此这条不能对它们断言。
   *
   * 一张表写死会逼着其中一族去断言一个它没有的成员（这正是 #165 把这四个类加进
   * `DECLARED_CTORS` 时暴露出来的那类漂移）。
   */
  setStyle: ["setStyleOptions", "doOnceDraw"],
  setVisible: ["setVisible"],
  setOpacity: ["setOpacity"],
  setZIndex: ["setZIndex"],
  setZoomRange: ["setMinZoom", "setMaxZoom"],
  updateState: ["updateState"],
  removeState: ["removeState"],
  clearState: ["clearState"],
  replaceState: ["replaceAllState"],
  getState: ["getAllState"],
  setEnablePicked: ["setBaseOptions"],
  hitTest: ["hitTest"],
  // TrackLine 播放：成员名与方法同名（live 探针逐一验证 `typeof === "function"`）
  start: ["start"],
  pause: ["pause"],
  resume: ["resume"],
  stop: ["stop"],
  setSpeed: ["setSpeed"],
  setProcess: ["setProcess"],
};

/**
 * 逐 kind 覆写 `OPERATION_MEMBERS`（4.0.5 里两类图层的样式入口不同，见上面 `setStyle` 的注释）。
 *
 * 只覆写**真的不同**的那几条：其余操作逐 kind 一致，留在主表里。
 */
const OPERATION_MEMBERS_BY_KIND: Readonly<
  Partial<Record<NativeLayerKind, Partial<Record<NativeLayerOperation, readonly string[]>>>>
> = {
  point: { setStyle: ["setOptions"], setEnablePicked: ["setEnablePicked"] },
  cluster: { setStyle: ["setOptions"] },
  heatmap: { setStyle: ["setOptions"] },
  "track-line": { setStyle: ["setOptions"] },
  /**
   * #166 的两族。`setEnablePicked` 是**声明**成员（`visualization/PolygonLayer.d.ts:192` /
   * `PolylineLayer.d.ts:224`），因此要覆写掉默认表里 `layer/` 家族的 `setBaseOptions`。
   * 样式落在 `setOptions`（`:181` / `:213`）——`visualization/` 家族**没有**
   * `setStyleOptions` 与 `doOnceDraw`。
   */
  polygon: { setStyle: ["setOptions"], setEnablePicked: ["setEnablePicked"] },
  polyline: { setStyle: ["setOptions"], setEnablePicked: ["setEnablePicked"] },
};

function operationMembersFor(
  kind: NativeLayerKind,
  operation: NativeLayerOperation,
): readonly string[] {
  return OPERATION_MEMBERS_BY_KIND[kind]?.[operation] ?? OPERATION_MEMBERS[operation];
}

/**
 * 「有类声明」的 kind → 官方类名。
 *
 * ⚠️ 4.0.5（git `5ba67f4`）给 `visualization/` 的 `PointLayer` / `ClusterLayer` / `Heatmap` /
 * `TrackLine` 补上了类声明，此前这张表只有 `layer/` 下那四个类。**它们现在也在检查范围内**：
 * 只查 `layer/` 会让「扩展 API 的操作面比声明窄」这类漂移永远不被这条用例看见。
 *
 * 类名的目录（`layer/` 还是 `visualization/`）由 `declaredMembersOf` 的子目录参数决定——
 * 四个可视化类的声明在 `visualization/` 下，与 `layer/` 同名文件是两回事。
 */
const DECLARED_CTORS: ReadonlyArray<readonly [NativeLayerKind, string]> = [
  ["point-icon", "PointIconLayer"],
  ["point-shape", "PointShapeLayer"],
  ["line", "LineLayer"],
  ["fill", "FillLayer"],
  ["point", "PointLayer"],
  ["cluster", "ClusterLayer"],
  ["heatmap", "Heatmap"],
  ["track-line", "TrackLine"],
  // #166：官方 4.0.5 新增的两个类，**替代**弃用的 `FillLayer` / `LineLayer`。
  ["polygon", "PolygonLayer"],
  ["polyline", "PolylineLayer"],
];

/** `declaredMembersOf` 要读的子目录（4.0.5 把这两族分开放）。 */
const DECLARED_SUBDIR: Readonly<Partial<Record<NativeLayerKind, string>>> = {
  point: "visualization",
  cluster: "visualization",
  heatmap: "visualization",
  "track-line": "visualization",
  polygon: "visualization",
  polyline: "visualization",
};

/**
 * 读出某个官方类在 `.d.ts` 里**声明过的成员名**。
 *
 * 只扫 `class <name> { … }` 这一段（用 2 空格缩进的 `}` 收尾）：同文件里的 `XxxOptions` 接口
 * 字段也在 4 空格缩进上，整文件扫会把选项名混进成员表。成员名后必须跟 `(` 或 `<`——**泛型签名**
 * （`addEventListener<K extends …>(…)`）必须也能被解析出来，否则「扫不到」会被误判成「官方没有」
 * （这是本仓库踩过的坑）。
 */
function declaredMembersOf(ctor: string, subdir = "layer"): string[] {
  const require = createRequire(import.meta.url);
  const path = require.resolve(`@baidumap/jsapi-v4-types/${subdir}/${ctor}.d.ts`);
  const source = readFileSync(path, "utf8");
  const start = source.indexOf(`class ${ctor} {`);
  expect(start, `${ctor}.d.ts 里应当有 class ${ctor} 声明`).toBeGreaterThan(-1);
  const body = source.slice(start);
  const end = body.indexOf("\n  }");
  const declaration = end === -1 ? body : body.slice(0, end);
  return [...declaration.matchAll(/^ {4}(\w+)\s*[<(]/gm)].map((match) => match[1]!);
}

describe("v4 Native Layer Facet：操作面与官方声明一致", () => {
  it("每一类「有类声明」的图层，支持的每个操作都能映射到官方 .d.ts 里声明过的成员", () => {
    for (const [kind, ctor] of DECLARED_CTORS) {
      const declared = declaredMembersOf(ctor, DECLARED_SUBDIR[kind] ?? "layer");
      for (const operation of OPERATIONS) {
        if (!layers.supports(kind, operation)) continue;
        for (const member of operationMembersFor(kind, operation)) {
          expect(
            declared,
            `${kind}(${ctor}).${operation} 落在 ${member}() 上，而官方声明里没有它`,
          ).toContain(member);
        }
      }
    }
  });

  it("polygon / polyline：登记面里的每一条都**逐条**在官方声明里（含样式与拾取落点）", () => {
    // 这条是 #166 的**核心**门禁：两个新 kind 的操作表**只能**引用官方声明过的成员。
    // 特别地，它们**不得**登记 `setOpacity`——两族的「显示属性」一组里没有它
    // （`PolygonLayer.d.ts:203-218` / `PolylineLayer.d.ts:235-250` 逐条列了
    // visible / zIndex / renderStage / refCenter）。live 探针读到运行时**有**
    // `setOpacity`（case 3b，2026-09-27），但仓库的口径是「不把**未声明**成员当契约」，
    // #165 已经为**形状完全相同**的 `PointLayer` 做过这个裁决（它的 `setOpacity`
    // 同样是「声明没有、运行时有」⇒ `supports()` 回答 `false`，见上面那条用例）。
    // 跟随既有裁决，而不是给同一件事开两个例外。
    for (const [kind, ctor] of [
      ["polygon", "PolygonLayer"],
      ["polyline", "PolylineLayer"],
    ] as const) {
      const declared = declaredMembersOf(ctor, "visualization");
      expect(
        layers.supports(kind, "setOpacity"),
        `${kind}.setOpacity：声明里没有它，不当契约（与 point 一致）`,
      ).toBe(false);
      // 反向：本票**确实**登记的那几条，逐条要在声明里
      for (const operation of OPERATIONS) {
        if (!layers.supports(kind, operation)) continue;
        for (const member of operationMembersFor(kind, operation)) {
          expect(declared, `${kind}.${operation} → ${member}()`).toContain(member);
        }
      }
    }
  });

  it("声明有、运行时实测没有的成员不登记（hitTest）", () => {
    // 「操作面 ↔ 声明」门禁的**反方向**：只查「登记的都声明了」会漏掉「声明了却没登记」
    // 这一半，而那一半正是假支持的来源。`hitTest` 两族的声明里都有
    // （`PolygonLayer.d.ts:201` / `PolylineLayer.d.ts:233`），而 live 探针读
    // `prototype.hitTest` 均为 `false` ⇒ 不登记（同 `Heatmap` 的 `setGradient` / `setRadius`）。
    for (const [kind, ctor] of [
      ["polygon", "PolygonLayer"],
      ["polyline", "PolylineLayer"],
    ] as const) {
      const declared = declaredMembersOf(ctor, "visualization");
      expect(declared, "官方声明里确实有 hitTest（下面的断言才有意义）").toContain("hitTest");
      expect(layers.supports(kind, "hitTest"), `${kind} 不得登记 hitTest`).toBe(false);
    }
  });

  it("解析器本身不能恒真：泛型成员要读得到、未声明的成员必须读不到", () => {
    const declared = declaredMembersOf("LineLayer");
    expect(declared.length, "读到的应当是一整个类体").toBeGreaterThan(20);
    expect(declared, "普通方法").toContain("setData");
    expect(declared, "泛型方法（只匹配「名字 + (」会漏）").toContain("addEventListener");
    expect(declared, "未被声明的方法不得凭空出现").not.toContain("clearData");
    expect(declared, "同文件里 XxxOptions 的字段不得混进来").not.toContain("idKey");
  });

  it("解析器也读得到 visualization/ 下的声明（四个扩展 API 类）", () => {
    // 这条是为了让「读不到 `visualization/`」这种假绿在别的用例出错之前就暴露出来：
    // 上一条只证明了解析器在 `layer/` 下工作。
    const declared = declaredMembersOf("PointLayer", "visualization");
    expect(declared, "泛型 addEventListener").toContain("addEventListener");
    expect(declared, "显示属性").toContain("setVisible");
    expect(declared, "同文件的 PointLayerOptions 字段不得混进来").not.toContain("idKey");
  });

  it("四类专页图层的操作表里没有 clearData（这一族的「清空」靠实例生命周期表达）", () => {
    // ⚠️ 只对 `layer/` 下那四类成立。4.0.5 的 `visualization/` 四类**确实声明**了
    // `clearData`（`visualization/PointLayer.d.ts:294` 等），把它们一并断言 false 就是
    // 拿「四类专页」这条结论错误地扩到另一族身上。
    for (const [kind] of DECLARED_CTORS) {
      if (DECLARED_SUBDIR[kind]) continue;
      expect(layers.supports(kind, "clearData"), `${kind} 不该声称有 clearData`).toBe(false);
    }
  });

  it("visualization 四类：官方声明了 clearData，登记面因此保留它", () => {
    for (const [kind, ctor] of DECLARED_CTORS) {
      const subdir = DECLARED_SUBDIR[kind];
      if (!subdir) continue;
      const declared = declaredMembersOf(ctor, subdir);
      expect(declared, `${ctor} 声明里没有 clearData，下面的断言就要改`).toContain("clearData");
      expect(layers.supports(kind, "clearData"), `${kind} 应当保留 clearData`).toBe(true);
    }
  });
});
