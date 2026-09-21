#!/usr/bin/env node
/**
 * 性能基准采集与趋势门禁（M6-PERFORMANCE / issue #37）
 *
 * 做三件事，顺序固定：
 *
 * 1. **跑基准**：`tests/performance/**`（vitest + 基准专用配置：串行 + `--expose-gc`）；
 * 2. **出报告**：`.artifacts/perf/report.json` + 一份人读表格（CI 日志里就能看）+ 包体与
 *    worker chunk 读数；
 * 3. **对基线**：与 `tests/performance/baseline.json` 比对，超出宽容阈值 ⇒ 退出码 1。
 *
 * ## 为什么是「归一化 + 宽容阈值」而不是绝对毫秒阈值
 *
 * issue 的非目标第 2 条：**不把单次本机数字当跨平台硬阈值**。因此比较的是
 * `metric.min / calibration.min`（同一次运行里的校准工作量当分母，抵消机器速度差），
 * 阈值默认取得很宽（5×）——它是一条**绊线**，负责抓量级上的回退；精细回归按 issue 的分工交给
 * 定期基准审查（输入就是报告里的比值列）。
 *
 * ## 退出码（四种状态必须能分开，否则一次环境抖动就会污染结论）
 *
 * | 码 | 含义 |
 * | --- | --- |
 * | 0 | 基准跑完、无超阈值回退 |
 * | 1 | 有超阈值回退（**本门禁唯一想拦的东西**） |
 * | 2 | 脚手架 / 判据失败（vitest 挂了、指标缺失、基线缺失或漂移）——「门禁没跑起来」 |
 * | 3 | blocked（前置缺失，例如没有 `dist` ⇒ 包体读数无法采集）——「门禁没跑完」 |
 *
 * 2 与 3 都**不是**通过：把「没跑」当成「通过」是这个仓库反复记过的一类失效。同理，**缺基线、
 * 指标集合漂移、数据集版本不一致都会落到 2**——那三种情形下「比较」根本没发生。
 *
 * ## 跨平台：只出报告、不做门禁
 *
 * 基线录在一台机器上，「本机读数 / 校准量」的比值仍然**跨平台不可比**：实测同一份代码在
 * Apple M4（开发机，安静~极载）与 GitHub runner（INTEL XEON / linux）之间差 **2 ~ 6 倍**，
 * 而且**校准量吸收不掉**——纯数字循环的 `min` 能在被抢占的间隙里找到空闲时刻，而分配密集的
 * workload 会整体退化。因此 `platform + arch` 与基线不一致时，本脚本打印比值但**不做门禁**
 * （详见 ADR `2026-09-21-performance-baseline-and-worker-decision` 的决策 5），并在报告里记
 * `comparison.skipped`。要在本机启用门禁就先在本机 `--update`（基线会记下本机的身份）。
 *
 * ## 用法
 *
 * ```bash
 * pnpm build:v3 && pnpm perf:baseline      # 采集 + 报告 + 门禁（CI 用的就是这条）
 * pnpm perf:baseline --update             # 同时刷新提交的基线（换机器 / 换数据集时才做）
 * pnpm perf:baseline --metrics-dir=<dir>  # 复用已有指标（不重跑基准，用于调报告与看门禁）
 * pnpm perf:baseline --tolerance=5        # 临时放宽阈值（改数据量 / 大改实现时）
 * ```
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = resolve(root, "tests/performance/baseline.json");
const OUT_DIR = resolve(root, ".artifacts/perf");
const METRICS_DIR = resolve(OUT_DIR, "metrics");
const REPORT_PATH = resolve(OUT_DIR, "report.json");
const PACKAGE_DIST = resolve(root, "packages/baidu-map-gl-vue/dist");

/** 归一化分母的指标名（基准里必须采到它，否则跨机器比较没有意义）。 */
const NORMALIZER = "calibration.cpu";

/**
 * 默认阈值：归一化成本涨到基线的 5 倍以上才告警。
 *
 * 为什么是 5 而不是 1.2 或 3：基线的绝对读数录在一台机器上，而门禁在另一台（CI 的共享 runner）
 * 上跑，跨机器 + 共享 runner 的噪声实测量级在「百分之几十」到「2 倍左右」（本机自己在负载高低
 * 之间就有近 2 倍的差）；门槛取 5× 让这层噪声不可能把门禁染红，同时仍然拦得住「一个数量级」的
 * 回退（新增一遍 O(n) 全量遍历、把小数据路径换成逐项路径这类）。
 */
const DEFAULT_TOLERANCE = 5;

/**
 * 比较的**噪声地板**（归一化单位）。0.1 ≈ 1ms（本项目校准量 ~10ms）。
 *
 * 低于这一档的读数是**计时器分辨率 / 单次调度**量级（实测 `scanValidItems@100` = 0.02、
 * `cluster@100` = 0.04、`data.replace.line@100` = 0.028），拿它比比值只会得到假红 ⇒ 只进报告。
 *
 * 曾经把地板抬到 0.5 来掩盖一条 100 档的假回退（`mount.pointCollection@100` 报 5.8×）——
 * 那条的**根因是冷启动**（过程内第一次挂载要付装配 + 首次 patch + 建图：实测 16.15ms vs
 * 紧接着再跑一次的数毫秒），已在 `component-path.perf.test.ts` §1 用一次**丢弃的挂载**修掉
 * （首次那一次仍以 `.firstMs` 读数进报告）。**根因在读数生成处修，不要用地板掩盖。**
 */
