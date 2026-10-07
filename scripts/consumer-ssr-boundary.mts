/**
 * SSR 消费者报告的判据（issue #158 工作包 B）
 *
 * 住在 boundary 而非驱动脚本：驱动脚本顶层跑 `main()`，用例 import 它会连带触发真实子进程；
 * 这里只有纯函数，可以喂**合成报告**做行为级反例（合法报告必须过、每类违规必须红）。
 * 与 `consumer-isolation.mts` / `release-identity.mts` 的分层理由相同。
 *
 * 取证分两遍（`bare` / `instrument`，见 runner 文件头），判据也必须分开，否则会得出
 * 「真实纯 Node 能渲染」与「没有 DOM 访问」混在一起的结论：
 *
 * - `bare`：一个全局都不注入，忠实于真实消费者。判「环境真的没有 window/document」
 *   （`typeof` + `in` + `hasOwn` 三条一起）＋「渲染产物」＋「没加载 SDK」。
 * - `instrument`：注入记账 getter，只判**访问**。`document` 一次都不许被读；**渲染阶段**
 *   （renderPhase）不许有任何访问。import 阶段允许 `window` 的守卫式读取 ——
 *   `@vueuse/shared` 的模块求值会 `typeof window`，那是 SSR 安全的标准写法，
 *   而「它真的读到了什么」由 `bare` 那一遍在真正无此全局时仍渲染成功来兜底。
 */
export interface SsrVersions {
  readonly vue: string;
  readonly serverRenderer: string;
  readonly compilerSfc: string;
}

export interface SsrEnvironment {
  readonly typeofWindow: string;
  readonly typeofDocument: string;
  readonly windowIn: boolean;
  readonly documentIn: boolean;
  readonly windowOwn: boolean;
  readonly documentOwn: boolean;
}

export interface SsrReport {
  readonly mode: "bare" | "instrument";
  readonly versions: SsrVersions;
  readonly environmentBefore: SsrEnvironment;
  readonly environmentAfter: SsrEnvironment;
  readonly importPhase: readonly string[];
  readonly renderPhase: readonly string[];
  readonly html: string;
  readonly loaderStatus: string;
  readonly bmapGlobal: string;
}

/** `vue` 与两个配套包必须同版本（三者不同版是「装了两个 Vue」最典型的形态）。 */
const VERSION_FIELDS = ["vue", "serverRenderer", "compilerSfc"] as const;

function assertVersions(versions: SsrVersions): void {
  const values = VERSION_FIELDS.map((field) => versions[field]);
  if (values.some((value) => value.length === 0)) {
    throw new Error(`[consumer-ssr] 版本读数缺失：${JSON.stringify(versions)}`);
  }
  if (new Set(values).size !== 1) {
    throw new Error(
      `[consumer-ssr] vue / @vue/server-renderer / @vue/compiler-sfc 版本不一致：` +
        `${JSON.stringify(versions)}\n` +
        `  三者不同版会同时破坏 SFC 编译与 SSR 渲染，且常常表现为「能渲染但行为怪」。`,
    );
  }
}

/**
 * 环境判据看**六条**，不是只看 `typeof`。
 *
 * 只看 `typeof window === 'undefined'` 的话，「注入了一个返回 undefined 的 getter」与
 * 「真的没有这个全局」在报告里长得一模一样 —— 前者已经不是纯 Node（`'window' in globalThis`
 * 为 true，依赖若用「属性是否存在」判断环境会走另一条路径）。
 */
function assertEnvironment(environment: SsrEnvironment, when: string): void {
  const violations: string[] = [];
  if (environment.typeofWindow !== "undefined") violations.push("typeof window");
  if (environment.typeofDocument !== "undefined") violations.push("typeof document");
  if (environment.windowIn) violations.push("'window' in globalThis");
  if (environment.documentIn) violations.push("'document' in globalThis");
  if (environment.windowOwn) violations.push("hasOwn(globalThis, 'window')");
  if (environment.documentOwn) violations.push("hasOwn(globalThis, 'document')");
  if (violations.length > 0) {
    throw new Error(
      `[consumer-ssr] ${when}环境里存在 window/document：${violations.join(", ")} —— ` +
        `那不是纯 Node。SSR 门禁不得加载 happy-dom / jsdom，也不得注入可见的 DOM 全局。`,
    );
  }
}

