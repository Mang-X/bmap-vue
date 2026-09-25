/**
 * 包体对照的**纯逻辑**：读数渲染 / 判据（issue #140 · 指标 8「bundle/tarball 入口大小」）
 *
 * 与 `report.mts`（Fake 档）、`tests/browser/official-contrast/report.mts`（真实浏览器档）
 * 同一分工：只吃 JSON 形状的入参、只吐文本与退出码，不 import vite、不读 `process.argv`。
 * 因此可以用合成读数直接单测，不必真跑一次打包。
 *
 * ## 口径（与前两档**不同**的一档，要单独讲清）
 *
 * 前面两档量的是**运行时**行为；这里量的是**发包字节**。两者最要紧的区别：
 *
 * 1. **绝对值可比，但只在「同一份打包配置」下可比。** 这条读数里**记录了配置**
 *    （external / minify / target），换任何一个都会让数字换意义 —— 所以配置进报告，
 *    而不是只活在脚本里。
 * 2. **不判胜负。** 官方当前是**单文件**产物（`dist/index.js` 一处装全，`sideEffects:false`
 *    但没有可摇的粒度），本库是**多 chunk** 产物。打包形态不同是上游事实，不是谁更强。
 *    唯一能判「回退」的是**本库自身相对自己的基线**（`--update` 录进
 *    `tests/performance/bundle-baseline.json`，与 `baseline.json` 分开——那个是运行时指标集，
 *    混进去会让 `collect-performance-baseline.mts` 的双向校验炸掉）。
 * 3. **不写百分比。** 票面禁止「X 倍更快」式的无支撑排名。差值只给**字节**。
 */

export const BUNDLE_REPORT_VERSION = 1;

/** 两侧共用的打包配置——进报告，读者不必回头翻脚本就知道数字是什么条件下量的。 */
export interface BundleBuildRecipe {
  /** 未被打进产物的 specifier。 */
  readonly external: readonly string[];
  /** 是否压缩（`true` / `false` / 具体压缩器名）。 */
  readonly minify: string;
  /** 编译目标。 */
  readonly target: string;
  /** 产物格式（Vite 8 / rolldown 下为 ESM）。 */
  readonly format: string;
}

/** 一个包在「基本路径」下的产物读数。 */
export interface BundleSideReading {
  readonly package: string;
  readonly version: string;
  /** `entry.mjs` 的字节数。 */
  readonly entryBytes: number;
  /** 闭包内其余 chunk 的字节数合计。 */
  readonly chunkBytes: number;
  /** 闭包内 css 的字节数合计。 */
  readonly cssBytes: number;
  /** 闭包内 chunk 文件数。 */
  readonly chunkCount: number;
  /**
   * 该包**运行时会加载**的文件在磁盘上的字节数合计。
   *
   * **刻意排除 `.map` 与 `.d.ts`**：两侧发不发 sourcemap 是发布偏好（本库 17 张 map
   * 共 5.6 MB，官方 0 张），把它算进来量到的不是「库有多大」；`.d.ts` 只在编译期被读。
   * 排除后比的是同一件事：装进 `node_modules`、运行时代码会读到的字节。
   *
   * 压缩后的 tarball 体积**不在**这里——那是 `verify-package` / npm 的账，且与本档
   * 测的「基本路径入口大小」是两个问题。
   */
  readonly distBytes: number;
  /** 入口形状（引用了哪些公开面），供人核对两边是同一份任务。 */
  readonly entryImports: readonly string[];
}

export interface BundleReport {
  readonly version: number;
  readonly mode: "bundle";
  readonly done: boolean;
  readonly fatal: string | null;
  readonly blockedReason: string | null;
  readonly notes: readonly string[];
  readonly recipe: BundleBuildRecipe;
  readonly ours: BundleSideReading;
  readonly official: BundleSideReading;
  readonly startedAt: string;
  readonly finishedAt: string;
}

export type BundleExitCode = 0 | 1 | 2 | 3;

/* ------------------------------------------------------------------ 判定 */

export interface BundleDecision {
  readonly exitCode: BundleExitCode;
  readonly ok: boolean;
  readonly reasons: readonly string[];
}

/**
 * 退出码判定（纯函数）。
 *
 * 与前两档同一优先级：脚手架(2) > 基线回退(1) > blocked(3) > 通过(0)。
 *
 * `baseline` 的形状刻意做成 `unknown | null` 而不是省略键：**没有基线**（首轮 /
 * 没录过）与**基线里查无此项**要能分开报。前者是「还没建立基准」→ blocked(3)，
 * 后者是「基线文件对不上当前版本」→ 脚手架失败(2)。合成一处会得到一个查不到原因的绿。
 */
