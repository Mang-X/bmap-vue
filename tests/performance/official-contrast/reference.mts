/**
 * 「版本化实验快照」（reference result）的形状与纯逻辑（issue #140）
 *
 * ## 它**不是** baseline —— 名字与语义都刻意避开那个词
 *
 * #37 的 `tests/performance/baseline.json` 是**真基线**：后续运行会拿它做趋势判定，带
 * normalizer / tolerance / 机器身份比较。本模块**不做**这件事，也不该被后来的人加上：
 * 票面明说「不做谁整体更快的营销排名」，毫秒在 GitHub runner 与开发机上完全不可比。一旦
 * 快照参与漂移判定，维护者迟早会补上 tolerance、runner 换 SKU 处理、跨机归一化——
 * 那正是本票要避免的机制。所以：
 *
 * ```text
 * perf:contrast
 *   ├─ 产当前 report
 *   ├─ 用 invariants 判 CI（1 / 2 / 3 / 0）
 *   └─ **不**与 recorded-result.json 做任何毫秒比较
 * ```
 *
 * 它的唯一职责是 **provenance**（票面「数据与脚本入库」那半）：让几个月后看这份数字的人
 * 知道它是**哪一次跑**、**哪一版实现**、**哪台机器**、**哪份数据**、**哪两个库版本**测出来的。
 * 因此它必须带 `sourceCommit`——只有 `recordedAt` 的话，几年后只剩一个日期，对不上代码。
 *
 * ## 为什么不直接把 `.artifacts` 的报告原样 copy 进仓库
 *
 * 那份 envelope 混着**一次性编排字段**（`runId`、`startedAt`/`finishedAt`、`durationMs`）
 * 与**当轮环境细节**（node 绝对路径、机器 CPU）。前者每次都变、录进去只会制造无谓 diff；
 * 后者是 provenance 的一部分、该留。本模块给的是**稳定 schema**：字段少、语义固定、
 * 每次重录的 diff 都是「读数真的动了」而不是「时间戳动了」。
 */

// ⚠️ 从 `report.mts` 复用，**不**在本文件再抄一份：两处字面量相同的实现就是「两份事实源」，
// 抄一份的那天起，形状守卫与快照校验就会各改各的（同 ADR decision 15 的教训）。
import { isPlainObject } from "./report.mts";

/** 快照 schema 版本。结构变了要 +1，门禁会挡住旧 schema 混入。 */
export const REFERENCE_RESULT_VERSION = 1;

/** 跑出这份快照的机器身份（跨机不可比的判据三件套，沿用报告信封口径）。 */
export interface ReferenceEnvironment {
  readonly platform: string;
  readonly arch: string;
  readonly cpuModel: string;
  readonly node: string;
  /** 跑基准时的 vitest 版本（可复现的一环；`packageManager` 之类由 lockfile 保证）。 */
  readonly vitest?: string;
  /** DOM 实现（Fake 档固定 happy-dom；写进来是为了让「没浏览器」这件事在快照上可见）。 */
  readonly dom?: string;
}

/** 单侧在某个场景上的读数（只留有核对价值的字段，**不含** `null` 以外的填充值）。 */
export interface ReferenceSideReadings {
  /** 动作墙钟毫秒（`null` = 那一轮没测到；**不填 0**，0 会被读成「快得不可能」）。 */
  readonly actMs: number | null;
  /** 卸载/销毁墙钟毫秒（**独立窗口**，与动作分开取中位数）。 */
  readonly teardownMs: number | null;
  /** 某一个 SDK 调用面的调用次数（**不是**「总数」，`callKind` 说明数的是哪个面）。 */
  readonly sdkCalls: number;
  readonly callKind: string;
  /** 该动作窗口内**新建**的 SDK 实例数。 */
  readonly recreates: number;
  /** 窗口内触发的**组件渲染**次数（**不是** watcher 回调次数）。 */
  readonly renderCallbacks: number;
  /** 动作结束后**仍未释放**的 SDK 资源数（0 = 干净）。 */
  readonly retainedResources: number;
  readonly retainedListeners: number;
}

export interface ReferenceScenario {
  readonly id: string;
  /** 官方等价物；`null` = 本库扩展档。 */
  readonly official: string | null;
  readonly ours: ReferenceSideReadings | null;
  readonly officialSide: ReferenceSideReadings | null;
  /** 官方侧被跳过的原因（`official === null` 时必填）。 */
  readonly officialSkippedReason?: string;
}

/** 引擎种类。 */
export type EngineKind = "fake" | "real";

/** 本仓库 Fake 替身的引擎版本标识。票面写的是「同 JSAPI 4.0」，本档**没有**真实 JSAPI。 */
export const FAKE_ENGINE_VERSION = "fake-v4";

/** 真实档的引擎版本（票面锁定 JSAPI 4.0，`v=4.0`）。本轮未实跑。 */
export const REAL_ENGINE_VERSION = "4.0";

