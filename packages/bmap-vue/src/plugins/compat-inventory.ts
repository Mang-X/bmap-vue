/**
 * 插件兼容 inventory（M3A3-07 / issue #25；结论定型于 M8-ADAPTERS-ADVANCED / issue #43）
 *
 * 这份清单回答一个 #25 验收里长期没有答案的问题：**四个内置插件脚本在 JSAPI 4.0 上到底
 * 是什么状态**。此前 Capability Catalog 里 `overlay.mapvgl` / `service.track-animation`
 * 的说明是「迁移结论待定（M8）」——那不是结论，读者既不知道已经查过什么，也不知道还差什么。
 *
 * 三条约定（都由 `plugin-compat-inventory.test.ts` 钉住，且配了反证）：
 *
 * 1. **依据分级，不混着写**。每条结论必须标出 `basis`：哪些是**对锁定 URL 的真实发布产物**
 *    的观察（`artifact`，命令 `pnpm probe:plugin-compat`）、哪些是与官方
 *    `@baidumap/jsapi-v4-types@4.0.4` 的**逐成员核对**（`declaration`）、哪些是真实运行时
 *    观察（`runtime`，需 AK + WebGL，命令 `pnpm probe:plugin-runtime`）。没跑过的档位**不写进依据**。
 * 2. **必需功能不得依赖任何插件脚本**。内置插件一律 `required: false`：插件脚本的失败只
 *    发 `plugin:error` 事件，不得让地图本身失败（隔离口径，见 ADR
 *    `2026-09-13-plugin-compat-inventory`）。历史上 `TrackAnimation` 被标成 `required: true`，
 *    那意味着一个 legacy-only 插件的 CDN 抖动就能让整张地图挂掉。
 * 3. **能力与清单互锁**。Catalog 里被标为 `unsupported` 的插件类能力，必须在这里有对应条目
 *    （否则「不支持」是一句没有依据的话）；反过来，条目声明的能力必须真实存在于 Catalog。
 *
 * ## #43：从「三值 + 未定项」收敛成五值结论 + 迁移路径
 *
 * #25 那版的词汇是 `incompatible` / `no-declaration-gap` / `undetermined`。后者诚实地表达了
 * 「还没查完」，但它不是一个**结论**，读者仍然不知道该怎么办。`#43` 把词汇换成
 * `native` / `compatible` / `adapter` / `incompatible` / `unverified`（见 `PLUGIN_VERDICT_MEANING`），
 * 并给每条补 `migrationPath`：**结论要落到「那我现在该用什么」上**。
 *
 * 同一轮把运行时档从「构造 + 一次真实调用」扩到各自的最小功能链路（TrackAnimation 的
 * `pause` / `continue` / 播放到结尾、DrawingManager 的**真的画出一个多边形**、MapVGL 的抛错根因），
 * 并把**覆盖到哪几步**写进 `runtime.covered` / `runtime.uncovered` ——「已验证」不是一个布尔值，
 * 它有一个明确的范围；没覆盖的部分写出来，而不是留白让读者以为全都验过了。
 *
 * 本文件是**单一事实源**：`pnpm generate:plugin-inventory` 由它生成
 * `docs/zh-CN/contributing/plugin-compat-inventory.md`（人读）与
 * `docs/.vitepress/plugin-inventory.json`（机读：给站点 / 工具链按 id 取结论用，形状由
 * `plugin-compat-inventory.test.ts` 钉住，取用方式见 `docs/zh-CN/contributing/ai-development.md`），
 * CI 用 `--check` 校验无漂移。
 */
import type { Capability } from "../driver/capability";

/** 内置插件的字符串名（`plugins: [...]` 与 `stringToPluginDefinitions` 用的就是它）。 */
export type BuiltinPluginName = "TrackAnimation" | "DrawingManager" | "GeoUtils" | "Mapvgl";

