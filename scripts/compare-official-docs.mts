#!/usr/bin/env node
/**
 * 官方 React 文档站 vs 本库：组件面与 prop 面的差异对照（issue #141）
 *
 * ## 为什么要有这道脚本
 *
 * issue 要求「尽量对齐官方示例与目录」。但**官方文档站 ≠ 上游 SDK 声明**：
 * 官方 React 文档会把一些上游 `*Options.d.ts` 里**没有**的键列进 API 表
 * （实测 `Marker` 表里的 `opacity` / `color` / `rank` / `rotationOrigin` /
 * `shadow` / `baseZIndex` / `enableCollisionDetection` / `enableDraggingMap` /
 * `visible` 十项，上游 `overlay/MarkerOptions.d.ts` 全部查无此成员）。
 * 照着文档抄会**引入传了也不生效的 prop**——那正是本库一贯拒绝的「假支持」。
 *
 * 所以判据是**三者求交**，不是单看文档：
 *   官方文档 API 表 ∩ 上游 4.0.5 类型声明 ∩ 本库 `*Props`
 * 差集才叫缺口。
 *
 * ## 输入
 *
 * `--capture` 用系统 Chrome 走 CDP 抓取官方站点（hash 路由，服务端抓不到 404），
 * 结果落到 `.artifacts/official-docs.json` 供离线比对。抓取与比对分开，
 * 是为了让比对这一步在 CI / 本地都能反复跑而不必联网。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const ART = join(ROOT, ".artifacts");
const CAPTURE = join(ART, "official-docs.json");

/** 官方组件名 → 本库组件名（形态差异，逐条依据见 findings 文档）。 */
export const COMPONENT_ALIAS: Record<string, string> = {
  GeolocationControl: "LocationControl", // 官方 GeolocationControl ↔ 本库 LocationControl
  PointShapeLayer: "PointCollection", // 官方 PointShapeLayer ↔ 本库 PointCollection
};

/** 官方列为独立组件，本库以 prop 形态提供。 */
const PROP_SHAPED = new Set(["Icon"]); // 本库走 <Marker :icon>

/** 官方 React 库自有封装，上游 SDK 没有对应类。 */
const REACT_ONLY = new Set([
  "React-BMap", "SimpleInfoWindow", "RawOverlay", "RawControl", "ThreeLayer",
]);

/** 官方 API 表里那些其实是 React 事件回调 / 渲染数据的键，不是 SDK 构造项。 */
const EVENT_LIKE = /^on[A-Z]/;
const DATA_LIKE = new Set(["children", "node", "nodeT", "points", "style", "data", "content"]);

/** 官方组件名 → 文档站 slug。 */
export const SLUGS: Record<string, string> = {
  BMapProvider: "bmap-provider", Map: "map", Marker: "marker", Label: "label",
  Polyline: "polyline", Polygon: "polygon", Circle: "circle", Rectangle: "rectangle",
  BezierCurve: "bezier-curve", Prism: "prism", GroundOverlay: "ground-overlay",
  GroundPoint: "ground-point", PointCollection: "point-collection", InfoWindow: "info-window",
  Symbol: "symbol", Icon: "icon", IconSequence: "icon-sequence", CustomOverlay: "custom-overlay",
  Marker3D: "marker-3d", MapMask: "map-mask", SimpleInfoWindow: "simple-info-window",
  PlaceDetail: "place-detail-overlay", RawOverlay: "raw-overlay",
  NavigationControl: "navigation-control", NavigationControl3D: "navigation-control-3d",
  ScaleControl: "scale-control", OverviewMapControl: "overview-map-control",
  MapTypeControl: "map-type-control", CopyrightControl: "copyright-control",
  GeolocationControl: "geolocation-control", PanoramaControl: "panorama-control",
  ZoomControl: "zoom-control", CityListControl: "city-list-control",
  CustomControl: "custom-control", RawControl: "raw-control",
  GeoJSONLayer: "geojson-layer", DistrictLayer: "district-layer",
  TrafficLayer: "traffic-layer", FillLayer: "fill-layer", DOMLayer: "dom-layer",
  LineLayer: "line-layer", PointIconLayer: "point-icon-layer",
  PointShapeLayer: "point-shape-layer", PanoramaCoverageLayer: "panorama-coverage-layer",
  ThreeLayer: "three-layer", ContextMenu: "context-menu", Panorama: "panorama",
};

export const OFFICIAL_BASE = "https://lbs.baidu.com/jsapi/react/docs/#/component/";

/**
 * 上游类型包根。
 *
 * **必须挑版本号最大的那一份**：`node_modules/.pnpm/` 下会同时留着
 * `@baidumap+jsapi-v4-types@4.0.4_patch_…`（旧 npm 依赖的残留）与
 * `@baidumap+jsapi-v4-types@https+++codeload.github.com+…`（4.0.5 的 git 依赖）。
 * `find` 取第一个会稳定地拿到 4.0.4，于是把 4.0.5 才有的成员全报成「上游没有」——
 * 对照结论直接反了（第一版就跑出了 292 条假缺口）。
 */
