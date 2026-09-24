/**
 * v4 Map facet 行为验证（M3A2-MAP / issue #20）
 *
 * 这一层验证两件事：
 * 1. **同一个 Map facet 契约**在两个 Fake 上都能通过 —— 本文件让 v4 Map facet 直接跑
 *    `runMapFacetContract`，与 `tests/behavior/v4-driver-contract.test.ts` 的 webgl-v1
 *    harness 共用同一套断言（契约的单一事实源在 `packages/test-utils/driver-contract.ts`）；
 * 2. v4 特有的生命周期策略 —— destroy 释放 Fake diagnostics 里的地图资源、destroy 之后的
 *    命令按 `BMAP_RESOURCE_DISPOSED` 拒绝（webgl-v1 是待删除实现，不追平该策略）。
 *
 * 组装方式：v4 的 Facet 装配（`createJsapiV4Driver`）属 #23/#25，本 issue 只在测试里
 * 手工组合 Map facet 与它的依赖，不提前改动默认 Client 路径。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createFakeBMapV4, type FakeBMapV4 } from "../../packages/test-utils";
import {
  runMapFacetContract,
  type MapFacetDriver,
  type MapFacetHarness,
} from "../../packages/test-utils/driver-contract";
import { createCapabilityRegistry } from "../../packages/bmap-vue/src/driver/capability/registry";
import { createJsapiV4EventDriver } from "../../packages/bmap-vue/src/driver/jsapi-v4/events";
import { createJsapiV4GeometryDriver } from "../../packages/bmap-vue/src/driver/jsapi-v4/geometry";
import { createJsapiV4MapDriver } from "../../packages/bmap-vue/src/driver/jsapi-v4/map";
import { createJsapiV4HandleRegistry } from "../../packages/bmap-vue/src/driver/jsapi-v4/registry";

let fake: FakeBMapV4;
let driver: MapFacetDriver;
let registry: ReturnType<typeof createJsapiV4HandleRegistry>;

function sizedContainer(width = 300, height = 300): HTMLElement {
  const el = document.createElement("div");
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  fake = createFakeBMapV4();
  registry = createJsapiV4HandleRegistry();
  const geometry = createJsapiV4GeometryDriver(fake.namespace);
  const events = createJsapiV4EventDriver({ registry, geometry });
  const capabilities = createCapabilityRegistry({
    engine: "jsapi-v4",
    version: fake.namespace.VERSION,
    rawSdk: fake.namespace,
    unsupported: "throw",
  });
  driver = {
    map: createJsapiV4MapDriver({
      rawSdk: fake.namespace,
      geometry,
      capabilities,
      registry,
      events,
    }),
    geometry,
    events,
    capabilities,
  };
});

function createHarness(): MapFacetHarness {
  return { driver: () => driver, container: () => sizedContainer() };
}

runMapFacetContract(createHarness);

describe("v4 Map facet 生命周期", () => {
  it("destroy 释放该地图上的资源，且不牵连其它 target 的订阅", () => {
    const map = driver.map.create(sizedContainer());
    const marker = registry.adopt(
      "overlay:marker",
      new fake.namespace.Marker(new fake.namespace.Point(116.4, 39.9)),
    );
    const disposeMarker = driver.events.on(marker, "click", () => {});
    driver.events.on(map, "moveend", () => {});
    driver.events.on(map, "click", () => {});
    expect(fake.diagnostics.liveListeners).toBe(3);

    driver.map.destroy(map);

    // 地图自己的两条订阅随 destroy 释放；Marker 上的订阅仍归调用方管（不强杀子对象）
    expect(fake.diagnostics.liveListeners).toBe(1);
    expect(fake.createdMaps[0].getListenerCount()).toBe(0);
    expect(fake.createdMaps[0].destroyed).toBe(true);

    disposeMarker();
    expect(fake.diagnostics.liveListeners).toBe(0);
  });

  it("destroy 之后的命令按 BMAP_RESOURCE_DISPOSED 拒绝，且不再触碰 SDK 对象", () => {
    const map = driver.map.create(sizedContainer());
    driver.map.initializeView(map, { center: { lng: 116.4, lat: 39.9 }, zoom: 12 });
    driver.map.destroy(map);
    const callsAfterDestroy = fake.createdMaps[0].callLog.length;

    expect(() => driver.map.getZoom(map)).toThrowError(
      expect.objectContaining({ code: "BMAP_RESOURCE_DISPOSED" }),
    );
    expect(() => driver.map.setCenter(map, { lng: 1, lat: 1 })).toThrowError(
      expect.objectContaining({ code: "BMAP_RESOURCE_DISPOSED" }),
    );
    expect(fake.createdMaps[0].callLog.length).toBe(callsAfterDestroy);
  });

  it("事件订阅经由 Driver 归一化后派发（point/pixel + raw 逃生口）", () => {
    const map = driver.map.create(sizedContainer());
    const received: unknown[] = [];
    driver.events.on(map, "click", (event) => received.push(event));

    fake.createdMaps[0].emit("click", {
      point: { lng: 116.404, lat: 39.915 },
      pixel: { x: 10, y: 20 },
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      type: "click",
      point: { lng: 116.404, lat: 39.915 },
      pixel: { x: 10, y: 20 },
    });
  });

  it("Map Handle 稳定：同一个 raw map 复用同一个 Handle", () => {
    const map = driver.map.create(sizedContainer());
    expect(registry.lookup(map.raw)).toBe(map);
    expect(registry.resolve(map)).toBe(map.raw);
  });
});
