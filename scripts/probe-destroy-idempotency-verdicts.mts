/**
 * `probe-destroy-idempotency.mts` 的**判定层**（读数 → 结论），单独成模块是为了可测。
 *
 * 与 #98 / #110 / #128-F2 的判定层同口径：
 *
 * 1. **每个结论先查 presence / 类型，再进正负分支**；缺失一律 `UNKNOWN`（第三态）。
 * 2. 「前置 attempt 抛错 / 读数缺失」也是 `UNKNOWN`，并点名是哪一步不成立。
 * 3. 结论行可以带读数原文，但**结论本身**不得由读数原文二次推导。
 *
 * issue #128 的 F-3 两组问题 → 两条结论：
 * destroy/dispose 幂等性 / 销毁期是否回调业务。
 *
 * 退出码（#128：**0 = 全 pass** / 1 有 fail / 3 只有 blocked / 2 脚手架失败）：
 * 控件不成立 → 命令层 exit 1；控件成立但仍有第三态结论 → `conclusionExitCode` 也必须
 * 返回 1——stdout 说了「无法判定」，shell status 不得仍表示全通过。
 */

/** 一条读数。字段可选正是「可能没测到」的来源，所以判定层必须逐字段查 presence。 */
export interface Reading {
  id: string;
  threw?: boolean;
  message?: string | null;
  count?: number;
  type?: string;
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
 * 四条硬门槛：
 * 1. Map 首次 destroy 必须成功（正证：SDK 起来了、销毁路径可测）；
 * 2. Autocomplete 首次 dispose 必须成功（正证：服务实例可测）；
 * 3. Autocomplete **对照组显式 `search()` 必须成功**（`auto.control.search.threw === false`）
 *    ——否则 `callbackObserved >= 1` 可能来自同实例其它触发，不证明「本次 search 可回调」；
 * 4. Autocomplete **对照组** `callbackObserved.count >= 1`——同环境不 dispose 时
 *    `onSearchComplete` 必须能到达；否则 dispose 臂的 0/0 无法区分「dispose 挡住了」
 *    与「网络/服务根本没回」（issue #128：每个探针要有对照组，否则挂起会退化成失败）。
 *
 * Panorama **未加载场景**的 destroy 抛错是**已知反例**，不进控件——它恰恰是 F-3 要测的一侧。
 *
 * 半边前置（进结论、**不**进本函数——否则 exit 1 时不再打印另一半有效结论）：
 * - `map.control.destroyListener.threw === false`：否则 Map 半边第三态；
 * - `auto.search.threw === false`：否则 Autocomplete 半边第三态。
 * 控件成立后若仍有第三态，由 `conclusionExitCode` 收成退出码 1（#128：0 = 全 pass）。
 */
export function controlFailures(report: ProbeReport): string[] {
  const failures: string[] = [];
  const byId = new Map(report.readings.map((r) => [r.id, r]));

  const mapOnce = byId.get("map.control.destroyOnce");
  if (!mapOnce || mapOnce.threw !== false) {
    failures.push(
      `map.control.destroyOnce 抛错或缺失（得到 ${String(mapOnce?.threw)}）——` +
        ` 首次销毁都失败，后续幂等读数无意义`,
    );
  }
  const autoOnce = byId.get("auto.control.disposeOnce");
  if (!autoOnce || autoOnce.threw !== false) {
    failures.push(
      `auto.control.disposeOnce 抛错或缺失（得到 ${String(autoOnce?.threw)}）——` +
        ` 首次释放都失败，后续幂等读数无意义`,
    );
  }
  const autoCtrlSearch = byId.get("auto.control.search");
  if (!autoCtrlSearch || autoCtrlSearch.threw !== false) {
    failures.push(
      `auto.control.search 抛错或缺失（得到 ${String(autoCtrlSearch?.threw)}）——` +
        ` 对照组的显式 search 没发出，callbackObserved 可能来自其它触发，不证明本次可回调`,
    );
  }
  const autoCtrl = byId.get("auto.control.callbackObserved");
  if (!autoCtrl || typeof autoCtrl.count !== "number" || autoCtrl.count < 1) {
    failures.push(
      `auto.control.callbackObserved 的 count 不足（得到 ${String(autoCtrl?.count)}）——` +
        ` 对照组没等到 onSearchComplete，dispose 臂的 0/0 无法解释（可能只是网络没回）`,
    );
  }
  return failures;
}

/**
 * 把读数映射成结论——本探针真正的产物。共 **2** 条，与
 * `probe-destroy-idempotency-verdicts.test.ts` 的空报告用例条数锁在一起。
 */
export function verdicts(report: ProbeReport): string[] {
  const byId = new Map(report.readings.map((r) => [r.id, r]));
  const lines: string[] = [];

  const threwOf = (id: string): boolean | null => {
    const value = byId.get(id)?.threw;
    return typeof value === "boolean" ? value : null;
  };
  const countOf = (id: string): number | null => {
    const value = byId.get(id)?.count;
    return typeof value === "number" ? value : null;
  };
  const messageOf = (id: string): string | null => {
    const value = byId.get(id)?.message;
    return typeof value === "string" ? value : null;
  };

  const describeAttempt = (id: string): string => {
    const threw = threwOf(id);
    if (threw === null) return "无法判定（读数缺失）";
    return threw ? `抛错（${messageOf(id) ?? "?"}）` : "未抛错";
  };
  const num = (value: number | null): string => (value === null ? "—" : String(value));

  // ── 1. destroy / dispose 幂等性 ────────────────────────────────────────
  {
    const mapOnce = threwOf("map.control.destroyOnce");
    const mapTwice = threwOf("map.destroyTwice");
    const autoOnce = threwOf("auto.control.disposeOnce");
    const autoTwice = threwOf("auto.disposeTwice");
    const panoLoadedOnce = threwOf("pano.loaded.destroyOnce");
    const panoLoadedTwice = threwOf("pano.loaded.destroyTwice");
    const panoEmpty = threwOf("pano.unloaded.destroy");

    // Panorama(loaded) 第二次读数只有在 **first 成功** 时才构成「重复调用」取证；
    // first 已抛错时 second 只是失败后的重试，不是幂等性的第二次调用。
    const panoLoadedSecondMeaningful = panoLoadedOnce === false && panoLoadedTwice !== null;
    const panoLoadedFirstFailed = panoLoadedOnce === true;

    lines.push(
      `[幂等性] Map first=${describeAttempt("map.control.destroyOnce")}` +
        ` / second=${describeAttempt("map.destroyTwice")}；` +
        `Autocomplete first=${describeAttempt("auto.control.disposeOnce")}` +
        ` / second=${describeAttempt("auto.disposeTwice")}；` +
        `Panorama(loaded) first=${describeAttempt("pano.loaded.destroyOnce")}` +
        ` / second=${describeAttempt("pano.loaded.destroyTwice")}` +
        (panoLoadedFirstFailed
          ? "（**first 已抛错 ⇒ second 不构成幂等取证**）"
          : "") +
        `；Panorama(empty)=${describeAttempt("pano.unloaded.destroy")} ⇒ ` +
        (mapOnce === null || mapTwice === null || autoOnce === null || autoTwice === null
          ? UNKNOWN
          : mapOnce !== false || autoOnce !== false
            ? "**前置失败**（正证控件要求 first 必须成功）"
            : panoLoadedOnce === null || panoLoadedTwice === null || panoEmpty === null
              ? UNKNOWN
              : // Map / Autocomplete first 已在控件里确认成功；这里判 second 与 Panorama 两侧。
                panoEmpty === false
                  ? "**未加载 Panorama 首次不抛**（与已知反例不符——可能上游行为已变，需复核；" +
                    `Map/Autocomplete second=${mapTwice}/${autoTwice}）`
                  : mapTwice === true || autoTwice === true
                    ? "**重复调用抛错**（Map/Autocomplete 第二次 destroy/dispose 不是 no-op ⇒" +
                      " 本库 guard 只能承诺「本库保证」，不能写成官方幂等）" +
                      (panoLoadedFirstFailed
                        ? "；已加载 Panorama first 已抛错，其 second 不构成幂等取证"
                        : panoLoadedTwice === true
                          ? "；已加载 Panorama 第二次也抛（first 成功 ⇒ 重复 destroy 不是 no-op）"
                          : panoLoadedTwice === false
                            ? "；已加载 Panorama 第二次不抛（first 成功 ⇒ 该侧幂等）"
                            : "")
                    : panoLoadedFirstFailed
                      ? "**已加载 Panorama 首次即抛**（first 失败 ⇒ 其 second 不构成幂等取证；" +
                        `Map/Autocomplete second=${mapTwice}/${autoTwice} 均不抛，` +
                        `未加载首次=${describeAttempt("pano.unloaded.destroy")}）`
                      : panoLoadedSecondMeaningful && panoLoadedTwice === true
                        ? "**已加载 Panorama 第二次抛错**（first 成功 ⇒ 重复 destroy 不是 no-op）"
                        : panoEmpty === true && mapTwice === false && autoTwice === false &&
                          panoLoadedSecondMeaningful && panoLoadedTwice === false
                          ? "**有条件幂等**（Map / Autocomplete / 已加载 Panorama 重复销毁不抛；" +
                            "未加载 Panorama 首次即抛 —— 与 ADR 2026-09-12 已知反例一致）"
                          : mapTwice === false && autoTwice === false &&
                            panoLoadedSecondMeaningful && panoLoadedTwice === false
                            ? "**三者均幂等**（含已加载与未加载 Panorama 的重复调用；" +
                              `未加载首次=${describeAttempt("pano.unloaded.destroy")}）`
                            : UNKNOWN),
    );
  }

  // ── 2. 销毁期是否回调业务 ──────────────────────────────────────────────
  {
    const destroyListenerThrew = threwOf("map.control.destroyListener");
    const mapDestroyEvents = countOf("map.destroyEventCount");
    const autoControl = countOf("auto.control.callbackObserved");
    const autoSearchThrew = threwOf("auto.search");
    const autoDuring = countOf("auto.callbacksDuringDispose");
    const autoAfter = countOf("auto.callbacksAfterDispose");

    // Map 路径与 Autocomplete 路径**分开**下结论：Map 的 destroy 事件不能外推成
    // 「Autocomplete dispose 也会回写」；Autocomplete 的 0/0 在对照组不成立时也不能
    // 落成「未见回调」（可能只是网络没回）。
    // 半边前置：监听未挂上 / search 未发出 ⇒ 对应半边第三态，0 不构成「未见回调」。
    const mapPart =
      destroyListenerThrew === null || destroyListenerThrew !== false
        ? destroyListenerThrew === true
          ? UNKNOWN.replace("（读数缺失）", "（destroy 监听未挂上，destroyEventCount=0 不构成「未见回调」）")
          : UNKNOWN
        : mapDestroyEvents === null
          ? UNKNOWN
          : mapDestroyEvents >= 1
            ? `**Map destroy 会回调业务**（事件=${mapDestroyEvents} ⇒ Map 路径 guard 按「可能重入」防护）`
            : `**Map destroy 未见业务回调**（事件=${mapDestroyEvents}；本轮窗口没测到，不等于官方永不回调）`;

    const autoPart =
      autoSearchThrew === null || autoSearchThrew !== false
        ? autoSearchThrew === true
          ? UNKNOWN.replace("（读数缺失）", "（auto.search 抛错，dispose 臂 0/0 不构成「未见回调」）")
          : UNKNOWN
        : autoControl === null || autoDuring === null || autoAfter === null
          ? UNKNOWN
          : autoControl < 1
            ? `**无法判定**（对照组 callbackObserved=${autoControl}，` +
              `dispose 臂 期间/之后=${autoDuring}/${autoAfter} 无法区分「dispose 挡住」与「网络没回」）`
            : autoDuring >= 1 || autoAfter >= 1
              ? `**Autocomplete dispose 会回调业务**（对照组=${autoControl}；` +
                `dispose 期间/之后=${autoDuring}/${autoAfter} ⇒ service 路径 guard 按「可能重入」防护）`
              : `**Autocomplete dispose 窗口内未见回调**（对照组=${autoControl} 证明服务可回调；` +
                `dispose 期间/之后=${autoDuring}/${autoAfter} —— 只说明本轮窗口没测到，不等于官方永不回调）`;

    lines.push(
      `[销毁期回调] Map 监听=${destroyListenerThrew === null ? "—" : destroyListenerThrew ? "抛错" : "ok"}` +
        ` / destroy 事件=${num(mapDestroyEvents)}；` +
        `Autocomplete search=${autoSearchThrew === null ? "—" : autoSearchThrew ? "抛错" : "ok"}` +
        ` / 对照组=${num(autoControl)} / dispose 期间=${num(autoDuring)}` +
        ` / dispose 之后=${num(autoAfter)} ⇒ ` +
        `Map：${mapPart}；Autocomplete：${autoPart}`,
    );
  }

  return lines;
}

/**
 * 控件成立后的**最终退出码**：`0` = 全 pass（每条结论都确定）；`1` = 至少一条仍是第三态。
 *
 * #128 退出码约定「0 全 pass」。半边前置（destroyListener / auto.search）刻意不进
 * `controlFailures`，以便 stdout 仍打印另一半有效结论；但 shell status 不得在
 * 「Map：**无法判定**」时仍返回 0——命令层在打印 verdicts 后必须调用本函数。
 */
export function conclusionExitCode(report: ProbeReport): 0 | 1 {
  return verdicts(report).some((line) => line.includes("无法判定")) ? 1 : 0;
}
