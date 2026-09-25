#!/usr/bin/env node
/**
 * #135: 生成「本库公开 API × 官方 React 参考」对照表
 *
 * 对照物（维护者改口后的单一参考，不是开发中的 @baidumap/vue-bmap）：
 * - `scripts/api-diff/official-react-bmap-2.0.6.json` —— `@baidumap/react-bmap@2.0.6` 的导出清单
 *   （由官方仓库 commit `fde5bbd3e5b4` 抽取；刷新方式见文末「刷新官方清单」）。
 *
 * 本库侧的公开面**不读 dist**（避免先 build 才能 check）：
 * - 组件：`packages/bmap-vue/src/manifest.ts` 的 `componentManifest`
 * - 根 / composables / ui-kit：解析入口 barrel 的 `export {…}` / `export * from`（一层可跟随）
 *
 * 生成（无时间戳，稳定可 diff）：
 * - `docs/zh-CN/contributing/official-api-alignment.md`
 * - `docs/.vitepress/official-api-alignment.json`
 *
 * 用法：
 *   node --experimental-strip-types scripts/generate-api-diff.mts
 *   node --experimental-strip-types scripts/generate-api-diff.mts --check
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { freshModuleUrl } from "./fresh-module-url.mts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

const OFFICIAL_JSON = resolve(root, "scripts/api-diff/official-react-bmap-2.0.6.json");
const MD_PATH = resolve(root, "docs/zh-CN/contributing/official-api-alignment.md");
const JSON_PATH = resolve(root, "docs/.vitepress/official-api-alignment.json");

const PKG_SRC = resolve(root, "packages/bmap-vue/src");

// ─── 官方清单 ────────────────────────────────────────────────────────────────

interface OfficialExport {
  name: string;
  file?: string;
  from?: string;
  kind?: string;
}

interface OfficialInventory {
  package: string;
  version: string;
  commit: string;
  source: string;
  note?: string;
  exports: OfficialExport[];
}

const official = JSON.parse(readFileSync(OFFICIAL_JSON, "utf8")) as OfficialInventory;

/** 官方**根入口** `src/index.ts` 上的重导出（公共面口径）。 */
const officialPublic = new Map<string, { from?: string }>();
for (const e of official.exports) {
  if (e.file !== "src/index.ts") continue;
  const prev = officialPublic.get(e.name);
  if (!prev || (!prev.from && e.from)) officialPublic.set(e.name, { from: e.from });
}

// 官方 kind：定义文件上的 kind（interface/type/function/const）
const officialKind = new Map<string, string>();
for (const e of official.exports) {
  if (!e.kind) continue;
  if (!officialKind.has(e.name)) officialKind.set(e.name, e.kind);
}

// ─── 本库公开面 ──────────────────────────────────────────────────────────────

const { componentManifest } = (await import(freshModuleUrl(resolve(PKG_SRC, "manifest.ts")))) as {
  componentManifest: { name: string; exportName: string; source: string; category?: string }[];
};

/** 从一段 TS 源里抠出直接导出的名字（含 `export type {…}` / `export {a as b}`）。 */
function parseNamedExports(source: string): Set<string> {
  const out = new Set<string>();
  for (const m of source.matchAll(/export\s+(?:type\s+)?\{([^}]+)\}(?:\s*from\s*["'][^"']+["'])?/g)) {
    for (let part of m[1].split(",")) {
      part = part.trim();
      if (!part) continue;
      part = part.replace(/^type\s+/, "");
      if (part.includes(" as ")) part = part.split(" as ").pop()!.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(part)) out.add(part);
    }
  }
  for (const m of source.matchAll(
    /export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function|class|enum|interface|type)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    out.add(m[1]);
  }
  return out;
}

