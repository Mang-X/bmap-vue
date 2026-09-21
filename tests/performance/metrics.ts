/**
 * 基准的采样、读数与报告序列化（M6-PERFORMANCE / issue #37）
 *
 * ## 为什么要有这一层，而不是直接 `console.log(performance.now() - t0)`
 *
 * 1. **样本与判据分开**：每个步骤记录**多次**样本（`min` 抗噪、`max` = 单次最长阻塞），
 *    报告给 `median` / `p95`，门禁用 `min` 与 `max`。只有一条数字时，「这台机器慢」与
 *    「这一步真的退了」分不开。
 * 2. **读数与结论分开**：`readout()` 记的是「事实」（桶数、要素数、包体字节、堆增长），
 *    `metric` 记的是耗时。混在一起会让报告看起来像「所有数字都是判据」。
 * 3. **报告必须自带身份**：机器 / 运行时 / DOM 替身 / SDK（Fake）/ 数据集版本。issue 的验收
 *    明确要求「所有 benchmark 记录 SDK/Fake、机器和数据版本」——缺了它，两个数字并排放着
 *    就是误导。
 *
 * ## 刻意的边界
 *
 * - 不做统计显著性、不做回归分析、不回传历史：需要的是「这一版是不是比上一版差了一大截」，
 *   而不是一个小型基准平台（本票非目标、范围纠正都点名禁止把工具本身做成平台）。
 * - **不假装是浏览器基准**：本套跑在 vitest + happy-dom 里，`performance.now()` 是 Node 的，
 *   没有真实渲染、没有真实长任务调度。因此这里测到的是**主线程 JS 工作量**，
 *   「SDK 侧真实重绘成本」不在其中（报告里以 `notMeasured` 显式列出，见 `note()`）。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, platform, arch, release, totalmem } from "node:os";
import { resolve } from "node:path";

/** 一个被采样的步骤。 */
export interface PerfMetricStat {
  readonly name: string;
  /** 样本（毫秒），按采集顺序。 */
  readonly samples: readonly number[];
  /** 最好一次：抗机器噪声，**门禁判据**用它。 */
  readonly min: number;
  readonly median: number;
  /** 最坏一次：就是「单次最长阻塞」，用来对照 50ms 长任务线。 */
  readonly max: number;
}

export interface PerfSnapshot {
  /** 产出这份快照的基准文件标签（如 `preprocess`）。 */
  readonly file: string;
  readonly dataset: Record<string, unknown>;
  /** 被测引擎：本库当前只有 Fake v4（真实 SDK 无法在无浏览器环境里跑）。 */
  readonly engine: string;
  readonly environment: Record<string, unknown>;
  readonly metrics: readonly PerfMetricStat[];
  readonly readouts: Record<string, number | string>;
  /** 明确写出「本套测不到什么」，避免读者把读数外推到真实浏览器。 */
  readonly notMeasured: readonly string[];
}

export interface RecordOptions {
  /**
   * 采样次数（每次采样之间**不做**任何清理：要测的就是稳定态）。
   * 缺省 5：够取 `min`/`max`，又不会让 50k 规模的整轮跑很久。
   */
  readonly samples?: number;
  /**
   * 预热次数（结果丢弃）。默认 1：第一次调用常包含 Map 扩容 / 内联缓存未热等一次性成本，
   * 把它算进 `min` 会让读数虚高，但**预热不能太多**——本票关心的是「稳态成本」，
   * 不是「冷启动成本」（冷启动另有一条 `timeFirst` 读数）。
   */
  readonly warmup?: number;
}

function stat(name: string, samples: number[]): PerfMetricStat {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)]!;
  return {
    name,
    samples: [...samples],
    min: sorted[0] ?? 0,
    median: mid,
    max: sorted[sorted.length - 1] ?? 0,
  };
}

