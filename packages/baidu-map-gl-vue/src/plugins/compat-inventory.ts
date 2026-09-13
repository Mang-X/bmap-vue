/**
 * 插件兼容 inventory（M3A3-07 / issue #25）
 *
 * 这份清单回答一个 #25 验收里长期没有答案的问题：**四个内置插件脚本在 JSAPI 4.0 上到底
 * 是什么状态**。此前 Capability Catalog 里 `overlay.mapvgl` / `service.track-animation`
 * 的说明是「迁移结论待定（M8）」——那不是结论，读者既不知道已经查过什么，也不知道还差什么。
 *
 * 三条约定（都由 `v3-plugin-compat-inventory.test.ts` 钉住，且配了反证）：
 *
 * 1. **依据分级，不混着写**。每条结论必须标出 `basis`：哪些是**对锁定 URL 的真实发布产物**
 *    的观察（`artifact`，命令 `pnpm probe:plugin-compat`）、哪些是与官方
 *    `@baidumap/jsapi-v4-types@4.0.4` 的**逐成员核对**（`declaration`）、哪些是真实运行时
 *    观察（`runtime`，需 AK + WebGL，只在 nightly / 手动跑）。没跑过的档位**不写进依据**。
 * 2. **必需功能不得依赖任何插件脚本**。内置插件一律 `required: false`：插件脚本的失败只
 *    发 `plugin:error` 事件，不得让地图本身失败（隔离口径，见 ADR
 *    `2026-09-13-plugin-compat-inventory`）。历史上 `TrackAnimation` 被标成 `required: true`，
 *    那意味着一个 legacy-only 插件的 CDN 抖动就能让整张地图挂掉。
 * 3. **能力与清单互锁**。Catalog 里被标为 `unsupported` 的插件类能力，必须在这里有对应条目
 *    （否则「不支持」是一句没有依据的话）；反过来，条目声明的能力必须真实存在于 Catalog。
 *
 * 本文件是**单一事实源**：`pnpm generate:plugin-inventory` 由它生成
 * `docs/zh-CN/contributing/plugin-compat-inventory.md` 与
 * `docs/.vitepress/plugin-inventory.json`，CI 用 `--check` 校验无漂移。
 */
import type { Capability } from "../driver/capability";

/** 内置插件的字符串名（`plugins: [...]` 与 `stringToPluginDefinitions` 用的就是它）。 */
export type BuiltinPluginName = "TrackAnimation" | "DrawingManager" | "GeoUtils" | "Mapvgl";

/**
 * `BUILTIN_PLUGIN_URLS` 的键。
 *
 * 刻意**不**在这里 import `builtins.ts`：本文件要能被 Node 侧的生成器 / 探针以
 * `--experimental-strip-types` 直接加载，而 Node ESM 不解析无扩展名导入。URL 的单一事实源
 * 仍是 `builtins.ts`，两边的一致性由 `v3-plugin-compat-inventory.test.ts` 交叉断言
 * （`Object.keys(BUILTIN_PLUGIN_URLS)` 必须与这里的键集合相等）。
 */
export type PluginUrlKey = "trackAnimation" | "drawingManager" | "geoUtils" | "mapvgl";

/**
 * 结论依据的档位。
 *
 * 三档必须分开写：把「声明面没缺口」说成「兼容」是把结论说得比证据强，而把「没跑过」
 * 混进依据里会让读者以为有人跑过。
 */
export type PluginEvidenceBasis =
  /** 对锁定 URL 的**真实发布产物**做静态抽取（`pnpm probe:plugin-compat`，可复现）。 */
  | "artifact"
  /** 与官方 `@baidumap/jsapi-v4-types` 的声明逐成员核对（同一条探针命令的第二个落点）。 */
  | "declaration"
  /** 真实 4.0 运行时观察（需 AK + WebGL；nightly / 手动，不在 PR 门禁内）。 */
  | "runtime";