/**
 * `engine.kind` → 引擎版本的**唯一**配对表（`kind` 与 `version` 必须成对自洽）。
 *
 * ⚠️ 这张表是**事实源**：`collect-official-contrast.mts` 从它取 `engine.version`，
 * `checkReferenceResult` 拿它验「已入库的快照有没有自相矛盾」。两处各写一份就是两份事实源。
 */
export const ENGINE_VERSION_BY_KIND = {
  fake: FAKE_ENGINE_VERSION,
  real: REAL_ENGINE_VERSION,
} as const satisfies Record<EngineKind, string>;

/**
 * **实际被测的是什么**（票面「同环境、同 JSAPI 4.0」在 Fake 档不成立，得写进数据）。
 *
 * 票面对照版本写的是「本库最终 1.0 RC tarball」、环境写的是「同 JSAPI 4.0」。本档两条都
 * 达不到：无 AK ⇒ 没有真实 JSAPI 可加载（`jsapi-loader` 复用已存在的 `window.BMap`），
 * 而组件场景量的是 `src/**` 而不是打包产物。**达不成就写清楚**，而不是让 `mode: "fake-v4"`
 * 埋在 JSON 里、让人读视图照旧摆出一张「同 JSAPI 4.0」模样的表。
 */
export interface ReferenceEngine {
  /** `fake` = 本仓库 Fake v4 替身；`real` = 真实 JSAPI。 */
  readonly kind: EngineKind;
  /**
   * 引擎版本：Fake 档为 `fake-v4`；真实档是票面锁定的 `4.0`（`v=4.0`）。
   *
   * ⚠️ 与 `kind` **成对校验**，不各自放行：`kind: "fake"` 配 `version: "4.0"` 会让这组读数
   * 冒充「跑在真实 JSAPI 4.0 上」——正是本票最忌讳的那类含糊（同一个坑 AGENTS.md 在引擎
   * 取值上也钉过）。单看 `kind` 或单看 `version` 都挡不住，判据见 `checkReferenceResult` 的
   * `REFERENCE_ENGINE_PAIR_MISMATCH`。
   */
  readonly version: string;
  /**
   * 本库侧被测的是**源码还是产物**。
   *
   * ⚠️ 这一栏存在的理由：场景导入 `packages/bmap-vue/src/**`，而快照同时记着
   * `oursVersion: 1.0.0-rc.0`（读自 `package.json`）。两个都真，但**合起来是误导**——
   * provenance 说的那个构建从未被加载过。不写这一栏，读者会默认「测的是发布物」。
   */
  readonly oursUnderTest: "source" | "dist";
}

/** 入库的实测快照。**只承担 provenance，不参与任何毫秒判定。** */
export interface ReferenceResult {
  readonly version: number;
  readonly mode: "fake-v4";
  /** 引擎与被测物的真实身份（见 `ReferenceEngine`）。人读视图**必须**据此加限定语。 */
  readonly engine: ReferenceEngine;
  /** 录下来的时刻（ISO）。与 `sourceCommit` 一起构成「哪一次跑」。 */
  readonly recordedAt: string;
  /** 跑出这份读数的 **commit SHA**——没有它，几年后只剩一个日期，对不上代码。 */
  readonly sourceCommit: string;
  readonly datasetVersion: string;
  readonly oursVersion: string;
  readonly officialVersion: string;
  readonly environment: ReferenceEnvironment;
  readonly scenarios: readonly ReferenceScenario[];
  /** 本档**测不到**什么（与报告同源，录下来是为了快照自己就说清边界）。 */
  readonly notMeasured: readonly string[];
}

/* -------------------------------------------------------------- 纯逻辑 */

/** 把一条报告的读数整形成快照的行（只挑有核对价值的字段）。 */
export function toReferenceSide(
  side: {
    durationMs: number | null;
    teardownMs: number | null;
    sdkCalls: number;
    callKind: string;
    recreates: number;
    renderCallbacks: number;
    retainedResources: number;
    retainedListeners: number;
  } | null,
): ReferenceSideReadings | null {
  if (!side) return null;
  return {
    actMs: side.durationMs,
    teardownMs: side.teardownMs,
    sdkCalls: side.sdkCalls,
    callKind: side.callKind,
    recreates: side.recreates,
    renderCallbacks: side.renderCallbacks,
    retainedResources: side.retainedResources,
    retainedListeners: side.retainedListeners,
  };
}

/**
 * 快照**没有腐烂**的校验：结构、envelope、场景覆盖。
 *
 * ⚠️ 刻意**不**校验「当前毫秒接近快照毫秒」——那是性能门禁，票面禁止。本函数只回答一个问题：
 * **这份记录还能不能读懂**（schema 对不对、场景表改了没有、官方版本有没有漂）。
 *
 * @param expectedScenarioIds 场景表的 id 全集（来自 `CONTRAST_SCENARIOS`，是事实源）
 */