/**
 * `BUILTIN_PLUGIN_URLS` 的键。
 *
 * 刻意**不**在这里 import `builtins.ts`：本文件要能被 Node 侧的生成器 / 探针以
 * `--experimental-strip-types` 直接加载，而 Node ESM 不解析无扩展名导入。URL 的单一事实源
 * 仍是 `builtins.ts`，两边的一致性由 `plugin-compat-inventory.test.ts` 交叉断言
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
  /**
   * 与官方 `@baidumap/jsapi-v4-types` 的声明核对。**自动部分只覆盖命名空间级成员**
   * （`BMapGL.<Member>` 是否存在）；`Owner#member` 形态的**实例成员**没有被自动校验，
   * 由人工逐条对照声明，写在每条目的 `manualInstanceChecks` 里（评审 #85 P2-1）。
   */
  | "declaration"
  /** 真实 JSAPI 4.0 运行时观察（`pnpm probe:plugin-runtime`：需 AK + 浏览器；不进 PR 门禁）。 */
  | "runtime";

/**
 * 脚本的兼容结论（#43 冻结的五值词汇）。
 *
 * 五个取值各自都能**单独作为最终结论**——`unverified` 也是结论（「查过、但依据不足以支持
 * 一个更强的话」），不要为了「功能完整」把它实现成 `adapter`。这条来自 #43 的开工前范围纠正
 * （Evidence-before-abstraction）：**先判定，再适配；只有结论明确是 `adapter` 且存在真实
 * 消费者时才写 adapter 代码**。
 */
export type PluginVerdict =
  /** 上游 4.0 已有**原生替代**：迁移到原生能力，不要再依赖该脚本（见 `migrationPath`）。 */
  | "native"
  /**
   * 脚本在 4.0 上**可直接使用**，且已有运行时证据支撑最小功能链路。
   *
   * 它的边界是「脚本自己能用」，**不是**「本库为它提供了封装」：本库只负责按需加载脚本，
   * 不承诺插件的内部实现，也不管控它在运行时自行注入的其它脚本。
   */
  | "compatible"
  /**
   * 需要本库写适配层才能用。
   *
   * ⚠️ **当前没有任何条目取这个值，这是刻意的**：按 #43 的口径，只有「结论明确是 adapter
   * **且**存在真实消费者」时才写 adapter 代码；四个内置插件都不满足该条件。要新增一条
   * `adapter` 条目，必须同时给出消费者与迁移落点，并删掉 `plugin-compat-inventory.test.ts`
   * 里那条「当前无 adapter 条目」的门禁。
   */
  | "adapter"
  /** 有**决定性**依据说明它在 4.0 上不可用（必须给出决定性依据，见门禁用例）。 */
  | "incompatible"
  /**
   * 依据不足以支持更强的结论。**可以**是最终结论。
   *
   * 与 `incompatible` 的分界：`incompatible` 是「有决定性依据证明不可用」，`unverified` 是
   * 「没查到那个程度」。把后者写成前者，等于把「不知道」说成「不行」。
   */
  | "unverified";

/**
 * 迁移路径：**结论要落到「那我现在该用什么」上**（#43 的验收项「每个旧插件有版本、依据、
 * 兼容结果及迁移路径」）。
 */
export interface PluginMigrationPath {
  /**
   * 迁移方向的三分法。
   *
   * - `native`：上游已有原生替代，迁到本库的原生组件 / Facet；
   * - `plugin`：**没有**原生替代，继续按官方文档直接使用该插件脚本（本库只负责加载脚本）；
   * - `none`：没有可用路径（脚本不可用且无可替代能力）——此时 `target` 必须写明「无」并给出替代建议。
   */
  readonly kind: "native" | "plugin" | "none";
  /** 迁移落点：原生能力 id / 官方文档指引 / 「（无）」。 */
  readonly target: string;
  /**
   * `kind === "native"` 时必填：本库**真实存在**的组件名。
   *
   * 单独列出来是为了让门禁能核对它（组件清单在 `src/manifest.ts` 里，不存在就必须红）——
   * 迁移路径写成一句不存在的组件名，比不写更坏。
   */
  readonly nativeComponent?: string;
  /** 一句话说明怎么迁，直接进文档。 */
  readonly note: string;
}

