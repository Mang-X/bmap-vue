/**
 * Driver 契约测试
 *
 * 每个 Driver 实现必须通过同一套契约。
 * 通过 harness 提供 client/driver，不依赖全局 window.BMapGL。
 *
 * 结构（M3A2-MAP / #20、M3A2-OVERLAYS / #21、M3A2-CONTROLS-LAYERS / #22）：
 * - `runMapFacetContract`：**Map facet 契约**，只需要 `map` / `geometry` / `events` /
 *   `capabilities` 四个 facet，因此 v4（其余 facet 属 #21~#23）与 webgl-v1 都能跑；
 * - `runOverlayFacetContract`：**Overlay facet 契约**，只需要 `overlays` 与一个 Map 句柄，
 *   覆盖「每种基础覆盖物的 create/update/remove」「InfoWindow 专用 API」「属性分类查询」；
 * - `runControlFacetContract` / `runLayerFacetContract`：**Control / Layer facet 契约**，
 *   只需要对应 facet、一个 Map 句柄与挂载计数，覆盖「构造 → 挂载 → 更新 → 摘除」与
 *   「重复 add 不重复挂载」「非 Map 目标必须失败」；
 * - `runMapDriverContract`：webgl-v1 时代的全量契约（额外的覆盖物 / 能力策略断言），
 *   内部复用上面几层。
 *
 * 契约只断言**两个引擎都能满足**的部分：v4 独有的策略（`BMAP_RESOURCE_DISPOSED` 之后的命令、
 * 非 Map 目标的错误码、Rectangle / CustomOverlay 等）留在引擎自己的测试里断言。
 */
import { describe, it, expect } from "vitest";
import type { BMapClient } from "../baidu-map-gl-vue/src/client/types";
import type { BMapDriver } from "../baidu-map-gl-vue/src/driver/types/bmap";
import type { ControlKind } from "../baidu-map-gl-vue/src/driver/types/controls";
import type { MapHandle } from "../baidu-map-gl-vue/src/driver/types/handles";
import type { LayerKind } from "../baidu-map-gl-vue/src/driver/types/layers";
import type { MapInteraction } from "../baidu-map-gl-vue/src/driver/types/map";
import type {
  NativeLayerDriver,
  NativeLayerKind,
} from "../baidu-map-gl-vue/src/driver/types/native-layers";
import type {
  OverlayDriver,
  OverlayHandle,
  OverlayTarget,
} from "../baidu-map-gl-vue/src/driver/types/overlays";
import type { PanoramaViewerDriver } from "../baidu-map-gl-vue/src/driver/types/panorama";
import type {
  JsapiV4ServiceDriver,
  ServiceCallStatus,
  ServiceResult,
} from "../baidu-map-gl-vue/src/driver/types/services";
import type { Point } from "../baidu-map-gl-vue/src/driver/types/geometry";
import {
  DEFAULT_SERVICE_FACET_FIXTURE,
  probeNativeLayerFacet,
  probePanoramaFacet,
  probeServiceFacet,
} from "./facet-probes";

/**
 * 探针（`./facet-probes`）是本文件与真实 AK smoke 共用的那一半：这里再导出一次，
 * 让「契约」这个入口同时提供纯探针与 vitest 断言，调用方不必知道文件怎么切。
 */
export {
  DEFAULT_SERVICE_FACET_FIXTURE,
  NATIVE_LAYER_FACET_KINDS,
  NATIVE_LAYER_FACET_OPERATIONS,
  callNativeLayerOperation,
  probeNativeLayerFacet,
  probePanoramaFacet,
  probeServiceFacet,
} from "./facet-probes";
export type {
  NativeLayerFacetProbeOptions,
  NativeLayerRoundTrip,
  PanoramaFacetProbes,
  ServiceFacetFixture,
  ServiceFacetProbes,
} from "./facet-probes";

export interface DriverHarness {
  client(): BMapClient;
  container(): HTMLElement;
}

/** Map facet 契约只需要这几个 facet，不要求 Driver 已实现覆盖物 / 控件 / 图层。 */
export type MapFacetDriver = Pick<BMapDriver, "map" | "geometry" | "events" | "capabilities">;