/** 跟随 `export * from "./x"`（相对说明符，尝试 .ts / /index.ts）。 */
function resolveStarExports(file: string, seen = new Set<string>()): Set<string> {
  const abs = resolve(file);
  if (seen.has(abs) || !existsSync(abs)) return new Set();
  seen.add(abs);
  const source = readFileSync(abs, "utf8");
  const names = parseNamedExports(source);
  for (const m of source.matchAll(/export\s+\*\s+from\s+["']([^"']+)["']/g)) {
    const spec = m[1];
    if (!spec.startsWith(".")) continue;
    const base = resolve(dirname(abs), spec);
    const candidates = [
      base,
      `${base}.ts`,
      `${base}/index.ts`,
      base.replace(/\.vue$/, ""),
    ];
    for (const c of candidates) {
      if (existsSync(c) && c.endsWith(".ts") && !seen.has(resolve(c))) {
        for (const n of resolveStarExports(c, seen)) names.add(n);
        break;
      }
    }
  }
  return names;
}

function loadEntryBarrel(rel: string): Set<string> {
  const abs = resolve(PKG_SRC, rel);
  if (!existsSync(abs)) return new Set();
  return resolveStarExports(abs);
}

const oursComponents = new Set(componentManifest.map((c) => c.exportName));
const oursRoot = loadEntryBarrel("index.ts");
const oursUiKit = loadEntryBarrel("integrations/ui-kit/index.ts");
const oursComposables = loadEntryBarrel("composables/index.ts");

/** 根入口 = index 直接导出 ∪ components barrel ∪ composables barrel（与 `export *` 语义一致）。 */
const oursPublic = new Set<string>([
  ...oursRoot,
  ...oursComponents,
  ...oursComposables,
]);
// ui-kit 是独立子路径，单独一栏；不并进根入口（ADR：根不重导出 UI）。

// ─── 分类 ────────────────────────────────────────────────────────────────────

type Surface = "component" | "hook" | "constant" | "type" | "other";

function classifyOfficial(name: string): Surface {
  if (name.startsWith("BMAP_")) return "constant";
  if (/^use[A-Z]/.test(name)) return "hook";
  const from = officialPublic.get(name)?.from ?? "";
  const kind = officialKind.get(name);
  if (from.startsWith("./components/") || from.startsWith("./provider/")) {
    if (kind === "interface" || kind === "type") return "type";
    return "component";
  }
  if (kind === "interface" || kind === "type") return "type";
  if (name.endsWith("Props") || name.endsWith("Options") || name.endsWith("Result") || name.endsWith("Ref")) {
    return "type";
  }
  if (name[0] === name[0].toUpperCase() && !name.startsWith("BMAP_") && kind === "function") return "hook";
  if (name[0] === name[0].toUpperCase()) {
    // 无 kind 的 PascalCase：倾向 component（官方清单里组件多为 const）
    if (kind === "const") return "component";
    if (kind === "function" && from.startsWith("./hooks")) return "hook";
    if (kind === "function") return "component";
    return "type";
  }
  return "other";
}

function classifyOurs(name: string): Surface {
  if (oursComponents.has(name)) return "component";
  if (oursUiKit.has(name) && name[0] === name[0].toUpperCase() && !name.endsWith("Props") && !name.endsWith("DTO")) {
    // ui-kit 运行时组件
    if (/^[A-Z][A-Za-z0-9]+$/.test(name) && !name.endsWith("Options")) {
      const kindLooksType = name.endsWith("DTO") || name.endsWith("Type") || name.endsWith("Mode");
      if (!kindLooksType) return "component";
    }
  }
  if (/^use[A-Z]/.test(name)) return "hook";
  if (name.startsWith("BMAP_")) return "constant";
  if (
    name.endsWith("Props") ||
    name.endsWith("Options") ||
    name.endsWith("Result") ||
    name.endsWith("Event") ||
    name.endsWith("Context") ||
    name.endsWith("Handle") ||
    name.endsWith("Status") ||
    name.endsWith("Payload") ||
    name.endsWith("Matrix") ||
    name.endsWith("Catalog")
  ) {
    return "type";
  }
  return "other";
}

