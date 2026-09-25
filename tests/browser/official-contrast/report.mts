/**
 * 官方对照的**真实浏览器档**报告逻辑（issue #140，档位二）
 *
 * 与 Fake 档（`tests/performance/official-contrast/report.mts`）的关系：判定口径**一致**、
 * 事实来源不同。Fake 档用 Fake v4 测「建了多少资源、发了多少 SDK 写入」；本档用**真实
 * JSAPI 4.0 + 真实浏览器**补上 Fake 档 `notMeasured` 的四项：long task、真实重绘、帧调度
 * （FPS）、堆增长。
 *
 * ## 为什么仍是「纯函数」
 *
 * 与 `live-performance/report.mts` 同一分工：只吃 JSON 形状的入参、只吐文本与退出码。
 * 页面在浏览器里跑、编排脚本在 Node 里跑，**两侧共用同一份判定与渲染**——因此可以用
 * 合成报告单测退出码与分节，不必起浏览器。
 *
 * ## 退出码（沿用 Fake 档的合同）
 *
 * | 码 | 含义 |
 * | --- | --- |
 * | `0` | 采齐、信封自检通过、不变式未破 |
 * | `1` | **不变式被破坏**（本库侧的架构预期没了） |
 * | `2` | 脚手架失败（含 **AK 缺失**——它让本档跑不起来，属脚手架前置不成立） |
 * | `3` | blocked——**不是通过** |
 *
 * ## AK 绝不写入任何产物
 *
 * AK 只经 `BAIDU_MAP_AK` / `--ak=` 进入，并由编排脚本经 **CDP** 注入页面
 * （**不进页面 URL、不进 chrome argv、不进 vite env**——三条路径各自会把 AK 送进
 * `ps` / CI 的 job log / 被 vite 内联的构建产物）。因此 `redactAk` 在**两条出口**上
 * 仍过一遍（stdout 与落盘 JSON）：页面错误消息会进 `report.fatal` / `notes`，
 * 那条出口按「消息可能含敏感串」处理。本模块**不含**任何 AK 字面量。
 */

/** 报告载荷版本。 */
export const LIVE_CONTRAST_REPORT_VERSION = 1;

/** 官方基线版本（**必须**精确等于票面锁定的 1.0.1；沿用 Fake 档的常量，不另抄一份）。 */
export { OFFICIAL_BASELINE_VERSION } from "../../performance/official-contrast/report.mts";

/**
 * 本档能采的窗口。每一项都对应 Fake 档 `notMeasured` 里的一条。
 *
 * `firstFrame` / `redraw` / `fps` 沿用 `live-performance` 的**同名同口径**窗口定义
 * （那张计时协议表是 #131 两轮评审定下的），`longTaskMs` 补本档独有的交互阻塞读数。
 */
export const LIVE_CONTRAST_WINDOWS = ["firstFrame", "redraw", "longTaskMs", "fps"] as const;
export type LiveContrastWindow = (typeof LIVE_CONTRAST_WINDOWS)[number];

/** 一个窗口的读数：`{start,end}` 之间的墙钟 + 落在该窗口里的 long task。 */
export interface LiveContrastSample {
  readonly durationMs: number;
  /** 落在该窗口内的长任务**条数**。 */
  readonly longTaskCount: number;
  /** 落在该窗口内的最长长任务（毫秒）。 */
  readonly longestTaskMs: number;
  /** 窗口结束后 1s rAF 采到的帧率（仅 `fps` 窗口有值，其余为 `null`）。 */
  readonly fps: number | null;
}

/** 某一侧（某个库）在一组场景上的读数。 */
export interface LiveContrastSideReadings {
  readonly scenario: string;
  readonly firstFrame: LiveContrastSample;
  readonly redraw: LiveContrastSample;
  readonly longTaskMs: LiveContrastSample;
  readonly fps: LiveContrastSample;
  /**
   * 换数据后的堆增长（字节）。
   *
   * 真实浏览器里**没有** `gc()`，因此这个值是「采样间隔内的净增长」，含未回收的垃圾——
   * 只在同一浏览器、同一场景、同一数据下**两侧互比**有意义，**绝不**跨机比较。
   */
  readonly heapGrowthBytes: number | null;
}