export function decideBundleExit(input: {
  envelopeIssues: readonly string[];
  fatal: string | null;
  blockedReason: string | null;
  done: boolean;
  /** 本轮量到的本库入口字节。 */
  oursEntryBytes: number;
  /** 本轮跑的本库版本。 */
  version: string;
  /** 读到的基线读数；`null` = 基线文件存在但查无此项；`undefined` = 压根没读基线。 */
  baseline: BundleSideReading | null | undefined;
}): BundleDecision {
  const reasons: string[] = [];
  for (const issue of input.envelopeIssues) reasons.push(`ENVELOPE: ${issue}`);

  if (input.fatal) reasons.push(`FATAL: ${input.fatal}`);
  if (!input.done && !input.fatal && !input.blockedReason) {
    reasons.push("INCOMPLETE: 未 done 且未给出 blockedReason（无法归因）");
  }
  if (input.blockedReason) reasons.push(`BLOCKED: ${input.blockedReason}`);

  if (input.baseline === undefined) {
    reasons.push("BLOCKED: 没有基线读数（先跑一次 `--update` 录基线）");
  } else if (input.baseline !== null && input.baseline.version !== input.version) {
    reasons.push(
      `BUNDLE_BASELINE_VERSION_DRIFT: 基线是 ${input.baseline.version}，本轮跑的是 ${input.version}`,
    );
  }

  if (input.envelopeIssues.length > 0 || input.fatal) {
    return { exitCode: 2, ok: false, reasons };
  }
  // 基线漂了 = 读数不可归因（拿了 v1 的基线比 v2 的产物）→ 脚手架失败，不是回退。
  if (
    input.baseline === null ||
    (input.baseline !== undefined && input.baseline.version !== input.version)
  ) {
    return { exitCode: 2, ok: false, reasons };
  }
  if (!input.done || input.blockedReason || input.baseline === undefined) {
    return { exitCode: 3, ok: false, reasons };
  }

  // 唯一的回退判据：本库自己的**入口**相对自己的基线变大。
  // 只看 entryBytes，不看闭包总和：闭包总和会被 chunk 划分方式左右（同一个库在不同
  // vite 小版本下可能多切一个 chunk），而入口字节的变化才对应「基本路径真的变重了」。
  if (input.baseline !== undefined) {
    const delta = input.oursEntryBytes - input.baseline.entryBytes;
    if (delta > 0) {
      reasons.push(
        `BUNDLE_REGRESSION: 本库基本路径入口 ${input.oursEntryBytes}B，基线 ${input.baseline.entryBytes}B（+${delta}B）`,
      );
      return { exitCode: 1, ok: false, reasons };
    }
  }
  return { exitCode: 0, ok: true, reasons };
}

/* ------------------------------------------------------------------ 渲染 */

function bytes(value: number): string {
  return `${value} B`;
}

function kb(value: number): string {
  return `${(value / 1024).toFixed(1)} KiB`;
}

function sideRow(side: BundleSideReading): string[] {
  return [
    `${side.package}@${side.version}`,
    `    入口    ${bytes(side.entryBytes)} (${kb(side.entryBytes)})`,
    `    chunk   ${bytes(side.chunkBytes)} × ${side.chunkCount}`,
    `    css     ${bytes(side.cssBytes)}`,
    `    发布物  ${bytes(side.distBytes)}（不含 .map / .d.ts）`,
  ];
}

/**
 * 人读报告。
 *
 * **只给字节差，不给百分比、不给「X 倍」**——票面禁止无支撑的排名说法。两侧并排给，
 * 让读者自己看形状；唯一的判定是本库相对**自己基线**的那个字节差。
 */
export function formatBundleReport(input: {
  report: BundleReport;
  decision: BundleDecision;
}): string {
  const { report, decision } = input;
  const lines: string[] = [];
  const { ours, official } = report;
  const closureOurs = ours.entryBytes + ours.chunkBytes + ours.cssBytes;
  const closureOfficial = official.entryBytes + official.chunkBytes + official.cssBytes;

  lines.push("== 官方对照基准（#140 · 包体档）==");
  lines.push(`env   ours=${ours.version} vs official=${official.version}`);
  lines.push(
    `env   recipe=external[${report.recipe.external.join(",")}] minify=${report.recipe.minify} target=${report.recipe.target} format=${report.recipe.format}`,
  );
  lines.push(`run   id-start=${report.startedAt} done=${report.done}`);
  if (report.fatal) lines.push(`run   FATAL: ${report.fatal}`);
  if (report.blockedReason) lines.push(`run   BLOCKED: ${report.blockedReason}`);
  for (const note of report.notes) lines.push(`run   NOTE: ${note}`);
  lines.push("");

  lines.push("--- bmap-vue ---");
  lines.push(...sideRow(ours));
  lines.push("--- @baidumap/vue-bmap ---");
  lines.push(...sideRow(official));
  lines.push("");

  lines.push(`闭包合计 ours=${bytes(closureOurs)} official=${bytes(closureOfficial)} 差=${closureOurs - closureOfficial}B`);
  lines.push("入口差  ours=" + bytes(ours.entryBytes) + " official=" + bytes(official.entryBytes) +
    ` 差=${ours.entryBytes - official.entryBytes}B`);
  lines.push("");
  lines.push("--- node ---");
  lines.push(`node  exit=${decision.exitCode} ok=${decision.ok}`);
  for (const reason of decision.reasons) lines.push(`node  ${reason}`);
  lines.push("");
  lines.push("口径提醒：");
  lines.push("  - 官方当前是**单文件**产物，本库是**多 chunk**。打包形态不同是上游事实，不是谁更强。");
  lines.push("  - 本档只判「本库相对**自己基线**的入口字节变没变大」，不判谁比谁小。");
  lines.push("  - 换打包配置（external / minify / target）会让这些数字换意义——配置已随读数记录。");
  return lines.join("\n");
}