// ─── 对照 ────────────────────────────────────────────────────────────────────

/** 语义例外 / 有意不镜像（手写；生成器只渲染，不推断这些理由）。 */
interface Exception {
  ours: string | null;
  official: string | null;
  kind: "renamed" | "official-only" | "ours-only" | "semantic";
  note: string;
}

const EXCEPTIONS: Exception[] = [
  {
    ours: "MapExpose",
    official: "MapRef",
    kind: "renamed",
    note: "官方叫 `MapRef`；本库 expose 面是 `createExpose()` 拼出的只读命令集，命名对齐组件而非 ref 类型别名。",
  },
  {
    ours: "useMapContext",
    official: "useBMapContext",
    kind: "renamed",
    // 品牌门禁（`check:docs-brand`）的逐行豁免**必须由生成器写进 note**：本文件是生成物，
    // 手写在 .md 上的豁免会在下一次 `pnpm generate:api-diff` 时被覆盖掉，两道门禁就会互相打架。
    note: "官方仍保留 `useBMapContext`；#135 将 hooks 统一去 `BMap` 前缀，与 `useMap` / `Map` 组件一致。 <!-- brand-gate:allow 对照表必须引用官方 React 的现行名，这一列就是被对照的一方 -->",
  },
  {
    ours: "useAreaBoundary",
    official: "useBoundary",
    kind: "renamed",
    note: "官方叫 `useBoundary`；本库语义是「行政区域边界」（AreaBoundary），与 `BoundaryResult` 成对。",
  },
  {
    ours: "Autocomplete",
    official: null,
    kind: "ours-only",
    note: "官方只有 `useAutocomplete` hook，没有同名组件；本库有声明式 `<Autocomplete>` 薄封装。",
  },
  {
    ours: "MarkerCluster",
    official: null,
    kind: "ours-only",
    note: "官方 React 封装没有聚合组件（参考清单 0 命中）。",
  },
  {
    ours: "MarkerList",
    official: null,
    kind: "ours-only",
    note: "官方没有 `MarkerList`；本库数据组件。",
  },
  {
    ours: null,
    official: "useMapRef",
    kind: "official-only",
    note: "官方专用 ref hook；本库等价路径是 `<Map>` ref + `MapExpose`（不另设 `useMapRef`）。",
  },
  {
    ours: null,
    official: "useCapabilities",
    kind: "official-only",
    note: "官方 capability 读取 hook；本库能力目录在 `CAPABILITY_*` / `advanced` 入口，不镜像该 hook。",
  },
  {
    ours: null,
    official: "useDriver",
    kind: "official-only",
    note: "官方 driver 逃生 hook；本库逃生口是 `./advanced` 的 `createJsapiV4Driver` / `unwrapRaw`。",
  },
  {
    ours: null,
    official: "BMapErrorBoundary",
    kind: "official-only",
    note: "React error boundary 形态；Vue 对应物是插件级错误上报，不提供同名组件。",
  },
  {
    ours: null,
    official: "PlaceDetail",
    kind: "official-only",
    note: "官方根入口的详情面板；本库在 `bmap-vue/ui-kit` 子路径（根入口不碰 optional peer）。",
  },
  {
    ours: "PlaceSearch",
    official: null,
    kind: "ours-only",
    note: "标准 UI 在 `./ui-kit` 子路径；官方 React 根清单未导出同名组件（它用 `RoutePlan` 类型名占位）。",
  },
  // ── 残留 `BMap*` 类型 / 注入键：#135 清的是组件与 hook 名，不是 Driver/Client 领域类型 ──
  {
    ours: "BMapClient",
    official: null,
    kind: "ours-only",
    note: "Client 句柄类型；官方无同名导出。#135 只对齐组件 / hook / 基础类型名，不镜像本库 Client 面。",
  },
  {
    ours: "BMapClientContext",
    official: null,
    kind: "ours-only",
    note: "Client 注入上下文；官方无同名导出。保留 `BMap*` 前缀以区别于地图实例上下文。",
  },
  {
    ours: "BMapDriverFactory",
    official: null,
    kind: "ours-only",
    note: "Driver 工厂类型；#135 不把 raw-SDK 边界类型改名（会与 `BMapDriver` 断开）。",
  },
  {
    ours: "BMapDriverInput",
    official: null,
    kind: "ours-only",
    note: "Driver 构造入参；同上，raw-SDK 边界类型保留 `BMap*`。",
  },
  {
    ours: "BMapEngine",
    official: null,
    kind: "ours-only",
    note: "引擎 id 判别类型（`\"jsapi-v4\"`）；官方无对应导出。",
  },
  {
    ours: "BMapDrivingRouteOptions",
    official: null,
    kind: "ours-only",
    note: "路线服务选项；官方 hook 选项形态不同，不镜像同名 type。",
  },
  {
    ours: "BMapRidingRouteOptions",
    official: null,
    kind: "ours-only",
    note: "骑行路线选项；同上。",
  },
  {
    ours: "BMapWalkingRouteOptions",
    official: null,
    kind: "ours-only",
    note: "步行路线选项；同上。",
  },
  {
    ours: "BMapTransitRouteOptions",
    official: null,
    kind: "ours-only",
    note: "公交路线选项；同上。",
  },
  {
    ours: "BMapGeolocationOptions",
    official: null,
    kind: "ours-only",
    note: "定位选项；官方 hook 不导出同名 options。",
  },
  {
    ours: "BMapGeoResult",
    official: null,
    kind: "ours-only",
    note: "地理编码结果 DTO；官方无同名 type。",
  },
  {
    ours: "BMapIpLocationResult",
    official: null,
    kind: "ours-only",
    note: "IP 定位结果 DTO；官方无同名 type。",
  },
  {
    ours: "BMapLocalSearchOptions",
    official: null,
    kind: "ours-only",
    note: "本地检索 options；本库 service 层独立状态机，官方无同名 type。",
  },
  {
    ours: "BMapLocalSearchRenderOptions",
    official: null,
    kind: "ours-only",
    note: "本地检索绘制 options；同上。",
  },
  {
    ours: "BMapLocalSearchOperation",
    official: null,
    kind: "ours-only",
    note: "本地检索在飞操作标识；#104 归属模型的一部分，官方无对应。",
  },
  {
    ours: "BMapServiceStatus",
    official: null,
    kind: "ours-only",
    note: "服务状态口径（`idle`/`loading`/…）；ADR 2026-09-14 单一事实源，不改名以免与 `ServiceCallStatus` 混淆。",
  },
  {
    ours: "BMapPluginConfig",
    official: null,
    kind: "ours-only",
    note: "插件配置；官方无同名导出。",
  },
  {
    ours: "BMapProviderLike",
    official: null,
    kind: "ours-only",
    note: "Provider 结构类型；与组件 `BMapProvider` 成对，官方根 barrel 无同名 type。",
  },
  {
    ours: "CreateBMapClientOptions",
    official: null,
    kind: "ours-only",
    note: "`createBMapClient` 入参；Client 装配面不在 #135 组件 / hook 对齐范围。",
  },
  {
    ours: "CreateBMapPluginOptions",
    official: null,
    kind: "ours-only",
    note: "`createBMapPlugin` 入参；插件装配面不在 #135 组件 / hook 对齐范围。",
  },
  {
    ours: "bmapClientContextKey",
    official: null,
    kind: "ours-only",
    note: "Client 上下文 InjectionKey；Vue DI 键，官方 React 无对应。",
  },
  {
    ours: "bmapConfigKey",
    official: null,
    kind: "ours-only",
    note: "插件配置 InjectionKey；同上。",
  },
  {
    ours: null,
    official: "BMapContextValue",
    kind: "official-only",
    note: "官方 React context value 类型；Vue 对应是 `useMapContext` 返回面 / `MapContext*`。",
  },
  {
    ours: null,
    official: "BMapEvent",
    kind: "official-only",
    note: "官方事件对象类型；本库 typed emits + `MapComponentEvent*` 矩阵。",
  },
  {
    ours: null,
    official: "BMapVersion",
    kind: "official-only",
    note: "官方 SDK 版本类型；本库经 `BMapEngine` / loader 元数据表达。",
  },
];