/**
 * 脚本的兼容结论。
 *
 * - `incompatible`：有**决定性**依据说明它在 4.0 上不可用（例如依赖本库明令禁止的私有面）；
 * - `no-declaration-gap`：脚本引用的 SDK 成员在 4.0.4 声明里**没有缺口**，也没有私有面——
 *   这是「声明面通过」，不是「运行时验证通过」；运行时档位另行标注；
 * - `undetermined`：既有缺口也有不确定项，需要在 M8（#43）里继续。
 */
export type PluginVerdict = "incompatible" | "no-declaration-gap" | "undetermined";

export interface PluginCompatEntry {
  /** 稳定标识，同时是 `plugins: [...]` 接受的字符串名。 */
  readonly id: BuiltinPluginName;
  /** `BUILTIN_PLUGIN_URLS` 的键：URL 的单一事实源在那里，这里只做交叉校验。 */
  readonly urlKey: PluginUrlKey;
  /** 脚本加载后应出现的全局取值路径（点号分隔），用于探针与手工核对。 */
  readonly exposedGlobal: string;
  /**
   * 插件是否必需。内置插件**一律 `false`**（见文件头约定 2）。
   *
   * 字段保留而不是删掉，是为了让「有人想把它改成必需」这件事必须显式改数据 + 改用例，
   * 而不是悄悄改一行 `required: true`。
   */
  readonly required: false;
  /** 脚本引用的 SDK 命名空间成员（`BMap.<Member>` 这一层）。 */
  readonly sdkNamespaceMembers: readonly string[];
  /**
   * 脚本是否引用了 SDK 的**命名空间级私有成员**（命名空间上的 `_` 前缀成员）。
   *
   * `true` 就是 `incompatible` 的决定性依据。这里只放布尔值、不放成员名清单，有两个原因：
   *
   * 1. **门禁口径**：本库生产源码的私有面门禁（`tests/behavior/v3-private-sdk-surface.test.ts`）
   *    匹配的是**访问形态**——字符串字面量里写成「命名空间点号 + 成员名」与「真的去读它」在文本上
   *    无法区分，判违规是对的。门禁自己的约定就是「解释这类成员时只写成员名（反引号包起来）」，
   *    所以这里不给出可被误读的完整路径形态。
   * 2. **可核对性不降级**：探针仍然从真实产物里抽取私有成员名（`scripts/probe-plugin-compat.mts`，
   *    不在扫描范围内），并断言「抽到的集合是否为空」与这个布尔值一致。人要看的完整名字在探针输出、
   *    inventory 文档与 `privateSurfaceNote` 里。
   *
   * 口径边界：**只覆盖命名空间级私有成员**。实例级私有字段（例如某插件读 `polyline` 上的下划线
   * 字段）不进这一列，写在 `residualRisks` 里——探针的文本抽取本来也不认这种形态。
   */
  readonly hasPrivateSurface: boolean;
  /** 私有面的人读说明（写成员名即可，不要写成完整访问形态，见上）。 */
  readonly privateSurfaceNote: string;
  /**
   * 脚本**自身**在运行期产生的副作用标记（子串）。
   *
   * 这些是自动注入外部脚本 / 统计代码的痕迹，不受本库的加载与取消路径管控。探针会逐个在
   * 发布产物里按子串核对，因此这里只能写**确切的字面片段**，不能写结论式描述。
   */
  readonly selfInjectedMarkers: readonly string[];
  /** 关联的 Capability（存在时双向互锁，见文件头约定 3）。 */
  readonly capability?: Capability;
  readonly verdict: PluginVerdict;
  readonly basis: readonly PluginEvidenceBasis[];
  /** 一句话结论，直接进文档表。 */
  readonly summary: string;
  /**
   * 已知但**刻意不修**的残余风险（必须写成「谁去处理」，不能只写「存在风险」）。
   */
  readonly residualRisks: readonly string[];
}

