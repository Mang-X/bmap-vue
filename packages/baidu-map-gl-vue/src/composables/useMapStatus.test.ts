/**
 * useMapStatus —— 地图外部状态的只读 refs（M4-EVENTS / issue #28）
 *
 * 用真实的 v4 Driver（`createFakeV4Client()`）与 Fake v4 的状态 + 事件，断言三件事：
 * 订阅即给值、**值没变就不产生更新**（引用与触发次数都不动）、`moving` / `zooming` 标志的
 * 起止与「同一帧内 start/end 不倒置」。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, isRef, nextTick, ref, shallowRef, watch } from "vue";
import { createFakeV4Client } from "../../../test-utils";
import { BMapError } from "../core/errors/BMapError";
import type { BMapClient } from "../client/types";
import type { MapHandle } from "../driver/types/handles";
import { useMapStatus } from "./useMapStatus";

function sizedContainer(width = 320, height = 240): HTMLElement {
  const el = document.createElement("div");
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  document.body.appendChild(el);
  return el;
}

interface Fixture {
  client: BMapClient;
  map: MapHandle;
  mapRef: ReturnType<typeof shallowRef<MapHandle | null>>;
  /** 改地图状态 + 派发对应事件（真实 SDK 由地图内部完成这两步）。 */
  userMove: (next: {
    center?: { lng: number; lat: number };
    zoom?: number;
    heading?: number;
    tilt?: number;
  }) => void;
  /** 只改容器尺寸再派发 `resize`（真实 SDK 的 resize 由容器变化触发）。 */
  resize: (width: number, height: number) => void;
  emit: (name: string, payload?: Record<string, unknown>) => void;
  listenerCount: () => number;
  /** 当前绑定的监听器类型（去重、按类型粒度）。 */
  listenerTypes: () => string[];
}

async function createFixture(): Promise<Fixture> {
  const { client, fake } = await createFakeV4Client();
  const container = sizedContainer();
  const map = client.driver.map.create(container);
  const raw = fake.createdMaps[fake.createdMaps.length - 1]!;
  const setView = (next: Parameters<Fixture["userMove"]>[0]): void => {
    if (next.center) {
      raw.center = new fake.namespace.Point(next.center.lng, next.center.lat);
      raw.emit("moveend");
    }
    if (next.zoom !== undefined) {
      raw.zoom = next.zoom;
      raw.emit("zoomend");
    }
    if (next.heading !== undefined) {
      raw.heading = next.heading;
      raw.emit("headingchange");
    }
    if (next.tilt !== undefined) {
      raw.tilt = next.tilt;
      raw.emit("tiltchange");
    }
  };
  // 初始视野（真实 SDK 由 centerAndZoom 设定）
  raw.centerAndZoom(new fake.namespace.Point(116.4, 39.9), 12);
  return {
    client,
    map,
    mapRef: shallowRef<MapHandle | null>(map),
    userMove: setView,
    resize: (width, height) => {
      container.style.width = `${width}px`;
      container.style.height = `${height}px`;
      raw.emit("resize");
    },
    emit: (name, payload) => raw.emit(name, payload ?? {}),
    listenerCount: () => raw.getListenerCount(),
    listenerTypes: () => raw.getListenerTypes(),
  };
}

let fixture: Fixture;

beforeEach(async () => {
  fixture = await createFixture();
});

