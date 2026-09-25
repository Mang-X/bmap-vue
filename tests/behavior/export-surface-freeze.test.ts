/**
 * 1.0 Freeze：根入口与子入口的**精确导出面**（issue #44「冻结范围」1 + 验收项）
 *
 * 这是「冻结」的载体：本文件把 `.` / `./components` / `./composables` / `./plugins` /
 * `./resolver` 的**值导出集合**写死成登记清单，任何增删都会让用例变红，从而把改动逼成
 * 「显式改门禁」而不是「顺手多导出一个」。冻结之后只允许 blocker 修。
 *
 * 三个入口各有自己的门禁，本文件**不重复它们的清单**（两份字面量迟早会漂移）：
 * - `./advanced` → `tests/behavior/advanced-contract.test.ts`（25 个值导出的冻结 + 双向边界）
 * - `./ui-kit`   → `tests/behavior/ui-kit-entry.test.ts`（四个组件 + 桥 + 加载器的导出面）
 * - `./core`     → 已随 #44 **取消**；「它没有被加回来」由 `core-surface.test.ts` 的包级前提守
 *
 * `./components` 刻意**不写字面量**：它是从 `componentManifest` 生成的（`src/components/index.ts`），
 * 再抄一份清单就等于给「Manifest 是唯一组件元数据源」造了第二处事实源。组件面的冻结因此由
 * 「等于 manifest」表达 —— 加组件 = 改 manifest + 重新生成，本文件不需要动。
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as root from "../../packages/bmap-vue/src";
import * as components from "../../packages/bmap-vue/src/components/index";
import * as composables from "../../packages/bmap-vue/src/composables/index";
import * as plugins from "../../packages/bmap-vue/src/plugins/index";
import * as resolver from "../../packages/bmap-vue/src/resolver/index";
import * as uiKit from "../../packages/bmap-vue/src/integrations/ui-kit/index";
import { componentManifest } from "../../packages/bmap-vue/src/manifest";

const PKG_DIR = resolve(import.meta.dirname, "../../packages/bmap-vue");
const DIST = resolve(PKG_DIR, "dist");

/** 冻结的值导出面：键是 `package.json#exports` 的子路径。 */
const FROZEN_EXPORTS: Readonly<Record<string, readonly string[]>> = {
  ".": [
  "Autocomplete",
  "BMAP_COMPONENT_EVENT_CATALOG",
  "BMapProvider",
  "BMapResolver",
  "BUILTIN_PLUGIN_CATALOG",
  "BUILTIN_PLUGIN_NAMES",
  "BUILTIN_PLUGIN_URLS",
  "BezierCurve",
  "Circle",
  "CityListControl",
  "ContextMenu",
  "CoordinatesFromType",
  "CoordinatesToType",
  "CopyrightControl",
  "CustomControl",
  "CustomOverlay",
  "DOMLayer",
  "DistrictLayer",
  "DistrictType",
  "DrivingPolicy",
  "FillLayer",
  "GeoJSONLayer",
  "GroundOverlay",
  "HeatmapLayer",
  "InfoWindow",
  "IntercityPolicy",
  "Label",
  "LineLayer",
  "LocationControl",
  "MAP_EVENT_CATALOG",
  "MAP_EVENT_EMIT_ALIASES",
  "MAP_EVENT_NAMES",
  "MAP_SUSPEND_REASONS",
  "MVTLayer",
  "Map",
  "MapMask",
  "MapTypeControl",
  "Marker",
  "Marker3D",
  "MarkerCluster",
  "MarkerList",
  "MenuItem",
  "MenuSeparator",
  "NavigationControl",
  "NavigationControl3D",
  "OVERLAY_EVENT_MATRIX",
  "OVERLAY_KINDS_WITHOUT_EVENT_MATRIX",
  "OverviewMapControl",
  "Panorama",
  "PanoramaControl",
  "PanoramaCoverageLayer",
  "PanoramaLabel",
  "PointCollection",
  "PointIconLayer",
  "PointLayer",
  "Polygon",
  "Polyline",
  "Prism",
  "RasterTileLayer",
  "Rectangle",
  "ResourceScope",
  "ScaleControl",
  "TileLayer",
  "TrackLineLayer",
  "TrafficLayer",
  "TransitPolicy",
  "TransitVehiclePolicy",
  "WMSLayer",
  "WMTSLayer",
  "XYZLayer",
  "ZoomControl",
  "bmapClientContextKey",
  "bmapConfigKey",
  "createBMapClientDefinition",
  "createBMapPlugin",
  "createClientContext",
  "defaultClientDefinitionKey",
  "drawingManagerPlugin",
  "dynamicEmit",
  "geoUtilsPlugin",
  "mapVglPlugin",
  "mvtFeatureStateKey",
  "normalizeEventKey",
  "overlayEventOf",
  "overlayEventsOf",
  "overlayPointerFallback",
  "resolveMapContext",
  "resolveMapEventName",
  "resolvePluginDefinition",
  "stringToPluginDefinitions",
  "targetContextKey",
  "toSdkEventName",
  "toVueEventName",
  "trackAnimationPlugin",
  "urlPluginDefinition",
  "useAreaBoundary",
  "useControllableState",
  "useConvertor",
  "useDrivingRoute",
  "useGeocodeDetail",
  "useGeocoder",
  "useGeolocation",
  "useIpLocation",
  "useLocalSearch",
  "useMap",
  "useMapContext",
  "useMapEvent",
  "useMapReady",
  "useMapStatus",
  "useMarkerIcons",
  "useOptionalClientContext",
  "useOverlaySpec",
  "usePanoramaService",
  "useParentOverlayHandle",
  "useRequiredClientContext",
  "useRidingRoute",
  "useSdkResource",
  "useTransitRoute",
  "useViewAnimation",
  "useWalkingRoute",
  ],
  "./composables": [
  "CoordinatesFromType",
  "CoordinatesToType",
  "resolveMapContext",
  "useAreaBoundary",
  "useControllableState",
  "useConvertor",
  "useDrivingRoute",
  "useGeocodeDetail",
  "useGeocoder",
  "useGeolocation",
  "useIpLocation",
  "useLocalSearch",
  "useMap",
  "useMapContext",
  "useMapEvent",
  "useMapReady",
  "useMapStatus",
  "useMarkerIcons",
  "usePanoramaService",
  "useRidingRoute",
  "useTransitRoute",
  "useViewAnimation",
  "useWalkingRoute",
  ],
  "./plugins": [
  "BUILTIN_PLUGIN_CATALOG",
  "BUILTIN_PLUGIN_NAMES",
  "BUILTIN_PLUGIN_URLS",
  "PLUGIN_COMPAT_BY_ID",
  "PLUGIN_COMPAT_INVENTORY",
  "PLUGIN_EVIDENCE_BASIS_MEANING",
  "PLUGIN_VERDICTS",
  "PLUGIN_VERDICT_MEANING",
  "bmapConfigKey",
  "createBMapPlugin",
  "createPluginHost",
  "disposeDefaultPluginHost",
  "drawingManagerPlugin",
  "geoUtilsPlugin",
  "getDefaultPluginHost",
  "mapVglPlugin",
  "resolvePluginDefinition",
  "stringToPluginDefinitions",
  "trackAnimationPlugin",
  "urlPluginDefinition",
  ],
  "./resolver": [
  "BMapResolver",
  ],
};