const FLOOR_UNITS = 0.1;

/** 基准必须产出的两份指标（少一份说明范围被改窄了，不能当「通过」）。 */
const REQUIRED_SNAPSHOTS = ["preprocess", "component-path"];

/** 四态退出码（「没跑」不等于「通过」，见文件头）。 */
export type PerfExitCode = 0 | 1 | 2 | 3;

interface CliFlags {
  update: boolean;
  metricsDir: string | null;
  tolerance: number;
}

interface MetricStat {
  name: string;
  samples: number[];
  min: number;
  median: number;
  max: number;
}

interface Snapshot {
  file: string;
  dataset: Record<string, unknown>;
  engine: string;
  environment: Record<string, unknown>;
  metrics: MetricStat[];
  readouts: Record<string, number | string>;
  notMeasured: string[];
}

interface BundleTotals {
  runtimeJs: number;
  esmJs: number;
  cjs: number;
  css: number;
  dts: number;
  sourceMaps: number;
  allBytes: number;
  fileCount: number;
}

interface BundleReport {
  status: "ok" | "blocked";
  reason?: string;
  topFiles?: Array<{ path: string; bytes: number }>;
  totals?: BundleTotals;
  worker?: { namedChunks: string[]; runtimeReferences: string[]; note: string };
}

interface ReportMetric {
  minMs: number;
  medianMs: number;
  maxMs: number;
  samples: number;
  normalized: number;
}

interface Report {
  version: number;
  generatedAt: string;
  dataset: Record<string, unknown>;
  engine: string;
  environment: Record<string, unknown>;
  normalizer: { metric: string; minMs: number };
  metrics: Record<string, ReportMetric>;
  readouts: Record<string, number | string>;
  notMeasured: string[];
  bundle: BundleReport;
}

interface ComparisonItem {
  name: string;
  ratio: number;
  current: number;
  baseline: number;
}

interface Comparison {
  baseline: Record<string, { normalized: number }> | null;
  tolerance: number;
  /** 绝对值那一层（只在同机器时生效）。 */
  regressions: ComparisonItem[];
  improvements: ComparisonItem[];
  /** 非空 = 本次**没有**做绝对值门禁（跨平台 / 跨 SKU），内容是原因。 */
  skipped: string | null;
  /** 同轮比值那一层（任何机器上都生效）。 */
  shape: {
    readings: ShapeRatioReading[];
    skipped: string[];
    regressions: ComparisonItem[];
    improvements: ComparisonItem[];
  };
}

/** 退出：`2` = 门禁没跑起来，`3` = 门禁没跑完，`1` = 真的回退了。 */
function fail(code: number, message: string): never {
  console.error(message);
  process.exit(code);
}

