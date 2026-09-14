/**
 * `probe-plugin-runtime` 的**清单与判定**（纯函数，可单测）
 *
 * 为什么把判定从探针脚本里抽出来：它必须能用桩数据测 —— 尤其是「某个插件的页面根本没跑起来」
 * 这类只在环境抖动时出现的反例（评审 #85 第二轮 P1）：
 *
 * 旧实现在汇总阶段把 `result === null` 的 run **过滤掉**，而 `sdkLoaded` 只看 `runs[0]`。于是
 * 「Mapvgl 那一页 SDK 没起来 ⇒ 它从结果里消失」会被读成「没有异常」⇒ 退出码 0（**漏测却通过**）。
 *
 * 现在逐 run 判定，并且**任何未得出结论的形态都不允许落到 0**：
 *
 * | 退出码 | 含义 | 触发 |
 * | --- | --- | --- |
 * | `0` | 全部成立 | 每个期望的插件都有报告、SDK 都起来、脚本都加载、全局都暴露、独立性断言成立、且没有抛错 |
 * | `1` | 运行时不兼容 / 独立性被打破 | 有插件 `THREW`，或 `globalExistedBeforeLoad === true` |
 * | `2` | **脚手架失败** | 缺 AK / 找不到浏览器（调用方提前返回）、页面脚本自身抛错（`fatal`）、期望的插件没有报告 |
 * | `3` | `blocked`（本轮无法判定，**不是通过**） | 任一页面 `sdkLoaded !== true`，或任一 run 没给出 `result`，或脚本加载/全局暴露不成立 |
 *
 * 优先级：脚手架(2) > blocked(3) > 独立性(1) > 抛错(1) > 通过(0)。
 * 「独立性被打破」排在被 block 的页面之后，是因为被 block 的页面压根没资格谈归因。
 */

/** `BUILTIN_PLUGIN_URLS` 的键。 */
export type PluginUrlKey = "trackAnimation" | "drawingManager" | "geoUtils" | "mapvgl";

export interface PluginSpec {
  /** 插件名（`plugins: [...]` 的字符串名）。 */
  readonly id: string;
  /** `BUILTIN_PLUGIN_URLS` 的键。 */
  readonly key: PluginUrlKey;
  /** 应暴露的全局路径。 */
  readonly global: string;
}

/**
 * 探针要跑的插件清单（**单一事实源**：页面侧与汇总侧都从这里取）。
 *
 * 顺序刻意是 `TrackAnimation → GeoUtils → DrawingManager → Mapvgl`：虽然现在每个插件各用一个
 * 独立文档、顺序已不影响归因，但让「会自行注入 GeoUtils 的 DrawingManager」排在 GeoUtils 之后，
 * 能减少读者对「谁先注入」的误解。
 */
export const PLUGIN_SPECS: readonly PluginSpec[] = [
  { id: "TrackAnimation", key: "trackAnimation", global: "BMapGLLib.TrackAnimation" },
  { id: "GeoUtils", key: "geoUtils", global: "BMapGLLib.GeoUtils" },
  { id: "DrawingManager", key: "drawingManager", global: "BMapGLLib.DrawingManager" },
  { id: "Mapvgl", key: "mapvgl", global: "mapvgl" },
];

/** 期望的插件 id 列表。 */
export function expectedPluginIds(): string[] {
  return PLUGIN_SPECS.map((spec) => spec.id);
}

export type PluginRuntimeExitCode = 0 | 1 | 2 | 3;

export interface PluginRuntimeRunResult {
  id: string;
  /** 脚本加载结果：`ok` 或错误文本。 */
  urlLoaded?: string;
  /** 应暴露的全局是否出现。 */
  globalExposed?: boolean;
  /** 最小路径读数；字符串以 `THREW:` 开头表示运行时抛错。 */
  probe?: unknown;
}

export interface PluginRuntimeRun {
  /** 这一页被要求跑哪个插件（来自 `?only=`）。 */
  only: string | null;
  env: Record<string, unknown>;
  result: PluginRuntimeRunResult | null;
  steps?: Array<{ name: string; detail: unknown }>;
  done?: boolean;
  /** 页面脚本自身抛错（`catch` 到的最外层错误）。 */
  fatal?: string;
}

export interface PluginRuntimeDecision {
  exitCode: PluginRuntimeExitCode;
  /** 人类可读的结论（进 stdout / CI 日志）。 */
  reasons: string[];
  /** 供汇总行打印的计数。 */
  counts: {
    runs: number;
    results: number;
    sdkBlocked: number;
    missingResults: number;
    notIndependent: number;
    scriptFailed: number;
    globalMissing: number;
    threw: number;
  };
}

