/**
 * `probe-plugin-runtime` 的**清单与判定**（纯函数，可单测）
 *
 * ## 为什么判定要逐 run、且要有「结构化 status」（评审 #85 第二、三轮）
 *
 * - 第二轮：旧实现把 `result === null` 的 run **过滤掉**、`sdkLoaded` 只看 `runs[0]` ⇒
 *   「某个插件的页面没跑起来」会被读成「没有异常」⇒ 退出码 `0`（漏测却通过）。
 * - 第三轮：即使逐 run 判定了，**成功条件仍然太宽** —— 只要 `probe` 不是以 `THREW` 开头就可能落到 `0`，
 *   而页面存在多种「没执行到最小路径、但不抛异常」的返回（构造器不是 function 返回 `"no-ctor"`、
 *   `mapvgl.View` 不是 function 返回一个形状对象……）。`0` 实际只表达了「脚本加载了、全局存在、没抛错」，
 *   而不是 inventory 想表达的「**已跑通该插件的最小功能路径**」。
 *
 * 因此页面侧改为统一产出结构化状态，并且**每条最小路径的 invariant 由插件自己判定**：
 *
 * ```ts
 * { status: "verified" | "threw" | "inconclusive", detail, reason?, checks?, error? }
 * ```
 *
 * 判定只看 `status`，不再从字符串里猜：
 *
 * | 退出码 | 含义 | 触发 |
 * | --- | --- | --- |
 * | `0` | 全部成立 | 每个期望的插件都有报告、SDK 都起来、脚本都加载、全局都暴露、独立性成立，且每次读数都与 inventory 记录的 `runtime.status` **一致** |
 * | `1` | 运行时不兼容 / 证据不成立 | 独立性被打破；或 `status` 与 inventory 不一致（说明 inventory 已过期）；或某个插件 `threw` **却没有登记过期望值** |
 * | `2` | **脚手架失败** | 缺 AK / 找不到浏览器（调用方提前返回）、页面脚本自身抛错（`fatal`）、期望的插件没有报告 |
 * | `3` | `blocked`（本轮无法判定，**不是通过**） | 任一页 `sdkLoaded !== true`；**任一页地图夹具没建成（`mapCreated !== true`）**；任一 run 没给出 `result`；`status` 缺失或不是三个取值之一；脚本加载/全局暴露不成立；**`inconclusive`（最小路径 invariant 不成立）** |
 *
 * 优先级：脚手架(2) > blocked(3) > fail(1) > 通过(0)。这与 smoke 门禁的
 * 「先按能不能判定分，再按有没有失败分」一致 —— 一个插件没跑通最小路径时，
 * 我们不该拿另一个插件的观察当结论。
 *
 * ## #43 修正的第 ⑩ 条：已登记的 `threw` 是**结论**，不是回归
 *
 * 旧规则写的是「有插件 `threw` ⇒ `1`」，于是 MapVGL 这种「结论就是它在 4.0 上抛错」的条目
 * 会让这个探针**永远红**。把探针搬进 nightly（可选插件 smoke 单独执行）之后，这条规则会让
 * 每天都产生一次假警报，而假警报训练出来的习惯是「不看它」——那比没有门禁更坏。
 *
 * 现在：`threw` 且与 inventory 的 `runtime.status` **一致** ⇒ 是**已登记的结论**，不算 fail
 * （它仍然进 `counts.threw`，看得见）；`threw` 但没有登记过期望值 ⇒ `1`（新问题）。
 * 「本来 verified 的插件开始抛错」这条回归由 ⑨ 的 `statusMismatch` 抓住，没有漏。
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
 * 顺序是 `TrackAnimation → GeoUtils → DrawingManager → Mapvgl`：虽然每个插件各用一个独立文档、
 * 顺序已不影响归因，但让「会自行注入 GeoUtils 的 DrawingManager」排在 GeoUtils 之后，
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

/** 页面侧给出的小结：三态，**只有 `verified` 才算跑通最小路径**。 */
export type PluginProbeStatus = "verified" | "threw" | "inconclusive";

