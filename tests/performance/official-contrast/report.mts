/**
 * 官方对照基准的**纯逻辑**：信封自检 / 退出码 / 人读报告（issue #140）
 *
 * 与 `tests/browser/live-performance/report.mts` 同一分工：只吃 JSON 形状的入参、只吐文本与
 * 退出码——不 import vitest、不碰 `window`、不读 `process.argv`。页面与 Node 编排共用同一份
 * 渲染与判定，用例可直接构造读数钉它。
 *
 * ## 三个必须写死的口径（票面 #140 的硬规则）
 *
 * 1. **不伪造官方等价物**：`official === null` 的场景进 `oursOnly` 节，**永不**与官方数字并排；
 * 2. **绝对毫秒不作门禁**：可比性判据是「同一台机器身份」（沿用 `performance-baseline.md`
 *    的 `platform + arch + cpuModel` 口径），否则只出报告；
 * 3. **「没跑」≠「通过」**：blocked 走退出码 3，不落 0。
 *
 * 本档**没有**退出码 1 以外的性能阈值门禁之外的东西——唯一能返回 1 的���「不变式被破坏」
 * （场景 4 的「父级无关更新不重发 path」），而不是「谁比谁快多少」。
 */

/** 报告载荷版本：报告要能自证「跑的是哪一版候选」。 */
export const CONTRAST_REPORT_VERSION = 1;

/** 单侧（某个库）在一个场景上的读数。 */
export interface ContrastSideReadings {
  /** 墙钟毫秒（`null` = 本轮没测到；**不填 0**，0 会被读成「快得不可能」）。 */
  readonly durationMs: number | null;
  /**
   * **卸载 / 销毁**的墙钟毫秒（独立窗口）。
   *
   * 票面指标 5 写的是「mount/unmount time」——两个动作。合成一个数字就没法归因「慢在挂载
   * 还是慢在卸载」，只报一个数字又会让读者以为两个都测了（第 2 轮评审第 5 条）。本档此前
   * 只有 mount 一侧，销毁成本没有任何读数。
   */
  readonly teardownMs: number | null;
  /**
   * 窗口内**某一个** SDK 调用面的调用次数（**增量**，不含挂载阶段）。
   *
   * ⚠️ **它不是票面那个泛指的「SDK 调用总数」**——Fake v4 没有「所有 SDK 调用」的单一
   * 计数器（真实 SDK 也没有），所以这一列必须带名字才是诚实的。默认口径是
   * `listenCalls`（监听订阅次数），场景 3/4/5 各自按 SDK 语义覆盖成 `setPosition` /
   * `setPath`；`callKind` 说明这一行**具体数的是哪个调用面**。票面原口径「SDK 调用
   * 总数」进 `notMeasured`（第 1 轮评审第 8 条）。
   */
  readonly sdkCalls: number;
  /** `sdkCalls` 具体数的调用面（`listen` / `setPosition` / `setPath`）。 */
  readonly callKind: string;
  /** 该动作窗口内**新建**的 SDK 实例数（地图 / 覆盖物 / 图层，按实例计）。 */
  readonly recreates: number;
  /**
   * 窗口内触发的**组件渲染**次数（Vue devtools `perf:start`，`type === "render"`，dev-only）。
   *
   * ⚠️ 它**不是**票面的「watcher 回调次数」——Vue 3 没有公开的 watcher 计数面，本档量的是
   * 组件渲染；两者不等价（一次渲染可以触发 0..N 个 watcher）。票面原口径进 `notMeasured`
   * （第 1 轮评审第 8 条）。
   */
  readonly renderCallbacks: number;
  /** 动作结束后**仍未释放**的 SDK 资源数（0 = 干净）。本库应为 0；官方如实记录。 */
  readonly retainedResources: number;
  /** 动作结束后仍未释放的监听器数。 */
  readonly retainedListeners: number;
}

