/**
 * 已退役发布身份配置（单一事实源）— 文档面门禁（issue #141）
 *
 * 被以下位置消费，避免禁词规则在脚本、测试与文档之间漂移：
 * - `scripts/check-docs-brand.mts`  文档面静态门禁（驱动）
 * - `tests/behavior/docs-brand-gate.test.ts`
 *
 * ## 这道门禁管的是什么
 *
 * `bmap-vue` 的发布身份在 1.0 期间复位过三次：包名从 `baidu-map-gl-vue` 改成 `bmap-vue`
 * （身份复位）、公开 API 去掉 `B` 前缀（命名对齐）、旧引擎与迁移包袱整体删除（clean-slate）。
 * 文档面是这些决策的**主要对外产物**——读者只会从文档判断「这是个什么库、有哪些 API、怎么装」，
 * 而不从 git 历史判断。发布身份一旦在文档里回潮（哪怕只是一句「以前的包叫 xxx」），
 * 文档就开始说谎。因此这里把退役串**冻结成规则表**，让回潮在 CI 上变红而不是靠人记得。
 *
 * ## 三条设计原则（每条都对应一类真实的失效方式）
 *
 * ### 1. 「退役」是相对**当前发布面**说的，不是相对词面
 *
 * 本表刻意**不收**下面这些串，因为它们今天仍然是活的：
 *
 * | 串 | 为什么不是违规 |
 * | --- | --- |
 * | `BMapVue` | **活的** CDN 全局名（`vite.config.global.ts` 的 `name`），被 `global-build.test.ts` 与 `verify-package.mts` 断言着。改名是独立的一票。 |
 * | `BMap`（裸标识符） | 它是 **JSAPI 4.0 的官方命名空间**（`BMap.Map` / `BMap.Icon`）。文档讲 SDK 能力时必须写它。只有「把它当 Vue 组件用」才退役（见 `retired-bmap-tag`）。 |
 * | `BMapClient` / `BMapError` / `BMapServiceStatus` / `BMapProvider` / `BMapResolver` … | 当前公开类型与组件导出。`B` 前缀本身不是判据。 |
 * | `BMapGLLib` | 官方第三方插件命名空间，`check:raw-sdk` 明确放行。 |
 * | 官方 loader 的 `version: '3.0'` | 上游 `@baidumap/jsapi-loader` 的**合法**取值之一（见 `retired-version` 的引号分档）。 |
 * | `yue1123/vue3-baidu-map-gl` | MIT 归属义务，`NOTICE.md` / `LICENSE` / 三个 README 都必须写。见 `retired-product` 的 lookbehind。 |
 *
 * 把这些收进来的门禁第一天就在误伤**已发布的契约**，那不是严格，是不可用。
 *
 * ### 2. 判据要有区分力，且区分力必须**可被证明**
 *
 * 「有区分力」= 存在**近似但合规**的输入，且它不命中。否则规则可能退化成常量：命中集 = 全集时，
 * 任何正例都能证明它「有效」，规则却毫无信息。本文件里每条规则的区分力来源不同，
 * 测试逐条给出正例与近似反例（见 `tests/behavior/docs-brand-gate.test.ts`）。
 *
 * 判别力不是靠名单堆出来的，主要是靠**结构**：
 * - `retired-bmap-tag` 靠**位置**（后面是空白/斜杠/尖括号）而不是名单——扫描面里 36 处
 *   `<BMap…` 是当前公开类型，`<BMapProvider` 后面是 `P`、`BMap.Map` 后面是 `.`，两者都过不了。
 * - `retired-version` 靠**引号形态**：带引号的 `3.0` 是上游选项值，裸写的才是库版本措辞。
 * - `retired-product` 靠 lookbehind 把合法署名排除。
 *
 * ### 3. 豁免必须**离它豁免的那行足够近**
 *
 * 逐行内联豁免（`brand-gate:allow <理由>`）而不是脚本内白名单数组。理由有两条，
 * 都指向同一个失败模式——「为了过门禁而改注释」的本末倒置：
 * - 白名单条目离它豁免的句子很远，review 读文档时看不到例外存在；
 * - 白名单一大，规则集就没有区分力了（这正是仓库删过无判别力 guard 的原因）。
 *
 * 逐行豁免让理由**跟着文本走**，并配三条防自我消解的约束（理由必填、只豁免本行、
 * 豁免预算 `MAX_ESCAPES` 且由测试断言用量）。**预期用量是 0~5**；一旦逼近预算，
 * 该重新审视的是规则判据，不是加豁免。
 *
 * ## 刻意排除在扫描面之外
 *
 * | 排除 | 为什么 |
 * | --- | --- |
 * | `docs/adr/**` | 已接受即冻结的**决策史**，它的职能就是写下当时的旧名。`docs/adr/README.md` 写明「后续变更应新增 ADR 取代，而不是在原文件里改写历史」。按**路径**排除，不逐行豁免——它是另一个文体。 |
 * | `CHANGELOG.md` | 继承自上游的发布史（57KB 的 `vue3-baidu-map-gl/compare/...` 链接）。改它等于伪造来源记录。 |
 * | `docs/.vitepress/*.json` | 生成物，归 `generate:capability-matrix:check` / `generate:api-diff:check` / `generate:manifest:check` 管。两道门禁管同一个事实会漂移。 |
 * | `scripts/verify-package.mts` | 它把旧名当**拒绝表**用（`['baidu-map-gl-vue','3.0.0']`）——正是本门禁禁止的形状，出现在唯一必须出现它的文件里。与 `raw-sdk-boundary.mts` 不被自己的门禁扫是同一个道理。 |
 * | `packages/bmap-vue/src/**` | 归 `check:raw-sdk:tree` / `check:public-dts` / `check:api`。品牌门禁扫源码会与 API 面门禁重复且必然漂移。 |
 */