const officialNames = [...officialPublic.keys()].sort((a, b) => a.localeCompare(b));
const oursNames = [...oursPublic].sort((a, b) => a.localeCompare(b));
const uiKitOnly = [...oursUiKit].filter((n) => !oursPublic.has(n)).sort((a, b) => a.localeCompare(b));

// EXCEPTIONS 过期检查：ours 必须在根入口或 ui-kit 子路径，official 必须在官方根 barrel。
{
  const stale: string[] = [];
  for (const e of EXCEPTIONS) {
    if (e.ours !== null && !oursPublic.has(e.ours) && !oursUiKit.has(e.ours)) stale.push(`ours=${e.ours}`);
    if (e.official !== null && !officialPublic.has(e.official)) stale.push(`official=${e.official}`);
  }
  if (stale.length > 0) {
    console.error("[generate-api-diff] stale EXCEPTIONS (name not in public surface):");
    for (const s of stale) console.error(`  ${s}`);
    process.exit(1);
  }
}

interface Row {
  name: string;
  surface: Surface;
  ours: boolean;
  official: boolean;
  officialFrom?: string;
  oursEntry?: string;
  note?: string;
}

function entryOf(name: string): string | undefined {
  if (oursComponents.has(name)) return "./components";
  if (oursComposables.has(name)) return "./composables";
  if (oursUiKit.has(name)) return "./ui-kit";
  if (oursRoot.has(name)) return ".";
  return undefined;
}