export interface MapFacetHarness {
  driver(): MapFacetDriver;
  container(): HTMLElement;
}

/** issue #20「交互开关」相关的全部语义项（各引擎的实现表都必须覆盖这 12 项）。 */
export const MAP_INTERACTIONS: readonly MapInteraction[] = [
  "dragging",
  "scroll-zoom",
  "inertial-dragging",
  "pinch-zoom",
  "keyboard",
  "double-click-zoom",
  "continuous-zoom",
  "resize-on-center",
  "rotate",
  "rotate-gestures",
  "tilt",
  "tilt-gestures",
];

export function runMapFacetContract(createHarness: () => MapFacetHarness) {
  describe("Map facet contract", () => {
    it("creates and destroys a map (destroy 幂等)", () => {
      const harness = createHarness();
      const map = harness.driver().map.create(harness.container());
      expect(map.raw).toBeTruthy();
      harness.driver().map.destroy(map);
      expect(() => harness.driver().map.destroy(map)).not.toThrow();
    });

    it("initializes center and zoom once, then updates each axis independently", () => {
      const harness = createHarness();
      const driver = harness.driver();
      const map = driver.map.create(harness.container());
      driver.map.initializeView(map, { center: { lng: 116.4, lat: 39.9 }, zoom: 14 });
      expect(driver.map.getZoom(map)).toBe(14);
      expect(driver.map.getCenter(map)).toEqual({ lng: 116.4, lat: 39.9 });

      driver.map.setCenter(map, { lng: 121.5, lat: 31.2 });
      expect(driver.map.getZoom(map)).toBe(14);
      driver.map.setZoom(map, 9);
      expect(driver.map.getCenter(map)).toEqual({ lng: 121.5, lat: 31.2 });
      expect(driver.map.getZoom(map)).toBe(9);
    });

    it("round-trips heading and tilt", () => {
      const harness = createHarness();
      const driver = harness.driver();
      const map = driver.map.create(harness.container());
      driver.map.initializeView(map, { center: { lng: 116.4, lat: 39.9 }, zoom: 12 });

      driver.map.setHeading(map, 45);
      expect(driver.map.getHeading(map)).toBe(45);
      driver.map.setTilt(map, 30);
      expect(driver.map.getTilt(map)).toBe(30);
    });

    it("normalizes bounds and size", () => {
      const harness = createHarness();
      const driver = harness.driver();
      const map = driver.map.create(harness.container());
      driver.map.initializeView(map, { center: { lng: 116.4, lat: 39.9 }, zoom: 12 });

      const bounds = driver.map.getBounds(map);
      expect(bounds.southwest.lng).toBeLessThan(bounds.northeast.lng);
      expect(bounds.southwest.lat).toBeLessThan(bounds.northeast.lat);

      const size = driver.map.getSize(map);
      expect(Number.isFinite(size.width)).toBe(true);
      expect(Number.isFinite(size.height)).toBe(true);
      expect(size.width).toBeGreaterThanOrEqual(0);
    });

    it("round-trips projection conversions and puts the center in the middle", () => {
      const harness = createHarness();
      const driver = harness.driver();
      const container = harness.container();
      const map = driver.map.create(container);
      driver.map.initializeView(map, { center: { lng: 116.404, lat: 39.915 }, zoom: 14 });

      const point = { lng: 116.414, lat: 39.905 };
      const pixel = driver.map.pointToPixel(map, point);
      const roundTrip = driver.map.pixelToPoint(map, pixel);
      expect(roundTrip.lng).toBeCloseTo(point.lng, 8);
      expect(roundTrip.lat).toBeCloseTo(point.lat, 8);

      const size = driver.map.getSize(map);
      expect(driver.map.pointToPixel(map, { lng: 116.404, lat: 39.915 })).toEqual({
        x: size.width / 2,
        y: size.height / 2,
      });
    });

    it("toggles every interaction and stays stable on repeats", () => {
      const harness = createHarness();
      const driver = harness.driver();
      const map = driver.map.create(harness.container());

      // 跨引擎只断言「不抛错」：各引擎的交互项 → SDK 方法的映射细节与是否落地，
      // 由引擎自己的单测用可观察状态断言（v4 见 `driver/jsapi-v4/map.test.ts`）。
      for (const interaction of MAP_INTERACTIONS) {
        expect(() => {
          driver.map.setInteraction(map, interaction, false);
          driver.map.setInteraction(map, interaction, false);
          driver.map.setInteraction(map, interaction, true);
          driver.map.setInteraction(map, interaction, true);
        }).not.toThrow();
      }
    });

    it("applies pan / fitBounds / setViewport without losing the view", () => {
      const harness = createHarness();
      const driver = harness.driver();
      const map = driver.map.create(harness.container());
      driver.map.initializeView(map, { center: { lng: 116.4, lat: 39.9 }, zoom: 12 });

      expect(() => {
        driver.map.panTo(map, { lng: 116.5, lat: 39.9 });
        driver.map.panBy(map, { x: 40, y: -20 });
        driver.map.fitBounds(map, {
          southwest: { lng: 116.2, lat: 39.7 },
          northeast: { lng: 116.6, lat: 40.1 },
        });
        driver.map.setViewport(map, [
          { lng: 116.3, lat: 39.8 },
          { lng: 116.5, lat: 40.0 },
        ]);
        driver.map.checkResize(map);
      }).not.toThrow();

      // 视野操作之后视图仍然可读（不是被平移/取景弄成非法状态）
      const center = driver.map.getCenter(map);
      expect(Number.isFinite(center.lng)).toBe(true);
      expect(Number.isFinite(center.lat)).toBe(true);
      expect(Number.isFinite(driver.map.getZoom(map))).toBe(true);
    });

    it("creates and destroys a map in a zero-size container", () => {
      const harness = createHarness();
      const driver = harness.driver();
      const container = harness.container();
      container.style.width = "0px";
      container.style.height = "0px";

      const map = driver.map.create(container);
      expect(map.raw).toBeTruthy();
      expect(() => driver.map.checkResize(map)).not.toThrow();
      const size = driver.map.getSize(map);
      expect(Number.isFinite(size.width)).toBe(true);
      driver.map.destroy(map);
    });

    it("returns a disposer for events", () => {
      const harness = createHarness();
      const driver = harness.driver();
      const map = driver.map.create(harness.container());
      const listener = () => {};
      const dispose = driver.events.on(map, "click", listener);
      dispose();
    });
  });
}