export interface LiveContrastReport {
  readonly version: number;
  readonly mode: "live";
  readonly runId: string;
  /** 页面是否真的用上了 AK（缺 AK 时编排脚本会直接 blocked，这一项恒为 true）。 */
  readonly akUsed: boolean;
  readonly done: boolean;
  readonly fatal: string | null;
  readonly blockedReason: string | null;
  readonly notes: readonly string[];
  /** 浏览器身份（票面要求记录 hardware / browser / SDK 版本）。 */
  readonly browser: {
    readonly userAgent: string;
    readonly sdkVersion: string;
    readonly engine: string;
  };
  /** 数据集版本（与 Fake 档同一份 `dataset.ts`）。 */
  readonly datasetVersion: string;
  /** 本库版本 / 官方版本（官方必须是 1.0.1）。 */
  readonly oursVersion: string;
  readonly officialVersion: string;
  /** 两侧读数（本库 / 官方）；`official` 为 `null` = 本场景官方无等价物。 */
  readonly ours: readonly LiveContrastSideReadings[];
  readonly official: readonly LiveContrastSideReadings[] | null;
}

export type LiveContrastExitCode = 0 | 1 | 2 | 3;

/**
 * 页面**边跑边填**用的可变草稿。
 *
 * `LiveContrastReport` 是**线上格式**（全 `readonly`）——它会被 JSON 序列化、被判定函数
 * 读，写完就不该再改。页面却必须在测量过程中逐步填（先建骨架、ready 后补读数、失败时
 * 改 `fatal`），直接拿 `LiveContrastReport` 当可变对象会逼出一堆 `@ts-expect-error`。
 *
 * 草稿只去**掉 readonly**，字段一个不多一个不少——因此 `publish()` 处那次赋值本身就是
 * 「草稿是否仍与线上格式同形」的编译期检查：字段名/类型漂了就编不过。
 *
 * ⚠️ 数组要**显式**换成可变类型：`-readonly[K]` 只摘字段上的 `readonly`，
 * 摘不掉 `readonly string[]` 这种**元素**上的只读——页面的 `notes.push(...)` /
 * `ours.push(...)` 需要真正的可变数组。
 */
export interface LiveContrastReportDraft {
  version: number;
  mode: "live";
  runId: string;
  akUsed: boolean;
  done: boolean;
  fatal: string | null;
  blockedReason: string | null;
  notes: string[];
  browser: { userAgent: string; sdkVersion: string; engine: string };
  datasetVersion: string;
  oursVersion: string;
  officialVersion: string;
  ours: LiveContrastSideReadings[];
  official: LiveContrastSideReadings[] | null;
}

/* ------------------------------------------------------------------ 信封 */

export function checkLiveContrastEnvelope(
  report: Pick<LiveContrastReport, "version" | "mode" | "runId" | "akUsed" | "datasetVersion">,
  expected: { runId: string; datasetVersion: string },
): string[] {
  const issues: string[] = [];
  if (report.version !== LIVE_CONTRAST_REPORT_VERSION) issues.push("LIVE_CONTRAST_VERSION_MISMATCH");
  if (report.mode !== "live") issues.push("LIVE_CONTRAST_MODE_MISMATCH");
  if (report.runId !== expected.runId) issues.push("LIVE_CONTRAST_RUN_ID_MISMATCH");
  if (expected.datasetVersion !== report.datasetVersion) {
    issues.push("LIVE_CONTRAST_DATASET_VERSION_MISMATCH");
  }
  if (report.akUsed !== true) issues.push("LIVE_CONTRAST_AK_NOT_USED");
  return issues;
}

/* ------------------------------------------------------------------ 判定 */

export interface LiveContrastDecision {
  readonly exitCode: LiveContrastExitCode;
  readonly ok: boolean;
  readonly reasons: readonly string[];
}

/**
 * 退出码判定（纯函数）。
 *
 * 与 Fake 档一致：**没有**「比官方慢就算回退」。本档同样只出读数，唯一能判 1 的位置留给
 * 不变式——而真实浏览器里「本库是否重建了实例」这类判断需要 SDK 侧的可靠信号，本档骨架
 * 尚未接，因此 `invariants` 默认空数组（接线到位前不假装有门禁）。
 */
export function decideLiveContrastExit(input: {
  envelopeIssues: readonly string[];
  fatal: string | null;
  blockedReason: string | null;
  done: boolean;
  expectedScenarioCount: number;
  scenarioCount: number;
}): LiveContrastDecision {
  const reasons: string[] = [];
  for (const issue of input.envelopeIssues) reasons.push(`ENVELOPE: ${issue}`);
  if (input.fatal) reasons.push(`FATAL: ${input.fatal}`);
  if (input.blockedReason) reasons.push(`BLOCKED: ${input.blockedReason}`);
  if (input.done && input.scenarioCount < input.expectedScenarioCount) {
    reasons.push(
      `INCOMPLETE: 场景 ${input.scenarioCount}/${input.expectedScenarioCount}（缺项不能当通过）`,
    );
  }
  if (!input.done && !input.fatal && !input.blockedReason) {
    reasons.push("INCOMPLETE: 页面未 done 且未给出 blockedReason（无法归因）");
  }
  if (input.envelopeIssues.length > 0 || input.fatal) {
    return { exitCode: 2, ok: false, reasons };
  }
  if (!input.done || input.blockedReason || input.scenarioCount < input.expectedScenarioCount) {
    return { exitCode: 3, ok: false, reasons };
  }
  return { exitCode: 0, ok: true, reasons };
}

