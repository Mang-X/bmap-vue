/**
 * 真实浏览器档性能读数的**纯逻辑**（#123）
 *
 * 与 `tests/browser/jsapi-v4/report.mts` / `scripts/plugin-load-channel-report.mts` 同样的分工：
 * 本文件只吃 JSON 形状的入参、只吐文本与退出码——不 import vitest、不碰 `window`、不读
 * `process.argv`。页面与 Node orchestrator 共用同一份渲染与判定，用例可直接构造读数钉它。
 *
 * ## 退出码（**永不返回 1**）
 *
 * 本票是**无阈值的读数采集**，不是门禁：没有「回退」这一态，因此不存在退出码 1。
 *
 * | 码 | 含义 |
 * | --- | --- |
 * | `0` | 读数采齐、信封自检通过 |
 * | `2` | 脚手架失败（缺报告 / 信封不匹配 / 页面 fatal） |
 * | `3` | blocked（缺 AK、SDK 没 ready、前置读数不成立）——**不是通过** |
 *
 * ## 信封自检
 *
 * 页面若意外按另一档跑（或没带 AK），Node 跟着报告自报的字段取数会拿到**另一轮**的读数。
 * `runId` / `akUsed` / `mode` 三者必须与本轮请求一致，不一致按脚手架失败（2）处理。
 */

/** 本套读数的载荷版本：报告要能自证「跑的是哪一版候选」。 */
export const LIVE_PERF_REPORT_VERSION = 1;

/** 图层族（issue 验收：4 类读数 × 3 类图层）。 */
export const LIVE_PERF_LAYERS = ["pointCollection", "line", "fill"] as const;
export type LivePerfLayer = (typeof LIVE_PERF_LAYERS)[number];

/** 读数族（issue 目标 1~3；对照表由 Node 侧拼 Fake 基线）。 */
export const LIVE_PERF_FAMILIES = [
  "firstFrame",
  "setData",
  "redraw",
  "sdkSetData",
  "longTask",
  "fps",
] as const;
export type LivePerfFamily = (typeof LIVE_PERF_FAMILIES)[number];

export interface LivePerfSample {
  /**
   * 单次窗口耗时（毫秒）。口径见 `main.ts` 文件头「计时协议」表：
   * `setData` = 赋值 → settle（**Fake 对照窗**）；`redraw` = settle → paint；
   * `firstFrame` = 该图层独立 mount → ready 后第一次 paint（**不含**之后的稳定期）。
   */
  durationMs: number;
  /**
   * 与该窗口时间重叠的 long task 条数。
   * 页面级 collector 收集后按 `startTime/duration` 归属（窗末 flush + `takeRecords`，
   * 不是窗末直接 `disconnect`——#131 复审第 1 条）。
   */
  longTaskCount: number;
  /** 窗口内最长 long task（毫秒）；无则为 0。 */
  longestTaskMs: number;
}

export interface LivePerfLayerReadings {
  layer: LivePerfLayer;
  /** 数据量（issue 固定 50k）。 */
  size: number;
  /** 首帧：**本图层独立挂载**的 mount → ready 后第一次 paint（不含稳定期；不是三图层联合值的复制）。 */
  firstFrame: LivePerfSample;
  /**
   * 换数据 · Fake 对照窗：预生成数据的 `setItems` → settle（≈ Fake `data.replace.*`）。
   * **只有这一族进 `buildFakeContrast`**。
   */
  setData: LivePerfSample;
  /** 换数据 · paint 窗：settle 之后 → 2×rAF（端到端 redraw，不进 Fake 对照）。 */
  redraw: LivePerfSample;
  /**
   * 原生 `prototype.setData` 返回墙钟（ms）；本轮没进原生调用则 `null`。
   * **不进 Fake 对照**（Fake 没有可包装的真实类）。
   */
  sdkSetDataMs: number | null;
  /** 换数据后的 **真实 FPS**（frames/second，不是 ÷60 比值；`null` = 没采到）。 */
  fps: number | null;
}

export interface LivePerfEnvelope {
  runId: string;
  akUsed: boolean;
  mode: "live";
}