/** 展示用路径：仓内给相对路径，仓外给绝对路径（`--metrics-dir` 可以指向 `/tmp` 之类）。 */
function showPath(target: string): string {
  const rel = relative(root, target);
  return rel.startsWith("..") ? target : rel;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseArgs(argv: string[]): CliFlags {
  const flags: CliFlags = { update: false, metricsDir: null, tolerance: DEFAULT_TOLERANCE };
  for (const arg of argv) {
    if (arg === "--update") flags.update = true;
    else if (arg.startsWith("--metrics-dir=")) {
      flags.metricsDir = resolve(root, arg.slice("--metrics-dir=".length));
    } else if (arg.startsWith("--tolerance=")) {
      flags.tolerance = Number(arg.slice("--tolerance=".length));
    } else {
      fail(2, `[perf] 未知参数：${arg}`);
    }
  }
  if (!Number.isFinite(flags.tolerance) || flags.tolerance <= 0) {
    fail(2, `[perf] --tolerance 必须是正数（收到 ${flags.tolerance}）`);
  }
  return flags;
}

/** 跑基准：串行（配置里 `fileParallelism: false`），指标写到指定目录。 */
function runBenchmarks(metricsDir: string): void {
  const vitestBin = resolve(root, "node_modules/vitest/vitest.mjs");
  if (!existsSync(vitestBin)) {
    fail(2, `[perf] 找不到 vitest（${showPath(vitestBin)}）：先跑 pnpm install`);
  }
  mkdirSync(metricsDir, { recursive: true });
  console.log("[perf] 运行基准：vitest run --config tests/performance/vitest.config.ts");
  try {
    execFileSync(process.execPath, [vitestBin, "run", "--config", "tests/performance/vitest.config.ts"], {
      cwd: root,
      env: { ...process.env, PERF_METRICS_DIR: metricsDir },
      stdio: "inherit",
    });
  } catch {
    // 基准里的判据（超线性 / 泄漏 / 保留内存）失败时走到这里：vitest 的输出已经原样留在日志里，
    // 这里再交一个「判据失败」的退出码，不要把它伪装成趋势回退。
    fail(2, "[perf] 基准自身失败（见上方 vitest 输出）：判据失败优先于趋势对比");
  }
}

function readSnapshots(metricsDir: string): Snapshot[] {
  if (!existsSync(metricsDir)) {
    fail(2, `[perf] 指标目录不存在：${showPath(metricsDir)}`);
  }
  const files = readdirSync(metricsDir).filter((name) => /^bmv-perf-.*\.json$/.test(name));
  const snapshots = files.map(
    (name) => JSON.parse(readFileSync(join(metricsDir, name), "utf8")) as Snapshot,
  );
  const labels = snapshots.map((snapshot) => snapshot.file);
  const missing = REQUIRED_SNAPSHOTS.filter((label) => !labels.includes(label));
  if (missing.length > 0) {
    fail(
      2,
      `[perf] 缺少基准指标：${missing.join(", ")}（已采到 ${labels.join(", ") || "无"}）` +
        "；范围被改窄时门禁会静默空转，因此这里直接失败",
    );
  }
  return snapshots;
}

/** 环境身份：两份快照必须来自同一次运行（否则并排比较没有意义）。 */
function assertSameEnvironment(snapshots: Snapshot[]): void {
  const first = JSON.stringify(snapshots[0]!.environment);
  for (const snapshot of snapshots) {
    if (JSON.stringify(snapshot.environment) !== first) {
      fail(2, "[perf] 指标文件的环境不一致：它们不是同一次运行的产物");
    }
  }
}

/** 合并指标（重名直接失败：两份文件采同一个名字说明命名空间没划清）。 */
function mergeMetrics(snapshots: Snapshot[]): Map<string, MetricStat> {
  const metrics = new Map<string, MetricStat>();
  for (const snapshot of snapshots) {
    for (const metric of snapshot.metrics) {
      if (metrics.has(metric.name)) {
        fail(2, `[perf] 指标重名：${metric.name}（出现在 ${snapshot.file}）`);
      }
      metrics.set(metric.name, metric);
    }
  }
  return metrics;
}

function mergeReadouts(snapshots: Snapshot[]): Record<string, number | string> {
  const readouts: Record<string, number | string> = {};
  for (const snapshot of snapshots) Object.assign(readouts, snapshot.readouts);
  return readouts;
}

/**
 * 包体与 worker chunk 读数。
 *
 * 依据：issue 的「测试要求」明确要记包体与 worker chunk 体积。没有 `dist` 时**不静默跳过**——
 * 报 blocked，由调用方交出退出码 3（CI 的 performance job 会先 `build:v3`）。
 *
 * ⚠️ 这里**只记录、不门禁**「有没有 Worker」：验收补充要求「性能门禁关注趋势和回退，不把实现方式
 * （Worker 与否）冻结成需求」，所以 worker 的存在与否是读数，不是判据。
 */
function collectBundle(): BundleReport {
  if (!existsSync(PACKAGE_DIST)) {
    return {
      status: "blocked",
      reason: `没有构建产物：${showPath(PACKAGE_DIST)}（先跑 pnpm build:v3）`,
    };
  }
  const files: Array<{ path: string; bytes: number }> = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        files.push({ path: relative(PACKAGE_DIST, full), bytes: statSync(full).size });
      }
    }
  };
  walk(PACKAGE_DIST);
  files.sort((a, b) => b.bytes - a.bytes);

  const isJs = (file: { path: string }): boolean => /\.(mjs|js)$/.test(file.path);
  const isDts = (file: { path: string }): boolean => /\.d\.(mts|cts|ts)$/.test(file.path);
  const sum = (filter: (file: { path: string }) => boolean): number =>
    files.filter(filter).reduce((total, file) => total + file.bytes, 0);

  // worker chunk 的判据：产物里出现 worker 命名的文件，或运行时脚本里出现 `new Worker(`。
  const workerNamedFiles = files.filter((file) => /worker/i.test(file.path)).map((file) => file.path);
  const workerRefs = files
    .filter((file) => isJs(file) && readFileSync(join(PACKAGE_DIST, file.path), "utf8").includes("new Worker("))
    .map((file) => file.path);

  return {
    status: "ok",
    // 只列 1KB 以上的前几个：它们解释了「运行时体积花在哪」，而几十字节的碎片没有信息量。
    topFiles: files.filter((file) => file.bytes >= 1024).slice(0, 5),
    totals: {
      runtimeJs: sum((file) => isJs(file) || /\.cjs$/.test(file.path)),
      esmJs: sum(isJs),
      cjs: sum((file) => /\.cjs$/.test(file.path)),
      css: sum((file) => /\.css$/.test(file.path)),
      dts: sum(isDts),
      sourceMaps: sum((file) => /\.map$/.test(file.path)),
      allBytes: sum(() => true),
      fileCount: files.length,
    },
    worker: {
      namedChunks: workerNamedFiles,
      runtimeReferences: workerRefs,
      note: "读数而非门禁：本票的结论是不引入 Worker，但不冻结实现方式（见 ADR）",
    },
  };
}