/** Overlay facet 契约只需要覆盖物 facet：挂载目标与 InfoWindow 宿主由 harness 提供。 */
export type OverlayFacetDriver = Pick<BMapDriver, "overlays">;

export interface OverlayFacetHarness {
  driver(): OverlayFacetDriver;
  /** 每个用例一份新的 Map 句柄（既作挂载目标，也作 InfoWindow 的宿主地图） */
  mapHandle(): MapHandle;
}

const POINT: Point = { lng: 116.4, lat: 39.9 };

/** 基础覆盖物的构造入口（issue #21 的「每种基础 Overlay 的 create/update/remove contract」）。 */
const OVERLAY_FACTORIES: ReadonlyArray<[string, (overlays: OverlayDriver) => OverlayHandle]> = [
  ["marker", (overlays) => overlays.createMarker(POINT)],
  ["label", (overlays) => overlays.createLabel("label", { position: POINT })],
  [
    "polyline",
    (overlays) =>
      overlays.createPolyline([
        { lng: 116.39, lat: 39.9 },
        { lng: 116.42, lat: 39.92 },
      ]),
  ],
  [
    "polygon",
    (overlays) =>
      overlays.createPolygon([
        { lng: 116.39, lat: 39.9 },
        { lng: 116.42, lat: 39.9 },
        { lng: 116.41, lat: 39.92 },
      ]),
  ],
  ["circle", (overlays) => overlays.createCircle(POINT, 500)],
];