export interface LivePerfReport {
  version: number;
  runId: string;
  mode: "live";
  akUsed: boolean;
  /** 页面是否成功写出全部读数（`false` ⇒ Node 按 2/3 结算）。 */
  done: boolean;
  /** 页面级 fatal（脚本自身抛错）；非空 ⇒ 退出码 2。 */
  fatal: string | null;
  /** 外部前置（AK / SDK ready）不成立的原因；`done=false` 且无 fatal 时用于 3。 */
  blockedReason: string | null;
  /**
   * 被忽略的可恢复噪声（SDK worker `importScripts` 等），进报告而非只 `console.warn`，
   * 便于 nightly artifact 看到发生过什么（#131 复审非 blocker 建议）。
   */
  notes: string[];
  env: {
    userAgent: string;
    /** 浏览器主版本（报告要写明浏览器版本，issue 测试要求）。 */
    browser: string;
    /** 数据集版本（与 `tests/performance/dataset.ts` 的 `DATASET_VERSION` 对齐）。 */
    datasetVersion: string;
    size: number;
  };
  readings: LivePerfLayerReadings[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export type LivePerfExitCode = 0 | 2 | 3;

/* ------------------------------------------------------------------ 信封 */

/**
 * 信封自检（与 smoke 的 `checkReportEnvelope` 同口径）。
 *
 * 返回 issue 列表；空数组 = 通过。`mode` 恒为 `live`：本套没有 fixture 档
 * （页面测量逻辑只能真浏览器跑）。
 */
export function checkLivePerfEnvelope(
  report: Pick<LivePerfReport, "runId" | "akUsed" | "mode" | "version">,
  expected: { runId: string; requireAk: boolean },
): string[] {
  const issues: string[] = [];
  if (report.version !== LIVE_PERF_REPORT_VERSION) issues.push("LIVE_PERF_VERSION_MISMATCH");
  if (report.mode !== "live") issues.push("LIVE_PERF_MODE_MISMATCH");
  if (report.runId !== expected.runId) issues.push("LIVE_PERF_RUN_ID_MISMATCH");
  if (expected.requireAk && report.akUsed !== true) issues.push("LIVE_PERF_AK_NOT_USED");
  return issues;
}

/* ------------------------------------------------------------------ 判定 */

export interface LivePerfDecision {
  exitCode: LivePerfExitCode;
  ok: boolean;
  reasons: string[];
}

/**
 * 退出码判定（纯函数；优先级：脚手架(2) > blocked(3) > 通过(0)）。
 *
 * **永不返回 1**：本票不设阈值，没有「回退」这一态。
 */
export function decideLivePerfExit(input: {
  envelopeIssues: string[];
  fatal: string | null;
  blockedReason: string | null;
  done: boolean;
  readingCount: number;
  expectedReadingCount: number;
}): LivePerfDecision {
  const reasons: string[] = [];
  for (const issue of input.envelopeIssues) reasons.push(`ENVELOPE: ${issue}`);

  if (input.fatal) reasons.push(`FATAL: ${input.fatal}`);
  if (!input.done && !input.fatal && !input.blockedReason) {
    reasons.push("INCOMPLETE: 页面未 done 且未给出 blockedReason（无法归因）");
  }
  if (input.blockedReason) reasons.push(`BLOCKED: ${input.blockedReason}`);
  if (input.done && input.readingCount < input.expectedReadingCount) {
    reasons.push(
      `INCOMPLETE: 读数 ${input.readingCount}/${input.expectedReadingCount}（缺项不能当通过）`,
    );
  }

  if (input.envelopeIssues.length > 0 || input.fatal) {
    return { exitCode: 2, ok: false, reasons };
  }
  if (!input.done || input.blockedReason || input.readingCount < input.expectedReadingCount) {
    return { exitCode: 3, ok: false, reasons };
  }
  return { exitCode: 0, ok: true, reasons };
}

/* ------------------------------------------------------------------ 对照表 */

export interface FakeContrastSource {
  /** Fake 基线里与「我们这一侧」对应的指标名 → minMs（或缺失）。 */
  metrics: Record<string, { minMs?: number } | undefined>;
}

/**
 * Fake 对照拼表：同一图层的 live 读数与 Fake 基线并排。
 *
 * `ours` **只取 `setData` 族**（赋值 → settle，与 Fake `data.value = second + settle()` 同边界）；
 * `redraw` / `sdkSetDataMs` 不进本表——它们的窗口与 Fake 不同，混进 delta 会把 rAF / 原生包装
 * 算成「SDK 内部成本」（#131 评审第 1 条）。
 *
 * `fake` = Fake 基线里同规模 `setData.replace@*` / `data.replace.*` 的 `minMs`。
 * 差值**量级参考**「我们这一侧之外多出来的成本」（含真实 SDK 调用），不是严格单因归因。
 */
export function buildFakeContrast(
  readings: readonly LivePerfLayerReadings[],
  fake: FakeContrastSource,
): Array<{
  layer: LivePerfLayer;
  size: number;
  liveSetDataMs: number;
  fakeSetDataMs: number | null;
  /** `live - fake`（负数表示 live 更快，如实记录，不夹逼）。 */
  deltaMs: number | null;
  /** 同一次运行的原生 `setData` 返回墙钟（无包装 / 未触发 ⇒ `null`）；不参与 delta。 */
  liveSdkSetDataMs: number | null;
}> {
  const fakeKey = (layer: LivePerfLayer, size: number): string =>
    layer === "pointCollection" ? `setData.replace@${size}` : `data.replace.${layer}@${size}`;
  return readings.map((entry) => {
    const metric = fake.metrics[fakeKey(entry.layer, entry.size)];
    const fakeMs = typeof metric?.minMs === "number" ? metric.minMs : null;
    return {
      layer: entry.layer,
      size: entry.size,
      liveSetDataMs: round(entry.setData.durationMs),
      fakeSetDataMs: fakeMs === null ? null : round(fakeMs),
      deltaMs: fakeMs === null ? null : round(entry.setData.durationMs - fakeMs),
      liveSdkSetDataMs: entry.sdkSetDataMs === null ? null : round(entry.sdkSetDataMs),
    };
  });
}

/* ------------------------------------------------------------------ 脱敏 */

/** AK 脱敏（与 smoke 同一口径：只打码 URL 查询参数里的 `ak=`）。 */
export function redactAk(text: string): string {
  return text.replace(/([?&]ak=)[^&#\s"')]+/gi, "$1<redacted>");
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/* ------------------------------------------------------------------ 渲染 */

function sampleCell(sample: LivePerfSample): string {
  return `${round(sample.durationMs)}ms · tasks=${sample.longTaskCount} · longest=${round(sample.longestTaskMs)}ms`;
}

/**
 * 人读报告：**page 与 node 两段分开**（issue 测试要求「页面侧读数与 Node 侧读数分开报告」）。
 *
 * - `page` 段：浏览器内测到的逐图层窗口（firstFrame / setData / redraw / sdkSetData）+ 环境；
 * - `node` 段：信封、退出码、Fake 对照拼表（Node 侧读的 Fake 基线，含 sdk 旁路列）。
 *
 * 语义提醒（#131 第 5 条）：`fps` 列是 **frames/second**，不是 0~1 比值。
 */
export function formatLivePerfReport(input: {
  report: LivePerfReport;
  decision: LivePerfDecision;
  contrast?: ReturnType<typeof buildFakeContrast>;
}): string {
  const { report, decision } = input;
  const lines: string[] = [];

  lines.push("== 真实浏览器档性能读数（#123）==");
  lines.push(
    `page  run=${report.runId} mode=${report.mode} ak=${report.akUsed} done=${report.done} ` +
      `in ${report.durationMs}ms`,
  );
  lines.push(
    `page  browser=${report.env.browser} dataset=v${report.env.datasetVersion} size=${report.env.size}`,
  );
  lines.push(`page  ua=${report.env.userAgent}`);
  if (report.fatal) lines.push(`page  FATAL: ${report.fatal}`);
  if (report.blockedReason) lines.push(`page  BLOCKED: ${report.blockedReason}`);
  for (const note of report.notes ?? []) lines.push(`page  NOTE: ${note}`);
  lines.push("");

  lines.push("--- page: readings ---");
  lines.push(
    `${"layer".padEnd(18)}${"family".padEnd(12)}durationMs${"tasks".padStart(8)}${"longest".padStart(12)}${"fps".padStart(8)}`,
  );
  const row = (
    layerPad: string,
    family: string,
    s: LivePerfSample,
    fpsCell: string,
  ): string =>
    `${layerPad}${family.padEnd(12)}` +
    `${String(round(s.durationMs)).padStart(10)}` +
    `${String(s.longTaskCount).padStart(8)}` +
    `${String(round(s.longestTaskMs)).padStart(12)}` +
    `${fpsCell.padStart(8)}`;
  for (const entry of report.readings) {
    const fpsCell = entry.fps === null ? "-" : String(round(entry.fps, 2));
    lines.push(row(entry.layer.padEnd(18), "firstFrame", entry.firstFrame, "-"));
    lines.push(row("".padEnd(18), "setData", entry.setData, fpsCell));
    lines.push(row("".padEnd(18), "redraw", entry.redraw, "-"));
    lines.push(
      `${"".padEnd(18)}${"sdkSetData".padEnd(12)}` +
        `${(entry.sdkSetDataMs === null ? "-" : String(round(entry.sdkSetDataMs))).padStart(10)}` +
        `${"-".padStart(8)}${"-".padStart(12)}${"-".padStart(8)}`,
    );
  }
  lines.push("");

  lines.push("--- node: envelope ---");
  lines.push(`node  exit=${decision.exitCode} ok=${decision.ok}`);
  for (const reason of decision.reasons) lines.push(`node  ${reason}`);
  lines.push("");

  if (input.contrast && input.contrast.length > 0) {
    lines.push("--- node: fake contrast (ours vs Fake baseline) ---");
    lines.push(
      `${"layer".padEnd(18)}${"size".padStart(7)}${"liveSetData".padStart(12)}${"fakeSetData".padStart(12)}${"delta".padStart(10)}${"sdkSetData".padStart(12)}`,
    );
    for (const row of input.contrast) {
      lines.push(
        `${row.layer.padEnd(18)}${String(row.size).padStart(7)}` +
          `${String(row.liveSetDataMs).padStart(12)}` +
          `${row.fakeSetDataMs === null ? "-".padStart(12) : String(row.fakeSetDataMs).padStart(12)}` +
          `${row.deltaMs === null ? "-".padStart(10) : String(row.deltaMs).padStart(10)}` +
          `${row.liveSdkSetDataMs === null ? "-".padStart(12) : String(row.liveSdkSetDataMs).padStart(12)}`,
      );
    }
    lines.push("");
  }

  lines.push("本套测不到（不要外推）：");
  lines.push("  - 跨机器绝对毫秒（只作参考，不作门禁——本票无阈值）");
  lines.push("  - 服务层网络耗时 / 路由渲染");
  return lines.join("\n");
}