export interface ContrastScenarioReadings {
  readonly id: string;
  /** 官方等价物；`null` = 本库扩展档（报告单列，不并排）。 */
  readonly official: string | null;
  readonly ours: ContrastSideReadings | null;
  readonly officialSide: ContrastSideReadings | null;
  /** 官方这一侧被跳过的原因（`official === null` 时必填；跑挂了也填）。 */
  readonly officialSkippedReason?: string;
}

/** 场景级**不变式**：不是性能判据，是「架构预期是否还成立」。 */
export interface ContrastInvariant {
  readonly id: string;
  readonly scenario: string;
  readonly description: string;
  readonly holds: boolean;
  /**
   * 哪一侧被钉。
   *
   * `official` 的那条是**读数**，不是门禁：官方没做到某件事不构成本库的回归，拿它卡门禁
   * 等于用别人的缺陷判本库失败。它照样出现在报告里（`holds: false` 会被显式列出），
   * 但 `decideContrastExit` 只对 `ours` / `both` 判失败。
   */
  readonly side: "ours" | "official" | "both";
}

export interface ContrastEnvelope {
  readonly runId: string;
  /** 本库版本（`packages/bmap-vue/package.json`）。 */
  readonly oursVersion: string;
  /** 官方版本（**必须**是票面锁定的 1.0.1）。 */
  readonly officialVersion: string;
  readonly datasetVersion: string;
  /** 机器身份：可比性的判据三件套。 */
  readonly platform: string;
  readonly arch: string;
  readonly cpuModel: string;
  readonly node: string;
}

export interface ContrastReport {
  readonly version: number;
  readonly mode: "fake-v4";
  readonly done: boolean;
  readonly fatal: string | null;
  readonly blockedReason: string | null;
  readonly notes: readonly string[];
  readonly envelope: ContrastEnvelope;
  readonly scenarios: readonly ContrastScenarioReadings[];
  readonly invariants: readonly ContrastInvariant[];
  /** 本档**测不到**什么（必须显式列出，禁止把 Fake 读数外推到浏览器）。 */
  readonly notMeasured: readonly string[];
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
}

export type ContrastExitCode = 0 | 1 | 2 | 3;

/** 票面锁定的官方基线版本：偏离它就不是这次对照了。 */
export const OFFICIAL_BASELINE_VERSION = "1.0.1";

/* ------------------------------------------------------------------ 信封 */

/**
 * 信封自检。
 *
 * 官方版本**必须**精确等于 `OFFICIAL_BASELINE_VERSION`：票面把 `@baidumap/vue-bmap@1.0.1`
 * 定为「基线锁版本」，对着别的版本出的数字不能叫「与 1.0.1 的对照」。
 */
export function checkContrastEnvelope(
  report: Pick<ContrastReport, "version" | "envelope">,
  expected: { runId: string; datasetVersion: string },
): string[] {
  const issues: string[] = [];
  if (report.version !== CONTRAST_REPORT_VERSION) issues.push("CONTRAST_VERSION_MISMATCH");
  if (report.envelope.runId !== expected.runId) issues.push("CONTRAST_RUN_ID_MISMATCH");
  if (report.envelope.datasetVersion !== expected.datasetVersion) {
    issues.push("CONTRAST_DATASET_VERSION_MISMATCH");
  }
  if (report.envelope.officialVersion !== OFFICIAL_BASELINE_VERSION) {
    issues.push(`CONTRAST_OFFICIAL_VERSION_DRIFT: ${report.envelope.officialVersion}`);
  }
  return issues;
}

/** 机器身份是否与既有基线同一台（跨机只出报告，不做绝对值比较）。 */
export function sameMachine(a: ContrastEnvelope, b: ContrastEnvelope): boolean {
  return a.platform === b.platform && a.arch === b.arch && a.cpuModel === b.cpuModel;
}

/* ------------------------------------------------------------------ 判定 */

export interface ContrastDecision {
  readonly exitCode: ContrastExitCode;
  readonly ok: boolean;
  readonly reasons: readonly string[];
}

