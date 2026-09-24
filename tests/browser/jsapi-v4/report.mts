/**
 * v4 浏览器 smoke 的结果结构、判定与判退（零依赖）
 *
 * 与 `packages/test-utils/facet-probes.ts` 同样的分工：这里是**纯逻辑**——不 import vitest、
 * 不 import Vue、不碰 `window`，因此同一份代码既能被浏览器页面写进 `window.__SMOKE__`，
 * 也能被 Node 侧 orchestrator（`scripts/smoke-jsapi-v4.mts`）读出、判定与打印。
 *
 * ## 五态语义（R25-E / issue #74 的承接欠账 1）
 *
 * `pass` / `fail` / `blocked` / `skipped` / `expected-failure` 五种结论，**required 只接受
 * `pass`**。历史 characterization（「已知失败也算验收」）从此不再计入通过：
 *
 * | 结论 | 含义 | 是否可放行 |
 * | --- | --- | --- |
 * | `pass` | 断言成立，且是本轮真实观察到的 | 是（required 也只认它） |
 * | `fail` | 断言不成立，或出现归属到本库的未处理异常 | 否 |
 * | `blocked` | 前置不满足（AK / 配额 / 网络 / 浏览器），本轮无法得出结论 | 否（不是通过） |
 * | `skipped` | 登记了但本轮没有执行，必须给出理由 | 否 |
 * | `expected-failure` | 已知缺口，**必须**带追踪票与到期日 | 否（阻止发布） |
 *
 * `expected-failure` 缺 `tracking` / `expires`、或 `skipped` 缺 `reason` 时，被判为 `fail`：
 * 「声明一个无法追踪的已知失败」与「静默跳过」都不允许。
 *
 * ## 未归因异常：取消「跨域一律豁免」（承接欠账 2）
 *
 * 跨域脚本抛出的错误在浏览器里只有 `"Script error."`（无 `source`、无堆栈），确实无法归属。
 * 但「无法归属」**不等于**「可以豁免」：必需链路上出现未归因错误时，必须
 *   ① 被一条**白名单**条目覆盖，且该条目带齐 `reason` / `version` / `owner` / `expires` /
 *      `tracking`，且未过期 → 记 `blocked`（仍然不能放行）；
 *   ② 否则记 `fail`。
 * 可选插件的噪声不靠豁免规则兜底，而是放到**单独页面**里跑（见 ADR「已知欠账」）。
 *
 * ## 约束
 *
 * `node --experimental-strip-types` 只擦除类型：不得使用 `enum` / 参数属性 / namespace，
 * 本地模块导入必须带扩展名。
 */

/* ------------------------------------------------------------------ 基础类型 */

export type SmokeMode = "fixture" | "live";

export const SMOKE_VERDICTS = [
  "pass",
  "fail",
  "blocked",
  "skipped",
  "expected-failure",
] as const;

export type SmokeVerdict = (typeof SMOKE_VERDICTS)[number];

export interface SmokeCheckResult {
  /** 稳定标识：registry 的 required 列表按它匹配。 */
  id: string;
  name: string;
  verdict: SmokeVerdict;
  /**
   * 机读原因码。约定前缀：
   * `BMAP_*` / `DOM_RESIDUE` / `HARNESS_*` 提示本库或 harness 回归，
   * `SERVICE_*` / `TILES_TIMEOUT` / `NETWORK_*` 提示外部波动。
   */
  code?: string;
  /** 通过时也可用的观察值，用于排障与「区分外部波动与库回归」。 */
  detail?: unknown;
  error?: string;
  durationMs: number;
  /** `blocked` / `skipped` 必填：为什么没有结论 / 为什么没跑。 */
  reason?: string;
  /** `expected-failure` 必填：追踪票（如 `#32`）。 */
  tracking?: string;
  /** `expected-failure` 必填：到期日 `YYYY-MM-DD`，过期即视为 fail。 */
  expires?: string;
}

/**
 * 未处理异常条目。
 *
 * `attributed` 表示「能否归属到本库」：同源模块（Vite 提供的源码 / 依赖）会给出 `source`
 * 与堆栈；跨域脚本只给 `"Script error."`。归属由页面侧按 `source` 与栈帧判定，判定结果
 * 在这里只做记录——**是否豁免由门禁决定**，不在记录层放宽。
 */
