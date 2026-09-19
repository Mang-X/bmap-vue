import { describe, it, expect, vi } from "vitest";
import { createCapabilityRegistry } from "./registry";
import { UnsupportedCapabilityError } from "./unsupported";
import {
  CAPABILITY_CATALOG,
  CAPABILITY_FAMILIES,
  CAPABILITY_IDS,
  CAPABILITY_STATUSES,
  type Capability,
} from "./catalog";

/**
 * M3A3-REMOVE-LEGACY（#26）：`BMapEngine` 只剩 `jsapi-v4`，因此原先用 `webgl-v1` / `jsapi-v3`
 * 构造 registry 的用例改为单一引擎。两处**语义**变化要显式钉住：
 * - 目录里每条能力都必须声明当前唯一引擎（否则那张能力在运行时永远探不到）；
 * - 白名单不命中只剩「目录未收录该 id」这一条防御路径（引擎维度的区分已随旧引擎消失）。
 */
const fakeSdk = {
  Map: class {},
  Marker: class {},
  InfoWindow: class {},
  setHeading: () => {},
  setTilt: () => {},
  checkResize: () => {},
  VERSION: "4.0",
};

describe("CapabilityRegistry", () => {
  it("detects raw members on namespace and Map prototype", () => {
    const registry = createCapabilityRegistry({
      engine: "jsapi-v4",
      version: "4.0",
      rawSdk: fakeSdk,
      unsupported: "silent",
    });
    expect(registry.supports("overlay.marker")).toBe(true);
    expect(registry.supports("map.heading")).toBe(true);
    expect(registry.supports("overlay.mapvgl")).toBe(false);
  });

  /**
   * #29 评审 P1：真实 JSAPI 4.0 有一部分 Map 方法挂在**实例**上（`setZoom` / `setCenter` …），
   * 只查「命名空间 + `Map.prototype`」会让 `supports()` 假阴性 —— 而它是公开命令面的一部分。
   */
  it("实例自有成员也算：登记之前 false、登记之后 supported（真实 4.0 的 setZoom 不在原型上）", () => {
    const mapProto = class MapProtoOnly {}
    ;(mapProto.prototype as Record<string, unknown>).getZoom = () => 12
    const namespace = { Map: mapProto, VERSION: "4.0" }
    const registry = createCapabilityRegistry({
      engine: "jsapi-v4",
      version: "4.0",
      rawSdk: namespace,
      unsupported: "silent",
    })
    // 只有 getZoom 在原型上：`map.zoom` 需要 getZoom **和** setZoom ⇒ 还不能判定支持
    expect(registry.supports("map.zoom"), "半个成员不算支持").toBe(false)

    // 建图成功之后 Map Facet 会登记实例成员（driver/jsapi-v4/map.ts 的 create()）
    class RealishMap {
      getZoom = (): number => 12
      setZoom = (_zoom: number): void => {}
    }
    registry.observeInstanceMembers(new RealishMap())
    expect(registry.supports("map.zoom"), "登记实例成员之后必须转为 supported").toBe(true)
  })

  it("observeInstanceMembers：只收函数、幂等、null 是 no-op", () => {
    const registry = createCapabilityRegistry({
      engine: "jsapi-v4",
      version: "4.0",
      rawSdk: { Map: class {} },
      unsupported: "silent",
    })
    registry.observeInstanceMembers(null)
    registry.observeInstanceMembers(undefined)
    // `map.check-resize` 只要求一个成员：`checkResize`
    registry.observeInstanceMembers({ checkResize: 12 })
    expect(registry.supports("map.check-resize"), "数据字段不算成员").toBe(false)

    registry.observeInstanceMembers({ checkResize: () => {} })
    registry.observeInstanceMembers({ checkResize: () => {} })
    expect(registry.supports("map.check-resize")).toBe(true)
  })

  it("catalog 的每条能力都声明当前引擎（单引擎基线，M3A3-REMOVE-LEGACY）", () => {
    for (const id of CAPABILITY_IDS) {
      expect(CAPABILITY_CATALOG[id].engines, `${id} 未声明 jsapi-v4`).toContain("jsapi-v4");
    }
  });

  it("目录未收录的 id 按 engine-unsupported 拒绝", () => {
    const registry = createCapabilityRegistry({
      engine: "jsapi-v4",
      version: "4.0",
      rawSdk: fakeSdk,
      unsupported: "silent",
    });
    // 白名单检查在单引擎下的**唯一**可达路径：没有描述符
    expect(registry.supports("does.not-exist" as Capability)).toBe(false);
    expect(registry.explain("does.not-exist" as Capability).reason).toBe("engine-unsupported");
    // 没有描述符就没有 family 可报：留空，而不是兜一个值（#104 R10 删掉 `runtime` 族之后，
    // 原先兜的 `"runtime"` 是一个没人能解释的幽灵值）
    expect(registry.explain("does.not-exist" as Capability).family).toBeUndefined();
  });

  it("list() returns only supported capabilities", () => {
    const registry = createCapabilityRegistry({
      engine: "jsapi-v4",
      version: "4.0",
      rawSdk: fakeSdk,
      unsupported: "silent",
    });
    const listed = registry.list();
    expect(listed).toContain("overlay.marker");
    expect(listed).not.toContain("overlay.mapvgl");
    expect(listed.every((id) => CAPABILITY_IDS.includes(id))).toBe(true);
  });

  it("require() throw policy throws UnsupportedCapabilityError", () => {
    const registry = createCapabilityRegistry({
      engine: "jsapi-v4",
      version: "4.0",
      rawSdk: fakeSdk,
      unsupported: "throw",
    });
    expect(() => registry.require("overlay.mapvgl")).toThrow(UnsupportedCapabilityError);
  });

  it("require() warn policy logs and does not throw", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = createCapabilityRegistry({
      engine: "jsapi-v4",
      version: "4.0",
      rawSdk: fakeSdk,
      unsupported: "warn",
    });
    expect(() => registry.require("overlay.mapvgl")).not.toThrow();
    warn.mockRestore();
  });

  it("overrides take precedence", () => {
    const registry = createCapabilityRegistry({
      engine: "jsapi-v4",
      version: "4.0",
      rawSdk: fakeSdk,
      unsupported: "silent",
      overrides: { "overlay.marker": false, "overlay.mapvgl": true },
    });
    expect(registry.supports("overlay.marker")).toBe(false);
    expect(registry.supports("overlay.mapvgl")).toBe(true);
  });
});