/** 依据档位的解释（生成文档时用，避免文档与代码两套说法）。 */
export const PLUGIN_EVIDENCE_BASIS_MEANING: Record<PluginEvidenceBasis, string> = {
  artifact: "对锁定 URL 的真实发布产物做静态抽取（`pnpm probe:plugin-compat`，可复现）",
  declaration: "与官方 `@baidumap/jsapi-v4-types@4.0.4` 的逐成员核对（同一条命令）",
  runtime: "真实 JSAPI 4.0 运行时观察（需 AK + WebGL，仅 nightly / 手动）",
};

/** 结论的解释（同上）。 */
export const PLUGIN_VERDICT_MEANING: Record<PluginVerdict, string> = {
  incompatible: "有决定性依据说明它在 4.0 上不可用",
  "no-declaration-gap": "引用的 SDK 成员在 4.0.4 声明里没有缺口（≠ 运行时已验证）",
  undetermined: "既有缺口也有不确定项，结论留给 M8（#43）",
};

/**
 * 四个内置插件的兼容清单。
 *
 * `sdkNamespaceMembers` / `privateSurface` / `selfInjectedScripts` 三列是
 * `pnpm probe:plugin-compat` 从**真实发布产物**里抽出来的观察值，不是人工阅读结论；
 * 改了脚本（URL 变化）就该重跑探针并核对这三列。
 */