/** 该 run 是否被判为「运行时抛错」。 */
export function isThrew(result: PluginRuntimeRunResult | null): boolean {
  return typeof result?.probe === "string" && result.probe.startsWith("THREW");
}

export function decidePluginRuntimeExitCode(
  runs: readonly PluginRuntimeRun[],
  expectedIds: readonly string[] = expectedPluginIds(),
): PluginRuntimeDecision {
  const got = runs.map((run) => run.only);
  const missingReports = expectedIds.filter((id) => !got.includes(id));
  const counts = {
    runs: runs.length,
    results: runs.filter((run) => run.result !== null).length,
    sdkBlocked: runs.filter((run) => run.env.sdkLoaded !== true).length,
    missingResults: runs.filter((run) => run.result === null).length,
    notIndependent: runs.filter((run) => run.env.globalExistedBeforeLoad === true).length,
    scriptFailed: runs.filter((run) => run.result !== null && run.result.urlLoaded !== "ok").length,
    globalMissing: runs.filter((run) => run.result !== null && !run.result.globalExposed).length,
    threw: runs.filter((run) => isThrew(run.result)).length,
  };

  // ① 脚手架：期望的插件没有报告（页面没起来 / 导航失败 / 报告写不出来）
  if (missingReports.length > 0) {
    return {
      exitCode: 2,
      reasons: [`缺少报告（脚手架失败）：${missingReports.join(", ")}`],
      counts,
    };
  }

  // ② 脚手架：页面脚本自身抛错
  const fatals = runs.filter((run) => run.fatal).map((run) => run.only ?? "?");
  if (fatals.length > 0) {
    return {
      exitCode: 2,
      reasons: [`页面脚本抛错（脚手架失败）：${fatals.join(", ")}`],
      counts,
    };
  }

  // ③ blocked：任一页面 SDK 没起来 —— 该页拿不到任何结论
  const sdkBlocked = runs.filter((run) => run.env.sdkLoaded !== true).map((run) => run.only ?? "?");
  if (sdkBlocked.length > 0) {
    return {
      exitCode: 3,
      reasons: [`SDK 未就绪（blocked，不是通过）：${sdkBlocked.join(", ")}`],
      counts,
    };
  }

  // ④ blocked：任一 run 没给出 result（**不得**当成「没问题」过滤掉 —— 这正是本轮修掉的漏测）
  const missingResults = runs
    .filter((run) => run.result === null)
    .map((run) => run.only ?? "?");
  if (missingResults.length > 0) {
    return {
      exitCode: 3,
      reasons: [`未得出结论（blocked，不是通过）：${missingResults.join(", ")}`],
      counts,
    };
  }

  // ⑤ 独立性被打破：全局先于我们的脚本存在 ⇒ 读数不能归因给我们那个 URL
  const notIndependent = runs
    .filter((run) => run.env.globalExistedBeforeLoad === true)
    .map((run) => run.only ?? "?");
  if (notIndependent.length > 0) {
    return {
      exitCode: 1,
      reasons: [`证据不独立（全局先于脚本存在）：${notIndependent.join(", ")}`],
      counts,
    };
  }

  // ⑥ 脚本加载失败 / 全局缺失：CDN 或网络不成立 ⇒ blocked
  const blockedByLoad = runs
    .filter(
      (run) => run.result !== null && (run.result.urlLoaded !== "ok" || !run.result.globalExposed),
    )
    .map((run) => run.only ?? "?");
  if (blockedByLoad.length > 0) {
    return {
      exitCode: 3,
      reasons: [`脚本加载 / 全局暴露不成立（blocked）：${blockedByLoad.join(", ")}`],
      counts,
    };
  }

  // ⑦ 真正跑起来了但运行时抛错 ⇒ fail
  const threw = runs.filter((run) => isThrew(run.result)).map((run) => run.only ?? "?");
  if (threw.length > 0) {
    return { exitCode: 1, reasons: [`运行时抛错：${threw.join(", ")}`], counts };
  }

  return { exitCode: 0, reasons: [], counts };
}

/** 探针打印用的汇总行。 */
export function formatPluginRuntimeSummary(decision: PluginRuntimeDecision): string {
  const c = decision.counts;
  return (
    `[plugin-runtime] exit=${decision.exitCode} runs=${c.runs} results=${c.results} ` +
    `sdkBlocked=${c.sdkBlocked} missingResults=${c.missingResults} ` +
    `notIndependent=${c.notIndependent} scriptFailed=${c.scriptFailed} ` +
    `globalMissing=${c.globalMissing} threw=${c.threw}`
  );
}