function buildReport(snapshots: Snapshot[], bundle: BundleReport): Report {
  const metrics = mergeMetrics(snapshots);
  const calibration = metrics.get(NORMALIZER);
  if (!calibration || calibration.min <= 0) {
    fail(2, `[perf] 缺可用的校准指标 ${NORMALIZER}：归一化分母缺失就没法跨机器比较`);
  }
  const normalized: Record<string, ReportMetric> = {};
  for (const [name, metric] of metrics) {
    normalized[name] = {
      minMs: round(metric.min),
      medianMs: round(metric.median),
      maxMs: round(metric.max),
      samples: metric.samples.length,
      normalized: round(metric.min / calibration.min, 4),
    };
  }
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    dataset: snapshots[0]!.dataset,
    engine: snapshots[0]!.engine,
    environment: snapshots[0]!.environment,
    normalizer: { metric: NORMALIZER, minMs: round(calibration.min) },
    metrics: normalized,
    readouts: mergeReadouts(snapshots),
    notMeasured: snapshots.flatMap((snapshot) => snapshot.notMeasured),
    bundle,
  };
}

/** 报告里「关键读数」的行过滤（阶段 A 结论的依据项）。 */
const KEY_READOUT = /(exceedsLongTask|contrast|retainedGrowthMb|retainedSeries|perItemMicros)/i;

function printReport(report: Report, comparison: Comparison): void {
  const lines: string[] = [];
  const env = report.environment;
  lines.push("== 性能基准报告（M6-PERFORMANCE / issue #37，阶段 A）==");
  lines.push(
    `机器   ${env.cpuModel} × ${env.cpuCount} · ${env.platform} ${env.release} · ${env.arch} · ` +
      `${env.totalMemoryGb}GB · Node ${env.node}`,
  );
  lines.push(`运行时 DOM ${env.dom} · 被测引擎 ${report.engine} · vitest ${env.vitest}`);
  lines.push(
    `数据集 v${report.dataset.version}（${(report.dataset.sizes as number[]).join(" / ")} 项，` +
      `${report.dataset.cityCount} 个中心，${Math.round(Number(report.dataset.clusteredRatio) * 100)}% 聚簇）`,
  );
  lines.push(`归一化分母 ${report.normalizer.metric} = ${report.normalizer.minMs}ms`);
  lines.push("");
  lines.push("指标                                   min      med      max   归一化    基线   比值");
  const names = Object.keys(report.metrics).sort();
  let noisy = 0;
  for (const name of names) {
    const entry = report.metrics[name]!;
    const base = comparison.baseline?.[name];
    const aboveFloor = entry.normalized >= FLOOR_UNITS;
    if (!aboveFloor) noisy += 1;
    const baseCell = base ? String(base.normalized) : "—";
    const ratioCell = base && aboveFloor ? `${round(entry.normalized / base.normalized)}×` : "—";
    lines.push(
      `${name.padEnd(38)}${String(entry.minMs).padStart(7)}${String(entry.medianMs).padStart(9)}` +
        `${String(entry.maxMs).padStart(9)}${String(entry.normalized).padStart(9)}` +
        `${baseCell.padStart(9)}${ratioCell.padStart(8)}`,
    );
  }
  lines.push("");
  lines.push(
    `以上 ${names.length} 项指标中，${noisy} 项低于噪声地板（${FLOOR_UNITS} 归一化单位）` +
      "：只进报告，不参与门禁。",
  );
  lines.push("");
  lines.push("关键读数（阶段 A 结论的依据）：");
  for (const key of Object.keys(report.readouts).sort()) {
    if (KEY_READOUT.test(key)) lines.push(`  ${key} = ${report.readouts[key]}`);
  }
  lines.push("");
  if (report.bundle.status === "ok") {
    const totals = report.bundle.totals!;
    lines.push(
      `包体   dist ${totals.fileCount} 个文件 · 运行时（ESM/CJS/CSS）${totals.runtimeJs + totals.css} 字节` +
        `（ESM ${totals.esmJs} · CJS ${totals.cjs} · CSS ${totals.css}）· d.ts ${totals.dts} · ` +
        `sourcemap ${totals.sourceMaps} · 全部 ${totals.allBytes}`,
    );
    for (const file of report.bundle.topFiles ?? []) {
      lines.push(`  ${String(file.bytes).padStart(8)}  ${file.path}`);
    }
    lines.push(
      `worker chunk：命名命中 ${report.bundle.worker!.namedChunks.length} 个 · 运行时引用 ` +
        `${report.bundle.worker!.runtimeReferences.length} 处（读数，不是门禁）`,
    );
  } else {
    lines.push(`包体   BLOCKED：${report.bundle.reason}`);
  }
  lines.push("");
  lines.push("本套测不到（不要外推）：");
  for (const note of report.notMeasured) lines.push(`  - ${note}`);
  lines.push("");
  if (comparison.shape.readings.length > 0) {
    lines.push(
      `同轮比值（分子分母在同一次运行里测，**跨机器可比**；阈值 ${comparison.tolerance}×）：` +
        `${comparison.shape.regressions.length} 项越界` +
        (comparison.shape.skipped.length > 0 ? ` · 缺读数跳过 ${comparison.shape.skipped.length} 项` : ""),
    );
    for (const reading of comparison.shape.readings) {
      const hit = comparison.shape.regressions.find((item) => item.name === reading.name);
      const mark = hit ? "⚠️ " : "   ";
      lines.push(
        `${mark}${reading.name.padEnd(34)} ${String(reading.ratio).padStart(10)}` +
          `${hit ? `（基线 ${hit.baseline} → 现在 ${hit.current}，${hit.ratio}×）` : ""}  ${reading.note}`,
      );
    }
    lines.push("");
  }
  if (comparison.baseline) {
    if (comparison.skipped) {
      lines.push(`趋势对比：**本次不做门禁** —— ${comparison.skipped}`);
    } else {
      lines.push(
        `趋势对比（相对基线，阈值 ${comparison.tolerance}×）：${comparison.regressions.length} 项越界 · ` +
          `${comparison.improvements.length} 项明显改善`,
      );
    }
    for (const item of comparison.regressions) {
      lines.push(`  ⚠️ 回退 ${item.name}：${item.ratio}×（基线 ${item.baseline} → 现在 ${item.current}）`);
    }
    for (const item of comparison.improvements.slice(0, 5)) {
      lines.push(`  ✅ 改善 ${item.name}：${item.ratio}×`);
    }
  } else {
    lines.push("趋势对比：本次没有可比的基线（首次使用，或刚被判为不可比）");
  }
  console.log(lines.join("\n"));
}