export function checkReferenceResult(
  value: unknown,
  expected: { readonly scenarioIds: readonly string[]; readonly datasetVersion: string },
): string[] {
  const issues: string[] = [];
  if (!isPlainObject(value)) {
    return ["REFERENCE_NOT_AN_OBJECT"];
  }
  if (value.version !== REFERENCE_RESULT_VERSION) {
    issues.push(`REFERENCE_VERSION_MISMATCH: ${String(value.version)}`);
  }
  if (value.mode !== "fake-v4") {
    issues.push(`REFERENCE_MODE_UNKNOWN: ${String(value.mode)}`);
  }
  // 引擎三件套（kind / version / oursUnderTest）缺任一条，人读视图就没法说清「测的到底是什么」，
  // 于是那张表会被默认读成「发布物 × 真实 JSAPI 4.0」——本档两条都不成立。
  if (!isPlainObject(value.engine)) {
    issues.push("REFERENCE_ENGINE_MISSING");
  } else {
    if (value.engine.kind !== "fake" && value.engine.kind !== "real") {
      issues.push(`REFERENCE_ENGINE_KIND_UNKNOWN: ${String(value.engine.kind)}`);
    }
    if (typeof value.engine.version !== "string" || value.engine.version === "") {
      issues.push("REFERENCE_ENGINE_VERSION_MISSING");
    }
    // ⚠️ `kind` 与 `version` **成对**判，不各自放行：分开看都合法的一对（`fake` + `4.0`）
    // 正是这张票最忌讳的含糊——读数会冒充「跑在真实 JSAPI 4.0 上」。这是 AGENTS.md 对引擎
    // 取值那条要求的同一类：命名空间与版本必须自洽，不能各说各话。
    //
    // 「合法配对」刻意写成**表**而不是 `kind === "fake" ? ... : ...`：将来真上真实 JSAPI
    // 档时，往表里加一行即可；用三元会逼着下一个维护者去改判断逻辑，而那张表是数据。
    const expectedVersion = ENGINE_VERSION_BY_KIND[value.engine.kind as EngineKind];
    if (expectedVersion !== undefined && value.engine.version !== expectedVersion) {
      issues.push(
        `REFERENCE_ENGINE_PAIR_MISMATCH: kind=${String(value.engine.kind)} ` +
          `配 version=${String(value.engine.version)}，该 kind 的版本应是 ${expectedVersion}`,
      );
    }
    if (value.engine.oursUnderTest !== "source" && value.engine.oursUnderTest !== "dist") {
      issues.push(`REFERENCE_ENGINE_OURS_UNDER_TEST_UNKNOWN: ${String(value.engine.oursUnderTest)}`);
    }
  }
  // provenance 三件套：缺任一条，这份快照就无法回答「这是哪一次跑、哪一版、哪台机器」。
  for (const key of ["recordedAt", "sourceCommit", "datasetVersion", "oursVersion", "officialVersion"]) {
    if (typeof value[key] !== "string" || value[key] === "") {
      issues.push(`REFERENCE_FIELD_MISSING: ${key}`);
    }
  }
  if (typeof value.sourceCommit === "string" && !/^[0-9a-f]{7,40}$/.test(value.sourceCommit)) {
    issues.push(`REFERENCE_COMMIT_NOT_SHA: ${value.sourceCommit}`);
  }
  if (value.datasetVersion !== expected.datasetVersion) {
    issues.push(
      `REFERENCE_DATASET_DRIFT: 快照记 v${String(value.datasetVersion)}，` +
        `场景表现在是 v${expected.datasetVersion}（改数据后旧读数不再可比）`,
    );
  }
  if (!isPlainObject(value.environment)) {
    issues.push("REFERENCE_ENVIRONMENT_MISSING");
  }
  if (!Array.isArray(value.scenarios)) {
    issues.push("REFERENCE_SCENARIOS_NOT_ARRAY");
    return issues;
  }

  // 场景 id 必须与场景表**完整一致**（不多不少、不重）：场景表改了却没重录，读数会静默对不上。
  const ids = value.scenarios.map((entry) => (isPlainObject(entry) ? entry.id : undefined));
  const actual = ids.filter((id): id is string => typeof id === "string");
  const actualSet = new Set(actual);
  if (actualSet.size !== actual.length) {
    issues.push("REFERENCE_SCENARIO_DUPLICATE");
  }
  for (const id of expected.scenarioIds) {
    if (!actualSet.has(id)) issues.push(`REFERENCE_SCENARIO_MISSING: ${id}`);
  }
  for (const id of actual) {
    if (!expected.scenarioIds.includes(id)) {
      issues.push(`REFERENCE_SCENARIO_UNKNOWN: ${id}（场景表里没有，快照是旧的）`);
    }
  }
  for (const entry of value.scenarios) {
    if (!isPlainObject(entry)) {
      issues.push("REFERENCE_SCENARIO_NOT_OBJECT");
      continue;
    }
    if (entry.official === null && typeof entry.officialSkippedReason !== "string") {
      issues.push(`REFERENCE_SKIP_REASON_MISSING: ${String(entry.id)}`);
    }
  }
  return issues;
}