export const PLUGIN_COMPAT_INVENTORY: readonly PluginCompatEntry[] = [
  {
    id: "TrackAnimation",
    urlKey: "trackAnimation",
    exposedGlobal: "window.BMapGLLib.TrackAnimation",
    required: false,
    sdkNamespaceMembers: ["Point", "ViewAnimation"],
    hasPrivateSurface: false,
    privateSurfaceNote: "无命名空间级私有成员；实例级私有字段见残余风险。",
    selfInjectedMarkers: [],
    capability: "service.track-animation",
    verdict: "no-declaration-gap",
    basis: ["artifact", "declaration"],
    summary:
      "加载期只写 `window.BMapGLLib`，不碰 SDK；引用的 `BMapGL.Point` / `BMapGL.ViewAnimation` " +
      "与它调用的 `Map` 方法（`getViewport` / `getDistance` / `getMaxZoom` / " +
      "`startViewAnimation` / `pauseViewAnimation` / `continueViewAnimation` / " +
      "`cancelViewAnimation` / `addOverlay` / `removeOverlay`）在 4.0.4 声明里**全部存在**。",
    residualRisks: [
      "`setSpeed()` 依赖上游**未声明**的 `ViewAnimation` 私有成员（`animation` / `_options` / " +
        "`_beginTime` / `_pauseTime` 与 `setBeginTime` / `setDuration`）⇒ 该方法按「依据不足」处理，" +
        "本库不承诺它；构造函数 / `start` / `pause` / `continue` 路径不碰私有面。",
      "`Polyline#_config.linkRight` 是实例私有字段，用于判断折线是否跨 180° 经线。",
      "运行时未验证（无 AK / WebGL）；`pnpm smoke:v4` 的插件页属 #43。",
    ],
  },
  {
    id: "DrawingManager",
    urlKey: "drawingManager",
    exposedGlobal: "window.BMapGLLib.DrawingManager",
    required: false,
    sdkNamespaceMembers: [
      "Circle",
      "Control",
      "Icon",
      "Label",
      "Marker",
      "Overlay",
      "Pixel",
      "Point",
      "Polygon",
      "Polyline",
      "Size",
    ],
    hasPrivateSurface: false,
    privateSurfaceNote: "无。",
    selfInjectedMarkers: [
      "BMapGLLib/GeoUtils/src/GeoUtils.min.js",
      "BMapGLLib/DrawingManager/src/gpc.js",
    ],
    capability: undefined,
    verdict: "undetermined",
    basis: ["artifact", "declaration"],
    summary:
      "引用的命名空间成员全部在 4.0.4 声明内；`lang.Class` 是脚本**自带**的实现（`r.lang = r.lang || {}`），" +
      "不依赖 SDK 内部模块。但它用 `prototype = new BMapGL.Overlay` 继承覆盖物基类，而官方声明明写" +
      "「此类不可实例化」；且 `enableCalculate()` / `enableGpc()` 会**由脚本自己**动态注入" +
      " GeoUtils 与 GPC 两个外部脚本，不受本库管控。",
    residualRisks: [
      "`new BMapGL.Overlay` 与官方「不可实例化」的表述冲突，4.0 运行时行为未知 ⇒ 归 #43 用真实运行时确认。",
      "运行时自行注入的两个外部脚本会绕过本库的加载与清理路径（不写进 `BUILTIN_PLUGIN_URLS`、" +
        "不参与取消）⇒ 文档必须写明这一点。",
    ],
  },
  {
    id: "GeoUtils",
    urlKey: "geoUtils",
    exposedGlobal: "window.BMapGLLib.GeoUtils",
    required: false,
    sdkNamespaceMembers: ["Bounds", "Circle", "Polygon", "Polyline"],
    hasPrivateSurface: false,
    privateSurfaceNote: "无。",
    selfInjectedMarkers: [],
    capability: undefined,
    verdict: "no-declaration-gap",
    basis: ["artifact", "declaration"],
    summary:
      "纯几何谓词集合（`isPointInRect` / `isPointInPolygon` / `isPointInCircle` / `isPointOnPolyline` / " +
      "`isPolylineIntersectArea` / `getDistance` / `getPolylineDistance` / `getPolygonArea` / `degreeToRad` / " +
      "`radToDegree`），只读 `Bounds` / `Circle` / `Polygon` / `Polyline` 的公开读数方法，无私有面、无副作用。",
    residualRisks: [
      "**本仓库自持的 legacy 声明与真实脚本不一致**：`types/BMapGL/lib.d.ts` 把 `BMapGLLib.GeoUtils` " +
        "声明成 `new GeoUtils(map, options)` 的类，而真实脚本暴露的是**静态谓词命名空间**（没有可用的" +
        "实例 API）。在 `#26` 删除 legacy 声明面之前，别照着那份声明写调用。",
      "运行时未验证（无 AK / WebGL）；`DrawingManager` 会自行注入它，属于插件之间的隐式依赖。",
    ],
  },
  {
    id: "Mapvgl",
    urlKey: "mapvgl",
    exposedGlobal: "window.mapvgl",
    required: false,
    sdkNamespaceMembers: [],
    hasPrivateSurface: true,
    privateSurfaceNote:
      "私有 JSONP 回调表（成员名 `_rd`）：脚本把函数注册进这张表，并把 `callback=` 指过去。",

    selfInjectedMarkers: ["_hmt"],
    capability: "overlay.mapvgl",
    verdict: "incompatible",
    basis: ["artifact", "declaration"],
    summary:
      "**硬不兼容**：它的 JSONP 传输层直接拿 SDK 的私有回调表（成员名 `_rd`）当注册处——" +
      "把自己的回调函数塞进去，再把 `callback=` 参数指向表里的那条。这正是 #72 明令本库" +
      "（ADR `2026-09-13-private-sdk-surface-removal`）不得访问的私有面，它也不在官方声明里；" +
      "脚本另外读 `window.BMapGL || window.BMap` 并尝试继承 `Overlay`。",
    residualRisks: [
      "加载期会注入百度统计脚本（`window._hmt`）——`builtins.ts` 的 `mapvgl` 分支因此用" +
        "「fetch + 去掉统计片段 + 内联」的方式加载，这条特例只对 MapVGL 成立，不要推广到别的插件。",
      "即使去掉统计脚本，`_rd` 这一条也不会因为本库的改动而消失：它是脚本自己的传输实现，" +
        "要修只能改上游（M8 / #43）。",
    ],
  },
];

/** 供生成器与用例按 id 取条目。 */
export const PLUGIN_COMPAT_BY_ID: Readonly<Record<BuiltinPluginName, PluginCompatEntry>> =
  Object.fromEntries(
    PLUGIN_COMPAT_INVENTORY.map((entry) => [entry.id, entry]),
  ) as Readonly<Record<BuiltinPluginName, PluginCompatEntry>>;
