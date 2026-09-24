/**
 * v4 Service / Native Layer / Panorama facet 行为验证（M3A2-SERVICES-NATIVE / issue #23）
 *
 * 与前三个 facet 的行为测试有一处关键差别：这次跑的是**装配后的** Driver
 * （`createJsapiV4Driver` 在 #23 完成装配），而不是测试里手工组合的 Facet——因此契约
 * 验证的对象就是组件默认路径实际会拿到的那个 Driver，句柄也全部来自它自己的
 * Handle Registry（跨 Client 混用会被拒绝，所以不能另建一个）。
 *
 * 三件事在这里固定：
 * 1. 三个 facet 的共享契约（`driver-contract.ts` 的 `run*FacetContract`）；
 * 2. 跨 facet 不变式：原生图层与底图图层共用 `map.layers` 容器但各自记账；
 * 3. 「先摘子资源、再销毁地图」在原生图层上同样成立。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createFakeBMapV4, type FakeBMapV4, type FakeV4Map } from "../../packages/test-utils";
import {
  runNativeLayerFacetContract,
  runPanoramaFacetContract,
  runServiceFacetContract,
  type NativeLayerFacetHarness,
  type PanoramaFacetHarness,
  type ServiceFacetHarness,
} from "../../packages/test-utils/driver-contract";
import { createJsapiV4Driver } from "../../packages/bmap-vue/src/driver/createJsapiV4Driver";
import type { JsapiV4Driver } from "../../packages/bmap-vue/src/driver/types/bmap";
import type { OverlayTarget } from "../../packages/bmap-vue/src/driver/types/overlays";

let fake: FakeBMapV4;
let driver: JsapiV4Driver;

function sizedContainer(): HTMLElement {
  const el = document.createElement("div");
  el.style.width = "320px";
  el.style.height = "240px";
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  fake = createFakeBMapV4();
  driver = createJsapiV4Driver({
    rawSdk: fake.namespace,
    version: fake.namespace.VERSION,
    unsupported: "throw",
  });
});

/* --------------------------------------------------------------- 共享契约 */

function createServiceHarness(): ServiceFacetHarness {
  return { services: () => driver.services, expectation: "fixture" };
}

function createNativeLayerHarness(): NativeLayerFacetHarness {
  const rawMaps: FakeV4Map[] = [];
  return {
    nativeLayers: () => driver.nativeLayers,
    mapHandle: () => {
      const handle = driver.map.create(sizedContainer());
      rawMaps.push(handle.raw as FakeV4Map);
      return handle;
    },
    attachedCount: () => rawMaps[rawMaps.length - 1].layers.length,
  };
}

function createPanoramaHarness(): PanoramaFacetHarness {
  return {
    panorama: () => driver.panorama,
    container: () => document.createElement("div"),
    expectation: "fixture",
  };
}

runServiceFacetContract(createServiceHarness);
runNativeLayerFacetContract(createNativeLayerHarness);
runPanoramaFacetContract(createPanoramaHarness);

/* ------------------------------------------------------------ 跨 facet 不变式 */

describe("v4 装配后的跨 facet 不变式（#23）", () => {
  it("先摘原生图层再销毁地图：destroyedWithLayers 为 0", () => {
    const map = driver.map.create(sizedContainer());
    const rawMap = map.raw as FakeV4Map;
    const target: OverlayTarget = { kind: "map", handle: map };

    const layer = driver.nativeLayers.create("line");
    driver.nativeLayers.add(target, layer);
    expect(rawMap.layers).toHaveLength(1);

    driver.nativeLayers.remove(target, layer);
    driver.map.destroy(map);

    expect(rawMap.destroyedWithLayers).toBe(0);
  });

  it("遗漏摘除时该不变式会失败（证明这条检查不是空转）", () => {
    const map = driver.map.create(sizedContainer());
    const rawMap = map.raw as FakeV4Map;
    const target: OverlayTarget = { kind: "map", handle: map };

    driver.nativeLayers.add(target, driver.nativeLayers.create("line"));
    driver.map.destroy(map);

    expect(rawMap.destroyedWithLayers).toBe(1);
  });

  it("原生图层与 LayerDriver 的图层可以共存（同一容器、两份记账）", () => {
    const map = driver.map.create(sizedContainer());
    const rawMap = map.raw as FakeV4Map;
    const target: OverlayTarget = { kind: "map", handle: map };

    const tile = driver.layers.create("tile");
    const nativeLayer = driver.nativeLayers.create("fill");
    driver.layers.add(target, tile);
    driver.nativeLayers.add(target, nativeLayer);
    expect(rawMap.layers).toHaveLength(2);

    driver.nativeLayers.remove(target, nativeLayer);
    expect(rawMap.layers).toHaveLength(1);

    // 两个 Facet 的记账互不干扰：LayerDriver 的图层仍在，且能正常摘除
    driver.layers.remove(target, tile);
    expect(rawMap.layers).toHaveLength(0);
  });

  it("三个 facet 与既有 facet 用的是同一份 capability registry", () => {
    expect(driver.capabilities.supports("layer.point-icon")).toBe(true);
    expect(driver.capabilities.supports("layer.heatmap")).toBe(true);
    expect(driver.capabilities.supports("service.geocoder")).toBe(true);
    expect(driver.capabilities.supports("panorama.viewer")).toBe(true);
    expect(driver.capabilities.supports("service.track-animation")).toBe(false);
  });

  it("装配后释放服务实例时，EventDriver 持有的订阅也必须释放（events 已注入 Service Facet）", () => {
    const el = document.createElement("input");
    document.body.appendChild(el);
    const handle = driver.services.createAutocomplete({ input: el });
    const raw = fake.createdAutocompletes[0]!;

    driver.events.on(handle, "confirm", vi.fn());
    expect(raw.getListenerCount()).toBe(1);

    driver.services.disposeAutocomplete(handle);
    expect(raw.getListenerCount(), "dispose 之后 Driver 侧订阅必须已释放").toBe(0);
  });

  it("销毁全景时释放 EventDriver 持有的订阅（否则 raw 对象与业务回调被长期持有）", () => {
    const container = document.createElement("div");
    const viewer = driver.panorama.create(container);
    const raw = fake.createdPanoramas[0];
    const listener = vi.fn();

    driver.events.on(viewer, "position_changed", listener);
    expect(raw.getListenerCount()).toBe(1);

    driver.panorama.destroy(viewer);

    // EventDriver 的 groups 是强引用（Map<rawTarget, …>）：不主动 release，条目会一直持有
    // 已销毁的 raw 对象与业务回调，反复建/销全景会持续累积
    expect(raw.getListenerCount(), "destroy 之后 Driver 侧订阅必须已释放").toBe(0);
  });

  it("销毁失败后重新订阅：重试成功时必须再次释放订阅（不能因「曾经释放过」而跳过）", () => {
    const container = document.createElement("div");
    const viewer = driver.panorama.create(container);
    const raw = fake.createdPanoramas[0];

    driver.events.on(viewer, "position_changed", vi.fn());
    raw.failNextDestroy = new TypeError("Cannot read properties of undefined (reading 'START')");
    expect(() => driver.panorama.destroy(viewer)).toThrow();

    // 查看器**尚未成功销毁** → 业务可以重新订阅（等待就绪 / 恢复）
    driver.events.on(viewer, "position_changed", vi.fn());
    expect(raw.getListenerCount()).toBe(1);

    driver.panorama.destroy(viewer);
    expect(
      raw.getListenerCount(),
      "重试成功之后 Driver 侧订阅必须已释放（否则新订阅会随查看器一起泄漏）",
    ).toBe(0);
  });
});