describe("useMapStatus：订阅即给值（不必等第一个事件）", () => {
  it("六个字段都读到当前状态，两个标志为 false", () => {
    const scope = effectScope();
    const status = scope.run(() =>
      useMapStatus({ source: { map: fixture.mapRef, client: ref(fixture.client) } }),
    )!;

    expect(status.center.value).toEqual({ lng: 116.4, lat: 39.9 });
    expect(status.zoom.value).toBe(12);
    expect(status.heading.value).toBe(0);
    expect(status.tilt.value).toBe(0);
    expect(status.size.value).toEqual({ width: 320, height: 240 });
    expect(status.bounds.value).not.toBeNull();
    expect(status.bounds.value!.southwest.lng).toBeLessThan(status.bounds.value!.northeast.lng);
    expect(status.moving.value).toBe(false);
    expect(status.zooming.value).toBe(false);
    scope.stop();
  });

  it("对「没有有效视野」的地图读状态：如实上报，不把 SDK 调用失败伪装成「未知」", () => {
    // 新建但**没有** centerAndZoom 的地图：driver 的 getter 拿到 null ⇒ BMAP_SDK_CALL_FAILED
    const container = sizedContainer();
    const emptyMap = fixture.client.driver.map.create(container);
    const scope = effectScope();
    let error: unknown;
    try {
      scope.run(() => useMapStatus({ source: { map: shallowRef(emptyMap), client: ref(fixture.client) } }));
    } catch (e) {
      error = e;
    }
    expect(error, "未初始化视野不是「读不到」而是如实上报").toBeInstanceOf(BMapError);
    // 具体码取决于先失败的字段（center 先读 ⇒ INVALID_POINT；zoom 是 SDK_CALL_FAILED）——
    // 两者都**不在**可忽略白名单里，这正是「读错不变成读不到」这条口径的证据
    expect(["BMAP_INVALID_POINT", "BMAP_SDK_CALL_FAILED"]).toContain((error as BMapError).code);
    scope.stop();
  });

  it("地图还没就绪时是「未知」而不是「上一次的值」；就绪后自动补齐", async () => {
    const handle = shallowRef<MapHandle | null>(null);
    const scope = effectScope();
    const status = scope.run(() =>
      useMapStatus({ source: { map: handle, client: ref(fixture.client) } }),
    )!;
    expect(status.center.value).toBeNull();
    expect(status.zoom.value).toBeNull();

    handle.value = fixture.map;
    await Promise.resolve();
    expect(status.center.value).toEqual({ lng: 116.4, lat: 39.9 });

    handle.value = null;
    await Promise.resolve();
    expect(status.center.value, "销毁后回到「未知」").toBeNull();
    expect(status.size.value).toBeNull();
    scope.stop();
  });
});

