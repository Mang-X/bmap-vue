/**
 * v4 EventDriver（M3A2-02 / issue #19）
 *
 * 验收点：
 * - 订阅都返回**可重复调用**的 disposer；
 * - 同一个 target+type 只绑定一个 raw listener —— handler 更新/追加不重绑；
 * - 全部 dispose 后 raw listener 计数归零；
 * - 事件在 Driver 边界归一化（point/pixel/size/... + raw 逃生口）；
 * - 句柄必须属于本 Client（跨 Client 混用被拒绝）。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { FakeV4EventTarget, createFakeBMapV4, type FakeBMapV4 } from "../../../../test-utils";
import { createJsapiV4EventDriver } from "./events";
import { createJsapiV4GeometryDriver } from "./geometry";
import { createJsapiV4HandleRegistry } from "./registry";
import type { MapMouseEvent } from "../types/events";

function setup() {
  const fake: FakeBMapV4 = createFakeBMapV4();
  const registry = createJsapiV4HandleRegistry();
  const geometry = createJsapiV4GeometryDriver(fake.namespace);
  const events = createJsapiV4EventDriver({ registry, geometry });
  const rawMap = new fake.namespace.Map(document.createElement("div"));
  const map = registry.adopt("map", rawMap);
  return { fake, registry, geometry, events, rawMap, map };
}

function clickPayload() {
  return {
    point: { lng: 116.404, lat: 39.915 },
    pixel: { x: 10, y: 20 },
    domEvent: { type: "click" },
  };
}

describe("订阅与 disposer", () => {
  it("所有订阅都返回函数 disposer，且可重复调用", () => {
    const { events, map } = setup();
    const dispose = events.on(map, "click", () => {});
    expect(typeof dispose).toBe("function");
    expect(() => {
      dispose();
      dispose();
      dispose();
    }).not.toThrow();
  });

  it("同一 target+type 只绑定一个 raw listener（handler 更新不重绑）", () => {
    const { events, map, fake } = setup();
    const first = vi.fn();
    const second = vi.fn();

    const disposeFirst = events.on(map, "click", first);
    expect(fake.stats.listenCalls).toBe(1);

    // 组件重渲染时用新 handler 再订阅同一个事件：追加订阅，不重新绑定
    const disposeSecond = events.on(map, "click", second);
    expect(fake.stats.listenCalls).toBe(1);

    fake.createdMaps[0].emit("click", clickPayload());
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    // 先移除旧 handler，新 handler 继续接收（不重绑）
    disposeFirst();
    fake.createdMaps[0].emit("click", clickPayload());
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    expect(fake.stats.listenCalls).toBe(1);

    disposeSecond();
  });

  it("全部 dispose 后 raw listener 计数归零，事件不再派发", () => {
    const { events, map, fake } = setup();
    const listener = vi.fn();
    const dispose = events.on(map, "click", listener);
    expect(fake.createdMaps[0].getListenerCount("click")).toBe(1);

    dispose();
    expect(fake.createdMaps[0].getListenerCount("click")).toBe(0);
    expect(fake.stats.liveListeners).toBe(0);

    fake.createdMaps[0].emit("click", clickPayload());
    expect(listener).not.toHaveBeenCalled();
  });

  it("不同事件类型各自独立绑定与释放", () => {
    const { events, map, fake } = setup();
    const disposeClick = events.on(map, "click", () => {});
    const disposeMove = events.on(map, "moveend", () => {});
    expect(fake.stats.listenCalls).toBe(2);

    disposeClick();
    expect(fake.createdMaps[0].getListenerCount("click")).toBe(0);
    expect(fake.createdMaps[0].getListenerCount("moveend")).toBe(1);

    disposeMove();
    expect(fake.stats.liveListeners).toBe(0);
  });

  it("释放后重新订阅会重新绑定（不留悬挂监听器）", () => {
    const { events, map, fake } = setup();
    const listener = vi.fn();
    events.on(map, "click", listener)();
    expect(fake.stats.listenCalls).toBe(1);

    const dispose = events.on(map, "click", listener);
    expect(fake.stats.listenCalls).toBe(2);
    fake.createdMaps[0].emit("click", clickPayload());
    expect(listener).toHaveBeenCalledTimes(1);
    dispose();
    expect(fake.stats.liveListeners).toBe(0);
  });

  it("目标没有事件能力时返回 no-op disposer，而不是抛错", () => {
    const { events, registry } = setup();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const silent = registry.adopt("overlay:marker", {});
    const dispose = events.on(silent, "click", () => {});
    expect(typeof dispose).toBe("function");
    expect(() => dispose()).not.toThrow();
    warning.mockRestore();
  });
});

describe("Layer 目标", () => {
  it("Layer 与 Map/Overlay 走同一套订阅、归一化与释放路径", () => {
    const { events, registry, fake } = setup();
    const rawLayer = new FakeV4EventTarget(fake.stats);
    const layer = registry.adopt("layer:point-icon", rawLayer);

    const onClick = vi.fn();
    const onDataParsed = vi.fn();
    const disposeClick = events.on(layer, "click", onClick);
    const disposeParsed = events.on(layer, "dataparsed", onDataParsed);

    rawLayer.emit("click", { point: { lng: 3, lat: 4 }, pixel: { x: 5, y: 6 } });
    rawLayer.emit("dataparsed");
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onDataParsed).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0][0]).toMatchObject({
      type: "click",
      point: { lng: 3, lat: 4 },
      pixel: { x: 5, y: 6 },
    });

    disposeClick();
    disposeParsed();
    expect(rawLayer.getListenerCount()).toBe(0);
  });
});

describe("事件归一化", () => {
  it("鼠标事件归一化为项目 payload，并保留 raw 逃生口", () => {
    const { events, map, fake } = setup();
    const domEvent = { type: "click", preventDefault: vi.fn(), stopPropagation: vi.fn() };
    let received: MapMouseEvent | undefined;
    const dispose = events.on<MapMouseEvent>(map, "click", (event) => {
      received = event;
    });

    fake.createdMaps[0].emit("click", { point: { lng: 1, lat: 2 }, pixel: { x: 3, y: 4 }, domEvent });

    expect(received).toMatchObject({
      type: "click",
      point: { lng: 1, lat: 2 },
      pixel: { x: 3, y: 4 },
      domEvent,
    });
    expect(received?.raw).toMatchObject({ type: "click" });

    received?.preventDefault();
    received?.stopPropagation();
    expect(domEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(domEvent.stopPropagation).toHaveBeenCalledTimes(1);

    dispose();
  });

  it("overlay 事件同时带 point 与 latLng 时优先 point", () => {
    const { events, registry, fake } = setup();
    const marker = registry.adopt("overlay:marker", new fake.namespace.Marker(new fake.namespace.Point(0, 0)));
    let received: MapMouseEvent | undefined;
    const dispose = events.on<MapMouseEvent>(marker, "click", (event) => {
      received = event;
    });

    (marker.raw as { emit(type: string, payload?: Record<string, unknown>): void }).emit("click", {
      point: { lng: 5, lat: 6 },
      latLng: { lng: 7, lat: 8 },
    });
    expect(received?.point).toEqual({ lng: 5, lat: 6 });
    dispose();
  });

  it("非指针事件（moveend）保留 raw，不带伪造坐标", () => {
    const { events, map, fake } = setup();
    let received: Record<string, unknown> | undefined;
    const dispose = events.on(map, "moveend", (event) => {
      received = event as Record<string, unknown>;
    });

    fake.createdMaps[0].emit("moveend");
    expect(received?.type).toBe("moveend");
    expect(received?.raw).toBeDefined();
    expect(received?.point).toBeUndefined();
    dispose();
  });

  it("raw 事件里残缺的坐标不会抛出到 SDK 派发链路", () => {
    const { events, map, fake } = setup();
    const listener = vi.fn();
    const dispose = events.on(map, "click", listener);

    expect(() => fake.createdMaps[0].emit("click", { point: { lng: "x", lat: 0 } })).not.toThrow();
    expect(listener).toHaveBeenCalledTimes(1);
    dispose();
  });
});

describe("句柄所有权", () => {
  it("跨 Client 的 Handle 被拒绝", () => {
    const other = setup();
    const mine = setup();
    expect(() => mine.events.on(other.map, "click", () => {})).toThrowError(
      expect.objectContaining({ code: "BMAP_HANDLE_FOREIGN" }),
    );
  });
});

describe("生命周期", () => {
  let fake: FakeBMapV4;
  beforeEach(() => {
    fake = createFakeBMapV4();
  });

  it("map.destroy() 清空 Map 自身监听器后统计归零", () => {
    const registry = createJsapiV4HandleRegistry();
    const geometry = createJsapiV4GeometryDriver(fake.namespace);
    const events = createJsapiV4EventDriver({ registry, geometry });
    const rawMap = new fake.namespace.Map(document.createElement("div"));
    const map = registry.adopt("map", rawMap);

    events.on(map, "click", () => {});
    expect(fake.stats.liveListeners).toBe(1);
    rawMap.destroy();
    expect(fake.stats.liveListeners).toBe(0);
  });
});

/**
 * 回归：PR #59 评审 P2（同函数重复订阅 + disposer 释放顺序）
 *
 * 旧实现的 `listeners` 是 `Set<函数>`、`removeGroup()` 按 `target+type` 找**当前**分组，
 * 因此「同一函数订阅两次」无法表达成两份独立订阅，且旧 disposer 会摘掉比它更晚建立的订阅。
 */