const both: Row[] = [];
const officialOnly: Row[] = [];
const oursOnly: Row[] = [];

for (const name of officialNames) {
  const surface = classifyOfficial(name);
  const inOurs = oursPublic.has(name);
  const row: Row = {
    name,
    surface,
    ours: inOurs,
    official: true,
    officialFrom: officialPublic.get(name)?.from,
    oursEntry: entryOf(name),
    note: EXCEPTIONS.find((e) => e.official === name)?.note,
  };
  if (inOurs) both.push(row);
  else officialOnly.push(row);
}

for (const name of oursNames) {
  if (officialPublic.has(name)) continue;
  const surface = classifyOurs(name);
  oursOnly.push({
    name,
    surface,
    ours: true,
    official: false,
    oursEntry: entryOf(name),
    note: EXCEPTIONS.find((e) => e.ours === name)?.note,
  });
}

// 排序：按 surface 再按名字
const surfaceOrder: Surface[] = ["component", "hook", "constant", "type", "other"];
function bySurfaceName(a: Row, b: Row): number {
  const s = surfaceOrder.indexOf(a.surface) - surfaceOrder.indexOf(b.surface);
  return s !== 0 ? s : a.name.localeCompare(b.name);
}
both.sort(bySurfaceName);
officialOnly.sort(bySurfaceName);
oursOnly.sort(bySurfaceName);

const summary = {
  officialPackage: official.package,
  officialVersion: official.version,
  officialCommit: official.commit,
  officialSource: official.source,
  officialNote: official.note ?? "",
  officialPublicCount: officialNames.length,
  oursPublicCount: oursNames.length,
  uiKitCount: oursUiKit.size,
  matchedCount: both.length,
  officialOnlyCount: officialOnly.length,
  oursOnlyCount: oursOnly.length,
  exceptions: EXCEPTIONS.length,
};