export interface SmokeUnhandledEntry {
  kind: "error" | "rejection";
  message: string;
  source: string;
  attributed: boolean;
  /** 稳定签名：未归因条目靠它匹配白名单。 */
  signature: string;
}

/**
 * 未归因异常的白名单条目。
 *
 * 五个字段**全部必填**：白名单不是「静默忽略」，而是一份带责任人与到期条件的欠账登记。
 */
export interface UnattributedWhitelistEntry {
  /** 与 `SmokeUnhandledEntry.signature` 匹配。 */
  signature: string;
  /** 具体原因（哪段上游脚本、为什么归因不了）。 */
  reason: string;
  /** 责任包与版本（如 `BMapGLLib@2.0`）。 */
  version: string;
  /** 责任人 / 责任角色。 */
  owner: string;
  /** 追踪票。 */
  tracking: string;
  /** 到期日 `YYYY-MM-DD`。 */
  expires: string;
}

export interface SmokeReport {
  mode: SmokeMode;
  /** 本轮运行标识（从 `?run=` 读出）：orchestrator 用它证明报告来自本轮页面。 */
  runId: string;
  /** 本轮是否带 AK 跑（live 档为 true，fixture 档为 false）。 */
  akUsed: boolean;
  checks: SmokeCheckResult[];
  /** 未处理异常（含可归属与不可归属两类）。 */
  unhandled: SmokeUnhandledEntry[];
  env: Record<string, unknown>;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

/* ------------------------------------------------------------------ 探针工具 */

/** 探针失败：带可机读原因码，而不是把一切失败都记成字符串。 */
export class SmokeFailure extends Error {
  readonly code: string;
  readonly detail: unknown;

  constructor(code: string, message: string, detail?: unknown) {
    super(message);
    this.name = "SmokeFailure";
    this.code = code;
    this.detail = detail;
  }
}

export function fail(code: string, message: string, detail?: unknown): never {
  throw new SmokeFailure(code, message, detail);
}

/**
 * 「本轮无法得出结论」——前置不满足（AK 权限 / 配额 / 网络），**不是**被测对象的错。
 *
 * 与 `fail` 分开是必需的：合成一个结论会让一次配额抖动被写成「库回归」，或者反过来让人把
 * 真回归说成「环境问题」。门禁按 `blocked` → 退出码 3（不可放行）。
 */
export class SmokeBlocked extends Error {
  readonly code: string;
  readonly detail: unknown;

  constructor(code: string, message: string, detail?: unknown) {
    super(message);
    this.name = "SmokeBlocked";
    this.code = code;
    this.detail = detail;
  }
}

export function block(code: string, message: string, detail?: unknown): never {
  throw new SmokeBlocked(code, message, detail);
}

/** 断言 + 显式原因码。条件不成立时立即失败，避免后续步骤在脏状态上继续跑。 */
export function assertSmoke(
  condition: unknown,
  code: string,
  message: string,
  detail?: unknown,
): void {
  if (!condition) fail(code, message, detail);
}

/** 把「等不到条件」变成带 `TIMEOUT` 码的失败，而不是让整轮 smoke 挂死。 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  code = "TIMEOUT",
): Promise<T> {
  return withDeadline(promise, ms, label, code, "fail");
}

/**
 * 同 `withTimeout`，但**本函数自己的超时**按 `blocked` 结算。
 *
 * 只用于**明确属于外部依赖**的阶段（服务回包、官方 UI Kit 的网络检索）：网络一直不返回与
 * 「服务返回空」是同一类前置不成立，两者必须得到同一个结论（`blocked`），否则同一件外部问题
 * 会一半记 blocked、一半记 fail。**promise 自身的拒绝照原样透传**——那是被测对象的结论，不能
 * 被这里吞成「环境问题」。
 */
export function withBlockedTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  code = "BLOCKED_TIMEOUT",
): Promise<T> {
  return withDeadline(promise, ms, label, code, "blocked");
}