describe("回归 PR#59-P2-1：订阅记录必须与 disposer 一一对应", () => {
  it("旧 disposer 不会误删后来建立的有效订阅（评审给出的复现场景）", () => {
    const { events, map, rawMap, fake } = setup();
    const oldHandler = () => {};

    const disposeA = events.on(map, "click", oldHandler);
    const disposeB = events.on(map, "click", oldHandler);

    disposeA();
    // 同一 target+type 只绑定一次；释放一份订阅不足以解绑
    expect(fake.stats.listenCalls).toBe(1);
    expect(rawMap.getListenerCount("click")).toBe(1);

    let calls = 0;
    const disposeNew = events.on(map, "click", () => {
      calls++;
    });
    expect(fake.stats.listenCalls).toBe(1);

    disposeB();
    expect(rawMap.getListenerCount("click")).toBe(1);

    rawMap.emit("click", { point: { lng: 1, lat: 2 } });
    expect(calls).toBe(1);

    disposeNew();
    expect(rawMap.getListenerCount("click")).toBe(0);
  });

  it("分组仍存活时，重新订阅同一函数不会被先前的 disposer 摘掉", () => {
    const { events, map, rawMap } = setup();
    const shared = vi.fn();
    const keepAlive = vi.fn();

    const disposeFirst = events.on(map, "click", shared);
    const disposeKeepAlive = events.on(map, "click", keepAlive);
    const disposeSecond = events.on(map, "click", shared);

    disposeFirst();
    rawMap.emit("click", { point: { lng: 1, lat: 2 } });
    expect(shared).toHaveBeenCalledTimes(1);
    expect(keepAlive).toHaveBeenCalledTimes(1);

    disposeSecond();
    rawMap.emit("click", { point: { lng: 1, lat: 2 } });
    expect(shared).toHaveBeenCalledTimes(1);
    expect(keepAlive).toHaveBeenCalledTimes(2);

    disposeKeepAlive();
    expect(rawMap.getListenerCount("click")).toBe(0);
  });

  it("同一函数订阅两次时每次事件只派发一次（不重复回调），但需两份都释放才解绑", () => {
    const { events, map, rawMap, fake } = setup();
    const shared = vi.fn();

    const disposeA = events.on(map, "click", shared);
    const disposeB = events.on(map, "click", shared);
    expect(fake.stats.listenCalls).toBe(1);

    rawMap.emit("click", { point: { lng: 1, lat: 2 } });
    expect(shared).toHaveBeenCalledTimes(1);

    disposeA();
    disposeB();
    expect(rawMap.getListenerCount("click")).toBe(0);
  });

  it("已销毁分组的 disposer 不会解绑新分组（分组身份校验）", () => {
    const { events, map, rawMap, fake } = setup();
    const disposeOld = events.on(map, "click", () => {});
    disposeOld();
    expect(rawMap.getListenerCount("click")).toBe(0);

    const calls: number[] = [];
    const disposeNew = events.on(map, "click", () => {
      calls.push(1);
    });
    expect(fake.stats.listenCalls).toBe(2);

    // 幂等 + 身份校验：不得触碰替换后的新分组
    disposeOld();
    disposeOld();
    expect(rawMap.getListenerCount("click")).toBe(1);
    rawMap.emit("click", { point: { lng: 0, lat: 0 } });
    expect(calls).toHaveLength(1);

    disposeNew();
    expect(rawMap.getListenerCount("click")).toBe(0);
  });
});

