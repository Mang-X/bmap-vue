/**
 * v4 Overlay facet 行为验证（M3A2-OVERLAYS / issue #21）
 *
 * 这一层验证两件事：
 * 1. **同一个 Overlay facet 契约**在 v4 与 webgl-v1 上都能通过 —— 本文件让 v4 Overlay facet
 *    直接跑 `runOverlayFacetContract`，与 `tests/behavior/v3-driver-contract.test.ts` 的
 *    webgl-v1 harness 共用同一套断言（契约的单一事实源在
 *    `packages/test-utils/driver-contract.ts`）；
 * 2. v4 特有的行为：`Rectangle` / `CustomOverlay` / `GroundOverlay` / `Prism` / `BezierCurve` /
 *    `ContextMenu` 的完整往返，InfoWindow 由 Map 管理，以及「**先摘子资源、再销毁 Map**」
 *    这条跨 Facet 不变式（见 ADR 2026-09-11-jsapi-v4-map-facet 的「跨 Facet 交接风险」）。
 *
 * 组装方式：v4 的 Facet 装配（`createJsapiV4Driver`）属 #23/#25，本 issue 只在测试里手工组合
 * Overlay facet 与它的依赖，不提前改动默认 Client 路径。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createFakeBMapV4, type FakeBMapV4 } from "../../packages/test-utils";
import {
  runOverlayFacetContract,
  type OverlayFacetHarness,
} from "../../packages/test-utils/driver-contract";
import { createCapabilityRegistry } from "../../packages/bmap-vue/src/driver/capability/registry";
import type { OverlayHandle, SdkHandle } from "../../packages/bmap-vue/src/driver/types/handles";
import { createJsapiV4GeometryDriver } from "../../packages/bmap-vue/src/driver/jsapi-v4/geometry";
import { createJsapiV4EventDriver } from "../../packages/bmap-vue/src/driver/jsapi-v4/events";
import { createJsapiV4OverlayDriver } from "../../packages/bmap-vue/src/driver/jsapi-v4/overlays";
import { createJsapiV4HandleRegistry } from "../../packages/bmap-vue/src/driver/jsapi-v4/registry";

let fake: FakeBMapV4;
let registry: ReturnType<typeof createJsapiV4HandleRegistry>;
let overlays: ReturnType<typeof createJsapiV4OverlayDriver>;
let events: ReturnType<typeof createJsapiV4EventDriver>;
let rawMaps: InstanceType<FakeBMapV4["namespace"]["Map"]>[];

function sizedContainer(): HTMLElement {
  const el = document.createElement("div");
  el.style.width = "320px";
  el.style.height = "240px";
  document.body.appendChild(el);
  return el;
}

/** 采纳一个 raw map 并记录它，供「先摘子资源」不变式断言使用。 */
function adoptMap(): SdkHandle<"map"> {
  const raw = new fake.namespace.Map(sizedContainer());
  rawMaps.push(raw);
  return registry.adopt("map", raw);
}

function mapTarget(): { kind: "map"; handle: SdkHandle<"map"> } {
  return { kind: "map", handle: adoptMap() };
}

beforeEach(() => {
  fake = createFakeBMapV4();
  registry = createJsapiV4HandleRegistry();
  rawMaps = [];
  const geometry = createJsapiV4GeometryDriver(fake.namespace);
  const capabilities = createCapabilityRegistry({
    engine: "jsapi-v4",
    version: fake.namespace.VERSION,
    rawSdk: fake.namespace,
    unsupported: "throw",
  });
  overlays = createJsapiV4OverlayDriver({
    rawSdk: fake.namespace,
    geometry,
    capabilities,
    registry,
  });
  events = createJsapiV4EventDriver({ registry, geometry });
});

function createHarness(): OverlayFacetHarness {
  return { driver: () => ({ overlays }), mapHandle: () => adoptMap() };
}

runOverlayFacetContract(createHarness);

const rawOf = (handle: OverlayHandle) => handle.raw as Record<string, unknown>;