const ENTRY_MODULES: Readonly<Record<string, Record<string, unknown>>> = {
  ".": root as unknown as Record<string, unknown>,
  "./components": components as unknown as Record<string, unknown>,
  "./composables": composables as unknown as Record<string, unknown>,
  "./plugins": plugins as unknown as Record<string, unknown>,
  "./resolver": resolver as unknown as Record<string, unknown>,
};

const sorted = (names: readonly string[]): string[] => [...names].sort();

/** 失效信息里列出**差异**（新增 / 消失），比一个巨大的 toEqual 更能定位。 */
function diff(actual: readonly string[], expected: readonly string[]): string {
  const a = new Set(actual);
  const e = new Set(expected);
  const added = actual.filter((n) => !e.has(n));
  const removed = expected.filter((n) => !a.has(n));
  const parts: string[] = [];
  if (added.length) parts.push(`多出: ${added.join(", ")}`);
  if (removed.length) parts.push(`缺失: ${removed.join(", ")}`);
  return parts.join("；") || "（集合相同但顺序不同 —— 本清单应保持升序）";
}

describe("1.0 导出面冻结", () => {
  it("登记的每个入口：值导出集合与清单逐个相等（增删都要显式改本文件）", () => {
    for (const [entry, expected] of Object.entries(FROZEN_EXPORTS)) {
      const actual = sorted(Object.keys(ENTRY_MODULES[entry]));
      expect(actual, `${entry} 导出面漂移 —— ${diff(actual, sorted(expected))}`).toEqual(
        sorted(expected),
      );
    }
  });

  it("./components 完全等于 componentManifest（Manifest 是唯一组件元数据源）", () => {
    const fromManifest = sorted(componentManifest.map((c) => c.exportName));
    const actual = sorted(Object.keys(components));
    expect(actual, `与 manifest 不一致 —— ${diff(actual, fromManifest)}`).toEqual(fromManifest);
    // 同名两次出现说明 manifest 自己就有重复项，上面的集合断言会因此掩盖它。
    expect(
      componentManifest.length,
      "componentManifest 有重复的 exportName",
    ).toBe(new Set(componentManifest.map((c) => c.exportName)).size);
  });

  it("子入口是根入口的视图：组件与 composable 全部可从根入口拿到", () => {
    const rootNames = new Set(Object.keys(root));
    for (const [entry, module] of [
      ["./components", components],
      ["./composables", composables],
    ] as const) {
      const missing = Object.keys(module).filter((n) => !rootNames.has(n));
      expect(missing, `${entry} 里有名字不在根入口: ${missing.join(", ")}`).toEqual([]);
    }
  });

  it("根入口不导出 UI Kit 任何名字（basic path 不静态拉 UI Kit 的第一道防线）", () => {
    const rootNames = new Set(Object.keys(root));
    const leaked = Object.keys(uiKit).filter((n) => rootNames.has(n));
    expect(leaked, `根入口泄漏了 UI Kit 导出: ${leaked.join(", ")}`).toEqual([]);
    // 正证：判定式必须读得到 ui-kit 的导出，否则上面那条会静默恒真。
    expect(Object.keys(uiKit).length).toBeGreaterThan(0);
  });

  it("package.json#exports 声明的每个入口都有 dist 产物（mjs + d.ts）", () => {
    const pkg = JSON.parse(readFileSync(resolve(PKG_DIR, "package.json"), "utf8")) as {
      exports?: Record<string, string | { import?: string; types?: string }>;
    };
    const entries = Object.keys(pkg.exports ?? {}).filter((k) => k !== "./package.json");
    expect(entries.length, "exports 里一个子路径都没有").toBeGreaterThan(0);
    for (const entry of entries) {
      const spec = pkg.exports![entry];
      const importPath = typeof spec === "string" ? spec : spec.import;
      const typesPath = typeof spec === "string" ? undefined : spec.types;
      expect(importPath, `${entry} 没有 import 出口`).toMatch(/^\.\/dist\/.+\.mjs$/);
      expect(existsSync(resolve(PKG_DIR, importPath!)), `产物缺失: ${importPath}`).toBe(true);
      if (typesPath) {
        expect(existsSync(resolve(PKG_DIR, typesPath)), `声明缺失: ${typesPath}`).toBe(true);
      }
    }
    // 正证：产物计数与入口数一致 —— 只断言「声明的都在」会漏掉「多构建了一个入口」。
    const dtsCount = readdirSync(DIST).filter((f) => f.endsWith(".d.ts")).length;
    expect(dtsCount).toBe(entries.length);
  });
});
