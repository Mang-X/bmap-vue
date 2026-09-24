/**
 * v4 Driver 基础契约 —— Fake BMap v4（M3A2-01/02 / issue #19）
 *
 * 这一层验证的是「Driver facet 与结构化 v4 namespace 的组合行为」，而不是单个函数的
 * 边界值（后者在 `src/driver/jsapi-v4/*.test.ts`）：用 Fake v4 提供 raw 构造器与可观察
 * 的监听器计数，把三个基础 facet 串起来跑。
 *
 * M3A.3（#24）会在 Fake v4 上补齐 Map/Overlay/Layer 行为并复用这份契约；本文件先用
 * 「基础 facet 契约」占位，避免 #20~#23 各自造一套 fake。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createFakeBMapV4, type FakeBMapV4 } from "../../packages/test-utils";
import { FakeV4Point } from "../../packages/test-utils/fake-bmap-v4";
import { createJsapiV4EventDriver } from "../../packages/bmap-vue/src/driver/jsapi-v4/events";
import { createJsapiV4GeometryDriver } from "../../packages/bmap-vue/src/driver/jsapi-v4/geometry";
import { createJsapiV4HandleRegistry } from "../../packages/bmap-vue/src/driver/jsapi-v4/registry";
import type { SdkHandle } from "../../packages/bmap-vue/src/driver/types/handles";

interface Harness {
  fake: FakeBMapV4;
  rawMap: InstanceType<FakeBMapV4["namespace"]["Map"]>;
  map: SdkHandle<"map">;
  marker: SdkHandle<"overlay:marker">;
}

let fake: FakeBMapV4;
let registry: ReturnType<typeof createJsapiV4HandleRegistry>;
let geometry: ReturnType<typeof createJsapiV4GeometryDriver>;
let events: ReturnType<typeof createJsapiV4EventDriver>;
let harness: Harness;

function createHarness(): Harness {
  const rawMap = new fake.namespace.Map(document.createElement("div"));
  const rawMarker = new fake.namespace.Marker(new fake.namespace.Point(116.4, 39.9));
  return {
    fake,
    rawMap,
    map: registry.adopt("map", rawMap),
    marker: registry.adopt("overlay:marker", rawMarker),
  };
}

beforeEach(() => {
  fake = createFakeBMapV4();
  registry = createJsapiV4HandleRegistry();
  geometry = createJsapiV4GeometryDriver(fake.namespace);
  events = createJsapiV4EventDriver({ registry, geometry });
  harness = createHarness();
});

describe("v4 namespace 边界", () => {
  it("Fake v4 命名空间通过 Driver 必需成员校验", () => {
    expect(() => createJsapiV4GeometryDriver(fake.namespace)).not.toThrow();
  });

  it("官方 4.0 命名空间缺 Pixel/Size/Bounds 时 Driver 直接失败", () => {
    const { Map, Point } = fake.namespace;
    expect(() => createJsapiV4GeometryDriver({ Map, Point })).toThrowError(
      expect.objectContaining({ code: "BMAP_SDK_CALL_FAILED" }),
    );
  });
});

describe("几何 round-trip（经 Fake v4 构造器）", () => {
  it("Point / Pixel / Size / Bounds 往返不变", () => {
    const point = { lng: 116.404, lat: 39.915 };
    const pixel = { x: 12, y: 24 };
    const size = { width: 320, height: 180 };
    const bounds = { southwest: { lng: 116.38, lat: 39.9 }, northeast: { lng: 116.43, lat: 39.93 } };

    const rawPoint = geometry.toRawPoint(point);
    expect(rawPoint).toBeInstanceOf(FakeV4Point);
    expect(geometry.fromRawPoint(rawPoint)).toEqual(point);
    expect(geometry.fromRawPixel(geometry.toRawPixel(pixel))).toEqual(pixel);
    expect(geometry.fromRawSize(geometry.toRawSize(size))).toEqual(size);
    expect(geometry.fromRawBounds(geometry.toRawBounds(bounds))).toEqual(bounds);
  });

  it("批量点转换保持顺序且逐个是 Fake v4 Point", () => {
    const points = [
      { lng: 0, lat: 0 },
      { lng: 116.4, lat: 39.9 },
    ];
    const raws = geometry.toRawPoints(points);
    expect(raws.every((raw) => raw instanceof FakeV4Point)).toBe(true);
    expect(raws.map((raw) => geometry.fromRawPoint(raw))).toEqual(points);
  });
});

describe("Handle identity", () => {
  it("同一个 raw 在一次会话内始终是同一个 Handle", () => {
    expect(registry.adopt("map", harness.rawMap)).toBe(harness.map);
    expect(registry.lookup(harness.rawMap)).toBe(harness.map);
    expect(registry.resolve(harness.map)).toBe(harness.rawMap);
  });

  it("句柄所有权可验证，跨 Client 混用被拒绝", () => {
    const otherClient = createJsapiV4HandleRegistry();
    const otherEvents = createJsapiV4EventDriver({ registry: otherClient, geometry });
    expect(otherClient.owns(harness.map)).toBe(false);
    expect(() => otherEvents.on(harness.map, "click", () => {})).toThrowError(
      expect.objectContaining({ code: "BMAP_HANDLE_FOREIGN" }),
    );
  });
});

describe("事件 disposer 契约", () => {
  it("每个订阅都返回可重复调用的 disposer，释放后计数归零", () => {
    const disposeMap = events.on(harness.map, "click", () => {});
    const disposeMarker = events.on(harness.marker, "click", () => {});
    expect(fake.stats.liveListeners).toBe(2);
    expect(fake.stats.listenCalls).toBe(2);

    disposeMap();
    disposeMap();
    expect(fake.stats.liveListeners).toBe(1);
    disposeMarker();
    expect(fake.stats.liveListeners).toBe(0);
  });

  it("Map 与 Overlay 同名事件各自独立绑定（互不串台）", () => {
    const onMap = vi.fn();
    const onMarker = vi.fn();
    const disposeMap = events.on(harness.map, "click", onMap);
    const disposeMarker = events.on(harness.marker, "click", onMarker);

    harness.rawMap.emit("click", { point: { lng: 1, lat: 1 }, pixel: { x: 0, y: 0 } });
    expect(onMap).toHaveBeenCalledTimes(1);
    expect(onMarker).not.toHaveBeenCalled();

    (harness.marker.raw as { emit(type: string, payload?: Record<string, unknown>): void }).emit(
      "click",
      { point: { lng: 2, lat: 2 }, pixel: { x: 1, y: 1 } },
    );
    expect(onMarker).toHaveBeenCalledTimes(1);
    expect(onMap).toHaveBeenCalledTimes(1);

    disposeMap();
    disposeMarker();
  });

  it("map.destroy() 后统计归零（Driver 不再持有残留监听器）", () => {
    events.on(harness.map, "moveend", () => {});
    expect(fake.stats.liveListeners).toBe(1);
    harness.rawMap.destroy();
    expect(fake.stats.liveListeners).toBe(0);
  });
});