/**
 * 退出码判定（纯函数；优先级：脚手架(2) > 不变式破坏(1) > blocked(3) > 通过(0)）。
 *
 * 注意**没有**「比官方慢就算回退」这一条：那正是票面禁止的营销式排名。比值只进报告。
 * 唯一能返回 1 的是不变式（架构预期被破坏），它与机器快慢无关。
 *
 * ## `scenarioCount` 必须是「**真的测到**」的数，不是「**填了行**」的数
 *
 * `buildScenarioReadings()` 永远按场景表逐条产出一行（没跑到的填 `ours: null`），
 * 因此 `report.scenarios.length` **恒等于**场景表条数——拿它当「采齐了没」是恒真的
 * 假绿（第 1 轮评审第 6 条）。调用方必须数 `ours !== null` 的行。
 */
export function decideContrastExit(input: {
  envelopeIssues: readonly string[];
  fatal: string | null;
  blockedReason: string | null;
  done: boolean;
  expectedScenarioCount: number;
  scenarioCount: number;
  /**
   * 声明了官方等价物（可比较）的场景数；`null` / `undefined` = 本档不做这项校验。
   *
   * 配套的 `comparableScenarioCount` 是「真的拿到官方侧读数（`officialSide !== null`）
   * 的可比较场景数」。两者不等就是**缺一侧的对照**——那不是本库的回归，但它也**不是**
   * 「这个场景已对照」。票面要的是同场景对照，缺一侧必须显式报出来，不能被读成通过。
   */
  expectedComparableScenarios?: number | null;
  comparableScenarioCount?: number;
  invariants: readonly ContrastInvariant[];
}): ContrastDecision {
  const reasons: string[] = [];
  for (const issue of input.envelopeIssues) reasons.push(`ENVELOPE: ${issue}`);

  if (input.fatal) reasons.push(`FATAL: ${input.fatal}`);
  if (!input.done && !input.fatal && !input.blockedReason) {
    reasons.push("INCOMPLETE: 页面未 done 且未给出 blockedReason（无法归因）");
  }
  if (input.blockedReason) reasons.push(`BLOCKED: ${input.blockedReason}`);
  if (input.done && input.scenarioCount < input.expectedScenarioCount) {
    reasons.push(
      `INCOMPLETE: 场景 ${input.scenarioCount}/${input.expectedScenarioCount}（缺项不能当通过）`,
    );
  }
  if (
    input.expectedComparableScenarios != null &&
    input.comparableScenarioCount != null &&
    input.done &&
    input.comparableScenarioCount < input.expectedComparableScenarios
  ) {
    reasons.push(
      `INCOMPLETE: 可比场景缺官方侧读数 ` +
        `${input.comparableScenarioCount}/${input.expectedComparableScenarios}（缺一侧不算已对照）`,
    );
  }
  for (const invariant of input.invariants) {
    // 只对**本库侧**的不变式判失败（`official` 那条是读数，见 `ContrastInvariant.side`）。
    if (!invariant.holds && invariant.side !== "official") {
      reasons.push(
        `INVARIANT_BROKEN: ${invariant.id} (${invariant.scenario}) — ${invariant.description}`,
      );
    }
  }

  if (input.envelopeIssues.length > 0 || input.fatal) {
    return { exitCode: 2, ok: false, reasons };
  }
  const broken = input.invariants.filter(
    (entry) => !entry.holds && entry.side !== "official",
  );
  if (broken.length > 0) {
    return { exitCode: 1, ok: false, reasons };
  }
  if (!input.done || input.blockedReason || input.scenarioCount < input.expectedScenarioCount) {
    return { exitCode: 3, ok: false, reasons };
  }
  if (
    input.expectedComparableScenarios != null &&
    input.comparableScenarioCount != null &&
    input.comparableScenarioCount < input.expectedComparableScenarios
  ) {
    return { exitCode: 3, ok: false, reasons };
  }
  return { exitCode: 0, ok: true, reasons };
}