/* ------------------------------------------------------------------ 脱敏 */

/**
 * 抹掉消息里可能出现的 `ak=` 查询参数。
 *
 * AK **已经**不进页面 URL（走 CDP 注入，见文件头），所以这里不是第一道防线——第一道
 * 防线是「根本不把它放进任何会被别人读到的通道」。这一层按「消息可能含敏感串」保留：
 * 页面错误消息会进 `report.fatal` / `notes`，而错误消息的形状不受我们控制。
 *
 * **两条出口都要过**（stdout 与落盘 JSON），漏一条就等于把 AK 写进了 CI 日志。
 *
 * 这是与 `live-performance/report.mts` 同一函数的同形实现（各自模块自持，因为页面侧与
 * Node 侧的 import 边界不同）；正则刻意保持一致，便于日后收成一处。
 */
export function redactAk(text: string): string {
  return text.replace(/([?&]ak=)[^&#\s"')]+/gi, "$1<redacted>");
}

/* ------------------------------------------------------------------ 渲染 */

function round(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return "-";
  const factor = 10 ** digits;
  return String(Math.round(value * factor) / factor);
}

function sampleCell(sample: LiveContrastSample): string {
  return (
    `${round(sample.durationMs)}ms · tasks=${sample.longTaskCount} · ` +
    `longest=${round(sample.longestTaskMs)}ms` +
    (sample.fps === null ? "" : ` · fps=${round(sample.fps, 1)}`)
  );
}

function sideRows(readings: readonly LiveContrastSideReadings[]): string[] {
  if (readings.length === 0) return ["  （无读数）"];
  const rows: string[] = [];
  for (const entry of readings) {
    rows.push(`  ${entry.scenario}`);
    rows.push(`    firstFrame  ${sampleCell(entry.firstFrame)}`);
    rows.push(`    redraw      ${sampleCell(entry.redraw)}`);
    rows.push(`    longTaskMs  ${sampleCell(entry.longTaskMs)}`);
    rows.push(`    fps         ${sampleCell(entry.fps)}`);
    rows.push(`    heap        +${entry.heapGrowthBytes ?? "-"} B`);
  }
  return rows;
}

/**
 * 人读报告（page / node 两段分开，沿用 #123 的口径）。
 *
 * - `page` 段：浏览器内测到的逐场景窗口 + 浏览器 / SDK / 数据集身份；
 * - `node` 段：判定与退出码。
 *
 * **本档不做差值列**：真实浏览器里两侧的绝对值受机器负载、瓦片网络、AK 配额影响太大，
 * 逐项相减会得到一个看起来精确、实际无意义的数。两侧并排给出，让人自己看形状。
 */
export function formatLiveContrastReport(input: {
  report: LiveContrastReport;
  decision: LiveContrastDecision;
}): string {
  const { report, decision } = input;
  const lines: string[] = [];
  lines.push("== 官方对照基准（#140 · 真实浏览器档）==");
  lines.push(
    `env   ours=${report.oursVersion} vs official=${report.officialVersion} dataset=v${report.datasetVersion}`,
  );
  lines.push(
    `env   browser=${report.browser.userAgent} · engine=${report.browser.engine} · sdk=v${report.browser.sdkVersion}`,
  );
  lines.push(`run   id=${report.runId} akUsed=${report.akUsed} done=${report.done}`);
  if (report.fatal) lines.push(`run   FATAL: ${report.fatal}`);
  if (report.blockedReason) lines.push(`run   BLOCKED: ${report.blockedReason}`);
  for (const note of report.notes) lines.push(`run   NOTE: ${note}`);
  lines.push("");
  lines.push("--- page: bmap-vue ---");
  lines.push(...sideRows(report.ours));
  lines.push("");
  lines.push(
    report.official
      ? "--- page: @baidumap/vue-bmap（官方有等价物的场景）---"
      : "--- page: @baidumap/vue-bmap —— 本轮未产出对照读数 ---",
  );
  if (report.official) lines.push(...sideRows(report.official));
  lines.push("");
  lines.push("--- node: envelope ---");
  lines.push(`node  exit=${decision.exitCode} ok=${decision.ok}`);
  for (const reason of decision.reasons) lines.push(`node  ${reason}`);
  lines.push("");
  lines.push("本档不做差值列：真实浏览器里两侧的绝对值受负载 / 瓦片网络 / AK 配额影响，");
  lines.push("逐项相减会得到一个看起来精确、实际无意义的数。两侧并排给出，看形状即可。");
  return lines.join("\n");
}