// PR #60 评审 P2：destroy 依赖 release() 摘掉订阅分组，而解绑本身可能抛错。
// release 必须逐项尽力、不得因为一项失败而跳过其余项，并且要把失败汇总报出来
// （否则 MapDriver.destroy 既不知道该重试，也拿不到可观测的错误）。
describe("release：逐项尽力释放订阅分组", () => {
  it("某一项解绑抛错不影响其余项，并汇总抛出错误", () => {
    const { events, map, rawMap } = setup();
    events.on(map, "click", () => {});
    events.on(map, "moveend", () => {});
    events.on(map, "dragend", () => {});
    expect(rawMap.getListenerCount()).toBe(3);

    const originalRemove = rawMap.removeEventListener.bind(rawMap);
    let failNext = false;
    rawMap.removeEventListener = (type: string, listener: (event: unknown) => void) => {
      if (failNext) {
        failNext = false;
        throw new Error(`unbind ${type} boom`);
      }
      originalRemove(type, listener);
    };

    // 第一个分组（click，Fake 的 Map 按插入顺序保留）解绑失败
    failNext = true;
    expect(() => events.release(map)).toThrowError(
      expect.objectContaining({
        code: "BMAP_SDK_CALL_FAILED",
        message: expect.stringContaining("unbind click boom"),
      }),
    );

    // 其余两项仍然被释放（逐项隔离），并且记账条目已清空（不持有已销毁的 raw 对象）
    expect(rawMap.getListenerCount("click")).toBe(1);
    expect(rawMap.getListenerCount("moveend")).toBe(0);
    expect(rawMap.getListenerCount("dragend")).toBe(0);
    expect(() => events.release(map)).not.toThrow();
  });

  it("没有订阅（或没有解绑能力）时 release 是 no-op", () => {
    const { events, map } = setup();
    expect(() => events.release(map)).not.toThrow();
  });

  it("外来句柄被拒绝（所有权校验在 release 同样生效）", () => {
    const { events } = setup();
    const other = createJsapiV4HandleRegistry();
    const foreign = other.adopt("map", {});
    expect(() => events.release(foreign)).toThrowError(
      expect.objectContaining({ code: "BMAP_HANDLE_FOREIGN" }),
    );
  });
});