export interface PerfRecorder {
  /** 计时一个同步步骤（结果取最后一次调用的返回值）。 */
  time<T>(name: string, fn: () => T, options?: RecordOptions): T;
  /** 记录一条**外部**测得的样本（组件路径那类不能重复跑的步骤用它逐次采样）。 */
  sample(name: string, ms: number): void;
  /** 记一条事实读数（计数 / 字节）——它不是判据，只是让人能解释耗时。 */
  readout(name: string, value: number | string): void;
  /** 记一条「本套测不到什么」。 */
  notMeasured(text: string): void;
  /** 取某个步骤的统计（门禁断言用）。 */
  stat(name: string): PerfMetricStat;
  /** 当前快照（含环境与数据集自述）。 */
  snapshot(): PerfSnapshot;
  /** 把快照写到 `<PERF_METRICS_DIR>/bmv-perf-<file>.json`；返回落盘路径。 */
  flush(): string;
}

/** 读一个已安装包的版本（缺失时给 `unknown`：报告里出现 `unknown` 比编一个假版本好）。 */
function packageVersion(fromDir: string, name: string): string {
  try {
    const manifest = JSON.parse(
      readFileSync(resolve(fromDir, `node_modules/${name}/package.json`), "utf8"),
    ) as { version?: string };
    return manifest.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function createPerfRecorder(input: {
  readonly file: string;
  readonly dataset: Record<string, unknown>;
  /** 根目录（缺省 `process.cwd()`，即仓库根）。 */
  readonly root?: string;
}): PerfRecorder {
  const root = input.root ?? process.cwd();
  const metrics = new Map<string, number[]>();
  const readouts: Record<string, number | string> = {};
  const notMeasured: string[] = [];

  const capture = (name: string, ms: number): void => {
    const samples = metrics.get(name) ?? [];
    samples.push(ms);
    metrics.set(name, samples);
  };

  const snapshot = (): PerfSnapshot => ({
    file: input.file,
    dataset: input.dataset,
    engine: "fake-v4",
    environment: {
      node: process.version,
      platform: platform(),
      release: release(),
      arch: arch(),
      cpuModel: cpus()[0]?.model ?? "unknown",
      cpuCount: cpus().length,
      totalMemoryGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
      vitest: packageVersion(root, "vitest"),
      // 明确写出来：这一套没有真实浏览器（issue 的「浏览器版本」在这一档里就是 DOM 替身）。
      dom: `happy-dom ${packageVersion(root, "happy-dom")}`,
      // 被测的「SDK」是 Fake：它只做记账，不做渲染。真实 SDK 的重绘成本不在读数内。
      sdk: "Fake v4（packages/test-utils/fake-bmap-v4）",
    },
    metrics: [...metrics.entries()].map(([name, samples]) => stat(name, samples)),
    readouts: { ...readouts },
    notMeasured: [...notMeasured],
  });

  return {
    time(name, fn, options = {}) {
      const warmup = options.warmup ?? 1;
      const samples = options.samples ?? 5;
      let last!: ReturnType<typeof fn>;
      for (let i = 0; i < warmup; i += 1) last = fn();
      for (let i = 0; i < samples; i += 1) {
        const start = performance.now();
        last = fn();
        capture(name, performance.now() - start);
      }
      return last;
    },
    sample(name, ms) {
      capture(name, ms);
    },
    readout(name, value) {
      readouts[name] = value;
    },
    notMeasured(text) {
      notMeasured.push(text);
    },
    stat(name) {
      const samples = metrics.get(name);
      if (!samples || samples.length === 0) {
        throw new Error(`没有名为 ${name} 的基准步骤（未采集就断言，等于门禁空转）`);
      }
      return stat(name, samples);
    },
    snapshot,
    flush() {
      // 缺省落在 `.artifacts/perf/metrics`：它已在 `.gitignore` 里，而 `pnpm test:performance`
      // 也是常规命令——写到仓库根下一个没被忽略的目录会让每次跑测试都留下未跟踪文件。
      const dir = process.env.PERF_METRICS_DIR ?? resolve(root, ".artifacts/perf/metrics");
      mkdirSync(dir, { recursive: true });
      const out = resolve(dir, `bmv-perf-${input.file}.json`);
      writeFileSync(out, `${JSON.stringify(snapshot(), null, 2)}\n`);
      return out;
    },
  };
}