export const PLUGIN_PROBE_STATUSES: readonly PluginProbeStatus[] = [
  "verified",
  "threw",
  "inconclusive",
];

export interface PluginProbeCheck {
  /** invariant 的名字（进 detail，便于核对是哪一条没成立）。 */
  name: string;
  ok: boolean;
  detail?: unknown;
}

export interface PluginProbeOutcome {
  status: PluginProbeStatus;
  /** 人读说明（`verified` / `inconclusive` 为什么）。 */
  detail?: unknown;
  /** `inconclusive` 的原因（短句）。 */
  reason?: string;
  /** `threw` 时页面捕获到的错误文本。 */
  error?: string;
  /** 逐条 invariant 的结果。 */
  checks?: PluginProbeCheck[];
  /**
   * **不进判定**的补充读数（M8-ADAPTERS-ADVANCED / #43）。
   *
   * 与 `checks` 的分工是刻意的：`checks` 全部成立才算跑通最小路径，所以只有**在真实 4.0 上
   * 确定会成立**的性质才能进 `checks`；而像「`setSpeed()` 调私有成员会不会抛」「mapvgl 抛错点
   * 读的是哪个容器成员」这类**结果未知**的观察，写进 `checks` 会让门禁随上游行为天天红，
   * 写掉又等于没测。它们进 `readings`：如实记录，用于填 inventory 的结论，
   * **不参与 `status` 判定**。
   */
  readings?: unknown;
}