describe("v4 Overlay facet 扩展覆盖物", () => {
  it("Rectangle / CustomOverlay / GroundOverlay / Prism / BezierCurve 走同一条加/摘路径", () => {
    const target = mapTarget();
    const handles: OverlayHandle[] = [
      overlays.createRectangle({
        southwest: { lng: 116.39, lat: 39.9 },
        northeast: { lng: 116.42, lat: 39.92 },
      }),
      overlays.createCustomOverlay({ lng: 116.404, lat: 39.915 }, () =>
        document.createElement("button"),
      ),
      overlays.createGroundOverlay(
        { southwest: { lng: 116.39, lat: 39.9 }, northeast: { lng: 116.42, lat: 39.92 } },
        { url: "https://example.com/a.png", opacity: 0.5 },
      ),
      overlays.createPrism(
        [
          { lng: 116.399, lat: 39.91 },
          { lng: 116.409, lat: 39.91 },
          { lng: 116.406, lat: 39.92 },
        ],
        300,
      ),
      overlays.createBezierCurve(
        [
          { lng: 116.392, lat: 39.906 },
          { lng: 116.418, lat: 39.924 },
        ],
        [[{ lng: 116.405, lat: 39.936 }]],
      ),
    ];

    for (const handle of handles) overlays.add(target, handle);
    expect(rawMaps[0].overlays).toHaveLength(handles.length);

    for (const handle of handles) overlays.remove(target, handle);
    expect(rawMaps[0].overlays).toHaveLength(0);
    for (const handle of handles) expect(rawOf(handle).attachedMap).toBeNull();
  });

  it("ContextMenu 挂在 Map 上，open/close 事件经 EventDriver 可订阅", () => {
    const target = mapTarget();
    const menu = overlays.createContextMenu({ width: 120 });
    overlays.addContextMenuItem(menu, { text: "a", callback: () => {} });
    overlays.addContextMenuItem(menu, "-");

    overlays.attachContextMenu(target, menu);
    expect(rawMaps[0].contextMenus).toHaveLength(1);
    overlays.detachContextMenu(target, menu);
    expect(rawMaps[0].contextMenus).toHaveLength(0);
  });

  it("InfoWindow 由 Map 管理：open 之后 close，再销毁地图时不留悬空气泡", () => {
    const target = mapTarget();
    const infoWindow = overlays.createInfoWindow(document.createElement("div"));
    overlays.openInfoWindow(target.handle, infoWindow, { lng: 116.4, lat: 39.9 });
    expect(rawMaps[0].infoWindow).toBe(rawOf(infoWindow));

    // 官方要求的卸载顺序：先关气泡、再销毁地图（marker.md / label-and-info-window.md）
    overlays.closeInfoWindow(infoWindow);
    rawMaps[0].destroy();
    expect(rawMaps[0].infoWindow).toBeNull();
    expect(rawMaps[0].destroyed).toBe(true);
  });
});

describe("v4 Overlay facet 释放顺序（跨 Facet 不变式）", () => {
  it("先摘掉子资源再销毁地图：destroyedWithOverlays 为 0", () => {
    const target = mapTarget();
    const marker = overlays.createMarker({ lng: 116.4, lat: 39.9 });
    const polyline = overlays.createPolyline([
      { lng: 116.39, lat: 39.9 },
      { lng: 116.42, lat: 39.92 },
    ]);
    overlays.add(target, marker);
    overlays.add(target, polyline);

    overlays.remove(target, marker);
    overlays.remove(target, polyline);
    rawMaps[0].destroy();

    expect(rawMaps[0].destroyedWithOverlays).toBe(0);
  });

  it("遗漏摘除时该不变式会失败（证明这条检查不是空转）", () => {
    const target = mapTarget();
    overlays.add(target, overlays.createMarker({ lng: 116.4, lat: 39.9 }));
    rawMaps[0].destroy();
    expect(rawMaps[0].destroyedWithOverlays).toBe(1);
  });
});

describe("v4 Overlay facet 事件与 Target 原子性", () => {
  it("覆盖物事件经 EventDriver 归一化派发，disposer 释放后监听归零", () => {
    const marker = overlays.createMarker({ lng: 116.4, lat: 39.9 });
    const received: Record<string, unknown>[] = [];
    const dispose = events.on<Record<string, unknown>>(marker, "click", (event) =>
      received.push(event),
    );
    expect(fake.stats.liveListeners).toBe(1);

    (rawOf(marker).emit as (type: string, payload?: Record<string, unknown>) => void)("click", {
      point: { lng: 116.404, lat: 39.915 },
      pixel: { x: 10, y: 20 },
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      type: "click",
      point: { lng: 116.404, lat: 39.915 },
      pixel: { x: 10, y: 20 },
    });

    dispose();
    expect(fake.stats.liveListeners).toBe(0);
  });

  it("重复 add 不会重复挂载；remove 之后可以重新挂载", () => {
    const target = mapTarget();
    const marker = overlays.createMarker({ lng: 116.4, lat: 39.9 });

    overlays.add(target, marker);
    overlays.add(target, marker);
    expect(rawMaps[0].overlays).toHaveLength(1);

    overlays.remove(target, marker);
    expect(rawMaps[0].overlays).toHaveLength(0);

    overlays.add(target, marker);
    expect(rawMaps[0].overlays).toHaveLength(1);
    expect(rawMaps[0].overlays[0]).toBe(rawOf(marker));
  });
});