/**
 * 与基线比对。
 *
 * 三条**必须失败**的情形（否则「比较」根本没发生，而门禁会报绿）：
 * 1. 基线文件缺失（除非本次就是来写基线的 `--update`）；
 * 2. 指标集合漂移（报告里有基线里没有的指标 ⇒ 改名 / 新增都会让那一条永久失效）；
 * 3. 数据集版本或引擎不一致（比的是两份不同的东西）。
 */
function compareWithBaseline(report: Report, flags: CliFlags): Comparison {
  const normalizedOf = (report: Report): Record<string, number> =>
    Object.fromEntries(Object.entries(report.metrics).map(([name, entry]) => [name, entry.normalized]));
  const empty: Comparison = {
    baseline: null,
    tolerance: flags.tolerance,
    regressions: [],
    improvements: [],
    skipped: null,
    shape: { readings: computeShapeRatios(normalizedOf(report)).readings, skipped: [], regressions: [], improvements: [] },
  };
  if (!existsSync(BASELINE_PATH)) {
    if (flags.update) return empty;
    // 缺基线 = 门禁的唯一输入不存在：不能报绿（那正是「门禁空转」）。
    fail(
      2,
      `[perf] 找不到基线 ${showPath(BASELINE_PATH)}：趋势门禁的唯一输入就是它。` +
        "首次使用请跑 `pnpm perf:baseline --update` 生成并提交",
    );
  }
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as {
    datasetVersion?: unknown;
    engine?: unknown;
    machine?: { platform?: unknown; arch?: unknown; cpuModel?: unknown };
    metrics?: Record<string, { normalized: number }>;
  };
  const baselineMetrics = baseline.metrics ?? {};

  const mismatch = detectMismatch(report, baseline, baselineMetrics);
  if (mismatch) {
    // `--update` 就是来重录基线的：此时「不可比」是预期状态，告警后跳过对比（否则改名/换数据集
    // 之后会永远卡在失败上，没法把基线更新过来）。
    if (flags.update) {
      console.warn(`[perf] ${mismatch}；--update 会重录基线，本次跳过对比`);
      return empty;
    }
    fail(2, mismatch);
  }

  // 同轮比值：**与机器无关**，因此在跨平台/跨 SKU 时也照常对比（这是评审 2 的「同一次运行内的
  // reference 对照」的最便宜形态；实测跨 SKU 的比值偏差只有 1.04 ~ 1.17×）。
  const shapeReadings = computeShapeRatios(normalizedOf(report));
  const baselineNormalized = Object.fromEntries(
    Object.entries(baselineMetrics).map(([name, entry]) => [name, entry.normalized]),
  );
  const shapeComparison = compareShapeRatios(shapeReadings.readings, baselineNormalized, flags.tolerance);
  const shape = {
    readings: shapeReadings.readings,
    skipped: shapeReadings.skipped,
    regressions: shapeComparison.regressions,
    improvements: shapeComparison.improvements,
  };

  const crossPlatform = describeMachineMismatch(baseline.machine, report.environment);
  if (crossPlatform) {
    // 跨平台 / 跨 SKU 时**不做绝对值门禁**：这不是「静默跳过」——报告里会有一行醒目的说明
    // + `comparison.skipped`；而同轮比值那一层继续生效。
    return {
      baseline: baselineMetrics,
      tolerance: flags.tolerance,
      regressions: [],
      improvements: [],
      skipped: crossPlatform,
      shape,
    };
  }

  const regressions: ComparisonItem[] = [];
  const improvements: ComparisonItem[] = [];
  for (const [name, entry] of Object.entries(report.metrics)) {
    const base = baselineMetrics[name]!;
    if (entry.normalized < FLOOR_UNITS || base.normalized < FLOOR_UNITS) continue;
    const ratio = entry.normalized / base.normalized;
    const item: ComparisonItem = {
      name,
      ratio: round(ratio),
      current: entry.normalized,
      baseline: base.normalized,
    };
    if (ratio > flags.tolerance) regressions.push(item);
    else if (ratio < 1 / flags.tolerance) improvements.push(item);
  }
  regressions.sort((a, b) => b.ratio - a.ratio);
  improvements.sort((a, b) => a.ratio - b.ratio);
  return {
    baseline: baselineMetrics,
    tolerance: flags.tolerance,
    regressions,
    improvements,
    skipped: null,
    shape,
  };
}