export function upstreamRoot(): string | null {
  const base = join(ROOT, "node_modules/.pnpm");
  if (!existsSync(base)) return null;
  const candidates = readdirSync(base).filter((n) => n.startsWith("@baidumap+jsapi-v4-types@"));
  let best: { dir: string; version: string } | null = null;
  for (const dir of candidates) {
    const pkg = join(base, dir, "node_modules/@baidumap/jsapi-v4-types/package.json");
    if (!existsSync(pkg)) continue;
    const version = /"version"\s*:\s*"([^"]+)"/.exec(readFileSync(pkg, "utf8"))?.[1] ?? "0";
    if (!best || compareVersion(version, best.version) > 0) best = { dir, version };
  }
  return best ? join(base, best.dir, "node_modules/@baidumap/jsapi-v4-types") : null;
}

/** 语义化版本号比较（够用即可，只比数字段）。 */
function compareVersion(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number(n) || 0);
  const pb = b.split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** 读一个上游 `*Options.d.ts` 的成员名。 */
export function upstreamMembers(file: string): Set<string> | null {
  const root = upstreamRoot();
  if (!root) return null;
  const dir = file.split("/")[0]!;
  const name = file.split("/")[1]!;
  // `<Name>Options.d.ts` 是首选；部分官方类没有独立的 Options 文件（`IconSequence` 等），
  // 这时回落到类文件本身。
  const candidates = [join(root, dir, name), join(root, dir, name.replace(/Options\.d\.ts$/, ".d.ts"))];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const text = readFileSync(p, "utf8");
    const members = new Set([...text.matchAll(/^\s{4}([a-zA-Z]\w*)\??:/gm)].map((m) => m[1]!));
    if (members.size > 0) return members;
  }
  return null;
}

/**
 * 本库 `*Props` 接口的成员名，**跟随 `extends`**。
 *
 * 一层继承必须跟：`LineLayerProps` 自身只有 `data` / `style`，其余
 * （`crs` / `idKey` / `visible` / `opacity` / `minZoom` …）在
 * `NativeLayerCommonProps` 与 `NativeLayerPickOptions` 上。不跟就会把
 * 几十个真实存在的 prop 全报成缺口。
 */
/**
 * 收集**内联声明 props** 的 .vue 源码。
 *
 * 只有一半组件的 `*Props` 在 `types/components.ts`；`GeoJSONLayerProps` /
 * `DistrictLayerProps` / `DOMLayerProps` 等是内联在各自 `.vue` 的 `<script setup>` 里。
 * 不收这些，第一版把三个组件共 20 个真实存在的 prop 全报成缺口。
 */
function listComponentSources(): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".vue")) out.push(readFileSync(p, "utf8"));
    }
  };
  walk(join(ROOT, "packages/bmap-vue/src/components"));
  return out;
}