/* ------------------------------------------------------------------ 渲染 */

function round(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return "-";
  const factor = 10 ** digits;
  return String(Math.round(value * factor) / factor);
}

function sideCell(side: ContrastSideReadings | null): string {
  if (!side) return "-";
  // 动作耗时与卸载耗时**都**打出来，并各自带标签：场景名写着「mount / destroy」时，
  // 只给一个数字会被读成两个动作都测了。
  return (
    `act=${round(side.durationMs)}ms teardown=${round(side.teardownMs)}ms / ` +
    `${side.callKind}=${side.sdkCalls} / recreate=${side.recreates} / ` +
    `render=${side.renderCallbacks} / retain=${side.retainedResources}+${side.retainedListeners}listeners`
  );
}

/**
 * 按**实际最长值**算列宽，并用 ` | ` 分隔。
 *
 * 不写死宽度：`padEnd(n)` 对超长内容既不截断也不补空格，因此任何「再加一个字段」都会
 * 让相邻列粘在一起——上一轮加 `teardown=` 时就是这样（76 → 实测 83~99）。动态算 + 显式
 * 分隔符让这件事不可能再发生。
 */
function formatTable(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => (row[column] ?? "").length)),
  );
  const render = (cells: readonly string[]): string =>
    cells
      .map((cell, column) =>
        // 末列不补尾随空格（否则每行都拖一串看不见的空白）。
        column === cells.length - 1 ? cell : cell.padEnd(widths[column]!),
      )
      .join(" | ");
  return [render(header), ...rows.map(render)];
}

/**
 * 人读报告。
 *
 * **分三节**，这是票面「不伪造官方等价物」在输出层的落点：
 * - 「可比场景」：两边都有的才进这张表，每行带差值（差值**只作读数**）；
 * - 「本库扩展档」：官方无等价物，**不与任何数字比较**，只列本库读数 + 为什么没有官方对照；
 * - 「不变式」：架构预期，与快慢无关。
 */