function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  code: string,
  onTimeout: "fail" | "blocked",
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const message = `${label} 在 ${ms}ms 内没有结算`;
      reject(
        onTimeout === "blocked" ? new SmokeBlocked(code, message, { label, ms }) : new SmokeFailure(code, message, { label, ms }),
      );
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function redactAk(text: string): string {
  return text.replace(/([?&]ak=)[^&#\s"')]+/gi, "$1<redacted>");
}

/* ------------------------------------------------------------------ 收集器 */

export interface SmokeRunOptions {
  mode: SmokeMode;
  runId: string;
  akUsed: boolean;
  env?: Record<string, unknown>;
  now?: () => number;
}

/**
 * 探针收集器。
 *
 * 每个检查独立 `try/catch`：一步失败不中断整轮——否则「第一个失败」会掩盖后面所有结论，
 * 排障时无法判断是一个问题还是五个。
 */
export class SmokeRun {
  readonly checks: SmokeCheckResult[] = [];
  private readonly options: SmokeRunOptions;
  private readonly now: () => number;
  private readonly startedAt: number;

  constructor(options: SmokeRunOptions) {
    this.options = options;
    this.now = options.now ?? (() => Date.now());
    this.startedAt = this.now();
  }

  /** 跑一个检查：正常结算记 `pass`，`SmokeFailure` 记 `fail`，`SmokeBlocked` 记 `blocked`。 */
  async check(id: string, name: string, run: () => Promise<unknown> | unknown): Promise<SmokeCheckResult> {
    const startedAt = this.now();
    let result: SmokeCheckResult;
    try {
      const detail = await run();
      result = { id, name, verdict: "pass", durationMs: Math.round(this.now() - startedAt) };
      if (detail !== undefined) result.detail = detail;
    } catch (error) {
      const known = error instanceof SmokeFailure;
      const blocked = error instanceof SmokeBlocked;
      result = {
        id,
        name,
        verdict: blocked ? "blocked" : "fail",
        code: known || blocked ? error.code : "UNEXPECTED",
        durationMs: Math.round(this.now() - startedAt),
      };
      if (blocked) {
        result.reason = error.message;
      } else {
        result.error = error instanceof Error ? error.message : String(error);
      }
      if ((known || blocked) && error.detail !== undefined) result.detail = error.detail;
    }
    this.record(result);
    return result;
  }

  /** 登记一个非 pass 结论（`blocked` / `skipped` / `expected-failure`）。 */
  declare(
    id: string,
    name: string,
    verdict: Exclude<SmokeVerdict, "pass" | "fail">,
    extra: Pick<SmokeCheckResult, "reason" | "tracking" | "expires" | "detail"> = {},
  ): SmokeCheckResult {
    const result: SmokeCheckResult = {
      id,
      name,
      verdict,
      durationMs: 0,
      ...extra,
    };
    this.record(result);
    return result;
  }

  /** 同名重复登记时以最后一次为准（用于「重挂载后再断言」）。 */
  record(result: SmokeCheckResult): void {
    const index = this.checks.findIndex((entry) => entry.id === result.id);
    if (index >= 0) this.checks.splice(index, 1, result);
    else this.checks.push(result);
  }

  finish(unhandled: SmokeUnhandledEntry[]): SmokeReport {
    const finishedAt = this.now();
    return {
      mode: this.options.mode,
      runId: this.options.runId,
      akUsed: this.options.akUsed,
      checks: this.checks,
      unhandled,
      env: this.options.env ?? {},
      startedAt: new Date(this.startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      durationMs: Math.round(finishedAt - this.startedAt),
    };
  }
}

/* ------------------------------------------------------------------ 门禁判定 */

export interface SmokeGateResult {
  /** 只有「required 全 pass 且没有任何不可放行结论」才为 true。 */
  ok: boolean;
  /** `0` 放行；`1` 有 fail；`3` 有 blocked/skipped/expected-failure（不可放行）；`2` 脚手架失败。 */
  exitCode: 0 | 1 | 2 | 3;
  required: string[];
  /** registry 声明为 required、但报告里根本没跑的检查（最容易「静默通过」的洞）。 */
  requiredMissing: string[];
  requiredNotPass: { id: string; verdict: SmokeVerdict | "missing" }[];
  failing: string[];
  inconclusive: string[];
  reasons: string[];
}

export interface SmokeGateOptions {
  /** registry 里本模式的 required 检查 id。 */
  required: string[];
  /** 未归因异常白名单（缺省为空：默认不放行任何未归因错误）。 */
  whitelist?: UnattributedWhitelistEntry[];
  /** 判定「今天」：`YYYY-MM-DD`。注入以便单测确定性。 */
  today?: string;
}

function isDateString(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * 对报告做门禁判定。
 *
 * 规则（顺序即优先级，`reasons` 逐条可读）：
 * 1. `required` 里的每个 id 都必须在报告里出现，且 `verdict === "pass"`；缺席记
 *    `REQUIRED_CHECK_MISSING`（**不允许**「没跑也算过」），非 pass 记 `REQUIRED_CHECK_NOT_PASS`。
 * 2. 任何 `fail` → 失败；`expected-failure` 缺 `tracking` / `expires` 或已过期 → 退化为失败。
 * 3. `skipped` 缺 `reason` → 退化为失败（静默跳过不允许）。
 * 4. 未处理异常：能归属到本库 → 失败；未归因 → 必须有未过期的完整白名单条目，否则失败、
 *    命中则记 `blocked`（不可放行但也不是「库回归」）。
 * 5. 剩下的 `blocked` / `skipped` / `expected-failure` 一律进 `inconclusive` → 退出码 3。
 */
export function evaluateSmokeReport(
  report: SmokeReport,
  options: SmokeGateOptions,
): SmokeGateResult {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const whitelist = options.whitelist ?? [];
  const byId = new Map(report.checks.map((check) => [check.id, check]));
  const reasons: string[] = [];
  const failing: string[] = [];
  const inconclusive: string[] = [];
  const requiredNotPass: { id: string; verdict: SmokeVerdict | "missing" }[] = [];

  /* 1. required 只接受 pass，且必须真的跑过 */
  const requiredMissing: string[] = [];
  for (const id of options.required) {
    const check = byId.get(id);
    if (!check) {
      requiredMissing.push(id);
      requiredNotPass.push({ id, verdict: "missing" });
      // 必须同时进 `failing`：只写 reason 不写 failing 会让「required 根本没跑」判成放行——
      // 这正是最该被门禁抓住的空转（单测 `REQUIRED_CHECK_MISSING` 用例覆盖）。
      failing.push(id);
      reasons.push(`REQUIRED_CHECK_MISSING: ${id} 未出现在报告里（required 不接受「没跑」）`);
      continue;
    }
    if (check.verdict !== "pass") {
      requiredNotPass.push({ id, verdict: check.verdict });
      reasons.push(`REQUIRED_CHECK_NOT_PASS: ${id}=${check.verdict}（required 只接受 pass）`);
    }
  }

  /* 2~3. 逐条检查结论 */
  for (const check of report.checks) {
    switch (check.verdict) {
      case "pass":
        break;
      case "fail":
        failing.push(check.id);
        reasons.push(`CHECK_FAILED: ${check.id} [${check.code ?? "UNKNOWN"}] ${check.error ?? ""}`);
        break;
      case "skipped":
        if (!check.reason) {
          failing.push(check.id);
          reasons.push(`SKIPPED_WITHOUT_REASON: ${check.id}（静默跳过不允许）`);
        } else {
          inconclusive.push(check.id);
          reasons.push(`CHECK_SKIPPED: ${check.id} — ${check.reason}（不可放行）`);
        }
        break;
      case "expected-failure": {
        const expires = check.expires;
        if (!check.tracking || !isDateString(expires)) {
          failing.push(check.id);
          reasons.push(
            `EXPECTED_FAILURE_WITHOUT_METADATA: ${check.id} 缺少 tracking / expires（YYYY-MM-DD）`,
          );
          break;
        }
        if (expires < today) {
          failing.push(check.id);
          reasons.push(`EXPECTED_FAILURE_EXPIRED: ${check.id} 已于 ${expires} 到期`);
          break;
        }
        inconclusive.push(check.id);
        reasons.push(
          `CHECK_EXPECTED_FAILURE: ${check.id} 追踪 ${check.tracking}，到期 ${expires}（不可放行）`,
        );
        break;
      }
      case "blocked":
        inconclusive.push(check.id);
        reasons.push(`CHECK_BLOCKED: ${check.id} — ${check.reason ?? "前置不满足"}（不可放行）`);
        break;
      default: {
        // 穷尽性守卫：新增 verdict 时这里会编译失败，而不是静默放行。
        const exhaustive: never = check.verdict;
        failing.push(check.id);
        reasons.push(`UNKNOWN_VERDICT: ${check.id}=${String(exhaustive)}`);
      }
    }
  }

  /* 4. 未处理异常：归属到本库即失败；未归因不再自动豁免 */
  const own = report.unhandled.filter((entry) => entry.attributed);
  const foreign = report.unhandled.filter((entry) => !entry.attributed);
  if (own.length > 0) {
    failing.push("unhandled-attributed");
    for (const entry of own) {
      reasons.push(`UNHANDLED_ATTRIBUTED: ${entry.kind} ${entry.message} @ ${entry.source}`);
    }
  }
  for (const entry of foreign) {
    const match = whitelist.find((item) => item.signature === entry.signature);
    if (!match) {
      failing.push("unhandled-unattributed");
      reasons.push(
        `UNATTRIBUTED_ERROR_UNLISTED: ${entry.kind} ${entry.message}（签名 ${entry.signature} 不在白名单，跨域来源不构成豁免）`,
      );
      continue;
    }
    const incomplete =
      !match.reason || !match.version || !match.owner || !match.tracking || !isDateString(match.expires);
    if (incomplete) {
      failing.push("unhandled-unattributed");
      reasons.push(
        `WHITELIST_INCOMPLETE: ${match.signature} 白名单条目必须带齐 reason / version / owner / tracking / expires`,
      );
      continue;
    }
    if (match.expires < today) {
      failing.push("unhandled-unattributed");
      reasons.push(`WHITELIST_EXPIRED: ${match.signature} 白名单已于 ${match.expires} 到期`);
      continue;
    }
    inconclusive.push("unhandled-unattributed");
    reasons.push(
      `UNATTRIBUTED_ERROR_WHITELISTED: ${entry.signature} — ${match.reason}（${match.version} / ${match.owner} / 追踪 ${match.tracking} / 到期 ${match.expires}，仍不可放行）`,
    );
  }

  const exitCode: SmokeGateResult["exitCode"] =
    failing.length > 0 ? 1 : inconclusive.length > 0 ? 3 : 0;
  return {
    ok: exitCode === 0,
    exitCode,
    required: [...options.required],
    requiredMissing,
    requiredNotPass,
    failing: [...new Set(failing)],
    inconclusive: [...new Set(inconclusive)],
    reasons,
  };
}

/* ------------------------------------------------------------------ bootstrap 归属 */

/**
 * 「外部前置」类错误码：加载失败 / 加载超时属于「环境不成立」，其余一律按**实现回归**处理。
 *
 * 判据方向刻意保守——无法归属时宁可按外部处理（结论是 `blocked`，仍然不可放行），
 * 但只要有任何一个**非**外部码，整轮就按 `library` 处理（宁可红不可绿）。
 */
export const EXTERNAL_BOOTSTRAP_CODES = ["BMAP_SDK_LOAD_FAILED", "BMAP_SDK_LOAD_TIMEOUT"] as const;

export interface BootstrapErrorLike {
  code?: string;
  message?: string;
}

export interface BootstrapVerdict {
  kind: "external" | "library";
  code: string;
  reason: string;
}

/**
 * 判定「`<Map>` 没能 ready」这件事该归给谁。
 *
 * 为什么要区分（第 1 轮评审 P1）：初始挂载失败时所有 required 检查都没跑，而门禁把「缺席的
 * required」判成 `fail`——于是网络/CDN/AK 这类**外部前置**问题会得到退出码 1（库回归），
 * 与本文件定义的五态语义矛盾，最关键的 bootstrap 场景反而把两类问题混在一起。
 */
export function classifyBootstrapFailure(errors: BootstrapErrorLike[]): BootstrapVerdict {
  const libraryError = errors.find(
    (error) =>
      typeof error.code === "string" &&
      error.code.length > 0 &&
      !(EXTERNAL_BOOTSTRAP_CODES as readonly string[]).includes(error.code),
  );
  if (libraryError) {
    return {
      kind: "library",
      code: libraryError.code!,
      reason: libraryError.message || libraryError.code!,
    };
  }
  const external = errors.find(
    (error) =>
      typeof error.code === "string" &&
      (EXTERNAL_BOOTSTRAP_CODES as readonly string[]).includes(error.code),
  );
  if (external) {
    return { kind: "external", code: external.code!, reason: external.message || external.code! };
  }
  // 一条错误都没有、ready 又没来：无法归属 ⇒ 外部（结论是 blocked，不是「通过」）。
  return {
    kind: "external",
    code: "BMAP_READY_TIMEOUT",
    reason: "ready 未在预算内结算，且没有任何可归属的错误",
  };
}

export interface BootstrapDeclaration {
  id: string;
  name: string;
  verdict: "blocked";
  reason: string;
}

/**
 * 外部前置失败时，把**本档登记的全部检查**逐条登记成 `blocked`（而不是留下「缺席」）。
 *
 * 「缺席」与「blocked」的区别正是门禁要守的东西：缺席 ⇒ `REQUIRED_CHECK_MISSING` ⇒ `fail`；
 * `blocked` ⇒ 退出码 3（不可放行）。外部前置失败必须落进后者。
 */
export function bootstrapDeclarations(
  verdict: BootstrapVerdict,
  checks: { id: string; name: string }[],
): BootstrapDeclaration[] {
  if (verdict.kind !== "external") return [];
  const reason = `前置（<Map> ready）不成立：${verdict.code} — ${verdict.reason}`;
  return checks.map((spec) => ({ id: spec.id, name: spec.name, verdict: "blocked", reason }));
}

/* ------------------------------------------------------------------ 信封自检 */

/**
 * orchestrator 侧的**信封自检**（第 1 轮评审建议的防空转校验）。
 *
 * 页面如果意外按另一档跑（或没带 AK），Node 若跟着 `report.mode` 去取 required，就会换成一个
 * **更小的** required 集合——门禁看着绿，其实少跑了一片。所以 mode / runId / akUsed 三者都
 * 必须与**本轮请求**一致，不一致按脚手架失败处理。
 */
export function checkReportEnvelope(
  report: Pick<SmokeReport, "mode" | "runId" | "akUsed">,
  expected: { mode: SmokeMode; runId: string },
): string[] {
  const issues: string[] = [];
  if (report.mode !== expected.mode) issues.push("SMOKE_MODE_MISMATCH");
  if (report.runId !== expected.runId) issues.push("SMOKE_RUN_ID_MISMATCH");
  if (expected.mode === "live" && report.akUsed !== true) issues.push("SMOKE_AK_NOT_USED");
  return issues;
}

/* ------------------------------------------------------------------ 渲染 */

const VERDICT_TAG: Record<SmokeVerdict, string> = {
  pass: "PASS",
  fail: "FAIL",
  blocked: "BLOCKED",
  skipped: "SKIPPED",
  "expected-failure": "EXPECTED-FAILURE",
};

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** 把报告渲染成人类可读文本（页面 `<pre>` 与 orchestrator stdout 共用）。 */
export function formatReport(report: SmokeReport, gate: SmokeGateResult): string {
  const lines = [
    `mode=${report.mode} run=${report.runId} ok=${gate.ok} exit=${gate.exitCode} ak=${report.akUsed} in ${report.durationMs}ms`,
    `env=${safeJson(report.env)}`,
    `required=${gate.required.join(",") || "-"}`,
  ];
  for (const check of report.checks) {
    const code = check.code ? ` [${check.code}]` : "";
    const reason = check.reason ? ` — ${check.reason}` : "";
    const error = check.error ? ` ${check.error}` : "";
    lines.push(
      `${VERDICT_TAG[check.verdict]} ${check.id}${code}${error}${reason} (${check.durationMs}ms)`,
    );
    if (check.detail !== undefined) lines.push(`      detail=${safeJson(check.detail)}`);
  }
  if (report.unhandled.length === 0) {
    lines.push("PASS unhandled-exceptions (0 条)");
  } else {
    for (const entry of report.unhandled) {
      lines.push(
        `${entry.attributed ? "FAIL" : "INFO"} unhandled(${entry.attributed ? "attributed" : "unattributed"}) ` +
          `${entry.kind}: ${entry.message}${entry.source ? ` @ ${entry.source}` : ""}`,
      );
    }
  }
  if (gate.reasons.length > 0) {
    lines.push("--- gate ---");
    for (const reason of gate.reasons) lines.push(reason);
  }
  return lines.join("\n");
}