/** 规则 id：报告与门禁自测用它断言读数。 */
export type DocsBrandRuleId =
  | "retired-package"
  | "retired-product"
  | "retired-resolver"
  | "retired-component"
  | "retired-bmap-tag"
  | "retired-hook"
  | "retired-version"
  | "retired-migration-nav";

/**
 * #135 去 `B` 前缀**之前**的组件名。
 *
 * 来源可复算：`git show cb4a11f8~1:packages/bmap-vue/src/manifest.ts` 的 `name` 集
 * 减去今天 `docs/.vitepress/component-index.json` 的名字集。唯一幸存者是 `BMapProvider`
 * （它是今天真实的组件导出，因此**刻意不在表里**）。
 *
 * 两个刻意的例外：
 * - `BMap` 不在表里 —— 它同时是 JSAPI 4.0 的官方命名空间，收进来会把 `BMap.Map` 全部误伤。
 *   它的 Vue 标签形态由位置规则 `retired-bmap-tag` 单独管。
 * - `BPointShapeLayer` 在表里但不在上面那个差集里 —— 它是 `PointCollection` 曾经**未发布**的
 *   命名（#136 之前只存在于一条未发布的 changeset），从未是任何真实发布面，文档里同样要退役。
 *
 * **必须写成显式枚举，不能写 `<B[A-Z]*>` 前缀**：扫描面里 36 处 `<BMap…` 是当前公开类型
 * （`BMapClient` / `BMapServiceStatus` / `BMapGeoResult` …），前缀写法会全部误伤。
 */
export const RETIRED_COMPONENT_NAMES = [
  "BAutoComplete",
  "BBezierCurve",
  "BCircle",
  "BCityList",
  "BContextMenu",
  "BControl",
  "BCopyright",
  "BCustomOverlay",
  "BDOMLayer",
  "BDistrictLayer",
  "BFillLayer",
  "BGeoJSONLayer",
  "BGroundOverlay",
  "BHeatmapLayer",
  "BInfoWindow",
  "BLabel",
  "BLineLayer",
  "BLocation",
  "BMVTLayer",
  "BMapMask",
  "BMapType",
  "BMarker",
  "BMarker3d",
  "BMarkerCluster",
  "BMarkerList",
  "BMenuItem",
  "BMenuSeparator",
  "BNavigation",
  "BNavigation3d",
  "BOverview",
  "BPanorama",
  "BPanoramaControl",
  "BPanoramaCoverageLayer",
  "BPanoramaLabel",
  "BPointCollection",
  "BPointIconLayer",
  "BPointLayer",
  "BPointShapeLayer",
  "BPolygon",
  "BPolyline",
  "BPrism",
  "BRasterLayer",
  "BRectangle",
  "BScale",
  "BTileLayer",
  "BTrackLineLayer",
  "BTrafficLayer",
  "BWMSLayer",
  "BWMTSLayer",
  "BXYZLayer",
  "BZoom",
] as const;