describe("useMapStatus：值没变就不产生无意义更新", () => {
  it("同一中心点再派发 moveend：ref 引用不变、watch 不被唤醒", async () => {
    const scope = effectScope();
    const status = scope.run(() =>
      useMapStatus({ source: { map: fixture.mapRef, client: ref(fixture.client) } }),
    )!;
    const before = status.center.value;
    const watcher = vi.fn();
    watch(status.center, watcher);

    fixture.emit("moveend");
    fixture.emit("moveend");
    // watch 默认 flush: "pre" ⇒ 必须等一次 nextTick 才能断言「没被唤醒」，
    // 否则这条断言恒真（#28 自审抓到的空转）
    await nextTick();

    expect(status.center.value, "引用必须保持同一个对象").toBe(before);
    expect(watcher, "值未变化时不产生更新").not.toHaveBeenCalled();
    scope.stop();
  });

  it("值真的变了才会唤醒 watch（正证：同一条断言不是恒真）", async () => {
    const scope = effectScope();
    const status = scope.run(() =>
      useMapStatus({ source: { map: fixture.mapRef, client: ref(fixture.client) } }),
    )!;
    const watcher = vi.fn();
    watch(status.center, watcher);

    fixture.userMove({ center: { lng: 121.5, lat: 31.2 } });
    await nextTick();

    expect(watcher, "真实变化必须唤醒").toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it("返回的是 8 个 ref（不是普通值）——「只读」那一半由类型层保证", () => {
    const scope = effectScope();
    const status = scope.run(() =>
      useMapStatus({ source: { map: fixture.mapRef, client: ref(fixture.client) } }),
    )!;
    for (const key of ["center", "zoom", "bounds", "size", "heading", "tilt", "moving", "zooming"] as const) {
      expect(isRef(status[key]), `${key} 应当是 ref`).toBe(true);
    }
    scope.stop();
  });

  it("容差内的浮点抖动也不算变化（与受控视野同一口径：1e-7 度）", () => {
    const scope = effectScope();
    const status = scope.run(() =>
      useMapStatus({ source: { map: fixture.mapRef, client: ref(fixture.client) } }),
    )!;
    const before = status.center.value;

    fixture.userMove({ center: { lng: 116.4 + 1e-9, lat: 39.9 - 1e-9 } });

    expect(status.center.value).toBe(before);
    scope.stop();
  });

  it("真实变化才会更新（并给出新的引用）", () => {
    const scope = effectScope();
    const status = scope.run(() =>
      useMapStatus({ source: { map: fixture.mapRef, client: ref(fixture.client) } }),
    )!;
    const before = status.center.value;

    fixture.userMove({ center: { lng: 121.5, lat: 31.2 } });

    expect(status.center.value).toEqual({ lng: 121.5, lat: 31.2 });
    expect(status.center.value).not.toBe(before);
    scope.stop();
  });

  it("resize / zoomend / headingchange / tiltchange 各自更新对应字段", () => {
    const scope = effectScope();
    const status = scope.run(() =>
      useMapStatus({ source: { map: fixture.mapRef, client: ref(fixture.client) } }),
    )!;

    fixture.resize(400, 300);
    expect(status.size.value).toEqual({ width: 400, height: 300 });

    fixture.userMove({ zoom: 15 });
    expect(status.zoom.value).toBe(15);
    expect(status.bounds.value).not.toBeNull();

    fixture.userMove({ heading: 30 });
    expect(status.heading.value).toBe(30);

    fixture.userMove({ tilt: 45 });
    expect(status.tilt.value).toBe(45);
    scope.stop();
  });
});

describe("useMapStatus：moving / zooming 标志", () => {
  it("movestart/moving 起、moveend 止；zoomstart/zooming 起、zoomend 止", () => {
    const scope = effectScope();
    const status = scope.run(() =>
      useMapStatus({ source: { map: fixture.mapRef, client: ref(fixture.client) } }),
    )!;

    fixture.emit("movestart");
    expect(status.moving.value).toBe(true);
    fixture.emit("moving");
    expect(status.moving.value).toBe(true);
    fixture.emit("moveend");
    expect(status.moving.value).toBe(false);

    fixture.emit("zoomstart");
    expect(status.zooming.value).toBe(true);
    fixture.emit("zooming");
    expect(status.zooming.value).toBe(true);
    fixture.emit("zoomend");
    expect(status.zooming.value).toBe(false);
    scope.stop();
  });

  it("同一帧内 moving 之后紧接 moveend：标志必须是 false（合帧不得让 start/end 倒置）", () => {
    const scope = effectScope();
    const status = scope.run(() =>
      useMapStatus({ source: { map: fixture.mapRef, client: ref(fixture.client) } }),
    )!;

    // 真实时序：一帧里先派发 moving，随后同帧结束
    fixture.emit("moving");
    fixture.emit("moveend");
    fixture.emit("moving");
    fixture.emit("moveend");
    expect(status.moving.value).toBe(false);

    fixture.emit("zooming");
    fixture.emit("zoomend");
    expect(status.zooming.value).toBe(false);
    scope.stop();
  });

  it("标志变化只在真的变化时唤醒 watch（重复 movestart 不算变化）", async () => {
    const scope = effectScope();
    const status = scope.run(() =>
      useMapStatus({ source: { map: fixture.mapRef, client: ref(fixture.client) } }),
    )!;
    const watcher = vi.fn();
    watch(status.moving, watcher);

    fixture.emit("movestart");
    fixture.emit("movestart");
    await nextTick();
    expect(watcher).toHaveBeenCalledTimes(1);
    scope.stop();
  });
});

describe("useMapStatus：订阅与释放", () => {
  it("订阅 12 份（读值 6 + 标志 6，去重后 10 个事件类型），释放后精确归零", () => {
    const scope = effectScope();
    const status = scope.run(() =>
      useMapStatus({ source: { map: fixture.mapRef, client: ref(fixture.client) } }),
    )!;
    // 读值：load / moveend / zoomend / resize / headingchange / tiltchange
    // 标志：movestart / moving / moveend、zoomstart / zooming / zoomend（moveend、zoomend 两者共用）
    // ⇒ 12 份订阅落在 10 个事件类型上；EventDriver 按 target+type 聚合，因此 raw 监听器恰好 10 个
    expect(fixture.listenerTypes().sort()).toEqual([
      "headingchange",
      "load",
      "moveend",
      "movestart",
      "moving",
      "resize",
      "tiltchange",
      "zoomend",
      "zooming",
      "zoomstart",
    ]);

    status.dispose();
    expect(fixture.listenerCount(), "释放后一个 raw 监听器都不剩").toBe(0);

    // 再订一次，这次靠 scope 释放
    const scope2 = effectScope();
    scope2.run(() => useMapStatus({ source: { map: fixture.mapRef, client: ref(fixture.client) } }));
    expect(fixture.listenerCount()).toBe(10);
    scope2.stop();
    expect(fixture.listenerCount()).toBe(0);
    scope.stop();
  });

  it("释放后不再更新 refs（迟到事件被丢掉）", () => {
    const scope = effectScope();
    const status = scope.run(() =>
      useMapStatus({ source: { map: fixture.mapRef, client: ref(fixture.client) } }),
    )!;
    status.dispose();

    fixture.userMove({ zoom: 18 });
    expect(status.zoom.value).toBe(12);
    scope.stop();
  });
});