describe("Capability Catalog 状态语义（M3A0-06 / issue #15）", () => {
  const fullSdk = {
    Map: class {},
    Marker: class {},
    InfoWindow: class {},
    Label: class {},
    Circle: class {},
    Polyline: class {},
    Polygon: class {},
    Rectangle: class {},
    CustomOverlay: class {},
    GroundOverlay: class {},
    PointCollection: class {},
    ContextMenu: class {},
    MenuItem: class {},
    Prism: class {},
    BezierCurve: class {},
    Marker3D: class {},
    TileLayer: class {},
    TrafficLayer: class {},
    GeoJSONLayer: class {},
    PointIconLayer: class {},
    PointShapeLayer: class {},
    DistrictLayer: class {},
    LineLayer: class {},
    FillLayer: class {},
    DOMLayer: class {},
    LocalSearch: class {},
    Autocomplete: class {},
    DrivingRoute: class {},
    WalkingRoute: class {},
    RidingRoute: class {},
    TransitRoute: class {},
    Geocoder: class {},
    Geolocation: class {},
    LocalCity: class {},
    Boundary: class {},
    Convertor: class {},
    Panorama: class {},
    PanoramaService: class {},
    PanoramaLabel: class {},
    getCenter: () => {},
    setCenter: () => {},
    setHeading: () => {},
    checkResize: () => {},
    setMapStyle: () => {},
    destroy: () => {},
    VERSION: "4.0",
  };

  it("catalog 覆盖 Map / Overlay / Layer / Service / Panorama 五个 family", () => {
    for (const family of CAPABILITY_FAMILIES) {
      const entries = CAPABILITY_IDS.filter((id) => CAPABILITY_CATALOG[id].family === family);
      expect(entries.length, `family ${family} 应至少有一个能力`).toBeGreaterThan(0);
    }
  });

  it("catalog 能表达 native / extended / experimental / unsupported 四种状态", () => {
    const statuses = new Set(CAPABILITY_IDS.map((id) => CAPABILITY_CATALOG[id].status));
    for (const status of CAPABILITY_STATUSES) {
      expect(statuses.has(status), `缺少状态 ${status}`).toBe(true);
    }
  });

  it("status=unsupported 在默认引擎下不支持，除非显式 override", () => {
    const unsupportedIds = CAPABILITY_IDS.filter(
      (id) => CAPABILITY_CATALOG[id].status === "unsupported",
    );
    expect(unsupportedIds.length).toBeGreaterThan(0);

    const registry = createCapabilityRegistry({
      engine: "jsapi-v4",
      version: "4.0",
      rawSdk: fullSdk,
      unsupported: "silent",
    });
    for (const id of unsupportedIds) {
      expect(registry.supports(id), `${id} 应不支持`).toBe(false);
      expect(registry.explain(id).reason).toBe("status-unsupported");
    }

    const overridden = createCapabilityRegistry({
      engine: "jsapi-v4",
      version: "4.0",
      rawSdk: fullSdk,
      unsupported: "silent",
      overrides: { "overlay.mapvgl": true },
    });
    expect(overridden.supports("overlay.mapvgl")).toBe(true);
    expect(overridden.explain("overlay.mapvgl").reason).toBe("overridden");
  });

  it("runtime-only 能力被显式标注，可探测能力不被误标", () => {
    const runtimeOnly = CAPABILITY_IDS.filter((id) => CAPABILITY_CATALOG[id].runtimeOnly);
    expect(runtimeOnly).toContain("map.check-resize");
    expect(runtimeOnly).toContain("overlay.point-collection");
    expect(runtimeOnly).toContain("layer.panorama-coverage");
    expect(CAPABILITY_CATALOG["overlay.marker"].runtimeOnly).toBe(false);
    expect(CAPABILITY_CATALOG["service.geocoder"].runtimeOnly).toBe(false);
  });

  it("explain() 返回 family / status / runtimeOnly 元数据", () => {
    const registry = createCapabilityRegistry({
      engine: "jsapi-v4",
      version: "4.0",
      rawSdk: fullSdk,
      unsupported: "silent",
    });
    const explanation = registry.explain("overlay.marker");
    expect(explanation.family).toBe("overlay");
    expect(explanation.status).toBe("native");
    expect(explanation.runtimeOnly).toBe(false);
    expect(explanation.supported).toBe(true);
    expect(explanation.reason).toBe("supported");

    const missing = registry.explain("layer.geojson");
    expect(missing.supported).toBe(true);

    const noMember = createCapabilityRegistry({
      engine: "jsapi-v4",
      version: "4.0",
      rawSdk: { Map: class {} },
      unsupported: "silent",
    }).explain("service.geocoder");
    expect(noMember.supported).toBe(false);
    expect(noMember.reason).toBe("raw-member-missing");
  });

  it("descriptor() 暴露只读描述符，且条目 id / 描述 / engine 完整", () => {
    const registry = createCapabilityRegistry({
      engine: "jsapi-v4",
      version: "4.0",
      rawSdk: fullSdk,
      unsupported: "silent",
    });
    for (const id of CAPABILITY_IDS) {
      const descriptor = registry.descriptor(id);
      expect(descriptor, `${id} 缺少 descriptor`).toBeDefined();
      expect(descriptor?.id).toBe(id);
      expect(descriptor?.description.length).toBeGreaterThan(0);
      expect(descriptor?.engines.length).toBeGreaterThan(0);
      expect(CAPABILITY_FAMILIES).toContain(descriptor?.family);
      expect(CAPABILITY_STATUSES).toContain(descriptor?.status);
    }
    expect(CAPABILITY_IDS.length).toBe(new Set(CAPABILITY_IDS).size);
  });

  it("语义命名：id 前缀与 family 一致", () => {
    for (const id of CAPABILITY_IDS) {
      const prefix = (id as Capability).split(".")[0];
      expect(prefix).toBe(CAPABILITY_CATALOG[id].family);
    }
  });
});