/**
 * 本次机器与基线录制机器是否「可比」（纯函数，见 `describeKeySetMismatch` 的同款理由）。
 *
 * 判据是 **`platform + arch + cpuModel`**，不是只比平台（issue #37 评审 2）。
 *
 * 为什么必须带上 CPU：本 PR 的两次连续 CI 推送实测就是**同一 label、不同 SKU**——
 * `ubuntu-latest` 第一次给 `INTEL XEON PLATINUM 8573C`、第二次给 `Intel Xeon 6973P-C`，
 * 连校准量都从 30.19ms 变成 21.99ms（27%）。而 ADR 自己就写着「这个 calibration 吸收不掉
 * allocation-heavy workload 的机器差异」⇒ 只比 `platform + arch` 等于在**两台不同的机器**之间
 * 开硬门禁，既有假红也有假绿。5× 宽阈值不能把「不可比」变成「可比」。
 *
 * 推论（写进 ADR 的维护规则）：**基线必须录在与门禁同一台/同一规格的机器上**；SKU 变了就只出报告，
 * 由维护者在那台机器上 `--update` 重录。宁可明说不可比，也不要一个看似生效的门禁。
 */
export function describeMachineMismatch(
  baselineMachine: { platform?: unknown; arch?: unknown; cpuModel?: unknown } | undefined,
  environment: Record<string, unknown>,
): string | null {
  if (!baselineMachine?.platform || !baselineMachine.arch) {
    return "基线没有记录机器身份（旧格式）：本次只出报告、不做门禁；用 --update 重录即可恢复";
  }
  const samePlatform =
    baselineMachine.platform === environment.platform && baselineMachine.arch === environment.arch;
  const sameCpu =
    baselineMachine.cpuModel !== undefined && baselineMachine.cpuModel === environment.cpuModel;
  if (samePlatform && sameCpu) return null;
  const why = samePlatform
    ? "同平台但 **CPU 不同**（`ubuntu-latest` 的 SKU 会轮换）"
    : "**跨平台**";
  return (
    `基线录于 ${String(baselineMachine.platform)}/${String(baselineMachine.arch)}` +
    ` · ${String(baselineMachine.cpuModel ?? "未知 CPU")}，本次是 ` +
    `${String(environment.platform)}/${String(environment.arch)} · ${String(environment.cpuModel ?? "未知 CPU")}：` +
    `${why}，归一化比值实测差 2 ~ 6 倍（校准量也吸收不掉 allocation-heavy 的差异），` +
    "因此**本次不做趋势门禁**（比值只作参考）。要在这台机器上启用门禁，先 `pnpm perf:baseline --update` 重录基线"
  );
}

/**
 * **同轮比值**（评审 2 的「同一次 CI 内的 reference 对照」在本票里的最便宜形态）。
 *
 * 归一化后的**单个绝对值**跨机器差 2 ~ 6 倍（见决策 5），但**同一轮里两个指标的比值**
 * 几乎不受机器影响：分子分母在同一台机器、同一时刻被测。实测两条 CI 读数（两次推送的 CPU SKU
 * 不同：Xeon 8573C vs 6973P-C，校准量 30.19ms vs 21.99ms）：
 *
 * | 同轮比值 | CI run1 | CI run2 | 跨 run 偏差 |
 * | --- | --- | --- | --- |
 * | `mount.pointCollection@50k / mount.lineLayerGeoJson@50k`（适配路径 vs 直通路径） | 25.6 | 24.3 | 1.05× |
 * | `replace.reactiveArray@50k / replace.markRawArray@50k`（深响应 vs `markRaw`） | 11.0 | 10.2 | 1.08× |
 * | `adaptPoints@50k / adaptPoints@1k`（每项成本的规模增长） | 54.2 | 63.5 | 1.17× |
 *
 * 因此**这一层门禁在任何机器上都生效**：它拦的是「我们自己两条路径之间的形状变了」
 * （例如适配路径忽然贵了 5 倍、或深响应读取被放大）。绝对值那一层仍然只在同机器上做门禁。
 *
 * 比值直接由 `metrics[分子].normalized / metrics[分母].normalized` 得出——校准量自动约掉，
 * 因此**基线不需要新增字段**（旧基线照样能用）。
 */
interface ShapeRatioSpec {
  readonly name: string;
  readonly numerator: string;
  readonly denominator: string;
  /** 这条比值在回答什么问题（进报告，让读数可解释）。 */
  readonly note: string;
}