/** 脚本的版本锁定情况（#43 实施步骤 4：「插件 URL 固定可追踪版本 / 受控资产」）。 */
export interface PluginVersionLock {
  /**
   * 上游资产是否**自带版本号**。
   *
   * 三个 `BMapGLLib/*` URL 指向百度自托管的 GitHub 镜像，路径里**没有** tag / commit
   * （`.../github/BMapGLLib/<Name>/src/<Name>.min.js`）⇒ 上游改一次内容，URL 不变。
   * 这不是我们能在本仓单方面解决的事（换成 commit-pinned CDN 是一次独立的受控资产决策），
   * 所以这里如实写「未版本化」，再用 `artifactDigest` 把**内容**锁住。
   */
  readonly versioned: boolean;
  /** 人读的锁定说明。 */
  readonly note: string;
}

/**
 * 最小路径的覆盖范围。
 *
 * 「已验证」不是一个布尔值：这四列写清**跑到了哪一步**、以及**哪一步没跑**。没跑的部分留白
 * 会被读成「也验过了」（评审 #85 第三轮同源问题）。
 */
export interface PluginRuntimeReading {
  /** `verified` = 最小路径无抛错；`threw` = 运行时抛错（错误文本进 `detail`）。 */
  readonly status: "verified" | "threw";
  /** 实测读数（写数字 / 关键事实，不写「一切正常」）。 */
  readonly detail: string;
  /** 这次读数**实际覆盖到**的最小路径子步骤（短标签，进文档）。 */
  readonly covered: readonly string[];
  /** 这次读数**明确没有覆盖**的子步骤 —— 写出来，别留白。 */
  readonly uncovered: readonly string[];
}

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
  /** 版本锁定情况（`BMapGLLib/*` 未版本化 ⇒ 用下面的内容摘要兜底）。 */
  readonly versionLock: PluginVersionLock;
  /**
   * 锁定 URL 当时的**内容摘要**（`sha256`，`probe:plugin-compat` 每次拉取后核对）。
   *
   * 为什么需要它：三个 `BMapGLLib/*` URL 指向自托管镜像、**没有版本号**，上游悄悄换一次
   * 内容，URL 与依赖声明都不会变。摘要让「换过了」当天就能被 nightly 抓到，并给出可执行的
   * 下一步（重新核对并更新 inventory），而不是等某个使用者发现行为变了。
   *
   * 它**不是**完整性校验（不做 SRI / 不给浏览器校验），只是漂移探测。
   */
  readonly artifactDigest: { readonly algo: "sha256"; readonly value: string };
  /** 脚本引用的 SDK 命名空间成员（`BMap.<Member>` 这一层）。 */
  readonly sdkNamespaceMembers: readonly string[];
  /**
   * 脚本是否引用了 SDK 的**命名空间级私有成员**（命名空间上的 `_` 前缀成员）。
   *
   * `true` 就是 `incompatible` 的决定性依据。这里只放布尔值、不放成员名清单，有两个原因：
   *
   * 1. **门禁口径**：本库生产源码的私有面门禁（`tests/behavior/private-sdk-surface.test.ts`）
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
   * **人工**逐条对照官方声明的实例成员（`Owner#member` 形态）。
   *
   * 为什么单独列出来：`probe:plugin-compat` 只做命名空间级存在性核对（抽取 `BMapGL.<Member>` 再与
   * 声明索引比对），它**不会**校验 `Map#getViewport` 这类实例成员——被调用的方法名在 minified 产物里
   * 无法可靠地归到 owner 类型上。把两者分开写，读者才不会以为「实例成员也在自动门禁里」。
   */
  readonly manualInstanceChecks: readonly string[];
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
  /** 迁移路径（#43 的验收项之一）。 */
  readonly migrationPath: PluginMigrationPath;
  readonly basis: readonly PluginEvidenceBasis[];
  /**
   * 运行时读数（`pnpm probe:plugin-runtime`：真实 JSAPI 4.0 + 真实 AK + 真实浏览器）。
   *
   * 与 `basis` 双向绑定：写了 `runtime` 档就必须有这份读数，反之亦然（用例锁住）。
   */
  readonly runtime?: PluginRuntimeReading;
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
  declaration:
    "与官方 `@baidumap/jsapi-v4-types` 的声明核对——**自动部分只证明命名空间级成员存在**；实例成员（`Owner#member`）是人工核对的，见各条的 `manualInstanceChecks`",
  runtime: "真实 JSAPI 4.0 运行时观察（`pnpm probe:plugin-runtime`，需 AK + 浏览器；nightly 单独跑）",
};