export function oursMembers(Comp: string, depth = 4): Set<string> {
  // **两处都要扫**。只读 `types/components.ts` 会漏掉一大半组件：`GeoJSONLayerProps` /
  // `DistrictLayerProps` / `DOMLayerProps` 等是**内联声明在各自 .vue 的 `<script setup>` 里**的
  // （`components/layers/*.vue`），不在那个文件。第一版因此把这三个组件的 20 个真实存在的
  // prop 全报成缺口——「报告误导人」比「没有报告」更糟。
  const src = [
    readFileSync(join(ROOT, "packages/bmap-vue/src/types/components.ts"), "utf8"),
    ...listComponentSources(),
  ].join("\n");
  const out = new Set<string>();
  if (depth < 0) return out;
  const i = src.indexOf(`export interface ${Comp}Props`);
  // 基础接口**不**都以 `Props` 结尾（`NativeLayerCommonProps` / `NativeLayerPickOptions` /
  // `NativeLayerStyle`），所以 `Comp + "Props"` 找不到时按 `Comp` 本身再找一次。
  const j = i === -1 ? src.indexOf(`export interface ${Comp} `) : i;
  if (j === -1) return out;
  const end = src.indexOf("\n}", j);
  const head = src.slice(j, end);
  for (const m of head.matchAll(/^\s{2}([a-zA-Z_]\w*)\??:/gm)) out.add(m[1]!);
  for (const m of head.matchAll(/extends\s+([\w\s,]+?)\s*\{/g)) {
    for (const base of m[1]!.split(",")) {
      const name = base.trim();
      if (name) for (const n of oursMembers(name, depth - 1)) out.add(n);
    }
  }
  return out;
}

/**
 * 官方 API 表里的 `onXxx` 是 **React 事件回调**，在本库对应 `defineEmits` 的事件名
 * （无 `on` 前缀），不是 prop。把它们算进「prop 缺口」会凭空报出几百条。
 */
const isEvent = (p: string): boolean => /^on[A-Z]/.test(p);

export interface ComponentDiff {
  official: string;
  mapped: string;
  coverage: "covered" | "prop-shaped" | "react-only" | "gap";
  /** 官方文档列了、但上游类型包没有的键（照抄会引入假支持）。 */
  docOnly: string[];
  /** 官方 ∩ 上游 ∩ 本库 求交后仍缺的键 —— 这才是真缺口。 */
  realGaps: string[];
}

export function compare(capture: Record<string, unknown>): ComponentDiff[] {
  const ourList = (JSON.parse(
    readFileSync(join(ROOT, "docs/.vitepress/component-index.json"), "utf8"),
  ) as { components: string[] }).components;

  const out: ComponentDiff[] = [];
  for (const [official, slug] of Object.entries(SLUGS)) {
    const mapped = COMPONENT_ALIAS[official] ?? official;
    const page = (capture[OFFICIAL_BASE + slug] ?? {}) as {
      tables?: { headers: string[]; rows: string[][] }[];
    };
    const table = page.tables?.[0];
    const docProps: string[] = [];
    if (table) {
      const hi = table.headers.findIndex((h) => /属性|props?/i.test(h));
      if (hi >= 0) {
        for (const r of table.rows) {
          const v = (r[hi] ?? "").trim().replace(/^`|`$/g, "");
          if (/^[a-zA-Z][\w-]*$/.test(v)) docProps.push(v);
        }
      }
    }
    const sdk = upstreamMembers(`${dirOf(slug)}/${upstreamFile(slug)}`) ?? new Set<string>();
    const mine = oursMembers(mapped);
    const covered = ourList.includes(mapped);
    // 官方文档 ∩ 上游声明 —— 只有两者都认的键才可能是「我们漏了」
    const realUpstream = docProps.filter(
      (p) => sdk.has(p) || EVENT_LIKE.test(p) || DATA_LIKE.has(p),
    );
    const docOnly = docProps.filter((p) => !realUpstream.includes(p));
    const realGaps = covered
      ? realUpstream.filter((p) => !isEvent(p) && !mine.has(p) && !mine.has(p.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())))
      : [];
    out.push({
      official,
      mapped,
      coverage:
        covered ? "covered"
        : PROP_SHAPED.has(official) ? "prop-shaped"
        : REACT_ONLY.has(official) ? "react-only"
        : "gap",
      docOnly,
      realGaps,
    });
  }
  return out;
}

const dirOf = (slug: string): string =>
  /layer|point-collection/.test(slug) ? "layer" : "overlay";

/**
 * 上游的**选项**声明文件，不是类声明文件。
 *
 * 第一版只找 `<Name>.d.ts`（类本身），于是 `MarkerOptions.d.ts` 里那 17 个成员
 * 一个都没被读到，全部落进 `docOnly`——对照结果直接反了（Marker 报「没有缺口」，
 * 真实缺口是 `anchor` 与 `enableMassClear`）。构造项在**类**文件、选项在
 * `*Options.d.ts`，这里要的是后者。
 */
function upstreamFile(slug: string): string {
  const base = slug.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  return `${base}Options.d.ts`;
}

function main(): number {
  if (process.argv.includes("--print-slugs")) {
    console.log(Object.entries(SLUGS).map(([n, s]) => OFFICIAL_BASE + s).join("\n"));
    return 0;
  }
  if (!existsSync(CAPTURE)) {
    console.error(
      "compare-official-docs: 缺 .artifacts/official-docs.json。\n" +
        "先跑抓取（走系统 Chrome 的 CDP，hash 路由抓不到）：\n" +
        "  node --experimental-strip-types scripts/capture-official-docs.mts",
    );
    return 1;
  }
  const diffs = compare(JSON.parse(readFileSync(CAPTURE, "utf8")));
  const gaps = diffs.filter((d) => d.coverage === "gap");
  const realGaps = diffs.flatMap((d) => d.realGaps.map((p) => `${d.mapped}.${p}`));
  console.log(
    `官方组件 ${diffs.length} · 已覆盖 ${diffs.filter((d) => d.coverage === "covered").length}` +
      ` · 未覆盖 ${diffs.length - diffs.filter((d) => d.coverage === "covered").length}`,
  );
  console.log(`未覆盖分类：`);
  for (const d of diffs.filter((x) => x.coverage !== "covered")) {
    console.log(`  ${d.official.padEnd(22)} ${d.coverage}`);
  }
  console.log(`\n官方文档列了但上游声明没有（照抄=假支持，不补）：${diffs.reduce((a, d) => a + d.docOnly.length, 0)} 项`);
  console.log(`三方求交后仍缺（真缺口）：${realGaps.length} 项`);
  for (const g of realGaps) console.log(`  ${g}`);
  mkdirSync(ART, { recursive: true });
  writeFileSync(join(ART, "official-diff.json"), JSON.stringify(diffs, null, 1));
  return 0;
}

process.exitCode = main();
