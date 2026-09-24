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
 * 两条硬门槛：
 * 1. Map 首次 destroy 必须成功（正证：SDK 起来了、销毁路径可测）；
 * 2. Autocomplete 首次 dispose 必须成功（正证：服务实例可测）。
 *
 * Panorama **未加载场景**的 destroy 抛错是**已知反例**，不进控件——它恰恰是 F-3 要测的一侧。
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
  return failures;
}

/**
 * 把读数映射成结论——本探针真正的产物。共 **2** 条，与
 * `v3-probe-destroy-idempotency-verdicts.test.ts` 的空报告用例条数锁在一起。
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

    lines.push(
      `[幂等性] Map first=${describeAttempt("map.control.destroyOnce")}` +
        ` / second=${describeAttempt("map.destroyTwice")}；` +
        `Autocomplete first=${describeAttempt("auto.control.disposeOnce")}` +
        ` / second=${describeAttempt("auto.disposeTwice")}；` +
        `Panorama(loaded) first=${describeAttempt("pano.loaded.destroyOnce")}` +
        ` / second=${describeAttempt("pano.loaded.destroyTwice")}；` +
        `Panorama(empty)=${describeAttempt("pano.unloaded.destroy")} ⇒ ` +
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
                      " 本库 guard 只能承诺「本库保证」，不能写成官方幂等）"
                    : panoLoadedTwice === true
                      ? "**已加载 Panorama 第二次抛错**（重复 destroy 不是 no-op）"
                      : panoEmpty === true && mapTwice === false && autoTwice === false && panoLoadedTwice === false
                        ? "**有条件幂等**（Map / Autocomplete / 已加载 Panorama 重复销毁不抛；" +
                          "未加载 Panorama 首次即抛 —— 与 ADR 2026-09-12 已知反例一致）"
                        : mapTwice === false && autoTwice === false && panoLoadedOnce === false && panoLoadedTwice === false
                          ? "**三者均幂等**（含已加载与未加载 Panorama 的重复调用；" +
                            `未加载首次=${describeAttempt("pano.unloaded.destroy")}）`
                          : UNKNOWN),
    );
  }

  // ── 2. 销毁期是否回调业务 ──────────────────────────────────────────────
  {
    const mapDestroyEvents = countOf("map.destroyEventCount");
    const autoDuring = countOf("auto.callbacksDuringDispose");
    const autoAfter = countOf("auto.callbacksAfterDispose");
    lines.push(
      `[销毁期回调] Map destroy 事件到业务=${num(mapDestroyEvents)}；` +
        `Autocomplete dispose 期间=${num(autoDuring)} / dispose 之后=${num(autoAfter)} ⇒ ` +
        (mapDestroyEvents === null || autoDuring === null || autoAfter === null
          ? UNKNOWN
          : // 结论只陈述**哪条路径有读数**，不把「Map 有事件」外推成「Autocomplete dispose 也会回写」。
            mapDestroyEvents >= 1 || autoDuring >= 1 || autoAfter >= 1
            ? "**销毁期会回调业务**（有读数的路径在 destroy/dispose 前后触达了业务回调：" +
              `Map destroy 事件=${mapDestroyEvents}，Autocomplete dispose 期间/之后=${autoDuring}/${autoAfter}` +
              " ⇒ 对应路径的 guard 按「可能重入」防护；Autocomplete 计数为 0 的路径本轮未测到回写）"
            : "**销毁期未见业务回调**（本轮窗口内 destroy/dispose 未触发业务回调；" +
              "这不等于官方「永不回调」——只是本轮没测到，guard 仍按「可能」措辞保留）"),
    );
  }

  return lines;
}