/**
 * 结论的解释（生成文档时用）。
 *
 * 五个取值各有明确边界，`Record<PluginVerdict, string>` 保证**漏一个编译不过**；
 * 反向「多一个」由用例做双向集合比较（类型锁不住多出来的键）。
 */
export const PLUGIN_VERDICT_MEANING: Record<PluginVerdict, string> = {
  native: "上游 4.0 已有原生替代 ⇒ 迁移到原生能力，不再依赖该脚本（见「迁移路径」列）",
  compatible:
    "脚本在 4.0 上可直接使用，且最小功能链路有运行时证据。边界：本库只负责按需加载脚本，不承诺插件的内部实现与它自行注入的其它脚本",
  adapter: "需要本库写适配层才能用（**当前无条目**：按 #43 口径，只有存在真实消费者时才写 adapter）",
  incompatible: "有决定性依据说明它在 4.0 上不可用",
  unverified:
    "依据不足以支持更强的结论 —— **这本身可以是最终结论**：不为了「功能完整」把它强行实现成 adapter",
};

/**
 * 四个内置插件的兼容清单。
 *
 * `sdkNamespaceMembers` / `hasPrivateSurface` / `selfInjectedMarkers` / `artifactDigest` 四列是
 * `pnpm probe:plugin-compat` 从**真实发布产物**里抽出来的观察值，不是人工阅读结论；
 * 改了脚本（URL 或内容变化）就该重跑探针并核对这四列。
 */
