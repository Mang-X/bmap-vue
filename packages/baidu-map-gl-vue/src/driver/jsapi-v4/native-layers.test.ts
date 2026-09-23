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

  it("要素状态在扩展 API 图层上显式失败（它们没有状态入口）", () => {
    const layer = layers.create("cluster");
    expect(() => layers.clearState(layer)).toThrowError(
      expect.objectContaining({ code: "BMAP_CAPABILITY_UNSUPPORTED" }),
    );
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

/** 四类「有类声明」的 kind（扩展 API 没有声明，由官方扩展参考的表钉住，不在这条检查里）。 */
const DECLARED_CTORS: ReadonlyArray<readonly [NativeLayerKind, string]> = [
  ["point-icon", "PointIconLayer"],
  ["point-shape", "PointShapeLayer"],
  ["line", "LineLayer"],
  ["fill", "FillLayer"],
];

/**
 * 读出某个官方类在 `.d.ts` 里**声明过的成员名**。
 *
 * 只扫 `class <name> { … }` 这一段（用 2 空格缩进的 `}` 收尾）：同文件里的 `XxxOptions` 接口
 * 字段也在 4 空格缩进上，整文件扫会把选项名混进成员表。成员名后必须跟 `(` 或 `<`——**泛型签名**
 * （`addEventListener<K extends …>(…)`）必须也能被解析出来，否则「扫不到」会被误判成「官方没有」
 * （这是本仓库踩过的坑）。
 */
function declaredMembersOf(ctor: string): string[] {
  const require = createRequire(import.meta.url);
  const path = require.resolve(`@baidumap/jsapi-v4-types/layer/${ctor}.d.ts`);
  const source = readFileSync(path, "utf8");
  const start = source.indexOf(`class ${ctor} {`);
  expect(start, `${ctor}.d.ts 里应当有 class ${ctor} 声明`).toBeGreaterThan(-1);
  const body = source.slice(start);
  const end = body.indexOf("\n  }");
  const declaration = end === -1 ? body : body.slice(0, end);
  return [...declaration.matchAll(/^ {4}(\w+)\s*[<(]/gm)].map((match) => match[1]!);
}

describe("v4 Native Layer Facet：操作面与官方声明一致", () => {
  it("四类专页图层支持的每个操作，都能映射到官方 .d.ts 里声明过的成员", () => {
    for (const [kind, ctor] of DECLARED_CTORS) {
      const declared = declaredMembersOf(ctor);
      for (const operation of OPERATIONS) {
        if (!layers.supports(kind, operation)) continue;
        for (const member of OPERATION_MEMBERS[operation]) {
          expect(
            declared,
            `${kind}(${ctor}).${operation} 落在 ${member}() 上，而官方声明里没有它`,
          ).toContain(member);
        }
      }
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

  it("四类专页图层的操作表里没有 clearData（这一族的「清空」靠实例生命周期表达）", () => {
    for (const [kind] of DECLARED_CTORS) {
      expect(layers.supports(kind, "clearData"), `${kind} 不该声称有 clearData`).toBe(false);
    }
  });
});
