/**
 * useMapEvent —— 订阅 map 事件（M4-EVENTS / issue #28）
 *
 * 这里用**真实的** v4 Driver（经 `createFakeV4Client()`，即组件默认路径那条链）与 Fake v4 的
 * 事件派发，而不是手搭一个假 driver——断言的是真会跑的那份归一化与订阅实现。
 *
 * 覆盖：显式 MapSource、`name` 用 ref 时换订阅、高频事件按帧合帧（手动帧队列）、raw 逃生口、
 * handler 传函数 / 传 ref 两种口径、释放路径与「没有订阅源就明确报错」。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, ref, shallowRef } from "vue";
import { createFakeV4Client, createManualFrames, type ManualFrames } from "../../../test-utils";
import type { BMapClient } from "../client/types";
import type { MapHandle } from "../driver/types/handles";
import { BMapError } from "../core/errors/BMapError";
import { useMapEvent } from "./useMapEvent";

function sizedContainer(): HTMLElement {
  const el = document.createElement("div");
  el.style.width = "320px";
  el.style.height = "240px";
  document.body.appendChild(el);
  return el;
}

/** 每个用例一份的真实链路：Fake v4 Provider → Client → Driver → 一张地图。 */
async function createMapFixture(): Promise<{
  client: BMapClient;
  /** 给 composable 用的地图句柄（领域包装）。 */
  map: MapHandle;
  /** 派发 SDK 事件（真实 SDK 由地图内部派发；Fake 把这一步显式化）。 */
  emit: (name: string, payload?: Record<string, unknown>) => void;
  /** 该地图上某一事件类型当前的 raw 监听器数（不带参数 = 全部）。 */
  listenerCount: (name?: string) => number;
  /** 累计订阅次数（活动口径，用于「不重绑」断言）。 */
  listenCalls: () => number;
}> {
  const { client, fake } = await createFakeV4Client();
  const map = client.driver.map.create(sizedContainer());
  // `create()` 交出的是 MapHandle（领域包装）；派发与读数要落到 Fake 那一侧的对象上
  const raw = fake.createdMaps[fake.createdMaps.length - 1]!;
  return {
    client,
    map,
    emit: (name, payload) => raw.emit(name, payload ?? {}),
    listenerCount: (name) => raw.getListenerCount(name),
    listenCalls: () => fake.diagnostics.snapshot().activity.listenCalls,
  };
}

let frames: ManualFrames;

beforeEach(() => {
  frames = createManualFrames();
});

describe("useMapEvent：显式 MapSource 与载荷", () => {
  it("派发时调用 handler，载荷是归一化后的领域事件（type 恒有、指针事件 point 必有）", async () => {
    const { client, map, emit } = await createMapFixture();
    const seen: unknown[] = [];
    const scope = effectScope();
    scope.run(() => {
      useMapEvent("click", (event) => seen.push(event), { source: { map, client } });
    });

    emit("click", { point: { lng: 116.4, lat: 39.9 }, pixel: { x: 12, y: 34 } });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      type: "click",
      point: { lng: 116.4, lat: 39.9 },
      pixel: { x: 12, y: 34 },
    });
    scope.stop();
  });

  it("订阅名用 Catalog 的 SDK 拼写：`style-loaded` 也能订上 `style_loaded`", async () => {
    const { client, map, emit } = await createMapFixture();
    const spy = vi.fn();
    const scope = effectScope();
    scope.run(() => {
      useMapEvent("style-loaded", spy, { source: { map, client } });
    });

    emit("style_loaded");
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0]![0] as { type: string }).type).toBe("style_loaded");
    scope.stop();
  });

  it("raw 逃生口：Catalog 之外的事件名原样订阅，不报错也不丢", async () => {
    const { client, map, emit } = await createMapFixture();
    const spy = vi.fn();
    const scope = effectScope();
    scope.run(() => {
      useMapEvent("some-future-event", spy, { source: { map, client } });
    });

    emit("some-future-event");
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0]![0] as { type: string }).type).toBe("some-future-event");
    scope.stop();
  });

  it("没有显式 source 又不在 <BMap> 子树里：明确报 BMAP_PARENT_CONTEXT_MISSING", () => {
    const scope = effectScope();
    let error: unknown;
    scope.run(() => {
      try {
        useMapEvent("click", () => {});
      } catch (e) {
        error = e;
      }
    });
    expect(error).toBeInstanceOf(BMapError);
    expect((error as BMapError).code).toBe("BMAP_PARENT_CONTEXT_MISSING");
    scope.stop();
  });
});

describe("useMapEvent：句柄与事件名变化", () => {
  it("句柄就绪前不订阅，就绪后自动订阅；再变成 null 就解绑", async () => {
    const { client, map, emit, listenerCount } = await createMapFixture();
    const handle = shallowRef<MapHandle | null>(null);
    const spy = vi.fn();
    const scope = effectScope();
    scope.run(() => {
      useMapEvent("click", spy, { source: { map: handle, client: ref(client) } });
    });

    emit("click", { point: { lng: 1, lat: 2 } });
    expect(spy).not.toHaveBeenCalled();
    expect(listenerCount("click")).toBe(0);

    handle.value = map;
    await Promise.resolve(); // watch 的 flush: "post" 需要一次微任务
    emit("click", { point: { lng: 1, lat: 2 } });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(listenerCount("click")).toBe(1);

    handle.value = null;
    await Promise.resolve();
    emit("click", { point: { lng: 1, lat: 2 } });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(listenerCount("click")).toBe(0);
    scope.stop();
  });

  it("事件名用 ref：换名字会换订阅，旧名字不再派发", async () => {
    const { client, map, emit, listenerCount } = await createMapFixture();
    const name = ref<"click" | "moveend">("click");
    const spy = vi.fn();
    const scope = effectScope();
    scope.run(() => {
      useMapEvent(name, spy, { source: { map, client } });
    });

    emit("click", { point: { lng: 1, lat: 2 } });
    expect(spy).toHaveBeenCalledTimes(1);

    name.value = "moveend";
    await Promise.resolve();
    emit("click", { point: { lng: 1, lat: 2 } });
    emit("moveend");
    expect(spy).toHaveBeenCalledTimes(2);
    expect((spy.mock.calls[1]![0] as { type: string }).type).toBe("moveend");
    expect(listenerCount("click")).toBe(0);
    expect(listenerCount("moveend")).toBe(1);
    scope.stop();
  });
});