// ─── Markdown ────────────────────────────────────────────────────────────────

function mdTable(rows: Row[], cols: ("name" | "surface" | "ours" | "official" | "note")[]): string {
  const header: Record<string, string> = {
    name: "名称",
    surface: "面",
    ours: "本库",
    official: "官方 React",
    note: "说明",
  };
  const lines: string[] = [];
  lines.push(`| ${cols.map((c) => header[c]).join(" | ")} |`);
  lines.push(`| ${cols.map(() => "---").join(" | ")} |`);
  for (const r of rows) {
    const cells = cols.map((c) => {
      if (c === "name") return `\`${r.name}\``;
      if (c === "surface") return r.surface;
      if (c === "ours") return r.ours ? "✓" : "—";
      if (c === "official") return r.official ? "✓" : "—";
      if (c === "note") return (r.note ?? "—").replaceAll("|", "\\|");
      return "";
    });
    lines.push(`| ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

function countBySurface(rows: Row[]): string {
  const counts = new Map<Surface, number>();
  for (const r of rows) counts.set(r.surface, (counts.get(r.surface) ?? 0) + 1);
  return surfaceOrder
    .filter((s) => counts.has(s))
    .map((s) => `${s} ${counts.get(s)}`)
    .join(" · ");
}

const md: string[] = [];
md.push("<!-- Generated file. Do not edit directly. -->");
md.push("");
md.push("# 公开 API 对照（vs 官方 React 参考）");
md.push("");
md.push(
  `> 由 \`scripts/generate-api-diff.mts\` 生成，请勿手工编辑。刷新：\`pnpm generate:api-diff\`，CI \`--check\`。`,
);
md.push("");
md.push(
  `> **对照物**：维护者指定对齐 **[\`huiyan-fe/react-bmap\`](https://github.com/huiyan-fe/react-bmap)**（\`${official.package}@${official.version}\`，commit \`${official.commit.slice(0, 12)}\`），**不是**仍在开发中的 \`@baidumap/vue-bmap\`。`,
);
md.push("");
md.push("## 口径");
md.push("");
md.push("- **本库**：根入口（\`bmap-vue\`）公开导出 = \`componentManifest\` ∪ \`src/index.ts\` ∪ \`composables/index\`；\`./ui-kit\` 子路径单独计数。");
md.push("- **官方**：\`src/index.ts\` 上的重导出（与官方 barrel 同一口径）。");
md.push("- **不含** deprecation 别名（#136 清理前本就不提供旧 `B*` 名）。");
md.push("- 历史 ADR / migration 文档中的旧名**不**参与本表。");
md.push("");
md.push("## 汇总");
md.push("");
md.push("| 口径 | 数量 |");
md.push("| --- | --- |");
md.push(`| 官方根入口导出 | ${summary.officialPublicCount} |`);
md.push(`| 本库根入口导出 | ${summary.oursPublicCount} |`);
md.push(`| 名称对齐（交集） | ${summary.matchedCount} |`);
md.push(`| 仅官方有 | ${summary.officialOnlyCount} |`);
md.push(`| 仅本库有 | ${summary.oursOnlyCount} |`);
md.push(`| \`./ui-kit\` 子路径导出 | ${summary.uiKitCount} |`);
md.push(`| 手写语义例外 | ${summary.exceptions} |`);
md.push("");
md.push("### 交集按面分布");
md.push("");
md.push(countBySurface(both) || "（空）");
md.push("");
md.push("## 名称对齐");
md.push("");
md.push("两侧同名的导出（组件 / hooks / 类型 / 常量）。");
md.push("");
md.push(mdTable(both, ["name", "surface", "ours", "official"]));
md.push("");
md.push("## 语义例外（手写）");
md.push("");
md.push("| 本库 | 官方 | 类型 | 说明 |");
md.push("| --- | --- | --- | --- |");
for (const e of EXCEPTIONS) {
  const oursCell = e.ours ? `\`${e.ours}\`` : "—";
  const offCell = e.official ? `\`${e.official}\`` : "—";
  md.push(`| ${oursCell} | ${offCell} | ${e.kind} | ${e.note.replaceAll("|", "\\|")} |`);
}
md.push("");
md.push("## 仅官方有");
md.push("");
md.push("官方 React 根入口导出、本库根入口没有的名字。含官方 `BMAP_*` 常量重导出（本库经 Driver 归一，不镜像裸常量面）。");
md.push("");
md.push(mdTable(officialOnly, ["name", "surface", "note"]));
md.push("");
md.push("## 仅本库有");
md.push("");
md.push("本库扩展面（服务底座、聚合 / 列表组件、事件矩阵、能力目录、插件 catalog 等）。官方清单没有对应物不等于能力缺失——见 Capability Catalog。");
md.push("");
md.push(mdTable(oursOnly, ["name", "surface", "note"]));
md.push("");
md.push("## \`./ui-kit\` 子路径");
md.push("");
md.push("根入口**不**重导出 UI（ADR Official-first）。下列名字只从 `bmap-vue/ui-kit` 解析：");
md.push("");
if (uiKitOnly.length > 0) {
  for (const n of uiKitOnly) md.push(`- \`${n}\``);
} else {
  md.push("（全部 ui-kit 名称均已与根入口对齐或已在上表出现。）");
}
md.push("");
md.push("## 刷新官方清单");
md.push("");
md.push("官方清单是**快照**，不自动拉网。上游 bump 后：");
md.push("");
md.push("1. clone `huiyan-fe/react-bmap` 到临时目录，checkout 对应 commit；");
md.push("2. 抽取 `src/index.ts` 重导出与定义 `kind`，覆写 `scripts/api-diff/official-react-bmap-<version>.json`；");
md.push("3. `pnpm generate:api-diff` 并提交 JSON + 文档。");
md.push("");

const mdText = md.join("\n");
const jsonText = JSON.stringify(
  {
    ...summary,
    matched: both.map((r) => ({ name: r.name, surface: r.surface, oursEntry: r.oursEntry })),
    officialOnly: officialOnly.map((r) => ({ name: r.name, surface: r.surface })),
    oursOnly: oursOnly.map((r) => ({ name: r.name, surface: r.surface, oursEntry: r.oursEntry })),
    exceptions: EXCEPTIONS,
    uiKitOnly,
  },
  null,
  2,
) + "\n";

// ─── 写盘 / check ────────────────────────────────────────────────────────────

if (!check) {
  writeFileSync(MD_PATH, mdText);
  writeFileSync(JSON_PATH, jsonText);
}

console.log(`[generate-api-diff] official=${summary.officialPublicCount} ours=${summary.oursPublicCount} matched=${summary.matchedCount}`);
console.log(`  officialOnly=${summary.officialOnlyCount} oursOnly=${summary.oursOnlyCount} uiKit=${summary.uiKitCount}`);
console.log(`  ${check ? "checked" : "wrote"} ${relative(root, MD_PATH)}`);
console.log(`  ${check ? "checked" : "wrote"} ${relative(root, JSON_PATH)}`);

if (check) {
  const drift: string[] = [];
  const curMd = existsSync(MD_PATH) ? readFileSync(MD_PATH, "utf8") : "";
  const curJson = existsSync(JSON_PATH) ? readFileSync(JSON_PATH, "utf8") : "";
  if (curMd !== mdText) drift.push(relative(root, MD_PATH));
  if (curJson !== jsonText) drift.push(relative(root, JSON_PATH));
  if (drift.length > 0) {
    console.error("[generate-api-diff] DRIFT detected in:");
    for (const f of drift) console.error(`  ${f}`);
    console.error("  run: pnpm generate:api-diff");
    process.exit(1);
  }
  console.log("[generate-api-diff] OK, no drift.");
}