export function runOverlayFacetContract(createHarness: () => OverlayFacetHarness) {
  describe("Overlay facet contract", () => {
    for (const [name, make] of OVERLAY_FACTORIES) {
      it(`creates, mounts, updates and removes a ${name}`, () => {
        const harness = createHarness();
        const overlays = harness.driver().overlays;
        const overlay = make(overlays);
        expect(overlay.raw).toBeTruthy();

        const target: OverlayTarget = { kind: "map", handle: harness.mapHandle() };
        overlays.add(target, overlay);
        expect(() => overlays.setOptions(overlay, {})).not.toThrow();
        expect(typeof overlays.show(overlay)).toBe("boolean");
        expect(() => overlays.hide(overlay)).not.toThrow();
        expect(() => overlays.remove(target, overlay)).not.toThrow();
      });
    }

    it("updates position and path through the field-level API", () => {
      const harness = createHarness();
      const overlays = harness.driver().overlays;
      const marker = overlays.createMarker(POINT);
      const polyline = overlays.createPolyline([POINT, { lng: 116.42, lat: 39.92 }]);

      expect(() => overlays.setPosition(marker, { lng: 116.5, lat: 39.9 })).not.toThrow();
      expect(() =>
        overlays.setPath(polyline, [{ lng: 116.3, lat: 39.8 }, { lng: 116.45, lat: 39.95 }]),
      ).not.toThrow();
    });

    it("opens and closes an InfoWindow through the dedicated API", () => {
      const harness = createHarness();
      const overlays = harness.driver().overlays;
      const infoWindow = overlays.createInfoWindow(document.createElement("div"), {
        width: 200,
        title: "气泡",
      });
      expect(infoWindow.raw).toBeTruthy();

      expect(() => overlays.openInfoWindow(harness.mapHandle(), infoWindow, POINT)).not.toThrow();
      expect(() => overlays.redrawInfoWindow(infoWindow)).not.toThrow();
      expect(() => overlays.closeInfoWindow(infoWindow)).not.toThrow();
    });

    it("rejects opening an InfoWindow without a position (point 是官方 API 的必需参数)", () => {
      const harness = createHarness();
      const overlays = harness.driver().overlays;
      const infoWindow = overlays.createInfoWindow(document.createElement("div"));

      // 运行期兜底：类型上 `position` 已是必需，但 JS 调用方 / 类型被绕过的路径仍要显式失败
      // （两个引擎同一份契约，R25-C 复审 P1；此前 legacy 会走实例级回退、v4 也会「碰巧打开」）
      expect(() =>
        overlays.openInfoWindow(harness.mapHandle(), infoWindow, undefined as never),
      ).toThrowError(expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }));
    });

    it("exposes the shared property classification (mutable / recreate / unsupported)", () => {
      const harness = createHarness();
      const overlays = harness.driver().overlays;
      const marker = overlays.createMarker(POINT);

      // 元数据来自公共 `OVERLAY_DESCRIPTORS`，因此两个引擎的答案必须一致
      expect(overlays.updatePolicy(marker, "icon")).toBe("mutable");
      expect(overlays.updatePolicy(marker, "position")).toBe("mutable");
      expect(overlays.updatePolicy(marker, "enableClicking")).toBe("recreate");
      expect(overlays.updatePolicy(marker, "noSuchProperty")).toBeUndefined();
    });

    it("rejects a non-map mount target instead of silently doing nothing", () => {
      const harness = createHarness();
      const overlays = harness.driver().overlays;
      const marker = overlays.createMarker(POINT);
      expect(() => overlays.add({ kind: "marker", handle: marker }, marker)).toThrow();
      expect(() => overlays.remove({ kind: "overlay", handle: marker }, marker)).toThrow();
    });
  });
}