describe("useMapEvent：handler 更新不重绑", () => {
  it("传函数：订阅一次即可，闭包读 ref 本来就是最新值（不需要换 handler）", async () => {
    const { client, map, emit, listenerCount, listenCalls } = await createMapFixture();
    const counter = ref(0);
    const calls = vi.fn();
    const scope = effectScope();
    scope.run(() => {
      useMapEvent("click", () => calls("first"), { source: { map, client } });
      useMapEvent("zoomend", () => counter.value++, { source: { map, client } });
    });

    const before = listenCalls();
    expect(listenerCount("click")).toBe(1);
    emit("click", { point: { lng: 1, lat: 2 } });
    expect(calls).toHaveBeenCalledTimes(1);
    expect(calls).toHaveBeenCalledWith("first");
    // 闭包读 ref：状态变化不需要换 handler 就能看到
    emit("zoomend", { zoom: 15 });
    expect(counter.value).toBe(1);
    expect(listenCalls(), "handler 更新不得新增监听器").toBe(before);
    scope.stop();
  });

  it("传 ref(handler)：切换实现后调的是新实现，且订阅数不变", async () => {
    const { client, map, emit, listenerCount, listenCalls } = await createMapFixture();
    const first = vi.fn();
    const second = vi.fn();
    const handler = shallowRef(first);
    const scope = effectScope();
    scope.run(() => {
      useMapEvent("click", handler, { source: { map, client } });
    });

    const before = listenCalls();
    emit("click", { point: { lng: 1, lat: 2 } });
    expect(first).toHaveBeenCalledTimes(1);

    handler.value = second;
    emit("click", { point: { lng: 3, lat: 4 } });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(listenerCount("click")).toBe(1);
    expect(listenCalls()).toBe(before);
    scope.stop();
  });
});

describe("useMapEvent：高频事件按帧合帧", () => {
  it("同一帧内多次 moving 只提交一次，且是最后一次的载荷", async () => {
    frames.install();
    const { client, map, emit } = await createMapFixture();
    const seen: Array<{ type: string; point?: { lng: number } }> = [];
    const scope = effectScope();
    scope.run(() => {
      useMapEvent("moving", (event) => seen.push(event), { source: { map, client } });
    });

    emit("moving", { point: { lng: 1, lat: 1 } });
    emit("moving", { point: { lng: 2, lat: 2 } });
    emit("moving", { point: { lng: 3, lat: 3 } });
    expect(seen, "未到帧边界时一次都不提交").toHaveLength(0);

    expect(frames.flush()).toBe(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.point).toEqual({ lng: 3, lat: 3 });

    // 下一帧再派发 → 新的一次提交
    emit("moving", { point: { lng: 4, lat: 4 } });
    frames.flush();
    expect(seen).toHaveLength(2);
    scope.stop();
    frames.restore();
  });

  it("低频事件（moveend）不排队，立即提交", async () => {
    frames.install();
    const { client, map, emit } = await createMapFixture();
    const spy = vi.fn();
    const scope = effectScope();
    scope.run(() => {
      useMapEvent("moveend", spy, { source: { map, client } });
    });

    emit("moveend");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(frames.pending()).toBe(0);
    scope.stop();
    frames.restore();
  });

  it("coalesce: false 可显式关掉合帧（每次派发都提交）", async () => {
    const { client, map, emit } = await createMapFixture();
    const spy = vi.fn();
    const scope = effectScope();
    scope.run(() => {
      useMapEvent("moving", spy, { source: { map, client }, coalesce: false });
    });

    emit("moving", { point: { lng: 1, lat: 1 } });
    emit("moving", { point: { lng: 2, lat: 2 } });
    expect(spy).toHaveBeenCalledTimes(2);
    scope.stop();
  });

  it("释放后正在排队的载荷不再投递", async () => {
    frames.install();
    const { client, map, emit } = await createMapFixture();
    const spy = vi.fn();
    const scope = effectScope();
    let dispose: () => void = () => {};
    scope.run(() => {
      dispose = useMapEvent("moving", spy, { source: { map, client } });
    });

    emit("moving");
    dispose();
    frames.flush();
    expect(spy).not.toHaveBeenCalled();
    scope.stop();
    frames.restore();
  });
});

describe("useMapEvent：释放路径", () => {
  it("disposer 幂等；scope 停止后监听器归零", async () => {
    const { client, map, listenerCount } = await createMapFixture();
    const scope = effectScope();
    let dispose: () => void = () => {};
    scope.run(() => {
      dispose = useMapEvent("click", () => {}, { source: { map, client } });
    });
    expect(listenerCount("click")).toBe(1);

    dispose();
    dispose();
    expect(listenerCount("click")).toBe(0);

    // 再订一次，这次靠 scope 释放
    const scope2 = effectScope();
    scope2.run(() => {
      useMapEvent("dblclick", () => {}, { source: { map, client } });
    });
    expect(listenerCount("dblclick")).toBe(1);
    scope2.stop();
    expect(listenerCount("dblclick")).toBe(0);
    scope.stop();
  });
});