export interface PluginRuntimeRunResult {
  id: string;
  /** 脚本加载结果：`ok` 或错误文本。 */
  urlLoaded?: string;
  /** 应暴露的全局是否出现。 */
  globalExposed?: boolean;
  /** 结构化小结；**不再用字符串形状猜成败**。 */
  probe?: PluginProbeOutcome | null;
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

/** 期望值：`status` 来自 inventory 的 `runtime.status`；缺省表示「不比对」。 */
export interface PluginRuntimeExpectation {
  id: string;
  status?: PluginProbeStatus;
}

export type PluginRuntimeExitCode = 0 | 1 | 2 | 3;

export interface PluginRuntimeDecision {
  exitCode: PluginRuntimeExitCode;
  reasons: string[];
  counts: {
    runs: number;
    results: number;
    sdkBlocked: number;
    /** 地图夹具没建成的页面数（见 ③b）。 */
    mapNotReady: number;
    missingResults: number;
    notIndependent: number;
    scriptFailed: number;
    globalMissing: number;
    invalidStatus: number;
    inconclusive: number;
    verified: number;
    threw: number;
    statusMismatch: number;
  };
}

/** 读取结构化状态；不是三个取值之一（含 `undefined` / 旧的字符串形状）都返回 `null`。 */
export function readProbeStatus(result: PluginRuntimeRunResult | null): PluginProbeStatus | null {
  const status = result?.probe?.status;
  return typeof status === "string" &&
    (PLUGIN_PROBE_STATUSES as readonly string[]).includes(status)
    ? (status as PluginProbeStatus)
    : null;
}

function idsOf(runs: readonly PluginRuntimeRun[], predicate: (run: PluginRuntimeRun) => boolean): string[] {
  return runs.filter(predicate).map((run) => run.only ?? "?");
}

export function decidePluginRuntimeExitCode(
  runs: readonly PluginRuntimeRun[],
  expectations: readonly PluginRuntimeExpectation[] = PLUGIN_SPECS.map((spec) => ({ id: spec.id })),
): PluginRuntimeDecision {
  const expectedIds = expectations.map((entry) => entry.id);
  const got = runs.map((run) => run.only);
  const counts = {
    runs: runs.length,
    results: runs.filter((run) => run.result !== null).length,
    sdkBlocked: runs.filter((run) => run.env.sdkLoaded !== true).length,
    mapNotReady: runs.filter((run) => run.env.mapCreated !== true).length,
    missingResults: runs.filter((run) => run.result === null).length,
    notIndependent: runs.filter((run) => run.env.globalExistedBeforeLoad === true).length,
    scriptFailed: runs.filter((run) => run.result !== null && run.result.urlLoaded !== "ok").length,
    globalMissing: runs.filter((run) => run.result !== null && !run.result.globalExposed).length,
    invalidStatus: runs.filter((run) => run.result !== null && readProbeStatus(run.result) === null)
      .length,
    inconclusive: runs.filter((run) => readProbeStatus(run.result) === "inconclusive").length,
    verified: runs.filter((run) => readProbeStatus(run.result) === "verified").length,
    threw: runs.filter((run) => readProbeStatus(run.result) === "threw").length,
    statusMismatch: 0,
  };

  // ① 脚手架：期望的插件没有报告（页面没起来 / 导航失败 / 报告写不出来）
  const missingReports = expectedIds.filter((id) => !got.includes(id));
  if (missingReports.length > 0) {
    return {
      exitCode: 2,
      reasons: [`缺少报告（脚手架失败）：${missingReports.join(", ")}`],
      counts,
    };
  }

  // ② 脚手架：页面脚本自身抛错
  const fatals = idsOf(runs, (run) => Boolean(run.fatal));
  if (fatals.length > 0) {
    return { exitCode: 2, reasons: [`页面脚本抛错（脚手架失败）：${fatals.join(", ")}`], counts };
  }

  // ③ blocked：任一页面 SDK 没起来 —— 该页拿不到任何结论
  const sdkBlocked = idsOf(runs, (run) => run.env.sdkLoaded !== true);
  if (sdkBlocked.length > 0) {
    return {
      exitCode: 3,
      reasons: [`SDK 未就绪（blocked，不是通过）：${sdkBlocked.join(", ")}`],
      counts,
    };
  }

  // ③b blocked：**地图夹具**没建成 —— 该页的结论不可用
  //
  // 为什么必须单独判（评审 2026-09-21 P1）：`status` 只描述「这个插件的最小路径跑成什么样」。
  // 地图没建成时 `map` 是 null，插件会因为拿到无效 map 而抛错；若那个插件的 inventory 期望
  // **本来就是** `threw`（MapVGL 就是），结果会「与 inventory 一致」并落到 0 ——
  // 把「根本没在有效地图上验过」读成「确认它仍然如预期不兼容」。这是纯粹的假绿。
  // 所以「地图夹具就绪」是**判定前置条件**，与任何插件的结论无关。
  const mapNotReady = idsOf(runs, (run) => run.env.mapCreated !== true);
  if (mapNotReady.length > 0) {
    return {
      exitCode: 3,
      reasons: [
        `地图夹具未就绪（blocked，不是通过）：${mapNotReady.join(", ")}` +
          `（该页在地图构造 / 初始化那一步就没走通，插件结论不可用）`,
      ],
      counts,
    };
  }

  // ④ blocked：任一 run 没给出 result（**不得**当成「没问题」过滤掉）
  const missingResults = idsOf(runs, (run) => run.result === null);
  if (missingResults.length > 0) {
    return {
      exitCode: 3,
      reasons: [`未得出结论（blocked，不是通过）：${missingResults.join(", ")}`],
      counts,
    };
  }

  // ⑤ blocked：`status` 缺失 / 不是三个取值之一（页面没走结构化小结，或脚本改坏了）
  const invalidStatus = idsOf(runs, (run) => run.result !== null && readProbeStatus(run.result) === null);
  if (invalidStatus.length > 0) {
    return {
      exitCode: 3,
      reasons: [
        `小结不是结构化 status（blocked，不是通过）：${invalidStatus.join(", ")}` +
          `（取值必须属于 ${PLUGIN_PROBE_STATUSES.join(" / ")}）`,
      ],
      counts,
    };
  }

  // ⑥ blocked：脚本加载失败 / 全局没暴露 —— CDN 或网络不成立
  const blockedByLoad = idsOf(
    runs,
    (run) => run.result !== null && (run.result.urlLoaded !== "ok" || !run.result.globalExposed),
  );
  if (blockedByLoad.length > 0) {
    return {
      exitCode: 3,
      reasons: [`脚本加载 / 全局暴露不成立（blocked）：${blockedByLoad.join(", ")}`],
      counts,
    };
  }

  // ⑦ blocked：**最小路径 invariant 没成立** —— 这是第三轮补的那一层：
  //    「脚本加载了、全局存在、没抛错」不等于「跑通了插件的最小功能路径」。
  const inconclusive = idsOf(runs, (run) => readProbeStatus(run.result) === "inconclusive");
  if (inconclusive.length > 0) {
    const reasons = runs
      .filter((run) => readProbeStatus(run.result) === "inconclusive")
      .map((run) => `${run.only ?? "?"}: ${run.result?.probe?.reason ?? "最小路径未跑通"}`);
    return {
      exitCode: 3,
      reasons: [`最小路径未跑通（blocked，不是通过）：${reasons.join("；")}`],
      counts,
    };
  }

  // ⑧ fail：独立性被打破（全局先于我们的脚本存在 ⇒ 读数不能归因给我们那个 URL）
  const notIndependent = idsOf(runs, (run) => run.env.globalExistedBeforeLoad === true);
  if (notIndependent.length > 0) {
    return {
      exitCode: 1,
      reasons: [`证据不独立（全局先于脚本存在）：${notIndependent.join(", ")}`],
      counts,
    };
  }

  // ⑨ fail：读数与 inventory 记录的 `runtime.status` 不一致 —— inventory 已过期，必须更新
  const expectedById = new Map(
    expectations.filter((entry) => entry.status).map((entry) => [entry.id, entry.status!]),
  );
  const mismatches: string[] = [];
  for (const run of runs) {
    const expected = expectedById.get(run.only ?? "");
    if (!expected) continue;
    const actual = readProbeStatus(run.result);
    if (actual !== expected) {
      mismatches.push(`${run.only}: inventory 记 ${expected}，本次实测 ${actual}`);
    }
  }
  counts.statusMismatch = mismatches.length;
  if (mismatches.length > 0) {
    return {
      exitCode: 1,
      reasons: [`与 inventory 不一致（请更新 inventory）：${mismatches.join("；")}`],
      counts,
    };
  }

  // ⑩ fail：真正跑起来了但**没有被登记为结论**的运行时抛错（#43 修正）。
  //    已登记的 `threw`（inventory 的 `runtime.status` 就是 `threw`）是结论，不是回归 ——
  //    否则「结论就是它在 4.0 上抛错」的条目会让 nightly 每天红一次，而假警报会训练人忽略门禁。
  //    「本来 verified 的插件开始抛错」这条回归由 ⑨ 的 statusMismatch 抓，没有漏。
  const threw = runs.filter(
    (run) =>
      readProbeStatus(run.result) === "threw" &&
      expectedById.get(run.only ?? "") !== "threw",
  )
  if (threw.length > 0) {
    return {
      exitCode: 1,
      reasons: [
        `未登记的运行时抛错：${threw.map((run) => run.only ?? "?").join(", ")}` +
          `（inventory 没有把这些条目的 runtime.status 记成 threw）`,
      ],
      counts,
    };
  }

  return { exitCode: 0, reasons: [], counts };
}

/** 探针打印用的汇总行。 */
export function formatPluginRuntimeSummary(decision: PluginRuntimeDecision): string {
  const c = decision.counts;
  return (
    `[plugin-runtime] exit=${decision.exitCode} runs=${c.runs} results=${c.results} ` +
    `sdkBlocked=${c.sdkBlocked} mapNotReady=${c.mapNotReady} missingResults=${c.missingResults} ` +
    `invalidStatus=${c.invalidStatus} inconclusive=${c.inconclusive} verified=${c.verified} ` +
    `threw=${c.threw} statusMismatch=${c.statusMismatch} ` +
    `notIndependent=${c.notIndependent} scriptFailed=${c.scriptFailed} globalMissing=${c.globalMissing}`
  );
}