export function formatContrastReport(input: {
  report: ContrastReport;
  decision: ContrastDecision;
}): string {
  const { report, decision } = input;
  const lines: string[] = [];
  const env = report.envelope;

  lines.push("== 官方对照基准（#140 · fake-v4 档）==");
  lines.push(
    `env   ours=${env.oursVersion} vs official=${env.officialVersion} dataset=v${env.datasetVersion}`,
  );
  lines.push(
    `env   machine=${env.cpuModel} · ${env.platform}/${env.arch} · node ${env.node} · mode=${report.mode}`,
  );
  lines.push(
    `run   id=${env.runId} done=${report.done} in ${report.durationMs}ms`,
  );
  if (report.fatal) lines.push(`run   FATAL: ${report.fatal}`);
  if (report.blockedReason) lines.push(`run   BLOCKED: ${report.blockedReason}`);
  for (const note of report.notes) lines.push(`run   NOTE: ${note}`);
  lines.push("");

  const comparable = report.scenarios.filter((entry) => entry.official !== null);
  const oursOnly = report.scenarios.filter((entry) => entry.official === null);

  lines.push("--- 可比场景（两边都有官方等价物）---");
  // ⚠️ 列宽**动态算**，不写死（三轮评审第 3 条）。此前 ours / official 各自 `padEnd(76)`，
  // 而加了 `teardown=` 之后单元格实测 83 ~ 99 字符 —— `padEnd` 对超长内容**不截断也不补空格**，
  // 于是三列直接粘在一起：`…retain=0+0listenersact=…`，CI 日志里根本分不出列边界。
  //
  // 靠固定宽度兜底迟早再被新字段顶破（这是第二轮加 teardown 时发生的）。因此按本表**实际
  // 最长值**算宽度，并用显式 `|` 分隔：再长的字段也不会让两列粘住。
  const rows = comparable.map((entry) => {
    const ours = entry.ours;
    const off = entry.officialSide;
    let delta = "-";
    if (ours?.durationMs != null && off?.durationMs != null) {
      const diff = round(ours.durationMs - off.durationMs);
      // 差值列同时给动作与卸载两段，读者不必自己相减才能看出卸载差多少。
      const teardownDiff =
        ours.teardownMs != null && off.teardownMs != null
          ? ` / teardownΔ${round(ours.teardownMs - off.teardownMs)}ms`
          : "";
      delta = `${diff}ms${teardownDiff}`;
    }
    return [entry.id, sideCell(entry.ours), sideCell(entry.officialSide), delta] as const;
  });
  for (const line of formatTable(["scenario", "ours", "official", "delta"], rows)) {
    lines.push(line);
  }
  for (const entry of comparable) {
    if (entry.officialSkippedReason) {
      lines.push(`${" ".repeat(Math.max(entry.id.length, 8))} | official skipped: ${entry.officialSkippedReason}`);
    }
  }
  lines.push("");

  lines.push("--- 本库扩展档（官方无等价契约，**不硬比较**）---");
  for (const entry of oursOnly) {
    lines.push(`${entry.id.padEnd(Math.max(entry.id.length, 8))} | ${sideCell(entry.ours)}`);
    lines.push(
      `${" ".repeat(Math.max(entry.id.length, 8))} | official: 无等价物 — ${entry.officialSkippedReason ?? "未提供说明"}`,
    );
  }
  lines.push("");

  lines.push("--- 不变式（架构预期，与快慢无关）---");
  for (const invariant of report.invariants) {
    lines.push(
      `${invariant.holds ? "PASS" : "FAIL"} ${invariant.id} [${invariant.side}] ${invariant.scenario} — ${invariant.description}`,
    );
  }
  lines.push("");

  lines.push("--- node: envelope ---");
  lines.push(`node  exit=${decision.exitCode} ok=${decision.ok}`);
  for (const reason of decision.reasons) lines.push(`node  ${reason}`);
  lines.push("");

  lines.push("本档测不到（不要外推）：");
  for (const text of report.notMeasured) lines.push(`  - ${text}`);
  lines.push("  - 真实 SDK 重绘 / 真实浏览器帧调度（那是另一档，见 perf:contrast:live）");
  lines.push("");
  lines.push("口径注记（避免把列名读成票面原词）：");
  lines.push("  - `listen` / `setPosition` / `setPath` 那一列是**某个调用面**的次数，");
  lines.push("    不是票面泛指的「SDK 调用总数」（真实与 Fake 都没有单一计数器）；");
  lines.push("  - `render` 是**组件渲染**次数（devtools perf:start），不是「watcher 回调次数」；");
  return lines.join("\n");
}

/* ------------------------------------------------------------------ 报告形状守卫 */

/**
 * 读回的报告**能不能用**，在这里判一次。
 *
 * ⚠️ 这段逻辑一度住在编排脚本里，只能用「文件文本断言」钉——于是断言和被钉的代码
 * 各改各的，回归过一次（`scenarios: [null]` 能过「是数组」那一关，随后
 * `measuredScenarioCount` 解引用 null 抛 TypeError，逃出 `main()` 让 Node 以 **1** 结束，
 * 把「报告损坏」报成「不变式回退」）。移进纯模块是为了能**真的跑它**：门禁现在对
 * 合成输入断言，而不是对源文本做正则。
 *
 * 判据只有一条：**下游会不会解引用它**。所以验到数组**元素**这一层（元素为 `null`
 * 同样会崩），但不做全字段校验。
 */
