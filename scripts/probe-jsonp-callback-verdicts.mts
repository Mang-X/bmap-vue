/**
 * `probe-jsonp-callback.mts` 的**判定层**（读数 → 结论），单独成模块是为了可测。
 *
 * 与 #98 / #110 的判定层同口径：
 *
 * 1. **每个结论先查 presence / 类型，再进正负分支**；缺失一律 `UNKNOWN`（第三态）。
 *    `?.` + `??` 兜底会把「没测到」印成「测到了，是好的那一侧」——正是要禁止的形态。
 * 2. 「前置 attempt 抛错 / 读数缺失」也是 `UNKNOWN`，并点名是哪一步不成立。
 * 3. 结论行可以带读数原文，但**结论本身**不得由读数原文二次推导。
 *
 * issue #128 的 F-2 两组问题 → **三条**结论（与空报告用例条数锁在一起）：
 * 回调契约（callback=NAME 是否被官方调用）/ foreign 捕获与释放 / 官方新增全局。
 */

/** 一条读数。字段可选正是「可能没测到」的来源，所以判定层必须逐字段查 presence。 */
export interface Reading {
  id: string;
  threw?: boolean;
  message?: string | null;
  /** 计数（回调次数、事件条数等）。 */
  count?: number;
  /** `typeof` / 状态名字符串。 */
  type?: string;
  /** 同一性判定（handler 身份是否仍是我们的）。 */
  same?: boolean;
  /** 就绪布尔。 */
  ready?: boolean;
  /** 就绪采样时缺失的 JSAPI_V4_REQUIRED_MEMBERS 成员名（诊断；ready=false 时非空）。 */
  missing?: string[];
  /** 窗口新增全局名列表。 */
  keys?: string[];
}

/** 页面写回的报告（脱敏前的原始形状）。 */
export interface ProbeReport {
  phase: string;
  sdk: Record<string, string> | null;
  readings: Reading[];
  console: Array<{ level: string; text: string }>;
  error: string | null;
  loadError?: string;
}

/** 三态里的第三态。缺失读数的**唯一**合法归宿，不得落进正 / 负任一分支。 */
const UNKNOWN = "**无法判定**（读数缺失）";

/**
 * 正证控件：本轮实验能不能下结论。
 *
 * 三条硬门槛：
 * 1. `callback=` 契约必须成立 —— 我们的 handler 被官方调用过（`count >= 1`）；
 * 2. **首次 callback 当下** JSAPI 4.0 命名空间已就绪（`readyAtCall.ready === true`，
 *    与生产 `requireJsapiV4Global` 同口径：Map / Point / Marker 齐全）——
 *    生产路径 `SharedLoadTask.succeed()` 会在这里同步跑 `assertReady`，
 *    「最终 ready」不能代替「首次调用那一刻 ready」；
 * 3. **首次**调用时全局值仍是我们的 handler（`identity.same === true`）。
 *
 * `control.bmapReady` 只作诊断，不进控件。
 */
export function controlFailures(report: ProbeReport): string[] {
  const failures: string[] = [];
  const byId = new Map(report.readings.map((r) => [r.id, r]));

  const fired = byId.get("control.callbackFired");
  if (!fired || typeof fired.count !== "number" || fired.count < 1) {
    failures.push(
      `control.callbackFired 的 count 不足（得到 ${String(fired?.count)}）—— 官方没有调用我们安装的回调`,
    );
  }
  const readyAtCall = byId.get("control.readyAtCall");
  const missingAtCall = readyAtCall?.missing;
  const missingOk =
    missingAtCall === undefined ||
    (Array.isArray(missingAtCall) && missingAtCall.length === 0);
  if (!readyAtCall || readyAtCall.ready !== true || !missingOk) {
    const missingNote = Array.isArray(missingAtCall) && missingAtCall.length > 0
      ? `（缺 ${missingAtCall.join(", ")}）`
      : "";
    failures.push(
      `control.readyAtCall 不是 true（得到 ${String(readyAtCall?.ready)}）${missingNote}——` +
        ` 首次 callback 当下 JSAPI_V4_REQUIRED_MEMBERS（Map/Point/Marker）未齐，` +
        `assertReady 会在 succeed() 当场失败；「最终 ready」不能代替它`,
    );
  }
  const identity = byId.get("control.handlerIdentityAtCall");
  if (!identity || identity.same !== true) {
    failures.push(
      `control.handlerIdentityAtCall 不是 true（得到 ${String(identity?.same)}）——` +
        ` 首次调用时全局值已不是我们的 handler（官方可能先覆盖了名）`,
    );
  }
  return failures;
}

/**
 * 把读数映射成结论——本探针真正的产物。共 **3** 条，与
 * `v3-probe-jsonp-callback-verdicts.test.ts` 的空报告用例条数锁在一起。
 */