export const SHAPE_RATIOS: readonly ShapeRatioSpec[] = [
  {
    name: "adaptationOverPassthrough@50000",
    numerator: "mount.pointCollection@50000",
    denominator: "mount.lineLayerGeoJson@50000",
    note: "适配路径（Item[] → GeoJSON）相对直通路径的挂载成本倍数",
  },
  {
    name: "deepReactiveOverMarkRaw@50000",
    numerator: "replace.reactiveArray@50000",
    denominator: "replace.markRawArray@50000",
    note: "深响应数组替换相对 markRaw 的倍数（阶段 A 结论的关键对照）",
  },
  {
    // 名字带 `Total` 是刻意的：这里比的是**总耗时**的规模增长（纯线性 = 50×），不是「每项成本」。
    name: "adaptPointsTotal50kOver1k",
    numerator: "adaptPoints@50000",
    denominator: "adaptPoints@1000",
    note: "适配总耗时的规模增长（纯线性 50×；O(n²) → 2500×；每项成本的增长见 §2 的用例）",
  },
  {
    name: "pointMountTotal50kOver1k",
    numerator: "mount.pointCollection@50000",
    denominator: "mount.pointCollection@1000",
    note: "组件挂载总耗时的规模增长（固定开销占大头 ⇒ 明显低于 50× 是预期）",
  },
  {
    // 用 §6 矩阵的 line（四类原生图层同一条直通路径）而不是 §4 的单个 50k 对照：
    // 后者只有 50k 一个规模，构不成比值（本票第一版就是这么写的，报告里直接显示「缺读数跳过」）。
    name: "passthroughTotal50kOver1k",
    numerator: "mount.line@50000",
    denominator: "mount.line@1000",
    note: "四类原生图层（GeoJSON 直通）总耗时的规模增长（≈1× ⇒ 与数据量无关，符合「整包转发」）",
  },
];

export interface ShapeRatioReading {
  readonly name: string;
  readonly note: string;
  readonly ratio: number;
}

/** 由（归一化后的）指标值算出同轮比值；缺任一端的条目进 `skipped`（不静默当成 0）。 */
export function computeShapeRatios(normalized: Record<string, number>): {
  readings: ShapeRatioReading[];
  skipped: string[];
} {
  const readings: ShapeRatioReading[] = [];
  const skipped: string[] = [];
  for (const spec of SHAPE_RATIOS) {
    const numerator = normalized[spec.numerator];
    const denominator = normalized[spec.denominator];
    if (numerator === undefined || denominator === undefined || denominator <= 0) {
      skipped.push(spec.name);
      continue;
    }
    readings.push({ name: spec.name, note: spec.note, ratio: round(numerator / denominator, 4) });
  }
  return { readings, skipped };
}

/** 同轮比值的趋势对比：与基线的同名比值比，阈值同样宽容（机器噪声实测 ~1.2×，5× 绰绰有余）。 */
export function compareShapeRatios(
  readings: readonly ShapeRatioReading[],
  baselineNormalized: Record<string, number>,
  tolerance: number,
): { regressions: ComparisonItem[]; improvements: ComparisonItem[] } {
  const baseline = computeShapeRatios(baselineNormalized);
  const baselineByName = new Map(baseline.readings.map((entry) => [entry.name, entry.ratio]));
  const regressions: ComparisonItem[] = [];
  const improvements: ComparisonItem[] = [];
  for (const reading of readings) {
    const base = baselineByName.get(reading.name);
    if (base === undefined || base <= 0) continue;
    const ratio = reading.ratio / base;
    const item: ComparisonItem = {
      name: reading.name,
      ratio: round(ratio),
      current: reading.ratio,
      baseline: base,
    };
    if (ratio > tolerance) regressions.push(item);
    else if (ratio < 1 / tolerance) improvements.push(item);
  }
  regressions.sort((a, b) => b.ratio - a.ratio);
  improvements.sort((a, b) => a.ratio - b.ratio);
  return { regressions, improvements };
}

/**
 * 四态退出码的判定（纯函数；判定与 `process.exit` 分开，用例才能直接断言）。
 *
 * 优先级：**回退(1) > blocked(3) > 通过(0)**；`2` 由各处的 `fail(2, …)` 直接给出（脚手架/不可比）。
 */
export function decideExitCode(input: { regressions: number; bundleStatus: "ok" | "blocked" }): PerfExitCode {
  if (input.regressions > 0) return 1;
  if (input.bundleStatus !== "ok") return 3;
  return 0;
}

/**
 * 「这次比不了」的三种情形（返回原因；`null` = 可以比）。
 *
 * 缺基线、指标集合漂移、数据集/引擎不一致——这三条都能让门禁**静默失效**（比了个不存在的东西，
 * 或者干脆没比），因此调用方把它们当成失败（`--update` 时降级为告警 + 跳过对比）。
 */