function assertRenderedOutput(report: SsrReport): void {
  for (const marker of ["bmap-container", "bmap-canvas-host"]) {
    if (!report.html.includes(marker)) {
      throw new Error(
        `[consumer-ssr] SSR 输出里没有 \`${marker}\` —— 容器 shell 没有渲染出来：\n  ${report.html.slice(0, 300)}`,
      );
    }
  }
  if (!report.html.includes('class="ssr-status">idle<')) {
    throw new Error(
      `[consumer-ssr] SSR 下 <Map> 的 status 不是 \`idle\` —— 服务端不应进入建图状态：\n  ${report.html.slice(0, 300)}`,
    );
  }
  if (!report.html.includes('class="ssr-has-map">no-map<')) {
    throw new Error(
      `[consumer-ssr] SSR 下默认插槽拿到了非 null 的 map —— 服务端不应创建地图实例：\n  ${report.html.slice(0, 300)}`,
    );
  }
  if (report.html.includes("<script")) {
    throw new Error("[consumer-ssr] SSR 输出里出现了 <script> —— 服务端不应注入任何脚本。");
  }
  if (report.loaderStatus !== "notload") {
    throw new Error(
      `[consumer-ssr] 服务端渲染改变了官方 loader 状态：${report.loaderStatus}（应为 notload）—— ` +
        `服务端不应发起 JSAPI 加载。`,
    );
  }
  if (report.bmapGlobal !== "undefined") {
    throw new Error(
      `[consumer-ssr] 服务端出现了全局 BMap（typeof = ${report.bmapGlobal}）—— ` +
        `SDK 不得在无 DOM 的服务端被装配。`,
    );
  }
}

/** `bare` 那一遍：不注入任何全局，两端的真实 Node 环境都必须干净。 */
export function assertBareSsrReport(report: SsrReport): void {
  if (report.mode !== "bare") {
    throw new Error(`[consumer-ssr] 期望 bare 报告，实际 ${report.mode}`);
  }
  assertEnvironment(report.environmentBefore, "渲染前的");
  assertEnvironment(report.environmentAfter, "渲染后的");
  assertVersions(report.versions);
  assertRenderedOutput(report);
}

/**
 * `instrument` 那一遍：只判访问。
 *
 * - `document` 一次都不许被读（浏览器 DOM 的硬信号）；
 * - **渲染阶段**不许有任何访问 —— 组件渲染不得依赖 DOM；
 * - import 阶段的 `window` 守卫式读取允许，但必须留下记录（报告里可见）。
 */
export function assertInstrumentedSsrReport(report: SsrReport): void {
  if (report.mode !== "instrument") {
    throw new Error(`[consumer-ssr] 期望 instrument 报告，实际 ${report.mode}`);
  }
  assertEnvironment(report.environmentBefore, "注入 getter 前的");
  assertVersions(report.versions);

  const documentReads = [...report.importPhase, ...report.renderPhase].filter(
    (name) => name === "document",
  );
  if (documentReads.length > 0) {
    throw new Error(
      `[consumer-ssr] 服务端读取了 document（${documentReads.length} 次）—— ` +
        `任何 document 读取（含守卫式的 ` +
        `\`typeof document\`）都说明这条路径在无 DOM 时不是零依赖。`,
    );
  }
  if (report.renderPhase.length > 0) {
    const counts = countBy(report.renderPhase);
    throw new Error(
      `[consumer-ssr] 渲染阶段访问了浏览器全局：${JSON.stringify(counts)} —— ` +
        `SSR 渲染不得依赖 DOM（import 阶段的守卫式探测是另一回事）。`,
    );
  }
  assertRenderedOutput(report);
}

function countBy(names: readonly string[]): Record<string, number> {
  return names.reduce<Record<string, number>>((acc, name) => {
    acc[name] = (acc[name] ?? 0) + 1;
    return acc;
  }, {});
}