export function verdicts(report: ProbeReport): string[] {
  const byId = new Map(report.readings.map((r) => [r.id, r]));
  const lines: string[] = [];

  const countOf = (id: string): number | null => {
    const value = byId.get(id)?.count;
    return typeof value === "number" ? value : null;
  };
  const sameOf = (id: string): boolean | null => {
    const value = byId.get(id)?.same;
    return typeof value === "boolean" ? value : null;
  };
  const readyOf = (id: string): boolean | null => {
    const value = byId.get(id)?.ready;
    return typeof value === "boolean" ? value : null;
  };
  const missingOf = (id: string): string[] | null => {
    const value = byId.get(id)?.missing;
    return Array.isArray(value) ? value : null;
  };
  const typeOf = (id: string): string | null => {
    const value = byId.get(id)?.type;
    return typeof value === "string" ? value : null;
  };
  const keysOf = (id: string): string[] | null => {
    const value = byId.get(id)?.keys;
    return Array.isArray(value) ? value : null;
  };
  const threwOf = (id: string): boolean | null => {
    const value = byId.get(id)?.threw;
    return typeof value === "boolean" ? value : null;
  };

  const num = (value: number | null): string => (value === null ? "—" : String(value));
  const bool = (value: boolean | null): string =>
    value === null ? "—" : value ? "true" : "false";

  // ── 1. 回调契约（F-2 问题一：官方是否按 callback=NAME 调用我们的全局函数） ──
  {
    const count = countOf("control.callbackFired");
    const readyAtCall = readyOf("control.readyAtCall");
    const missingAtCall = missingOf("control.readyAtCall");
    const readyFinal = readyOf("control.bmapReady");
    const same = sameOf("control.handlerIdentityAtCall");
    const argsLength = countOf("control.argsLength");
    const missingNote =
      missingAtCall !== null && missingAtCall.length > 0
        ? `（缺 ${missingAtCall.join("/")}）`
        : "";
    lines.push(
      `[回调契约] handler 被调 ${num(count)} 次；args.length=${num(argsLength)}；` +
        `首次调用时身份仍是我们的=${bool(same)}；` +
        `首次 callback 当下 readyAtCall=${bool(readyAtCall)}${missingNote}；` +
        `最终 bmapReady=${bool(readyFinal)} ⇒ ` +
        (count === null || readyAtCall === null || same === null
          ? UNKNOWN
          : count >= 1 && same === true && readyAtCall === true
            ? "**callback=NAME 契约成立**（官方在就绪时调用了我们安装的全局函数，" +
              "且 **首次 callback 当下** Map/Point/Marker 齐全——与 SharedLoadTask.succeed " +
              "的同步 assertReady 同拍）"
            : count < 1
              ? "**回调未被调用**（官方没有按 callback=NAME 调用我们的 handler）"
              : same === false
                ? "**调用时身份已被覆盖**（首次回调时全局值已被官方改写 ⇒ foreign 捕获的读法不可靠）"
                : `**回调已调但 callback 当下 BMap 未就绪**` +
                  `（readyAtCall=${bool(readyAtCall)}${missingNote}，` +
                  `最终 bmapReady=${bool(readyFinal)} ⇒` +
                  " 脚本加载成功 ≠ SDK 可用；生产路径 assertReady 会在 succeed() 当场失败，" +
                  "「最终 ready」不能代替它）"),
    );
  }

  // ── 2. foreign 捕获与释放（F-2 问题二：同名回调的占用/恢复是否可靠） ──
  {
    const preType = typeOf("foreign.preInstall");
    const fired = countOf("foreign.callbackFired");
    const restoredType = typeOf("foreign.afterRelease");
    const restoredSame = sameOf("foreign.afterRelease");
    const loadThrew = threwOf("control.loadAttempt");
    lines.push(
      `[foreign 捕获] 安装前 type=${preType ?? "—"}；回调被调 ${num(fired)} 次；` +
        `释放后 type=${restoredType ?? "—"} / same=${bool(restoredSame)} ⇒ ` +
      (preType === null || fired === null || restoredType === null || restoredSame === null || loadThrew === null
        ? UNKNOWN
        : loadThrew
          ? `**加载失败**（${String(byId.get("control.loadAttempt")?.message)}）——本轮无法判定 foreign 语义`
          : preType === "function" && restoredType === "function" && restoredSame === true
            ? "**foreign 捕获与释放可靠**（安装前原值在释放后按引用恢复；" +
              `官方调用次数=${fired} 次——第二次加载可能命中缓存不回调，恢复语义不依赖它）`
            : preType !== "function"
              ? `**安装前无外部值**（type=${preType}）——本轮不构成 foreign 场景，释放后删除名属预期`
              : restoredSame === false
                ? "**释放后未恢复原引用**（恢复的值与安装前不同 ⇒ 外部原值捕获不可靠）"
                : "**释放后外部值丢失**（type 不再是 function ⇒ 占用恢复失败）"),
    );
    const occupied = keysOf("globals.officialCreated");
    lines.push(
      `[官方新增全局] 新增键 ${occupied === null ? "—" : JSON.stringify(occupied)} ⇒ ` +
        (occupied === null
          ? UNKNOWN
          : occupied.length === 0
            ? "**无新增可枚举全局**（官方未在 window 上留下与我们冲突的可枚举函数名）"
            : `**有新增全局**（${occupied.length} 个：${occupied.join(", ")}）——` +
              `需核对是否与 __bmap_v4_custom_ 前缀冲突`),
    );
  }

  return lines;
}