function detectMismatch(
  report: Report,
  baseline: { datasetVersion?: unknown; engine?: unknown },
  baselineMetrics: Record<string, unknown>,
): string | null {
  if (baseline.datasetVersion !== undefined && baseline.datasetVersion !== report.dataset.version) {
    return (
      `[perf] 基线录的是数据集 v${String(baseline.datasetVersion)}，本次是 v${String(report.dataset.version)}：` +
      "两份不同的数据没法比（改生成规则后请用 --update 重录）"
    );
  }
  if (baseline.engine !== undefined && baseline.engine !== report.engine) {
    return `[perf] 基线的引擎是 ${String(baseline.engine)}，本次是 ${report.engine}：两份不同的被测对象没法比`;
  }
  return describeKeySetMismatch(Object.keys(report.metrics), Object.keys(baselineMetrics));
}

/**
 * 指标集合必须**双向**一致（issue #37 评审 1）。
 *
 * 只查「报告有、基线没有」会漏掉反方向：把一条既有 benchmark / metric 删掉之后，它从
 * `report.metrics` 消失，后续比较循环根本不会再看到它 ⇒ 门禁**静默少测一项**并且照样退出 0
 * —— 正是本 PR 一直强调要避免的「门禁空转」。因此这里直接比完整的 key set（两个方向都报）。
 *
 * 纯函数（`scripts/source-scan.mts` 同款：判定抽出来给用例直接调），否则这条分支只能靠
 * 「真跑一次坏环境」来验证。
 */
export function describeKeySetMismatch(reportNames: string[], baselineNames: string[]): string | null {
  const onlyInReport = reportNames.filter((name) => !baselineNames.includes(name));
  const onlyInBaseline = baselineNames.filter((name) => !reportNames.includes(name));
  if (onlyInReport.length === 0 && onlyInBaseline.length === 0) return null;
  const parts: string[] = [];
  if (onlyInReport.length > 0) parts.push(`报告有而基线没有：${onlyInReport.join(", ")}`);
  if (onlyInBaseline.length > 0) parts.push(`基线有而报告没有：${onlyInBaseline.join(", ")}`);
  return (
    `[perf] 指标集合漂移（${parts.join("；")}）。` +
    "任意一个方向都会让那条指标静默失效（改名 / 新增 / 删除都会），因此这里直接失败——" +
    "确认新指标合理后用 --update 重录基线"
  );
}

function writeBaseline(report: Report): void {
  const baseline = {
    version: 1,
    datasetVersion: report.dataset.version,
    engine: report.engine,
    normalizer: report.normalizer,
    tolerance: DEFAULT_TOLERANCE,
    comparisonFloorUnits: FLOOR_UNITS,
    recordedAt: report.generatedAt,
    // `machine` 是**门禁的键**（`platform + arch` 一致才做趋势门禁），`recordedOn` 是完整读档。
    machine: {
      platform: report.environment.platform,
      arch: report.environment.arch,
      cpuModel: report.environment.cpuModel,
      cpuCount: report.environment.cpuCount,
      node: report.environment.node,
    },
    recordedOn: report.environment,
    metrics: Object.fromEntries(
      Object.entries(report.metrics).map(([name, entry]) => [
        name,
        { normalized: entry.normalized, minMs: entry.minMs, medianMs: entry.medianMs, maxMs: entry.maxMs },
      ]),
    ),
    // 下面两段是**读档**（给人核对「这次比的是什么东西」），不参与比较：
    bundle: report.bundle.status === "ok" ? report.bundle.totals : { status: report.bundle.status },
    readouts: report.readouts,
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`[perf] 已更新基线：${showPath(BASELINE_PATH)}`);
}

function main(): void {
  const flags = parseArgs(process.argv.slice(2));
  const metricsDir = flags.metricsDir ?? METRICS_DIR;
  if (!flags.metricsDir) runBenchmarks(metricsDir);

  const snapshots = readSnapshots(metricsDir);
  assertSameEnvironment(snapshots);
  const report = buildReport(snapshots, collectBundle());
  const comparison = compareWithBaseline(report, flags);
  printReport(report, comparison);

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[perf] 报告已写入：${showPath(REPORT_PATH)}`);
  if (flags.update) writeBaseline(report);

  const regressionCount = comparison.regressions.length + comparison.shape.regressions.length;
  const exitCode = decideExitCode({
    regressions: regressionCount,
    bundleStatus: report.bundle.status,
  });
  if (exitCode === 1) {
    fail(
      1,
      `[perf] 有 ${regressionCount} 项超出 ${flags.tolerance}× 阈值（绝对值 ${comparison.regressions.length} 项 · ` +
        `同轮比值 ${comparison.shape.regressions.length} 项）：见上方 ⚠️ 行`,
    );
  }
  if (exitCode === 3) {
    fail(3, `[perf] BLOCKED：${report.bundle.reason}`);
  }
  console.log(
    comparison.skipped ? "[perf] OK：本次跨平台，趋势门禁未启用（见上方说明）" : "[perf] OK：无超阈值回退",
  );
}

/** 只有被直接执行时才跑 `main()`；被用例 import 时（`scripts/source-scan.mts` 同款）不执行。 */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url);
}

if (isEntryPoint()) {
  try {
    main();
  } catch (error) {
    // 未捕获异常（坏 JSON、EACCES、mkdir 失败…）必须落到「门禁没跑起来」这一档，
    // 否则会被读成「趋势回退」（码 1）——那是完全不同的结论。
    console.error(`[perf] 脚手架异常：${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}
