/**
 * Capability Catalog 契约测试（M3A0-06 / issue #15）
 *
 * `packages/**\/*.test.ts` 不在 `pnpm test:unit` 的路径过滤内，因此在 behavior 层
 * 固定 CI 可见的契约：
 * - Catalog 覆盖 Map / Overlay / Layer / Service / Panorama 五个 family；
 * - 能表达 native / extended / experimental / unsupported 四种状态；
 * - runtime-only 能力被标注；
 * - override / require / supports 与 unsupported 策略语义稳定；
 * - 能力矩阵由 catalog 数据生成且无漂移。
 */
import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CAPABILITY_CATALOG,
  CAPABILITY_FAMILIES,
  CAPABILITY_IDS,
  CAPABILITY_STATUSES,
  createCapabilityRegistry,
  UnsupportedCapabilityError,
  type Capability,
} from "../../packages/bmap-vue/src/driver/capability";

const ROOT = resolve(import.meta.dirname, "../..");
const MATRIX_MD = resolve(ROOT, "docs/zh-CN/contributing/capability-matrix.md");
const MATRIX_JSON = resolve(ROOT, "docs/.vitepress/capability-catalog.json");

const FULL_SDK = {
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

const baseRegistry = (overrides?: Partial<Record<Capability, boolean>>) =>
  createCapabilityRegistry({
    engine: "jsapi-v4",
    version: "4.0",
    rawSdk: FULL_SDK,
    unsupported: "silent",
    overrides,
  });

describe("Capability Catalog 结构与状态", () => {
  it("覆盖 Map / Overlay / Layer / Service / Panorama 五个 family", () => {
    for (const family of CAPABILITY_FAMILIES) {
      const entries = CAPABILITY_IDS.filter((id) => CAPABILITY_CATALOG[id].family === family);
      expect(entries.length, `family ${family} 应至少有一个能力`).toBeGreaterThan(0);
    }
  });

  it("能表达 native / extended / experimental / unsupported 四种状态", () => {
    const statuses = new Set(CAPABILITY_IDS.map((id) => CAPABILITY_CATALOG[id].status));
    for (const status of CAPABILITY_STATUSES) {
      expect(statuses.has(status), `缺少状态 ${status}`).toBe(true);
    }
  });

  it("每条描述符 id / 描述 / family / status 完整且 id 唯一（#126：engines 维度已删除）", () => {
    expect(CAPABILITY_IDS.length).toBe(new Set(CAPABILITY_IDS).size);
    for (const id of CAPABILITY_IDS) {
      const descriptor = CAPABILITY_CATALOG[id];
      expect(descriptor.id).toBe(id);
      expect(descriptor.description.length).toBeGreaterThan(0);
      expect(descriptor).not.toHaveProperty("engines");
      expect(CAPABILITY_FAMILIES).toContain(descriptor.family);
      expect(CAPABILITY_STATUSES).toContain(descriptor.status);
    }
  });

  it("语义命名：id 前缀与 family 一致", () => {
    for (const id of CAPABILITY_IDS) {
      const prefix = id.split(".")[0];
      expect(prefix).toBe(CAPABILITY_CATALOG[id].family);
    }
  });

  it("runtime-only 能力被标注，可静态探测的构造器不被误标", () => {
    expect(CAPABILITY_CATALOG["map.check-resize"].runtimeOnly).toBe(true);
    expect(CAPABILITY_CATALOG["overlay.point-collection"].runtimeOnly).toBe(true);
    expect(CAPABILITY_CATALOG["layer.panorama-coverage"].runtimeOnly).toBe(true);
    expect(CAPABILITY_CATALOG["overlay.marker"].runtimeOnly).toBe(false);
    expect(CAPABILITY_CATALOG["service.geocoder"].runtimeOnly).toBe(false);
  });
});

describe("Capability override / supports / require / unsupported 策略", () => {
  it("supports 结合目录收录与 raw member 探测", () => {
    const registry = baseRegistry();
    expect(registry.supports("overlay.marker")).toBe(true);
    expect(registry.supports("map.check-resize")).toBe(true);
    expect(registry.explain("service.geocoder").reason).toBe("supported");
  });

  it("目录未收录的 id 以 unlisted-capability 拒绝（#126：engines 维度删除后的唯一拒绝路径）", () => {
    const registry = createCapabilityRegistry({
      engine: "jsapi-v4",
      version: "4.0",
      rawSdk: FULL_SDK,
      unsupported: "silent",
    });
    // #26 删除旧引擎、`#126` 删除 engines 维度后，「能力目录没有这条 id」是唯一的
    // 「已知能力但不归本目录管」拒绝理由；名字与这条唯一可达路径一致。
    expect(registry.supports("does.not-exist" as Capability)).toBe(false);
    expect(registry.explain("does.not-exist" as Capability).reason).toBe("unlisted-capability");
  });

  it("raw member 缺失时报告 raw-member-missing", () => {
    const registry = createCapabilityRegistry({
      engine: "jsapi-v4",
      version: "4.0",
      rawSdk: { Map: class {} },
      unsupported: "silent",
    });
    const explanation = registry.explain("service.geocoder");
    expect(explanation.supported).toBe(false);
    expect(explanation.reason).toBe("raw-member-missing");
  });

  it("status=unsupported 恒不支持，但可被 override 覆盖", () => {
    const unsupportedIds = CAPABILITY_IDS.filter(
      (id) => CAPABILITY_CATALOG[id].status === "unsupported",
    );
    expect(unsupportedIds.length).toBeGreaterThan(0);

    const registry = createCapabilityRegistry({
      engine: "jsapi-v4",
      version: "4.0",
      rawSdk: FULL_SDK,
      unsupported: "silent",
    });
    for (const id of unsupportedIds) {
      expect(registry.supports(id), `${id} 应不支持`).toBe(false);
      expect(registry.explain(id).reason).toBe("status-unsupported");
    }

    const overridden = baseRegistry({ "overlay.mapvgl": true, "overlay.marker": false });
    expect(overridden.supports("overlay.mapvgl")).toBe(true);
    expect(overridden.explain("overlay.mapvgl").reason).toBe("overridden");
    expect(overridden.supports("overlay.marker")).toBe(false);
  });

  it("require() 按 throw / warn / silent 策略处理", () => {
    const throwing = createCapabilityRegistry({
      engine: "jsapi-v4",
      version: "4.0",
      rawSdk: FULL_SDK,
      unsupported: "throw",
    });
    expect(() => throwing.require("overlay.mapvgl")).toThrow(UnsupportedCapabilityError);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const warning = createCapabilityRegistry({
      engine: "jsapi-v4",
      version: "4.0",
      rawSdk: FULL_SDK,
      unsupported: "warn",
    });
    expect(() => warning.require("overlay.mapvgl")).not.toThrow();
    warn.mockRestore();

    const silent = baseRegistry();
    expect(() => silent.require("overlay.mapvgl")).not.toThrow();
  });

  it("list() 只返回目录已收录且 SDK 实际支持的能力", () => {
    const listed = baseRegistry().list();
    expect(listed).toContain("overlay.marker");
    expect(listed).toContain("service.geocoder");
    // status=unsupported 的条目不出现在可用列表
    expect(listed).not.toContain("overlay.mapvgl");
    expect(listed).not.toContain("service.track-animation");
    expect(listed.every((id) => CAPABILITY_IDS.includes(id))).toBe(true);
    expect(listed.length).toBeLessThan(CAPABILITY_IDS.length);
  });
});

describe("能力矩阵由 Catalog 数据生成", () => {
  it("catalog 数据可由脚本生成矩阵且无漂移", () => {
    const script = resolve(ROOT, "scripts/generate-capability-matrix.mts");
    expect(() =>
      execFileSync(process.execPath, ["--experimental-strip-types", script, "--check"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    ).not.toThrow();
  });

  it("生成产物包含全部能力且带 Generated 标记", () => {
    expect(existsSync(MATRIX_MD)).toBe(true);
    expect(existsSync(MATRIX_JSON)).toBe(true);

    const markdown = readFileSync(MATRIX_MD, "utf8");
    expect(markdown).toContain("Generated file. Do not edit directly.");
    for (const id of CAPABILITY_IDS) {
      expect(markdown, `矩阵缺少 ${id}`).toContain(`\`${id}\``);
    }

    const json = JSON.parse(readFileSync(MATRIX_JSON, "utf8")) as {
      capabilities: { id: string }[];
    };
    expect(json.capabilities.map((c) => c.id).sort()).toEqual([...CAPABILITY_IDS].sort());
  });
});