/** 词边界里的标识符字符：把 `BMapProvider` 里的 `BMap` 判成「另一个标识符」的一部分。 */
const WORD = String.raw`[\w$.]`;
const escapeRe = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/**
 * 官方 `@baidumap/jsapi-loader` 的 `version` 取值之一：`'3.0'`。
 *
 * `docs/zh-CN/contributing/official-packages.md` 如实记录了上游的
 * `version`（`'3.0'｜'gl'｜'4.0'`，默认 `'4.0'`）——那是**上游的**版本语义，不是本库的库版本品牌。
 * 判据是**引号形态**（带引号 = 某个上游选项的取值），不是文件名、不是目录。
 */
const UPSTREAM_QUOTED_VERSION = /(['"`])3\.0\1/;

/** 迁移类措辞：只服务「怎么从旧版过来」的文案，1.0 不提供迁移路径。 */
const MIGRATION_PROSE = /v\d+\s*(?:已移除|已删除|不再支持)|仅留迁移|从\s*v\d+\s*迁移/;

export interface DocsBrandRule {
  readonly id: DocsBrandRuleId;
  /** 报告与 `--print-boundary` 用的一句话说明。 */
  readonly label: string;
  /**
   * 逐行匹配的正则。**每条都必须区分**「真的违规」与「近似但合规」——区分力来源写在规则旁，
   * 并由 `tests/behavior/docs-brand-gate.test.ts` 的正反例钉住。
   */
  readonly pattern: RegExp;
  /**
   * 规则级豁免，参数是（整行文本、本次命中的串）。返回 true 表示「这一处虽然字面命中，
   * 但它指的是上游语义而不是退役身份」。
   *
   * 与逐行豁免的区别：这里消解的是**判据内的歧义**（引号形态），例外是**人的决定**。
   */
  readonly isCompliant?: (line: string, match: string) => boolean;
  /**
   * 规则只作用于这些路径（相对仓库根）。省略 = 全扫描面。
   *
   * 用于「这类串在散文里是正常讨论、在导航里才是问题」的不对称规则。
   */
  readonly scopes?: readonly string[];
}

export const NAV_CONFIG_SCOPES = ["docs/.vitepress/configs/nav.ts", "docs/.vitepress/configs/sidebar.config.zh.ts"] as const;

/**
 * 逐行内联豁免：同一行出现 `brand-gate:allow` 且**后面有非空理由**才算豁免。
 *
 * 理由必填是刻意的——裸 `brand-gate:allow` 不豁免。没有理由的豁免等于注释掉一行代码。
 *
 * **`-->` 先剥掉再判理由**：markdown 里豁免写在 HTML 注释内（`<!-- brand-gate:allow r -->`），
 * 收尾的 `-->` 本身是非空 token，不剥掉的话「裸标记」也会被误判成有理由——
 * 那正是「不写理由也能关掉门禁」这个后门。剥掉之后裸标记后面没东西，仍判不豁免。
 */
const ESCAPE_REASON_BODY = /brand-gate:allow[ \t]+(.*?)\s*$/;
const HTML_COMMENT_CLOSE = /\s*-->\s*$/;

export function escapeReasonOf(line: string): string | null {
  const match = ESCAPE_REASON_BODY.exec(line);
  if (!match) return null;
  const body = match[1]!.replace(HTML_COMMENT_CLOSE, "").trim();
  return body.length > 0 ? body : null;
}

export const ESCAPE_HINT =
  'escape a genuine exception on the same line with `<!-- brand-gate:allow <reason> -->`' +
  " (markdown) or `// brand-gate:allow <reason>` (ts/vue script); the reason is mandatory.";

/**
 * 豁免预算。测试断言实际用量 ≤ 它且 > 0。
 *
 * 「> 0」是为了证明豁免路径真的被走过（不是写成死代码的分支）；「≤」是为了让
 * 「加一条豁免」变成一次可 review 的显式 diff，而不是逐行加、没人看见。
 * 逼近预算时该重新审视的是规则判据。
 */
export const MAX_ESCAPES = 12;

export const DOCS_BRAND_RULES: readonly DocsBrandRule[] = [
  {
    id: "retired-package",
    label: "已退役的 npm 包名 baidu-map-gl-vue",
    // lookbehind 排除 `/` 前缀，于是旧路径写法 `packages/baidu-map-gl-vue/...` 不命中——
    // 那是仓库路径而不是安装命令，而仓库路径的真实残留由 `docs/adr` 排除 + review 负责。
    pattern: new RegExp(String.raw`(?<![\w$./-])baidu-map-gl-vue(?![\w$-])`, "g"),
  },
  {
    id: "retired-product",
    label: "已退役的产品名 / 站点文案",
    // `(?<!yue1123/)` 是**归属义务**的例外：README / NOTICE / LICENSE 必须写原项目名。
    // 把它做进判据（而不是豁免），是因为它不依赖任何人工注释，也不会被人顺手删掉。
    pattern: new RegExp(
      String.raw`(?<!yue1123/)(?:vue3-baidu-map-gl(?![\w-])|Vue3[ -]BaiduMap[ -]GL|JavaScript GL 版|vue3-bmap-gl(?![\w-]))`,
      "g",
    ),
  },
  {
    id: "retired-resolver",
    label: "已退役的 resolver 名 Vue3BaiduMapGlResolver",
    // 吃掉完整后缀 `Resolver`：`import { Vue3BaiduMapGlResolver }` 里 `Vue3BaiduMapGl`
    // 后面紧跟字母，用 `[\w$]` 右断言会把它判成「另一个标识符」而漏放。
    // 真正的区分对象是**当前的** `BMapResolver`，它不含这个前缀，天然不命中。
    pattern: new RegExp(String.raw`(?<![\w$.])Vue3BaiduMapGl(?:Resolver)?(?![\w$])`, "g"),
  },
  {
    id: "retired-component",
    label: "已退役的组件名（去 B 前缀之前）",
    pattern: new RegExp(
      String.raw`(?<![\w$.])(?:${RETIRED_COMPONENT_NAMES.map(escapeRe).join("|")})(?![\w$])`,
      "g",
    ),
  },
  {
    // 判别力来自**位置**而不是名单：`<BMapProvider` 后面是 `P`、`BMap.Map` 后面是 `.`，
    // 两者都过不了 `[\s/>]`——所以当前 16 处 `<BMapProvider` 与全部 `BMap.*` SDK 引用天然不命中，
    // 只有「把 BMap 当 Vue 组件」才会红。
    id: "retired-bmap-tag",
    label: "已退役的组件名 BMap（作为 Vue 标签）",
    pattern: new RegExp(String.raw`(?<![\w$.])<BMap(?=[\s/>])`, "g"),
  },
  {
    id: "retired-hook",
    label: "已退役的 hooks 名 useBMap*",
    pattern: new RegExp(String.raw`(?<![\w$.])useBMap[A-Z][A-Za-z0-9]*`, "g"),
  },
  {
    id: "retired-version",
    label: "已退役的库版本措辞 3.0",
    // lookaround 排掉 `4.0.4` / `1.0.0-rc.0` / `^2.3.0` / `2026-09-24` 这类含 3.0 的更长数字。
    // 引号分档见 `isCompliant`：带引号 = 上游 loader 的 version 取值，裸写 = 库版本品牌。
    pattern: /(?<![0-9.'"`])\d?3\.0(?![0-9.'"`])/g,
    isCompliant: (line) => UPSTREAM_QUOTED_VERSION.test(line),
  },
  {
    // 迁移措辞在**散文**里可以是正常的历史说明（「本库移除了 usePoint，直接用 Point 即可」），
    // 但**留在主导航**里就是给新用户指了一条 1.0 不存在的路。所以规则带 scope。
    id: "retired-migration-nav",
    label: "只服务迁移说明的导航 / 侧栏条目",
    pattern: MIGRATION_PROSE,
    scopes: NAV_CONFIG_SCOPES,
  },
];

/** 扫描相位。`extensions` 决定收哪些文件；`files` 模式直接收显式文件列表。 */
export interface DocsScanPhase {
  /** 报告与断言用的相位名。**不含空白**——扫描读数按 `<label>=<dir>:<N> 个文件` 分隔解析。 */
  readonly label: string;
  /** 扫描根目录（相对仓库根）。 */
  readonly dir: string;
  /** 收集哪些扩展名；`"file"` 模式表示按 `dir` 收单个文件。 */
  readonly extensions: readonly string[];
}

/**
 * 扫描相位表。
 *
 * `docs-examples` 与 `docs-config` **不可省**：
 * - `:::demo` 容器会逐字内联 `docs/examples/*.vue` 的源码进页面（`configs/plugins.ts` 读它），
 *   所以示例源码是**发布面**，示例里的退役串同样在页面里。
 * - `pwa.ts` / `head.ts` / `nav.ts` / `sidebar.config.zh.ts` 是站点 chrome，直接发到用户浏览器。
 *
 * `readmes` 相位只收三个文件（不进目录），因此 extensions 写 `"file"`。
 */
export const DOCS_SCAN_PHASES: readonly DocsScanPhase[] = [
  { label: "docs", dir: "docs", extensions: [".md"] },
  { label: "docs-examples", dir: "docs/examples", extensions: [".vue"] },
  { label: "docs-config", dir: "docs/.vitepress", extensions: [".ts", ".mts"] },
  { label: "readmes", dir: "README.md", extensions: ["file"] },
];

/** 额外并入 `readmes` 相位的文件（相对仓库根）。 */
export const DOCS_EXTRA_READMES = ["packages/bmap-vue/README.md", "NOTICE.md"] as const;

/** 扫描面内按**路径**排除的目录 / 后缀（`isExcludedDocPath` 的依据）。 */
export const EXCLUDED_DOC_PATH_PREFIXES = ["docs/adr/", "docs/.vitepress/cache/"] as const;
export const EXCLUDED_DOC_SUFFIXES = [".json", ".map"] as const;

/** 判断一个**仓库相对**路径是否落在扫描面的排除区里。 */
export function isExcludedDocPath(relativePath: string): boolean {
  const path = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (EXCLUDED_DOC_PATH_PREFIXES.some((prefix) => path === prefix.slice(0, -1) || path.startsWith(prefix))) {
    return true;
  }
  return EXCLUDED_DOC_SUFFIXES.some((suffix) => path.endsWith(suffix));
}

/** 某条规则是否适用于这个文件。 */
export function ruleAppliesToFile(rule: DocsBrandRule, relativePath: string): boolean {
  if (!rule.scopes) return true;
  return rule.scopes.some((pattern) => matchesPattern(pattern, relativePath));
}

/**
 * 极简 glob：支持 `dir/**`、精确路径。
 *
 * 直接复用 `raw-sdk-boundary.mts` 的同名实现——两份 glob 迟早会漂移，而这里只需要
 * 极简语义（`dir/**` 与精确路径），不值得为它养第二份实现。
 */
import { matchesPattern } from "./raw-sdk-boundary.mts";

export { matchesPattern };

/** 结构化配置，供 `--print-boundary` 与门禁自测断言使用。 */
export function docsBrandSummary(): {
  rules: { id: DocsBrandRuleId; label: string; pattern: string; scopes: string[] | null }[];
  phases: { label: string; dir: string; extensions: string[] }[];
  excludedPathPrefixes: string[];
  extraReadmes: string[];
  maxEscapes: number;
  escapeHint: string;
} {
  return {
    rules: DOCS_BRAND_RULES.map((rule) => ({
      id: rule.id,
      label: rule.label,
      pattern: rule.pattern.source,
      scopes: rule.scopes ? [...rule.scopes] : null,
    })),
    phases: DOCS_SCAN_PHASES.map((phase) => ({
      label: phase.label,
      dir: phase.dir,
      extensions: [...phase.extensions],
    })),
    excludedPathPrefixes: [...EXCLUDED_DOC_PATH_PREFIXES],
    extraReadmes: [...DOCS_EXTRA_READMES],
    maxEscapes: MAX_ESCAPES,
    escapeHint: ESCAPE_HINT,
  };
}