/** 顶层不是一个对象（`null` / `[]` / 字符串 / 数字……）——下游会解引用 `.envelope`，必崩。 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 把「形状不对」讲成**具体哪一条不对**，而不是只列缺哪个键。
 *
 * ⚠️ 只报「缺什么」有个假绿读数：四个必需键**都在**、但**类型不对**时（`envelope: null`、
 * `scenarios: {}`），缺键列表是**空的** → 消息会变成「JSON 合法但不是对照报告（缺 ）」，
 * 既自相矛盾又指不出问题在哪。这里逐条给出实际的错。
 *
 * 返回 `null` = **形状没问题**。不要为「没毛病」编一条兜底 fault：调用方只在该拒时调用
 * 本函数，能走到空列表就说明守卫与叙述**不一致**（改了一边忘了另一边）——那本身要看得见，
 * 编个「形状与 v1 契约不符」把它盖掉才是真的看不见。
 */
export function describeReportShapeFault(value: unknown): string | null {
  if (isContrastReport(value)) return null;
  if (!isPlainObject(value)) {
    return `JSON 合法但不是对照报告（顶层是 ${describeJsonType(value)}，需为对象）`;
  }
  const faults: string[] = [];
  for (const key of REQUIRED_REPORT_FIELDS) {
    if (value[key] === undefined) faults.push(`缺 ${key}`);
  }
  // 键都在但类型不对：下游照样会崩（checkContrastEnvelope 会解引用 envelope.runId，
  // 计数函数会 .filter 数组），所以这里把「类型不对」也当形状错误，而不是放行。
  if (!isPlainObject(value.envelope)) {
    faults.push(`envelope 是 ${describeJsonType(value.envelope)}，需为对象`);
  }
  for (const key of ["scenarios", "invariants"] as const) {
    if (value[key] !== undefined && !Array.isArray(value[key])) {
      faults.push(`${key} 是 ${describeJsonType(value[key])}，需为数组`);
    } else if (Array.isArray(value[key])) {
      // ⚠️ 元素也要看：`scenarios: [null]` 能过「是数组」这一关，但计数函数随后
      // `entry.ours` 就解引用 null → TypeError 逃出 main() → Node 以 **1** 结束 ——
      // 正是本函数要消灭的「垃圾报告被报成不变式回退」。所以形状验到**元素**这一层。
      const items = value[key] as unknown[];
      const bad = items.findIndex((item) => !isPlainObject(item));
      if (bad >= 0) {
        faults.push(`${key}[${bad}] 是 ${describeJsonType(items[bad])}，需为对象`);
      }
    }
  }
  return `JSON 合法但不是对照报告（${faults.join(" / ") || "形状与 v1 契约不符"}）`;
}

export function describeJsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "数组";
  const names: Record<string, string> = {
    string: "字符串",
    number: "数字",
    boolean: "布尔",
    bigint: "bigint",
    symbol: "symbol",
    function: "函数",
    undefined: "undefined",
    object: "对象",
  };
  return names[typeof value] ?? typeof value;
}

/** 下游一定会解引用的四个字段。 */
const REQUIRED_REPORT_FIELDS = ["envelope", "scenarios", "invariants", "done"] as const;

/**
 * 形状守卫：验「下游会解引用的东西在不在、类型对不对」，不做全字段校验。
 *
 * 验到**数组元素**这一层不是洁癖：`measuredScenarioCount` 会 `entry.ours`、
 * `decideContrastExit` 会读 `invariant.holds / .side`——元素是 `null` 时这些都抛 TypeError，
 * 逃出 `main()` 后 Node 以 **1** 结束，把「报告损坏」说成「不变式回退」。只验容器不验元素，
 * 那条假绿路径原封不动地留着（`scenarios: [null]` 就是现成的例子）。
 */
export function isContrastReport(value: unknown): value is ContrastReport {
  if (!isPlainObject(value)) return false;
  if (REQUIRED_REPORT_FIELDS.some((key) => value[key] === undefined)) return false;
  if (!isPlainObject(value.envelope)) return false;
  for (const key of ["scenarios", "invariants"] as const) {
    const items = value[key];
    if (!Array.isArray(items)) return false;
    if (!items.every((item) => isPlainObject(item))) return false;
  }
  return true;
}