export function runMapDriverContract(createHarness: () => DriverHarness) {
  describe("MapDriver contract", () => {
    it("respects unsupported policy", () => {
      const harness = createHarness();
      const client = harness.client();
      expect(client.driver.capabilities.supports("overlay.marker")).toBe(true);
      expect(typeof client.driver.capabilities.explain("overlay.marker").supported).toBe("boolean");
    });

    it("creates core overlays through the driver", () => {
      const harness = createHarness();
      const client = harness.client();
      const map = client.driver.map.create(harness.container());
      const marker = client.driver.overlays.createMarker({ lng: 116.4, lat: 39.9 });
      client.driver.overlays.add({ kind: "map", handle: map }, marker);
      client.driver.overlays.setPosition(marker, { lng: 116.5, lat: 39.9 });
      client.driver.overlays.remove({ kind: "map", handle: map }, marker);
    });

    runMapFacetContract(() => {
      const harness = createHarness();
      return { driver: () => harness.client().driver, container: () => harness.container() };
    });

    runOverlayFacetContract(() => {
      const harness = createHarness();
      return {
        driver: () => harness.client().driver,
        mapHandle: () => harness.client().driver.map.create(harness.container()),
      };
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Control / Layer facet 契约（M3A2-CONTROLS-LAYERS / #22）                      */
/* -------------------------------------------------------------------------- */

/** issue #22「目标与范围」列出的十个内置控件（两个引擎都必须实现）。 */
export const CONTROL_FACET_KINDS: readonly ControlKind[] = [
  "zoom",
  "scale",
  "navigation",
  "navigation-3d",
  "city-list",
  "location",
  "map-type",
  "overview",
  "panorama",
  "copyright",
];

/** issue #22 要求的图层种类（`LayerKind` 全覆盖）。 */
export const LAYER_FACET_KINDS: readonly LayerKind[] = [
  "district",
  "panorama-coverage",
  "tile",
];

/** Control / Layer facet 契约只需要该 facet + 一个 Map 句柄 + 挂载计数。 */
export type ControlFacetDriver = Pick<BMapDriver, "controls">;
export type LayerFacetDriver = Pick<BMapDriver, "layers">;

export interface MountFacetHarness<Driver> {
  driver(): Driver;
  /** 每个用例一份新的 Map 句柄（挂载目标） */
  mapHandle(): MapHandle;
  /**
   * 当前挂在该地图上的子资源数量。
   *
   * 各引擎用自己 Fake 的记账实现（v4：`rawMap.controls` / `rawMap.layers`；
   * webgl-v1：`fakeMap.controls` / `fakeMap.overlays`）。把假账本放在 harness 一侧，
   * 契约才能断言「重复 add 只挂一次」「remove 之后计数归零」这类不变的语义。
   */
  attachedCount(): number;
}

export type ControlFacetHarness = MountFacetHarness<ControlFacetDriver>;
export type LayerFacetHarness = MountFacetHarness<LayerFacetDriver>;

/**
 * Control facet 契约。
 *
 * 只断言**两个引擎都能满足**的部分：构造、挂载/摘除记账、显隐、公共 option 更新、
 * 自定义控件、非 Map 目标必须失败。引擎独有的策略（anchor 常量换算、kind 专属分类、
 * 告警文本）留在各引擎自己的测试里。
 */
export function runControlFacetContract(createHarness: () => ControlFacetHarness) {
  describe("Control facet contract", () => {
    for (const kind of CONTROL_FACET_KINDS) {
      it(`creates, mounts, toggles and removes a ${kind} control`, () => {
        const harness = createHarness();
        const controls = harness.driver().controls;
        const control = controls.create(kind);
        expect(control.raw).toBeTruthy();

        const target: OverlayTarget = { kind: "map", handle: harness.mapHandle() };
        expect(harness.attachedCount()).toBe(0);

        controls.add(target, control);
        expect(harness.attachedCount()).toBe(1);
        // 重复 add 不重复挂载（SDK 不保证去重，两个引擎的 Driver 自己记账）
        controls.add(target, control);
        expect(harness.attachedCount()).toBe(1);

        expect(() => controls.hide(control)).not.toThrow();
        expect(() => controls.show(control)).not.toThrow();
        expect(() =>
          controls.setOptions(control, { anchor: "BMAP_ANCHOR_TOP_LEFT" }),
        ).not.toThrow();

        controls.remove(target, control);
        expect(harness.attachedCount()).toBe(0);
        // dispose 幂等：重复 remove 不抛错、计数不变成负数（SDK 侧的移除对未挂载资源是 no-op）
        expect(() => controls.remove(target, control)).not.toThrow();
        expect(harness.attachedCount()).toBe(0);
        // remove 之后可以重新挂载
        controls.add(target, control);
        expect(harness.attachedCount()).toBe(1);
      });
    }

    it("creates and mounts a custom control", () => {
      const harness = createHarness();
      const controls = harness.driver().controls;
      const control = controls.createCustomControl({
        anchor: "BMAP_ANCHOR_TOP_RIGHT",
        offset: { x: 4, y: 8 },
        render: (container) => container,
      });
      expect(control.raw).toBeTruthy();

      const target: OverlayTarget = { kind: "map", handle: harness.mapHandle() };
      controls.add(target, control);
      expect(harness.attachedCount()).toBe(1);
      controls.remove(target, control);
      expect(harness.attachedCount()).toBe(0);
    });

    it("rejects a non-map mount target instead of silently doing nothing", () => {
      const harness = createHarness();
      const controls = harness.driver().controls;
      const control = controls.create("zoom");
      expect(() => controls.add({ kind: "overlay", handle: control }, control)).toThrow();
      expect(() => controls.remove({ kind: "overlay", handle: control }, control)).toThrow();
    });
  });
}

/**
 * Layer facet 契约。
 *
 * 可见性在 v4 就是「挂上 / 摘掉」（图层没有 `show/hide`），因此这块用挂载计数断言；
 * 与 webgl-v1 的 `addDistrictLayer` / `addTileLayer` 分流差异一起由 harness 吸收。
 */
export function runLayerFacetContract(createHarness: () => LayerFacetHarness) {
  describe("Layer facet contract", () => {
    for (const kind of LAYER_FACET_KINDS) {
      it(`creates, mounts, updates and removes a ${kind} layer`, () => {
        const harness = createHarness();
        const layers = harness.driver().layers;
        const options = kind === "district" ? { name: "北京市", viewport: true } : {};
        const layer = layers.create(kind, options);
        expect(layer.raw).toBeTruthy();

        const target: OverlayTarget = { kind: "map", handle: harness.mapHandle() };
        expect(harness.attachedCount()).toBe(0);

        layers.add(target, layer);
        expect(harness.attachedCount()).toBe(1);
        // 重复 add 不重复挂载
        layers.add(target, layer);
        expect(harness.attachedCount()).toBe(1);

        // 「hidden」在图层上就是「已摘掉」：显隐不抛错
        expect(() => layers.setOptions(layer, {})).not.toThrow();

        layers.remove(target, layer);
        expect(harness.attachedCount()).toBe(0);
        // dispose 幂等：重复 remove 不抛错、计数不变成负数
        expect(() => layers.remove(target, layer)).not.toThrow();
        expect(harness.attachedCount()).toBe(0);
        // remove 之后可以重新挂载
        layers.add(target, layer);
        expect(harness.attachedCount()).toBe(1);
      });
    }

    it("rejects a non-map mount target instead of silently doing nothing", () => {
      const harness = createHarness();
      const layers = harness.driver().layers;
      const layer = layers.create("tile");
      expect(() => layers.add({ kind: "overlay", handle: layer }, layer)).toThrow();
      expect(() => layers.remove({ kind: "overlay", handle: layer }, layer)).toThrow();
    });
  });
}

export function expectMapHandle(map: unknown): asserts map is MapHandle {
  expect(typeof (map as MapHandle).raw).not.toBe("undefined");
}

/* -------------------------------------------------------------------------- */
/* Service / Native Layer / Panorama facet 契约（M3A2-SERVICES-NATIVE / #23）     */
/* -------------------------------------------------------------------------- */

/**
 * 这一层与前三个 facet 契约的**结构差别**值得先说明：
 *
 * 前者是「两个引擎都必须满足」的跨引擎契约；Service / Native Layer / Panorama 是 v4
 * 独有的面（webgl-v1 没有原生数据图层，也没有归一化服务调用面），因此契约的消费者是
 * **v4 Fake** 与 **真实 AK smoke 子集**（issue #23 实施步骤 5）。
 *
 * 为了「同一套 Harness 两边都能跑」，每个 facet 拆成两半：
 * - `./facet-probes` 的 `probeXxxFacet`：纯函数，只做调用与结构化记录，**不 import vitest**
 *   （浏览器里的 smoke 直接用它）；
 * - 本文件的 `runXxxFacetContract`：用 vitest 断言探针的结果。
 *
 * Fake 侧另有一档 `expectation: "fixture" | "live"`：Fake 环境要求「命中 fixture」，
 * 真实环境只要求「结算且形状自洽」——配额、网络与 Referer 都不受本库控制，
 * 把「真实环境必须成功」写进契约只会得到一个不稳定的门禁。
 */

const SERVICE_CALL_STATUSES: readonly ServiceCallStatus[] = [
  "success",
  "empty",
  "failed",
  "timeout",
  "canceled",
];

/** `ServiceResult` 的形状不变式：三个终态各自的可观测契约。 */
export function assertServiceResultShape<T>(label: string, result: ServiceResult<T>): void {
  expect(SERVICE_CALL_STATUSES, `${label}: 未知的 status`).toContain(result.status);
  if (result.status === "success") {
    expect(result.data, `${label}: success 必须带 data`).not.toBeNull();
    expect(result.error, `${label}: success 不应带 error`).toBeNull();
    return;
  }
  expect(result.data, `${label}: ${result.status} 不应带 data`).toBeNull();
  if (result.status === "failed" || result.status === "timeout") {
    expect(result.error, `${label}: ${result.status} 必须带 error`).not.toBeNull();
  } else {
    expect(result.error, `${label}: ${result.status} 不应带 error`).toBeNull();
  }
}

export interface ServiceFacetHarness {
  services(): JsapiV4ServiceDriver;
  fixture?: Parameters<typeof probeServiceFacet>[1];
  /**
   * `fixture`（默认）：Fake 环境，要求每个调用都真的命中 fixture；
   * `live`：真实 SDK/网络，只要求「结算且形状自洽」。
   */
  expectation?: "fixture" | "live";
}

export function runServiceFacetContract(createHarness: () => ServiceFacetHarness) {
  describe("Service facet contract", () => {
    it("七个归一化调用都结算，且每个 ServiceResult 形状自洽", async () => {
      const harness = createHarness();
      const probes = await probeServiceFacet(
        harness.services(),
        harness.fixture ?? DEFAULT_SERVICE_FACET_FIXTURE,
      );

      const entries: ReadonlyArray<readonly [string, ServiceResult<unknown>]> = [
        ["geocode", probes.geocode],
        ["reverseGeocode", probes.reverseGeocode],
        ["convert", probes.convert],
        ["boundary", probes.boundary],
        ["locate", probes.locate],
        ["locateCity", probes.locateCity],
        ["suggest", probes.suggest],
        ["canceled", probes.canceled],
      ];
      for (const [label, result] of entries) assertServiceResultShape(label, result);
    });

    it("取消立即以 canceled 结算，且不回写数据（迟到回调不复活）", async () => {
      const harness = createHarness();
      const probes = await probeServiceFacet(harness.services(), harness.fixture);
      expect(probes.canceled.status).toBe("canceled");
      expect(probes.canceled.data).toBeNull();
      expect(probes.canceled.error).toBeNull();
    });

    it("fixture 环境下每个基础服务都命中结果", async () => {
      const harness = createHarness();
      if ((harness.expectation ?? "fixture") !== "fixture") return;
      const probes = await probeServiceFacet(harness.services(), harness.fixture);

      const entries: ReadonlyArray<readonly [string, ServiceResult<unknown>]> = [
        ["geocode", probes.geocode],
        ["reverseGeocode", probes.reverseGeocode],
        ["convert", probes.convert],
        ["boundary", probes.boundary],
        ["locate", probes.locate],
        ["locateCity", probes.locateCity],
        ["suggest", probes.suggest],
      ];
      for (const [label, result] of entries) {
        expect(result.status, `${label} 未命中 fixture`).toBe("success");
      }
    });
  });
}

export interface NativeLayerFacetHarness {
  nativeLayers(): NativeLayerDriver;
  mapHandle(): MapHandle;
  /** Fake 环境的挂载计数；真实 smoke 省略 */
  attachedCount?: () => number;
  kinds?: readonly NativeLayerKind[];
}

export function runNativeLayerFacetContract(createHarness: () => NativeLayerFacetHarness) {
  describe("Native Layer facet contract", () => {
    it("每种图层的挂载往返：重复 add 只挂一次、remove 归零、remove 后可重挂", () => {
      const harness = createHarness();
      const roundTrips = probeNativeLayerFacet(harness.nativeLayers(), {
        target: { kind: "map", handle: harness.mapHandle() },
        attachedCount: harness.attachedCount,
        kinds: harness.kinds,
      });

      for (const trip of roundTrips) {
        if (trip.attached === null) continue;
        expect(trip.attached, `${trip.kind}: add 之后应挂 1 个`).toBe(1);
        expect(trip.attachedAfterDuplicateAdd, `${trip.kind}: 重复 add 只挂一次`).toBe(1);
        expect(trip.attachedAfterRemove, `${trip.kind}: remove 之后计数归零`).toBe(0);
        expect(trip.attachedAfterRemount, `${trip.kind}: remove 之后可以重挂`).toBe(1);
      }
    });

    it("supports() 与实现一致：不支持的操作必须显式失败", () => {
      const harness = createHarness();
      const roundTrips = probeNativeLayerFacet(harness.nativeLayers(), {
        target: { kind: "map", handle: harness.mapHandle() },
        attachedCount: harness.attachedCount,
        kinds: harness.kinds,
      });

      for (const trip of roundTrips) {
        expect(
          trip.rejectedWhenUnsupported,
          `${trip.kind}: 有操作声明不支持却静默成功（${trip.unsupported.join(", ")}）`,
        ).toBe(true);
      }
    });

    it("非 Map 目标必须失败（不静默 no-op）", () => {
      const harness = createHarness();
      const driver = harness.nativeLayers();
      const layer = driver.create(harness.kinds?.[0] ?? "line");
      expect(() => driver.add({ kind: "overlay", handle: harness.mapHandle() }, layer)).toThrow();
    });
  });
}

export interface PanoramaFacetHarness {
  panorama(): PanoramaViewerDriver;
  container(): HTMLElement;
  expectation?: "fixture" | "live";
}

export function runPanoramaFacetContract(createHarness: () => PanoramaFacetHarness) {
  describe("Panorama facet contract", () => {
    it("supported / 视角 / 生命周期：destroy 幂等，检索调用结算且形状自洽", async () => {
      const harness = createHarness();
      const probes = await probePanoramaFacet(harness.panorama(), harness.container());

      expect(probes.supported).toBe(true);
      // 幂等只在「第一次销毁成功」时可断言：失败会释放记账以便重试（真实 4.0 在未加载
      // 场景的实例上 destroy 会抛 TypeError，见 ADR 的 smoke 记录），此时第二次仍会打到 SDK。
      if (probes.destroyStatus === "ok") {
        expect(
          probes.destroyIdempotent,
          "首次销毁成功，重复销毁必须是短路（不再次打到 SDK）",
        ).toBe(true);
      }
      if ((harness.expectation ?? "fixture") === "fixture") {
        expect(probes.destroyStatus, `destroy 失败：${probes.destroyError ?? ""}`).toBe("ok");
      }
      assertServiceResultShape("panorama.byId", probes.byId);
      assertServiceResultShape("panorama.byLocation", probes.byLocation);
    });

    it("fixture 环境下两个检索都命中结果", async () => {
      const harness = createHarness();
      if ((harness.expectation ?? "fixture") !== "fixture") return;
      const probes = await probePanoramaFacet(harness.panorama(), harness.container());

      expect(probes.byId.status).toBe("success");
      expect(probes.byLocation.status).toBe("success");
    });
  });
}