export const PLUGIN_COMPAT_INVENTORY: readonly PluginCompatEntry[] = [
  {
    id: "TrackAnimation",
    urlKey: "trackAnimation",
    exposedGlobal: "window.BMapGLLib.TrackAnimation",
    required: false,
    versionLock: {
      versioned: false,
      note:
        "URL 指向百度自托管的 GitHub 镜像（路径里没有 tag / commit）⇒ 上游改内容而 URL 不变；" +
        "本仓用 artifactDigest 锁内容，不做版本号承诺。",
    },
    artifactDigest: {
      algo: "sha256",
      value: "059eafe7e57d48135fb2e547544d1e870a85392d90e6dbdccbbd2b98a156f673",
    },
    sdkNamespaceMembers: ["Point", "ViewAnimation"],
    hasPrivateSurface: false,
    privateSurfaceNote: "无命名空间级私有成员；实例级私有字段见残余风险。",
    manualInstanceChecks: [
      "Map#getViewport",
      "Map#getDistance",
      "Map#getMaxZoom",
      "Map#startViewAnimation",
      "Map#pauseViewAnimation",
      "Map#continueViewAnimation",
      "Map#cancelViewAnimation",
      "Map#addOverlay",
      "Map#removeOverlay",
      "ViewAnimation#addEventListener",
    ],
    selfInjectedMarkers: [],
    capability: "service.track-animation",
    verdict: "native",
    migrationPath: {
      kind: "native",
      target: "layer.track-line",
      nativeComponent: "TrackLineLayer",
      note:
        "改用原生轨迹线图层 `<TrackLineLayer>`（官方 4.0 扩展 API `TrackLine`，见 M6 / #35、#36）。" +
        "**播放命令面**（start / pause / resume / stop / setSpeed / setProcess）与页面可见性" +
        "（`pauseOnHidden`）已由 #110 落地（方法名经 live 探针取证）；本票的结论与去向不变：" +
        "不要为 TrackAnimation 再写组件或 hook。",
    },
    basis: ["artifact", "declaration", "runtime"],
    runtime: {
      status: "verified",
      detail:
        "真实 4.0 上 `new BMapGLLib.TrackAnimation(map, polyline, { duration: 2000, overallView: false })` " +
        "构造成功；`start()` 后折线 path 由 2 点增长到 46 点、`map.getZoom()` 由 13 变为约 15.15（视角跟随）；" +
        "`pause()` 后 400ms 内 path 冻结在 46 点，`continue()` 后恢复到 104 点；" +
        "播放到结尾时 path 收敛到 201 点并触发构造选项 `onAnimateEnd`（连续 800ms 不再变化）。全程无抛错。",
      covered: [
        "构造",
        "start（path 增长 + 视角跟随）",
        "pause（path 冻结）",
        "continue（path 恢复增长）",
        "播放到结尾（path 收敛 + `onAnimateEnd` 回调）",
      ],
      uncovered: [
        "`setSpeed()` **不进门禁**：它调的是上游**未声明**的 `ViewAnimation` 私有成员（`animation` / `_options` / `_beginTime` 与 `setBeginTime` / `setDuration`）。本次实测在 4.0 上未抛错且 duration 被改短（path 继续增长到 145 点），但这依赖私有面，本库不承诺。",
        "跨 180° 经线的路径（构造期读 `Polyline#_config.linkRight` 那条分支）。",
        "重放（`start()` 二次调用）、`overallView: true`、`delay`、`setPolyline()` 等分支。",
      ],
    },
    summary:
      "加载期只写 `window.BMapGLLib`，不碰 SDK；引用的 `BMapGL.Point` / `BMapGL.ViewAnimation` " +
      "与它调用的 `Map` 方法在官方类型声明里**全部存在**（命名空间成员由 `probe:plugin-compat` 自动核对，" +
      "其中 10 个**实例成员**是人工对照声明核对的）。**结论是「迁到原生」**：4.0 有原生轨迹线图层，" +
      "本库不该再为这个 legacy 插件提供封装 —— 迁移落点与播放命令面的归属见「迁移路径」与残余风险。",
    residualRisks: [
      "`setSpeed()` 依赖上游**未声明**的 `ViewAnimation` 私有成员（`animation` / `_options` / " +
        "`_beginTime` 与 `setBeginTime` / `setDuration`）：4.0 上实测可用，但私有面随时可能消失 ⇒ " +
        "本库不提供它，也不承诺它。",
      "`Polyline#_config.linkRight` 是实例私有字段，用于判断折线是否跨 180° 经线。",
      "播放命令面的原生对应物已由 **#110** 落地在 `TrackLineLayer` 的 `playback` expose 上" +
        "（方法名经 live 探针取证，2026-09-23）。",
    ],
  },
  {
    id: "DrawingManager",
    urlKey: "drawingManager",
    exposedGlobal: "window.BMapGLLib.DrawingManager",
    required: false,
    versionLock: {
      versioned: false,
      note: "同 TrackAnimation：自托管镜像、URL 无 tag / commit ⇒ 用 artifactDigest 锁内容。",
    },
    artifactDigest: {
      algo: "sha256",
      value: "fe59847f0689c3dacc80440d0efbf6aa7f4ca00bcdc1ce2764ef9f39a5425850",
    },
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
    manualInstanceChecks: [
      "Map#addOverlay",
      "Map#removeOverlay",
      "Map#addControl",
      "Map#getPanes",
      "Map#getContainer",
      "Map#pointToPixel",
      "Map#pointToOverlayPixel",
      "Map#getDistance",
      "Map#getBounds",
      "Map#getCenter",
      "Map#setCenter",
      "Map#getSize",
      "Map#getViewport",
      "Map#setViewport",
      "Map#enableDragging",
      "Overlay#initialize",
      "Overlay#draw",
      "Overlay#dispose",
    ],
    selfInjectedMarkers: [
      "BMapGLLib/GeoUtils/src/GeoUtils.min.js",
      "BMapGLLib/DrawingManager/src/gpc.js",
    ],
    capability: undefined,
    verdict: "compatible",
    migrationPath: {
      kind: "plugin",
      target: "（按官方文档直接使用；本库不封装组件）",
      note:
        "交互式绘制在 4.0 **没有**原生替代（原生只有非交互的数据图层），继续经 " +
        "`plugins: ['DrawingManager']` 加载脚本、按官方文档使用。注意本库只负责加载脚本：" +
        "绘制 UI、以及脚本自行注入的 GeoUtils / GPC 不在本库的加载与取消路径内。",
    },
    basis: ["artifact", "declaration", "runtime"],
    runtime: {
      status: "verified",
      detail:
        "真实 4.0 上沿**公开 DOM 事件链路**发**合成指针事件序列**（`dispatchEvent`，`isTrusted === false`）"
        + "走通一条完整绘制链路：`new BMapGLLib.DrawingManager(map, " +
        "{ isOpen: false, confirmVisible: false, enableCalculate: true, enableGpc: true })` 构造成功、" +
        "`getDrawingMode()` 为 `marker`；`open()` + `setDrawingMode('polygon')` 读回 `polygon`；" +
        "在掩膜上按下并拖动 3 次后双击收尾，收到 `overlaycomplete`（载荷 `drawingMode: \"polygon\"`），" +
        "`map.getOverlays()` 里能找到同一个实例、`dm.getOverlays()` 记到 1 个。全程无抛错。" +
        "另外证实它**自行注入** `GeoUtils.min.js` 与 `gpc.js` 两个脚本（各两次：构造选项与显式 `enable*()`）。",
      covered: [
        "构造 + `getDrawingMode()`",
        "`enableCalculate()` / `enableGpc()` 并观察到自行注入两个脚本",
        "`open()` + `setDrawingMode('polygon')`（读回一致）",
        "合成指针事件序列画出多边形：按下 → 3 次拖动 → 双击收尾 → `overlaycomplete`（载荷 drawingMode 为 polygon）",
        "画出的覆盖物真的在图上、并被记进 `dm.getOverlays()`",
      ],
      uncovered: [
        "确认面板分支（`confirmVisible` 缺省为 `true`，画完要先点「确定」才 complete）——探针显式关掉了它。",
        "其余绘制模式（marker / polyline / rectangle / circle）与编辑、裁切、合并、复制、移动等能力。",
        "顶点吸附（sorption）与 `limit` 面积 / 距离校验。",
        "**浏览器真实用户输入**：事件是 `dispatchEvent` 造出来的（`isTrusted === false`），本探针验的是「库自己的公开 DOM 事件处理链路 + SDK 的坐标归一化」，不含浏览器输入层的差异（指针捕获 / 合成 click / 双击判定那一段）。",
        "脚本自行注入的 GeoUtils / GPC 的加载、失败与清理**不受本库管控**（只在真实运行时观察到）。",
      ],
    },
    summary:
      "引用的命名空间成员全部在官方类型声明内；`lang.Class` 是脚本**自带**的实现（`r.lang = r.lang || {}`），" +
      "不依赖 SDK 内部模块。它用 `prototype = new BMapGL.Overlay` 继承覆盖物基类（官方声明明写「此类不可实例化」），" +
      "但**真实 4.0 上用（合成的）指针事件序列画出了一个多边形、收到 `overlaycomplete`、覆盖物真的落在图上**。" +
      "它还会**由脚本自己**动态注入 GeoUtils 与 GPC 两个外部脚本，绕过本库的加载与取消路径。",
    residualRisks: [
      "`new BMapGL.Overlay` 与官方「不可实例化」的表述冲突；真实 4.0 上绘制链路已跑通，" +
        "但「今天能跑」不等于「上游保证」——这类 legacy 继承写法随时可能随 SDK 版本变化失效。",
      "运行时自行注入的两个外部脚本会绕过本库的加载与清理路径（不写进 `BUILTIN_PLUGIN_URLS`、" +
        "不参与取消）⇒ 文档必须写明这一点（已由运行时观察证实，不再是推断）。",
      "只覆盖了 polygon 的「画一个」链路；`confirmVisible` 缺省分支与其它模式未验证（见 `runtime.uncovered`）。",
    ],
  },
  {
    id: "GeoUtils",
    urlKey: "geoUtils",
    exposedGlobal: "window.BMapGLLib.GeoUtils",
    required: false,
    versionLock: {
      versioned: false,
      note: "同 TrackAnimation：自托管镜像、URL 无 tag / commit ⇒ 用 artifactDigest 锁内容。",
    },
    artifactDigest: {
      algo: "sha256",
      value: "3302aebe7d999b6c2676b5d34886eeaddff11cf27d62ff2ea3c03eccaca90576",
    },
    sdkNamespaceMembers: ["Bounds", "Circle", "Polygon", "Polyline"],
    hasPrivateSurface: false,
    privateSurfaceNote: "无。",
    manualInstanceChecks: [
      "Bounds#getSouthWest",
      "Bounds#getNorthEast",
      "Bounds#getCenter",
      "Circle#getCenter",
      "Circle#getRadius",
      "Polyline#getPath",
      "Polygon#getPath",
      "Point#equals",
    ],
    selfInjectedMarkers: [],
    capability: undefined,
    verdict: "compatible",
    migrationPath: {
      kind: "plugin",
      target: "（按官方文档直接使用；本库不封装）",
      note:
        "官方 4.0 **没有**等价的几何谓词集合，也没有原生替代 ⇒ 继续经 `plugins: ['GeoUtils']` " +
        "加载脚本、按官方文档调用静态谓词。它是纯函数集合（无实例 API、无副作用），本库不为其写适配层。",
    },
    basis: ["artifact", "declaration", "runtime"],
    runtime: {
      status: "verified",
      detail:
        "真实 4.0 页面上暴露 10 个静态成员；`getDistance(new Point(0, 0), new Point(0, 1))` 返回 " +
        "111194.87（≈1° 纬度，符合预期）；`isPointInRect` 返回布尔。注：三参形态的 " +
        "`isPointInRect(point, sw, ne)` 返回 `false` 且不抛错——该形态的语义未确认，本库不据此下结论。",
      covered: ["静态成员枚举（10 个）", "`getDistance` 数值正确性", "`isPointInRect` 返回类型"],
      uncovered: [
        "各静态谓词的**签名语义**（只证了「不抛错」+ `getDistance` 数值正确）。",
        "`isPointInRect` 三参形态的语义（返回 `false`，不抛错）。",
        "`DrawingManager` 自行注入它的那条隐式依赖（运行时已观察到，但不受本库管控）。",
      ],
    },
    summary:
      "纯几何谓词集合（`isPointInRect` / `isPointInPolygon` / `isPointInCircle` / `isPointOnPolyline` / " +
      "`isPolylineIntersectArea` / `getDistance` / `getPolylineDistance` / `getPolygonArea` / `degreeToRad` / " +
      "`radToDegree`），只读 `Bounds` / `Circle` / `Polygon` / `Polyline` 的公开读数方法，无私有面、无副作用。" +
      "**结论是 `compatible`**：没有原生替代，但脚本本身可直接使用。",
    residualRisks: [
      "**本仓库自持的 legacy 声明曾经与真实脚本不一致**：那份声明把 `BMapGLLib.GeoUtils` 写成 " +
        "`new GeoUtils(map, options)` 的类，而真实脚本暴露的是**静态谓词命名空间**（没有可用的实例 API）。" +
        "记录这条是因为它解释了「为什么不能拿 legacy 类型当依据」——该声明目录已在 `#26` 删除，" +
        "现在类型面只剩官方 `@baidumap/jsapi-v4-types` 与最小 augmentation。",
      "各静态谓词的签名语义未逐个核对（只证了不抛错 + `getDistance` 数值正确）；" +
        "`isPointInRect` 的三参形态语义未确认。",
    ],
  },
  {
    id: "Mapvgl",
    urlKey: "mapvgl",
    exposedGlobal: "window.mapvgl",
    required: false,
    versionLock: {
      versioned: true,
      note: "URL 内含精确版本 `mapvgl@1.0.0-beta.188`（unpkg）⇒ 版本可追踪，仍同时用 artifactDigest 锁内容。",
    },
    artifactDigest: {
      algo: "sha256",
      value: "20a9101a6419d57ec355c1155e94c6feaa5f788438ce9282566913d9743a0555",
    },
    sdkNamespaceMembers: [],
    hasPrivateSurface: true,
    // MapVGL 没有用到我们 SDK 的实例成员（它挂在视图容器那一步就失败了），故为空。
    manualInstanceChecks: [],
    privateSurfaceNote:
      "私有 JSONP 回调表（成员名 `_rd`）：脚本把函数注册进这张表，并把 `callback=` 指过去。",
    selfInjectedMarkers: ["_hmt"],
    capability: "overlay.mapvgl",
    verdict: "incompatible",
    migrationPath: {
      kind: "none",
      target: "（无）",
      note:
        "没有可用路径：它的适配层要求 legacy 容器面（`getPanes().mapPane`），4.0 上不存在。" +
        "改用官方 4.0 原生图层（`BPointShapeLayer` / `MarkerCluster` / `HeatmapLayer` / " +
        "`LineLayer` / `FillLayer` 等），或按你自行评估的其它可视化方案。",
    },
    basis: ["artifact", "declaration", "runtime"],
    runtime: {
      status: "threw",
      detail:
        "真实 4.0 上 `window.mapvgl` 与 `View` 都在，但 `new mapvgl.View({ map, mapType: \"bmap\" })` " +
        "抛 `Cannot read properties of undefined (reading 'appendChild')`。**根因已定位**（本次新增的读数）：" +
        "产物第 481 行是 `map.getPanes().mapPane.appendChild(div)`，而 4.0 的 `getPanes()` 返回的键是 " +
        "floatPane / markerMouseTarget / floatShadow / labelPane / markerPane —— **没有 `mapPane`**。" +
        "这与「依赖私有回调表」是**两条相互独立**的依据。",
      covered: [
        "脚本加载 + 全局暴露",
        "`new mapvgl.View({ map, mapType: \"bmap\" })` 的抛错现场",
        "抛错时的容器面读数（`getPanes()` 的键、`mapPane` 是否存在）",
      ],
      uncovered: [
        "图层渲染 / 数据上屏：`View` 构造不成立，后续步骤无从谈起。",
        "`mapType: \"blank\"` 或其它适配模式是否有可用路径（未测）。",
      ],
    },
    summary:
      "**硬不兼容**，两条独立依据：①它的 JSONP 传输层直接拿 SDK 的私有回调表（成员名 `_rd`）当注册处" +
      "——这正是 #72（ADR `2026-09-13-private-sdk-surface-removal`）明令本库不得访问的私有面，也不在官方声明里；" +
      "②它的 bmap 适配层要往 `map.getPanes().mapPane` 上挂视图容器，而 4.0 的 panes 里没有 `mapPane`。" +
      "**结论是「没有迁移路径」**：改用 4.0 的原生图层。",
    residualRisks: [
      "加载期会注入百度统计脚本（`window._hmt`）——`builtins.ts` 的 `mapvgl` 分支因此用" +
        "「fetch + 去掉统计片段 + 内联」的方式加载，这条特例只对 MapVGL 成立，不要推广到别的插件。",
      "即使去掉统计脚本，`_rd` 与 `getPanes().mapPane` 这两条也不会因为本库的改动而消失：它们是脚本自己的实现，" +
        "要修只能改上游。本库**不修它**，只把结论写清楚。",
      "`getPanes().mapPane` 这条根因说明它面向的是 legacy 容器模型；上游若发布面向 4.0 的版本，" +
        "本条目需要重跑两个探针再改结论。",
    ],
  },
];

/** 供生成器与用例按 id 取条目。 */
export const PLUGIN_COMPAT_BY_ID: Readonly<Record<BuiltinPluginName, PluginCompatEntry>> =
  Object.fromEntries(
    PLUGIN_COMPAT_INVENTORY.map((entry) => [entry.id, entry]),
  ) as Readonly<Record<BuiltinPluginName, PluginCompatEntry>>;

/** 五个结论取值的运行时清单（生成器 / 用例用同一份来源，避免两处清单漂移）。 */
export const PLUGIN_VERDICTS: readonly PluginVerdict[] = Object.keys(
  PLUGIN_VERDICT_MEANING,
) as PluginVerdict[];
